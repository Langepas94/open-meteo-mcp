import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openMeteoFetch } from "../client.js";

export function registerElevation(server: McpServer) {
  server.registerTool(
    "get_elevation",
    {
      description:
        "Get elevation above sea level (meters) for one or more coordinates. " +
        "Batch up to 100 locations per request. Data from 90m digital elevation model.",
      inputSchema: z.object({
        latitude: z.array(z.number().min(-90).max(90)).min(1).max(100)
          .describe("Array of latitudes"),
        longitude: z.array(z.number().min(-180).max(180)).min(1).max(100)
          .describe("Array of longitudes (same length as latitude)"),
      }),
    },
    async (params) => {
      const data = await openMeteoFetch("https://api.open-meteo.com/v1/elevation", params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
