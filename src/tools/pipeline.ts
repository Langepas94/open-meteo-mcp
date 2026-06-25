import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  geocodeCity,
  fetchWeekForecast,
  scoreDayWeather,
  wmoDescription,
} from "./shared.js";
import { resultsRepo, type PipelineResult } from "../db.js";

// ── shared dataset shape: STEP 1 output === STEP 2 input ───────────────────
// Keeping these schemas exported lets the chain pass data verbatim between
// tools — the agent feeds tool N's JSON straight into tool N+1.

const DaySchema = z.object({
  date: z.string(),
  weekday: z.string(),
  temp_max: z.number(),
  temp_min: z.number(),
  temp_avg: z.number(),
  precipitation_mm: z.number(),
  rain_probability_pct: z.number(),
  wind_speed_kmh: z.number(),
  uv_index: z.number(),
  sunshine_hours: z.number(),
  weather_code: z.number(),
});

const LocationSchema = z.object({
  label: z.string(),
  country: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  days: z.array(DaySchema),
});

const DatasetSchema = z.object({
  pipeline_version: z.literal("1"),
  generated_at: z.string(),
  activity: z.string(),
  date_range: z.object({ start: z.string(), end: z.string() }),
  locations: z.array(LocationSchema),
  errors: z.array(z.string()).optional(),
});

type Dataset = z.infer<typeof DatasetSchema>;
type Day = z.infer<typeof DaySchema>;

// Activity weighting — applied ON TOP of the base good-weather score.
// Cycling/walking care more about dry roads & manageable wind than UV.
export const ACTIVITY_MOD: Record<string, (d: Day) => number> = {
  cycling: (d) => (d.wind_speed_kmh > 25 ? -(d.wind_speed_kmh - 25) * 0.6 : 0) - d.precipitation_mm * 4,
  walking: (d) => -d.rain_probability_pct * 0.2,
  general: () => 0,
};

export function weekdayOf(date: string): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

function jsonResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

export function registerPipelineTools(server: McpServer) {

  // ── STEP 1: FETCH ────────────────────────────────────────────────────────
  server.registerTool(
    "pipeline_fetch_weather",
    {
      description:
        "PIPELINE STEP 1 of 3 — FETCH. " +
        "Geocodes each city and fetches the daily forecast for the next N days. " +
        "Returns a structured `dataset` object. " +
        "NEXT STEP: pass the ENTIRE returned dataset, unchanged, into `pipeline_analyze_weather`.",
      inputSchema: z.object({
        cities: z.array(z.string()).min(1).max(20)
          .describe("City names to fetch, e.g. ['Moscow', 'Sochi', 'Kazan']"),
        days: z.number().int().min(1).max(16).optional().default(7)
          .describe("How many days ahead to fetch (default 7 = next week)"),
        activity: z.enum(["cycling", "walking", "general"]).optional().default("general")
          .describe("Outdoor activity the weather is being judged for. Carried into the dataset so step 2 weights the score accordingly."),
        language: z.string().optional().default("en")
          .describe("Language for geocoding results (ISO 639-1)"),
      }),
    },
    async (params) => {
      const locations: Dataset["locations"] = [];
      const errors: string[] = [];

      await Promise.all(params.cities.map(async (city) => {
        try {
          const geo = await geocodeCity(city, params.language);
          if (!geo) { errors.push(`Not found: ${city}`); return; }

          const daily = await fetchWeekForecast(geo.latitude, geo.longitude, params.days);
          if (!daily) { errors.push(`No forecast for ${city}`); return; }

          const days: Day[] = daily.time.map((date, i) => {
            const temp_max = daily.temperature_2m_max[i];
            const temp_min = daily.temperature_2m_min[i];
            return {
              date,
              weekday: weekdayOf(date),
              temp_max,
              temp_min,
              temp_avg: +((temp_max + temp_min) / 2).toFixed(1),
              precipitation_mm: daily.precipitation_sum[i] ?? 0,
              rain_probability_pct: daily.precipitation_probability_max[i] ?? 0,
              wind_speed_kmh: daily.wind_speed_10m_max[i] ?? 0,
              uv_index: daily.uv_index_max[i] ?? 0,
              sunshine_hours: +((daily.sunshine_duration[i] ?? 0) / 3600).toFixed(1),
              weather_code: daily.weather_code[i],
            };
          });

          locations.push({
            label: geo.admin1 ? `${geo.name}, ${geo.admin1}` : geo.name,
            country: geo.country,
            latitude: geo.latitude,
            longitude: geo.longitude,
            days,
          });
        } catch (e) {
          errors.push(`Error for ${city}: ${String(e)}`);
        }
      }));

      if (locations.length === 0) {
        return jsonResult({ error: "Could not fetch any city", details: errors });
      }

      const allDates = locations.flatMap((l) => l.days.map((d) => d.date)).sort();
      const dataset: Dataset = {
        pipeline_version: "1",
        generated_at: new Date().toISOString(),
        activity: params.activity,
        date_range: { start: allDates[0], end: allDates[allDates.length - 1] },
        locations,
        errors: errors.length ? errors : undefined,
      };
      return jsonResult({
        step: "1/3 fetch complete",
        next: "Feed this whole object into pipeline_analyze_weather (as `dataset`).",
        dataset,
      });
    }
  );

  // ── STEP 2: ANALYZE ──────────────────────────────────────────────────────
  server.registerTool(
    "pipeline_analyze_weather",
    {
      description:
        "PIPELINE STEP 2 of 3 — ANALYZE. " +
        "Takes the `dataset` produced by pipeline_fetch_weather and scores every (city, day) pair " +
        "to find the single best day + city for the activity. Returns an analysis with an explanation. " +
        "REQUIRES the dataset from step 1 — it does NOT fetch weather itself. " +
        "NEXT STEP: pass the returned analysis into `pipeline_save_result`.",
      inputSchema: z.object({
        // Optional so a bare/empty call yields a friendly guide instead of a raw
        // zod validation error — this is the documented "no data passed" path.
        dataset: DatasetSchema.optional()
          .describe("The exact dataset object returned by pipeline_fetch_weather."),
      }),
    },
    async (params) => {
      const dataset = params.dataset;
      if (!dataset || dataset.locations.length === 0) {
        return jsonResult({
          error: "No dataset to analyze.",
          hint: "This is step 2 of a 3-step pipeline. Call pipeline_fetch_weather FIRST, then pass its `dataset` here.",
          expected_input: "{ dataset: <output of pipeline_fetch_weather> }",
        });
      }

      const activity = dataset.activity ?? "general";
      const mod = ACTIVITY_MOD[activity] ?? ACTIVITY_MOD.general;

      // Score every (city, day) pair.
      const scored = dataset.locations.flatMap((loc) =>
        loc.days.map((d) => {
          const base = scoreDayWeather({
            temp_max: d.temp_max, temp_min: d.temp_min, temp_avg: d.temp_avg,
            precipitation_mm: d.precipitation_mm, rain_probability_pct: d.rain_probability_pct,
            wind_speed_kmh: d.wind_speed_kmh, uv_index: d.uv_index, sunshine_hours: d.sunshine_hours,
          });
          const score = Math.round(base + mod(d));
          return {
            location: loc.label,
            country: loc.country,
            date: d.date,
            weekday: d.weekday,
            score,
            weather: wmoDescription(d.weather_code),
            temp: `${d.temp_min}–${d.temp_max}°C`,
            rain_mm: d.precipitation_mm,
            rain_probability_pct: d.rain_probability_pct,
            wind_kmh: d.wind_speed_kmh,
            sunshine_h: d.sunshine_hours,
            uv_index: d.uv_index,
          };
        })
      ).sort((a, b) => b.score - a.score);

      const best = scored[0];
      const explanation =
        `Best for ${activity}: ${best.weekday} ${best.date} in ${best.location}` +
        (best.country ? `, ${best.country}` : "") + `. ` +
        `${best.weather}, ${best.temp}, rain ${best.rain_mm}mm (${best.rain_probability_pct}%), ` +
        `wind ${best.wind_kmh} km/h, ${best.sunshine_h}h sun, UV ${best.uv_index}. ` +
        `Scored ${best.score} — highest of ${scored.length} day/city combos (higher = drier, calmer, sunnier, mild temp).`;

      const analysis = {
        activity,
        date_range: dataset.date_range,
        considered: scored.length,
        best: {
          location: best.location,
          country: best.country,
          date: best.date,
          weekday: best.weekday,
          score: best.score,
        },
        explanation,
        ranking: scored.slice(0, 10),
      };

      return jsonResult({
        step: "2/3 analysis complete",
        next: "Pass this analysis into pipeline_save_result to persist it for the client.",
        analysis,
      });
    }
  );

  // ── STEP 3: SAVE ─────────────────────────────────────────────────────────
  const AnalysisSchema = z.object({
    activity: z.string(),
    date_range: z.object({ start: z.string(), end: z.string() }).optional(),
    considered: z.number().optional(),
    best: z.object({
      location: z.string(),
      country: z.string().optional(),
      date: z.string(),
      weekday: z.string().optional(),
      score: z.number(),
    }),
    explanation: z.string(),
    ranking: z.array(z.unknown()).optional(),
  });

  server.registerTool(
    "pipeline_save_result",
    {
      description:
        "PIPELINE STEP 3 of 3 — SAVE. " +
        "Persists the analysis from pipeline_analyze_weather so the MCP client can fetch it later " +
        "via pipeline_get_result. Returns a `result_id`. " +
        "REQUIRES the analysis from step 2.",
      inputSchema: z.object({
        session_id: z.string().min(1).max(128)
          .describe("Stable caller id (e.g. chat/user id). Isolates results per user; the agent sets it, does not ask."),
        question: z.string().optional()
          .describe("The original user question, stored for context, e.g. 'best day for a bike ride next week'."),
        analysis: AnalysisSchema.optional()
          .describe("The analysis object returned by pipeline_analyze_weather."),
      }),
    },
    async (params) => {
      if (!params.analysis) {
        return jsonResult({
          error: "No analysis to save.",
          hint: "This is step 3 of a 3-step pipeline. Run pipeline_analyze_weather FIRST, then pass its `analysis` here.",
        });
      }
      const a = params.analysis;
      const row: PipelineResult = {
        id: randomUUID(),
        session_id: params.session_id,
        created_at: Date.now(),
        question: params.question ?? null,
        best_label: a.best.location,
        best_date: a.best.date,
        best_score: a.best.score,
        explanation: a.explanation,
        payload: a as Record<string, unknown>,
      };
      resultsRepo.insert(row);
      return jsonResult({
        step: "3/3 saved",
        ok: true,
        result_id: row.id,
        message: `Saved. Best: ${a.best.weekday ?? ""} ${a.best.date} in ${a.best.location} (score ${a.best.score}).`,
        retrieve_with: `pipeline_get_result { session_id, result_id: "${row.id}" }`,
      });
    }
  );

  // ── RETRIEVAL: client reads a saved result ────────────────────────────────
  server.registerTool(
    "pipeline_get_result",
    {
      description:
        "Retrieve a saved pipeline result. " +
        "Provide a result_id to get one, or omit it to list the most recent results for the session. " +
        "This is how the MCP client reads what the pipeline produced.",
      inputSchema: z.object({
        session_id: z.string().min(1).max(128)
          .describe("Same session_id used in pipeline_save_result."),
        result_id: z.string().optional()
          .describe("Specific result to fetch. Omit to list recent results."),
      }),
    },
    async (params) => {
      if (params.result_id) {
        const r = resultsRepo.get(params.result_id);
        if (!r || r.session_id !== params.session_id) {
          return jsonResult({ error: "Result not found" });
        }
        return jsonResult({
          result_id: r.id,
          created_at: new Date(r.created_at).toISOString(),
          question: r.question,
          best: { location: r.best_label, date: r.best_date, score: r.best_score },
          explanation: r.explanation,
          analysis: r.payload,
        });
      }

      const list = resultsRepo.listBySession(params.session_id).map((r) => ({
        result_id: r.id,
        created_at: new Date(r.created_at).toISOString(),
        question: r.question,
        best: `${r.best_label} on ${r.best_date} (score ${r.best_score})`,
      }));
      return jsonResult({ count: list.length, results: list });
    }
  );
}
