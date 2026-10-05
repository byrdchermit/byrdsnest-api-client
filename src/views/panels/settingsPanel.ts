import * as vscode from 'vscode';
import { Collection, CollectionFolder, EnvironmentConfig, Profile, ProfileAuth, ProfileGuardConfig, StoredToken } from '../../types';
import { BlueByrdStateManager } from '../../state/stateManager';
import { TokenService } from '../../services/tokenService';
import { OAuthService } from '../../services/oauthService';
import { getSettingsPanelHtml } from './settingsPanelHtml';
import { BlueByrdPanel } from './requestPanel';

export class BlueByrdSettingsPanel {
  public static readonly viewType = 'blueByrdSettings';
  public static currentPanel?: BlueByrdSettingsPanel;
  private static readonly panels = new Map<string, BlueByrdSettingsPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly stateManager: BlueByrdStateManager;
  private readonly tokenService?: TokenService;
  private readonly target: 'profile' | 'environment' | 'collection' | 'folder';
  private readonly originalName: string;
  private readonly originalId?: string;
  private readonly collectionName?: string;
  private disposables: vscode.Disposable[] = [];

  private static getPanelKey(
    target: 'profile' | 'environment' | 'collection' | 'folder',
    idOrName: string,
    collectionName?: string
  ): string {
    return [target, idOrName, collectionName || 'root'].join('::');
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    target: 'profile' | 'environment' | 'collection' | 'folder',
    name: string,
    stateManager: BlueByrdStateManager,
    collectionName?: string,
    itemId?: string,
    tokenService?: TokenService
  ): void {
    try {
      const key = this.getPanelKey(target, itemId || name, collectionName);
      const existing = this.panels.get(key);
      if (existing) {
        existing.panel.reveal(vscode.ViewColumn.One);
        return;
      }

      const state = stateManager.getState();
      const isDuplicateName = target === 'profile'
        ? state.profiles.filter((p) => p.name === name).length > 1
        : false;
      const title = isDuplicateName && itemId
        ? `${name} (${itemId.replace(/^profile-/, '')}) Settings`
        : `${name || 'Untitled'} Settings`;

      const panel = vscode.window.createWebviewPanel(
        BlueByrdSettingsPanel.viewType,
        title,
        { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
        {
          enableScripts: true,
          localResourceRoots: [extensionUri],
          retainContextWhenHidden: true,
        }
      );

      const instance = new BlueByrdSettingsPanel(
        panel,
        target,
        name,
        stateManager,
        collectionName,
        itemId,
        tokenService
      );

      this.panels.set(key, instance);
      this.currentPanel = instance;
    } catch (err) {
      console.error('[byrdsnest api client] Failed to open settings panel:', err);
      vscode.window.showErrorMessage(`Failed to open settings: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    target: 'profile' | 'environment' | 'collection' | 'folder',
    name: string,
    stateManager: BlueByrdStateManager,
    collectionName?: string,
    itemId?: string,
    tokenService?: TokenService
  ) {
    this.panel = panel;
    this.target = target;
    this.originalName = name;
    this.originalId = itemId;
    this.collectionName = collectionName;
    this.stateManager = stateManager;
    this.tokenService = tokenService;

    const item = this.resolveItem();
    const allEnvironments = Object.entries(this.stateManager.getEnvironments()).map(([name, env]) => ({
      id: env.id,
      name,
      baseUrl: env.baseUrl,
      inheritsFrom: env.inheritsFrom,
    }));
    const allProfiles = this.stateManager.getProfiles().map((p) => ({
      id: p.id,
      name: p.name,
    }));

    const profileId = this.target === 'profile' ? (this.originalId || 'global') : this.stateManager.getActiveProfileId();
    const availableTokens = this.tokenService
      ? this.tokenService.getAllTokens().filter((t) => t.profileId === profileId || t.profileId === 'global')
      : [];

    this.panel.webview.html = getSettingsPanelHtml(
      target,
      item,
      name,
      collectionName,
      allEnvironments,
      allProfiles,
      availableTokens
    );

    this.panel.onDidDispose(
      () => {
        if (BlueByrdSettingsPanel.currentPanel === this) {
          BlueByrdSettingsPanel.currentPanel = undefined;
        }
        const key = BlueByrdSettingsPanel.getPanelKey(
          this.target,
          this.originalId || this.originalName,
          this.collectionName
        );
        BlueByrdSettingsPanel.panels.delete(key);
        while (this.disposables.length) {
          const d = this.disposables.pop();
          if (d) d.dispose();
        }
      },
      null,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.type === 'cancel') {
          this.panel.dispose();
          return;
        }

        if (message.type === 'saveSettings') {
          this.handleSave(message.payload);
        } else if (message.type === 'saveTokenToVault') {
          if (this.tokenService && message.payload?.token) {
            const activePid = (this.target === 'profile' ? (this.originalId || 'global') : this.stateManager.getActiveProfileId()) || 'global';
            const prof = this.stateManager.getProfile(activePid);
            const envName = this.target === 'environment' ? this.originalName : (message.payload.envName || '');
            const env = this.target === 'environment' ? (this.resolveItem() as EnvironmentConfig) : (envName ? this.stateManager.getEnvironment(envName) : undefined);
            const newToken: StoredToken = {
              id: `tok-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              profileId: activePid,
              profileName: prof?.name || 'Default Profile',
              envName: envName || undefined,
              envId: env?.id,
              tokenName: message.payload.name || `${this.originalName || 'Stored'} Token`,
              accessToken: message.payload.token,
              tokenType: 'Bearer',
              createdAt: Date.now(),
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
              source: 'manual',
              sourceUrl: message.payload.sourceUrl || env?.baseUrl,
              clientId: message.payload.clientId,
            };
            await this.tokenService.saveToken(newToken);
            vscode.window.showInformationMessage(`Token "${newToken.tokenName}" saved to vault.`);
            const updatedTokens = await this.tokenService.getTokens(activePid);
            this.panel.webview.postMessage({
              type: 'tokensUpdated',
              tokens: updatedTokens,
              selectedId: newToken.id,
            });
          }
        } else if (message.type === 'getOAuthToken') {
          const payload = message.payload || {};
          const activePid = (this.target === 'profile' ? (this.originalId || 'global') : this.stateManager.getActiveProfileId()) || 'global';
          const prof = this.stateManager.getProfile(activePid);
          const envName = this.target === 'environment' ? this.originalName : (this.stateManager.getActiveEnvironmentName() || '');
          const env = this.stateManager.getEnvironment(envName);

          const result = await OAuthService.acquireToken(
            {
              grantType: payload.grantType || 'authorization_code',
              clientId: payload.clientId,
              clientSecret: payload.clientSecret,
              authorizationUrl: payload.authorizationUrl,
              tokenUrl: payload.tokenUrl,
              redirectUri: payload.redirectUri,
              scopes: payload.scopes,
              pkce: payload.pkce,
              username: payload.username,
              password: payload.password,
              profileId: activePid,
              profileName: prof?.name || 'Default Profile',
              envName: envName,
              envId: env?.id,
            },
            this.tokenService
          );

          if (result.success && result.token) {
            vscode.window.showInformationMessage(`OAuth 2.0 token successfully acquired and saved to vault!`);
            const allTokens = this.tokenService ? await this.tokenService.getTokens(activePid) : [];
            this.panel.webview.postMessage({
              type: 'oauthTokenAcquired',
              token: result.accessToken,
              tokenId: result.token.id,
              tokenName: result.token.tokenName,
              tokens: allTokens,
            });
          } else {
            vscode.window.showErrorMessage(`OAuth authorization failed: ${result.error || 'Unknown error'}`);
            this.panel.webview.postMessage({
              type: 'oauthTokenError',
              error: result.error || 'OAuth authorization failed',
            });
          }
        }
      },
      null,
      this.disposables
    );
  }

  private resolveItem(): Profile | EnvironmentConfig | Collection | CollectionFolder | undefined {
    const idOrName = this.originalId || this.originalName;
    if (this.target === 'profile') {
      return this.stateManager.getProfile(idOrName);
    } else if (this.target === 'environment') {
      return this.stateManager.getEnvironment(idOrName);
    } else if (this.target === 'collection') {
      return this.stateManager.getCollection(idOrName);
    } else if (this.target === 'folder') {
      const col = this.stateManager.getCollection(this.collectionName);
      return col?.folders.find((f) => f.id === idOrName || f.name === idOrName);
    }
    return undefined;
  }

  private handleSave(payload: {
    name: string;
    color?: string;
    baseUrl?: string;
    baseUrlDisabled?: boolean;
    baseUrlPreference?: 'collection' | 'environment';
    inheritsFrom?: string;
    profileId?: string;
    authType: 'none' | 'bearer' | 'apiKey' | 'oauth2' | 'basic';
    token?: string;
    headerName?: string;
    keyName?: string;
    headerPrefix?: string;
    addTo?: 'header' | 'query';
    username?: string;
    password?: string;
    clientId?: string;
    clientSecret?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
    grantType?: string;
    selectedTokenId?: string;
    redirectUri?: string;
    pkce?: boolean;
    inheritAuth?: boolean;
    variables: Record<string, string>;
    headers?: Record<string, string>;
    notes?: string;
    guards?: ProfileGuardConfig;
  }): void {
    const nextName = payload.name.trim() || this.originalName;

    const authObj: ProfileAuth = {
      type: payload.authType,
      token: payload.token,
      headerName: payload.headerName || (payload.authType === 'apiKey' ? payload.keyName || 'X-API-Key' : 'Authorization'),
      keyName: payload.keyName || (payload.authType === 'apiKey' ? payload.headerName || 'X-API-Key' : undefined),
      headerPrefix: payload.headerPrefix || (payload.authType === 'bearer' || payload.authType === 'oauth2' ? 'Bearer' : undefined),
      addTo: payload.addTo || 'header',
      username: payload.username,
      password: payload.password,
      clientId: payload.clientId,
      clientSecret: payload.clientSecret,
      authorizationUrl: payload.authorizationUrl,
      tokenUrl: payload.tokenUrl,
      scopes: payload.scopes,
      grantType: payload.grantType as any,
      selectedTokenId: payload.selectedTokenId,
      redirectUri: payload.redirectUri,
      pkce: payload.pkce,
    };

    if (this.target === 'profile') {
      const existing = this.stateManager.getProfile(this.originalId || this.originalName);
      const updated: Profile = {
        id: this.originalId || existing?.id || `profile-${Date.now()}`,
        name: nextName,
        color: payload.color || existing?.color || '#3b82f6',
        auth: authObj,
        variables: payload.variables,
        headers: payload.headers,
        inheritsFrom: payload.inheritsFrom,
        notes: payload.notes,
        guards: payload.guards || existing?.guards,
      };
      this.stateManager.saveProfile(updated);
    } else if (this.target === 'environment') {
      const existing = this.stateManager.getEnvironment(this.originalId || this.originalName);
      const inheritsFrom = payload.inheritsFrom !== undefined ? (payload.inheritsFrom.trim() || undefined) : existing?.inheritsFrom;
      const updated: EnvironmentConfig = {
        id: this.originalId || existing?.id || `env-${Date.now()}`,
        baseUrl: inheritsFrom && !payload.baseUrl ? '' : (payload.baseUrl || (inheritsFrom ? '' : 'https://api.example.com')),
        baseUrlDisabled: !!payload.baseUrlDisabled,
        auth: authObj,
        variables: payload.variables,
        headers: payload.headers,
        inheritsFrom,
        notes: payload.notes,
        profileId: payload.profileId || undefined,
      };
      this.stateManager.saveEnvironment(nextName, updated, this.originalName);
    } else if (this.target === 'collection') {
      const existing = this.stateManager.getCollection(this.originalId || this.originalName);
      if (existing) {
        existing.name = nextName;
        existing.variables = payload.variables || {};
        existing.headers = payload.headers;
        existing.inheritsFrom = payload.inheritsFrom;
        existing.notes = payload.notes;
        existing.profileId = payload.profileId || undefined;
        existing.baseUrlDisabled = !!payload.baseUrlDisabled;
        if (payload.baseUrl !== undefined) {
          existing.baseUrl = payload.baseUrl.trim();
          if (existing.baseUrl) {
            existing.variables['baseUrl'] = existing.baseUrl;
          }
        }
        if (payload.baseUrlPreference) {
          existing.baseUrlPreference = payload.baseUrlPreference;
          existing.preferCollectionBaseUrl = payload.baseUrlPreference === 'collection';
        }
        existing.auth = {
          inheritFromProfile: payload.inheritAuth !== false,
          inheritFromEnvironment: payload.inheritAuth !== false,
          auth: authObj,
        };
        this.stateManager.saveCollection(existing);
      }
    } else if (this.target === 'folder') {
      const col = this.stateManager.getCollection(this.collectionName);
      const existing = col?.folders.find((f) => f.id === this.originalId || f.name === this.originalName);
      if (col && existing) {
        existing.name = nextName;
        existing.variables = payload.variables;
        existing.headers = payload.headers;
        existing.inheritsFrom = payload.inheritsFrom;
        existing.notes = payload.notes;
        existing.baseUrlDisabled = !!payload.baseUrlDisabled;
        existing.auth = {
          inheritFromProfile: payload.inheritAuth !== false,
          inheritFromEnvironment: payload.inheritAuth !== false,
          inheritFromCollection: payload.inheritAuth !== false,
          inheritFromFolder: payload.inheritAuth !== false,
          auth: authObj,
        };
        this.stateManager.saveCollection(col);
      }
    }

    vscode.window.showInformationMessage(`${this.target.toUpperCase()} settings saved.`);
    vscode.commands.executeCommand('byrdsnestApiClient.refreshExplorer');
    BlueByrdPanel.broadcastStateUpdated();
    try {
      this.panel.title = `${nextName} Settings`;
    } catch {
      // Panel might already be disposed
    }
  }
}

