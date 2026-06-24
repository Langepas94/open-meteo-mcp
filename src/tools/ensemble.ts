import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

export function registerEnsemble(server: McpServer) {
  server.registerTool(
    "get_ensemble",
    {
      description:
        "Get ensemble weather forecasts showing forecast uncertainty across multiple model runs. " +
        "Returns multiple members per variable. Available models: icon_seamless, icon_global, " +
        "ecmwf_ifs04, gfs025, gem_global, bom_access_global_ensemble.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        hourly: z.array(z.string()).optional().describe(
          "Variables: temperature_2m, precipitation, wind_speed_10m, weather_code, etc."
        ),
        models: z.array(z.enum([
          "icon_seamless", "icon_global", "icon_eu", "icon_d2",
          "ecmwf_ifs04", "ecmwf_ifs025",
          "gfs025", "gfs05",
          "gem_global",
          "bom_access_global_ensemble"
        ])).optional().default(["icon_seamless"]),
        forecast_days: z.number().int().min(1).max(35).optional().default(7),
        past_days: z.number().int().min(0).max(92).optional(),
        timezone: z.string().optional().default("auto"),
        temperature_unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
        wind_speed_unit: z.enum(["kmh", "ms", "mph", "kn"]).optional().default("kmh"),
        precipitation_unit: z.enum(["mm", "inch"]).optional().default("mm"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://ensemble-api.open-meteo.com/v1/ensemble", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
