import { jobsRepo, readingsRepo } from "./db.js";

export const PERIOD_MS: Record<string, number> = {
  "1h": 1 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export interface Summary {
  job_id: string;
  location: string;
  session_id: string;
  period: string;
  readings_count: number;
  first_reading?: string;
  last_reading?: string;
  stats: Record<string, { min: number; max: number; avg: number; count: number }>;
}

/**
 * Aggregate a job's recent readings into min/max/avg per variable.
 * Returns null if the job is unknown; `readings_count: 0` if no data yet.
 * Shared by the get_weather_summary tool and the scheduler's push notifications.
 */
export function summarize(job_id: string, period: string): Summary | null {
  const job = jobsRepo.get(job_id);
  if (!job) return null;

  const sinceMs = Date.now() - (PERIOD_MS[period] ?? PERIOD_MS["24h"]);
  const readings = readingsRepo.getRecent(job_id, sinceMs);

  if (readings.length === 0) {
    return {
      job_id,
      location: job.location,
      session_id: job.session_id,
      period,
      readings_count: 0,
      stats: {},
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

  const stats: Summary["stats"] = {};
  for (const [varName, values] of Object.entries(buckets)) {
    if (values.length === 0) continue;
    stats[varName] = {
      min: +Math.min(...values).toFixed(2),
      max: +Math.max(...values).toFixed(2),
      avg: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
      count: values.length,
    };
  }

  return {
    job_id,
    location: job.location,
    session_id: job.session_id,
    period,
    readings_count: readings.length,
    first_reading: new Date(readings[0].fetched_at).toISOString(),
    last_reading: new Date(readings[readings.length - 1].fetched_at).toISOString(),
    stats,
  };
}
