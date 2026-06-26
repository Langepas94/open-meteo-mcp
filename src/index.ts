import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomUUID } from "crypto";
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
  registerAnalyzeTools,
} from "./tools/index.js";
import { restoreJobs } from "./scheduler.js";
import { registerSession, unregisterSession } from "./notifications.js";

function createMcpServer() {
  // `logging` capability lets the server push summaries via logging notifications.
  const server = new McpServer(
    { name: "open-meteo", version: "2.2.1" },
    { capabilities: { logging: {} } }
  );
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
  registerAnalyzeTools(server);
  return server;
}

restoreJobs();

const transport = process.env.MCP_TRANSPORT ?? "stdio";

if (transport === "http") {
  const port = parseInt(process.env.PORT ?? "3000", 10);

  // Stateful sessions: keep one transport (and its server) alive per session so
  // the server can push notifications over the session's SSE stream.
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Last-Event-ID");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

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

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Existing session: route to its live transport (POST / GET-SSE / DELETE).
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res);
      return;
    }

    // New session: only a POST (initialize handshake) may create one.
    if (req.method !== "POST") {
      res.writeHead(400);
      res.end("Missing or unknown Mcp-Session-Id");
      return;
    }

    const server = createMcpServer();
    const mcpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        transports[sid] = mcpTransport;
        registerSession(sid, server);
      },
    });
    mcpTransport.onclose = () => {
      const sid = mcpTransport.sessionId;
      if (sid) {
        delete transports[sid];
        unregisterSession(sid);
      }
    };

    await server.connect(mcpTransport);
    await mcpTransport.handleRequest(req, res);
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(`open-meteo MCP HTTP (stateful) listening on http://0.0.0.0:${port}/mcp`);
  });
} else {
  const server = createMcpServer();
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
}
