# SuperWorkspaces

A Firefox extension for saving and restoring tab workspaces from the sidebar.

## Features

- Save the current window's tabs (and tab groups) as a named workspace
- Restore a workspace into a new window, preserving tab groups and colours
- Right-click one or more tabs to move them into a new workspace
- Workspaces sync automatically as you add, remove, or rearrange tabs
- Works from the Firefox sidebar or the extension toolbar popup

## Installation

1. Open `about:debugging` in Firefox → **This Firefox** → **Load Temporary Add-on**
2. Select `manifest.json` from this repository

To reload after making changes, click **Reload** on the same page.

## Usage

| Action | How |
|---|---|
| Create workspace from current tabs | Click **New Workspace** in the sidebar |
| Move selected tabs to a new workspace | Right-click a tab → **Move to new workspace** |
| Open a saved workspace | Click **Open in new window** in the sidebar |
| Rename / delete a workspace | Buttons on each workspace card in the sidebar |

When a workspace window is opened, the workspace name prompt appears as the first tab and closes itself after you save a name.

If you close all tabs in a workspace window, you'll be asked whether to delete the saved workspace or keep it.
