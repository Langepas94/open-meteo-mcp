import { openMeteoFetch } from "../client.js";

// ── types ─────────────────────────────────────────────────────────────────

export interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
  timezone: string;
}

export interface DailyForecast {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  precipitation_probability_max: number[];
  wind_speed_10m_max: number[];
  weather_code: number[];
  uv_index_max: number[];
  sunshine_duration: number[];
}

export interface LocationWeather {
  label: string;
  latitude: number;
  longitude: number;
  country?: string;
  date: string;
  temp_max: number;
  temp_min: number;
  temp_avg: number;
  precipitation_mm: number;
  rain_probability_pct: number;
  wind_speed_kmh: number;
  uv_index: number;
  sunshine_hours: number;
  weather_description: string;
  score: number;
}

// ── WMO weather code → description ───────────────────────────────────────

export function wmoDescription(code: number): string {
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

// ── scoring ───────────────────────────────────────────────────────────────
// Higher = better. Penalties for rain, wind, cold; bonuses for sunshine, warmth.

export function scoreDayWeather(w: Omit<LocationWeather, "score" | "label" | "date" | "latitude" | "longitude" | "country" | "weather_description">) {
  let score = 100;
  // Rain penalty
  score -= w.precipitation_mm * 8;
  score -= w.rain_probability_pct * 0.5;
  // Wind penalty
  if (w.wind_speed_kmh > 30) score -= (w.wind_speed_kmh - 30) * 0.8;
  // Temperature: sweet spot 18-28°C
  const midTemp = w.temp_avg;
  if (midTemp < 15) score -= (15 - midTemp) * 2;
  if (midTemp > 32) score -= (midTemp - 32) * 1.5;
  // Sunshine bonus
  score += w.sunshine_hours * 3;
  // UV guard
  if (w.uv_index > 8) score -= (w.uv_index - 8) * 2;
  return Math.round(score);
}

// ── geocode helper ────────────────────────────────────────────────────────

export async function geocodeCity(name: string, language: string): Promise<GeoResult | null> {
  const res = await openMeteoFetch("https://geocoding-api.open-meteo.com/v1/search", {
    name,
    count: 1,
    language,
  }) as { results?: GeoResult[] };
  return res.results?.[0] ?? null;
}

// ── forecast for one point ────────────────────────────────────────────────

export async function fetchWeekForecast(lat: number, lon: number, forecastDays = 7): Promise<DailyForecast | null> {
  const res = await openMeteoFetch("https://api.open-meteo.com/v1/forecast", {
    latitude: lat,
    longitude: lon,
    daily: [
      "temperature_2m_max", "temperature_2m_min",
      "precipitation_sum", "precipitation_probability_max",
      "wind_speed_10m_max", "weather_code", "uv_index_max", "sunshine_duration",
    ],
    timezone: "auto",
    forecast_days: forecastDays,
  }) as { daily?: DailyForecast };
  return res.daily ?? null;
}

export async function fetchDayForecast(lat: number, lon: number, targetDate: string): Promise<DailyForecast | null> {
  const daily = await fetchWeekForecast(lat, lon, 16);
  if (!daily) return null;

  const idx = daily.time.indexOf(targetDate);
  if (idx === -1) return null;

  // Return single-element slices for the target date
  return {
    time: [daily.time[idx]],
    temperature_2m_max: [daily.temperature_2m_max[idx]],
    temperature_2m_min: [daily.temperature_2m_min[idx]],
    precipitation_sum: [daily.precipitation_sum[idx] ?? 0],
    precipitation_probability_max: [daily.precipitation_probability_max[idx] ?? 0],
    wind_speed_10m_max: [daily.wind_speed_10m_max[idx] ?? 0],
    weather_code: [daily.weather_code[idx]],
    uv_index_max: [daily.uv_index_max[idx] ?? 0],
    sunshine_duration: [daily.sunshine_duration[idx] ?? 0],
  };
}

export function dailyToWeather(geo: { label: string; latitude: number; longitude: number; country?: string }, daily: DailyForecast, idx = 0): LocationWeather {
  const temp_max = daily.temperature_2m_max[idx];
  const temp_min = daily.temperature_2m_min[idx];
  const precipitation_mm = daily.precipitation_sum[idx] ?? 0;
  const rain_probability_pct = daily.precipitation_probability_max[idx] ?? 0;
  const wind_speed_kmh = daily.wind_speed_10m_max[idx] ?? 0;
  const uv_index = daily.uv_index_max[idx] ?? 0;
  const sunshine_hours = +((daily.sunshine_duration[idx] ?? 0) / 3600).toFixed(1);
  const weather_description = wmoDescription(daily.weather_code[idx]);
  const temp_avg = +((temp_max + temp_min) / 2).toFixed(1);

  const score = scoreDayWeather({ temp_max, temp_min, temp_avg, precipitation_mm, rain_probability_pct, wind_speed_kmh, uv_index, sunshine_hours });

  return {
    ...geo,
    date: daily.time[idx],
    temp_max, temp_min, temp_avg,
    precipitation_mm,
    rain_probability_pct,
    wind_speed_kmh,
    uv_index,
    sunshine_hours,
    weather_description,
    score,
  };
}

// ── grid point generation for region mode ────────────────────────────────

export function gridPoints(centerLat: number, centerLon: number, radiusKm: number): Array<{ lat: number; lon: number; distKm: number; direction: string }> {
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

  // Deduplicate by rounded coords
  const seen = new Set<string>();
  return points.filter(p => {
    const key = `${p.lat},${p.lon}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── format output ─────────────────────────────────────────────────────────

export function formatResults(results: LocationWeather[], date: string) {
  const ranked = [...results].sort((a, b) => b.score - a.score);
  const best = ranked[0];

  const table = ranked.map((r, i) => ({
    rank: i + 1,
    location: r.label,
    country: r.country,
    score: r.score,
    weather: r.weather_description,
    temp: `${r.temp_min}–${r.temp_max}°C`,
    rain_mm: r.precipitation_mm,
    rain_probability: `${r.rain_probability_pct}%`,
    wind_kmh: r.wind_speed_kmh,
    sunshine_h: r.sunshine_hours,
    uv_index: r.uv_index,
  }));

  return {
    date,
    best_location: {
      name: best.label,
      score: best.score,
      summary: `${best.weather_description}, ${best.temp_min}–${best.temp_max}°C, rain: ${best.precipitation_mm}mm (${best.rain_probability_pct}%), wind: ${best.wind_speed_kmh} km/h, sun: ${best.sunshine_hours}h`,
    },
    ranking: table,
    note: "Score: higher = better weather. Penalizes rain, strong wind, extreme temperatures. Rewards sunshine and mild warmth.",
  };
}
