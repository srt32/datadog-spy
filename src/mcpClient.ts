import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getConfig } from './config';
import { DataPoint } from './graphRenderer';

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connecting = false;
let statusBarItem: vscode.StatusBarItem | null = null;

/**
 * Creates and shows the MCP connection status bar item.
 */
export function createStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(plug) Metrics Peek';
    statusBarItem.tooltip = 'Datadog MCP: Disconnected';
    statusBarItem.show();
  }
  return statusBarItem;
}

function updateStatus(status: 'connected' | 'connecting' | 'disconnected' | 'error') {
  if (!statusBarItem) { return; }
  switch (status) {
    case 'connected':
      statusBarItem.text = '$(check) Metrics Peek';
      statusBarItem.tooltip = 'Datadog MCP: Connected';
      break;
    case 'connecting':
      statusBarItem.text = '$(sync~spin) Metrics Peek';
      statusBarItem.tooltip = 'Datadog MCP: Connecting...';
      break;
    case 'disconnected':
      statusBarItem.text = '$(plug) Metrics Peek';
      statusBarItem.tooltip = 'Datadog MCP: Disconnected';
      break;
    case 'error':
      statusBarItem.text = '$(error) Metrics Peek';
      statusBarItem.tooltip = 'Datadog MCP: Error';
      break;
  }
}

/**
 * Lazily connects to the Datadog MCP server. Returns the client.
 */
export async function getClient(): Promise<Client> {
  if (client) {
    return client;
  }

  if (connecting) {
    // Wait for existing connection attempt
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (!connecting) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
    if (client) { return client; }
    throw new Error('MCP connection failed');
  }

  connecting = true;
  updateStatus('connecting');

  try {
    const config = getConfig();

    if (!config.datadogApiKey || !config.datadogAppKey) {
      throw new Error(
        'Datadog API key and App key are required. Configure them in Settings → Metrics Peek.'
      );
    }

    transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@winor30/mcp-server-datadog'],
      env: {
        ...process.env,
        DATADOG_API_KEY: config.datadogApiKey,
        DATADOG_APP_KEY: config.datadogAppKey,
        DATADOG_SITE: config.datadogSite,
      },
    });

    client = new Client({
      name: 'metrics-peek',
      version: '0.1.0',
    });

    await client.connect(transport);
    updateStatus('connected');
    return client;
  } catch (err) {
    updateStatus('error');
    client = null;
    throw err;
  } finally {
    connecting = false;
  }
}

/**
 * Queries metrics from Datadog via the MCP server.
 */
export async function queryMetrics(
  metricQuery: string,
  fromEpoch: number,
  toEpoch: number
): Promise<DataPoint[]> {
  const mcpClient = await getClient();

  const result = await mcpClient.callTool({
    name: 'query_metrics',
    arguments: {
      query: metricQuery,
      from: fromEpoch,
      to: toEpoch,
    },
  });

  return parseMetricsResponse(result);
}

/**
 * Parses the MCP tool response into DataPoint[].
 */
function parseMetricsResponse(result: unknown): DataPoint[] {
  try {
    const res = result as { content?: Array<{ type: string; text: string }> };
    if (!res.content || res.content.length === 0) {
      return [];
    }

    const text = res.content[0].text;
    const parsed = JSON.parse(text);

    // The Datadog metrics API returns series data
    if (parsed.series && Array.isArray(parsed.series) && parsed.series.length > 0) {
      const series = parsed.series[0];
      const pointlist = series.pointlist || series.point_list || [];
      return pointlist.map((point: [number, number] | { timestamp: number; value: number }) => {
        if (Array.isArray(point)) {
          return { timestamp: point[0] / 1000, value: point[1] || 0 };
        }
        return { timestamp: point.timestamp, value: point.value || 0 };
      });
    }

    // Fallback: try to find data points directly
    if (Array.isArray(parsed)) {
      return parsed.map((p: { timestamp: number; value: number }) => ({
        timestamp: p.timestamp,
        value: p.value || 0,
      }));
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Disconnects from the MCP server.
 */
export async function disconnect(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
    client = null;
  }
  if (transport) {
    try {
      await transport.close();
    } catch {
      // Ignore close errors
    }
    transport = null;
  }
  updateStatus('disconnected');
}

/**
 * Disposes of the status bar item.
 */
export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = null;
}
