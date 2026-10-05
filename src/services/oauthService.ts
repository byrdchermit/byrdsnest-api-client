import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { StoredToken } from '../types';
import { TokenService } from './tokenService';

export interface OAuthAcquireParams {
  grantType: 'authorization_code' | 'client_credentials' | 'implicit' | 'password';
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  redirectUri?: string;
  scopes?: string[] | string;
  pkce?: boolean;
  username?: string;
  password?: string;
  profileId: string;
  profileName?: string;
  envName?: string;
  envId?: string;
}

export interface OAuthResult {
  success: boolean;
  token?: StoredToken;
  accessToken?: string;
  error?: string;
}

export class OAuthService {
  private static activeServer: http.Server | null = null;

  /**
   * Generates a high-entropy cryptographic code_verifier for PKCE (RFC 7636).
   */
  public static generateCodeVerifier(): string {
    return this.base64UrlEncode(crypto.randomBytes(32));
  }

  /**
   * Generates SHA-256 code_challenge for PKCE.
   */
  public static generateCodeChallenge(verifier: string): string {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return this.base64UrlEncode(hash);
  }

  /**
   * Encodes a buffer to URL-safe base64 (without padding).
   */
  public static base64UrlEncode(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Parses a redirect URI to extract host, port, and pathname.
   */
  public static parseRedirectUri(redirectUri?: string): { hostname: string; port: number; pathname: string } {
    const defaultUri = 'http://127.0.0.1:41982/callback';
    try {
      const u = new URL((redirectUri || defaultUri).trim());
      const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
      return {
        hostname: u.hostname || '127.0.0.1',
        port: isNaN(port) ? 41982 : port,
        pathname: u.pathname || '/callback',
      };
    } catch {
      return {
        hostname: '127.0.0.1',
        port: 41982,
        pathname: '/callback',
      };
    }
  }

  /**
   * Constructs the full authorization URL for browser launch.
   */
  public static buildAuthorizationUrl(params: {
    authorizationUrl: string;
    clientId: string;
    redirectUri: string;
    scopes?: string[] | string;
    state: string;
    codeChallenge?: string;
    responseType?: 'code' | 'token';
  }): string {
    const url = new URL(params.authorizationUrl.trim());
    url.searchParams.set('response_type', params.responseType || 'code');
    if (params.clientId) {
      url.searchParams.set('client_id', params.clientId.trim());
    }
    url.searchParams.set('redirect_uri', params.redirectUri.trim());

    const scopesStr = Array.isArray(params.scopes)
      ? params.scopes.join(' ')
      : (params.scopes || '').trim();
    if (scopesStr) {
      url.searchParams.set('scope', scopesStr);
    }

    url.searchParams.set('state', params.state);

    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    return url.toString();
  }

  /**
   * Exchanges an authorization code for tokens via token endpoint (RFC 6749 Section 4.1.3).
   */
  public static async exchangeCodeForToken(params: {
    tokenUrl: string;
    code: string;
    redirectUri: string;
    clientId?: string;
    clientSecret?: string;
    codeVerifier?: string;
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn?: number;
    scopes?: string[];
  }> {
    const postBody = new URLSearchParams();
    postBody.set('grant_type', 'authorization_code');
    postBody.set('code', params.code);
    postBody.set('redirect_uri', params.redirectUri);

    if (params.clientId) {
      postBody.set('client_id', params.clientId);
    }
    if (params.clientSecret) {
      postBody.set('client_secret', params.clientSecret);
    }
    if (params.codeVerifier) {
      postBody.set('code_verifier', params.codeVerifier);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    };

    if (params.clientId && params.clientSecret) {
      headers['Authorization'] = `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64')}`;
    }

    const res = await fetch(params.tokenUrl, {
      method: 'POST',
      headers,
      body: postBody.toString(),
    });

    const rawText = await res.text();
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = Object.fromEntries(new URLSearchParams(rawText));
    }

    if (!res.ok || data.error) {
      const errMsg = data.error_description || data.error || `HTTP ${res.status}: ${rawText}`;
      throw new Error(`Token exchange failed: ${errMsg}`);
    }

    if (!data.access_token) {
      throw new Error(`No access_token returned by token endpoint. Response: ${rawText}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type || 'Bearer',
      expiresIn: data.expires_in ? parseInt(data.expires_in, 10) : undefined,
      scopes: data.scope ? String(data.scope).split(/[ ,]+/).filter(Boolean) : undefined,
    };
  }

  /**
   * Obtains an access token using Client Credentials grant (RFC 6749 Section 4.4).
   */
  public static async exchangeClientCredentials(params: {
    tokenUrl: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string[] | string;
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn?: number;
    scopes?: string[];
  }> {
    const postBody = new URLSearchParams();
    postBody.set('grant_type', 'client_credentials');
    if (params.clientId) postBody.set('client_id', params.clientId);
    if (params.clientSecret) postBody.set('client_secret', params.clientSecret);
    const scopeStr = Array.isArray(params.scopes) ? params.scopes.join(' ') : (params.scopes || '').trim();
    if (scopeStr) postBody.set('scope', scopeStr);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    };
    if (params.clientId && params.clientSecret) {
      headers['Authorization'] = `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64')}`;
    }

    const res = await fetch(params.tokenUrl, {
      method: 'POST',
      headers,
      body: postBody.toString(),
    });

    const rawText = await res.text();
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = Object.fromEntries(new URLSearchParams(rawText));
    }

    if (!res.ok || data.error) {
      const errMsg = data.error_description || data.error || `HTTP ${res.status}: ${rawText}`;
      throw new Error(`Client credentials exchange failed: ${errMsg}`);
    }

    if (!data.access_token) {
      throw new Error(`No access_token returned by token endpoint. Response: ${rawText}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type || 'Bearer',
      expiresIn: data.expires_in ? parseInt(data.expires_in, 10) : undefined,
      scopes: data.scope ? String(data.scope).split(/[ ,]+/).filter(Boolean) : undefined,
    };
  }

  /**
   * Obtains an access token using Resource Owner Password Credentials grant (RFC 6749 Section 4.3).
   */
  public static async exchangePassword(params: {
    tokenUrl: string;
    username?: string;
    password?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string[] | string;
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn?: number;
    scopes?: string[];
  }> {
    const postBody = new URLSearchParams();
    postBody.set('grant_type', 'password');
    if (params.username) postBody.set('username', params.username);
    if (params.password) postBody.set('password', params.password);
    if (params.clientId) postBody.set('client_id', params.clientId);
    if (params.clientSecret) postBody.set('client_secret', params.clientSecret);
    const scopeStr = Array.isArray(params.scopes) ? params.scopes.join(' ') : (params.scopes || '').trim();
    if (scopeStr) postBody.set('scope', scopeStr);

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    };
    if (params.clientId && params.clientSecret) {
      headers['Authorization'] = `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64')}`;
    }

    const res = await fetch(params.tokenUrl, {
      method: 'POST',
      headers,
      body: postBody.toString(),
    });

    const rawText = await res.text();
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = Object.fromEntries(new URLSearchParams(rawText));
    }

    if (!res.ok || data.error) {
      const errMsg = data.error_description || data.error || `HTTP ${res.status}: ${rawText}`;
      throw new Error(`Password credentials exchange failed: ${errMsg}`);
    }

    if (!data.access_token) {
      throw new Error(`No access_token returned by token endpoint. Response: ${rawText}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type || 'Bearer',
      expiresIn: data.expires_in ? parseInt(data.expires_in, 10) : undefined,
      scopes: data.scope ? String(data.scope).split(/[ ,]+/).filter(Boolean) : undefined,
    };
  }

  /**
   * Main entry point to acquire an OAuth 2.0 access token:
   * - authorization_code: Starts local loopback redirect server, opens browser, listens for callback, and exchanges code for token.
   * - client_credentials: Direct POST to tokenUrl.
   * - password: Direct POST to tokenUrl.
   * - implicit: Starts loopback server and grabs token from browser redirect hash.
   */
  public static async acquireToken(
    params: OAuthAcquireParams,
    tokenService?: TokenService
  ): Promise<OAuthResult> {
    try {
      // 1. Client Credentials flow (Direct API call, no redirect needed)
      if (params.grantType === 'client_credentials') {
        if (!params.tokenUrl) {
          throw new Error('Access Token URL is required for Client Credentials flow.');
        }
        if (!params.clientId) {
          throw new Error('Client ID is required for Client Credentials flow.');
        }
        const exchanged = await this.exchangeClientCredentials({
          tokenUrl: params.tokenUrl,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          scopes: params.scopes,
        });
        return await this.saveAndReturnResult(params, exchanged, tokenService);
      }

      // 2. Resource Owner Password Credentials flow (Direct API call)
      if (params.grantType === 'password') {
        if (!params.tokenUrl) {
          throw new Error('Access Token URL is required for Password Credentials flow.');
        }
        if (!params.username || !params.password) {
          throw new Error('Username and Password are required for Password Credentials flow.');
        }
        const exchanged = await this.exchangePassword({
          tokenUrl: params.tokenUrl,
          username: params.username,
          password: params.password,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          scopes: params.scopes,
        });
        return await this.saveAndReturnResult(params, exchanged, tokenService);
      }

      // 3. Authorization Code flow (Loopback redirect server)
      if (params.grantType === 'authorization_code') {
        if (!params.authorizationUrl) {
          throw new Error('Authorization URL is required for Authorization Code flow.');
        }
        if (!params.tokenUrl) {
          throw new Error('Access Token URL is required for Authorization Code flow.');
        }
        if (!params.clientId) {
          throw new Error('Client ID is required for Authorization Code flow.');
        }

        const redirectUri = params.redirectUri?.trim() || 'http://127.0.0.1:41982/callback';
        const { hostname, port, pathname } = this.parseRedirectUri(redirectUri);

        // Close any prior server
        if (this.activeServer) {
          try { this.activeServer.close(); } catch {}
          this.activeServer = null;
        }

        const state = crypto.randomBytes(16).toString('hex');
        let codeVerifier: string | undefined;
        let codeChallenge: string | undefined;

        if (params.pkce !== false) {
          codeVerifier = this.generateCodeVerifier();
          codeChallenge = this.generateCodeChallenge(codeVerifier);
        }

        const fullAuthUrl = this.buildAuthorizationUrl({
          authorizationUrl: params.authorizationUrl,
          clientId: params.clientId,
          redirectUri,
          scopes: params.scopes,
          state,
          codeChallenge,
          responseType: 'code',
        });

        // Launch server and await code callback
        const authCode = await this.startRedirectListener({
          hostname,
          port,
          pathname,
          expectedState: state,
          browserAuthUrl: fullAuthUrl,
        });

        // Exchange received code for token
        const exchanged = await this.exchangeCodeForToken({
          tokenUrl: params.tokenUrl,
          code: authCode,
          redirectUri,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          codeVerifier,
        });

        return await this.saveAndReturnResult(params, exchanged, tokenService);
      }

      // 4. Implicit flow
      if (params.grantType === 'implicit') {
        if (!params.authorizationUrl) {
          throw new Error('Authorization URL is required for Implicit flow.');
        }
        if (!params.clientId) {
          throw new Error('Client ID is required for Implicit flow.');
        }

        const redirectUri = params.redirectUri?.trim() || 'http://127.0.0.1:41982/callback';
        const { hostname, port, pathname } = this.parseRedirectUri(redirectUri);

        if (this.activeServer) {
          try { this.activeServer.close(); } catch {}
          this.activeServer = null;
        }

        const state = crypto.randomBytes(16).toString('hex');
        const fullAuthUrl = this.buildAuthorizationUrl({
          authorizationUrl: params.authorizationUrl,
          clientId: params.clientId,
          redirectUri,
          scopes: params.scopes,
          state,
          responseType: 'token',
        });

        const tokenResult = await this.startImplicitListener({
          hostname,
          port,
          pathname,
          expectedState: state,
          browserAuthUrl: fullAuthUrl,
        });

        return await this.saveAndReturnResult(params, tokenResult, tokenService);
      }

      throw new Error(`Unsupported grant type: ${params.grantType}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: msg,
      };
    }
  }

  /**
   * Starts a temporary local HTTP loopback server to listen for the OAuth 2.0 authorization code redirect.
   */
  public static startRedirectListener(options: {
    hostname: string;
    port: number;
    pathname: string;
    expectedState: string;
    browserAuthUrl: string;
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      let isSettled = false;

      const server = http.createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', `http://${req.headers.host || `${options.hostname}:${options.port}`}`);

          // Only handle the designated callback path
          if (reqUrl.pathname !== options.pathname) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
          }

          const incomingState = reqUrl.searchParams.get('state');
          const errorParam = reqUrl.searchParams.get('error');
          const errorDesc = reqUrl.searchParams.get('error_description') || errorParam;
          const code = reqUrl.searchParams.get('code');

          if (errorParam) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getErrorHtml(`Authorization denied by provider: ${errorDesc}`));
            cleanup();
            if (!isSettled) {
              isSettled = true;
              reject(new Error(`OAuth provider error: ${errorDesc}`));
            }
            return;
          }

          if (incomingState && incomingState !== options.expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getErrorHtml('State verification failed (CSRF security check mismatch).'));
            cleanup();
            if (!isSettled) {
              isSettled = true;
              reject(new Error('OAuth state mismatch (possible CSRF attack).'));
            }
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getErrorHtml('No authorization code was found in the redirect callback.'));
            cleanup();
            if (!isSettled) {
              isSettled = true;
              reject(new Error('No authorization code received in redirect query parameters.'));
            }
            return;
          }

          // Success! Serve confirmation page to browser
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.getSuccessHtml());

          cleanup();
          if (!isSettled) {
            isSettled = true;
            resolve(code);
          }
        } catch (handlerErr) {
          cleanup();
          if (!isSettled) {
            isSettled = true;
            reject(handlerErr);
          }
        }
      });

      this.activeServer = server;

      // Timeout after 120 seconds (2 minutes)
      const timeout = setTimeout(() => {
        cleanup();
        if (!isSettled) {
          isSettled = true;
          reject(new Error('OAuth authorization timed out. No redirect received within 2 minutes.'));
        }
      }, 120000);

      const cleanup = () => {
        clearTimeout(timeout);
        if (server) {
          try { server.close(); } catch {}
        }
        if (this.activeServer === server) {
          this.activeServer = null;
        }
      };

      server.on('error', (err: any) => {
        cleanup();
        if (!isSettled) {
          isSettled = true;
          if (err.code === 'EADDRINUSE') {
            reject(new Error(`Port ${options.port} is already in use. Please select a different port in the Callback URL or close the application using it.`));
          } else {
            reject(err);
          }
        }
      });

      server.listen(options.port, options.hostname, () => {
        // Server listening! Open browser
        vscode.env.openExternal(vscode.Uri.parse(options.browserAuthUrl)).then(
          (opened) => {
            if (!opened) {
              vscode.window.showInformationMessage(
                `Please open this URL in your browser to authorize: ${options.browserAuthUrl}`,
                'Copy URL'
              ).then((c) => {
                if (c === 'Copy URL') {
                  vscode.env.clipboard.writeText(options.browserAuthUrl);
                }
              });
            }
          },
          (openErr) => {
            console.error('[byrdsnest api client] Failed to open external browser for OAuth:', openErr);
          }
        );
      });
    });
  }

  /**
   * Starts a local loopback server for Implicit flow, capturing the token via hash redirect.
   */
  private static startImplicitListener(options: {
    hostname: string;
    port: number;
    pathname: string;
    expectedState: string;
    browserAuthUrl: string;
  }): Promise<{
    accessToken: string;
    tokenType?: string;
    expiresIn?: number;
  }> {
    return new Promise((resolve, reject) => {
      let isSettled = false;

      const server = http.createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', `http://${req.headers.host || `${options.hostname}:${options.port}`}`);

          if (reqUrl.pathname === options.pathname) {
            // Serve bridge page that converts hash fragment to query parameter
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <!DOCTYPE html>
              <html>
              <head><meta charset="UTF-8"><title>Processing Authorization...</title></head>
              <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #18181b; color: #fff;">
                <p>Completing authentication...</p>
                <script>
                  if (window.location.hash) {
                    var hashQuery = window.location.hash.substring(1);
                    window.location.replace('/oauth-implicit-capture?' + hashQuery);
                  } else {
                    document.body.innerHTML = '<p style="color: #ef4444;">No access token found in URL hash.</p>';
                  }
                </script>
              </body>
              </html>
            `);
            return;
          }

          if (reqUrl.pathname === '/oauth-implicit-capture') {
            const token = reqUrl.searchParams.get('access_token');
            const incomingState = reqUrl.searchParams.get('state');
            const errorParam = reqUrl.searchParams.get('error');

            if (errorParam) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(this.getErrorHtml(`Authorization error: ${errorParam}`));
              cleanup();
              if (!isSettled) {
                isSettled = true;
                reject(new Error(`OAuth error: ${errorParam}`));
              }
              return;
            }

            if (incomingState && incomingState !== options.expectedState) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(this.getErrorHtml('State verification failed.'));
              cleanup();
              if (!isSettled) {
                isSettled = true;
                reject(new Error('State mismatch.'));
              }
              return;
            }

            if (!token) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(this.getErrorHtml('No access token received.'));
              cleanup();
              if (!isSettled) {
                isSettled = true;
                reject(new Error('No access token received.'));
              }
              return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.getSuccessHtml());

            cleanup();
            if (!isSettled) {
              isSettled = true;
              resolve({
                accessToken: token,
                tokenType: reqUrl.searchParams.get('token_type') || 'Bearer',
                expiresIn: reqUrl.searchParams.get('expires_in') ? parseInt(reqUrl.searchParams.get('expires_in')!, 10) : undefined,
              });
            }
            return;
          }

          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } catch (err) {
          cleanup();
          if (!isSettled) {
            isSettled = true;
            reject(err);
          }
        }
      });

      this.activeServer = server;

      const timeout = setTimeout(() => {
        cleanup();
        if (!isSettled) {
          isSettled = true;
          reject(new Error('OAuth authorization timed out after 2 minutes.'));
        }
      }, 120000);

      const cleanup = () => {
        clearTimeout(timeout);
        if (server) {
          try { server.close(); } catch {}
        }
        if (this.activeServer === server) {
          this.activeServer = null;
        }
      };

      server.listen(options.port, options.hostname, () => {
        vscode.env.openExternal(vscode.Uri.parse(options.browserAuthUrl));
      });
    });
  }

  /**
   * Helper to persist token to Token Vault and format result.
   */
  private static async saveAndReturnResult(
    params: OAuthAcquireParams,
    exchanged: {
      accessToken: string;
      refreshToken?: string;
      tokenType?: string;
      expiresIn?: number;
      scopes?: string[];
    },
    tokenService?: TokenService
  ): Promise<OAuthResult> {
    const now = Date.now();
    const expiresAt = exchanged.expiresIn && exchanged.expiresIn > 0
      ? now + (exchanged.expiresIn * 1000)
      : now + (30 * 24 * 60 * 60 * 1000);

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tokenName = `${params.envName || params.profileName || 'OAuth 2.0'} Token (${timeStr})`;

    const storedToken: StoredToken = {
      id: `tok-${now}-${Math.random().toString(36).substring(2, 7)}`,
      profileId: params.profileId || 'global',
      profileName: params.profileName || 'Default Profile',
      envName: params.envName,
      envId: params.envId,
      tokenName,
      accessToken: exchanged.accessToken,
      tokenType: exchanged.tokenType || 'Bearer',
      refreshToken: exchanged.refreshToken,
      expiresAt,
      createdAt: now,
      scopes: exchanged.scopes || (Array.isArray(params.scopes) ? params.scopes : (params.scopes ? String(params.scopes).split(/[ ,]+/).filter(Boolean) : [])),
      source: 'oauth2',
      sourceUrl: params.authorizationUrl || params.tokenUrl,
      clientId: params.clientId,
    };

    if (tokenService) {
      await tokenService.saveToken(storedToken);
    }

    return {
      success: true,
      token: storedToken,
      accessToken: exchanged.accessToken,
    };
  }

  /**
   * HTML rendered to browser upon successful callback.
   */
  public static getSuccessHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Successful - byrdsnest api client</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #18181b;
      color: #e4e4e7;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 12px;
      padding: 36px 32px;
      text-align: center;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      background: rgba(78, 201, 176, 0.15);
      border: 2px solid #4ec9b0;
      color: #4ec9b0;
      border-radius: 50%;
      font-size: 28px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 10px 0;
    }
    p {
      font-size: 14px;
      color: #a1a1aa;
      line-height: 1.5;
      margin: 0 0 8px 0;
    }
    .hint {
      font-size: 13px;
      color: #71717a;
      margin-top: 14px;
    }
    .brand {
      font-size: 11px;
      color: #4ec9b0;
      margin-top: 24px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">✓</div>
    <h1>Authentication Complete</h1>
    <p>Your OAuth 2.0 authorization code was securely received.</p>
    <p class="hint">You can safely close this browser window and return to VS Code.</p>
    <div class="brand">byrdsnest api client</div>
  </div>
</body>
</html>`;
  }

  /**
   * HTML rendered to browser upon callback error.
   */
  public static getErrorHtml(errorMessage: string): string {
    const escaped = errorMessage
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Failed - byrdsnest api client</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #18181b;
      color: #e4e4e7;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #27272a;
      border: 1px solid #ef4444;
      border-radius: 12px;
      padding: 36px 32px;
      text-align: center;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      background: rgba(239, 68, 68, 0.15);
      border: 2px solid #ef4444;
      color: #ef4444;
      border-radius: 50%;
      font-size: 28px;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 10px 0;
    }
    p {
      font-size: 14px;
      color: #f87171;
      line-height: 1.5;
      margin: 0 0 8px 0;
    }
    .hint {
      font-size: 13px;
      color: #71717a;
      margin-top: 14px;
    }
    .brand {
      font-size: 11px;
      color: #ef4444;
      margin-top: 24px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">✕</div>
    <h1>Authentication Error</h1>
    <p>${escaped}</p>
    <p class="hint">Please check your OAuth configuration in VS Code and try again.</p>
    <div class="brand">byrdsnest api client</div>
  </div>
</body>
</html>`;
  }
}
