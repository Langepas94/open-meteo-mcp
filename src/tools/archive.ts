import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

export function registerArchive(server: McpServer) {
  server.registerTool(
    "get_historical",
    {
      description:
        "Retrieve historical weather data (ERA5 reanalysis) from 1940 to present. " +
        "Use start_date and end_date to define the range (YYYY-MM-DD format).",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        start_date: z.string().describe("Start date in YYYY-MM-DD format"),
        end_date: z.string().describe("End date in YYYY-MM-DD format"),
        hourly: z.array(z.string()).optional().describe(
          "Hourly variables: temperature_2m, relative_humidity_2m, precipitation, wind_speed_10m, etc."
        ),
        daily: z.array(z.string()).optional().describe(
          "Daily variables: temperature_2m_max, temperature_2m_min, precipitation_sum, wind_speed_10m_max, etc."
        ),
        timezone: z.string().optional().default("auto"),
        temperature_unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
        wind_speed_unit: z.enum(["kmh", "ms", "mph", "kn"]).optional().default("kmh"),
        precipitation_unit: z.enum(["mm", "inch"]).optional().default("mm"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://archive-api.open-meteo.com/v1/archive", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
