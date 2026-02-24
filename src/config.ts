import * as vscode from 'vscode';

export interface ExtensionConfig {
  datadogApiKey: string;
  datadogAppKey: string;
  datadogSite: string;
  defaultTimeRange: string;
  metricPrefix: string;
}

export function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('metricsPeek');
  return {
    datadogApiKey: config.get<string>('datadogApiKey', ''),
    datadogAppKey: config.get<string>('datadogAppKey', ''),
    datadogSite: config.get<string>('datadogSite', 'datadoghq.com'),
    defaultTimeRange: config.get<string>('defaultTimeRange', '1h'),
    metricPrefix: config.get<string>('metricPrefix', ''),
  };
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
