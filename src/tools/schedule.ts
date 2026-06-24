import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { jobsRepo, readingsRepo } from "../db.js";
import { startJob, stopJob, isRunning } from "../scheduler.js";

const PERIOD_MS: Record<string, number> = {
  "1h":  1 * 60 * 60 * 1000,
  "6h":  6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const sessionParam = z
  .string()
  .min(1)
  .max(128)
  .describe(
    "Caller's session/user identifier. Jobs are isolated per session — " +
    "list_jobs and cancel_job only see jobs created with the same session_id. " +
    "Use a stable ID (e.g. Telegram user ID, Claude session ID, bot name)."
  );

export function registerScheduleTools(server: McpServer) {
  // ── schedule_weather_job ────────────────────────────────────────────────
  server.registerTool(
    "schedule_weather_job",
    {
      description:
        "Create a recurring weather data collection job. " +
        "The server will fetch weather data on the given cron schedule and persist it locally. " +
        "Returns a job_id to use with get_weather_summary / cancel_job. " +
        "Jobs are scoped to session_id — other callers cannot see or cancel your jobs.",
      inputSchema: z.object({
        session_id: sessionParam,
        location: z.string().describe("Human-readable label, e.g. 'Moscow'"),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        cron_expr: z
          .string()
          .describe(
            "Standard 5-field cron expression. Examples: " +
            "'0 * * * *' (hourly), '0 9 * * *' (daily 09:00), '*/30 * * * *' (every 30 min)"
          ),
        variables: z
          .array(z.string())
          .optional()
          .default(["temperature_2m", "precipitation", "wind_speed_10m", "weather_code"])
          .describe("Hourly Open-Meteo variables to collect"),
      }),
    },
    async (params) => {
      const job = {
        id: randomUUID(),
        session_id: params.session_id,
        cron_expr: params.cron_expr,
        latitude: params.latitude,
        longitude: params.longitude,
        location: params.location,
        variables: params.variables,
        created_at: Date.now(),
      };
      jobsRepo.insert(job);
      startJob(job);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              job_id: job.id,
              message: `Job scheduled: ${params.location} every '${params.cron_expr}'`,
            }),
          },
        ],
      };
    }
  );

  // ── list_jobs ───────────────────────────────────────────────────────────
  server.registerTool(
    "list_jobs",
    {
      description: "List active weather collection jobs for this session.",
      inputSchema: z.object({
        session_id: sessionParam,
      }),
    },
    async (params) => {
      const jobs = jobsRepo.listBySession(params.session_id).map((j) => ({
        job_id: j.id,
        location: j.location,
        cron_expr: j.cron_expr,
        coordinates: { lat: j.latitude, lon: j.longitude },
        variables: j.variables,
        readings: readingsRepo.countByJob(j.id),
        running: isRunning(j.id),
        created_at: new Date(j.created_at).toISOString(),
      }));
      return { content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }] };
    }
  );

  // ── get_weather_summary ─────────────────────────────────────────────────
  server.registerTool(
    "get_weather_summary",
    {
      description:
        "Retrieve aggregated weather readings collected by a scheduled job. " +
        "Returns min/max/avg for each numeric variable over the requested period. " +
        "Requires session_id matching the one used when the job was created.",
      inputSchema: z.object({
        session_id: sessionParam,
        job_id: z.string().uuid().describe("Job ID from schedule_weather_job or list_jobs"),
        period: z
          .enum(["1h", "6h", "12h", "24h", "7d", "30d"])
          .optional()
          .default("24h")
          .describe("Lookback window for aggregation"),
      }),
    },
    async (params) => {
      const job = jobsRepo.get(params.job_id);
      if (!job) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Job not found" }) }] };
      }
      if (job.session_id !== params.session_id) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Job not found" }) }] };
      }

      const sinceMs = Date.now() - (PERIOD_MS[params.period] ?? PERIOD_MS["24h"]);
      const readings = readingsRepo.getRecent(params.job_id, sinceMs);

      if (readings.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                job_id: params.job_id,
                location: job.location,
                period: params.period,
                readings: 0,
                message: "No data collected yet",
              }),
            },
          ],
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
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        stats[varName] = { min: +min.toFixed(2), max: +max.toFixed(2), avg: +avg.toFixed(2), count: values.length };
      }

      return {
        content: [
          {
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
          },
        ],
      };
    }
  );

  // ── cancel_job ──────────────────────────────────────────────────────────
  server.registerTool(
    "cancel_job",
    {
      description: "Stop and delete a scheduled weather collection job. Collected data is also deleted.",
      inputSchema: z.object({
        session_id: sessionParam,
        job_id: z.string().uuid(),
      }),
    },
    async (params) => {
      const job = jobsRepo.get(params.job_id);
      if (!job) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Job not found" }) }] };
      }
      if (job.session_id !== params.session_id) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Job not found" }) }] };
      }
      stopJob(params.job_id);
      jobsRepo.delete(params.job_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, message: `Job '${job.location}' cancelled and deleted` }),
          },
        ],
      };
    }
  );
}
