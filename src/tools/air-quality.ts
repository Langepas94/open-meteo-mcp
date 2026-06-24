import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

const AirQualityVar = z.enum([
  "pm10", "pm2_5", "carbon_monoxide", "nitrogen_dioxide", "sulphur_dioxide", "ozone",
  "aerosol_optical_depth", "dust", "uv_index", "uv_index_clear_sky",
  "alder_pollen", "birch_pollen", "grass_pollen", "mugwort_pollen", "olive_pollen", "ragweed_pollen",
  "european_aqi", "european_aqi_pm2_5", "european_aqi_pm10", "european_aqi_no2",
  "european_aqi_o3", "european_aqi_so2",
  "us_aqi", "us_aqi_pm2_5", "us_aqi_pm10", "us_aqi_no2", "us_aqi_co", "us_aqi_o3", "us_aqi_so2"
]);

export function registerAirQuality(server: McpServer) {
  server.registerTool(
    "get_air_quality",
    {
      description:
        "Get air quality data including PM2.5, PM10, ozone, NO2, SO2, CO, pollen counts, " +
        "and European/US AQI indices. Data from Copernicus CAMS.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        hourly: z.array(AirQualityVar).describe("Air quality variables to retrieve"),
        timezone: z.string().optional().default("auto"),
        forecast_days: z.number().int().min(1).max(7).optional().default(5),
        past_days: z.number().int().min(0).max(92).optional(),
        start_date: z.string().optional().describe("YYYY-MM-DD, overrides forecast_days"),
        end_date: z.string().optional().describe("YYYY-MM-DD"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://air-quality-api.open-meteo.com/v1/air-quality", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
