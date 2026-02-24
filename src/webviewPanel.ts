import * as vscode from 'vscode';
import { queryMetrics } from './mcpClient';
import { DataPoint, computeStats, formatNumber } from './graphRenderer';
import { getConfig, timeRangeToSeconds } from './config';

interface GraphArgs {
  metricName: string;
  metricType: string;
  metricQuery: string;
}

let currentPanel: vscode.WebviewPanel | null = null;

export function openGraphPanel(argsJson: string): void {
  let args: GraphArgs;
  try {
    args = JSON.parse(argsJson);
  } catch {
    vscode.window.showErrorMessage('Metrics Peek: Invalid graph arguments');
    return;
  }

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      'metricsPeekGraph',
      `📊 ${args.metricName}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    currentPanel.onDidDispose(() => {
      currentPanel = null;
    });
  }

  currentPanel.title = `📊 ${args.metricName}`;
  loadGraphData(currentPanel, args);
}

async function loadGraphData(panel: vscode.WebviewPanel, args: GraphArgs): Promise<void> {
  panel.webview.html = getLoadingHtml(args.metricName);

  try {
    const config = getConfig();
    const now = Math.floor(Date.now() / 1000);
    const rangeSeconds = timeRangeToSeconds(config.defaultTimeRange);
    const from = now - rangeSeconds;

    const data = await queryMetrics(args.metricQuery, from, now);
    const stats = computeStats(data);

    panel.webview.html = getGraphHtml(args, data, stats, config.defaultTimeRange);

    // Handle messages from the webview (time range changes)
    panel.webview.onDidReceiveMessage(async (message: { type: string; range: string }) => {
      if (message.type === 'changeRange') {
        const newRangeSeconds = timeRangeToSeconds(message.range);
        const newFrom = Math.floor(Date.now() / 1000) - newRangeSeconds;
        const newTo = Math.floor(Date.now() / 1000);

        panel.webview.html = getLoadingHtml(args.metricName);
        try {
          const newData = await queryMetrics(args.metricQuery, newFrom, newTo);
          const newStats = computeStats(newData);
          panel.webview.html = getGraphHtml(args, newData, newStats, message.range);
        } catch (err) {
          panel.webview.html = getErrorHtml(args.metricName, err instanceof Error ? err.message : 'Unknown error');
        }
      }
    });
  } catch (err) {
    panel.webview.html = getErrorHtml(args.metricName, err instanceof Error ? err.message : 'Unknown error');
  }
}

function getLoadingHtml(metricName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #1e1e1e); padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 200px; }
    .loading { text-align: center; }
    .spinner { font-size: 24px; animation: spin 1s linear infinite; display: inline-block; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner">⏳</div>
    <p>Loading <strong>${escapeHtml(metricName)}</strong>...</p>
  </div>
</body>
</html>`;
}

function getErrorHtml(metricName: string, error: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #1e1e1e); padding: 20px; }
    .error { color: var(--vscode-errorForeground, #f44); }
  </style>
</head>
<body>
  <h2>📊 ${escapeHtml(metricName)}</h2>
  <p class="error">⚠️ Error: ${escapeHtml(error)}</p>
</body>
</html>`;
}

function getGraphHtml(args: GraphArgs, data: DataPoint[], stats: { avg: number; min: number; max: number; latest: number }, activeRange: string): string {
  const ranges = ['1h', '4h', '24h', '1w'];

  // Build SVG chart
  const chartWidth = 600;
  const chartHeight = 250;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  let chartSvg = '';
  if (data.length > 0) {
    const values = data.map(d => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    const points = data.map((d, i) => {
      const x = padding.left + (i / Math.max(data.length - 1, 1)) * innerWidth;
      const y = padding.top + innerHeight - ((d.value - minVal) / range) * innerHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const baseY = padding.top + innerHeight;
    const areaPoints = [`${padding.left},${baseY}`, ...points, `${padding.left + innerWidth},${baseY}`];

    // Y-axis labels
    const yLabels = [minVal, (minVal + maxVal) / 2, maxVal].map((v, i) => {
      const y = padding.top + innerHeight - (i / 2) * innerHeight;
      return `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#888">${formatNumber(v)}</text>`;
    }).join('\n');

    // X-axis time labels
    const startTime = new Date(data[0].timestamp * 1000);
    const endTime = new Date(data[data.length - 1].timestamp * 1000);
    const xLabels = `
      <text x="${padding.left}" y="${chartHeight - 5}" font-size="11" fill="#888">${formatTimeLabel(startTime)}</text>
      <text x="${padding.left + innerWidth}" y="${chartHeight - 5}" text-anchor="end" font-size="11" fill="#888">${formatTimeLabel(endTime)}</text>
    `;

    // Grid lines
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(pct => {
      const y = padding.top + innerHeight * (1 - pct);
      return `<line x1="${padding.left}" y1="${y}" x2="${padding.left + innerWidth}" y2="${y}" stroke="#333" stroke-width="0.5"/>`;
    }).join('\n');

    chartSvg = `<svg width="${chartWidth}" height="${chartHeight}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      <polygon points="${areaPoints.join(' ')}" fill="rgba(99, 44, 166, 0.2)"/>
      <polyline points="${points.join(' ')}" fill="none" stroke="#632CA6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${yLabels}
      ${xLabels}
    </svg>`;
  } else {
    chartSvg = `<svg width="${chartWidth}" height="${chartHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="${chartWidth / 2}" y="${chartHeight / 2}" text-anchor="middle" font-size="14" fill="#888">No data available</text>
    </svg>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      color: var(--vscode-foreground, #ccc);
      background: var(--vscode-editor-background, #1e1e1e);
      padding: 20px;
      margin: 0;
    }
    h2 { margin-top: 0; }
    .stats {
      display: flex;
      gap: 24px;
      margin: 16px 0;
    }
    .stat {
      display: flex;
      flex-direction: column;
    }
    .stat-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      text-transform: uppercase;
    }
    .stat-value {
      font-size: 20px;
      font-weight: bold;
    }
    .stat-value.latest { color: #632CA6; }
    .ranges {
      display: flex;
      gap: 8px;
      margin: 16px 0;
    }
    .range-btn {
      padding: 4px 12px;
      border: 1px solid var(--vscode-button-border, #555);
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      font-size: 12px;
    }
    .range-btn:hover {
      background: var(--vscode-button-hoverBackground, #333);
    }
    .range-btn.active {
      background: #632CA6;
      color: white;
      border-color: #632CA6;
    }
    .chart { margin: 16px 0; }
    .query {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      margin-top: 16px;
    }
    code {
      background: var(--vscode-textCodeBlock-background, #2d2d2d);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h2>📊 ${escapeHtml(args.metricName)}</h2>
  <p style="margin-top: -8px; color: var(--vscode-descriptionForeground, #888);">Type: ${escapeHtml(args.metricType)}</p>

  <div class="stats">
    <div class="stat">
      <span class="stat-label">Latest</span>
      <span class="stat-value latest">${formatNumber(stats.latest)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Average</span>
      <span class="stat-value">${formatNumber(stats.avg)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Min</span>
      <span class="stat-value">${formatNumber(stats.min)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Max</span>
      <span class="stat-value">${formatNumber(stats.max)}</span>
    </div>
  </div>

  <div class="ranges">
    ${ranges.map(r => `<button class="range-btn ${r === activeRange ? 'active' : ''}" onclick="changeRange('${r}')">${r}</button>`).join('\n    ')}
  </div>

  <div class="chart">${chartSvg}</div>

  <div class="query">Query: <code>${escapeHtml(args.metricQuery)}</code></div>

  <script>
    const vscode = acquireVsCodeApi();
    function changeRange(range) {
      vscode.postMessage({ type: 'changeRange', range });
    }
  </script>
</body>
</html>`;
}

function formatTimeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
