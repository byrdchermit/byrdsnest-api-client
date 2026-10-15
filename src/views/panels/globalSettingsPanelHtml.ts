import { AppState, DEFAULT_PROFILE_COLORS, Profile, StoredToken } from '../../types';
import { getSharedAuthClientScript, renderAuthCss, renderAuthFieldsHtml } from './sharedAuthHtml';

export function getGlobalSettingsPanelHtml(
  state: AppState,
  storedTokens: StoredToken[] = [],
  initialTab = 'profiles',
  selectedProfileId?: string
): string {
  const activeProfileId = state.activeProfileId;
  const currentProfileId = selectedProfileId || activeProfileId || state.profiles[0]?.id || 'global';
  const isGlobalSelected = currentProfileId === 'global';
  const globalProfFallback: Profile = state.globalProfile || {
    id: 'global',
    name: 'Shared / Global',
    color: '#64748b',
    auth: { type: 'none' },
    variables: {},
    headers: {},
    notes: 'Variables & auth shared across all profiles',
  };
  const currentProfile = isGlobalSelected
    ? globalProfFallback
    : (state.profiles.find((p) => p.id === currentProfileId) || state.profiles[0] || globalProfFallback);
  const isGlobal = currentProfile?.id === 'global';
  const currentProfColor = isGlobal ? '#64748b' : (currentProfile?.color || '#3b82f6');

  const escapeHtml = (str: string | undefined | null): string => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const escapeAttr = escapeHtml;

  // Environment options for the dropdown with hierarchy
  const envEntries = Object.entries(state.environments);
  const activeEnvName = state.activeEnvironmentName || '';
  const envById = new Map<string, { name: string; env: typeof envEntries[0][1] }>();
  const envByName = new Map<string, { name: string; env: typeof envEntries[0][1] }>();
  for (const [name, env] of envEntries) {
    envByName.set(name, { name, env });
    if (env.id) envById.set(env.id, { name, env });
  }

  const childrenMap = new Map<string, Array<{ name: string; env: typeof envEntries[0][1] }>>();
  const rootEntries: Array<{ name: string; env: typeof envEntries[0][1] }> = [];

  for (const [name, env] of envEntries) {
    const parentRef = env.inheritsFrom;
    const parentEntry = parentRef ? (envById.get(parentRef) || envByName.get(parentRef)) : undefined;
    if (parentEntry && parentEntry.name !== name) {
      const key = parentEntry.env.id || parentEntry.name;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push({ name, env });
    } else {
      rootEntries.push({ name, env });
    }
  }

  const renderedOptions: string[] = [
    `<option value="" ${!activeEnvName ? 'selected' : ''}>No Environment (Collection Defaults)</option>`
  ];
  const visitedKeys = new Set<string>();

  const renderEnvOption = (name: string, env: typeof envEntries[0][1], depth: number) => {
    const key = env.id || name;
    if (visitedKeys.has(key)) return;
    visitedKeys.add(key);

    const isSelected = activeEnvName === name || activeEnvName === env.id;
    const indent = depth > 0 ? '&nbsp;&nbsp;'.repeat(depth) + '↳ ' : '';
    const rawChildren = childrenMap.get(key) || [];
    const isParent = rawChildren.length > 0;
    const parentBadge = isParent ? ` [Parent (${rawChildren.length})]` : '';
    const urlStr = env.baseUrl ? ` (${escapeHtml(env.baseUrl)})` : ' (no base url)';

    renderedOptions.push(
      `<option value="${escapeAttr(name)}" ${isSelected ? 'selected' : ''}>${indent}${escapeHtml(name)}${urlStr}${parentBadge}</option>`
    );

    for (const child of rawChildren) {
      renderEnvOption(child.name, child.env, depth + 1);
    }
  };

  for (const root of rootEntries) {
    renderEnvOption(root.name, root.env, 0);
  }
  for (const [name, env] of envEntries) {
    if (!visitedKeys.has(env.id || name)) {
      renderEnvOption(name, env, 0);
    }
  }
  const envOptionsHtml = renderedOptions.join('');

  // Profiles list items for sidebar selector
  const profileListHtml = state.profiles.map((p) => {
    const isActive = p.id === activeProfileId || (!activeProfileId && p.id === state.profiles[0]?.id);
    const isSelected = p.id === currentProfile?.id;
    const cardColor = p.color || '#3b82f6';
    return `
      <div class="profile-card ${isSelected ? 'selected' : ''}" data-profile-id="${escapeAttr(p.id)}" style="${isSelected ? `border-left: 3px solid ${escapeAttr(cardColor)};` : ''}">
        <div class="profile-card-header">
          <span class="profile-color-dot" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${escapeAttr(cardColor)}; margin-right: 6px; flex-shrink: 0; box-shadow: 0 0 4px ${escapeAttr(cardColor)}66;"></span>
          <span class="profile-radio ${isActive ? 'active' : ''}"></span>
          <span class="profile-name">${escapeHtml(p.name)}</span>
          ${isActive ? '<span class="pill active-pill">Active</span>' : ''}
        </div>
        <div class="profile-card-desc">${escapeHtml(p.notes || 'Custom profile')}</div>
      </div>
    `;
  }).join('');

  // Global / Shared profile card
  const isGlobalActive = !activeProfileId || activeProfileId === 'global' || activeProfileId === 'all';
  const globalCardHtml = `
    <div class="profile-card ${isGlobalSelected ? 'selected' : ''}" data-profile-id="global" style="${isGlobalSelected ? 'border-left: 3px solid #64748b;' : ''}">
      <div class="profile-card-header">
        <span class="profile-color-dot" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #64748b; margin-right: 6px; flex-shrink: 0; box-shadow: 0 0 4px #64748b66;"></span>
        <span class="profile-radio ${isGlobalActive ? 'active' : ''}"></span>
        <span class="profile-name">Shared / Global</span>
        ${isGlobalActive ? '<span class="pill active-pill">Active</span>' : ''}
      </div>
      <div class="profile-card-desc">${escapeHtml(state.globalProfile?.notes || 'Variables & auth shared across all profiles')}</div>
    </div>
  `;

  // Profile Variables JSON
  const profileVars = currentProfile?.variables || {};
  const profileHeaders = currentProfile?.headers || {};
  const profileAuth = currentProfile?.auth || { type: 'none' };

  // Current Base URL preference
  const currentBaseUrlPref = (state as any).settings?.baseUrlPreference || 'auto';
  const currentTimeout = (state as any).settings?.requestTimeoutMs || 30000;
  const currentFollowRedirects = (state as any).settings?.followRedirects !== false;
  const currentStrictSsl = (state as any).settings?.rejectUnauthorized !== false;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>byrdsnest api client Settings</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --panel: var(--vscode-sideBar-background, #252526);
      --surface: var(--vscode-input-background, #2d2d2d);
      --border: var(--vscode-panel-border, var(--vscode-input-border, #3c3c3c));
      --text: var(--vscode-editor-foreground, #cccccc);
      --muted: var(--vscode-descriptionForeground, #8c8c8c);
      --primary: ${currentProfColor || 'var(--vscode-button-background, #0e639c)'};
      --primary-hover: var(--vscode-button-hoverBackground, #1177bb);
      --primary-fg: var(--vscode-button-foreground, #ffffff);
      --success: var(--vscode-testing-iconPassed, #4ec9b0);
      --danger: var(--vscode-testing-iconFailed, #f14c4c);
      --warning: #cca700;
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
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Top Banner */
    .top-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header-title-box {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
    }
    .header-badge {
      font-size: 11px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 2px 8px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }

    /* Layout: Navigation Tabs on Top */
    .nav-bar {
      display: flex;
      background: rgba(0,0,0,0.15);
      border-bottom: 1px solid var(--border);
      padding: 0 16px;
      gap: 4px;
      flex-shrink: 0;
    }
    .nav-item {
      padding: 10px 16px;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      border-bottom: 2px solid transparent;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      margin-bottom: -1px;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      transition: all 0.15s ease;
    }
    .nav-item:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.03);
    }
    .nav-item.active {
      color: var(--text);
      font-weight: 600;
      border-bottom-color: var(--primary);
      background: rgba(255, 255, 255, 0.05);
    }

    /* Main Container */
    .main-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .tab-page {
      display: none;
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
    }
    .tab-page.active {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* Profile Split View */
    .profile-split {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 20px;
      height: 100%;
      min-height: 500px;
    }
    .profile-sidebar {
      display: flex;
      flex-direction: column;
      gap: 10px;
      border-right: 1px solid var(--border);
      padding-right: 16px;
    }
    .profile-sidebar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .profile-sidebar-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--muted);
      letter-spacing: 0.5px;
    }
    .profile-cards-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow-y: auto;
      flex: 1;
    }
    .profile-card {
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .profile-card:hover {
      border-color: var(--primary);
    }
    .profile-card.selected {
      border-color: var(--primary);
      background: rgba(14, 99, 156, 0.12);
    }
    .profile-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .profile-radio {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid var(--muted);
      flex-shrink: 0;
    }
    .profile-radio.active {
      border-color: var(--success);
      background: var(--success);
    }
    .profile-name {
      font-weight: 600;
      font-size: 13px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .profile-card-desc {
      font-size: 11px;
      color: var(--muted);
      margin-top: 4px;
      padding-left: 20px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pill.active-pill {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(78, 201, 176, 0.15);
      color: var(--success);
      font-weight: 600;
    }

    /* Profile Detail View */
    .profile-detail {
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
      padding-right: 8px;
    }
    .profile-detail-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }

    /* Buttons */
    .btn {
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid transparent;
      user-select: none;
      transition: background 0.15s ease;
    }
    .btn-primary {
      background: var(--primary);
      color: var(--primary-fg);
    }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-secondary {
      background: transparent;
      border-color: var(--border);
      color: var(--text);
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.06); }
    .btn-danger {
      background: rgba(241, 76, 76, 0.15);
      border-color: var(--danger);
      color: #ff8888;
    }
    .btn-danger:hover { background: var(--danger); color: #fff; }
    .btn-success {
      background: rgba(78, 201, 176, 0.2);
      border-color: var(--success);
      color: var(--success);
    }

    /* Form & Settings Cards */
    .settings-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .settings-card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .settings-card-desc {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.5;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-group label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text);
    }
    .form-input, .form-select {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .form-input:focus, .form-select:focus {
      border-color: var(--primary);
    }

    /* Radio Choice Cards */
    .choice-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .choice-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .choice-card:hover {
      border-color: var(--primary);
    }
    .choice-card.selected {
      border-color: var(--primary);
      background: rgba(14, 99, 156, 0.1);
    }
    .choice-card input[type="radio"] {
      margin-top: 2px;
      cursor: pointer;
    }
    .choice-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .choice-label {
      font-weight: 600;
      font-size: 13px;
      color: var(--text);
    }
    .choice-desc {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.4;
    }

    /* Sub-tabs inside profile detail */
    .subtab-header {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0;
      align-items: flex-end;
    }
    .subtab-btn {
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      margin-bottom: -1px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      padding: 7px 14px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .subtab-btn:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.03);
    }
    .subtab-btn.active {
      color: var(--text);
      font-weight: 600;
      border-bottom-color: var(--primary);
      background: rgba(255, 255, 255, 0.05);
    }
    .subtab-content {
      display: none;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
    }
    .subtab-content.active { display: flex; }

    /* Tables */
    .param-table {
      width: 100%;
      border-collapse: collapse;
    }
    .param-row {
      display: grid;
      grid-template-columns: 32px 1fr 1fr 60px 36px;
      gap: 6px;
      align-items: center;
      margin-bottom: 6px;
    }
    .param-row.header-row {
      grid-template-columns: 32px 1fr 1fr 36px;
    }
    .param-input {
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 5px 8px;
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
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover { color: var(--danger); background: rgba(255,255,255,0.05); }

    /* Token Vault Table */
    .token-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .token-table th {
      text-align: left;
      padding: 8px 10px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      font-weight: 600;
    }
    .token-table td {
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      vertical-align: middle;
    }
    .token-code {
      font-family: Consolas, Monaco, monospace;
      background: rgba(0,0,0,0.25);
      padding: 2px 6px;
      border-radius: 3px;
    }

    ${renderAuthCss()}
  </style>
</head>
<body>
  <!-- Top Banner -->
  <div class="top-header">
    <div class="header-title-box">
      <span class="header-title">byrdsnest api client Settings</span>
      <span class="header-badge">Preferences &amp; Profiles</span>
    </div>
    <div style="display: flex; gap: 8px;">
      <button id="btn-save-all" class="btn btn-primary">Save Changes</button>
    </div>
  </div>

  <!-- Navigation Bar -->
  <div class="nav-bar">
    <div class="nav-item ${initialTab === 'profiles' ? 'active' : ''}" data-tab="tab-profiles">👤 Profiles &amp; Scopes</div>
    <div class="nav-item ${initialTab === 'baseurl' ? 'active' : ''}" data-tab="tab-baseurl">🌐 Base URL &amp; Environments</div>
    <div class="nav-item ${initialTab === 'network' ? 'active' : ''}" data-tab="tab-network">⚡ Network &amp; Requests</div>
    <div class="nav-item ${initialTab === 'tokens' ? 'active' : ''}" data-tab="tab-tokens">🔑 OAuth &amp; Token Vault</div>
    <div class="nav-item ${initialTab === 'data' ? 'active' : ''}" data-tab="tab-data">💾 Data &amp; Backup</div>
  </div>

  <!-- Main Body -->
  <div class="main-body">

    <!-- TAB 1: PROFILES -->
    <div id="tab-profiles" class="tab-page ${initialTab === 'profiles' ? 'active' : ''}">
      <div class="profile-split">
        <!-- Sidebar: Profile List -->
        <div class="profile-sidebar">
          <div class="profile-sidebar-header">
            <span class="profile-sidebar-title">Profiles (1 Active)</span>
            <button id="btn-new-profile" class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px;">+ New</button>
          </div>
          <div class="profile-cards-list">
            ${profileListHtml}
            ${globalCardHtml}
          </div>
        </div>

        <!-- Detail: Selected Profile Editor -->
        <div class="profile-detail">
          <div class="profile-detail-actions">
            <div>
              <h2 id="prof-heading" style="font-size: 16px;">${escapeHtml(currentProfile?.name || 'Shared / Global')}</h2>
              <span id="prof-subheading" style="font-size: 11px; color: var(--muted);">${isGlobal ? 'global · Root scope (inherited by all profiles)' : (currentProfile?.id || 'global')}</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              ${!isGlobal ? `
              <button id="btn-activate-profile" class="btn btn-success" ${currentProfile?.id === activeProfileId ? 'disabled' : ''}>
                ${currentProfile?.id === activeProfileId ? '✔ Active Profile' : 'Set as Active'}
              </button>
              ${state.profiles.length > 1 ? '<button id="btn-delete-profile" class="btn btn-danger">Delete</button>' : ''}
              ` : `
              <span class="pill" style="background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.4); font-size: 11px; padding: 4px 8px;">
                🌐 Universal Scope (Always Applied)
              </span>
              `}
            </div>
          </div>

          <!-- Basic Info & Color Theme -->
          <div class="settings-card">
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
              <div class="form-group" style="flex: 2; min-width: 200px;">
                <label>Profile Name</label>
                <input id="prof-name-input" class="form-input" type="text" value="${escapeAttr(currentProfile?.name || '')}" ${isGlobal ? 'disabled title="Universal scope name is fixed"' : ''} />
                ${isGlobal ? '<span class="help-hint">Built-in universal scope. Variables, headers, and auth configured here apply across all profiles.</span>' : ''}
              </div>
              <div class="form-group" style="flex: 3; min-width: 260px;">
                <label>Description / Notes</label>
                <input id="prof-notes-input" class="form-input" type="text" placeholder="${isGlobal ? 'Variables & auth shared across all profiles' : 'Workspace scope description'}" value="${escapeAttr(currentProfile?.notes || '')}" />
              </div>
            </div>

            ${!isGlobal ? `
            <div class="form-group" style="margin-top: 12px;">
              <label style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span>Color Theme</span>
                <span id="prof-theme-preview" class="pill" style="background: ${escapeAttr(currentProfColor)}22; color: ${escapeAttr(currentProfColor)}; border: 1px solid ${escapeAttr(currentProfColor)}55; font-size: 11px; font-weight: 600;">
                  ● ${escapeHtml(currentProfile?.name || 'Profile')} Theme
                </span>
              </label>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                ${DEFAULT_PROFILE_COLORS.map(c => {
                  const isSelectedColor = (currentProfile?.color || '#3b82f6').toLowerCase() === c.value.toLowerCase();
                  return `<button type="button" class="color-swatch-btn ${isSelectedColor ? 'active' : ''}" data-color="${c.value}" title="${c.name} (${c.value})" style="width: 24px; height: 24px; border-radius: 50%; background: ${c.value}; border: 2px solid ${isSelectedColor ? 'var(--text, #ffffff)' : 'transparent'}; cursor: pointer; transition: transform 0.15s, border-color 0.15s; outline: none; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transform: ${isSelectedColor ? 'scale(1.15)' : 'scale(1)'};"></button>`;
                }).join('')}
                <div style="display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.04); border: 1px solid var(--border);">
                  <input type="color" id="prof-color-picker" value="${escapeAttr(currentProfColor)}" style="width: 22px; height: 22px; padding: 0; border: none; background: transparent; cursor: pointer; border-radius: 3px;" />
                  <input type="text" id="prof-color-input" class="form-input" value="${escapeAttr(currentProfColor)}" style="width: 78px; padding: 2px 6px; font-family: monospace; font-size: 11px; height: 22px;" placeholder="#3b82f6" />
                </div>
              </div>
              <span class="help-hint">Tints the status bar, sidebar indicators, request header badges, and webview accents when this profile is active.</span>
            </div>
            ` : ''}
          </div>

          <!-- Variables, Headers, Auth Sub-tabs -->
          <div class="settings-card">
            <div class="subtab-header">
              <button class="subtab-btn active" data-subtab="subtab-vars">Variables (${Object.keys(profileVars).length})</button>
              <button class="subtab-btn" data-subtab="subtab-headers">Headers (${Object.keys(profileHeaders).length})</button>
              <button class="subtab-btn" data-subtab="subtab-auth">Default Auth</button>
              ${!isGlobal ? '<button class="subtab-btn" data-subtab="subtab-guards">🛡️ Safety Guards</button>' : ''}
            </div>

            <!-- Profile Variables Sub-tab -->
            <div id="subtab-vars" class="subtab-content active">
              <div id="prof-vars-container"></div>
              <button id="btn-add-prof-var" class="btn btn-secondary" style="align-self: flex-start;">+ Add Variable</button>
            </div>

            <!-- Profile Headers Sub-tab -->
            <div id="subtab-headers" class="subtab-content">
              <div id="prof-headers-container"></div>
              <button id="btn-add-prof-header" class="btn btn-secondary" style="align-self: flex-start;">+ Add Header</button>
            </div>

            <!-- Profile Auth Sub-tab -->
            <div id="subtab-auth" class="subtab-content">
              ${renderAuthFieldsHtml(profileAuth, 'selected profile', storedTokens)}
            </div>

            <!-- Profile Safety Guards Sub-tab -->
            ${!isGlobal ? `
            <div id="subtab-guards" class="subtab-content">
              <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                <span>🛡️ Touch Points &amp; Safety Warnings</span>
                <span class="pill" style="font-size: 10px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">Safety Protection</span>
              </div>
              <p style="font-size: 11px; color: var(--muted); margin-bottom: 14px; line-height: 1.5;">
                Configure touch-point warnings and restrict destructive actions (e.g. <code>DELETE</code>, <code>PUT</code>) whenever this profile is active. Ideal for Production or Staging profiles.
              </p>

              <!-- Enable Guards Toggle -->
              <div style="margin-bottom: 14px; padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 600;">
                  <input type="checkbox" id="guard-enabled" ${currentProfile?.guards?.enabled ? 'checked' : ''} style="cursor: pointer;" />
                  <span>Enable Safety Guards for this Profile</span>
                </label>
                <div style="font-size: 11px; color: var(--muted); margin-left: 22px; margin-top: 4px;">
                  When enabled, all requests dispatched under this profile pass through pre-send safety validation.
                </div>
              </div>

              <!-- Guard Settings Container -->
              <div id="guard-settings-section" style="${currentProfile?.guards?.enabled ? '' : 'opacity: 0.5; pointer-events: none;'} display: flex; flex-direction: column; gap: 14px;">
                
                <!-- Touch Point 1: Confirmation Warning -->
                <div style="padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 6px;">
                  <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 600; margin-bottom: 8px;">
                    <input type="checkbox" id="guard-warn-send" ${currentProfile?.guards?.warnBeforeSend ? 'checked' : ''} style="cursor: pointer;" />
                    <span>⚠️ Prompt Confirmation Warning Before Sending Any Request</span>
                  </label>
                  <div style="margin-left: 22px;">
                    <label style="font-size: 11px; color: var(--muted); display: block; margin-bottom: 4px;">Custom Warning Dialog Message</label>
                    <input id="guard-warn-msg" class="form-input" type="text" placeholder="e.g., ⚠️ PRODUCTION PROFILE: Verify endpoint &amp; payload before proceeding!" value="${escapeAttr(currentProfile?.guards?.warnMessage || '')}" style="font-size: 12px; width: 100%;" />
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
                      const isBlocked = (currentProfile?.guards?.blockedMethods || []).map(b => b.toUpperCase()).includes(m);
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
                    <input type="checkbox" id="guard-keyword-req" ${currentProfile?.guards?.requireKeywordConfirmation ? 'checked' : ''} style="cursor: pointer;" />
                    <span>🔐 Allow Blocked Methods Only If User Types Confirmation Keyword</span>
                  </label>
                  <div style="margin-left: 22px;">
                    <div style="font-size: 11px; color: var(--muted); margin-bottom: 6px;">
                      If unchecked, blocked methods are aborted immediately. If checked, an input box appears requiring the exact keyword to proceed:
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                      <span style="font-size: 11px; color: var(--muted);">Keyword:</span>
                      <input id="guard-keyword" class="form-input" type="text" placeholder="e.g., PROD or CONFIRM" value="${escapeAttr(currentProfile?.guards?.confirmationKeyword || 'CONFIRM')}" style="font-size: 12px; width: 160px; font-family: monospace; text-transform: uppercase;" />
                    </div>
                  </div>
                </div>

              </div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: BASE URL & ENVIRONMENTS -->
    <div id="tab-baseurl" class="tab-page ${initialTab === 'baseurl' ? 'active' : ''}">
      <div class="settings-card">
        <div class="settings-card-title">🌐 Base URL Precedence Strategy</div>
        <div class="settings-card-desc">
          Choose how <code>{{baseUrl}}</code> resolves when both a Collection and an Environment define a Base URL.
        </div>
        <div class="choice-group">
          <label class="choice-card ${currentBaseUrlPref === 'auto' ? 'selected' : ''}">
            <input type="radio" name="baseUrlPreference" value="auto" ${currentBaseUrlPref === 'auto' ? 'checked' : ''} />
            <div class="choice-info">
              <span class="choice-label">Auto (Collection First) &mdash; Recommended</span>
              <span class="choice-desc">If a request belongs to a collection with its own Base URL (e.g. indexer, Algod, MAWM), the collection's Base URL is used. Environment variables still apply, and the environment's base URL remains accessible via <code>{{envBaseUrl}}</code>.</span>
            </div>
          </label>
          <label class="choice-card ${currentBaseUrlPref === 'collection' ? 'selected' : ''}">
            <input type="radio" name="baseUrlPreference" value="collection" ${currentBaseUrlPref === 'collection' ? 'checked' : ''} />
            <div class="choice-info">
              <span class="choice-label">Collection Always</span>
              <span class="choice-desc">Collections always preserve their Base URL. Environments cannot overwrite <code>{{baseUrl}}</code> for requests inside collections.</span>
            </div>
          </label>
          <label class="choice-card ${currentBaseUrlPref === 'environment' ? 'selected' : ''}">
            <input type="radio" name="baseUrlPreference" value="environment" ${currentBaseUrlPref === 'environment' ? 'checked' : ''} />
            <div class="choice-info">
              <span class="choice-label">Environment Always (Classic)</span>
              <span class="choice-desc">The active environment unconditionally overwrites <code>{{baseUrl}}</code> for all collections.</span>
            </div>
          </label>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">⚙ Active Environment Selection</div>
        <div class="settings-card-desc">
          Select which environment is currently active for interpolating variables and headers.
        </div>
        <div class="form-group" style="max-width: 480px;">
          <label>Active Environment</label>
          <select id="select-active-env" class="form-select">${envOptionsHtml}</select>
        </div>
      </div>
    </div>

    <!-- TAB 3: NETWORK & REQUESTS -->
    <div id="tab-network" class="tab-page ${initialTab === 'network' ? 'active' : ''}">
      <div class="settings-card">
        <div class="settings-card-title">⚡ Request &amp; Timeout Defaults</div>
        <div class="form-group" style="max-width: 360px;">
          <label>Default Request Timeout (milliseconds)</label>
          <input id="net-timeout-input" class="form-input" type="number" min="1000" max="120000" step="1000" value="${currentTimeout}" />
          <span style="font-size: 11px; color: var(--muted);">Maximum time to wait before aborting request (default: 30,000 ms).</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input id="net-follow-redirects" type="checkbox" ${currentFollowRedirects ? 'checked' : ''} />
            <span>Follow HTTP 3xx Redirects automatically</span>
          </label>
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input id="net-strict-ssl" type="checkbox" ${currentStrictSsl ? 'checked' : ''} />
            <span>Reject Unauthorized SSL / TLS Certificates (Strict SSL)</span>
          </label>
        </div>
      </div>
    </div>

    <!-- TAB 4: TOKEN VAULT -->
    <div id="tab-tokens" class="tab-page ${initialTab === 'tokens' ? 'active' : ''}">
      <div class="settings-card">
        <div class="settings-card-title" style="justify-content: space-between;">
          <span>🔑 Stored OAuth &amp; Auth Tokens (${storedTokens.length})</span>
          <button id="btn-prune-tokens" class="btn btn-secondary" style="font-size: 11px;">Clear Expired</button>
        </div>
        <div class="settings-card-desc">
          Tokens securely stored in VS Code SecretStorage for auto-injection into requests.
        </div>
        ${storedTokens.length === 0 ? '<div style="color: var(--muted); padding: 12px 0;">No tokens stored. Tokens fetched via OAuth 2.0 or authorization scripts appear here.</div>' : `
          <table class="token-table">
            <thead>
              <tr>
                <th>Token Name</th>
                <th>Profile</th>
                <th>Environment</th>
                <th>Access Token</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${storedTokens.map(t => `
                <tr>
                  <td><strong>${escapeHtml(t.tokenName || t.id)}</strong></td>
                  <td>${escapeHtml(t.profileName || t.profileId)}</td>
                  <td>${escapeHtml(t.envName || 'Default')}</td>
                  <td><span class="token-code">${escapeHtml(t.accessToken.substring(0, 10))}...</span></td>
                  <td>${t.expiresAt ? new Date(t.expiresAt).toLocaleTimeString() : 'Never'}</td>
                  <td>
                    <button class="btn btn-secondary btn-copy-token" data-token="${escapeAttr(t.accessToken)}" style="padding: 2px 8px; font-size: 11px;">Copy</button>
                    <button class="btn btn-danger btn-delete-token" data-token-id="${escapeAttr(t.id)}" data-profile-id="${escapeAttr(t.profileId)}" style="padding: 2px 8px; font-size: 11px;">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    </div>

    <!-- TAB 5: DATA & BACKUP -->
    <div id="tab-data" class="tab-page ${initialTab === 'data' ? 'active' : ''}">
      <div class="settings-card">
        <div class="settings-card-title">💾 Backup &amp; Recovery</div>
        <div class="settings-card-desc">
          Export your entire byrdsnest api client workspace state (all collections, environments, profiles, and history) or restore from an existing JSON backup.
        </div>
        <div style="display: flex; gap: 12px; margin-top: 10px;">
          <button id="btn-export-backup" class="btn btn-primary">Export Workspace Backup (.json)</button>
          <button id="btn-import-backup" class="btn btn-secondary">Import / Restore Backup...</button>
        </div>
      </div>
    </div>

  </div>

  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      let currentProfId = "${escapeAttr(currentProfile?.id || 'global')}";
      let currentActiveTab = "${escapeAttr(initialTab || 'profiles')}";
      let initialVars = ${JSON.stringify(profileVars)};
      let initialHeaders = ${JSON.stringify(profileHeaders)};

      // Navigation Tabs
      document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
          document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
          document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
          item.classList.add('active');
          const page = document.getElementById(item.getAttribute('data-tab'));
          if (page) page.classList.add('active');
          const rawTab = (item.getAttribute('data-tab') || '').replace(/^tab-/, '');
          if (rawTab) currentActiveTab = rawTab;
        });
      });

      // Sub-tabs
      document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
          btn.classList.add('active');
          const target = document.getElementById(btn.getAttribute('data-subtab'));
          if (target) target.classList.add('active');
        });
      });

      // Radio choice cards
      document.querySelectorAll('.choice-card').forEach(card => {
        card.addEventListener('click', () => {
          const radio = card.querySelector('input[type="radio"]');
          if (radio) {
            radio.checked = true;
            document.querySelectorAll('.choice-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
          }
        });
      });

      // Profile switching
      document.querySelectorAll('.profile-card').forEach(card => {
        card.addEventListener('click', () => {
          const pId = card.getAttribute('data-profile-id');
          if (pId && pId !== currentProfId) {
            vscode.postMessage({ type: 'switchProfileView', profileId: pId });
          }
        });
      });

      // Activate Profile
      const btnActivate = document.getElementById('btn-activate-profile');
      if (btnActivate) {
        btnActivate.addEventListener('click', () => {
          vscode.postMessage({ type: 'setActiveProfile', profileId: currentProfId });
        });
      }

      // New Profile
      const btnNew = document.getElementById('btn-new-profile');
      if (btnNew) {
        btnNew.addEventListener('click', () => {
          vscode.postMessage({ type: 'createProfile' });
        });
      }

      // Delete Profile
      const btnDel = document.getElementById('btn-delete-profile');
      if (btnDel) {
        btnDel.addEventListener('click', () => {
          vscode.postMessage({ type: 'deleteProfile', profileId: currentProfId });
        });
      }

      // Color Theme swatches & pickers
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

      // Variable rows builder
      const varsContainer = document.getElementById('prof-vars-container');
      function addVarRow(name = '', value = '', enabled = true, hidden = false) {
        const row = document.createElement('div');
        row.className = 'param-row';
        row.innerHTML = \`
          <input type="checkbox" \${enabled ? 'checked' : ''} data-role="enabled" />
          <input class="param-input" type="text" placeholder="Variable Name" value="\${String(name).replace(/"/g, '&quot;')}" data-role="name" />
          <input class="param-input" type="\${hidden ? 'password' : 'text'}" placeholder="Value" value="\${String(value).replace(/"/g, '&quot;')}" data-role="value" />
          <label style="font-size:11px; color:var(--muted); display:flex; align-items:center; gap:4px; cursor:pointer;">
            <input type="checkbox" \${hidden ? 'checked' : ''} data-role="hidden" /> Mask
          </label>
          <button class="icon-btn" title="Delete" data-role="delete">✕</button>
        \`;
        const hiddenBox = row.querySelector('[data-role="hidden"]');
        const valInp = row.querySelector('[data-role="value"]');
        hiddenBox.addEventListener('change', () => {
          valInp.type = hiddenBox.checked ? 'password' : 'text';
        });
        row.querySelector('[data-role="delete"]').addEventListener('click', () => row.remove());
        varsContainer.appendChild(row);
      }

      // Headers rows builder
      const headersContainer = document.getElementById('prof-headers-container');
      function addHeaderRow(key = '', value = '', enabled = true) {
        const row = document.createElement('div');
        row.className = 'param-row header-row';
        row.innerHTML = \`
          <input type="checkbox" \${enabled ? 'checked' : ''} data-role="enabled" />
          <input class="param-input" type="text" placeholder="Header Name" value="\${String(key).replace(/"/g, '&quot;')}" data-role="key" />
          <input class="param-input" type="text" placeholder="Value" value="\${String(value).replace(/"/g, '&quot;')}" data-role="value" />
          <button class="icon-btn" title="Delete" data-role="delete">✕</button>
        \`;
        row.querySelector('[data-role="delete"]').addEventListener('click', () => row.remove());
        headersContainer.appendChild(row);
      }

      // Populate initial vars and headers
      Object.entries(initialVars).forEach(([k, v]) => addVarRow(k, v));
      Object.entries(initialHeaders).forEach(([k, v]) => addHeaderRow(k, v));

      document.getElementById('btn-add-prof-var').addEventListener('click', () => addVarRow());
      document.getElementById('btn-add-prof-header').addEventListener('click', () => addHeaderRow());

      // Token actions
      document.querySelectorAll('.btn-copy-token').forEach(btn => {
        btn.addEventListener('click', () => {
          const tok = btn.getAttribute('data-token');
          if (tok) {
            navigator.clipboard.writeText(tok);
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          }
        });
      });

      document.querySelectorAll('.btn-delete-token').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-token-id');
          const profId = btn.getAttribute('data-profile-id');
          vscode.postMessage({ type: 'deleteToken', tokenId: id, profileId: profId });
        });
      });

      const btnPrune = document.getElementById('btn-prune-tokens');
      if (btnPrune) {
        btnPrune.addEventListener('click', () => {
          vscode.postMessage({ type: 'pruneTokens' });
        });
      }

      // Backup actions
      document.getElementById('btn-export-backup').addEventListener('click', () => {
        vscode.postMessage({ type: 'exportBackup' });
      });
      document.getElementById('btn-import-backup').addEventListener('click', () => {
        vscode.postMessage({ type: 'importBackup' });
      });

      ${getSharedAuthClientScript()}

      // Save action
      document.getElementById('btn-save-all').addEventListener('click', () => {
        // Collect variables
        const vars = {};
        varsContainer.querySelectorAll('.param-row').forEach(row => {
          const k = row.querySelector('[data-role="name"]').value.trim();
          const v = row.querySelector('[data-role="value"]').value;
          const en = row.querySelector('[data-role="enabled"]').checked;
          if (k && en) vars[k] = v;
        });

        // Collect headers
        const hdrs = {};
        headersContainer.querySelectorAll('.param-row').forEach(row => {
          const k = row.querySelector('[data-role="key"]').value.trim();
          const v = row.querySelector('[data-role="value"]').value;
          const en = row.querySelector('[data-role="enabled"]').checked;
          if (k && en) hdrs[k] = v;
        });

        // Collect Auth
        const auth = extractAuthValues();

        // Base URL preference
        const selectedPref = document.querySelector('input[name="baseUrlPreference"]:checked')?.value || 'auto';
        const activeEnv = document.getElementById('select-active-env')?.value;
        const timeout = parseInt(document.getElementById('net-timeout-input')?.value, 10) || 30000;
        const followRedirects = document.getElementById('net-follow-redirects')?.checked !== false;
        const strictSsl = document.getElementById('net-strict-ssl')?.checked !== false;
        // Safety Guards
        const guardEnabled = document.getElementById('guard-enabled')?.checked || false;
        const guardWarnSend = document.getElementById('guard-warn-send')?.checked || false;
        const guardWarnMsg = document.getElementById('guard-warn-msg')?.value?.trim() || '';
        const guardBlockedMethods = Array.from(document.querySelectorAll('.guard-method-cb:checked')).map(cb => cb.value);
        const guardKeywordReq = document.getElementById('guard-keyword-req')?.checked || false;
        const guardKeyword = document.getElementById('guard-keyword')?.value?.trim() || 'CONFIRM';

        const profileGuards = {
          enabled: guardEnabled,
          warnBeforeSend: guardWarnSend,
          warnMessage: guardWarnMsg,
          blockedMethods: guardBlockedMethods,
          requireKeywordConfirmation: guardKeywordReq,
          confirmationKeyword: guardKeyword
        };

        vscode.postMessage({
          type: 'saveSettings',
          payload: {
            activeTab: currentActiveTab,
            profileId: currentProfId,
            profileName: document.getElementById('prof-name-input')?.value || '',
            profileColor: document.getElementById('prof-color-input')?.value || document.getElementById('prof-color-picker')?.value || undefined,
            profileNotes: document.getElementById('prof-notes-input')?.value || '',
            variables: vars,
            headers: hdrs,
            auth: auth,
            profileGuards: profileGuards,
            baseUrlPreference: selectedPref,
            activeEnvironment: activeEnv,
            settings: {
              baseUrlPreference: selectedPref,
              requestTimeoutMs: timeout,
              followRedirects: followRedirects,
              rejectUnauthorized: strictSsl
            }
          }
        });

        const btnSave = document.getElementById('btn-save-all');
        if (btnSave) {
          btnSave.textContent = 'Saving...';
          btnSave.disabled = true;
        }
      });

      // Handle messages from extension host
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && msg.type === 'settingsSaved') {
          const btnSave = document.getElementById('btn-save-all');
          if (btnSave) {
            btnSave.textContent = '✔ Saved!';
            btnSave.style.background = 'var(--success, #10b981)';
            setTimeout(() => {
              btnSave.textContent = 'Save Changes';
              btnSave.style.background = '';
              btnSave.disabled = false;
            }, 1200);
          }
        }
      });

      const selectActiveEnv = document.getElementById('select-active-env');
      if (selectActiveEnv) {
        selectActiveEnv.addEventListener('change', () => {
          vscode.postMessage({
            type: 'setActiveEnvironment',
            environmentName: selectActiveEnv.value
          });
        });
      }

      // Ctrl+Z and Ctrl+Y support
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
    })();
  </script>
</body>
</html>`;
}
