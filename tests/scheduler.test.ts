import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node-cron before importing scheduler
vi.mock("node-cron", () => {
  const tasks = new Map<string, { stopped: boolean }>();
  return {
    schedule: vi.fn((expr: string, fn: () => void) => {
      const task = { stopped: false, stop: vi.fn(() => { task.stopped = true; }) };
      tasks.set(expr, task);
      return task;
    }),
  };
});

// Mock db to avoid real SQLite in unit tests
vi.mock("../src/db.js", () => ({
  jobsRepo: {
    list: vi.fn(() => []),
    get: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  readingsRepo: {
    insert: vi.fn(),
    getRecent: vi.fn(() => []),
    countByJob: vi.fn(() => 0),
  },
}));

// Mock client
vi.mock("../src/client.js", () => ({
  openMeteoFetch: vi.fn().mockResolvedValue({ hourly: { temperature_2m: [20] } }),
}));

import { startJob, stopJob, isRunning, restoreJobs } from "../src/scheduler.js";
import { jobsRepo } from "../src/db.js";

const sampleJob = {
  id: "test-job-1",
  cron_expr: "* * * * *",
  latitude: 55.75,
  longitude: 37.62,
  location: "Moscow",
  variables: ["temperature_2m"],
  created_at: Date.now(),
};

describe("scheduler", () => {
  afterEach(() => {
    stopJob(sampleJob.id);
  });

  it("starts a job and marks it as running", () => {
    startJob(sampleJob);
    expect(isRunning(sampleJob.id)).toBe(true);
  });

  it("does not start duplicate jobs", async () => {
    const cron = await import("node-cron");
    const scheduleSpy = vi.mocked(cron.schedule);
    scheduleSpy.mockClear();

    startJob(sampleJob);
    startJob(sampleJob);

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it("stops a running job", () => {
    startJob(sampleJob);
    expect(isRunning(sampleJob.id)).toBe(true);
    stopJob(sampleJob.id);
    expect(isRunning(sampleJob.id)).toBe(false);
  });

  it("stopJob is safe when job not found", () => {
    expect(() => stopJob("nonexistent-id")).not.toThrow();
  });

  it("restoreJobs starts all persisted jobs", () => {
    vi.mocked(jobsRepo.list).mockReturnValueOnce([sampleJob]);
    restoreJobs();
    expect(isRunning(sampleJob.id)).toBe(true);
  });
});
