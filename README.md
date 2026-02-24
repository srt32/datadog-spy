# Metrics Peek

> Hover over metrics calls in your code to see live Datadog graphs from production.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)

## Features

- **Inline sparkline graphs** — hover over `statsd.increment("orders.created")` and see the last hour of data right in your editor
- **Rich graph panel** — click "View Full Graph" to open a side panel with a larger chart, stats, and time range controls
- **Multi-language support** — works with Python, Go, Ruby, JavaScript, and TypeScript
- **Powered by MCP** — uses the [Datadog MCP Server](https://github.com/winor30/mcp-server-datadog) via the Model Context Protocol

## Detected Patterns

| Language | Patterns |
|----------|----------|
| Python | `statsd.increment()`, `statsd.gauge()`, `statsd.histogram()`, `statsd.timing()`, `statsd.count()`, `statsd.distribution()`, `statsd.set()` |
| Go | `statsd.Incr()`, `statsd.Gauge()`, `statsd.Count()`, `statsd.Histogram()`, `statsd.Distribution()`, `statsd.Timing()`, `statsd.Set()` |
| Ruby | `StatsD.increment()`, `StatsD.gauge()`, `StatsD.histogram()`, `StatsD.timing()`, `StatsD.count()`, `StatsD.distribution()`, `StatsD.set()` |
| JS/TS | `statsd.increment()`, `dogstatsd.gauge()`, `metrics.histogram()`, `client.timing()`, `StatsD.count()` |

## Setup

### 1. Install the Extension

Install from the VS Code marketplace or build locally:

```bash
cd metrics-peek
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

### 2. Configure Datadog Credentials

Open VS Code Settings (`Cmd+,` / `Ctrl+,`) and search for "Metrics Peek":

| Setting | Description |
|---------|-------------|
| `metricsPeek.datadogApiKey` | Your Datadog API key |
| `metricsPeek.datadogAppKey` | Your Datadog Application key |
| `metricsPeek.datadogSite` | Datadog site (default: `datadoghq.com`) |
| `metricsPeek.defaultTimeRange` | Default graph time range: `1h`, `4h`, `24h`, `1w` |
| `metricsPeek.metricPrefix` | Optional prefix prepended to detected metric names |

### 3. Usage

1. Open a file containing metrics calls
2. Hover over a metrics call (e.g., `statsd.increment("orders.created")`)
3. See the inline sparkline graph with key stats
4. Click **"View Full Graph"** to open the rich panel view

## How It Works

```
Your Code → Metric Detector (regex) → MCP Client → Datadog MCP Server → query_metrics API
                                                                              ↓
                                       Hover Tooltip ← SVG Sparkline ← Metric Data Points
```

1. The extension registers a `HoverProvider` for supported languages
2. On hover, regex patterns detect metrics calls and extract the metric name
3. The MCP SDK connects to `@winor30/mcp-server-datadog` (spawned as a subprocess)
4. The `query_metrics` tool fetches time-series data from Datadog
5. Data points are rendered as an SVG sparkline embedded in the hover tooltip
6. Results are cached for 60 seconds to minimize API calls

## Requirements

- Node.js 18+ (for the MCP server subprocess)
- Datadog API key and Application key with metrics read access
- `npx` available in PATH

## Development

```bash
npm install          # Install dependencies
npm run compile      # Build TypeScript
npm run watch        # Watch mode
npm test             # Run tests
```

## License

MIT
