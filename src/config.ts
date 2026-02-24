import * as vscode from 'vscode';

export interface ExtensionConfig {
  datadogApiKey: string;
  datadogAppKey: string;
  datadogSite: string;
  defaultTimeRange: string;
  metricPrefix: string;
  mcpServer: 'official' | 'official-local' | 'official-oauth' | 'community';
}

const SITE_TO_MCP_ENDPOINT: Record<string, string> = {
  'datadoghq.com': 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
  'us3.datadoghq.com': 'https://mcp.us3.datadoghq.com/api/unstable/mcp-server/mcp',
  'us5.datadoghq.com': 'https://mcp.us5.datadoghq.com/api/unstable/mcp-server/mcp',
  'datadoghq.eu': 'https://mcp.datadoghq.eu/api/unstable/mcp-server/mcp',
  'ap1.datadoghq.com': 'https://mcp.ap1.datadoghq.com/api/unstable/mcp-server/mcp',
  'ap2.datadoghq.com': 'https://mcp.ap2.datadoghq.com/api/unstable/mcp-server/mcp',
};

export function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('metricsPeek');
  return {
    datadogApiKey: config.get<string>('datadogApiKey', ''),
    datadogAppKey: config.get<string>('datadogAppKey', ''),
    datadogSite: config.get<string>('datadogSite', 'datadoghq.com'),
    defaultTimeRange: config.get<string>('defaultTimeRange', '1h'),
    metricPrefix: config.get<string>('metricPrefix', ''),
    mcpServer: config.get<'official' | 'official-local' | 'official-oauth' | 'community'>('mcpServer', 'official'),
  };
}

/**
 * Returns the MCP endpoint URL for a given Datadog site.
 */
export function getMcpEndpoint(site: string): string {
  return SITE_TO_MCP_ENDPOINT[site] || SITE_TO_MCP_ENDPOINT['datadoghq.com'];
}

/**
 * Converts a time range string to seconds.
 */
export function timeRangeToSeconds(range: string): number {
  const map: Record<string, number> = {
    '1h': 3600,
    '4h': 14400,
    '24h': 86400,
    '1w': 604800,
  };
  return map[range] || 3600;
}
