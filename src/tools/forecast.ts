import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

const HourlyVar = z.enum([
  "temperature_2m", "relative_humidity_2m", "dew_point_2m", "apparent_temperature",
  "precipitation", "rain", "snowfall", "snow_depth", "weather_code",
  "pressure_msl", "surface_pressure", "cloud_cover", "cloud_cover_low",
  "cloud_cover_mid", "cloud_cover_high", "visibility", "evapotranspiration",
  "et0_fao_evapotranspiration", "vapour_pressure_deficit",
  "wind_speed_10m", "wind_speed_80m", "wind_speed_120m", "wind_speed_180m",
  "wind_direction_10m", "wind_direction_80m", "wind_direction_120m", "wind_direction_180m",
  "wind_gusts_10m", "shortwave_radiation", "direct_radiation", "diffuse_radiation",
  "direct_normal_irradiance", "terrestrial_radiation", "uv_index", "uv_index_clear_sky",
  "cape", "freezing_level_height", "sunshine_duration", "is_day",
  "soil_temperature_0cm", "soil_temperature_6cm", "soil_temperature_18cm", "soil_temperature_54cm",
  "soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm", "soil_moisture_9_to_27cm"
]);

const DailyVar = z.enum([
  "weather_code", "temperature_2m_max", "temperature_2m_min",
  "apparent_temperature_max", "apparent_temperature_min",
  "sunrise", "sunset", "daylight_duration", "sunshine_duration",
  "uv_index_max", "uv_index_clear_sky_max",
  "precipitation_sum", "rain_sum", "snowfall_sum", "precipitation_hours",
  "precipitation_probability_max",
  "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
  "shortwave_radiation_sum", "et0_fao_evapotranspiration"
]);

export function registerForecast(server: McpServer) {
  server.registerTool(
    "get_forecast",
    {
      description:
        "Get weather forecast for a location. Returns hourly and/or daily data up to 16 days ahead. " +
        "Provide at least one of: hourly or daily variable lists.",
      inputSchema: z.object({
        latitude: z.number().min(-90).max(90).describe("Latitude in decimal degrees"),
        longitude: z.number().min(-180).max(180).describe("Longitude in decimal degrees"),
        hourly: z.array(HourlyVar).optional().describe("Hourly variables to retrieve"),
        daily: z.array(DailyVar).optional().describe("Daily variables to retrieve"),
        timezone: z.string().optional().default("auto").describe("Timezone name (e.g. Europe/Moscow) or 'auto'"),
        forecast_days: z.number().int().min(1).max(16).optional().default(7).describe("Number of forecast days (1-16)"),
        past_days: z.number().int().min(0).max(92).optional().describe("Include past days in result"),
        temperature_unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
        wind_speed_unit: z.enum(["kmh", "ms", "mph", "kn"]).optional().default("kmh"),
        precipitation_unit: z.enum(["mm", "inch"]).optional().default("mm"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://api.open-meteo.com/v1/forecast", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
