import { describe, it, expect } from "vitest";

// Pure aggregation logic extracted for unit testing
function aggregate(readings: Array<{ data: Record<string, unknown> }>) {
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
  return stats;
}

describe("weather summary aggregation", () => {
  it("computes min/max/avg correctly", () => {
    const readings = [
      { data: { hourly: { temperature_2m: [10, 20, 30] } } },
      { data: { hourly: { temperature_2m: [5, 15, 25] } } },
    ];
    const stats = aggregate(readings);
    expect(stats.temperature_2m.min).toBe(5);
    expect(stats.temperature_2m.max).toBe(30);
    expect(stats.temperature_2m.avg).toBe(17.5);
    expect(stats.temperature_2m.count).toBe(6);
  });

  it("skips 'time' key", () => {
    const readings = [
      { data: { hourly: { time: ["2024-01-01T00:00"] as unknown as number[], temperature_2m: [20] } } },
    ];
    const stats = aggregate(readings);
    expect(stats.time).toBeUndefined();
    expect(stats.temperature_2m).toBeDefined();
  });

  it("skips non-numeric values", () => {
    const readings = [
      { data: { hourly: { temperature_2m: [null, 20, undefined] as unknown as number[] } } },
    ];
    const stats = aggregate(readings);
    expect(stats.temperature_2m.count).toBe(1);
    expect(stats.temperature_2m.avg).toBe(20);
  });

  it("handles empty readings", () => {
    const stats = aggregate([]);
    expect(Object.keys(stats)).toHaveLength(0);
  });

  it("handles multiple variables", () => {
    const readings = [
      { data: { hourly: { temperature_2m: [15, 20], wind_speed_10m: [5, 10] } } },
    ];
    const stats = aggregate(readings);
    expect(stats.temperature_2m.avg).toBe(17.5);
    expect(stats.wind_speed_10m.avg).toBe(7.5);
  });
});
