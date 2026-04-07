# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Loading the extension

There are no build steps — all files are plain JS/HTML/CSS. Load the extension in Firefox via `about:debugging` → "This Firefox" → "Load Temporary Add-on" and select `manifest.json`. After editing files, click "Reload" on the same page.

There are no tests, linter, or package manager configured.

## Architecture

The extension is a Firefox Manifest V3 add-on with three distinct contexts that communicate via `browser.runtime.sendMessage`:

**`background.js`** — the single source of truth. Holds all workspace state in a `Map` in memory, persisted to `browser.storage.local`. Handles all mutations. Key data structures:
- `workspaces: Map<id, workspace>` — the full workspace objects (including `tabs[]` and `groups[]`)
- `windowToWorkspace: Map<windowId, workspaceId>` — tracks which open window belongs to which workspace

**`sidebar.html/js`** — the main UI, shown in the Firefox sidebar and extension popup. Read-only view of workspace state; sends messages to background for all actions.

**`name-workspace.html/js`** — a popup page opened inside a new workspace window when it's first created (via right-click menu or "New Workspace" button). Lets the user name the workspace and closes itself when done, leaving the workspace tabs behind.

**`confirm-delete-workspace.html/js`** — a popup opened when all tabs in a workspace window are closed. Asks whether to delete the saved workspace or keep it.

## Key background.js flows

**Creating from right-click**: `moveTabsToNewWorkspace` — snapshots selected tabs, creates a workspace record, opens a new window with `name-workspace.html` as the first tab, then moves the selected tabs into that window.

**New Workspace button**: `createEmptyWorkspaceWindow` — creates a workspace with no tabs, opens a new window with `name-workspace.html` plus a background new-tab, registers the window→workspace mapping immediately.

**Opening a saved workspace**: `openWorkspace` → `materializeWorkspaceInWindow` — creates a new window (or reuses the first tab as a seed), creates all saved tabs, reconstructs tab groups, then registers the mapping. Does **not** re-snapshot the window after opening (tabs are still loading); the debounced listeners handle the eventual sync.

**Ongoing sync**: Tab/group event listeners call `queueWorkspaceSync(windowId)`, which debounces 1200ms before calling `updateWorkspaceFromWindow`. A periodic alarm also syncs every minute.

## Important conventions

- `normalizeUrl` filters out `about:` and `moz-extension:` URLs — these are never saved.
- `workspaceToPublic` strips internal fields before sending to the sidebar (tabs are summarised to `{title, url}` only; `tabCount` is derived).
- `browser.sessions.setWindowValue` / `getWindowValue` is used to persist the workspace↔window association across browser restarts.
- The `getBrowserApi()` shim exists for Chrome compatibility but the extension targets Firefox only (`browser_specific_settings.gecko` in manifest).
