import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import { jobsRepo, readingsRepo } from "../db.js";
import { startJob, stopJob, isRunning } from "../scheduler.js";
import { summarize } from "../summarize.js";
import { subscribe, unsubscribe } from "../notifications.js";

const INTERVAL_CRON: Record<string, string> = {
  "10min":  "*/10 * * * *",
  "30min":  "*/30 * * * *",
  "1h":     "0 * * * *",
  "6h":     "0 */6 * * *",
  "12h":    "0 */12 * * *",
  "daily":  "0 9 * * *",
  "weekly": "0 9 * * 1",
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
      const summary = summarize(params.job_id, params.period);
      if (!summary || summary.session_id !== params.session_id) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Job not found" }) }] };
      }
      if (summary.readings_count === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              job_id: params.job_id,
              location: summary.location,
              period: params.period,
              readings: 0,
              message: "No data collected yet — check back after the first interval fires",
            }),
          }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── subscribe_summaries ─────────────────────────────────────────────────
  server.registerTool(
    "subscribe_summaries",
    {
      description:
        "Subscribe THIS connection to server-pushed weather summaries: after each " +
        "collection the server sends a logging notification (logger 'weather_summary') " +
        "with the aggregated stats, so the client receives periodic summaries WITHOUT polling. " +
        "Call after scheduling a collection job. The client relays the push to its user.",
      inputSchema: z.object({
        session_id: z.string().min(1).max(128).describe("Same session_id used when creating jobs."),
        period: z.enum(["1h", "6h", "12h", "24h", "7d", "30d"]).optional().default("1h")
          .describe("Aggregation window for each pushed summary."),
      }),
    },
    async (params, extra) => {
      if (!extra.sessionId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "push requires a stateful session (no sessionId)" }) }] };
      }
      subscribe(extra.sessionId, params.session_id, params.period);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, message: `Subscribed to pushed summaries (period ${params.period})` }) }],
      };
    }
  );

  // ── unsubscribe_summaries ───────────────────────────────────────────────
  server.registerTool(
    "unsubscribe_summaries",
    {
      description: "Stop receiving server-pushed weather summaries for this session.",
      inputSchema: z.object({
        session_id: z.string().min(1).max(128),
      }),
    },
    async (params, extra) => {
      const removed = extra.sessionId ? unsubscribe(extra.sessionId, params.session_id) : false;
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, removed }) }] };
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
