// Pure weather reasoning — no network, no DB. Shared by the compute tools in
// analyze.ts. These helpers turn raw Open-Meteo forecast JSON into a normalized
// per-day shape and score it for outdoor activities, with human-readable reasons.

// ── normalized day ─────────────────────────────────────────────────────────

export interface NDay {
  date: string;
  weekday: string;
  temp_min: number;
  temp_max: number;
  temp_avg: number;
  precipitation_mm: number;
  rain_probability_pct: number;
  wind_speed_kmh: number;
  gust_kmh?: number;
  uv_index: number;
  sunshine_hours: number;
  weather_code: number;
  weather: string;
  sunrise?: string;
  sunset?: string;
  daylight_hours?: number;
}

// ── WMO weather code → description ─────────────────────────────────────────

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

export function weekdayOf(date: string): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : names[d.getUTCDay()];
}

// ── raw Open-Meteo daily → normalized days ─────────────────────────────────
// Accepts the `daily` block from get_forecast (parallel arrays). Missing
// variables degrade gracefully to neutral defaults so the tool never throws.

export interface RawDaily {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
  precipitation_probability_max?: number[];
  wind_speed_10m_max?: number[];
  wind_gusts_10m_max?: number[];
  weather_code?: number[];
  uv_index_max?: number[];
  sunshine_duration?: number[];
  sunrise?: string[];
  sunset?: string[];
  daylight_duration?: number[];
}

export function normalizeDaily(daily: RawDaily): NDay[] {
  const time = daily.time ?? [];
  return time.map((date, i) => {
    const temp_max = num(daily.temperature_2m_max?.[i]);
    const temp_min = num(daily.temperature_2m_min?.[i]);
    const code = num(daily.weather_code?.[i]);
    return {
      date,
      weekday: weekdayOf(date),
      temp_min,
      temp_max,
      temp_avg: +((temp_max + temp_min) / 2).toFixed(1),
      precipitation_mm: num(daily.precipitation_sum?.[i]),
      rain_probability_pct: num(daily.precipitation_probability_max?.[i]),
      wind_speed_kmh: num(daily.wind_speed_10m_max?.[i]),
      gust_kmh: daily.wind_gusts_10m_max ? num(daily.wind_gusts_10m_max[i]) : undefined,
      uv_index: num(daily.uv_index_max?.[i]),
      sunshine_hours: +(num(daily.sunshine_duration?.[i]) / 3600).toFixed(1),
      weather_code: code,
      weather: wmoDescription(code),
      sunrise: daily.sunrise?.[i],
      sunset: daily.sunset?.[i],
      daylight_hours: daily.daylight_duration ? +(num(daily.daylight_duration[i]) / 3600).toFixed(1) : undefined,
    };
  });
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// ── grid sampling within a radius ──────────────────────────────────────────
// Generate sample coordinates inside `radiusKm` of a center point, each labeled
// by distance + compass direction. Pure geometry — no reverse-geocoding, so
// points are positions ("50 km NE"), not city names.

export interface GridPoint {
  latitude: number;
  longitude: number;
  distance_km: number;
  label: string;
}

export function gridPoints(centerLat: number, centerLon: number, radiusKm: number): GridPoint[] {
  const stepKm = Math.max(25, Math.round(radiusKm / 4));
  const R = 6371;
  const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const out: GridPoint[] = [];
  const seen = new Set<string>();

  for (let dlat = -radiusKm; dlat <= radiusKm; dlat += stepKm) {
    for (let dlon = -radiusKm; dlon <= radiusKm; dlon += stepKm) {
      const distKm = Math.round(Math.sqrt(dlat ** 2 + dlon ** 2));
      if (distKm > radiusKm) continue;

      const latitude = +(centerLat + (dlat / R) * (180 / Math.PI)).toFixed(4);
      const longitude = +(centerLon + (dlon / R) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180)).toFixed(4);

      const key = `${latitude},${longitude}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let label: string;
      if (distKm < stepKm * 0.3) {
        label = "Center";
      } else {
        const angle = Math.atan2(dlon, dlat) * 180 / Math.PI;
        const dir = DIRECTIONS[Math.round(((angle + 360) % 360) / 45) % 8];
        label = `${distKm} km ${dir}`;
      }
      out.push({ latitude, longitude, distance_km: distKm, label });
    }
  }
  return out;
}

// ── activity profiles ──────────────────────────────────────────────────────
// Each profile expresses how an activity weighs weather. Higher score = better.

export const ACTIVITIES = ["cycling", "walking", "running", "hiking", "beach", "picnic", "general"] as const;
export type Activity = (typeof ACTIVITIES)[number];

interface Profile {
  tempLo: number;       // ideal min temp (°C)
  tempHi: number;       // ideal max temp (°C)
  rainW: number;        // penalty per mm of rain
  rainProbW: number;    // penalty per % rain probability
  windW: number;        // penalty per km/h above 25
  uvW: number;          // penalty per UV point above 8
  sunW: number;         // bonus per sunshine hour
}

const PROFILES: Record<Activity, Profile> = {
  cycling: { tempLo: 12, tempHi: 26, rainW: 9, rainProbW: 0.5, windW: 1.0, uvW: 1.5, sunW: 2.5 },
  walking: { tempLo: 10, tempHi: 24, rainW: 6, rainProbW: 0.4, windW: 0.5, uvW: 1.0, sunW: 2.0 },
  running: { tempLo: 6, tempHi: 18, rainW: 4, rainProbW: 0.3, windW: 0.4, uvW: 1.5, sunW: 1.0 },
  hiking: { tempLo: 8, tempHi: 22, rainW: 7, rainProbW: 0.4, windW: 0.5, uvW: 1.0, sunW: 2.0 },
  beach: { tempLo: 24, tempHi: 33, rainW: 12, rainProbW: 0.6, windW: 0.8, uvW: 0.0, sunW: 4.0 },
  picnic: { tempLo: 16, tempHi: 27, rainW: 11, rainProbW: 0.6, windW: 0.7, uvW: 1.0, sunW: 3.0 },
  general: { tempLo: 16, tempHi: 26, rainW: 8, rainProbW: 0.5, windW: 0.8, uvW: 1.5, sunW: 3.0 },
};

export interface ScoreResult {
  score: number;
  reasons: string[];
}

// Score a single normalized day for an activity. Returns 0-capped score plus
// short human reasons explaining the main penalties/bonuses.
export function scoreActivityDay(day: Pick<NDay, "temp_avg" | "precipitation_mm" | "rain_probability_pct" | "wind_speed_kmh" | "uv_index" | "sunshine_hours">, activity: Activity): ScoreResult {
  const p = PROFILES[activity] ?? PROFILES.general;
  const reasons: string[] = [];
  let score = 100;

  if (day.precipitation_mm > 0) {
    const pen = day.precipitation_mm * p.rainW;
    score -= pen;
    if (pen >= 10) reasons.push(`rain ${day.precipitation_mm}mm (−${Math.round(pen)})`);
  }
  if (day.rain_probability_pct > 0) {
    score -= day.rain_probability_pct * p.rainProbW;
    if (day.rain_probability_pct >= 50) reasons.push(`${day.rain_probability_pct}% rain chance`);
  }
  if (day.wind_speed_kmh > 25) {
    const pen = (day.wind_speed_kmh - 25) * p.windW;
    score -= pen;
    if (pen >= 8) reasons.push(`windy ${day.wind_speed_kmh} km/h (−${Math.round(pen)})`);
  }
  if (day.temp_avg < p.tempLo) {
    const pen = (p.tempLo - day.temp_avg) * 2;
    score -= pen;
    reasons.push(`cold ${day.temp_avg}°C (−${Math.round(pen)})`);
  } else if (day.temp_avg > p.tempHi) {
    const pen = (day.temp_avg - p.tempHi) * 1.5;
    score -= pen;
    reasons.push(`hot ${day.temp_avg}°C (−${Math.round(pen)})`);
  } else {
    reasons.push(`comfortable ${day.temp_avg}°C`);
  }
  if (day.uv_index > 8) score -= (day.uv_index - 8) * p.uvW;
  if (day.sunshine_hours > 0) {
    const bonus = day.sunshine_hours * p.sunW;
    score += bonus;
    if (day.sunshine_hours >= 6) reasons.push(`${day.sunshine_hours}h sun (+${Math.round(bonus)})`);
  }

  return { score: Math.max(0, Math.round(score)), reasons };
}
