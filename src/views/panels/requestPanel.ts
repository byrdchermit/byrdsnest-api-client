import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AppState, EnvironmentConfig, Profile, RequestContext, RequestItem, StoredToken } from '../../types';
import { BlueByrdStateManager } from '../../state/stateManager';
import { HttpService } from '../../services/httpService';
import { VariableService } from '../../services/variableService';
import { AuthService } from '../../services/authService';
import { TokenService } from '../../services/tokenService';
import { ExportService } from '../../services/exportService';
import { getRequestPanelHtml } from './requestPanelHtml';

export class BlueByrdPanel {
  public static currentPanel: BlueByrdPanel | undefined;
  private static readonly panels = new Map<string, BlueByrdPanel>();
  public static readonly viewType = 'blueByrdApiClient';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly stateManager: BlueByrdStateManager;
  private readonly httpService: HttpService;
  private readonly variableService: VariableService;
  private readonly authService: AuthService;
  private readonly tokenService?: TokenService;
  private readonly panelKey: string;
  private disposables: vscode.Disposable[] = [];
  private baseTitle: string = 'New Request';
  private isDirty: boolean = false;

  public static createOrShow(
    extensionUri: vscode.Uri,
    initialContext: RequestContext | undefined,
    stateManager: BlueByrdStateManager,
    httpService: HttpService,
    variableService: VariableService,
    authService: AuthService,
    tokenService?: TokenService
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // Use stable request ID if available, or generate a unique session key for new requests
    const requestId = initialContext?.requestId || initialContext?.id;
    const panelKey = requestId || `new-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // If panel is already open for this request, reveal it
    if (requestId && this.panels.has(requestId)) {
      const existing = this.panels.get(requestId)!;
      existing.panel.reveal(column);
      return;
    }

    const title = initialContext?.requestName || (initialContext?.method && initialContext?.url ? `${initialContext.method} ${initialContext.url}` : 'New Request');

    const panel = vscode.window.createWebviewPanel(
      BlueByrdPanel.viewType,
      title,
      { viewColumn: column || vscode.ViewColumn.One, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      }
    );

    const instance = new BlueByrdPanel(
      panel,
      extensionUri,
      initialContext || {},
      stateManager,
      httpService,
      variableService,
      authService,
      panelKey,
      tokenService
    );

    this.panels.set(panelKey, instance);
    this.currentPanel = instance;
  }

  /**
   * Push the newly selected active environment to every open request panel.
   * The webview will update its dropdown and re-fetch inherited variables.
   */
  public static broadcastActiveEnvironment(envName: string): void {
    this.panels.forEach((p) => {
      p.panel.webview.postMessage({ type: 'activeEnvironmentChanged', envName });
    });
  }

  /**
   * Push the newly selected active profile to every open request panel.
   */
  public static broadcastActiveProfile(profileId: string, profileName: string): void {
    this.panels.forEach((p) => {
      p.panel.webview.postMessage({ type: 'activeProfileChanged', profileId, profileName });
    });
  }

  /**
   * Broadcast state update (e.g. environment, collection, folder, or profile updated)
   * to all open request panels so they can refresh inherited headers and variables.
   */
  public static broadcastStateUpdated(state?: AppState): void {
    this.panels.forEach((p) => {
      p.refreshInheritedData(state);
    });
  }

  /**
   * Re-evaluates state and prompts webview to refresh inherited variables,
   * inherited headers, and environment/profile selectors.
   */
  public refreshInheritedData(state?: AppState): void {
    try {
      const currentState = state || this.stateManager.getState();
      const environments = Object.entries(currentState.environments).map(([name, env]: [string, EnvironmentConfig]) => ({
        id: env.id,
        name,
        inheritsFrom: env.inheritsFrom,
        profileId: env.profileId,
        baseUrl: env.baseUrl,
        baseUrlDisabled: env.baseUrlDisabled,
      }));
      const profiles = currentState.profiles.map((pr: Profile) => ({
        id: pr.id,
        name: pr.name,
        color: pr.color,
      }));

      this.panel.webview.postMessage({
        type: 'stateUpdated',
        environments,
        profiles,
        activeEnvironment: currentState.activeEnvironmentName,
        activeProfileId: currentState.activeProfileId,
      });
    } catch (err) {
      console.error('[byrdsnest api client] Error refreshing inherited data in panel:', err);
    }
  }

  /**
   * Notify matching open panels when a request is renamed.
   */
  public static notifyRequestRenamed(requestId: string, newName: string): void {
    this.panels.forEach((p) => {
      const id = p.initialContext?.requestId || p.initialContext?.id || p.panelKey;
      if (id === requestId) {
        p.baseTitle = newName;
        p.updatePanelTitle();
        if (p.initialContext) {
          p.initialContext.requestName = newName;
        }
        p.panel.webview.postMessage({ type: 'requestRenamed', requestId, name: newName });
      }
    });
  }

  private updatePanelTitle(): void {
    this.panel.title = this.isDirty ? `● ${this.baseTitle}` : this.baseTitle;
  }

  private readonly initialContext: RequestContext;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    initialContext: RequestContext,
    stateManager: BlueByrdStateManager,
    httpService: HttpService,
    variableService: VariableService,
    authService: AuthService,
    panelKey: string,
    tokenService?: TokenService
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.initialContext = initialContext;
    this.stateManager = stateManager;
    this.httpService = httpService;
    this.variableService = variableService;
    this.authService = authService;
    this.panelKey = panelKey;
    this.tokenService = tokenService;
    this.baseTitle = panel.title || 'New Request';

    // Listen for state changes to live-update inherited headers and variables across open panels
    this.disposables.push(
      this.stateManager.onDidChangeState((state) => {
        this.refreshInheritedData(state);
      })
    );

    // Pre-calculate initial inherited variables and headers for inspector
    const state = this.stateManager.getState();
    const envKeys = Object.keys(state.environments);
    const initialEnv = initialContext?.environment || state.activeEnvironmentName || envKeys[0];
    const initialCol = initialContext?.collection || state.collections[0]?.name;
    const initialFolder = initialContext?.folder && initialContext.folder !== 'Root' ? initialContext.folder : undefined;
    const initialVars = initialContext?.variables || [];
    const initialHeaders = initialContext?.headers || {};
    const initialProfile = initialContext?.profileId || initialContext?.profile || (state.activeProfileId !== 'all' ? state.activeProfileId : undefined) || state.profiles[0]?.id;

    const varDetails = this.variableService.resolveVariablesDetailed(
      initialProfile,
      initialEnv,
      initialCol,
      initialFolder,
      initialVars,
      initialContext?.baseUrlPreference
    );
    const headerDetails = this.variableService.resolveHeadersDetailed(
      initialEnv,
      initialCol,
      initialFolder,
      initialHeaders,
      initialProfile
    );

    const availableTokens = this.tokenService
      ? this.tokenService.getAllTokens().filter(
          (t) => t.profileId === initialProfile || t.profileId === 'global'
        )
      : [];

    // Set HTML content
    this.panel.webview.html = getRequestPanelHtml(
      initialContext,
      state,
      varDetails.inherited,
      headerDetails.inherited,
      availableTokens,
      varDetails.resolved
    );

    // Listen for disposal
    this.panel.onDidDispose(
      () => {
        if (BlueByrdPanel.currentPanel === this) {
          BlueByrdPanel.currentPanel = undefined;
        }
        BlueByrdPanel.panels.delete(this.panelKey);
        while (this.disposables.length) {
          const d = this.disposables.pop();
          if (d) d.dispose();
        }
      },
      null,
      this.disposables
    );

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        try {
          if (message.type === 'dirtyStateChanged') {
            this.isDirty = !!message.isDirty;
            this.updatePanelTitle();
          } else if (message.type === 'sendRequest') {
            const payload = message.payload;

            // Check Safety Guards for active/assigned Profile
            const profileKey = payload.profileId || payload.profile || this.stateManager.getActiveProfileId();
            const profile = profileKey ? this.stateManager.getProfile(profileKey) : undefined;
            if (profile?.guards?.enabled) {
              const method = (payload.method || 'GET').toUpperCase();
              const blocked = (profile.guards.blockedMethods || []).map((m: string) => m.toUpperCase());
              if (blocked.includes(method)) {
                if (profile.guards.requireKeywordConfirmation) {
                  const kw = (profile.guards.confirmationKeyword || 'CONFIRM').trim();
                  const typed = await vscode.window.showInputBox({
                    prompt: `⚠️ High Risk: ${method} requests are guarded on profile "${profile.name}". Type "${kw}" to proceed:`,
                    placeHolder: kw,
                    ignoreFocusOut: true,
                  });
                  if (!typed || typed.trim().toUpperCase() !== kw.toUpperCase()) {
                    vscode.window.showWarningMessage(`Request cancelled. Confirmation keyword did not match.`);
                    return;
                  }
                } else {
                  vscode.window.showErrorMessage(
                    `⛔ Request Blocked: HTTP ${method} requests are blocked by Safety Guards on profile "${profile.name}".`
                  );
                  return;
                }
              } else if (profile.guards.warnBeforeSend) {
                const warnMsg = (profile.guards.warnMessage || '').trim() ||
                  `⚠️ Safety Warning: You are sending a ${method} request under guarded profile "${profile.name}". Proceed?`;
                const choice = await vscode.window.showWarningMessage(
                  warnMsg,
                  { modal: true },
                  'Send Request',
                  'Cancel'
                );
                if (choice !== 'Send Request') {
                  return;
                }
              }
            }

            const meta = await this.httpService.executeRequest(payload);
            this.panel.webview.postMessage({ type: 'requestResult', meta });
            // Refresh explorer so history node updates
            vscode.commands.executeCommand('byrdsnestApiClient.refreshExplorer');
          } else if (message.type === 'saveRequest') {
            const payload = message.payload;
            const savedItem: RequestItem = {
              id: payload.requestId || `req-${Date.now()}`,
              name: payload.requestName || (payload.url ? `${payload.method} ${payload.url}` : 'Saved Request'),
              method: payload.method || 'GET',
              url: payload.url || '',
              folder: payload.folder,
              collection: payload.collection || 'Demo Collection',
              headers: payload.headers || {},
              body: payload.body || '',
              bodyType: payload.bodyType,
              bodyFormData: payload.bodyFormData,
              profile: payload.profile,
              environment: payload.environment,
              baseUrlPreference: payload.baseUrlPreference,
              auth: payload.auth,
              notes: payload.notes,
              variables: payload.variables,
              preRequestScript: payload.preRequestScript,
              postResponseScript: payload.postResponseScript,
            };

            const saved = this.stateManager.saveRequest(savedItem, payload.collection, payload.folder);

            // Update panel title and internal context
            this.baseTitle = saved.name;
            this.isDirty = false;
            this.updatePanelTitle();
            if (this.initialContext) {
              this.initialContext.requestName = saved.name;
              this.initialContext.id = saved.id;
              this.initialContext.requestId = saved.id;
              this.initialContext.baseUrlPreference = saved.baseUrlPreference;
            }
            this.panel.webview.postMessage({ type: 'saved', id: saved.id, name: saved.name });

            vscode.window.showInformationMessage(`Request '${saved.name}' saved.`);
            vscode.commands.executeCommand('byrdsnestApiClient.refreshExplorer');
          } else if (message.type === 'renameRequest') {
            const { requestId, newName } = message.payload || {};
            if (newName && typeof newName === 'string' && newName.trim()) {
              const trimmed = newName.trim();
              this.baseTitle = trimmed;
              this.updatePanelTitle();
              if (this.initialContext) {
                this.initialContext.requestName = trimmed;
              }
              const targetId = requestId || this.initialContext?.requestId || this.initialContext?.id;
              if (targetId) {
                const renamed = this.stateManager.renameRequest(targetId, trimmed);
                if (renamed) {
                  vscode.commands.executeCommand('byrdsnestApiClient.refreshExplorer');
                  vscode.window.showInformationMessage(`Request renamed to '${trimmed}'.`);
                }
              }
              this.panel.webview.postMessage({ type: 'requestRenamed', requestId: targetId, name: trimmed });
            }
          } else if (message.type === 'getInherited') {
            const payload = message.payload;
            const varDetails = this.variableService.resolveVariablesDetailed(
              payload.profileId || payload.profile,
              payload.environment,
              payload.collection,
              payload.folder,
              payload.variables,
              payload.baseUrlPreference
            );
            const headerDetails = this.variableService.resolveHeadersDetailed(
              payload.environment,
              payload.collection,
              payload.folder,
              payload.headers || {},
              payload.profileId || payload.profile
            );
            this.panel.webview.postMessage({
              type: 'updateInherited',
              inheritedVars: varDetails.inherited,
              inheritedHeaders: headerDetails.inherited,
              resolvedVars: varDetails.resolved,
            });
          } else if (message.type === 'previewRequest') {
            const payload = message.payload;
            const vars = this.variableService.resolveVariables(
              payload.profileId || payload.profile,
              payload.environment,
              payload.collection,
              payload.folder,
              payload.variables,
              payload.baseUrlPreference
            );
            const hierarchicalHeaders = this.variableService.resolveHeaders(
              payload.environment,
              payload.collection,
              payload.folder,
              payload.headers || {},
              payload.profileId || payload.profile
            );
            const authHeaders = this.authService.resolveAuthHeaders(
              payload.profileId || payload.profile,
              payload.environment,
              payload.collection,
              payload.folder,
              hierarchicalHeaders,
              payload.auth
            );
            const interpolated = this.variableService.interpolateRequest(
              {
                url: payload.url,
                headers: authHeaders,
                body: payload.body,
              },
              vars
            );

            let resolvedUrl = interpolated.url.trim();
            if (resolvedUrl.startsWith('/') && vars['baseUrl']) {
              resolvedUrl = `${vars['baseUrl'].replace(/\/+$/, '')}${resolvedUrl}`;
            }
            if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) {
              if (resolvedUrl.startsWith('localhost') || /^(?:127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/.*)?$/.test(resolvedUrl)) {
                resolvedUrl = `http://${resolvedUrl}`;
              }
            }

            this.panel.webview.postMessage({
              type: 'preview',
              preview: {
                resolvedUrl: resolvedUrl,
                method: payload.method,
                resolvedHeaders: interpolated.headers,
                resolvedBody: interpolated.body,
                availableVariables: vars,
              },
            });
          } else if (message.type === 'copyCurl') {
            const payload = message.payload;
            const vars = this.variableService.resolveVariables(
              payload.profileId || payload.profile,
              payload.environment,
              payload.collection,
              payload.folder,
              payload.variables,
              payload.baseUrlPreference
            );
            const hierarchicalHeaders = this.variableService.resolveHeaders(
              payload.environment,
              payload.collection,
              payload.folder,
              payload.headers || {},
              payload.profileId || payload.profile
            );
            const authHeaders = this.authService.resolveAuthHeaders(
              payload.profileId || payload.profile,
              payload.environment,
              payload.collection,
              payload.folder,
              hierarchicalHeaders,
              payload.auth
            );
            const interpolated = this.variableService.interpolateRequest(
              {
                url: payload.url,
                headers: authHeaders,
                body: payload.body,
              },
              vars
            );

            let resolvedUrl = interpolated.url.trim();
            if (resolvedUrl.startsWith('/') && vars['baseUrl']) {
              resolvedUrl = `${vars['baseUrl'].replace(/\/+$/, '')}${resolvedUrl}`;
            }
            if (!resolvedUrl.startsWith('http://') && !resolvedUrl.startsWith('https://')) {
              if (resolvedUrl.startsWith('localhost') || /^(?:127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/.*)?$/.test(resolvedUrl)) {
                resolvedUrl = `http://${resolvedUrl}`;
              }
            }

            let curl = `curl -X ${payload.method || 'GET'} "${resolvedUrl}"`;
            Object.entries(interpolated.headers).forEach(([k, v]) => {
              curl += ` -H "${k}: ${v.replace(/"/g, '\\"')}"`;
            });
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(payload.method)) {
              if (payload.bodyType === 'form-data' && Array.isArray(payload.bodyFormData)) {
                payload.bodyFormData.forEach((item: { key: string; value: string; enabled: boolean; type?: string }) => {
                  if (item.enabled && item.key) {
                    if (item.type === 'file') {
                      curl += ` -F "${item.key}=@${(item.value || '').replace(/"/g, '\\"')}"`;
                    } else {
                      curl += ` -F "${item.key}=${(item.value || '').replace(/"/g, '\\"')}"`;
                    }
                  }
                });
              } else if (interpolated.body) {
                curl += ` -d '${interpolated.body.replace(/'/g, "'\\''")}'`;
              }
            }

            await vscode.env.clipboard.writeText(curl);
            vscode.window.showInformationMessage('cURL command copied to clipboard.');
          } else if (message.type === 'openSettings') {
            vscode.commands.executeCommand('byrdsnestApiClient.openSettings');
          } else if (message.type === 'openInEditor') {
            const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
            const language = message.language || 'json';
            const doc = await vscode.workspace.openTextDocument({
              content,
              language,
            });
            await vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Beside,
              preview: true,
            });
            if (message.target === 'requestBody') {
              const docSub = vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document === doc) {
                  this.panel.webview.postMessage({
                    type: 'setRequestBody',
                    body: doc.getText(),
                  });
                }
              });
              this.disposables.push(docSub);
            }
          } else if (message.type === 'selectFile') {
            const uris = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              openLabel: 'Select File for Form Data',
            });
            if (uris && uris.length > 0) {
              this.panel.webview.postMessage({
                type: 'fileSelected',
                rowId: message.rowId,
                filePath: uris[0].fsPath,
              });
            }
          } else if (message.type === 'saveTokenToVault') {
            if (this.tokenService && message.payload?.token) {
              const activeProfileId = this.stateManager.getActiveProfileId() || 'global';
              const profile = this.stateManager.getProfile(activeProfileId);
              const envName = message.payload.envName || this.stateManager.getActiveEnvironmentName() || '';
              const env = this.stateManager.getEnvironment(envName);
              const newToken: StoredToken = {
                id: `tok-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                profileId: activeProfileId,
                profileName: profile?.name || 'Default Profile',
                envName: envName,
                envId: env?.id,
                tokenName: message.payload.name || `${envName || 'Stored'} Token`,
                accessToken: message.payload.token,
                tokenType: 'Bearer',
                createdAt: Date.now(),
                expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
                source: 'manual',
                sourceUrl: message.payload.sourceUrl || (env?.baseUrl || ''),
                clientId: message.payload.clientId,
              };
              await this.tokenService.saveToken(newToken);
              vscode.window.showInformationMessage(`Token "${newToken.tokenName}" saved to vault.`);
              const tokens = await this.tokenService.getTokens(activeProfileId);
              this.panel.webview.postMessage({
                type: 'tokensUpdated',
                tokens,
                selectedId: newToken.id,
              });
            }
          } else if (message.type === 'exportCsv') {
            const payload = message.payload || {};
            const rawTitle = payload.filename || this.baseTitle || 'response';
            const cleanTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '_').trim() || 'response';
            const defaultFileName = cleanTitle.endsWith('.csv') ? cleanTitle : `${cleanTitle}.csv`;

            const saveUri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(defaultFileName),
              filters: { 'CSV (Comma Delimited)': ['csv'], 'All Files': ['*'] },
              saveLabel: 'Export CSV',
            });

            if (saveUri) {
              const csvContent = ExportService.jsonToCsv(payload.data);
              await fs.promises.writeFile(saveUri.fsPath, csvContent, 'utf8');
              const choice = await vscode.window.showInformationMessage(
                `CSV exported: ${path.basename(saveUri.fsPath)}`,
                'Open File'
              );
              if (choice === 'Open File') {
                vscode.env.openExternal(saveUri);
              }
            }
          } else if (message.type === 'exportXlsx') {
            const payload = message.payload || {};
            const rawTitle = payload.filename || this.baseTitle || 'response';
            const cleanTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '_').trim() || 'response';
            const defaultFileName = cleanTitle.endsWith('.xlsx') ? cleanTitle : `${cleanTitle}.xlsx`;

            const saveUri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(defaultFileName),
              filters: { 'Excel Workbook (*.xlsx)': ['xlsx'], 'All Files': ['*'] },
              saveLabel: 'Export Excel Workbook',
            });

            if (saveUri) {
              const sheets = ExportService.jsonToWorkbookSheets(payload.data, cleanTitle);
              const xlsxBuffer = ExportService.generateXlsx(sheets);
              await fs.promises.writeFile(saveUri.fsPath, xlsxBuffer);
              const choice = await vscode.window.showInformationMessage(
                `Excel workbook exported: ${path.basename(saveUri.fsPath)} (${sheets.length} ${sheets.length === 1 ? 'tab' : 'tabs'})`,
                'Open File'
              );
              if (choice === 'Open File') {
                vscode.env.openExternal(saveUri);
              }
            }
          }
        } catch (err) {
          console.error('[byrdsnest api client] Error handling webview message:', err);
          vscode.window.showErrorMessage(`Request panel error: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
      null,
      this.disposables
    );
  }
}

