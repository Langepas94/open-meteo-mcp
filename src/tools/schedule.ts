import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { jobsRepo, readingsRepo } from "../db.js";
import { startJob, stopJob, isRunning } from "../scheduler.js";

const INTERVAL_CRON: Record<string, string> = {
  "10min":  "*/10 * * * *",
  "30min":  "*/30 * * * *",
  "1h":     "0 * * * *",
  "6h":     "0 */6 * * *",
  "12h":    "0 */12 * * *",
  "daily":  "0 9 * * *",
  "weekly": "0 9 * * 1",
};

const PERIOD_MS: Record<string, number> = {
  "1h":  1 * 60 * 60 * 1000,
  "6h":  6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function registerScheduleTools(server: McpServer) {
  // ── schedule_weather_job ────────────────────────────────────────────────
  server.registerTool(
    "schedule_weather_job",
    {
      description:
        "Start periodic weather data collection for a location. " +
        "Pick an interval and a location — the server collects data automatically in the background. " +
        "Returns a job_id; use get_weather_summary to read collected data later.",
      inputSchema: z.object({
        session_id: z.string().min(1).max(128).describe(
          "Stable identifier for the caller — set by the bot/client (e.g. Telegram user ID). " +
          "Isolates jobs between users; the agent should NOT ask the user for this."
        ),
        location: z.string().describe("Human-readable label, e.g. 'Moscow'"),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        interval: z.enum(["10min", "30min", "1h", "6h", "12h", "daily", "weekly"])
          .describe("How often to collect data. '10min' = every 10 minutes, 'daily' = once a day at 09:00 UTC."),
        variables: z
          .array(z.string())
          .optional()
          .default(["temperature_2m", "precipitation", "wind_speed_10m", "weather_code"])
          .describe("Weather variables to collect. Default covers temperature, rain, wind, conditions."),
      }),
    },
    async (params) => {
      const cron_expr = INTERVAL_CRON[params.interval];
      const job = {
        id: randomUUID(),
        session_id: params.session_id,
        cron_expr,
        latitude: params.latitude,
        longitude: params.longitude,
        location: params.location,
        variables: params.variables,
        created_at: Date.now(),
      };
      jobsRepo.insert(job);
      startJob(job);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            job_id: job.id,
            message: `Collecting weather for ${params.location} every ${params.interval}`,
          }),
        }],
      };
    }
  );

  // ── list_jobs ───────────────────────────────────────────────────────────
  server.registerTool(
    "list_jobs",
    {
      description: "List all active weather collection jobs for this user.",
      inputSchema: z.object({
        session_id: z.string().min(1).max(128).describe("Same session_id used when creating jobs."),
      }),
    },
    async (params) => {
      const jobs = jobsRepo.listBySession(params.session_id).map((j) => {
        const interval = Object.entries(INTERVAL_CRON).find(([, c]) => c === j.cron_expr)?.[0] ?? j.cron_expr;
        return {
          job_id: j.id,
          location: j.location,
          interval,
          coordinates: { lat: j.latitude, lon: j.longitude },
          variables: j.variables,
          readings_collected: readingsRepo.countByJob(j.id),
          running: isRunning(j.id),
          created_at: new Date(j.created_at).toISOString(),
        };
      });
      return { content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }] };
    }
  );

  // ── get_weather_summary ─────────────────────────────────────────────────
  server.registerTool(
    "get_weather_summary",
    {
      description:
        "Get aggregated weather stats collected by a scheduled job. " +
        "Returns min/max/avg for each variable over the requested period.",
      inputSchema: z.object({
        session_id: z.string().min(1).max(128),
        job_id: z.string().uuid().describe("Job ID from schedule_weather_job or list_jobs"),
        period: z.enum(["1h", "6h", "12h", "24h", "7d", "30d"])
          .optional()
          .default("24h")
          .describe("How far back to aggregate"),
      }),
    },
    async (params) => {
      const job = jobsRepo.get(params.job_id);
      if (!job || job.session_id !== params.session_id) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Job not found" }) }] };
      }

      const sinceMs = Date.now() - (PERIOD_MS[params.period] ?? PERIOD_MS["24h"]);
      const readings = readingsRepo.getRecent(params.job_id, sinceMs);

      if (readings.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              job_id: params.job_id,
              location: job.location,
              period: params.period,
              readings: 0,
              message: "No data collected yet — check back after the first interval fires",
            }),
          }],
        };
      }

      const buckets: Record<string, number[]> = {};
      for (const reading of readings) {
        const hourly = (reading.data as { hourly?: Record<string, unknown[]> }).hourly;
        if (!hourly) continue;
        for (const [varName, values] of Object.entries(hourly)) {
          if (varName === "time") continue;
          if (!buckets[varName]) buckets[varName] = [];
          for (const v of values) {
            if (typeof v === "number") buckets[varName].push(v);
          }
        }
      }

      const stats: Record<string, { min: number; max: number; avg: number; count: number }> = {};
      for (const [varName, values] of Object.entries(buckets)) {
        stats[varName] = {
          min: +Math.min(...values).toFixed(2),
          max: +Math.max(...values).toFixed(2),
          avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
          count: values.length,
        };
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            job_id: params.job_id,
            location: job.location,
            period: params.period,
            readings_count: readings.length,
            first_reading: new Date(readings[0].fetched_at).toISOString(),
            last_reading: new Date(readings[readings.length - 1].fetched_at).toISOString(),
            stats,
          }, null, 2),
        }],
      };
    }
  );

  // ── cancel_job ──────────────────────────────────────────────────────────
  server.registerTool(
    "cancel_job",
    {
      description: "Stop and delete a scheduled weather collection job.",
      inputSchema: z.object({
        session_id: z.string().min(1).max(128),
        job_id: z.string().uuid(),
      }),
    },
    async (params) => {
      const job = jobsRepo.get(params.job_id);
      if (!job || job.session_id !== params.session_id) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Job not found" }) }] };
      }
      stopJob(params.job_id);
      jobsRepo.delete(params.job_id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ok: true, message: `Stopped collecting weather for ${job.location}` }),
        }],
      };
    }
  );
}
