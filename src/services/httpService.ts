import * as fs from 'fs';
import * as path from 'path';
import { AuthSettings, BodyType, FormDataItem, RequestItem, ResponseMetadata, ScriptConsoleLog, TestResultItem, VariableItem } from '../types';
import { BlueByrdStateManager } from '../state/stateManager';
import { VariableService } from './variableService';
import { AuthService } from './authService';
import { ScriptService } from './scriptService';
import { BlueByrdHistoryPanel } from '../views/panels/historyPanel';

export class HttpService {
  private readonly stateManager: BlueByrdStateManager;
  private readonly variableService: VariableService;
  private readonly authService: AuthService;
  private readonly scriptService: ScriptService;

  constructor(
    stateManager: BlueByrdStateManager,
    variableService: VariableService,
    authService: AuthService,
    scriptService?: ScriptService
  ) {
    this.stateManager = stateManager;
    this.variableService = variableService;
    this.authService = authService;
    this.scriptService = scriptService || new ScriptService();
  }

  /**
   * Prepares and executes an HTTP request, recording history on completion.
   */
  public async executeRequest(params: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    bodyType?: BodyType;
    bodyFormData?: FormDataItem[];
    profile?: string;
    profileId?: string;
    environment?: string;
    collection?: string;
    folder?: string;
    requestName?: string;
    requestId?: string;
    auth?: AuthSettings;
    variables?: VariableItem[];
    preRequestScript?: string;
    postResponseScript?: string;
  }, cancellationSignal?: AbortSignal): Promise<ResponseMetadata> {
    let method = (params.method || 'GET').toUpperCase();
    let rawUrl = params.url || '';
    let incomingHeaders: Record<string, string> = { ...(params.headers || {}) };
    let incomingBody = params.body;

    const allConsoleLogs: ScriptConsoleLog[] = [];
    let testResults: TestResultItem[] = [];

    // 1. Resolve combined variables
    let variables = this.variableService.resolveVariables(
      params.profileId || params.profile,
      params.environment,
      params.collection,
      params.folder,
      params.variables,
      (params as any).baseUrlPreference
    );

    // 1.5. Pre-Request Script execution
    if (params.preRequestScript && params.preRequestScript.trim()) {
      const activeEnvObj = params.environment ? this.stateManager.getEnvironment(params.environment) : undefined;
      const colObj = params.collection ? this.stateManager.getCollection(params.collection) : undefined;

      const preResult = this.scriptService.executePreRequest(params.preRequestScript, {
        url: rawUrl,
        method,
        headers: incomingHeaders,
        body: incomingBody,
        environmentVariables: activeEnvObj?.variables || {},
        collectionVariables: colObj?.variables || {},
        resolvedVariables: { ...variables },
      });

      rawUrl = preResult.url;
      method = preResult.method;
      incomingHeaders = preResult.headers;
      incomingBody = preResult.body;
      allConsoleLogs.push(...preResult.consoleLogs);

      // Apply environment variable mutations if any
      if (params.environment && activeEnvObj && Object.keys(preResult.envMutations).length > 0) {
        activeEnvObj.variables = activeEnvObj.variables || {};
        for (const [k, v] of Object.entries(preResult.envMutations)) {
          if (v === null) {
            delete activeEnvObj.variables[k];
          } else {
            activeEnvObj.variables[k] = v;
          }
        }
        this.stateManager.saveEnvironment(params.environment, activeEnvObj);

        // Re-resolve variables since environment changed
        variables = this.variableService.resolveVariables(
          params.profileId || params.profile,
          params.environment,
          params.collection,
          params.folder,
          params.variables,
          (params as any).baseUrlPreference
        );
      }

      // Apply collection variable mutations if any
      if (colObj && Object.keys(preResult.colMutations).length > 0) {
        colObj.variables = colObj.variables || {};
        for (const [k, v] of Object.entries(preResult.colMutations)) {
          if (v === null) {
            delete colObj.variables[k];
          } else {
            colObj.variables[k] = v;
          }
        }
        this.stateManager.saveCollection(colObj);
      }
    }

    // 2. Resolve hierarchical headers (Profile -> Col -> Folder -> Parent Env -> Env -> Request)
    const hierarchicalHeaders = this.variableService.resolveHeaders(
      params.environment,
      params.collection,
      params.folder,
      incomingHeaders,
      params.profileId || params.profile
    );

    // 3. Resolve Auth headers
    const authHeaders = this.authService.resolveAuthHeaders(
      params.profileId || params.profile,
      params.environment,
      params.collection,
      params.folder,
      hierarchicalHeaders,
      params.auth
    );

    // 3. Interpolate variables into URL, headers, and body
    const interpolated = this.variableService.interpolateRequest(
      {
        url: rawUrl,
        headers: authHeaders,
        body: incomingBody,
      },
      variables
    );

    let finalUrl = interpolated.url.trim();

    if (!finalUrl) {
      throw new Error('URL is required to send a request.');
    }

    // Auto-resolve relative URL paths if baseUrl is available
    if (finalUrl.startsWith('/') && variables['baseUrl']) {
      finalUrl = `${variables['baseUrl'].replace(/\/+$/, '')}${finalUrl}`;
    }

    // Auto-prepend http:// if host looks like localhost, 127.0.0.1, or an IPv4 address
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      if (finalUrl.startsWith('localhost') || /^(?:127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/.*)?$/.test(finalUrl)) {
        finalUrl = `http://${finalUrl}`;
      }
    }

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      throw new Error(`Invalid URL scheme: "${finalUrl}". Only HTTP and HTTPS protocols are supported.`);
    }

    // Build fetch RequestInit
    const requestHeaders = new Headers();
    Object.entries(interpolated.headers).forEach(([k, v]) => {
      if (k) requestHeaders.set(k, v);
    });

    // Timeout guard (30 seconds) & mid-flight cancellation
    const controller = new AbortController();
    let isUserCancelled = false;

    const onCancel = () => {
      isUserCancelled = true;
      try {
        controller.abort(new Error('Request cancelled by user.'));
      } catch (_) {}
    };

    if (cancellationSignal) {
      if (cancellationSignal.aborted) {
        onCancel();
      } else {
        cancellationSignal.addEventListener('abort', onCancel);
      }
    }

    const timeoutId = setTimeout(() => {
      try {
        controller.abort(new Error('Request timed out after 30 seconds.'));
      } catch (_) {}
    }, 30000);

    const init: RequestInit = {
      method,
      headers: requestHeaders,
      signal: controller.signal,
    };

    const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (hasBody) {
      if (params.bodyType === 'form-data' && Array.isArray(params.bodyFormData)) {
        if (typeof FormData !== 'undefined') {
          const fd = new FormData();
          for (const item of params.bodyFormData) {
            if (item.enabled && item.key) {
              const k = this.variableService.interpolate(item.key, variables);
              const v = this.variableService.interpolate(item.value || '', variables);

              if (item.type === 'file') {
                let resolvedFilePath = v.trim();
                if (resolvedFilePath) {
                  if (!path.isAbsolute(resolvedFilePath)) {
                    let baseDir = process.cwd();
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-var-requires
                      const vscode = require('vscode');
                      if (vscode.workspace && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        baseDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
                      }
                    } catch {
                      // Running outside VS Code (test suite)
                    }
                    const candidate = path.resolve(baseDir, resolvedFilePath);
                    if (fs.existsSync(candidate)) {
                      resolvedFilePath = candidate;
                    }
                  }

                  if (fs.existsSync(resolvedFilePath)) {
                    const fileBytes = fs.readFileSync(resolvedFilePath);
                    const fileName = path.basename(resolvedFilePath);
                    const blob = new Blob([fileBytes]);
                    fd.append(k, blob, fileName);
                  } else {
                    throw new Error(`File not found for form-data field "${k}": ${v}`);
                  }
                }
              } else {
                fd.append(k, v);
              }
            }
          }
          init.body = fd;
          requestHeaders.delete('content-type');
        } else if (interpolated.body) {
          init.body = interpolated.body;
        }
      } else if (params.bodyType === 'none') {
        // Explicitly no body
      } else if (interpolated.body) {
        init.body = interpolated.body;
      }
    }

    const startTime = performance.now();
    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB limit

    try {
      const response = await fetch(finalUrl, init);
      const elapsedMs = Math.round(performance.now() - startTime);

      // Inspect Content-Length header if present
      const declaredLen = Number(response.headers.get('content-length') || 0);
      if (declaredLen > MAX_RESPONSE_BYTES) {
        throw new Error(`Response payload (${(declaredLen / (1024 * 1024)).toFixed(1)} MB) exceeds the maximum 10 MB limit.`);
      }

      let responseText = await response.text();
      let sizeBytes = new TextEncoder().encode(responseText).length;

      if (sizeBytes > MAX_RESPONSE_BYTES) {
        responseText = responseText.substring(0, MAX_RESPONSE_BYTES) + '\n\n... [Response truncated: exceeded 10 MB limit]';
        sizeBytes = MAX_RESPONSE_BYTES;
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key] = val;
      });

      // 5. Post-Response Script execution
      if (params.postResponseScript && params.postResponseScript.trim()) {
        const activeEnvObj = params.environment ? this.stateManager.getEnvironment(params.environment) : undefined;
        const colObj = params.collection ? this.stateManager.getCollection(params.collection) : undefined;

        const postResult = this.scriptService.executePostResponse(params.postResponseScript, {
          url: finalUrl,
          method,
          requestHeaders: interpolated.headers,
          requestBody: interpolated.body,
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseText,
          elapsedMs,
          environmentVariables: activeEnvObj?.variables || {},
          collectionVariables: colObj?.variables || {},
          resolvedVariables: { ...variables },
        });

        testResults = postResult.testResults;
        allConsoleLogs.push(...postResult.consoleLogs);

        // Apply environment variable mutations if any
        if (params.environment && activeEnvObj && Object.keys(postResult.envMutations).length > 0) {
          activeEnvObj.variables = activeEnvObj.variables || {};
          for (const [k, v] of Object.entries(postResult.envMutations)) {
            if (v === null) {
              delete activeEnvObj.variables[k];
            } else {
              activeEnvObj.variables[k] = v;
            }
          }
          this.stateManager.saveEnvironment(params.environment, activeEnvObj);
        }

        // Apply collection variable mutations if any
        if (colObj && Object.keys(postResult.colMutations).length > 0) {
          colObj.variables = colObj.variables || {};
          for (const [k, v] of Object.entries(postResult.colMutations)) {
            if (v === null) {
              delete colObj.variables[k];
            } else {
              colObj.variables[k] = v;
            }
          }
          this.stateManager.saveCollection(colObj);
        }
      }

      const metadata: ResponseMetadata = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        elapsedMs,
        sizeBytes,
        headers: responseHeaders,
        body: responseText,
        testResults,
        consoleLogs: allConsoleLogs,
      };

      // Record in history without touching collections
      const historyItem: RequestItem = {
        id: params.requestId || `req-hist-${Date.now()}`,
        name: params.requestName || `${method} ${finalUrl}`,
        method,
        url: rawUrl,
        headers: params.headers || {},
        body: params.body || '',
        bodyType: params.bodyType,
        bodyFormData: params.bodyFormData,
        collection: params.collection || 'Demo Collection',
        folder: params.folder,
        profile: params.profile,
        environment: params.environment,
        auth: params.auth,
        variables: params.variables,
        preRequestScript: params.preRequestScript,
        postResponseScript: params.postResponseScript,
      };

      const recorded = this.stateManager.recordHistory(historyItem, {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        elapsedMs,
        sizeBytes,
        headers: responseHeaders,
        body: responseText,
        resolvedUrl: finalUrl,
        testResults,
        consoleLogs: allConsoleLogs,
      });

      // Live notification to open History Inspector
      BlueByrdHistoryPanel.notifyNewHistory(recorded);

      clearTimeout(timeoutId);
      if (cancellationSignal) {
        try { cancellationSignal.removeEventListener('abort', onCancel); } catch (_) {}
      }

      return metadata;
    } catch (err) {
      clearTimeout(timeoutId);
      if (cancellationSignal) {
        try { cancellationSignal.removeEventListener('abort', onCancel); } catch (_) {}
      }

      const elapsedMs = Math.round(performance.now() - startTime);

      // Extract the real OS-level error from Node's fetch wrapper.
      // fetch() wraps network errors as TypeError("fetch failed", { cause: <SystemError> })
      // The actual details (code, port, address) live in err.cause.
      const cause = (err instanceof Error && (err as any).cause) ? (err as any).cause : null;
      const causeCode: string = cause?.code || '';       // e.g. "ECONNREFUSED"
      const causeMsg: string  = cause?.message || '';
      const surfaceMsg = err instanceof Error ? err.message : String(err);

      // Build a structured diagnostic string
      let errorLabel = 'Network Error';
      let diagnostic = surfaceMsg;

      if (causeCode === 'ECONNREFUSED') {
        const addr = cause?.address ? `${cause.address}:${cause.port}` : finalUrl;
        errorLabel = 'Connection Refused';
        diagnostic =
          `Connection refused by ${addr}\n\n` +
          `The server actively rejected the connection. Common causes:\n` +
          `  • The server is not running on that host/port\n` +
          `  • A firewall is blocking the port\n` +
          `  • Wrong port number in baseUrl or URL\n\n` +
          `Error: ECONNREFUSED ${causeMsg || addr}`;
      } else if (causeCode === 'ETIMEDOUT' || causeCode === 'ENETUNREACH') {
        errorLabel = causeCode === 'ETIMEDOUT' ? 'Connection Timed Out' : 'Network Unreachable';
        diagnostic =
          `${errorLabel}: ${causeMsg || finalUrl}\n\n` +
          `Common causes:\n` +
          `  • Host is unreachable (wrong IP or network)\n` +
          `  • Firewall silently dropping packets\n` +
          `  • VPN or routing issue\n\n` +
          `Error: ${causeCode}`;
      } else if (causeCode === 'ENOTFOUND') {
        errorLabel = 'DNS Resolution Failed';
        diagnostic =
          `Cannot resolve hostname: ${causeMsg || finalUrl}\n\n` +
          `Common causes:\n` +
          `  • Hostname doesn't exist or is misspelled\n` +
          `  • DNS not available\n` +
          `  • baseUrl contains a hostname instead of an IP\n\n` +
          `Error: ENOTFOUND`;
      } else if (isUserCancelled || cancellationSignal?.aborted || controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        if (isUserCancelled || cancellationSignal?.aborted) {
          errorLabel = 'Cancelled';
          diagnostic =
            `Request cancelled by user mid-flight.\n\n` +
            `The request was aborted before completing.`;
        } else {
          errorLabel = 'Request Timed Out';
          diagnostic =
            `Request aborted after 30 seconds.\n\n` +
            `The server did not respond within the timeout window.\n` +
            `Check that the host is reachable and the endpoint is responding.`;
        }
      } else if (causeCode) {
        errorLabel = causeCode;
        diagnostic = `${surfaceMsg}\n\nUnderlying error: ${causeCode} — ${causeMsg}`;
      }

      const metadata: ResponseMetadata = {
        ok: false,
        status: 0,
        statusText: errorLabel,
        elapsedMs,
        sizeBytes: 0,
        headers: {},
        body: diagnostic,
        testResults,
        consoleLogs: allConsoleLogs,
      };

      // Record network error attempts in history
      const historyItem: RequestItem = {
        id: params.requestId || `req-hist-${Date.now()}`,
        name: params.requestName || `${method} ${finalUrl}`,
        method,
        url: rawUrl,
        headers: params.headers || {},
        body: params.body || '',
        bodyType: params.bodyType,
        bodyFormData: params.bodyFormData,
        collection: params.collection || 'Demo Collection',
        folder: params.folder,
        profile: params.profile,
        environment: params.environment,
        auth: params.auth,
        variables: params.variables,
        preRequestScript: params.preRequestScript,
        postResponseScript: params.postResponseScript,
      };

      const recorded = this.stateManager.recordHistory(historyItem, {
        ok: false,
        status: 0,
        statusText: errorLabel,
        elapsedMs,
        sizeBytes: 0,
        headers: {},
        body: diagnostic,
        resolvedUrl: finalUrl,
        testResults,
        consoleLogs: allConsoleLogs,
      });

      BlueByrdHistoryPanel.notifyNewHistory(recorded);

      return metadata;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

