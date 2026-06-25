import * as cron from "node-cron";
import { jobsRepo, readingsRepo, type Job } from "./db.js";
import { openMeteoFetch } from "./client.js";
import { pushSummaryForJob } from "./notifications.js";

// active cron tasks, keyed by job id
const activeTasks = new Map<string, cron.ScheduledTask>();

async function runJob(job: Job) {
  try {
    const data = await openMeteoFetch("https://api.open-meteo.com/v1/forecast", {
      latitude: job.latitude,
      longitude: job.longitude,
      hourly: job.variables,
      timezone: "auto",
      forecast_days: 1,
    });
    readingsRepo.insert(job.id, data as Record<string, unknown>);
  } catch (err) {
    readingsRepo.insert(job.id, { error: String(err), fetched_at: Date.now() });
  }
  // Push a fresh summary to any subscribed client (no-op if none). This is what
  // makes periodic delivery server-driven: clients receive without polling.
  await pushSummaryForJob(job.id, job.session_id);
}

export function startJob(job: Job) {
  if (activeTasks.has(job.id)) return;
  const task = cron.schedule(job.cron_expr, () => runJob(job));
  activeTasks.set(job.id, task);
}

export function stopJob(id: string) {
  const task = activeTasks.get(id);
  if (task) {
    task.stop();
    activeTasks.delete(id);
  }
}

export function isRunning(id: string): boolean {
  return activeTasks.has(id);
}

// Restore all persisted jobs on server start (all sessions)
export function restoreJobs() {
  for (const job of jobsRepo.listAll()) {
    startJob(job);
  }
}
