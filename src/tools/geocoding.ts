import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

export function registerGeocoding(server: McpServer) {
  server.registerTool(
    "geocode",
    {
      description:
        "Search for locations by name or postal code. Returns coordinates, country, admin areas, " +
        "timezone, and population. Use this to resolve a city name to lat/lon before calling weather tools.",
      inputSchema: z.object({
        name: z.string().min(1).describe("City name, location name, or postal code to search"),
        count: z.number().int().min(1).max(100).optional().default(5)
          .describe("Number of results to return"),
        language: z.string().optional().default("en")
          .describe("Language for result names (ISO 639-1 code, e.g. 'en', 'ru', 'de')"),
        country_code: z.string().optional()
          .describe("Filter by ISO 3166-1 alpha-2 country code (e.g. 'RU', 'DE')"),
        format: z.enum(["json", "protobuf"]).optional().default("json"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://geocoding-api.open-meteo.com/v1/search", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
