import { describe, it, expect, vi, beforeEach } from "vitest";

// ── pure logic extracted for unit testing ─────────────────────────────────

function wmoDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 2) return "Mainly clear";
  if (code === 3) return "Overcast";
  if (code <= 49) return "Fog";
  if (code <= 59) return "Drizzle";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 84) return "Snow showers";
  if (code <= 99) return "Thunderstorm";
  return "Unknown";
}

function scoreDayWeather(w: {
  temp_max: number; temp_min: number; temp_avg: number;
  precipitation_mm: number; rain_probability_pct: number;
  wind_speed_kmh: number; uv_index: number; sunshine_hours: number;
}) {
  let score = 100;
  score -= w.precipitation_mm * 8;
  score -= w.rain_probability_pct * 0.5;
  if (w.wind_speed_kmh > 30) score -= (w.wind_speed_kmh - 30) * 0.8;
  const midTemp = w.temp_avg;
  if (midTemp < 15) score -= (15 - midTemp) * 2;
  if (midTemp > 32) score -= (midTemp - 32) * 1.5;
  score += w.sunshine_hours * 3;
  if (w.uv_index > 8) score -= (w.uv_index - 8) * 2;
  return Math.round(score);
}

function gridPoints(centerLat: number, centerLon: number, radiusKm: number) {
  const stepKm = Math.max(30, Math.round(radiusKm / 4));
  const R = 6371;
  const points: Array<{ lat: number; lon: number; distKm: number; direction: string }> = [];
  const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "Center"];

  for (let dlat = -radiusKm; dlat <= radiusKm; dlat += stepKm) {
    for (let dlon = -radiusKm; dlon <= radiusKm; dlon += stepKm) {
      const distKm = Math.sqrt(dlat ** 2 + dlon ** 2);
      if (distKm > radiusKm) continue;
      const lat = +(centerLat + (dlat / R) * (180 / Math.PI)).toFixed(4);
      const lon = +(centerLon + (dlon / R) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180)).toFixed(4);
      let dir = "Center";
      if (distKm > stepKm * 0.3) {
        const angle = Math.atan2(dlon, dlat) * 180 / Math.PI;
        const idx = Math.round(((angle + 360) % 360) / 45) % 8;
        dir = DIRECTIONS[idx];
      }
      const label = distKm < stepKm * 0.3 ? "Center" : `${Math.round(distKm)} km ${dir}`;
      points.push({ lat, lon, distKm: Math.round(distKm), direction: label });
    }
  }

  const seen = new Set<string>();
  return points.filter(p => {
    const key = `${p.lat},${p.lon}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("wmoDescription", () => {
  it("returns correct descriptions", () => {
    expect(wmoDescription(0)).toBe("Clear sky");
    expect(wmoDescription(1)).toBe("Mainly clear");
    expect(wmoDescription(61)).toBe("Rain");
    expect(wmoDescription(95)).toBe("Thunderstorm");
    expect(wmoDescription(200)).toBe("Unknown");
  });
});

describe("scoreDayWeather", () => {
  const sunny = {
    temp_max: 25, temp_min: 18, temp_avg: 21.5,
    precipitation_mm: 0, rain_probability_pct: 0,
    wind_speed_kmh: 10, uv_index: 5, sunshine_hours: 8,
  };

  const rainy = {
    temp_max: 12, temp_min: 8, temp_avg: 10,
    precipitation_mm: 15, rain_probability_pct: 90,
    wind_speed_kmh: 40, uv_index: 1, sunshine_hours: 0,
  };

  it("sunny day scores higher than rainy day", () => {
    expect(scoreDayWeather(sunny)).toBeGreaterThan(scoreDayWeather(rainy));
  });

  it("no rain, mild temp, sunshine → score well above 100", () => {
    expect(scoreDayWeather(sunny)).toBeGreaterThan(100);
  });

  it("heavy rain + cold + wind → low score", () => {
    expect(scoreDayWeather(rainy)).toBeLessThan(50);
  });

  it("wind penalty kicks in above 30 km/h", () => {
    const calm = { ...sunny, wind_speed_kmh: 20 };
    const windy = { ...sunny, wind_speed_kmh: 50 };
    expect(scoreDayWeather(calm)).toBeGreaterThan(scoreDayWeather(windy));
  });

  it("cold temperature penalty", () => {
    const cold = { ...sunny, temp_avg: 5, temp_min: 2, temp_max: 8 };
    expect(scoreDayWeather(cold)).toBeLessThan(scoreDayWeather(sunny));
  });

  it("high UV penalty above 8", () => {
    const highUv = { ...sunny, uv_index: 11 };
    expect(scoreDayWeather(sunny)).toBeGreaterThan(scoreDayWeather(highUv));
  });
});

describe("gridPoints", () => {
  it("always includes a center point", () => {
    const pts = gridPoints(55.75, 37.62, 200);
    const center = pts.find(p => p.direction === "Center");
    expect(center).toBeDefined();
  });

  it("all points are within radius", () => {
    const pts = gridPoints(55.75, 37.62, 150);
    for (const p of pts) {
      expect(p.distKm).toBeLessThanOrEqual(150);
    }
  });

  it("larger radius produces more points", () => {
    const small = gridPoints(55.75, 37.62, 100);
    const large = gridPoints(55.75, 37.62, 500);
    expect(large.length).toBeGreaterThan(small.length);
  });

  it("no duplicate coordinates", () => {
    const pts = gridPoints(55.75, 37.62, 200);
    const coords = pts.map(p => `${p.lat},${p.lon}`);
    const unique = new Set(coords);
    expect(unique.size).toBe(pts.length);
  });
});
