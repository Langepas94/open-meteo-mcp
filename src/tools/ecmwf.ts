import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

export function registerEcmwf(server: McpServer) {
  server.registerTool(
    "get_ecmwf",
    {
      description:
        "Get weather forecast from ECMWF IFS model (European Centre for Medium-Range Weather Forecasts). " +
        "Gold standard for global medium-range forecasting. " +
        "Provides 10-day forecasts at 0.25° resolution.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        hourly: z.array(z.string()).optional().describe(
          "Hourly variables: temperature_2m, precipitation, wind_speed_10m, geopotential_height, etc."
        ),
        daily: z.array(z.string()).optional().describe(
          "Daily variables: temperature_2m_max, precipitation_sum, wind_speed_10m_max, etc."
        ),
        timezone: z.string().optional().default("auto"),
        forecast_days: z.number().int().min(1).max(10).optional().default(7),
        past_days: z.number().int().min(0).max(92).optional(),
        temperature_unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
        wind_speed_unit: z.enum(["kmh", "ms", "mph", "kn"]).optional().default("kmh"),
        precipitation_unit: z.enum(["mm", "inch"]).optional().default("mm"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://api.open-meteo.com/v1/ecmwf", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
