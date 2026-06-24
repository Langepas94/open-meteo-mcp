# open-meteo-mcp

MCP server for [Open-Meteo](https://open-meteo.com/) — free weather APIs, no API key required.

## Features

- **16 tools** covering weather forecast, historical data, air quality, marine, flood, ensemble, climate projections, and scheduled data collection
- **Scheduled jobs** — server-side cron, persists readings to SQLite, returns aggregated stats
- **No auth** — Open-Meteo is free for non-commercial use
- **stdio transport** — works with Claude Desktop and any MCP client

## Tools

### Weather data

| Tool | Description |
|------|-------------|
| `geocode` | Search locations by name → lat/lon, timezone, country |
| `get_forecast` | 7–16 day forecast, hourly + daily (45+ variables) |
| `get_historical` | ERA5 reanalysis from 1940 to present |
| `get_air_quality` | PM2.5, PM10, ozone, NO2, SO2, CO, pollen, EU/US AQI |
| `get_marine` | Wave height, period, direction, swell, sea surface temp |
| `get_elevation` | Elevation above sea level, batch up to 100 points |
| `get_flood` | GloFAS river discharge forecast, up to 16 weeks |
| `get_ensemble` | Multi-model ensemble with uncertainty quantification |
| `get_climate` | CMIP6 climate projections 1950–2050 |
| `get_seasonal` | ECMWF SEAS5 seasonal forecast up to 9 months |
| `get_dwd_icon` | DWD ICON model — high-res for Europe |
| `get_ecmwf` | ECMWF IFS model — gold standard global forecast |

### Weather comparison

| Tool | Description |
|------|-------------|
| `compare_weather_cities` | Compare named cities on a date → ranked by weather quality score |
| `compare_weather_region` | Center city + radius km → grid sample → best spot in the area |

Score factors: sunshine, temperature comfort (18–28°C sweet spot), precipitation, wind, UV.

Example prompts:
- *"Moscow, Sochi, Kazan this Saturday — where's best?"* → `compare_weather_cities`
- *"Best weather within 300 km of Moscow next Sunday?"* → `compare_weather_region`

### Scheduled collection

| Tool | Description |
|------|-------------|
| `schedule_weather_job` | Create a recurring data collection job (cron expression) |
| `list_jobs` | List jobs with schedule, status, and reading count |
| `get_weather_summary` | Aggregated stats (min/max/avg) over a time window |
| `cancel_job` | Stop and delete a job |

Scheduled jobs survive server restarts — state is persisted in `~/.open-meteo-mcp/data.db`.

## Installation

```bash
git clone https://github.com/langepas/open-meteo-mcp.git
cd open-meteo-mcp
npm install
npm run build
```

## Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "open-meteo": {
      "command": "node",
      "args": ["/absolute/path/to/open-meteo-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. Example prompts:

- *"What's the weather in Moscow this week?"* → `geocode` → `get_forecast`
- *"Collect temperature in Saint Petersburg every hour"* → `schedule_weather_job`
- *"Show me the air quality summary for the last 24h"* → `get_weather_summary`

## Development

```bash
npm run build          # compile TypeScript
npm test               # run unit tests
npm run dev            # watch mode
```

## Architecture

```
src/
├── index.ts           # McpServer + StdioServerTransport entry point
├── client.ts          # shared fetch helper (URLSearchParams, arrays → repeated keys)
├── db.ts              # SQLite (better-sqlite3): jobs + readings tables
├── scheduler.ts       # node-cron scheduler, restores jobs on start
└── tools/
    ├── forecast.ts    # get_forecast
    ├── archive.ts     # get_historical
    ├── air-quality.ts # get_air_quality
    ├── marine.ts      # get_marine
    ├── elevation.ts   # get_elevation
    ├── geocoding.ts   # geocode
    ├── flood.ts       # get_flood
    ├── ensemble.ts    # get_ensemble
    ├── climate.ts     # get_climate
    ├── seasonal.ts    # get_seasonal
    ├── dwd-icon.ts    # get_dwd_icon
    ├── ecmwf.ts       # get_ecmwf
    └── schedule.ts    # schedule_weather_job, list_jobs, get_weather_summary, cancel_job
```

## License

MIT
