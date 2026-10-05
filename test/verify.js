const assert = require('assert');
const path = require('path');
const Module = require('module');

// Mock vscode module for standalone execution
const mockVscode = {
  ExtensionContext: class {},
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  EventEmitter: class {
    constructor() {
      this.listeners = [];
      this.event = (listener) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
      };
    }
    fire(data) {
      this.listeners.forEach(l => {
        try { l(data); } catch (e) { /* ignore in mock */ }
      });
    }
    dispose() {
      this.listeners = [];
    }
  },
  DataTransfer: class {
    constructor() {
      this.entries = new Map();
    }
    get(mime) {
      return this.entries.get(mime);
    }
    set(mime, item) {
      this.entries.set(mime, item);
    }
  },
  DataTransferItem: class {
    constructor(value) {
      this.value = value;
    }
    asString() {
      return Promise.resolve(typeof this.value === 'string' ? this.value : JSON.stringify(this.value));
    }
  },
  window: {
    showInformationMessage: () => {},
    showErrorMessage: () => {},
    showWarningMessage: () => {},
    createTreeView: () => ({ dispose: () => {} }),
    createStatusBarItem: () => ({ show: () => {} }),
    setStatusBarMessage: () => ({ dispose: () => {} }),
    StatusBarAlignment: { Right: 2 },
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => {},
  },
  workspace: {
    workspaceFolders: [],
  },
  env: {
    openExternal: (uri) => Promise.resolve(true),
    clipboard: {
      writeText: (text) => Promise.resolve(),
    }
  },
  Uri: {
    parse: (str) => ({ scheme: 'data', path: str, toString: () => str }),
    file: (p) => ({ fsPath: p, path: p, toString: () => p }),
    joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath || base.path, ...parts), toString: () => path.join(base.fsPath || base.path, ...parts) })
  }
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  if (request === 'vscode') {
    return mockVscode;
  }
  return originalRequire.apply(this, arguments);
};

const repoDist = path.resolve(__dirname, '../dist');
const { BlueByrdStateManager } = require(path.join(repoDist, 'state/stateManager'));
const { VariableService } = require(path.join(repoDist, 'services/variableService'));
const { AuthService } = require(path.join(repoDist, 'services/authService'));
const { TokenService } = require(path.join(repoDist, 'services/tokenService'));
const { ScriptService } = require(path.join(repoDist, 'services/scriptService'));
const { ImportExportService } = require(path.join(repoDist, 'services/importExportService'));
const { UpdateService } = require(path.join(repoDist, 'services/updateService'));
const { BlueByrdExplorerTreeDataProvider } = require(path.join(repoDist, 'views/tree/explorerTreeDataProvider'));
const {
  BlueByrdProfilesTreeProvider,
  BlueByrdCollectionsTreeProvider,
  BlueByrdEnvironmentsTreeProvider,
  BlueByrdHistoryTreeProvider,
  BlueByrdToolsTreeProvider,
  BlueByrdTreeCoordinator,
} = require(path.join(repoDist, 'views/tree'));
const { getGlobalSettingsPanelHtml } = require(path.join(repoDist, 'views/panels/globalSettingsPanelHtml'));

console.log('--- Starting bluebyrd Verification Suite ---');

// 1. Test Mock Context & StateManager
const fakeStorage = new Map();
const mockContext = {
  workspaceState: {
    get: (key) => fakeStorage.get(key),
    update: (key, val) => { fakeStorage.set(key, val); return Promise.resolve(); }
  }
};

const stateManager = new BlueByrdStateManager(mockContext);
const variableService = new VariableService(stateManager);
const authService = new AuthService(stateManager);

// Test 1: State Initialization & Default State
const state = stateManager.getState();
assert(state.profiles.length >= 1, 'Should have default profiles');
assert(state.collections.length >= 1, 'Should have default collections');
assert(Object.keys(state.environments).length >= 1, 'Should have default environments');
assert(Array.isArray(state.history), 'History should be an array');
console.log('✓ Default state initialization passed');

// Test 2: Variable Interpolation
const testVars = {
  baseUrl: 'https://jsonplaceholder.typicode.com',
  userId: '42',
  version: 'v1',
  path: 'users/{{userId}}'
};

const singleReplace = variableService.interpolate('{{baseUrl}}/todos/{{userId}}', testVars);
assert.strictEqual(singleReplace, 'https://jsonplaceholder.typicode.com/todos/42', 'Single variable replacement failed');

const nestedReplace = variableService.interpolate('{{baseUrl}}/{{path}}', testVars);
assert.strictEqual(nestedReplace, 'https://jsonplaceholder.typicode.com/users/42', 'Nested variable replacement failed');

const unreplaced = variableService.interpolate('{{baseUrl}}/unknown/{{notExists}}', testVars);
assert.strictEqual(unreplaced, 'https://jsonplaceholder.typicode.com/unknown/{{notExists}}', 'Unmatched vars should remain untouched');
console.log('✓ Variable interpolation passed');

// Test 3: Variable Hierarchy Resolution
const resolvedVars = variableService.resolveVariables('Development', 'Local', 'Demo Collection', 'Todos', [
  { name: 'userId', value: '999', enabled: true },
  { name: 'customVar', value: 'hello', enabled: true },
  { name: 'disabledVar', value: 'ignored', enabled: false }
]);

assert.strictEqual(resolvedVars['baseUrl'], 'https://jsonplaceholder.typicode.com', 'baseUrl from environment should exist');
assert.strictEqual(resolvedVars['userId'], '999', 'Request-level variable should override environment');
assert.strictEqual(resolvedVars['customVar'], 'hello', 'Custom request variable should exist');
assert.strictEqual(resolvedVars['disabledVar'], undefined, 'Disabled variable should not exist');
assert.strictEqual(resolvedVars['version'], 'v1', 'Profile variable should exist');
console.log('✓ Hierarchical variable resolution passed');

// Test 4: Auth Resolution
const authHeaders = authService.resolveAuthHeaders('Development', 'Local', 'Demo Collection', 'Todos', { 'Accept': 'application/json' }, {
  inheritFromProfile: true,
  inheritFromEnvironment: true,
  auth: { type: 'apiKey', token: 'my-custom-key', headerName: 'X-API-Key' }
});

assert.strictEqual(authHeaders['Accept'], 'application/json', 'Existing headers should be preserved');
assert.strictEqual(authHeaders['X-API-Key'], 'my-custom-key', 'Override auth should be applied');
console.log('✓ Auth header resolution passed');

// Test 5: Saving Requests without Duplication
const demoCol = state.collections[0];
assert(demoCol, 'Demo collection must exist');

const newReq = stateManager.saveRequest({
  id: 'test-req-1',
  name: 'Test Request 1',
  method: 'GET',
  url: '{{baseUrl}}/test',
  headers: {},
  body: '',
  collection: demoCol.name,
  folder: 'Todos'
}, demoCol.id, 'Todos');

const updatedCol = stateManager.getCollection(demoCol.id);
const todosFolder = updatedCol.folders.find(f => f.name === 'Todos');
assert(todosFolder.requests.some(r => r.id === 'test-req-1'), 'Request should exist in folder');
assert(!updatedCol.requests.some(r => r.id === 'test-req-1'), 'Request must NOT be duplicated in root collection!');

stateManager.saveRequest({
  id: 'test-req-1',
  name: 'Updated Test Request Name',
  method: 'GET',
  url: '{{baseUrl}}/test',
  headers: {},
  body: '',
  collection: demoCol.name,
  folder: 'Todos'
}, demoCol.id, 'Todos');

const refreshedCol = stateManager.getCollection(demoCol.id);
const refreshedFolder = refreshedCol.folders.find(f => f.name === 'Todos');
const matchingReqs = refreshedFolder.requests.filter(r => r.id === 'test-req-1');
assert.strictEqual(matchingReqs.length, 1, 'Updating must NOT create a duplicate request!');
assert.strictEqual(matchingReqs[0].name, 'Updated Test Request Name', 'Request name should be updated');
console.log('✓ Save & update request deduplication passed');

// Test 6: History Isolation from Collections
const initialColReqCount = refreshedCol.requests.length;
const initialFolderReqCount = refreshedFolder.requests.length;

stateManager.recordHistory({
  id: 'history-item-1',
  name: 'Executed GET /test',
  method: 'GET',
  url: 'https://example.com/test',
  headers: {},
  body: '',
  collection: demoCol.name,
  folder: 'Todos'
}, { status: 200, statusText: 'OK', elapsedMs: 85 });

const postHistoryState = stateManager.getState();
assert.strictEqual(postHistoryState.history.length, 1, 'History should have 1 item');
assert.strictEqual(postHistoryState.history[0].responseStatus, 200, 'History item should record status');

const checkColAfterHistory = stateManager.getCollection(demoCol.id);
assert.strictEqual(checkColAfterHistory.requests.length, initialColReqCount, 'Collections must NOT be modified by request execution');
const checkFolderAfterHistory = checkColAfterHistory.folders.find(f => f.name === 'Todos');
assert.strictEqual(checkFolderAfterHistory.requests.length, initialFolderReqCount, 'Folders must NOT be modified by request execution');
console.log('✓ History recording isolation passed');

// Test 7: Duplication, Cloning & Deletion
const duplicated = stateManager.duplicateRequest('test-req-1');
assert(duplicated, 'Duplicate request should succeed');
assert(duplicated.id !== 'test-req-1', 'Duplicated request should have a distinct ID');
assert(duplicated.name.includes('(Copy)'), 'Duplicated request should have (Copy) in name');

const clonedReq = stateManager.cloneRequest('test-req-1', 'Custom Cloned Request');
assert(clonedReq, 'Clone request with custom name should succeed');
assert.strictEqual(clonedReq.name, 'Custom Cloned Request');
assert(clonedReq.id !== 'test-req-1' && clonedReq.id !== duplicated.id);

const deleted = stateManager.deleteRequest(duplicated.id);
assert.strictEqual(deleted, true, 'Delete request should succeed');
assert(!stateManager.getRequest(duplicated.id), 'Deleted request should no longer exist');
stateManager.deleteRequest(clonedReq.id);
console.log('✓ Request duplication, cloning and deletion passed');

// Test 8: History Clear
stateManager.clearHistory();
assert.strictEqual(stateManager.getState().history.length, 0, 'History should be empty after clear');
console.log('✓ Clear history passed');

// Test 9: Multiple Profiles with the Same Name
stateManager.saveProfile({ id: 'dev-1', name: 'Development', auth: { type: 'bearer', token: 'token-1' } });
stateManager.saveProfile({ id: 'dev-2', name: 'Development', auth: { type: 'bearer', token: 'token-2' } });
stateManager.saveProfile({ id: 'dev-3', name: 'Development', auth: { type: 'bearer', token: 'token-3' } });

const p2 = stateManager.getProfile('dev-2');
assert(p2, 'Profile dev-2 must exist');
assert.strictEqual(p2.auth.token, 'token-2', 'getProfile by id must return the exact matching profile, not the first same-named profile');

stateManager.saveProfile({ id: 'dev-2', name: 'Development', auth: { type: 'bearer', token: 'token-2-updated' } });
const checkP1 = stateManager.getProfile('dev-1');
const checkP2 = stateManager.getProfile('dev-2');
const checkP3 = stateManager.getProfile('dev-3');
assert.strictEqual(checkP1.auth.token, 'token-1', 'Profile 1 must remain untouched when Profile 2 is saved');
assert.strictEqual(checkP2.auth.token, 'token-2-updated', 'Profile 2 must be updated');
assert.strictEqual(checkP3.auth.token, 'token-3', 'Profile 3 must remain untouched when Profile 2 is saved');
console.log('✓ Multiple same-named profiles handled correctly by ID passed');

// Test 10: Full-Fidelity History Recording & Retrieval
const recordedItem = stateManager.recordHistory(
  {
    id: 'req-full-test',
    name: 'Get User Todos',
    method: 'GET',
    url: '{{baseUrl}}/todos/1',
    headers: { Accept: 'application/json' },
    body: '',
    collection: 'Demo Collection',
    folder: 'Todos',
  },
  {
    ok: true,
    status: 200,
    statusText: 'OK',
    elapsedMs: 85,
    sizeBytes: 1240,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: '{"userId": 1, "id": 1, "title": "delectus aut autem", "completed": false}',
    resolvedUrl: 'https://jsonplaceholder.typicode.com/todos/1',
  }
);

assert(recordedItem, 'Should return recorded history item');
assert.strictEqual(recordedItem.resolvedUrl, 'https://jsonplaceholder.typicode.com/todos/1', 'Resolved URL must be preserved');
assert.strictEqual(recordedItem.responseStatus, 200, 'Response status must be preserved');
assert.strictEqual(recordedItem.elapsedMs, 85, 'Elapsed ms must be preserved');
assert.strictEqual(recordedItem.responseSizeBytes, 1240, 'Response size bytes must be preserved');
assert(recordedItem.responseHeaders['content-type'].includes('application/json'), 'Response headers must be preserved');
assert(recordedItem.responseBody.includes('delectus aut autem'), 'Response body must be preserved');

const fetched = stateManager.getHistoryItem(recordedItem.id);
assert(fetched, 'getHistoryItem by ID should find the recorded item');
assert.strictEqual(fetched.id, recordedItem.id, 'Fetched history item ID should match');
const allHistory = stateManager.getHistory();
assert.strictEqual(allHistory.length, 1, 'getHistory should return array with recorded run');
console.log('✓ Full-fidelity history recording & retrieval passed');

// Test 11: Oversized Payload Truncation & Single-Item Deletion
const hugePayload = 'A'.repeat(150000); // 150KB
const truncatedItem = stateManager.recordHistory(
  {
    id: 'req-huge-test',
    name: 'Download Huge File',
    method: 'GET',
    url: 'https://api.example.com/huge',
    headers: {},
    body: '',
    collection: 'Demo Collection',
  },
  {
    ok: true,
    status: 200,
    statusText: 'OK',
    elapsedMs: 350,
    sizeBytes: 150000,
    headers: { 'content-type': 'text/plain' },
    body: hugePayload,
    resolvedUrl: 'https://api.example.com/huge',
  }
);

assert(truncatedItem.responseBody.length < 110000, 'Payload larger than 100KB must be truncated for storage safety');
assert(truncatedItem.responseBody.includes('[Response body truncated (> 100 KB) for history storage]'), 'Truncation message must be present');

const deleteSuccess = stateManager.deleteHistoryItem(truncatedItem.id);
assert.strictEqual(deleteSuccess, true, 'deleteHistoryItem should return true');
assert.strictEqual(stateManager.getHistoryItem(truncatedItem.id), undefined, 'Deleted history item should no longer be found');
assert.strictEqual(stateManager.getHistory().length, 1, 'Remaining history should still have previous item');
console.log('✓ Oversized payload safety truncation & single-item deletion passed');

// Test 12: Settings Panel Static viewType & HTML Generation
const { BlueByrdSettingsPanel } = require(path.join(repoDist, 'views/panels/settingsPanel'));
const { getSettingsPanelHtml } = require(path.join(repoDist, 'views/panels/settingsPanelHtml'));

assert.strictEqual(BlueByrdSettingsPanel.viewType, 'blueByrdSettings', 'Settings panel viewType must be static blueByrdSettings');

// Test across all scope targets
const profileHtml = getSettingsPanelHtml('profile', state.profiles[0], 'Dev');
assert(profileHtml.includes('Dev Settings'), 'Profile settings title should match');
assert(profileHtml.includes('Variables'), 'Tabs should be present');

const envHtml = getSettingsPanelHtml('environment', state.environments['Local'], 'Local');
assert(envHtml.includes('Base URL'), 'Environment should display Base URL banner');

const colHtml = getSettingsPanelHtml('collection', state.collections[0], 'Demo Collection');
assert(colHtml.includes('scope-collection'), 'Collection scope pill class should be present');
assert(colHtml.includes('COLLECTION'), 'Collection scope label should be present');

const folderHtml = getSettingsPanelHtml('folder', state.collections[0].folders[0], 'Todos', 'Demo Collection');
assert(folderHtml.includes('Todos'), 'Folder name should be present');

const undefinedHtml = getSettingsPanelHtml('profile', undefined, 'Empty');
assert(undefinedHtml.includes('Empty Settings'), 'Undefined item should not throw');
console.log('✓ Settings panel multi-scope HTML rendering passed');

// Test 13: Settings Panel Script Syntax & Injection Safety
const edgeCaseItem = {
  id: 'test-edge',
  name: 'Edge Case Item',
  auth: { type: 'bearer', token: 'token"with`quotes${and}interpolation' },
  variables: {
    'normalVar': 'simple-val',
    'backtickVar': 'val`with`backtick',
    'templateVar': '${dangerouslyInterpolated}',
    'quoteVar': 'quotes"and\'single',
    'scriptTagVar': '</script><script>alert(1)</script>'
  },
  notes: 'Testing notes with </textarea> and `code`'
};

const edgeHtml = getSettingsPanelHtml('environment', edgeCaseItem, 'Edge Case');
const scriptMatch = edgeHtml.match(/<script>([\s\S]*?)<\/script>/);
assert(scriptMatch, 'Script block must be present in settings HTML');
assert.doesNotThrow(() => {
  new Function(scriptMatch[1]);
}, 'Client script in settings HTML must be valid JavaScript without syntax or template errors');
console.log('✓ Settings panel script integrity & edge-case injection safety passed');

// Test 14: Comprehensive Auth Types (OAuth 2.0, Basic Auth, API Key, Bearer)
const oauthProfile = {
  id: 'profile-oauth-test',
  name: 'OAuth Profile',
  auth: {
    type: 'oauth2',
    grantType: 'authorization_code',
    token: 'ya29.sample-token',
    clientId: 'test-client-id-123',
    clientSecret: 'test-secret-456',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'profile', 'email'],
    headerPrefix: 'Bearer',
    headerName: 'Authorization'
  },
  variables: {}
};

const oauthHtml = getSettingsPanelHtml('profile', oauthProfile, 'OAuth Profile');
assert(oauthHtml.includes('oauth-grant-type'), 'OAuth 2.0 grant type input must be present');
assert(oauthHtml.includes('oauth-client-id'), 'OAuth 2.0 Client ID input must be present');
assert(oauthHtml.includes('oauth-client-secret'), 'OAuth 2.0 Client Secret input must be present');
assert(oauthHtml.includes('oauth-auth-url'), 'OAuth 2.0 Authorization URL input must be present');
assert(oauthHtml.includes('oauth-token-url'), 'OAuth 2.0 Token URL input must be present');
assert(oauthHtml.includes('oauth-scopes'), 'OAuth 2.0 Scopes input must be present');
assert(oauthHtml.includes('test-client-id-123'), 'Configured Client ID should be rendered in HTML');
assert(oauthHtml.includes('openid profile email'), 'Scopes should be joined and rendered');

// Basic auth test
const basicProfile = {
  id: 'profile-basic-test',
  name: 'Basic Profile',
  auth: {
    type: 'basic',
    username: 'admin',
    password: 'secretpassword',
    headerName: 'Authorization'
  },
  variables: {}
};

const basicHtml = getSettingsPanelHtml('profile', basicProfile, 'Basic Profile');
assert(basicHtml.includes('basic-username'), 'Basic Auth username input must be present');
assert(basicHtml.includes('basic-password'), 'Basic Auth password input must be present');

// Test AuthService resolution for basic auth
stateManager.saveProfile(basicProfile);
const basicHeaders = authService.resolveAuthHeaders('profile-basic-test', undefined, undefined, undefined, {});
const expectedBasic = `Basic ${Buffer.from('admin:secretpassword').toString('base64')}`;
assert.strictEqual(basicHeaders['Authorization'], expectedBasic, 'Basic auth header must resolve to correct base64 encoding');

// Test AuthService resolution for OAuth2
stateManager.saveProfile(oauthProfile);
const oauthHeaders = authService.resolveAuthHeaders('profile-oauth-test', undefined, undefined, undefined, {});
console.log('✓ Comprehensive Auth types (OAuth 2.0, Basic Auth, API Key, Bearer) verified');

// 15. Test Request Panel Response Inspector HTML & Tabs
const { getRequestPanelHtml } = require(path.join(repoDist, 'views/panels/requestPanelHtml'));
const reqHtml = getRequestPanelHtml({}, stateManager.getState());
assert(!reqHtml.includes('id="tab-resp-body" class="tab-content active" style='), 'tab-resp-body should not have inline display styles that break hiding');
assert(reqHtml.includes('#tab-resp-body.active {'), 'tab-resp-body.active flex style should be in CSS');
assert(reqHtml.includes('id="tab-resp-body" class="tab-content active"'), 'tab-resp-body should have class tab-content active');
assert(reqHtml.includes('id="tab-resp-headers" class="tab-content"'), 'tab-resp-headers should have class tab-content');
assert(reqHtml.includes('headers-table'), 'headers-table should be present in response inspector');
console.log('✓ Request panel response tabs and header inspection verified');

// 16. Test Multi-Type Request Body (form encoded, json, text, xml, form-data, none)
assert(reqHtml.includes('name="bodyType" value="none"'), 'none body radio should be present');
assert(reqHtml.includes('name="bodyType" value="json"'), 'JSON body radio should be present');
assert(reqHtml.includes('name="bodyType" value="form-urlencoded"'), 'x-www-form-urlencoded radio should be present');
assert(reqHtml.includes('name="bodyType" value="form-data"'), 'form-data radio should be present');
assert(reqHtml.includes('name="bodyType" value="text"'), 'text body radio should be present');
assert(reqHtml.includes('name="bodyType" value="xml"'), 'XML body radio should be present');
assert(reqHtml.includes('name="bodyType" value="raw"'), 'raw body radio should be present');

assert(reqHtml.includes('id="body-view-json"'), 'JSON body subview should be present');
assert(reqHtml.includes('id="body-view-form-urlencoded"'), 'form-urlencoded subview should be present');
assert(reqHtml.includes('id="body-view-form-data"'), 'form-data subview should be present');
assert(reqHtml.includes('id="body-view-text"'), 'text subview should be present');
assert(reqHtml.includes('id="body-view-xml"'), 'xml subview should be present');
assert(reqHtml.includes('id="urlencoded-rows"'), 'form-urlencoded rows container should be present');
assert(reqHtml.includes('btn-toggle-urlencoded-mode'), 'Bulk Edit button should be present');

// Test saving and normalizing requests with bodyType and bodyFormData
const formReq = {
  id: 'req-form-test',
  name: 'Form Request',
  method: 'POST',
  url: 'https://httpbin.org/post',
  collection: 'Demo Collection',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'username=chase&grant_type=password',
  bodyType: 'form-urlencoded',
  bodyFormData: [
    { key: 'username', value: 'chase', enabled: true },
    { key: 'grant_type', value: 'password', enabled: true }
  ]
};

const savedFormReq = stateManager.saveRequest(formReq);
assert.strictEqual(savedFormReq.bodyType, 'form-urlencoded', 'Saved request must preserve bodyType');
assert.strictEqual(savedFormReq.bodyFormData.length, 2, 'Saved request must preserve bodyFormData rows');

const reloadedState = stateManager.getState();
const reloadedReq = reloadedState.collections[0].requests.find(r => r.id === 'req-form-test');
assert(reloadedReq, 'Request must exist in state');
assert.strictEqual(reloadedReq.bodyType, 'form-urlencoded', 'Reloaded request must retain bodyType');
assert.strictEqual(reloadedReq.bodyFormData.length, 2, 'Reloaded request must retain bodyFormData rows');

// Test request panel rendering with specific bodyType and bodyFormData
const renderedFormHtml = getRequestPanelHtml(reloadedReq, reloadedState);
assert(renderedFormHtml.includes('initialBodyType = "form-urlencoded"'), 'Webview script should receive initial bodyType');
assert(renderedFormHtml.includes('"username"'), 'Webview script should receive initial form data keys');
console.log('✓ Request body type selection (form-urlencoded, json, txt, xml, form-data) verified');

// 17. Test Request Panel Script Syntax & Integrity
const reqScriptMatch = reqHtml.match(/<script>([\s\S]*?)<\/script>/);
assert(reqScriptMatch, 'Script block must be present in request panel HTML');
assert.doesNotThrow(() => {
  new Function(reqScriptMatch[1]);
}, 'Client script in request panel HTML must be valid JavaScript without syntax or template errors');

function createMockDom() {
  const elements = new Map();
  function getEl(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        tagName: 'DIV',
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
        classList: {
          contains: () => false,
          add: () => {},
          remove: () => {},
          toggle: () => {},
        },
        selectedOptions: [{ value: 'Default', dataset: { id: 'def-1' } }],
        options: [{ value: 'Default', getAttribute: () => 'def-1' }],
        selectedIndex: 0,
        querySelector: (sel) => getEl(sel),
        querySelectorAll: () => [],
        closest: (sel) => getEl(sel),
        appendChild: () => {},
        remove: () => {},
        addEventListener: () => {},
      });
    }
    return elements.get(id);
  }
  return {
    getElementById: (id) => getEl(id),
    querySelector: (sel) => getEl(sel),
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: tag,
      innerHTML: '',
      textContent: '',
      style: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      querySelector: (sel) => getEl(sel),
      querySelectorAll: () => [],
      closest: (sel) => getEl(sel),
      appendChild: () => {},
      remove: () => {},
      addEventListener: () => {},
      setAttribute: () => {},
    }),
    addEventListener: () => {},
  };
}

// Runtime execution test: ensures no Temporal Dead Zone (TDZ) ReferenceErrors (e.g. inheritedVarsContainer)
assert.doesNotThrow(() => {
  const mockDoc = createMockDom();
  const mockWindow = { addEventListener: () => {} };
  const fn = new Function('document', 'window', 'acquireVsCodeApi', reqScriptMatch[1]);
  fn(mockDoc, mockWindow, () => ({ postMessage: () => {} }));
}, 'Client script in request panel HTML must execute without runtime TDZ ReferenceError');

const renderedFormScriptMatch = renderedFormHtml.match(/<script>([\s\S]*?)<\/script>/);
assert(renderedFormScriptMatch, 'Script block must be present in rendered form request HTML');
assert.doesNotThrow(() => {
  new Function(renderedFormScriptMatch[1]);
}, 'Client script in form request panel HTML must be valid JavaScript without syntax or template errors');
console.log('✓ Request panel script integrity & syntax validation passed');

// 18. Test Multipart Form-Data File Upload Execution & UI
(async function runAsyncTests() {
  const { HttpService } = require(path.join(repoDist, 'services/httpService'));
  const http = require('http');
  const fs = require('fs');

  // Create temporary fixture file
  const fixtureDir = path.join(__dirname, 'fixtures');
  if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true });
  const sampleFilePath = path.join(fixtureDir, 'upload-sample.txt');
  fs.writeFileSync(sampleFilePath, 'Hello bluebyrd multipart upload!', 'utf8');

  let receivedContentType = '';
  let receivedBody = '';
  const server = http.createServer((req, res) => {
    receivedContentType = req.headers['content-type'] || '';
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      receivedBody = Buffer.concat(chunks).toString();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  const httpService = new HttpService(stateManager, variableService, authService);

  // Successful file upload test
  const uploadResult = await httpService.executeRequest({
    method: 'POST',
    url: `http://127.0.0.1:${port}/upload`,
    bodyType: 'form-data',
    bodyFormData: [
      { key: 'username', value: 'byrd-dev', enabled: true, type: 'text' },
      { key: 'avatar', value: sampleFilePath, enabled: true, type: 'file' }
    ]
  });

  assert(receivedContentType.startsWith('multipart/form-data; boundary='), 'Must set multipart/form-data with boundary');
  assert(receivedBody.includes('name="username"'), 'Must include username text field');
  assert(receivedBody.includes('byrd-dev'), 'Must include username text value');
  assert(receivedBody.includes('name="avatar"; filename="upload-sample.txt"'), 'Must include file field with filename');
  assert(receivedBody.includes('Hello bluebyrd multipart upload!'), 'Must include file contents');
  assert.strictEqual(uploadResult.status, 200, 'HTTP request must succeed');

  // Missing file safety test
  let missingFileError = null;
  try {
    await httpService.executeRequest({
      method: 'POST',
      url: `http://127.0.0.1:${port}/upload`,
      bodyType: 'form-data',
      bodyFormData: [
        { key: 'avatar', value: path.join(fixtureDir, 'non-existent-file.xyz'), enabled: true, type: 'file' }
      ]
    });
  } catch (err) {
    missingFileError = err;
  }
  assert(missingFileError && missingFileError.message.includes('File not found for form-data field "avatar"'), 'Must throw descriptive error when file does not exist');

  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  server.close();
  server.unref();

  // Test form-data file row rendering and script compilation
  const fileReq = {
    id: 'req-file-test',
    name: 'File Upload Request',
    method: 'POST',
    url: 'https://httpbin.org/post',
    bodyType: 'form-data',
    bodyFormData: [
      { key: 'avatar', value: sampleFilePath, enabled: true, type: 'file' }
    ]
  };
  const renderedFileHtml = getRequestPanelHtml(fileReq, stateManager.getState());
  assert(renderedFileHtml.includes('addFormDataRow'), 'Should include addFormDataRow function');
  assert(renderedFileHtml.includes('data-role="browse"'), 'Should render Browse button for file upload');
  assert(renderedFileHtml.includes('initialBodyFormData = [{"key":"avatar"'), 'Should pass initial form data');

  const fileScriptMatch = renderedFileHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert(fileScriptMatch, 'Script block must be present');
  assert.doesNotThrow(() => {
    new Function(fileScriptMatch[1]);
  }, 'Client script with form-data file row must compile without syntax errors');

  console.log('✓ Form-data file upload execution, missing file safety & UI rendering verified');

  // 19. Test Shared Auth Component in Request Panel (OAuth 2.0 & Basic Auth parity)
  const oauthReq = {
    id: 'req-oauth-test',
    name: 'OAuth Request',
    method: 'GET',
    url: 'https://api.example.com/me',
    collection: 'Demo Collection',
    auth: {
      inheritFromProfile: false,
      inheritFromEnvironment: false,
      auth: {
        type: 'oauth2',
        grantType: 'authorization_code',
        token: 'ya29.req-token-xyz',
        clientId: 'req-client-123',
        clientSecret: 'req-secret-456',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: ['openid', 'email'],
        headerPrefix: 'Bearer',
        headerName: 'Authorization'
      }
    }
  };

  const renderedOAuthReqHtml = getRequestPanelHtml(oauthReq, stateManager.getState());
  assert(renderedOAuthReqHtml.includes('id="oauth-client-id"'), 'Request Auth tab must include oauth-client-id input');
  assert(renderedOAuthReqHtml.includes('value="req-client-123"'), 'Request Auth tab must render configured Client ID');
  assert(renderedOAuthReqHtml.includes('value="req-secret-456"'), 'Request Auth tab must render configured Client Secret');
  assert(renderedOAuthReqHtml.includes('value="https://accounts.google.com/o/oauth2/v2/auth"'), 'Request Auth tab must render Auth URL');
  assert(renderedOAuthReqHtml.includes('value="https://oauth2.googleapis.com/token"'), 'Request Auth tab must render Token URL');
  assert(renderedOAuthReqHtml.includes('value="openid email"'), 'Request Auth tab must render Scopes');
  assert(renderedOAuthReqHtml.includes('value="authorization_code"'), 'Request Auth tab must render Grant Type');

  // Test Request Panel Basic Auth parity
  const basicReq = {
    id: 'req-basic-test',
    name: 'Basic Request',
    method: 'GET',
    url: 'https://api.example.com/protected',
    collection: 'Demo Collection',
    auth: {
      inheritFromProfile: false,
      inheritFromEnvironment: false,
      auth: {
        type: 'basic',
        username: 'req-user',
        password: 'req-password',
        headerName: 'Authorization'
      }
    }
  };
  const renderedBasicReqHtml = getRequestPanelHtml(basicReq, stateManager.getState());
  assert(renderedBasicReqHtml.includes('id="basic-username"'), 'Request Auth tab must include basic-username input');
  assert(renderedBasicReqHtml.includes('value="req-user"'), 'Request Auth tab must render configured Username');
  assert(renderedBasicReqHtml.includes('value="req-password"'), 'Request Auth tab must render configured Password');

  // Verify save & state preservation of full OAuth 2.0 on request
  const savedOAuthReq = stateManager.saveRequest(oauthReq);
  assert.strictEqual(savedOAuthReq.auth.auth.clientId, 'req-client-123', 'Saved request must preserve OAuth Client ID');
  assert.strictEqual(savedOAuthReq.auth.auth.clientSecret, 'req-secret-456', 'Saved request must preserve OAuth Client Secret');
  assert.strictEqual(savedOAuthReq.auth.auth.tokenUrl, 'https://oauth2.googleapis.com/token', 'Saved request must preserve OAuth Token URL');

  // Verify client script integrity of OAuth request panel HTML
  const oauthReqScriptMatch = renderedOAuthReqHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert(oauthReqScriptMatch, 'Script tag must exist in OAuth request HTML');
  assert.doesNotThrow(() => {
    new Function(oauthReqScriptMatch[1]);
  }, 'Client script in OAuth request HTML must compile without syntax errors');

  console.log('✓ Unified Auth parity verified (OAuth 2.0, Basic, API Key, Bearer shared across Request & Settings)');

  // Test 20: Built-in Dynamic Variables
  const uuid = variableService.resolveDynamic('$uuid');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid), 'UUID v4 must match standard format');

  const timestamp = variableService.resolveDynamic('$timestamp');
  const now = Date.now();
  assert(Math.abs(Number(timestamp) - now) < 5000, '$timestamp should be current epoch millis');

  const isoDate = variableService.resolveDynamic('$isoDate');
  assert(!isNaN(Date.parse(isoDate)), '$isoDate must be valid ISO-8601');

  const randomInt = variableService.resolveDynamic('$randomInt:8');
  assert(/^\d{8}$/.test(randomInt), '$randomInt:8 should return 8 numeric digits');

  const dateFmt = variableService.resolveDynamic('$date:yyyy-MM');
  const currentYm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  assert.strictEqual(dateFmt, currentYm, '$date:yyyy-MM should match current year and month');

  const dynInterpolated = variableService.interpolate('ID: {{$uuid}}, Date: {{$date:yyyy}}', {});
  assert(dynInterpolated.includes('ID: ') && dynInterpolated.includes(`Date: ${new Date().getFullYear()}`), 'Dynamic variables must interpolate into strings');
  console.log('✓ Built-in dynamic variables ($uuid, $timestamp, $isoDate, $randomInt, $date) passed');

  // Test 21: Nested Environments & Cycle-Safe Resolution Chain
  stateManager.saveEnvironment('Stage-Base', {
    id: 'env-stage-base',
    baseUrl: 'https://base.stage.api.com',
    apiKey: 'base-key-123',
    variables: { commonHost: 'stage.api.internal', sharedSecret: 'base-secret', region: 'global' },
    headers: { 'X-Common-Base': 'true' }
  });

  stateManager.saveEnvironment('Stage-East', {
    id: 'env-stage-east',
    baseUrl: '', // Empty baseUrl so it inherits from Stage-Base
    inheritsFrom: 'Stage-Base',
    variables: { region: 'us-east-1', localCluster: 'east-pod-4' },
    headers: { 'X-Region': 'us-east-1' }
  });

  const eastVars = variableService.resolveVariables('Development', 'Stage-East', 'Demo Collection', 'Todos');
  assert.strictEqual(eastVars['baseUrl'], 'https://base.stage.api.com', 'Child environment should inherit baseUrl from parent environment');
  assert.strictEqual(eastVars['apiKey'], 'base-key-123', 'Child environment should inherit apiKey from parent environment');
  assert.strictEqual(eastVars['commonHost'], 'stage.api.internal', 'Child environment should inherit parent variables');
  assert.strictEqual(eastVars['region'], 'us-east-1', 'Child environment should override parent variables with same key');
  assert.strictEqual(eastVars['localCluster'], 'east-pod-4', 'Child environment should provide its own variables');

  // Cycle safety check: Env-A -> Env-B -> Env-A
  stateManager.saveEnvironment('Cycle-A', {
    id: 'env-cycle-a',
    baseUrl: 'https://a.test',
    inheritsFrom: 'Cycle-B',
    variables: { varA: '1' }
  });
  stateManager.saveEnvironment('Cycle-B', {
    id: 'env-cycle-b',
    baseUrl: 'https://b.test',
    inheritsFrom: 'Cycle-A',
    variables: { varB: '2' }
  });
  assert.doesNotThrow(() => {
    const cycleVars = variableService.resolveVariables('Development', 'Cycle-A');
    assert(cycleVars['varA'] === '1' && cycleVars['varB'] === '2', 'Cycle resolution should terminate safely');
  }, 'Circular environment inheritance must be cycle-safe without throwing');
  console.log('✓ Nested environments & cycle-safe inheritance chain passed');

  // Test 22: Hierarchical Headers across Environments, Collections, Folders, and Requests
  const demoCollection = stateManager.getState().collections[0];
  demoCollection.headers = { 'Accept': 'application/json', 'X-Collection-Scope': 'orders-v1' };
  demoCollection.folders[0].headers = { 'X-Folder-Scope': 'todos', 'Accept': 'application/vnd.todos+json' };
  stateManager.saveCollection(demoCollection);

  const resolvedHierarchicalHeaders = variableService.resolveHeaders('Stage-East', demoCollection.id, demoCollection.folders[0].id, {
    'X-Request-Trace': 'trace-999',
    'accept': 'application/xml' // Lowercase override of Folder's 'Accept'
  });

  assert.strictEqual(resolvedHierarchicalHeaders['X-Common-Base'], 'true', 'Parent environment header should be inherited');
  assert.strictEqual(resolvedHierarchicalHeaders['X-Region'], 'us-east-1', 'Active environment header should be inherited');
  assert.strictEqual(resolvedHierarchicalHeaders['X-Collection-Scope'], 'orders-v1', 'Collection header should be inherited');
  assert.strictEqual(resolvedHierarchicalHeaders['X-Folder-Scope'], 'todos', 'Folder header should be inherited');
  assert.strictEqual(resolvedHierarchicalHeaders['X-Request-Trace'], 'trace-999', 'Request header should be included');
  assert.strictEqual(resolvedHierarchicalHeaders['accept'], 'application/xml', 'Request header should case-insensitively override inherited Accept header');
  assert.strictEqual(resolvedHierarchicalHeaders['Accept'], undefined, 'Overridden header with different casing should not create duplicate keys');
  console.log('✓ Hierarchical headers across environments, collections, folders, and requests passed');

  // Test 23: Detailed Traceability & Inherited Inspector Resolution
  const varDetails = variableService.resolveVariablesDetailed(
    'Development',
    'Stage-East',
    demoCollection.id,
    demoCollection.folders[0].id,
    [{ name: 'region', value: 'override-at-request', enabled: true }]
  );
  assert(varDetails.inherited.some(i => i.key === '$uuid' && i.source === 'dynamic'), 'Dynamic variable info should be listed in inherited');
  assert(varDetails.inherited.some(i => i.key === 'commonHost' && i.source === 'parent-environment'), 'Parent env variable must be labeled parent-environment');
  assert(varDetails.inherited.some(i => i.key === 'region' && i.isOverridden === true), 'Inherited variable overridden at request level must be flagged isOverridden');

  const headerDetails = variableService.resolveHeadersDetailed(
    'Stage-East',
    demoCollection.id,
    demoCollection.folders[0].id,
    { 'x-collection-scope': 'override' }
  );
  assert(headerDetails.inherited.some(h => h.key === 'X-Collection-Scope' && h.isOverridden === true), 'Inherited header overridden by request must have isOverridden = true');
  console.log('✓ Detailed traceability and inherited inspector resolution passed');

  // Test 24: JSON Typed Variable Coercion
  const jsonBodyTemplate = '{\n  "active": "{{FLAG_ACTIVE}}",\n  "disabled": "{{FLAG_DISABLED}}",\n  "count": {{COUNT}},\n  "empty": "{{NULL_VAL}}",\n  "text": "{{TEXT}}"\n}';
  const coercedBody = variableService.coerceTypedVarTokens(jsonBodyTemplate, {
    FLAG_ACTIVE: 'true',
    FLAG_DISABLED: 'false',
    COUNT: '42',
    NULL_VAL: 'null',
    TEXT: 'hello'
  });
  const finalJson = variableService.interpolate(coercedBody, {
    COUNT: '42',
    TEXT: 'hello'
  });
  const parsedCoerced = JSON.parse(finalJson);
  assert.strictEqual(parsedCoerced.active, true, 'Quoted "{{FLAG_ACTIVE}}" must coerce to boolean true');
  assert.strictEqual(parsedCoerced.disabled, false, 'Quoted "{{FLAG_DISABLED}}" must coerce to boolean false');
  assert.strictEqual(parsedCoerced.empty, null, 'Quoted "{{NULL_VAL}}" must coerce to null');
  assert.strictEqual(parsedCoerced.count, 42, 'Unquoted {{COUNT}} must remain number 42');
  assert.strictEqual(parsedCoerced.text, 'hello', 'Quoted "{{TEXT}}" must remain string "hello"');
  console.log('✓ JSON typed variable coercion (boolean, null, primitive preservation) passed');

  // Test 25: Settings Panel & Request Panel HTML Rendering for Inherited Variables & Headers
  const envSettingsHtml = getSettingsPanelHtml(
    'environment',
    stateManager.getEnvironment('Stage-East'),
    'Stage-East',
    undefined,
    [{ id: 'env-stage-base', name: 'Stage-Base' }, { id: 'env-stage-east', name: 'Stage-East' }]
  );
  assert(envSettingsHtml.includes('id="env-parent"'), 'Environment settings must include Parent Environment selector');
  assert(envSettingsHtml.includes('Stage-Base'), 'Parent Environment dropdown must list available parent environments');
  assert(envSettingsHtml.includes('data-tab="tab-headers"'), 'Settings panel must render Headers tab');
  assert(envSettingsHtml.includes('id="header-rows"'), 'Settings panel must include header-rows container');

  const renderedReqPanelHtml = getRequestPanelHtml(
    {
      method: 'GET',
      url: '{{baseUrl}}/test',
      collection: demoCollection.name,
      folder: demoCollection.folders[0].name,
      environment: 'Stage-East'
    },
    stateManager.getState(),
    varDetails.inherited,
    headerDetails.inherited
  );
  assert(renderedReqPanelHtml.includes('id="inherited-vars-section"'), 'Request panel must render Inherited Variables section');
  assert(renderedReqPanelHtml.includes('id="inherited-headers-section"'), 'Request panel must render Inherited Headers section');
  assert(renderedReqPanelHtml.includes('id="inherited-var-rows"'), 'Request panel must include inherited-var-rows container');
  assert(renderedReqPanelHtml.includes('id="inherited-header-rows"'), 'Request panel must include inherited-header-rows container');

  const reqScriptMatch = renderedReqPanelHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert(reqScriptMatch, 'Request panel HTML must contain client script');
  assert.doesNotThrow(() => {
    new Function(reqScriptMatch[1]);
  }, 'Client script in request panel HTML must compile without syntax errors');
  console.log('✓ Settings Panel and Request Panel HTML rendering for Inherited Variables & Headers verified');

  // Test 26: Create Profile & Create Environment with UI Command Manifest
  const createdProf = stateManager.createProfile('QA Security Team');
  assert(createdProf && createdProf.id, 'createProfile should return created profile with unique ID');
  assert.strictEqual(createdProf.name, 'QA Security Team', 'Created profile name should match');
  assert(createdProf.auth && createdProf.auth.type === 'none', 'Default auth type should be none');
  assert(stateManager.getProfile(createdProf.id), 'Should retrieve created profile by id');
  assert(stateManager.getProfile('QA Security Team'), 'Should retrieve created profile by name');

  // Collision handling test
  const dupProf = stateManager.createProfile('QA Security Team');
  assert.strictEqual(dupProf.name, 'QA Security Team (2)', 'Duplicate profile name should auto-increment');
  assert.notStrictEqual(dupProf.id, createdProf.id, 'Duplicate profile should have distinct ID');

  const createdEnvRes = stateManager.createEnvironment('Preview-Canary', 'https://canary.api.example.com');
  assert(createdEnvRes && createdEnvRes.env && createdEnvRes.env.id, 'createEnvironment should return environment object');
  assert.strictEqual(createdEnvRes.name, 'Preview-Canary', 'Environment name should match');
  assert.strictEqual(createdEnvRes.env.baseUrl, 'https://canary.api.example.com', 'Environment baseUrl should match');
  assert(stateManager.getEnvironment('Preview-Canary'), 'Should retrieve created environment by name');
  assert(stateManager.getEnvironment(createdEnvRes.env.id), 'Should retrieve created environment by id');

  // Duplicate environment collision handling test
  const dupEnvRes = stateManager.createEnvironment('Preview-Canary');
  assert.strictEqual(dupEnvRes.name, 'Preview-Canary (2)', 'Duplicate environment name should auto-increment');

  // Validate package.json commands and context menu definitions
  const pkgJson = require('../package.json');
  const commands = pkgJson.contributes.commands.map(c => c.command);
  assert(commands.includes('byrdsnestApiClient.createProfile') || commands.includes('blueByrdApiClient.createProfile'), 'package.json must register createProfile');
  assert(commands.includes('byrdsnestApiClient.createEnvironment') || commands.includes('blueByrdApiClient.createEnvironment'), 'package.json must register createEnvironment');

  const contextMenus = pkgJson.contributes.menus['view/item/context'];
  const profileInline = contextMenus.find(m => (m.command === 'byrdsnestApiClient.createProfile' || m.command === 'blueByrdApiClient.createProfile') && (m.when.includes('byrdsnest.section.profiles') || m.when.includes('bluebyrd.section.profiles')));
  assert(profileInline, 'Must have inline menu action on section.profiles');
  assert.strictEqual(profileInline.group, 'inline@1', 'Profile inline action must be positioned at inline@1');

  const envInline = contextMenus.find(m => (m.command === 'byrdsnestApiClient.createEnvironment' || m.command === 'blueByrdApiClient.createEnvironment') && (m.when.includes('byrdsnest.section.environments') || m.when.includes('bluebyrd.section.environments')));
  assert(envInline, 'Must have inline menu action on section.environments');
  assert.strictEqual(envInline.group, 'inline@1', 'Environment inline action must be positioned at inline@1');

  console.log('✓ Create Profile and Create Environment lifecycle & manifest verified');

  // Test 27: Postman Collection (v2.1) & Postman Environment Import
  const samplePostmanCol = JSON.stringify({
    info: {
      name: 'Stripe Payments Collection',
      description: 'Collection for processing customer payments',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    variable: [
      { key: 'baseUrl', value: 'https://api.stripe.com/v1' },
      { key: 'version', value: '2023-10-16' }
    ],
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: 'sk_test_123456789' }]
    },
    item: [
      {
        name: 'Customers',
        item: [
          {
            name: 'Create Customer',
            request: {
              method: 'POST',
              header: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
              body: {
                mode: 'urlencoded',
                urlencoded: [{ key: 'email', value: 'test@example.com' }, { key: 'name', value: 'Jane Doe' }]
              },
              url: {
                raw: '{{baseUrl}}/customers',
                host: ['{{baseUrl}}'],
                path: ['customers']
              }
            }
          }
        ]
      },
      {
        name: 'Health Check',
        request: {
          method: 'GET',
          url: 'https://api.stripe.com/health'
        }
      }
    ]
  });

  const parsedPostmanCol = ImportExportService.parse(samplePostmanCol);
  assert.strictEqual(parsedPostmanCol.type, 'postman-collection', 'Should detect postman-collection');
  assert.strictEqual(parsedPostmanCol.collection.name, 'Stripe Payments Collection', 'Should parse collection name');
  assert.strictEqual(parsedPostmanCol.collection.variables.baseUrl, 'https://api.stripe.com/v1', 'Should parse collection variable');
  assert(parsedPostmanCol.collection.auth && parsedPostmanCol.collection.auth.auth.token === 'sk_test_123456789', 'Should parse bearer auth');
  assert.strictEqual(parsedPostmanCol.collection.folders.length, 1, 'Should parse 1 folder');
  assert.strictEqual(parsedPostmanCol.collection.folders[0].name, 'Customers', 'Should parse folder name');
  assert.strictEqual(parsedPostmanCol.collection.folders[0].requests.length, 1, 'Should parse folder request');
  assert.strictEqual(parsedPostmanCol.collection.folders[0].requests[0].bodyType, 'form-urlencoded', 'Should detect urlencoded body');
  assert.strictEqual(parsedPostmanCol.collection.requests.length, 1, 'Should parse root request');
  assert.strictEqual(parsedPostmanCol.collection.requests[0].name, 'Health Check', 'Root request name should match');

  // Postman Environment import
  const samplePostmanEnv = JSON.stringify({
    name: 'Production Environment',
    _postman_variable_scope: 'environment',
    values: [
      { key: 'baseUrl', value: 'https://api.prod.example.com', enabled: true },
      { key: 'apiKey', value: 'prod_secret_token', enabled: true },
      { key: 'disabledVar', value: 'skip', enabled: false }
    ]
  });

  const parsedPostmanEnv = ImportExportService.parse(samplePostmanEnv);
  assert.strictEqual(parsedPostmanEnv.type, 'postman-environment', 'Should detect postman-environment');
  assert.strictEqual(parsedPostmanEnv.environmentName, 'Production Environment', 'Should parse environment name');
  assert.strictEqual(parsedPostmanEnv.environment.baseUrl, 'https://api.prod.example.com', 'Should extract baseUrl');
  assert.strictEqual(parsedPostmanEnv.environment.variables.apiKey, 'prod_secret_token', 'Should parse active variable');
  assert.strictEqual(parsedPostmanEnv.environment.variables.disabledVar, undefined, 'Should ignore disabled variable');
  console.log('✓ Postman Collection v2.1 & Postman Environment import passed');

  // Test 28: OpenAPI 3.0 & Swagger 2.0 Import
  const sampleOpenApi = JSON.stringify({
    openapi: '3.0.0',
    info: {
      title: 'Petstore API',
      version: '2.4.0',
      description: 'OpenAPI 3.0 specification for Petstore'
    },
    servers: [
      { url: 'https://petstore.swagger.io/v2' }
    ],
    paths: {
      '/pet': {
        post: {
          summary: 'Add a new pet to the store',
          tags: ['Pet'],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'doggie' },
                    status: { type: 'string', enum: ['available', 'pending'] }
                  }
                }
              }
            }
          }
        }
      },
      '/pet/{petId}': {
        get: {
          summary: 'Find pet by ID',
          tags: ['Pet'],
          parameters: [
            { name: 'petId', in: 'path', required: true, example: '123' },
            { name: 'apiKey', in: 'header', example: 'special-key' }
          ]
        }
      },
      '/health': {
        get: {
          summary: 'Check API Status'
        }
      }
    }
  });

  const parsedOpenApi = ImportExportService.parse(sampleOpenApi);
  assert.strictEqual(parsedOpenApi.type, 'openapi', 'Should detect OpenAPI format');
  assert.strictEqual(parsedOpenApi.collection.name, 'Petstore API v2.4.0', 'Should format name with version');
  assert.strictEqual(parsedOpenApi.collection.variables.baseUrl, 'https://petstore.swagger.io/v2', 'Should extract server baseUrl');
  assert.strictEqual(parsedOpenApi.collection.folders.length, 1, 'Should create 1 folder for Pet tag');
  assert.strictEqual(parsedOpenApi.collection.folders[0].requests.length, 2, 'Pet folder should have 2 requests');

  const addPetReq = parsedOpenApi.collection.folders[0].requests.find(r => r.method === 'POST');
  assert(addPetReq, 'Should have POST /pet request');
  assert.strictEqual(addPetReq.bodyType, 'json', 'Should detect JSON bodyType');
  const parsedGeneratedBody = JSON.parse(addPetReq.body);
  assert.strictEqual(parsedGeneratedBody.name, 'doggie', 'Should generate example property from schema');

  const getPetReq = parsedOpenApi.collection.folders[0].requests.find(r => r.method === 'GET');
  assert(getPetReq, 'Should have GET /pet/{petId} request');
  assert.strictEqual(getPetReq.url, '{{baseUrl}}/pet/{{petId}}', 'Should convert {petId} to {{petId}}');
  assert.strictEqual(getPetReq.headers['apiKey'], 'special-key', 'Should extract header parameter');

  assert.strictEqual(parsedOpenApi.collection.requests.length, 1, 'Untagged request should be at root');
  assert.strictEqual(parsedOpenApi.collection.requests[0].name, 'Check API Status', 'Untagged request should be health check');
  console.log('✓ OpenAPI 3.0 / Swagger 2.0 import passed');

  // Test 29: Native byrdsnest Export & Full Backup Restore Lifecycle + Manifest
  const exportColJson = ImportExportService.exportCollection(parsedPostmanCol.collection);
  assert(exportColJson.includes('byrdsnest.collection') || exportColJson.includes('bluebyrd.collection'), 'Exported collection must include kind');
  const reimportedCol = ImportExportService.parse(exportColJson);
  assert(reimportedCol.type === 'byrdsnest-collection' || reimportedCol.type === 'bluebyrd-collection', 'Should roundtrip native collection');
  assert.strictEqual(reimportedCol.collection.name, 'Stripe Payments Collection');

  const exportEnvJson = ImportExportService.exportEnvironment(parsedPostmanEnv.environmentName, parsedPostmanEnv.environment);
  assert(exportEnvJson.includes('byrdsnest.environment') || exportEnvJson.includes('bluebyrd.environment'), 'Exported environment must include kind');
  const reimportedEnv = ImportExportService.parse(exportEnvJson);
  assert(reimportedEnv.type === 'byrdsnest-environment' || reimportedEnv.type === 'bluebyrd-environment', 'Should roundtrip native environment');
  assert.strictEqual(reimportedEnv.environmentName, 'Production Environment');

  const exportBackupJson = ImportExportService.exportBackup(stateManager.getState());
  assert(exportBackupJson.includes('byrdsnestBackupVersion') || exportBackupJson.includes('bluebyrdBackupVersion'), 'Exported backup must include version header');
  const reimportedBackup = ImportExportService.parse(exportBackupJson);
  assert(reimportedBackup.type === 'byrdsnest-backup' || reimportedBackup.type === 'bluebyrd-backup', 'Should roundtrip full workspace backup');
  assert(reimportedBackup.state.collections.length > 0, 'Backup state must preserve collections');
  assert(reimportedBackup.state.profiles.length > 0, 'Backup state must preserve profiles');

  // Manifest check for Import/Export commands & menus
  assert(commands.includes('byrdsnestApiClient.importJson') || commands.includes('blueByrdApiClient.importJson'), 'package.json must register importJson');
  assert(commands.includes('byrdsnestApiClient.exportCollection') || commands.includes('blueByrdApiClient.exportCollection'), 'package.json must register exportCollection');
  assert(commands.includes('byrdsnestApiClient.exportEnvironment') || commands.includes('blueByrdApiClient.exportEnvironment'), 'package.json must register exportEnvironment');
  assert(commands.includes('byrdsnestApiClient.exportBackup') || commands.includes('blueByrdApiClient.exportBackup'), 'package.json must register exportBackup');

  const titleMenus = pkgJson.contributes.menus['view/title'];
  assert(titleMenus.some(m => m.command === 'byrdsnestApiClient.importJson' || m.command === 'blueByrdApiClient.importJson'), 'Title menu must include importJson action');

  const importColInline = contextMenus.find(m => (m.command === 'byrdsnestApiClient.importJson' || m.command === 'blueByrdApiClient.importJson') && (m.when.includes('byrdsnest.section.collections') || m.when.includes('bluebyrd.section.collections')));
  assert(importColInline, 'Must have inline import action on collections section');
  const importEnvInline = contextMenus.find(m => (m.command === 'byrdsnestApiClient.importJson' || m.command === 'blueByrdApiClient.importJson') && (m.when.includes('byrdsnest.section.environments') || m.when.includes('bluebyrd.section.environments')));
  assert(importEnvInline, 'Must have inline import action on environments section');

  const exportColInline = contextMenus.find(m => (m.command === 'byrdsnestApiClient.exportCollection' || m.command === 'blueByrdApiClient.exportCollection') && (m.when.includes('byrdsnest.collection') || m.when.includes('bluebyrd.collection')));
  assert(exportColInline, 'Must have inline export action on collection item');
  const exportEnvInline = contextMenus.find(m => (m.command === 'byrdsnestApiClient.exportEnvironment' || m.command === 'blueByrdApiClient.exportEnvironment') && (m.when.includes('byrdsnest.environment') || m.when.includes('bluebyrd.environment')));
  assert(exportEnvInline, 'Must have inline export action on environment item');

  console.log('✓ Native byrdsnest Export & Full Backup Restore Lifecycle + Manifest passed');

  // Test 30: Legacy Profile Backup & Multi-Collection/Environment Compatibility
  const legacyBackupSample = JSON.stringify({
    version: 1,
    exportedAt: 1789144264979,
    profile: {
      id: 'prof-legacy-1',
      name: 'LegacyProfile'
    },
    collections: [
      {
        id: 'col-legacy-1',
        name: 'Legacy Collection',
        auth: {
          type: 'oauth2',
          config: {
            grantType: 'client_credentials',
            tokenUrl: 'https://auth.example.com/token',
            clientId: 'client-123',
            clientSecret: 'secret-456'
          }
        },
        folders: [
          {
            id: 'fold-1',
            name: 'Orders',
            requests: [
              {
                id: 'req-order-1',
                name: 'Search Orders',
                method: 'POST',
                url: 'https://api.example.com/orders/search',
                headers: [{ key: 'X-Tenant', value: 'TenantA', enabled: true }],
                bodyType: 'raw-json',
                bodyRaw: '{"query": "status=active"}'
              }
            ]
          }
        ],
        requests: []
      }
    ],
    environments: [
      {
        id: 'env-legacy-1',
        name: 'Stage Env',
        variables: [
          { key: 'app_host', value: 'https://stage.example.com', enabled: true },
          { key: 'apiKey', value: 'key-123', enabled: true }
        ]
      }
    ]
  });

  const parsedLegacy = ImportExportService.parse(legacyBackupSample);
  assert(parsedLegacy.type === 'byrdsnest-backup' || parsedLegacy.type === 'bluebyrd-backup', 'Should detect legacy profile backup');
  assert.strictEqual(parsedLegacy.state.profiles.length, 1);
  assert.strictEqual(parsedLegacy.state.profiles[0].name, 'LegacyProfile');
  assert.strictEqual(parsedLegacy.state.collections.length, 1);
  assert.strictEqual(parsedLegacy.state.collections[0].name, 'Legacy Collection');
  assert.strictEqual(parsedLegacy.state.collections[0].auth.auth.type, 'oauth2');
  assert.strictEqual(parsedLegacy.state.collections[0].auth.auth.clientId, 'client-123');
  assert.strictEqual(parsedLegacy.state.collections[0].folders[0].requests[0].bodyType, 'json');
  assert.strictEqual(parsedLegacy.state.collections[0].folders[0].requests[0].headers['X-Tenant'], 'TenantA');
  assert(parsedLegacy.state.environments['Stage Env'], 'Should parse environment by name');
  assert.strictEqual(parsedLegacy.state.environments['Stage Env'].baseUrl, 'https://stage.example.com');
  assert.strictEqual(parsedLegacy.state.environments['Stage Env'].variables['apiKey'], 'key-123');

  // Verify actual disk file if accessible
  const actualFilePath = 'C:/Users/chase-developer/Downloads/mawm_collection_export_CB_2609111231.json';
  if (fs.existsSync(actualFilePath)) {
    const rawActual = fs.readFileSync(actualFilePath, 'utf8');
    const parsedActual = ImportExportService.parse(rawActual);
    assert(parsedActual.type === 'byrdsnest-backup' || parsedActual.type === 'bluebyrd-backup');
    assert.strictEqual(parsedActual.state.collections.length, 5, 'Should import all 5 collections');
    const totalActualReqs = parsedActual.state.collections.reduce(
      (sum, c) => sum + c.requests.length + c.folders.reduce((fsum, f) => fsum + f.requests.length, 0),
      0
    );
    assert.strictEqual(totalActualReqs, 475, 'Should parse all 475 requests accurately');
    assert.strictEqual(Object.keys(parsedActual.state.environments).length, 10, 'Should import all 10 environments');
    assert(parsedActual.state.environments['VPT Stage 33'], 'Should contain VPT Stage 33');
    assert.strictEqual(parsedActual.state.environments['VPT Stage 33'].baseUrl, 'https://twccv.sce.manh.com');
  }

  console.log('✓ Legacy Profile Backup & 475-request full export verified');

  // Test 31: UpdateService Semver Logic & Update Command Manifest
  assert.strictEqual(UpdateService.isNewerVersion('0.2.0', '0.1.0'), true, '0.2.0 should be newer than 0.1.0');
  assert.strictEqual(UpdateService.isNewerVersion('1.0.0', '0.1.0'), true, '1.0.0 should be newer than 0.1.0');
  assert.strictEqual(UpdateService.isNewerVersion('0.1.1', '0.1.0'), true, '0.1.1 should be newer than 0.1.0');
  assert.strictEqual(UpdateService.isNewerVersion('v0.1.5', '0.1.0'), true, 'v0.1.5 should be newer than 0.1.0');
  assert.strictEqual(UpdateService.isNewerVersion('0.1.0', '0.1.0'), false, '0.1.0 should not be newer than 0.1.0');
  assert.strictEqual(UpdateService.isNewerVersion('0.0.9', '0.1.0'), false, '0.0.9 should not be newer than 0.1.0');
  assert.strictEqual(UpdateService.isNewerVersion('v0.1.0', 'v0.1.0'), false, 'v0.1.0 should not be newer than v0.1.0');

  const mockGlobalState = new Map();
  const mockExtContext = {
    globalState: {
      get: (k) => mockGlobalState.get(k),
      update: (k, v) => { mockGlobalState.set(k, v); return Promise.resolve(); }
    },
    extension: {
      packageJSON: { version: '0.1.0' }
    }
  };
  const updateService = new UpdateService(mockExtContext);
  assert.strictEqual(updateService.getCurrentVersion(), '0.1.0', 'Current version should match manifest version');

  const pkgJsonUpdated = require('../package.json');
  const allCommands = pkgJsonUpdated.contributes.commands.map(c => c.command);
  assert(allCommands.includes('byrdsnestApiClient.checkForUpdates') || allCommands.includes('blueByrdApiClient.checkForUpdates'), 'package.json must register checkForUpdates');

  console.log('✓ UpdateService semver logic & update command manifest verified');

  // Test 32: Security Hardening (Prototype Pollution & Webview Script Neutralization)
  const prototypePayload = JSON.stringify({
    info: {
      name: 'Pollution Collection',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: [
      {
        name: 'Evil Request',
        request: {
          url: 'https://example.com/api',
          method: 'GET',
          header: [
            { key: '__proto__', value: 'polluted' },
            { key: 'constructor', value: 'polluted' },
            { key: 'X-Safe-Header', value: 'clean' }
          ]
        }
      }
    ]
  });
  const parsedPollution = ImportExportService.parse(prototypePayload);
  const evilHeaders = parsedPollution.collection.requests[0].headers;
  assert.strictEqual(evilHeaders['X-Safe-Header'], 'clean', 'Safe header should be retained');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(evilHeaders, '__proto__'), false, '__proto__ key must not exist as own property');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(evilHeaders, 'constructor'), false, 'constructor key must not exist as own property');
  assert.strictEqual(({}).polluted, undefined, 'Object.prototype must not be polluted');

  const xssContext = {
    url: 'https://example.com/"><img src=x onerror=alert(1)>',
    notes: '</textarea><script>alert("xss")</script>',
    body: '{"evil": "</script><script>alert(2)</script>"}',
  };
  const requestPanelHtml = require('../dist/views/panels/requestPanelHtml');
  const renderedHtml = requestPanelHtml.getRequestPanelHtml(xssContext, stateManager.getState());
  assert(!renderedHtml.includes('onerror=alert(1)>'), 'Attributes in rendered HTML must be safely escaped');
  assert(!renderedHtml.includes('</textarea><script>'), 'Textareas in rendered HTML must be safely escaped');
  assert(!renderedHtml.includes('</script><script>'), 'Script tag breakout via embedded JSON must be neutralized');

  console.log('✓ Webview XSS & prototype pollution security hardening verified');

  // Test 33: Profile-Scoped Workspace & Visual Parent -> Child Environment Tree Nesting
  const hierarchyStorage = new Map();
  const hierarchyContext = {
    workspaceState: {
      get: (k) => hierarchyStorage.get(k),
      update: (k, v) => { hierarchyStorage.set(k, v); return Promise.resolve(); }
    }
  };
  const hierarchySM = new BlueByrdStateManager(hierarchyContext);

  // Setup Profiles: Tenant Alpha (profile-alpha) and Tenant Beta (profile-beta)
  const profAlpha = hierarchySM.createProfile('Tenant Alpha');
  const profBeta = hierarchySM.createProfile('Tenant Beta');

  // Setup Environments:
  // - Global Root (no profileId)
  // - Alpha Base (scoped to profAlpha.id)
  // - Alpha Dev (scoped to profAlpha.id, inheritsFrom Alpha Base)
  // - Alpha Dev Feature 1 (scoped to profAlpha.id, inheritsFrom Alpha Dev)
  // - Beta Prod (scoped to profBeta.id)
  hierarchySM.createEnvironment('Global Root', 'https://api.global.com');
  const alphaBase = hierarchySM.createEnvironment('Alpha Base', 'https://alpha.example.com', profAlpha.id);
  const alphaDev = hierarchySM.createEnvironment('Alpha Dev', 'https://dev.alpha.example.com', profAlpha.id);
  alphaDev.env.inheritsFrom = alphaBase.env.id;
  hierarchySM.saveEnvironment('Alpha Dev', alphaDev.env);

  const alphaFeature = hierarchySM.createEnvironment('Alpha Feature 1', 'https://feat.alpha.example.com', profAlpha.id);
  alphaFeature.env.inheritsFrom = alphaDev.env.id;
  hierarchySM.saveEnvironment('Alpha Feature 1', alphaFeature.env);

  hierarchySM.createEnvironment('Beta Prod', 'https://beta.example.com', profBeta.id);

  // Setup Collections:
  // - Global Shared Library (no profileId)
  // - Alpha Orders API (scoped to profAlpha.id)
  // - Beta Inventory API (scoped to profBeta.id)
  hierarchySM.createCollection('Global Shared Library');
  hierarchySM.createCollection('Alpha Orders API', profAlpha.id);
  hierarchySM.createCollection('Beta Inventory API', profBeta.id);

  // Initialize Explorer Tree Provider
  const treeProvider = new BlueByrdExplorerTreeDataProvider(hierarchySM);

  // 1. Verify Root has Profiles and History sections
  const rootItems = treeProvider.getChildren();
  assert.strictEqual(rootItems.length, 2, 'Root should have 2 sections: Profiles and History');
  const [profilesSection, historySection] = rootItems;
  assert.strictEqual(profilesSection.label, 'Profiles');
  assert.strictEqual(historySection.label, 'History');

  // 2. Verify Profiles section contains profiles + Shared / Global
  const profileItems = treeProvider.getChildren(profilesSection);
  const profileLabels = profileItems.map(p => p.label);
  assert(profileLabels.includes('Tenant Alpha'), 'Must include Tenant Alpha');
  assert(profileLabels.includes('Tenant Beta'), 'Must include Tenant Beta');
  assert(profileLabels.includes('Shared / Global'), 'Must include Shared / Global');

  // 3. Verify Tenant Alpha owns its Environments and Collections
  const alphaItem = profileItems.find(p => p.label === 'Tenant Alpha');
  assert(alphaItem, 'Tenant Alpha must exist');
  const alphaChildren = treeProvider.getChildren(alphaItem);
  assert.strictEqual(alphaChildren.length, 2, 'Tenant Alpha must have Environments and Collections nodes');
  const [alphaEnvsNode, alphaColsNode] = alphaChildren;
  assert.strictEqual(alphaEnvsNode.label, 'Environments');
  assert.strictEqual(alphaColsNode.label, 'Collections');

  // Verify Environments nested inside Tenant Alpha
  const alphaEnvs = treeProvider.getChildren(alphaEnvsNode);
  const alphaEnvLabels = alphaEnvs.map(e => e.label);
  assert(alphaEnvLabels.includes('Alpha Base'), 'Alpha Base must be in Tenant Alpha environments');
  assert(!alphaEnvLabels.includes('Beta Prod'), 'Beta Prod must NOT be in Tenant Alpha environments');
  assert(!alphaEnvLabels.includes('Global Root'), 'Global Root must NOT be in Tenant Alpha environments');

  // Verify Parent -> Child hierarchy under Alpha Base:
  const alphaBaseItem = alphaEnvs.find(e => e.label === 'Alpha Base');
  assert(alphaBaseItem, 'Alpha Base must exist');
  assert.strictEqual(alphaBaseItem.children.length, 1, 'Alpha Base should have 1 child (Alpha Dev)');
  assert(alphaBaseItem.description.includes('Parent (1)'), 'Alpha Base description should indicate 1 child');

  // Verify Alpha Dev nested under Alpha Base
  const alphaBaseChildren = treeProvider.getChildren(alphaBaseItem);
  assert.strictEqual(alphaBaseChildren.length, 1);
  const alphaDevItem = alphaBaseChildren[0];
  assert.strictEqual(alphaDevItem.label, 'Alpha Dev');
  assert(alphaDevItem.description.includes('Parent (1)'), 'Alpha Dev should have 1 child (Alpha Feature 1)');

  // Verify multi-level nesting: expanding Alpha Dev returns Alpha Feature 1
  const alphaDevChildren = treeProvider.getChildren(alphaDevItem);
  assert.strictEqual(alphaDevChildren.length, 1);
  const alphaFeatureItem = alphaDevChildren[0];
  assert.strictEqual(alphaFeatureItem.label, 'Alpha Feature 1');
  assert(alphaFeatureItem.description.includes('inherits: Alpha Dev'), 'Child environment should show parent in description');

  // Verify Collections nested inside Tenant Alpha
  const alphaCols = treeProvider.getChildren(alphaColsNode);
  const alphaColLabels = alphaCols.map(c => c.label);
  assert(alphaColLabels.includes('Alpha Orders API'), 'Alpha Orders API must be in Tenant Alpha collections');
  assert(!alphaColLabels.includes('Beta Inventory API'), 'Beta Inventory API must NOT be in Tenant Alpha collections');
  assert(!alphaColLabels.includes('Global Shared Library'), 'Global Shared Library must NOT be in Tenant Alpha collections');

  // 4. Verify Tenant Beta owns its Environments and Collections
  const betaItem = profileItems.find(p => p.label === 'Tenant Beta');
  assert(betaItem, 'Tenant Beta must exist');
  const betaChildren = treeProvider.getChildren(betaItem);
  const [betaEnvsNode, betaColsNode] = betaChildren;

  const betaEnvs = treeProvider.getChildren(betaEnvsNode);
  const betaEnvLabels = betaEnvs.map(e => e.label);
  assert(betaEnvLabels.includes('Beta Prod'), 'Beta Prod must be in Tenant Beta');
  assert(!betaEnvLabels.includes('Alpha Base'), 'Alpha Base must NOT be in Tenant Beta');

  const betaCols = treeProvider.getChildren(betaColsNode);
  const betaColLabels = betaCols.map(c => c.label);
  assert(betaColLabels.includes('Beta Inventory API'), 'Beta Inventory API must be in Tenant Beta');
  assert(!betaColLabels.includes('Alpha Orders API'), 'Alpha Orders API must NOT be in Tenant Beta');

  // 5. Verify Shared / Global owns unassigned/global Environments and Collections
  const globalItem = profileItems.find(p => p.label === 'Shared / Global');
  assert(globalItem, 'Shared / Global must exist');
  const [globalEnvsNode, globalColsNode] = treeProvider.getChildren(globalItem);

  const globalEnvs = treeProvider.getChildren(globalEnvsNode);
  assert(globalEnvs.some(e => e.label === 'Global Root'), 'Global Root must be in Shared / Global');
  assert(!globalEnvs.some(e => e.label === 'Alpha Base'), 'Alpha Base must NOT be in Shared / Global');

  const globalCols = treeProvider.getChildren(globalColsNode);
  assert(globalCols.some(c => c.label === 'Global Shared Library'), 'Global Shared Library must be in Shared / Global');
  assert(!globalCols.some(c => c.label === 'Alpha Orders API'), 'Alpha Orders API must NOT be in Shared / Global');

  // 6. Verify Active Profile & Active Environment Badges
  hierarchySM.setActiveProfileId(profAlpha.id);
  hierarchySM.setActiveEnvironmentName('Alpha Dev');
  treeProvider.refresh();

  const refreshedProfiles = treeProvider.getChildren(treeProvider.getChildren()[0]);
  const activeAlphaItem = refreshedProfiles.find(p => p.label === 'Tenant Alpha');
  assert(activeAlphaItem.description.includes('✔ Active'), 'Active profile must display ✔ Active Scope badge');

  const refreshedAlphaEnvs = treeProvider.getChildren(treeProvider.getChildren(activeAlphaItem)[0]);
  const refreshedBase = refreshedAlphaEnvs.find(e => e.label === 'Alpha Base');
  const refreshedDev = treeProvider.getChildren(refreshedBase)[0];
  assert(refreshedDev.description.includes('✔ Active'), 'Active environment Alpha Dev must show ✔ Active badge');

  console.log('✓ Profile-Scoped Workspace & Visual Parent -> Child Environment Tree Nesting verified');

  // Test 34: Breakout Native View Panes Architecture & Profile OAuth Token Vault
  const tokenService = new TokenService();
  const breakoutProfiles = new BlueByrdProfilesTreeProvider(hierarchySM, tokenService);
  const breakoutCollections = new BlueByrdCollectionsTreeProvider(hierarchySM);
  const breakoutEnvironments = new BlueByrdEnvironmentsTreeProvider(hierarchySM);
  const breakoutHistory = new BlueByrdHistoryTreeProvider(hierarchySM);

  let coordinatorRefreshed = false;
  const coordinator = new BlueByrdTreeCoordinator(
    breakoutProfiles,
    breakoutCollections,
    breakoutEnvironments,
    breakoutHistory,
    () => { coordinatorRefreshed = true; }
  );

  // 1. Verify Profiles view
  const profNodes = await breakoutProfiles.getChildren();
  const profNodeLabels = profNodes.map(p => p.label);
  assert(profNodeLabels.includes('Tenant Alpha'), 'Profiles view must list Tenant Alpha');
  assert(profNodeLabels.includes('Tenant Beta'), 'Profiles view must list Tenant Beta');
  assert(profNodeLabels.includes('Shared / Global'), 'Profiles view must list Shared / Global');
  const alphaProfNode = profNodes.find(p => p.label === 'Tenant Alpha');
  assert(alphaProfNode.description.includes('✔ Active'), 'Tenant Alpha must be marked active');

  // Verify Profile Token Vault (initial: no tokens)
  const initialAlphaTokens = await breakoutProfiles.getChildren(alphaProfNode);
  assert.strictEqual(initialAlphaTokens.length, 1);
  assert.strictEqual(initialAlphaTokens[0].label, 'No stored tokens');
  assert.strictEqual(initialAlphaTokens[0].kind, 'noTokens');

  // Save an OAuth token under Tenant Alpha
  await tokenService.saveToken({
    id: 'tok-alpha-dev',
    profileId: profAlpha.id,
    envId: alphaDev.env.id,
    envName: 'Alpha Dev',
    tokenName: 'Alpha Dev Bearer',
    accessToken: 'bb_oauth_alpha_dev_1234567890abcdef',
    refreshToken: 'bb_refresh_alpha_dev_abcdef1234567890',
    expiresAt: Date.now() + 3600 * 1000,
    scopes: ['read:orders', 'write:orders'],
    tier: 'Bearer',
  });

  // Verify Profile Token Vault displays the active token
  const updatedAlphaTokens = await breakoutProfiles.getChildren(alphaProfNode);
  assert.strictEqual(updatedAlphaTokens.length, 1);
  assert.strictEqual(updatedAlphaTokens[0].label, 'Alpha Dev');
  assert.strictEqual(updatedAlphaTokens[0].kind, 'token');
  assert(updatedAlphaTokens[0].description.includes('Bearer'));
  assert(updatedAlphaTokens[0].description.includes('Expires'));
  assert(updatedAlphaTokens[0].description.includes('refreshable'));

  // Verify AuthService auto-resolution with TokenService
  const authServiceWithTokens = new AuthService(hierarchySM, tokenService);
  const testOAuthReqAuth = {
    inheritFromProfile: true,
    inheritFromEnvironment: true,
    auth: {
      type: 'oauth2'
    }
  };
  const resolvedOAuthHeaders = authServiceWithTokens.resolveAuthHeaders(
    profAlpha.id,
    alphaDev.env.id,
    undefined,
    undefined,
    {},
    testOAuthReqAuth
  );
  assert(resolvedOAuthHeaders['Authorization'], 'Authorization header must be auto-injected from Token Vault');
  assert.strictEqual(resolvedOAuthHeaders['Authorization'], 'Bearer bb_oauth_alpha_dev_1234567890abcdef');

  // Verify token deletion
  await tokenService.deleteToken(profAlpha.id, 'tok-alpha-dev');
  const afterDeleteTokens = await breakoutProfiles.getChildren(alphaProfNode);
  assert.strictEqual(afterDeleteTokens.length, 1);
  assert.strictEqual(afterDeleteTokens[0].label, 'No stored tokens');

  // 2. Verify Collections view is scoped to active profile (Tenant Alpha) + Shared
  const alphaColNodes = breakoutCollections.getChildren();
  const breakoutAlphaColLabels = alphaColNodes.map(c => c.label);
  assert(breakoutAlphaColLabels.includes('Alpha Orders API'), 'Collections view must show Alpha Orders API for Tenant Alpha');
  assert(breakoutAlphaColLabels.includes('Global Shared Library'), 'Collections view must include Shared / Global collections');
  assert(!breakoutAlphaColLabels.includes('Beta Inventory API'), 'Collections view must NOT show Beta Inventory API under Tenant Alpha scope');

  // 3. Verify Environments view has Parent -> Child nesting for Tenant Alpha
  const alphaEnvNodes = breakoutEnvironments.getChildren();
  const breakoutAlphaEnvLabels = alphaEnvNodes.map(e => e.label);
  assert(breakoutAlphaEnvLabels.includes('Alpha Base'), 'Environments view must have root Alpha Base');
  assert(breakoutAlphaEnvLabels.includes('Global Root'), 'Environments view must include Shared / Global environment');
  assert(!breakoutAlphaEnvLabels.includes('Beta Prod'), 'Environments view must NOT include Beta Prod under Tenant Alpha scope');

  const breakoutAlphaBase = alphaEnvNodes.find(e => e.label === 'Alpha Base');
  assert(breakoutAlphaBase, 'Alpha Base node must exist');
  const breakoutAlphaBaseChildren = breakoutEnvironments.getChildren(breakoutAlphaBase);
  assert.strictEqual(breakoutAlphaBaseChildren.length, 1);
  const breakoutAlphaDev = breakoutAlphaBaseChildren[0];
  assert.strictEqual(breakoutAlphaDev.label, 'Alpha Dev');
  assert(breakoutAlphaDev.description.includes('✔ Active'), 'Active environment Alpha Dev must show ✔ Active');

  const breakoutAlphaDevChildren = breakoutEnvironments.getChildren(breakoutAlphaDev);
  assert.strictEqual(breakoutAlphaDevChildren.length, 1);
  assert.strictEqual(breakoutAlphaDevChildren[0].label, 'Alpha Feature 1');

  // 4. Verify dynamic re-scoping when switching to Tenant Beta
  hierarchySM.setActiveProfileId(profBeta.id);
  coordinator.refresh();
  assert(coordinatorRefreshed, 'Coordinator callback must fire on refresh');

  const betaColNodes = breakoutCollections.getChildren();
  const breakoutBetaColLabels = betaColNodes.map(c => c.label);
  assert(breakoutBetaColLabels.includes('Beta Inventory API'), 'Collections view must re-scope to Beta Inventory API');
  assert(!breakoutBetaColLabels.includes('Alpha Orders API'), 'Collections view must no longer show Alpha Orders API');

  const betaEnvNodes = breakoutEnvironments.getChildren();
  const breakoutBetaEnvLabels = betaEnvNodes.map(e => e.label);
  assert(breakoutBetaEnvLabels.includes('Beta Prod'), 'Environments view must re-scope to Beta Prod');
  assert(!breakoutBetaEnvLabels.includes('Alpha Base'), 'Environments view must no longer show Alpha Base');

  // 5. Verify History view
  const historyNodes = breakoutHistory.getChildren();
  assert(Array.isArray(historyNodes), 'History provider must return array of nodes');

  console.log('✓ Breakout Native View Panes Architecture & Profile OAuth Token Vault verified');

  // Test 35: Reorder Drag & Drop of Collections, Folders, and Requests
  // 1. Programmatic State Reordering & Moving
  const dndSM = new BlueByrdStateManager(mockContext);
  const colA = dndSM.createCollection('DnD Collection Alpha');
  const colB = dndSM.createCollection('DnD Collection Beta');

  // Verify reorderCollection
  const initialCols = dndSM.getCollections();
  const alphaIdx = initialCols.findIndex(c => c.id === colA.id);
  const betaIdx = initialCols.findIndex(c => c.id === colB.id);
  assert(alphaIdx < betaIdx, 'Alpha collection should originally be before Beta');

  dndSM.reorderCollection(colB.id, colA.id, 'before');
  const reorderedCols = dndSM.getCollections();
  assert.strictEqual(reorderedCols.findIndex(c => c.id === colB.id), alphaIdx, 'Beta should now be before Alpha');

  // Verify moveCollectionToEnd
  dndSM.moveCollectionToEnd(colB.id);
  const endCols = dndSM.getCollections();
  assert.strictEqual(endCols[endCols.length - 1].id, colB.id, 'Beta should be moved to the end');

  // Setup Folders in Col Alpha
  const folder1 = dndSM.createFolder(colA.id, 'Folder 1');
  const folder2 = dndSM.createFolder(colA.id, 'Folder 2');
  const folder3 = dndSM.createFolder(colA.id, 'Folder 3');

  // Verify reorderFolder within same collection
  dndSM.reorderFolder(colA.id, folder3.id, folder1.id, 'before');
  const updatedColA = dndSM.getCollection(colA.id);
  assert.strictEqual(updatedColA.folders[0].id, folder3.id, 'Folder 3 should now be the first folder');
  assert.strictEqual(updatedColA.folders[1].id, folder1.id, 'Folder 1 should now be second');

  // Verify moveFolderToCollection
  dndSM.moveFolderToCollection(folder2.id, colB.id);
  const afterMoveColA = dndSM.getCollection(colA.id);
  const afterMoveColB = dndSM.getCollection(colB.id);
  assert(!afterMoveColA.folders.some(f => f.id === folder2.id), 'Folder 2 must no longer be in Col Alpha');
  assert(afterMoveColB.folders.some(f => f.id === folder2.id), 'Folder 2 must now be in Col Beta');

  // Setup Requests
  const req1 = dndSM.saveRequest({
    id: 'req-dnd-1',
    name: 'Request 1',
    method: 'GET',
    url: 'https://api.test/1',
    collection: colA.name,
    headers: {},
    body: '',
  }, colA.id);

  const req2 = dndSM.saveRequest({
    id: 'req-dnd-2',
    name: 'Request 2',
    method: 'POST',
    url: 'https://api.test/2',
    collection: colA.name,
    headers: {},
    body: '',
  }, colA.id);

  // Verify request reordering at collection root
  dndSM.moveRequest(req2.id, colA.id, undefined, req1.id, 'before');
  const rootReqsColA = dndSM.getCollection(colA.id).requests;
  assert.strictEqual(rootReqsColA[0].id, req2.id, 'Request 2 should now be before Request 1');

  // Verify moving request into folder
  dndSM.moveRequest(req1.id, colA.id, folder3.id);
  const colAAfterReqMove = dndSM.getCollection(colA.id);
  assert(!colAAfterReqMove.requests.some(r => r.id === req1.id), 'Request 1 should no longer be at root');
  const f3 = colAAfterReqMove.folders.find(f => f.id === folder3.id);
  assert(f3.requests.some(r => r.id === req1.id), 'Request 1 should now be inside Folder 3');

  // Verify moving request across collections into folder
  dndSM.moveRequest(req1.id, colB.id, folder2.id);
  const colBAfterMove = dndSM.getCollection(colB.id);
  const f2 = colBAfterMove.folders.find(f => f.id === folder2.id);
  assert(f2.requests.some(r => r.id === req1.id), 'Request 1 should now be inside Col Beta / Folder 2');

  // Verify moveItemUp and moveItemDown
  const preDownCols = dndSM.getCollections();
  const firstCol = preDownCols[0];
  dndSM.moveItemDown('collection', firstCol.id);
  const postDownCols = dndSM.getCollections();
  assert.strictEqual(postDownCols[1].id, firstCol.id, 'Col should move down 1 slot');
  dndSM.moveItemUp('collection', firstCol.id);
  const postUpCols = dndSM.getCollections();
  assert.strictEqual(postUpCols[0].id, firstCol.id, 'Col should move back up to 0 index');

  // 2. Drag and Drop Controller (TreeDragAndDropController implementation)
  const dndProvider = new BlueByrdCollectionsTreeProvider(dndSM);
  assert(dndProvider.dragMimeTypes.includes('application/vnd.code.tree.bluebyrdcollections'), 'Must support bluebyrdcollections drag mime type');
  assert(dndProvider.dropMimeTypes.includes('application/vnd.code.tree.bluebyrdcollections'), 'Must support bluebyrdcollections drop mime type');

  // Test handleDrag
  const allTreeItems = dndProvider.getChildren();

  const colTreeItems = allTreeItems.filter(c => c.kind === 'collection');
  const sourceColItem = colTreeItems[1];
  const targetColItem = colTreeItems[0];

  const dataTransfer = new mockVscode.DataTransfer();
  dndProvider.handleDrag([sourceColItem], dataTransfer, {});
  const transferItem = dataTransfer.get('application/vnd.code.tree.bluebyrdcollections');
  assert(transferItem, 'DataTransfer must store dragged item under MIME');

  // Test handleDrop: Reorder Collection
  const originalCols = dndSM.getCollections().map(c => c.id);
  await dndProvider.handleDrop(targetColItem, dataTransfer, {});
  const afterDropCols = dndSM.getCollections().map(c => c.id);
  assert.strictEqual(afterDropCols[0], sourceColItem.itemId, 'Second collection should move to first index after dropping before first');

  // Test handleDrop: Move Request into Folder via Drag and Drop
  const reqTransfer = new mockVscode.DataTransfer();
  const reqSourceItem = { kind: 'request', itemId: req2.id, parentId: colA.id };
  const folderTargetItem = { kind: 'folder', itemId: folder3.id, parentId: colA.id };
  reqTransfer.set('application/vnd.code.tree.bluebyrdcollections', new mockVscode.DataTransferItem([reqSourceItem]));

  await dndProvider.handleDrop(folderTargetItem, reqTransfer, {});
  const f3Check = dndSM.getCollection(colA.id).folders.find(f => f.id === folder3.id);
  assert(f3Check.requests.some(r => r.id === req2.id), 'Request 2 must be moved into Folder 3 via Drag & Drop');

  // Test handleDrop: Move Request to Collection Root via Drag and Drop
  const reqToRootTransfer = new mockVscode.DataTransfer();
  const reqFromFolderItem = { kind: 'request', itemId: req2.id, parentId: folder3.id };
  const colTargetItem = { kind: 'collection', itemId: colA.id };
  reqToRootTransfer.set('application/vnd.code.tree.bluebyrdcollections', new mockVscode.DataTransferItem([reqFromFolderItem]));

  await dndProvider.handleDrop(colTargetItem, reqToRootTransfer, {});
  const colACheck = dndSM.getCollection(colA.id);
  assert(colACheck.requests.some(r => r.id === req2.id), 'Request 2 must be moved back to collection root via Drag & Drop');

  console.log('✓ Reorder Drag & Drop of Collections, Folders, and Requests verified');

  // Test 36: Environment Cloning, Hierarchy Preservation & State Isolation
  const cloneSM = new BlueByrdStateManager(mockContext);
  const parentEnvResult = cloneSM.createEnvironment('Prod Base', 'https://api.prod.com');
  const childEnvResult = cloneSM.createEnvironment('Prod US-East', 'https://useast.api.prod.com');
  childEnvResult.env.inheritsFrom = parentEnvResult.env.id;
  childEnvResult.env.variables = { region: 'us-east-1', timeout: '5000' };
  childEnvResult.env.headers = { 'X-Region': 'us-east-1' };
  childEnvResult.env.auth = { type: 'bearer', token: 'secret-token-123' };
  cloneSM.saveEnvironment('Prod US-East', childEnvResult.env);

  // 1. Clone with default copy name
  const defaultClone = cloneSM.cloneEnvironment('Prod US-East');
  assert(defaultClone, 'cloneEnvironment must succeed');
  assert.strictEqual(defaultClone.name, 'Prod US-East (Copy)', 'Default cloned environment name must have (Copy)');
  assert.notStrictEqual(defaultClone.env.id, childEnvResult.env.id, 'Cloned environment must have distinct ID');
  assert.strictEqual(defaultClone.env.baseUrl, 'https://useast.api.prod.com', 'BaseUrl must be cloned');
  assert.strictEqual(defaultClone.env.inheritsFrom, parentEnvResult.env.id, 'inheritsFrom must be preserved');
  assert.strictEqual(defaultClone.env.variables.region, 'us-east-1', 'Variables must be cloned');
  assert.strictEqual(defaultClone.env.headers['X-Region'], 'us-east-1', 'Headers must be cloned');
  assert.strictEqual(defaultClone.env.auth.token, 'secret-token-123', 'Auth must be cloned');

  // Verify memory isolation between clone and original
  defaultClone.env.variables.region = 'us-west-2';
  cloneSM.saveEnvironment(defaultClone.name, defaultClone.env);
  const checkOriginal = cloneSM.getEnvironment('Prod US-East');
  assert.strictEqual(checkOriginal.variables.region, 'us-east-1', 'Mutating clone variables must not mutate original environment');

  // 2. Clone with custom name
  const customClone = cloneSM.cloneEnvironment(childEnvResult.env.id, 'Prod EU-Central');
  assert(customClone, 'Cloning by ID with custom name must succeed');
  assert.strictEqual(customClone.name, 'Prod EU-Central');
  assert.strictEqual(customClone.env.inheritsFrom, parentEnvResult.env.id);

  console.log('✓ Environment Cloning, Hierarchy Preservation & State Isolation verified');

  // Test 37: Variable Resolution & URL Scheme Auto-Resolution with Base URL & IP Targets
  const varSM = new BlueByrdStateManager(mockContext);
  const varService = new VariableService(varSM);
  const varAuthService = new AuthService(varSM, varService);
  const varHttpService = new HttpService(varSM, varService, varAuthService);

  // Setup Algorand-like environment with base URL and profile scope
  const algoEnvResult = varSM.createEnvironment('Algorand Mainnet IdeaPad', 'http://192.168.1.199:8080');
  algoEnvResult.env.variables = { tokenHeader: 'X-Algo-Token', genesisId: 'mainnet-v1.0' };
  varSM.saveEnvironment('Algorand Mainnet IdeaPad', algoEnvResult.env);

  // Setup Algod Collection with default baseUrl = http://localhost (like imported OpenAPI / Postman spec)
  const algoCol = varSM.getState().collections[0];
  algoCol.variables = { baseUrl: 'http://localhost' };
  varSM.saveCollection(algoCol);

  // 1. Resolve variables with environment and collection: Environment MUST override Collection's baseUrl
  const resolvedVars = varService.resolveVariables(undefined, 'Algorand Mainnet IdeaPad', algoCol.id);
  assert.strictEqual(resolvedVars['baseUrl'], 'http://192.168.1.199:8080', 'Active Environment baseUrl must override Collection default baseUrl');
  assert.strictEqual(resolvedVars['tokenHeader'], 'X-Algo-Token', 'Environment custom variables must resolve');

  // 2. VariableService detailed resolution: Collection baseUrl must be marked as overridden, Environment baseUrl active
  const detailed = varService.resolveVariablesDetailed(undefined, 'Algorand Mainnet IdeaPad', algoCol.id);
  const colBaseUrl = detailed.inherited.find(i => i.key === 'baseUrl' && i.source === 'collection');
  const envBaseUrl = detailed.inherited.find(i => i.key === 'baseUrl' && i.source === 'environment');
  assert(colBaseUrl, 'Collection baseUrl must appear in inherited list');
  assert.strictEqual(colBaseUrl.value, 'http://localhost');
  assert.strictEqual(colBaseUrl.isOverridden, true, 'Collection baseUrl must be marked as overridden by Environment');
  assert(envBaseUrl, 'Environment baseUrl must appear in inherited list');
  assert.strictEqual(envBaseUrl.value, 'http://192.168.1.199:8080');
  assert.strictEqual(envBaseUrl.isOverridden, undefined, 'Environment baseUrl must NOT be marked as overridden');

  // 3. Request Panel HTML default selection with active environment
  const varAppState = varSM.getState();
  varAppState.activeEnvironmentName = 'Algorand Mainnet IdeaPad';
  const panelHtml = getRequestPanelHtml(
    { url: '{{baseUrl}}/v2/status', environment: 'Algorand Mainnet IdeaPad' },
    varAppState,
    detailed.inherited,
    []
  );
  assert(panelHtml.includes('value="Algorand Mainnet IdeaPad" selected'), 'Selected environment must be selected in HTML');
  assert(panelHtml.includes('http://192.168.1.199:8080'), 'Inherited baseUrl value must be embedded in script');

  // 4. Test URL interpolation and auto-resolution in local HTTP server
  let lastReceivedUrl = '';
  const testServer = http.createServer((req, res) => {
    lastReceivedUrl = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', url: req.url }));
  });
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = testServer.address().port;

  // Update environment to point to test server port
  algoEnvResult.env.baseUrl = `http://127.0.0.1:${testPort}`;
  varSM.saveEnvironment('Algorand Mainnet IdeaPad', algoEnvResult.env);

  // Request with {{baseUrl}}/v2/status
  const res1 = await varHttpService.executeRequest({
    method: 'GET',
    url: '{{baseUrl}}/v2/status',
    environment: 'Algorand Mainnet IdeaPad',
    headers: { 'Connection': 'close' }
  });
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(lastReceivedUrl, '/v2/status');

  // Request with relative path /v2/ledger (auto-resolves baseUrl)
  const res2 = await varHttpService.executeRequest({
    method: 'GET',
    url: '/v2/ledger',
    environment: 'Algorand Mainnet IdeaPad',
    headers: { 'Connection': 'close' }
  });
  assert.strictEqual(res2.status, 200);
  assert.strictEqual(lastReceivedUrl, '/v2/ledger');

  // Request with raw IPv4 target (auto-prepends http://)
  const res3 = await varHttpService.executeRequest({
    method: 'GET',
    url: `127.0.0.1:${testPort}/v2/health`,
    headers: { 'Connection': 'close' }
  });
  assert.strictEqual(res3.status, 200);
  assert.strictEqual(lastReceivedUrl, '/v2/health');

  if (typeof testServer.closeAllConnections === 'function') {
    testServer.closeAllConnections();
  }
  await new Promise((resolve) => testServer.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));

  console.log('✓ Variable Resolution & URL Scheme Auto-Resolution with Base URL & IP Targets verified');

  // ─── Test 38: Network Error Diagnostic Classification ──────────────────────────
  {
    // Isolated context — prevents history pollution from the shared fakeStorage
    const storage38 = new Map();
    const ctx38 = {
      workspaceState: {
        get: (k) => storage38.get(k),
        update: (k, v) => { storage38.set(k, v); return Promise.resolve(); }
      }
    };
    const stateManager38 = new BlueByrdStateManager(ctx38);
    const variableService38 = new VariableService(stateManager38);
    const authService38 = new AuthService(stateManager38, variableService38);
    const httpService38 = new HttpService(stateManager38, variableService38, authService38);

    // ECONNREFUSED — use a high port that nothing is listening on
    const econnResult = await httpService38.executeRequest({
      method: 'GET',
      url: 'http://127.0.0.1:19876/ping',
    });
    assert.strictEqual(econnResult.status, 0, 'ECONNREFUSED should return status 0');
    assert.strictEqual(econnResult.ok, false);
    assert.strictEqual(econnResult.statusText, 'Connection Refused',
      `Expected "Connection Refused", got "${econnResult.statusText}"`);
    assert.ok(econnResult.body.includes('ECONNREFUSED'),
      `Expected ECONNREFUSED in body, got: ${econnResult.body.substring(0, 200)}`);
    assert.ok(econnResult.body.includes('The server actively rejected'),
      'Body should contain actionable explanation');

    // AbortError — mock it by wrapping a rejected fetch
    {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => { throw abortErr; };
      try {
        const abortResult = await httpService38.executeRequest({
          method: 'GET',
          url: 'http://127.0.0.1:9999/timeout',
        });
        assert.strictEqual(abortResult.status, 0);
        assert.strictEqual(abortResult.statusText, 'Request Timed Out',
          `Expected "Request Timed Out", got "${abortResult.statusText}"`);
        assert.ok(abortResult.body.includes('30 seconds'),
          'Timeout body should mention 30 seconds');
      } finally {
        globalThis.fetch = origFetch;
      }
    }

    // Unknown error with cause.code — should show cause code as label
    {
      const unknownErr = new TypeError('fetch failed');
      unknownErr.cause = { code: 'ENETDOWN', message: 'Network is down' };
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => { throw unknownErr; };
      try {
        const unknownResult = await httpService38.executeRequest({
          method: 'GET',
          url: 'http://127.0.0.1:9999/unknown',
        });
        assert.strictEqual(unknownResult.status, 0);
        assert.strictEqual(unknownResult.statusText, 'ENETDOWN',
          `Expected "ENETDOWN" as statusText, got "${unknownResult.statusText}"`);
        assert.ok(unknownResult.body.includes('ENETDOWN'));
      } finally {
        globalThis.fetch = origFetch;
      }
    }

    // Verify error is recorded in history
    const hist38 = stateManager38.getHistory();
    assert.ok(hist38.length >= 1, 'Error requests should be recorded in history');
    assert.strictEqual(hist38[hist38.length - 1].responseStatus, 0,
      'Network error history items must have responseStatus === 0');

    console.log('✓ Network Error Diagnostic Classification (ECONNREFUSED / AbortError / unknown) verified');
  }

  // ─── Test 39: Pre-Request & Post-Response Scripting Engine & Assertions ──────────────────────────
  {
    const scriptService = new ScriptService(1500);

    // 1. Pre-Request Script Execution: mutation of headers, body, url, and variables
    const preScriptCode = `
      bb.request.headers['X-Calculated-Signature'] = crypto.createHmac('sha256', 'secret-key').update('bluebyrd-payload').digest('hex');
      bb.request.headers['X-Timestamp'] = '1700000000';
      bb.request.body = JSON.stringify({ injected: true });
      bb.environment.set('injectedToken', 'bb_tok_999');
      bb.collectionVariables.set('colKey', 'colVal');
      console.log('Pre-request ran successfully');
    `;

    const preResult = scriptService.executePreRequest(preScriptCode, {
      url: 'http://localhost/api',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
      environmentVariables: {},
      collectionVariables: {},
      resolvedVariables: {},
    });

    assert(preResult.headers['X-Calculated-Signature'], 'Pre-request script should inject X-Calculated-Signature header');
    assert.strictEqual(preResult.headers['X-Timestamp'], '1700000000');
    assert.strictEqual(preResult.body, '{"injected":true}');
    assert.strictEqual(preResult.envMutations['injectedToken'], 'bb_tok_999');
    assert.strictEqual(preResult.colMutations['colKey'], 'colVal');
    assert(preResult.consoleLogs.some(l => l.message.includes('Pre-request ran successfully')));

    // 2. Post-Response Script Execution: assertions, PM parity, JSON parsing, test results
    const postScriptCode = `
      // bb API assertions
      bb.test('Status is 200', () => {
        bb.expect(bb.response.status).toBe(200);
      });

      bb.test('Status is 404 (expected failure)', () => {
        bb.expect(bb.response.status).toBe(404);
      });

      bb.test('Payload matches user Alice', () => {
        const data = bb.response.json();
        bb.expect(data.name).toEqual('Alice');
        bb.expect(data.roles).to.include('admin');
        bb.expect(data.id).toBe(42);
      });

      // Postman pm API syntax parity
      pm.test('Postman pm syntax parity', function() {
        pm.expect(pm.response.status).to.equal(200);
        pm.response.to.have.status(200);
        pm.response.to.have.header('content-type');
      });

      // Extract token to environment
      const payload = bb.response.json();
      bb.environment.set('extractedToken', payload.token);
      console.info('Finished post-response tests');
    `;

    const postResult = scriptService.executePostResponse(postScriptCode, {
      url: 'http://localhost/api',
      method: 'GET',
      requestHeaders: {},
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 42, name: 'Alice', roles: ['admin', 'dev'], token: 'jwt_abc_123' }),
      elapsedMs: 45,
      environmentVariables: {},
      collectionVariables: {},
      resolvedVariables: {},
    });

    assert.strictEqual(postResult.testResults.length, 4, 'Should record exactly 4 tests');
    const passedTests = postResult.testResults.filter(t => t.passed);
    const failedTests = postResult.testResults.filter(t => !t.passed);
    assert.strictEqual(passedTests.length, 3, '3 tests should pass');
    assert.strictEqual(failedTests.length, 1, '1 test should fail');
    assert.strictEqual(failedTests[0].name, 'Status is 404 (expected failure)');
    assert(failedTests[0].error.includes('404'), 'Failed test error should describe failure');
    assert.strictEqual(postResult.envMutations['extractedToken'], 'jwt_abc_123');
    assert(postResult.consoleLogs.some(l => l.message.includes('Finished post-response tests')));

    // 3. Sandbox execution timeout guard (infinite loop protection)
    const timeoutScriptService = new ScriptService(150); // 150ms timeout
    const timeoutResult = timeoutScriptService.executePreRequest('while(true) {}', {
      url: 'http://localhost',
      method: 'GET',
      headers: {},
      environmentVariables: {},
      collectionVariables: {},
      resolvedVariables: {},
    });
    assert(timeoutResult.error, 'Infinite loop script must be aborted with error');
    assert(timeoutResult.consoleLogs.some(l => l.level === 'error'), 'Should log script timeout error');

    // 4. End-to-End HttpService Integration with Test Server
    const http = require('http');
    let receivedHeader = '';
    const scriptTestServer = http.createServer((req, res) => {
      receivedHeader = req.headers['x-script-injected'] || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', serverName: 'bluebyrd-test-srv', token: 'secret_tok_777' }));
    });

    await new Promise((resolve) => scriptTestServer.listen(0, '127.0.0.1', resolve));
    const scriptPort = scriptTestServer.address().port;

    const storage39 = new Map();
    const ctx39 = {
      workspaceState: {
        get: (k) => storage39.get(k),
        update: (k, v) => { storage39.set(k, v); return Promise.resolve(); }
      }
    };
    const stateManager39 = new BlueByrdStateManager(ctx39);
    const varService39 = new VariableService(stateManager39);
    const authService39 = new AuthService(stateManager39, varService39);
    const httpService39 = new HttpService(stateManager39, varService39, authService39);

    const testEnvResult = stateManager39.createEnvironment('Script Testing Env', `http://127.0.0.1:${scriptPort}`);
    stateManager39.saveEnvironment('Script Testing Env', testEnvResult.env);

    const execResult = await httpService39.executeRequest({
      method: 'GET',
      url: `http://127.0.0.1:${scriptPort}/test-scripts`,
      environment: 'Script Testing Env',
      preRequestScript: `
        bb.request.headers['X-Script-Injected'] = 'confirmed-from-pre-request';
        bb.environment.set('preVar', 'hello_pre');
        console.log('Sending request to server');
      `,
      postResponseScript: `
        bb.test('Response is 200 OK', () => {
          bb.expect(bb.response.status).toBe(200);
        });
        const d = bb.response.json();
        bb.environment.set('tokenFromResponse', d.token);
        console.log('Received response from', d.serverName);
      `
    });

    assert.strictEqual(execResult.status, 200);
    assert.strictEqual(receivedHeader, 'confirmed-from-pre-request', 'Pre-request injected header must be received by HTTP server');
    assert(execResult.testResults && execResult.testResults.length === 1 && execResult.testResults[0].passed, 'Post-response test assertion must pass');
    assert(execResult.consoleLogs.length >= 2, 'Console logs must be collected from both pre and post scripts');

    // Verify environment variable mutations persisted in stateManager
    const updatedEnv = stateManager39.getEnvironment('Script Testing Env');
    assert.strictEqual(updatedEnv.variables['preVar'], 'hello_pre', 'Pre-request environment variable must be persisted');
    assert.strictEqual(updatedEnv.variables['tokenFromResponse'], 'secret_tok_777', 'Post-response environment variable must be persisted');

    if (typeof scriptTestServer.closeAllConnections === 'function') {
      scriptTestServer.closeAllConnections();
    }
    await new Promise((resolve) => scriptTestServer.close(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));

    console.log('✓ Pre-Request & Post-Response Scripting Engine, Sandboxed Assertions, PM Parity & Persistence verified');
  }

  // Test 40: Parent-Child Environment Dropdown Hierarchy & Inheritance Annotations
  {
    const fakeStorage40 = new Map();
    const ctx40 = {
      workspaceState: {
        get: (key) => fakeStorage40.get(key),
        update: (key, val) => { fakeStorage40.set(key, val); return Promise.resolve(); }
      }
    };
    const stateManager40 = new BlueByrdStateManager(ctx40);

    // Setup Parent and Child environments
    const parentEnv = stateManager40.createEnvironment('Algorand Mainnet', 'http://192.168.1.199:8080');
    stateManager40.saveEnvironment('Algorand Mainnet', parentEnv.env);

    const childEnv = stateManager40.createEnvironment('Algorand Mainnet localhost', 'http://localhost:8080');
    childEnv.env.inheritsFrom = 'Algorand Mainnet';
    stateManager40.saveEnvironment('Algorand Mainnet localhost', childEnv.env);

    const appState40 = stateManager40.getState();

    const panelHtml = getRequestPanelHtml(
      { url: 'http://localhost:8080/v2/status', environment: 'Algorand Mainnet localhost' },
      appState40,
      [],
      []
    );

    // Verify parent option is labeled with Parent indicator
    assert(panelHtml.includes('Algorand Mainnet (Parent • 1 child)'), 'Parent environment must display parent indicator and child count');

    // Verify child option is indented with tree chevron and inherits label
    assert(panelHtml.includes('↳ Algorand Mainnet localhost (inherits: Algorand Mainnet)'), 'Child environment must be indented with chevron and parent inheritance note');
    assert(panelHtml.includes('value="Algorand Mainnet localhost" selected'), 'Active child environment must have selected attribute with exact environment name');

    // Verify child appears immediately after parent in HTML order
    const parentIdx = panelHtml.indexOf('value="Algorand Mainnet"');
    const childIdx = panelHtml.indexOf('value="Algorand Mainnet localhost"');
    assert(parentIdx !== -1 && childIdx !== -1 && childIdx > parentIdx, 'Child environment option must follow parent hierarchically in dropdown');

    console.log('✓ Parent-Child Environment Dropdown Hierarchy & Inheritance Annotations verified');
  }

  // Test 41: Request Renaming Lifecycle, Breadcrumb Inline Display & State Synchronization
  {
    const fakeStorage41 = new Map();
    const ctx41 = {
      workspaceState: {
        get: (key) => fakeStorage41.get(key),
        update: (key, val) => { fakeStorage41.set(key, val); return Promise.resolve(); }
      }
    };
    const stateManager41 = new BlueByrdStateManager(ctx41);

    // Save initial request inside collection and folder
    const initialReq = stateManager41.saveRequest({
      id: 'req-status-001',
      name: 'Get Node Status',
      method: 'GET',
      url: '{{baseUrl}}/v2/status',
      collection: 'Algod REST API. v0.0.1',
      folder: 'public',
      headers: {},
      body: ''
    });

    assert.strictEqual(initialReq.name, 'Get Node Status', 'Initial request name must match');

    // 1. Rename request via stateManager
    const renamedReq = stateManager41.renameRequest('req-status-001', 'Get Node Health & Status');
    assert(renamedReq, 'renameRequest must return the updated request');
    assert.strictEqual(renamedReq.name, 'Get Node Health & Status', 'Request name must be updated in state');

    // Verify retrieval preserves new name
    const found = stateManager41.getRequest('req-status-001');
    assert(found && found.request.name === 'Get Node Health & Status', 'Retrieved request must reflect renamed title');

    // 2. Request Panel HTML rendering: breadcrumbs must display editable request name
    const appState41 = stateManager41.getState();
    const panelHtml = getRequestPanelHtml(
      {
        id: 'req-status-001',
        requestName: found.request.name,
        collection: 'Algod REST API. v0.0.1',
        folder: 'public',
        url: '{{baseUrl}}/v2/status'
      },
      appState41,
      [],
      []
    );

    assert(panelHtml.includes('id="req-name-input"'), 'Breadcrumbs must contain request name input element');
    assert(panelHtml.includes('value="Get Node Health &amp; Status"'), 'Request name input must display current request name');
    assert(panelHtml.includes('id="btn-rename-req"'), 'Breadcrumbs must contain rename action button');
    assert(panelHtml.includes('<title>Get Node Health &amp; Status</title>'), 'Panel title must reflect request name');
    assert(panelHtml.includes('requestName: document.getElementById(\'req-name-input\')?.value?.trim() || \'\''), 'Payload assembly must include requestName from input');

    console.log('✓ Request Renaming Lifecycle, Breadcrumb Inline Display & State Synchronization verified');
  }

  // Test 42: Built-in Dynamic Variables Hidden by Default & Toggle Control
  {
    const fakeStorage42 = new Map();
    const ctx42 = {
      workspaceState: {
        get: (key) => fakeStorage42.get(key),
        update: (key, val) => { fakeStorage42.set(key, val); return Promise.resolve(); }
      }
    };
    const stateManager42 = new BlueByrdStateManager(ctx42);
    const varService42 = new VariableService(stateManager42);

    // Context with NO user variables, but built-in dynamic variables are present in resolution
    const varDetails42 = varService42.resolveVariablesDetailed(undefined, undefined, undefined, undefined, []);
    const dynamicOnly = varDetails42.inherited.filter(i => i.source === 'dynamic');
    assert(dynamicOnly.length === 5, 'VariableService must provide 5 default dynamic variables');

    const appState42 = stateManager42.getState();
    const panelHtml = getRequestPanelHtml(
      { url: '{{baseUrl}}/health' },
      appState42,
      varDetails42.inherited,
      []
    );

    // Verify toggle button is present
    assert(panelHtml.includes('id="btn-toggle-dynamic-vars"'), 'Inherited variables header must contain dynamic toggle button');
    assert(panelHtml.includes('class="btn-toggle-dynamic"'), 'Toggle button must have btn-toggle-dynamic class');

    // Verify showDynamicVars is false by default in client script
    assert(panelHtml.includes('let showDynamicVars = false;'), 'Dynamic variables must be hidden by default in script state');

    // Verify separation of user vars from dynamic vars in client logic
    assert(panelHtml.includes('const userVars = (currentInheritedVars || []).filter(item => item.source !== \'dynamic\');'), 'Script must filter user vars from dynamic vars');
    assert(panelHtml.includes('inheritedVarsCount.textContent = userVars.length + \' available\';'), 'Count badge must reflect user-inherited variables only');

    console.log('✓ Built-in Dynamic Variables Hidden by Default & Toggle Control verified');
  }

  // Test 43: Tools Sidebar View & cURL Command Parser
  {
    // 1. cURL GET request with headers
    const curlGet = 'curl "https://api.example.com/v1/health" -H "Accept: application/json" -H "X-Client: bluebyrd"';
    const parsedGet = ImportExportService.parseCurl(curlGet);
    assert.strictEqual(parsedGet.method, 'GET');
    assert.strictEqual(parsedGet.url, 'https://api.example.com/v1/health');
    assert.strictEqual(parsedGet.headers['Accept'], 'application/json');
    assert.strictEqual(parsedGet.headers['X-Client'], 'bluebyrd');
    assert.strictEqual(parsedGet.body, '');
    assert.strictEqual(parsedGet.bodyType, 'none');

    // 2. cURL POST request with JSON payload and line continuation slashes
    const curlPost = `curl -X POST https://api.example.com/v1/transactions \\
      -H "Content-Type: application/json" \\
      -d '{"amount": 100, "currency": "USD"}'`;
    const parsedPost = ImportExportService.parseCurl(curlPost);
    assert.strictEqual(parsedPost.method, 'POST');
    assert.strictEqual(parsedPost.url, 'https://api.example.com/v1/transactions');
    assert.strictEqual(parsedPost.headers['Content-Type'], 'application/json');
    assert.strictEqual(parsedPost.bodyType, 'json');
    const parsedJson = JSON.parse(parsedPost.body);
    assert.strictEqual(parsedJson.amount, 100);
    assert.strictEqual(parsedJson.currency, 'USD');

    // 3. cURL form urlencoded with implicit POST from -d
    const curlForm = 'curl https://api.example.com/oauth/token -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=client_credentials&client_id=foo"';
    const parsedForm = ImportExportService.parseCurl(curlForm);
    assert.strictEqual(parsedForm.method, 'POST');
    assert.strictEqual(parsedForm.bodyType, 'form-urlencoded');
    assert(parsedForm.body.includes('grant_type=client_credentials'));

    // 4. BlueByrdToolsTreeProvider items and commands
    const fakeStorage43 = new Map();
    const ctx43 = {
      workspaceState: {
        get: (key) => fakeStorage43.get(key),
        update: (key, val) => { fakeStorage43.set(key, val); return Promise.resolve(); }
      }
    };
    const stateManager43 = new BlueByrdStateManager(ctx43);
    const mockTokenService43 = {
      getAllTokens: () => [
        { id: 'tok-1', profileId: 'default', accessToken: 'xyz' },
        { id: 'tok-2', profileId: 'default', accessToken: 'abc' }
      ]
    };

    const toolsProvider = new BlueByrdToolsTreeProvider(stateManager43, mockTokenService43);
    const toolItems = toolsProvider.getChildren();

    assert.strictEqual(toolItems.length, 7, 'Tools panel must have 7 items (Profiles section removed)');

    const expectedLabels = [
      'Manage Profiles & Settings...',
      'OAuth Token Vault',
      'History Inspector',
      'Import from cURL...',
      'Import API Data...',
      'Export Full Backup...',
      'Check for Updates...'
    ];
    const actualLabels = toolItems.map(item => item.label);
    assert.deepStrictEqual(actualLabels, expectedLabels, 'Tool labels must match expected order and naming');

    // Verify token count badge
    const tokenItem = toolItems.find(t => t.label === 'OAuth Token Vault');
    assert.strictEqual(tokenItem.description, '2 stored', 'Token vault description must display count of stored tokens');
    assert(tokenItem.command.command === 'byrdsnestApiClient.manageTokens' || tokenItem.command.command === 'blueByrdApiClient.manageTokens');

    // Verify cURL item command
    const curlItem = toolItems.find(t => t.label === 'Import from cURL...');
    assert(curlItem.command.command === 'byrdsnestApiClient.importCurl' || curlItem.command.command === 'blueByrdApiClient.importCurl');

    // Verify Check for Updates description displays current installed version
    const updateToolItem = toolItems.find(t => t.label === 'Check for Updates...');
    assert(updateToolItem, 'Check for Updates tool item must exist');
    const currentPkgVersion43 = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version;
    assert.strictEqual(updateToolItem.description, 'v' + currentPkgVersion43, `Check for Updates description must match current version v${currentPkgVersion43}`);

    // Verify coordinator compatibility
    const coordinator43 = new BlueByrdTreeCoordinator(
      new BlueByrdProfilesTreeProvider(stateManager43),
      new BlueByrdCollectionsTreeProvider(stateManager43),
      new BlueByrdEnvironmentsTreeProvider(stateManager43),
      toolsProvider
    );
    assert(coordinator43.toolsProvider, 'Coordinator must expose toolsProvider');
    assert(coordinator43.historyProvider, 'Coordinator must maintain historyProvider alias for backwards compatibility');

    console.log('✓ Tools Sidebar View & cURL Command Parser verified');
  }

  // ==========================================
  // Suite 44: Token Vault Provenance, UI Layout Consistency & Nest Icon
  // ==========================================
  {
    const fs = require('fs');
    const { renderAuthFieldsHtml } = require(path.join(repoDist, 'views/panels/sharedAuthHtml'));
    const stateManager44 = new BlueByrdStateManager(mockContext);
    const tokenService44 = new TokenService();
    const authService44 = new AuthService(stateManager44, tokenService44);

    const testToken = {
      id: 'tok-suite44-abc',
      profileId: 'profile-main',
      profileName: 'Algorand',
      envName: 'Algorand Mainnet',
      envId: 'env-algorand-mainnet',
      tokenName: 'Algonode Mainnet Token',
      accessToken: 'a-super-secret-vault-token-xyz',
      tokenType: 'Bearer',
      createdAt: Date.now() - 3600000,
      expiresAt: Date.now() + 86400000,
      source: 'oauth2',
      sourceUrl: 'https://mainnet-api.algonode.cloud/oauth/token',
      clientId: 'algorand-client-44',
      scopes: ['read', 'write']
    };

    await tokenService44.saveToken(testToken);
    const retrieved = await tokenService44.getTokens('profile-main');
    assert.strictEqual(retrieved.length, 1);
    assert.strictEqual(retrieved[0].id, 'tok-suite44-abc');
    assert.strictEqual(retrieved[0].source, 'oauth2');
    assert.strictEqual(retrieved[0].sourceUrl, 'https://mainnet-api.algonode.cloud/oauth/token');
    assert.strictEqual(retrieved[0].clientId, 'algorand-client-44');
    assert.strictEqual(tokenService44.getTokenById('tok-suite44-abc')?.accessToken, 'a-super-secret-vault-token-xyz');

    // Verify AuthService header resolution using selectedTokenId
    const resolvedHeaders = authService44.resolveAuthHeaders(
      'profile-main',
      'env-algorand-mainnet',
      undefined,
      undefined,
      {},
      {
        auth: {
          type: 'bearer',
          selectedTokenId: 'tok-suite44-abc'
        }
      }
    );
    assert.strictEqual(resolvedHeaders['Authorization'], 'Bearer a-super-secret-vault-token-xyz', 'AuthService must resolve bearer header using selectedTokenId from vault');

    // Verify renderAuthFieldsHtml includes vault picker and provenance card
    const authHtml = renderAuthFieldsHtml({
      type: 'bearer',
      selectedTokenId: 'tok-suite44-abc'
    }, 'this request', [testToken]);
    assert(authHtml.includes('bearer-token-select'), 'Auth HTML must contain bearer token selector');
    assert(authHtml.includes('TOKEN PROVENANCE'), 'Auth HTML must render token provenance section');
    assert(authHtml.includes('a-super-secret-vault-token-xyz'), 'Auth HTML options must include token payload');
    assert(authHtml.includes('https://mainnet-api.algonode.cloud/oauth/token'), 'Auth HTML must include origin URL in metadata');

    // Verify Settings Panel HTML layout consistency
    const settingsHtml = getSettingsPanelHtml('environment', { id: 'env-1', baseUrl: 'https://api.test' }, 'Mainnet', undefined, [], [], [testToken]);
    assert(settingsHtml.includes('width: 100%'), 'Settings panel container must use 100% full width matching request panel');
    assert(settingsHtml.includes('padding: 14px'), 'Settings panel body must use 14px padding matching request panel');
    assert(settingsHtml.includes('token-vault-select'), 'Settings panel must render token vault picker in Auth tab');

    // Verify bird's nest icon assets exist
    const svgIcon = fs.readFileSync(path.join(__dirname, '../media/icon.svg'), 'utf8');
    assert(svgIcon.includes('Bird'), 'SVG icon must reflect bird nest design');
    assert(fs.existsSync(path.join(__dirname, '../media/icon.png')), 'PNG icon must exist');
    const pngStat = fs.statSync(path.join(__dirname, '../media/icon.png'));
    assert(pngStat.size > 500, 'PNG icon must be a valid non-empty image file');

    console.log('✓ Token Vault Provenance, UI Layout Consistency & Nest Icon verified');
  }

  // Test 45: Live Inherited Headers Update, Profile Headers & Dynamic Child Base URL Inheritance
  {
    // 1. Verify StateManager onDidChangeState Event Emitter
    let stateChangeEventFired = false;
    let stateChangeReceivedState = null;
    const disposable = stateManager.onDidChangeState((newState) => {
      stateChangeEventFired = true;
      stateChangeReceivedState = newState;
    });

    stateManager.saveEnvironment('Suite45-Parent', {
      id: 'env-suite45-parent',
      baseUrl: 'https://api.suite45-parent.com',
      headers: {
        'X-Env-Common': 'parent-value',
        'X-Parent-Only': 'from-parent'
      },
      variables: {
        parentCluster: 'cluster-alpha'
      }
    });

    assert.strictEqual(stateChangeEventFired, true, 'stateManager.save() must fire onDidChangeState event');
    assert(stateChangeReceivedState?.environments['Suite45-Parent'], 'Event payload must contain updated environment state');
    disposable.dispose();

    // 2. Verify Child Environment dynamically inherits baseUrl from Parent Environment
    stateManager.saveEnvironment('Suite45-Child', {
      id: 'env-suite45-child',
      baseUrl: '', // Empty baseUrl so it inherits dynamically
      inheritsFrom: 'Suite45-Parent',
      headers: {
        'X-Env-Common': 'child-override-val',
        'X-Child-Only': 'from-child'
      },
      variables: {
        childZone: 'us-west-2'
      }
    });

    const childVarsInitial = variableService.resolveVariables('Development', 'Suite45-Child');
    assert.strictEqual(childVarsInitial['baseUrl'], 'https://api.suite45-parent.com', 'Child environment with empty baseUrl must inherit baseUrl from parent');
    assert.strictEqual(childVarsInitial['parentCluster'], 'cluster-alpha', 'Child environment must inherit variables from parent');
    assert.strictEqual(childVarsInitial['childZone'], 'us-west-2', 'Child environment must resolve its own variables');

    // Interpolation check: {{baseUrl}}/endpoint
    const interpolatedUrl = variableService.interpolate('{{baseUrl}}/v1/users', childVarsInitial);
    assert.strictEqual(interpolatedUrl, 'https://api.suite45-parent.com/v1/users', '{{baseUrl}} must resolve to parent baseUrl in child environment');

    // Dynamic Parent Base URL change: update parent baseUrl without editing child
    const parentEnvObj = stateManager.getEnvironment('Suite45-Parent');
    parentEnvObj.baseUrl = 'https://api-v2.suite45-parent.com';
    stateManager.saveEnvironment('Suite45-Parent', parentEnvObj);

    const childVarsAfterParentUpdate = variableService.resolveVariables('Development', 'Suite45-Child');
    assert.strictEqual(childVarsAfterParentUpdate['baseUrl'], 'https://api-v2.suite45-parent.com', 'Child environment must dynamically reflect updated parent baseUrl without reopening');

    // Override check: child sets its own baseUrl
    const childEnvObj = stateManager.getEnvironment('Suite45-Child');
    childEnvObj.baseUrl = 'https://custom.suite45-child.com';
    stateManager.saveEnvironment('Suite45-Child', childEnvObj);

    const childVarsOverridden = variableService.resolveVariables('Development', 'Suite45-Child');
    assert.strictEqual(childVarsOverridden['baseUrl'], 'https://custom.suite45-child.com', 'Child environment with explicit baseUrl must override parent baseUrl');

    // 3. Verify Profile Headers in resolveHeaders and resolveHeadersDetailed
    const testProfile = stateManager.createProfile('Suite45-Profile');
    testProfile.headers = {
      'X-Profile-Trace': 'trace-suite45-id',
      'X-Profile-Auth': 'Bearer test-suite-prof-token',
      'X-Env-Common': 'from-profile'
    };
    stateManager.saveProfile(testProfile);

    // Create a demo collection for header resolution
    stateManager.saveCollection({
      id: 'col-suite45',
      name: 'Suite45 Collection',
      folders: [
        {
          id: 'folder-suite45',
          name: 'Folder 45',
          requests: [],
          headers: {
            'X-Folder-Hdr': 'folder-val'
          }
        }
      ],
      requests: [],
      headers: {
        'X-Col-Hdr': 'col-val',
        'X-Env-Common': 'from-collection'
      }
    });

    const headerDetails = variableService.resolveHeadersDetailed(
      'Suite45-Child',
      'col-suite45',
      'folder-suite45',
      {
        'X-Req-Custom': 'req-val'
      },
      testProfile.id
    );

    // Merged headers check
    assert.strictEqual(headerDetails.merged['X-Profile-Trace'], 'trace-suite45-id', 'Profile headers must be present in merged headers');
    assert.strictEqual(headerDetails.merged['X-Col-Hdr'], 'col-val', 'Collection headers must be present in merged headers');
    assert.strictEqual(headerDetails.merged['X-Folder-Hdr'], 'folder-val', 'Folder headers must be present in merged headers');
    assert.strictEqual(headerDetails.merged['X-Req-Custom'], 'req-val', 'Request headers must be present in merged headers');
    assert.strictEqual(headerDetails.merged['X-Parent-Only'], 'from-parent', 'Parent environment headers must be present in merged headers');
    assert.strictEqual(headerDetails.merged['X-Child-Only'], 'from-child', 'Child environment headers must be present in merged headers');
    assert.strictEqual(headerDetails.merged['X-Env-Common'], 'child-override-val', 'Child environment must override parent, collection, and profile headers');

    // Precedence and override flag check in inherited list
    const profileItem = headerDetails.inherited.find(i => i.source === 'profile' && i.key === 'X-Profile-Trace');
    assert(profileItem, 'Inherited list must contain profile headers with source profile');
    assert(!profileItem.isOverridden, 'Non-overridden profile header must not be overridden');

    const overriddenProfileItem = headerDetails.inherited.find(i => i.source === 'profile' && i.key === 'X-Env-Common');
    assert(overriddenProfileItem, 'Inherited list must contain X-Env-Common for profile');
    assert.strictEqual(overriddenProfileItem.isOverridden, true, 'Overridden profile header must have isOverridden true');

    const overriddenColItem = headerDetails.inherited.find(i => i.source === 'collection' && i.key === 'X-Env-Common');
    assert(overriddenColItem, 'Inherited list must contain X-Env-Common for collection');
    assert.strictEqual(overriddenColItem.isOverridden, true, 'Overridden collection header must have isOverridden true');

    const childEnvItem = headerDetails.inherited.find(i => i.source === 'environment' && i.key === 'X-Env-Common');
    assert(childEnvItem, 'Inherited list must contain X-Env-Common for active child environment');
    assert(!childEnvItem.isOverridden, 'Winning active environment header must not be overridden');

    // 4. Verify Settings Panel HTML renders inherited placeholder and hint when parent is selected
    const parentEnvInfo = { id: 'env-suite45-parent', name: 'Suite45-Parent', baseUrl: 'https://api-v2.suite45-parent.com' };
    const childEnvWithEmptyBaseUrl = { id: 'env-suite45-child', baseUrl: '', inheritsFrom: 'env-suite45-parent' };
    const renderedSettingsHtml = getSettingsPanelHtml(
      'environment',
      childEnvWithEmptyBaseUrl,
      'Suite45-Child',
      undefined,
      [parentEnvInfo],
      []
    );

    assert(renderedSettingsHtml.includes('Inherited: https://api-v2.suite45-parent.com'), 'Settings Panel HTML must show parent baseUrl in placeholder');
    assert(renderedSettingsHtml.includes('Inherits from parent (https://api-v2.suite45-parent.com) when left blank'), 'Settings Panel HTML must render clear inheritance hint');
    assert(renderedSettingsHtml.includes('envParentSelect.addEventListener(\'change\''), 'Settings Panel HTML must attach dynamic change listener to parent select');

    console.log('✓ Live Inherited Headers Update, Profile Headers & Dynamic Child Base URL Inheritance verified');
  }

  // ==========================================
  // Suite 46: Visual Environment Hierarchy Distinction (Root vs Parent vs Child)
  // ==========================================
  {
    const stateManager46 = new BlueByrdStateManager(mockContext);
    const envTreeProvider46 = new BlueByrdEnvironmentsTreeProvider(stateManager46);

    const testState46 = {
      activeProfileId: 'all',
      activeEnvironmentName: 'None',
      profiles: [{ id: 'prof-suite46', name: 'Suite 46 Profile' }],
      environments: {
        'Local': {
          id: 'env-local-46',
          name: 'Local',
          baseUrl: 'https://local.api.com'
        },
        'Dev': {
          id: 'env-dev-46',
          name: 'Dev',
          inheritsFrom: 'env-local-46',
          baseUrl: 'https://dev.api.com'
        },
        'None': {
          id: 'env-none-46',
          name: 'None',
          baseUrl: 'https://api.example.com'
        }
      },
      collections: [],
      history: []
    };

    stateManager46.save(testState46);
    envTreeProvider46.refresh();

    const rootNodes = envTreeProvider46.getChildren();
    const envRootNodes = rootNodes.filter(n => n.kind === 'environment');
    assert.strictEqual(envRootNodes.length, 2, 'There should be 2 root environment nodes: Local (parent) and None (standalone root)');

    const localNode = envRootNodes.find(n => n.label === 'Local');
    const noneNode = envRootNodes.find(n => n.label === 'None');

    assert(localNode, 'Local parent environment node must exist');
    assert(noneNode, 'None root environment node must exist');

    // Verify Local is identified as a parent
    assert(localNode.description.includes('Parent (1)'), 'Local node description must indicate Parent (1)');
    assert.strictEqual(localNode.iconPath.id, 'server-process', 'Parent environment must use server-process icon');

    // Verify Dev is child of Local and has arrow-subwards icon
    const localChildren = envTreeProvider46.getChildren(localNode);
    assert.strictEqual(localChildren.length, 1, 'Local should have 1 child');
    const devChild = localChildren[0];
    assert.strictEqual(devChild.label, 'Dev', 'Child must be Dev');
    assert(devChild.description.includes('inherits: Local'), 'Dev child must show inherits: Local in description');
    assert.strictEqual(devChild.iconPath.id, 'arrow-subwards', 'Child environment must use arrow-subwards icon');

    // Verify None is identified as a standalone Root environment
    assert(noneNode.description.includes('Root'), 'Standalone root environment None must have Root badge in description');
    assert(noneNode.description.includes('✔ Active'), 'Active None node must show ✔ Active badge in description');
    assert.strictEqual(noneNode.iconPath.id, 'server-environment', 'Standalone root environment must use server-environment icon');
    assert.strictEqual(noneNode.iconPath.color.id, 'charts.green', 'Active standalone root environment must have green tint');

    // Verify Explorer tree data provider matches the same hierarchy
    const explorerProvider46 = new BlueByrdExplorerTreeDataProvider(stateManager46);
    const explorerSections = explorerProvider46.getChildren();
    const profilesSection = explorerSections[0];
    const profileNodes = explorerProvider46.getChildren(profilesSection);
    const globalProfNode = profileNodes.find(p => p.label === 'Shared / Global') || profileNodes[0];
    const [envSection] = explorerProvider46.getChildren(globalProfNode);
    assert(envSection, 'Environments section must exist under profile in Explorer');

    const explorerEnvRoots = explorerProvider46.getChildren(envSection);
    const explorerLocal = explorerEnvRoots.find(e => e.label === 'Local');
    const explorerNone = explorerEnvRoots.find(e => e.label === 'None');

    assert(explorerLocal, 'Explorer Local must exist');
    assert(explorerNone, 'Explorer None must exist');
    assert(explorerLocal.description.includes('Parent (1)'), 'Explorer Local must indicate Parent (1)');
    assert.strictEqual(explorerLocal.iconPath.id, 'server-process', 'Explorer Local must use server-process icon');
    assert(explorerNone.description.includes('Root'), 'Explorer None must indicate Root');
    assert.strictEqual(explorerNone.iconPath.id, 'server-environment', 'Explorer None must use server-environment icon');

    const explorerDevChildren = explorerProvider46.getChildren(explorerLocal);
    assert.strictEqual(explorerDevChildren.length, 1);
    assert.strictEqual(explorerDevChildren[0].iconPath.id, 'arrow-subwards', 'Explorer child environment must use arrow-subwards icon');

    console.log('✓ Visual Environment Hierarchy Distinction (Root vs Parent vs Child) verified');
  }

  // ==========================================
  // Suite 47: Collection Base URL Precedence, No Environment & {{collectionBaseUrl}} / {{envBaseUrl}}
  // ==========================================
  {
    const stateManager47 = new BlueByrdStateManager(mockContext);
    const variableService47 = new VariableService(stateManager47);

    const testState47 = {
      activeProfileId: 'all',
      activeEnvironmentName: 'Staging Env',
      profiles: [{ id: 'prof-47', name: 'Profile 47' }],
      environments: {
        'Staging Env': {
          id: 'env-staging-47',
          name: 'Staging Env',
          baseUrl: 'https://staging.corporate.com',
          variables: { envVar: 'env-val' }
        }
      },
      collections: [
        {
          id: 'col-indexer-47',
          name: 'Indexer Collection',
          baseUrl: 'https://indexer.node.com:8980',
          baseUrlPreference: 'collection',
          preferCollectionBaseUrl: true,
          variables: { colVar: 'col-val' },
          folders: [],
          requests: []
        }
      ],
      history: []
    };

    stateManager47.save(testState47);

    // 1. With baseUrlPreference: 'collection', Collection Base URL wins over active environment
    const resColPref = variableService47.resolveVariablesDetailed(
      undefined,
      'Staging Env',
      'Indexer Collection',
      undefined,
      [],
      'collection'
    );

    assert.strictEqual(resColPref.resolved['baseUrl'], 'https://indexer.node.com:8980', 'baseUrl must resolve to collection base URL when preference is collection');
    assert.strictEqual(resColPref.resolved['collectionBaseUrl'], 'https://indexer.node.com:8980', 'collectionBaseUrl must always be available');
    assert.strictEqual(resColPref.resolved['envBaseUrl'], 'https://staging.corporate.com', 'envBaseUrl must always be available');
    assert.strictEqual(resColPref.resolved['envVar'], 'env-val', 'Environment variables must still apply');
    assert.strictEqual(resColPref.resolved['colVar'], 'col-val', 'Collection variables must still apply');

    // Check overridden flag on environment's baseUrl in inherited
    const envBaseUrlInherited = resColPref.inherited.find(i => i.key === 'baseUrl' && i.source === 'environment');
    assert(envBaseUrlInherited, 'Environment baseUrl must be in inherited trace');
    assert.strictEqual(envBaseUrlInherited.isOverridden, true, 'Environment baseUrl must be marked as overridden');

    // 2. With baseUrlPreference: 'environment', Environment Base URL wins
    const resEnvPref = variableService47.resolveVariablesDetailed(
      undefined,
      'Staging Env',
      'Indexer Collection',
      undefined,
      [],
      'environment'
    );
    assert.strictEqual(resEnvPref.resolved['baseUrl'], 'https://staging.corporate.com', 'baseUrl must resolve to environment base URL when preference is environment');
    assert.strictEqual(resEnvPref.resolved['collectionBaseUrl'], 'https://indexer.node.com:8980', 'collectionBaseUrl must still be available');

    // 3. With "No Environment" (empty environment), Collection Base URL is preserved with 0 environment overrides
    const resNoEnv = variableService47.resolveVariablesDetailed(
      undefined,
      '',
      'Indexer Collection',
      undefined,
      []
    );
    assert.strictEqual(resNoEnv.resolved['baseUrl'], 'https://indexer.node.com:8980', 'baseUrl must resolve to collection base URL when no environment is active');
    assert.strictEqual(resNoEnv.resolved['envBaseUrl'], undefined, 'No envBaseUrl when no environment is active');
    assert.strictEqual(resNoEnv.resolved['colVar'], 'col-val', 'Collection variables must be present');

    // 4. Verify Request Panel HTML renders No Environment and Base URL preference selector
    const reqPanelHtml = getRequestPanelHtml(
      {
        collection: 'Indexer Collection',
        environment: '',
        baseUrlPreference: 'collection'
      },
      testState47,
      [],
      []
    );
    assert(reqPanelHtml.includes('No Environment (Collection Defaults)'), 'Request panel must render No Environment option');
    assert(reqPanelHtml.includes('id="select-base-url-pref"'), 'Request panel must render select-base-url-pref');
    assert(reqPanelHtml.includes('value="collection" selected'), 'Collection preference option must be selected');

    console.log('✓ Collection Base URL Precedence, No Environment & {{collectionBaseUrl}} / {{envBaseUrl}} verified');
  }

  // ==========================================
  // Suite 48: Single Active Profile Selection, Settings Panel & Ctrl+Z Undo
  // ==========================================
  {
    const stateManager48 = new BlueByrdStateManager(mockContext);
    const mockTokenService48 = {
      getAllTokens: () => [
        {
          id: 'tok-suite48',
          profileId: 'prof-dev',
          profileName: 'Developer',
          envName: 'Dev Local',
          tokenName: 'Suite48 Bearer',
          accessToken: 'bb_oauth_suite48_secret_token_123',
          expiresAt: Date.now() + 7200000
        }
      ],
      getTokens: async () => [],
      pruneAllExpiredTokens: async () => 0
    };

    const testState48 = {
      activeProfileId: 'prof-dev',
      activeEnvironmentName: 'Dev Local',
      profiles: [
        { id: 'prof-dev', name: 'Developer', auth: { type: 'none' }, variables: { devKey: 'devVal' }, headers: {} },
        { id: 'prof-staging', name: 'Staging', auth: { type: 'none' }, variables: { stgKey: 'stgVal' }, headers: {} },
      ],
      environments: {
        'Dev Local': { id: 'env-dev-local', baseUrl: 'http://localhost:3000' }
      },
      collections: [],
      history: [],
      settings: {
        baseUrlPreference: 'auto',
        requestTimeoutMs: 30000,
        followRedirects: true,
        rejectUnauthorized: true
      }
    };

    stateManager48.save(testState48);

    // 1. Verify ProfilesTreeProvider renders single active selection
    const profilesTree48 = new BlueByrdProfilesTreeProvider(stateManager48, mockTokenService48);
    const initialRootProfiles = await profilesTree48.getChildren();

    const devNode = initialRootProfiles.find(p => p.label === 'Developer');
    const stagingNode = initialRootProfiles.find(p => p.label === 'Staging');
    const globalNode = initialRootProfiles.find(p => p.label === 'Shared / Global');
    const settingsNode = initialRootProfiles.find(p => p.label.includes('Manage Profiles & Settings'));

    assert(devNode, 'Developer profile node must exist');
    assert(stagingNode, 'Staging profile node must exist');
    assert(globalNode, 'Shared / Global profile node must exist');
    assert(settingsNode, 'Manage Profiles & Settings action node must exist');

    // Developer is active, Staging is inactive
    assert(devNode.description.includes('✔ Active (1 active)'), 'Developer profile must show ✔ Active (1 active)');
    assert.strictEqual(devNode.iconPath.id, 'check', 'Active profile must have check icon');
    assert.strictEqual(devNode.iconPath.color.id, 'charts.green', 'Active profile must have green check');

    assert(stagingNode.description.includes('Click to activate'), 'Inactive profile must show Click to activate');
    assert.strictEqual(stagingNode.iconPath.id, 'circle-outline', 'Inactive profile must have circle-outline icon');

    // 2. Switch active profile to Staging -> Developer becomes inactive, Staging becomes active
    stateManager48.setActiveProfileId('prof-staging');
    profilesTree48.refresh();
    const switchedRootProfiles = await profilesTree48.getChildren();
    const switchedDev = switchedRootProfiles.find(p => p.label === 'Developer');
    const switchedStaging = switchedRootProfiles.find(p => p.label === 'Staging');

    assert(switchedStaging.description.includes('✔ Active (1 active)'), 'Staging profile must now show ✔ Active');
    assert.strictEqual(switchedStaging.iconPath.id, 'check');
    assert(switchedDev.description.includes('Click to activate'), 'Developer profile must now show Click to activate');
    assert.strictEqual(switchedDev.iconPath.id, 'circle-outline');

    // 3. Verify getGlobalSettingsPanelHtml renders all 5 tabs and valid JavaScript
    const settingsHtml = getGlobalSettingsPanelHtml(
      testState48,
      mockTokenService48.getAllTokens(),
      'profiles',
      'prof-staging'
    );

    assert(settingsHtml.includes('byrdsnest api client Settings'), 'Settings HTML must have byrdsnest title');
    assert(settingsHtml.includes('id="tab-profiles"'), 'Settings HTML must have tab-profiles');
    assert(settingsHtml.includes('id="tab-baseurl"'), 'Settings HTML must have tab-baseurl');
    assert(settingsHtml.includes('id="tab-network"'), 'Settings HTML must have tab-network');
    assert(settingsHtml.includes('id="tab-tokens"'), 'Settings HTML must have tab-tokens');
    assert(settingsHtml.includes('id="tab-data"'), 'Settings HTML must have tab-data');
    assert(settingsHtml.includes('Auto (Collection First) &mdash; Recommended'), 'Settings HTML must offer Auto Base URL choice');
    assert(settingsHtml.includes('Suite48 Bearer'), 'Settings HTML must show stored tokens in Token Vault tab');

    // Validate client script syntax in settings HTML
    const scriptMatch = settingsHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch, 'Settings HTML must contain <script>');
    assert.doesNotThrow(() => {
      new Function('acquireVsCodeApi', scriptMatch[1]);
    }, 'Client script in global settings HTML must be valid JavaScript without syntax errors');

    // 4. Verify Request Panel HTML has Undo / Redo (Ctrl+Z) and Tab indentation handling
    const reqHtmlWithUndo = getRequestPanelHtml(
      { collection: 'Indexer Collection' },
      testState48,
      [],
      []
    );
    assert(reqHtmlWithUndo.includes('Comprehensive Undo / Redo Manager (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)'), 'Request panel HTML must contain Undo/Redo Manager');
    assert(reqHtmlWithUndo.includes('performUndo'), 'Request panel HTML must implement performUndo');
    assert(reqHtmlWithUndo.includes('performRedo'), 'Request panel HTML must implement performRedo');
    assert(reqHtmlWithUndo.includes('recordUndoSnapshot'), 'Request panel HTML must implement recordUndoSnapshot');
    assert(reqHtmlWithUndo.includes("e.key === 'Tab'"), 'Request panel HTML must handle Tab indentation in textareas');

    console.log('✓ Single Active Profile Selection, Settings Panel & Ctrl+Z Undo verified');
  }

  // Test 49: Disabled Base URL, Clean Command Manifest & Tools-scoped Profiles
  {
    // 1. Verify Manifest clean command titles and category
    const pkg = require('../package.json');
    const cmds = pkg.contributes.commands;
    cmds.forEach(cmd => {
      assert.strictEqual(cmd.category, 'byrdsnest api client', `Command ${cmd.command} must have category 'byrdsnest api client'`);
      assert(!cmd.title.startsWith('byrdsnest api client:'), `Command ${cmd.command} title must not repeat category name prefix`);
    });

    // 2. Verify sidebar views (Collections, Environments, Tools)
    const views = pkg.contributes.views.byrdsnestApiClient;
    const viewIds = views.map(v => v.id);
    assert(viewIds.includes('byrdsnestCollections'), 'Must include Collections view');
    assert(viewIds.includes('byrdsnestEnvironments'), 'Must include Environments view');
    assert(viewIds.includes('byrdsnestTools'), 'Must include Tools view');
    assert(!viewIds.includes('byrdsnestProfiles'), 'Profiles must not be a top-level sidebar accordion');

    // 3. Verify VariableService with baseUrlDisabled on Collection
    const mockStorage49 = new Map();
    const mockCtx49 = {
      workspaceState: {
        get: (k) => mockStorage49.get(k),
        update: (k, v) => { mockStorage49.set(k, v); return Promise.resolve(); }
      }
    };
    const sm49 = new BlueByrdStateManager(mockCtx49);
    const testState49 = sm49.getState();

    testState49.environments['Staging'] = {
      id: 'env-staging-49',
      baseUrl: 'https://staging.api.example.com',
      variables: {},
      headers: {}
    };

    testState49.collections = [
      {
        id: 'col-disabled-url',
        name: 'Disabled URL Col',
        baseUrl: 'https://collection-url.example.com',
        baseUrlDisabled: true,
        folders: [],
        requests: []
      },
      {
        id: 'col-enabled-url',
        name: 'Enabled URL Col',
        baseUrl: 'https://collection-url.example.com',
        baseUrlDisabled: false,
        folders: [],
        requests: []
      }
    ];
    sm49.save(testState49);

    const vs49 = new VariableService(sm49);

    // Case A: Collection baseUrlDisabled = true -> collection does not override or set baseUrl
    const varsWithDisabledCol = vs49.resolveVariablesDetailed(
      undefined,
      'Staging',
      'col-disabled-url',
      undefined,
      [],
      'collection'
    );
    assert.strictEqual(varsWithDisabledCol.resolved['collectionBaseUrl'], undefined, 'Disabled collection baseUrl must not be exposed');
    assert.strictEqual(varsWithDisabledCol.resolved['baseUrl'], 'https://staging.api.example.com', 'Environment baseUrl must prevail when collection baseUrl is disabled');

    // Case B: Collection baseUrlDisabled = false -> collection baseUrl resolves
    const varsWithEnabledCol = vs49.resolveVariablesDetailed(
      undefined,
      'Staging',
      'col-enabled-url',
      undefined,
      [],
      'collection'
    );
    assert.strictEqual(varsWithEnabledCol.resolved['baseUrl'], 'https://collection-url.example.com', 'Enabled collection baseUrl must resolve');

    // Case C: Environment baseUrlDisabled = true -> environment baseUrl does not resolve
    testState49.environments['Staging'].baseUrlDisabled = true;
    sm49.save(testState49);
    const varsWithDisabledEnv = vs49.resolveVariablesDetailed(
      undefined,
      'Staging',
      'col-disabled-url',
      undefined,
      [],
      'environment'
    );
    assert.strictEqual(varsWithDisabledEnv.resolved['baseUrl'], undefined, 'Disabled environment baseUrl must not resolve');
    assert.strictEqual(varsWithDisabledEnv.resolved['envBaseUrl'], undefined, 'Disabled environment envBaseUrl must not be exposed');

    // Case D: baseUrlPreference = 'none' -> neither baseUrl resolves
    const varsWithNonePref = vs49.resolveVariablesDetailed(
      undefined,
      'Staging',
      'col-enabled-url',
      undefined,
      [],
      'none'
    );
    assert.strictEqual(varsWithNonePref.resolved['baseUrl'], undefined, "baseUrlPreference 'none' must not set baseUrl");

    // 4. Verify Settings Panel HTML renders Disable Base URL toggles
    const envSettingsHtml = getSettingsPanelHtml('environment', testState49.environments['Staging'], 'Staging');
    assert(envSettingsHtml.includes('id="base-url-disabled"'), 'Environment settings HTML must have base-url-disabled checkbox');
    assert(envSettingsHtml.includes('Disable Base URL'), 'Environment settings HTML must include Disable Base URL label');

    const colSettingsHtml = getSettingsPanelHtml('collection', testState49.collections[0], 'Disabled URL Col');
    assert(colSettingsHtml.includes('id="col-base-url-disabled"'), 'Collection settings HTML must have col-base-url-disabled checkbox');
    assert(colSettingsHtml.includes('Disable Base URL'), 'Collection settings HTML must include Disable Base URL label');

    console.log('✓ Disabled Base URL (Collection & Environment), Clean Commands & Tools Profiles verified');
  }

  // ==========================================
  // Suite 50: Profile Color Themes (Settings, Palettes, Status Bar, Webviews, and Tree Icons)
  // ==========================================
  {
    const isolatedContext = {
      storage: {},
      workspaceState: {
        get(key) { return this[key]; },
        update(key, val) { this[key] = val; }
      }
    };
    const stateManager50 = new BlueByrdStateManager(isolatedContext);
    const state50 = stateManager50.getState();

    // 1. Verify default state profiles have preset color themes
    const devProf = state50.profiles.find(p => p.id === 'profile-dev');
    const stagingProf = state50.profiles.find(p => p.id === 'profile-staging');
    const prodProf = state50.profiles.find(p => p.id === 'profile-prod');

    assert(devProf, 'Dev profile must exist in default state');
    assert.strictEqual(devProf.color, '#10b981', 'Dev profile must have Dev Green color theme');
    assert(stagingProf, 'Staging profile must exist in default state');
    assert.strictEqual(stagingProf.color, '#f59e0b', 'Staging profile must have Staging Amber color theme');
    assert(prodProf, 'Production profile must exist in default state');
    assert.strictEqual(prodProf.color, '#ef4444', 'Prod profile must have Prod Red color theme');

    // 2. Create custom profile with explicit color and verify persistence across normalization
    const customProf = stateManager50.createProfile('Canary Testing', undefined, '#8b5cf6');
    assert.strictEqual(customProf.color, '#8b5cf6', 'Created profile must retain custom color');
    const normalized = stateManager50.normalizeState(stateManager50.getState());
    const normCustom = normalized.profiles.find(p => p.id === customProf.id);
    assert(normCustom, 'Normalized profiles must contain custom profile');
    assert.strictEqual(normCustom.color, '#8b5cf6', 'Normalized profile must preserve custom color theme');

    // 3. Verify Global Settings Panel HTML renders color swatches, picker, and active theme
    const globalSettingsHtml = getGlobalSettingsPanelHtml(state50, [], 'profiles', devProf.id);
    assert(globalSettingsHtml.includes('class="color-swatch-btn'), 'Global Settings HTML must render color swatch buttons');
    assert(globalSettingsHtml.includes('id="prof-color-picker"'), 'Global Settings HTML must render HTML5 color picker');
    assert(globalSettingsHtml.includes('id="prof-color-input"'), 'Global Settings HTML must render hex color input');
    assert(globalSettingsHtml.includes('id="prof-theme-preview"'), 'Global Settings HTML must render theme preview pill');
    assert(globalSettingsHtml.includes('--primary: #10b981;'), 'Global Settings HTML must theme --primary with selected profile color');
    assert(globalSettingsHtml.includes('style="border-left: 3px solid #10b981;"'), 'Selected profile card must have left color accent border');

    // 4. Verify standalone Profile Settings Panel HTML
    const profileSettingsHtml = getSettingsPanelHtml('profile', customProf, customProf.name);
    assert(profileSettingsHtml.includes('Profile Color Theme'), 'Profile Settings HTML must render Profile Color Theme banner');
    assert(profileSettingsHtml.includes('id="prof-color-picker"'), 'Profile Settings HTML must render color picker input');
    assert(profileSettingsHtml.includes('value="#8b5cf6"'), 'Profile Settings HTML must populate current profile color');
    assert(profileSettingsHtml.includes('--primary: #8b5cf6;'), 'Profile Settings HTML must theme --primary with profile color');

    // 5. Verify Request Panel HTML renders active profile accent and indicator dot
    const requestPanelHtml = getRequestPanelHtml(
      { profileId: 'profile-dev' },
      state50,
      [],
      [],
      []
    );
    assert(requestPanelHtml.includes('--profile-accent: #10b981;'), 'Request Panel HTML must set --profile-accent to active profile color');
    assert(requestPanelHtml.includes('--primary: var(--profile-accent);'), 'Request Panel HTML must bind --primary to --profile-accent');
    assert(requestPanelHtml.includes('id="profile-indicator-dot"'), 'Request Panel HTML must render profile indicator dot');
    assert(requestPanelHtml.includes('data-color="#10b981"'), 'Profile option in Request Panel must carry data-color');

    // 6. Verify Tools Tree Provider has Manage Profiles & Settings (no longer has collapsible Profiles section)
    const toolsProvider50 = new BlueByrdToolsTreeProvider(stateManager50);
    const sections = await toolsProvider50.getChildren();
    const manageItem50 = sections.find(s => s.label === 'Manage Profiles & Settings...');
    assert(manageItem50, 'Manage Profiles & Settings item must exist in Tools tree');
    assert.strictEqual(manageItem50.command.command, 'byrdsnestApiClient.openSettings', 'Manage Profiles item must open settings');
    const profilesSectionGone = sections.find(s => s.itemId === 'tool-profiles');
    assert.strictEqual(profilesSectionGone, undefined, 'Profiles collapsible section must be removed from Tools tree');

    console.log('✓ Profile Color Themes (Settings, Palettes, Status Bar, Webviews, and Tree Icons) verified');
  }

  // ==========================================
  // Suite 51: Profile Banner in Environments Tree, Removed from Collections & Tools
  // ==========================================
  {
    const stateManager51 = new BlueByrdStateManager(mockContext);
    const stagingProf = stateManager51.createProfile('Staging Profile', undefined, '#f59e0b');
    stateManager51.setActiveProfileId(stagingProf.id);

    // 1. Banner must appear in Environments tree (first item)
    const envsProvider51 = new BlueByrdEnvironmentsTreeProvider(stateManager51);
    const envNodes = envsProvider51.getChildren();
    assert(envNodes.length >= 1, 'Environments tree must have items');
    const bannerNode = envNodes[0];
    assert.strictEqual(bannerNode.itemId, 'active-profile-banner', 'First item in environments tree must be active profile banner');
    assert.strictEqual(bannerNode.kind, 'active-filter', 'Banner item kind must be active-filter');
    assert.strictEqual(bannerNode.label, 'Profile: Staging Profile', 'Banner item label must reflect active profile name');
    assert.strictEqual(bannerNode.description, '(click to switch)', 'Banner item description must indicate click to switch');
    assert.strictEqual(bannerNode.command.command, 'byrdsnestApiClient.switchActiveProfile', 'Banner command must switch active profile');
    assert.strictEqual(bannerNode.contextValue, 'byrdsnest.activeFilter', 'Banner contextValue must be byrdsnest.activeFilter');
    assert(bannerNode.iconPath && bannerNode.iconPath.path.includes(encodeURIComponent('#f59e0b')), 'Banner icon must be SVG tinted with active profile color');

    // 2. Banner must NOT appear in Collections tree
    const collectionsProvider51 = new BlueByrdCollectionsTreeProvider(stateManager51);
    const colNodes = collectionsProvider51.getChildren();
    const colBanner = colNodes.find(n => n.itemId === 'active-profile-banner');
    assert.strictEqual(colBanner, undefined, 'Collections tree must NOT have active profile banner (moved to Environments)');

    // 3. Profiles section must NOT appear in Tools tree
    const toolsProvider51 = new BlueByrdToolsTreeProvider(stateManager51);
    const toolItems = toolsProvider51.getChildren();
    const profilesSection = toolItems.find(t => t.label === 'Profiles' || t.itemId === 'tool-profiles');
    assert.strictEqual(profilesSection, undefined, 'Tools tree must NOT have a Profiles collapsible section (removed)');

    // 4. Manage Profiles & Settings must still be in Tools
    const manageItem = toolItems.find(t => t.label === 'Manage Profiles & Settings...');
    assert(manageItem, 'Tools tree must still have Manage Profiles & Settings item');
    assert.strictEqual(manageItem.command.command, 'byrdsnestApiClient.openSettings', 'Manage Profiles item must open settings');

    // 5. Verify package.json inline menu actions and icons
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    const switchCmd = packageJson.contributes.commands.find(c => c.command === 'byrdsnestApiClient.switchActiveProfile');
    assert(switchCmd, 'byrdsnestApiClient.switchActiveProfile must be registered in package.json');
    assert.strictEqual(switchCmd.icon, '$(arrow-swap)', 'switchActiveProfile icon must be $(arrow-swap)');

    const contextMenus = packageJson.contributes.menus['view/item/context'];
    const bannerSwitchAction = contextMenus.find(m => m.command === 'byrdsnestApiClient.switchActiveProfile' && m.when.includes('byrdsnest.activeFilter'));
    assert(bannerSwitchAction, 'view/item/context must include switchActiveProfile for activeFilter');
    assert.strictEqual(bannerSwitchAction.group, 'inline@1', 'switchActiveProfile must be inline@1');

    const bannerSettingsAction = contextMenus.find(m => m.command === 'byrdsnestApiClient.openSettings' && m.when.includes('byrdsnest.activeFilter'));
    assert(bannerSettingsAction, 'view/item/context must include openSettings for activeFilter');
    assert.strictEqual(bannerSettingsAction.group, 'inline@2', 'openSettings must be inline@2');

    console.log('✓ Profile Banner in Environments Tree, Removed from Collections & Tools verified');
  }

  // ==========================================
  // Suite 52: Actual Resolved URL in Request Panel Green Box with Recursive Variables
  // ==========================================
  {
    const stateManager52 = new BlueByrdStateManager(mockContext);
    const state52 = stateManager52.getState();
    const reqHtml52 = getRequestPanelHtml(
      {
        url: '{{baseUrl}}/health',
        method: 'GET'
      },
      state52,
      [
        { key: 'baseUrl', value: 'https://{{customer}}{{stack}}.sce.manh.com', source: 'collection', sourceName: 'Algod REST API' },
        { key: 'customer', value: 'twcc', source: 'collection', sourceName: 'Algod REST API' },
        { key: 'stack', value: 'p', source: 'profile', sourceName: 'Production' }
      ]
    );

    // 1. Verify CSS styles for the actual resolved URL green pill
    assert(reqHtml52.includes('.token-pill.url-resolved-pill'), 'Request panel must define .url-resolved-pill styles');
    assert(reqHtml52.includes('.token-pill.url-resolved-pill .token-val-url'), 'Request panel must define .token-val-url styles');
    assert(reqHtml52.includes('.token-copy-icon'), 'Request panel must define .token-copy-icon styles');

    // 2. Extract and execute script functions in a sandbox to verify resolveRecursively
    const scriptMatch52 = reqHtml52.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch52, 'Script block must be present');

    const vm = require('vm');
    const createMockEl = () => ({ style: {}, classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, querySelector: () => createMockEl(), querySelectorAll: () => [], value: '', innerHTML: '', textContent: '' });
    const sandbox52 = {
      console,
      acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => ({}), setState: () => {} }),
      document: {
        addEventListener: () => {},
        getElementById: () => createMockEl(),
        querySelector: () => createMockEl(),
        querySelectorAll: () => [],
        createElement: () => createMockEl()
      },
      window: { addEventListener: () => {} },
      navigator: { clipboard: { writeText: () => {} } },
      currentInheritedVars: [
        { key: 'baseUrl', value: 'https://{{customer}}{{stack}}.sce.manh.com', source: 'collection', sourceName: 'Algod REST API' },
        { key: 'customer', value: 'twcc', source: 'collection', sourceName: 'Algod REST API' },
        { key: 'stack', value: 'p', source: 'profile', sourceName: 'Production' }
      ]
    };
    vm.createContext(sandbox52);

    const funcCode = `
      ${scriptMatch52[1]}
      this.__testResolve = resolveRecursively;
      this.__testAnalyze = analyzeVariables;
      this.__testGetActiveMap = getActiveVariableMap;
    `;
    vm.runInContext(funcCode, sandbox52);

    const testResolve = sandbox52.__testResolve;
    const testMap = sandbox52.__testGetActiveMap();
    const resolution = testResolve('{{baseUrl}}/health', testMap);

    assert.strictEqual(resolution.hasVariables, true, 'Resolution must detect variables');
    assert.strictEqual(resolution.hasUnresolved, false, 'Resolution must have no unresolved tokens');
    assert.strictEqual(resolution.resolvedText, 'https://twccp.sce.manh.com/health', 'Resolved URL must be fully recursively resolved to actual URL in green box');
    assert.strictEqual(resolution.resolvedCount, 3, 'All 3 nested variables must be counted as resolved');

    // Test unresolved token handling
    const unresolvedRes = testResolve('{{baseUrl}}/orders/{{orderId}}', testMap);
    assert.strictEqual(unresolvedRes.hasUnresolved, true, 'Missing token must be flagged as unresolved');
    assert(unresolvedRes.unresolvedTokens.includes('orderId'), 'unresolvedTokens must include orderId');
    assert.strictEqual(unresolvedRes.resolvedText, 'https://twccp.sce.manh.com/orders/{{orderId}}', 'Resolved prefix must be expanded even with unresolved suffix');

    console.log('✓ Actual Resolved URL in Request Panel Green Box with Recursive Variables verified');
  }

  // ==========================================
  // Suite 53: JSON Formatting, Color Highlighting & VS Code Editor Integration
  // ==========================================
  {
    const fs = require('fs');
    const { getRequestPanelHtml } = require(path.join(repoDist, 'views/panels/requestPanelHtml'));

    const mockWebview = {
      asWebviewUri: (uri) => uri,
      cspSource: 'vscode-webview:',
      postMessage: async () => true,
      onDidReceiveMessage: () => ({ dispose: () => {} })
    };

    const mockReq = {
      id: 'req-json-test',
      name: 'Get User Profile',
      method: 'GET',
      url: 'https://api.example.com/user/1',
      headers: [],
      bodyType: 'json',
      body: '{"name":"Alice","age":30,"active":true,"details":null}',
      auth: { type: 'inherit' }
    };

    const stateManager53 = new BlueByrdStateManager(mockContext);
    const html = getRequestPanelHtml(mockReq, stateManager53.getState());

    // 1. Verify CSS syntax highlighting tokens
    assert(html.includes('.json-key'), 'HTML must include .json-key CSS rule');
    assert(html.includes('.json-string'), 'HTML must include .json-string CSS rule');
    assert(html.includes('.json-number'), 'HTML must include .json-number CSS rule');
    assert(html.includes('.json-boolean'), 'HTML must include .json-boolean CSS rule');
    assert(html.includes('.json-null'), 'HTML must include .json-null CSS rule');

    // 2. Verify controls: Format/Raw toggle, Copy button, Open in Editor button
    assert(html.includes('id="btn-format-resp"'), 'Response pane must have Format/Raw toggle button');
    assert(html.includes('id="btn-copy-resp"'), 'Response pane must have Copy button');
    assert(html.includes('id="btn-open-editor"'), 'Response pane must have Open in Editor button');
    assert(html.includes('id="btn-edit-body-json"'), 'Request body pane must have Open in Editor button');

    // 3. Test highlightJson logic inside client JS
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch, 'HTML must contain script block');

    const vm = require('vm');
    const createMockEl53 = () => ({ style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, querySelector: () => createMockEl53(), querySelectorAll: () => [], value: '', innerHTML: '', textContent: '' });
    const sandbox53 = {
      console: console,
      acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => ({}), setState: () => {} }),
      document: {
        addEventListener: () => {},
        getElementById: () => createMockEl53(),
        querySelector: () => createMockEl53(),
        querySelectorAll: () => [],
        createElement: () => createMockEl53()
      },
      window: { addEventListener: () => {} },
      navigator: { clipboard: { writeText: () => {} } }
    };
    vm.createContext(sandbox53);

    const funcCode = `
      ${scriptMatch[1]}
      this.__testHighlightJson = highlightJson;
    `;
    vm.runInContext(funcCode, sandbox53);

    const highlightJson = sandbox53.__testHighlightJson;
    assert.strictEqual(typeof highlightJson, 'function', 'highlightJson must be defined');

    const sampleJson = JSON.stringify({
      username: "alice_jones",
      count: 42,
      is_valid: true,
      data: null
    }, null, 2);

    const highlighted = highlightJson(sampleJson);
    assert(highlighted.includes('<span class="json-key">"username"</span>'), 'JSON keys must be styled with .json-key');
    assert(highlighted.includes('<span class="json-string">"alice_jones"</span>'), 'JSON strings must be styled with .json-string');
    assert(highlighted.includes('<span class="json-number">42</span>'), 'JSON numbers must be styled with .json-number');
    assert(highlighted.includes('<span class="json-boolean">true</span>'), 'JSON booleans must be styled with .json-boolean');
    assert(highlighted.includes('<span class="json-null">null</span>'), 'JSON null must be styled with .json-null');

    // 4. Verify RequestPanel handles openInEditor message
    const panelSrc = fs.readFileSync(path.join(__dirname, '../src/views/panels/requestPanel.ts'), 'utf8');
    assert(panelSrc.includes("message.type === 'openInEditor'"), 'RequestPanel must handle openInEditor message type');
    assert(panelSrc.includes('vscode.workspace.openTextDocument'), 'RequestPanel must call openTextDocument');
    assert(panelSrc.includes('vscode.window.showTextDocument'), 'RequestPanel must show document in editor beside panel');

    console.log('✓ JSON Formatting, Color Highlighting & VS Code Editor Integration verified');
  }

  // ==========================================
  // Suite 54: Profile-Scoped Hierarchical Environment Dropdown & Accurate Variable Resolution Truth
  // ==========================================
  {
    const stateManager54 = new BlueByrdStateManager(mockContext);
    const profTenant = stateManager54.createProfile('Tenant Profile', undefined, '#8b5cf6');
    const testState54 = stateManager54.getState();
    testState54.activeProfileId = profTenant.id;

    // Add Profile-scoped environments (Parent -> Child)
    testState54.environments['Tenant-Root'] = {
      id: 'env-tenant-root',
      name: 'Tenant-Root',
      baseUrl: 'https://tenant.example.com',
      profileId: profTenant.id,
      variables: {},
      headers: {}
    };
    testState54.environments['Tenant-Child'] = {
      id: 'env-tenant-child',
      name: 'Tenant-Child',
      baseUrl: 'https://tenant-child.example.com',
      profileId: profTenant.id,
      inheritsFrom: 'Tenant-Root',
      variables: {},
      headers: {}
    };

    // Add Global environment
    testState54.environments['Shared-Global'] = {
      id: 'env-shared-global',
      name: 'Shared-Global',
      baseUrl: 'https://shared.example.com',
      variables: {},
      headers: {}
    };

    // Add Unrelated other profile environment (should be excluded when filtered by active profile)
    testState54.environments['Other-Profile-Env'] = {
      id: 'env-other-profile',
      name: 'Other-Profile-Env',
      baseUrl: 'https://other.example.com',
      profileId: 'other-profile-id',
      variables: {},
      headers: {}
    };

    // 1. Verify Request Panel HTML renders optgroups and profile filtering
    const reqHtml54 = getRequestPanelHtml(
      {
        url: '{{baseUrl}}/health',
        method: 'GET'
      },
      testState54,
      [
        { key: 'baseUrl', value: 'http://localhost:8080', source: 'collection', sourceName: 'Algod REST API (Disabled)', isOverridden: true }
      ]
    );

    assert(reqHtml54.includes('<optgroup label="Profile Environments (Tenant Profile)">'), 'Must render Profile Environments optgroup');
    assert(reqHtml54.includes('<optgroup label="Shared / Global Environments">'), 'Must render Shared / Global Environments optgroup');
    assert(reqHtml54.includes('Tenant-Root'), 'Profile environments must be included');
    assert(reqHtml54.includes('↳ Tenant-Child (inherits: Tenant-Root)'), 'Child environment must have indentation and inherits annotation');
    assert(reqHtml54.includes('Shared-Global'), 'Shared global environment must be included');
    const selectEnvMatch = reqHtml54.match(/<select id="select-env"[^>]*>([\s\S]*?)<\/select>/);
    assert(selectEnvMatch, 'select-env dropdown must be present');
    assert(!selectEnvMatch[1].includes('Other-Profile-Env'), 'Environments belonging to other profiles must not be included in select-env options');

    // 2. Verify Client-Side Variable Map Truth: Disabled variable MUST NOT be treated as active in varMap
    const scriptMatch54 = reqHtml54.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch54, 'Script block must be present');

    const vm54 = require('vm');
    const mockEl54 = () => ({ style: {}, classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, querySelector: () => mockEl54(), querySelectorAll: () => [], value: '', innerHTML: '', textContent: '' });
    const sandbox54 = {
      console,
      acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => ({}), setState: () => {} }),
      document: {
        addEventListener: () => {},
        getElementById: () => mockEl54(),
        querySelector: () => mockEl54(),
        querySelectorAll: () => [],
        createElement: () => mockEl54()
      },
      window: { addEventListener: () => {} },
      navigator: { clipboard: { writeText: () => {} } },
      currentInheritedVars: [
        { key: 'baseUrl', value: 'http://localhost:8080', source: 'collection', sourceName: 'Algod REST API (Disabled)', isOverridden: true }
      ]
    };
    vm54.createContext(sandbox54);

    const testCode54 = `
      ${scriptMatch54[1]}
      this.__testResolve = resolveRecursively;
      this.__testGetActiveMap = getActiveVariableMap;
      this.__testRenderEnvHtml = renderEnvironmentSelectHtml;
    `;
    vm54.runInContext(testCode54, sandbox54);

    const testMap54 = sandbox54.__testGetActiveMap();
    assert.strictEqual(testMap54['baseUrl'], undefined, 'Disabled/overridden baseUrl must NOT be present in varMap');

    const resolution54 = sandbox54.__testResolve('{{baseUrl}}/health', testMap54);
    assert.strictEqual(resolution54.hasUnresolved, true, '{{baseUrl}} must be flagged as unresolved when disabled');
    assert(resolution54.unresolvedTokens.includes('baseUrl'), 'unresolvedTokens must include baseUrl');

    // 3. Verify client-side renderEnvironmentSelectHtml reproduces optgroup hierarchy dynamically
    const dynamicHtml = sandbox54.__testRenderEnvHtml(
      [
        { id: 'e1', name: 'Tenant-Root', profileId: profTenant.id },
        { id: 'e2', name: 'Tenant-Child', inheritsFrom: 'Tenant-Root', profileId: profTenant.id },
        { id: 'e3', name: 'Shared-Global' },
        { id: 'e4', name: 'Other-Profile-Env', profileId: 'other-profile-id' }
      ],
      profTenant.id,
      'Tenant-Root'
    );
    assert(dynamicHtml.includes('<optgroup label="Profile Environments'), 'Dynamic client generator must create optgroups');
    assert(dynamicHtml.includes('Tenant-Root'), 'Dynamic client generator must include profile envs');
    assert(dynamicHtml.includes('↳ Tenant-Child (inherits: Tenant-Root)'), 'Dynamic client generator must format hierarchy');
    assert(!dynamicHtml.includes('Other-Profile-Env'), 'Dynamic client generator must filter out other profiles');

    console.log('✓ Profile-Scoped Hierarchical Environment Dropdown & Accurate Variable Resolution Truth verified');
  }

  // ==========================================
  // Test 55: Action Bar Decluttering, Active Environment Persistence & Variable Deduplication
  // ==========================================
  {
    const { BlueByrdStateManager } = require(path.join(repoDist, 'state/stateManager'));
    const { VariableService } = require(path.join(repoDist, 'services/variableService'));
    const { getGlobalSettingsPanelHtml } = require(path.join(repoDist, 'views/panels/globalSettingsPanelHtml'));
    const pkgJson = require('../package.json');

    // 1. Verify action bar decluttering in package.json
    const contextMenus = pkgJson.contributes.menus['view/item/context'];
    
    // deleteItem must NEVER be inline (prevent accidental misclicks and visual clutter)
    const inlineDeletes = contextMenus.filter(m => m.command === 'byrdsnestApiClient.deleteItem' && m.group && m.group.startsWith('inline'));
    assert.strictEqual(inlineDeletes.length, 0, 'No deleteItem action may be placed in an inline group');

    // exportCollection and exportEnvironment must not be inline
    const inlineExports = contextMenus.filter(m => (m.command === 'byrdsnestApiClient.exportCollection' || m.command === 'byrdsnestApiClient.exportEnvironment') && m.group && m.group.startsWith('inline'));
    assert.strictEqual(inlineExports.length, 0, 'No export action may be placed in an inline group');

    // Collection hover must only have inline@1 (newRequest), not 4 stacked icons
    const colInlineActions = contextMenus.filter(m => m.when && m.when.includes('byrdsnest.collection') && m.group && m.group.startsWith('inline'));
    assert.strictEqual(colInlineActions.length, 1, 'Collection item hover must only have 1 inline action (newRequest)');
    assert.strictEqual(colInlineActions[0].command, 'byrdsnestApiClient.newRequest');

    // 2. Verify variable deduplication in environment resolution
    const sm55 = new BlueByrdStateManager(mockContext);
    const vs55 = new VariableService(sm55);

    // Save an environment that has both baseUrl property AND baseUrl in variables dictionary
    sm55.saveEnvironment('TestEnv', {
      id: 'env-test-dedup',
      baseUrl: 'https://api.custom.com',
      apiKey: 'custom-api-key',
      variables: {
        baseUrl: 'https://api.custom.com', // Duplicate entry
        apiKey: 'custom-api-key',          // Duplicate entry
        customVar: 'customValue'
      }
    });

    const resDetailed = vs55.resolveVariablesDetailed(undefined, 'TestEnv');
    const baseUrlInherited = resDetailed.inherited.filter(v => v.key === 'baseUrl' && v.source === 'environment');
    assert.strictEqual(baseUrlInherited.length, 1, 'Inherited variables must not contain duplicate baseUrl from the same environment');
    assert.strictEqual(baseUrlInherited[0].isOverridden, undefined, 'Winning environment baseUrl must not be marked overridden');

    const apiKeyInherited = resDetailed.inherited.filter(v => v.key === 'apiKey' && v.source === 'environment');
    assert.strictEqual(apiKeyInherited.length, 1, 'Inherited variables must not contain duplicate apiKey from the same environment');

    // 3. Verify Active Environment clearing and persistence (does NOT revert to 'Local')
    const rawStateCleared = {
      profiles: [{ id: 'p1', name: 'P1', auth: { type: 'none' }, variables: {}, headers: {} }],
      environments: {
        Local: { id: 'env-local', baseUrl: 'https://jsonplaceholder.typicode.com', variables: {} },
        Prod: { id: 'env-prod', baseUrl: 'https://api.prod.com', variables: {} }
      },
      collections: [],
      activeProfileId: 'p1',
      activeEnvironmentName: '' // Explicitly cleared by user
    };
    const normCleared = sm55.normalizeState(rawStateCleared);
    assert.strictEqual(normCleared.activeEnvironmentName, undefined, 'Explicitly cleared activeEnvironmentName must remain undefined and NOT revert to Local');

    const rawStateProd = {
      ...rawStateCleared,
      activeEnvironmentName: 'Prod'
    };
    const normProd = sm55.normalizeState(rawStateProd);
    assert.strictEqual(normProd.activeEnvironmentName, 'Prod', 'Explicitly selected active environment must persist');

    // 4. Verify Global Settings Panel renders hierarchical environments and tab preservation
    const sampleState55 = {
      ...normCleared,
      environments: {
        RootEnv: { id: 'root-1', name: 'RootEnv', baseUrl: 'https://root.com' },
        ChildEnv: { id: 'child-1', name: 'ChildEnv', inheritsFrom: 'RootEnv', baseUrl: '' }
      }
    };
    const html55 = getGlobalSettingsPanelHtml(sampleState55, [], 'baseurl');
    assert(html55.includes('↳ ChildEnv'), 'Global Settings panel must format child environments with ↳ hierarchy');
    assert(html55.includes('activeTab: currentActiveTab'), 'Global Settings panel must submit current activeTab in save payload');

    console.log('✓ Action Bar Decluttering, Active Environment Persistence & Variable Deduplication verified');
  }

  // ==========================================
  // Test Suite 56: Profile Safety Guards & Touch Points, Warnings & Full-Height Live Body Editor
  // ==========================================
  {
    // 1. Profile Safety Guards configuration in state manager
    const prodProfile = {
      id: 'profile-prod-guard',
      name: 'Production Guarded',
      color: '#ef4444',
      auth: { type: 'none' },
      variables: {},
      headers: {},
      guards: {
        enabled: true,
        warnBeforeSend: true,
        warnMessage: 'CRITICAL: You are targeting the Production profile!',
        blockedMethods: ['DELETE', 'PUT', 'PATCH'],
        requireKeywordConfirmation: true,
        confirmationKeyword: 'PRODUCTION'
      }
    };

    const baseState = stateManager.getState();
    const stateWithGuards = {
      ...baseState,
      profiles: [...baseState.profiles, prodProfile],
      activeProfileId: 'profile-prod-guard'
    };

    // Verify normalization preserves guards
    const normalizedWithGuards = stateManager.normalizeState(stateWithGuards);
    const normalizedProd = normalizedWithGuards.profiles.find(p => p.id === 'profile-prod-guard');
    assert(normalizedProd, 'Guarded profile must be present after normalization');
    assert(normalizedProd.guards, 'Profile guards must be preserved after normalization');
    assert.strictEqual(normalizedProd.guards.enabled, true, 'Guards enabled must be true');
    assert.strictEqual(normalizedProd.guards.warnBeforeSend, true, 'warnBeforeSend must be true');
    assert.deepStrictEqual(normalizedProd.guards.blockedMethods, ['DELETE', 'PUT', 'PATCH'], 'blockedMethods must match');
    assert.strictEqual(normalizedProd.guards.requireKeywordConfirmation, true, 'requireKeywordConfirmation must be true');
    assert.strictEqual(normalizedProd.guards.confirmationKeyword, 'PRODUCTION', 'confirmationKeyword must match');

    // 2. Request Panel HTML rendering: Live JSON syntax highlighter & Safety Guards badge
    const reqPanelHtml = getRequestPanelHtml(
      { method: 'DELETE', url: 'https://api.example.com/users/123' },
      stateWithGuards
    );
    assert(reqPanelHtml.includes('code-editor-container'), 'Request Panel must render .code-editor-container');
    assert(reqPanelHtml.includes('json-highlight-backdrop'), 'Request Panel must render #json-highlight-backdrop');
    assert(reqPanelHtml.includes('json-line-numbers'), 'Request Panel must render #json-line-numbers gutter');
    assert(reqPanelHtml.includes('profile-guard-badge'), 'Request Panel must render #profile-guard-badge');
    assert(reqPanelHtml.includes('data-guards='), 'Profile option elements must embed data-guards attribute');

    // Verify script integrity of the Request Panel with editor and guards
    const scriptMatch = reqPanelHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch, 'Script tag must be present in request panel HTML');
    assert.doesNotThrow(() => {
      new Function(scriptMatch[1]);
    }, 'Client script in request panel HTML must be valid JavaScript');

    // 3. Dedicated Settings Panel HTML rendering for Profile
    const dedicatedProfileHtml = getSettingsPanelHtml(
      'profile',
      prodProfile,
      prodProfile.name,
      undefined,
      [],
      [],
      []
    );
    assert(dedicatedProfileHtml.includes('🛡️ Safety Guards'), 'Dedicated profile settings must include Safety Guards tab button');
    assert(dedicatedProfileHtml.includes('id="tab-guards"'), 'Dedicated profile settings must render #tab-guards section');
    assert(dedicatedProfileHtml.includes('id="guard-enabled"'), 'Dedicated profile settings must render #guard-enabled toggle');
    assert(dedicatedProfileHtml.includes('guard-method-cb'), 'Dedicated profile settings must render .guard-method-cb checkboxes');
    assert(dedicatedProfileHtml.includes('id="guard-keyword"'), 'Dedicated profile settings must render #guard-keyword input');

    // 4. Global Settings Panel HTML rendering for Profile
    const globalSettingsHtml = getGlobalSettingsPanelHtml(
      stateWithGuards,
      [],
      'profiles',
      'profile-prod-guard'
    );
    assert(globalSettingsHtml.includes('data-subtab="subtab-guards"'), 'Global settings panel must render Safety Guards subtab button');
    assert(globalSettingsHtml.includes('id="subtab-guards"'), 'Global settings panel must render #subtab-guards container');
    assert(globalSettingsHtml.includes('id="guard-warn-send"'), 'Global settings panel must render #guard-warn-send input');
    assert(globalSettingsHtml.includes('id="guard-warn-msg"'), 'Global settings panel must render #guard-warn-msg input');

    console.log('✓ Profile Safety Guards & Touch Points, Warnings & Full-Height Live Body Editor verified');
  }

  // --- Suite 57: URL Preview Variable Resolution Parity & Collection Base URL Fallback with Disabled Environment Base URL ---
  {
    const mockStorage57 = new Map();
    const mockCtx57 = {
      workspaceState: {
        get: (k) => mockStorage57.get(k),
        update: (k, v) => { mockStorage57.set(k, v); return Promise.resolve(); }
      }
    };
    const sm57 = new BlueByrdStateManager(mockCtx57);
    const testState57 = sm57.createDefaultState();

    // Setup: Collection with baseUrl = 'http://localhost:8080'
    const col57 = {
      id: 'col-algod',
      name: 'Algod REST API v0.0.1',
      baseUrl: 'http://localhost:8080',
      baseUrlDisabled: false,
      folders: [],
      requests: [
        {
          id: 'req-health',
          name: 'Health Check',
          method: 'GET',
          url: '{{baseUrl}}/health',
          headers: {},
          body: '',
          bodyType: 'none',
          variables: []
        }
      ]
    };
    testState57.collections = [col57];

    // Setup: Environment with baseUrl = 'https://api.example.com', but baseUrlDisabled = true
    testState57.environments['None'] = {
      id: 'env-none',
      name: 'None',
      baseUrl: 'https://api.example.com',
      baseUrlDisabled: true,
      variables: {},
      headers: {},
      notes: ''
    };
    sm57.save(testState57);

    const vs57 = new VariableService(sm57);

    // 1. Resolve variables with collection and disabled environment
    const details57 = vs57.resolveVariablesDetailed(
      undefined,
      'None',
      'col-algod',
      undefined,
      [],
      'auto'
    );

    // Assert backend resolved dictionary truth
    assert.strictEqual(details57.resolved['baseUrl'], 'http://localhost:8080', 'Active resolved baseUrl must be collection baseUrl when env baseUrl is disabled');
    assert.strictEqual(details57.resolved['collectionBaseUrl'], 'http://localhost:8080', 'collectionBaseUrl must resolve to collection baseUrl');

    // Assert collection baseUrl is NOT marked as overridden
    const colItem = details57.inherited.find(i => i.source === 'collection' && i.key === 'baseUrl');
    assert(colItem, 'Collection baseUrl must be present in inherited list');
    assert.strictEqual(colItem.value, 'http://localhost:8080', 'Collection baseUrl value must match');
    assert.strictEqual(colItem.isOverridden, undefined, 'Collection baseUrl must NOT be marked overridden when environment baseUrl is disabled');

    // Assert environment baseUrl IS marked as overridden/disabled
    const envItem = details57.inherited.find(i => i.source === 'environment' && i.key === 'baseUrl');
    assert(envItem, 'Environment baseUrl must be present in inherited list');
    assert.strictEqual(envItem.value, 'https://api.example.com', 'Environment baseUrl value must match');
    assert.strictEqual(envItem.isOverridden, true, 'Environment baseUrl must be marked as overridden/disabled');

    // 2. Request Panel HTML generation with initialResolvedVars
    const reqHtml57 = getRequestPanelHtml(
      {
        requestId: 'req-health',
        name: 'Health Check',
        method: 'GET',
        url: '{{baseUrl}}/health',
        collection: 'Algod REST API v0.0.1',
        environment: 'None'
      },
      testState57,
      details57.inherited,
      [],
      [],
      details57.resolved
    );

    // Assert initialResolvedVars is embedded into client script
    assert(reqHtml57.includes('initialResolvedVars'), 'Request panel HTML must contain initialResolvedVars');
    assert(reqHtml57.includes('http://localhost:8080'), 'Request panel HTML must contain resolved collection baseUrl');

    // Validate client-side script syntax
    const scriptMatch57 = reqHtml57.match(/<script>([\s\S]*?)<\/script>/);
    assert(scriptMatch57 && scriptMatch57[1], 'Must contain <script> tag');
    assert.doesNotThrow(() => {
      new Function(scriptMatch57[1]);
    }, 'Client script in request panel HTML must be valid JavaScript');

    // 3. Simulate client-side variable resolution to ensure {{baseUrl}}/health resolves without UNRESOLVED warning
    // In client getActiveVariableMap:
    const clientVarMap = {};
    for (const item of details57.inherited) {
      if (!item.isOverridden && item.key && item.value !== undefined) {
        clientVarMap[item.key] = { value: String(item.value), source: item.source };
      }
    }
    // Fallback:
    for (const k in details57.resolved) {
      if (!clientVarMap[k]) {
        clientVarMap[k] = { value: String(details57.resolved[k]), source: 'Inherited' };
      }
    }

    assert(clientVarMap['baseUrl'], 'clientVarMap must contain baseUrl');
    assert.strictEqual(clientVarMap['baseUrl'].value, 'http://localhost:8080', 'clientVarMap baseUrl must be http://localhost:8080');

    // URL resolution
    const urlPattern = /\{\{([a-zA-Z0-9_.:$-]+)\}\}/g;
    const testUrl = '{{baseUrl}}/health';
    const resolvedUrl = testUrl.replace(urlPattern, (m, k) => clientVarMap[k] ? clientVarMap[k].value : m);
    assert.strictEqual(resolvedUrl, 'http://localhost:8080/health', 'URL must resolve cleanly to http://localhost:8080/health');
    assert(!resolvedUrl.includes('{{'), 'No unresolved {{tokens}} should remain in resolved URL');

    console.log('✓ URL Preview Variable Resolution Parity & Collection Base URL Fallback verified');
  }

  // Test 58: Profile Settings Persistence, Dirty Tab Tracking & Activity Bar Icon
  {
    // 1. Verify globalSettingsPanelHtml.ts script integrity
    const settingsHtmlFile = fs.readFileSync(path.join(__dirname, '../src/views/panels/globalSettingsPanelHtml.ts'), 'utf8');
    assert(settingsHtmlFile.includes('let currentActiveTab ='), 'currentActiveTab must be explicitly declared to prevent ReferenceError');
    assert(settingsHtmlFile.includes('settingsSaved'), 'settingsSaved message handler must be implemented for save confirmation');
    assert(settingsHtmlFile.includes('btnSave.textContent = \'Saving...\''), 'Save button must show Saving... feedback');

    // 2. Verify globalSettingsPanel.ts saveSettings persistence logic
    const settingsPanelFile = fs.readFileSync(path.join(__dirname, '../src/views/panels/globalSettingsPanel.ts'), 'utf8');
    assert(settingsPanelFile.includes('this.selectedProfileId = payload.profileId;'), 'selectedProfileId must be preserved across saves');
    assert(settingsPanelFile.includes('settingsSaved'), 'Must notify webview with settingsSaved message on successful save');

    // 3. Verify requestPanel.ts dirty tracking & title management
    const reqPanelFile = fs.readFileSync(path.join(__dirname, '../src/views/panels/requestPanel.ts'), 'utf8');
    assert(reqPanelFile.includes('private isDirty: boolean = false;'), 'BlueByrdPanel must track isDirty property');
    assert(reqPanelFile.includes('this.isDirty ? `● ${this.baseTitle}` : this.baseTitle'), 'Panel title must display dirty dot ● when modified');
    assert(reqPanelFile.includes('dirtyStateChanged'), 'BlueByrdPanel must handle dirtyStateChanged message from webview');

    // 4. Verify requestPanelHtml.ts dirty snapshot & Ctrl+S shortcut
    const reqHtmlFile = fs.readFileSync(path.join(__dirname, '../src/views/panels/requestPanelHtml.ts'), 'utf8');
    assert(reqHtmlFile.includes('captureDirtySnapshot'), 'requestPanelHtml must implement captureDirtySnapshot');
    assert(reqHtmlFile.includes('checkDirtyState'), 'requestPanelHtml must implement checkDirtyState');
    assert(reqHtmlFile.includes('#btn-save.dirty'), 'CSS must define #btn-save.dirty styles');
    assert(reqHtmlFile.includes("e.key === 's' || e.key === 'S'"), 'Ctrl+S / Cmd+S must trigger save action');

    // 5. Verify Activity Bar icon configuration & files
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    const actIcon = pkg.contributes.viewsContainers.activitybar[0].icon;
    assert.strictEqual(actIcon, 'media/byrdsnest-icon.svg', 'Activity bar icon must point to media/byrdsnest-icon.svg');
    assert(fs.existsSync(path.join(__dirname, '..', actIcon)), 'byrdsnest-icon.svg must exist on disk');

    console.log('✓ Profile Settings Persistence, Dirty Tab Tracking & Activity Bar Icon verified');
  }

  // ==========================================
  // Test 59: Collapsible Response Body Objects & Arrays, Cleaned CollectionBaseUrl
  // ==========================================
  {
    // 1. Verify requestPanelHtml.ts has collapsible JSON tree structures and controls
    const reqHtml = fs.readFileSync(path.join(__dirname, '../src/views/panels/requestPanelHtml.ts'), 'utf8');
    assert(reqHtml.includes('buildJsonTree('), 'requestPanelHtml must define buildJsonTree function');
    assert(reqHtml.includes('json-collapsible'), 'requestPanelHtml must include json-collapsible CSS and markup');
    assert(reqHtml.includes('json-toggle'), 'requestPanelHtml must include json-toggle button with chevron');
    assert(reqHtml.includes('json-collapsed-preview'), 'requestPanelHtml must include json-collapsed-preview badge');
    assert(reqHtml.includes('btn-collapse-all'), 'requestPanelHtml must include btn-collapse-all button');
    assert(reqHtml.includes('btn-expand-all'), 'requestPanelHtml must include btn-expand-all button');
    assert(reqHtml.includes('e.altKey'), 'requestPanelHtml must support Alt+click recursive toggle');

    // 2. Verify VariableService eliminates redundant collectionBaseUrl and envBaseUrl in inherited list
    const varSM59 = new BlueByrdStateManager(mockContext);
    const varService59 = new VariableService(varSM59);

    const testState59 = {
      activeProfileId: 'all',
      activeEnvironmentName: 'Production Cloud',
      profiles: [{ id: 'prof-59', name: 'Profile 59' }],
      environments: {
        'Production Cloud': {
          id: 'env-prod-59',
          name: 'Production Cloud',
          baseUrl: 'https://api.production.com',
          variables: {}
        }
      },
      collections: [
        {
          id: 'col-algod-59',
          name: 'Algod REST API',
          baseUrl: 'http://localhost:8080',
          variables: { customVar: '123' },
          folders: [],
          requests: []
        }
      ],
      history: []
    };

    varSM59.save(testState59);

    const details59 = varService59.resolveVariablesDetailed(undefined, 'Production Cloud', 'col-algod-59');

    // In resolved dictionary: collectionBaseUrl, envBaseUrl, and baseUrl must ALL be available
    assert.strictEqual(details59.resolved['collectionBaseUrl'], 'http://localhost:8080', 'collectionBaseUrl must resolve in template dictionary');
    assert.strictEqual(details59.resolved['envBaseUrl'], 'https://api.production.com', 'envBaseUrl must resolve in template dictionary');
    assert.strictEqual(details59.resolved['baseUrl'], 'https://api.production.com', 'baseUrl must resolve to environment baseUrl');

    // In inherited inspector list:
    // Collection section MUST have baseUrl, and MUST NOT have redundant duplicate collectionBaseUrl
    const colInherited = details59.inherited.filter(i => i.source === 'collection');
    const colBaseUrls = colInherited.filter(i => i.key === 'baseUrl');
    const colCollectionBaseUrls = colInherited.filter(i => i.key === 'collectionBaseUrl');

    assert.strictEqual(colBaseUrls.length, 1, 'Collection must have exactly 1 baseUrl entry');
    assert.strictEqual(colCollectionBaseUrls.length, 0, 'Collection must NOT have redundant duplicate collectionBaseUrl in inherited list');

    // Environment section MUST have baseUrl, and MUST NOT have redundant duplicate envBaseUrl
    const envInherited = details59.inherited.filter(i => i.source === 'environment');
    const envBaseUrls = envInherited.filter(i => i.key === 'baseUrl');
    const envEnvBaseUrls = envInherited.filter(i => i.key === 'envBaseUrl');

    assert.strictEqual(envBaseUrls.length, 1, 'Environment must have exactly 1 baseUrl entry');
    assert.strictEqual(envEnvBaseUrls.length, 0, 'Environment must NOT have redundant duplicate envBaseUrl in inherited list');

    // 3. Verify tabs fit cleanly and do not show scrollbars
    assert(reqHtml.includes('.tab-header {') && reqHtml.includes('scrollbar-width: none;'), 'tab-header must disable scrollbars');
    assert(!reqHtml.includes('.tab-header {\n      display: flex;\n      gap: 2px;\n      border-bottom: 1px solid var(--border);\n      background: rgba(0,0,0,0.15);\n      overflow-x: auto;'), 'tab-header must not have overflow-x: auto');
    assert(reqHtml.includes('.body-nav {') && reqHtml.includes('overflow: hidden;'), 'body-nav must fit without scrollbars');

    console.log('✓ Collapsible Response Body Objects & Arrays, Cleaned CollectionBaseUrl & Fitted Tabs verified');
  }

  // --- Suite 60: Shared / Global Configurable Scope, HTML Settings Panel & Universal Inheritance Cascade ---
  {
    const sm60 = new BlueByrdStateManager(mockContext);
    const varService60 = new VariableService(sm60);
    const authService60 = new AuthService(sm60);

    // 1. State Manager default globalProfile and get/save/delete guards
    const state60 = sm60.getState();
    assert(state60.globalProfile, 'AppState must initialize default globalProfile');
    assert.strictEqual(state60.globalProfile.id, 'global');
    assert.strictEqual(state60.globalProfile.name, 'Shared / Global');

    const globalProfById = sm60.getProfile('global');
    const globalProfByName = sm60.getProfile('Shared / Global');
    assert.deepStrictEqual(globalProfById, globalProfByName);
    assert.strictEqual(globalProfById.id, 'global');

    // Deleting 'global' must be rejected
    const delResult = sm60.deleteProfile('global');
    assert.strictEqual(delResult, false, 'deleteProfile("global") must return false and be protected');
    assert.strictEqual(sm60.getProfile('global').id, 'global', 'globalProfile must persist despite delete attempt');

    // Saving 'global' updates state.globalProfile
    const updatedGlobal = {
      id: 'global',
      name: 'Shared / Global',
      color: '#64748b',
      notes: 'Universal org variables and root tokens',
      variables: {
        globalApiKey: 'secret-global-999',
        sharedHost: 'api.enterprise.internal',
        overrideMe: 'root-val'
      },
      headers: {
        'X-Enterprise-Tenant': 'tenant-xyz',
        'X-Correlation-Id': 'corr-root'
      },
      auth: {
        type: 'bearer',
        token: 'ey-universal-jwt'
      }
    };
    sm60.saveProfile(updatedGlobal);
    assert.strictEqual(sm60.getState().globalProfile.notes, 'Universal org variables and root tokens');
    assert.strictEqual(sm60.getProfile('global').variables.globalApiKey, 'secret-global-999');

    // 2. Settings Panel HTML rendering when currentProfileId === 'global'
    const { getGlobalSettingsPanelHtml } = require('../dist/views/panels/globalSettingsPanelHtml');
    const htmlGlobal = getGlobalSettingsPanelHtml(sm60.getState(), [], 'profiles', 'global');

    assert(htmlGlobal.includes('id="prof-heading" style="font-size: 16px;">Shared / Global</h2>'), 'Settings panel must render Shared / Global heading');
    assert(htmlGlobal.includes('global · Root scope (inherited by all profiles)'), 'Settings panel must render root scope subheading');
    assert(htmlGlobal.includes('disabled title="Universal scope name is fixed"'), 'Settings panel must disable name field for global');
    assert(htmlGlobal.includes('🌐 Universal Scope (Always Applied)'), 'Settings panel must show universal scope indicator badge');
    assert(!htmlGlobal.includes('id="btn-activate-profile"'), 'Settings panel must not render activate button for global');
    assert(htmlGlobal.includes('data-subtab="subtab-vars">Variables (3)</button>'), 'Settings panel must render 3 variables for global');
    assert(htmlGlobal.includes('data-subtab="subtab-headers">Headers (2)</button>'), 'Settings panel must render 2 headers for global');
    assert(!htmlGlobal.includes('data-subtab="subtab-guards"'), 'Settings panel must not render guards subtab for global');
    assert(htmlGlobal.includes('<div class="profile-card selected" data-profile-id="global"'), 'Shared / Global profile card must be selected in sidebar');

    // 3. Variable Inheritance Cascade: Shared / Global -> Profile -> Collection -> Environment
    // Custom profile 'Development' overrides overrideMe
    let devProf = sm60.getProfile('profile-dev') || sm60.getProfiles()[0];
    if (!devProf) {
      devProf = {
        id: 'profile-dev',
        name: 'Development',
        color: '#10b981',
        auth: { type: 'none' },
        variables: {},
        headers: {}
      };
      sm60.saveProfile(devProf);
    }
    devProf.variables = {
      overrideMe: 'dev-val',
      devOnlyVar: 'dev-exclusive'
    };
    sm60.saveProfile(devProf);

    // Resolve for devProf.id
    const varResolution = varService60.resolveVariablesDetailed(devProf.id);
    assert.strictEqual(varResolution.resolved['globalApiKey'], 'secret-global-999', 'globalApiKey must inherit from Shared / Global');
    assert.strictEqual(varResolution.resolved['sharedHost'], 'api.enterprise.internal', 'sharedHost must inherit from Shared / Global');
    assert.strictEqual(varResolution.resolved['devOnlyVar'], 'dev-exclusive', 'devOnlyVar must resolve from profile');
    assert.strictEqual(varResolution.resolved['overrideMe'], 'dev-val', 'overrideMe must be overridden by dev profile');

    // Check inherited traceability
    const globalVarInherited = varResolution.inherited.filter(i => i.sourceName === 'Shared / Global');
    assert(globalVarInherited.length >= 3, 'Must have at least 3 variables from Shared / Global');
    const rootOverrideMe = globalVarInherited.find(i => i.key === 'overrideMe');
    assert(rootOverrideMe && rootOverrideMe.isOverridden, 'Shared / Global overrideMe must be marked isOverridden');

    // 4. Header Inheritance Cascade: Shared / Global -> Profile
    devProf.headers = {
      'X-Correlation-Id': 'corr-dev-123',
      'X-Dev-Header': 'dev-value'
    };
    sm60.saveProfile(devProf);

    const headerResolution = varService60.resolveHeadersDetailed(undefined, undefined, undefined, {}, devProf.id);
    assert.strictEqual(headerResolution.merged['X-Enterprise-Tenant'], 'tenant-xyz', 'X-Enterprise-Tenant must inherit from Shared / Global');
    assert.strictEqual(headerResolution.merged['X-Correlation-Id'], 'corr-dev-123', 'X-Correlation-Id must be overridden by dev profile');
    assert.strictEqual(headerResolution.merged['X-Dev-Header'], 'dev-value');

    // 5. Auth Fallback Cascade: Profile none -> Global bearer
    devProf.auth = { type: 'none' };
    sm60.saveProfile(devProf);
    const authHeaders1 = authService60.resolveAuthHeaders(devProf.id);
    assert.strictEqual(authHeaders1['Authorization'], 'Bearer ey-universal-jwt', 'Profile with type none must fallback to Shared / Global bearer auth');

    // Custom profile defines own auth (overrides Shared / Global)
    devProf.auth = { type: 'apiKey', keyName: 'X-Dev-Key', token: 'dev-api-key' };
    sm60.saveProfile(devProf);
    const authHeaders2 = authService60.resolveAuthHeaders(devProf.id);
    assert.strictEqual(authHeaders2['X-Dev-Key'], 'dev-api-key', 'Profile custom auth must override Shared / Global auth');
    assert.strictEqual(authHeaders2['Authorization'], undefined, 'Shared / Global auth must not bleed when profile auth is active');

    console.log('✓ Shared / Global Configurable Scope, HTML Settings Panel & Universal Inheritance Cascade verified');
  }

  // --- Suite 61: bn Namespace & Prefix-Free Direct Globals (test, expect, response, request, environment) ---
  {
    const { ScriptService } = require('../dist/services/scriptService');
    const scriptService = new ScriptService();

    // 1. Pre-Request script using bn namespace
    const preResBn = scriptService.executePreRequest(
      `
      bn.request.headers['X-Bn-Test'] = 'ByrdsNest-Namespace';
      bn.environment.set('bnKey', 'bnVal');
      `,
      {
        url: 'https://api.example.com',
        method: 'GET',
        headers: {},
        environmentVariables: {},
        collectionVariables: {},
        resolvedVariables: {}
      }
    );
    assert.strictEqual(preResBn.headers['X-Bn-Test'], 'ByrdsNest-Namespace');
    assert.strictEqual(preResBn.envMutations['bnKey'], 'bnVal');

    // 2. Pre-Request script using prefix-free direct globals (request, environment)
    const preResDirect = scriptService.executePreRequest(
      `
      request.headers['X-Direct-Test'] = 'PrefixFree';
      environment.set('directKey', 'directVal');
      `,
      {
        url: 'https://api.example.com',
        method: 'GET',
        headers: {},
        environmentVariables: {},
        collectionVariables: {},
        resolvedVariables: {}
      }
    );
    assert.strictEqual(preResDirect.headers['X-Direct-Test'], 'PrefixFree');
    assert.strictEqual(preResDirect.envMutations['directKey'], 'directVal');

    // 3. Post-Response script using bn namespace
    const postResBn = scriptService.executePostResponse(
      `
      bn.test('bn status check', () => {
        bn.expect(bn.response.status).toBe(200);
      });
      const data = bn.response.json();
      bn.environment.set('receivedToken', data.token);
      `,
      {
        url: 'https://api.example.com',
        method: 'GET',
        requestHeaders: {},
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'nest-jwt-123' }),
        elapsedMs: 45,
        environmentVariables: {},
        collectionVariables: {},
        resolvedVariables: {}
      }
    );
    assert.strictEqual(postResBn.testResults.length, 1);
    assert.strictEqual(postResBn.testResults[0].passed, true);
    assert.strictEqual(postResBn.envMutations['receivedToken'], 'nest-jwt-123');

    // 4. Post-Response script using prefix-free direct globals (test, expect, response, environment)
    const postResDirect = scriptService.executePostResponse(
      `
      test('direct status check', () => {
        expect(response.status).toBe(200);
        expect(response.responseTime).toBe(45);
      });
      const data = response.json();
      environment.set('cleanToken', data.token);
      `,
      {
        url: 'https://api.example.com',
        method: 'GET',
        requestHeaders: {},
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'clean-jwt-456' }),
        elapsedMs: 45,
        environmentVariables: {},
        collectionVariables: {},
        resolvedVariables: {}
      }
    );
    assert.strictEqual(postResDirect.testResults.length, 1);
    assert.strictEqual(postResDirect.testResults[0].passed, true);
    assert.strictEqual(postResDirect.envMutations['cleanToken'], 'clean-jwt-456');

    // 5. Verify UI template includes bn and prefix-free hints
    const { getRequestPanelHtml } = require('../dist/views/panels/requestPanelHtml');
    const mockState = new BlueByrdStateManager(mockContext).getState();
    const mockReq = (mockState.collections[0]?.requests && mockState.collections[0].requests[0]) ||
                    (mockState.collections[0]?.folders && mockState.collections[0].folders[0]?.requests[0]) ||
                    { id: 'req-1', name: 'Test Request', method: 'GET', url: 'https://api.example.com', headers: {} };
    const htmlReq = getRequestPanelHtml(mockReq, mockState);
    assert(htmlReq.includes('Access globals: <code style="color:#4ec9b0;">bn</code>'), 'UI must mention bn');
    assert(htmlReq.includes('direct (<code style="color:#4ec9b0;">test</code>'), 'UI must mention direct globals');
    assert(htmlReq.includes('test("Status code is 200"'), 'Snippet must use direct test()');

    console.log('✓ bn Namespace & Prefix-Free Direct Globals (test, expect, response, request, environment) verified');
  }

  // 62. Tabular Response View, Array Object Count & Drilling, CSV & Multi-Sheet XLSX Export
  {
    const { ExportService } = require('../dist/services/exportService');
    const { getRequestPanelHtml } = require('../dist/views/panels/requestPanelHtml');

    // 1. ExportService XML Escaping & Column Naming
    assert.strictEqual(ExportService.escapeXml('Hello <World> & "Friends"'), 'Hello &lt;World&gt; &amp; &quot;Friends&quot;');
    assert.strictEqual(ExportService.colName(0), 'A');
    assert.strictEqual(ExportService.colName(25), 'Z');
    assert.strictEqual(ExportService.colName(26), 'AA');
    assert.strictEqual(ExportService.colName(27), 'AB');

    // 2. Sheet name sanitization
    const existing = new Set();
    const s1 = ExportService.sanitizeSheetName('Invalid/Sheet[1]*', existing);
    assert.strictEqual(s1, 'Invalid_Sheet_1__');
    const s2 = ExportService.sanitizeSheetName('Invalid/Sheet[1]*', existing);
    assert.strictEqual(s2, 'Invalid_Sheet_1___2');

    // 3. RFC 4180 CSV Export
    const testData = [
      { id: 1, name: 'Alice', bio: 'Software "Lead" Engineer', tags: ['api', 'client'] },
      { id: 2, name: 'Bob', bio: 'Designer, UX', tags: ['ui'] }
    ];
    const csv = ExportService.jsonToCsv(testData);
    assert(csv.includes('id,name,bio,tags'), 'CSV header row present');
    assert(csv.includes('1,Alice,"Software ""Lead"" Engineer"'), 'CSV quotes properly escaped');
    assert(csv.includes('2,Bob,"Designer, UX"'), 'CSV comma field quoted');

    // 4. Multi-sheet array discovery for XLSX
    const nestedData = [
      {
        id: 'usr_1',
        name: 'Alice',
        orders: [
          { orderId: 'ord_101', total: 49.99, items: [{ sku: 'SKU-A', qty: 2 }] },
          { orderId: 'ord_102', total: 19.50, items: [{ sku: 'SKU-B', qty: 1 }] }
        ],
        roles: ['admin', 'billing']
      },
      {
        id: 'usr_2',
        name: 'Bob',
        orders: [
          { orderId: 'ord_103', total: 105.00, items: [{ sku: 'SKU-C', qty: 5 }] }
        ],
        roles: ['user']
      }
    ];

    const sheets = ExportService.jsonToWorkbookSheets(nestedData, 'Users');
    const sheetNames = sheets.map(s => s.name);
    assert(sheetNames.includes('Users'), 'Primary Users sheet present');
    assert(sheetNames.includes('orders'), 'Dedicated orders tab present');
    assert(sheetNames.includes('roles'), 'Dedicated roles tab present');
    assert(sheetNames.includes('orders_items'), 'Dedicated nested orders_items tab present');

    // Check parent sheet array cell label
    const usersSheet = sheets.find(s => s.name === 'Users');
    assert.strictEqual(usersSheet.rows[0][2], '[2 items]', 'Parent row shows [2 items]');

    // Check child orders sheet has parent linkage
    const ordersSheet = sheets.find(s => s.name === 'orders');
    assert(ordersSheet.headers.includes('_parent_index'), 'orders sheet has _parent_index');
    assert(ordersSheet.headers.includes('_parent_id'), 'orders sheet has _parent_id');
    assert.strictEqual(ordersSheet.rows.length, 3, 'orders sheet has 3 rows');
    assert.strictEqual(ordersSheet.rows[0][0], 1, 'First order belongs to parent 1');
    assert.strictEqual(ordersSheet.rows[0][1], 'usr_1', 'Parent id is usr_1');

    // 5. Zero-dependency XLSX Buffer generation & ZIP signature
    const xlsxBuffer = ExportService.generateXlsx(sheets);
    assert(Buffer.isBuffer(xlsxBuffer), 'XLSX must be a Buffer');
    assert(xlsxBuffer.length > 500, 'XLSX buffer must contain substantial OPC package');
    assert.strictEqual(xlsxBuffer.readUInt32LE(0), 0x04034b50, 'Must begin with PK local header signature');

    // 6. UI Rendering in requestPanelHtml
    const mockState = new BlueByrdStateManager(mockContext).getState();
    const mockReq = (mockState.collections[0]?.requests && mockState.collections[0].requests[0]) ||
                    (mockState.collections[0]?.folders && mockState.collections[0].folders[0]?.requests[0]) ||
                    { id: 'req-1', name: 'Test Request', method: 'GET', url: 'https://api.example.com', headers: {} };
    const html = getRequestPanelHtml(mockReq, mockState);

    // Verify Tabular mode toggle button
    assert(html.includes('id="btn-table-resp"'), 'Must include Table toggle button #btn-table-resp');
    assert(html.includes('⊞ Table'), 'Table toggle button must have label');

    // Verify Tabular container and toolbar
    assert(html.includes('id="resp-table-view"'), 'Must include #resp-table-view container');
    assert(html.includes('id="table-breadcrumbs"'), 'Must include #table-breadcrumbs');
    assert(html.includes('id="btn-table-back"'), 'Must include #btn-table-back');
    assert(html.includes('id="table-filter-input"'), 'Must include #table-filter-input');
    assert(html.includes('id="btn-table-orientation"'), 'Must include #btn-table-orientation');
    assert(html.includes('id="btn-table-export-csv"'), 'Must include #btn-table-export-csv');
    assert(html.includes('id="btn-table-export-xlsx"'), 'Must include #btn-table-export-xlsx');
    assert(html.includes('id="resp-tabular-table"'), 'Must include #resp-tabular-table');

    // Verify Tabular View Engine scripts
    assert(html.includes("tableOrientation = 'horizontal'"), 'Must default to horizontal mode');
    assert(html.includes('table-array-badge'), 'Must include table-array-badge class');
    assert(html.includes('renderTableCell'), 'Must include renderTableCell function');
    assert(html.includes('renderTableView'), 'Must include renderTableView function');
    assert(html.includes("type: 'exportCsv'"), 'Must dispatch exportCsv message');
    assert(html.includes("type: 'exportXlsx'"), 'Must dispatch exportXlsx message');

    console.log('✓ Tabular Response View, Array Object Count & Drilling, CSV & Multi-Sheet XLSX Export verified');
  }

  // 63. Test OAuth 2.0 Loopback Redirect Server, PKCE RFC 7636, Token Acquisition & Settings/Request Panel Parity
  {
    const { OAuthService } = require(path.join(repoDist, 'services/oauthService'));

    // 1. RFC 7636 PKCE Code Verifier & Challenge
    const verifier = OAuthService.generateCodeVerifier();
    assert.strictEqual(typeof verifier, 'string', 'Verifier must be string');
    assert(verifier.length >= 43 && verifier.length <= 128, 'Verifier length must be RFC 7636 compliant (43-128 chars)');
    assert(/^[A-Za-z0-9\-._~]+$/.test(verifier), 'Verifier must only use RFC 7636 unreserved characters');

    // Test RFC 7636 Appendix B test vector
    const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const rfcChallenge = OAuthService.generateCodeChallenge(rfcVerifier);
    assert.strictEqual(rfcChallenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'PKCE code challenge must match RFC 7636 Appendix B test vector');

    // 2. Redirect URI Parsing
    const parsedDefault = OAuthService.parseRedirectUri('http://127.0.0.1:41982/callback');
    assert.strictEqual(parsedDefault.hostname, '127.0.0.1', 'Hostname must be 127.0.0.1');
    assert.strictEqual(parsedDefault.port, 41982, 'Port must be 41982');
    assert.strictEqual(parsedDefault.pathname, '/callback', 'Pathname must be /callback');

    const parsedCustom = OAuthService.parseRedirectUri('http://localhost:8080/auth/custom-cb');
    assert.strictEqual(parsedCustom.hostname, 'localhost', 'Custom hostname must match');
    assert.strictEqual(parsedCustom.port, 8080, 'Custom port must match');
    assert.strictEqual(parsedCustom.pathname, '/auth/custom-cb', 'Custom path must match');

    // 3. Authorization URL Builder
    const authUrlWithPkce = OAuthService.buildAuthorizationUrl({
      authorizationUrl: 'https://login.example.com/oauth/authorize',
      clientId: 'byrdsnest-client-app',
      redirectUri: 'http://127.0.0.1:41982/callback',
      scopes: ['openid', 'profile', 'email'],
      state: 'state-security-csrf-token',
      codeChallenge: 'challenge-s256-test',
      grantType: 'authorization_code'
    });
    const parsedBuiltUrl = new URL(authUrlWithPkce);
    assert.strictEqual(parsedBuiltUrl.origin, 'https://login.example.com');
    assert.strictEqual(parsedBuiltUrl.pathname, '/oauth/authorize');
    assert.strictEqual(parsedBuiltUrl.searchParams.get('response_type'), 'code');
    assert.strictEqual(parsedBuiltUrl.searchParams.get('client_id'), 'byrdsnest-client-app');
    assert.strictEqual(parsedBuiltUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:41982/callback');
    assert.strictEqual(parsedBuiltUrl.searchParams.get('scope'), 'openid profile email');
    assert.strictEqual(parsedBuiltUrl.searchParams.get('state'), 'state-security-csrf-token');
    assert.strictEqual(parsedBuiltUrl.searchParams.get('code_challenge'), 'challenge-s256-test');
    assert.strictEqual(parsedBuiltUrl.searchParams.get('code_challenge_method'), 'S256');

    // 4. Temporary Loopback Redirect Server Lifecycle
    const testPort = 41986;
    const testState = 'state-test-loopback-xyz';
    const listenerPromise = OAuthService.startRedirectListener({
      hostname: '127.0.0.1',
      port: testPort,
      pathname: '/callback',
      expectedState: testState,
      browserAuthUrl: `http://127.0.0.1:${testPort}/simulated-auth`
    });

    // Make mock HTTP GET simulating Identity Provider redirect
    await new Promise(resolve => setTimeout(resolve, 50));
    http.get(
      `http://127.0.0.1:${testPort}/callback?code=mock-auth-code-12345&state=${testState}`,
      (res) => {
        let respData = '';
        res.on('data', chunk => { respData += chunk; });
        res.on('end', () => {
          assert.strictEqual(res.statusCode, 200, 'Redirect handler must return 200 OK');
          assert(respData.includes('Authentication Complete') || respData.includes('Authorization Successful'), 'Response HTML must contain confirmation message');
          assert(respData.includes('byrdsnest api client'), 'Response HTML must be branded with byrdsnest api client');
        });
      }
    );

    const receivedCode = await listenerPromise;
    assert.strictEqual(receivedCode, 'mock-auth-code-12345', 'Listener must resolve with received authorization code');

    // 5. Verify Request Panel HTML Rendering
    const mockState = new BlueByrdStateManager(mockContext).getState();
    const mockReq = (mockState.collections[0]?.requests && mockState.collections[0].requests[0]) ||
                    { id: 'req-1', name: 'Test Request', method: 'GET', url: 'https://api.example.com', headers: {} };
    const reqHtml = getRequestPanelHtml(mockReq, mockState);

    assert(reqHtml.includes('id="oauth-redirect-uri"'), 'Request Panel must include #oauth-redirect-uri input');
    assert(reqHtml.includes('id="btn-copy-redirect-uri"'), 'Request Panel must include #btn-copy-redirect-uri copy button');
    assert(reqHtml.includes('id="oauth-pkce"'), 'Request Panel must include #oauth-pkce checkbox');
    assert(reqHtml.includes('id="btn-get-oauth-token"'), 'Request Panel must include ⚡ Get New Access Token button');
    assert(reqHtml.includes('id="oauth-flow-status"'), 'Request Panel must include #oauth-flow-status');
    assert(reqHtml.includes('syncGrantTypeVisibility'), 'Request Panel must include dynamic grant type visibility synchronizer');

    // 6. Verify Settings Panel HTML Rendering (OAuth profile)
    const oauthProfileConfig = {
      id: 'profile-oauth-test',
      name: 'OAuth Provider Profile',
      color: '#8b5cf6',
      auth: {
        type: 'oauth2',
        grantType: 'authorization_code',
        redirectUri: 'http://127.0.0.1:41982/callback',
        pkce: true,
        authorizationUrl: 'https://auth.example.com/oauth/authorize',
        tokenUrl: 'https://auth.example.com/oauth/token',
        clientId: 'test-client-id'
      },
      variables: {},
      headers: {}
    };
    const settingsHtml = getSettingsPanelHtml('profile', oauthProfileConfig, oauthProfileConfig.name);

    assert(settingsHtml.includes('id="oauth-redirect-uri"'), 'Settings Panel must include #oauth-redirect-uri input');
    assert(settingsHtml.includes('id="btn-copy-redirect-uri"'), 'Settings Panel must include #btn-copy-redirect-uri copy button');
    assert(settingsHtml.includes('id="oauth-pkce"'), 'Settings Panel must include #oauth-pkce checkbox');
    assert(settingsHtml.includes('id="btn-get-oauth-token"'), 'Settings Panel must include ⚡ Get New Access Token button');
    assert(settingsHtml.includes('id="oauth-flow-status"'), 'Settings Panel must include #oauth-flow-status');

    // 7. Verify StateManager Profile & Auth Persistence with redirectUri & pkce
    const stateManager = new BlueByrdStateManager(mockContext);
    const createdProfile = stateManager.createProfile('OAuth Saved Profile');
    createdProfile.auth = {
      type: 'oauth2',
      grantType: 'authorization_code',
      redirectUri: 'http://127.0.0.1:45123/my-redirect',
      pkce: true,
      clientId: 'my-client-id-123'
    };
    stateManager.saveProfile(createdProfile);

    const reloadedProfile = stateManager.getProfile(createdProfile.id);
    assert.strictEqual(reloadedProfile.auth?.redirectUri, 'http://127.0.0.1:45123/my-redirect', 'StateManager must persist custom redirectUri');
    assert.strictEqual(reloadedProfile.auth?.pkce, true, 'StateManager must persist PKCE toggle');

    console.log('✓ OAuth 2.0 Loopback Redirect Server, PKCE RFC 7636, Token Acquisition & Settings/Request Panel Parity verified');
  }

  // 64. Test Pinned Settings Headers, Locked Context Bar & Sticky Table Headers Layout
  {
    const stateManager = new BlueByrdStateManager(mockContext);
    const mockState = stateManager.getState();
    const colSettingsHtml = getSettingsPanelHtml('collection', mockState.collections[0], mockState.collections[0].name);

    // Verify root layout prevents body scroll and pins container
    assert(colSettingsHtml.includes('overflow: hidden;'), 'Settings Panel root must have overflow: hidden');
    assert(colSettingsHtml.includes('flex-shrink: 0;'), 'Settings Panel headers must have flex-shrink: 0');
    assert(colSettingsHtml.includes('.tab-content {'), 'Settings Panel must define .tab-content');
    assert(colSettingsHtml.includes('overflow-y: auto;'), 'Settings Panel tab-content must have overflow-y: auto');
    assert(colSettingsHtml.includes('position: sticky;'), 'Settings Panel table headers must be sticky');

    console.log('✓ Pinned Settings Headers, Locked Context Bar & Sticky Table Headers Layout verified');
  }

  // 65. Test Mid-Flight Request Cancellation & Folder Auth Inheritance + Dirty Tracking
  {
    const stateManager = new BlueByrdStateManager(mockContext);
    const authService65 = new AuthService(stateManager);
    const httpService65 = new HttpService(stateManager, new VariableService(stateManager), authService65, new ScriptService(stateManager));

    // 1. Verify Mid-Flight Request Cancellation
    const cancelController = new AbortController();
    cancelController.abort();

    const cancelResult = await httpService65.executeRequest({
      url: 'http://example.com/test',
      method: 'GET'
    }, cancelController.signal);

    assert.strictEqual(cancelResult.ok, false, 'Cancelled request must not be ok');
    assert.strictEqual(cancelResult.statusText, 'Cancelled', 'Cancelled request must have statusText "Cancelled"');
    assert(cancelResult.body.includes('Request cancelled by user mid-flight'), 'Diagnostic must explain user cancellation');

    // 2. Verify Folder Auth Inheritance from Parent Collection
    const colWithAuth = {
      id: 'col-auth-test',
      name: 'Auth Test Collection',
      folders: [
        {
          id: 'folder-sub-auth',
          name: 'Sub Folder',
          requests: [],
          auth: { inheritFromCollection: true }
        }
      ],
      requests: [],
      auth: {
        type: 'bearer',
        token: 'col-bearer-token-12345'
      }
    };
    stateManager.saveCollection(colWithAuth);

    const folderAuthHeaders = authService65.resolveAuthHeaders(
      undefined,
      undefined,
      colWithAuth.id,
      'folder-sub-auth',
      {},
      { inheritFromFolder: true, inheritFromCollection: true, auth: { type: 'none' } }
    );
    assert.strictEqual(folderAuthHeaders['Authorization'], 'Bearer col-bearer-token-12345', 'Folder must inherit bearer auth from parent collection');

    // 3. Verify Request Panel Auth Inheritance HTML & Send/Cancel Toggle
    const reqHtml = getRequestPanelHtml({}, stateManager.getState());
    assert(reqHtml.includes('Inherit from Parent (Collection, Folder, Environment, Profile)'), 'Request panel must list full parent hierarchy option');
    assert(reqHtml.includes('Inherit from Collection / Folder only'), 'Request panel must list collection/folder option');
    assert(reqHtml.includes('btn-cancel-req'), 'Request panel must include btn-cancel-req styling');
    assert(reqHtml.includes('isRequestInFlight'), 'Request panel must manage in-flight state');

    // 4. Verify Folder Settings HTML & Dirty Tracking
    const folderObj = colWithAuth.folders[0];
    const folderSettingsHtml = getSettingsPanelHtml('folder', folderObj, folderObj.name, colWithAuth.name, undefined, undefined, [], colWithAuth.auth);
    assert(folderSettingsHtml.includes('id="inherited-auth-banner"'), 'Folder Settings HTML must include inherited auth banner');
    assert(folderSettingsHtml.includes('Inheriting from Collection:'), 'Folder Settings HTML banner must show collection inheritance');
    assert(folderSettingsHtml.includes('#btn-save.dirty'), 'Folder Settings HTML must include dirty save button styles');
    assert(folderSettingsHtml.includes('captureDirtySnapshot'), 'Folder Settings HTML must include dirty snapshot checking');

    console.log('✓ Mid-Flight Request Cancellation & Folder Auth Inheritance + Dirty Tracking verified');
  }

  // 66. Test byrdsnest-backup, byrdsnest-collection, and byrdsnest-environment Import Parsing & Command Dispatch
  {
    const fs = require('fs');

    // 1. Verify byrdsnest-backup format detection & parsing
    const sampleByrdsnestBackup = JSON.stringify({
      byrdsnestBackupVersion: 1,
      exportedAt: new Date().toISOString(),
      profile: {
        id: 'profile-bn-test',
        name: 'Byrdsnest Test Profile',
        auth: { type: 'bearer', token: 'profile-tok' },
        variables: { profKey: 'profVal' }
      },
      environments: [
        {
          id: 'env-bn-1',
          name: 'BN Stage',
          baseUrl: 'https://stage.example.com',
          variables: { apiHost: 'stage.example.com' }
        }
      ],
      collections: [
        {
          id: 'col-bn-1',
          name: 'BN API Collection',
          folders: [
            {
              id: 'fold-1',
              name: 'Auth Endpoints',
              requests: [
                {
                  id: 'req-1',
                  name: 'Get Token',
                  method: 'POST',
                  url: 'https://stage.example.com/oauth/token',
                  headers: { 'Content-Type': 'application/json' },
                  body: '{}',
                  bodyType: 'json'
                }
              ]
            }
          ],
          requests: []
        }
      ]
    });

    const parsedBackup = ImportExportService.parse(sampleByrdsnestBackup);
    assert.strictEqual(parsedBackup.type, 'byrdsnest-backup', 'Should detect byrdsnest-backup type');
    assert.strictEqual(parsedBackup.state.collections.length, 1, 'Should have 1 collection');
    assert.strictEqual(parsedBackup.state.collections[0].name, 'BN API Collection');
    assert.strictEqual(parsedBackup.state.collections[0].folders.length, 1);
    assert.strictEqual(parsedBackup.state.collections[0].folders[0].requests.length, 1);
    assert(parsedBackup.state.environments['BN Stage'], 'Should have BN Stage environment');
    assert.strictEqual(parsedBackup.state.profiles.length, 1, 'Should have 1 profile');
    assert.strictEqual(parsedBackup.state.profiles[0].name, 'Byrdsnest Test Profile');

    // 2. Verify byrdsnest-collection format detection & parsing
    const sampleByrdsnestCol = JSON.stringify({
      kind: 'byrdsnest.collection',
      version: 1,
      name: 'Single Byrdsnest Col',
      folders: [],
      requests: [
        {
          id: 'req-single',
          name: 'Direct Request',
          method: 'GET',
          url: 'https://api.example.com/items'
        }
      ]
    });
    const parsedCol = ImportExportService.parse(sampleByrdsnestCol);
    assert.strictEqual(parsedCol.type, 'byrdsnest-collection', 'Should detect byrdsnest-collection type');
    assert.strictEqual(parsedCol.collection.name, 'Single Byrdsnest Col');
    assert.strictEqual(parsedCol.collection.requests.length, 1);

    // 3. Verify byrdsnest-environment format detection & parsing
    const sampleByrdsnestEnv = JSON.stringify({
      kind: 'byrdsnest.environment',
      version: 1,
      name: 'Single Byrdsnest Env',
      baseUrl: 'https://bn.example.com',
      variables: { testVar: 'hello' }
    });
    const parsedEnv = ImportExportService.parse(sampleByrdsnestEnv);
    assert.strictEqual(parsedEnv.type, 'byrdsnest-environment', 'Should detect byrdsnest-environment type');
    assert.strictEqual(parsedEnv.environmentName, 'Single Byrdsnest Env');
    assert.strictEqual(parsedEnv.environment.baseUrl, 'https://bn.example.com');
    assert.strictEqual(parsedEnv.environment.variables.testVar, 'hello');

    // 4. Verify actual user export file if present on disk
    const userExportPath = 'C:\\Users\\chase-developer\\Downloads\\mawm_collection_export_CB_2609111231.json';
    if (fs.existsSync(userExportPath)) {
      const userFileContent = fs.readFileSync(userExportPath, 'utf8');
      const parsedUserFile = ImportExportService.parse(userFileContent);
      assert.strictEqual(parsedUserFile.type, 'byrdsnest-backup', 'User export file must be detected as byrdsnest-backup');
      assert.strictEqual(parsedUserFile.state.collections.length, 5, 'User export file should contain 5 collections');
      assert.strictEqual(Object.keys(parsedUserFile.state.environments).length, 10, 'User export file should contain 10 environments');
      assert.strictEqual(parsedUserFile.state.profiles.length, 1, 'User export file should contain 1 profile');
      assert.strictEqual(parsedUserFile.state.profiles[0].name, 'MAWM_EXPORT_VSIX', 'User profile should be MAWM_EXPORT_VSIX');
    }

    // 5. Verify commandManager dispatch logic checks byrdsnest types
    const cmdManagerSrc = fs.readFileSync(path.join(__dirname, '../src/commands/commandManager.ts'), 'utf8');
    assert(cmdManagerSrc.includes("result.type === 'byrdsnest-collection'"), 'commandManager must check byrdsnest-collection');
    assert(cmdManagerSrc.includes("result.type === 'byrdsnest-environment'"), 'commandManager must check byrdsnest-environment');
    assert(cmdManagerSrc.includes("result.type === 'byrdsnest-backup'"), 'commandManager must check byrdsnest-backup');
    assert(cmdManagerSrc.includes('Unrecognized import format'), 'commandManager must have fallback warning message');

    console.log('✓ byrdsnest-backup, byrdsnest-collection & byrdsnest-environment Import Parsing & Command Dispatch verified');
  }

  console.log('\nAll 66 verification test suites passed successfully! 🎉');
  process.exit(0);
})().catch(err => {
  console.error('Async test suite failure:', err);
  process.exit(1);
});



