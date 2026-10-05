import { Collection, CollectionFolder, DEFAULT_PROFILE_COLORS, EnvironmentConfig, Profile, StoredToken } from '../../types';
import { renderAuthCss, renderAuthFieldsHtml, getSharedAuthClientScript } from './sharedAuthHtml';

export function getSettingsPanelHtml(
  target: 'profile' | 'environment' | 'collection' | 'folder',
  item: Profile | EnvironmentConfig | Collection | CollectionFolder | undefined,
  displayName: string,
  collectionName?: string,
  allEnvironments?: Array<{ id: string; name: string; baseUrl?: string; inheritsFrom?: string }>,
  allProfiles?: Array<{ id: string; name: string }>,
  availableTokens: StoredToken[] = []
): string {
  const isProfile = target === 'profile';
  const isEnv = target === 'environment';
  const isCol = target === 'collection';
  const isFolder = target === 'folder';

  const profile = isProfile ? (item as Profile) : undefined;
  const env = isEnv ? (item as EnvironmentConfig) : undefined;
  const col = isCol ? (item as Collection) : undefined;
  const folder = isFolder ? (item as CollectionFolder) : undefined;
  const profColor = profile?.color || (item as any)?.color || '#3b82f6';

  const parentEnv = (allEnvironments || []).find(e => e.id === item?.inheritsFrom || e.name === item?.inheritsFrom);
  const parentBaseUrl = parentEnv?.baseUrl || '';

  const getAuth = (): any => {
    if (isProfile) return profile?.auth;
    if (isEnv) return env?.auth;
    if (isCol) return (col?.auth as any)?.auth || (col?.auth as any);
    if (isFolder) return (folder?.auth as any)?.auth || (folder?.auth as any);
    return undefined;
  };
  const auth = getAuth();

  const isInherited = isCol
    ? (col?.auth?.inheritFromProfile !== false && col?.auth?.inheritFromEnvironment !== false)
    : isFolder
    ? (folder?.auth?.inheritFromProfile !== false && folder?.auth?.inheritFromCollection !== false)
    : false;

  const normalizedVariables: Record<string, string> = {};
  if (Array.isArray(item?.variables)) {
    item.variables.forEach((v: any) => {
      if (v && typeof v === 'object') {
        const key = v.name || v.key;
        if (key) normalizedVariables[key] = String(v.value ?? '');
      }
    });
  } else if (item?.variables && typeof item.variables === 'object') {
    Object.entries(item.variables).forEach(([k, v]) => {
      normalizedVariables[k] = v != null ? String(v) : '';
    });
  }

  const normalizedHeaders: Record<string, string> = {};
  if (item?.headers && typeof item.headers === 'object') {
    Object.entries(item.headers).forEach(([k, v]) => {
      if (k) normalizedHeaders[k] = v != null ? String(v) : '';
    });
  }

  const notes = item?.notes || '';

  const escapeHtml = (str: string | undefined | null): string => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const variablesJson = JSON.stringify(normalizedVariables).replace(/</g, '\\u003c');
  const headersJson = JSON.stringify(normalizedHeaders).replace(/</g, '\\u003c');
  const targetLabel = target.toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(displayName)} Settings</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --panel: var(--vscode-sideBar-background, #252526);
      --surface: var(--vscode-input-background, #2d2d2d);
      --border: var(--vscode-panel-border, var(--vscode-input-border, #3c3c3c));
      --text: var(--vscode-editor-foreground, #cccccc);
      --muted: var(--vscode-descriptionForeground, #8c8c8c);
      --primary: ${isProfile && profColor ? profColor : 'var(--vscode-button-background, #0e639c)'};
      --primary-hover: var(--vscode-button-hoverBackground, #1177bb);
      --primary-fg: var(--vscode-button-foreground, #ffffff);
      --success: var(--vscode-testing-iconPassed, #4ec9b0);
      --danger: var(--vscode-testing-iconFailed, #f14c4c);
      --badge-bg: var(--vscode-badge-background, rgba(255,255,255,0.08));
      --badge-fg: var(--vscode-badge-foreground, var(--text));
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
    }
    body {
      padding: 14px;
    }

    .container {
      width: 100%;
      max-width: 100%;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: calc(100vh - 28px);
    }

    /* Top Context & Action Bar */
    .context-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
    }
    .context-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 260px;
    }
    .scope-pill {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      border: 1px solid var(--border);
    }
    .scope-profile { background: rgba(79, 193, 255, 0.15); color: #4fc1ff; }
    .scope-environment { background: rgba(206, 145, 120, 0.15); color: #ce9178; }
    .scope-collection { background: rgba(78, 201, 176, 0.15); color: #4ec9b0; }
    .scope-folder { background: rgba(220, 220, 170, 0.15); color: #dcdcaa; }

    .name-input {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 14px;
      font-weight: 600;
      outline: none;
      flex: 1;
      max-width: 320px;
      transition: border-color 0.15s ease;
    }
    .name-input:focus { border-color: var(--primary); }

    .context-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 7px 14px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      outline: none;
      user-select: none;
      transition: background 0.15s ease, filter 0.15s ease;
    }
    .btn-primary {
      background: var(--primary);
      color: var(--primary-fg);
    }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-secondary {
      background: var(--surface);
      border-color: var(--border);
      color: var(--text);
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.08); }

    input[type="checkbox"] {
      accent-color: var(--primary);
      cursor: pointer;
      width: 14px;
      height: 14px;
    }

    /* Environment Configuration Banner */
    .env-url-banner {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .env-url-banner label {
      font-weight: 600;
      font-size: 12px;
      color: var(--text);
    }
    .env-url-input {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 13px;
      font-family: var(--vscode-editor-font-family, monospace);
      outline: none;
      width: 100%;
      transition: border-color 0.15s ease;
    }
    .env-url-input:focus { border-color: var(--primary); }
    .help-hint {
      font-size: 11px;
      color: var(--muted);
    }

    /* Tabbed Workspace */
    .panel-box {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 400px;
    }
    .tab-header {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.15);
      padding: 0 8px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      margin-bottom: -1px;
      color: var(--muted);
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.03);
    }
    .tab-btn.active {
      color: var(--text);
      font-weight: 600;
      border-bottom-color: var(--primary);
      background: rgba(255, 255, 255, 0.05);
    }
    .tab-badge {
      font-size: 10px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 1px 6px;
      border-radius: 10px;
    }

    .tab-content {
      display: none;
      padding: 16px;
      flex: 1;
      overflow-y: auto;
    }
    .tab-content.active {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Table Rows */
    .table-header-row {
      display: grid;
      grid-template-columns: 32px 1.2fr 1.8fr 70px 36px;
      gap: 8px;
      padding: 0 4px 6px 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
    }
    .param-row {
      display: grid;
      grid-template-columns: 32px 1.2fr 1.8fr 70px 36px;
      gap: 8px;
      align-items: center;
      margin-bottom: 6px;
    }
    .param-row.header-row {
      grid-template-columns: 32px 1.5fr 2.5fr 36px;
    }
    .param-input {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      outline: none;
    }
    .param-input:focus { border-color: var(--primary); }
    .icon-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      font-size: 13px;
      line-height: 1;
    }
    .icon-btn:hover {
      color: var(--danger);
      background: rgba(241, 76, 76, 0.15);
    }

    ${renderAuthCss()}

    /* Notes Textarea */
    .notes-box {
      width: 100%;
      min-height: 240px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 4px;
      padding: 10px 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
      line-height: 1.5;
      resize: vertical;
      outline: none;
    }
    .notes-box:focus { border-color: var(--primary); }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Context Bar -->
    <header class="context-bar">
      <div class="context-left">
        <span class="scope-pill scope-${target}">${targetLabel}</span>
        ${collectionName ? `<span style="color: var(--muted); font-size: 12px;">${escapeHtml(collectionName)} ›</span>` : ''}
        <input
          id="item-name"
          class="name-input"
          type="text"
          value="${escapeHtml(displayName)}"
          placeholder="Name"
          title="Rename ${targetLabel}"
        />
      </div>
      <div class="context-actions">
        <button id="btn-cancel" class="btn btn-secondary">Cancel</button>
        <button id="btn-save" class="btn btn-primary">Save Changes</button>
      </div>
    </header>

    ${isProfile ? `
    <!-- Profile Color Theme Banner -->
    <div class="env-url-banner">
      <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 280px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label style="margin-bottom: 0;">Profile Color Theme</label>
            <span id="prof-theme-preview" class="pill" style="background: ${escapeHtml(profColor)}22; color: ${escapeHtml(profColor)}; border: 1px solid ${escapeHtml(profColor)}55; font-size: 11px; font-weight: 600;">
              ● ${escapeHtml(displayName)}
            </span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${DEFAULT_PROFILE_COLORS.map(c => {
              const isSelected = profColor.toLowerCase() === c.value.toLowerCase();
              return `<button type="button" class="color-swatch-btn ${isSelected ? 'active' : ''}" data-color="${c.value}" title="${c.name} (${c.value})" style="width: 24px; height: 24px; border-radius: 50%; background: ${c.value}; border: 2px solid ${isSelected ? 'var(--text, #ffffff)' : 'transparent'}; cursor: pointer; transition: transform 0.15s, border-color 0.15s; outline: none; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transform: ${isSelected ? 'scale(1.15)' : 'scale(1)'};"></button>`;
            }).join('')}
            <div style="display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.04); border: 1px solid var(--border);">
              <input type="color" id="prof-color-picker" value="${escapeHtml(profColor)}" style="width: 22px; height: 22px; padding: 0; border: none; background: transparent; cursor: pointer; border-radius: 3px;" />
              <input type="text" id="prof-color-input" class="env-url-input" value="${escapeHtml(profColor)}" style="width: 78px; padding: 2px 6px; font-family: monospace; font-size: 11px; height: 22px;" placeholder="#3b82f6" />
            </div>
          </div>
          <span class="help-hint" style="margin-top: 4px;">Tints the status bar, sidebar indicators, request header badges, and webview accents when this profile is active.</span>
        </div>
      </div>
    </div>
    ` : ''}

    ${isEnv ? `
    <!-- Environment Base URL, Parent & Profile Scope Banner -->
    <div class="env-url-banner">
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <div style="flex: 2; min-width: 240px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label for="base-url" style="margin-bottom: 0;">Base URL</label>
            <label style="font-size: 11px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; text-transform: none; font-weight: normal; color: var(--vscode-foreground);">
              <input type="checkbox" id="base-url-disabled" ${env?.baseUrlDisabled === true ? 'checked' : ''} style="margin: 0; cursor: pointer;" />
              <span>Disable Base URL</span>
            </label>
          </div>
          <input
            id="base-url"
            class="env-url-input"
            type="text"
            value="${escapeHtml(env?.baseUrl || '')}"
            placeholder="${parentBaseUrl ? `Inherited: ${escapeHtml(parentBaseUrl)}` : 'https://api.example.com'}"
            ${env?.baseUrlDisabled === true ? 'disabled style="opacity: 0.55; text-decoration: line-through;"' : ''}
          />
          <span id="base-url-hint" class="help-hint">${parentBaseUrl ? `Inherits from parent (${escapeHtml(parentBaseUrl)}) when left blank` : (env?.baseUrlDisabled === true ? 'Base URL is currently disabled for this environment' : 'Available as {{baseUrl}} across requests')}</span>
        </div>
        <div style="flex: 1; min-width: 180px;">
          <label for="env-parent">Parent Environment</label>
          <select id="env-parent" class="env-url-input" style="height: 32px; cursor: pointer;">
            <option value="">None (Root Environment)</option>
            ${(allEnvironments || [])
              .filter(e => e.id !== item?.id && e.name !== displayName)
              .map(e => `<option value="${escapeHtml(e.id)}" ${e.id === item?.inheritsFrom || e.name === item?.inheritsFrom ? 'selected' : ''}>${escapeHtml(e.name)}</option>`)
              .join('')}
          </select>
          <span class="help-hint">Inherits variables and headers from parent</span>
        </div>
        <div style="flex: 1; min-width: 180px;">
          <label for="env-profile">Profile Scope</label>
          <select id="env-profile" class="env-url-input" style="height: 32px; cursor: pointer;">
            <option value="">Global / Shared (All Profiles)</option>
            ${(allProfiles || [])
              .map(p => `<option value="${escapeHtml(p.id)}" ${p.id === (item as any)?.profileId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
              .join('')}
          </select>
          <span class="help-hint">Scope to profile or share globally</span>
        </div>
      </div>
    </div>
    ` : ''}

    ${isCol ? `
    <!-- Collection Base URL & Profile Scope Banner -->
    <div class="env-url-banner">
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <div style="flex: 2; min-width: 240px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label for="col-base-url" style="margin-bottom: 0;">Collection Base URL</label>
            <label style="font-size: 11px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; text-transform: none; font-weight: normal; color: var(--vscode-foreground);">
              <input type="checkbox" id="col-base-url-disabled" ${(item as any)?.baseUrlDisabled === true ? 'checked' : ''} style="margin: 0; cursor: pointer;" />
              <span>Disable Base URL</span>
            </label>
          </div>
          <input
            id="col-base-url"
            class="env-url-input"
            type="text"
            value="${escapeHtml((item as any)?.baseUrl || (item as any)?.variables?.['baseUrl'] || '')}"
            placeholder="e.g. https://api.example.com or http://localhost:8980"
            ${(item as any)?.baseUrlDisabled === true ? 'disabled style="opacity: 0.55; text-decoration: line-through;"' : ''}
          />
          <span id="col-base-url-hint" class="help-hint">${(item as any)?.baseUrlDisabled === true ? 'Base URL is currently disabled for this collection' : 'Dedicated Base URL for all requests in this collection'}</span>
        </div>
        <div style="flex: 1.5; min-width: 220px;">
          <label for="col-base-url-pref">Base URL Priority</label>
          <select id="col-base-url-pref" class="env-url-input" style="height: 32px; cursor: pointer;">
            <option value="collection" ${(item as any)?.baseUrlPreference !== 'environment' ? 'selected' : ''}>Collection Base URL takes precedence</option>
            <option value="environment" ${(item as any)?.baseUrlPreference === 'environment' ? 'selected' : ''}>Active Environment overrides Collection</option>
          </select>
          <span class="help-hint">Choose whether active environment overrides this collection</span>
        </div>
        <div style="flex: 1; min-width: 180px;">
          <label for="col-profile">Profile Scope</label>
          <select id="col-profile" class="env-url-input" style="height: 32px; cursor: pointer;">
            <option value="">Global / Shared (All Profiles)</option>
            ${(allProfiles || [])
              .map(p => `<option value="${escapeHtml(p.id)}" ${p.id === (item as any)?.profileId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
              .join('')}
          </select>
          <span class="help-hint">Scope to profile or share globally</span>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Tabbed Settings Workspace -->
    <main class="panel-box">
      <nav class="tab-header">
        <button class="tab-btn active" data-tab="tab-vars">
          Variables <span id="var-count-badge" class="tab-badge">0</span>
        </button>
        <button class="tab-btn" data-tab="tab-headers">
          Headers <span id="header-count-badge" class="tab-badge">0</span>
        </button>
        <button class="tab-btn" data-tab="tab-auth">
          Authentication
        </button>
        <button class="tab-btn" data-tab="tab-notes">
          Documentation & Notes
        </button>
        ${isProfile ? `
        <button class="tab-btn" data-tab="tab-guards">
          🛡️ Safety Guards
        </button>
        ` : ''}
      </nav>

      <!-- Tab 1: Interactive Variables Table -->
      <section id="tab-vars" class="tab-content active">
        <div class="table-header-row">
          <span></span>
          <span>Variable Key</span>
          <span>Initial Value</span>
          <span>Mask</span>
          <span></span>
        </div>
        <div id="var-rows"></div>
        <div style="margin-top: 10px; display: flex; align-items: center; justify-content: space-between;">
          <button id="btn-add-var" class="btn btn-secondary" style="font-size: 11px; padding: 4px 12px;">
            + Add Variable
          </button>
          <span class="help-hint">
            Reference in requests via <code style="color: #9cdcfe;">{{variableName}}</code>.
          </span>
        </div>
      </section>

      <!-- Tab 2: Interactive Headers Table -->
      <section id="tab-headers" class="tab-content">
        <div class="table-header-row" style="grid-template-columns: 32px 1.5fr 2.5fr 36px;">
          <span></span>
          <span>Header Name</span>
          <span>Header Value</span>
          <span></span>
        </div>
        <div id="header-rows"></div>
        <div style="margin-top: 10px; display: flex; align-items: center; justify-content: space-between;">
          <button id="btn-add-header" class="btn btn-secondary" style="font-size: 11px; padding: 4px 12px;">
            + Add Header
          </button>
          <span class="help-hint">
            Inherited automatically by all requests under this ${target}.
          </span>
        </div>
      </section>

      <!-- Tab 3: Authentication -->
      <section id="tab-auth" class="tab-content">
        <div class="auth-grid">
          ${isCol || isFolder ? `
          <div class="form-group" style="padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 4px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; font-size: 13px;">
              <input type="checkbox" id="auth-inherit" ${isInherited ? 'checked' : ''} style="cursor: pointer;" />
              <span>Inherit authentication from parent</span>
            </label>
            <span class="help-hint" style="margin-left: 22px; margin-top: 4px;">
              When enabled, requests in this ${target} automatically inherit credentials from the parent Collection, Environment, or Profile.
            </span>
          </div>
          ` : ''}

          ${renderAuthFieldsHtml(auth, target, availableTokens)}
        </div>
      </section>

      <!-- Tab 4: Notes -->
      <section id="tab-notes" class="tab-content">
        <textarea
          id="item-notes"
          class="notes-box"
          placeholder="Add notes, usage guidelines, or documentation here..."
        >${escapeHtml(notes)}</textarea>
      </section>

      ${isProfile ? `
      <!-- Tab 5: Safety Guards -->
      <section id="tab-guards" class="tab-content">
        <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
          <span>🛡️ Touch Points &amp; Safety Warnings</span>
          <span class="pill" style="font-size: 10px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">Safety Protection</span>
        </div>
        <p style="font-size: 11px; color: var(--muted); margin-bottom: 14px; line-height: 1.5;">
          Configure touch-point confirmation warnings and strictly block destructive actions (like <code>DELETE</code> or <code>PUT</code>) whenever this profile is active.
        </p>

        <!-- Enable Guards Toggle -->
        <div style="margin-bottom: 14px; padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 600;">
            <input type="checkbox" id="guard-enabled" ${profile?.guards?.enabled ? 'checked' : ''} style="cursor: pointer;" />
            <span>Enable Safety Guards for this Profile</span>
          </label>
          <div style="font-size: 11px; color: var(--muted); margin-left: 22px; margin-top: 4px;">
            When enabled, all requests dispatched under this profile pass through pre-send safety validation.
          </div>
        </div>

        <!-- Guard Settings Container -->
        <div id="guard-settings-section" style="${profile?.guards?.enabled ? '' : 'opacity: 0.5; pointer-events: none;'} display: flex; flex-direction: column; gap: 14px;">
          
          <!-- Touch Point 1: Confirmation Warning -->
          <div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 600; margin-bottom: 8px;">
              <input type="checkbox" id="guard-warn-send" ${profile?.guards?.warnBeforeSend ? 'checked' : ''} style="cursor: pointer;" />
              <span>⚠️ Prompt Confirmation Warning Before Sending Any Request</span>
            </label>
            <div style="margin-left: 22px;">
              <label style="font-size: 11px; color: var(--muted); display: block; margin-bottom: 4px;">Custom Warning Dialog Message</label>
              <input id="guard-warn-msg" class="form-input" type="text" placeholder="e.g., ⚠️ PRODUCTION PROFILE: Verify endpoint &amp; payload before proceeding!" value="${escapeHtml(profile?.guards?.warnMessage || '')}" style="font-size: 12px; width: 100%;" />
            </div>
          </div>

          <!-- Touch Point 2: Blocked HTTP Methods -->
          <div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px;">
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px;">⛔ Block Destructive HTTP Methods</div>
            <div style="font-size: 11px; color: var(--muted); margin-bottom: 10px;">
              Select HTTP methods that should be strictly blocked under this profile.
            </div>
            <div style="display: flex; gap: 16px; flex-wrap: wrap;">
              ${['DELETE', 'PUT', 'PATCH', 'POST'].map(m => {
                const isBlocked = (profile?.guards?.blockedMethods || []).map(b => b.toUpperCase()).includes(m);
                return `
                  <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">
                    <input type="checkbox" class="guard-method-cb" value="${m}" ${isBlocked ? 'checked' : ''} style="cursor: pointer;" />
                    <span style="font-family: monospace; font-weight: 600; color: ${m === 'DELETE' ? '#ef4444' : m === 'PUT' ? '#f59e0b' : m === 'PATCH' ? '#eab308' : '#3b82f6'};">${m}</span>
                  </label>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Touch Point 3: Keyword Confirmation for Blocked Actions -->
          <div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 600; margin-bottom: 8px;">
              <input type="checkbox" id="guard-keyword-req" ${profile?.guards?.requireKeywordConfirmation ? 'checked' : ''} style="cursor: pointer;" />
              <span>🔐 Allow Blocked Methods Only If User Types Confirmation Keyword</span>
            </label>
            <div style="margin-left: 22px;">
              <div style="font-size: 11px; color: var(--muted); margin-bottom: 6px;">
                If unchecked, blocked methods are aborted immediately. If checked, an input box appears requiring the exact keyword to proceed:
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <span style="font-size: 11px; color: var(--muted);">Keyword:</span>
                <input id="guard-keyword" class="form-input" type="text" placeholder="e.g., PROD or CONFIRM" value="${escapeHtml(profile?.guards?.confirmationKeyword || 'CONFIRM')}" style="font-size: 12px; width: 160px; font-family: monospace; text-transform: uppercase;" />
              </div>
            </div>
          </div>

        </div>
      </section>
      ` : ''}
    </main>
  </div>

  <script>
    (function() {
      try {
        const vscode = acquireVsCodeApi();
        const initialVars = ${variablesJson};
        const initialHeaders = ${headersJson};

        // --- Tabs Switching ---
        document.querySelectorAll('.tab-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const content = document.getElementById(targetTab);
            if (content) content.classList.add('active');
          });
        });

        // --- Variables Table Management ---
        const varRowsContainer = document.getElementById('var-rows');
        const varCountBadge = document.getElementById('var-count-badge');

        function updateVarCount() {
          const count = varRowsContainer.querySelectorAll('.param-row').length;
          varCountBadge.textContent = count;
        }

        function addVarRow(key = '', val = '', enabled = true, isMasked = false) {
          const row = document.createElement('div');
          row.className = 'param-row';

          const enabledCheckbox = document.createElement('input');
          enabledCheckbox.type = 'checkbox';
          enabledCheckbox.checked = enabled;
          enabledCheckbox.style.cursor = 'pointer';
          enabledCheckbox.dataset.role = 'enabled';

          const keyInput = document.createElement('input');
          keyInput.type = 'text';
          keyInput.className = 'param-input';
          keyInput.placeholder = 'Key';
          keyInput.value = key;
          keyInput.dataset.role = 'key';

          const valInput = document.createElement('input');
          valInput.type = isMasked ? 'password' : 'text';
          valInput.className = 'param-input';
          valInput.placeholder = 'Value';
          valInput.value = val;
          valInput.dataset.role = 'value';

          const maskLabel = document.createElement('label');
          maskLabel.style.display = 'flex';
          maskLabel.style.alignItems = 'center';
          maskLabel.style.gap = '4px';
          maskLabel.style.fontSize = '11px';
          maskLabel.style.color = 'var(--muted)';
          maskLabel.style.cursor = 'pointer';

          const maskCheckbox = document.createElement('input');
          maskCheckbox.type = 'checkbox';
          maskCheckbox.checked = isMasked;
          maskCheckbox.dataset.role = 'mask';
          maskLabel.appendChild(maskCheckbox);
          maskLabel.appendChild(document.createTextNode('Mask'));

          maskCheckbox.addEventListener('change', () => {
            valInput.type = maskCheckbox.checked ? 'password' : 'text';
          });

          const delBtn = document.createElement('button');
          delBtn.className = 'icon-btn';
          delBtn.title = 'Delete';
          delBtn.dataset.role = 'delete';
          delBtn.textContent = '✕';
          delBtn.addEventListener('click', () => {
            row.remove();
            updateVarCount();
          });

          row.appendChild(enabledCheckbox);
          row.appendChild(keyInput);
          row.appendChild(valInput);
          row.appendChild(maskLabel);
          row.appendChild(delBtn);

          varRowsContainer.appendChild(row);
          updateVarCount();
        }

        document.getElementById('btn-add-var').addEventListener('click', () => addVarRow());

        // Populate initial variables from object
        const varEntries = Object.entries(initialVars);
        if (varEntries.length > 0) {
          varEntries.forEach(([k, v]) => {
            addVarRow(k, v != null ? String(v) : '', true, false);
          });
        } else {
          addVarRow('', '', true, false);
        }

        // --- Headers Table Management ---
        const headerRowsContainer = document.getElementById('header-rows');
        const headerCountBadge = document.getElementById('header-count-badge');

        function updateHeaderCount() {
          const count = headerRowsContainer.querySelectorAll('.param-row').length;
          headerCountBadge.textContent = count;
        }

        function addHeaderRow(key = '', val = '', enabled = true) {
          const row = document.createElement('div');
          row.className = 'param-row header-row';

          const enabledCheckbox = document.createElement('input');
          enabledCheckbox.type = 'checkbox';
          enabledCheckbox.checked = enabled;
          enabledCheckbox.style.cursor = 'pointer';
          enabledCheckbox.dataset.role = 'enabled';

          const keyInput = document.createElement('input');
          keyInput.type = 'text';
          keyInput.className = 'param-input';
          keyInput.placeholder = 'Header name (e.g. Accept, X-Custom)';
          keyInput.value = key;
          keyInput.dataset.role = 'key';

          const valInput = document.createElement('input');
          valInput.type = 'text';
          valInput.className = 'param-input';
          valInput.placeholder = 'Header value';
          valInput.value = val;
          valInput.dataset.role = 'value';

          const delBtn = document.createElement('button');
          delBtn.className = 'icon-btn';
          delBtn.title = 'Delete';
          delBtn.dataset.role = 'delete';
          delBtn.textContent = '✕';
          delBtn.addEventListener('click', () => {
            row.remove();
            updateHeaderCount();
          });

          row.appendChild(enabledCheckbox);
          row.appendChild(keyInput);
          row.appendChild(valInput);
          row.appendChild(delBtn);

          headerRowsContainer.appendChild(row);
          updateHeaderCount();
        }

        document.getElementById('btn-add-header').addEventListener('click', () => addHeaderRow());

        // Populate initial headers
        const headerEntries = Object.entries(initialHeaders);
        if (headerEntries.length > 0) {
          headerEntries.forEach(([k, v]) => {
            addHeaderRow(k, v != null ? String(v) : '', true);
          });
        }

        // --- Dynamic Auth Fields & Visibility ---
        ${getSharedAuthClientScript()}

        // --- Dynamic Parent Base URL Update ---
        const envParentSelect = document.getElementById('env-parent');
        const baseUrlInput = document.getElementById('base-url');
        const baseUrlHint = document.getElementById('base-url-hint');
        const allEnvsData = ${JSON.stringify(allEnvironments || []).replace(/</g, '\\u003c')};

        if (envParentSelect && baseUrlInput) {
          envParentSelect.addEventListener('change', () => {
            const selectedParentId = envParentSelect.value;
            const parentObj = allEnvsData.find(e => e.id === selectedParentId || e.name === selectedParentId);
            if (parentObj && parentObj.baseUrl) {
              baseUrlInput.placeholder = 'Inherited: ' + parentObj.baseUrl;
              if (baseUrlHint) baseUrlHint.textContent = 'Inherits from parent (' + parentObj.baseUrl + ') when left blank';
            } else if (selectedParentId) {
              baseUrlInput.placeholder = 'Inherited from parent (empty)';
              if (baseUrlHint) baseUrlHint.textContent = 'Inherits from parent when left blank';
            } else {
              baseUrlInput.placeholder = 'https://api.example.com';
              if (baseUrlHint) baseUrlHint.textContent = 'Available as {{baseUrl}} across requests';
            }
          });
        }

        // --- Dynamic Base URL Disabled Toggles ---
        const envBaseUrlDisabledCheckbox = document.getElementById('base-url-disabled');
        if (envBaseUrlDisabledCheckbox && baseUrlInput) {
          envBaseUrlDisabledCheckbox.addEventListener('change', () => {
            if (envBaseUrlDisabledCheckbox.checked) {
              baseUrlInput.disabled = true;
              baseUrlInput.style.opacity = '0.55';
              baseUrlInput.style.textDecoration = 'line-through';
              if (baseUrlHint) baseUrlHint.textContent = 'Base URL is currently disabled for this environment';
            } else {
              baseUrlInput.disabled = false;
              baseUrlInput.style.opacity = '1';
              baseUrlInput.style.textDecoration = 'none';
              if (baseUrlHint) baseUrlHint.textContent = 'Available as {{baseUrl}} across requests';
            }
          });
        }

        const colBaseUrlDisabledCheckbox = document.getElementById('col-base-url-disabled');
        const colBaseUrlInput = document.getElementById('col-base-url');
        const colBaseUrlHint = document.getElementById('col-base-url-hint');
        if (colBaseUrlDisabledCheckbox && colBaseUrlInput) {
          colBaseUrlDisabledCheckbox.addEventListener('change', () => {
            if (colBaseUrlDisabledCheckbox.checked) {
              colBaseUrlInput.disabled = true;
              colBaseUrlInput.style.opacity = '0.55';
              colBaseUrlInput.style.textDecoration = 'line-through';
              if (colBaseUrlHint) colBaseUrlHint.textContent = 'Base URL is currently disabled for this collection';
            } else {
              colBaseUrlInput.disabled = false;
              colBaseUrlInput.style.opacity = '1';
              colBaseUrlInput.style.textDecoration = 'none';
              if (colBaseUrlHint) colBaseUrlHint.textContent = 'Dedicated Base URL for all requests in this collection';
            }
          });
        }

        // --- Color Theme swatches & pickers (Profile Settings) ---
        const colorPicker = document.getElementById('prof-color-picker');
        const colorInput = document.getElementById('prof-color-input');
        const themePreview = document.getElementById('prof-theme-preview');
        const swatchBtns = document.querySelectorAll('.color-swatch-btn');

        function updateColorTheme(newHex) {
          if (!newHex) return;
          if (colorPicker) colorPicker.value = newHex;
          if (colorInput) colorInput.value = newHex;
          if (themePreview) {
            themePreview.style.background = newHex + '22';
            themePreview.style.color = newHex;
            themePreview.style.borderColor = newHex + '55';
          }
          document.documentElement.style.setProperty('--primary', newHex);
          swatchBtns.forEach(btn => {
            const match = (btn.getAttribute('data-color') || '').toLowerCase() === newHex.toLowerCase();
            btn.style.borderColor = match ? 'var(--text, #ffffff)' : 'transparent';
            btn.style.transform = match ? 'scale(1.15)' : 'scale(1)';
          });
        }

        swatchBtns.forEach(btn => {
          btn.addEventListener('click', () => {
            const color = btn.getAttribute('data-color');
            if (color) updateColorTheme(color);
          });
        });

        if (colorPicker) {
          colorPicker.addEventListener('input', () => updateColorTheme(colorPicker.value));
        }
        if (colorInput) {
          colorInput.addEventListener('input', () => {
            const val = colorInput.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
              updateColorTheme(val);
            }
          });
        }

        // Safety Guards toggle
        const guardEnabledCb = document.getElementById('guard-enabled');
        const guardSection = document.getElementById('guard-settings-section');
        if (guardEnabledCb && guardSection) {
          guardEnabledCb.addEventListener('change', () => {
            guardSection.style.opacity = guardEnabledCb.checked ? '1' : '0.5';
            guardSection.style.pointerEvents = guardEnabledCb.checked ? 'auto' : 'none';
          });
        }

        // --- Save & Cancel Actions ---
        document.getElementById('btn-cancel').addEventListener('click', () => {
          vscode.postMessage({ type: 'cancel' });
        });

        document.getElementById('btn-save').addEventListener('click', () => {
          const name = (document.getElementById('item-name').value || '').trim();
          const baseUrlInput = document.getElementById('base-url') || document.getElementById('col-base-url');
          const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : undefined;
          const baseUrlDisabled = !!(
            (envBaseUrlDisabledCheckbox && envBaseUrlDisabledCheckbox.checked) ||
            (colBaseUrlDisabledCheckbox && colBaseUrlDisabledCheckbox.checked)
          );
          const colBaseUrlPref = document.getElementById('col-base-url-pref');
          const baseUrlPreference = colBaseUrlPref ? colBaseUrlPref.value : undefined;
          const envParentSelect = document.getElementById('env-parent');
          const inheritsFrom = envParentSelect ? envParentSelect.value.trim() || undefined : undefined;
          const profileScopeSelect = document.getElementById('env-profile') || document.getElementById('col-profile');
          const profileId = profileScopeSelect ? profileScopeSelect.value.trim() || undefined : undefined;
          const authValues = extractAuthValues();
          const inheritCheck = document.getElementById('auth-inherit');
          const inheritAuth = inheritCheck ? inheritCheck.checked : true;
          const notes = (document.getElementById('item-notes').value || '').trim();

          let guards = undefined;
          if (guardEnabledCb) {
            guards = {
              enabled: guardEnabledCb.checked,
              warnBeforeSend: document.getElementById('guard-warn-send')?.checked || false,
              warnMessage: document.getElementById('guard-warn-msg')?.value?.trim() || '',
              blockedMethods: Array.from(document.querySelectorAll('.guard-method-cb:checked')).map(cb => cb.value),
              requireKeywordConfirmation: document.getElementById('guard-keyword-req')?.checked || false,
              confirmationKeyword: document.getElementById('guard-keyword')?.value?.trim() || 'CONFIRM'
            };
          }

          // Gather non-empty enabled variables into a dictionary
          const variables = {};
          varRowsContainer.querySelectorAll('.param-row').forEach(row => {
            const enabled = row.querySelector('[data-role="enabled"]').checked;
            const key = (row.querySelector('[data-role="key"]').value || '').trim();
            const value = row.querySelector('[data-role="value"]').value;
            if (enabled && key) {
              variables[key] = value;
            }
          });

          // Gather non-empty enabled headers into a dictionary
          const headers = {};
          headerRowsContainer.querySelectorAll('.param-row').forEach(row => {
            const enabled = row.querySelector('[data-role="enabled"]').checked;
            const key = (row.querySelector('[data-role="key"]').value || '').trim();
            const value = row.querySelector('[data-role="value"]').value;
            if (enabled && key) {
              headers[key] = value;
            }
          });

          vscode.postMessage({
            type: 'saveSettings',
            payload: {
              name,
              color: document.getElementById('prof-color-input')?.value || document.getElementById('prof-color-picker')?.value || undefined,
              baseUrl,
              baseUrlDisabled,
              baseUrlPreference,
              inheritsFrom,
              profileId,
              authType: authValues.type,
              token: authValues.token,
              headerName: authValues.headerName,
              keyName: authValues.keyName,
              headerPrefix: authValues.headerPrefix,
              addTo: authValues.addTo,
              username: authValues.username,
              password: authValues.password,
              clientId: authValues.clientId,
              clientSecret: authValues.clientSecret,
              authorizationUrl: authValues.authorizationUrl,
              tokenUrl: authValues.tokenUrl,
              scopes: authValues.scopes,
              grantType: authValues.grantType,
              selectedTokenId: authValues.selectedTokenId,
              redirectUri: authValues.redirectUri,
              pkce: authValues.pkce,
              inheritAuth,
              variables,
              headers,
              notes,
              guards
            }
          });
        });

        // Intercept Ctrl+Z and Ctrl+Y in capture phase so VS Code cannot steal them
        window.addEventListener('keydown', (e) => {
          const isZ = e.key === 'z' || e.key === 'Z';
          const isY = e.key === 'y' || e.key === 'Y';
          if ((e.ctrlKey || e.metaKey) && (isZ || isY)) {
            const isRedo = isY || (isZ && e.shiftKey);
            const activeEl = document.activeElement;
            const isTextInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

            if (isTextInput) {
              try {
                const handled = document.execCommand(isRedo ? 'redo' : 'undo');
                if (handled) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              } catch (_) {}
            }
          }
        }, true);
      } catch (err) {
        console.error('[byrdsnest api client Settings] Webview runtime error:', err);
      }
    })();
  </script>
</body>
</html>`;
}
