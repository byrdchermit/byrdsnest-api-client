import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  AppState,
  AuthSettings,
  Collection,
  CollectionFolder,
  EnvironmentConfig,
  Profile,
  ProfileAuth,
  RecentRequest,
  RequestItem,
  ResponseMetadata,
  SidebarNodeKind,
} from '../types';

export class BlueByrdStateManager {
  private readonly context: vscode.ExtensionContext;
  private readonly storageKey = 'byrdsnest-api-state';
  private readonly legacyStorageKey = 'blue-byrd-state';
  private readonly _onDidChangeState = new vscode.EventEmitter<AppState>();
  public readonly onDidChangeState: vscode.Event<AppState> = this._onDidChangeState.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  public createDefaultState(): AppState {
    return {
      profiles: [
        {
          id: 'profile-dev',
          name: 'Development',
          color: '#10b981',
          auth: { type: 'bearer', token: 'dev-token-sample', headerName: 'Authorization' },
          variables: {
            authSecret: 'super-secret-key',
            version: 'v1',
          },
        },
        {
          id: 'profile-staging',
          name: 'Staging',
          color: '#f59e0b',
          auth: { type: 'apiKey', keyName: 'x-api-key', headerName: 'x-api-key', token: 'staging-api-key' },
          variables: {
            version: 'v1',
          },
        },
        {
          id: 'profile-prod',
          name: 'Production',
          color: '#ef4444',
          auth: { type: 'bearer', token: '', headerName: 'Authorization' },
          variables: {
            version: 'v1',
          },
        },
      ],
      environments: {
        Local: {
          id: 'env-local',
          baseUrl: 'https://jsonplaceholder.typicode.com',
          apiKey: 'local-key',
          variables: {
            userId: '1',
          },
          profileId: 'profile-dev',
        },
        Dev: {
          id: 'env-dev',
          baseUrl: 'https://dev.api.example.com',
          apiKey: 'dev-key',
          variables: {
            userId: '100',
          },
          inheritsFrom: 'Local',
          profileId: 'profile-dev',
        },
        Prod: {
          id: 'env-prod',
          baseUrl: 'https://api.example.com',
          apiKey: 'prod-key',
          variables: {},
          profileId: 'profile-prod',
        },
      },
      collections: [
        {
          id: 'col-demo',
          name: 'Demo Collection',
          profileId: 'profile-dev',
          folders: [
            {
              id: 'folder-todos',
              name: 'Todos',
              requests: [
                {
                  id: 'req-get-todo',
                  name: 'Get Todo Item',
                  method: 'GET',
                  url: '{{baseUrl}}/todos/{{userId}}',
                  folder: 'Todos',
                  collection: 'Demo Collection',
                  headers: {
                    Accept: 'application/json',
                  },
                  body: '',
                  profile: 'Development',
                  environment: 'Local',
                  notes: 'Fetches a single todo item using baseUrl and userId template variables.',
                },
                {
                  id: 'req-create-todo',
                  name: 'Create Todo Item',
                  method: 'POST',
                  url: '{{baseUrl}}/todos',
                  folder: 'Todos',
                  collection: 'Demo Collection',
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                  },
                  body: JSON.stringify(
                    {
                      title: 'Ship byrdsnest api client',
                      completed: false,
                      userId: 1,
                    },
                    null,
                    2
                  ),
                  profile: 'Development',
                  environment: 'Local',
                  notes: 'Creates a new todo item.',
                },
              ],
            },
          ],
          requests: [
            {
              id: 'req-get-users',
              name: 'Get Users List',
              method: 'GET',
              url: '{{baseUrl}}/users',
              collection: 'Demo Collection',
              headers: {
                Accept: 'application/json',
              },
              body: '',
              profile: 'Development',
              environment: 'Local',
              notes: 'Collection root level request.',
            },
          ],
        },
      ],
      history: [],
      activeProfileId: 'profile-dev',
      activeEnvironmentName: 'Local',
      globalProfile: {
        id: 'global',
        name: 'Shared / Global',
        color: '#64748b',
        auth: { type: 'none' },
        variables: {},
        headers: {},
        notes: 'Variables & auth shared across all profiles',
      },
    };
  }

  private normalizeAuth(auth?: Partial<ProfileAuth>): ProfileAuth {
    return {
      type: auth?.type === 'bearer' || auth?.type === 'apiKey' || auth?.type === 'oauth2' || auth?.type === 'basic' ? auth.type : 'none',
      token: auth?.token ?? '',
      headerName: auth?.headerName ?? (auth?.type === 'apiKey' ? (auth?.keyName ?? 'X-API-Key') : 'Authorization'),
      keyName: auth?.keyName ?? 'X-API-Key',
      headerPrefix: auth?.headerPrefix ?? (auth?.type === 'bearer' || auth?.type === 'oauth2' ? 'Bearer' : ''),
      addTo: auth?.addTo ?? 'header',
      username: auth?.username ?? '',
      password: auth?.password ?? '',
      clientId: auth?.clientId ?? '',
      clientSecret: auth?.clientSecret ?? '',
      authorizationUrl: auth?.authorizationUrl ?? '',
      tokenUrl: auth?.tokenUrl ?? '',
      redirectUri: auth?.redirectUri ?? 'http://127.0.0.1:41982/callback',
      pkce: auth?.pkce !== false,
      scopes: Array.isArray(auth?.scopes) ? auth.scopes : [],
      grantType: auth?.grantType ?? 'authorization_code',
    };
  }

  public normalizeState(value: Partial<AppState> | undefined): AppState {
    const fallback = this.createDefaultState();
    if (!value || typeof value !== 'object') {
      return fallback;
    }

    const slugify = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';

    // Normalize profiles
    const profiles: Profile[] = Array.isArray(value.profiles) && value.profiles.length > 0
      ? value.profiles.map((p, index) => ({
          id: p.id || `profile-${slugify(p.name || `dev-${index + 1}`)}`,
          name: p.name || `Profile ${index + 1}`,
          color: p.color || (index === 0 ? '#10b981' : index === 1 ? '#f59e0b' : index === 2 ? '#ef4444' : '#3b82f6'),
          auth: this.normalizeAuth(p.auth),
          variables: p.variables || {},
          headers: p.headers || {},
          inheritsFrom: p.inheritsFrom,
          notes: p.notes || '',
          guards: p.guards ? {
            enabled: p.guards.enabled !== false,
            warnBeforeSend: !!p.guards.warnBeforeSend,
            warnMessage: p.guards.warnMessage || '',
            blockedMethods: Array.isArray(p.guards.blockedMethods) ? p.guards.blockedMethods : [],
            requireKeywordConfirmation: !!p.guards.requireKeywordConfirmation,
            confirmationKeyword: p.guards.confirmationKeyword || '',
          } : undefined,
        }))
      : fallback.profiles;

    // Normalize environments
    const rawEnvs = value.environments && typeof value.environments === 'object' ? value.environments : {};
    const environments: Record<string, EnvironmentConfig> = {};

    if (Object.keys(rawEnvs).length > 0) {
      Object.entries(rawEnvs).forEach(([key, env]) => {
        if (!env || typeof env !== 'object') return;
        environments[key] = {
          id: env.id || `env-${slugify(key)}`,
          baseUrl: env.baseUrl !== undefined ? env.baseUrl : (env.inheritsFrom ? '' : 'https://api.example.com'),
          baseUrlDisabled: env.baseUrlDisabled ? true : false,
          apiKey: env.apiKey || '',
          auth: env.auth ? this.normalizeAuth(env.auth) : undefined,
          variables: env.variables || {},
          headers: env.headers || {},
          inheritsFrom: env.inheritsFrom,
          notes: env.notes || '',
          profileId: env.profileId,
        };
      });
    } else {
      Object.assign(environments, fallback.environments);
    }

    // Normalize collections & eliminate any duplicates where requests in folders were also placed in root
    const collections: Collection[] = Array.isArray(value.collections) && value.collections.length > 0
      ? value.collections.map((col, cIdx) => {
          const colId = col.id || `col-${slugify(col.name || `col-${cIdx + 1}`)}`;
          const colName = col.name || `Collection ${cIdx + 1}`;

          const folders: CollectionFolder[] = Array.isArray(col.folders)
            ? col.folders.map((f, fIdx) => {
                const folderId = f.id || `folder-${slugify(f.name || `folder-${fIdx + 1}`)}`;
                const folderName = f.name || `Folder ${fIdx + 1}`;
                const requests: RequestItem[] = Array.isArray(f.requests)
                  ? f.requests.map((r, rIdx) => ({
                      id: r.id || `req-${Date.now()}-${rIdx}`,
                      name: r.name || 'Untitled Request',
                      method: (r.method || 'GET').toUpperCase(),
                      url: r.url || '',
                      folder: folderName,
                      folderId,
                      collection: colName,
                      collectionId: colId,
                      headers: r.headers || {},
                      body: r.body || '',
                      bodyType: r.bodyType,
                      bodyFormData: r.bodyFormData,
                      profile: r.profile,
                      environment: r.environment,
                      auth: r.auth,
                      notes: r.notes || '',
                      variables: r.variables || [],
                      baseUrlPreference: r.baseUrlPreference,
                    }))
                  : [];
                return {
                  id: folderId,
                  name: folderName,
                  requests,
                  auth: f.auth,
                  notes: f.notes || '',
                  variables: f.variables || {},
                  headers: f.headers || {},
                  inheritsFrom: f.inheritsFrom,
                  baseUrl: f.baseUrl,
                  baseUrlDisabled: f.baseUrlDisabled ? true : false,
                  baseUrlPreference: f.baseUrlPreference,
                  preferCollectionBaseUrl: f.preferCollectionBaseUrl,
                };
              })
            : [];

          // Get IDs of requests that are in folders so we can remove them from root if duplicated
          const folderRequestIds = new Set<string>();
          folders.forEach((f) => f.requests.forEach((r) => folderRequestIds.add(r.id)));

          const rootRequests: RequestItem[] = Array.isArray(col.requests)
            ? col.requests
                .filter((r) => r && !folderRequestIds.has(r.id) && (!r.folder || r.folder === 'Root'))
                .map((r, rIdx) => ({
                  id: r.id || `req-${Date.now()}-${rIdx}`,
                  name: r.name || 'Untitled Request',
                  method: (r.method || 'GET').toUpperCase(),
                  url: r.url || '',
                  folder: undefined,
                  folderId: undefined,
                  collection: colName,
                  collectionId: colId,
                  headers: r.headers || {},
                  body: r.body || '',
                  bodyType: r.bodyType,
                  bodyFormData: r.bodyFormData,
                  profile: r.profile,
                  environment: r.environment,
                  auth: r.auth,
                  notes: r.notes || '',
                  variables: r.variables || [],
                  baseUrlPreference: r.baseUrlPreference,
                }))
            : [];

          return {
            id: colId,
            name: colName,
            folders,
            requests: rootRequests,
            auth: col.auth,
            notes: col.notes || '',
            variables: col.variables || {},
            headers: col.headers || {},
            inheritsFrom: col.inheritsFrom,
            profileId: col.profileId,
            baseUrl: col.baseUrl,
            baseUrlDisabled: col.baseUrlDisabled ? true : false,
            baseUrlPreference: col.baseUrlPreference,
            preferCollectionBaseUrl: col.preferCollectionBaseUrl,
          };
        })
      : fallback.collections;

    // Normalize history
    const history: RecentRequest[] = Array.isArray(value.history)
      ? value.history
          .filter((h): h is RecentRequest => !!h && typeof h.id === 'string')
          .map((h) => ({
            ...h,
            method: (h.method || 'GET').toUpperCase(),
            headers: h.headers || {},
            body: h.body || '',
            timestamp: h.timestamp || new Date().toISOString(),
          }))
          .slice(0, 50)
      : [];

    const activeProfileId = typeof value.activeProfileId === 'string' ? value.activeProfileId : undefined;
    let activeEnvironmentName: string | undefined;
    if (value && 'activeEnvironmentName' in value) {
      const candidate = typeof value.activeEnvironmentName === 'string' && value.activeEnvironmentName.trim()
        ? value.activeEnvironmentName.trim()
        : undefined;
      if (candidate) {
        const envExists = environments[candidate] || Object.values(environments).some((e) => e.id === candidate);
        activeEnvironmentName = envExists ? candidate : undefined;
      } else {
        activeEnvironmentName = undefined;
      }
    } else {
      activeEnvironmentName = fallback.activeEnvironmentName && environments[fallback.activeEnvironmentName]
        ? fallback.activeEnvironmentName
        : Object.keys(environments)[0] || undefined;
    }
    const settings = value.settings || fallback.settings;

    // Normalize globalProfile
    const rawGlobal = value.globalProfile || fallback.globalProfile;
    const globalProfile: Profile = {
      id: 'global',
      name: 'Shared / Global',
      color: rawGlobal?.color || '#64748b',
      auth: this.normalizeAuth(rawGlobal?.auth),
      variables: rawGlobal?.variables || {},
      headers: rawGlobal?.headers || {},
      notes: rawGlobal?.notes || 'Variables & auth shared across all profiles',
    };

    return {
      profiles,
      environments,
      collections,
      history,
      activeProfileId,
      activeEnvironmentName,
      settings,
      globalProfile,
    };
  }

  public getState(): AppState {
    const saved =
      this.context.workspaceState.get<Partial<AppState>>(this.storageKey) ||
      this.context.workspaceState.get<Partial<AppState>>(this.legacyStorageKey);
    try {
      let normalized = this.normalizeState(saved);
      // Auto-recover collections if state has only default template collection and a recovered backup exists in workspace
      if (!saved || !saved.collections || saved.collections.length <= 1) {
        const workspaceFolders = vscode?.workspace?.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          for (const wf of workspaceFolders) {
            const backupFile = path.join(wf.uri.fsPath, 'byrdsnest-backup-recovered.json');
            if (fs.existsSync(backupFile)) {
              try {
                const raw = fs.readFileSync(backupFile, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.collections) && parsed.collections.length > 1) {
                  console.log('[byrdsnest api client] Auto-restoring recovered collections from backup file:', backupFile);
                  normalized = this.normalizeState(parsed);
                  this.save(normalized);
                  break;
                }
              } catch (e) {
                // Ignore parse errors
              }
            }
          }
        }
      }
      return normalized;
    } catch (err) {
      console.error('[byrdsnest api client] Error normalizing state, returning fallback:', err);
      const fallback = this.createDefaultState();
      this.context.workspaceState.update(this.storageKey, fallback);
      return fallback;
    }
  }

  public save(state: AppState): void {
    this.context.workspaceState.update(this.storageKey, state);
    try {
      this._onDidChangeState.fire(state);
    } catch (err) {
      console.error('[byrdsnest api client] Error firing onDidChangeState:', err);
    }
  }

  // --- Active Context & Workspace Scope ---
  public getActiveProfileId(): string | undefined {
    return this.getState().activeProfileId;
  }

  public setActiveProfileId(id?: string): void {
    const state = this.getState();
    state.activeProfileId = id;
    this.save(state);
  }

  public getActiveEnvironmentName(): string | undefined {
    return this.getState().activeEnvironmentName;
  }

  public setActiveEnvironmentName(name?: string): void {
    const state = this.getState();
    state.activeEnvironmentName = name;
    this.save(state);
  }

  // --- Profiles ---
  public getProfiles(): Profile[] {
    return this.getState().profiles;
  }

  public getProfile(nameOrId?: string): Profile | undefined {
    if (!nameOrId) return undefined;
    if (nameOrId === 'global' || nameOrId === 'Shared / Global') {
      const state = this.getState();
      if (!state.globalProfile) {
        state.globalProfile = {
          id: 'global',
          name: 'Shared / Global',
          color: '#64748b',
          auth: { type: 'none' },
          variables: {},
          headers: {},
          notes: 'Variables & auth shared across all profiles',
        };
      }
      return state.globalProfile;
    }
    const profiles = this.getState().profiles;
    return profiles.find((p) => p.id === nameOrId) || profiles.find((p) => p.name === nameOrId);
  }

  public createProfile(name: string, auth?: Partial<ProfileAuth>, color?: string): Profile {
    const state = this.getState();
    const trimmed = name.trim() || 'New Profile';
    let finalName = trimmed;
    let counter = 1;
    while (state.profiles.some((p) => p.name.toLowerCase() === finalName.toLowerCase())) {
      counter++;
      finalName = `${trimmed} (${counter})`;
    }
    const slug = finalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'profile';
    const newProfile: Profile = {
      id: this.generateId(`profile-${slug}`),
      name: finalName,
      color: color || '#3b82f6',
      auth: this.normalizeAuth(auth),
      variables: {},
      headers: {},
      notes: '',
    };
    state.profiles.push(newProfile);
    this.save(state);
    return newProfile;
  }

  public saveProfile(profile: Profile): void {
    const state = this.getState();
    if (profile.id === 'global' || profile.name === 'Shared / Global') {
      state.globalProfile = profile;
      this.save(state);
      return;
    }
    const index = profile.id
      ? state.profiles.findIndex((p) => p.id === profile.id)
      : state.profiles.findIndex((p) => p.name === profile.name);
    if (index >= 0) {
      state.profiles[index] = profile;
    } else {
      state.profiles.push(profile);
    }
    this.save(state);
  }

  public deleteProfile(nameOrId: string): boolean {
    if (nameOrId === 'global' || nameOrId === 'Shared / Global') {
      return false;
    }
    const state = this.getState();
    const initialLen = state.profiles.length;
    const deletedProfile = state.profiles.find((p) => p.id === nameOrId || p.name === nameOrId);
    const byId = state.profiles.filter((p) => p.id !== nameOrId);
    if (byId.length !== initialLen) {
      state.profiles = byId;
      if (state.activeProfileId === nameOrId || (deletedProfile && state.activeProfileId === deletedProfile.id)) {
        state.activeProfileId = undefined;
      }
      this.save(state);
      return true;
    }
    state.profiles = state.profiles.filter((p) => p.name !== nameOrId);
    if (state.profiles.length !== initialLen) {
      if (state.activeProfileId === nameOrId || (deletedProfile && state.activeProfileId === deletedProfile.id)) {
        state.activeProfileId = undefined;
      }
      this.save(state);
      return true;
    }
    return false;
  }

  // --- Environments ---
  public getEnvironments(): Record<string, EnvironmentConfig> {
    return this.getState().environments;
  }

  public getEnvironment(nameOrId?: string): EnvironmentConfig | undefined {
    if (!nameOrId) return undefined;
    const envs = this.getState().environments;
    if (envs[nameOrId]) return envs[nameOrId];
    return Object.values(envs).find((e) => e.id === nameOrId);
  }

  public getEnvironmentName(nameOrId?: string): string | undefined {
    if (!nameOrId) return undefined;
    const envs = this.getState().environments;
    if (envs[nameOrId]) return nameOrId;
    const entry = Object.entries(envs).find(([, e]) => e.id === nameOrId);
    return entry ? entry[0] : undefined;
  }

  public createEnvironment(name: string, baseUrl?: string, profileId?: string, baseUrlDisabled?: boolean): { name: string; env: EnvironmentConfig } {
    const state = this.getState();
    const trimmed = name.trim() || 'New Environment';
    let finalName = trimmed;
    let counter = 1;
    while (state.environments[finalName]) {
      counter++;
      finalName = `${trimmed} (${counter})`;
    }
    const slug = finalName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'env';
    const newEnv: EnvironmentConfig = {
      id: this.generateId(`env-${slug}`),
      baseUrl: baseUrl !== undefined ? baseUrl : 'https://api.example.com',
      baseUrlDisabled: baseUrlDisabled !== undefined ? baseUrlDisabled : (baseUrl !== undefined ? false : true),
      variables: {},
      headers: {},
      notes: '',
      profileId,
    };
    state.environments[finalName] = newEnv;
    this.save(state);
    return { name: finalName, env: newEnv };
  }

  public saveEnvironment(name: string, env: EnvironmentConfig, oldName?: string): void {
    const state = this.getState();
    if (oldName && oldName !== name) {
      delete state.environments[oldName];
      if (state.activeEnvironmentName === oldName) {
        state.activeEnvironmentName = name;
      }
    }
    state.environments[name] = env;
    this.save(state);
  }

  public deleteEnvironment(nameOrId: string): boolean {
    const state = this.getState();
    const key = Object.keys(state.environments).find((k) => k === nameOrId || state.environments[k].id === nameOrId);
    if (key) {
      delete state.environments[key];
      if (state.activeEnvironmentName === key || state.activeEnvironmentName === nameOrId) {
        state.activeEnvironmentName = undefined;
      }
      this.save(state);
      return true;
    }
    return false;
  }

  public cloneEnvironment(nameOrId: string, newName?: string): { name: string; env: EnvironmentConfig } | undefined {
    const state = this.getState();
    const sourceEnv = this.getEnvironment(nameOrId);
    const sourceName = this.getEnvironmentName(nameOrId) || nameOrId;
    if (!sourceEnv) return undefined;

    let targetName: string;
    if (newName && newName.trim()) {
      targetName = newName.trim();
    } else {
      targetName = `${sourceName} (Copy)`;
      let counter = 1;
      while (state.environments[targetName]) {
        counter++;
        targetName = `${sourceName} (Copy ${counter})`;
      }
    }

    const slug = targetName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'env';
    const clonedEnv: EnvironmentConfig = {
      id: this.generateId(`env-${slug}`),
      baseUrl: sourceEnv.baseUrl,
      apiKey: sourceEnv.apiKey,
      auth: sourceEnv.auth ? JSON.parse(JSON.stringify(sourceEnv.auth)) : undefined,
      variables: sourceEnv.variables ? { ...sourceEnv.variables } : {},
      headers: sourceEnv.headers ? { ...sourceEnv.headers } : {},
      inheritsFrom: sourceEnv.inheritsFrom,
      notes: sourceEnv.notes,
      profileId: sourceEnv.profileId,
    };

    state.environments[targetName] = clonedEnv;
    this.save(state);
    return { name: targetName, env: clonedEnv };
  }

  // --- Collections & Folders ---
  public getCollections(): Collection[] {
    return this.getState().collections;
  }

  public getCollection(idOrName?: string): Collection | undefined {
    if (!idOrName) return undefined;
    return this.getState().collections.find((c) => c.id === idOrName || c.name === idOrName);
  }

  public createCollection(name: string, profileId?: string): Collection {
    const state = this.getState();
    const newCol: Collection = {
      id: this.generateId('col'),
      name: name.trim() || 'New Collection',
      baseUrlDisabled: true,
      folders: [],
      requests: [],
      profileId,
    };
    state.collections.push(newCol);
    this.save(state);
    return newCol;
  }

  public saveCollection(collection: Collection): void {
    const state = this.getState();
    const idx = state.collections.findIndex((c) => c.id === collection.id);
    if (idx >= 0) {
      state.collections[idx] = collection;
    } else {
      state.collections.push(collection);
    }
    this.save(state);
  }

  public deleteCollection(idOrName: string): boolean {
    const state = this.getState();
    const initialLen = state.collections.length;
    state.collections = state.collections.filter((c) => c.id !== idOrName && c.name !== idOrName);
    if (state.collections.length !== initialLen) {
      this.save(state);
      return true;
    }
    return false;
  }

  public createFolder(collectionIdOrName: string, folderName: string): CollectionFolder | undefined {
    const state = this.getState();
    const col = state.collections.find((c) => c.id === collectionIdOrName || c.name === collectionIdOrName);
    if (!col) return undefined;

    const newFolder: CollectionFolder = {
      id: this.generateId('folder'),
      name: folderName.trim() || 'New Folder',
      baseUrlDisabled: true,
      requests: [],
      headers: {},
      variables: {},
    };
    col.folders.push(newFolder);
    this.save(state);
    return newFolder;
  }

  public deleteFolder(collectionIdOrName: string, folderIdOrName: string): boolean {
    const state = this.getState();
    const col = state.collections.find((c) => c.id === collectionIdOrName || c.name === collectionIdOrName);
    if (!col) return false;

    const initialLen = col.folders.length;
    col.folders = col.folders.filter((f) => f.id !== folderIdOrName && f.name !== folderIdOrName);
    if (col.folders.length !== initialLen) {
      this.save(state);
      return true;
    }
    return false;
  }

  // --- Reordering & Drag-and-Drop Management ---
  public reorderCollection(
    sourceIdOrName: string,
    targetIdOrName: string,
    position: 'before' | 'after' = 'before'
  ): boolean {
    const state = this.getState();
    const sourceIdx = state.collections.findIndex((c) => c.id === sourceIdOrName || c.name === sourceIdOrName);
    const targetIdx = state.collections.findIndex((c) => c.id === targetIdOrName || c.name === targetIdOrName);
    if (sourceIdx < 0 || targetIdx < 0 || sourceIdx === targetIdx) return false;

    const [movedCol] = state.collections.splice(sourceIdx, 1);
    let newTargetIdx = state.collections.findIndex((c) => c.id === targetIdOrName || c.name === targetIdOrName);
    if (newTargetIdx < 0) return false;
    if (position === 'after') {
      newTargetIdx++;
    }
    state.collections.splice(newTargetIdx, 0, movedCol);
    this.save(state);
    return true;
  }

  public moveCollectionToEnd(sourceIdOrName: string): boolean {
    const state = this.getState();
    const sourceIdx = state.collections.findIndex((c) => c.id === sourceIdOrName || c.name === sourceIdOrName);
    if (sourceIdx < 0 || sourceIdx === state.collections.length - 1) return false;

    const [movedCol] = state.collections.splice(sourceIdx, 1);
    state.collections.push(movedCol);
    this.save(state);
    return true;
  }

  public reorderFolder(
    collectionIdOrName: string,
    sourceFolderIdOrName: string,
    targetFolderIdOrName: string,
    position: 'before' | 'after' = 'before'
  ): boolean {
    const state = this.getState();
    const col = state.collections.find((c) => c.id === collectionIdOrName || c.name === collectionIdOrName);
    if (!col) return false;

    const sourceIdx = col.folders.findIndex((f) => f.id === sourceFolderIdOrName || f.name === sourceFolderIdOrName);
    const targetIdx = col.folders.findIndex((f) => f.id === targetFolderIdOrName || f.name === targetFolderIdOrName);
    if (sourceIdx < 0 || targetIdx < 0 || sourceIdx === targetIdx) return false;

    const [movedFolder] = col.folders.splice(sourceIdx, 1);
    let newTargetIdx = col.folders.findIndex((f) => f.id === targetFolderIdOrName || f.name === targetFolderIdOrName);
    if (newTargetIdx < 0) return false;
    if (position === 'after') {
      newTargetIdx++;
    }
    col.folders.splice(newTargetIdx, 0, movedFolder);
    this.save(state);
    return true;
  }

  public moveFolderToCollection(
    sourceFolderIdOrName: string,
    targetCollectionIdOrName: string,
    targetFolderIdOrName?: string,
    position: 'before' | 'after' = 'after'
  ): boolean {
    const state = this.getState();
    let sourceCol: Collection | undefined;
    let folderIdx = -1;

    for (const c of state.collections) {
      const idx = c.folders.findIndex((f) => f.id === sourceFolderIdOrName || f.name === sourceFolderIdOrName);
      if (idx >= 0) {
        sourceCol = c;
        folderIdx = idx;
        break;
      }
    }
    if (!sourceCol || folderIdx < 0) return false;

    const targetCol = state.collections.find((c) => c.id === targetCollectionIdOrName || c.name === targetCollectionIdOrName);
    if (!targetCol) return false;

    if (sourceCol.id === targetCol.id && targetFolderIdOrName) {
      return this.reorderFolder(sourceCol.id, sourceFolderIdOrName, targetFolderIdOrName, position === 'after' ? 'after' : 'before');
    }

    const [movedFolder] = sourceCol.folders.splice(folderIdx, 1);

    // Update child requests' collection reference
    movedFolder.requests.forEach((r) => {
      r.collection = targetCol.name;
      r.collectionId = targetCol.id;
      r.folder = movedFolder.name;
      r.folderId = movedFolder.id;
    });

    if (targetFolderIdOrName) {
      const targetIdx = targetCol.folders.findIndex((f) => f.id === targetFolderIdOrName || f.name === targetFolderIdOrName);
      if (targetIdx >= 0) {
        const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
        targetCol.folders.splice(insertIdx, 0, movedFolder);
      } else {
        targetCol.folders.push(movedFolder);
      }
    } else {
      targetCol.folders.push(movedFolder);
    }

    this.save(state);
    return true;
  }

  public moveRequest(
    requestId: string,
    targetCollectionIdOrName: string,
    targetFolderIdOrName?: string,
    targetRequestId?: string,
    position: 'before' | 'after' = 'before'
  ): boolean {
    const state = this.getState();
    let foundReq: RequestItem | undefined;

    // 1. Find and remove request from current location
    for (const col of state.collections) {
      const rootIdx = col.requests.findIndex((r) => r.id === requestId);
      if (rootIdx >= 0) {
        [foundReq] = col.requests.splice(rootIdx, 1);
        break;
      }
      for (const folder of col.folders) {
        const fIdx = folder.requests.findIndex((r) => r.id === requestId);
        if (fIdx >= 0) {
          [foundReq] = folder.requests.splice(fIdx, 1);
          break;
        }
      }
      if (foundReq) break;
    }

    if (!foundReq) return false;

    // 2. Locate target collection
    const targetCol = state.collections.find((c) => c.id === targetCollectionIdOrName || c.name === targetCollectionIdOrName);
    if (!targetCol) return false;

    foundReq.collection = targetCol.name;
    foundReq.collectionId = targetCol.id;

    // 3. Insert into target folder or collection root
    if (targetFolderIdOrName && targetFolderIdOrName !== 'Root') {
      const targetFolder = targetCol.folders.find((f) => f.id === targetFolderIdOrName || f.name === targetFolderIdOrName);
      if (!targetFolder) return false;

      foundReq.folder = targetFolder.name;
      foundReq.folderId = targetFolder.id;

      if (targetRequestId && targetRequestId !== requestId) {
        const targetIdx = targetFolder.requests.findIndex((r) => r.id === targetRequestId);
        if (targetIdx >= 0) {
          const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
          targetFolder.requests.splice(insertIdx, 0, foundReq);
        } else {
          targetFolder.requests.push(foundReq);
        }
      } else {
        targetFolder.requests.push(foundReq);
      }
    } else {
      // Root of collection
      foundReq.folder = undefined;
      foundReq.folderId = undefined;

      if (targetRequestId && targetRequestId !== requestId) {
        const targetIdx = targetCol.requests.findIndex((r) => r.id === targetRequestId);
        if (targetIdx >= 0) {
          const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
          targetCol.requests.splice(insertIdx, 0, foundReq);
        } else {
          targetCol.requests.push(foundReq);
        }
      } else {
        targetCol.requests.push(foundReq);
      }
    }

    this.save(state);
    return true;
  }

  public moveItemUp(kind: SidebarNodeKind, itemId: string, parentId?: string): boolean {
    const state = this.getState();
    if (kind === 'collection') {
      const idx = state.collections.findIndex((c) => c.id === itemId);
      if (idx > 0) {
        const [col] = state.collections.splice(idx, 1);
        state.collections.splice(idx - 1, 0, col);
        this.save(state);
        return true;
      }
    } else if (kind === 'folder') {
      for (const col of state.collections) {
        const idx = col.folders.findIndex((f) => f.id === itemId);
        if (idx > 0) {
          const [f] = col.folders.splice(idx, 1);
          col.folders.splice(idx - 1, 0, f);
          this.save(state);
          return true;
        }
      }
    } else if (kind === 'request') {
      for (const col of state.collections) {
        const rootIdx = col.requests.findIndex((r) => r.id === itemId);
        if (rootIdx > 0) {
          const [r] = col.requests.splice(rootIdx, 1);
          col.requests.splice(rootIdx - 1, 0, r);
          this.save(state);
          return true;
        }
        for (const folder of col.folders) {
          const fIdx = folder.requests.findIndex((r) => r.id === itemId);
          if (fIdx > 0) {
            const [r] = folder.requests.splice(fIdx, 1);
            folder.requests.splice(fIdx - 1, 0, r);
            this.save(state);
            return true;
          }
        }
      }
    }
    return false;
  }

  public moveItemDown(kind: SidebarNodeKind, itemId: string, parentId?: string): boolean {
    const state = this.getState();
    if (kind === 'collection') {
      const idx = state.collections.findIndex((c) => c.id === itemId);
      if (idx >= 0 && idx < state.collections.length - 1) {
        const [col] = state.collections.splice(idx, 1);
        state.collections.splice(idx + 1, 0, col);
        this.save(state);
        return true;
      }
    } else if (kind === 'folder') {
      for (const col of state.collections) {
        const idx = col.folders.findIndex((f) => f.id === itemId);
        if (idx >= 0 && idx < col.folders.length - 1) {
          const [f] = col.folders.splice(idx, 1);
          col.folders.splice(idx + 1, 0, f);
          this.save(state);
          return true;
        }
      }
    } else if (kind === 'request') {
      for (const col of state.collections) {
        const rootIdx = col.requests.findIndex((r) => r.id === itemId);
        if (rootIdx >= 0 && rootIdx < col.requests.length - 1) {
          const [r] = col.requests.splice(rootIdx, 1);
          col.requests.splice(rootIdx + 1, 0, r);
          this.save(state);
          return true;
        }
        for (const folder of col.folders) {
          const fIdx = folder.requests.findIndex((r) => r.id === itemId);
          if (fIdx >= 0 && fIdx < folder.requests.length - 1) {
            const [r] = folder.requests.splice(fIdx, 1);
            folder.requests.splice(fIdx + 1, 0, r);
            this.save(state);
            return true;
          }
        }
      }
    }
    return false;
  }

  // --- Requests CRUD ---
  public getRequest(requestId: string): { request: RequestItem; collection: Collection; folder?: CollectionFolder } | undefined {
    const state = this.getState();
    for (const collection of state.collections) {
      const rootReq = collection.requests.find((r) => r.id === requestId);
      if (rootReq) {
        return { request: rootReq, collection };
      }
      for (const folder of collection.folders) {
        const folderReq = folder.requests.find((r) => r.id === requestId);
        if (folderReq) {
          return { request: folderReq, collection, folder };
        }
      }
    }
    return undefined;
  }

  public saveRequest(request: RequestItem, targetCollectionNameOrId?: string, targetFolderNameOrId?: string): RequestItem {
    const state = this.getState();
    const colName = targetCollectionNameOrId || request.collection || state.collections[0]?.name || 'Demo Collection';
    let collection = state.collections.find((c) => c.id === colName || c.name === colName);

    if (!collection) {
      collection = {
        id: `col-${Date.now()}`,
        name: colName,
        folders: [],
        requests: [],
      };
      state.collections.push(collection);
    }

    const folderName = targetFolderNameOrId || request.folder;
    const hasFolder = folderName && folderName !== 'Root' && folderName.trim() !== '';

    const normalizedRequest: RequestItem = {
      ...request,
      id: request.id || `req-${Date.now()}`,
      name: request.name?.trim() || `${request.method} ${request.url || 'Untitled'}`,
      method: (request.method || 'GET').toUpperCase(),
      collection: collection.name,
      collectionId: collection.id,
      folder: hasFolder ? folderName : undefined,
    };

    if (hasFolder) {
      let folder = collection.folders.find((f) => f.id === folderName || f.name === folderName);
      if (!folder) {
        folder = {
          id: `folder-${Date.now()}`,
          name: folderName,
          requests: [],
        };
        collection.folders.push(folder);
      }
      normalizedRequest.folderId = folder.id;
      normalizedRequest.folder = folder.name;

      // Update in folder
      const reqIdx = folder.requests.findIndex((r) => r.id === normalizedRequest.id);
      if (reqIdx >= 0) {
        folder.requests[reqIdx] = normalizedRequest;
      } else {
        folder.requests.push(normalizedRequest);
      }

      // Remove from root if previously there
      collection.requests = collection.requests.filter((r) => r.id !== normalizedRequest.id);
    } else {
      normalizedRequest.folder = undefined;
      normalizedRequest.folderId = undefined;

      // Update in root
      const reqIdx = collection.requests.findIndex((r) => r.id === normalizedRequest.id);
      if (reqIdx >= 0) {
        collection.requests[reqIdx] = normalizedRequest;
      } else {
        collection.requests.push(normalizedRequest);
      }

      // Remove from any folder if previously there
      collection.folders.forEach((f) => {
        f.requests = f.requests.filter((r) => r.id !== normalizedRequest.id);
      });
    }

    this.save(state);
    return normalizedRequest;
  }

  public deleteRequest(requestId: string): boolean {
    const state = this.getState();
    let deleted = false;

    for (const col of state.collections) {
      const initRoot = col.requests.length;
      col.requests = col.requests.filter((r) => r.id !== requestId);
      if (col.requests.length !== initRoot) {
        deleted = true;
      }
      for (const folder of col.folders) {
        const initFolder = folder.requests.length;
        folder.requests = folder.requests.filter((r) => r.id !== requestId);
        if (folder.requests.length !== initFolder) {
          deleted = true;
        }
      }
    }

    if (deleted) {
      this.save(state);
    }
    return deleted;
  }

  public cloneRequest(
    requestId: string,
    newName?: string,
    targetCollectionId?: string,
    targetFolderId?: string
  ): RequestItem | undefined {
    const found = this.getRequest(requestId);
    if (!found) return undefined;

    let targetName: string;
    if (newName && newName.trim()) {
      targetName = newName.trim();
    } else {
      targetName = `${found.request.name} (Copy)`;
    }

    const copy: RequestItem = {
      ...JSON.parse(JSON.stringify(found.request)),
      id: this.generateId('req'),
      name: targetName,
    };

    const colId = targetCollectionId || found.collection.id;
    const fId = targetFolderId !== undefined ? targetFolderId : found.folder?.id;

    return this.saveRequest(copy, colId, fId);
  }

  public duplicateRequest(requestId: string): RequestItem | undefined {
    return this.cloneRequest(requestId);
  }

  public renameRequest(requestId: string, newName: string): RequestItem | undefined {
    const found = this.getRequest(requestId);
    if (!found) return undefined;
    found.request.name = newName.trim();
    return this.saveRequest(found.request, found.collection.id, found.folder?.id);
  }

  // --- History Isolated from Collections ---
  public getHistory(): RecentRequest[] {
    return this.getState().history;
  }

  public getHistoryItem(id: string): RecentRequest | undefined {
    return this.getState().history.find((h) => h.id === id);
  }

  public recordHistory(
    request: RequestItem,
    meta?: Partial<ResponseMetadata> & { resolvedUrl?: string }
  ): RecentRequest {
    const state = this.getState();

    // Memory protection: truncate response body if larger than 100KB (102400 chars)
    let bodyToStore = meta?.body;
    if (bodyToStore && bodyToStore.length > 102400) {
      bodyToStore = bodyToStore.substring(0, 102400) + '\n\n... [Response body truncated (> 100 KB) for history storage]';
    }

    const historyEntry: RecentRequest = {
      ...request,
      id: this.generateId('history'),
      timestamp: new Date().toISOString(),
      resolvedUrl: meta?.resolvedUrl || request.url,
      responseStatus: meta?.status,
      responseStatusText: meta?.statusText,
      elapsedMs: meta?.elapsedMs,
      responseSizeBytes: meta?.sizeBytes,
      responseHeaders: meta?.headers,
      responseBody: bodyToStore,
      responseOk: meta?.ok,
    };

    // Filter out previous immediate exact duplicate
    const filtered = state.history.filter(
      (entry) =>
        !(
          entry.method === historyEntry.method &&
          entry.url === historyEntry.url &&
          entry.collection === historyEntry.collection &&
          entry.folder === historyEntry.folder
        )
    );

    // Prepend and cap at 50
    state.history = [historyEntry, ...filtered].slice(0, 50);
    this.save(state);
    return historyEntry;
  }

  public clearHistory(): void {
    const state = this.getState();
    state.history = [];
    this.save(state);
  }

  public deleteHistoryItem(id: string): boolean {
    const state = this.getState();
    const initialLen = state.history.length;
    state.history = state.history.filter((h) => h.id !== id);
    if (state.history.length !== initialLen) {
      this.save(state);
      return true;
    }
    return false;
  }

  // --- Generic Delete Item for Context Menus ---
  public deleteItem(kind: SidebarNodeKind, id: string, parentId?: string): boolean {
    switch (kind) {
      case 'profile':
        return this.deleteProfile(id);
      case 'environment':
        return this.deleteEnvironment(id);
      case 'collection':
        return this.deleteCollection(id);
      case 'folder':
        return parentId ? this.deleteFolder(parentId, id) : false;
      case 'request':
        return this.deleteRequest(id);
      case 'history':
        return this.deleteHistoryItem(id);
      default:
        return false;
    }
  }
}

