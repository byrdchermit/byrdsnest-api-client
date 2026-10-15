import { AuthSettings, ProfileAuth } from '../types';
import { BlueByrdStateManager } from '../state/stateManager';
import { TokenService } from './tokenService';

export class AuthService {
  private readonly stateManager: BlueByrdStateManager;
  private readonly tokenService?: TokenService;

  constructor(stateManager: BlueByrdStateManager, tokenService?: TokenService) {
    this.stateManager = stateManager;
    this.tokenService = tokenService;
  }

  /**
   * Resolves authentication headers based on request, folder, collection, environment, and profile settings.
   */
  public resolveAuthHeaders(
    profileNameOrId?: string,
    environmentNameOrId?: string,
    collectionNameOrId?: string,
    folderNameOrId?: string,
    existingHeaders: Record<string, string> = {},
    requestAuth?: AuthSettings
  ): Record<string, string> {
    const merged = { ...existingHeaders };

    // Retrieve hierarchy sources first so applyAuth has profile & environment context
    const profile = this.stateManager.getProfile(profileNameOrId);
    const environment = this.stateManager.getEnvironment(environmentNameOrId);
    const collection = this.stateManager.getCollection(collectionNameOrId);
    const folder = collection && folderNameOrId
      ? collection.folders.find((f) => f.id === folderNameOrId || f.name === folderNameOrId)
      : undefined;

    const globalProfile = this.stateManager.getProfile('global');

    const findCaseInsensitiveKey = (obj: Record<string, string> | undefined, targetKey: string): string | undefined => {
      if (!obj) return undefined;
      const lower = targetKey.toLowerCase();
      return Object.keys(obj).find((k) => k.toLowerCase() === lower);
    };

    // Scope ranks: 0 = global, 1 = profile, 2 = collection, 3 = folder, 4 = environment, 5 = request
    const canApplyAuthHeader = (headerName: string, authScopeRank: number): boolean => {
      if (authScopeRank >= 5) {
        return true;
      }

      // Check if any strictly higher scope explicitly defines this header in its .headers
      if (authScopeRank < 2 && findCaseInsensitiveKey(collection?.headers, headerName)) {
        return false;
      }
      if (authScopeRank < 3 && findCaseInsensitiveKey(folder?.headers, headerName)) {
        return false;
      }
      if (authScopeRank < 4 && findCaseInsensitiveKey(environment?.headers, headerName)) {
        return false;
      }

      // Check if existingHeaders already contains this header from a higher scope (e.g. Request headers override)
      const existingKey = findCaseInsensitiveKey(merged, headerName);
      if (existingKey !== undefined) {
        let lowerScopeVal: string | undefined;
        const gKey = findCaseInsensitiveKey(globalProfile?.headers, headerName);
        if (gKey !== undefined) lowerScopeVal = globalProfile!.headers![gKey];
        if (authScopeRank >= 1) {
          const pKey = findCaseInsensitiveKey(profile?.headers, headerName);
          if (pKey !== undefined) lowerScopeVal = profile!.headers![pKey];
        }
        if (authScopeRank >= 2) {
          const cKey = findCaseInsensitiveKey(collection?.headers, headerName);
          if (cKey !== undefined) lowerScopeVal = collection!.headers![cKey];
        }
        if (authScopeRank >= 3) {
          const fKey = findCaseInsensitiveKey(folder?.headers, headerName);
          if (fKey !== undefined) lowerScopeVal = folder!.headers![fKey];
        }
        if (authScopeRank >= 4) {
          const eKey = findCaseInsensitiveKey(environment?.headers, headerName);
          if (eKey !== undefined) lowerScopeVal = environment!.headers![eKey];
        }
        if (lowerScopeVal === undefined || merged[existingKey] !== lowerScopeVal) {
          return false;
        }
      }

      return true;
    };

    const setMergedHeader = (headerName: string, value: string, authScopeRank: number) => {
      if (!canApplyAuthHeader(headerName, authScopeRank)) {
        return;
      }
      const existingKey = findCaseInsensitiveKey(merged, headerName);
      if (existingKey && existingKey !== headerName) {
        delete merged[existingKey];
      }
      merged[headerName] = value;
    };

    const applyAuth = (auth: ProfileAuth | undefined, authScopeRank: number) => {
      if (!auth || auth.type === 'none') {
        return;
      }

      if (auth.type === 'bearer' || auth.type === 'oauth2') {
        let tokenValue = auth.token?.trim() ?? '';
        if (auth.selectedTokenId && this.tokenService) {
          const found = this.tokenService.getAllTokens().find((t) => t.id === auth.selectedTokenId);
          if (found && found.accessToken) {
            tokenValue = found.accessToken;
          }
        }
        if (!tokenValue && auth.type === 'oauth2' && this.tokenService) {
          const stored = this.tokenService.getValidTokenSync(
            profile?.id || profileNameOrId || 'global',
            environment?.id || environmentNameOrId
          );
          if (stored) {
            tokenValue = stored.accessToken;
          }
        }
        if (!tokenValue) return;
        const header = auth.headerName?.trim() || 'Authorization';
        const prefix = auth.headerPrefix !== undefined && auth.headerPrefix !== '' ? auth.headerPrefix.trim() : 'Bearer';
        setMergedHeader(header, prefix ? `${prefix} ${tokenValue}` : tokenValue, authScopeRank);
      } else if (auth.type === 'apiKey') {
        const tokenValue = auth.token?.trim() ?? '';
        if (!tokenValue) return;
        const header = (auth.headerName && auth.headerName !== 'Authorization' ? auth.headerName.trim() : undefined) || auth.keyName?.trim() || auth.headerName?.trim() || 'X-API-Key';
        setMergedHeader(header, tokenValue, authScopeRank);
      } else if (auth.type === 'basic') {
        const header = auth.headerName?.trim() || 'Authorization';
        const user = auth.username ?? '';
        const pass = auth.password ?? auth.token ?? '';
        if (user || pass) {
          const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
          setMergedHeader(header, `Basic ${encoded}`, authScopeRank);
        }
      }
    };

    // Check request-level override
    if (requestAuth?.auth && requestAuth.auth.type !== 'none') {
      applyAuth(requestAuth.auth, 5);
      return merged;
    }

    // Determine inheritance permissions
    const inheritProfile = requestAuth?.inheritFromProfile !== false;
    const inheritEnvironment = requestAuth?.inheritFromEnvironment !== false;
    const inheritCollection = requestAuth?.inheritFromCollection !== false;
    const inheritFolder = requestAuth?.inheritFromFolder !== false;

    // 1. Folder level
    const folderAuthObj = (folder?.auth as any)?.auth || (folder?.auth as any);
    const folderInheritsCollection = (folder?.auth as any)?.inheritFromCollection !== false;
    if (inheritFolder && folderAuthObj && folderAuthObj.type && folderAuthObj.type !== 'none') {
      applyAuth(folderAuthObj, 3);
      return merged;
    }

    // 2. Collection level
    const colAuthObj = (collection?.auth as any)?.auth || (collection?.auth as any);
    const allowCollection = inheritCollection && (folder ? folderInheritsCollection : true);
    if (allowCollection && colAuthObj && colAuthObj.type && colAuthObj.type !== 'none') {
      applyAuth(colAuthObj, 2);
      return merged;
    }

    // 3. Environment level
    if (inheritEnvironment && environment?.auth && environment.auth.type !== 'none') {
      applyAuth(environment.auth, 4);
      return merged;
    }

    // 4. Profile level
    if (inheritProfile && profile?.auth && profile.auth.type !== 'none') {
      applyAuth(profile.auth, 1);
      return merged;
    }

    // 5. Shared / Global fallback
    const globalAuth = (this.stateManager as any).getSharedGlobalAuth ? (this.stateManager as any).getSharedGlobalAuth() : undefined;
    if (inheritProfile && globalAuth && globalAuth.type && globalAuth.type !== 'none') {
      applyAuth(globalAuth, 0);
      return merged;
    }

    if (inheritProfile) {
      if (globalProfile?.auth && globalProfile.auth.type !== 'none') {
        applyAuth(globalProfile.auth, 0);
        return merged;
      }
    }

    return merged;
  }
}

