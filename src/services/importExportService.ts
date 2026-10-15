import * as crypto from 'crypto';
import {
  AppState,
  AuthSettings,
  BodyType,
  Collection,
  CollectionFolder,
  EnvironmentConfig,
  FormDataItem,
  OpenApiBodyDoc,
  OpenApiOperationDocs,
  OpenApiParameterDoc,
  OpenApiResponseDoc,
  OpenApiResponseHeaderDoc,
  OpenApiSchemaPropertyDoc,
  OpenApiSecurityDoc,
  Profile,
  ProfileAuth,
  RequestItem,
  VariableItem,
} from '../types';

export type ParsedImportResult =
  | { type: 'postman-collection'; collection: Collection }
  | { type: 'postman-environment'; environmentName: string; environment: EnvironmentConfig }
  | { type: 'openapi'; collection: Collection }
  | { type: 'byrdsnest-collection'; collection: Collection }
  | { type: 'bluebyrd-collection'; collection: Collection }
  | { type: 'byrdsnest-environment'; environmentName: string; environment: EnvironmentConfig }
  | { type: 'bluebyrd-environment'; environmentName: string; environment: EnvironmentConfig }
  | { type: 'byrdsnest-backup'; state: AppState }
  | { type: 'bluebyrd-backup'; state: AppState };

export class ImportExportService {
  private static generateId(prefix: string): string {
    const rand = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${Date.now()}-${rand}`;
  }

  // ==========================================
  // Public Parsing & Import Detection
  // ==========================================

  public static parse(jsonStr: string): ParsedImportResult {
    let data: any;
    try {
      data = JSON.parse(jsonStr);
    } catch (err: any) {
      throw new Error(`Invalid JSON file: ${err?.message || 'JSON parse error'}`);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Invalid input: Expected a JSON object.');
    }

    // 1. Native backup
    if (this.isBlueByrdBackup(data)) {
      const isLegacy = data.bluebyrdBackupVersion !== undefined && data.byrdsnestBackupVersion === undefined;
      return {
        type: isLegacy ? 'bluebyrd-backup' : 'byrdsnest-backup',
        state: this.parseBlueByrdBackup(data),
      };
    }

    // 2. Native single collection
    if (this.isBlueByrdCollection(data)) {
      const isLegacy = data.kind === 'bluebyrd.collection';
      return {
        type: isLegacy ? 'bluebyrd-collection' : 'byrdsnest-collection',
        collection: this.parseBlueByrdCollection(data),
      };
    }

    // 3. Native single environment
    if (this.isBlueByrdEnvironment(data)) {
      const { name, env } = this.parseBlueByrdEnvironment(data);
      const isLegacy = data.kind === 'bluebyrd.environment';
      return {
        type: isLegacy ? 'bluebyrd-environment' : 'byrdsnest-environment',
        environmentName: name,
        environment: env,
      };
    }

    // 4. Postman Collection v2 / v2.1
    if (this.isPostmanCollection(data)) {
      return {
        type: 'postman-collection',
        collection: this.parsePostmanCollection(data),
      };
    }

    // 5. Postman Environment
    if (this.isPostmanEnvironment(data)) {
      const { name, env } = this.parsePostmanEnvironment(data);
      return {
        type: 'postman-environment',
        environmentName: name,
        environment: env,
      };
    }

    // 6. OpenAPI 3.0 or Swagger 2.0
    if (this.isOpenApi(data)) {
      return {
        type: 'openapi',
        collection: this.parseOpenApi(data),
      };
    }

    throw new Error(
      'Unrecognized format: Expected a Postman Collection (v2/v2.1), Postman Environment, OpenAPI/Swagger document, or bluebyrd JSON backup.'
    );
  }

  // ==========================================
  // cURL Command Parser
  // ==========================================

  public static parseCurl(curlCommand: string): {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
    bodyType: BodyType;
  } {
    const raw = curlCommand.replace(/\\\r?\n/g, ' ').trim();
    if (!raw.toLowerCase().startsWith('curl')) {
      throw new Error('Command must start with "curl"');
    }

    let method = 'GET';
    const headers: Record<string, string> = {};
    let body = '';
    let url = '';

    // Regex token matcher for flags, double-quoted, single-quoted, and unquoted arguments
    const tokenRegex = /(-[A-Za-z0-9-]+|--[A-Za-z0-9-]+)|"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
    const tokens: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(raw)) !== null) {
      if (match[1]) {
        tokens.push(match[1]);
      } else if (match[2] !== undefined) {
        tokens.push(match[2].replace(/\\"/g, '"'));
      } else if (match[3] !== undefined) {
        tokens.push(match[3].replace(/\\'/g, "'"));
      } else if (match[4]) {
        tokens.push(match[4]);
      }
    }

    let i = 1;
    let explicitMethod = false;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token === '-X' || token === '--request') {
        i++;
        if (i < tokens.length) {
          method = tokens[i].toUpperCase();
          explicitMethod = true;
        }
      } else if (token === '-H' || token === '--header') {
        i++;
        if (i < tokens.length) {
          const headerStr = tokens[i];
          const colonIdx = headerStr.indexOf(':');
          if (colonIdx > 0) {
            const hKey = headerStr.substring(0, colonIdx).trim();
            const hVal = headerStr.substring(colonIdx + 1).trim();
            headers[hKey] = hVal;
          }
        }
      } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
        i++;
        if (i < tokens.length) {
          body = tokens[i];
          if (!explicitMethod) {
            method = 'POST';
          }
        }
      } else if (token.startsWith('http://') || token.startsWith('https://') || token.startsWith('{{')) {
        url = token;
      } else if (!token.startsWith('-') && !url && i > 1) {
        url = token;
      }
      i++;
    }

    let bodyType: BodyType = 'none';
    if (body) {
      bodyType = 'raw';
      try {
        JSON.parse(body);
        bodyType = 'json';
      } catch {
        const ct = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
        if (ct && headers[ct].includes('application/x-www-form-urlencoded')) {
          bodyType = 'form-urlencoded';
        }
      }
    }

    return {
      url: url || '',
      method,
      headers,
      body,
      bodyType
    };
  }

  // ==========================================
  // Format Detectors
  // ==========================================

  private static isBlueByrdBackup(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    if (data.byrdsnestBackupVersion !== undefined || data.bluebyrdBackupVersion !== undefined) return true;
    if (
      Array.isArray(data.collections) &&
      (Array.isArray(data.environments) || (data.environments && typeof data.environments === 'object'))
    ) {
      return true;
    }
    return false;
  }

  private static isBlueByrdCollection(data: any): boolean {
    if (data.kind === 'byrdsnest.collection' || data.kind === 'bluebyrd.collection') return true;
    return (
      typeof data.name === 'string' &&
      !data.info &&
      (Array.isArray(data.folders) || Array.isArray(data.requests))
    );
  }

  private static isBlueByrdEnvironment(data: any): boolean {
    if (data.kind === 'byrdsnest.environment' || data.kind === 'bluebyrd.environment') return true;
    if (data.info || data.openapi || data.swagger) return false;
    if (Array.isArray(data.collections)) return false;
    return (
      (typeof data.name === 'string' || typeof data.baseUrl === 'string') &&
      ((data.variables !== undefined && typeof data.variables === 'object') || Array.isArray(data.variables)) &&
      !data.values
    );
  }

  private static isPostmanCollection(data: any): boolean {
    return Boolean(
      data.info &&
        typeof data.info === 'object' &&
        (Array.isArray(data.item) ||
          data.info._postman_id ||
          (typeof data.info.schema === 'string' && data.info.schema.includes('postman')))
    );
  }

  private static isPostmanEnvironment(data: any): boolean {
    return Boolean(
      typeof data.name === 'string' &&
        Array.isArray(data.values) &&
        (data._postman_variable_scope === 'environment' ||
          data.values.length === 0 ||
          data.values.some((v: any) => v && typeof v === 'object' && 'key' in v))
    );
  }

  private static isOpenApi(data: any): boolean {
    return Boolean(data.openapi || data.swagger || (data.info && data.paths));
  }

  // ==========================================
  // Postman Collection Parser
  // ==========================================

  private static parsePostmanAuth(authObj: any): ProfileAuth {
    if (!authObj || authObj.type === 'noauth') {
      return { type: 'none' };
    }

    const findVal = (arr: any[], key: string): string => {
      const match = (arr || []).find((x: any) => x?.key === key);
      return match ? String(match.value ?? '') : '';
    };

    const type = authObj.type;
    if (type === 'bearer') {
      return {
        type: 'bearer',
        token: findVal(authObj.bearer, 'token'),
        headerName: 'Authorization',
        headerPrefix: 'Bearer',
      };
    }

    if (type === 'basic') {
      return {
        type: 'basic',
        username: findVal(authObj.basic, 'username'),
        password: findVal(authObj.basic, 'password'),
      };
    }

    if (type === 'apikey') {
      const keyName = findVal(authObj.apikey, 'key');
      const token = findVal(authObj.apikey, 'value');
      const addToRaw = findVal(authObj.apikey, 'in') || 'header';
      return {
        type: 'apiKey',
        keyName: keyName || 'X-API-Key',
        headerName: keyName || 'X-API-Key',
        token,
        addTo: addToRaw === 'query' ? 'query' : 'header',
      };
    }

    if (type === 'oauth2') {
      return {
        type: 'oauth2',
        grantType: (findVal(authObj.oauth2, 'grant_type') as any) || 'client_credentials',
        clientId: findVal(authObj.oauth2, 'clientId'),
        clientSecret: findVal(authObj.oauth2, 'clientSecret'),
        authorizationUrl: findVal(authObj.oauth2, 'authUrl'),
        tokenUrl: findVal(authObj.oauth2, 'accessTokenUrl'),
        scopes: findVal(authObj.oauth2, 'scope')
          ? findVal(authObj.oauth2, 'scope').split(/[\s,]+/).filter(Boolean)
          : [],
        headerPrefix: 'Bearer',
      };
    }

    return { type: 'none' };
  }

  private static parsePostmanUrl(urlInput: any): string {
    if (!urlInput) return '';
    if (typeof urlInput === 'string') {
      return urlInput.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, '{{$1}}');
    }

    let raw = urlInput.raw || '';
    if (!raw && Array.isArray(urlInput.host)) {
      const protocol = urlInput.protocol ? `${urlInput.protocol}://` : 'https://';
      const host = urlInput.host.join('.');
      const pathPart = Array.isArray(urlInput.path) ? '/' + urlInput.path.join('/') : '';
      raw = `${protocol}${host}${pathPart}`;
      if (Array.isArray(urlInput.query) && urlInput.query.length > 0) {
        const queryParams = urlInput.query
          .filter((q: any) => !q.disabled && q.key)
          .map((q: any) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value ?? '')}`)
          .join('&');
        if (queryParams) {
          raw += `?${queryParams}`;
        }
      }
    }

    // Convert :param syntax into {{param}}
    return raw.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, '{{$1}}');
  }

  private static parsePostmanItem(
    item: any,
    collectionName: string,
    collectionId: string,
    folderName?: string,
    folderId?: string
  ): RequestItem {
    const req = item.request || {};
    const url = this.parsePostmanUrl(req.url);
    const method = (req.method || 'GET').toUpperCase();

    // Extract headers
    const headers: Record<string, string> = {};
    if (Array.isArray(req.header)) {
      for (const h of req.header) {
        if (!h.disabled && h.key && this.isSafeKey(h.key)) {
          headers[h.key] = h.value ?? '';
        }
      }
    }

    // Extract body
    let body = '';
    let bodyType: BodyType = 'none';
    const bodyFormData: FormDataItem[] = [];

    if (req.body) {
      const mode = req.body.mode;
      if (mode === 'raw') {
        body = req.body.raw || '';
        const lang = req.body.options?.raw?.language;
        if (lang === 'json' || body.trim().startsWith('{') || body.trim().startsWith('[')) {
          bodyType = 'json';
        } else if (lang === 'xml' || body.trim().startsWith('<')) {
          bodyType = 'xml';
        } else {
          bodyType = 'text';
        }
      } else if (mode === 'urlencoded' && Array.isArray(req.body.urlencoded)) {
        bodyType = 'form-urlencoded';
        body = req.body.urlencoded
          .filter((u: any) => !u.disabled && u.key)
          .map((u: any) => `${encodeURIComponent(u.key)}=${encodeURIComponent(u.value ?? '')}`)
          .join('&');
      } else if (mode === 'formdata' && Array.isArray(req.body.formdata)) {
        bodyType = 'form-data';
        for (const fd of req.body.formdata) {
          if (fd.key) {
            bodyFormData.push({
              key: fd.key,
              value: fd.type === 'file' ? (fd.src || '') : (fd.value ?? ''),
              enabled: !fd.disabled,
              type: fd.type === 'file' ? 'file' : 'text',
            });
          }
        }
      }
    }

    // Extract auth
    let auth: AuthSettings | undefined;
    if (req.auth) {
      if (req.auth.type === 'noauth') {
        auth = { auth: { type: 'none' } };
      } else {
        auth = { auth: this.parsePostmanAuth(req.auth) };
      }
    }

    // Extract notes
    const notes = typeof req.description === 'string'
      ? req.description
      : req.description?.content || '';

    return {
      id: this.generateId('req'),
      name: item.name || 'Untitled Request',
      method,
      url,
      headers,
      body,
      bodyType,
      bodyFormData: bodyFormData.length > 0 ? bodyFormData : undefined,
      collection: collectionName,
      collectionId,
      folder: folderName,
      folderId,
      auth,
      notes,
    };
  }

  private static parsePostmanCollection(data: any): Collection {
    const colId = this.generateId('col');
    const colName = data.info?.name || 'Imported Postman Collection';
    const notes = typeof data.info?.description === 'string'
      ? data.info.description
      : data.info?.description?.content || '';

    // Variables
    const variables: Record<string, string> = {};
    if (Array.isArray(data.variable)) {
      for (const v of data.variable) {
        if (!v.disabled && v.key) {
          variables[v.key] = String(v.value ?? '');
        }
      }
    }

    // Auth
    let auth: AuthSettings | undefined;
    if (data.auth) {
      auth = { auth: this.parsePostmanAuth(data.auth) };
    }

    const folders: CollectionFolder[] = [];
    const rootRequests: RequestItem[] = [];

    // Helper to traverse postman items (which can contain nested sub-items)
    const traverse = (items: any[], currentFolderName?: string, currentFolderId?: string) => {
      for (const item of items) {
        if (Array.isArray(item.item)) {
          // It's a folder
          const subFolderName = currentFolderName ? `${currentFolderName} / ${item.name}` : (item.name || 'Folder');
          const subFolderId = this.generateId('folder');
          const folderRequests: RequestItem[] = [];

          // Collect direct requests inside this folder
          for (const sub of item.item) {
            if (!Array.isArray(sub.item) && sub.request) {
              folderRequests.push(
                this.parsePostmanItem(sub, colName, colId, subFolderName, subFolderId)
              );
            }
          }

          folders.push({
            id: subFolderId,
            name: subFolderName,
            requests: folderRequests,
          });

          // Check if there are deeper subfolders
          const nestedFolders = item.item.filter((sub: any) => Array.isArray(sub.item));
          if (nestedFolders.length > 0) {
            traverse(nestedFolders, subFolderName, subFolderId);
          }
        } else if (item.request) {
          // Root request
          rootRequests.push(
            this.parsePostmanItem(item, colName, colId, undefined, undefined)
          );
        }
      }
    };

    traverse(data.item || []);

    return {
      id: colId,
      name: colName,
      folders,
      requests: rootRequests,
      variables,
      auth,
      notes,
    };
  }

  // ==========================================
  // Postman Environment Parser
  // ==========================================

  private static parsePostmanEnvironment(data: any): { name: string; env: EnvironmentConfig } {
    const name = data.name || 'Imported Environment';
    const envId = this.generateId('env');
    const variables: Record<string, string> = {};
    let baseUrl = 'https://api.example.com';

    if (Array.isArray(data.values)) {
      for (const v of data.values) {
        if (!v || v.enabled === false || !v.key || !this.isSafeKey(v.key)) continue;
        const val = String(v.value ?? '');
        variables[v.key] = val;
        const lowerKey = v.key.toLowerCase();
        if (lowerKey === 'baseurl' || lowerKey === 'base_url' || lowerKey === 'url' || lowerKey === 'host') {
          if (val.startsWith('http://') || val.startsWith('https://')) {
            baseUrl = val;
          }
        }
      }
    }

    const env: EnvironmentConfig = {
      id: envId,
      baseUrl,
      variables,
      headers: {},
      notes: `Imported from Postman Environment '${name}'`,
    };

    return { name, env };
  }

  // ==========================================
  // OpenAPI 3.0 / 3.1 & Swagger 2.0 Parser
  // ==========================================

  private static resolveRef(ref: string, rootDoc: any): any {
    if (!ref || typeof ref !== 'string' || !ref.startsWith('#/') || !rootDoc) {
      return null;
    }
    const parts = ref
      .substring(2)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let curr: any = rootDoc;
    for (const part of parts) {
      if (curr && typeof curr === 'object' && part in curr) {
        curr = curr[part];
      } else {
        return null;
      }
    }
    return curr;
  }

  private static extractRefName(schema: any): string | undefined {
    if (!schema || typeof schema !== 'object') return undefined;
    const refStr =
      schema.$ref ||
      (Array.isArray(schema.allOf) && schema.allOf.length === 1 && schema.allOf[0]?.$ref) ||
      (Array.isArray(schema.oneOf) && schema.oneOf[0]?.$ref) ||
      (Array.isArray(schema.anyOf) && schema.anyOf[0]?.$ref);
    if (typeof refStr === 'string' && refStr.includes('/')) {
      return refStr.substring(refStr.lastIndexOf('/') + 1);
    }
    if (schema.type === 'array' && schema.items) {
      const itemRef = this.extractRefName(schema.items);
      if (itemRef) return `${itemRef}[]`;
    }
    return undefined;
  }

  private static resolveSchema(schema: any, rootDoc: any, visited = new Set<string>()): any {
    if (!schema || typeof schema !== 'object') return schema;

    if (typeof schema.$ref === 'string') {
      if (visited.has(schema.$ref)) {
        return {};
      }
      const nextVisited = new Set(visited);
      nextVisited.add(schema.$ref);
      const target = this.resolveRef(schema.$ref, rootDoc);
      if (!target) return schema;
      const resolvedTarget = this.resolveSchema(target, rootDoc, nextVisited);
      const { $ref, ...siblings } = schema;
      return { ...resolvedTarget, ...siblings };
    }

    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
      const mergedProps: Record<string, any> = {};
      const mergedRequired = new Set<string>();
      let mergedBase: Record<string, any> = {};

      for (const sub of schema.allOf) {
        const resolvedSub = this.resolveSchema(sub, rootDoc, new Set(visited));
        if (resolvedSub && typeof resolvedSub === 'object') {
          const { properties, required, ...rest } = resolvedSub;
          mergedBase = { ...mergedBase, ...rest };
          if (properties && typeof properties === 'object') {
            Object.assign(mergedProps, properties);
          }
          if (Array.isArray(required)) {
            required.forEach((r: string) => mergedRequired.add(r));
          }
        }
      }

      const { allOf, properties: ownProps, required: ownReq, ...ownRest } = schema;
      if (ownProps && typeof ownProps === 'object') {
        Object.assign(mergedProps, ownProps);
      }
      if (Array.isArray(ownReq)) {
        ownReq.forEach((r: string) => mergedRequired.add(r));
      }

      const result: Record<string, any> = {
        ...mergedBase,
        ...ownRest,
      };
      if (Object.keys(mergedProps).length > 0) {
        result.type = result.type || 'object';
        result.properties = mergedProps;
      }
      if (mergedRequired.size > 0) {
        result.required = Array.from(mergedRequired);
      }
      return result;
    }

    const choiceList = Array.isArray(schema.oneOf)
      ? schema.oneOf
      : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : null;
    if (choiceList && choiceList.length > 0) {
      const firstCandidate = choiceList.find((c: any) => c && c.type !== 'null') || choiceList[0];
      const resolvedCandidate = this.resolveSchema(firstCandidate, rootDoc, new Set(visited));
      const { oneOf, anyOf, ...ownRest } = schema;
      return { ...resolvedCandidate, ...ownRest };
    }

    return schema;
  }

  private static formatSchemaType(schema: any, rootDoc?: any): { type: string; format?: string; enumValues?: string[] } {
    if (!schema || typeof schema !== 'object') {
      return { type: 'any' };
    }
    const refName = this.extractRefName(schema);
    const resolved = rootDoc ? this.resolveSchema(schema, rootDoc) : schema;
    if (!resolved || typeof resolved !== 'object') {
      return { type: refName || 'any' };
    }

    let enumValues: string[] | undefined = Array.isArray(resolved.enum)
      ? resolved.enum.map((v: any) => String(v))
      : undefined;

    let baseType = Array.isArray(resolved.type)
      ? resolved.type.filter((t: string) => t !== 'null').join(' | ') || 'string'
      : resolved.type || (resolved.properties ? 'object' : 'string');

    if (baseType === 'array' && resolved.items) {
      const itemRef = this.extractRefName(resolved.items);
      const resolvedItems = rootDoc ? this.resolveSchema(resolved.items, rootDoc) : resolved.items;
      if (!enumValues && Array.isArray(resolvedItems?.enum)) {
        enumValues = resolvedItems.enum.map((v: any) => String(v));
      }
      const itemType = itemRef || resolvedItems?.type || 'any';
      baseType = `${itemType}[]`;
    } else if (refName && (baseType === 'object' || enumValues)) {
      baseType = enumValues ? `enum (${refName})` : refName;
    } else if (enumValues) {
      baseType = 'enum';
    }

    return {
      type: baseType,
      format: resolved.format,
      enumValues,
    };
  }

  private static extractSchemaProperties(
    schema: any,
    rootDoc: any,
    maxProps = 60
  ): OpenApiSchemaPropertyDoc[] {
    if (!schema || typeof schema !== 'object') return [];
    let resolved = this.resolveSchema(schema, rootDoc);
    if (!resolved || typeof resolved !== 'object') return [];

    if (resolved.type === 'array' && resolved.items) {
      resolved = this.resolveSchema(resolved.items, rootDoc);
    }
    if (!resolved || typeof resolved !== 'object' || !resolved.properties) {
      return [];
    }

    const requiredSet = new Set<string>(Array.isArray(resolved.required) ? resolved.required : []);
    const props: OpenApiSchemaPropertyDoc[] = [];
    const entries = Object.entries(resolved.properties);

    for (let i = 0; i < Math.min(entries.length, maxProps); i++) {
      const [propName, rawProp] = entries[i] as [string, any];
      if (!rawProp || typeof rawProp !== 'object') continue;
      const resolvedProp = this.resolveSchema(rawProp, rootDoc);
      const typeInfo = this.formatSchemaType(rawProp, rootDoc);

      props.push({
        name: propName,
        type: typeInfo.type,
        format: typeInfo.format || resolvedProp?.format,
        required: requiredSet.has(propName) || undefined,
        nullable: rawProp.nullable === true || resolvedProp?.nullable === true || undefined,
        readOnly: rawProp.readOnly === true || resolvedProp?.readOnly === true || undefined,
        deprecated: rawProp.deprecated === true || resolvedProp?.deprecated === true || undefined,
        description: rawProp.description || resolvedProp?.description || undefined,
        enum: typeInfo.enumValues,
        defaultValue:
          rawProp.default !== undefined
            ? String(rawProp.default)
            : resolvedProp?.default !== undefined
            ? String(resolvedProp.default)
            : undefined,
        example:
          rawProp.example !== undefined
            ? String(rawProp.example)
            : resolvedProp?.example !== undefined
            ? String(resolvedProp.example)
            : undefined,
      });
    }

    return props;
  }

  private static generateSchemaExample(
    schema: any,
    rootDoc?: any,
    depth = 0,
    visited = new Set<string>(),
    forRequestBody = false,
    maxDepth = 3
  ): any {
    if (depth > maxDepth || !schema || typeof schema !== 'object') return null;

    const refKey =
      typeof schema.$ref === 'string'
        ? schema.$ref
        : Array.isArray(schema.allOf) && schema.allOf.length === 1 && typeof schema.allOf[0]?.$ref === 'string'
        ? schema.allOf[0].$ref
        : undefined;
    if (refKey) {
      if (visited.has(refKey)) {
        return null;
      }
      visited = new Set(visited);
      visited.add(refKey);
    }

    const resolved = rootDoc ? this.resolveSchema(schema, rootDoc, new Set<string>()) : schema;
    if (!resolved || typeof resolved !== 'object') return null;

    if (resolved.example !== undefined) return resolved.example;
    if (resolved.default !== undefined) return resolved.default;
    if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
      return resolved.enum[0];
    }

    const schemaType = Array.isArray(resolved.type)
      ? resolved.type.find((t: string) => t !== 'null') || 'string'
      : resolved.type;

    if (schemaType === 'string') {
      if (resolved.format === 'uuid' || resolved.format === 'guid') {
        return '00000000-0000-0000-0000-000000000000';
      }
      if (resolved.format === 'date-time') return '2026-01-01T00:00:00Z';
      if (resolved.format === 'date') return '2026-01-01';
      if (resolved.format === 'email') return 'user@example.com';
      if (resolved.format === 'uri' || resolved.format === 'url') return 'https://example.com';
      if (resolved.format === 'ipv4') return '127.0.0.1';
      return 'string';
    }
    if (schemaType === 'integer' || schemaType === 'number') {
      return typeof resolved.minimum === 'number' ? resolved.minimum : 0;
    }
    if (schemaType === 'boolean') {
      return true;
    }
    if (schemaType === 'array') {
      if (depth >= maxDepth) return [];
      const itemEx = this.generateSchemaExample(
        resolved.items,
        rootDoc,
        depth + 1,
        visited,
        forRequestBody,
        maxDepth
      );
      return itemEx !== null && itemEx !== undefined ? [itemEx] : [];
    }
    if (schemaType === 'object' || resolved.properties) {
      const result: Record<string, any> = {};
      const props = resolved.properties || {};
      const entries = Object.entries(props);
      // Keep deeply nested large DTOs concise
      const limit = depth >= 2 ? Math.min(entries.length, 20) : Math.min(entries.length, 50);
      for (let i = 0; i < limit; i++) {
        const [k, v] = entries[i] as [string, any];
        if (!v || typeof v !== 'object') continue;
        if (forRequestBody && v.readOnly === true) continue;
        if (!forRequestBody && v.writeOnly === true) continue;
        const propVal = this.generateSchemaExample(
          v,
          rootDoc,
          depth + 1,
          visited,
          forRequestBody,
          maxDepth
        );
        if (propVal !== undefined) {
          result[k] = propVal;
        }
      }
      return result;
    }
    if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
      const valEx = this.generateSchemaExample(
        resolved.additionalProperties,
        rootDoc,
        depth + 1,
        visited,
        forRequestBody,
        maxDepth
      );
      return { key: valEx ?? 'string' };
    }
    return null;
  }

  private static parseOpenApi(data: any): Collection {
    const colId = this.generateId('col');
    const title = data.info?.title || 'OpenAPI Specification';
    const version = data.info?.version ? `v${data.info.version}` : '';
    const colName = `${title} ${version}`.trim();
    const notes = data.info?.description || '';

    // Extract Base URL (handling OpenAPI 3 server variables and Swagger 2 host/basePath)
    let baseUrl = 'https://api.example.com';
    if (Array.isArray(data.servers) && data.servers[0]?.url) {
      let rawServerUrl = String(data.servers[0].url).trim();
      const serverVars = data.servers[0].variables;
      if (serverVars && typeof serverVars === 'object') {
        for (const [vName, vDef] of Object.entries(serverVars)) {
          const defVal = (vDef as any)?.default !== undefined ? String((vDef as any).default) : '';
          if (defVal) {
            rawServerUrl = rawServerUrl.replace(new RegExp(`\\{${vName}\\}`, 'g'), defVal);
          }
        }
      }
      rawServerUrl = rawServerUrl.replace(/\/$/, '');
      if (rawServerUrl && rawServerUrl !== '/') {
        baseUrl = rawServerUrl;
      }
    } else if (data.host) {
      const scheme = Array.isArray(data.schemes) && data.schemes[0] ? data.schemes[0] : 'https';
      const basePath = data.basePath ? data.basePath.replace(/\/$/, '') : '';
      baseUrl = `${scheme}://${data.host}${basePath}`;
    }

    // Extract Tag descriptions for Folders
    const tagDescriptions = new Map<string, string>();
    if (Array.isArray(data.tags)) {
      for (const t of data.tags) {
        if (t && typeof t.name === 'string' && t.description) {
          tagDescriptions.set(t.name, String(t.description));
        }
      }
    }

    // Extract Security Schemes (OpenAPI 3 components.securitySchemes / Swagger 2 securityDefinitions)
    const securitySchemes: Record<string, any> =
      (data.components?.securitySchemes && typeof data.components.securitySchemes === 'object'
        ? data.components.securitySchemes
        : data.securityDefinitions && typeof data.securityDefinitions === 'object'
        ? data.securityDefinitions
        : {}) || {};

    // Derive Collection-level Auth if a primary security scheme is defined
    let colAuth: AuthSettings | undefined;
    const schemeEntries = Object.entries(securitySchemes);
    if (schemeEntries.length > 0) {
      const [, firstScheme] = schemeEntries[0] as [string, any];
      if (firstScheme && typeof firstScheme === 'object') {
        const sType = String(firstScheme.type || '').toLowerCase();
        if (sType === 'http' && String(firstScheme.scheme || '').toLowerCase() === 'bearer') {
          colAuth = {
            auth: {
              type: 'bearer',
              token: '{{accessToken}}',
              headerName: 'Authorization',
              headerPrefix: 'Bearer',
            },
          };
        } else if (sType === 'http' && String(firstScheme.scheme || '').toLowerCase() === 'basic') {
          colAuth = {
            auth: {
              type: 'basic',
              username: '{{username}}',
              password: '{{password}}',
            },
          };
        } else if (sType === 'apikey') {
          colAuth = {
            auth: {
              type: 'apiKey',
              keyName: firstScheme.name || 'Authorization',
              headerName: firstScheme.name || 'Authorization',
              token: '{{apiKey}}',
              addTo: firstScheme.in === 'query' ? 'query' : 'header',
            },
          };
        }
      }
    }

    // Caches for fast schema example & property resolution on large specs (e.g. Jellyfin 63k lines)
    const reqBodyExampleCache = new Map<string, string>();
    const respExampleCache = new Map<string, string>();
    const schemaPropsCache = new Map<string, OpenApiSchemaPropertyDoc[]>();

    const getCachedSchemaProps = (schema: any): OpenApiSchemaPropertyDoc[] => {
      if (!schema || typeof schema !== 'object') return [];
      const cacheKey =
        schema.$ref ||
        (Array.isArray(schema.allOf) && schema.allOf.length === 1 ? schema.allOf[0]?.$ref : undefined) ||
        (schema.type === 'array' && schema.items?.$ref ? `arr:${schema.items.$ref}` : undefined);
      if (cacheKey && schemaPropsCache.has(cacheKey)) {
        return schemaPropsCache.get(cacheKey)!;
      }
      const computed = this.extractSchemaProperties(schema, data);
      if (cacheKey) {
        schemaPropsCache.set(cacheKey, computed);
      }
      return computed;
    };

    const getCachedExampleJson = (schema: any, forReqBody: boolean): string | undefined => {
      if (!schema || typeof schema !== 'object') return undefined;
      const cacheMap = forReqBody ? reqBodyExampleCache : respExampleCache;
      const cacheKey =
        schema.$ref ||
        (Array.isArray(schema.allOf) && schema.allOf.length === 1 ? schema.allOf[0]?.$ref : undefined) ||
        (schema.type === 'array' && schema.items?.$ref ? `arr:${schema.items.$ref}` : undefined);
      if (cacheKey && cacheMap.has(cacheKey)) {
        return cacheMap.get(cacheKey)!;
      }
      const ex = this.generateSchemaExample(
        schema,
        data,
        0,
        new Set<string>(),
        forReqBody,
        forReqBody ? 3 : 2
      );
      if (ex === null || ex === undefined) return undefined;
      const jsonStr = typeof ex === 'string' ? ex : JSON.stringify(ex, null, 2);
      if (cacheKey) {
        cacheMap.set(cacheKey, jsonStr);
      }
      return jsonStr;
    };

    const tagFolders = new Map<string, RequestItem[]>();
    const rootRequests: RequestItem[] = [];
    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

    for (const [pathKey, pathItem] of Object.entries(data.paths || {})) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      const pathParams = Array.isArray((pathItem as any).parameters)
        ? (pathItem as any).parameters
        : [];

      for (const method of HTTP_METHODS) {
        const op = (pathItem as any)[method];
        if (!op || typeof op !== 'object') continue;

        // Merge path-level and operation-level parameters (resolving $ref on parameters)
        const rawParams = [...pathParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
        const paramMap = new Map<string, any>();
        for (const rawP of rawParams) {
          const resolvedP = rawP?.$ref ? this.resolveRef(rawP.$ref, data) || rawP : rawP;
          if (resolvedP && resolvedP.name) {
            paramMap.set(`${resolvedP.in || 'query'}:${resolvedP.name}`, resolvedP);
          }
        }
        const allParams = Array.from(paramMap.values());

        const headers: Record<string, string> = {};
        const queryParts: string[] = [];
        const requestVariables: VariableItem[] = [];
        const addedVarNames = new Set<string>();
        const paramDocs: OpenApiParameterDoc[] = [];

        for (const param of allParams) {
          if (!param || !param.name || param.in === 'body') continue;

          const paramSchema = param.schema || param;
          const resolvedParamSchema = this.resolveSchema(paramSchema, data);
          const typeInfo = this.formatSchemaType(paramSchema, data);

          const explicitExample =
            param.example !== undefined
              ? String(param.example)
              : resolvedParamSchema?.example !== undefined
              ? String(resolvedParamSchema.example)
              : undefined;
          const defaultVal =
            param.default !== undefined
              ? String(param.default)
              : resolvedParamSchema?.default !== undefined
              ? String(resolvedParamSchema.default)
              : undefined;

          let sampleVal = explicitExample ?? defaultVal ?? '';
          if (!sampleVal && param.in === 'path') {
            if (typeInfo.enumValues && typeInfo.enumValues.length > 0) {
              sampleVal = typeInfo.enumValues[0];
            } else if (typeInfo.format === 'uuid' || typeInfo.format === 'guid') {
              sampleVal = '00000000-0000-0000-0000-000000000000';
            } else if (typeInfo.type.startsWith('integer') || typeInfo.type.startsWith('number')) {
              sampleVal = '1';
            } else {
              sampleVal = param.name;
            }
          }

          paramDocs.push({
            name: param.name,
            in: param.in || 'query',
            required: param.required === true || param.in === 'path' || undefined,
            deprecated: param.deprecated === true || resolvedParamSchema?.deprecated === true || undefined,
            type: typeInfo.type,
            format: typeInfo.format,
            description: param.description || resolvedParamSchema?.description || undefined,
            enum: typeInfo.enumValues,
            defaultValue: defaultVal,
            example: explicitExample,
            nullable: param.nullable === true || resolvedParamSchema?.nullable === true || undefined,
          });

          if (param.in === 'path') {
            if (!addedVarNames.has(param.name)) {
              addedVarNames.add(param.name);
              requestVariables.push({
                name: param.name,
                value: sampleVal,
                enabled: true,
              });
            }
          } else if (param.in === 'header' && this.isSafeKey(param.name)) {
            headers[param.name] = sampleVal || (typeInfo.enumValues?.[0] ?? '');
          } else if (param.in === 'query') {
            // Only auto-append query parameters to the URL if required or an explicit example is given
            // Optional query parameters remain one-click insertable from the OpenAPI Docs tab!
            if (param.required === true || explicitExample !== undefined) {
              const qVal =
                explicitExample ??
                defaultVal ??
                (typeInfo.enumValues && typeInfo.enumValues.length > 0 ? typeInfo.enumValues[0] : '');
              queryParts.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(qVal)}`);
            }
          }
        }

        // Ensure any {param} tokens in pathKey are also registered in requestVariables
        const pathTokenRegex = /(?<!\{)\{([^{}]+)\}(?!\})/g;
        let pathMatch: RegExpExecArray | null;
        while ((pathMatch = pathTokenRegex.exec(pathKey)) !== null) {
          const tokenName = pathMatch[1].trim();
          if (tokenName && !addedVarNames.has(tokenName)) {
            addedVarNames.add(tokenName);
            requestVariables.push({
              name: tokenName,
              value: tokenName,
              enabled: true,
            });
          }
        }

        // Convert {param} to {{param}}
        let convertedPath = pathKey.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, '{{$1}}');
        if (queryParts.length > 0) {
          convertedPath += `?${queryParts.join('&')}`;
        }

        const fullUrl = `{{baseUrl}}${convertedPath}`;
        let body = '';
        let bodyType: BodyType = 'none';
        let bodyFormData: FormDataItem[] | undefined;
        let requestBodyDoc: OpenApiBodyDoc | undefined;

        // Check OpenAPI 3 requestBody (resolving $ref if needed)
        const rawRb = op.requestBody;
        const rb = rawRb?.$ref ? this.resolveRef(rawRb.$ref, data) || rawRb : rawRb;
        if (rb && rb.content && typeof rb.content === 'object') {
          const contentKeys = Object.keys(rb.content);
          const jsonKey =
            contentKeys.find((k) => k.toLowerCase() === 'application/json') ||
            contentKeys.find((k) => k.toLowerCase().includes('json'));
          const formUrlKey = contentKeys.find((k) => k.toLowerCase().includes('x-www-form-urlencoded'));
          const multipartKey = contentKeys.find((k) => k.toLowerCase().includes('multipart/form-data'));
          const xmlKey = contentKeys.find((k) => k.toLowerCase().includes('xml'));
          const textKey = contentKeys.find((k) => k.toLowerCase().includes('text/plain'));
          const primaryKey = jsonKey || formUrlKey || multipartKey || xmlKey || textKey || contentKeys[0];

          if (primaryKey) {
            const mediaObj = rb.content[primaryKey];
            const rawSchema = mediaObj?.schema;
            const schemaName = this.extractRefName(rawSchema);
            const typeInfo = this.formatSchemaType(rawSchema, data);
            const schemaProps = getCachedSchemaProps(rawSchema);

            if (jsonKey) {
              bodyType = 'json';
              let exJson: string | undefined;
              if (mediaObj?.example !== undefined) {
                exJson = JSON.stringify(mediaObj.example, null, 2);
              } else {
                exJson = getCachedExampleJson(rawSchema, true);
              }
              body = exJson || '{}';
              headers['Content-Type'] = 'application/json';
              requestBodyDoc = {
                description: rb.description || rawSchema?.description || undefined,
                required: rb.required === true || undefined,
                contentType: 'application/json',
                schemaName,
                schemaType: typeInfo.type,
                properties: schemaProps.length > 0 ? schemaProps : undefined,
                exampleJson: body,
              };
            } else if (formUrlKey) {
              bodyType = 'form-urlencoded';
              headers['Content-Type'] = 'application/x-www-form-urlencoded';
              bodyFormData = schemaProps.map((p) => ({
                key: p.name,
                value: p.example ?? p.defaultValue ?? '',
                enabled: true,
              }));
              body = bodyFormData
                .map((item) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`)
                .join('&');
              requestBodyDoc = {
                description: rb.description || undefined,
                required: rb.required === true || undefined,
                contentType: 'application/x-www-form-urlencoded',
                schemaName,
                schemaType: typeInfo.type,
                properties: schemaProps.length > 0 ? schemaProps : undefined,
              };
            } else if (multipartKey) {
              bodyType = 'form-data';
              bodyFormData = schemaProps.map((p) => ({
                key: p.name,
                value: p.example ?? p.defaultValue ?? '',
                enabled: true,
                type: p.format === 'binary' ? 'file' : 'text',
              }));
              requestBodyDoc = {
                description: rb.description || undefined,
                required: rb.required === true || undefined,
                contentType: 'multipart/form-data',
                schemaName,
                schemaType: typeInfo.type,
                properties: schemaProps.length > 0 ? schemaProps : undefined,
              };
            } else if (xmlKey) {
              bodyType = 'xml';
              headers['Content-Type'] = primaryKey;
              requestBodyDoc = {
                description: rb.description || undefined,
                required: rb.required === true || undefined,
                contentType: primaryKey,
                schemaName,
                schemaType: typeInfo.type,
                properties: schemaProps.length > 0 ? schemaProps : undefined,
              };
            } else {
              bodyType = 'text';
              headers['Content-Type'] = primaryKey;
              const exJson = getCachedExampleJson(rawSchema, true);
              body = exJson || '';
              requestBodyDoc = {
                description: rb.description || undefined,
                required: rb.required === true || undefined,
                contentType: primaryKey,
                schemaName,
                schemaType: typeInfo.type,
                properties: schemaProps.length > 0 ? schemaProps : undefined,
                exampleJson: exJson,
              };
            }
          }
        } else {
          // Check Swagger 2 body or formData parameters
          const bodyParam = allParams.find((p: any) => p?.in === 'body');
          if (bodyParam) {
            bodyType = 'json';
            const rawSchema = bodyParam.schema;
            const schemaName = this.extractRefName(rawSchema);
            const typeInfo = this.formatSchemaType(rawSchema, data);
            const schemaProps = getCachedSchemaProps(rawSchema);
            const exJson = rawSchema ? getCachedExampleJson(rawSchema, true) : undefined;
            body = exJson || '{}';
            headers['Content-Type'] = 'application/json';
            requestBodyDoc = {
              description: bodyParam.description || undefined,
              required: bodyParam.required === true || undefined,
              contentType: 'application/json',
              schemaName,
              schemaType: typeInfo.type,
              properties: schemaProps.length > 0 ? schemaProps : undefined,
              exampleJson: body,
            };
          }
        }

        // Extract Responses & Schemas
        const responseDocs: OpenApiResponseDoc[] = [];
        if (op.responses && typeof op.responses === 'object') {
          for (const [statusCode, rawResp] of Object.entries(op.responses)) {
            const respObj = (rawResp as any)?.$ref
              ? this.resolveRef((rawResp as any).$ref, data) || rawResp
              : (rawResp as any);
            if (!respObj || typeof respObj !== 'object') continue;

            let respContentType: string | undefined;
            let respRawSchema: any;
            let respExplicitExample: any;

            if (respObj.content && typeof respObj.content === 'object') {
              const cKeys = Object.keys(respObj.content);
              respContentType =
                cKeys.find((k) => k.toLowerCase() === 'application/json') ||
                cKeys.find((k) => k.toLowerCase().includes('json')) ||
                cKeys[0];
              if (respContentType && respObj.content[respContentType]) {
                respRawSchema = respObj.content[respContentType].schema;
                respExplicitExample = respObj.content[respContentType].example;
              }
            } else if (respObj.schema) {
              // Swagger 2.0 response schema
              respContentType = 'application/json';
              respRawSchema = respObj.schema;
            }

            const respHeaders: OpenApiResponseHeaderDoc[] = [];
            if (respObj.headers && typeof respObj.headers === 'object') {
              for (const [hName, rawH] of Object.entries(respObj.headers)) {
                const hObj = (rawH as any)?.$ref ? this.resolveRef((rawH as any).$ref, data) || rawH : (rawH as any);
                if (!hObj || typeof hObj !== 'object') continue;
                const hSchema = hObj.schema || hObj;
                const hType = this.formatSchemaType(hSchema, data);
                respHeaders.push({
                  name: hName,
                  type: hType.type,
                  format: hType.format,
                  description: hObj.description || undefined,
                });
              }
            }

            const respSchemaName = this.extractRefName(respRawSchema);
            const respTypeInfo = respRawSchema ? this.formatSchemaType(respRawSchema, data) : undefined;
            const respProps = respRawSchema ? getCachedSchemaProps(respRawSchema) : [];
            let respExampleJson: string | undefined;
            if (respExplicitExample !== undefined) {
              respExampleJson = JSON.stringify(respExplicitExample, null, 2);
            } else if (respRawSchema && respContentType && respContentType.toLowerCase().includes('json')) {
              respExampleJson = getCachedExampleJson(respRawSchema, false);
            }

            responseDocs.push({
              status: statusCode,
              description: respObj.description || undefined,
              contentType: respContentType,
              schemaName: respSchemaName,
              schemaType: respTypeInfo?.type,
              headers: respHeaders.length > 0 ? respHeaders : undefined,
              properties: respProps.length > 0 ? respProps : undefined,
              exampleJson: respExampleJson,
            });
          }
        }

        // Extract Security requirements for this operation
        const rawSecurity = Array.isArray(op.security)
          ? op.security
          : Array.isArray(data.security)
          ? data.security
          : [];
        const securityDocs: OpenApiSecurityDoc[] = [];
        for (const secItem of rawSecurity) {
          if (!secItem || typeof secItem !== 'object') continue;
          for (const [schemeName, scopes] of Object.entries(secItem)) {
            const schemeDef = securitySchemes[schemeName];
            securityDocs.push({
              schemeName,
              type: schemeDef?.type || undefined,
              in: schemeDef?.in || undefined,
              paramName: schemeDef?.name || schemeDef?.scheme || undefined,
              description: schemeDef?.description || undefined,
              scopes: Array.isArray(scopes) ? scopes.map((s) => String(s)) : undefined,
            });
          }
        }

        const reqName = op.summary || op.operationId || `${method.toUpperCase()} ${pathKey}`;
        const tag = Array.isArray(op.tags) && op.tags.length > 0 ? op.tags[0] : undefined;

        const openApiDocs: OpenApiOperationDocs = {
          operationId: op.operationId || undefined,
          summary: op.summary || undefined,
          description: op.description || undefined,
          method: method.toUpperCase(),
          path: pathKey,
          tags: Array.isArray(op.tags) ? op.tags : undefined,
          deprecated: op.deprecated === true || undefined,
          security: securityDocs.length > 0 ? securityDocs : undefined,
          parameters: paramDocs.length > 0 ? paramDocs : undefined,
          requestBody: requestBodyDoc,
          responses: responseDocs.length > 0 ? responseDocs : undefined,
        };

        const reqItem: RequestItem = {
          id: this.generateId('req'),
          name: reqName,
          method: method.toUpperCase(),
          url: fullUrl,
          headers,
          body,
          bodyType,
          bodyFormData,
          variables: requestVariables.length > 0 ? requestVariables : undefined,
          collection: colName,
          collectionId: colId,
          folder: tag,
          notes: op.description || op.summary || '',
          openApiDocs,
        };

        if (tag) {
          if (!tagFolders.has(tag)) {
            tagFolders.set(tag, []);
          }
          tagFolders.get(tag)!.push(reqItem);
        } else {
          rootRequests.push(reqItem);
        }
      }
    }

    const folders: CollectionFolder[] = [];
    for (const [folderName, requests] of tagFolders.entries()) {
      const folderId = this.generateId('folder');
      requests.forEach((r) => {
        r.folderId = folderId;
      });
      folders.push({
        id: folderId,
        name: folderName,
        requests,
        notes: tagDescriptions.get(folderName) || undefined,
      });
    }

    return {
      id: colId,
      name: colName,
      baseUrl,
      baseUrlDisabled: false,
      folders,
      requests: rootRequests,
      variables: {
        baseUrl,
      },
      auth: colAuth,
      notes,
    };
  }

  // ==========================================
  // Normalization Helpers for Universal Compatibility
  // ==========================================

  private static isSafeKey(key: string): boolean {
    return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
  }

  private static normalizeHeaders(headers: any): Record<string, string> {
    const res: Record<string, string> = {};
    if (Array.isArray(headers)) {
      headers.forEach((h: any) => {
        if (h && h.enabled !== false && h.key && this.isSafeKey(h.key)) {
          res[h.key] = String(h.value ?? '');
        }
      });
      return res;
    }
    if (headers && typeof headers === 'object') {
      Object.entries(headers).forEach(([k, v]) => {
        if (v !== undefined && v !== null && this.isSafeKey(k)) {
          res[k] = String(v);
        }
      });
      return res;
    }
    return res;
  }

  private static normalizeVariables(variables: any): Record<string, string> {
    const res: Record<string, string> = {};
    if (Array.isArray(variables)) {
      variables.forEach((v: any) => {
        if (v && v.enabled !== false && v.key && this.isSafeKey(v.key)) {
          res[v.key] = String(v.value ?? '');
        }
      });
      return res;
    }
    if (variables && typeof variables === 'object') {
      Object.entries(variables).forEach(([k, v]) => {
        if (v !== undefined && v !== null && this.isSafeKey(k)) {
          res[k] = String(v);
        }
      });
      return res;
    }
    return res;
  }

  private static normalizeAuthHelper(authObj: any): ProfileAuth {
    if (!authObj || authObj.type === 'none' || authObj.type === 'noauth' || authObj.type === 'inherit') {
      return { type: 'none' };
    }
    const cfg = authObj.config || authObj;
    if (authObj.type === 'oauth2') {
      let scopes: string[] = [];
      if (cfg.scope) {
        scopes = Array.isArray(cfg.scope) ? cfg.scope : String(cfg.scope).split(/[\s,]+/).filter(Boolean);
      } else if (cfg.scopes) {
        scopes = Array.isArray(cfg.scopes) ? cfg.scopes : String(cfg.scopes).split(/[\s,]+/).filter(Boolean);
      }
      return {
        type: 'oauth2',
        grantType: (cfg.grantType as any) || 'client_credentials',
        tokenUrl: cfg.tokenUrl || '',
        authorizationUrl: cfg.authUrl || cfg.authorizationUrl || '',
        clientId: cfg.clientId || '',
        clientSecret: cfg.clientSecret || '',
        scopes,
        headerPrefix: cfg.headerPrefix || 'Bearer',
      };
    }
    if (authObj.type === 'bearer') {
      return {
        type: 'bearer',
        token: cfg.token || '',
        headerName: cfg.headerName || 'Authorization',
        headerPrefix: cfg.headerPrefix || 'Bearer',
      };
    }
    if (authObj.type === 'basic') {
      return {
        type: 'basic',
        username: cfg.username || '',
        password: cfg.password || '',
      };
    }
    if (authObj.type === 'apikey' || authObj.type === 'apiKey') {
      return {
        type: 'apiKey',
        keyName: cfg.key || cfg.keyName || 'X-API-Key',
        token: cfg.value || cfg.token || '',
        addTo: cfg.addTo === 'query' ? 'query' : 'header',
      };
    }
    return { type: 'none' };
  }

  private static normalizeBodyTypeHelper(bodyType: any): BodyType {
    if (bodyType === 'raw-json' || bodyType === 'json') return 'json';
    if (bodyType === 'raw-text' || bodyType === 'text') return 'text';
    if (bodyType === 'urlencoded' || bodyType === 'form-urlencoded') return 'form-urlencoded';
    if (bodyType === 'formdata' || bodyType === 'form-data') return 'form-data';
    if (bodyType === 'xml') return 'xml';
    return 'none';
  }

  private static normalizeRequestHelper(
    r: any,
    collectionName: string,
    collectionId: string,
    folderName?: string,
    folderId?: string
  ): RequestItem {
    const bodyType = this.normalizeBodyTypeHelper(r.bodyType);
    let body = r.body !== undefined ? r.body : (r.bodyRaw || '');
    const bodyFormData: FormDataItem[] = [];

    if (bodyType === 'form-urlencoded' && !body && Array.isArray(r.bodyUrlencoded)) {
      body = r.bodyUrlencoded
        .filter((u: any) => u.enabled !== false && u.key)
        .map((u: any) => `${encodeURIComponent(u.key)}=${encodeURIComponent(u.value || '')}`)
        .join('&');
    } else if (bodyType === 'form-data' && Array.isArray(r.bodyFormData)) {
      for (const fd of r.bodyFormData) {
        if (fd && fd.key) {
          bodyFormData.push({
            key: fd.key,
            value: fd.type === 'file' ? (fd.src || '') : (fd.value ?? ''),
            enabled: fd.enabled !== false,
            type: fd.type === 'file' ? 'file' : 'text',
          });
        }
      }
    }

    let auth: AuthSettings | undefined;
    if (r.auth) {
      if (r.auth.type === 'inherit') {
        auth = { inheritFromCollection: true };
      } else {
        auth = { auth: this.normalizeAuthHelper(r.auth) };
      }
    }

    let url = r.url || '';
    if (Array.isArray(r.queryParams) && r.queryParams.length > 0 && !url.includes('?')) {
      const qs = r.queryParams
        .filter((q: any) => q.enabled !== false && q.key)
        .map((q: any) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value ?? '')}`)
        .join('&');
      if (qs) {
        url += `?${qs}`;
      }
    }

    return {
      id: r.id || this.generateId('req'),
      name: r.name || 'Untitled Request',
      method: (r.method || 'GET').toUpperCase(),
      url,
      headers: this.normalizeHeaders(r.headers),
      body,
      bodyType,
      bodyFormData: bodyFormData.length > 0 ? bodyFormData : undefined,
      variables: Array.isArray(r.variables) ? r.variables : undefined,
      preRequestScript: typeof r.preRequestScript === 'string' ? r.preRequestScript : undefined,
      postResponseScript: typeof r.postResponseScript === 'string' ? r.postResponseScript : undefined,
      baseUrlPreference: r.baseUrlPreference,
      openApiDocs: r.openApiDocs && typeof r.openApiDocs === 'object' ? r.openApiDocs : undefined,
      collection: collectionName,
      collectionId,
      folder: folderName,
      folderId,
      auth,
      notes: r.notes || r.description || '',
    };
  }

  private static normalizeCollectionHelper(c: any): Collection {
    const colId = c.id || this.generateId('col');
    const colName = c.name || 'Imported Collection';
    const colVars = this.normalizeVariables(c.variables);
    const colHeaders = this.normalizeHeaders(c.headers);
    const colAuth: AuthSettings | undefined = c.auth ? { auth: this.normalizeAuthHelper(c.auth) } : undefined;

    const folders: CollectionFolder[] = (c.folders || []).map((fold: any) => {
      const fId = fold.id || this.generateId('folder');
      const fName = fold.name || 'Folder';
      const fReqs: RequestItem[] = (fold.requests || []).map((r: any) =>
        this.normalizeRequestHelper(r, colName, colId, fName, fId)
      );
      return {
        id: fId,
        name: fName,
        requests: fReqs,
        headers: this.normalizeHeaders(fold.headers),
        variables: this.normalizeVariables(fold.variables),
        notes: fold.notes || '',
      };
    });

    const rootReqs: RequestItem[] = (c.requests || []).map((r: any) =>
      this.normalizeRequestHelper(r, colName, colId, undefined, undefined)
    );

    return {
      id: colId,
      name: colName,
      folders,
      requests: rootReqs,
      variables: colVars,
      headers: colHeaders,
      auth: colAuth,
      notes: c.notes || '',
    };
  }

  // ==========================================
  // Native bluebyrd & Profile Backup Parsers
  // ==========================================

  private static parseBlueByrdBackup(data: any): AppState {
    const collections: Collection[] = Array.isArray(data.collections)
      ? data.collections.map((c: any) => this.normalizeCollectionHelper(c))
      : [];

    const environments: Record<string, EnvironmentConfig> = {};
    if (Array.isArray(data.environments)) {
      data.environments.forEach((e: any) => {
        const v = this.normalizeVariables(e.variables);
        let baseUrl = e.baseUrl;
        if (!baseUrl) {
          const keys = ['url', 'app_host', 'baseurl', 'base_url', 'host'];
          for (const k of keys) {
            if (v[k] && (v[k].startsWith('http://') || v[k].startsWith('https://'))) {
              baseUrl = v[k];
              break;
            }
          }
        }
        const envName = e.name || 'Environment';
        environments[envName] = {
          id: e.id || this.generateId('env'),
          baseUrl: baseUrl || 'https://api.example.com',
          apiKey: e.apiKey || '',
          auth: e.auth ? this.normalizeAuthHelper(e.auth) : undefined,
          variables: v,
          headers: this.normalizeHeaders(e.headers),
          inheritsFrom: e.inheritsFrom,
          notes: e.notes || '',
        };
      });
    } else if (data.environments && typeof data.environments === 'object') {
      Object.entries(data.environments).forEach(([key, e]: [string, any]) => {
        if (!e || typeof e !== 'object') return;
        environments[key] = {
          id: e.id || this.generateId('env'),
          baseUrl: e.baseUrl !== undefined ? e.baseUrl : 'https://api.example.com',
          apiKey: e.apiKey || '',
          auth: e.auth ? this.normalizeAuthHelper(e.auth) : undefined,
          variables: this.normalizeVariables(e.variables),
          headers: this.normalizeHeaders(e.headers),
          inheritsFrom: e.inheritsFrom,
          notes: e.notes || '',
        };
      });
    }

    let profiles: Profile[] = [];
    if (Array.isArray(data.profiles) && data.profiles.length > 0) {
      profiles = data.profiles.map((p: any) => ({
        id: p.id || this.generateId('profile'),
        name: p.name || 'Profile',
        auth: this.normalizeAuthHelper(p.auth),
        variables: this.normalizeVariables(p.variables),
        headers: this.normalizeHeaders(p.headers),
        inheritsFrom: p.inheritsFrom,
        notes: p.notes || '',
      }));
    } else if (data.profile && typeof data.profile === 'object') {
      profiles = [
        {
          id: data.profile.id || this.generateId('profile'),
          name: data.profile.name || 'Imported Profile',
          auth: this.normalizeAuthHelper(data.profile.auth),
          variables: this.normalizeVariables(data.profile.variables),
          headers: this.normalizeHeaders(data.profile.headers),
          notes: data.profile.notes || 'Imported from workspace backup',
        },
      ];
    } else {
      profiles = [
        {
          id: this.generateId('profile'),
          name: 'Default',
          auth: { type: 'none' },
          variables: {},
          headers: {},
          notes: '',
        },
      ];
    }

    const history = Array.isArray(data.history) ? data.history : [];

    return {
      profiles,
      environments,
      collections,
      history,
    };
  }

  private static parseBlueByrdCollection(data: any): Collection {
    const raw = data.collection || data;
    return this.normalizeCollectionHelper(raw);
  }

  private static parseBlueByrdEnvironment(data: any): { name: string; env: EnvironmentConfig } {
    const raw = data.environment || data;
    const name = data.name || data.environmentName || raw.name || 'Imported Environment';
    const v = this.normalizeVariables(raw.variables);
    let baseUrl = raw.baseUrl;
    if (!baseUrl) {
      const keys = ['url', 'app_host', 'baseurl', 'base_url', 'host'];
      for (const k of keys) {
        if (v[k] && (v[k].startsWith('http://') || v[k].startsWith('https://'))) {
          baseUrl = v[k];
          break;
        }
      }
    }
    const env: EnvironmentConfig = {
      id: raw.id || this.generateId('env'),
      baseUrl: baseUrl || 'https://api.example.com',
      apiKey: raw.apiKey || '',
      auth: raw.auth ? this.normalizeAuthHelper(raw.auth) : undefined,
      variables: v,
      headers: this.normalizeHeaders(raw.headers),
      inheritsFrom: raw.inheritsFrom,
      notes: raw.notes || '',
    };
    return { name, env };
  }

  // ==========================================
  // Export Methods
  // ==========================================

  public static exportCollection(collection: Collection): string {
    const exportData = {
      kind: 'byrdsnest.collection',
      legacyKind: 'bluebyrd.collection',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      collection,
    };
    return JSON.stringify(exportData, null, 2);
  }

  public static exportEnvironment(name: string, environment: EnvironmentConfig): string {
    const exportData = {
      kind: 'byrdsnest.environment',
      legacyKind: 'bluebyrd.environment',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      name,
      environment,
    };
    return JSON.stringify(exportData, null, 2);
  }

  public static exportBackup(state: AppState): string {
    const exportData = {
      byrdsnestBackupVersion: '1.0.0',
      bluebyrdBackupVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      profiles: state.profiles,
      environments: state.environments,
      collections: state.collections,
      history: state.history,
    };
    return JSON.stringify(exportData, null, 2);
  }
}

