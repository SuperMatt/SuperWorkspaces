# Feature Ideas

**Workspace switching** — rather than always opening workspaces in new windows, a "switch to" action that closes (or suspends) the current window's tabs and loads the workspace in-place. More like a traditional workspace manager.

**Drag to reorder** — the sidebar list has no ordering control. Drag-and-drop or manual up/down would be useful once you accumulate several workspaces.

**Workspace icons/colours** — each workspace could have a colour dot or emoji, similar to tab groups. Useful for quick visual identification in the sidebar.

**Search/filter** — once you have many workspaces, a small filter input to narrow by name or URL would save scrolling.

**Merge workspaces** — combine two saved workspaces into one. Logical complement of the split-by-moving-tabs flow you already have.

**Import/export** — export workspaces as JSON (or bookmarks-compatible HTML) for backup or moving between Firefox profiles/machines. Low implementation cost, high practical value.

**Tab preview on hover** — the "Show pages" list currently shows raw URLs. Favicons and page titles would make it much more scannable.

**Auto-name from tab group titles** — when creating a workspace from a window that has a single dominant tab group, default the workspace name to that group's title rather than "Workspace".

**Keyboard shortcut to open sidebar** — Firefox supports `commands` in the manifest for triggering sidebar toggle, which would make the whole thing keyboard-accessible without touching the mouse.

**Workspace sessions across restarts** — already persists to `storage.local` and uses `sessions.setWindowValue`, but if Firefox crashes the window→workspace mapping can be lost. A recovery prompt on startup (detect open windows with no mapping, offer to re-associate) would close that gap.
