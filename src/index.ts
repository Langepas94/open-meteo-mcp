import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const server = new McpServer({
  name: "open-meteo",
  version: "1.1.0",
});

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

// Resume persisted jobs after restart
restoreJobs();

const transport = new StdioServerTransport();
await server.connect(transport);
