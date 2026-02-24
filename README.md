# Datadog Spy

> Hover over metrics calls in your code to see live Datadog graphs from production — right inside VS Code.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## What It Does

You're reading code and see `statsd.increment("orders.created")`. What does that metric actually look like in prod right now? Instead of context-switching to Datadog, just hover:

1. **Inline sparkline** appears in the hover tooltip showing the last hour of data
2. **Key stats** (latest, avg, min, max) displayed at a glance
3. **"Open in Datadog"** link takes you directly to the Metrics Explorer for that metric
4. **"View Full Graph"** link opens a rich side panel with a larger chart and time range controls

## Quick Start

### 1. Clone and build

```bash
git clone https://github.com/srt32/datadog-spy.git
cd datadog-spy
npm install
npm run compile
```

### 2. Launch in VS Code

```bash
open -a "Visual Studio Code" .    # macOS
# or: code .                      # if you have the `code` CLI alias
```

Then launch the Extension Development Host:

- **macOS:** `Cmd+Shift+P` → type **"Debug: Start Debugging"** → Enter
- **Windows/Linux:** Press `F5`

This opens a **second VS Code window** where the extension is active.

### 3. Open your project in the Extension Development Host

In the second window that opened: `Cmd+O` (macOS) or `Ctrl+O` → open your project folder.

### 4. Set the metric prefix

Most projects prepend a namespace to all metrics. For example, if your code has `statsClient.Increment("publish", ...)` but the metric in Datadog is `gateway_limiting_agent.publish`, you need to set the prefix:

`Cmd+,` (macOS) or `Ctrl+,` → search **`metricsPeek.metricPrefix`** → set to your prefix (e.g., `gateway_limiting_agent.`)

> **Important:** Include the trailing dot (`.`) in the prefix.

### 5. Hover over a metrics call

Open any file with StatsD/DogStatsD calls and hover over the metric name. You should see a sparkline, stats, and links.

## Authentication

The extension defaults to `official-oauth` mode, which **reuses your existing Copilot CLI OAuth tokens** — no API keys to configure.

### Prerequisites for OAuth mode (default)

1. You have GitHub Copilot CLI installed
2. You have Datadog MCP configured in `~/.copilot/mcp-config.json`:
   ```json
   {
     "mcpServers": {
       "datadog": {
         "type": "http",
         "url": "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
         "headers": {},
         "tools": ["*"]
       }
     }
   }
   ```
3. You've used a Datadog MCP tool at least once via Copilot CLI (this triggers the initial OAuth login and caches tokens at `~/.copilot/mcp-oauth-config/`)

The extension reads the cached tokens and **auto-refreshes** them when they expire.

### Alternative auth modes

| Mode | Setting | Auth | Best for |
|------|---------|------|----------|
| **Copilot OAuth** (default) | `official-oauth` | Reads `~/.copilot/mcp-oauth-config/` | Copilot CLI users — zero config |
| **API Keys** | `official` | `metricsPeek.datadogApiKey` + `datadogAppKey` | Users with Datadog API keys |
| **Local CLI** | `official-local` | `datadog_mcp_cli login` | Users who prefer the local binary |
| **Community** | `community` | API keys + npx | No Preview access needed |

## Detected Patterns

The extension uses regex-based detection to identify metrics calls:

| Language | Example Patterns |
|----------|-----------------|
| **Python** | `statsd.increment('orders.created')`, `dogstatsd.gauge(...)`, `statsd.histogram(...)` |
| **Go** | `statsd.Incr("orders.created", ...)`, `statsClient.Increment(...)`, `statsd.Gauge(...)`, `client.Count(...)` |
| **Ruby** | `StatsD.increment('orders.created')`, `Datadog::Statsd.count(...)` |
| **JS/TS** | `statsd.increment('orders.created')`, `dogstatsd.gauge(...)`, `metrics.histogram(...)` |

The detector handles `increment`/`decrement`/`Incr`/`Decr` and normalizes metric types to pick the right Datadog aggregation (`sum` for counts, `avg` for gauges, etc.).

## Configuration

Open VS Code Settings (`Cmd+,` / `Ctrl+,`) and search for **"Metrics Peek"**:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `metricsPeek.mcpServer` | enum | `"official-oauth"` | MCP backend (see auth modes above) |
| `metricsPeek.datadogApiKey` | string | `""` | Datadog API key (only for `official` and `community` modes) |
| `metricsPeek.datadogAppKey` | string | `""` | Datadog App key (only for `official` and `community` modes) |
| `metricsPeek.datadogSite` | string | `"datadoghq.com"` | Datadog site / region |
| `metricsPeek.defaultTimeRange` | enum | `"1h"` | Time range: `1h`, `4h`, `24h`, `1w` |
| `metricsPeek.metricPrefix` | string | `""` | Prefix prepended to metric names (e.g., `myapp.`) |

## Known Issues & Gotchas

### Metric prefix is required for most projects
Your code says `statsClient.Increment("publish")` but Datadog knows it as `gateway_limiting_agent.publish`. **You must set `metricsPeek.metricPrefix`** to the namespace your StatsD client is configured with (including the trailing `.`). Without this, you'll see "No data found."

### Regex detection doesn't match all client variable names
The Go detector matches `statsd`, `statsClient`, and `client` as variable names. If your project uses a different name (e.g., `ddClient.Incr(...)`), the hover won't trigger. File an issue or add your pattern to `src/metricDetector.ts`.

### Session errors on restart
If you restart the Extension Development Host, you may see "Invalid session ID" errors on the first hover. The extension auto-reconnects — just hover again and it should work.

### OAuth token expiry
The `official-oauth` mode reads tokens from `~/.copilot/mcp-oauth-config/`. If both the access token and refresh token are expired (e.g., you haven't used Copilot CLI in weeks), the auto-refresh will fail. Fix: use any Datadog MCP tool via Copilot CLI once to re-authenticate, then hover again.

### First hover is slow
The first hover establishes the MCP connection (~1-3 seconds). Subsequent hovers use the cached connection and return in ~200ms. Results are also cached for 60 seconds.

### Metric names in variables aren't resolved
If the code uses `statsd.Incr(metricName)` where `metricName` is a variable, the extension can't detect it (regex limitation). Only string literals are detected.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Extension (datadog-spy)                        │
│                                                         │
│  ┌──────────────────┐  ┌──────────────────────────┐     │
│  │  HoverProvider    │──│  MetricDetector          │     │
│  │  (sparkline +     │  │  (language-specific      │     │
│  │   "View Graph")   │  │   regex patterns)        │     │
│  └───────┬──────────┘  └──────────────────────────┘     │
│          │                                               │
│  ┌───────▼──────────┐  ┌──────────────────────────┐     │
│  │  MCP Client       │──│  MCP SDK                 │     │
│  │  queryMetrics()   │  │  (transport auto-select) │     │
│  └───────┬──────────┘  └──────────┬───────────────┘     │
│          │                        │                      │
│  ┌───────▼──────────┐             ├── StreamableHTTP ──▶ Official Datadog MCP (OAuth)
│  │  GraphRenderer    │             ├── StreamableHTTP ──▶ Official Datadog MCP (API keys)
│  │  (SVG sparkline)  │             ├── Stdio ──────────▶ datadog_mcp_cli (local binary)
│  └──────────────────┘             └── Stdio ──────────▶ @winor30/mcp-server-datadog
│  ┌──────────────────┐                                    │
│  │  WebviewPanel     │                                   │
│  │  (rich chart)     │                                   │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── extension.ts        # Entry point — activate/deactivate, register providers
├── config.ts           # Settings + MCP endpoint resolution per Datadog region
├── metricDetector.ts   # Language-specific regex patterns, metric name extraction
├── mcpClient.ts        # MCP client — auto-selects transport, session retry, OAuth
├── oauth.ts            # OAuth 2.1 PKCE flow for Datadog MCP authentication
├── parseMetrics.ts     # Response parser — handles binned, CSV, and series formats
├── graphRenderer.ts    # SVG sparkline renderer, stats computation, formatting
├── hoverProvider.ts    # HoverProvider — detection + MCP + sparkline → tooltip
└── webviewPanel.ts     # Webview panel for rich chart display with time controls

test/
├── metricDetector.test.ts  # Detection tests across all languages + edge cases
├── graphRenderer.test.ts   # Rendering, stats, formatting tests
├── mcpClient.test.ts       # MCP response parsing tests
└── config.test.ts          # Time range conversion tests
```

## Development

```bash
npm install          # Install dependencies
npm run compile      # Build TypeScript → out/
npm run watch        # Watch mode (auto-rebuild on save)
npm test             # Run tests (67 tests)
```

## License

MIT
