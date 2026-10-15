import * as crypto from 'crypto';
import {
  Collection,
  CollectionFolder,
  EnvironmentConfig,
  HeaderResolutionResult,
  InheritedHeaderInfo,
  InheritedVariableInfo,
  Profile,
  RequestContext,
  RequestItem,
  VariableItem,
  VariableResolutionResult,
} from '../types';
import { BlueByrdStateManager } from '../state/stateManager';

export class VariableService {
  private readonly stateManager: BlueByrdStateManager;

  constructor(stateManager: BlueByrdStateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Retrieves the environment inheritance chain from root ancestor to active environment.
   * e.g., if Local inherits from Dev, and Dev inherits from Base:
   * returns [Base, Dev, Local]
   */
  public getEnvironmentChain(environmentNameOrId?: string): EnvironmentConfig[] {
    if (!environmentNameOrId) return [];
    const chain: EnvironmentConfig[] = [];
    const visited = new Set<string>();

    let current = this.stateManager.getEnvironment(environmentNameOrId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.unshift(current);
      if (current.inheritsFrom) {
        current = this.stateManager.getEnvironment(current.inheritsFrom);
      } else {
        break;
      }
    }
    return chain;
  }

  /**
   * Resolves dynamic variable tokens like $uuid, $timestamp, $isoDate, $randomInt, $date:format.
   */
  public resolveDynamic(key: string, rowIndex = 0): string | null {
    if (key === '$uuid') {
      return crypto.randomUUID();
    }
    if (key === '$timestamp') {
      return String(Date.now());
    }
    if (key === '$isoDate') {
      return new Date().toISOString();
    }
    if (key === '$rowIndex') {
      return String(rowIndex);
    }
    if (key.startsWith('$rowIndex:')) {
      const pad = Math.min(20, Math.max(1, parseInt(key.slice(10), 10) || 1));
      return String(rowIndex).padStart(pad, '0');
    }
    if (key.startsWith('$randomInt:')) {
      const n = Math.min(20, Math.max(1, parseInt(key.slice(11), 10) || 6));
      let digits = '';
      for (let i = 0; i < n; i++) {
        digits += Math.floor(Math.random() * 10);
      }
      return digits;
    }
    if (key === '$randomInt') {
      let digits = '';
      for (let i = 0; i < 6; i++) {
        digits += Math.floor(Math.random() * 10);
      }
      return digits;
    }
    if (key.startsWith('$date:')) {
      const fmt = key.slice(6);
      const d = new Date();
      return fmt
        .replace(/yyyy/g, String(d.getFullYear()))
        .replace(/yy/g, String(d.getFullYear()).slice(-2))
        .replace(/MM/g, String(d.getMonth() + 1).padStart(2, '0'))
        .replace(/dd/g, String(d.getDate()).padStart(2, '0'))
        .replace(/HH/g, String(d.getHours()).padStart(2, '0'))
        .replace(/mm/g, String(d.getMinutes()).padStart(2, '0'))
        .replace(/ss/g, String(d.getSeconds()).padStart(2, '0'));
    }
    return null;
  }

  /**
   * Coerces whole-token "{{VAR}}" in JSON to real booleans or null
   * if the resolved variable is "true", "false", or "null".
   */
  public coerceTypedVarTokens(text: string, variables: Record<string, string>): string {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/"(\{\{[^}]+\}\})"/g, (match, innerToken) => {
      const key = innerToken.slice(2, -2).trim();
      let val = variables[key];
      if (val === undefined && key.startsWith('$')) {
        const dyn = this.resolveDynamic(key);
        if (dyn !== null) val = dyn;
      }
      if (val === undefined) return match;

      const trimmed = val == null ? '' : String(val).trim();
      if (trimmed === '' || /^null$/i.test(trimmed)) return 'null';
      if (/^true$/i.test(trimmed)) return 'true';
      if (/^false$/i.test(trimmed)) return 'false';
      return match;
    });
  }

  /**
   * Resolves the combined dictionary of variables taking into account the full inheritance hierarchy:
   * Profile -> Collection -> Folder -> Environment Chain (Parent -> Child, including baseUrl and apiKey) -> Request
   * Higher levels in the chain override lower levels (Environment overrides Collection/Folder defaults).
   */
  public resolveVariables(
    profileNameOrId?: string,
    environmentNameOrId?: string,
    collectionNameOrId?: string,
    folderNameOrId?: string,
    requestVariables?: VariableItem[] | Record<string, string>,
    baseUrlPreference?: 'collection' | 'environment' | 'none'
  ): Record<string, string> {
    const detail = this.resolveVariablesDetailed(
      profileNameOrId,
      environmentNameOrId,
      collectionNameOrId,
      folderNameOrId,
      requestVariables,
      baseUrlPreference
    );
    return detail.resolved;
  }

  /**
   * Resolves variables with full transparency on where each variable originated.
   */
  public resolveVariablesDetailed(
    profileNameOrId?: string,
    environmentNameOrId?: string,
    collectionNameOrId?: string,
    folderNameOrId?: string,
    requestVariables?: VariableItem[] | Record<string, string>,
    baseUrlPreference?: 'collection' | 'environment' | 'none'
  ): VariableResolutionResult {
    const resolved: Record<string, string> = {};
    const inherited: InheritedVariableInfo[] = [];

    // 0. Built-in dynamic variables info
    const dynamicSamples = [
      { key: '$uuid', sample: 'Auto UUID v4' },
      { key: '$timestamp', sample: 'Epoch Milliseconds' },
      { key: '$isoDate', sample: 'ISO 8601 Timestamp' },
      { key: '$randomInt:6', sample: 'Random 6-digit int' },
      { key: '$date:yyyy-MM-dd', sample: 'Formatted Date' },
    ];
    dynamicSamples.forEach((ds) => {
      inherited.push({
        key: ds.key,
        value: ds.sample,
        source: 'dynamic',
        sourceName: 'Built-in Dynamic',
      });
    });

    // 1a. Shared / Global profile variables (universal defaults)
    const globalProfile = this.stateManager.getProfile('global');
    if (globalProfile?.variables) {
      Object.entries(globalProfile.variables).forEach(([k, v]) => {
        if (k && v !== undefined) {
          const val = String(v);
          resolved[k] = val;
          inherited.push({
            key: k,
            value: val,
            source: 'profile',
            sourceName: 'Shared / Global',
          });
        }
      });
    }

    // 1b. Active/Target Profile variables (overrides Shared / Global)
    const activePid = this.stateManager.getActiveProfileId();
    const targetProfileId = (profileNameOrId && profileNameOrId !== 'all') ? profileNameOrId : (activePid !== 'all' ? activePid : undefined);
    let activeProfile: Profile | undefined;
    if (targetProfileId && targetProfileId !== 'global') {
      activeProfile = this.stateManager.getProfile(targetProfileId);
      const prof = activeProfile;
      if (prof?.variables) {
        Object.entries(prof.variables).forEach(([k, v]) => {
          if (k && v !== undefined) {
            const val = String(v);
            resolved[k] = val;
            inherited.push({
              key: k,
              value: val,
              source: 'profile',
              sourceName: `Profile: ${prof.name}`,
            });
          }
        });
      }
    }

    // 2. Collection variables & dedicated collection baseUrl
    const collection = this.stateManager.getCollection(collectionNameOrId);
    let collectionBaseUrl: string | undefined;
    let preferCollectionBaseUrl = false;

    if (collection) {
      if (!collection.baseUrlDisabled) {
        if (collection.baseUrl && collection.baseUrl.trim()) {
          collectionBaseUrl = collection.baseUrl.trim().replace(/\/+$/, '');
        } else if (collection.variables?.['baseUrl'] && collection.variables['baseUrl'].trim()) {
          collectionBaseUrl = collection.variables['baseUrl'].trim().replace(/\/+$/, '');
        }
      }

      if (baseUrlPreference) {
        preferCollectionBaseUrl = baseUrlPreference === 'collection';
      } else if (collection.baseUrlPreference) {
        preferCollectionBaseUrl = collection.baseUrlPreference === 'collection';
      } else if (collection.preferCollectionBaseUrl !== undefined) {
        preferCollectionBaseUrl = !!collection.preferCollectionBaseUrl;
      }

      if (collectionBaseUrl) {
        resolved['collectionBaseUrl'] = collectionBaseUrl;
        if (baseUrlPreference !== 'none') {
          resolved['baseUrl'] = collectionBaseUrl;
          inherited.push({
            key: 'baseUrl',
            value: collectionBaseUrl,
            source: 'collection',
            sourceName: `Collection: ${collection.name}`,
          });
        }
      } else if (collection.baseUrlDisabled && (collection.baseUrl || collection.variables?.['baseUrl'])) {
        inherited.push({
          key: 'baseUrl',
          value: collection.baseUrl || collection.variables?.['baseUrl'] || '',
          source: 'collection',
          sourceName: `Collection: ${collection.name} (Disabled)`,
          isOverridden: true,
        });
      }

      if (collection.variables) {
        Object.entries(collection.variables).forEach(([k, v]) => {
          if (k && v !== undefined && k !== 'baseUrl') {
            const val = String(v);
            resolved[k] = val;
            inherited.push({
              key: k,
              value: val,
              source: 'collection',
              sourceName: `Collection: ${collection!.name}`,
            });
          }
        });
      }
    }

    // 3. Folder variables (folder defaults)
    let folder: CollectionFolder | undefined;
    if (collection && folderNameOrId) {
      folder = collection.folders.find(
        (f) => f.id === folderNameOrId || f.name === folderNameOrId
      );
      if (folder) {
        let folderBaseUrl: string | undefined;
        if (!folder.baseUrlDisabled) {
          if (folder.baseUrl && folder.baseUrl.trim()) {
            folderBaseUrl = folder.baseUrl.trim().replace(/\/+$/, '');
          } else if (folder.variables?.['baseUrl'] && folder.variables['baseUrl'].trim()) {
            folderBaseUrl = folder.variables['baseUrl'].trim().replace(/\/+$/, '');
          }
        }

        if (folderBaseUrl) {
          collectionBaseUrl = folderBaseUrl;
          if (folder.baseUrlPreference) {
            preferCollectionBaseUrl = folder.baseUrlPreference === 'collection';
          } else if (folder.preferCollectionBaseUrl !== undefined) {
            preferCollectionBaseUrl = !!folder.preferCollectionBaseUrl;
          }
          resolved['collectionBaseUrl'] = folderBaseUrl;
          if (baseUrlPreference !== 'none') {
            resolved['baseUrl'] = folderBaseUrl;
            inherited.push({
              key: 'baseUrl',
              value: folderBaseUrl,
              source: 'folder',
              sourceName: `Folder: ${folder.name}`,
            });
          }
        }

        if (folder.variables) {
          Object.entries(folder.variables).forEach(([k, v]) => {
            if (k && v !== undefined && k !== 'baseUrl') {
              const val = String(v);
              resolved[k] = val;
              inherited.push({
                key: k,
                value: val,
                source: 'folder',
                sourceName: `Folder: ${folder!.name}`,
              });
            }
          });
        }
      }
    }

    // 4. Environment chain (parent environments first, active environment last - overrides collection/folder defaults)
    const envChain = this.getEnvironmentChain(environmentNameOrId);
    envChain.forEach((env, index) => {
      const isParent = index < envChain.length - 1;
      const envName = this.stateManager.getEnvironmentName(env.id) || env.id;
      const sourceKind = isParent ? 'parent-environment' : 'environment';
      const sourceLabel = isParent ? `Parent Env: ${envName}` : `Env: ${envName}`;

      if (!env.baseUrlDisabled && env.baseUrl && env.baseUrl.trim()) {
        const val = env.baseUrl.trim().replace(/\/+$/, '');
        resolved['envBaseUrl'] = val;

        if (baseUrlPreference === 'none') {
          // Base URL preference is disabled for this request
          inherited.push({
            key: 'baseUrl',
            value: val,
            source: sourceKind,
            sourceName: sourceLabel,
            isOverridden: true,
          });
        } else if (preferCollectionBaseUrl && collectionBaseUrl) {
          // Collection explicitly preferred over Environment baseUrl
          inherited.push({
            key: 'baseUrl',
            value: val,
            source: sourceKind,
            sourceName: sourceLabel,
            isOverridden: true,
          });
        } else {
          resolved['baseUrl'] = val;
          inherited.push({
            key: 'baseUrl',
            value: val,
            source: sourceKind,
            sourceName: sourceLabel,
          });
        }
      } else if (env.baseUrlDisabled && env.baseUrl) {
        inherited.push({
          key: 'baseUrl',
          value: env.baseUrl,
          source: sourceKind,
          sourceName: `${sourceLabel} (Disabled)`,
          isOverridden: true,
        });
      }
      if (env.apiKey && env.apiKey.trim()) {
        const val = env.apiKey.trim();
        resolved['apiKey'] = val;
        inherited.push({
          key: 'apiKey',
          value: val,
          source: sourceKind,
          sourceName: sourceLabel,
        });
      }
      if (env.variables) {
        Object.entries(env.variables).forEach(([k, v]) => {
          if (k && v !== undefined) {
            // Do not push duplicate baseUrl or apiKey if already handled from top-level env properties
            if (k === 'baseUrl' && env.baseUrl && env.baseUrl.trim()) {
              return;
            }
            if (k === 'apiKey' && env.apiKey && env.apiKey.trim()) {
              return;
            }
            const val = String(v);
            resolved[k] = val;
            inherited.push({
              key: k,
              value: val,
              source: sourceKind,
              sourceName: sourceLabel,
            });
          }
        });
      }
    });

    // 4b. Re-evaluate collection / folder baseUrl if it references {{baseUrl}}, {{envBaseUrl}}, or environment variables
    const underlyingBaseUrl = resolved['envBaseUrl'] || activeProfile?.variables?.['baseUrl'] || '';
    if (collectionBaseUrl && (collectionBaseUrl.includes('{{') || collectionBaseUrl.startsWith(':') || (collectionBaseUrl.startsWith('/') && !collectionBaseUrl.startsWith('//')))) {
      let expandedColBaseUrl = collectionBaseUrl;
      if (expandedColBaseUrl.startsWith(':') && underlyingBaseUrl) {
        expandedColBaseUrl = `${underlyingBaseUrl}${expandedColBaseUrl}`;
      } else if (expandedColBaseUrl.startsWith('/') && !expandedColBaseUrl.startsWith('//') && underlyingBaseUrl) {
        expandedColBaseUrl = `${underlyingBaseUrl}${expandedColBaseUrl}`;
      } else {
        if (underlyingBaseUrl) {
          expandedColBaseUrl = expandedColBaseUrl
            .replace(/\{\{baseUrl\}\}/g, underlyingBaseUrl)
            .replace(/\{\{envBaseUrl\}\}/g, underlyingBaseUrl);
        }
        if (expandedColBaseUrl.includes('{{')) {
          expandedColBaseUrl = this.interpolate(expandedColBaseUrl, {
            ...resolved,
            baseUrl: underlyingBaseUrl,
            envBaseUrl: underlyingBaseUrl,
          });
        }
      }
      collectionBaseUrl = expandedColBaseUrl.trim().replace(/\/+$/, '');
      resolved['collectionBaseUrl'] = collectionBaseUrl;
      if (preferCollectionBaseUrl && baseUrlPreference !== 'none') {
        resolved['baseUrl'] = collectionBaseUrl;
      }
      for (const inh of inherited) {
        if ((inh.source === 'collection' || inh.source === 'folder') && inh.key === 'baseUrl') {
          inh.value = collectionBaseUrl;
        }
      }
    }

    // Also re-evaluate resolved['baseUrl'] if it was set by a collection/folder variable referencing {{baseUrl}} or {{envBaseUrl}}
    if (resolved['baseUrl'] && (resolved['baseUrl'].includes('{{baseUrl}}') || resolved['baseUrl'].includes('{{envBaseUrl}}') || resolved['baseUrl'].startsWith(':'))) {
      if (resolved['baseUrl'].startsWith(':') && underlyingBaseUrl) {
        resolved['baseUrl'] = `${underlyingBaseUrl}${resolved['baseUrl']}`;
      } else {
        if (underlyingBaseUrl) {
          resolved['baseUrl'] = resolved['baseUrl']
            .replace(/\{\{baseUrl\}\}/g, underlyingBaseUrl)
            .replace(/\{\{envBaseUrl\}\}/g, underlyingBaseUrl);
        }
        if (resolved['baseUrl'].includes('{{')) {
          resolved['baseUrl'] = this.interpolate(resolved['baseUrl'], {
            ...resolved,
            baseUrl: underlyingBaseUrl,
            envBaseUrl: underlyingBaseUrl,
          });
        }
      }
      resolved['baseUrl'] = resolved['baseUrl'].trim().replace(/\/+$/, '');
      for (const inh of inherited) {
        if (inh.key === 'baseUrl' && !inh.isOverridden) {
          inh.value = resolved['baseUrl'];
        }
      }
    }

    // 5. Request-level variables (highest precedence)
    const overriddenKeys: string[] = [];
    if (Array.isArray(requestVariables)) {
      requestVariables.forEach((item) => {
        if (item.enabled && item.name?.trim()) {
          const k = item.name.trim();
          resolved[k] = item.value ?? '';
          overriddenKeys.push(k);
        }
      });
    } else if (requestVariables && typeof requestVariables === 'object') {
      Object.entries(requestVariables).forEach(([k, v]) => {
        if (k && v !== undefined) {
          resolved[k] = String(v);
          overriddenKeys.push(k);
        }
      });
    }

    // Mark inherited items as overridden if a higher level (or request) overrides them
    const seenActiveKeys = new Set<string>(overriddenKeys);
    for (let i = inherited.length - 1; i >= 0; i--) {
      if (inherited[i].source === 'dynamic') continue;
      const k = inherited[i].key;

      // If this item was already marked overridden/disabled when added (e.g. baseUrlDisabled, disabled tier),
      // preserve it as overridden and DO NOT add to seenActiveKeys so it cannot hide an enabled lower tier.
      if (inherited[i].isOverridden) {
        continue;
      }

      if (seenActiveKeys.has(k) || resolved[k] !== inherited[i].value) {
        inherited[i].isOverridden = true;
      } else {
        // This is the active winning source for key k
        seenActiveKeys.add(k);
      }
    }

    return {
      resolved,
      inherited,
      overriddenKeys,
    };
  }

  /**
   * Resolves the combined headers from Profile -> Collection -> Folder -> Parent Environments -> Active Environment -> Request.
   * Handles case-insensitive header overriding (Environment overrides Collection/Folder defaults).
   */
  public resolveHeaders(
    environmentNameOrId?: string,
    collectionNameOrId?: string,
    folderNameOrId?: string,
    requestHeaders?: Record<string, string>,
    profileNameOrId?: string
  ): Record<string, string> {
    const detail = this.resolveHeadersDetailed(
      environmentNameOrId,
      collectionNameOrId,
      folderNameOrId,
      requestHeaders,
      profileNameOrId
    );
    return detail.merged;
  }

  /**
   * Resolves headers with full traceability of origin for inspector UI.
   */
  public resolveHeadersDetailed(
    environmentNameOrId?: string,
    collectionNameOrId?: string,
    folderNameOrId?: string,
    requestHeaders: Record<string, string> = {},
    profileNameOrId?: string
  ): HeaderResolutionResult {
    const merged: Record<string, string> = {};
    const inherited: InheritedHeaderInfo[] = [];

    const setHeader = (key: string, value: string) => {
      const lower = key.toLowerCase();
      for (const existingKey of Object.keys(merged)) {
        if (existingKey.toLowerCase() === lower) {
          delete merged[existingKey];
          break;
        }
      }
      merged[key] = value;
    };

    const extractAuthHeaderEntry = (authObj: any): { key: string; value: string } | undefined => {
      const auth = authObj?.auth || authObj;
      if (!auth || !auth.type || auth.type === 'none') {
        return undefined;
      }
      if (auth.type === 'bearer' || auth.type === 'oauth2') {
        const tokenValue = auth.token?.trim() ?? '';
        if (!tokenValue) return undefined;
        const header = auth.headerName?.trim() || 'Authorization';
        const prefix = auth.headerPrefix !== undefined && auth.headerPrefix !== '' ? auth.headerPrefix.trim() : 'Bearer';
        return { key: header, value: prefix ? `${prefix} ${tokenValue}` : tokenValue };
      } else if (auth.type === 'apiKey') {
        const tokenValue = auth.token?.trim() ?? '';
        if (!tokenValue) return undefined;
        const header = (auth.headerName && auth.headerName !== 'Authorization' ? auth.headerName.trim() : undefined) || auth.keyName?.trim() || auth.headerName?.trim() || 'X-API-Key';
        return { key: header, value: tokenValue };
      } else if (auth.type === 'basic') {
        const header = auth.headerName?.trim() || 'Authorization';
        const user = auth.username ?? '';
        const pass = auth.password ?? auth.token ?? '';
        if (user || pass) {
          const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
          return { key: header, value: `Basic ${encoded}` };
        }
      }
      return undefined;
    };

    // 0a. Shared / Global profile headers (universal defaults)
    const globalProfile = this.stateManager.getProfile('global');
    if (globalProfile?.headers) {
      Object.entries(globalProfile.headers).forEach(([k, v]) => {
        if (k && v !== undefined) {
          setHeader(k, String(v));
          inherited.push({
            key: k,
            value: String(v),
            source: 'profile',
            sourceName: 'Shared / Global',
          });
        }
      });
    }
    const globalAuthEntry = extractAuthHeaderEntry(globalProfile?.auth);
    if (globalAuthEntry) {
      inherited.push({
        key: globalAuthEntry.key,
        value: globalAuthEntry.value,
        source: 'profile',
        sourceName: 'Shared / Global (Auth)',
      });
    }

    // 0b. Active/Target Profile headers (overrides Shared / Global)
    const activePid = this.stateManager.getActiveProfileId();
    const targetProfileId = (profileNameOrId && profileNameOrId !== 'all') ? profileNameOrId : (activePid !== 'all' ? activePid : undefined);
    if (targetProfileId && targetProfileId !== 'global') {
      const profile = this.stateManager.getProfile(targetProfileId);
      if (profile?.headers) {
        Object.entries(profile.headers).forEach(([k, v]) => {
          if (k && v !== undefined) {
            setHeader(k, String(v));
            inherited.push({
              key: k,
              value: String(v),
              source: 'profile',
              sourceName: `Profile: ${profile.name}`,
            });
          }
        });
      }
      const profileAuthEntry = extractAuthHeaderEntry(profile?.auth);
      if (profile && profileAuthEntry) {
        inherited.push({
          key: profileAuthEntry.key,
          value: profileAuthEntry.value,
          source: 'profile',
          sourceName: `Profile: ${profile.name} (Auth)`,
        });
      }
    }

    // 1. Collection headers (collection defaults)
    const collection = this.stateManager.getCollection(collectionNameOrId);
    if (collection?.headers) {
      Object.entries(collection.headers).forEach(([k, v]) => {
        if (k && v !== undefined) {
          setHeader(k, String(v));
          inherited.push({
            key: k,
            value: String(v),
            source: 'collection',
            sourceName: `Collection: ${collection.name}`,
          });
        }
      });
    }
    const colAuthEntry = extractAuthHeaderEntry(collection?.auth);
    if (collection && colAuthEntry) {
      inherited.push({
        key: colAuthEntry.key,
        value: colAuthEntry.value,
        source: 'collection',
        sourceName: `Collection: ${collection.name} (Auth)`,
      });
    }

    // 2. Folder headers (folder defaults)
    if (collection && folderNameOrId) {
      const folder = collection.folders.find(
        (f) => f.id === folderNameOrId || f.name === folderNameOrId
      );
      if (folder?.headers) {
        Object.entries(folder.headers).forEach(([k, v]) => {
          if (k && v !== undefined) {
            setHeader(k, String(v));
            inherited.push({
              key: k,
              value: String(v),
              source: 'folder',
              sourceName: `Folder: ${folder.name}`,
            });
          }
        });
      }
      const folderAuthEntry = extractAuthHeaderEntry(folder?.auth);
      if (folder && folderAuthEntry) {
        inherited.push({
          key: folderAuthEntry.key,
          value: folderAuthEntry.value,
          source: 'folder',
          sourceName: `Folder: ${folder.name} (Auth)`,
        });
      }
    }

    // 3. Environment chain (parent environments first, active environment last - overrides collection/folder defaults)
    const envChain = this.getEnvironmentChain(environmentNameOrId);
    envChain.forEach((env, index) => {
      const isParent = index < envChain.length - 1;
      const envName = this.stateManager.getEnvironmentName(env.id) || env.id;
      const sourceKind = isParent ? 'parent-environment' : 'environment';
      const sourceLabel = isParent ? `Parent Env: ${envName}` : `Env: ${envName}`;

      if (env.headers) {
        Object.entries(env.headers).forEach(([k, v]) => {
          if (k && v !== undefined) {
            setHeader(k, String(v));
            inherited.push({
              key: k,
              value: String(v),
              source: sourceKind,
              sourceName: sourceLabel,
            });
          }
        });
      }
      const envAuthEntry = extractAuthHeaderEntry(env.auth);
      if (envAuthEntry) {
        inherited.push({
          key: envAuthEntry.key,
          value: envAuthEntry.value,
          source: sourceKind,
          sourceName: `${sourceLabel} (Auth)`,
        });
      }
    });

    // 4. Request headers (highest precedence)
    const overriddenKeys: string[] = [];
    const requestKeyLowers = new Set(Object.keys(requestHeaders).map((k) => k.toLowerCase()));

    Object.entries(requestHeaders).forEach(([k, v]) => {
      if (k && v !== undefined) {
        setHeader(k, String(v));
        overriddenKeys.push(k);
      }
    });

    // Mark overridden in inherited headers (traversing from highest precedence to lowest)
    const seenLowerKeys = new Set<string>(requestKeyLowers);
    for (let i = inherited.length - 1; i >= 0; i--) {
      if (inherited[i].isOverridden) {
        continue;
      }
      const lower = inherited[i].key.toLowerCase();
      if (seenLowerKeys.has(lower)) {
        inherited[i].isOverridden = true;
      } else {
        seenLowerKeys.add(lower);
      }
    }

    return {
      merged,
      inherited,
      overriddenKeys,
    };
  }

  /**
   * Replaces all occurrences of {{variableName}} in input text using the provided variables and dynamic tokens.
   */
  public interpolate(text: string, variables: Record<string, string>, maxDepth = 5): string {
    if (!text || typeof text !== 'string') {
      return text;
    }

    let result = text;
    let depth = 0;
    const varPattern = /\{\{([a-zA-Z0-9_\-.:$]+)\}\}/g;

    while (depth < maxDepth && varPattern.test(result)) {
      varPattern.lastIndex = 0;
      result = result.replace(varPattern, (match, key) => {
        if (key.startsWith('$')) {
          const dyn = this.resolveDynamic(key);
          if (dyn !== null) return dyn;
        }
        if (Object.prototype.hasOwnProperty.call(variables, key)) {
          return variables[key];
        }
        return match;
      });
      depth++;
    }

    return result;
  }

  /**
   * Interpolates an entire request: URL, Headers (both key and value), and Body.
   */
  public interpolateRequest(
    request: {
      url: string;
      headers: Record<string, string>;
      body?: string;
    },
    variables: Record<string, string>
  ): {
    url: string;
    headers: Record<string, string>;
    body?: string;
  } {
    const url = this.interpolate(request.url, variables);

    const headers: Record<string, string> = {};
    Object.entries(request.headers || {}).forEach(([rawKey, rawValue]) => {
      const key = this.interpolate(rawKey, variables);
      const val = this.interpolate(rawValue, variables);
      if (key) {
        headers[key] = val;
      }
    });

    let body = request.body;
    if (body) {
      body = this.coerceTypedVarTokens(body, variables);
      body = this.interpolate(body, variables);
    }

    return { url, headers, body };
  }
}
