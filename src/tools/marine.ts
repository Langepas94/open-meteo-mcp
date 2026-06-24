import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

const MarineHourly = z.enum([
  "wave_height", "wave_direction", "wave_period",
  "wind_wave_height", "wind_wave_direction", "wind_wave_period", "wind_wave_peak_period",
  "swell_wave_height", "swell_wave_direction", "swell_wave_period", "swell_wave_peak_period",
  "sea_surface_temperature", "ocean_current_velocity", "ocean_current_direction"
]);

const MarineDaily = z.enum([
  "wave_height_max", "wave_direction_dominant", "wave_period_max",
  "wind_wave_height_max", "wind_wave_direction_dominant", "wind_wave_period_max",
  "swell_wave_height_max", "swell_wave_direction_dominant", "swell_wave_period_max",
  "sea_surface_temperature_max", "sea_surface_temperature_min"
]);

export function registerMarine(server: McpServer) {
  server.registerTool(
    "get_marine",
    {
      description:
        "Get marine weather data: wave height, wave period, wave direction, " +
        "swell, sea surface temperature, and ocean currents. " +
        "Only valid for ocean/sea coordinates.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        hourly: z.array(MarineHourly).optional(),
        daily: z.array(MarineDaily).optional(),
        timezone: z.string().optional().default("auto"),
        forecast_days: z.number().int().min(1).max(7).optional().default(7),
        past_days: z.number().int().min(0).max(92).optional(),
        length_unit: z.enum(["metric", "imperial"]).optional().default("metric"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://marine-api.open-meteo.com/v1/marine", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
