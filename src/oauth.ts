import * as vscode from 'vscode';
import * as http from 'http';
import * as crypto from 'crypto';
import * as https from 'https';
import * as url from 'url';
import { getMcpEndpoint } from './config';

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

interface ClientRegistration {
  clientId: string;
  clientSecret?: string;
}

const OAUTH_METADATA_PATH = '/.well-known/oauth-authorization-server';
const SCOPES = 'mcp_read mcp_write metrics_read dashboards_read monitors_read';

let cachedTokens: OAuthTokens | null = null;

/**
 * Fetches JSON from a URL via https.
 */
function fetchJson(targetUrl: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    https.get(parsed, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON from ${targetUrl}`)); }
      });
    }).on('error', reject);
  });
}

/**
 * POSTs form data and returns parsed JSON.
 */
function postForm(targetUrl: string, body: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          reject(new Error(`OAuth request failed (${res.statusCode}): ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON in OAuth response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * POSTs JSON and returns parsed JSON.
 */
function postJson(targetUrl: string, payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const parsed = new URL(targetUrl);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          reject(new Error(`Registration failed (${res.statusCode}): ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON in registration response')); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Discovers OAuth metadata from the Datadog MCP server.
 */
async function discoverMetadata(site: string): Promise<OAuthMetadata> {
  const endpoint = getMcpEndpoint(site);
  const baseUrl = new URL(endpoint).origin;
  return fetchJson(`${baseUrl}${OAUTH_METADATA_PATH}`);
}

/**
 * Dynamically registers a client with the Datadog MCP server.
 */
async function registerClient(
  registrationEndpoint: string,
  redirectUri: string
): Promise<ClientRegistration> {
  const response = await postJson(registrationEndpoint, {
    client_name: 'Datadog Spy VS Code Extension',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
  return {
    clientId: response.client_id,
    clientSecret: response.client_secret,
  };
}

/**
 * Generates PKCE code verifier and challenge (S256).
 */
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Starts a local HTTP server to receive the OAuth callback.
 * Returns the auth code received.
 */
function waitForCallback(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url || '', true);
      const code = parsed.query.code as string | undefined;
      const error = parsed.query.error as string | undefined;

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>✅ Authenticated with Datadog!</h2><p>You can close this tab and return to VS Code.</p></body></html>');
        server.close();
        resolve(code);
      }
    });

    server.listen(port, '127.0.0.1');
    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timed out. Please try again.'));
    }, 120000);
  });
}

/**
 * Runs the full OAuth 2.1 PKCE login flow.
 * Opens the browser, waits for callback, exchanges code for tokens.
 */
export async function login(
  context: vscode.ExtensionContext,
  site: string
): Promise<OAuthTokens> {
  const metadata = await discoverMetadata(site);

  // Find a free port for the callback server
  const port = await new Promise<number>((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      srv.close(() => resolve(addr.port));
    });
  });

  const redirectUri = `http://127.0.0.1:${port}/`;

  // Register a dynamic client
  const client = await registerClient(metadata.registration_endpoint, redirectUri);

  // Generate PKCE
  const pkce = generatePkce();
  const state = crypto.randomBytes(16).toString('hex');

  // Build authorization URL
  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', client.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', pkce.challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', SCOPES);

  // Start callback server and open browser
  const codePromise = waitForCallback(port);
  await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

  vscode.window.showInformationMessage('Datadog Spy: Complete login in your browser...');

  const code = await codePromise;

  // Exchange code for tokens
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: client.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: pkce.verifier,
  }).toString();

  const tokenResponse = await postForm(metadata.token_endpoint, tokenBody);

  const tokens: OAuthTokens = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (tokenResponse.expires_in || 3600),
  };

  // Store securely
  await context.secrets.store('datadogOAuthTokens', JSON.stringify(tokens));
  await context.secrets.store('datadogOAuthClientId', client.clientId);
  cachedTokens = tokens;

  vscode.window.showInformationMessage('Datadog Spy: Successfully authenticated!');
  return tokens;
}

/**
 * Gets a valid access token, refreshing if expired.
 */
export async function getAccessToken(
  context: vscode.ExtensionContext,
  site: string
): Promise<string> {
  // Check in-memory cache first
  if (cachedTokens && cachedTokens.expiresAt > Math.floor(Date.now() / 1000) + 60) {
    return cachedTokens.accessToken;
  }

  // Check stored tokens
  const stored = await context.secrets.get('datadogOAuthTokens');
  if (stored) {
    const tokens: OAuthTokens = JSON.parse(stored);

    // Still valid (with 60s buffer)
    if (tokens.expiresAt > Math.floor(Date.now() / 1000) + 60) {
      cachedTokens = tokens;
      return tokens.accessToken;
    }

    // Try refresh
    if (tokens.refreshToken) {
      try {
        const metadata = await discoverMetadata(site);
        const clientId = await context.secrets.get('datadogOAuthClientId');
        if (clientId) {
          const refreshBody = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: tokens.refreshToken,
          }).toString();

          const resp = await postForm(metadata.token_endpoint, refreshBody);
          const newTokens: OAuthTokens = {
            accessToken: resp.access_token,
            refreshToken: resp.refresh_token || tokens.refreshToken,
            expiresAt: Math.floor(Date.now() / 1000) + (resp.expires_in || 3600),
          };

          await context.secrets.store('datadogOAuthTokens', JSON.stringify(newTokens));
          cachedTokens = newTokens;
          return newTokens.accessToken;
        }
      } catch {
        // Refresh failed — need to re-login
      }
    }
  }

  // No valid token — trigger login
  const tokens = await login(context, site);
  return tokens.accessToken;
}

/**
 * Clears stored tokens (logout).
 */
export async function logout(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete('datadogOAuthTokens');
  await context.secrets.delete('datadogOAuthClientId');
  cachedTokens = null;
  vscode.window.showInformationMessage('Datadog Spy: Logged out.');
}
