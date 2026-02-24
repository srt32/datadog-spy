import * as vscode from 'vscode';
import { MetricsHoverProvider } from './hoverProvider';
import { openGraphPanel } from './webviewPanel';
import { createStatusBarItem, disconnect, disposeStatusBar } from './mcpClient';
import { getConfig } from './config';

const SUPPORTED_LANGUAGES = [
  'python',
  'go',
  'ruby',
  'javascript',
  'typescript',
  'javascriptreact',
  'typescriptreact',
];

export function activate(context: vscode.ExtensionContext): void {
  // Status bar
  const statusBar = createStatusBarItem();
  context.subscriptions.push(statusBar);

  // Register hover provider for all supported languages
  const hoverProvider = new MetricsHoverProvider();
  for (const language of SUPPORTED_LANGUAGES) {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider({ scheme: 'file', language }, hoverProvider)
    );
  }

  // Register the open graph command
  context.subscriptions.push(
    vscode.commands.registerCommand('metricsPeek.openGraph', (args: unknown) => {
      openGraphPanel(args);
    })
  );

  // Check for missing configuration and prompt user (skip for modes that don't need API keys)
  const config = getConfig();
  if (config.mcpServer !== 'official-local' && config.mcpServer !== 'official-oauth' && (!config.datadogApiKey || !config.datadogAppKey)) {
    vscode.window
      .showInformationMessage(
        'Metrics Peek: Configure your Datadog API key and App key to get started.',
        'Open Settings'
      )
      .then(selection => {
        if (selection === 'Open Settings') {
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'metricsPeek'
          );
        }
      });
  }
}

export function deactivate(): void {
  disconnect();
  disposeStatusBar();
}
