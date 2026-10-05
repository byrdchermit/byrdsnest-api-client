import * as vscode from 'vscode';

export type SidebarNodeKind =
  | 'section'
  | 'active-filter'
  | 'profile'
  | 'environment'
  | 'collection'
  | 'folder'
  | 'request'
  | 'history'
  | 'token'
  | 'noTokens';

export interface StoredToken {
  id: string;
  profileId: string;
  profileName?: string;
  envName?: string;
  envId?: string;
  tokenName?: string;
  tier?: string;
  accessToken: string;
  tokenType?: string;
  refreshToken?: string;
  expiresAt: number;
  createdAt: number;
  scopes?: string[];
  configHash?: string;
  source?: 'oauth2' | 'manual' | 'script' | 'vault';
  sourceUrl?: string;
  clientId?: string;
}

export type RequestContext = {
  id?: string;
  requestId?: string;
  profile?: string;
  profileId?: string;
  environment?: string;
  environmentId?: string;
  collection?: string;
  collectionId?: string;
  folder?: string;
  folderId?: string;
  requestName?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyType?: BodyType;
  bodyFormData?: FormDataItem[];
  auth?: AuthSettings;
  notes?: string;
  variables?: VariableItem[];
  preRequestScript?: string;
  postResponseScript?: string;
  baseUrlPreference?: 'collection' | 'environment' | 'none';
};

export type BodyType = 'none' | 'json' | 'form-urlencoded' | 'form-data' | 'text' | 'xml' | 'raw';

export type FormDataItem = {
  key: string;
  value: string;
  enabled: boolean;
  type?: 'text' | 'file';
};

export type VariableItem = {
  name: string;
  value: string;
  enabled: boolean;
  hidden?: boolean;
};

export type ProfileAuth = {
  type: 'none' | 'bearer' | 'apiKey' | 'oauth2' | 'basic';
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
  redirectUri?: string;
  pkce?: boolean;
  scopes?: string[];
  grantType?: 'authorization_code' | 'client_credentials' | 'implicit' | 'password';
  selectedTokenId?: string;
};

export type AuthSettings = {
  inheritFromProfile?: boolean;
  inheritFromEnvironment?: boolean;
  inheritFromCollection?: boolean;
  inheritFromFolder?: boolean;
  auth?: ProfileAuth;
};

export type RequestItem = {
  id: string;
  name: string;
  method: string;
  url: string;
  folder?: string;
  folderId?: string;
  collection: string;
  collectionId?: string;
  headers: Record<string, string>;
  body: string;
  bodyType?: BodyType;
  bodyFormData?: FormDataItem[];
  profile?: string;
  environment?: string;
  auth?: AuthSettings;
  notes?: string;
  variables?: VariableItem[];
  preRequestScript?: string;
  postResponseScript?: string;
  baseUrlPreference?: 'collection' | 'environment' | 'none';
};

export type TestResultItem = {
  name: string;
  passed: boolean;
  error?: string;
};

export type ScriptConsoleLog = {
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
};

export type CollectionFolder = {
  id: string;
  name: string;
  requests: RequestItem[];
  auth?: AuthSettings;
  notes?: string;
  variables?: Record<string, string>;
  headers?: Record<string, string>;
  inheritsFrom?: string;
  baseUrl?: string;
  baseUrlDisabled?: boolean;
  baseUrlPreference?: 'collection' | 'environment';
  preferCollectionBaseUrl?: boolean;
};

export type Collection = {
  id: string;
  name: string;
  folders: CollectionFolder[];
  requests: RequestItem[];
  auth?: AuthSettings;
  notes?: string;
  variables?: Record<string, string>;
  headers?: Record<string, string>;
  inheritsFrom?: string;
  profileId?: string;
  baseUrl?: string;
  baseUrlDisabled?: boolean;
  baseUrlPreference?: 'collection' | 'environment';
  preferCollectionBaseUrl?: boolean;
};

export type ResponseMetadata = {
  ok: boolean;
  status: number;
  statusText: string;
  elapsedMs: number;
  sizeBytes?: number;
  headers: Record<string, string>;
  body: string;
  testResults?: TestResultItem[];
  consoleLogs?: ScriptConsoleLog[];
};

export type RecentRequest = RequestItem & {
  timestamp: string;
  responseStatus?: number;
  responseStatusText?: string;
  elapsedMs?: number;
  resolvedUrl?: string;
  responseSizeBytes?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseOk?: boolean;
  testResults?: TestResultItem[];
  consoleLogs?: ScriptConsoleLog[];
};

export interface ProfileGuardConfig {
  enabled?: boolean;
  warnBeforeSend?: boolean;
  warnMessage?: string;
  blockedMethods?: string[];
  requireKeywordConfirmation?: boolean;
  confirmationKeyword?: string;
}

export type Profile = {
  id: string;
  name: string;
  color?: string;
  auth: ProfileAuth;
  variables?: Record<string, string>;
  headers?: Record<string, string>;
  inheritsFrom?: string;
  notes?: string;
  guards?: ProfileGuardConfig;
};

export interface ProfileColorPalette {
  name: string;
  value: string;
}

export const DEFAULT_PROFILE_COLORS: ProfileColorPalette[] = [
  { name: 'Dev Green', value: '#10b981' },
  { name: 'Staging Amber', value: '#f59e0b' },
  { name: 'Prod Red', value: '#ef4444' },
  { name: 'Ocean Blue', value: '#3b82f6' },
  { name: 'Royal Purple', value: '#8b5cf6' },
  { name: 'Cyber Cyan', value: '#06b6d4' },
  { name: 'Slate Gray', value: '#64748b' },
];

export type EnvironmentConfig = {
  id: string;
  baseUrl: string;
  baseUrlDisabled?: boolean;
  apiKey?: string;
  auth?: ProfileAuth;
  variables?: Record<string, string>;
  headers?: Record<string, string>;
  inheritsFrom?: string;
  notes?: string;
  profileId?: string;
};

export interface AppSettings {
  baseUrlPreference?: 'collection' | 'environment' | 'auto' | 'none';
  requestTimeoutMs?: number;
  followRedirects?: boolean;
  rejectUnauthorized?: boolean;
}

export type AppState = {
  profiles: Profile[];
  environments: Record<string, EnvironmentConfig>;
  collections: Collection[];
  history: RecentRequest[];
  activeProfileId?: string;
  activeEnvironmentName?: string;
  settings?: AppSettings;
  globalProfile?: Profile;
};

export type VariableSourceKind =
  | 'profile'
  | 'parent-environment'
  | 'environment'
  | 'collection'
  | 'folder'
  | 'dynamic';

export type InheritedVariableInfo = {
  key: string;
  value: string;
  source: VariableSourceKind;
  sourceName: string;
  isOverridden?: boolean;
};

export interface VariableResolutionResult {
  resolved: Record<string, string>;
  inherited: InheritedVariableInfo[];
  overriddenKeys: string[];
}

export type HeaderSourceKind =
  | 'profile'
  | 'parent-environment'
  | 'environment'
  | 'collection'
  | 'folder';

export type InheritedHeaderInfo = {
  key: string;
  value: string;
  source: HeaderSourceKind;
  sourceName: string;
  isOverridden?: boolean;
};

export interface HeaderResolutionResult {
  merged: Record<string, string>;
  inherited: InheritedHeaderInfo[];
  overriddenKeys: string[];
}

