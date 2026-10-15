import * as vscode from 'vscode';
import { AppState, RequestContext, RequestItem } from '../../types';
import { BlueByrdStateManager } from '../../state/stateManager';
import { BlueByrdTreeItem } from './treeItem';

export class BlueByrdExplorerTreeDataProvider
  implements vscode.TreeDataProvider<BlueByrdTreeItem>, vscode.Disposable {
  private readonly stateManager: BlueByrdStateManager;
  private state: AppState;
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<BlueByrdTreeItem | undefined>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(stateManager: BlueByrdStateManager) {
    this.stateManager = stateManager;
    this.state = stateManager.getState();
  }

  public dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  public refresh(): void {
    this.state = this.stateManager.getState();
    this._onDidChangeTreeData.fire(undefined);
  }

  public getTreeItem(element: BlueByrdTreeItem): vscode.TreeItem {
    return element;
  }

  public getParent(element: BlueByrdTreeItem): vscode.ProviderResult<BlueByrdTreeItem> {
    return undefined;
  }

  public getChildren(element?: BlueByrdTreeItem): BlueByrdTreeItem[] {
    if (!element) {
      return [
        this.buildProfilesSection(),
        this.buildHistorySection(),
      ];
    }

    if (
      element.kind === 'section' ||
      element.kind === 'profile' ||
      element.kind === 'collection' ||
      element.kind === 'folder' ||
      element.kind === 'environment'
    ) {
      return element.children;
    }

    return [];
  }

  private buildProfilesSection(): BlueByrdTreeItem {
    const activeProfileId = this.state.activeProfileId;
    const profileItems = this.state.profiles.map((p) => {
      const isActive = activeProfileId === p.id || activeProfileId === p.name;
      const desc = isActive ? '✔ Active Scope' : undefined;

      const envNode = this.buildProfileEnvironmentsNode(p.id);
      const colNode = this.buildProfileCollectionsNode(p.id);
      const children = [envNode, colNode];

      const item = new BlueByrdTreeItem(
        p.name,
        'profile',
        p.id,
        undefined,
        undefined,
        children,
        {
          title: 'Edit Profile Settings',
          command: 'byrdsnestApiClient.editProfile',
          arguments: [{ id: p.id, name: p.name }],
        },
        desc,
        isActive ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
      );

      if (isActive) {
        item.iconPath = new vscode.ThemeIcon('pass');
      }
      return item;
    });

    // Add Shared / Global pseudo-profile node for items available across all profiles
    const globalEnvNode = this.buildProfileEnvironmentsNode('global');
    const globalColNode = this.buildProfileCollectionsNode('global');
    const globalChildren = [globalEnvNode, globalColNode];
    const hasGlobalItems =
      (globalEnvNode.children && globalEnvNode.children.length > 0) ||
      (globalColNode.children && globalColNode.children.length > 0);

    const globalItem = new BlueByrdTreeItem(
      'Shared / Global',
      'profile',
      'global',
      undefined,
      undefined,
      globalChildren,
      undefined,
      'All Profiles',
      hasGlobalItems ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    globalItem.iconPath = new vscode.ThemeIcon('globe');
    globalItem.contextValue = 'bluebyrd.profile.global';

    profileItems.push(globalItem);

    const section = new BlueByrdTreeItem('Profiles', 'section', 'section-profiles', undefined, undefined, profileItems);
    section.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    return section;
  }

  private buildProfileEnvironmentsNode(profileId: string): BlueByrdTreeItem {
    const isGlobal = profileId === 'global';
    const allEnvs = Object.entries(this.state.environments);
    const profileEnvs = isGlobal
      ? allEnvs.filter(([, e]) => !e.profileId || e.profileId === 'global')
      : allEnvs.filter(([, e]) => e.profileId === profileId);

    const envItems = this.buildEnvironmentTree(profileEnvs, this.state.activeEnvironmentName, profileId);
    const count = profileEnvs.length;

    const envNode = new BlueByrdTreeItem(
      'Environments',
      'section',
      `${profileId}-environments`,
      profileId,
      undefined,
      envItems,
      undefined,
      `${count} ${count === 1 ? 'env' : 'envs'}`,
      count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    envNode.iconPath = new vscode.ThemeIcon('server-environment');
    envNode.contextValue = 'bluebyrd.section.environments';
    return envNode;
  }

  private buildProfileCollectionsNode(profileId: string): BlueByrdTreeItem {
    const isGlobal = profileId === 'global';
    const allCols = this.state.collections;
    const profileCols = isGlobal
      ? allCols.filter((c) => !c.profileId || c.profileId === 'global')
      : allCols.filter((c) => c.profileId === profileId);

    const colItems = profileCols.map((col) => {
      // Build folders
      const folderItems = col.folders.map((folder) => {
        const reqItems = folder.requests.map((req) => this.buildRequestItem(req, col.name, folder.name, col.id, folder.id));
        return new BlueByrdTreeItem(
          folder.name,
          'folder',
          folder.id,
          col.id,
          undefined,
          reqItems,
          undefined
        );
      });

      // Build root requests (which do not belong to any folder)
      const rootReqItems = col.requests.map((req) => this.buildRequestItem(req, col.name, undefined, col.id));
      const children = [...folderItems, ...rootReqItems];

      return new BlueByrdTreeItem(
        col.name,
        'collection',
        col.id,
        profileId,
        undefined,
        children,
        {
          title: 'Edit Collection Settings',
          command: 'byrdsnestApiClient.editCollection',
          arguments: [{ id: col.id, name: col.name }],
        },
        `${children.length} ${children.length === 1 ? 'item' : 'items'}`
      );
    });

    const count = profileCols.length;
    const colNode = new BlueByrdTreeItem(
      'Collections',
      'section',
      `${profileId}-collections`,
      profileId,
      undefined,
      colItems,
      undefined,
      `${count} ${count === 1 ? 'collection' : 'collections'}`,
      count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    colNode.iconPath = new vscode.ThemeIcon('library');
    colNode.contextValue = 'bluebyrd.section.collections';
    return colNode;
  }

  private buildEnvironmentTree(
    envEntries: Array<[string, any]>,
    activeEnvName?: string,
    parentProfileId?: string
  ): BlueByrdTreeItem[] {
    const entryMapByName = new Map<string, { name: string; env: any }>();
    const entryMapById = new Map<string, { name: string; env: any }>();
    for (const [name, env] of envEntries) {
      entryMapByName.set(name, { name, env });
      if (env.id) {
        entryMapById.set(env.id, { name, env });
      }
    }

    const parentMap = new Map<string, string>(); // child name -> parent name
    const childrenMap = new Map<string, Array<{ name: string; env: any }>>(); // parent name -> child entries

    for (const [name] of envEntries) {
      childrenMap.set(name, []);
    }

    for (const [name, env] of envEntries) {
      if (env.inheritsFrom) {
        const parentEntry = entryMapById.get(env.inheritsFrom) || entryMapByName.get(env.inheritsFrom);
        if (parentEntry && parentEntry.name !== name) {
          // Check for cycles
          let curr: string | undefined = parentEntry.name;
          let isCycle = false;
          const visited = new Set<string>([name]);
          while (curr) {
            if (visited.has(curr)) {
              isCycle = true;
              break;
            }
            visited.add(curr);
            curr = parentMap.get(curr);
          }
          if (!isCycle) {
            parentMap.set(name, parentEntry.name);
            childrenMap.get(parentEntry.name)!.push({ name, env });
          }
        }
      }
    }

    const rootEntries = envEntries.filter(([name]) => !parentMap.has(name));

    const buildEnvItem = (name: string, env: any, parentName?: string): BlueByrdTreeItem => {
      const childEntries = childrenMap.get(name) || [];
      const childTreeItems = childEntries.map((c) => buildEnvItem(c.name, c.env, name));

      const isActive = activeEnvName === name || (env.id && activeEnvName === env.id);

      const isParent = childTreeItems.length > 0;
      const isChild = !!parentName;

      const parts: string[] = [];
      if (isActive) {
        parts.push('✔ Active');
      }
      if (isParent) {
        parts.push(`Parent (${childTreeItems.length})`);
      } else if (isChild) {
        parts.push(`inherits: ${parentName}`);
      } else {
        parts.push('Root');
      }
      if (!env.baseUrlDisabled && env.baseUrl) {
        parts.push(env.baseUrl);
      }
      const desc = parts.join(' • ');

      const item = new BlueByrdTreeItem(
        name,
        'environment',
        env.id,
        parentProfileId,
        undefined,
        childTreeItems,
        {
          title: 'Edit Environment Settings',
          command: 'byrdsnestApiClient.editEnvironment',
          arguments: [{ id: env.id, name }],
        },
        desc || undefined
      );

      if (isParent) {
        item.iconPath = isActive
          ? new vscode.ThemeIcon('server-process', new vscode.ThemeColor('charts.green'))
          : new vscode.ThemeIcon('server-process');
      } else if (isChild) {
        item.iconPath = isActive
          ? new vscode.ThemeIcon('arrow-subwards', new vscode.ThemeColor('charts.green'))
          : new vscode.ThemeIcon('arrow-subwards');
      } else {
        item.iconPath = isActive
          ? new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.green'))
          : new vscode.ThemeIcon('server-environment');
      }

      return item;
    };

    return rootEntries.map(([name, env]) => buildEnvItem(name, env));
  }

  private buildHistorySection(): BlueByrdTreeItem {
    const historyItems = this.state.history.map((h) => {
      const label = h.name || `${h.method} ${h.url}`;
      return new BlueByrdTreeItem(
        label,
        'history',
        h.id,
        'section-history',
        undefined,
        [],
        {
          title: `Inspect History: ${label}`,
          command: 'byrdsnestApiClient.openHistoryPanel',
          arguments: [{ historyId: h.id }],
        }
      );
    });

    return new BlueByrdTreeItem(
      'History',
      'section',
      'section-history',
      undefined,
      undefined,
      historyItems,
      {
        title: 'Open History Inspector',
        command: 'byrdsnestApiClient.openHistoryPanel',
        arguments: [],
      }
    );
  }

  private buildRequestItem(
    req: RequestItem,
    collectionName?: string,
    folderName?: string,
    collectionId?: string,
    folderId?: string,
    isHistory = false
  ): BlueByrdTreeItem {
    const context: RequestContext = {
      id: req.id,
      requestId: req.id,
      requestName: req.name,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      bodyType: req.bodyType,
      bodyFormData: req.bodyFormData,
      environment: req.environment,
      collection: collectionName || req.collection,
      collectionId: collectionId || req.collectionId,
      folder: folderName || req.folder,
      folderId: folderId || req.folderId,
      auth: req.auth,
      notes: req.notes,
      variables: req.variables,
      preRequestScript: req.preRequestScript,
      postResponseScript: req.postResponseScript,
      baseUrlPreference: req.baseUrlPreference,
      openApiDocs: req.openApiDocs,
    };

    return new BlueByrdTreeItem(
      req.name || `${req.method} ${req.url}`,
      isHistory ? 'history' : 'request',
      req.id,
      folderId || collectionId,
      context,
      [],
      {
        title: `Open ${req.name}`,
        command: 'byrdsnestApiClient.openRequestPanel',
        arguments: [context],
      }
    );
  }
}

