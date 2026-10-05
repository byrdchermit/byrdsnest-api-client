import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AppState, Collection, DEFAULT_PROFILE_COLORS, EnvironmentConfig, Profile, RequestContext, StoredToken } from '../types';
import { BlueByrdStateManager } from '../state/stateManager';
import { HttpService } from '../services/httpService';
import { VariableService } from '../services/variableService';
import { AuthService } from '../services/authService';
import { TokenService } from '../services/tokenService';
import { ImportExportService } from '../services/importExportService';
import { UpdateService } from '../services/updateService';
import { BlueByrdPanel } from '../views/panels/requestPanel';
import { BlueByrdSettingsPanel } from '../views/panels/settingsPanel';
import { BlueByrdGlobalSettingsPanel } from '../views/panels/globalSettingsPanel';
import { BlueByrdHistoryPanel } from '../views/panels/historyPanel';
import { BlueByrdTreeItem } from '../views/tree/treeItem';

export interface TreeRefreshable {
  refresh(): void;
}

export class CommandManager {
  private readonly context: vscode.ExtensionContext;
  private readonly stateManager: BlueByrdStateManager;
  private readonly treeProvider: TreeRefreshable;
  private readonly httpService: HttpService;
  private readonly variableService: VariableService;
  private readonly authService: AuthService;
  private readonly updateService: UpdateService;
  private readonly tokenService: TokenService;

  constructor(
    context: vscode.ExtensionContext,
    stateManager: BlueByrdStateManager,
    treeProvider: TreeRefreshable,
    httpService: HttpService,
    variableService: VariableService,
    authService: AuthService,
    updateService?: UpdateService,
    tokenService?: TokenService
  ) {
    this.context = context;
    this.stateManager = stateManager;
    this.treeProvider = treeProvider;
    this.httpService = httpService;
    this.variableService = variableService;
    this.authService = authService;
    this.updateService = updateService || new UpdateService(context);
    this.tokenService = tokenService || new TokenService(context.secrets);
  }

  private regCmd(commandName: string, callback: (...args: any[]) => any): vscode.Disposable {
    return vscode.commands.registerCommand(`byrdsnestApiClient.${commandName}`, callback);
  }

  public registerAll(): void {
    const s = this.context.subscriptions;

    // Open Sidebar
    s.push(
      this.regCmd('openSidebar', () => {
        vscode.commands.executeCommand('workbench.view.extension.byrdsnestApiClient');
      })
    );

    // Refresh Explorer
    s.push(
      this.regCmd('refreshExplorer', () => {
        this.treeProvider.refresh();
      })
    );

    // Open Request Panel
    s.push(
      this.regCmd('openRequestPanel', (payload?: RequestContext) => {
        BlueByrdPanel.createOrShow(
          this.context.extensionUri,
          payload,
          this.stateManager,
          this.httpService,
          this.variableService,
          this.authService,
          this.tokenService
        );
      })
    );

    // Open Dedicated History Inspector Panel (Singleton)
    s.push(
      this.regCmd('openHistoryPanel',
        (arg?: BlueByrdTreeItem | { historyId?: string } | string) => {
          let selectedId: string | undefined;
          if (arg instanceof BlueByrdTreeItem) {
            selectedId = arg.itemId;
          } else if (typeof arg === 'string') {
            selectedId = arg;
          } else if (arg && typeof arg === 'object') {
            selectedId = (arg as any).historyId || (arg as any).itemId || (arg as any).id;
          }

          BlueByrdHistoryPanel.createOrShow(
            this.context.extensionUri,
            this.stateManager,
            selectedId
          );
        }
      )
    );

    // Clear History
    s.push(
      this.regCmd('clearHistory', async () => {
        const confirm = await vscode.window.showWarningMessage(
          'Are you sure you want to clear all request history?',
          { modal: true },
          'Clear History'
        );
        if (confirm === 'Clear History') {
          this.stateManager.clearHistory();
          this.treeProvider.refresh();
          vscode.window.showInformationMessage('Request history cleared.');
          BlueByrdHistoryPanel.notifyHistoryCleared();
        }
      })
    );

    // New Request
    s.push(
      this.regCmd('newRequest', (treeItem?: BlueByrdTreeItem) => {
        const state = this.stateManager.getState();
        const activeProfile = state.activeProfileId && state.activeProfileId !== 'all'
          ? this.stateManager.getProfile(state.activeProfileId)
          : state.profiles[0];
        const activeEnv = state.activeEnvironmentName || Object.keys(state.environments)[0] || 'Local';

        const collection = treeItem?.kind === 'collection'
          ? treeItem.label
          : treeItem?.kind === 'folder' && treeItem.parentId
          ? state.collections.find((c) => c.id === treeItem.parentId)?.name || state.collections[0]?.name
          : state.collections[0]?.name || 'Demo Collection';

        const folder = treeItem?.kind === 'folder' ? treeItem.label : undefined;

        BlueByrdPanel.createOrShow(
          this.context.extensionUri,
          {
            method: 'GET',
            url: '{{baseUrl}}/',
            collection,
            folder,
            profile: activeProfile?.name || state.profiles[0]?.name,
            environment: activeEnv,
          },
          this.stateManager,
          this.httpService,
          this.variableService,
          this.authService,
          this.tokenService
        );
      })
    );

    // Switch Active Profile Scope
    s.push(
      this.regCmd('switchActiveProfile', async () => {
        const state = this.stateManager.getState();
        const activeProfileId = state.activeProfileId;

        const items: Array<vscode.QuickPickItem & { profileId?: string }> = [
          {
            label: '$(globe) All Profiles (Global Scope)',
            description: (!activeProfileId || activeProfileId === 'all') ? 'Current Active Scope' : '',
            profileId: 'all',
          },
        ];

        for (const p of state.profiles) {
          const isCurrent = activeProfileId === p.id || activeProfileId === p.name;
          items.push({
            label: `$(account) ${p.name}`,
            description: isCurrent ? 'Current Active Scope' : '',
            profileId: p.id,
          });
        }

        items.push({
          label: '$(add) Create New Profile...',
          profileId: '__create__',
        });

        items.push({
          label: '$(gear) Manage Profiles & Settings...',
          profileId: '__manage__',
        });

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select workspace profile scope',
        });

        if (!selected) return;

        if (selected.profileId === '__create__') {
          vscode.commands.executeCommand('byrdsnestApiClient.createProfile');
          return;
        }

        if (selected.profileId === '__manage__') {
          vscode.commands.executeCommand('byrdsnestApiClient.openSettings');
          return;
        }

        const newId = selected.profileId === 'all' ? undefined : selected.profileId;
        this.stateManager.setActiveProfileId(newId);
        if (newId) {
          const prof = this.stateManager.getProfile(newId);
          if (prof) BlueByrdPanel.broadcastActiveProfile(prof.id, prof.name);
        }
        this.treeProvider.refresh();
        vscode.window.showInformationMessage(`Active profile scope set to: ${selected.label.replace(/^\$\([^)]+\)\s*/, '')}`);
      })
    );

    // Set Active Profile Directly (e.g. from context menu)
    s.push(
      this.regCmd('setActiveProfile', (arg?: BlueByrdTreeItem | { id?: string; name?: string } | string) => {
        let profileId: string | undefined;
        let profileName: string | undefined;

        if (arg instanceof BlueByrdTreeItem) {
          profileId = arg.itemId;
          profileName = arg.label;
        } else if (typeof arg === 'string') {
          profileId = arg;
        } else if (arg && typeof arg === 'object') {
          profileId = (arg as any).itemId || arg.id;
          profileName = arg.name || (arg as any).label;
        }

        const profile = this.stateManager.getProfile(profileId) || this.stateManager.getProfile(profileName);
        if (profile) {
          this.stateManager.setActiveProfileId(profile.id);
          BlueByrdPanel.broadcastActiveProfile(profile.id, profile.name);
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Active profile set to: ${profile.name}`);
        } else if (profileId === 'global' || profileId === 'all' || profileName === 'Shared / Global') {
          this.stateManager.setActiveProfileId(undefined);
          BlueByrdPanel.broadcastActiveProfile('global', 'Shared / Global');
          this.treeProvider.refresh();
          vscode.window.showInformationMessage('Active profile set to: Shared / Global');
        }
      })
    );

    // Open Settings & Profile Manager
    s.push(
      this.regCmd('openSettings', (arg?: any) => {
        let initialTab = 'profiles';
        let profileId: string | undefined;

        if (typeof arg === 'string') {
          initialTab = arg;
        } else if (arg && typeof arg === 'object') {
          if (arg.tab) initialTab = arg.tab;
          profileId = arg.profileId || arg.id || arg.itemId;
        }

        BlueByrdGlobalSettingsPanel.createOrShow(
          this.context.extensionUri,
          this.stateManager,
          this.tokenService,
          initialTab,
          profileId
        );
      })
    );

    // Manage OAuth Tokens (QuickPick Token Vault)
    s.push(
      this.regCmd('manageTokens', async (arg?: BlueByrdTreeItem | { profileId?: string }) => {
        let profileId = (arg instanceof BlueByrdTreeItem ? arg.parentId || arg.itemId : arg?.profileId) || this.stateManager.getActiveProfileId() || 'global';
        if (profileId === 'all') profileId = 'global';

        const profile = this.stateManager.getProfile(profileId);
        const profileName = profile ? profile.name : (profileId === 'global' ? 'Shared / Global' : profileId);

        const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { token?: StoredToken; action?: string }>();
        picker.title = `Stored OAuth Tokens - ${profileName}`;
        picker.placeholder = 'Click trash to delete a token, or select to copy access token';
        picker.matchOnDescription = true;
        picker.matchOnDetail = true;

        const refreshPicker = async () => {
          await this.tokenService.pruneExpiredTokens(profileId);
          const tokens = await this.tokenService.getTokens(profileId);
          const now = Date.now();

          const items: Array<vscode.QuickPickItem & { token?: StoredToken; action?: string }> = [];

          if (tokens.length === 0) {
            items.push({
              label: '$(info) No stored OAuth tokens for this profile',
              description: 'Mint a token via OAuth 2.0 to populate this vault',
              action: 'none',
            });
          } else {
            const sorted = [...tokens].sort((a, b) => b.expiresAt - a.expiresAt);
            for (const t of sorted) {
              const isExpired = t.expiresAt <= now;
              const timeStr = new Date(t.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const dateStr = new Date(t.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
              const expiryDesc = isExpired ? `Expired (${dateStr} ${timeStr})` : `Expires ${timeStr}`;
              const descParts = [t.tier, expiryDesc, t.refreshToken ? 'refreshable' : undefined].filter(Boolean);

              items.push({
                label: `$(key) ${t.envName || t.tokenName || t.tier || 'Access Token'}`,
                description: descParts.join(' • '),
                detail: `Token: ${t.accessToken.substring(0, 16)}...`,
                token: t,
                buttons: [{ iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete this token' }],
              });
            }

            items.push({
              label: '$(clear-all) Clear All Stored Tokens...',
              description: `Delete all ${tokens.length} token${tokens.length === 1 ? '' : 's'} for ${profileName}`,
              action: 'clearAll',
            });
          }

          picker.items = items;
        };

        await refreshPicker();

        picker.onDidTriggerItemButton(async (e) => {
          if (e.item.token) {
            const token = e.item.token;
            const label = token.envName || token.tokenName || 'token';
            const confirm = await vscode.window.showWarningMessage(
              `Delete stored token "${label}"?`,
              { modal: true },
              'Delete'
            );
            if (confirm === 'Delete') {
              await this.tokenService.deleteToken(profileId, token.id);
              this.treeProvider.refresh();
              await refreshPicker();
              vscode.window.showInformationMessage(`Token "${label}" deleted.`);
            }
          }
        });

        picker.onDidAccept(async () => {
          const selected = picker.selectedItems[0];
          if (!selected) return;

          if (selected.action === 'clearAll') {
            picker.hide();
            await vscode.commands.executeCommand('byrdsnestApiClient.clearProfileTokens', { id: profileId, name: profileName });
            return;
          }

          if (selected.token) {
            await vscode.env.clipboard.writeText(selected.token.accessToken);
            vscode.window.showInformationMessage(`Access token copied to clipboard.`);
            picker.hide();
          }
        });

        picker.onDidHide(() => picker.dispose());
        picker.show();
      })
    );

    // Delete Token directly
    s.push(
      this.regCmd('deleteToken', async (arg?: BlueByrdTreeItem | { profileId?: string; id?: string; name?: string }) => {
        let profileId: string | undefined;
        let tokenId: string | undefined;
        let tokenLabel: string | undefined;

        if (arg instanceof BlueByrdTreeItem) {
          profileId = arg.parentId;
          tokenId = arg.itemId;
          tokenLabel = arg.label;
        } else if (arg && typeof arg === 'object') {
          profileId = arg.profileId;
          tokenId = arg.id;
          tokenLabel = arg.name;
        }

        if (!profileId || !tokenId) return;

        const confirm = await vscode.window.showWarningMessage(
          `Delete stored OAuth token "${tokenLabel || 'token'}"?`,
          { modal: true },
          'Delete'
        );
        if (confirm === 'Delete') {
          await this.tokenService.deleteToken(profileId, tokenId);
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Token "${tokenLabel || 'token'}" deleted.`);
        }
      })
    );

    // Clear All Tokens for a Profile
    s.push(
      this.regCmd('clearProfileTokens', async (arg?: BlueByrdTreeItem | { id?: string; name?: string }) => {
        let profileId = (arg instanceof BlueByrdTreeItem ? arg.itemId : arg?.id) || this.stateManager.getActiveProfileId() || 'global';
        const profile = this.stateManager.getProfile(profileId);
        const profileName = profile ? profile.name : (profileId === 'global' ? 'Shared / Global' : profileId);

        const tokens = await this.tokenService.getTokens(profileId);
        if (tokens.length === 0) {
          vscode.window.showInformationMessage(`No stored OAuth tokens found for "${profileName}".`);
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Delete all ${tokens.length} stored OAuth token${tokens.length === 1 ? '' : 's'} for "${profileName}"? Requests using OAuth 2.0 under this profile will need to authenticate again.`,
          { modal: true },
          'Delete All'
        );
        if (confirm === 'Delete All') {
          await this.tokenService.clearTokens(profileId);
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`All tokens for "${profileName}" have been cleared.`);
        }
      })
    );

    // Copy Token to Clipboard
    s.push(
      this.regCmd('copyToken', async (arg?: BlueByrdTreeItem) => {
        if (!arg || !arg.itemId || !arg.parentId) return;
        const tokens = await this.tokenService.getTokens(arg.parentId);
        const token = tokens.find((t) => t.id === arg.itemId);
        if (token && token.accessToken) {
          await vscode.env.clipboard.writeText(token.accessToken);
          vscode.window.showInformationMessage(`Copied token to clipboard.`);
        }
      })
    );

    // Switch Active Environment
    s.push(
      this.regCmd('switchActiveEnvironment', async () => {
        const state = this.stateManager.getState();
        const activeEnvName = state.activeEnvironmentName;
        const envEntries = Object.entries(state.environments);

        if (envEntries.length === 0) {
          vscode.window.showWarningMessage('No environments available.');
          return;
        }

        // Lookup maps for inheritance resolution
        const envById = new Map<string, { name: string; env: typeof envEntries[0][1] }>();
        const envByName = new Map<string, { name: string; env: typeof envEntries[0][1] }>();
        for (const [name, env] of envEntries) {
          envByName.set(name, { name, env });
          if (env.id) envById.set(env.id, { name, env });
        }

        const childrenMap = new Map<string, Array<{ name: string; env: typeof envEntries[0][1] }>>();
        const rootEntries: Array<{ name: string; env: typeof envEntries[0][1] }> = [];

        for (const [name, env] of envEntries) {
          const parentRef = env.inheritsFrom;
          const parentEntry = parentRef ? (envById.get(parentRef) || envByName.get(parentRef)) : undefined;

          if (parentEntry && parentEntry.name !== name) {
            const key = parentEntry.env.id || parentEntry.name;
            if (!childrenMap.has(key)) {
              childrenMap.set(key, []);
            }
            childrenMap.get(key)!.push({ name, env });
          } else {
            rootEntries.push({ name, env });
          }
        }

        const items: Array<vscode.QuickPickItem & { envName?: string }> = [];
        const visitedNames = new Set<string>();

        const addItem = (name: string, env: typeof envEntries[0][1], depth: number, visited: Set<string>) => {
          const key = env.id || name;
          if (visited.has(key)) return;
          const nextVisited = new Set(visited).add(key);
          visitedNames.add(name);

          const rawChildren = childrenMap.get(key) || [];
          const validChildren = rawChildren.filter(c => !visited.has(c.env.id || c.name));
          const isParent = validChildren.length > 0;
          const isCurrent = activeEnvName === name || (env.id && activeEnvName === env.id);

          const parentEntry = env.inheritsFrom ? (envById.get(env.inheritsFrom) || envByName.get(env.inheritsFrom)) : undefined;
          const parentDisplayName = parentEntry ? parentEntry.name : env.inheritsFrom;

          const parts: string[] = [];
          if (isParent) parts.push(`Parent (${validChildren.length})`);
          if (parentDisplayName) parts.push(`inherits: ${parentDisplayName}`);
          if (env.baseUrl) parts.push(env.baseUrl);
          if (isCurrent) parts.push('Current Active');

          const prefix = depth > 0 ? '\u00A0\u00A0'.repeat(depth) + '↳ ' : '';
          const icon = isParent ? '$(server-process)' : (depth > 0 ? '$(arrow-subwards)' : '$(globe)');

          items.push({
            label: `${prefix}${icon} ${name}`,
            description: parts.join(' • '),
            envName: name,
          });

          for (const child of validChildren) {
            addItem(child.name, child.env, depth + 1, nextVisited);
          }
        };

        for (const root of rootEntries) {
          addItem(root.name, root.env, 0, new Set());
        }

        for (const [name, env] of envEntries) {
          if (!visitedNames.has(name)) {
            addItem(name, env, 0, new Set());
          }
        }

        items.unshift({
          label: '$(circle-slash) No Environment (Use Collection Defaults)',
          description: 'Clear active environment and rely on collection variables',
          envName: '',
        });

        items.push({
          label: '$(add) Create New Environment...',
          envName: '__create__',
        });

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select active environment',
        });

        if (!selected) return;

        if (selected.envName === '__create__') {
          vscode.commands.executeCommand('byrdsnestApiClient.createEnvironment');
          return;
        }

        if (selected.envName === '') {
          this.stateManager.setActiveEnvironmentName(undefined);
          BlueByrdPanel.broadcastActiveEnvironment('');
          this.treeProvider.refresh();
          vscode.window.showInformationMessage('Active environment cleared (using collection defaults).');
          return;
        }

        if (selected.envName) {
          this.stateManager.setActiveEnvironmentName(selected.envName);
          BlueByrdPanel.broadcastActiveEnvironment(selected.envName);
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Active environment set to: ${selected.envName}`);
        }
      })
    );

    // Clear Active Environment
    s.push(
      this.regCmd('clearActiveEnvironment', () => {
        this.stateManager.setActiveEnvironmentName(undefined);
        BlueByrdPanel.broadcastActiveEnvironment('');
        this.treeProvider.refresh();
        vscode.window.showInformationMessage('Active environment cleared (using collection defaults).');
      })
    );

    // Set Active Environment Directly (e.g. from context menu)
    s.push(
      this.regCmd('setActiveEnvironment', (arg?: BlueByrdTreeItem | { id?: string; name?: string } | string) => {
        let envName: string | undefined;

        if (arg instanceof BlueByrdTreeItem) {
          envName = arg.label;
        } else if (typeof arg === 'string') {
          envName = this.stateManager.getEnvironmentName(arg) || arg;
        } else if (arg && typeof arg === 'object') {
          envName = arg.name || (arg as any).label || this.stateManager.getEnvironmentName(arg.id);
        }

        if (envName) {
          const currentActive = this.stateManager.getState().activeEnvironmentName;
          if (currentActive === envName) {
            // Clicking already active environment toggles it off!
            this.stateManager.setActiveEnvironmentName(undefined);
            BlueByrdPanel.broadcastActiveEnvironment('');
            this.treeProvider.refresh();
            vscode.window.showInformationMessage('Active environment cleared (using collection defaults).');
            return;
          }
          this.stateManager.setActiveEnvironmentName(envName);
          BlueByrdPanel.broadcastActiveEnvironment(envName);
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Active environment set to: ${envName}`);
        }
      })
    );

    // Switch Context (Profile or Environment)
    s.push(
      this.regCmd('switchContext', async () => {
        const state = this.stateManager.getState();
        const activeProfile = state.activeProfileId && state.activeProfileId !== 'all'
          ? this.stateManager.getProfile(state.activeProfileId)
          : undefined;
        const profileLabel = activeProfile ? activeProfile.name : 'All Profiles (Global)';
        const envLabel = state.activeEnvironmentName || Object.keys(state.environments)[0] || 'None';

        const choice = await vscode.window.showQuickPick([
          {
            label: '$(account) Switch Active Profile Scope',
            description: `Current: ${profileLabel}`,
            action: 'profile',
          },
          {
            label: '$(globe) Switch Active Environment',
            description: `Current: ${envLabel}`,
            action: 'environment',
          },
          {
            label: '$(gear) Manage Profiles & Settings...',
            description: 'Open unified settings page',
            action: 'settings',
          },
        ], {
          placeHolder: 'Select context or action',
        });

        if (!choice) return;
        if (choice.action === 'profile') {
          vscode.commands.executeCommand('byrdsnestApiClient.switchActiveProfile');
        } else if (choice.action === 'environment') {
          vscode.commands.executeCommand('byrdsnestApiClient.switchActiveEnvironment');
        } else if (choice.action === 'settings') {
          vscode.commands.executeCommand('byrdsnestApiClient.openSettings');
        }
      })
    );

    // Assign Profile Scope to Environment or Collection
    s.push(
      this.regCmd('assignProfileScope', async (arg?: BlueByrdTreeItem) => {
        if (!arg || !arg.itemId) return;

        const state = this.stateManager.getState();
        const profiles = state.profiles;

        const picks: Array<vscode.QuickPickItem & { profileId?: string }> = [
          {
            label: '$(globe) Global / Shared (All Profiles)',
            profileId: undefined,
          },
        ];

        for (const p of profiles) {
          picks.push({
            label: `$(account) ${p.name}`,
            profileId: p.id,
          });
        }

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: `Assign profile scope for '${arg.label}'`,
        });

        if (selected === undefined) return;

        if (arg.kind === 'environment') {
          const env = this.stateManager.getEnvironment(arg.itemId) || this.stateManager.getEnvironment(arg.label);
          const envName = this.stateManager.getEnvironmentName(arg.itemId || arg.label) || arg.label;
          if (env) {
            env.profileId = selected.profileId;
            this.stateManager.saveEnvironment(envName, env);
            this.treeProvider.refresh();
            vscode.window.showInformationMessage(`Scope for environment '${envName}' updated.`);
          }
        } else if (arg.kind === 'collection') {
          const col = this.stateManager.getCollection(arg.itemId) || this.stateManager.getCollection(arg.label);
          if (col) {
            col.profileId = selected.profileId;
            this.stateManager.saveCollection(col);
            this.treeProvider.refresh();
            vscode.window.showInformationMessage(`Scope for collection '${col.name}' updated.`);
          }
        }
      })
    );

    // Create Profile
    s.push(
      this.regCmd('createProfile', async () => {
        const name = await vscode.window.showInputBox({
          prompt: 'Enter a name for the new profile',
          placeHolder: 'e.g. Staging Team',
        });
        if (name && name.trim()) {
          const colorPick = await vscode.window.showQuickPick(
            DEFAULT_PROFILE_COLORS.map(c => ({
              label: c.name,
              description: c.value,
              color: c.value
            })),
            { placeHolder: 'Select a color theme for this profile (optional, defaults to Ocean Blue)' }
          );
          const chosenColor = colorPick?.color || '#3b82f6';
          const newProfile = this.stateManager.createProfile(name.trim(), undefined, chosenColor);
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Profile '${newProfile.name}' created.`);
          BlueByrdSettingsPanel.createOrShow(
            this.context.extensionUri,
            'profile',
            newProfile.name,
            this.stateManager,
            undefined,
            newProfile.id,
            this.tokenService
          );
        }
      })
    );

    // Create Environment
    s.push(
      this.regCmd('createEnvironment', async (treeItem?: BlueByrdTreeItem) => {
        let profileId: string | undefined;
        if (treeItem?.kind === 'profile') {
          profileId = treeItem.itemId !== 'global' ? treeItem.itemId : undefined;
        } else if (treeItem?.parentId) {
          profileId = treeItem.parentId !== 'global' ? treeItem.parentId : undefined;
        } else {
          profileId = this.stateManager.getActiveProfileId();
        }

        const name = await vscode.window.showInputBox({
          prompt: 'Enter a name for the new environment',
          placeHolder: 'e.g. Staging or QA-West',
        });
        if (name && name.trim()) {
          const result = this.stateManager.createEnvironment(name.trim(), undefined, profileId);
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Environment '${result.name}' created.`);
          BlueByrdSettingsPanel.createOrShow(
            this.context.extensionUri,
            'environment',
            result.name,
            this.stateManager,
            undefined,
            result.env.id,
            this.tokenService
          );
        }
      })
    );

    // Create Child Environment
    s.push(
      this.regCmd('createChildEnvironment', async (treeItem?: BlueByrdTreeItem | { id?: string; name?: string }) => {
        let parentId: string | undefined;
        let parentName: string | undefined;

        if (treeItem instanceof BlueByrdTreeItem) {
          parentId = treeItem.itemId;
          parentName = treeItem.label;
        } else if (treeItem && typeof treeItem === 'object') {
          parentId = treeItem.id;
          parentName = treeItem.name;
        }

        const state = this.stateManager.getState();
        const parentEnv = parentId
          ? this.stateManager.getEnvironment(parentId)
          : (parentName ? this.stateManager.getEnvironment(parentName) : undefined);

        const name = await vscode.window.showInputBox({
          prompt: `Enter child environment name (inheriting from ${parentName || 'parent'})`,
          placeHolder: 'e.g. DC1 - Fulfillment',
          validateInput: (value) => {
            if (!value || !value.trim()) return 'Environment name cannot be empty.';
            if (state.environments[value.trim()]) return 'An environment with this name already exists.';
            return undefined;
          },
        });

        if (!name || !name.trim()) return;

        const created = this.stateManager.createEnvironment(
          name.trim(),
          '', // Leave empty so child dynamically inherits baseUrl from parent
          parentEnv?.profileId || this.stateManager.getActiveProfileId()
        );
        created.env.inheritsFrom = parentEnv?.id || parentId || parentName;
        this.stateManager.saveEnvironment(name.trim(), created.env);
        this.treeProvider.refresh();
        vscode.window.showInformationMessage(`Child environment '${name.trim()}' created under '${parentName}'.`);
        BlueByrdSettingsPanel.createOrShow(
          this.context.extensionUri,
          'environment',
          created.name,
          this.stateManager,
          undefined,
          created.env.id,
          this.tokenService
        );
      })
    );

    // Clone Environment
    s.push(
      this.regCmd('cloneEnvironment', async (treeItem?: BlueByrdTreeItem | { id?: string; name?: string } | string) => {
        let envIdOrName: string | undefined;

        if (treeItem instanceof BlueByrdTreeItem) {
          envIdOrName = treeItem.itemId || treeItem.label;
        } else if (typeof treeItem === 'string') {
          envIdOrName = treeItem;
        } else if (treeItem && typeof treeItem === 'object') {
          envIdOrName = (treeItem as any).id || (treeItem as any).name || (treeItem as any).label;
        }

        if (!envIdOrName) {
          const envs = this.stateManager.getEnvironments();
          const picks = Object.entries(envs).map(([name, env]) => ({
            label: name,
            description: env.baseUrl,
            envId: env.id,
          }));
          if (picks.length === 0) {
            vscode.window.showWarningMessage('No environments found to clone.');
            return;
          }
          const selected = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select an environment to clone',
          });
          if (!selected) return;
          envIdOrName = selected.envId;
        }

        const sourceEnv = this.stateManager.getEnvironment(envIdOrName);
        const sourceName = this.stateManager.getEnvironmentName(envIdOrName) || envIdOrName;
        if (!sourceEnv) {
          vscode.window.showErrorMessage(`Environment '${envIdOrName}' not found.`);
          return;
        }

        const defaultNewName = `${sourceName} (Copy)`;
        const newName = await vscode.window.showInputBox({
          prompt: 'Enter name for cloned environment',
          value: defaultNewName,
          validateInput: (val) => {
            if (!val || !val.trim()) return 'Environment name cannot be empty.';
            if (this.stateManager.getEnvironment(val.trim())) return 'An environment with this name already exists.';
            return undefined;
          },
        });

        if (!newName || !newName.trim()) return;

        const cloned = this.stateManager.cloneEnvironment(envIdOrName, newName.trim());
        if (cloned) {
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Cloned environment '${sourceName}' as '${cloned.name}'.`);
        }
      })
    );

    // Create Collection
    s.push(
      this.regCmd('createCollection', async (treeItem?: BlueByrdTreeItem) => {
        let profileId: string | undefined;
        if (treeItem?.kind === 'profile') {
          profileId = treeItem.itemId !== 'global' ? treeItem.itemId : undefined;
        } else if (treeItem?.parentId) {
          profileId = treeItem.parentId !== 'global' ? treeItem.parentId : undefined;
        } else {
          profileId = this.stateManager.getActiveProfileId();
        }

        const name = await vscode.window.showInputBox({
          prompt: 'Enter a name for the new collection',
          placeHolder: 'e.g. Payments API',
        });
        if (name && name.trim()) {
          this.stateManager.createCollection(name.trim(), profileId);
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Collection '${name.trim()}' created.`);
        }
      })
    );

    // Create Folder
    s.push(
      this.regCmd('createFolder', async (treeItem?: BlueByrdTreeItem) => {
        const state = this.stateManager.getState();
        let targetCollectionId = treeItem?.kind === 'collection' ? treeItem.itemId : undefined;

        if (!targetCollectionId) {
          const picks = state.collections.map((c) => ({ label: c.name, id: c.id }));
          if (picks.length === 0) {
            vscode.window.showWarningMessage('Please create a collection first.');
            return;
          }
          const selected = await vscode.window.showQuickPick(picks, { placeHolder: 'Select a collection for the folder' });
          if (!selected) return;
          targetCollectionId = selected.id;
        }

        const folderName = await vscode.window.showInputBox({
          prompt: 'Enter folder name',
          placeHolder: 'e.g. Authentication',
        });

        if (folderName && folderName.trim()) {
          this.stateManager.createFolder(targetCollectionId, folderName.trim());
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Folder '${folderName.trim()}' created.`);
        }
      })
    );

    // Clone / Duplicate Request
    const cloneRequestHandler = async (treeItem?: BlueByrdTreeItem | { id?: string; itemId?: string; name?: string } | string) => {
      let reqId: string | undefined;

      if (treeItem instanceof BlueByrdTreeItem) {
        reqId = treeItem.itemId;
      } else if (typeof treeItem === 'string') {
        reqId = treeItem;
      } else if (treeItem && typeof treeItem === 'object') {
        reqId = (treeItem as any).itemId || (treeItem as any).id;
      }

      if (!reqId) {
        const state = this.stateManager.getState();
        const picks: Array<vscode.QuickPickItem & { reqId: string }> = [];
        for (const col of state.collections) {
          for (const req of col.requests) {
            picks.push({
              label: req.name,
              description: `${req.method} ${req.url} (${col.name})`,
              reqId: req.id,
            });
          }
          for (const folder of col.folders) {
            for (const req of folder.requests) {
              picks.push({
                label: req.name,
                description: `${req.method} ${req.url} (${col.name} / ${folder.name})`,
                reqId: req.id,
              });
            }
          }
        }
        if (picks.length === 0) {
          vscode.window.showWarningMessage('No requests found to clone.');
          return;
        }
        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: 'Select a request to clone',
        });
        if (!selected) return;
        reqId = selected.reqId;
      }

      const found = this.stateManager.getRequest(reqId);
      if (!found) {
        vscode.window.showErrorMessage(`Request not found.`);
        return;
      }

      const defaultName = `${found.request.name} (Copy)`;
      const newName = await vscode.window.showInputBox({
        prompt: 'Enter name for cloned request',
        value: defaultName,
        validateInput: (val) => {
          if (!val || !val.trim()) return 'Request name cannot be empty.';
          return undefined;
        },
      });

      if (!newName || !newName.trim()) return;

      const cloned = this.stateManager.cloneRequest(reqId, newName.trim());
      if (cloned) {
        this.treeProvider.refresh();
        vscode.window.showInformationMessage(`Cloned request '${found.request.name}' as '${cloned.name}'.`);
      }
    };

    s.push(
      this.regCmd('cloneRequest', cloneRequestHandler),
      this.regCmd('duplicateRequest', cloneRequestHandler)
    );

    // Rename Request
    s.push(
      this.regCmd('renameRequest', async (arg?: BlueByrdTreeItem | { id?: string; requestId?: string; name?: string }) => {
        let requestId: string | undefined;
        let currentName: string = '';

        if (arg instanceof BlueByrdTreeItem) {
          requestId = arg.itemId;
          currentName = typeof arg.label === 'string' ? arg.label : '';
        } else if (arg && typeof arg === 'object') {
          requestId = arg.requestId || arg.id;
          currentName = arg.name || '';
        }

        if (!requestId) return;

        const found = this.stateManager.getRequest(requestId);
        if (!found) {
          vscode.window.showErrorMessage('Request not found.');
          return;
        }

        currentName = currentName || found.request.name;

        const newName = await vscode.window.showInputBox({
          prompt: 'Enter new name for the request',
          value: currentName,
          validateInput: (v) => (!v.trim() ? 'Request name cannot be empty.' : null),
        });

        if (!newName || newName.trim() === currentName) return;

        const renamed = this.stateManager.renameRequest(requestId, newName.trim());
        if (renamed) {
          this.treeProvider.refresh();
          BlueByrdPanel.notifyRequestRenamed(requestId, renamed.name);
          vscode.window.showInformationMessage(`Request renamed to '${renamed.name}'.`);
        }
      })
    );

    // Move Item Up (Reordering Collections, Folders, and Requests)
    s.push(
      this.regCmd('moveItemUp', (treeItem?: BlueByrdTreeItem) => {
        if (!treeItem || !treeItem.itemId) return;
        const moved = this.stateManager.moveItemUp(treeItem.kind, treeItem.itemId, treeItem.parentId);
        if (moved) {
          this.treeProvider.refresh();
        }
      })
    );

    // Move Item Down (Reordering Collections, Folders, and Requests)
    s.push(
      this.regCmd('moveItemDown', (treeItem?: BlueByrdTreeItem) => {
        if (!treeItem || !treeItem.itemId) return;
        const moved = this.stateManager.moveItemDown(treeItem.kind, treeItem.itemId, treeItem.parentId);
        if (moved) {
          this.treeProvider.refresh();
        }
      })
    );

    // Move Request To (QuickPick selector for moving requests across folders and collections)
    s.push(
      this.regCmd('moveRequestTo', async (treeItem?: BlueByrdTreeItem) => {
        const reqId = treeItem?.itemId;
        if (!reqId) return;

        const state = this.stateManager.getState();
        const current = this.stateManager.getRequest(reqId);
        if (!current) return;

        const picks: Array<vscode.QuickPickItem & { collectionId: string; folderId?: string }> = [];

        for (const col of state.collections) {
          picks.push({
            label: `$(repo) ${col.name} (Root)`,
            description: `Move directly under ${col.name}`,
            collectionId: col.id,
            folderId: undefined,
          });
          for (const folder of col.folders) {
            picks.push({
              label: `$(folder) ${col.name} / ${folder.name}`,
              description: `Move into folder '${folder.name}'`,
              collectionId: col.id,
              folderId: folder.id,
            });
          }
        }

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: `Move '${current.request.name}' to collection or folder`,
        });

        if (!selected) return;

        const moved = this.stateManager.moveRequest(reqId, selected.collectionId, selected.folderId);
        if (moved) {
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(
            `Moved '${current.request.name}' to ${selected.label.replace(/^\$\([^)]+\)\s*/, '')}.`
          );
        }
      })
    );

    // Move Folder To (QuickPick selector for moving folders across collections)
    s.push(
      this.regCmd('moveFolderTo', async (treeItem?: BlueByrdTreeItem) => {
        const folderId = treeItem?.itemId;
        if (!folderId) return;

        const state = this.stateManager.getState();
        const picks = state.collections.map((c) => ({
          label: `$(repo) ${c.name}`,
          description: `Move folder '${treeItem.label}' into ${c.name}`,
          collectionId: c.id,
        }));

        if (picks.length === 0) return;

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: `Move folder '${treeItem.label}' to collection`,
        });

        if (!selected) return;

        const moved = this.stateManager.moveFolderToCollection(folderId, selected.collectionId);
        if (moved) {
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(
            `Moved folder '${treeItem.label}' to ${selected.label.replace(/^\$\([^)]+\)\s*/, '')}.`
          );
        }
      })
    );

    // Delete Item
    s.push(
      this.regCmd('deleteItem', async (treeItem?: BlueByrdTreeItem) => {
        if (!treeItem || !treeItem.itemId) return;

        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete '${treeItem.label}'?`,
          { modal: true },
          'Delete'
        );

        if (confirm === 'Delete') {
          this.stateManager.deleteItem(treeItem.kind, treeItem.itemId, treeItem.parentId);
          if (treeItem.kind === 'history') {
            BlueByrdHistoryPanel.notifyItemDeleted(treeItem.itemId);
          }
          this.treeProvider.refresh();
          vscode.window.showInformationMessage(`Deleted '${treeItem.label}'.`);
        }
      })
    );

    // Edit Settings Commands
    s.push(
      this.regCmd('editProfile', (arg?: BlueByrdTreeItem | { id?: string; name?: string } | string) => {
        let profileId: string | undefined;
        let profileName: string | undefined;

        if (arg instanceof BlueByrdTreeItem) {
          profileId = arg.itemId;
          profileName = arg.label;
        } else if (typeof arg === 'string') {
          profileId = arg;
        } else if (arg && typeof arg === 'object') {
          profileId = (arg as any).itemId || arg.id;
          profileName = arg.name || (arg as any).label;
        }

        const profile = this.stateManager.getProfile(profileId) || this.stateManager.getProfile(profileName) || this.stateManager.getState().profiles[0];
        if (profile) {
          BlueByrdSettingsPanel.createOrShow(
            this.context.extensionUri,
            'profile',
            profile.name,
            this.stateManager,
            undefined,
            profile.id,
            this.tokenService
          );
        }
      })
    );

    s.push(
      this.regCmd('editEnvironment', (arg?: BlueByrdTreeItem | { id?: string; name?: string } | string) => {
        let envId: string | undefined;
        let envName: string | undefined;

        if (arg instanceof BlueByrdTreeItem) {
          envId = arg.itemId;
          envName = arg.label;
        } else if (typeof arg === 'string') {
          envId = arg;
        } else if (arg && typeof arg === 'object') {
          envId = (arg as any).itemId || arg.id;
          envName = arg.name || (arg as any).label;
        }

        const env = this.stateManager.getEnvironment(envId) || this.stateManager.getEnvironment(envName);
        const resolvedName = this.stateManager.getEnvironmentName(envId || envName) || envName || 'Local';
        if (env) {
          BlueByrdSettingsPanel.createOrShow(
            this.context.extensionUri,
            'environment',
            resolvedName,
            this.stateManager,
            undefined,
            env.id,
            this.tokenService
          );
        }
      })
    );

    s.push(
      this.regCmd('editCollection', (arg?: BlueByrdTreeItem | { id?: string; name?: string } | string) => {
        let colId: string | undefined;
        let colName: string | undefined;

        if (arg instanceof BlueByrdTreeItem) {
          colId = arg.itemId;
          colName = arg.label;
        } else if (typeof arg === 'string') {
          colId = arg;
        } else if (arg && typeof arg === 'object') {
          colId = (arg as any).itemId || arg.id;
          colName = arg.name || (arg as any).label;
        }

        const col = this.stateManager.getCollection(colId) || this.stateManager.getCollection(colName);
        if (col) {
          BlueByrdSettingsPanel.createOrShow(
            this.context.extensionUri,
            'collection',
            col.name,
            this.stateManager,
            undefined,
            col.id,
            this.tokenService
          );
        }
      })
    );

    s.push(
      this.regCmd('editFolder', (arg?: BlueByrdTreeItem | { collection?: string; folder?: string; collectionId?: string; folderId?: string }) => {
        let folderId: string | undefined;
        let folderName: string | undefined;
        let colIdOrName: string | undefined;

        if (arg instanceof BlueByrdTreeItem) {
          folderId = arg.itemId;
          folderName = arg.label;
          colIdOrName = arg.parentId;
        } else if (arg && typeof arg === 'object') {
          folderId = arg.folderId;
          folderName = arg.folder;
          colIdOrName = arg.collectionId || arg.collection;
        }

        const col = this.stateManager.getCollection(colIdOrName);
        const colName = col?.name || (typeof colIdOrName === 'string' ? colIdOrName : undefined);
        BlueByrdSettingsPanel.createOrShow(
          this.context.extensionUri,
          'folder',
          folderName || 'Folder',
          this.stateManager,
          colName,
          folderId,
          this.tokenService
        );
      })
    );

    // Import JSON (Postman, OpenAPI, bluebyrd Collection/Environment/Backup)
    s.push(
      this.regCmd('importJson', async () => {
        try {
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Import JSON',
            filters: {
              'API & Collection JSON': ['json'],
            },
          });

          if (!uris || uris.length === 0) return;

          const filePath = uris[0].fsPath;
          const content = await fs.promises.readFile(filePath, 'utf8');
          const result = ImportExportService.parse(content);

          if (
            result.type === 'postman-collection' ||
            result.type === 'openapi' ||
            result.type === 'bluebyrd-collection' ||
            result.type === 'byrdsnest-collection'
          ) {
            await this.handleCollectionImport(filePath, result.collection);
          } else if (
            result.type === 'postman-environment' ||
            result.type === 'bluebyrd-environment' ||
            result.type === 'byrdsnest-environment'
          ) {
            await this.handleEnvironmentImport(filePath, result.environmentName, result.environment);
          } else if (result.type === 'bluebyrd-backup' || result.type === 'byrdsnest-backup') {
            await this.handleBackupImport(filePath, result.state);
          } else {
            vscode.window.showWarningMessage(`Unrecognized import format for '${path.basename(filePath)}'.`);
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Import failed: ${err?.message || 'Unknown error'}`);
        }
      })
    );

    // Import from cURL Command
    s.push(
      this.regCmd('importCurl', async () => {
        const rawCurl = await vscode.window.showInputBox({
          prompt: 'Paste a cURL command to import into a new request panel',
          placeHolder: 'curl -X POST https://api.example.com/v1/resource -H "Content-Type: application/json" -d \'{"key":"value"}\'',
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return 'Please enter a cURL command.';
            }
            if (!value.trim().toLowerCase().startsWith('curl')) {
              return 'Command must start with "curl".';
            }
            return null;
          },
        });

        if (!rawCurl || !rawCurl.trim()) return;

        try {
          const parsed = ImportExportService.parseCurl(rawCurl.trim());
          const state = this.stateManager.getState();
          const activeProfile = state.activeProfileId && state.activeProfileId !== 'all'
            ? this.stateManager.getProfile(state.activeProfileId)
            : state.profiles[0];
          const activeEnv = state.activeEnvironmentName || Object.keys(state.environments)[0] || 'Local';

          // Derive request name from URL pathname if available
          let requestName = `${parsed.method} Request`;
          try {
            if (parsed.url.startsWith('http://') || parsed.url.startsWith('https://')) {
              const u = new URL(parsed.url);
              const pathEnd = u.pathname.split('/').filter(Boolean).pop();
              if (pathEnd) {
                requestName = `${parsed.method} ${pathEnd}`;
              }
            }
          } catch {
            // fallback name
          }

          BlueByrdPanel.createOrShow(
            this.context.extensionUri,
            {
              profile: activeProfile?.name || 'Default',
              profileId: activeProfile?.id,
              environment: activeEnv,
              collection: state.collections[0]?.name || 'Demo Collection',
              requestName,
              method: parsed.method,
              url: parsed.url,
              headers: parsed.headers,
              body: parsed.body,
              bodyType: parsed.bodyType,
            },
            this.stateManager,
            this.httpService,
            this.variableService,
            this.authService,
            this.tokenService
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to import cURL: ${err?.message || 'Unknown error'}`);
        }
      })
    );

    // Export Collection as JSON
    s.push(
      this.regCmd('exportCollection', async (arg?: BlueByrdTreeItem | { id?: string; name?: string }) => {
        try {
          const state = this.stateManager.getState();
          let targetCollectionId: string | undefined;

          if (arg instanceof BlueByrdTreeItem) {
            targetCollectionId = arg.itemId;
          } else if (arg && typeof arg === 'object') {
            targetCollectionId = arg.id || arg.name;
          }

          let col = this.stateManager.getCollection(targetCollectionId);
          if (!col) {
            const picks = state.collections.map((c) => ({ label: c.name, id: c.id }));
            if (picks.length === 0) {
              vscode.window.showWarningMessage('No collections available to export.');
              return;
            }
            const selected = await vscode.window.showQuickPick(picks, { placeHolder: 'Select a collection to export' });
            if (!selected) return;
            col = this.stateManager.getCollection(selected.id);
          }

          if (!col) return;

          const exportJson = ImportExportService.exportCollection(col);
          const slug = col.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'collection';
          const defaultUri = vscode.Uri.file(`${slug}.byrdsnest-collection.json`);

          const targetUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'JSON Files': ['json'] },
            saveLabel: 'Export Collection',
          });

          if (!targetUri) return;

          await fs.promises.writeFile(targetUri.fsPath, exportJson, 'utf8');
          vscode.window.showInformationMessage(`Collection '${col.name}' exported to ${path.basename(targetUri.fsPath)}.`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Export collection failed: ${err?.message || 'Unknown error'}`);
        }
      })
    );

    // Export Environment as JSON
    s.push(
      this.regCmd('exportEnvironment', async (arg?: BlueByrdTreeItem | { id?: string; name?: string }) => {
        try {
          const state = this.stateManager.getState();
          let targetEnvName: string | undefined;

          if (arg instanceof BlueByrdTreeItem) {
            targetEnvName = arg.label;
          } else if (arg && typeof arg === 'object') {
            targetEnvName = arg.name || arg.id;
          }

          let env = this.stateManager.getEnvironment(targetEnvName);
          let envName = this.stateManager.getEnvironmentName(targetEnvName) || targetEnvName;

          if (!env || !envName) {
            const picks = Object.keys(state.environments).map((name) => ({ label: name }));
            if (picks.length === 0) {
              vscode.window.showWarningMessage('No environments available to export.');
              return;
            }
            const selected = await vscode.window.showQuickPick(picks, { placeHolder: 'Select an environment to export' });
            if (!selected) return;
            envName = selected.label;
            env = this.stateManager.getEnvironment(envName);
          }

          if (!env || !envName) return;

          const exportJson = ImportExportService.exportEnvironment(envName, env);
          const slug = envName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'environment';
          const defaultUri = vscode.Uri.file(`${slug}.byrdsnest-environment.json`);

          const targetUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'JSON Files': ['json'] },
            saveLabel: 'Export Environment',
          });

          if (!targetUri) return;

          await fs.promises.writeFile(targetUri.fsPath, exportJson, 'utf8');
          vscode.window.showInformationMessage(`Environment '${envName}' exported to ${path.basename(targetUri.fsPath)}.`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Export environment failed: ${err?.message || 'Unknown error'}`);
        }
      })
    );

    // Export Full Workspace Backup as JSON
    s.push(
      this.regCmd('exportBackup', async () => {
        try {
          const state = this.stateManager.getState();
          const exportJson = ImportExportService.exportBackup(state);
          const dateStr = new Date().toISOString().slice(0, 10);
          const defaultUri = vscode.Uri.file(`byrdsnest-backup-${dateStr}.json`);

          const targetUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'JSON Files': ['json'] },
            saveLabel: 'Export Workspace Backup',
          });

          if (!targetUri) return;

          await fs.promises.writeFile(targetUri.fsPath, exportJson, 'utf8');
          vscode.window.showInformationMessage(`Workspace backup exported to ${path.basename(targetUri.fsPath)}.`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Export backup failed: ${err?.message || 'Unknown error'}`);
        }
      })
    );

    // Check for Updates
    s.push(
      this.regCmd('checkForUpdates', async () => {
        await this.updateService.checkForUpdates(true);
      })
    );
  }

  private async handleCollectionImport(filePath: string, collection: Collection): Promise<void> {
    const fileName = path.basename(filePath);
    const directReqs = collection.requests ? collection.requests.length : 0;
    const folderReqs = (collection.folders || []).reduce((acc, f) => acc + (f.requests ? f.requests.length : 0), 0);
    const totalReqs = directReqs + folderReqs;
    const folderCount = collection.folders ? collection.folders.length : 0;

    let collectionToSave = collection;

    if (folderCount > 0 || totalReqs > 1) {
      const scanSummary = `Scanned '${fileName}': Found collection '${collection.name}' (${totalReqs} request${totalReqs === 1 ? '' : 's'}, ${folderCount} folder${folderCount === 1 ? '' : 's'}).`;

      const choice = await vscode.window.showInformationMessage(
        scanSummary,
        { modal: true },
        'Import Entire Collection',
        'Choose Folders & Requests...'
      );
      if (!choice) return;

      if (choice === 'Choose Folders & Requests...') {
        type ScannedColPickItem = vscode.QuickPickItem & {
          itemType: 'folder' | 'request';
          id: string;
        };

        const items: (ScannedColPickItem | vscode.QuickPickItem)[] = [];

        if (collection.folders && collection.folders.length > 0) {
          items.push({
            label: 'Folders',
            kind: vscode.QuickPickItemKind.Separator,
          });
          for (const f of collection.folders) {
            items.push({
              label: `$(folder) ${f.name}`,
              description: `${f.requests ? f.requests.length : 0} request${(f.requests ? f.requests.length : 0) === 1 ? '' : 's'}`,
              picked: true,
              itemType: 'folder',
              id: f.id,
            });
          }
        }

        if (collection.requests && collection.requests.length > 0) {
          items.push({
            label: 'Direct Requests',
            kind: vscode.QuickPickItemKind.Separator,
          });
          for (const r of collection.requests) {
            items.push({
              label: `$(symbol-method) ${r.name || 'Untitled Request'}`,
              description: `[${r.method || 'GET'}] ${r.url || ''}`,
              picked: true,
              itemType: 'request',
              id: r.id,
            });
          }
        }

        const selected = await vscode.window.showQuickPick(items, {
          canPickMany: true,
          title: `Selective Import: ${collection.name}`,
          placeHolder: "Select folders and requests to import (Press 'Enter' to confirm)",
          ignoreFocusOut: true,
        });

        if (!selected || selected.length === 0) {
          vscode.window.showInformationMessage('Import cancelled: No items selected.');
          return;
        }

        const validPicks = selected as ScannedColPickItem[];
        const chosenFolderIds = new Set(validPicks.filter(i => i.itemType === 'folder').map(i => i.id));
        const chosenRequestIds = new Set(validPicks.filter(i => i.itemType === 'request').map(i => i.id));

        collectionToSave = {
          ...collection,
          folders: (collection.folders || []).filter(f => chosenFolderIds.has(f.id)),
          requests: (collection.requests || []).filter(r => chosenRequestIds.has(r.id)),
        };
      }
    }

    const currentState = this.stateManager.getState();
    if (currentState.collections.some(cc => cc.id === collectionToSave.id)) {
      collectionToSave.id = `col-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    }

    this.stateManager.saveCollection(collectionToSave);
    this.treeProvider.refresh();
    const finalDirect = collectionToSave.requests ? collectionToSave.requests.length : 0;
    const finalFolderReqs = (collectionToSave.folders || []).reduce((acc, f) => acc + (f.requests ? f.requests.length : 0), 0);
    const finalTotal = finalDirect + finalFolderReqs;
    vscode.window.showInformationMessage(
      `Imported collection '${collectionToSave.name}' (${finalTotal} request${finalTotal === 1 ? '' : 's'}, ${(collectionToSave.folders || []).length} folder${(collectionToSave.folders || []).length === 1 ? '' : 's'}).`
    );
  }

  private async handleEnvironmentImport(filePath: string, environmentName: string, environment: EnvironmentConfig): Promise<void> {
    const fileName = path.basename(filePath);
    const varCount = Object.keys(environment.variables || {}).length;
    const exists = !!this.stateManager.getEnvironment(environmentName);

    let envToSave = environment;

    if (varCount > 1) {
      const scanSummary = `Scanned '${fileName}': Found environment '${environmentName}' with ${varCount} variable${varCount === 1 ? '' : 's'}.${exists ? ' (Environment already exists in workspace)' : ''}`;

      const choice = await vscode.window.showInformationMessage(
        scanSummary,
        { modal: true },
        exists ? 'Overwrite Existing' : 'Import All Variables',
        'Choose Variables to Import...'
      );
      if (!choice) return;

      if (choice === 'Choose Variables to Import...') {
        type ScannedVarPickItem = vscode.QuickPickItem & {
          varKey: string;
          varVal: string;
        };

        const items: ScannedVarPickItem[] = Object.entries(environment.variables || {}).map(([k, v]) => ({
          label: `$(variable) ${k}`,
          description: String(v),
          picked: true,
          varKey: k,
          varVal: String(v),
        }));

        const selected = await vscode.window.showQuickPick(items, {
          canPickMany: true,
          title: `Selective Import: ${environmentName} Variables`,
          placeHolder: "Select variables to import (Press 'Enter' to confirm)",
          ignoreFocusOut: true,
        });

        if (!selected || selected.length === 0) {
          vscode.window.showInformationMessage('Import cancelled: No variables selected.');
          return;
        }

        const filteredVars: Record<string, string> = {};
        for (const item of selected) {
          filteredVars[item.varKey] = item.varVal;
        }

        envToSave = {
          ...environment,
          variables: filteredVars,
        };
      }
    }

    this.stateManager.saveEnvironment(environmentName, envToSave);
    this.treeProvider.refresh();
    const finalVarCount = Object.keys(envToSave.variables || {}).length;
    vscode.window.showInformationMessage(
      `Imported environment '${environmentName}' (${finalVarCount} variable${finalVarCount === 1 ? '' : 's'}).`
    );
  }

  private async handleBackupImport(filePath: string, rawBackupState: AppState): Promise<void> {
    const backupState = this.stateManager.normalizeState(rawBackupState);
    const fileName = path.basename(filePath);
    const numCollections = backupState.collections.length;
    const totalBackupReqs = backupState.collections.reduce(
      (acc, c) => acc + c.requests.length + c.folders.reduce((facc, f) => facc + f.requests.length, 0),
      0
    );
    const numEnvironments = Object.keys(backupState.environments || {}).length;
    const numProfiles = backupState.profiles ? backupState.profiles.length : 0;

    const scanSummary = `Scanned '${fileName}': Found ${numCollections} collection${numCollections === 1 ? '' : 's'} (${totalBackupReqs} request${totalBackupReqs === 1 ? '' : 's'}), ${numEnvironments} environment${numEnvironments === 1 ? '' : 's'}, and ${numProfiles} profile${numProfiles === 1 ? '' : 's'}.`;

    const choice = await vscode.window.showInformationMessage(
      scanSummary,
      { modal: true },
      'Choose What to Import...',
      'Import All (Merge)',
      'Replace Entire Workspace'
    );
    if (!choice) return;

    if (choice === 'Replace Entire Workspace') {
      this.stateManager.save(this.stateManager.normalizeState(backupState));
      this.treeProvider.refresh();
      vscode.window.showInformationMessage(
        `Workspace replaced from backup: ${numCollections} collections (${totalBackupReqs} requests), ${numEnvironments} environments, ${numProfiles} profile(s).`
      );
      return;
    }

    if (choice === 'Import All (Merge)') {
      const currentState = this.stateManager.getState();
      for (const p of backupState.profiles || []) {
        if (!currentState.profiles.some((cp) => cp.id === p.id || cp.name === p.name)) {
          currentState.profiles.push(p);
        }
      }
      for (const [k, e] of Object.entries(backupState.environments || {})) {
        currentState.environments[k] = e;
      }
      for (const col of backupState.collections || []) {
        if (!currentState.collections.some((cc) => cc.id === col.id)) {
          currentState.collections.push(col);
        } else {
          col.id = `col-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          currentState.collections.push(col);
        }
      }
      if (Array.isArray(backupState.history) && backupState.history.length > 0) {
        for (const h of backupState.history) {
          if (!currentState.history.some((ch) => ch.id === h.id)) {
            currentState.history.push(h);
          }
        }
      }
      this.stateManager.save(this.stateManager.normalizeState(currentState));
      this.treeProvider.refresh();
      vscode.window.showInformationMessage(
        `Workspace merged with backup: imported ${numCollections} collections (${totalBackupReqs} requests), ${numEnvironments} environments.`
      );
      return;
    }

    if (choice === 'Choose What to Import...') {
      type ScannedBackupPickItem = vscode.QuickPickItem & {
        category: 'collection' | 'environment' | 'profile';
        itemData: any;
      };

      const items: (ScannedBackupPickItem | vscode.QuickPickItem)[] = [];
      const currentState = this.stateManager.getState();

      if (backupState.collections && backupState.collections.length > 0) {
        items.push({
          label: 'Collections',
          kind: vscode.QuickPickItemKind.Separator,
        });
        for (const col of backupState.collections) {
          const reqCount = col.requests.length + col.folders.reduce((acc, f) => acc + f.requests.length, 0);
          const exists = currentState.collections.some(c => c.name === col.name || c.id === col.id);
          items.push({
            label: `$(folder) ${col.name}`,
            description: `${reqCount} request${reqCount === 1 ? '' : 's'}, ${col.folders.length} folder${col.folders.length === 1 ? '' : 's'}${exists ? ' (exists in workspace)' : ''}`,
            picked: true,
            category: 'collection',
            itemData: col,
          });
        }
      }

      const envEntries = Object.entries(backupState.environments || {});
      if (envEntries.length > 0) {
        items.push({
          label: 'Environments',
          kind: vscode.QuickPickItemKind.Separator,
        });
        for (const [envName, env] of envEntries) {
          const varCount = Object.keys(env.variables || {}).length;
          const exists = !!currentState.environments[envName];
          items.push({
            label: `$(server) ${envName}`,
            description: `${varCount} variable${varCount === 1 ? '' : 's'}${exists ? ' (exists in workspace - will update)' : ''}`,
            detail: env.baseUrl ? `Base URL: ${env.baseUrl}` : undefined,
            picked: true,
            category: 'environment',
            itemData: { name: envName, env },
          });
        }
      }

      if (backupState.profiles && backupState.profiles.length > 0) {
        items.push({
          label: 'Profiles',
          kind: vscode.QuickPickItemKind.Separator,
        });
        for (const prof of backupState.profiles) {
          const varCount = Object.keys(prof.variables || {}).length;
          const exists = currentState.profiles.some(p => p.name === prof.name || p.id === prof.id);
          items.push({
            label: `$(person) ${prof.name}`,
            description: `Auth: ${prof.auth?.type || 'none'}, ${varCount} variable${varCount === 1 ? '' : 's'}${exists ? ' (exists in workspace)' : ''}`,
            picked: true,
            category: 'profile',
            itemData: prof,
          });
        }
      }

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: `Selective Import: ${fileName}`,
        placeHolder: "Select items to import (Press 'Enter' to confirm)",
        ignoreFocusOut: true,
      });

      if (!selected || selected.length === 0) {
        vscode.window.showInformationMessage('Import cancelled: No items selected.');
        return;
      }

      const selectedPicks = selected as ScannedBackupPickItem[];
      const selectedCollections = selectedPicks.filter(i => i.category === 'collection').map(i => i.itemData as Collection);
      const selectedEnvironments = selectedPicks.filter(i => i.category === 'environment').map(i => i.itemData as { name: string; env: EnvironmentConfig });
      const selectedProfiles = selectedPicks.filter(i => i.category === 'profile').map(i => i.itemData as Profile);

      for (const p of selectedProfiles) {
        if (!currentState.profiles.some((cp) => cp.id === p.id || cp.name === p.name)) {
          currentState.profiles.push(p);
        }
      }
      for (const { name, env } of selectedEnvironments) {
        currentState.environments[name] = env;
      }
      for (const col of selectedCollections) {
        if (!currentState.collections.some((cc) => cc.id === col.id)) {
          currentState.collections.push(col);
        } else {
          col.id = `col-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          currentState.collections.push(col);
        }
      }

      this.stateManager.save(this.stateManager.normalizeState(currentState));
      this.treeProvider.refresh();

      const parts: string[] = [];
      if (selectedCollections.length > 0) parts.push(`${selectedCollections.length} collection${selectedCollections.length === 1 ? '' : 's'}`);
      if (selectedEnvironments.length > 0) parts.push(`${selectedEnvironments.length} environment${selectedEnvironments.length === 1 ? '' : 's'}`);
      if (selectedProfiles.length > 0) parts.push(`${selectedProfiles.length} profile${selectedProfiles.length === 1 ? '' : 's'}`);

      vscode.window.showInformationMessage(`Imported ${parts.join(', ')} from '${fileName}'.`);
    }
  }
}

