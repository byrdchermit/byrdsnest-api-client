import { ProfileAuth, StoredToken } from '../../types';

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderAuthCss(): string {
  return `
    /* Shared Auth Styles */
    .auth-grid {
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 620px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .form-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
    }
    .form-control {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 13px;
      outline: none;
    }
    .form-control:focus { border-color: var(--primary); }

    .password-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .password-wrapper .form-control {
      width: 100%;
      padding-right: 36px;
    }
    .btn-toggle-mask {
      position: absolute;
      right: 6px;
      padding: 4px 6px;
      font-size: 13px;
      color: var(--muted);
      cursor: pointer;
      background: transparent;
      border: none;
      border-radius: 4px;
      line-height: 1;
    }
    .btn-toggle-mask:hover {
      color: var(--text);
      background: rgba(255,255,255,0.08);
    }

    .auth-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .help-hint {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.4;
    }

    /* Token Vault Picker & Provenance Styles */
    .token-vault-box {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .vault-badge {
      font-size: 10px;
      color: var(--muted);
      background: var(--badge-bg);
      padding: 2px 7px;
      border-radius: 10px;
      border: 1px solid var(--border);
      font-weight: 500;
    }
    .token-provenance-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-left: 3px solid var(--primary);
      border-radius: 4px;
      padding: 10px 12px;
      font-size: 11px;
      margin-top: 4px;
    }
    .provenance-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .provenance-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 6px;
      text-transform: uppercase;
    }
    .provenance-status {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .provenance-status.active {
      background: rgba(78, 201, 176, 0.15);
      color: #4ec9b0;
      border: 1px solid rgba(78, 201, 176, 0.3);
    }
    .provenance-status.expired {
      background: rgba(241, 76, 76, 0.15);
      color: #f14c4c;
      border: 1px solid rgba(241, 76, 76, 0.3);
    }
    .provenance-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 14px;
    }
    .prov-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .prov-label {
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.3px;
    }
    .prov-val {
      color: var(--text);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      overflow-wrap: break-word;
    }
    .vault-action-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 4px;
    }
    .btn-save-to-vault {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
      transition: all 0.15s ease;
      outline: none;
    }
    .btn-save-to-vault:hover {
      background: var(--primary);
      color: var(--primary-fg);
      border-color: var(--primary);
    }
  `;
}

function renderTokenPickerAndProvenance(
  pickerId: string,
  inputTargetId: string,
  currentTokenId?: string,
  tokens: StoredToken[] = []
): string {
  const selectedToken = tokens.find((t) => t.id === currentTokenId);
  const now = Date.now();

  const options = [
    `<option value="" ${!selectedToken ? 'selected' : ''}>— Enter token manually / custom —</option>`,
    ...tokens.map((t) => {
      const isSelected = t.id === currentTokenId;
      const isExpired = t.expiresAt > 0 && t.expiresAt < now;
      const originDesc = t.envName || t.profileName || 'Vault';
      const statusText = isExpired ? ' (Expired)' : '';
      const label = `${t.tokenName || t.tier || 'Token'} [${originDesc}]${statusText}`;
      return `<option value="${escapeHtml(t.id)}" data-token="${escapeHtml(t.accessToken)}" data-origin="${escapeHtml(t.envName || t.profileName || 'Vault')}" data-url="${escapeHtml(t.sourceUrl || '')}" data-client="${escapeHtml(t.clientId || '')}" data-created="${t.createdAt || 0}" data-expires="${t.expiresAt || 0}" data-scopes="${escapeHtml((t.scopes || []).join(' '))}" ${isSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }),
  ].join('\n');

  const provOrigin = selectedToken ? (selectedToken.envName || selectedToken.profileName || 'Vault') : '—';
  const provUrl = selectedToken?.sourceUrl || '—';
  const provClient = selectedToken?.clientId || '—';
  const provCreated = selectedToken?.createdAt ? new Date(selectedToken.createdAt).toLocaleString() : '—';
  const provExpires = selectedToken?.expiresAt
    ? selectedToken.expiresAt < now
      ? 'Expired'
      : `Expires in ${Math.round((selectedToken.expiresAt - now) / 60000)}m`
    : 'No Expiry / Static';
  const provScopes = selectedToken?.scopes?.length ? selectedToken.scopes.join(', ') : 'None';
  const isProvActive = selectedToken && (!selectedToken.expiresAt || selectedToken.expiresAt >= now);

  return `
    <div class="form-group token-vault-box">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
        <label class="form-label" for="${pickerId}">Select Existing Token (Vault)</label>
        <span class="vault-badge" id="${pickerId}-count">${tokens.length} in vault</span>
      </div>
      <select id="${pickerId}" class="form-control token-vault-select" data-target="${inputTargetId}">
        ${options}
      </select>

      <div id="${pickerId}-card" class="token-provenance-card" style="display: ${selectedToken ? 'flex' : 'none'};">
        <div class="provenance-header">
          <span class="provenance-title">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a2 2 0 0 1 2 2v2H6V3a2 2 0 0 1 2-2zm3 4V3a3 3 0 1 0-6 0v2H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1z"/></svg>
            TOKEN PROVENANCE
          </span>
          <span id="${pickerId}-status" class="provenance-status ${isProvActive ? 'active' : 'expired'}">
            ${isProvActive ? 'Active' : 'Expired'}
          </span>
        </div>
        <div class="provenance-grid">
          <div class="prov-item">
            <span class="prov-label">Origin / Source</span>
            <span id="${pickerId}-val-origin" class="prov-val">${escapeHtml(provOrigin)}</span>
          </div>
          <div class="prov-item">
            <span class="prov-label">Acquired From URL</span>
            <span id="${pickerId}-val-url" class="prov-val" style="word-break: break-all;">${escapeHtml(provUrl)}</span>
          </div>
          <div class="prov-item">
            <span class="prov-label">OAuth Client ID</span>
            <span id="${pickerId}-val-client" class="prov-val">${escapeHtml(provClient)}</span>
          </div>
          <div class="prov-item">
            <span class="prov-label">Acquired At</span>
            <span id="${pickerId}-val-created" class="prov-val">${escapeHtml(provCreated)}</span>
          </div>
          <div class="prov-item">
            <span class="prov-label">Expires</span>
            <span id="${pickerId}-val-expires" class="prov-val">${escapeHtml(provExpires)}</span>
          </div>
          <div class="prov-item">
            <span class="prov-label">Granted Scopes</span>
            <span id="${pickerId}-val-scopes" class="prov-val">${escapeHtml(provScopes)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderAuthFieldsHtml(
  auth?: ProfileAuth,
  targetDescription: string = 'this item',
  availableTokens: StoredToken[] = []
): string {
  const authType = auth?.type || 'none';
  const authToken = auth?.token || '';
  const authHeader = auth?.headerName || 'Authorization';
  const authKeyName = auth?.keyName || 'X-API-Key';
  const authPrefix = auth?.headerPrefix || (authType === 'bearer' || authType === 'oauth2' ? 'Bearer' : '');
  const authAddTo = auth?.addTo || 'header';
  const authClientId = auth?.clientId || '';
  const authClientSecret = auth?.clientSecret || '';
  const authAuthUrl = auth?.authorizationUrl || '';
  const authTokenUrl = auth?.tokenUrl || '';
  const authScopes = Array.isArray(auth?.scopes) ? auth.scopes.join(' ') : (auth?.scopes || '');
  const authGrantType = auth?.grantType || 'authorization_code';
  const authRedirectUri = auth?.redirectUri || 'http://127.0.0.1:41982/callback';
  const authPkce = auth?.pkce !== false;
  const authUsername = auth?.username || '';
  const authPassword = auth?.password || '';
  const selectedTokenId = auth?.selectedTokenId;

  return `
    <div class="auth-grid">
      <div class="form-group">
        <label class="form-label" for="auth-type">Authentication Type</label>
        <select id="auth-type" class="form-control">
          <option value="none" ${authType === 'none' ? 'selected' : ''}>None (No Auth)</option>
          <option value="bearer" ${authType === 'bearer' ? 'selected' : ''}>Bearer Token</option>
          <option value="apiKey" ${authType === 'apiKey' ? 'selected' : ''}>API Key</option>
          <option value="oauth2" ${authType === 'oauth2' ? 'selected' : ''}>OAuth 2.0</option>
          <option value="basic" ${authType === 'basic' ? 'selected' : ''}>Basic Auth</option>
        </select>
      </div>

      <!-- Section: None -->
      <div id="section-none" class="auth-section">
        <span class="help-hint">Does not send any authentication credentials with requests.</span>
      </div>

      <!-- Section: Bearer Token -->
      <div id="section-bearer" class="auth-section">
        ${renderTokenPickerAndProvenance('bearer-token-select', 'bearer-token', selectedTokenId, availableTokens)}

        <div class="form-group">
          <label class="form-label" for="bearer-token">Token</label>
          <div class="password-wrapper">
            <input
              id="bearer-token"
              class="form-control"
              type="password"
              value="${escapeHtml(authToken)}"
              placeholder="Enter bearer token"
            />
            <button type="button" class="btn-toggle-mask icon-btn" title="Toggle visibility">👁</button>
          </div>
          <div class="vault-action-row">
            <span class="help-hint">Enter custom bearer token or select one from the vault above.</span>
            <button type="button" class="btn-save-to-vault" data-input="bearer-token" title="Save this token into your profile vault for reuse">
              💾 Save to Vault
            </button>
          </div>
        </div>

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="bearer-prefix">Header Prefix</label>
            <input
              id="bearer-prefix"
              class="form-control"
              type="text"
              value="${escapeHtml(authPrefix || 'Bearer')}"
              placeholder="Bearer"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="bearer-header">Header Name</label>
            <input
              id="bearer-header"
              class="form-control"
              type="text"
              value="${escapeHtml(authHeader || 'Authorization')}"
              placeholder="Authorization"
            />
          </div>
        </div>
      </div>

      <!-- Section: API Key -->
      <div id="section-apikey" class="auth-section">
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="apikey-key">Key Name</label>
            <input
              id="apikey-key"
              class="form-control"
              type="text"
              value="${escapeHtml(authKeyName || 'X-API-Key')}"
              placeholder="e.g. X-API-Key"
            />
            <span class="help-hint">Header or query parameter name.</span>
          </div>
          <div class="form-group">
            <label class="form-label" for="apikey-add-to">Add To</label>
            <select id="apikey-add-to" class="form-control">
              <option value="header" ${authAddTo === 'header' ? 'selected' : ''}>Header</option>
              <option value="query" ${authAddTo === 'query' ? 'selected' : ''}>Query Params</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="apikey-value">Value</label>
          <div class="password-wrapper">
            <input
              id="apikey-value"
              class="form-control"
              type="password"
              value="${escapeHtml(authToken)}"
              placeholder="Enter API key"
            />
            <button type="button" class="btn-toggle-mask icon-btn" title="Toggle visibility">👁</button>
          </div>
        </div>
      </div>

      <!-- Section: OAuth 2.0 -->
      <div id="section-oauth2" class="auth-section">
        <div class="form-group">
          <label class="form-label" for="oauth-grant-type">Grant Type</label>
          <select id="oauth-grant-type" class="form-control">
            <option value="authorization_code" ${authGrantType === 'authorization_code' ? 'selected' : ''}>Authorization Code</option>
            <option value="client_credentials" ${authGrantType === 'client_credentials' ? 'selected' : ''}>Client Credentials</option>
            <option value="implicit" ${authGrantType === 'implicit' ? 'selected' : ''}>Implicit</option>
            <option value="password" ${authGrantType === 'password' ? 'selected' : ''}>Password Credentials</option>
          </select>
        </div>

        ${renderTokenPickerAndProvenance('oauth-token-select', 'oauth-token', selectedTokenId, availableTokens)}

        <div class="form-group">
          <label class="form-label" for="oauth-token">Access Token</label>
          <div class="password-wrapper">
            <input
              id="oauth-token"
              class="form-control"
              type="password"
              value="${escapeHtml(authToken)}"
              placeholder="Enter access token (e.g. ya29...)"
            />
            <button type="button" class="btn-toggle-mask icon-btn" title="Toggle visibility">👁</button>
          </div>
          <div class="vault-action-row">
            <span class="help-hint">Current Bearer access token used to authorize requests.</span>
            <button type="button" class="btn-save-to-vault" data-input="oauth-token" title="Save this token into your profile vault for reuse">
              💾 Save to Vault
            </button>
          </div>
        </div>

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="oauth-prefix">Header Prefix</label>
            <input
              id="oauth-prefix"
              class="form-control"
              type="text"
              value="${escapeHtml(authPrefix || 'Bearer')}"
              placeholder="Bearer"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="oauth-header">Header Name</label>
            <input
              id="oauth-header"
              class="form-control"
              type="text"
              value="${escapeHtml(authHeader || 'Authorization')}"
              placeholder="Authorization"
            />
          </div>
        </div>

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="oauth-client-id">Client ID</label>
            <input
              id="oauth-client-id"
              class="form-control"
              type="text"
              value="${escapeHtml(authClientId)}"
              placeholder="e.g. client_12345"
            />
          </div>
          <div class="form-group" id="oauth-client-secret-group">
            <label class="form-label" for="oauth-client-secret">Client Secret</label>
            <div class="password-wrapper">
              <input
                id="oauth-client-secret"
                class="form-control"
                type="password"
                value="${escapeHtml(authClientSecret)}"
                placeholder="Client secret"
              />
              <button type="button" class="btn-toggle-mask icon-btn" title="Toggle visibility">👁</button>
            </div>
          </div>
        </div>

        <div class="form-group" id="oauth-auth-url-group">
          <label class="form-label" for="oauth-auth-url">Authorization URL</label>
          <input
            id="oauth-auth-url"
            class="form-control"
            type="text"
            value="${escapeHtml(authAuthUrl)}"
            placeholder="https://example.com/oauth/authorize"
          />
        </div>

        <div class="form-group" id="oauth-token-url-group">
          <label class="form-label" for="oauth-token-url">Access Token URL</label>
          <input
            id="oauth-token-url"
            class="form-control"
            type="text"
            value="${escapeHtml(authTokenUrl)}"
            placeholder="https://example.com/oauth/token"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="oauth-scopes">Scope(s)</label>
          <input
            id="oauth-scopes"
            class="form-control"
            type="text"
            value="${escapeHtml(authScopes)}"
            placeholder="e.g. openid profile email"
          />
          <span class="help-hint">Space or comma separated OAuth 2.0 permission scopes.</span>
        </div>

        <div class="form-group" id="oauth-redirect-group">
          <label class="form-label" for="oauth-redirect-uri">Callback / Redirect URL</label>
          <div style="display: flex; gap: 6px;">
            <input
              id="oauth-redirect-uri"
              class="form-control"
              type="text"
              value="${escapeHtml(authRedirectUri)}"
              placeholder="http://127.0.0.1:41982/callback"
              style="flex: 1;"
            />
            <button type="button" id="btn-copy-redirect-uri" class="btn btn-secondary icon-btn" style="white-space: nowrap; font-size: 11px; padding: 4px 10px;" title="Copy Redirect URL to clipboard">📋 Copy</button>
          </div>
          <span class="help-hint">Register this redirect URL with your OAuth provider (e.g. Google, GitHub, Azure, Okta, Keycloak).</span>
        </div>

        <div class="form-group" id="oauth-pkce-group" style="display: flex; flex-direction: row; align-items: center; gap: 8px; margin-top: 4px;">
          <input type="checkbox" id="oauth-pkce" ${authPkce ? 'checked' : ''} style="cursor: pointer;" />
          <label for="oauth-pkce" style="font-size: 12px; color: var(--text); cursor: pointer; user-select: none;">
            Use PKCE (Proof Key for Code Exchange with SHA-256)
          </label>
        </div>

        <div style="margin: 12px 0 6px 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <button type="button" id="btn-get-oauth-token" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-weight: 600; cursor: pointer;">
            ⚡ Get New Access Token
          </button>
          <span id="oauth-flow-status" style="font-size: 12px; color: var(--muted); display: none;"></span>
        </div>
      </div>

      <!-- Section: Basic Auth -->
      <div id="section-basic" class="auth-section">
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="basic-username">Username</label>
            <input
              id="basic-username"
              class="form-control"
              type="text"
              value="${escapeHtml(authUsername)}"
              placeholder="Username"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="basic-password">Password</label>
            <div class="password-wrapper">
              <input
                id="basic-password"
                class="form-control"
                type="password"
                value="${escapeHtml(authPassword)}"
                placeholder="Password"
              />
              <button type="button" class="btn-toggle-mask icon-btn" title="Toggle visibility">👁</button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="basic-header">Header Name</label>
          <input
            id="basic-header"
            class="form-control"
            type="text"
            value="${escapeHtml(authHeader || 'Authorization')}"
            placeholder="Authorization"
          />
        </div>
      </div>
    </div>
  `;
}

export function getSharedAuthClientScript(): string {
  return `
    // --- Dynamic Auth Fields Toggle ---
    const authTypeSelect = document.getElementById('auth-type');
    const authSections = {
      none: document.getElementById('section-none'),
      bearer: document.getElementById('section-bearer'),
      apiKey: document.getElementById('section-apikey'),
      oauth2: document.getElementById('section-oauth2'),
      basic: document.getElementById('section-basic'),
    };

    function syncAuthVisibility() {
      if (!authTypeSelect) return;
      const type = authTypeSelect.value;
      Object.entries(authSections).forEach(([key, section]) => {
        if (section) {
          section.style.display = key === type ? 'flex' : 'none';
        }
      });
    }
    if (authTypeSelect) {
      authTypeSelect.addEventListener('change', syncAuthVisibility);
      syncAuthVisibility();
    }

    // --- Dynamic OAuth Grant Type Field Visibility ---
    const grantTypeSelect = document.getElementById('oauth-grant-type');
    function syncGrantTypeVisibility() {
      if (!grantTypeSelect) return;
      const gt = grantTypeSelect.value;
      const redirectGroup = document.getElementById('oauth-redirect-group');
      const pkceGroup = document.getElementById('oauth-pkce-group');
      const authUrlGroup = document.getElementById('oauth-auth-url-group') || document.getElementById('oauth-auth-url')?.closest?.('.form-group');
      const tokenUrlGroup = document.getElementById('oauth-token-url-group') || document.getElementById('oauth-token-url')?.closest?.('.form-group');
      const secretGroup = document.getElementById('oauth-client-secret-group') || document.getElementById('oauth-client-secret')?.closest?.('.form-group');

      if (redirectGroup) redirectGroup.style.display = (gt === 'authorization_code' || gt === 'implicit') ? 'flex' : 'none';
      if (pkceGroup) pkceGroup.style.display = (gt === 'authorization_code') ? 'flex' : 'none';
      if (authUrlGroup) authUrlGroup.style.display = (gt === 'authorization_code' || gt === 'implicit') ? 'flex' : 'none';
      if (tokenUrlGroup) tokenUrlGroup.style.display = (gt === 'implicit') ? 'none' : 'flex';
      if (secretGroup) secretGroup.style.display = (gt === 'implicit') ? 'none' : 'flex';
    }
    if (grantTypeSelect) {
      grantTypeSelect.addEventListener('change', syncGrantTypeVisibility);
      syncGrantTypeVisibility();
    }

    // --- Copy Callback URL ---
    const btnCopyRedirect = document.getElementById('btn-copy-redirect-uri');
    if (btnCopyRedirect) {
      btnCopyRedirect.addEventListener('click', () => {
        const uriInput = document.getElementById('oauth-redirect-uri');
        if (uriInput) {
          navigator.clipboard.writeText(uriInput.value);
          btnCopyRedirect.textContent = 'Copied!';
          setTimeout(() => { btnCopyRedirect.textContent = '📋 Copy'; }, 1500);
        }
      });
    }

    // --- Get New Access Token Button ---
    const btnGetOAuthToken = document.getElementById('btn-get-oauth-token');
    const oauthStatus = document.getElementById('oauth-flow-status');
    if (btnGetOAuthToken) {
      btnGetOAuthToken.addEventListener('click', () => {
        const grantType = document.getElementById('oauth-grant-type')?.value || 'authorization_code';
        const clientId = (document.getElementById('oauth-client-id')?.value || '').trim();
        const clientSecret = (document.getElementById('oauth-client-secret')?.value || '').trim();
        const authUrl = (document.getElementById('oauth-auth-url')?.value || '').trim();
        const tokenUrl = (document.getElementById('oauth-token-url')?.value || '').trim();
        const redirectUri = (document.getElementById('oauth-redirect-uri')?.value || 'http://127.0.0.1:41982/callback').trim();
        const scopes = (document.getElementById('oauth-scopes')?.value || '').trim();
        const pkce = document.getElementById('oauth-pkce')?.checked ?? true;
        const username = (document.getElementById('basic-username')?.value || '').trim();
        const password = (document.getElementById('basic-password')?.value || '').trim();

        if (grantType === 'authorization_code' || grantType === 'implicit') {
          if (!authUrl) {
            alert('Please specify an Authorization URL.');
            document.getElementById('oauth-auth-url')?.focus();
            return;
          }
        }
        if (grantType !== 'implicit') {
          if (!tokenUrl) {
            alert('Please specify an Access Token URL.');
            document.getElementById('oauth-token-url')?.focus();
            return;
          }
        }
        if (!clientId && grantType !== 'password') {
          alert('Please enter a Client ID.');
          document.getElementById('oauth-client-id')?.focus();
          return;
        }

        btnGetOAuthToken.disabled = true;
        if (oauthStatus) {
          oauthStatus.textContent = grantType === 'authorization_code'
            ? 'Waiting for browser authorization...'
            : 'Fetching access token...';
          oauthStatus.style.color = 'var(--muted)';
          oauthStatus.style.display = 'inline-block';
        }

        vscode.postMessage({
          type: 'getOAuthToken',
          payload: {
            grantType,
            clientId,
            clientSecret,
            authorizationUrl: authUrl,
            tokenUrl,
            redirectUri,
            scopes,
            pkce,
            username,
            password,
          }
        });
      });
    }

    // --- Password Peek Toggles ---
    document.querySelectorAll('.btn-toggle-mask').forEach(btn => {
      btn.addEventListener('click', () => {
        const wrapper = btn.closest('.password-wrapper');
        const input = wrapper ? wrapper.querySelector('input') : null;
        if (input) {
          input.type = input.type === 'password' ? 'text' : 'password';
        }
      });
    });

    // --- Token Vault Selection & Provenance Synchronizer ---
    function formatTimeRemaining(expiresMs) {
      if (!expiresMs || expiresMs <= 0) return 'No Expiry';
      const diff = expiresMs - Date.now();
      if (diff <= 0) return 'Expired';
      const mins = Math.floor(diff / 60000);
      if (mins < 60) return 'in ' + mins + 'm';
      const hours = Math.floor(mins / 60);
      if (hours < 24) return 'in ' + hours + 'h ' + (mins % 60) + 'm';
      const days = Math.floor(hours / 24);
      return 'in ' + days + 'd';
    }

    function syncTokenVaultPicker(sel) {
      if (!sel) return;
      const targetId = sel.dataset.target;
      const input = document.getElementById(targetId);
      const card = document.getElementById(sel.id + '-card');
      const opt = sel.options[sel.selectedIndex];

      if (opt && opt.value) {
        if (input) {
          input.value = opt.dataset.token || '';
        }
        if (card) {
          const originEl = document.getElementById(sel.id + '-val-origin');
          const urlEl = document.getElementById(sel.id + '-val-url');
          const clientEl = document.getElementById(sel.id + '-val-client');
          const createdEl = document.getElementById(sel.id + '-val-created');
          const expiresEl = document.getElementById(sel.id + '-val-expires');
          const scopesEl = document.getElementById(sel.id + '-val-scopes');
          const statusEl = document.getElementById(sel.id + '-status');

          if (originEl) originEl.textContent = opt.dataset.origin || 'Vault';
          if (urlEl) urlEl.textContent = opt.dataset.url || '—';
          if (clientEl) clientEl.textContent = opt.dataset.client || '—';
          const createdMs = parseInt(opt.dataset.created || '0', 10);
          if (createdEl) createdEl.textContent = createdMs > 0 ? new Date(createdMs).toLocaleString() : '—';
          const expiresMs = parseInt(opt.dataset.expires || '0', 10);
          const isExpired = expiresMs > 0 && expiresMs < Date.now();
          if (expiresEl) expiresEl.textContent = expiresMs > 0 ? (isExpired ? 'Expired' : 'Active (' + formatTimeRemaining(expiresMs) + ')') : 'No Expiry / Static';
          if (scopesEl) scopesEl.textContent = opt.dataset.scopes || 'None';

          if (statusEl) {
            statusEl.textContent = isExpired ? 'Expired' : 'Active';
            statusEl.className = 'provenance-status ' + (isExpired ? 'expired' : 'active');
          }
          card.style.display = 'flex';
        }
      } else {
        if (card) {
          card.style.display = 'none';
        }
      }
    }

    document.querySelectorAll('.token-vault-select').forEach(sel => {
      sel.addEventListener('change', () => syncTokenVaultPicker(sel));
    });

    // Reset picker when user manually edits token input
    ['bearer-token', 'oauth-token'].forEach(inputId => {
      const input = document.getElementById(inputId);
      if (input) {
        input.addEventListener('input', () => {
          const picker = document.querySelector('.token-vault-select[data-target="' + inputId + '"]');
          if (picker) {
            const opt = picker.options[picker.selectedIndex];
            if (opt && opt.dataset.token !== input.value) {
              picker.value = '';
              const card = document.getElementById(picker.id + '-card');
              if (card) card.style.display = 'none';
            }
          }
        });
      }
    });

    // Save to Vault buttons
    document.querySelectorAll('.btn-save-to-vault').forEach(btn => {
      btn.addEventListener('click', () => {
        const inputId = btn.dataset.input;
        const input = document.getElementById(inputId);
        const tokenVal = input ? input.value.trim() : '';
        if (!tokenVal) {
          alert('Please enter a token value before saving to vault.');
          return;
        }

        const nameInput = document.getElementById('item-name') || document.getElementById('crumb-request-name');
        const defaultName = (nameInput ? nameInput.value.trim() : 'Manual') + ' Token';
        const tokenName = prompt('Enter a label for this token in your vault:', defaultName);
        if (tokenName !== null && tokenName.trim()) {
          const tokenUrl = document.getElementById('oauth-token-url')?.value || '';
          const clientId = document.getElementById('oauth-client-id')?.value || '';
          const envSelect = document.getElementById('environment-select');
          const envName = envSelect ? envSelect.value : '';

          if (typeof vscode !== 'undefined') {
            vscode.postMessage({
              type: 'saveTokenToVault',
              payload: {
                token: tokenVal,
                name: tokenName.trim(),
                sourceUrl: tokenUrl,
                clientId: clientId,
                envName: envName,
              }
            });
          }
        }
      });
    });

    // Live update token options when tokens are added or updated in vault
    function updateAllTokenSelects(tokens, selectedId) {
      if (!Array.isArray(tokens)) return;
      document.querySelectorAll('.token-vault-select').forEach(sel => {
        const targetId = sel.dataset.target;
        const currentVal = selectedId || sel.value;
        const now = Date.now();

        let html = '<option value="">— Enter token manually / custom —</option>';
        tokens.forEach(t => {
          const isSelected = t.id === currentVal;
          const isExpired = t.expiresAt > 0 && t.expiresAt < now;
          const originDesc = t.envName || t.profileName || 'Vault';
          const statusText = isExpired ? ' (Expired)' : '';
          const label = (t.tokenName || t.tier || 'Token') + ' [' + originDesc + ']' + statusText;
          html += '<option value="' + (t.id || '') + '" data-token="' + (t.accessToken || '') + '" data-origin="' + originDesc + '" data-url="' + (t.sourceUrl || '') + '" data-client="' + (t.clientId || '') + '" data-created="' + (t.createdAt || 0) + '" data-expires="' + (t.expiresAt || 0) + '" data-scopes="' + ((t.scopes || []).join(' ')) + '" ' + (isSelected ? 'selected' : '') + '>' + label + '</option>';
        });
        sel.innerHTML = html;

        const countBadge = document.getElementById(sel.id + '-count');
        if (countBadge) countBadge.textContent = tokens.length + ' in vault';

        syncTokenVaultPicker(sel);
      });
    }

    window.addEventListener('message', event => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'tokensUpdated') {
        updateAllTokenSelects(data.tokens, data.selectedId);
      } else if (data.type === 'oauthTokenAcquired') {
        const btnGet = document.getElementById('btn-get-oauth-token');
        if (btnGet) btnGet.disabled = false;
        const statusEl = document.getElementById('oauth-flow-status');
        if (statusEl) {
          statusEl.textContent = '✓ Token acquired & saved to vault!';
          statusEl.style.color = 'var(--success, #4ec9b0)';
          statusEl.style.display = 'inline-block';
          setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 6000);
        }
        const tokenInput = document.getElementById('oauth-token');
        if (tokenInput) {
          tokenInput.value = data.token || '';
          tokenInput.dispatchEvent(new Event('input', { bubbles: true }));
          tokenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (data.tokens) {
          updateAllTokenSelects(data.tokens, data.tokenId);
        }
      } else if (data.type === 'oauthTokenError') {
        const btnGet = document.getElementById('btn-get-oauth-token');
        if (btnGet) btnGet.disabled = false;
        const statusEl = document.getElementById('oauth-flow-status');
        if (statusEl) {
          statusEl.textContent = '✕ ' + (data.error || 'Failed to acquire token');
          statusEl.style.color = 'var(--danger, #f14c4c)';
          statusEl.style.display = 'inline-block';
        }
      }
    });

    // Helper to extract full auth values from DOM
    function extractAuthValues() {
      if (!authTypeSelect) return { type: 'none' };
      const authType = authTypeSelect.value;

      let token = '';
      let headerName = 'Authorization';
      let keyName = undefined;
      let headerPrefix = undefined;
      let addTo = undefined;
      let clientId = undefined;
      let clientSecret = undefined;
      let authorizationUrl = undefined;
      let tokenUrl = undefined;
      let redirectUri = undefined;
      let pkce = undefined;
      let scopes = undefined;
      let grantType = undefined;
      let username = undefined;
      let password = undefined;
      let selectedTokenId = undefined;

      if (authType === 'bearer') {
        token = (document.getElementById('bearer-token')?.value || '').trim();
        headerPrefix = (document.getElementById('bearer-prefix')?.value || '').trim() || 'Bearer';
        headerName = (document.getElementById('bearer-header')?.value || '').trim() || 'Authorization';
        selectedTokenId = document.getElementById('bearer-token-select')?.value || undefined;
      } else if (authType === 'apiKey') {
        keyName = (document.getElementById('apikey-key')?.value || '').trim() || 'X-API-Key';
        token = (document.getElementById('apikey-value')?.value || '').trim();
        headerName = keyName;
        addTo = document.getElementById('apikey-add-to')?.value || 'header';
      } else if (authType === 'oauth2') {
        grantType = document.getElementById('oauth-grant-type')?.value || 'authorization_code';
        token = (document.getElementById('oauth-token')?.value || '').trim();
        headerPrefix = (document.getElementById('oauth-prefix')?.value || '').trim() || 'Bearer';
        headerName = (document.getElementById('oauth-header')?.value || '').trim() || 'Authorization';
        clientId = (document.getElementById('oauth-client-id')?.value || '').trim();
        clientSecret = (document.getElementById('oauth-client-secret')?.value || '').trim();
        authorizationUrl = (document.getElementById('oauth-auth-url')?.value || '').trim();
        tokenUrl = (document.getElementById('oauth-token-url')?.value || '').trim();
        redirectUri = (document.getElementById('oauth-redirect-uri')?.value || 'http://127.0.0.1:41982/callback').trim();
        pkce = document.getElementById('oauth-pkce')?.checked ?? true;
        const scopesRaw = (document.getElementById('oauth-scopes')?.value || '').trim();
        scopes = scopesRaw ? scopesRaw.split(/[\\s,]+/).filter(Boolean) : [];
        selectedTokenId = document.getElementById('oauth-token-select')?.value || undefined;
      } else if (authType === 'basic') {
        username = (document.getElementById('basic-username')?.value || '').trim();
        password = (document.getElementById('basic-password')?.value || '').trim();
        headerName = (document.getElementById('basic-header')?.value || '').trim() || 'Authorization';
      }

      return {
        type: authType,
        token,
        headerName,
        keyName,
        headerPrefix,
        addTo,
        clientId,
        clientSecret,
        authorizationUrl,
        tokenUrl,
        redirectUri,
        pkce,
        scopes,
        grantType,
        username,
        password,
        selectedTokenId,
      };
    }
  `;
}
