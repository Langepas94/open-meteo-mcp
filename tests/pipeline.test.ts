import { describe, it, expect } from "vitest";
import { scoreDayWeather } from "../src/tools/shared.js";
import { ACTIVITY_MOD, weekdayOf } from "../src/tools/pipeline.js";

// Mirror of the (city, day) scoring + selection the analyze step performs,
// so we can assert chain behavior without standing up an MCP server.
interface Day {
  date: string; weekday: string;
  temp_max: number; temp_min: number; temp_avg: number;
  precipitation_mm: number; rain_probability_pct: number;
  wind_speed_kmh: number; uv_index: number; sunshine_hours: number;
  weather_code: number;
}

function mkDay(o: Partial<Day>): Day {
  return {
    date: "2026-06-27", weekday: "Saturday",
    temp_max: 24, temp_min: 14, temp_avg: 19,
    precipitation_mm: 0, rain_probability_pct: 0,
    wind_speed_kmh: 10, uv_index: 4, sunshine_hours: 8,
    weather_code: 0, ...o,
  };
}

function bestPick(days: Array<{ city: string; day: Day }>, activity: string) {
  const mod = ACTIVITY_MOD[activity] ?? ACTIVITY_MOD.general;
  return days
    .map(({ city, day }) => ({
      city,
      date: day.date,
      score: Math.round(scoreDayWeather(day) + mod(day)),
    }))
    .sort((a, b) => b.score - a.score)[0];
}

describe("pipeline weekdayOf", () => {
  it("maps ISO date to weekday name (UTC)", () => {
    expect(weekdayOf("2026-06-27")).toBe("Saturday");
    expect(weekdayOf("2026-06-29")).toBe("Monday");
  });
});

describe("pipeline analyze selection", () => {
  it("picks the driest, sunniest day/city across the week", () => {
    const candidates = [
      { city: "Moscow", day: mkDay({ date: "2026-06-27", precipitation_mm: 12, rain_probability_pct: 80, sunshine_hours: 2 }) },
      { city: "Sochi", day: mkDay({ date: "2026-06-28", precipitation_mm: 0, rain_probability_pct: 5, sunshine_hours: 11 }) },
      { city: "Kazan", day: mkDay({ date: "2026-06-29", precipitation_mm: 4, rain_probability_pct: 40, sunshine_hours: 6 }) },
    ];
    const best = bestPick(candidates, "general");
    expect(best.city).toBe("Sochi");
    expect(best.date).toBe("2026-06-28");
  });

  it("cycling weighting penalizes rain harder than general", () => {
    const rainy = mkDay({ precipitation_mm: 5, rain_probability_pct: 60 });
    const general = scoreDayWeather(rainy) + ACTIVITY_MOD.general(rainy);
    const cycling = scoreDayWeather(rainy) + ACTIVITY_MOD.cycling(rainy);
    expect(cycling).toBeLessThan(general);
  });
});
