import { AppState, EnvironmentConfig, InheritedHeaderInfo, InheritedVariableInfo, RequestContext, StoredToken } from '../../types';
import { renderAuthCss, renderAuthFieldsHtml, getSharedAuthClientScript } from './sharedAuthHtml';

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getRequestPanelHtml(
  context: RequestContext,
  state: AppState,
  initialInheritedVars: InheritedVariableInfo[] = [],
  initialInheritedHeaders: InheritedHeaderInfo[] = [],
  availableTokens: StoredToken[] = [],
  initialResolvedVars: Record<string, string> = {}
): string {
  const activeProfile = context.profileId || context.profile || (state.activeProfileId !== 'all' ? state.activeProfileId : undefined) || state.profiles[0]?.id;
  const activeProfileObj = state.profiles.find((p) => p.id === activeProfile || p.name === activeProfile) || state.profiles[0];
  const activeProfileColor = activeProfileObj?.color || '#3b82f6';
  const profileOptions = state.profiles
    .map((p) => {
      const isDuplicate = state.profiles.filter((o) => o.name === p.name).length > 1;
      const label = isDuplicate ? `${p.name} (${p.id.replace(/^profile-/, '')})` : p.name;
      const isSelected = p.id === activeProfile || p.name === activeProfile;
      const guardsJson = p.guards ? escapeHtml(JSON.stringify(p.guards)) : '';
      return `<option value="${escapeHtml(p.name)}" data-id="${escapeHtml(p.id)}" data-color="${escapeHtml(p.color || '#3b82f6')}" data-guards="${guardsJson}" ${isSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');

  const activeProfileId = state.activeProfileId;
  const isFiltered = activeProfileId && activeProfileId !== 'all';
  const envEntries = Object.entries(state.environments).filter(([name, env]) => {
    if (!isFiltered) return true;
    if (activeProfileId === 'global') return !env.profileId || env.profileId === 'global';
    return env.profileId === activeProfileId || !env.profileId || env.profileId === 'global';
  });
  const envKeys = envEntries.map(([name]) => name);
  const activeEnv = context.environment !== undefined ? context.environment : (state.activeEnvironmentName || '');
  const selectedEnvKey = activeEnv ? (envKeys.find(k => k === activeEnv || state.environments[k]?.id === activeEnv) || '') : '';

  // Lookup maps for inheritance resolution
  const envById = new Map<string, { name: string; env: EnvironmentConfig }>();
  const envByName = new Map<string, { name: string; env: EnvironmentConfig }>();
  for (const [name, env] of envEntries) {
    envByName.set(name, { name, env });
    if (env.id) envById.set(env.id, { name, env });
  }

  // Split into profile-specific and shared if active profile is set
  const hasSplit = isFiltered && activeProfileId !== 'global';
  const profileEnvs: Array<[string, EnvironmentConfig]> = [];
  const sharedEnvs: Array<[string, EnvironmentConfig]> = [];
  envEntries.forEach(([name, env]) => {
    if (hasSplit && env.profileId === activeProfileId) {
      profileEnvs.push([name, env]);
    } else {
      sharedEnvs.push([name, env]);
    }
  });

  const renderGroupTree = (entries: Array<[string, EnvironmentConfig]>): string[] => {
    const childrenMap = new Map<string, Array<{ name: string; env: EnvironmentConfig }>>();
    const rootEntries: Array<{ name: string; env: EnvironmentConfig }> = [];

    for (const [name, env] of entries) {
      const parentRef = env.inheritsFrom;
      const parentEntry = parentRef ? (envById.get(parentRef) || envByName.get(parentRef)) : undefined;

      if (parentEntry && parentEntry.name !== name && entries.some(([eName]) => eName === parentEntry.name)) {
        const key = parentEntry.env.id || parentEntry.name;
        if (!childrenMap.has(key)) {
          childrenMap.set(key, []);
        }
        childrenMap.get(key)!.push({ name, env });
      } else {
        rootEntries.push({ name, env });
      }
    }

    const renderedEnvNames = new Set<string>();
    const lines: string[] = [];

    const renderEnvOption = (name: string, env: EnvironmentConfig, depth: number, visited: Set<string>) => {
      const key = env.id || name;
      if (visited.has(key)) return;
      const nextVisited = new Set(visited).add(key);
      renderedEnvNames.add(name);

      const rawChildren = childrenMap.get(key) || [];
      const validChildren = rawChildren.filter(c => !visited.has(c.env.id || c.name));
      const hasChildren = validChildren.length > 0;

      const parentEntry = env.inheritsFrom ? (envById.get(env.inheritsFrom) || envByName.get(env.inheritsFrom)) : undefined;
      const parentDisplayName = parentEntry ? parentEntry.name : env.inheritsFrom;

      let label = '';
      if (depth > 0) {
        const indent = '\u00A0\u00A0'.repeat(depth) + '↳ ';
        label = `${indent}${name}`;
        if (parentDisplayName) {
          label += ` (inherits: ${parentDisplayName})`;
        }
        if (hasChildren) {
          label += ` [Parent (${validChildren.length})]`;
        }
      } else {
        label = name;
        if (hasChildren) {
          label += ` (Parent • ${validChildren.length} ${validChildren.length === 1 ? 'child' : 'children'})`;
        } else if (parentDisplayName) {
          label += ` (inherits: ${parentDisplayName})`;
        }
      }

      const isSelected = Boolean(selectedEnvKey) && name === selectedEnvKey;
      lines.push(
        `<option value="${escapeHtml(name)}" ${isSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`
      );

      for (const child of validChildren) {
        renderEnvOption(child.name, child.env, depth + 1, nextVisited);
      }
    };

    for (const root of rootEntries) {
      renderEnvOption(root.name, root.env, 0, new Set());
    }

    for (const [name, env] of entries) {
      if (!renderedEnvNames.has(name)) {
        renderEnvOption(name, env, 0, new Set());
      }
    }

    return lines;
  };

  const optionLines: string[] = [];
  optionLines.push(
    `<option value="" ${!selectedEnvKey ? 'selected' : ''}>No Environment (Collection Defaults)</option>`
  );

  if (hasSplit && profileEnvs.length > 0 && sharedEnvs.length > 0) {
    optionLines.push(`<optgroup label="Profile Environments (${escapeHtml(activeProfileObj ? activeProfileObj.name : 'Profile')})">`);
    optionLines.push(...renderGroupTree(profileEnvs));
    optionLines.push(`</optgroup>`);
    optionLines.push(`<optgroup label="Shared / Global Environments">`);
    optionLines.push(...renderGroupTree(sharedEnvs));
    optionLines.push(`</optgroup>`);
  } else {
    optionLines.push(...renderGroupTree(envEntries));
  }

  const environmentOptions = optionLines.join('');

  const environmentsData = Object.entries(state.environments).map(([name, env]) => ({
    id: env.id,
    name,
    inheritsFrom: env.inheritsFrom,
    profileId: env.profileId,
    baseUrl: env.baseUrl,
    baseUrlDisabled: env.baseUrlDisabled,
  }));

  const collectionName = escapeHtml(context.collection || state.collections[0]?.name || 'Demo Collection');
  const displayFolder = escapeHtml(context.folder && context.folder !== 'Root' ? context.folder : 'Root');
  const rawRequestName = context.requestName || (context as any).name || (context.url ? `${context.method || 'GET'} ${context.url}` : 'New Request');
  const requestName = escapeHtml(rawRequestName);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${requestName || 'byrdsnest api client Request'}</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --panel: var(--vscode-sideBar-background);
      --surface: var(--vscode-input-background, #252526);
      --border: var(--vscode-panel-border, var(--vscode-input-border, #3c3c3c));
      --text: var(--vscode-editor-foreground, #cccccc);
      --muted: var(--vscode-descriptionForeground, #8c8c8c);
      --profile-accent: ${activeProfileColor || 'var(--vscode-button-background, #0e639c)'};
      --primary: var(--profile-accent);
      --primary-fg: var(--vscode-button-foreground, #ffffff);
      --success: var(--vscode-testing-iconPassed, #4ec9b0);
      --danger: var(--vscode-testing-iconFailed, #f14c4c);
      --warning: #cca700;
      --badge-bg: var(--vscode-badge-background, rgba(255,255,255,0.08));
      --badge-fg: var(--vscode-badge-foreground, var(--text));
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      min-height: 100%;
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
    }
    body {
      padding: 14px;
      box-sizing: border-box;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .app {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: calc(100vh - 28px);
      height: calc(100vh - 28px);
    }

    /* Top Context Bar */
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
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .crumb-pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--badge-bg);
      border: 1px solid var(--border);
      color: var(--text);
      font-weight: 500;
    }
    .crumb-separator { color: var(--muted); }
    .crumb-request-wrapper {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1px 4px 1px 8px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    }
    .crumb-request-wrapper:hover {
      border-color: var(--primary);
    }
    .crumb-request-wrapper:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
      background: var(--bg);
    }
    .crumb-request-icon {
      color: var(--muted);
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .crumb-request-input {
      background: transparent;
      border: none;
      color: var(--text);
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 2px 4px;
      outline: none;
      min-width: 140px;
      max-width: 320px;
    }
    .crumb-request-input::placeholder {
      color: var(--muted);
      font-weight: normal;
    }
    .crumb-rename-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--muted);
      cursor: pointer;
      padding: 3px;
      border-radius: 3px;
      transition: color 0.15s ease, background 0.15s ease;
      flex-shrink: 0;
    }
    .crumb-rename-btn:hover {
      color: var(--success);
      background: rgba(78, 201, 176, 0.15);
    }
    .crumb-rename-btn.saved-flash {
      color: var(--success);
      animation: pulse-saved 0.6s ease;
    }
    @keyframes pulse-saved {
      0% { transform: scale(1); }
      50% { transform: scale(1.3); color: #4ec9b0; }
      100% { transform: scale(1); }
    }

    .selectors {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .selector-group {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .select-control {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      outline: none;
    }

    /* URL / Action Toolbar */
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px;
    }
    .method-select {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 4px;
      padding: 6px 10px;
      font-weight: 600;
      min-width: 100px;
      outline: none;
    }
    .url-input-container {
      position: relative;
      flex: 1;
      display: flex;
      align-items: center;
      min-width: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .url-input-container:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .input-highlight-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      overflow: hidden;
      white-space: pre;
      font-family: monospace;
      font-size: 13px;
      line-height: normal;
      padding: 7px 12px;
      color: transparent;
      box-sizing: border-box;
      user-select: none;
      display: flex;
      align-items: center;
    }
    .url-input {
      width: 100%;
      background: transparent !important;
      border: none !important;
      color: var(--text);
      padding: 7px 12px;
      font-family: monospace;
      font-size: 13px;
      outline: none;
      position: relative;
      z-index: 1;
    }

    /* Button styles */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 7px 14px;
      border-radius: 4px;
      border: 1px solid transparent;
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
      outline: none;
      user-select: none;
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
    .btn-secondary:hover { background: rgba(255,255,255,0.06); }
    #btn-save.dirty {
      border-color: #f59e0b;
      color: #ffffff;
      background: rgba(245, 158, 11, 0.18);
      font-weight: 600;
      box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.4);
    }

    .btn-group {
      display: inline-flex;
      position: relative;
    }
    .btn-split-main {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    .btn-split-toggle {
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left: 1px solid rgba(255,255,255,0.18);
      padding: 7px 8px;
    }

    .dropdown-menu {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 100;
      min-width: 140px;
    }
    .dropdown-menu.show { display: flex; flex-direction: column; }
    .dropdown-item {
      padding: 8px 12px;
      background: transparent;
      border: none;
      color: var(--text);
      text-align: left;
      cursor: pointer;
      font-size: 12px;
    }
    .dropdown-item:hover { background: rgba(255,255,255,0.08); }

    /* Main Grid: Request on left, Response on right */
    .main-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 1fr);
      gap: 12px;
      flex: 1;
      min-height: 0;
    }
    @media (max-width: 960px) {
      .main-grid { grid-template-columns: 1fr; }
    }

    .panel-box {
      display: flex;
      flex-direction: column;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      min-height: 0;
      flex: 1;
      height: 100%;
    }

    /* Tabs */
    .tab-header {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,0.15);
      overflow: hidden;
      padding: 0 4px;
      flex-shrink: 0;
      flex-wrap: nowrap;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .tab-header::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    .tab-btn {
      padding: 8px 12px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      margin-bottom: -1px;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      transition: all 0.15s ease;
      flex: 0 1 auto;
      min-width: 0;
    }
    .tab-btn:hover {
      color: var(--text);
      background: rgba(255,255,255,0.03);
    }
    .tab-btn.active {
      color: var(--text);
      font-weight: 600;
      border-bottom-color: var(--primary);
      background: rgba(255,255,255,0.05);
    }
    .tab-content {
      padding: 12px;
      flex: 1;
      display: none;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
    }
    .tab-content.active {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
    }
    #tab-resp-body {
      padding: 0;
    }
    #tab-resp-body.active {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
    }
    #tab-resp-headers {
      padding: 0;
    }

    /* Tables & Rows */
    .param-table {
      width: 100%;
      border-collapse: collapse;
    }
    .param-row {
      display: grid;
      grid-template-columns: 32px 1fr 1fr 70px 36px;
      gap: 6px;
      align-items: center;
      margin-bottom: 6px;
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

    /* Inherited Sections & Tables */
    .inherited-section {
      margin-top: 14px;
      border-top: 1px solid var(--border);
      padding-top: 12px;
    }
    .inherited-header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .inherited-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .inherited-table {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .inherited-row {
      display: grid;
      grid-template-columns: 1fr 1.2fr auto auto;
      gap: 8px;
      align-items: center;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 12px;
      transition: background 0.15s ease;
    }
    .inherited-row:hover {
      background: rgba(255, 255, 255, 0.04);
    }
    .inherited-row.is-overridden {
      opacity: 0.55;
    }
    .inherited-row.is-overridden .inherited-key,
    .inherited-row.is-overridden .inherited-val {
      text-decoration: line-through;
    }
    .inherited-key {
      font-family: monospace;
      font-weight: 600;
      color: #9cdcfe;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inherited-val {
      font-family: monospace;
      color: #ce9178;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .source-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      white-space: nowrap;
    }
    .source-dynamic { background: rgba(78, 201, 176, 0.15); color: #4ec9b0; border: 1px solid rgba(78, 201, 176, 0.3); }
    .source-profile { background: rgba(79, 193, 255, 0.15); color: #4fc1ff; border: 1px solid rgba(79, 193, 255, 0.3); }
    .source-parent-environment { background: rgba(197, 134, 192, 0.15); color: #c586c0; border: 1px solid rgba(197, 134, 192, 0.3); }
    .source-environment { background: rgba(206, 145, 120, 0.15); color: #ce9178; border: 1px solid rgba(206, 145, 120, 0.3); }
    .source-collection { background: rgba(78, 201, 176, 0.15); color: #4ec9b0; border: 1px solid rgba(78, 201, 176, 0.3); }
    .source-folder { background: rgba(220, 220, 170, 0.15); color: #dcdcaa; border: 1px solid rgba(220, 220, 170, 0.3); }
    .overridden-pill {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(241, 76, 76, 0.15);
      color: #f14c4c;
      border: 1px solid rgba(241, 76, 76, 0.3);
      margin-left: 6px;
    }
    .override-btn {
      font-size: 11px;
      padding: 2px 8px;
      height: 24px;
      cursor: pointer;
    }
    .btn-toggle-dynamic {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: 10px;
      font-weight: 500;
      cursor: pointer;
      padding: 1px 7px;
      border-radius: 3px;
      transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    }
    .btn-toggle-dynamic:hover {
      color: var(--text);
      border-color: var(--primary);
      background: var(--bg);
    }

    /* Collapsible source groups in inherited vars/headers */
    .var-group {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      border-radius: 5px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .var-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      background: rgba(255,255,255,0.025);
      user-select: none;
      transition: background 0.12s ease;
    }
    .var-group-header:hover {
      background: rgba(255,255,255,0.05);
    }
    .var-group-chevron {
      font-size: 9px;
      color: var(--muted);
      transition: transform 0.18s ease;
      flex-shrink: 0;
      margin-left: auto;
    }
    .var-group-header.collapsed .var-group-chevron {
      transform: rotate(-90deg);
    }
    .var-group-name {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .var-group-count {
      font-size: 10px;
      color: var(--muted);
      background: rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 1px 6px;
      flex-shrink: 0;
    }
    .var-group-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px 6px 6px 6px;
      background: rgba(255,255,255,0.01);
    }
    .var-group-header.collapsed + .var-group-body {
      display: none;
    }
    /* Slightly tighter rows inside groups */
    .var-group .inherited-row {
      border-radius: 3px;
    }

    .textarea-box {
      width: 100%;
      height: 100%;
      min-height: 0;
      flex: 1;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 4px;
      font-family: Consolas, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.5;
      resize: none;
      outline: none;
      box-sizing: border-box;
      tab-size: 2;
    }
    .textarea-box:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }

    /* Code Editor with Live Syntax Highlighting & Line Numbers */
    .code-editor-container {
      display: flex;
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      overflow: hidden;
      position: relative;
      box-sizing: border-box;
    }
    .code-editor-container:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .code-editor-gutter {
      width: 44px;
      padding: 10px 8px 10px 0;
      text-align: right;
      font-family: Consolas, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.5;
      color: var(--muted);
      background: rgba(0, 0, 0, 0.18);
      border-right: 1px solid var(--border);
      user-select: none;
      overflow: hidden;
      white-space: pre;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .code-editor-surface {
      position: relative;
      flex: 1;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .code-editor-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      margin: 0;
      padding: 10px 12px;
      font-family: Consolas, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.5;
      tab-size: 2;
      pointer-events: none;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-all;
      box-sizing: border-box;
      background: transparent;
      color: var(--text);
    }
    .code-editor-backdrop code {
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      background: transparent;
      padding: 0;
    }
    .code-editor-textarea {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 10px 12px;
      font-family: Consolas, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.5;
      tab-size: 2;
      color: transparent;
      caret-color: var(--vscode-editorCursor-foreground, #aeafad);
      background: transparent;
      border: none;
      outline: none;
      resize: none;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
      box-sizing: border-box;
      z-index: 2;
    }
    .code-editor-textarea::selection {
      background: rgba(14, 99, 156, 0.45);
      color: transparent;
    }

    .json-variable {
      color: #4ec9b0;
      background: rgba(78, 201, 176, 0.14);
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: 600;
      border: 1px solid rgba(78, 201, 176, 0.3);
    }
    .json-punct {
      color: var(--text, #d4d4d4);
      opacity: 0.85;
    }

    /* Body Type Selector as Connected Subtabs */
    .body-nav {
      display: flex;
      gap: 2px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--border);
      overflow: hidden;
      align-items: flex-end;
      padding: 0;
      flex-shrink: 0;
      flex-wrap: nowrap;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .body-nav::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    .radio-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      cursor: pointer;
      padding: 7px 13px;
      border: none;
      border-bottom: 2px solid transparent;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      margin-bottom: -1px;
      user-select: none;
      white-space: nowrap;
      transition: all 0.15s ease;
      background: transparent;
    }
    .radio-pill input[type="radio"] {
      display: none;
    }
    .radio-pill:hover {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
    }
    .radio-pill.selected {
      color: var(--text);
      font-weight: 600;
      background: rgba(255, 255, 255, 0.05);
      border-bottom-color: var(--primary);
    }
    .body-subview {
      display: none;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
    }
    .script-subview {
      display: none;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
    }
    .body-subview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      flex-shrink: 0;
    }
    .body-mime-badge {
      font-size: 11px;
      color: var(--muted);
      font-family: monospace;
    }

    /* Auth tab */
    .auth-config {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 480px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-group label {
      font-size: 12px;
      color: var(--muted);
    }

    /* Response Panel */
    .response-status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: rgba(0,0,0,0.2);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 8px;
    }
    .status-badges {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
      color: #ffffff;
      background: #555555;
    }
    .pill.status-2xx { background: #238636; }
    .pill.status-3xx { background: #1f6feb; }
    .pill.status-4xx { background: #d29922; }
    .pill.status-5xx { background: #da3633; }
    .pill.status-err { background: #da3633; }

    .meta-tag {
      font-size: 11px;
      color: var(--muted);
    }

    .response-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Tabular Response View */
    .resp-table-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
      background: var(--surface);
      overflow: hidden;
    }
    .table-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 12px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    .table-toolbar-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .table-toolbar-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .table-breadcrumbs {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .table-crumb-link {
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      text-decoration: none;
      font-weight: 500;
    }
    .table-crumb-link:hover {
      text-decoration: underline;
    }
    .table-crumb-active {
      color: var(--text);
      font-weight: 600;
    }
    .table-crumb-sep {
      color: var(--muted);
      font-size: 11px;
    }
    .table-btn-back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      cursor: pointer;
      font-family: inherit;
    }
    .table-btn-back:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: var(--primary);
    }
    .table-filter-input {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      width: 140px;
      outline: none;
      font-family: inherit;
    }
    .table-filter-input:focus {
      border-color: var(--primary);
    }
    .table-scroll-container {
      flex: 1;
      overflow: auto;
      min-height: 0;
    }
    .resp-table {
      width: 100%;
      border-collapse: collapse;
      font-family: Consolas, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.45;
      table-layout: auto;
    }
    .resp-table th {
      position: sticky;
      top: 0;
      background: var(--panel);
      z-index: 2;
      text-align: left;
      padding: 6px 10px;
      border-bottom: 2px solid var(--border);
      border-right: 1px solid rgba(128, 128, 128, 0.15);
      font-weight: 600;
      color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);
      white-space: nowrap;
      user-select: none;
    }
    .resp-table th.col-index {
      width: 44px;
      text-align: center;
      color: var(--muted);
      font-weight: normal;
    }
    .resp-table td {
      padding: 5px 10px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.12);
      border-right: 1px solid rgba(128, 128, 128, 0.1);
      max-width: 340px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: middle;
    }
    .resp-table td.col-index {
      text-align: center;
      color: var(--muted);
      font-size: 11px;
      background: rgba(0, 0, 0, 0.1);
      user-select: none;
    }
    .resp-table tbody tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.018);
    }
    .resp-table tbody tr:hover {
      background: rgba(255, 255, 255, 0.045);
    }
    .table-array-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(78, 201, 176, 0.15);
      border: 1px solid rgba(78, 201, 176, 0.4);
      color: #4ec9b0;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      font-family: inherit;
      transition: all 0.15s ease;
    }
    .table-array-badge:hover {
      background: rgba(78, 201, 176, 0.28);
      border-color: #4ec9b0;
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .table-obj-badge {
      display: inline-block;
      color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);
      font-style: italic;
      font-size: 11px;
    }
    .table-cell-null {
      color: var(--muted);
      font-style: italic;
    }
    .table-cell-bool {
      color: #569cd6;
      font-weight: 600;
    }
    .table-cell-num {
      color: #b5cea8;
    }
    .table-cell-str {
      color: var(--text);
    }
    .table-empty-msg {
      padding: 24px;
      text-align: center;
      color: var(--muted);
      font-size: 12px;
    }

    .response-body-pre {
      flex: 1;
      margin: 0;
      padding: 12px;
      background: var(--surface);
      color: var(--text);
      font-family: Consolas, Monaco, "Courier New", monospace;
      font-size: 12px;
      white-space: pre-wrap;
      line-height: 1.5;
      overflow: auto;
    }
    .json-tree-root {
      font-family: Consolas, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.55;
    }
    .json-line,
    .json-header,
    .json-closing {
      position: relative;
      padding-left: 18px;
      min-height: 18px;
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .json-header {
      cursor: pointer;
    }
    .json-toggle {
      position: absolute;
      left: 0;
      top: 1px;
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: none;
      border: none;
      padding: 0;
      color: var(--muted);
      user-select: none;
      -webkit-user-select: none;
      border-radius: 2px;
    }
    .json-toggle:hover {
      color: var(--text);
      background: rgba(128, 128, 128, 0.15);
    }
    .json-chevron {
      width: 10px;
      height: 10px;
      fill: currentColor;
      transition: transform 0.15s ease-in-out;
      transform-origin: center;
    }
    .json-collapsible.collapsed > .json-header > .json-toggle > .json-chevron {
      transform: rotate(-90deg);
    }
    .json-collapsible.collapsed > .json-children {
      display: none !important;
    }
    .json-collapsible.collapsed > .json-closing {
      display: none !important;
    }
    .json-children {
      position: relative;
      margin-left: 9px;
      padding-left: 9px;
      border-left: 1px solid rgba(128, 128, 128, 0.2);
    }
    .json-children:hover {
      border-left-color: rgba(128, 128, 128, 0.45);
    }
    .json-collapsed-preview {
      display: none;
      background: var(--vscode-badge-background, rgba(128, 128, 128, 0.2));
      color: var(--vscode-badge-foreground, var(--text));
      padding: 0 5px;
      margin-left: 6px;
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    .json-collapsed-preview:hover {
      filter: brightness(1.2);
    }
    .json-collapsible.collapsed > .json-header > .json-collapsed-preview {
      display: inline-block;
    }
    .json-collapsed-comma {
      display: none;
    }
    .json-collapsible.collapsed > .json-header > .json-collapsed-comma {
      display: inline;
    }
    .json-key {
      color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);
      font-weight: 600;
    }
    .json-colon {
      color: var(--text);
      margin-right: 4px;
    }
    .json-bracket {
      color: var(--text);
      font-weight: 500;
    }
    .json-comma {
      color: var(--text);
    }
    .json-string {
      color: var(--vscode-debugTokenExpression-string, #ce9178);
      word-break: break-all;
    }
    .json-number {
      color: var(--vscode-debugTokenExpression-number, #b5cea8);
    }
    .json-boolean {
      color: var(--vscode-debugTokenExpression-boolean, #569cd6);
      font-weight: 600;
    }
    .json-null {
      color: var(--vscode-debugTokenExpression-boolean, #569cd6);
      font-style: italic;
    }

    .headers-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .headers-table th, .headers-table td {
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
    }
    .headers-table th {
      color: var(--muted);
      position: sticky;
      top: 0;
      background: var(--panel);
      z-index: 1;
      font-weight: 600;
    }
    .headers-table td.header-key { font-weight: 600; width: 35%; word-break: break-all; }
    .headers-table td.header-val { word-break: break-all; }

    /* URL preview bar */
    .url-preview-bar {
      font-size: 11px;
      color: var(--muted);
      padding: 4px 10px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      min-height: 24px;
      line-height: 20px;
      font-family: Consolas, Monaco, "Courier New", monospace;
      white-space: nowrap;
      overflow-x: auto;
      overflow-y: hidden;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease, border-color 0.15s ease;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .url-preview-bar::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    .url-preview-bar.has-unresolved {
      background: rgba(241, 76, 76, 0.06);
      border-bottom-color: rgba(241, 76, 76, 0.3);
    }
    .url-preview-label {
      color: var(--muted);
      font-family: var(--vscode-font-family, inherit);
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .url-preview-resolved {
      flex: 1;
      display: inline-flex;
      align-items: center;
      flex-wrap: nowrap;
      overflow-x: auto;
      overflow-y: hidden;
      gap: 2px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .url-preview-resolved::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    .token-hl {
      display: inline-block;
      border-radius: 3px;
      padding: 0 1px;
      color: transparent;
      user-select: none;
      pointer-events: none;
      height: 1.2em;
      line-height: 1.2em;
      vertical-align: middle;
    }
    .token-hl.resolved {
      background: rgba(78, 201, 176, 0.28);
      border-bottom: 2px solid #4ec9b0;
    }
    .token-hl.unresolved {
      background: rgba(241, 76, 76, 0.28);
      border-bottom: 2px wavy #f14c4c;
    }

    /* Enhanced URL Preview Bar Tokens */
    .token-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-family: Consolas, Monaco, monospace;
      margin: 0 2px;
      vertical-align: middle;
      cursor: help;
      transition: all 0.12s ease;
      white-space: nowrap;
    }
    .token-pill.resolved-token {
      color: #4ec9b0;
      background: rgba(78, 201, 176, 0.12);
      border: 1px solid rgba(78, 201, 176, 0.35);
    }
    .token-pill.resolved-token:hover {
      background: rgba(78, 201, 176, 0.22);
      border-color: #4ec9b0;
    }
    .token-pill.unresolved-token {
      color: #f14c4c;
      background: rgba(241, 76, 76, 0.12);
      border: 1px solid rgba(241, 76, 76, 0.35);
    }
    .token-pill.unresolved-token:hover {
      background: rgba(241, 76, 76, 0.22);
      border-color: #f14c4c;
    }
    .token-pill .token-sym {
      font-weight: 700;
      font-size: 10px;
    }
    .token-pill .token-arrow {
      color: var(--muted);
      font-size: 10px;
    }
    .token-pill .token-val {
      color: #ce9178;
      font-weight: 600;
    }
    .token-pill.url-resolved-pill {
      cursor: pointer;
      user-select: text;
      padding: 2px 8px;
      font-size: 11px;
      max-width: calc(100% - 150px);
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.15s ease;
    }
    .token-pill.url-resolved-pill .token-val-url {
      color: #4ec9b0;
      font-weight: 600;
      letter-spacing: 0.2px;
      font-family: Consolas, Monaco, monospace;
    }
    .token-pill.url-resolved-pill:hover {
      background: rgba(78, 201, 176, 0.22);
      border-color: #4ec9b0;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    }
    .token-pill.url-resolved-pill .token-copy-icon {
      margin-left: 6px;
      font-size: 10px;
      opacity: 0.6;
      cursor: pointer;
    }
    .token-pill.url-resolved-pill:hover .token-copy-icon {
      opacity: 1;
    }
    .url-part-text {
      color: var(--foreground);
      font-family: Consolas, Monaco, monospace;
      font-size: 11px;
    }
    .tokens-summary-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      flex-shrink: 0;
      margin-left: auto;
    }
    .tokens-summary-badge.all-resolved {
      background: rgba(78, 201, 176, 0.15);
      color: #4ec9b0;
      border: 1px solid rgba(78, 201, 176, 0.3);
    }
    .tokens-summary-badge.has-unresolved {
      background: rgba(241, 76, 76, 0.15);
      color: #f14c4c;
      border: 1px solid rgba(241, 76, 76, 0.3);
    }

    /* Row Variable Resolution Chips for Headers & Variables */
    .row-var-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 10px;
      font-family: Consolas, Monaco, monospace;
      padding: 1px 6px;
      border-radius: 3px;
      white-space: nowrap;
      cursor: help;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.15s ease;
    }
    .row-var-chip.resolved {
      color: #4ec9b0;
      background: rgba(78, 201, 176, 0.12);
      border: 1px solid rgba(78, 201, 176, 0.3);
    }
    .row-var-chip.unresolved {
      color: #f14c4c;
      background: rgba(241, 76, 76, 0.12);
      border: 1px solid rgba(241, 76, 76, 0.3);
    }
    .param-input.has-unresolved-vars {
      border-color: rgba(241, 76, 76, 0.6) !important;
      background: rgba(241, 76, 76, 0.04);
    }
    .param-input.has-resolved-vars {
      border-color: rgba(78, 201, 176, 0.5) !important;
    }

    /* Auth Variable Status Banner */
    .auth-var-status {
      font-size: 11px;
      font-family: Consolas, Monaco, monospace;
      padding: 3px 8px;
      border-radius: 4px;
      margin-top: 4px;
    }
    .auth-var-status.resolved {
      background: rgba(78, 201, 176, 0.12);
      border: 1px solid rgba(78, 201, 176, 0.3);
      color: #4ec9b0;
    }
    .auth-var-status.unresolved {
      background: rgba(241, 76, 76, 0.12);
      border: 1px solid rgba(241, 76, 76, 0.3);
      color: #f14c4c;
    }

    /* Body Variable Indicator Pill */
    .body-var-indicator {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      cursor: help;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .body-var-indicator.all-resolved {
      color: #4ec9b0;
      background: rgba(78, 201, 176, 0.12);
      border: 1px solid rgba(78, 201, 176, 0.3);
    }
    .body-var-indicator.has-unresolved {
      color: #f14c4c;
      background: rgba(241, 76, 76, 0.12);
      border: 1px solid rgba(241, 76, 76, 0.3);
    }
    .url-preview-warn {
      color: #f14c4c;
      font-size: 10px;
      font-family: var(--vscode-font-family, inherit);
      flex-shrink: 0;
    }

    /* Scripts tab & Snippet Chips */
    .snippet-btn {
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      color: var(--muted);
      cursor: pointer;
      user-select: none;
      transition: all 0.12s ease;
    }
    .snippet-btn:hover {
      background: var(--primary);
      color: #ffffff;
      border-color: var(--primary);
    }
    /* Connected Subtabs (Scripts, etc.) */
    .subtab-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
      padding: 0;
    }
    .subtab-nav {
      display: flex;
      gap: 2px;
    }
    .subtab-btn {
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      padding: 7px 14px;
      margin-bottom: -1px;
      user-select: none;
      transition: all 0.15s ease;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .subtab-btn:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.03);
    }
    .subtab-btn.active,
    .script-type-btn.active {
      color: var(--text);
      font-weight: 600;
      background: rgba(255, 255, 255, 0.05);
      border-bottom-color: var(--primary);
    }
    .subtab-meta {
      font-size: 11px;
      color: var(--muted);
      padding-bottom: 6px;
      padding-right: 4px;
    }

    /* Test Results Cards */
    .test-result-card {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 8px 12px;
      border-radius: 4px;
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border);
      font-size: 12px;
    }
    .test-result-card.passed {
      border-left: 3px solid #238636;
    }
    .test-result-card.failed {
      border-left: 3px solid #f14c4c;
      background: rgba(241, 76, 76, 0.05);
    }
    .test-result-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }
    .test-pass-icon { color: #238636; font-weight: bold; }
    .test-fail-icon { color: #f14c4c; font-weight: bold; }
    .test-error-msg {
      font-size: 11px;
      color: #f14c4c;
      font-family: Consolas, Monaco, monospace;
      margin-top: 3px;
      padding: 4px 8px;
      background: rgba(241,76,76,0.1);
      border-radius: 3px;
    }

    /* Console Logs */
    .console-log-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 4px 6px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      font-family: Consolas, Monaco, monospace;
      font-size: 11px;
      line-height: 1.5;
    }
    .console-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 4px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .console-badge.log { background: rgba(255,255,255,0.1); color: var(--text); }
    .console-badge.info { background: rgba(79,193,255,0.2); color: #4fc1ff; }
    .console-badge.warn { background: rgba(204,167,0,0.2); color: #cca700; }
    .console-badge.error { background: rgba(241,76,76,0.2); color: #f14c4c; }
    .console-msg { flex: 1; word-break: break-word; white-space: pre-wrap; }
    .console-time { color: var(--muted); font-size: 10px; flex-shrink: 0; }

    ${renderAuthCss()}
  </style>
</head>
<body>
  <div class="app">
    <!-- Top Context Bar -->
    <div class="context-bar">
      <div class="breadcrumbs">
        <span class="crumb-pill" id="crumb-col" title="Collection">${collectionName}</span>
        <span class="crumb-separator">›</span>
        <span class="crumb-pill" id="crumb-folder" title="Folder">${displayFolder}</span>
        <span class="crumb-separator">›</span>
        <div class="crumb-request-wrapper" title="Request Name (click to edit, Enter to rename)">
          <span class="crumb-request-icon" title="Request">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.23 1h-1.46L3.52 9.25l-.16.32L2.01 13.9a.5.5 0 0 0 .61.61l4.33-1.35.32-.16L15.5 4.77v-1.46L13.23 1zM4.2 10.02L11.5 2.72l1.78 1.78-7.3 7.3-2.3.72.72-2.3z"/>
            </svg>
          </span>
          <input
            type="text"
            id="req-name-input"
            class="crumb-request-input"
            value="${requestName}"
            placeholder="Request Name"
            spellcheck="false"
            autocomplete="off"
            title="Click to rename request (Enter to save)"
          />
          <button id="btn-rename-req" class="crumb-rename-btn" type="button" title="Save Request Name">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="selectors">
        <div class="selector-group">
          <span id="profile-indicator-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${activeProfileColor}; box-shadow: 0 0 6px ${activeProfileColor}aa; flex-shrink: 0; margin-right: 4px;"></span>
          <span>Profile:</span>
          <select id="select-profile" class="select-control">${profileOptions}</select>
          <span id="profile-guard-badge" class="pill" style="display: none; font-size: 10px; padding: 1px 6px; margin-left: 4px; font-weight: 600; cursor: help; border-radius: 4px;">🛡️ Guarded</span>
        </div>
        <div class="selector-group">
          <span>Environment:</span>
          <select id="select-env" class="select-control">${environmentOptions}</select>
        </div>
        <div class="selector-group">
          <span>Base URL:</span>
          <select id="select-base-url-pref" class="select-control" title="Choose which Base URL has precedence for {{baseUrl}} and relative paths">
            <option value="auto" ${!context.baseUrlPreference || (context.baseUrlPreference as any) === 'auto' ? 'selected' : ''}>Auto (Collection Default)</option>
            <option value="collection" ${context.baseUrlPreference === 'collection' ? 'selected' : ''}>Collection Base URL</option>
            <option value="environment" ${context.baseUrlPreference === 'environment' ? 'selected' : ''}>Environment Base URL</option>
            <option value="none" ${context.baseUrlPreference === 'none' ? 'selected' : ''}>Disabled (No Base URL)</option>
          </select>
        </div>
        <button id="btn-open-settings" class="icon-btn" type="button" title="Open Settings & Manage Profiles" style="padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center;">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.5.5v1.2l2.5.5.3.8-1.4 1.9.8.8 2-1.3.8.3.4 2.5h1.2l.5-2.5.7-.3 2 1.3.8-.8-1.3-2 .3-.7 2.5-.5V7.4l-2.5-.5-.3-.7 1.3-2-.8-.8-2 1.3-.7-.3zM8 11c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Request Toolbar -->
    <div class="toolbar">
      <select id="method-select" class="method-select">
        <option ${context.method === 'GET' ? 'selected' : ''}>GET</option>
        <option ${context.method === 'POST' ? 'selected' : ''}>POST</option>
        <option ${context.method === 'PUT' ? 'selected' : ''}>PUT</option>
        <option ${context.method === 'PATCH' ? 'selected' : ''}>PATCH</option>
        <option ${context.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
        <option ${context.method === 'HEAD' ? 'selected' : ''}>HEAD</option>
        <option ${context.method === 'OPTIONS' ? 'selected' : ''}>OPTIONS</option>
      </select>

      <div class="url-input-container">
        <div id="url-highlight-backdrop" class="input-highlight-backdrop" aria-hidden="true"></div>
        <input
          id="url-input"
          class="url-input"
          type="text"
          placeholder="Enter URL or {{baseUrl}}/endpoint"
          value="${escapeHtml(context.url || '')}"
          spellcheck="false"
          autocomplete="off"
        />
      </div>

      <div class="btn-group">
        <button id="btn-send" class="btn btn-primary btn-split-main">Send</button>
        <button id="btn-send-toggle" class="btn btn-primary btn-split-toggle">▾</button>
        <div id="send-dropdown" class="dropdown-menu">
          <button class="dropdown-item" data-action="preview">Preview Resolved</button>
          <button class="dropdown-item" data-action="curl">Copy as cURL</button>
        </div>
      </div>

      <button id="btn-save" class="btn btn-secondary">Save</button>
    </div>

    <!-- URL Preview Bar -->
    <div id="url-preview-bar" class="url-preview-bar" style="display:none;">
      <span class="url-preview-label">→</span>
      <span class="url-preview-resolved" id="url-preview-text"></span>
      <span class="url-preview-warn" id="url-preview-warn" style="display:none;">⚠ unresolved tokens</span>
    </div>

    <!-- Main Workspace -->
    <div class="main-grid">
      <!-- Request Builder -->
      <div class="panel-box">
        <div class="tab-header">
          <button class="tab-btn active" data-tab="tab-params">Variables</button>
          <button class="tab-btn" data-tab="tab-headers">Headers</button>
          <button class="tab-btn" data-tab="tab-body">Body</button>
          <button class="tab-btn" data-tab="tab-auth">Auth</button>
          <button class="tab-btn" data-tab="tab-scripts">Scripts</button>
          <button class="tab-btn" data-tab="tab-notes">Notes</button>
        </div>

        <!-- Tab: Variables -->
        <div id="tab-params" class="tab-content active">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.5px;">Request Variables</div>
          <div id="var-rows"></div>
          <div style="margin-top: 8px;">
            <button id="btn-add-var" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;">+ Add Variable</button>
          </div>

          <div id="inherited-vars-section" class="inherited-section">
            <div class="inherited-header-bar">
              <span class="inherited-title">
                Inherited Variables
              </span>
              <div style="display:inline-flex; align-items:center; gap:6px;">
                <button id="btn-toggle-dynamic-vars" class="btn-toggle-dynamic" type="button" style="display:none;" title="Toggle built-in dynamic variables ($uuid, $timestamp, etc.)">Show Built-in Dynamic</button>
                <span class="meta-tag" id="inherited-vars-count">0 available</span>
              </div>
            </div>
            <div id="inherited-var-rows" class="inherited-table"></div>
          </div>
        </div>

        <!-- Tab: Headers -->
        <div id="tab-headers" class="tab-content">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; letter-spacing: 0.5px;">Request Headers</div>
          <div id="header-rows"></div>
          <div style="margin-top: 8px;">
            <button id="btn-add-header" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;">+ Add Header</button>
          </div>

          <div id="inherited-headers-section" class="inherited-section">
            <div class="inherited-header-bar">
              <span class="inherited-title">
                Inherited Headers
              </span>
              <span class="meta-tag" id="inherited-headers-count">0 inherited</span>
            </div>
            <div id="inherited-header-rows" class="inherited-table"></div>
          </div>
        </div>

        <!-- Tab: Body -->
        <div id="tab-body" class="tab-content">
          <div class="body-nav">
            <label class="radio-pill" data-type="none">
              <input type="radio" name="bodyType" value="none" />
              <span>none</span>
            </label>
            <label class="radio-pill" data-type="json">
              <input type="radio" name="bodyType" value="json" />
              <span>JSON</span>
            </label>
            <label class="radio-pill" data-type="form-urlencoded">
              <input type="radio" name="bodyType" value="form-urlencoded" />
              <span>x-www-form-urlencoded</span>
            </label>
            <label class="radio-pill" data-type="form-data">
              <input type="radio" name="bodyType" value="form-data" />
              <span>form-data</span>
            </label>
            <label class="radio-pill" data-type="text">
              <input type="radio" name="bodyType" value="text" />
              <span>text</span>
            </label>
            <label class="radio-pill" data-type="xml">
              <input type="radio" name="bodyType" value="xml" />
              <span>XML</span>
            </label>
            <label class="radio-pill" data-type="raw">
              <input type="radio" name="bodyType" value="raw" />
              <span>raw</span>
            </label>
          </div>

          <!-- None Subview -->
          <div id="body-view-none" class="body-subview" style="display: none; align-items: center; justify-content: center; padding: 40px 16px; text-align: center; color: var(--muted);">
            <div>
              <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 500;">This request does not have a body.</p>
              <p style="margin: 0; font-size: 11px;">Select a body type above to attach a payload.</p>
            </div>
          </div>

          <!-- JSON Subview -->
          <div id="body-view-json" class="body-subview" style="display: none;">
            <div class="body-subview-header">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="body-mime-badge">application/json</span>
                <span id="json-syntax-indicator" style="font-size: 11px; font-weight: 500;"></span>
              </div>
              <div style="display: flex; gap: 6px;">
                <button id="btn-fmt-json" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;" title="Format JSON with indentation">Beautify JSON</button>
                <button id="btn-edit-body-json" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;" title="Open in VS Code Editor (Monaco)">↗ Open in Editor</button>
              </div>
            </div>
            <div class="code-editor-container">
              <div id="json-line-numbers" class="code-editor-gutter" aria-hidden="true">1</div>
              <div class="code-editor-surface">
                <pre id="json-highlight-backdrop" class="code-editor-backdrop" aria-hidden="true"><code id="json-highlight-code"></code></pre>
                <textarea id="req-body-json" class="code-editor-textarea" spellcheck="false" placeholder="{\n  &quot;key&quot;: &quot;value&quot;\n}"></textarea>
              </div>
            </div>
          </div>

          <!-- Form URL Encoded Subview -->
          <div id="body-view-form-urlencoded" class="body-subview" style="display: none;">
            <div class="body-subview-header">
              <span class="body-mime-badge">application/x-www-form-urlencoded</span>
              <button id="btn-toggle-urlencoded-mode" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;">Bulk Edit</button>
            </div>
            <div id="urlencoded-table-view">
              <div id="urlencoded-rows"></div>
              <div style="margin-top: 8px;">
                <button id="btn-add-urlencoded" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;">+ Add Field</button>
              </div>
            </div>
            <div id="urlencoded-bulk-view" style="display: none; flex: 1; min-height: 0; height: 100%;">
              <textarea id="req-body-urlencoded-bulk" class="textarea-box" placeholder="key1=value1&#10;key2=value2"></textarea>
            </div>
          </div>

          <!-- Form Data Subview -->
          <div id="body-view-form-data" class="body-subview" style="display: none;">
            <div class="body-subview-header">
              <span class="body-mime-badge">multipart/form-data</span>
            </div>
            <div id="formdata-rows"></div>
            <div style="margin-top: 8px;">
              <button id="btn-add-formdata" class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;">+ Add Field</button>
            </div>
          </div>

          <!-- Text Subview -->
          <div id="body-view-text" class="body-subview" style="display: none;">
            <div class="body-subview-header">
              <span class="body-mime-badge">text/plain</span>
            </div>
            <textarea id="req-body-text" class="textarea-box" placeholder="Plain text request body..."></textarea>
          </div>

          <!-- XML Subview -->
          <div id="body-view-xml" class="body-subview" style="display: none;">
            <div class="body-subview-header">
              <span class="body-mime-badge">application/xml</span>
              <button id="btn-fmt-xml" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;">Format XML</button>
            </div>
            <textarea id="req-body-xml" class="textarea-box" placeholder="&lt;?xml version=&quot;1.0&quot; encoding=&quot;UTF-8&quot;?&gt;&#10;&lt;root&gt;&#10;&lt;/root&gt;"></textarea>
          </div>

          <!-- Raw Subview -->
          <div id="body-view-raw" class="body-subview" style="display: none;">
            <div class="body-subview-header">
              <span class="body-mime-badge">Raw payload</span>
            </div>
            <textarea id="req-body-raw" class="textarea-box" placeholder="Raw request payload..."></textarea>
          </div>
        </div>

        <!-- Tab: Auth -->
        <div id="tab-auth" class="tab-content">
          <div class="auth-config" style="display: flex; flex-direction: column; gap: 14px; max-width: 580px;">
            <div class="form-group">
              <label class="form-label" for="auth-inheritance">Inheritance</label>
              <select id="auth-inheritance" class="form-control">
                <option value="both" ${context.auth?.inheritFromProfile !== false && context.auth?.inheritFromEnvironment !== false ? 'selected' : ''}>Inherit from Profile + Environment</option>
                <option value="profile" ${context.auth?.inheritFromProfile !== false && context.auth?.inheritFromEnvironment === false ? 'selected' : ''}>Inherit from Profile</option>
                <option value="environment" ${context.auth?.inheritFromProfile === false && context.auth?.inheritFromEnvironment !== false ? 'selected' : ''}>Inherit from Environment</option>
                <option value="none" ${context.auth?.inheritFromProfile === false && context.auth?.inheritFromEnvironment === false ? 'selected' : ''}>No Inheritance (Manual Override)</option>
              </select>
              <span class="help-hint">When set to No Inheritance, the credentials configured below will be sent with this request.</span>
            </div>

            ${renderAuthFieldsHtml(context.auth?.auth, 'this request', availableTokens)}
          </div>
        </div>

        <!-- Tab: Scripts -->
        <div id="tab-scripts" class="tab-content">
          <div class="subtab-bar">
            <div class="subtab-nav">
              <button type="button" class="subtab-btn script-type-btn active" data-script-view="pre">Pre-Request Script</button>
              <button type="button" class="subtab-btn script-type-btn" data-script-view="post">Post-Response Script (Tests)</button>
            </div>
            <div class="subtab-meta">
              Access globals: <code style="color:#4ec9b0;">bn</code>, <code style="color:#4ec9b0;">pm</code>, or direct (<code style="color:#4ec9b0;">test</code>, <code style="color:#4ec9b0;">expect</code>, <code style="color:#4ec9b0;">response</code>)
            </div>
          </div>

          <!-- Snippet helper bar -->
          <div style="display:flex; gap:5px; flex-wrap:wrap; margin-bottom:8px; align-items:center;">
            <span style="font-size:10px; color:var(--muted); margin-right:4px;">SNIPPETS:</span>
            <button type="button" class="snippet-btn" data-snippet="set-env">+ Set Env Var</button>
            <button type="button" class="snippet-btn" data-snippet="get-env">+ Get Env Var</button>
            <button type="button" class="snippet-btn" data-snippet="status-200">+ Status is 200</button>
            <button type="button" class="snippet-btn" data-snippet="parse-json">+ Parse JSON</button>
            <button type="button" class="snippet-btn" data-snippet="set-header">+ Set Header</button>
            <button type="button" class="snippet-btn" data-snippet="hash-sha256">+ SHA-256</button>
          </div>

          <div id="script-view-pre" class="script-subview" style="display: flex;">
            <div style="font-size:11px; color:var(--muted); margin-bottom:6px; flex-shrink: 0;">
              Runs before sending. Mutate <code>request.headers</code>, <code>request.body</code>, or set variables with <code>environment.set()</code> / <code>bn.environment.set()</code>.
            </div>
            <textarea id="req-pre-script" class="textarea-box" placeholder="// Example: set dynamic timestamp or signature&#10;request.headers['X-Timestamp'] = Date.now().toString();&#10;environment.set('reqId', crypto.randomUUID());&#10;// Or namespace: bn.request.headers / bn.environment.set">${escapeHtml(context.preRequestScript || '')}</textarea>
          </div>

          <div id="script-view-post" class="script-subview" style="display: none;">
            <div style="font-size:11px; color:var(--muted); margin-bottom:6px; flex-shrink: 0;">
              Runs after response. Assert tests with <code>test()</code> / <code>bn.test()</code> and <code>expect()</code>, or store tokens with <code>environment.set()</code> / <code>bn.environment.set()</code>.
            </div>
            <textarea id="req-post-script" class="textarea-box" placeholder="// Example: assert status 200 and store token&#10;test('Status is 200', () => {&#10;  expect(response.status).toBe(200);&#10;});&#10;&#10;const data = response.json();&#10;if (data.token) {&#10;  environment.set('authToken', data.token);&#10;}">${escapeHtml(context.postResponseScript || '')}</textarea>
          </div>
        </div>

        <!-- Tab: Notes -->
        <div id="tab-notes" class="tab-content">
          <textarea id="req-notes" class="textarea-box" placeholder="Documentation or notes for this request...">${escapeHtml(context.notes || '')}</textarea>
        </div>
      </div>

      <!-- Response Inspector -->
      <div class="panel-box">
        <div class="response-status-bar">
          <div class="status-badges">
            <span id="resp-status" class="pill">Waiting</span>
            <span id="resp-time" class="meta-tag"></span>
            <span id="resp-size" class="meta-tag"></span>
          </div>
          <div class="response-actions" style="display: flex; align-items: center; gap: 6px;">
            <button id="btn-collapse-all" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px; display: none;" title="Collapse all objects and arrays">Collapse All</button>
            <button id="btn-expand-all" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px; display: none;" title="Expand all objects and arrays">Expand All</button>
            <button id="btn-format-resp" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;" title="Toggle Raw / Formatted Colorized JSON">Raw</button>
            <button id="btn-table-resp" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;" title="Flip Response into Tabular View">⊞ Table</button>
            <button id="btn-copy-resp" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;" title="Copy Response Body">Copy</button>
            <button id="btn-open-editor" class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;" title="Open Response in VS Code Editor (Monaco)">↗ Editor</button>
          </div>
        </div>

        <div class="tab-header">
          <button class="tab-btn active" data-tab="tab-resp-body">Response Body</button>
          <button class="tab-btn" data-tab="tab-resp-headers">Headers <span id="resp-header-count"></span></button>
          <button class="tab-btn" data-tab="tab-resp-tests">Tests <span id="resp-test-count" class="pill" style="display:none; font-size:10px; padding:1px 6px; margin-left:4px;"></span></button>
          <button class="tab-btn" data-tab="tab-resp-console">Console <span id="resp-console-count" class="meta-tag" style="display:none; margin-left:4px;"></span></button>
        </div>

        <div id="tab-resp-body" class="tab-content active">
          <pre id="resp-body-text" class="response-body-pre">Click 'Send' to dispatch request.</pre>
          <div id="resp-table-view" class="resp-table-container" style="display: none;">
            <div class="table-toolbar">
              <div class="table-toolbar-left">
                <button id="btn-table-back" class="table-btn-back" style="display: none;" title="Go back to previous table">← Back</button>
                <div id="table-breadcrumbs" class="table-breadcrumbs">
                  <span class="table-crumb-active">Root</span>
                </div>
              </div>
              <div class="table-toolbar-right">
                <input type="text" id="table-filter-input" class="table-filter-input" placeholder="Filter rows..." title="Search & filter rows in current table" />
                <button id="btn-table-orientation" class="btn btn-secondary" style="font-size: 11px; padding: 2px 7px;" title="Toggle between Horizontal (rows as records) and Vertical (transposed) mode">⇄ Orientation</button>
                <button id="btn-table-export-csv" class="btn btn-secondary" style="font-size: 11px; padding: 2px 7px;" title="Export current table view to CSV">⬇ CSV</button>
                <button id="btn-table-export-xlsx" class="btn btn-secondary" style="font-size: 11px; padding: 2px 7px;" title="Export entire response to Excel (.xlsx) with dedicated tabs for every array">⬇ XLSX</button>
                <span id="table-record-count" class="meta-tag" style="margin-left: 4px;"></span>
              </div>
            </div>
            <div class="table-scroll-container" id="table-scroll-container">
              <table class="resp-table" id="resp-tabular-table">
                <thead id="resp-table-head"></thead>
                <tbody id="resp-table-body"></tbody>
              </table>
              <div id="resp-table-empty" class="table-empty-msg" style="display: none;"></div>
            </div>
          </div>
        </div>

        <div id="tab-resp-headers" class="tab-content">
          <table class="headers-table">
            <thead>
              <tr><th>Header</th><th>Value</th></tr>
            </thead>
            <tbody id="resp-headers-body">
              <tr><td colspan="2" style="color: var(--muted);">No response received.</td></tr>
            </tbody>
          </table>
        </div>

        <div id="tab-resp-tests" class="tab-content">
          <div id="test-results-container" style="display:flex; flex-direction:column; gap:6px; padding:10px;">
            <div style="color: var(--muted); font-size:12px;">No tests executed yet. Add test assertions in the <strong>Scripts &rarr; Post-Response Script</strong> tab using <code>test(...)</code> or <code>bn.test(...)</code>.</div>
          </div>
        </div>

        <div id="tab-resp-console" class="tab-content">
          <div id="console-logs-container" style="display:flex; flex-direction:column; padding:8px; font-family: Consolas, Monaco, monospace; font-size:11px;">
            <div style="color: var(--muted); font-size:12px;">No console logs. Use <code>console.log(...)</code> in pre-request or post-response scripts.</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    ${getSharedAuthClientScript()}

    // Context / ID tracking
    let currentRequestId = "${escapeHtml(context.requestId || context.id || '')}";
    let initialHeaders = ${JSON.stringify(context.headers || {}).replace(/</g, '\\u003c')};
    let initialVars = ${JSON.stringify(context.variables || []).replace(/</g, '\\u003c')};
    let initialInheritedVars = ${JSON.stringify(initialInheritedVars).replace(/</g, '\\u003c')};
    let initialInheritedHeaders = ${JSON.stringify(initialInheritedHeaders).replace(/</g, '\\u003c')};
    let initialResolvedVars = ${JSON.stringify(initialResolvedVars || {}).replace(/</g, '\\u003c')};
    let currentInheritedVars = initialInheritedVars;
    let currentInheritedHeaders = initialInheritedHeaders;
    let currentResolvedVars = initialResolvedVars;
    let currentEnvironments = ${JSON.stringify(environmentsData).replace(/</g, '\\u003c')};
    let initialBodyType = "${escapeHtml(context.bodyType || '')}";
    let initialBody = ${JSON.stringify(context.body || '').replace(/</g, '\\u003c')};
    let initialBodyFormData = ${JSON.stringify(context.bodyFormData || []).replace(/</g, '\\u003c')};
    const activeCollection = ${JSON.stringify(context.collection || state.collections[0]?.name || 'Demo Collection').replace(/</g, '\\u003c')};
    const activeFolder = ${JSON.stringify(context.folder && context.folder !== 'Root' ? context.folder : '').replace(/</g, '\\u003c')};

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const header = btn.parentElement;
        const panelBox = header.parentElement;
        header.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const targetId = btn.getAttribute('data-tab');
        panelBox.querySelectorAll('.tab-content').forEach(content => {
          content.classList.toggle('active', content.id === targetId);
        });
      });
    });

    // Dropdown toggle
    const toggleBtn = document.getElementById('btn-send-toggle');
    const sendDropdown = document.getElementById('send-dropdown');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendDropdown.classList.toggle('show');
    });
    document.addEventListener('click', () => sendDropdown.classList.remove('show'));

    // Script view toggle (Pre-Request vs Post-Response)
    document.querySelectorAll('.script-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.script-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.getAttribute('data-script-view');
        const preView = document.getElementById('script-view-pre');
        const postView = document.getElementById('script-view-post');
        if (preView) preView.style.display = view === 'pre' ? 'flex' : 'none';
        if (postView) postView.style.display = view === 'post' ? 'flex' : 'none';
      });
    });

    // Script Snippets
    document.querySelectorAll('.snippet-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const snippetType = btn.getAttribute('data-snippet');
        const activeBtn = document.querySelector('.script-type-btn.active');
        const activeView = activeBtn ? activeBtn.getAttribute('data-script-view') : 'pre';
        const targetTextarea = activeView === 'pre' ? document.getElementById('req-pre-script') : document.getElementById('req-post-script');
        if (!targetTextarea) return;

        let snippetCode = '';
        switch (snippetType) {
          case 'set-env':
            snippetCode = 'environment.set("myKey", "myValue");\\n';
            break;
          case 'get-env':
            snippetCode = 'const val = environment.get("myKey");\\nconsole.log("Got value:", val);\\n';
            break;
          case 'status-200':
            snippetCode = 'test("Status code is 200", () => {\\n  expect(response.status).toBe(200);\\n});\\n';
            break;
          case 'parse-json':
            snippetCode = 'const data = response.json();\\nconsole.log("Response payload:", data);\\n';
            break;
          case 'set-header':
            snippetCode = 'request.headers["X-Custom-Header"] = "CustomValue";\\n';
            break;
          case 'hash-sha256':
            snippetCode = 'const hash = crypto.createHash("sha256").update("myMessage").digest("hex");\\nconsole.log("SHA-256:", hash);\\n';
            break;
        }

        if (snippetCode) {
          const start = targetTextarea.selectionStart !== undefined ? targetTextarea.selectionStart : targetTextarea.value.length;
          const end = targetTextarea.selectionEnd !== undefined ? targetTextarea.selectionEnd : targetTextarea.value.length;
          const prev = targetTextarea.value;
          const prefix = (start > 0 && !prev.substring(0, start).endsWith('\\n')) ? '\\n' : '';
          targetTextarea.value = prev.substring(0, start) + prefix + snippetCode + prev.substring(end);
          targetTextarea.focus();
        }
      });
    });

    // DOM Containers
    const varRowsContainer = document.getElementById('var-rows');
    const headerRowsContainer = document.getElementById('header-rows');
    const inheritedVarsContainer = document.getElementById('inherited-var-rows');
    const inheritedVarsCount = document.getElementById('inherited-vars-count');
    const inheritedHeadersContainer = document.getElementById('inherited-header-rows');
    const inheritedHeadersCount = document.getElementById('inherited-headers-count');

    // URL Preview Bar — live resolved URL with unresolved token highlighting
    const urlPreviewBar = document.getElementById('url-preview-bar');
    const urlPreviewText = document.getElementById('url-preview-text');
    const urlPreviewWarn = document.getElementById('url-preview-warn');

    function safeEscape(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function getActiveVariableMap() {
      const varMap = {};

      // 1. Dynamic system variables ($uuid, $timestamp, etc.)
      const dynamicKeys = ['$uuid', '$timestamp', '$isoDate', '$randomInt', '$rowIndex'];
      dynamicKeys.forEach(k => {
        varMap[k] = { value: '<dynamic>', source: 'Dynamic System' };
      });

      // 2. Inherited variables (environments, profiles, collections, folders)
      if (currentInheritedVars && currentInheritedVars.length) {
        for (const item of currentInheritedVars) {
          if (!item.isOverridden && item.key && item.value !== undefined) {
            varMap[item.key] = {
              value: String(item.value),
              source: item.sourceName ? (item.source + ': ' + item.sourceName) : item.source
            };
          }
        }
      }

      // 2b. Ground-truth fallback: any variables resolved by backend engine
      if (currentResolvedVars && typeof currentResolvedVars === 'object') {
        for (const k in currentResolvedVars) {
          if (!varMap[k] && currentResolvedVars[k] !== undefined && !k.startsWith('$')) {
            varMap[k] = {
              value: String(currentResolvedVars[k]),
              source: 'Inherited'
            };
          }
        }
      }

      // 3. Request-level variables override everything
      if (varRowsContainer) {
        varRowsContainer.querySelectorAll('.param-row').forEach(row => {
          const enabled = row.querySelector('[data-role="enabled"]')?.checked;
          const name = (row.querySelector('[data-role="name"]')?.value || '').trim();
          const value = row.querySelector('[data-role="value"]')?.value || '';
          if (enabled && name) {
            varMap[name] = { value: value, source: 'Request Variables' };
          }
        });
      }

      return varMap;
    }

    // Helper to recursively resolve variable expressions in a string
    function resolveRecursively(text, varMap, maxDepth) {
      if (maxDepth === undefined) maxDepth = 5;
      if (!varMap) varMap = getActiveVariableMap();
      if (!text || typeof text !== 'string') {
        return {
          resolvedText: text || '',
          hasVariables: false,
          hasUnresolved: false,
          hasResolved: false,
          resolvedTokens: [],
          unresolvedTokens: [],
          resolvedCount: 0,
          unresolvedCount: 0,
          allUsedMap: {},
          hasImplicitBaseUrl: false
        };
      }

      const simpleVars = {};
      const sources = {};
      for (const k in varMap) {
        if (varMap[k] && varMap[k].value !== undefined) {
          simpleVars[k] = String(varMap[k].value);
          sources[k] = varMap[k].source || 'Variables';
        }
      }

      let workingText = text;
      let hasImplicitBaseUrl = false;
      if (workingText.startsWith('/') && simpleVars['baseUrl']) {
        workingText = '{{baseUrl}}' + workingText;
        hasImplicitBaseUrl = true;
      }

      const TOKEN_RE = /\{\{([a-zA-Z0-9_.:$-]+)\}\}/g;
      const initialMatches = workingText.match(TOKEN_RE);
      if (!initialMatches) {
        return {
          resolvedText: text,
          hasVariables: false,
          hasUnresolved: false,
          hasResolved: false,
          resolvedTokens: [],
          unresolvedTokens: [],
          resolvedCount: 0,
          unresolvedCount: 0,
          allUsedMap: {},
          hasImplicitBaseUrl: false
        };
      }

      const usedMap = {};
      const unresolvedSet = new Set();
      let current = workingText;
      let depth = 0;
      let changed = true;

      while (depth < maxDepth && changed) {
        changed = false;
        TOKEN_RE.lastIndex = 0;
        current = current.replace(TOKEN_RE, (match, rawKey) => {
          const key = rawKey.trim();
          if (key.startsWith('$')) {
            changed = true;
            let dynVal = '<dynamic>';
            if (key === '$uuid') dynVal = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
            else if (key === '$timestamp') dynVal = String(Date.now());
            else if (key === '$isoDate') dynVal = new Date().toISOString();
            else if (key === '$randomInt') dynVal = '123456';
            else if (key === '$rowIndex') dynVal = '0';
            usedMap[key] = { key: key, raw: match, value: dynVal, source: 'Dynamic System' };
            return dynVal;
          }
          if (Object.prototype.hasOwnProperty.call(simpleVars, key)) {
            changed = true;
            const val = simpleVars[key];
            usedMap[key] = { key: key, raw: match, value: val, source: sources[key] || 'Variables' };
            return val;
          }
          return match;
        });
        depth++;
      }

      // Check for remaining unresolved tokens in current
      TOKEN_RE.lastIndex = 0;
      let rem;
      while ((rem = TOKEN_RE.exec(current)) !== null) {
        const unKey = rem[1].trim();
        unresolvedSet.add(unKey);
      }

      const resolvedTokens = Object.values(usedMap);
      const unresolvedTokens = Array.from(unresolvedSet);

      // Compute final flattened values for tooltip
      for (const item of resolvedTokens) {
        let val = item.value;
        let d = 0;
        let ch = true;
        while (d < maxDepth && ch) {
          ch = false;
          TOKEN_RE.lastIndex = 0;
          val = val.replace(TOKEN_RE, (m, k) => {
            k = k.trim();
            if (Object.prototype.hasOwnProperty.call(simpleVars, k)) {
              ch = true;
              return simpleVars[k];
            }
            return m;
          });
          d++;
        }
        item.finalValue = val;
      }

      return {
        resolvedText: current,
        hasVariables: resolvedTokens.length > 0 || unresolvedTokens.length > 0,
        hasUnresolved: unresolvedTokens.length > 0,
        hasResolved: resolvedTokens.length > 0,
        resolvedTokens: resolvedTokens,
        unresolvedTokens: unresolvedTokens,
        resolvedCount: resolvedTokens.length,
        unresolvedCount: unresolvedTokens.length,
        allUsedMap: usedMap,
        hasImplicitBaseUrl: hasImplicitBaseUrl
      };
    }

    function analyzeVariables(text, varMap) {
      if (!varMap) varMap = getActiveVariableMap();
      if (!text || typeof text !== 'string') {
        return {
          tokens: [],
          hasVariables: false,
          hasUnresolved: false,
          hasResolved: false,
          resolvedCount: 0,
          unresolvedCount: 0,
          segments: [{ type: 'text', text: '' }]
        };
      }

      const TOKEN_RE = /\{\{([^}]+)\}\}/g;
      const segments = [];
      const tokens = [];
      let lastIndex = 0;
      let match;
      let resolvedCount = 0;
      let unresolvedCount = 0;

      while ((match = TOKEN_RE.exec(text)) !== null) {
        if (match.index > lastIndex) {
          segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
        }

        const raw = match[0];
        const key = match[1].trim();

        let isResolved = false;
        let value = '';
        let source = '';

        if (key.startsWith('$')) {
          if (key === '$uuid' || key === '$timestamp' || key === '$isoDate' || key === '$randomInt' || key === '$rowIndex' || key.startsWith('$date:') || key.startsWith('$randomInt:') || key.startsWith('$rowIndex:')) {
            isResolved = true;
            value = key === '$uuid' ? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx' : (key === '$timestamp' ? String(Date.now()) : '<dynamic>');
            source = 'Dynamic System';
          }
        }

        if (!isResolved && varMap[key] !== undefined) {
          // Check if key itself has unresolved dependencies recursively
          const subRes = resolveRecursively('{{' + key + '}}', varMap);
          if (subRes.hasUnresolved) {
            isResolved = false;
            value = '';
            source = 'Missing dependency: ' + subRes.unresolvedTokens.map(k => '{{' + k + '}}').join(', ');
          } else {
            isResolved = true;
            value = subRes.resolvedText;
            source = varMap[key].source || 'Variables';
          }
        }

        const tokenInfo = { raw, key, isResolved, value, source };
        tokens.push(tokenInfo);

        if (isResolved) {
          resolvedCount++;
          segments.push({ type: 'resolved', text: raw, raw, key, value, source });
        } else {
          unresolvedCount++;
          segments.push({ type: 'unresolved', text: raw, raw, key, value: '', source: source || 'Missing' });
        }

        lastIndex = match.index + raw.length;
      }

      if (lastIndex < text.length) {
        segments.push({ type: 'text', text: text.slice(lastIndex) });
      }

      return {
        tokens,
        hasVariables: tokens.length > 0,
        hasUnresolved: unresolvedCount > 0,
        hasResolved: resolvedCount > 0,
        resolvedCount,
        unresolvedCount,
        segments
      };
    }

    function updateUrlPreview() {
      const urlInput = document.getElementById('url-input');
      const urlBackdrop = document.getElementById('url-highlight-backdrop');
      if (!urlInput || !urlPreviewBar || !urlPreviewText) return;
      const raw = urlInput.value;

      const varMap = getActiveVariableMap();
      const analysis = analyzeVariables(raw, varMap);
      const res = resolveRecursively(raw, varMap);

      // 1. Update In-Input Highlight Backdrop
      if (urlBackdrop) {
        urlBackdrop.innerHTML = '';
        for (const seg of analysis.segments) {
          if (seg.type === 'text') {
            const span = document.createElement('span');
            span.style.color = 'transparent';
            span.textContent = seg.text;
            urlBackdrop.appendChild(span);
          } else if (seg.type === 'resolved') {
            const span = document.createElement('span');
            span.className = 'token-hl resolved';
            span.textContent = seg.raw;
            urlBackdrop.appendChild(span);
          } else {
            const span = document.createElement('span');
            span.className = 'token-hl unresolved';
            span.textContent = seg.raw;
            urlBackdrop.appendChild(span);
          }
        }
        urlBackdrop.scrollLeft = urlInput.scrollLeft;
      }

      // 2. Update Live Preview Bar
      if (!raw.trim() || !res.hasVariables) {
        urlPreviewBar.style.display = 'none';
        return;
      }

      urlPreviewText.innerHTML = '';

      if (!res.hasUnresolved) {
        // All variables resolved: show the ACTUAL resolved URL in the green box!
        const pill = document.createElement('span');
        pill.className = 'token-pill resolved-token url-resolved-pill';
        pill.id = 'url-resolved-pill';

        const tooltipLines = [
          'Resolved URL: ' + res.resolvedText,
          '(Click to copy to clipboard)',
          '',
          'Variables resolved:'
        ];
        res.resolvedTokens.forEach(t => {
          tooltipLines.push('• {{' + t.key + '}} = "' + t.finalValue + '" (' + t.source + ')');
        });
        pill.title = tooltipLines.join('\\n');
        pill.innerHTML = '<span class="token-sym">✓</span> <span class="token-val-url">' + safeEscape(res.resolvedText) + '</span> <span class="token-copy-icon" title="Copy resolved URL">📋</span>';

        pill.addEventListener('click', () => {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(res.resolvedText);
          }
          const icon = pill.querySelector('.token-copy-icon');
          if (icon) {
            const prev = icon.textContent;
            icon.textContent = '✓ Copied';
            setTimeout(() => { icon.textContent = prev; }, 1500);
          }
        });
        urlPreviewText.appendChild(pill);
      } else {
        // Some variables are unresolved: render resolved portions and highlight unresolved pills
        const UNRESOLVED_TOKEN_RE = /\{\{([a-zA-Z0-9_.:$-]+)\}\}/g;
        let lastIdx = 0;
        let m;
        while ((m = UNRESOLVED_TOKEN_RE.exec(res.resolvedText)) !== null) {
          if (m.index > lastIdx) {
            const textPart = res.resolvedText.slice(lastIdx, m.index);
            const textSpan = document.createElement('span');
            textSpan.className = 'url-part-text';
            textSpan.textContent = textPart;
            urlPreviewText.appendChild(textSpan);
          }
          const unKey = m[1].trim();
          const unPill = document.createElement('span');
          unPill.className = 'token-pill unresolved-token';
          unPill.title = 'Unresolved variable: "{{' + unKey + '}}" is not defined in any active scope';
          unPill.innerHTML = '<span class="token-sym">⚠</span> {{' + safeEscape(unKey) + '}} <span class="token-arrow">→</span> <span style="font-style:italic;">(not found)</span>';
          urlPreviewText.appendChild(unPill);
          lastIdx = m.index + m[0].length;
        }
        if (lastIdx < res.resolvedText.length) {
          const textPart = res.resolvedText.slice(lastIdx);
          const textSpan = document.createElement('span');
          textSpan.className = 'url-part-text';
          textSpan.textContent = textPart;
          urlPreviewText.appendChild(textSpan);
        }
      }

      // Summary badge on right side of preview bar
      let summaryBadge = urlPreviewBar.querySelector('.tokens-summary-badge');
      if (!summaryBadge) {
        summaryBadge = document.createElement('span');
        summaryBadge.className = 'tokens-summary-badge';
        urlPreviewBar.appendChild(summaryBadge);
      }

      summaryBadge.style.display = 'inline-block';
      if (res.hasUnresolved) {
        summaryBadge.className = 'tokens-summary-badge has-unresolved';
        summaryBadge.textContent = '⚠ ' + res.unresolvedCount + ' Unresolved';
        summaryBadge.title = res.unresolvedTokens.map(k => '{{' + k + '}}').join(', ') + ' not found in current context';
      } else {
        summaryBadge.className = 'tokens-summary-badge all-resolved';
        summaryBadge.textContent = '✓ All Resolved (' + res.resolvedCount + ')';
        summaryBadge.title = 'All ' + res.resolvedCount + ' variable(s) resolved successfully';
      }

      urlPreviewBar.style.display = 'flex';
      urlPreviewBar.classList.toggle('has-unresolved', res.hasUnresolved);
      if (urlPreviewWarn) urlPreviewWarn.style.display = 'none';
    }

    function updateRowVariableHighlight(row, varMap) {
      if (!row) return;
      const valueInput = row.querySelector('[data-role="value"]');
      if (!valueInput) return;
      const slot = row.querySelector('.row-var-slot');
      const val = valueInput.value;
      const analysis = analyzeVariables(val, varMap);

      if (analysis.hasVariables) {
        if (analysis.hasUnresolved) {
          valueInput.classList.add('has-unresolved-vars');
          valueInput.classList.remove('has-resolved-vars');
        } else {
          valueInput.classList.add('has-resolved-vars');
          valueInput.classList.remove('has-unresolved-vars');
        }

        if (slot) {
          let chip = slot.querySelector('.row-var-chip');
          if (!chip) {
            chip = document.createElement('span');
            slot.appendChild(chip);
          }
          if (analysis.hasUnresolved) {
            const missing = analysis.tokens.filter(t => !t.isResolved).map(t => '{{' + t.key + '}}').join(', ');
            chip.className = 'row-var-chip unresolved';
            chip.textContent = '⚠ ' + missing;
            chip.title = 'Unresolved variable: not found in current context';
            chip.style.display = 'inline-flex';
          } else {
            chip.className = 'row-var-chip resolved';
            chip.textContent = '✓ ' + analysis.tokens.map(t => '{{' + t.key + '}}').join(', ');
            chip.title = analysis.tokens.map(t => '{{' + t.key + '}} = "' + t.value + '" (' + t.source + ')').join('\\n');
            chip.style.display = 'inline-flex';
          }
        }
      } else {
        valueInput.classList.remove('has-unresolved-vars', 'has-resolved-vars');
        if (slot) {
          const chip = slot.querySelector('.row-var-chip');
          if (chip) chip.style.display = 'none';
        }
      }
    }

    function refreshTableVariableHighlights() {
      const varMap = getActiveVariableMap();
      if (headerRowsContainer) {
        headerRowsContainer.querySelectorAll('.param-row').forEach(row => updateRowVariableHighlight(row, varMap));
      }
      if (varRowsContainer) {
        varRowsContainer.querySelectorAll('.param-row').forEach(row => updateRowVariableHighlight(row, varMap));
      }
    }

    function refreshAuthVariableHighlights() {
      const authContainer = document.getElementById('tab-auth');
      if (!authContainer) return;
      const varMap = getActiveVariableMap();

      authContainer.querySelectorAll('input[type="text"], input[type="password"]').forEach(input => {
        const val = input.value;
        const analysis = analyzeVariables(val, varMap);
        let status = input.parentElement ? input.parentElement.querySelector('.auth-var-status') : null;

        if (analysis.hasVariables) {
          if (!status && input.parentElement) {
            status = document.createElement('div');
            status.className = 'auth-var-status';
            input.parentElement.appendChild(status);
          }
          if (status) {
            if (analysis.hasUnresolved) {
              input.classList.add('has-unresolved-vars');
              input.classList.remove('has-resolved-vars');
              status.className = 'auth-var-status unresolved';
              const missing = analysis.tokens.filter(t => !t.isResolved).map(t => '<code>{{' + safeEscape(t.key) + '}}</code>').join(', ');
              status.innerHTML = '⚠ Unresolved variable: ' + missing + ' not defined in active scope';
              status.style.display = 'block';
            } else {
              input.classList.add('has-resolved-vars');
              input.classList.remove('has-unresolved-vars');
              status.className = 'auth-var-status resolved';
              const resolvedInfo = analysis.tokens.map(t => '<code>{{' + safeEscape(t.key) + '}}</code> → &quot;' + safeEscape(t.value) + '&quot; (' + safeEscape(t.source) + ')').join(', ');
              status.innerHTML = '✓ Resolved: ' + resolvedInfo;
              status.style.display = 'block';
            }
          }
        } else {
          input.classList.remove('has-unresolved-vars', 'has-resolved-vars');
          if (status) status.style.display = 'none';
        }
      });
    }

    function refreshBodyVariableHighlights() {
      const varMap = getActiveVariableMap();
      const bodyInfo = getBodyPayload();
      const bodyText = typeof bodyInfo.body === 'string' ? bodyInfo.body : '';
      const analysis = analyzeVariables(bodyText, varMap);

      const activeSubview = document.querySelector('.body-subview[style*="display: block"], .body-subview[style*="display: flex"]');
      if (!activeSubview || activeSubview.id === 'body-view-none') return;
      const header = activeSubview.querySelector('.body-subview-header');
      if (!header) return;

      let indicator = header.querySelector('.body-var-indicator');
      if (analysis.hasVariables) {
        if (!indicator) {
          indicator = document.createElement('span');
          header.appendChild(indicator);
        }
        indicator.style.display = 'inline-flex';
        if (analysis.hasUnresolved) {
          indicator.className = 'body-var-indicator has-unresolved';
          indicator.textContent = '⚠ ' + analysis.unresolvedCount + ' Unresolved in Body';
          indicator.title = 'Unresolved:\\n' + analysis.tokens.filter(t => !t.isResolved).map(t => '{{' + t.key + '}}').join('\\n');
        } else {
          indicator.className = 'body-var-indicator all-resolved';
          indicator.textContent = '✓ ' + analysis.resolvedCount + ' Variables Resolved';
          indicator.title = 'Resolved:\\n' + analysis.tokens.map(t => '{{' + t.key + '}} = "' + t.value + '" (' + t.source + ')').join('\\n');
        }
      } else if (indicator) {
        indicator.style.display = 'none';
      }
    }

    function refreshAllVariableHighlights() {
      updateUrlPreview();
      refreshTableVariableHighlights();
      refreshAuthVariableHighlights();
      refreshBodyVariableHighlights();
    }

    // Helper functions for reading request state
    function getRequestVariables() {
      const vars = [];
      if (!varRowsContainer) return vars;
      varRowsContainer.querySelectorAll('.param-row').forEach(row => {
        const enabled = row.querySelector('[data-role="enabled"]')?.checked;
        const name = (row.querySelector('[data-role="name"]')?.value || '').trim();
        const value = row.querySelector('[data-role="value"]')?.value || '';
        const hidden = row.querySelector('[data-role="hidden"]')?.checked;
        if (name) {
          vars.push({ name, value, enabled: !!enabled, hidden: !!hidden });
        }
      });
      return vars;
    }

    function getRequestHeaders() {
      const headers = {};
      if (!headerRowsContainer) return headers;
      headerRowsContainer.querySelectorAll('.param-row').forEach(row => {
        const enabled = row.querySelector('[data-role="enabled"]')?.checked;
        const key = (row.querySelector('[data-role="key"]')?.value || '').trim();
        const value = row.querySelector('[data-role="value"]')?.value || '';
        if (enabled && key) {
          headers[key] = value;
        }
      });
      return headers;
    }

    // Tracks which groups are collapsed across re-renders
    const varGroupCollapsed = new Map();   // groupId → boolean
    const hdrGroupCollapsed = new Map();

    // Helper: build a single inherited-row element
    function buildInheritedRow(item, isOverridden, keyLabel, onOverride) {
      const row = document.createElement('div');
      row.className = 'inherited-row' + (isOverridden ? ' is-overridden' : '');

      const keySpan = document.createElement('span');
      keySpan.className = 'inherited-key';
      keySpan.textContent = keyLabel;
      keySpan.title = item.key;

      const valSpan = document.createElement('span');
      valSpan.className = 'inherited-val';
      valSpan.textContent = item.value;
      valSpan.title = item.value;

      const badgeContainer = document.createElement('div');
      badgeContainer.style.cssText = 'display:flex;align-items:center;gap:4px;';

      if (isOverridden) {
        const overPill = document.createElement('span');
        overPill.className = 'overridden-pill';
        const isDis = item.sourceName && item.sourceName.includes('(Disabled)');
        overPill.textContent = isDis ? 'Disabled' : 'Overridden';
        overPill.title = isDis ? 'This variable is disabled at the collection or environment level' : 'This variable is shadowed by a more specific scope';
        badgeContainer.appendChild(overPill);
      }

      const actionDiv = document.createElement('div');
      if (onOverride) {
        const overrideBtn = document.createElement('button');
        overrideBtn.className = 'btn btn-secondary override-btn';
        overrideBtn.textContent = '+ Override';
        overrideBtn.title = 'Copy to request variables to enable/override';
        overrideBtn.addEventListener('click', onOverride);
        actionDiv.appendChild(overrideBtn);
      }

      row.appendChild(keySpan);
      row.appendChild(valSpan);
      row.appendChild(badgeContainer);
      row.appendChild(actionDiv);
      return row;
    }

    // Helper: build a collapsible group wrapper
    function buildGroup(groupId, source, sourceName, items, collapseMap, defaultCollapsed, buildRowFn) {
      const wasCollapsed = collapseMap.has(groupId) ? collapseMap.get(groupId) : defaultCollapsed;

      const group = document.createElement('div');
      group.className = 'var-group';

      const header = document.createElement('div');
      header.className = 'var-group-header' + (wasCollapsed ? ' collapsed' : '');

      const badge = document.createElement('span');
      badge.className = 'source-badge source-' + source;
      badge.textContent = sourceName;

      const name = document.createElement('span');
      name.className = 'var-group-name';
      name.textContent = sourceName;
      // Use badge instead of separate name label for compactness
      name.style.display = 'none';

      const count = document.createElement('span');
      count.className = 'var-group-count';
      count.textContent = items.length + (items.length === 1 ? ' var' : ' vars');

      const chevron = document.createElement('span');
      chevron.className = 'var-group-chevron';
      chevron.textContent = '▾';

      header.appendChild(badge);
      header.appendChild(count);
      header.appendChild(chevron);

      const body = document.createElement('div');
      body.className = 'var-group-body';
      items.forEach(item => body.appendChild(buildRowFn(item)));

      header.addEventListener('click', () => {
        const isNowCollapsed = header.classList.toggle('collapsed');
        collapseMap.set(groupId, isNowCollapsed);
      });

      group.appendChild(header);
      group.appendChild(body);
      return group;
    }

    let showDynamicVars = false;

    // --- Inherited Variables Inspector (grouped) ---
    function renderInheritedVars() {
      if (!inheritedVarsContainer) return;
      inheritedVarsContainer.innerHTML = '';

      const userVars = (currentInheritedVars || []).filter(item => item.source !== 'dynamic');
      const dynamicVars = (currentInheritedVars || []).filter(item => item.source === 'dynamic');

      if (inheritedVarsCount) {
        inheritedVarsCount.textContent = userVars.length + ' available';
      }

      const btnToggleDynamic = document.getElementById('btn-toggle-dynamic-vars');
      if (btnToggleDynamic) {
        btnToggleDynamic.style.display = dynamicVars.length > 0 ? 'inline-flex' : 'none';
        btnToggleDynamic.textContent = showDynamicVars ? 'Hide Built-in Dynamic' : ('Show Built-in Dynamic (' + dynamicVars.length + ')');
      }

      if (userVars.length === 0 && (!showDynamicVars || dynamicVars.length === 0)) {
        inheritedVarsContainer.innerHTML = '<div style="font-size: 11px; color: var(--muted); padding: 8px 4px;">No inherited variables for this context.</div>';
        return;
      }

      const reqVarKeys = Array.from(varRowsContainer ? varRowsContainer.querySelectorAll('.param-row') : []).map(row => {
        const en = row.querySelector('[data-role="enabled"]')?.checked;
        const k = (row.querySelector('[data-role="name"]')?.value || '').trim();
        return en && k ? k : null;
      }).filter(Boolean);

      // Group items by source key
      const varsToRender = showDynamicVars ? currentInheritedVars : userVars;
      const groups = new Map(); // groupId → { source, sourceName, items[] }
      varsToRender.forEach(item => {
        const groupId = item.source + '::' + item.sourceName;
        if (!groups.has(groupId)) groups.set(groupId, { source: item.source, sourceName: item.sourceName, items: [] });
        groups.get(groupId).items.push(item);
      });

      groups.forEach(({ source, sourceName, items }, groupId) => {
        const isDynamic = source === 'dynamic';
        const group = buildGroup(
          groupId, source, sourceName, items,
          varGroupCollapsed,
          isDynamic, // dynamic starts collapsed
          (item) => {
            const isOverridden = item.isOverridden || reqVarKeys.includes(item.key);
            return buildInheritedRow(
              item, isOverridden,
              isDynamic ? item.key : ('{{' + item.key + '}}'),
              isDynamic ? null : () => {
                const newRow = addVarRow(item.key, item.value, true, false);
                const valInp = newRow.querySelector('[data-role="value"]');
                if (valInp) valInp.focus();
              }
            );
          }
        );
        inheritedVarsContainer.appendChild(group);
      });
    }

    // --- Inherited Headers Inspector (grouped) ---
    function renderInheritedHeaders() {
      if (!inheritedHeadersContainer) return;
      inheritedHeadersContainer.innerHTML = '';

      if (!currentInheritedHeaders || currentInheritedHeaders.length === 0) {
        inheritedHeadersContainer.innerHTML = '<div style="font-size: 11px; color: var(--muted); padding: 8px 4px;">No inherited headers for this context.</div>';
        if (inheritedHeadersCount) inheritedHeadersCount.textContent = '0 inherited';
        return;
      }

      const reqHeaderKeys = Array.from(headerRowsContainer ? headerRowsContainer.querySelectorAll('.param-row') : []).map(row => {
        const en = row.querySelector('[data-role="enabled"]')?.checked;
        const k = (row.querySelector('[data-role="key"]')?.value || '').trim().toLowerCase();
        return en && k ? k : null;
      }).filter(Boolean);

      if (inheritedHeadersCount) inheritedHeadersCount.textContent = currentInheritedHeaders.length + ' inherited';

      const groups = new Map();
      currentInheritedHeaders.forEach(item => {
        const groupId = item.source + '::' + item.sourceName;
        if (!groups.has(groupId)) groups.set(groupId, { source: item.source, sourceName: item.sourceName, items: [] });
        groups.get(groupId).items.push(item);
      });

      groups.forEach(({ source, sourceName, items }, groupId) => {
        const group = buildGroup(
          groupId, source, sourceName, items,
          hdrGroupCollapsed,
          false, // headers always start expanded
          (item) => {
            const isOverridden = item.isOverridden || reqHeaderKeys.includes(item.key.toLowerCase());
            return buildInheritedRow(
              item, isOverridden,
              item.key,
              () => {
                const newRow = addHeaderRow(item.key, item.value, true);
                const valInp = newRow.querySelector('[data-role="value"]');
                if (valInp) valInp.focus();
              }
            );
          }
        );
        inheritedHeadersContainer.appendChild(group);
      });
    }

    function requestInheritedData() {
      const selectEnv = document.getElementById('select-env');
      const selectProfile = document.getElementById('select-profile');
      const selectBaseUrlPref = document.getElementById('select-base-url-pref');
      const rawBaseUrlPref = selectBaseUrlPref ? selectBaseUrlPref.value : undefined;
      const baseUrlPreference = (rawBaseUrlPref === 'collection' || rawBaseUrlPref === 'environment' || rawBaseUrlPref === 'none') ? rawBaseUrlPref : undefined;

      vscode.postMessage({
        type: 'getInherited',
        payload: {
          profile: selectProfile ? selectProfile.value : undefined,
          profileId: selectProfile && selectProfile.selectedOptions[0] ? selectProfile.selectedOptions[0].dataset.id : undefined,
          environment: selectEnv ? selectEnv.value : undefined,
          baseUrlPreference: baseUrlPreference,
          collection: activeCollection,
          folder: activeFolder,
          variables: getRequestVariables(),
          headers: getRequestHeaders()
        }
      });
    }

    const selectEnvEl = document.getElementById('select-env');
    if (selectEnvEl) {
      selectEnvEl.addEventListener('change', () => requestInheritedData());
    }
    function updateActiveProfileAccent() {
      const selectProfileEl = document.getElementById('select-profile');
      const dotEl = document.getElementById('profile-indicator-dot');
      const guardBadge = document.getElementById('profile-guard-badge');
      const methodSelect = document.getElementById('method-select');
      if (selectProfileEl) {
        const selOpt = selectProfileEl.options[selectProfileEl.selectedIndex];
        const color = selOpt?.getAttribute('data-color') || '#3b82f6';
        if (dotEl) {
          dotEl.style.background = color;
          dotEl.style.boxShadow = '0 0 6px ' + color + 'aa';
        }
        document.documentElement.style.setProperty('--primary', color);

        if (guardBadge && selOpt) {
          let guards = null;
          try {
            const rawGuards = selOpt.getAttribute('data-guards');
            if (rawGuards) guards = JSON.parse(rawGuards);
          } catch (_) {}

          if (guards && guards.enabled) {
            guardBadge.style.display = 'inline-flex';
            const blocked = (guards.blockedMethods || []).map(m => m.toUpperCase());
            const curMethod = methodSelect ? methodSelect.value.toUpperCase() : '';
            if (blocked.includes(curMethod)) {
              guardBadge.textContent = '⛔ ' + curMethod + ' Blocked';
              guardBadge.style.color = '#ef4444';
              guardBadge.style.background = 'rgba(239, 68, 68, 0.15)';
              guardBadge.style.borderColor = 'rgba(239, 68, 68, 0.35)';
              guardBadge.title = 'Profile "' + selOpt.value + '" has Safety Guards active: ' + curMethod + ' requests are guarded/blocked.';
            } else {
              guardBadge.textContent = '🛡️ Guarded';
              guardBadge.style.color = '#f59e0b';
              guardBadge.style.background = 'rgba(245, 158, 11, 0.15)';
              guardBadge.style.borderColor = 'rgba(245, 158, 11, 0.35)';
              guardBadge.title = 'Profile "' + selOpt.value + '" has Safety Guards active. Blocked methods: ' + (blocked.join(', ') || 'None');
            }
          } else {
            guardBadge.style.display = 'none';
          }
        }
      }
    }

    const methodSelectEl = document.getElementById('method-select');
    if (methodSelectEl) {
      methodSelectEl.addEventListener('change', () => updateActiveProfileAccent());
    }

    function renderEnvironmentSelectHtml(environments, activeProfileId, selectedValue) {
      if (!environments || !Array.isArray(environments)) {
        return '<option value="">No Environment (Collection Defaults)</option>';
      }

      // Filter by profile scope (matching sidebar behavior)
      const isFiltered = Boolean(activeProfileId && activeProfileId !== 'all');
      const filteredEnvs = environments.filter(function(e) {
        if (!isFiltered) return true;
        if (activeProfileId === 'global') return !e.profileId || e.profileId === 'global';
        return e.profileId === activeProfileId || !e.profileId || e.profileId === 'global';
      });

      // Split into Profile-Scoped and Shared/Global if a profile is active
      const profileEnvs = [];
      const sharedEnvs = [];
      const hasSplit = isFiltered && activeProfileId !== 'global';

      filteredEnvs.forEach(function(e) {
        if (hasSplit && e.profileId === activeProfileId) {
          profileEnvs.push(e);
        } else {
          sharedEnvs.push(e);
        }
      });

      function buildGroupOptions(envsList) {
        if (!envsList.length) return '';
        const byId = {};
        const byName = {};
        envsList.forEach(function(e) {
          if (e.id) byId[e.id] = e;
          byName[e.name] = e;
        });

        const childrenMap = {};
        const roots = [];
        envsList.forEach(function(e) {
          const parentRef = e.inheritsFrom;
          const parentObj = parentRef ? (byId[parentRef] || byName[parentRef]) : null;
          if (parentObj && parentObj.name !== e.name && envsList.some(function(el) { return el.name === parentObj.name; })) {
            const pKey = parentObj.id || parentObj.name;
            if (!childrenMap[pKey]) childrenMap[pKey] = [];
            childrenMap[pKey].push(e);
          } else {
            roots.push(e);
          }
        });

        const rendered = new Set();
        const lines = [];

        function renderNode(e, depth, visited) {
          const key = e.id || e.name;
          if (visited.has(key)) return;
          visited.add(key);
          rendered.add(e.name);

          const rawChildren = childrenMap[key] || [];
          const validChildren = rawChildren.filter(function(c) { return !visited.has(c.id || c.name); });
          const hasChildren = validChildren.length > 0;
          const parentObj = e.inheritsFrom ? (byId[e.inheritsFrom] || byName[e.inheritsFrom]) : null;
          const pName = parentObj ? parentObj.name : e.inheritsFrom;

          let label = '';
          if (depth > 0) {
            const indent = '\u00A0\u00A0'.repeat(depth) + '↳ ';
            label = indent + e.name;
            if (pName) label += ' (inherits: ' + pName + ')';
            if (hasChildren) label += ' [Parent (' + validChildren.length + ')]';
          } else {
            label = e.name;
            if (hasChildren) {
              label += ' (Parent • ' + validChildren.length + (validChildren.length === 1 ? ' child' : ' children') + ')';
            } else if (pName) {
              label += ' (inherits: ' + pName + ')';
            }
          }

          const isSel = Boolean(selectedValue) && e.name === selectedValue;
          lines.push('<option value="' + safeEscape(e.name) + '"' + (isSel ? ' selected' : '') + '>' + safeEscape(label) + '</option>');

          validChildren.forEach(function(child) {
            renderNode(child, depth + 1, new Set(visited));
          });
        }

        roots.forEach(function(root) {
          renderNode(root, 0, new Set());
        });
        envsList.forEach(function(e) {
          if (!rendered.has(e.name)) {
            renderNode(e, 0, new Set());
          }
        });

        return lines.join('');
      }

      let html = '<option value=""' + (!selectedValue ? ' selected' : '') + '>No Environment (Collection Defaults)</option>';
      if (hasSplit && profileEnvs.length > 0 && sharedEnvs.length > 0) {
        const selectProfileEl = document.getElementById('select-profile');
        const profName = (selectProfileEl && selectProfileEl.options && selectProfileEl.selectedIndex >= 0 && selectProfileEl.options[selectProfileEl.selectedIndex])
          ? (selectProfileEl.options[selectProfileEl.selectedIndex].text || 'Profile')
          : 'Profile';
        html += '<optgroup label="Profile Environments (' + safeEscape(profName) + ')">' + buildGroupOptions(profileEnvs) + '</optgroup>';
        html += '<optgroup label="Shared / Global Environments">' + buildGroupOptions(sharedEnvs) + '</optgroup>';
      } else {
        html += buildGroupOptions(filteredEnvs);
      }
      return html;
    }

    function updateEnvironmentDropdown(preferredValue) {
      const selectEnv = document.getElementById('select-env');
      const selectProfile = document.getElementById('select-profile');
      if (!selectEnv) return;
      const targetVal = preferredValue !== undefined ? preferredValue : selectEnv.value;
      const selectedOption = selectProfile ? selectProfile.options[selectProfile.selectedIndex] : null;
      const activePid = selectedOption ? (selectedOption.getAttribute('data-id') || selectedOption.value) : undefined;
      selectEnv.innerHTML = renderEnvironmentSelectHtml(currentEnvironments, activePid, targetVal);
      if (selectEnv.value !== targetVal) {
        selectEnv.value = targetVal || '';
      }
    }

    const selectProfileEl = document.getElementById('select-profile');
    if (selectProfileEl) {
      selectProfileEl.addEventListener('change', () => {
        updateActiveProfileAccent();
        updateEnvironmentDropdown();
        requestInheritedData();
      });
    }
    const selectBaseUrlPrefEl = document.getElementById('select-base-url-pref');
    if (selectBaseUrlPrefEl) {
      selectBaseUrlPrefEl.addEventListener('change', () => requestInheritedData());
    }
    const btnOpenSettingsEl = document.getElementById('btn-open-settings');
    if (btnOpenSettingsEl) {
      btnOpenSettingsEl.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
      });
    }

    // Wire Request Name inline renaming
    const reqNameInput = document.getElementById('req-name-input');
    const btnRename = document.getElementById('btn-rename-req');
    let lastSavedName = reqNameInput ? reqNameInput.value.trim() : '';

    function autoResizeInput(input) {
      if (!input) return;
      const len = Math.max(input.value.length || 0, (input.placeholder || '').length || 10);
      input.style.width = Math.min(Math.max(len + 2, 14), 45) + 'ch';
    }

    function triggerRename() {
      if (!reqNameInput) return;
      const newName = reqNameInput.value.trim();
      if (!newName || newName === lastSavedName) return;
      lastSavedName = newName;

      if (btnRename) {
        btnRename.classList.add('saved-flash');
        setTimeout(() => btnRename.classList.remove('saved-flash'), 800);
      }

      vscode.postMessage({
        type: 'renameRequest',
        payload: {
          requestId: currentRequestId,
          newName: newName,
          collection: activeCollection,
          folder: activeFolder
        }
      });
    }

    if (reqNameInput) {
      autoResizeInput(reqNameInput);
      reqNameInput.addEventListener('input', () => autoResizeInput(reqNameInput));
      reqNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerRename();
          reqNameInput.blur();
        }
      });
      reqNameInput.addEventListener('change', triggerRename);
      if (btnRename) {
        btnRename.addEventListener('click', triggerRename);
      }
    }

    const btnToggleDynamicEl = document.getElementById('btn-toggle-dynamic-vars');
    if (btnToggleDynamicEl) {
      btnToggleDynamicEl.addEventListener('click', () => {
        showDynamicVars = !showDynamicVars;
        renderInheritedVars();
      });
    }

    // Wire URL input → live preview & backdrop scroll
    const urlInputEl = document.getElementById('url-input');
    if (urlInputEl) {
      urlInputEl.addEventListener('input', () => updateUrlPreview());
      urlInputEl.addEventListener('scroll', () => {
        const backdrop = document.getElementById('url-highlight-backdrop');
        if (backdrop) backdrop.scrollLeft = urlInputEl.scrollLeft;
      });
    }

    // Variables UI Builder
    function addVarRow(name = '', value = '', enabled = true, hidden = false) {
      const row = document.createElement('div');
      row.className = 'param-row';
      row.innerHTML = \`
        <input type="checkbox" \${enabled ? 'checked' : ''} data-role="enabled" style="cursor: pointer;" />
        <input class="param-input" type="text" placeholder="Key" value="\${String(name).replace(/"/g, '&quot;')}" data-role="name" />
        <input class="param-input" type="\${hidden ? 'password' : 'text'}" placeholder="Value" value="\${String(value).replace(/"/g, '&quot;')}" data-role="value" />
        <div class="row-var-slot" style="display: flex; align-items: center; gap: 4px; overflow: hidden;">
          <label style="font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 4px; cursor: pointer; flex-shrink: 0;">
            <input type="checkbox" \${hidden ? 'checked' : ''} data-role="hidden" /> Mask
          </label>
        </div>
        <button class="icon-btn" title="Delete" data-role="delete">✕</button>
      \`;

      const hiddenCheck = row.querySelector('[data-role="hidden"]');
      const valueInput = row.querySelector('[data-role="value"]');
      hiddenCheck.addEventListener('change', () => {
        valueInput.type = hiddenCheck.checked ? 'password' : 'text';
      });

      row.querySelector('[data-role="delete"]').addEventListener('click', () => {
        row.remove();
        renderInheritedVars();
        refreshAllVariableHighlights();
      });

      row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => {
          renderInheritedVars();
          refreshAllVariableHighlights();
        });
        input.addEventListener('change', () => {
          renderInheritedVars();
          refreshAllVariableHighlights();
        });
      });

      if (varRowsContainer) {
        varRowsContainer.appendChild(row);
      }
      updateRowVariableHighlight(row);
      renderInheritedVars();
      return row;
    }

    const btnAddVar = document.getElementById('btn-add-var');
    if (btnAddVar) {
      btnAddVar.addEventListener('click', () => addVarRow());
    }

    // Populate initial variables
    if (initialVars.length > 0) {
      initialVars.forEach(v => addVarRow(v.name, v.value, v.enabled !== false, v.hidden === true));
    } else {
      addVarRow();
    }

    // Headers UI Builder
    function addHeaderRow(key = '', value = '', enabled = true) {
      const row = document.createElement('div');
      row.className = 'param-row';
      row.innerHTML = \`
        <input type="checkbox" \${enabled ? 'checked' : ''} data-role="enabled" style="cursor: pointer;" />
        <input class="param-input" type="text" placeholder="Header name" value="\${String(key).replace(/"/g, '&quot;')}" data-role="key" />
        <input class="param-input" type="text" placeholder="Value" value="\${String(value).replace(/"/g, '&quot;')}" data-role="value" />
        <div class="row-var-slot" style="display: flex; align-items: center; overflow: hidden;"></div>
        <button class="icon-btn" title="Delete" data-role="delete">✕</button>
      \`;

      row.querySelector('[data-role="delete"]').addEventListener('click', () => {
        row.remove();
        renderInheritedHeaders();
        refreshAllVariableHighlights();
      });

      row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => {
          renderInheritedHeaders();
          refreshAllVariableHighlights();
        });
        input.addEventListener('change', () => {
          renderInheritedHeaders();
          refreshAllVariableHighlights();
        });
      });

      if (headerRowsContainer) {
        headerRowsContainer.appendChild(row);
      }
      updateRowVariableHighlight(row);
      renderInheritedHeaders();
      return row;
    }

    const btnAddHeader = document.getElementById('btn-add-header');
    if (btnAddHeader) {
      btnAddHeader.addEventListener('click', () => addHeaderRow());
    }

    // Populate initial headers
    const headerEntries = Object.entries(initialHeaders);
    if (headerEntries.length > 0) {
      headerEntries.forEach(([k, v]) => addHeaderRow(k, v, true));
    } else {
      addHeaderRow('Accept', 'application/json', true);
    }

    // Wire Auth and Body Variable Highlighting
    const tabAuthEl = document.getElementById('tab-auth');
    if (tabAuthEl) {
      tabAuthEl.querySelectorAll('input, select, textarea').forEach(inp => {
        inp.addEventListener('input', () => refreshAuthVariableHighlights());
        inp.addEventListener('change', () => refreshAuthVariableHighlights());
      });
    }

    ['req-body-json', 'req-body-text', 'req-body-xml', 'req-body-raw', 'req-body-urlencoded-bulk'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => refreshBodyVariableHighlights());
      }
    });

    // Initial render of inherited tables, URL preview, and variable highlights
    renderInheritedVars();
    renderInheritedHeaders();
    refreshAllVariableHighlights();

    // Form row builder for form-urlencoded
    function addFormRow(container, key = '', value = '', enabled = true) {
      const row = document.createElement('div');
      row.className = 'param-row';
      const checkedAttr = enabled ? 'checked' : '';
      row.innerHTML =
        '<input type="checkbox" ' + checkedAttr + ' data-role="enabled" style="cursor: pointer;" />' +
        '<input class="param-input" type="text" placeholder="Key" value="' + key.replace(/"/g, '&quot;') + '" data-role="key" />' +
        '<input class="param-input" type="text" placeholder="Value" value="' + value.replace(/"/g, '&quot;') + '" data-role="value" />' +
        '<div></div>' +
        '<button class="icon-btn" title="Delete" data-role="delete">✕</button>';
      row.querySelector('[data-role="delete"]').addEventListener('click', () => row.remove());
      container.appendChild(row);
      return row;
    }

    // Multipart Form-Data row builder with file upload support
    let formDataRowCounter = 0;
    function addFormDataRow(key = '', value = '', enabled = true, type = 'text') {
      const row = document.createElement('div');
      row.className = 'param-row formdata-row';
      const rowId = 'fd-' + (++formDataRowCounter) + '-' + Date.now();
      row.setAttribute('data-row-id', rowId);
      const checkedAttr = enabled ? 'checked' : '';
      const isFile = type === 'file';

      row.innerHTML =
        '<input type="checkbox" ' + checkedAttr + ' data-role="enabled" style="cursor: pointer;" />' +
        '<input class="param-input" type="text" placeholder="Key" value="' + key.replace(/"/g, '&quot;') + '" data-role="key" />' +
        '<div style="display: flex; gap: 4px; align-items: center; width: 100%; min-width: 0;">' +
          '<input class="param-input" type="text" placeholder="' + (isFile ? 'Select or enter file path...' : 'Value') + '" value="' + value.replace(/"/g, '&quot;') + '" data-role="value" style="flex: 1; min-width: 0;" />' +
          '<button type="button" class="btn btn-secondary" data-role="browse" style="display: ' + (isFile ? 'inline-block' : 'none') + '; padding: 3px 8px; font-size: 11px; white-space: nowrap; height: 26px;">Browse...</button>' +
        '</div>' +
        '<select class="param-input" data-role="type" style="width: 100%; padding: 4px 2px; font-size: 11px; cursor: pointer;">' +
          '<option value="text"' + (!isFile ? ' selected' : '') + '>Text</option>' +
          '<option value="file"' + (isFile ? ' selected' : '') + '>File</option>' +
        '</select>' +
        '<button class="icon-btn" title="Delete" data-role="delete">✕</button>';

      const typeSelect = row.querySelector('[data-role="type"]');
      const valInput = row.querySelector('[data-role="value"]');
      const browseBtn = row.querySelector('[data-role="browse"]');

      typeSelect.addEventListener('change', () => {
        const fileSelected = typeSelect.value === 'file';
        browseBtn.style.display = fileSelected ? 'inline-block' : 'none';
        valInput.placeholder = fileSelected ? 'Select or enter file path...' : 'Value';
      });

      browseBtn.addEventListener('click', () => {
        vscode.postMessage({
          type: 'selectFile',
          rowId: rowId
        });
      });

      row.querySelector('[data-role="delete"]').addEventListener('click', () => row.remove());
      formdataRows.appendChild(row);
      return row;
    }

    const urlencodedRows = document.getElementById('urlencoded-rows');
    const formdataRows = document.getElementById('formdata-rows');
    document.getElementById('btn-add-urlencoded').addEventListener('click', () => addFormRow(urlencodedRows));
    document.getElementById('btn-add-formdata').addEventListener('click', () => addFormDataRow());

    // Content-Type synchronization
    function syncContentType(type) {
      const typeMap = {
        'json': 'application/json',
        'form-urlencoded': 'application/x-www-form-urlencoded',
        'form-data': 'multipart/form-data',
        'text': 'text/plain',
        'xml': 'application/xml'
      };
      const newCt = typeMap[type];
      const managedTypes = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', 'application/xml'];
      const rows = Array.from(headerRowsContainer.querySelectorAll('.param-row'));
      let found = false;
      for (const row of rows) {
        const keyInput = row.querySelector('[data-role="key"]');
        const valInput = row.querySelector('[data-role="value"]');
        const enabledInput = row.querySelector('[data-role="enabled"]');
        if (keyInput && keyInput.value.trim().toLowerCase() === 'content-type') {
          found = true;
          if (newCt) {
            valInput.value = newCt;
            enabledInput.checked = true;
          } else if (type === 'none') {
            if (managedTypes.includes(valInput.value.trim())) {
              enabledInput.checked = false;
            }
          }
          break;
        }
      }
      if (!found && newCt) {
        addHeaderRow('Content-Type', newCt, true);
      }
    }

    // Body subviews
    const bodyViews = {
      'none': document.getElementById('body-view-none'),
      'json': document.getElementById('body-view-json'),
      'form-urlencoded': document.getElementById('body-view-form-urlencoded'),
      'form-data': document.getElementById('body-view-form-data'),
      'text': document.getElementById('body-view-text'),
      'xml': document.getElementById('body-view-xml'),
      'raw': document.getElementById('body-view-raw'),
    };

    function selectBodyType(type, updateHeaders = true) {
      document.querySelectorAll('.radio-pill').forEach(pill => {
        const radio = pill.querySelector('input[type="radio"]');
        const isMatch = radio && radio.value === type;
        if (radio) radio.checked = isMatch;
        pill.classList.toggle('selected', isMatch);
      });
      Object.entries(bodyViews).forEach(([key, el]) => {
        if (el) el.style.display = key === type ? 'flex' : 'none';
      });
      if (updateHeaders) {
        syncContentType(type);
      }
      refreshBodyVariableHighlights();
      if (type === 'json') {
        updateJsonHighlight();
      }
    }

    document.querySelectorAll('input[name="bodyType"]').forEach(radio => {
      radio.addEventListener('change', () => {
        selectBodyType(radio.value, true);
      });
    });

    // Toggle Bulk / Key-Value mode for x-www-form-urlencoded
    const urlencodedTable = document.getElementById('urlencoded-table-view');
    const urlencodedBulk = document.getElementById('urlencoded-bulk-view');
    const btnToggleUrlencoded = document.getElementById('btn-toggle-urlencoded-mode');
    const urlencodedRaw = document.getElementById('req-body-urlencoded-bulk');

    btnToggleUrlencoded.addEventListener('click', () => {
      const isTable = urlencodedTable.style.display !== 'none';
      if (isTable) {
        const rows = Array.from(urlencodedRows.querySelectorAll('.param-row'));
        const lines = rows.map(r => {
          const k = r.querySelector('[data-role="key"]').value.trim();
          const v = r.querySelector('[data-role="value"]').value;
          const enabled = r.querySelector('[data-role="enabled"]').checked;
          if (!enabled) return '';
          return k ? (k + '=' + v) : '';
        }).filter(Boolean);
        urlencodedRaw.value = lines.join('\\n');
        urlencodedTable.style.display = 'none';
        urlencodedBulk.style.display = 'block';
        btnToggleUrlencoded.textContent = 'Key-Value Edit';
      } else {
        urlencodedRows.innerHTML = '';
        const lines = urlencodedRaw.value.split('\\n');
        let count = 0;
        lines.forEach(line => {
          const trimmed = line.trim();
          if (!trimmed) return;
          const idx = trimmed.indexOf('=') >= 0 ? trimmed.indexOf('=') : trimmed.indexOf(':');
          if (idx >= 0) {
            addFormRow(urlencodedRows, trimmed.substring(0, idx).trim(), trimmed.substring(idx + 1).trim(), true);
            count++;
          } else {
            addFormRow(urlencodedRows, trimmed, '', true);
            count++;
          }
        });
        if (count === 0) addFormRow(urlencodedRows);
        urlencodedBulk.style.display = 'none';
        urlencodedTable.style.display = 'block';
        btnToggleUrlencoded.textContent = 'Bulk Edit';
      }
    });

    // Live JSON Syntax Highlighting & Line Numbers Editor
    const jsonTextarea = document.getElementById('req-body-json');
    const jsonBackdrop = document.getElementById('json-highlight-backdrop');
    const jsonHighlightCode = document.getElementById('json-highlight-code');
    const jsonGutter = document.getElementById('json-line-numbers');
    const jsonSyntaxIndicator = document.getElementById('json-syntax-indicator');

    function highlightJsonForEditor(rawText) {
      if (!rawText) return '';
      const escaped = rawText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const JSON_TOKEN_RE = /("(?:[^"\\\\]|\\\\.)*"\\s*:?)|(\\b(?:true|false)\\b)|(\\bnull\\b)|(-?\\d+(?:\\.\\d+)?(?:[eE][+\\-]?\\d+)?)|(\\{\\{[^}]+\\}\\})|([{}[\\],:])/g;

      return escaped.replace(JSON_TOKEN_RE, function (match, keyOrString, boolMatch, nullMatch, numMatch, varMatch, punctMatch) {
        if (keyOrString) {
          if (/:\\s*$/.test(keyOrString)) {
            const colonIdx = keyOrString.lastIndexOf(':');
            const keyPart = keyOrString.slice(0, colonIdx);
            const colonPart = keyOrString.slice(colonIdx);
            return '<span class="json-key">' + keyPart + '</span><span class="json-punct">' + colonPart + '</span>';
          } else {
            const withVars = keyOrString.replace(/\\{\\{([^}]+)\\}\\}/g, '<span class="json-variable">{{\$1}}</span>');
            return '<span class="json-string">' + withVars + '</span>';
          }
        } else if (boolMatch) {
          return '<span class="json-boolean">' + boolMatch + '</span>';
        } else if (nullMatch) {
          return '<span class="json-null">' + nullMatch + '</span>';
        } else if (numMatch) {
          return '<span class="json-number">' + numMatch + '</span>';
        } else if (varMatch) {
          return '<span class="json-variable">' + varMatch + '</span>';
        } else if (punctMatch) {
          return '<span class="json-punct">' + punctMatch + '</span>';
        }
        return match;
      });
    }

    function updateJsonHighlight() {
      if (!jsonTextarea || !jsonHighlightCode || !jsonGutter) return;
      const text = jsonTextarea.value || '';
      jsonHighlightCode.innerHTML = highlightJsonForEditor(text) + (text.endsWith('\\n') ? ' ' : '');

      const lineCount = text.split('\\n').length;
      let gutterText = '';
      for (let i = 1; i <= lineCount; i++) {
        gutterText += i + '\\n';
      }
      jsonGutter.textContent = gutterText;

      if (jsonBackdrop) {
        jsonBackdrop.scrollTop = jsonTextarea.scrollTop;
        jsonBackdrop.scrollLeft = jsonTextarea.scrollLeft;
      }
      jsonGutter.scrollTop = jsonTextarea.scrollTop;

      if (jsonSyntaxIndicator) {
        const trimmed = text.trim();
        if (!trimmed) {
          jsonSyntaxIndicator.textContent = '';
        } else {
          let isValid = false;
          try {
            JSON.parse(text);
            isValid = true;
          } catch (e1) {
            try {
              const mock = text.replace(/\\{\\{[^}]+\\}\\}/g, '0');
              JSON.parse(mock);
              isValid = true;
            } catch (e2) {}
          }
          if (isValid) {
            jsonSyntaxIndicator.textContent = '● Valid JSON';
            jsonSyntaxIndicator.style.color = '#4ec9b0';
          } else {
            jsonSyntaxIndicator.textContent = '● Invalid JSON';
            jsonSyntaxIndicator.style.color = '#f14c4c';
          }
        }
      }
    }

    if (jsonTextarea) {
      jsonTextarea.addEventListener('input', () => {
        updateJsonHighlight();
        if (typeof recordUndoSnapshot === 'function') recordUndoSnapshot();
      });

      jsonTextarea.addEventListener('scroll', () => {
        if (jsonBackdrop) {
          jsonBackdrop.scrollTop = jsonTextarea.scrollTop;
          jsonBackdrop.scrollLeft = jsonTextarea.scrollLeft;
        }
        if (jsonGutter) {
          jsonGutter.scrollTop = jsonTextarea.scrollTop;
        }
      });

      jsonTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = jsonTextarea.selectionStart;
          const end = jsonTextarea.selectionEnd;
          const val = jsonTextarea.value;
          if (e.shiftKey) {
            const lineStart = val.lastIndexOf('\\n', start - 1) + 1;
            if (val.slice(lineStart, lineStart + 2) === '  ') {
              jsonTextarea.value = val.slice(0, lineStart) + val.slice(lineStart + 2);
              jsonTextarea.selectionStart = Math.max(lineStart, start - 2);
              jsonTextarea.selectionEnd = Math.max(lineStart, end - 2);
            }
          } else {
            jsonTextarea.value = val.substring(0, start) + '  ' + val.substring(end);
            jsonTextarea.selectionStart = jsonTextarea.selectionEnd = start + 2;
          }
          updateJsonHighlight();
          if (typeof recordUndoSnapshot === 'function') recordUndoSnapshot();
        }
      });
    }

    // JSON beautify helper
    const btnFmtJson = document.getElementById('btn-fmt-json');
    if (btnFmtJson) {
      btnFmtJson.addEventListener('click', () => {
        const textarea = document.getElementById('req-body-json');
        if (!textarea) return;
        try {
          const parsed = JSON.parse(textarea.value);
          textarea.value = JSON.stringify(parsed, null, 2);
          updateJsonHighlight();
          if (typeof recordUndoSnapshot === 'function') recordUndoSnapshot(true);
        } catch (err) {
          // Not valid JSON
        }
      });
    }

    const btnEditBodyJson = document.getElementById('btn-edit-body-json');
    if (btnEditBodyJson) {
      btnEditBodyJson.addEventListener('click', () => {
        const textarea = document.getElementById('req-body-json');
        if (textarea) {
          vscode.postMessage({
            type: 'openInEditor',
            target: 'requestBody',
            content: textarea.value || '{\\n  \\n}',
            language: 'json'
          });
        }
      });
    }

    // XML beautify helper
    document.getElementById('btn-fmt-xml').addEventListener('click', () => {
      const textarea = document.getElementById('req-body-xml');
      try {
        let formatted = '';
        let indent = '';
        const tab = '  ';
        textarea.value.split(/>\\s*</).forEach(node => {
          if (node.match(/^\\/\\w/)) indent = indent.substring(tab.length);
          formatted += indent + '<' + node + '>\\r\\n';
          if (node.match(/^<?\\w[^>]*[^\\/]$/)) indent += tab;
        });
        const res = formatted.trim();
        if (res.startsWith('<') && res.endsWith('>')) {
          textarea.value = res;
        }
      } catch (err) {}
    });

    // Initialize Body Content & State
    function initBodyContent() {
      let type = initialBodyType;
      if (!type) {
        const ctEntry = Object.entries(initialHeaders).find(([k]) => k.toLowerCase() === 'content-type');
        const ctVal = ctEntry ? ctEntry[1].toLowerCase() : '';
        if (ctVal.includes('application/x-www-form-urlencoded')) type = 'form-urlencoded';
        else if (ctVal.includes('multipart/form-data')) type = 'form-data';
        else if (ctVal.includes('xml')) type = 'xml';
        else if (ctVal.includes('text/plain')) type = 'text';
        else if (ctVal.includes('application/json')) type = 'json';
        else if (initialBody) {
          const bodyStr = typeof initialBody === 'string' ? initialBody : JSON.stringify(initialBody);
          const trimmed = bodyStr.trim();
          if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            type = 'json';
          } else if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
            type = 'xml';
          } else if (trimmed.includes('=') && !trimmed.includes('\\n') && !trimmed.includes('{')) {
            type = 'form-urlencoded';
          } else {
            type = 'text';
          }
        } else {
          const method = "${(context.method || 'GET').toUpperCase()}";
          type = ['POST', 'PUT', 'PATCH'].includes(method) ? 'json' : 'none';
        }
      }

      if (initialBody) {
        document.getElementById('req-body-json').value = initialBody;
        document.getElementById('req-body-text').value = initialBody;
        document.getElementById('req-body-xml').value = initialBody;
        document.getElementById('req-body-raw').value = initialBody;
      }

      // Populate form-urlencoded
      if (initialBodyFormData && initialBodyFormData.length > 0 && type === 'form-urlencoded') {
        initialBodyFormData.forEach(item => addFormRow(urlencodedRows, item.key, item.value, item.enabled !== false));
      } else if (initialBody && type === 'form-urlencoded') {
        try {
          const params = new URLSearchParams(initialBody);
          let count = 0;
          params.forEach((v, k) => {
            addFormRow(urlencodedRows, k, v, true);
            count++;
          });
          if (count === 0) addFormRow(urlencodedRows);
        } catch (e) {
          addFormRow(urlencodedRows);
        }
      } else {
        addFormRow(urlencodedRows);
      }

      // Populate form-data
      if (initialBodyFormData && initialBodyFormData.length > 0 && type === 'form-data') {
        initialBodyFormData.forEach(item => addFormDataRow(item.key, item.value, item.enabled !== false, item.type || 'text'));
      } else {
        addFormDataRow();
      }

      selectBodyType(type, false);
    }

    initBodyContent();
    updateJsonHighlight();

    // Helper to get body payload
    function getBodyPayload() {
      const selected = document.querySelector('input[name="bodyType"]:checked');
      const bodyType = selected ? selected.value : 'none';
      let body = '';
      let bodyFormData = undefined;

      if (bodyType === 'none') {
        body = '';
      } else if (bodyType === 'json') {
        body = document.getElementById('req-body-json').value;
      } else if (bodyType === 'text') {
        body = document.getElementById('req-body-text').value;
      } else if (bodyType === 'xml') {
        body = document.getElementById('req-body-xml').value;
      } else if (bodyType === 'raw') {
        body = document.getElementById('req-body-raw').value;
      } else if (bodyType === 'form-urlencoded') {
        const isBulk = urlencodedBulk.style.display !== 'none';
        if (isBulk) {
          body = urlencodedRaw.value;
          bodyFormData = urlencodedRaw.value.split('\\n').filter(Boolean).map(line => {
            const idx = line.indexOf('=') >= 0 ? line.indexOf('=') : line.indexOf(':');
            return idx >= 0
              ? { key: line.substring(0, idx).trim(), value: line.substring(idx + 1).trim(), enabled: true }
              : { key: line.trim(), value: '', enabled: true };
          });
        } else {
          const rows = Array.from(urlencodedRows.querySelectorAll('.param-row'));
          bodyFormData = rows.map(r => ({
            key: r.querySelector('[data-role="key"]').value.trim(),
            value: r.querySelector('[data-role="value"]').value,
            enabled: r.querySelector('[data-role="enabled"]').checked
          }));
          const params = new URLSearchParams();
          bodyFormData.filter(r => r.enabled && r.key).forEach(r => params.append(r.key, r.value));
          body = params.toString();
        }
      } else if (bodyType === 'form-data') {
        const rows = Array.from(formdataRows.querySelectorAll('.param-row'));
        bodyFormData = rows.map(r => {
          const typeSelect = r.querySelector('[data-role="type"]');
          const rowType = typeSelect ? typeSelect.value : 'text';
          return {
            key: r.querySelector('[data-role="key"]').value.trim(),
            value: r.querySelector('[data-role="value"]').value,
            enabled: r.querySelector('[data-role="enabled"]').checked,
            type: rowType
          };
        });
        body = bodyFormData.filter(r => r.enabled && r.key).map(r => r.type === 'file' ? (r.key + '=@' + r.value) : (r.key + '=' + r.value)).join('&');
      }

      return { bodyType, body, bodyFormData };
    }

    // Helper to get variables array
    function getVariables() {
      return getRequestVariables();
    }

    // Helper to get headers map
    function getHeaders() {
      return getRequestHeaders();
    }

    // Helper to get auth settings
    function getAuthSettings() {
      const inheritVal = document.getElementById('auth-inheritance').value;
      return {
        inheritFromProfile: inheritVal === 'both' || inheritVal === 'profile',
        inheritFromEnvironment: inheritVal === 'both' || inheritVal === 'environment',
        auth: extractAuthValues()
      };
    }

    // Helper to assemble payload
    function getPayload() {
      const profileSelect = document.getElementById('select-profile');
      const selectedOption = profileSelect ? profileSelect.options[profileSelect.selectedIndex] : null;
      const profileId = selectedOption ? selectedOption.getAttribute('data-id') : undefined;
      const selectBaseUrlPref = document.getElementById('select-base-url-pref');
      const rawBaseUrlPref = selectBaseUrlPref ? selectBaseUrlPref.value : undefined;
      const baseUrlPreference = (rawBaseUrlPref === 'collection' || rawBaseUrlPref === 'environment' || rawBaseUrlPref === 'none') ? rawBaseUrlPref : undefined;
      const bodyInfo = getBodyPayload();

      return {
        requestId: currentRequestId,
        requestName: document.getElementById('req-name-input')?.value?.trim() || '',
        method: document.getElementById('method-select').value,
        url: document.getElementById('url-input').value.trim(),
        profile: profileSelect ? profileSelect.value : '',
        profileId: profileId,
        environment: document.getElementById('select-env').value,
        baseUrlPreference: baseUrlPreference,
        collection: activeCollection,
        folder: activeFolder,
        headers: getHeaders(),
        body: bodyInfo.body,
        bodyType: bodyInfo.bodyType,
        bodyFormData: bodyInfo.bodyFormData,
        variables: getVariables(),
        auth: getAuthSettings(),
        notes: document.getElementById('req-notes').value,
        preRequestScript: document.getElementById('req-pre-script')?.value || '',
        postResponseScript: document.getElementById('req-post-script')?.value || ''
      };
    }

    // Send action
    document.getElementById('btn-send').addEventListener('click', () => {
      const statusPill = document.getElementById('resp-status');
      statusPill.className = 'pill';
      statusPill.textContent = 'Sending...';

      const btnCollapseAll = document.getElementById('btn-collapse-all');
      const btnExpandAll = document.getElementById('btn-expand-all');
      if (btnCollapseAll) btnCollapseAll.style.display = 'none';
      if (btnExpandAll) btnExpandAll.style.display = 'none';

      document.getElementById('resp-body-text').textContent = 'Dispatching request...';
      vscode.postMessage({
        type: 'sendRequest',
        payload: getPayload()
      });
    });

    // Save action
    document.getElementById('btn-save').addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveRequest',
        payload: getPayload()
      });
    });

    // Secondary actions in dropdown
    document.querySelectorAll('[data-action]').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        if (action === 'preview') {
          vscode.postMessage({ type: 'previewRequest', payload: getPayload() });
        } else if (action === 'curl') {
          vscode.postMessage({ type: 'copyCurl', payload: getPayload() });
        }
      });
    });

    // Response Body Syntax Highlighting & Formatting
    let lastResponseBodyRaw = '';
    let isFormattedView = true;
    let isTableViewActive = false;
    let tableOrientation = 'horizontal'; // Default horizontal mode
    let tableNavStack = []; // [{ label: string, data: any }]
    let tableFilterQuery = '';
    let lastParsedJson = null;

    function escapeJsonHtml(str) {
      if (typeof str !== 'string') str = String(str);
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    const CHEVRON_SVG = '<svg class="json-chevron" viewBox="0 0 16 16"><path d="M4.646 6.646a.5.5 0 0 1 .708 0L8 9.293l2.646-2.647a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 0-.708z"/></svg>';

    function buildJsonTree(val, key, isLast) {
      const keyHtml = key !== undefined
        ? '<span class="json-key">' + escapeJsonHtml(JSON.stringify(key)) + '</span><span class="json-colon">:</span>'
        : '';
      const commaHtml = isLast ? '' : '<span class="json-comma">,</span>';

      if (val === null) {
        return '<div class="json-line">' + keyHtml + '<span class="json-null">null</span>' + commaHtml + '</div>';
      }
      if (typeof val === 'boolean') {
        return '<div class="json-line">' + keyHtml + '<span class="json-boolean">' + val + '</span>' + commaHtml + '</div>';
      }
      if (typeof val === 'number') {
        return '<div class="json-line">' + keyHtml + '<span class="json-number">' + val + '</span>' + commaHtml + '</div>';
      }
      if (typeof val === 'string') {
        return '<div class="json-line">' + keyHtml + '<span class="json-string">' + escapeJsonHtml(JSON.stringify(val)) + '</span>' + commaHtml + '</div>';
      }
      if (Array.isArray(val)) {
        const len = val.length;
        if (len === 0) {
          return '<div class="json-line">' + keyHtml + '<span class="json-bracket">[]</span>' + commaHtml + '</div>';
        }
        const countLabel = len + (len === 1 ? ' item' : ' items');
        let childrenHtml = '';
        for (let i = 0; i < len; i++) {
          childrenHtml += buildJsonTree(val[i], undefined, i === len - 1);
        }
        return '<div class="json-collapsible" data-type="array">' +
          '<div class="json-header" role="button" tabindex="0" aria-expanded="true">' +
            '<button type="button" class="json-toggle" tabindex="-1" title="Click to collapse / expand (Alt+click to toggle all)">' + CHEVRON_SVG + '</button>' +
            keyHtml + '<span class="json-bracket">[</span>' +
            '<span class="json-collapsed-preview" title="Click to expand">... ' + countLabel + ' ... ]</span>' +
            (commaHtml ? '<span class="json-collapsed-comma">' + commaHtml + '</span>' : '') +
          '</div>' +
          '<div class="json-children">' + childrenHtml + '</div>' +
          '<div class="json-closing"><span class="json-bracket">]</span>' + commaHtml + '</div>' +
        '</div>';
      }
      if (typeof val === 'object') {
        const keys = Object.keys(val);
        const len = keys.length;
        if (len === 0) {
          return '<div class="json-line">' + keyHtml + '<span class="json-bracket">{}</span>' + commaHtml + '</div>';
        }
        const countLabel = len + (len === 1 ? ' key' : ' keys');
        let childrenHtml = '';
        for (let i = 0; i < len; i++) {
          const k = keys[i];
          childrenHtml += buildJsonTree(val[k], k, i === len - 1);
        }
        return '<div class="json-collapsible" data-type="object">' +
          '<div class="json-header" role="button" tabindex="0" aria-expanded="true">' +
            '<button type="button" class="json-toggle" tabindex="-1" title="Click to collapse / expand (Alt+click to toggle all)">' + CHEVRON_SVG + '</button>' +
            keyHtml + '<span class="json-bracket">{</span>' +
            '<span class="json-collapsed-preview" title="Click to expand">... ' + countLabel + ' ... }</span>' +
            (commaHtml ? '<span class="json-collapsed-comma">' + commaHtml + '</span>' : '') +
          '</div>' +
          '<div class="json-children">' + childrenHtml + '</div>' +
          '<div class="json-closing"><span class="json-bracket">}</span>' + commaHtml + '</div>' +
        '</div>';
      }
      return '<div class="json-line">' + keyHtml + escapeJsonHtml(String(val)) + commaHtml + '</div>';
    }

    function highlightJson(jsonStr) {
      if (!jsonStr || typeof jsonStr !== 'string') return '';
      const escaped = jsonStr
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const JSON_TOKEN_RE = /("(?:[^"\\\\]|\\\\.)*"\\s*:?)|(\\b(?:true|false)\\b)|(\\bnull\\b)|(-?\\d+(?:\\.\\d+)?(?:[eE][+\\-]?\\d+)?)/g;
      return escaped.replace(JSON_TOKEN_RE, function (match, keyOrString, boolMatch, nullMatch, numMatch) {
        if (keyOrString) {
          if (/:\\s*$/.test(keyOrString)) {
            const colonIdx = keyOrString.lastIndexOf(':');
            const keyPart = keyOrString.slice(0, colonIdx);
            const colonPart = keyOrString.slice(colonIdx);
            return '<span class="json-key">' + keyPart + '</span>' + colonPart;
          } else {
            return '<span class="json-string">' + keyOrString + '</span>';
          }
        } else if (boolMatch) {
          return '<span class="json-boolean">' + boolMatch + '</span>';
        } else if (nullMatch) {
          return '<span class="json-null">' + nullMatch + '</span>';
        } else if (numMatch) {
          return '<span class="json-number">' + numMatch + '</span>';
        }
        return match;
      });
    }

    function renderResponseBody(bodyText) {
      const bodyPre = document.getElementById('resp-body-text');
      if (!bodyPre) return;
      lastResponseBodyRaw = bodyText || '';

      const btnCollapseAll = document.getElementById('btn-collapse-all');
      const btnExpandAll = document.getElementById('btn-expand-all');
      const btnTableResp = document.getElementById('btn-table-resp');

      if (!bodyText) {
        bodyPre.innerHTML = '<span style="color: var(--muted); font-style: italic;">(Empty response)</span>';
        if (btnCollapseAll) btnCollapseAll.style.display = 'none';
        if (btnExpandAll) btnExpandAll.style.display = 'none';
        if (btnTableResp) btnTableResp.style.display = 'none';
        return;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(bodyText);
      } catch (e) {}
      lastParsedJson = parsed;

      if (btnTableResp) {
        btnTableResp.style.display = (parsed !== null && typeof parsed === 'object') ? 'inline-block' : 'none';
      }

      if (isTableViewActive && parsed !== null) {
        tableNavStack = [{ label: 'Root', data: parsed }];
        renderTableView();
        return;
      }

      if (parsed !== null && isFormattedView) {
        const isContainer = parsed !== null && typeof parsed === 'object';
        const hasItems = isContainer && (Array.isArray(parsed) ? parsed.length > 0 : Object.keys(parsed).length > 0);
        if (btnCollapseAll) btnCollapseAll.style.display = hasItems ? 'inline-block' : 'none';
        if (btnExpandAll) btnExpandAll.style.display = hasItems ? 'inline-block' : 'none';

        if (bodyText.length > 2000000) {
          // Fallback to flat syntax coloring for massive payloads (>2MB)
          const formatted = JSON.stringify(parsed, null, 2);
          bodyPre.innerHTML = highlightJson(formatted);
        } else {
          bodyPre.innerHTML = '<div class="json-tree-root">' + buildJsonTree(parsed, undefined, true) + '</div>';
        }
      } else {
        if (btnCollapseAll) btnCollapseAll.style.display = 'none';
        if (btnExpandAll) btnExpandAll.style.display = 'none';
        bodyPre.textContent = bodyText;
      }
    }

    // Interactive collapsing/expanding via event delegation
    const bodyPreElem = document.getElementById('resp-body-text');
    if (bodyPreElem) {
      bodyPreElem.addEventListener('click', (e) => {
        const toggle = e.target.closest('.json-toggle');
        const preview = e.target.closest('.json-collapsed-preview');
        const bracket = e.target.closest('.json-bracket');

        if (toggle || preview || bracket) {
          const collapsible = (toggle || preview || bracket).closest('.json-collapsible');
          if (collapsible) {
            const willCollapse = preview ? false : !collapsible.classList.contains('collapsed');
            collapsible.classList.toggle('collapsed', willCollapse);
            const hdr = collapsible.querySelector(':scope > .json-header');
            if (hdr) {
              hdr.setAttribute('aria-expanded', String(!willCollapse));
            }
            if (e.altKey) {
              const descendants = collapsible.querySelectorAll('.json-collapsible');
              descendants.forEach(d => {
                d.classList.toggle('collapsed', willCollapse);
                const subHdr = d.querySelector(':scope > .json-header');
                if (subHdr) subHdr.setAttribute('aria-expanded', String(!willCollapse));
              });
            }
            e.stopPropagation();
          }
        }
      });

      bodyPreElem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const header = e.target.closest('.json-header');
          if (header) {
            const collapsible = header.closest('.json-collapsible');
            if (collapsible) {
              const willCollapse = !collapsible.classList.contains('collapsed');
              collapsible.classList.toggle('collapsed', willCollapse);
              header.setAttribute('aria-expanded', String(!willCollapse));
              e.preventDefault();
              e.stopPropagation();
            }
          }
        }
      });
    }

    // Collapse All / Expand All actions
    const btnCollapseAllAction = document.getElementById('btn-collapse-all');
    if (btnCollapseAllAction) {
      btnCollapseAllAction.addEventListener('click', () => {
        if (!bodyPreElem) return;
        const collapsibles = bodyPreElem.querySelectorAll('.json-collapsible');
        collapsibles.forEach(el => {
          el.classList.add('collapsed');
          const hdr = el.querySelector(':scope > .json-header');
          if (hdr) hdr.setAttribute('aria-expanded', 'false');
        });
      });
    }

    const btnExpandAllAction = document.getElementById('btn-expand-all');
    if (btnExpandAllAction) {
      btnExpandAllAction.addEventListener('click', () => {
        if (!bodyPreElem) return;
        const collapsibles = bodyPreElem.querySelectorAll('.json-collapsible');
        collapsibles.forEach(el => {
          el.classList.remove('collapsed');
          const hdr = el.querySelector(':scope > .json-header');
          if (hdr) hdr.setAttribute('aria-expanded', 'true');
        });
      });
    }

    // Toggle Formatted / Raw view
    const btnFormatResp = document.getElementById('btn-format-resp');
    if (btnFormatResp) {
      btnFormatResp.addEventListener('click', () => {
        isFormattedView = !isFormattedView;
        btnFormatResp.textContent = isFormattedView ? 'Raw' : 'Format';
        btnFormatResp.title = isFormattedView ? 'Switch to Raw view' : 'Format and colorize JSON';
        renderResponseBody(lastResponseBodyRaw);
      });
    }

    // Open Response in VS Code Editor (Monaco)
    const btnOpenEditor = document.getElementById('btn-open-editor');
    if (btnOpenEditor) {
      btnOpenEditor.addEventListener('click', () => {
        if (!lastResponseBodyRaw) return;
        vscode.postMessage({
          type: 'openInEditor',
          content: lastResponseBodyRaw,
          language: 'json'
        });
      });
    }

    // Copy Response
    const btnCopyResp = document.getElementById('btn-copy-resp');
    if (btnCopyResp) {
      btnCopyResp.addEventListener('click', () => {
        let text = '';
        const headersTab = document.getElementById('tab-resp-headers');
        if (headersTab && headersTab.classList.contains('active')) {
          const rows = Array.from(headersTab.querySelectorAll('tbody tr'));
          text = rows.map(r => {
            const k = r.querySelector('.header-key');
            const v = r.querySelector('.header-val');
            return (k && v) ? (k.textContent + ': ' + v.textContent) : r.textContent;
          }).join('\\n');
        } else {
          text = lastResponseBodyRaw || document.getElementById('resp-body-text').textContent;
          if (isFormattedView) {
            try {
              text = JSON.stringify(JSON.parse(text), null, 2);
            } catch (e) {}
          }
        }
        navigator.clipboard.writeText(text);
        btnCopyResp.textContent = 'Copied!';
        setTimeout(() => { btnCopyResp.textContent = 'Copy'; }, 1500);
      });
    }

    // Tabular Response View Engine
    function renderTableCell(val, fieldKey, rowIdx) {
      if (Array.isArray(val)) {
        const len = val.length;
        const label = '[' + len + (len === 1 ? ' object' : ' objects') + ']';
        return '<button type="button" class="table-array-badge" data-key="' + escapeJsonHtml(fieldKey) + '" data-row="' + rowIdx + '" title="Click to view ' + len + ' items for this record">📦 ' + label + ' ↗</button>';
      }
      if (val === null) return '<span class="table-cell-null">null</span>';
      if (val === undefined) return '<span class="table-cell-null">-</span>';
      if (typeof val === 'boolean') return '<span class="table-cell-bool">' + val + '</span>';
      if (typeof val === 'number') return '<span class="table-cell-num">' + val + '</span>';
      if (typeof val === 'object') {
        const keys = Object.keys(val);
        const jsonPreview = JSON.stringify(val);
        return '<span class="table-obj-badge" title="' + escapeJsonHtml(jsonPreview) + '">{ ' + keys.length + (keys.length === 1 ? ' field' : ' fields') + ' }</span>';
      }
      const s = String(val);
      return '<span class="table-cell-str" title="' + escapeJsonHtml(s) + '">' + escapeJsonHtml(s) + '</span>';
    }

    function renderTableView() {
      const tableElem = document.getElementById('resp-tabular-table');
      const thead = document.getElementById('resp-table-head');
      const tbody = document.getElementById('resp-table-body');
      const emptyDiv = document.getElementById('resp-table-empty');
      const bcElem = document.getElementById('table-breadcrumbs');
      const backBtn = document.getElementById('btn-table-back');
      const countTag = document.getElementById('table-record-count');
      const orientBtn = document.getElementById('btn-table-orientation');

      if (!tableElem || !thead || !tbody) return;

      if (tableNavStack.length === 0) {
        if (lastParsedJson !== null) {
          tableNavStack = [{ label: 'Root', data: lastParsedJson }];
        } else {
          tableElem.style.display = 'none';
          if (emptyDiv) {
            emptyDiv.textContent = 'No JSON data available to display in tabular form.';
            emptyDiv.style.display = 'block';
          }
          return;
        }
      }

      const currentNav = tableNavStack[tableNavStack.length - 1];
      const currentData = currentNav.data;

      // Update Breadcrumbs
      if (backBtn) {
        backBtn.style.display = tableNavStack.length > 1 ? 'inline-flex' : 'none';
      }
      if (bcElem) {
        let bcHtml = '';
        tableNavStack.forEach((nav, idx) => {
          const isLast = idx === tableNavStack.length - 1;
          if (idx > 0) {
            bcHtml += '<span class="table-crumb-sep">&rsaquo;</span>';
          }
          if (isLast) {
            bcHtml += '<span class="table-crumb-active">' + escapeJsonHtml(nav.label) + '</span>';
          } else {
            bcHtml += '<a href="#" class="table-crumb-link" data-depth="' + idx + '">' + escapeJsonHtml(nav.label) + '</a>';
          }
        });
        bcElem.innerHTML = bcHtml;
      }

      // Update orientation button label
      if (orientBtn) {
        orientBtn.textContent = tableOrientation === 'horizontal' ? '⇄ Flip (Horizontal)' : '⇄ Flip (Vertical)';
        orientBtn.title = tableOrientation === 'horizontal'
          ? 'Currently in Horizontal mode (rows as records). Click to flip to Vertical mode.'
          : 'Currently in Vertical mode (columns as records). Click to flip to Horizontal mode.';
      }

      // Normalize current data to array of records
      let items = [];
      if (Array.isArray(currentData)) {
        items = currentData;
      } else if (currentData !== null && typeof currentData === 'object') {
        items = [currentData];
      } else {
        items = [{ value: currentData }];
      }

      if (items.length === 0) {
        tableElem.style.display = 'none';
        if (emptyDiv) {
          emptyDiv.textContent = 'Array is empty (0 records).';
          emptyDiv.style.display = 'block';
        }
        if (countTag) countTag.textContent = '0 records';
        return;
      }

      tableElem.style.display = 'table';
      if (emptyDiv) emptyDiv.style.display = 'none';

      // Discover all property keys across objects
      const headersSet = new Set();
      items.forEach(item => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          Object.keys(item).forEach(k => headersSet.add(k));
        }
      });
      const headers = headersSet.size > 0 ? Array.from(headersSet) : ['Value'];

      // Apply filter
      const q = (tableFilterQuery || '').toLowerCase();
      const filteredItemsWithIdx = items.map((item, originalIdx) => ({ item, originalIdx }))
        .filter(({ item }) => {
          if (!q) return true;
          if (item === null || item === undefined) return false;
          if (typeof item === 'object') {
            return Object.values(item).some(v => {
              if (v === null || v === undefined) return false;
              const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
              return str.toLowerCase().includes(q);
            });
          }
          return String(item).toLowerCase().includes(q);
        });

      // Update count badge
      if (countTag) {
        const recLabel = filteredItemsWithIdx.length === 1 ? 'record' : 'records';
        if (q && filteredItemsWithIdx.length !== items.length) {
          countTag.textContent = filteredItemsWithIdx.length + ' of ' + items.length + ' ' + recLabel;
        } else {
          countTag.textContent = items.length + ' ' + recLabel + (headers.length > 1 ? ', ' + headers.length + ' cols' : '');
        }
      }

      // If filter matched nothing
      if (filteredItemsWithIdx.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = '';
        tableElem.style.display = 'none';
        if (emptyDiv) {
          emptyDiv.textContent = 'No records match filter "' + tableFilterQuery + '".';
          emptyDiv.style.display = 'block';
        }
        return;
      }

      // Render either Horizontal or Vertical
      if (tableOrientation === 'horizontal') {
        // Horizontal (default): Columns = headers, Rows = items
        let headHtml = '<tr><th class="col-index">#</th>';
        headers.forEach(h => {
          headHtml += '<th>' + escapeJsonHtml(h) + '</th>';
        });
        headHtml += '</tr>';
        thead.innerHTML = headHtml;

        let bodyHtml = '';
        filteredItemsWithIdx.forEach(({ item, originalIdx }) => {
          bodyHtml += '<tr><td class="col-index">' + (originalIdx + 1) + '</td>';
          headers.forEach(h => {
            const val = (item && typeof item === 'object' && !Array.isArray(item)) ? item[h] : item;
            bodyHtml += '<td>' + renderTableCell(val, h, originalIdx) + '</td>';
          });
          bodyHtml += '</tr>';
        });
        tbody.innerHTML = bodyHtml;
      } else {
        // Vertical (Transposed): Rows = headers, Columns = records
        let headHtml = '<tr><th style="min-width: 120px;">Field / Property</th>';
        filteredItemsWithIdx.forEach(({ originalIdx }) => {
          headHtml += '<th>Record #' + (originalIdx + 1) + '</th>';
        });
        headHtml += '</tr>';
        thead.innerHTML = headHtml;

        let bodyHtml = '';
        headers.forEach(h => {
          bodyHtml += '<tr><td style="font-weight: 600; color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);">' + escapeJsonHtml(h) + '</td>';
          filteredItemsWithIdx.forEach(({ item, originalIdx }) => {
            const val = (item && typeof item === 'object' && !Array.isArray(item)) ? item[h] : item;
            bodyHtml += '<td>' + renderTableCell(val, h, originalIdx) + '</td>';
          });
          bodyHtml += '</tr>';
        });
        tbody.innerHTML = bodyHtml;
      }
    }

    // Array badge drill-down click (event delegation)
    const tableScrollElem = document.getElementById('table-scroll-container');
    if (tableScrollElem) {
      tableScrollElem.addEventListener('click', (e) => {
        const badge = e.target.closest('.table-array-badge');
        if (!badge) return;
        const key = badge.getAttribute('data-key');
        const rowIdx = parseInt(badge.getAttribute('data-row'), 10);
        if (isNaN(rowIdx) || !tableNavStack.length) return;

        const currentNav = tableNavStack[tableNavStack.length - 1];
        const currentData = currentNav.data;
        let childArr = null;

        if (Array.isArray(currentData)) {
          const rowObj = currentData[rowIdx];
          if (rowObj && Array.isArray(rowObj[key])) {
            childArr = rowObj[key];
          }
        } else if (currentData && typeof currentData === 'object') {
          if (Array.isArray(currentData[key])) {
            childArr = currentData[key];
          }
        }

        if (childArr) {
          tableFilterQuery = '';
          const filterInput = document.getElementById('table-filter-input');
          if (filterInput) filterInput.value = '';
          tableNavStack.push({
            label: key + ' [' + (rowIdx + 1) + ']',
            data: childArr
          });
          renderTableView();
        }
      });
    }

    // Breadcrumb navigation click
    const tableBcElem = document.getElementById('table-breadcrumbs');
    if (tableBcElem) {
      tableBcElem.addEventListener('click', (e) => {
        const link = e.target.closest('.table-crumb-link');
        if (!link) return;
        e.preventDefault();
        const depth = parseInt(link.getAttribute('data-depth'), 10);
        if (!isNaN(depth) && depth >= 0 && depth < tableNavStack.length) {
          tableFilterQuery = '';
          const filterInput = document.getElementById('table-filter-input');
          if (filterInput) filterInput.value = '';
          tableNavStack = tableNavStack.slice(0, depth + 1);
          renderTableView();
        }
      });
    }

    // Back button in table toolbar
    const btnTableBack = document.getElementById('btn-table-back');
    if (btnTableBack) {
      btnTableBack.addEventListener('click', () => {
        if (tableNavStack.length > 1) {
          tableFilterQuery = '';
          const filterInput = document.getElementById('table-filter-input');
          if (filterInput) filterInput.value = '';
          tableNavStack.pop();
          renderTableView();
        }
      });
    }

    // Filter input in table toolbar
    const tableFilterInput = document.getElementById('table-filter-input');
    if (tableFilterInput) {
      tableFilterInput.addEventListener('input', (e) => {
        tableFilterQuery = (e.target.value || '').trim();
        renderTableView();
      });
    }

    // Flip orientation button
    const btnTableOrientation = document.getElementById('btn-table-orientation');
    if (btnTableOrientation) {
      btnTableOrientation.addEventListener('click', () => {
        tableOrientation = tableOrientation === 'horizontal' ? 'vertical' : 'horizontal';
        renderTableView();
      });
    }

    // Export CSV
    const btnTableExportCsv = document.getElementById('btn-table-export-csv');
    if (btnTableExportCsv) {
      btnTableExportCsv.addEventListener('click', () => {
        const currentNav = tableNavStack.length > 0 ? tableNavStack[tableNavStack.length - 1] : null;
        const exportData = currentNav ? currentNav.data : lastParsedJson;
        if (!exportData) return;
        const suffix = (currentNav && currentNav.label !== 'Root') ? '_' + currentNav.label.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
        const baseName = (document.getElementById('crumb-request-name')?.value || 'response').trim();
        vscode.postMessage({
          type: 'exportCsv',
          payload: {
            data: exportData,
            filename: baseName + suffix
          }
        });
      });
    }

    // Export XLSX (multi-sheet with dedicated tabs for all arrays)
    const btnTableExportXlsx = document.getElementById('btn-table-export-xlsx');
    if (btnTableExportXlsx) {
      btnTableExportXlsx.addEventListener('click', () => {
        const exportData = lastParsedJson || (tableNavStack.length > 0 ? tableNavStack[0].data : null);
        if (!exportData) return;
        const baseName = (document.getElementById('crumb-request-name')?.value || 'response').trim();
        vscode.postMessage({
          type: 'exportXlsx',
          payload: {
            data: exportData,
            filename: baseName
          }
        });
      });
    }

    // Toggle Tabular View button
    const btnTableResp = document.getElementById('btn-table-resp');
    if (btnTableResp) {
      btnTableResp.addEventListener('click', () => {
        const bodyPreElem = document.getElementById('resp-body-text');
        const tableViewElem = document.getElementById('resp-table-view');
        const btnFormat = document.getElementById('btn-format-resp');
        const btnCollapse = document.getElementById('btn-collapse-all');
        const btnExpand = document.getElementById('btn-expand-all');

        if (!isTableViewActive) {
          let parsed = null;
          try {
            parsed = JSON.parse(lastResponseBodyRaw);
          } catch (e) {}

          if (parsed === null) {
            const emptyDiv = document.getElementById('resp-table-empty');
            if (emptyDiv) {
              emptyDiv.textContent = 'Response body is not valid JSON and cannot be converted to tabular form.';
              emptyDiv.style.display = 'block';
            }
            return;
          }

          lastParsedJson = parsed;
          isTableViewActive = true;
          tableNavStack = [{ label: 'Root', data: parsed }];
          tableFilterQuery = '';
          const filterInput = document.getElementById('table-filter-input');
          if (filterInput) filterInput.value = '';

          btnTableResp.textContent = '{} JSON';
          btnTableResp.classList.add('active');
          btnTableResp.title = 'Switch back to JSON view';

          if (btnFormat) btnFormat.style.display = 'none';
          if (btnCollapse) btnCollapse.style.display = 'none';
          if (btnExpand) btnExpand.style.display = 'none';

          if (bodyPreElem) bodyPreElem.style.display = 'none';
          if (tableViewElem) tableViewElem.style.display = 'flex';

          renderTableView();
        } else {
          isTableViewActive = false;
          btnTableResp.textContent = '⊞ Table';
          btnTableResp.classList.remove('active');
          btnTableResp.title = 'Flip Response into Tabular View';

          if (btnFormat) btnFormat.style.display = 'inline-block';
          renderResponseBody(lastResponseBodyRaw);

          if (tableViewElem) tableViewElem.style.display = 'none';
          if (bodyPreElem) bodyPreElem.style.display = 'block';
        }
      });
    }

    // Message listener from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'requestResult') {
        const meta = msg.meta;
        const statusPill = document.getElementById('resp-status');
        const timeTag = document.getElementById('resp-time');
        const sizeTag = document.getElementById('resp-size');
        const bodyPre = document.getElementById('resp-body-text');

        // Status pill
        if (meta.status === 0) {
          statusPill.textContent = meta.statusText || 'Error';
          statusPill.className = 'pill status-err';
        } else {
          statusPill.textContent = meta.status + ' ' + meta.statusText;
          statusPill.className = 'pill';
          if (meta.status >= 200 && meta.status < 300) statusPill.classList.add('status-2xx');
          else if (meta.status >= 300 && meta.status < 400) statusPill.classList.add('status-3xx');
          else if (meta.status >= 400 && meta.status < 500) statusPill.classList.add('status-4xx');
          else if (meta.status >= 500) statusPill.classList.add('status-5xx');
        }

        timeTag.textContent = meta.elapsedMs + ' ms';
        if (meta.status === 0) {
          sizeTag.textContent = '';
        } else if (meta.sizeBytes) {
          const sizeKb = (meta.sizeBytes / 1024).toFixed(1);
          sizeTag.textContent = sizeKb + ' KB';
        }

        // Body rendering
        if (meta.status === 0) {
          if (isTableViewActive) {
            isTableViewActive = false;
            const btnTable = document.getElementById('btn-table-resp');
            if (btnTable) {
              btnTable.textContent = '⊞ Table';
              btnTable.classList.remove('active');
              btnTable.style.display = 'none';
            }
            const tableElem = document.getElementById('resp-table-view');
            if (tableElem) tableElem.style.display = 'none';
            bodyPre.style.display = 'block';
          }
          // Network error — render diagnostic card
          bodyPre.innerHTML = '';
          bodyPre.style.padding = '0';

          const card = document.createElement('div');
          card.style.cssText = [
            'margin: 12px',
            'padding: 14px 16px',
            'border-radius: 6px',
            'border: 1px solid rgba(241,76,76,0.35)',
            'background: rgba(241,76,76,0.07)',
            'font-family: Consolas, Monaco, "Courier New", monospace',
            'font-size: 12px',
            'color: var(--text)',
            'white-space: pre-wrap',
            'word-break: break-word',
            'line-height: 1.6'
          ].join(';');

          const heading = document.createElement('div');
          heading.style.cssText = 'font-size: 13px; font-weight: 700; color: #f14c4c; margin-bottom: 10px; font-family: var(--vscode-font-family, inherit); display: flex; align-items: center; gap: 6px;';
          heading.innerHTML = '⚠ ' + (meta.statusText || 'Network Error');

          const body = document.createElement('pre');
          body.style.cssText = 'margin: 0; padding: 0; background: transparent; font-size: 12px; color: var(--text); white-space: pre-wrap; word-break: break-word;';
          body.textContent = meta.body || 'An unknown network error occurred.';

          card.appendChild(heading);
          card.appendChild(body);
          bodyPre.appendChild(card);
          bodyPre.style.padding = '0';
        } else {
          // Normal response
          bodyPre.style.padding = '12px';
          renderResponseBody(meta.body || '');
        }

        // Response headers
        const headerEntries = Object.entries(meta.headers || {});
        document.getElementById('resp-header-count').textContent = \`(\${headerEntries.length})\`;
        const headersTbody = document.getElementById('resp-headers-body');
        headersTbody.innerHTML = '';
        if (headerEntries.length > 0) {
          headerEntries.forEach(([k, v]) => {
            const tr = document.createElement('tr');
            const tdK = document.createElement('td');
            tdK.className = 'header-key';
            tdK.textContent = k;
            const tdV = document.createElement('td');
            tdV.className = 'header-val';
            tdV.textContent = v;
            tr.appendChild(tdK);
            tr.appendChild(tdV);
            headersTbody.appendChild(tr);
          });
        } else {
          headersTbody.innerHTML = '<tr><td colspan="2" style="color: var(--muted);">No headers received.</td></tr>';
        }

        // Render test results
        const testBadge = document.getElementById('resp-test-count');
        const testsContainer = document.getElementById('test-results-container');
        if (testsContainer) {
          testsContainer.innerHTML = '';
          if (meta.testResults && meta.testResults.length > 0) {
            const passedCount = meta.testResults.filter(t => t.passed).length;
            const totalCount = meta.testResults.length;
            if (testBadge) {
              testBadge.style.display = 'inline-block';
              testBadge.textContent = \`\${passedCount}/\${totalCount}\`;
              testBadge.className = 'pill ' + (passedCount === totalCount ? 'status-2xx' : 'status-err');
            }

            meta.testResults.forEach(t => {
              const card = document.createElement('div');
              card.className = 'test-result-card ' + (t.passed ? 'passed' : 'failed');

              const header = document.createElement('div');
              header.className = 'test-result-header';

              const icon = document.createElement('span');
              icon.className = t.passed ? 'test-pass-icon' : 'test-fail-icon';
              icon.textContent = t.passed ? '✔' : '✖';

              const title = document.createElement('span');
              title.textContent = t.name;

              header.appendChild(icon);
              header.appendChild(title);
              card.appendChild(header);

              if (!t.passed && t.error) {
                const errDiv = document.createElement('div');
                errDiv.className = 'test-error-msg';
                errDiv.textContent = t.error;
                card.appendChild(errDiv);
              }

              testsContainer.appendChild(card);
            });
          } else {
            if (testBadge) testBadge.style.display = 'none';
            testsContainer.innerHTML = '<div style="color: var(--muted); font-size:12px;">No tests executed for this request. Add assertions in the <strong>Scripts &rarr; Post-Response Script</strong> tab using <code>test(...)</code> or <code>bn.test(...)</code>.</div>';
          }
        }

        // Render console logs
        const consoleBadge = document.getElementById('resp-console-count');
        const consoleContainer = document.getElementById('console-logs-container');
        if (consoleContainer) {
          consoleContainer.innerHTML = '';
          if (meta.consoleLogs && meta.consoleLogs.length > 0) {
            if (consoleBadge) {
              consoleBadge.style.display = 'inline-block';
              consoleBadge.textContent = \`(\${meta.consoleLogs.length})\`;
            }

            meta.consoleLogs.forEach(l => {
              const row = document.createElement('div');
              row.className = 'console-log-row';

              const timeSpan = document.createElement('span');
              timeSpan.className = 'console-time';
              timeSpan.textContent = new Date(l.timestamp).toLocaleTimeString([], { hour12: false });

              const badgeSpan = document.createElement('span');
              badgeSpan.className = 'console-badge ' + l.level;
              badgeSpan.textContent = l.level;

              const msgSpan = document.createElement('span');
              msgSpan.className = 'console-msg';
              msgSpan.textContent = l.message;

              row.appendChild(timeSpan);
              row.appendChild(badgeSpan);
              row.appendChild(msgSpan);
              consoleContainer.appendChild(row);
            });
          } else {
            if (consoleBadge) consoleBadge.style.display = 'none';
            consoleContainer.innerHTML = '<div style="color: var(--muted); font-size:12px;">No console logs. Use <code>console.log(...)</code> in pre-request or post-response scripts.</div>';
          }
        }
      }

      if (msg.type === 'saved') {
        currentRequestId = msg.id;
        if (msg.name && reqNameInput) {
          reqNameInput.value = msg.name;
          lastSavedName = msg.name;
          autoResizeInput(reqNameInput);
        }
        baselineDirtySnapshot = captureDirtySnapshot();
        isCurrentlyDirty = false;
        updateDirtyUi(false);
        vscode.postMessage({ type: 'dirtyStateChanged', isDirty: false });

        const statusPill = document.getElementById('resp-status');
        statusPill.textContent = 'Saved';
        statusPill.className = 'pill status-2xx';
        setTimeout(() => {
          if (statusPill.textContent === 'Saved') statusPill.textContent = 'Waiting';
        }, 2000);
      }

      if (msg.type === 'requestRenamed' && msg.name) {
        if (reqNameInput) {
          reqNameInput.value = msg.name;
          lastSavedName = msg.name;
          autoResizeInput(reqNameInput);
        }
      }

      if (msg.type === 'fileSelected' && msg.rowId) {
        const row = document.querySelector('.formdata-row[data-row-id="' + msg.rowId + '"]');
        if (row) {
          const valInput = row.querySelector('[data-role="value"]');
          if (valInput) {
            valInput.value = msg.filePath || '';
          }
        }
      }

      if (msg.type === 'setRequestBody' && typeof msg.body === 'string') {
        const textarea = document.getElementById('req-body-json');
        if (textarea) {
          textarea.value = msg.body;
          updateJsonHighlight();
        }
      }

      if (msg.type === 'updateInherited') {
        currentInheritedVars = msg.inheritedVars || [];
        currentInheritedHeaders = msg.inheritedHeaders || [];
        if (msg.resolvedVars) {
          currentResolvedVars = msg.resolvedVars;
        }
        renderInheritedVars();
        renderInheritedHeaders();
        refreshAllVariableHighlights();
      }

      if (msg.type === 'preview') {
        const bodyPre = document.getElementById('resp-body-text');
        if (bodyPre) bodyPre.style.padding = '12px';
        renderResponseBody(JSON.stringify(msg.preview, null, 2));
        const statusPill = document.getElementById('resp-status');
        if (statusPill) {
          statusPill.textContent = 'Preview';
          statusPill.className = 'pill status-3xx';
        }
        if (msg.preview && msg.preview.availableVariables) {
          currentResolvedVars = msg.preview.availableVariables;
          refreshAllVariableHighlights();
        }
      }

      if (msg.type === 'stateUpdated') {
        if (msg.environments && Array.isArray(msg.environments)) {
          currentEnvironments = msg.environments;
        }
        if (msg.profiles && Array.isArray(msg.profiles)) {
          const selectProfile = document.getElementById('select-profile');
          if (selectProfile) {
            const currentSelected = selectProfile.value;
            selectProfile.innerHTML = msg.profiles.map(function(p) {
              const guardsAttr = p.guards ? JSON.stringify(p.guards).replace(/"/g, '&quot;') : '';
              return '<option value="' + p.name.replace(/"/g, '&quot;') + '" data-id="' + p.id.replace(/"/g, '&quot;') + '" data-color="' + (p.color || '#3b82f6').replace(/"/g, '&quot;') + '" data-guards="' + guardsAttr + '">' + p.name + '</option>';
            }).join('');
            if (msg.profiles.some(function(p) { return p.name === currentSelected; })) {
              selectProfile.value = currentSelected;
            }
            updateActiveProfileAccent();
          }
        }
        const selectEnv = document.getElementById('select-env');
        const currentEnvVal = selectEnv ? selectEnv.value : '';
        updateEnvironmentDropdown(currentEnvVal);
        requestInheritedData();
      }

      if (msg.type === 'activeEnvironmentChanged') {
        const selectEnv = document.getElementById('select-env');
        if (selectEnv) {
          selectEnv.value = msg.envName || '';
          requestInheritedData();
        }
      }

      if (msg.type === 'activeProfileChanged' && (msg.profileId || msg.profileName)) {
        const selectProfile = document.getElementById('select-profile');
        if (selectProfile) {
          for (let i = 0; i < selectProfile.options.length; i++) {
            const opt = selectProfile.options[i];
            if ((msg.profileId && opt.dataset.id === msg.profileId) || (msg.profileName && opt.value === msg.profileName)) {
              selectProfile.selectedIndex = i;
              break;
            }
          }
          updateActiveProfileAccent();
          updateEnvironmentDropdown();
          requestInheritedData();
        }
      }
    });

    // ==========================================
    // Comprehensive Undo / Redo Manager (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
    // ==========================================
    const undoStack = [];
    const redoStack = [];
    let isUndoingOrRedoing = false;
    let lastRecordedSnapshot = null;
    let recordTimer = null;

    function captureCurrentState() {
      try {
        return JSON.stringify({
          method: document.getElementById('method-select')?.value,
          url: document.getElementById('url-input')?.value,
          headers: getHeaders(),
          variables: getVariables(),
          bodyInfo: getBodyPayload(),
          notes: document.getElementById('req-notes')?.value,
          preScript: document.getElementById('req-pre-script')?.value,
          postScript: document.getElementById('req-post-script')?.value,
          activeTab: document.querySelector('.tab-btn.active')?.getAttribute('data-tab'),
          activeBodyType: document.querySelector('input[name="bodyType"]:checked')?.value,
          focusedId: document.activeElement ? document.activeElement.id : null,
          selStart: document.activeElement && 'selectionStart' in document.activeElement ? document.activeElement.selectionStart : null,
          selEnd: document.activeElement && 'selectionEnd' in document.activeElement ? document.activeElement.selectionEnd : null,
        });
      } catch (_) {
        return null;
      }
    }

    function recordUndoSnapshot(immediate = false) {
      if (isUndoingOrRedoing) return;
      if (immediate) {
        if (recordTimer) clearTimeout(recordTimer);
        const current = captureCurrentState();
        if (current && current !== lastRecordedSnapshot) {
          if (lastRecordedSnapshot !== null) {
            undoStack.push(lastRecordedSnapshot);
            if (undoStack.length > 60) undoStack.shift();
            redoStack.length = 0;
          }
          lastRecordedSnapshot = current;
        }
        return;
      }

      if (recordTimer) clearTimeout(recordTimer);
      recordTimer = setTimeout(() => {
        const current = captureCurrentState();
        if (current && current !== lastRecordedSnapshot) {
          if (lastRecordedSnapshot !== null) {
            undoStack.push(lastRecordedSnapshot);
            if (undoStack.length > 60) undoStack.shift();
            redoStack.length = 0;
          }
          lastRecordedSnapshot = current;
        }
      }, 300);
    }

    function restoreSnapshot(serialized) {
      if (!serialized) return;
      isUndoingOrRedoing = true;
      try {
        const state = JSON.parse(serialized);
        lastRecordedSnapshot = serialized;

        if (state.method) {
          const m = document.getElementById('method-select');
          if (m) m.value = state.method;
        }
        if (state.url !== undefined) {
          const u = document.getElementById('url-input');
          if (u) u.value = state.url;
        }
        if (state.notes !== undefined) {
          const n = document.getElementById('req-notes');
          if (n) n.value = state.notes;
        }
        if (state.preScript !== undefined) {
          const ps = document.getElementById('req-pre-script');
          if (ps) ps.value = state.preScript;
        }
        if (state.postScript !== undefined) {
          const pos = document.getElementById('req-post-script');
          if (pos) pos.value = state.postScript;
        }

        // Headers
        if (state.headers && headerRowsContainer) {
          headerRowsContainer.innerHTML = '';
          const hEntries = Object.entries(state.headers);
          if (hEntries.length > 0) {
            hEntries.forEach(([k, v]) => addHeaderRow(k, v, true));
          } else {
            addHeaderRow('', '', true);
          }
        }

        // Variables
        if (state.variables && varRowsContainer) {
          varRowsContainer.innerHTML = '';
          if (state.variables.length > 0) {
            state.variables.forEach(v => addVarRow(v.name, v.value, v.enabled !== false, v.hidden === true));
          } else {
            addVarRow();
          }
        }

        // Body
        if (state.bodyInfo) {
          const bType = state.bodyInfo.bodyType || 'none';
          selectBodyType(bType, false);
          if (bType === 'json') {
            const el = document.getElementById('req-body-json');
            if (el) el.value = state.bodyInfo.body || '';
          } else if (bType === 'text') {
            const el = document.getElementById('req-body-text');
            if (el) el.value = state.bodyInfo.body || '';
          } else if (bType === 'xml') {
            const el = document.getElementById('req-body-xml');
            if (el) el.value = state.bodyInfo.body || '';
          } else if (bType === 'raw') {
            const el = document.getElementById('req-body-raw');
            if (el) el.value = state.bodyInfo.body || '';
          }
        }

        if (state.activeTab) {
          const tabBtn = document.querySelector('.tab-btn[data-tab="' + state.activeTab + '"]');
          if (tabBtn) tabBtn.click();
        }

        if (state.focusedId) {
          const el = document.getElementById(state.focusedId);
          if (el) {
            el.focus();
            if (state.selStart !== null && 'setSelectionRange' in el) {
              el.setSelectionRange(state.selStart, state.selEnd || state.selStart);
            }
          }
        }

        updateUrlPreview();
        renderInheritedVars();
        renderInheritedHeaders();
      } finally {
        isUndoingOrRedoing = false;
      }
    }

    function performUndo() {
      if (undoStack.length === 0) return false;
      recordUndoSnapshot(true);
      const prev = undoStack.pop();
      if (lastRecordedSnapshot) redoStack.push(lastRecordedSnapshot);
      restoreSnapshot(prev);
      safeSetTimeout(checkDirtyState, 10);
      return true;
    }

    function performRedo() {
      if (redoStack.length === 0) return false;
      const next = redoStack.pop();
      if (lastRecordedSnapshot) undoStack.push(lastRecordedSnapshot);
      restoreSnapshot(next);
      safeSetTimeout(checkDirtyState, 10);
      return true;
    }

    // ==========================================
    // Dirty State Tracking & Ctrl+S Shortcut
    // ==========================================
    const safeSetTimeout = typeof setTimeout !== 'undefined' ? setTimeout : (fn) => { try { fn(); } catch (_) {} };
    let baselineDirtySnapshot = null;
    let isCurrentlyDirty = false;

    function captureDirtySnapshot() {
      try {
        const p = getPayload();
        return JSON.stringify({
          name: p.requestName,
          method: p.method,
          url: p.url,
          profile: p.profile,
          environment: p.environment,
          baseUrlPreference: p.baseUrlPreference,
          headers: p.headers,
          body: p.body,
          bodyType: p.bodyType,
          bodyFormData: p.bodyFormData,
          variables: p.variables,
          auth: p.auth,
          notes: p.notes,
          preRequestScript: p.preRequestScript,
          postResponseScript: p.postResponseScript,
        });
      } catch (_) {
        return '';
      }
    }

    function updateDirtyUi(dirty) {
      const btnSave = document.getElementById('btn-save');
      if (btnSave) {
        if (dirty) {
          btnSave.classList.add('dirty');
          btnSave.textContent = 'Save *';
        } else {
          btnSave.classList.remove('dirty');
          btnSave.textContent = 'Save';
        }
      }
    }

    function checkDirtyState() {
      if (baselineDirtySnapshot === null) return;
      const current = captureDirtySnapshot();
      const dirty = current !== baselineDirtySnapshot;
      if (dirty !== isCurrentlyDirty) {
        isCurrentlyDirty = dirty;
        updateDirtyUi(dirty);
        vscode.postMessage({ type: 'dirtyStateChanged', isDirty: dirty });
      }
    }

    safeSetTimeout(() => {
      baselineDirtySnapshot = captureDirtySnapshot();
    }, 150);

    // Initialize baseline snapshot
    lastRecordedSnapshot = captureCurrentState();

    // Listen globally for edits to schedule snapshots and check dirty state
    document.addEventListener('input', () => {
      if (!isUndoingOrRedoing) {
        recordUndoSnapshot(false);
        checkDirtyState();
      }
    }, true);
    document.addEventListener('change', () => {
      if (!isUndoingOrRedoing) {
        recordUndoSnapshot(false);
        checkDirtyState();
      }
    }, true);

    // Intercept Ctrl+S, Ctrl+Z, and Ctrl+Y in capture phase
    window.addEventListener('keydown', (e) => {
      const isS = e.key === 's' || e.key === 'S';
      if ((e.ctrlKey || e.metaKey) && isS) {
        e.preventDefault();
        e.stopPropagation();
        const btnSave = document.getElementById('btn-save');
        if (btnSave) btnSave.click();
        return;
      }

      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';
      if ((e.ctrlKey || e.metaKey) && (isZ || isY)) {
        const isRedo = isY || (isZ && e.shiftKey);
        const activeEl = document.activeElement;
        const isTextInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

        if (!isRedo) {
          let handled = false;
          if (isTextInput) {
            const valBefore = activeEl.value;
            try {
              handled = document.execCommand('undo');
            } catch (_) {}
            if (handled && activeEl.value === valBefore) {
              handled = false;
            }
          }
          if (!handled) {
            handled = performUndo();
          }
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else {
          let handled = false;
          if (isTextInput) {
            const valBefore = activeEl.value;
            try {
              handled = document.execCommand('redo');
            } catch (_) {}
            if (handled && activeEl.value === valBefore) {
              handled = false;
            }
          }
          if (!handled) {
            handled = performRedo();
          }
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    }, true);

    // Support Tab indentation in code textareas
    ['req-body-json', 'req-body-text', 'req-body-xml', 'req-body-raw', 'req-pre-script', 'req-post-script', 'req-notes'].forEach(id => {
      const ta = document.getElementById(id);
      if (ta) {
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            recordUndoSnapshot(true);
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
            ta.selectionStart = ta.selectionEnd = start + 2;
            recordUndoSnapshot(false);
          }
        });
      }
    });
  </script>
</body>
</html>`;
}

