# Datadog Spy

> Hover over metrics calls in your code to see live Datadog graphs from production — right inside VS Code.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## What It Does

You're reading code and see `statsd.increment("orders.created")`. What does that metric actually look like in prod right now? Instead of context-switching to Datadog, just hover:

1. **Inline sparkline** appears in the hover tooltip showing the last hour of data
2. **Key stats** (latest, avg, min, max) displayed at a glance
3. **"View Full Graph"** link opens a rich side panel with a larger chart and time range controls

## Features

- **Inline sparkline graphs** — hover over any metrics call and see a 300×60px SVG sparkline rendered directly in the tooltip
- **Rich graph panel** — click "View Full Graph" to open a Webview side panel with a larger interactive chart, key statistics, and time range selector (1h / 4h / 24h / 1w)
- **Multi-language support** — detects metrics calls in Python, Go, Ruby, JavaScript, and TypeScript
- **Powered by MCP** — uses the [Datadog MCP Server](https://github.com/winor30/mcp-server-datadog) via the [Model Context Protocol](https://modelcontextprotocol.io), so the Datadog API interaction is handled by a well-maintained community server
- **Smart caching** — results cached for 60 seconds to avoid hammering the API on repeated hovers
- **Configurable** — set your Datadog site, default time range, and an optional metric name prefix

## Detected Patterns

The extension uses regex-based detection to identify metrics calls. It recognizes the common StatsD/DogStatsD client patterns:

| Language | Example Patterns |
|----------|-----------------|
| **Python** | `statsd.increment('orders.created')`, `dogstatsd.gauge(...)`, `statsd.histogram(...)`, `statsd.timing(...)`, `statsd.distribution(...)`, `statsd.set(...)`, `statsd.count(...)` |
| **Go** | `statsd.Incr("orders.created", ...)`, `statsd.Gauge(...)`, `statsd.Count(...)`, `statsd.Histogram(...)`, `client.Distribution(...)`, `statsd.Timing(...)`, `statsd.Set(...)` |
| **Ruby** | `StatsD.increment('orders.created')`, `StatsD.gauge(...)`, `StatsD.histogram(...)`, `StatsD.timing(...)`, `Datadog::Statsd.count(...)` |
| **JS/TS** | `statsd.increment('orders.created')`, `dogstatsd.gauge(...)`, `metrics.histogram(...)`, `client.timing(...)`, `StatsD.count(...)` |

The detector also handles `decrement`/`Decr` variants. Metric type is normalized (e.g., `increment` → `count`, `Incr` → `count`) and used to pick the right Datadog aggregation function (`sum` for counts, `avg` for gauges, etc.).

## Setup

### Prerequisites

- **Node.js 18+** — needed to run the MCP server subprocess
- **npx** available in your PATH
- **Datadog API key** and **Application key** with metrics read access ([create keys here](https://app.datadoghq.com/organization-settings/api-keys))

### Install

Build locally and run in the Extension Development Host:

```bash
git clone https://github.com/srt32/datadog-spy.git
cd datadog-spy
npm install
npm run compile
```

Then open the project in VS Code and press **F5** to launch the Extension Development Host.

### Configure

Open VS Code Settings (`Cmd+,` / `Ctrl+,`) and search for **"Metrics Peek"**:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `metricsPeek.datadogApiKey` | string | `""` | Your Datadog API key |
| `metricsPeek.datadogAppKey` | string | `""` | Your Datadog Application key |
| `metricsPeek.datadogSite` | string | `"datadoghq.com"` | Datadog site (e.g., `datadoghq.eu`, `us5.datadoghq.com`) |
| `metricsPeek.defaultTimeRange` | enum | `"1h"` | Default time range: `1h`, `4h`, `24h`, `1w` |
| `metricsPeek.metricPrefix` | string | `""` | Optional prefix prepended to detected metric names (e.g., `myapp.`) |

> **Tip:** The extension will prompt you to configure API keys on first activation if they're missing.

### Usage

1. Open any Python, Go, Ruby, JavaScript, or TypeScript file
2. Hover over a metrics call (e.g., `statsd.increment("orders.created")`)
3. See the inline sparkline graph with latest/avg/min/max stats
4. Click **"View Full Graph"** to open the rich panel view with time range controls

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
│  │  MCP Client       │──│  MCP SDK (stdio)         │──────── spawns ──▶ @winor30/mcp-server-datadog
│  │  queryMetrics()   │  │  StdioClientTransport    │     │
│  └───────┬──────────┘  └──────────────────────────┘     │
│          │                                               │
│  ┌───────▼──────────┐  ┌──────────────────────────┐     │
│  │  GraphRenderer    │  │  WebviewPanel             │     │
│  │  (SVG sparkline)  │  │  (rich chart + controls)  │     │
│  └──────────────────┘  └──────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### How It Works

1. The extension registers a `HoverProvider` for all supported languages
2. On hover, regex patterns detect metrics calls and extract the metric name and type
3. The metric type determines the Datadog aggregation function (`sum` for counts, `avg` for gauges)
4. The MCP SDK spawns `@winor30/mcp-server-datadog` as a subprocess and connects via stdio
5. The `query_metrics` MCP tool fetches time-series data from the Datadog API
6. Data points are rendered as an SVG sparkline and embedded in the hover as a base64 `data:` URI (VS Code blocks remote images in hovers)
7. Results are cached for 60 seconds keyed by metric query + time range

### File Structure

```
src/
├── extension.ts        # Entry point — activate/deactivate, register providers
├── config.ts           # Reads VS Code extension settings
├── metricDetector.ts   # Language-specific regex patterns, metric name extraction
├── mcpClient.ts        # MCP SDK client, spawns Datadog MCP server subprocess
├── graphRenderer.ts    # SVG sparkline renderer, stats computation, formatting
├── hoverProvider.ts    # HoverProvider — detection + MCP + sparkline → tooltip
└── webviewPanel.ts     # Webview panel for rich chart display with time controls

test/
├── metricDetector.test.ts  # 22 tests for detection across all languages
└── graphRenderer.test.ts   # 17 tests for rendering, stats, formatting
```

## Development

```bash
npm install          # Install dependencies
npm run compile      # Build TypeScript → out/
npm run watch        # Watch mode (auto-rebuild on save)
npm test             # Run all 39 tests
```

### Testing

Tests use Node.js built-in test runner (`node:test`) with `tsx` for TypeScript support:

```bash
$ npm test

▶ detectMetric
  ▶ Python ✔ (6 tests)
  ▶ Go ✔ (4 tests)
  ▶ Ruby ✔ (2 tests)
  ▶ JavaScript/TypeScript ✔ (4 tests)
▶ detectAllMetrics ✔
▶ buildMetricQuery ✔ (3 tests)
▶ defaultAggregation ✔ (3 tests)
▶ renderSparkline ✔ (5 tests)
▶ computeStats ✔ (3 tests)
▶ formatNumber ✔ (6 tests)
▶ svgToDataUri ✔

ℹ tests 39 | pass 39 | fail 0
```

## Next Steps

Here's what could come next, roughly in priority order:

### Near-term
- [ ] **End-to-end testing** — test the full hover flow with a mock MCP server to verify the sparkline renders correctly
- [ ] **CodeLens integration** — show metric stats as a CodeLens annotation above the line (always visible, not just on hover)
- [ ] **Tag extraction** — parse tags from the metrics call (e.g., `tags: ['env:prod']`) and include them in the Datadog query filter instead of `{*}`
- [ ] **Clickable Datadog link** — add a "Open in Datadog" link in the hover/panel that deep-links to the metric explorer with the right query pre-filled

### Medium-term
- [ ] **AST-based detection** — replace regex with Tree-sitter or language server queries for more accurate detection (handles multi-line calls, variable metric names, etc.)
- [ ] **Metric name from variables** — when the metric name is a variable/constant (e.g., `statsd.increment(METRIC_NAME)`), try to resolve it via simple static analysis or symbol lookup
- [ ] **Anomaly highlighting** — use Datadog anomaly detection or simple threshold comparison to highlight metrics that look unusual (e.g., spike or drop in the last hour)
- [ ] **Dashboard context** — when hovering, also show which Datadog dashboards include this metric (via the `list_dashboards` MCP tool)
- [ ] **Monitor status** — show if there's an active Datadog monitor on this metric and its current status (OK/Alert/Warn) via the `get_monitors` MCP tool

### Longer-term
- [ ] **Marketplace publishing** — package as a `.vsix` and publish to the VS Code Marketplace
- [ ] **Multiple MCP backends** — abstract the MCP client to support other observability backends (Prometheus, Grafana, New Relic) via different MCP servers
- [ ] **Metric discovery** — command palette action to search all metrics in the codebase and show a summary dashboard in a Webview
- [ ] **Team annotations** — let team members annotate metrics with context (e.g., "this spikes during deploys") stored in a shared config file

## License

MIT
