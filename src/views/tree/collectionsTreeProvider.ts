import * as vscode from 'vscode';
import { AppState, RequestContext, RequestItem } from '../../types';
import { BlueByrdStateManager } from '../../state/stateManager';
import { BlueByrdTreeItem } from './treeItem';

export class BlueByrdCollectionsTreeProvider
  implements
    vscode.TreeDataProvider<BlueByrdTreeItem>,
    vscode.TreeDragAndDropController<BlueByrdTreeItem>,
    vscode.Disposable {
  public readonly dropMimeTypes: readonly string[] = [
    'application/vnd.code.tree.bluebyrdcollections',
    'application/vnd.code.tree.bluebyrd',
  ];
  public readonly dragMimeTypes: readonly string[] = [
    'application/vnd.code.tree.byrdsnestcollections',
    'application/vnd.code.tree.byrdsnest',
    'application/vnd.code.tree.bluebyrdcollections',
    'application/vnd.code.tree.bluebyrd',
  ];

  private readonly stateManager: BlueByrdStateManager;
  private state: AppState;
  private refreshCoordinator?: () => void;
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<BlueByrdTreeItem | undefined>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(stateManager: BlueByrdStateManager) {
    this.stateManager = stateManager;
    this.state = stateManager.getState();
  }

  public setRefreshListener(listener: () => void): void {
    this.refreshCoordinator = listener;
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

  public getChildren(element?: BlueByrdTreeItem): BlueByrdTreeItem[] {
    if (!element) {
      return this.getRootCollections();
    }
    return element.children || [];
  }

  // --- Drag and Drop Implementation ---

  public handleDrag(
    source: readonly BlueByrdTreeItem[],
    treeDataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void {
    const draggable = source.filter((s) => s && s.kind !== 'active-filter' && s.itemId !== 'active-profile-banner');
    if (draggable.length === 0) return;
    treeDataTransfer.set(
      'application/vnd.code.tree.bluebyrdcollections',
      new vscode.DataTransferItem(draggable)
    );
  }

  public async handleDrop(
    target: BlueByrdTreeItem | undefined,
    sources: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem =
      sources.get('application/vnd.code.tree.bluebyrdcollections') ||
      sources.get('application/vnd.code.tree.bluebyrd');
    if (!transferItem) return;

    let sourceItems: BlueByrdTreeItem[] = [];
    if (Array.isArray(transferItem.value)) {
      sourceItems = transferItem.value;
    } else if (transferItem.value) {
      sourceItems = [transferItem.value];
    } else {
      try {
        const str = await transferItem.asString();
        if (str) {
          const parsed = JSON.parse(str);
          sourceItems = Array.isArray(parsed) ? parsed : [parsed];
        }
      } catch {
        // Fallback ignore parse errors
      }
    }

    if (!sourceItems || sourceItems.length === 0) return;

    let stateModified = false;
    let lastSummary = '';

    let effectiveTarget = target;
    if (effectiveTarget && (effectiveTarget.itemId === 'active-profile-banner' || effectiveTarget.kind === 'active-filter')) {
      const firstCol = this.state.collections[0];
      effectiveTarget = firstCol ? { kind: 'collection', itemId: firstCol.id, label: firstCol.name } as any : undefined;
    }

    for (const source of sourceItems) {
      if (!source || !source.itemId) continue;
      if (effectiveTarget && effectiveTarget.itemId === source.itemId) continue;

      // 1. Dragging a COLLECTION
      if (source.kind === 'collection') {
        if (!effectiveTarget) {
          // Dropped on blank canvas: move collection to bottom
          if (this.stateManager.moveCollectionToEnd(source.itemId)) {
            stateModified = true;
            lastSummary = `Moved '${source.label}' to the end of collections`;
          }
        } else if (effectiveTarget.kind === 'collection' && effectiveTarget.itemId) {
          // Dropped onto another collection: reorder before it
          if (this.stateManager.reorderCollection(source.itemId, effectiveTarget.itemId, 'before')) {
            stateModified = true;
            lastSummary = `Reordered '${source.label}' before '${effectiveTarget.label}'`;
          }
        } else if (effectiveTarget.kind === 'folder' || effectiveTarget.kind === 'request') {
          // Dropped onto item in another collection: reorder relative to target's collection
          const targetColId = effectiveTarget.requestContext?.collectionId || effectiveTarget.parentId;
          if (targetColId && targetColId !== source.itemId) {
            if (this.stateManager.reorderCollection(source.itemId, targetColId, 'before')) {
              stateModified = true;
              lastSummary = `Reordered '${source.label}' before target collection`;
            }
          }
        }
      }

      // 2. Dragging a FOLDER
      else if (source.kind === 'folder') {
        if (!target || !target.itemId) continue;

        if (target.kind === 'folder') {
          const sourceColId = source.parentId;
          const targetColId = target.parentId;
          if (targetColId) {
            if (sourceColId === targetColId) {
              // Reorder folders within same collection
              if (this.stateManager.reorderFolder(targetColId, source.itemId, target.itemId, 'before')) {
                stateModified = true;
                lastSummary = `Reordered folder '${source.label}' before '${target.label}'`;
              }
            } else {
              // Move folder from source collection to target collection before target folder
              if (this.stateManager.moveFolderToCollection(source.itemId, targetColId, target.itemId, 'before')) {
                stateModified = true;
                lastSummary = `Moved folder '${source.label}' before '${target.label}'`;
              }
            }
          }
        } else if (target.kind === 'collection') {
          // Move folder into target collection
          if (this.stateManager.moveFolderToCollection(source.itemId, target.itemId)) {
            stateModified = true;
            lastSummary = `Moved folder '${source.label}' into collection '${target.label}'`;
          }
        } else if (target.kind === 'request') {
          const targetReq = this.stateManager.getRequest(target.itemId);
          if (targetReq) {
            if (targetReq.folder) {
              if (this.stateManager.moveFolderToCollection(source.itemId, targetReq.collection.id, targetReq.folder.id, 'before')) {
                stateModified = true;
                lastSummary = `Moved folder '${source.label}' before folder '${targetReq.folder.name}'`;
              }
            } else {
              if (this.stateManager.moveFolderToCollection(source.itemId, targetReq.collection.id)) {
                stateModified = true;
                lastSummary = `Moved folder '${source.label}' into collection '${targetReq.collection.name}'`;
              }
            }
          }
        }
      }

      // 3. Dragging a REQUEST
      else if (source.kind === 'request') {
        if (!target || !target.itemId) continue;

        if (target.kind === 'request') {
          // Dropped onto another request: place immediately before target request
          const targetReq = this.stateManager.getRequest(target.itemId);
          if (targetReq) {
            if (
              this.stateManager.moveRequest(
                source.itemId,
                targetReq.collection.id,
                targetReq.folder?.id,
                targetReq.request.id,
                'before'
              )
            ) {
              stateModified = true;
              lastSummary = `Moved request '${source.label}' before '${target.label}'`;
            }
          }
        } else if (target.kind === 'folder') {
          // Dropped onto a folder: move request into that folder
          const targetColId = target.parentId;
          if (targetColId) {
            if (this.stateManager.moveRequest(source.itemId, targetColId, target.itemId)) {
              stateModified = true;
              lastSummary = `Moved request '${source.label}' into folder '${target.label}'`;
            }
          }
        } else if (target.kind === 'collection') {
          // Dropped onto a collection: move to collection root
          if (this.stateManager.moveRequest(source.itemId, target.itemId, undefined)) {
            stateModified = true;
            lastSummary = `Moved request '${source.label}' to root of collection '${target.label}'`;
          }
        }
      }
    }

    if (stateModified) {
      this.refresh();
      if (this.refreshCoordinator) {
        this.refreshCoordinator();
      }
      if (lastSummary) {
        vscode.window.setStatusBarMessage(`$(arrow-swap) bluebyrd: ${lastSummary}`, 3500);
      }
    }
  }

  private getRootCollections(): BlueByrdTreeItem[] {
    const activeProfileId = this.state.activeProfileId;
    const isFiltered = activeProfileId && activeProfileId !== 'all';

    const visibleCols = this.state.collections.filter((c) => {
      if (!isFiltered) return true;
      if (activeProfileId === 'global') return !c.profileId || c.profileId === 'global';
      // Include collections scoped to active profile OR shared/global
      return c.profileId === activeProfileId || !c.profileId || c.profileId === 'global';
    });

    if (visibleCols.length === 0) {
      const emptyItem = new BlueByrdTreeItem(
        'No collections found',
        'collection',
        'empty',
        undefined,
        undefined,
        [],
        undefined,
        'Click + to create one',
        vscode.TreeItemCollapsibleState.None
      );
      emptyItem.iconPath = new vscode.ThemeIcon('info');
      return [emptyItem];
    }

    const colItems = visibleCols.map((col) => {
      const folderMap = new Map<string, BlueByrdTreeItem>();
      const rootRequests: BlueByrdTreeItem[] = [];

      const existingReqIds = new Set<string>();
      for (const folder of col.folders || []) {
        const folderReqs = (folder.requests || []).map((req) => {
          existingReqIds.add(req.id);
          return this.buildRequestItem(req, col.id, col.name, folder.id, folder.name);
        });
        const folderItem = new BlueByrdTreeItem(
          folder.name,
          'folder',
          folder.id,
          col.id,
          undefined,
          folderReqs,
          undefined,
          undefined,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        folderMap.set(folder.id, folderItem);
        folderMap.set(folder.name, folderItem);
      }

      for (const req of col.requests || []) {
        if (existingReqIds.has(req.id)) continue;
        const reqItem = this.buildRequestItem(req, col.id, col.name);
        if (req.folder && folderMap.has(req.folder)) {
          folderMap.get(req.folder)!.children.push(reqItem);
        } else {
          rootRequests.push(reqItem);
        }
      }

      const uniqueFolders = Array.from(new Set(folderMap.values()));
      const children: BlueByrdTreeItem[] = [...uniqueFolders, ...rootRequests];

      const isShared = !col.profileId || col.profileId === 'global';
      const scopeDesc = isFiltered && activeProfileId !== 'global' && isShared
        ? 'Shared'
        : undefined;

      return new BlueByrdTreeItem(
        col.name,
        'collection',
        col.id,
        undefined,
        undefined,
        children,
        undefined,
        scopeDesc,
        children.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
      );
    });

    return colItems;
  }

  private buildRequestItem(
    req: RequestItem,
    collectionId: string,
    collectionName: string,
    folderId?: string,
    folderName?: string
  ): BlueByrdTreeItem {
    const activeEnv = this.state.activeEnvironmentName !== undefined
      ? this.state.activeEnvironmentName
      : (req.environment !== undefined ? req.environment : '');

    const reqContext: RequestContext = {
      id: req.id,
      requestId: req.id,
      requestName: req.name,
      method: req.method,
      url: req.url,
      collection: collectionName,
      collectionId: collectionId,
      folder: folderName || req.folder,
      folderId: folderId || req.folderId,
      environment: activeEnv,
      headers: req.headers,
      body: req.body,
      bodyType: req.bodyType,
      bodyFormData: req.bodyFormData,
      auth: req.auth,
      notes: req.notes,
      variables: req.variables,
      preRequestScript: req.preRequestScript,
      postResponseScript: req.postResponseScript,
      baseUrlPreference: req.baseUrlPreference,
      openApiDocs: req.openApiDocs,
    };

    const reqItem = new BlueByrdTreeItem(
      req.name,
      'request',
      req.id,
      folderId || collectionId,
      reqContext,
      [],
      {
        title: 'Open Request',
        command: 'byrdsnestApiClient.openRequestPanel',
        arguments: [reqContext],
      },
      req.method,
      vscode.TreeItemCollapsibleState.None
    );

    return reqItem;
  }
}
