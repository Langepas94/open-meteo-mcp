import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

export function registerClimate(server: McpServer) {
  server.registerTool(
    "get_climate",
    {
      description:
        "Get long-term climate projections (CMIP6) showing temperature and precipitation trends " +
        "under different warming scenarios. Useful for climate change analysis. " +
        "Date range must be within 1950-2050.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        start_date: z.string().describe("YYYY-MM-DD (from 1950)"),
        end_date: z.string().describe("YYYY-MM-DD (to 2050)"),
        daily: z.array(z.enum([
          "temperature_2m_max", "temperature_2m_min", "temperature_2m_mean",
          "precipitation_sum", "rain_sum", "snowfall_sum",
          "wind_speed_10m_max", "wind_speed_10m_mean",
          "cloud_cover_mean", "shortwave_radiation_sum",
          "relative_humidity_2m_max", "relative_humidity_2m_min", "relative_humidity_2m_mean",
          "soil_moisture_0_to_10cm_mean", "et0_fao_evapotranspiration_sum"
        ])).describe("Daily climate variables"),
        models: z.array(z.enum([
          "CMCC_CM2_VHR4", "FGOALS_f3_H", "HiRAM_SIT_HR",
          "MRI_AGCM3_2_S", "EC_Earth3P_HR", "MPI_ESM1_2_XR", "NICAM16_8S"
        ])).optional().default(["MRI_AGCM3_2_S"]),
        temperature_unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
        wind_speed_unit: z.enum(["kmh", "ms", "mph", "kn"]).optional().default("kmh"),
        precipitation_unit: z.enum(["mm", "inch"]).optional().default("mm"),
        disable_bias_correction: z.boolean().optional().default(false),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://climate-api.open-meteo.com/v1/climate", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
