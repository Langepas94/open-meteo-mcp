import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type LocationWeather,
  geocodeCity,
  fetchDayForecast,
  dailyToWeather,
  gridPoints,
  formatResults,
} from "./shared.js";

// ── register tools ────────────────────────────────────────────────────────

export function registerCompareTools(server: McpServer) {

  // Tool 1: compare named cities
  server.registerTool(
    "compare_weather_cities",
    {
      description:
        "Compare weather across multiple cities on a specific date. " +
        "Returns a ranked list showing which city has the best weather conditions. " +
        "Useful for trip planning: 'Where should I go this weekend?'",
      inputSchema: z.object({
        cities: z.array(z.string()).min(2).max(20)
          .describe("List of city names to compare, e.g. ['Moscow', 'Saint Petersburg', 'Sochi']"),
        date: z.string()
          .describe("Target date in YYYY-MM-DD format. Must be within the next 16 days."),
        language: z.string().optional().default("en")
          .describe("Language for city name results (ISO 639-1, e.g. 'ru', 'en')"),
      }),
    },
    async (params) => {
      const results: LocationWeather[] = [];
      const errors: string[] = [];

      await Promise.all(params.cities.map(async (city) => {
        try {
          const geo = await geocodeCity(city, params.language);
          if (!geo) { errors.push(`Not found: ${city}`); return; }

          const daily = await fetchDayForecast(geo.latitude, geo.longitude, params.date);
          if (!daily) { errors.push(`No forecast for ${city} on ${params.date}`); return; }

          results.push(dailyToWeather({
            label: geo.admin1 ? `${geo.name}, ${geo.admin1}` : geo.name,
            latitude: geo.latitude,
            longitude: geo.longitude,
            country: geo.country,
          }, daily));
        } catch (e) {
          errors.push(`Error for ${city}: ${String(e)}`);
        }
      }));

      if (results.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "No results", details: errors }) }] };
      }

      const output = { ...formatResults(results, params.date), errors: errors.length ? errors : undefined };
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    }
  );

  // Tool 2: compare grid points within a radius
  server.registerTool(
    "compare_weather_region",
    {
      description:
        "Compare weather across a region: specify a center city and radius in km. " +
        "Automatically samples grid points within that radius and finds the spot with the best weather. " +
        "Great for: 'Where within 200 km of Moscow will it be dry this Saturday?'",
      inputSchema: z.object({
        center_city: z.string()
          .describe("Center of the search region, e.g. 'Moscow'"),
        radius_km: z.number().min(30).max(1000)
          .describe("Search radius in kilometers (30–1000 km)"),
        date: z.string()
          .describe("Target date in YYYY-MM-DD format. Must be within the next 16 days."),
        language: z.string().optional().default("en"),
      }),
    },
    async (params) => {
      const centerGeo = await geocodeCity(params.center_city, params.language);
      if (!centerGeo) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `City not found: ${params.center_city}` }) }] };
      }

      const points = gridPoints(centerGeo.latitude, centerGeo.longitude, params.radius_km);

      const results: LocationWeather[] = [];

      await Promise.all(points.map(async (pt) => {
        try {
          const daily = await fetchDayForecast(pt.lat, pt.lon, params.date);
          if (!daily) return;
          results.push(dailyToWeather({
            label: pt.direction,
            latitude: pt.lat,
            longitude: pt.lon,
          }, daily));
        } catch {
          // skip failed points silently
        }
      }));

      if (results.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "No forecast data available" }) }] };
      }

      const output = {
        center: `${centerGeo.name}, ${centerGeo.country}`,
        radius_km: params.radius_km,
        points_sampled: results.length,
        ...formatResults(results, params.date),
      };
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    }
  );
}
