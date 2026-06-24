import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import {
  registerForecast,
  registerArchive,
  registerAirQuality,
  registerMarine,
  registerElevation,
  registerGeocoding,
  registerFlood,
  registerEnsemble,
  registerClimate,
  registerSeasonal,
  registerDwdIcon,
  registerEcmwf,
  registerScheduleTools,
  registerCompareTools,
} from "./tools/index.js";
import { restoreJobs } from "./scheduler.js";

function createMcpServer() {
  const server = new McpServer({ name: "open-meteo", version: "1.2.0" });
  registerForecast(server);
  registerArchive(server);
  registerAirQuality(server);
  registerMarine(server);
  registerElevation(server);
  registerGeocoding(server);
  registerFlood(server);
  registerEnsemble(server);
  registerClimate(server);
  registerSeasonal(server);
  registerDwdIcon(server);
  registerEcmwf(server);
  registerScheduleTools(server);
  registerCompareTools(server);
  return server;
}

restoreJobs();

const transport = process.env.MCP_TRANSPORT ?? "stdio";

if (transport === "http") {
  const port = parseInt(process.env.PORT ?? "3000", 10);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const server = createMcpServer();
    const mcpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless per-request
    });

    res.on("close", () => {
      mcpTransport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(mcpTransport);
    await mcpTransport.handleRequest(req, res);
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(`open-meteo MCP HTTP server listening on http://0.0.0.0:${port}/mcp`);
  });
} else {
  const server = createMcpServer();
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
}
