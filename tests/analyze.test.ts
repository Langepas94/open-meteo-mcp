import { describe, it, expect } from "vitest";
import {
  normalizeDaily,
  scoreActivityDay,
  wmoDescription,
  weekdayOf,
  gridPoints,
  type NDay,
} from "../src/tools/weather-logic.js";

function mkDay(o: Partial<NDay>): NDay {
  return {
    date: "2026-06-27", weekday: "Saturday",
    temp_min: 14, temp_max: 24, temp_avg: 19,
    precipitation_mm: 0, rain_probability_pct: 0,
    wind_speed_kmh: 10, uv_index: 4, sunshine_hours: 8,
    weather_code: 0, weather: "Clear sky", ...o,
  };
}

describe("weekdayOf / wmoDescription", () => {
  it("maps ISO date to UTC weekday", () => {
    expect(weekdayOf("2026-06-27")).toBe("Saturday");
    expect(weekdayOf("2026-06-29")).toBe("Monday");
  });
  it("describes WMO codes", () => {
    expect(wmoDescription(0)).toBe("Clear sky");
    expect(wmoDescription(95)).toBe("Thunderstorm");
  });
});

describe("normalizeDaily", () => {
  it("converts parallel arrays into normalized days and fills missing vars", () => {
    const days = normalizeDaily({
      time: ["2026-06-27", "2026-06-28"],
      temperature_2m_max: [24, 26],
      temperature_2m_min: [14, 16],
      precipitation_sum: [0, 5],
      weather_code: [0, 61],
      sunshine_duration: [36000, 7200], // 10h, 2h
      // wind/uv/probability intentionally absent → default 0
    });
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: "2026-06-27", temp_avg: 19, sunshine_hours: 10, weather: "Clear sky" });
    expect(days[0].wind_speed_kmh).toBe(0);          // missing → neutral
    expect(days[1]).toMatchObject({ precipitation_mm: 5, weather: "Rain" });
  });
});

describe("gridPoints", () => {
  it("samples points all within the radius, labeled by distance/direction", () => {
    const pts = gridPoints(55.75, 37.62, 100);
    expect(pts.length).toBeGreaterThan(1);
    expect(pts.every((p) => p.distance_km <= 100)).toBe(true);
    expect(pts.some((p) => p.label === "Center")).toBe(true);
    expect(pts.some((p) => /km (N|NE|E|SE|S|SW|W|NW)$/.test(p.label))).toBe(true);
  });

  it("deduplicates coordinates", () => {
    const pts = gridPoints(0, 0, 200);
    const keys = pts.map((p) => `${p.latitude},${p.longitude}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("scoreActivityDay", () => {
  it("rates a dry sunny mild day high", () => {
    const { score, reasons } = scoreActivityDay(mkDay({}), "cycling");
    expect(score).toBeGreaterThan(100);
    expect(reasons.join(" ")).toContain("comfortable");
  });

  it("penalizes rain more for cycling than for running", () => {
    const wet = mkDay({ precipitation_mm: 6, rain_probability_pct: 70 });
    const cycling = scoreActivityDay(wet, "cycling").score;
    const running = scoreActivityDay(wet, "running").score;
    expect(cycling).toBeLessThan(running);
  });

  it("beach prefers warmth that cycling would call hot", () => {
    const hot = mkDay({ temp_min: 28, temp_max: 34, temp_avg: 31, sunshine_hours: 12 });
    const beach = scoreActivityDay(hot, "beach").score;
    const cycling = scoreActivityDay(hot, "cycling").score;
    expect(beach).toBeGreaterThan(cycling);
  });

  it("never returns a negative score", () => {
    const awful = mkDay({ precipitation_mm: 40, rain_probability_pct: 100, wind_speed_kmh: 80, temp_avg: -5, sunshine_hours: 0 });
    expect(scoreActivityDay(awful, "cycling").score).toBe(0);
  });
});
