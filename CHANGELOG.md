# Changelog

All notable changes to **byrdsnest api client** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.9] - 2026-10-05

### Added
- **Scanned File Preview & Granular Selective Import**:
  - Automatically scans and reports file contents (collections, requests, folders, environments, variables, profiles) prior to importing.
  - Interactive multi-select QuickPick selection for workspace backups (`Choose What to Import...`), allowing selective import of collections, environments, and profiles.
  - Interactive multi-select QuickPick for collections (`Choose Folders & Requests...`), allowing selective filtering of folders and requests.
  - Interactive variable selection for environments (`Choose Variables to Import...`).
  - Added support for native `byrdsnest-backup`, `byrdsnest-collection`, and `byrdsnest-environment` formats with fallback unrecognized format warning.
- **Mid-Flight Request Cancellation**:
  - Added `Cancel` button toggle in Request Panel while requests are executing.
  - AbortController signal handling across HttpService with graceful UI cancellation state.
- **Folder Auth Inheritance from Collections**:
  - Folders can now inherit authentication configuration directly from their parent collection (`inheritFromCollection`).
  - Request panel hierarchical auth dropdown: Inherit from Parent (Collection, Folder, Environment, Profile).
- **Settings Panel Polish & Dirty Tracking**:
  - Dynamic dirty snapshot tracking with highlighted `Save Changes*` button state across settings tabs.
  - Pinned context bar and sticky table headers so controls and column labels remain visible while scrolling.
- **CI & Build Modernization**:
  - Upgraded packaging toolchain to `@vscode/vsce@4.0.0` with 0 security audit vulnerabilities.
  - Hardened GitHub Actions CI security audit step to audit production dependencies.

---

## [0.3.4] - 2026-09-27

### Fixed
- **Fitted Tabs & Elimination of Unwanted Scrollbars**:
  - Fixed `.tab-header` styling so tab buttons fit naturally across the header bar without scrollbars.
  - Eliminated unwanted vertical scrollbars (`▲` `▼` arrows) that Chromium on Windows was generating on `.tab-header` and `.body-nav`.
  - Added strict scrollbar suppression and `overflow: hidden` across primary tab headers, body type subtabs, and the URL preview bar.
  - Constrained `.tab-content` to clean vertical scrolling (`overflow-y: auto; overflow-x: hidden`).

---

## [0.3.3] - 2026-09-27

### Added
- **Collapsible Objects & Arrays in Response Body**:
  - Interactive fold/unfold chevrons on all JSON objects and arrays in the response viewer with smooth SVG transitions.
  - Informative collapsed badges summarizing item and key counts (e.g. `{ ... 4 keys ... }`, `[ ... 25 items ... ]`).
  - Added dedicated **Collapse All** and **Expand All** toolbar actions in the response header.
  - <kbd>Alt</kbd> + click on any chevron recursively collapses or expands all nested descendant objects and arrays in one gesture.
  - Full keyboard accessibility: press <kbd>Enter</kbd> or <kbd>Space</kbd> on any node header to toggle folding.
  - Preserved copy & editor fidelity: copying or opening in editor always exports the complete formatted JSON, unaffected by collapsed UI state.
  - Subtle tree indentation guide lines matching native VS Code editor styling.

### Fixed
- **Cleaned Up Collection Base URL Handling**:
  - Eliminated redundant duplicate `{{collectionBaseUrl}}` entry in the Inherited Variables inspector when a collection defines a base URL.
  - Eliminated redundant duplicate `{{envBaseUrl}}` entry in the environment section of the Inherited Variables inspector.
  - Preserved full template resolution truth: requests can still interpolate `{{collectionBaseUrl}}` and `{{envBaseUrl}}` whenever needed.

---

## [0.3.2] - 2026-09-27

### Added
- **Tab Dirty State Tracking & Live Unsaved Indicators**:
  - Request panels now track edits across all inputs (URL, method, headers, variables, body, auth, notes, scripts).
  - VS Code editor tab title dynamically displays `● Request Name` when modified and unsaved, cleanly reverting once saved.
  - In-panel Save button shows dirty state with accent styling and `Save *` status.
  - Added native <kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>Cmd</kbd> + <kbd>S</kbd> keyboard shortcut to immediately save requests from within the panel.

### Fixed
- **Profile Settings Save Bug**:
  - Fixed a `ReferenceError: currentActiveTab is not defined` in `globalSettingsPanelHtml.ts` that silently blocked the *Save Changes* button from saving profile modifications.
  - Added instant visual feedback to *Save Changes* button ("Saving...", "✔ Saved!").
  - Preserved `selectedProfileId` on save so the settings view stays on the selected profile without jumping.
- **Activity Bar Icon Cache Invalidation**:
  - Re-registered Activity Bar icon as `media/byrdsnest-icon.svg` to cleanly bust stale Chromium image caches.

---

## [0.3.1] - 2026-09-27

### Added
- **Configurable Safety Guards & Touch Points for Profiles**:
  - `ProfileGuardConfig` with method-level protection (e.g. `DELETE`, `PUT`, `PATCH`), keyword confirmation prompts (e.g. typing "PROD"), pre-send confirmation modals, and customizable warning messages.
  - Live `#profile-guard-badge` status indicator in the Request Panel header reflecting active profile protections.
  - Dedicated and Global Settings UI for configuring profile safety guards.
- **Full-Height Live Body Editor**:
  - Syntax-highlighted request body editor (tokenized colors, line numbers gutter, tab indentation, and format beautify).
  - Expanded editor to span full remaining height down to the bottom of the page.
  - Live bidirectional synchronization with VS Code Monaco editor via `↗ Open in Editor`.

### Fixed
- **Variable Resolution Truth & URL Preview Parity**:
  - Fixed inheritance override determination in `VariableService` so disabled upper-tier entries (e.g. `baseUrlDisabled`) or preferred collection base URLs do not suppress active winning entries.
  - Synchronized backend-resolved variables directly into the webview to ensure the live URL preview bar and preview tab are always in complete agreement.
- **Activity Bar Icon Rendering**:
  - Converted Activity Bar SVG icon to an optimal 24x24 vector glyph with transparent background conforming to VS Code's `-webkit-mask` rendering specifications.
- **Active Environment Persistence & Scoped Selection**:
  - Profile-scoped environment dropdown with automatic persistence on selection changes.

---

## [0.3.0] - 2026-09-25

### Added
- **Token Vault Selector & Full Provenance Tracking**:
  - Direct selection of stored tokens from the profile vault within the Authentication tab for Bearer and OAuth 2.0.
  - Interactive **Token Provenance Card** displaying origin environment/source, endpoint URL, OAuth client ID, acquisition timestamp, remaining expiry countdown, and granted scopes.
  - One-click **"Save Current Token to Vault"** action saving newly entered or minted tokens directly into the vault for cross-request reuse.
  - Automatic `selectedTokenId` resolution in `AuthService` when dispatching requests.
- **Bird's Nest Brand Icon**:
  - High-resolution SVG and PNG icon featuring an interwoven bird's nest bowl with glowing digital API data eggs and network node insignia.

### Changed
- **Cohesive Full-Width Layout**:
  - Harmonized Settings and Environment panels to match the Request Panel layout: edge-to-edge full width, unified 14px padding, matching context bar pills, action buttons, tab headers, input borders, and checkbox accents.
- **Parent-Child Environment Hierarchy Visuals**:
  - Visual tree indentation and nesting of child environments under parent environments in the sidebar.
  - Dropdown hierarchy indicators annotating inheritance paths and child counts.
- **Breadcrumb Request Renaming**:
  - In-place request rename field in the top breadcrumb bar with instant synchronization.
- **Dynamic Variables Default Collapse**:
  - Built-in dynamic variables collapsed by default with on-demand toggle control.

---

## [0.2.0] - 2026-09-25

### Changed
- **Rebrand to "byrdsnest api client"**:
  - Full project rename to **byrdsnest api client** across package name (`byrdsnest-api-client`), display name, Activity Bar container (`byrdsnestApiClient`), command IDs (`byrdsnestApiClient.*`), view IDs (`byrdsnestProfiles`, `byrdsnestCollections`, `byrdsnestEnvironments`, `byrdsnestTools`), and documentation.
  - Automatic zero-friction state migration: seamlessly imports and preserves existing `blue-byrd-state` workspace state and `bluebyrd.tokens` OAuth token vaults into `byrdsnest-api-state` and `byrdsnest.tokens`.
  - Comprehensive backward compatibility aliases: legacy `blueByrdApiClient.*` commands, context values, and backup formats continue to function without interruption.
- **Dedicated Tools Sidebar Accordion**:
  - Renamed the bottom accordion from "History" to **Tools** (`byrdsnestTools`), bundling quick-access developer actions: History Inspector, OAuth Token Vault, Import from cURL, Import API Data, Export Full Backup, and Check for Updates.

### Added
- **Pre-Request & Post-Response Scripting Engine**:
  - Sandboxed JavaScript execution engine powered by Node's `node:vm` with timeout protection.
  - Dual global API support: native **`bb`** and Postman **`pm`** syntax parity.
  - Pre-request mutation of headers, body, URL, and dynamic environment variables (e.g. HMAC signatures, timestamps).
  - Post-response testing and assertion suite (`bb.test`, `bb.expect`, `pm.test`, `pm.expect`).
  - Automatic environment variable extraction and persistence (`bb.environment.set`).
  - Response Inspector **Tests** tab with pass/fail badges (`✔` / `✖`) and detailed assertion error messages.
  - Response Inspector **Console** tab capturing timestamped logs (`log`, `info`, `warn`, `error`).
  - Quick snippet insert chips in Request Builder (`+ Set Env Var`, `+ Get Env Var`, `+ Status is 200`, `+ Parse JSON`, `+ Set Header`, `+ SHA-256`).
- **Breakout Native View Panes Architecture**:
  - Dedicated native sidebar tree views for **Profiles**, **Collections**, **Environments**, and **History**.
  - Synchronized tree coordinator ensuring seamless live state updates across all breakout panes.
- **Drag & Drop Reordering**:
  - Full native drag-and-drop reordering for Collections, Folders, and Requests.
  - Smooth reordering and moving requests between folders and collections directly in the sidebar tree.
- **Profile OAuth Token Vault**:
  - Dedicated token management with automatic auth header resolution.
  - Auto-injected authorization tokens for requests inheriting from profile auth.
- **Environment & Request Cloning**:
  - 1-click clone actions for environments and requests with hierarchy and parameter preservation.
- **Live URL Token Interpolation Preview**:
  - Interactive preview bar showing real-time token resolution directly beneath the URL input.
  - Clear visual warning and highlighting for unresolved tokens (`{{unresolved}}`).
- **Grouped Collapsible Inherited Variables & Headers**:
  - Accordion sections grouped by source (`Profile`, `Environment`, `Collection`, `Folder`, `Dynamic`).
  - Built-in dynamic variables collapsed by default; all other groups expanded with persistent toggle states.
- **Live Active Environment & Profile Synchronization**:
  - Open Request Panels live-update their environment and profile dropdowns and re-resolve variables immediately when changed in the sidebar.
- **Rich Network Error Diagnostics**:
  - Intelligent classification of OS-level network errors (`ECONNREFUSED`, `ETIMEDOUT`, `ENETUNREACH`, `ENOTFOUND`, `AbortError`).
  - Red-tinted diagnostic card in Response Inspector with actionable troubleshooting guidance.
- **Sidebar UX Improvements**:
  - Collections collapsed by default in the breakout view.
  - History sidebar pane condensed into a clean action link to open the full History Inspector.
  - Folders now expand and collapse on left-click; folder editing accessible via right-click context menu and hover icon.

### Changed
- Improved variable resolution precedence order to ensure Environment variables take priority over Collection variables.
- Hardened Webview script security and Prototype Pollution protections.

---

## [0.1.0] - 2026-09-24

### Initial Release (Public Beta)

Welcome to the initial public beta release of **bluebyrd**, the lightweight, native, and local-first API client for Visual Studio Code!

#### Added
- **Hierarchical Variable & Header Inheritance Engine**:
  - Multi-tier inheritance chain: `Profile` → `Parent Environment` → `Active Environment` → `Collection` → `Folder` → `Request`.
  - Nested environments with `inheritsFrom` parent environment configuration and cycle-safe dependency resolution.
  - Automatic collection-level and folder-level header cascading into child requests.
  - Case-insensitive header deduplication with request-level override priority.
- **Live Visual Inheritance Inspector**:
  - Interactive tabs in the Request Panel for both **Variables** and **Headers**.
  - Distinct source origin badges (`[Profile]`, `[Parent Env]`, `[Env]`, `[Collection]`, `[Folder]`, `[Dynamic]`).
  - Visual strikethrough indicator for overridden values.
  - One-click `+ Override` action that instantly copies inherited variables and headers into the local request editor.
- **Built-in Dynamic Variable Generators**:
  - `{{$uuid}}`: Generates RFC 4122 v4 unique identifiers.
  - `{{$timestamp}}`: Current Unix epoch timestamp in milliseconds.
  - `{{$isoDate}}`: Current UTC timestamp in ISO-8601 format.
  - `{{$randomInt:N}}`: Generates cryptographically pseudorandom N-digit integers.
  - `{{$date:format}}`: Formats current date and time tokens (`yyyy`, `MM`, `dd`, `HH`, `mm`, `ss`).
- **Smart JSON Type Coercion**:
  - Automatically coerces quoted string tokens (such as `"{{FLAG}}"`) to native JSON booleans (`true`/`false`) or `null` primitives upon substitution, preventing malformed payload errors.
- **Unified Authentication Framework**:
  - OAuth 2.0 engine supporting Authorization Code, Client Credentials, Password Credentials, and Implicit flows.
  - Automatic token acquisition and caching with custom headers and scope support.
  - Bearer Token, API Key (Header or Query parameter), and HTTP Basic Authentication.
  - Consistent authentication configuration across Profiles, Environments, Collections, and individual Requests.
- **Rich Request Body Modes**:
  - JSON editor with syntax formatting and validation.
  - Multipart form-data with native VS Code file browsing dialogs for binary uploads.
  - `x-www-form-urlencoded` key-value pairs with bulk editing support.
  - Raw text, XML, and binary modes.
- **Universal JSON Import & Export**:
  - **Postman Collections (v2 / v2.1)**: Imports folders, requests, url query parameters, headers, authentication settings, and payloads.
  - **Postman Environments**: Auto-detects and imports variable key-value pairs and base URLs.
  - **OpenAPI 3.0 / Swagger 2.0**: Auto-generates collections from OpenAPI specifications with endpoint tag folders, path parameter conversion, and sample schema JSON payloads.
  - **Multi-Resource & Full Workspace Backups**: Export and import complete workspaces or individual collections/environments with automatic normalization.
  - Contextual sidebar tree buttons and Command Palette shortcuts for all import and export actions.
- **Automated GitHub Releases Update Notifier**:
  - Background daily checks against the official GitHub Releases API (`byrdchermit/byrdsnest-api-client`).
  - Interactive update notification prompt with direct download and changelog view.
  - On-demand update check command (`bluebyrd: Check for Updates`) in the VS Code Command Palette.
- **VS Code Native UI & History**:
  - Dedicated Activity Bar icon and customizable Sidebar explorer.
  - Full request history recording status codes, response sizes, latency (ms), and payload details.
  - Single-click request restoration and re-execution from the history view.
- **Automated Verification Suite**:
  - 31 automated test suites covering inheritance resolution, import/export normalizers, type coercion, dynamic variables, and update verification.
