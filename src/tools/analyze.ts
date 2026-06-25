import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ACTIVITIES,
  type Activity,
  type NDay,
  normalizeDaily,
  wmoDescription,
  scoreActivityDay,
} from "./weather-logic.js";

// ── shared schemas ─────────────────────────────────────────────────────────
// A normalized day as produced by summarize_forecast. Kept loose (passthrough)
// so the agent can hand days between tools without field-by-field surgery.

const NDaySchema = z.object({
  date: z.string(),
  weekday: z.string().optional(),
  temp_min: z.number(),
  temp_max: z.number(),
  temp_avg: z.number(),
  precipitation_mm: z.number(),
  rain_probability_pct: z.number(),
  wind_speed_kmh: z.number(),
  uv_index: z.number(),
  sunshine_hours: z.number(),
  weather_code: z.number().optional(),
  weather: z.string().optional(),
  sunrise: z.string().optional(),
  sunset: z.string().optional(),
  daylight_hours: z.number().optional(),
}).passthrough();

const ActivityEnum = z.enum(ACTIVITIES).describe(
  "Outdoor activity to weigh the weather for. Affects ideal temperature band and rain/wind sensitivity."
);

function jsonResult(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function summaryLine(d: NDay): string {
  return `${d.weather ?? wmoDescription(d.weather_code ?? -1)}, ${d.temp_min}–${d.temp_max}°C, ` +
    `rain ${d.precipitation_mm}mm (${d.rain_probability_pct}%), wind ${d.wind_speed_kmh} km/h, ` +
    `${d.sunshine_hours}h sun, UV ${d.uv_index}`;
}

export function registerAnalyzeTools(server: McpServer) {

  // ── summarize_forecast — raw get_forecast JSON → normalized days ──────────
  server.registerTool(
    "summarize_forecast",
    {
      description:
        "Normalize a raw get_forecast response into a tidy array of daily entries " +
        "(date, weekday, temp min/max/avg, rain mm & probability, wind, UV, sunshine hours, condition text). " +
        "Run this on each get_forecast result before scoring/ranking/filtering. " +
        "Output `days` feeds score_activity_day, best_day, rank_weather, filter_days, compare_forecasts.",
      inputSchema: z.object({
        forecast: z.object({ daily: z.record(z.any()).optional() }).passthrough()
          .describe("The full JSON returned by get_forecast (must contain a `daily` block)."),
        label: z.string().optional()
          .describe("Human label for this location, e.g. 'Moscow'. Carried into the output."),
      }),
    },
    async (params) => {
      const daily = (params.forecast as { daily?: Record<string, unknown> }).daily;
      if (!daily || !Array.isArray((daily as { time?: unknown }).time)) {
        return jsonResult({ error: "No daily data in forecast. Call get_forecast with a `daily` variable list first." });
      }
      const days = normalizeDaily(daily as Parameters<typeof normalizeDaily>[0]);
      return jsonResult({ label: params.label, count: days.length, days });
    }
  );

  // ── describe_weather_code — WMO code(s) → text ───────────────────────────
  server.registerTool(
    "describe_weather_code",
    {
      description:
        "Translate WMO weather code(s) into human-readable descriptions (e.g. 95 → 'Thunderstorm'). " +
        "Accepts a single code or an array.",
      inputSchema: z.object({
        code: z.number().int().optional().describe("A single WMO weather code."),
        codes: z.array(z.number().int()).optional().describe("Multiple WMO weather codes."),
      }),
    },
    async (params) => {
      if (params.codes) {
        return jsonResult({ descriptions: params.codes.map((c) => ({ code: c, description: wmoDescription(c) })) });
      }
      if (typeof params.code === "number") {
        return jsonResult({ code: params.code, description: wmoDescription(params.code) });
      }
      return jsonResult({ error: "Provide `code` or `codes`." });
    }
  );

  // ── score_activity_day — one day + activity → score + reasons ────────────
  server.registerTool(
    "score_activity_day",
    {
      description:
        "Score a SINGLE normalized day (0–100) for how good it is for an activity, with reasons. " +
        "Use to evaluate one specific day; for picking the best across many days use best_day or rank_weather.",
      inputSchema: z.object({
        day: NDaySchema.describe("One normalized day from summarize_forecast."),
        activity: ActivityEnum,
      }),
    },
    async (params) => {
      const { score, reasons } = scoreActivityDay(params.day, params.activity as Activity);
      return jsonResult({ date: params.day.date, activity: params.activity, score, reasons, summary: summaryLine(params.day as NDay) });
    }
  );

  // ── best_day — best day for ONE location ─────────────────────────────────
  server.registerTool(
    "best_day",
    {
      description:
        "Pick the best day for an activity from ONE location's normalized days. " +
        "Answers 'when this week is best for X in <city>?'. For comparing MULTIPLE cities use rank_weather.",
      inputSchema: z.object({
        label: z.string().optional().describe("Location label, e.g. 'Moscow'."),
        days: z.array(NDaySchema).min(1).describe("Normalized days from summarize_forecast."),
        activity: ActivityEnum,
      }),
    },
    async (params) => {
      const ranked = params.days
        .map((d) => ({ day: d as NDay, ...scoreActivityDay(d, params.activity as Activity) }))
        .sort((a, b) => b.score - a.score);
      const top = ranked[0];
      return jsonResult({
        label: params.label,
        activity: params.activity,
        best: { date: top.day.date, weekday: top.day.weekday, score: top.score, reasons: top.reasons, summary: summaryLine(top.day) },
        ranking: ranked.map((r) => ({ date: r.day.date, weekday: r.day.weekday, score: r.score })),
      });
    }
  );

  // ── rank_weather — best (day, location) across MANY locations ────────────
  server.registerTool(
    "rank_weather",
    {
      description:
        "Compare MULTIPLE locations and find the single best (day + location) for an activity. " +
        "Answers 'which city has the best weather for X this week?'. " +
        "Feed it the summarize_forecast output of each location.",
      inputSchema: z.object({
        locations: z.array(z.object({
          label: z.string().describe("Location label, e.g. 'Sochi'."),
          days: z.array(NDaySchema).min(1),
        })).min(1).describe("Per-location normalized days (one entry per city)."),
        activity: ActivityEnum,
        date: z.string().optional().describe("Restrict to this YYYY-MM-DD; omit to consider the whole range."),
      }),
    },
    async (params) => {
      const scored = params.locations.flatMap((loc) =>
        loc.days
          .filter((d) => !params.date || d.date === params.date)
          .map((d) => ({ location: loc.label, day: d as NDay, ...scoreActivityDay(d, params.activity as Activity) }))
      ).sort((a, b) => b.score - a.score);

      if (scored.length === 0) return jsonResult({ error: "No matching days to rank." });

      const best = scored[0];
      const explanation =
        `Best for ${params.activity}: ${best.day.weekday} ${best.day.date} in ${best.location} — ` +
        `${summaryLine(best.day)}. Score ${best.score} of ${scored.length} day/location combos` +
        (best.reasons.length ? ` (${best.reasons.join(", ")})` : "") + ".";
      return jsonResult({
        activity: params.activity,
        considered: scored.length,
        best: { location: best.location, date: best.day.date, weekday: best.day.weekday, score: best.score, reasons: best.reasons },
        explanation,
        ranking: scored.slice(0, 12).map((r) => ({ location: r.location, date: r.day.date, weekday: r.day.weekday, score: r.score })),
      });
    }
  );

  // ── filter_days — keep days matching constraints ─────────────────────────
  server.registerTool(
    "filter_days",
    {
      description:
        "Keep only the days that satisfy weather constraints (dry-enough, warm-enough, calm-enough…). " +
        "Useful as a pre-filter before scoring, e.g. 'days under 2mm rain and 18–26°C'.",
      inputSchema: z.object({
        days: z.array(NDaySchema).min(1),
        max_precipitation_mm: z.number().optional(),
        max_rain_probability_pct: z.number().optional(),
        min_temp: z.number().optional().describe("Minimum daily average temperature (°C)."),
        max_temp: z.number().optional().describe("Maximum daily average temperature (°C)."),
        max_wind_kmh: z.number().optional(),
        min_sunshine_hours: z.number().optional(),
      }),
    },
    async (params) => {
      const matched = params.days.filter((d) =>
        (params.max_precipitation_mm === undefined || d.precipitation_mm <= params.max_precipitation_mm) &&
        (params.max_rain_probability_pct === undefined || d.rain_probability_pct <= params.max_rain_probability_pct) &&
        (params.min_temp === undefined || d.temp_avg >= params.min_temp) &&
        (params.max_temp === undefined || d.temp_avg <= params.max_temp) &&
        (params.max_wind_kmh === undefined || d.wind_speed_kmh <= params.max_wind_kmh) &&
        (params.min_sunshine_hours === undefined || d.sunshine_hours >= params.min_sunshine_hours)
      );
      return jsonResult({ matched: matched.length, of: params.days.length, days: matched });
    }
  );

  // ── compare_forecasts — side-by-side table by date ───────────────────────
  server.registerTool(
    "compare_forecasts",
    {
      description:
        "Build a side-by-side comparison table of several locations by date " +
        "(temp, rain, wind, sunshine). Pure presentation — no scoring. " +
        "Use when the user wants the raw numbers next to each other rather than a single winner.",
      inputSchema: z.object({
        locations: z.array(z.object({
          label: z.string(),
          days: z.array(NDaySchema).min(1),
        })).min(2).describe("Two or more locations' normalized days."),
      }),
    },
    async (params) => {
      const dates = [...new Set(params.locations.flatMap((l) => l.days.map((d) => d.date)))].sort();
      const table = dates.map((date) => {
        const row: Record<string, unknown> = { date };
        for (const loc of params.locations) {
          const d = loc.days.find((x) => x.date === date) as NDay | undefined;
          row[loc.label] = d
            ? { temp: `${d.temp_min}–${d.temp_max}°C`, rain_mm: d.precipitation_mm, wind_kmh: d.wind_speed_kmh, sun_h: d.sunshine_hours, weather: d.weather ?? wmoDescription(d.weather_code ?? -1) }
            : null;
        }
        return row;
      });
      return jsonResult({ locations: params.locations.map((l) => l.label), table });
    }
  );

  // ── sun_window — daylight window for a day ───────────────────────────────
  server.registerTool(
    "sun_window",
    {
      description:
        "Compute the daylight window (sunrise → sunset and daylight hours) for a normalized day " +
        "that carries sunrise/sunset (request `sunrise`,`sunset`,`daylight_duration` in get_forecast's daily). " +
        "Useful for planning the time of an outdoor activity.",
      inputSchema: z.object({
        day: NDaySchema.describe("A normalized day including sunrise/sunset."),
      }),
    },
    async (params) => {
      const d = params.day as NDay;
      if (!d.sunrise || !d.sunset) {
        return jsonResult({ error: "Day has no sunrise/sunset. Request sunrise,sunset,daylight_duration in get_forecast daily vars." });
      }
      let hours = d.daylight_hours;
      if (hours === undefined) {
        const ms = new Date(d.sunset).getTime() - new Date(d.sunrise).getTime();
        hours = Number.isFinite(ms) ? +(ms / 3_600_000).toFixed(1) : undefined;
      }
      return jsonResult({ date: d.date, sunrise: d.sunrise, sunset: d.sunset, daylight_hours: hours });
    }
  );
}
