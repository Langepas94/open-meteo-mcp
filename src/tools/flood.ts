import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

export function registerFlood(server: McpServer) {
  server.registerTool(
    "get_flood",
    {
      description:
        "Get river discharge and flood forecasts from GloFAS (Global Flood Awareness System). " +
        "Provides daily river discharge in m³/s up to 16 weeks ahead. " +
        "Useful for flood risk assessment near rivers.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        daily: z.array(z.enum([
          "river_discharge",
          "river_discharge_mean", "river_discharge_median",
          "river_discharge_max", "river_discharge_min",
          "river_discharge_p25", "river_discharge_p75"
        ])).optional().default(["river_discharge"]),
        forecast_days: z.number().int().min(1).max(112).optional().default(92)
          .describe("Number of forecast days (up to 112 / 16 weeks)"),
        past_days: z.number().int().min(0).max(92).optional(),
        start_date: z.string().optional().describe("YYYY-MM-DD"),
        end_date: z.string().optional().describe("YYYY-MM-DD"),
        ensemble: z.boolean().optional().default(false)
          .describe("Return ensemble members for uncertainty quantification"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://flood-api.open-meteo.com/v1/flood", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
