import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

export function registerSeasonal(server: McpServer) {
  server.registerTool(
    "get_seasonal",
    {
      description:
        "Get long-range seasonal forecasts up to 9 months ahead from ECMWF SEAS5. " +
        "Returns ensemble of multiple members showing probability distributions. " +
        "Data is at weekly resolution.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        daily: z.array(z.enum([
          "temperature_2m_max", "temperature_2m_min", "temperature_2m_mean",
          "precipitation_sum", "rain_sum", "snowfall_sum",
          "wind_speed_10m_max", "wind_speed_10m_mean",
          "shortwave_radiation_sum"
        ])).describe("Daily variables for seasonal forecast"),
        forecast_months: z.number().int().min(1).max(9).optional().default(6)
          .describe("Number of months ahead (1-9)"),
        past_days: z.number().int().min(0).max(92).optional(),
        timezone: z.string().optional().default("auto"),
        temperature_unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
        wind_speed_unit: z.enum(["kmh", "ms", "mph", "kn"]).optional().default("kmh"),
        precipitation_unit: z.enum(["mm", "inch"]).optional().default("mm"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://seasonal-api.open-meteo.com/v1/seasonal", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
