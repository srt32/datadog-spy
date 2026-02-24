import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { getConfig, getMcpEndpoint } from './config';
import { DataPoint } from './graphRenderer';
import { parseMetricsResponse } from './parseMetrics';

export { parseMetricsResponse } from './parseMetrics';

let client: Client | null = null;
let transport: Transport | null = null;
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
 * Reads the cached OAuth access token from the Copilot CLI's MCP OAuth config.
 * Looks for a token file whose config matches the Datadog MCP server URL.
 */
function readCopilotOAuthToken(site: string): string {
  const oauthDir = path.join(os.homedir(), '.copilot', 'mcp-oauth-config');
  if (!fs.existsSync(oauthDir)) {
    throw new Error('No Copilot MCP OAuth config found. Run Copilot CLI to authenticate with Datadog first.');
  }

  const targetUrl = getMcpEndpoint(site);
  const files = fs.readdirSync(oauthDir).filter(f => f.endsWith('.json') && !f.endsWith('.tokens.json'));

  for (const file of files) {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(oauthDir, file), 'utf-8'));
      if (config.serverUrl && config.serverUrl.replace(/\?$/, '') === targetUrl.replace(/\?$/, '')) {
        const tokensFile = file.replace('.json', '.tokens.json');
        const tokensPath = path.join(oauthDir, tokensFile);
        if (!fs.existsSync(tokensPath)) {
          throw new Error('OAuth tokens not found. Re-authenticate via Copilot CLI.');
        }
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
        if (!tokens.accessToken) {
          throw new Error('OAuth access token missing. Re-authenticate via Copilot CLI.');
        }
        if (tokens.expiresAt && tokens.expiresAt * 1000 < Date.now()) {
          throw new Error('OAuth token expired. Re-authenticate via Copilot CLI.');
        }
        return tokens.accessToken;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('OAuth')) { throw err; }
      // Skip malformed config files
    }
  }
  throw new Error('No Datadog OAuth token found in Copilot config. Ensure Datadog MCP is configured in ~/.copilot/mcp-config.json and authenticated.');
}

function createTransport(config: ReturnType<typeof getConfig>): Transport {
  switch (config.mcpServer) {
    case 'official': {
      // Official Datadog MCP server via Streamable HTTP
      const endpoint = getMcpEndpoint(config.datadogSite);
      const url = new URL(endpoint);
      return new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            'DD_API_KEY': config.datadogApiKey,
            'DD_APPLICATION_KEY': config.datadogAppKey,
          },
        },
      });
    }
    case 'official-oauth': {
      // Official Datadog MCP server via Streamable HTTP with Copilot CLI OAuth tokens
      const endpoint = getMcpEndpoint(config.datadogSite);
      const url = new URL(endpoint);
      const accessToken = readCopilotOAuthToken(config.datadogSite);
      return new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        },
      });
    }
    case 'official-local': {
      // Official Datadog MCP server via local binary (datadog_mcp_cli)
      return new StdioClientTransport({
        command: 'datadog_mcp_cli',
        args: [],
        env: { ...process.env } as Record<string, string>,
      });
    }
    case 'community': {
      // Community MCP server via npx
      return new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@winor30/mcp-server-datadog'],
        env: {
          ...process.env,
          DATADOG_API_KEY: config.datadogApiKey,
          DATADOG_APP_KEY: config.datadogAppKey,
          DATADOG_SITE: config.datadogSite,
        },
      });
    }
  }
}

/**
 * Returns the MCP tool name for querying metrics based on the configured server.
 */
function getMetricToolName(mcpServer: string): string {
  return mcpServer === 'community' ? 'query_metrics' : 'get_datadog_metric';
}

/**
 * Lazily connects to the Datadog MCP server. Returns the client.
 */
export async function getClient(): Promise<Client> {
  if (client) {
    return client;
  }

  if (connecting) {
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

    // API keys required for official (remote) and community modes
    if (config.mcpServer !== 'official-local' && config.mcpServer !== 'official-oauth' && (!config.datadogApiKey || !config.datadogAppKey)) {
      throw new Error(
        'Datadog API key and App key are required. Configure them in Settings → Metrics Peek.'
      );
    }

    transport = createTransport(config);

    client = new Client({
      name: 'datadog-spy',
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
  const config = getConfig();
  const mcpClient = await getClient();
  const toolName = getMetricToolName(config.mcpServer);

  const result = await mcpClient.callTool({
    name: toolName,
    arguments: {
      query: metricQuery,
      from: fromEpoch,
      to: toEpoch,
    },
  });

  return parseMetricsResponse(result);
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
