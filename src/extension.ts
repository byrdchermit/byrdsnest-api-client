import * as vscode from 'vscode';
import { BlueByrdStateManager } from './state/stateManager';
import { VariableService } from './services/variableService';
import { AuthService } from './services/authService';
import { TokenService } from './services/tokenService';
import { HttpService } from './services/httpService';
import { UpdateService } from './services/updateService';
import {
  BlueByrdProfilesTreeProvider,
  BlueByrdCollectionsTreeProvider,
  BlueByrdEnvironmentsTreeProvider,
  BlueByrdToolsTreeProvider,
  BlueByrdTreeCoordinator,
} from './views/tree';
import { CommandManager } from './commands/commandManager';

export function activate(context: vscode.ExtensionContext): void {
  try {
    console.log('[byrdsnest api client] Activating byrdsnest api client...');

    // 1. Initialize core state and services
    const stateManager = new BlueByrdStateManager(context);
    const tokenService = new TokenService(context.secrets);
    const variableService = new VariableService(stateManager);
    const authService = new AuthService(stateManager, tokenService);
    const httpService = new HttpService(stateManager, variableService, authService);
    const updateService = new UpdateService(context);

    // 2. Initialize Dedicated Breakout Tree Providers
    const profilesProvider = new BlueByrdProfilesTreeProvider(stateManager, tokenService);
    const collectionsProvider = new BlueByrdCollectionsTreeProvider(stateManager);
    const environmentsProvider = new BlueByrdEnvironmentsTreeProvider(stateManager);
    const toolsProvider = new BlueByrdToolsTreeProvider(stateManager, tokenService, updateService);

    // Dynamic Status Bar Item (Context & Scope Indicator)
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    let collectionsView: vscode.TreeView<any> | undefined;

    const updateStatusBar = () => {
      const state = stateManager.getState();
      const activeProfile =
        state.activeProfileId && state.activeProfileId !== 'all'
          ? stateManager.getProfile(state.activeProfileId)
          : undefined;
      const profileLabel = activeProfile ? activeProfile.name : 'Global';
      const envLabel =
        state.activeEnvironmentName || Object.keys(state.environments)[0] || 'None';

      statusBarItem.text = `$(circle-filled) ${profileLabel} $(globe) ${envLabel}`;
      statusBarItem.color = activeProfile?.color || undefined;
      statusBarItem.tooltip = `Active Profile Scope: ${profileLabel}${activeProfile?.color ? ` (${activeProfile.color})` : ''}\nActive Environment: ${envLabel}\nClick to switch profile or environment context`;
      statusBarItem.command = 'byrdsnestApiClient.switchContext';

      if (collectionsView) {
        collectionsView.description = profileLabel;
      }
    };

    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Coordinator that refreshes all views and synchronizes status bar
    const treeCoordinator = new BlueByrdTreeCoordinator(
      profilesProvider,
      collectionsProvider,
      environmentsProvider,
      toolsProvider,
      updateStatusBar
    );

    // Register native view accordions (Collections, Environments, Tools)
    collectionsView = vscode.window.createTreeView('byrdsnestCollections', {
      treeDataProvider: collectionsProvider,
      dragAndDropController: collectionsProvider,
      canSelectMany: true,
      showCollapseAll: true,
    });
    updateStatusBar();
    const environmentsView = vscode.window.createTreeView('byrdsnestEnvironments', {
      treeDataProvider: environmentsProvider,
      showCollapseAll: true,
    });
    const toolsView = vscode.window.createTreeView('byrdsnestTools', {
      treeDataProvider: toolsProvider,
    });

    context.subscriptions.push(
      treeCoordinator,
      collectionsView,
      environmentsView,
      toolsView
    );

    // 3. Register Commands
    const commandManager = new CommandManager(
      context,
      stateManager,
      treeCoordinator,
      httpService,
      variableService,
      authService,
      updateService,
      tokenService
    );
    commandManager.registerAll();

    // 4. Preload stored tokens from SecretStorage into memory
    const initialProfileIds = stateManager.getState().profiles.map((p) => p.id);
    tokenService.loadAllTokens(initialProfileIds).then(() => {
      treeCoordinator.refresh();
    }).catch((err) => {
      console.warn('[byrdsnest api client] Failed to preload tokens:', err?.message);
    });

    // 5. Check for Updates in Background (throttled to once every 24 hours)
    updateService.checkForUpdates(false).catch((err) => {
      console.warn('[byrdsnest api client] Background update check error:', err?.message);
    });

    console.log('[byrdsnest api client] Extension activated successfully with breakout views.');
  } catch (error) {
    console.error('[byrdsnest api client] Failed to activate extension:', error);
    vscode.window.showErrorMessage('byrdsnest api client failed to start.');
  }
}

export function deactivate(): void {
  console.log('[byrdsnest api client] Deactivating extension.');
}
