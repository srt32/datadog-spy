import * as vscode from 'vscode';
import { detectMetric, buildMetricQuery } from './metricDetector';
import { queryMetrics } from './mcpClient';
import { renderSparkline, svgToDataUri, computeStats, formatNumber, DataPoint } from './graphRenderer';
import { getConfig, timeRangeToSeconds } from './config';

interface CacheEntry {
  data: DataPoint[];
  timestamp: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export class MetricsHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const line = document.lineAt(position.line).text;
    const match = detectMetric(line, document.languageId);

    if (!match) {
      return null;
    }

    // Check if cursor is within the metric call
    if (position.character < match.startIndex || position.character > match.endIndex) {
      return null;
    }

    const config = getConfig();
    const metricQuery = buildMetricQuery(match.metricName, match.metricType, config.metricPrefix);

    // Build the hover content
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = true;

    try {
      const data = await getCachedMetrics(metricQuery, config.defaultTimeRange);

      if (data.length === 0) {
        const fullMetricName = config.metricPrefix ? `${config.metricPrefix}${match.metricName}` : match.metricName;
        const explorerUrl = `https://app.${config.datadogSite}/metric/explorer?exp_metric=${encodeURIComponent(fullMetricName)}`;
        md.appendMarkdown(`**📊 ${match.metricName}** _(${match.metricType})_\n\n`);
        md.appendMarkdown(`_No data found for_ \`${metricQuery}\`\n\n`);
        md.appendMarkdown(`Mode: \`${config.mcpServer}\` | Tool: \`${config.mcpServer === 'community' ? 'query_metrics' : 'get_datadog_metric'}\`\n\n`);
        md.appendMarkdown(`[Open in Metrics Explorer](${explorerUrl}) | Query: \`${metricQuery}\` | Range: ${config.defaultTimeRange}`);
        return new vscode.Hover(md);
      }

      const stats = computeStats(data);
      const svg = renderSparkline(data);
      const dataUri = svgToDataUri(svg);

      md.appendMarkdown(`**📊 ${match.metricName}** _(${match.metricType})_\n\n`);
      md.appendMarkdown(
        `Latest: **${formatNumber(stats.latest)}** | ` +
        `Avg: ${formatNumber(stats.avg)} | ` +
        `Min: ${formatNumber(stats.min)} | ` +
        `Max: ${formatNumber(stats.max)}\n\n`
      );
      md.appendMarkdown(`<img src="${dataUri}" width="300" height="60" />\n\n`);

      // Encode the metric info for the command — VS Code command URIs use JSON array as query param
      const cmdArgs = encodeURIComponent(JSON.stringify([{
        metricName: match.metricName,
        metricType: match.metricType,
        metricQuery,
      }]));
      const fullMetricName = config.metricPrefix ? `${config.metricPrefix}${match.metricName}` : match.metricName;
      const explorerUrl = `https://app.${config.datadogSite}/metric/explorer?exp_metric=${encodeURIComponent(fullMetricName)}`;
      md.appendMarkdown(`[View Full Graph](command:metricsPeek.openGraph?${cmdArgs})`);
      md.appendMarkdown(` | [Open in Datadog](${explorerUrl})`);
      md.appendMarkdown(` | \`${metricQuery}\``);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      md.appendMarkdown(`**📊 ${match.metricName}** _(${match.metricType})_\n\n`);
      md.appendMarkdown(`⚠️ _Error fetching metrics:_ ${message}\n\n`);

      if (message.includes('API key') || message.includes('App key')) {
        md.appendMarkdown(`[Open Settings](command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify('metricsPeek'))})`);
      }
    }

    const range = new vscode.Range(
      position.line, match.startIndex,
      position.line, match.endIndex
    );

    return new vscode.Hover(md, range);
  }
}

async function getCachedMetrics(metricQuery: string, timeRange: string): Promise<DataPoint[]> {
  const cacheKey = `${metricQuery}:${timeRange}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const now = Math.floor(Date.now() / 1000);
  const rangeSeconds = timeRangeToSeconds(timeRange);
  const from = now - rangeSeconds;

  const data = await queryMetrics(metricQuery, from, now);

  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}
