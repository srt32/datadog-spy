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
 * Refreshes an expired OAuth token using the refresh token.
 * Updates the tokens file on disk and returns the new access token.
 */
async function refreshOAuthToken(
  authServerUrl: string,
  clientId: string,
  refreshToken: string,
  tokensPath: string
): Promise<string> {
  // Discover the token endpoint from the OAuth well-known metadata
  const metadataUrl = `${authServerUrl}/.well-known/oauth-authorization-server`;
  const metadata = await fetchJson(metadataUrl);
  const tokenUrl = metadata.token_endpoint || `${authServerUrl}/api/unstable/mcp-server/token`;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  }).toString();

  return new Promise((resolve, reject) => {
    const url = new URL(tokenUrl);
    if (url.protocol !== 'https:') {
      reject(new Error('OAuth token refresh requires an HTTPS endpoint'));
      return;
    }
    const req = require('https').request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`OAuth refresh failed (${res.statusCode}). Re-authenticate via Copilot CLI.`));
            return;
          }
          try {
            const response = JSON.parse(data);
            const newTokens = {
              accessToken: response.access_token,
              refreshToken: response.refresh_token || refreshToken,
              expiresAt: Math.floor(Date.now() / 1000) + (response.expires_in || 3600),
              scope: response.scope || '',
            };
            fs.writeFileSync(tokensPath, JSON.stringify(newTokens, null, 2));
            resolve(newTokens.accessToken);
          } catch {
            reject(new Error('Failed to parse OAuth refresh response.'));
          }
        });
      }
    );
    req.on('error', () => reject(new Error('OAuth refresh request failed. Re-authenticate via Copilot CLI.')));
    req.write(body);
    req.end();
  });
}

/**
 * Fetches JSON from a URL. Only HTTPS is supported.
 */
function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error('Only HTTPS endpoints are supported'));
      return;
    }
    require('https').get(url, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

/**
 * Reads the cached OAuth access token from the Copilot CLI's MCP OAuth config.
 * Automatically refreshes expired tokens using the refresh token.
 */
async function readCopilotOAuthToken(site: string): Promise<string> {
  const oauthDir = path.join(os.homedir(), '.copilot', 'mcp-oauth-config');
  if (!fs.existsSync(oauthDir)) {
    throw new Error('No Copilot MCP OAuth config found. Run Copilot CLI to authenticate with Datadog first.');
  }

  const targetUrl = getMcpEndpoint(site);
  const files = fs.readdirSync(oauthDir).filter(f => f.endsWith('.json') && !f.endsWith('.tokens.json'));

  for (const file of files) {
    try {
      const oauthConfig = JSON.parse(fs.readFileSync(path.join(oauthDir, file), 'utf-8'));
      if (oauthConfig.serverUrl && oauthConfig.serverUrl.replace(/\?$/, '') === targetUrl.replace(/\?$/, '')) {
        const tokensFile = file.replace('.json', '.tokens.json');
        const tokensPath = path.join(oauthDir, tokensFile);
        if (!fs.existsSync(tokensPath)) {
          throw new Error('OAuth tokens not found. Re-authenticate via Copilot CLI.');
        }
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
        if (!tokens.accessToken) {
          throw new Error('OAuth access token missing. Re-authenticate via Copilot CLI.');
        }
        // Auto-refresh if expired
        if (tokens.expiresAt && tokens.expiresAt < Math.floor(Date.now() / 1000)) {
          if (!tokens.refreshToken) {
            throw new Error('OAuth token expired and no refresh token available. Re-authenticate via Copilot CLI.');
          }
          return await refreshOAuthToken(
            oauthConfig.authorizationServerUrl,
            oauthConfig.clientId,
            tokens.refreshToken,
            tokensPath
          );
        }
        return tokens.accessToken;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('OAuth')) { throw err; }
    }
  }
  throw new Error('No Datadog OAuth token found in Copilot config. Ensure Datadog MCP is configured in ~/.copilot/mcp-config.json and authenticated.');
}

async function createTransport(config: ReturnType<typeof getConfig>): Promise<Transport> {
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
      const accessToken = await readCopilotOAuthToken(config.datadogSite);
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

    transport = await createTransport(config);

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

  // The official Datadog MCP tool uses 'queries' (array) and relative time strings;
  // the community tool uses 'query', 'from', 'to' (epoch).
  const args = config.mcpServer === 'community'
    ? { query: metricQuery, from: fromEpoch, to: toEpoch }
    : { queries: [metricQuery], from: `${fromEpoch}`, to: `${toEpoch}` };

  let result;
  try {
    result = await mcpClient.callTool({
      name: toolName,
      arguments: args,
    });
  } catch (err) {
    // Reset connection on session errors and retry once
    if (err instanceof Error && err.message.includes('session')) {
      await disconnect();
      const retryClient = await getClient();
      result = await retryClient.callTool({ name: toolName, arguments: args });
    } else {
      throw err;
    }
  }

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
