const WORKSPACES_KEY = "workspaces";
const SYNC_ALARM_NAME = "workspace-sync";
const SYNC_PERIOD_MINUTES = 1;
const LISTENER_DEBOUNCE_MS = 1200;
const MOVE_TO_WORKSPACE_MENU_ID = "move-to-new-workspace";

const workspaces = new Map();
const windowToWorkspace = new Map();
const syncTimers = new Map();
const pendingDeletePrompts = new Set();

function getBrowserApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }
  return chrome;
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }
  if (url.startsWith("about:") || url.startsWith("moz-extension:")) {
    return null;
  }
  return url;
}

function makeWorkspaceId() {
  return `ws_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function serializeWorkspaces() {
  return Array.from(workspaces.values());
}

async function saveWorkspaces() {
  const api = getBrowserApi();
  await api.storage.local.set({ [WORKSPACES_KEY]: serializeWorkspaces() });
}

async function loadWorkspaces() {
  const api = getBrowserApi();
  const result = await api.storage.local.get(WORKSPACES_KEY);
  const value = result[WORKSPACES_KEY];
  workspaces.clear();
  if (!Array.isArray(value)) {
    return;
  }
  for (const workspace of value) {
    if (!workspace || typeof workspace !== "object" || typeof workspace.id !== "string") {
      continue;
    }
    const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
    workspaces.set(workspace.id, {
      id: workspace.id,
      name: typeof workspace.name === "string" && workspace.name.trim().length > 0 ? workspace.name : "Workspace",
      windowId: Number.isInteger(workspace.windowId) ? workspace.windowId : null,
      tabs,
      groups: Array.isArray(workspace.groups) ? workspace.groups : [],
      updatedAt: Number(workspace.updatedAt) || Date.now()
    });
  }
}

async function snapshotWindowState(windowId) {
  const api = getBrowserApi();
  const tabs = await api.tabs.query({ windowId });
  const normalizedTabs = tabs
    .sort((a, b) => a.index - b.index)
    .map((tab) => ({
      url: normalizeUrl(tab.url),
      title: tab.title || "",
      pinned: Boolean(tab.pinned),
      index: tab.index,
      groupId: Number.isInteger(tab.groupId) && tab.groupId !== -1 ? tab.groupId : null
    }))
    .filter((tab) => Boolean(tab.url));

  const groupIds = new Set(
    normalizedTabs
      .map((tab) => tab.groupId)
      .filter((groupId) => Number.isInteger(groupId))
  );

  const groups = [];
  if (api.tabGroups && api.tabGroups.get) {
    for (const groupId of groupIds) {
      try {
        const group = await api.tabGroups.get(groupId);
        groups.push({
          oldGroupId: groupId,
          title: typeof group.title === "string" ? group.title : "",
          color: group.color || "grey",
          collapsed: Boolean(group.collapsed)
        });
      } catch (_error) {
        // Ignore missing group details.
      }
    }
  }

  return {
    tabs: normalizedTabs,
    groups
  };
}

async function refreshWindowMappings() {
  const api = getBrowserApi();
  const windows = await api.windows.getAll();
  const openWindowIds = new Set(windows.map((windowInfo) => windowInfo.id));

  windowToWorkspace.clear();
  for (const windowInfo of windows) {
    try {
      const workspaceId = await api.sessions.getWindowValue(windowInfo.id, "workspaceId");
      if (typeof workspaceId === "string" && workspaces.has(workspaceId)) {
        windowToWorkspace.set(windowInfo.id, workspaceId);
        const workspace = workspaces.get(workspaceId);
        workspace.windowId = windowInfo.id;
      }
    } catch (_error) {
      // Ignore missing metadata.
    }
  }

  for (const workspace of workspaces.values()) {
    if (workspace.windowId != null && !openWindowIds.has(workspace.windowId)) {
      workspace.windowId = null;
    }
  }
  await saveWorkspaces();
}

function workspaceToPublic(workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    windowId: workspace.windowId,
    tabCount: Array.isArray(workspace.tabs) ? workspace.tabs.length : 0,
    updatedAt: workspace.updatedAt,
    tabs: Array.isArray(workspace.tabs)
      ? workspace.tabs.map((tab) => ({
          title: tab.title || "",
          url: normalizeUrl(tab.url)
        }))
      : []
  };
}

async function updateWorkspaceFromWindow(windowId) {
  const workspaceId = windowToWorkspace.get(windowId);
  if (!workspaceId) {
    return;
  }
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    return;
  }
  const nextState = await snapshotWindowState(windowId);
  workspace.tabs = nextState.tabs;
  workspace.groups = nextState.groups;
  workspace.updatedAt = Date.now();
  await saveWorkspaces();
}

async function maybePromptDeleteEmptyWorkspace(windowId) {
  const api = getBrowserApi();
  const workspaceId = windowToWorkspace.get(windowId);
  if (!workspaceId || pendingDeletePrompts.has(workspaceId)) {
    return;
  }
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    return;
  }

  let tabs = [];
  try {
    tabs = await api.tabs.query({ windowId });
  } catch (_error) {
    return;
  }
  if (tabs.length > 0) {
    return;
  }

  pendingDeletePrompts.add(workspaceId);
  await api.windows.create({
    url: `confirm-delete-workspace.html?workspaceId=${encodeURIComponent(workspaceId)}`,
    type: "popup",
    width: 420,
    height: 220
  });
}

function queueWorkspaceSync(windowId) {
  if (!windowToWorkspace.has(windowId)) {
    return;
  }
  const existing = syncTimers.get(windowId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(async () => {
    syncTimers.delete(windowId);
    await updateWorkspaceFromWindow(windowId);
  }, LISTENER_DEBOUNCE_MS);
  syncTimers.set(windowId, timer);
}

async function createWorkspace(name) {
  const api = getBrowserApi();
  const currentWindow = await api.windows.getCurrent();
  const state = await snapshotWindowState(currentWindow.id);
  const workspace = {
    id: makeWorkspaceId(),
    name: typeof name === "string" && name.trim().length > 0 ? name.trim() : "Workspace",
    windowId: null,
    tabs: state.tabs,
    groups: state.groups,
    updatedAt: Date.now()
  };
  workspaces.set(workspace.id, workspace);
  await saveWorkspaces();
  return workspaceToPublic(workspace);
}

async function moveTabsToNewWorkspace(windowId, tabIds) {
  const api = getBrowserApi();
  const orderedIds = Array.isArray(tabIds) ? tabIds.slice() : [];
  if (orderedIds.length === 0) {
    throw new Error("No tabs selected.");
  }

  const tabs = [];
  for (const tabId of orderedIds) {
    try {
      const tab = await api.tabs.get(tabId);
      if (tab && tab.windowId === windowId) {
        tabs.push(tab);
      }
    } catch (_error) {
      // Skip vanished tabs.
    }
  }

  const snapshot = tabs
    .sort((a, b) => a.index - b.index)
    .map((tab) => ({
      url: normalizeUrl(tab.url),
      title: tab.title || "",
      pinned: Boolean(tab.pinned),
      index: tab.index,
      groupId: Number.isInteger(tab.groupId) && tab.groupId !== -1 ? tab.groupId : null
    }))
    .filter((tab) => Boolean(tab.url));
  if (snapshot.length === 0) {
    throw new Error("No movable tabs found.");
  }

  const groupIds = new Set(
    snapshot
      .map((tab) => tab.groupId)
      .filter((groupId) => Number.isInteger(groupId))
  );
  const groups = [];
  if (api.tabGroups && api.tabGroups.get) {
    for (const groupId of groupIds) {
      try {
        const group = await api.tabGroups.get(groupId);
        groups.push({
          oldGroupId: groupId,
          title: typeof group.title === "string" ? group.title : "",
          color: group.color || "grey",
          collapsed: Boolean(group.collapsed)
        });
      } catch (_error) {
        // Ignore missing group details.
      }
    }
  }

  const workspace = {
    id: makeWorkspaceId(),
    name: "Workspace",
    windowId: null,
    tabs: snapshot,
    groups,
    updatedAt: Date.now()
  };
  workspaces.set(workspace.id, workspace);
  await saveWorkspaces();

  const newWindow = await api.windows.create({
    url: `name-workspace.html?workspaceId=${encodeURIComponent(workspace.id)}`
  });

  const idsToMove = tabs.map((tab) => tab.id);
  if (idsToMove.length > 0) {
    await api.tabs.move(idsToMove, { windowId: newWindow.id, index: -1 });
  }

  await api.sessions.setWindowValue(newWindow.id, "workspaceId", workspace.id);
  windowToWorkspace.set(newWindow.id, workspace.id);
  workspace.windowId = newWindow.id;
  workspace.updatedAt = Date.now();
  await updateWorkspaceFromWindow(newWindow.id);
  return workspaceToPublic(workspace);
}

async function materializeWorkspaceInWindow(workspace, windowId, promptTabId) {
  const api = getBrowserApi();
  const normalizedTabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
  const firstTab = normalizedTabs.find((tab) => Boolean(normalizeUrl(tab.url)));
  const createdTabMap = new Map();

  if (firstTab) {
    const initialUrl = normalizeUrl(firstTab.url);
    if (promptTabId != null) {
      try {
        await api.tabs.update(promptTabId, { url: initialUrl, active: true });
        const promptTab = await api.tabs.get(promptTabId);
        createdTabMap.set(firstTab.index, {
          id: promptTab.id,
          groupId: firstTab.groupId
        });
      } catch (_error) {
        const tab = await api.tabs.create({ windowId, url: initialUrl, active: true });
        createdTabMap.set(firstTab.index, {
          id: tab.id,
          groupId: firstTab.groupId
        });
      }
    } else {
      const tab = await api.tabs.create({ windowId, url: initialUrl, active: true });
      createdTabMap.set(firstTab.index, {
        id: tab.id,
        groupId: firstTab.groupId
      });
    }
  }

  for (const tabInfo of normalizedTabs) {
    const url = normalizeUrl(tabInfo.url);
    if (!url) {
      continue;
    }
    if (tabInfo.index === (firstTab && firstTab.index)) {
      continue;
    }
    await api.tabs.create({
      windowId,
      url,
      active: false
    }).then((tab) => {
      createdTabMap.set(tabInfo.index, {
        id: tab.id,
        groupId: Number.isInteger(tabInfo.groupId) ? tabInfo.groupId : null
      });
    });
  }

  if (api.tabs.group) {
    const sourceGroupToTabs = new Map();
    for (const entry of createdTabMap.values()) {
      if (!Number.isInteger(entry.groupId)) {
        continue;
      }
      if (!sourceGroupToTabs.has(entry.groupId)) {
        sourceGroupToTabs.set(entry.groupId, []);
      }
      sourceGroupToTabs.get(entry.groupId).push(entry.id);
    }

    const sourceGroupToNewGroup = new Map();
    for (const [sourceGroupId, tabIds] of sourceGroupToTabs.entries()) {
      if (tabIds.length === 0) {
        continue;
      }
      const newGroupId = await api.tabs.group({ tabIds });
      sourceGroupToNewGroup.set(sourceGroupId, newGroupId);
    }

    if (api.tabGroups && api.tabGroups.update && Array.isArray(workspace.groups)) {
      for (const groupMeta of workspace.groups) {
        if (!Number.isInteger(groupMeta.oldGroupId)) {
          continue;
        }
        const newGroupId = sourceGroupToNewGroup.get(groupMeta.oldGroupId);
        if (!Number.isInteger(newGroupId)) {
          continue;
        }
        try {
          await api.tabGroups.update(newGroupId, {
            title: groupMeta.title || "",
            color: groupMeta.color || "grey",
            collapsed: Boolean(groupMeta.collapsed)
          });
        } catch (_error) {
          // Keep restore resilient if a single group update fails.
        }
      }
    }
  }

  await api.sessions.setWindowValue(windowId, "workspaceId", workspace.id);
  windowToWorkspace.set(windowId, workspace.id);
  workspace.windowId = windowId;
  workspace.updatedAt = Date.now();
  await saveWorkspaces();
  return workspaceToPublic(workspace);
}

async function createWorkspaceFromTabs(windowId, tabIds, name, options = {}) {
  const api = getBrowserApi();
  const orderedIds = Array.isArray(tabIds) ? tabIds.slice() : [];
  if (orderedIds.length === 0) {
    throw new Error("No tabs selected.");
  }

  const tabs = [];
  for (const tabId of orderedIds) {
    try {
      const tab = await api.tabs.get(tabId);
      if (tab && tab.windowId === windowId) {
        tabs.push(tab);
      }
    } catch (_error) {
      // Skip tabs that disappeared during operation.
    }
  }

  const snapshot = tabs
    .sort((a, b) => a.index - b.index)
    .map((tab) => ({
      url: normalizeUrl(tab.url),
      title: tab.title || "",
      pinned: Boolean(tab.pinned),
      index: tab.index,
      groupId: Number.isInteger(tab.groupId) && tab.groupId !== -1 ? tab.groupId : null
    }))
    .filter((tab) => Boolean(tab.url));

  if (snapshot.length === 0) {
    throw new Error("No movable tabs found.");
  }

  const workspace = {
    id: makeWorkspaceId(),
    name: typeof name === "string" && name.trim().length > 0 ? name.trim() : "Workspace",
    windowId: null,
    tabs: snapshot,
    groups,
    updatedAt: Date.now()
  };
  workspaces.set(workspace.id, workspace);
  await saveWorkspaces();
  const targetWindowId = Number.isInteger(options.targetWindowId) ? options.targetWindowId : null;
  const promptTabId = Number.isInteger(options.promptTabId) ? options.promptTabId : null;
  if (targetWindowId != null) {
    await materializeWorkspaceInWindow(workspace, targetWindowId, promptTabId);
  } else {
    await openWorkspace(workspace.id);
  }

  const idsToRemove = tabs.map((tab) => tab.id);
  if (idsToRemove.length > 0) {
    try {
      await api.tabs.remove(idsToRemove);
    } catch (_error) {
      // Moving tabs should still be considered successful even if some closes fail.
    }
  }

  return workspaceToPublic(workspace);
}

async function createEmptyWorkspaceWindow() {
  const api = getBrowserApi();
  const workspace = {
    id: makeWorkspaceId(),
    name: "Workspace",
    windowId: null,
    tabs: [],
    groups: [],
    updatedAt: Date.now()
  };
  workspaces.set(workspace.id, workspace);
  await saveWorkspaces();

  const newWindow = await api.windows.create({
    url: `name-workspace.html?workspaceId=${encodeURIComponent(workspace.id)}`
  });

  // Add a new tab so the window has content once the name prompt is closed.
  await api.tabs.create({ windowId: newWindow.id, active: false });

  await api.sessions.setWindowValue(newWindow.id, "workspaceId", workspace.id);
  windowToWorkspace.set(newWindow.id, workspace.id);
  workspace.windowId = newWindow.id;
  workspace.updatedAt = Date.now();
  await saveWorkspaces();

  return workspaceToPublic(workspace);
}

async function openWorkspace(workspaceId) {
  const api = getBrowserApi();
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found.");
  }
  const normalizedTabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
  const firstTab = normalizedTabs.find((tab) => Boolean(normalizeUrl(tab.url)));
  const createdWindow = firstTab
    ? await api.windows.create({ url: normalizeUrl(firstTab.url) })
    : await api.windows.create({});
  const createdTabs = await api.tabs.query({ windowId: createdWindow.id, active: true });
  const promptTab = Array.isArray(createdTabs) && createdTabs.length > 0 ? createdTabs[0] : null;
  return materializeWorkspaceInWindow(workspace, createdWindow.id, promptTab ? promptTab.id : null);
}

async function renameWorkspace(workspaceId, name) {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found.");
  }
  const normalized = typeof name === "string" && name.trim().length > 0 ? name.trim() : "Workspace";
  workspace.name = normalized;
  workspace.updatedAt = Date.now();
  await saveWorkspaces();
  return workspaceToPublic(workspace);
}

async function deleteWorkspace(workspaceId) {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    return false;
  }
  if (workspace.windowId != null) {
    windowToWorkspace.delete(workspace.windowId);
  }
  workspaces.delete(workspaceId);
  await saveWorkspaces();
  return true;
}

async function getWorkspaces() {
  const list = Array.from(workspaces.values()).map((workspace) => workspaceToPublic(workspace));
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return list;
}

async function syncAllWorkspaceWindows() {
  for (const [windowId] of windowToWorkspace.entries()) {
    await updateWorkspaceFromWindow(windowId);
  }
}

function registerListeners() {
  const api = getBrowserApi();

  api.tabs.onCreated.addListener((tab) => {
    if (tab && tab.windowId != null) {
      queueWorkspaceSync(tab.windowId);
    }
  });
  api.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
    if (tab && tab.windowId != null) {
      queueWorkspaceSync(tab.windowId);
    }
  });
  api.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    if (removeInfo && removeInfo.windowId != null) {
      queueWorkspaceSync(removeInfo.windowId);
      if (!removeInfo.isWindowClosing) {
        void maybePromptDeleteEmptyWorkspace(removeInfo.windowId);
      }
    }
  });
  api.tabs.onMoved.addListener((_tabId, moveInfo) => {
    if (moveInfo && moveInfo.windowId != null) {
      queueWorkspaceSync(moveInfo.windowId);
    }
  });
  api.tabs.onAttached.addListener((_tabId, attachInfo) => {
    if (attachInfo && attachInfo.newWindowId != null) {
      queueWorkspaceSync(attachInfo.newWindowId);
    }
  });
  api.tabs.onDetached.addListener((_tabId, detachInfo) => {
    if (detachInfo && detachInfo.oldWindowId != null) {
      queueWorkspaceSync(detachInfo.oldWindowId);
    }
  });

  if (api.tabGroups && api.tabGroups.onCreated) {
    api.tabGroups.onCreated.addListener((group) => {
      if (group && group.windowId != null) {
        queueWorkspaceSync(group.windowId);
      }
    });
  }
  if (api.tabGroups && api.tabGroups.onUpdated) {
    api.tabGroups.onUpdated.addListener((group) => {
      if (group && group.windowId != null) {
        queueWorkspaceSync(group.windowId);
      }
    });
  }
  if (api.tabGroups && api.tabGroups.onMoved) {
    api.tabGroups.onMoved.addListener((group) => {
      if (group && group.windowId != null) {
        queueWorkspaceSync(group.windowId);
      }
    });
  }
  if (api.tabGroups && api.tabGroups.onRemoved) {
    api.tabGroups.onRemoved.addListener((group) => {
      if (group && group.windowId != null) {
        queueWorkspaceSync(group.windowId);
      }
    });
  }

  api.windows.onRemoved.addListener((windowId) => {
    const workspaceId = windowToWorkspace.get(windowId);
    if (!workspaceId) {
      return;
    }
    windowToWorkspace.delete(windowId);
    const workspace = workspaces.get(workspaceId);
    if (workspace) {
      workspace.windowId = null;
      workspace.updatedAt = Date.now();
      void saveWorkspaces();
    }
  });

  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
      void syncAllWorkspaceWindows();
    }
  });

  if (api.menus && api.menus.onClicked) {
    api.menus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId !== MOVE_TO_WORKSPACE_MENU_ID || !tab) {
        return;
      }
      const highlighted = await api.tabs.query({ windowId: tab.windowId, highlighted: true });
      const selectedIds = highlighted.length > 0 ? highlighted.map((t) => t.id) : [tab.id];
      await moveTabsToNewWorkspace(tab.windowId, selectedIds);
    });
  }
}

async function ensureSyncAlarm() {
  const api = getBrowserApi();
  const existing = await api.alarms.get(SYNC_ALARM_NAME);
  if (!existing) {
    await api.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
  }
}

async function ensureMenus() {
  const api = getBrowserApi();
  if (!api.menus || !api.menus.create) {
    return;
  }
  try {
    await api.menus.remove(MOVE_TO_WORKSPACE_MENU_ID);
  } catch (_error) {
    // Ignore if not present.
  }
  api.menus.create({
    id: MOVE_TO_WORKSPACE_MENU_ID,
    title: "Move to new workspace",
    contexts: ["tab"]
  });
}

async function init() {
  await loadWorkspaces();
  await refreshWindowMappings();
  registerListeners();
  await ensureSyncAlarm();
  await ensureMenus();
}

getBrowserApi().runtime.onMessage.addListener(async (message) => {
  await initPromise;
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "GET_WORKSPACES") {
    return getWorkspaces();
  }

  if (message.type === "CREATE_WORKSPACE") {
    return createWorkspace(message.name);
  }

  if (message.type === "NEW_WORKSPACE") {
    return createEmptyWorkspaceWindow();
  }

  if (message.type === "MOVE_TABS_TO_NEW_WORKSPACE") {
    return moveTabsToNewWorkspace(message.windowId, message.tabIds);
  }

  if (message.type === "OPEN_WORKSPACE") {
    return openWorkspace(message.workspaceId);
  }

  if (message.type === "RENAME_WORKSPACE") {
    return renameWorkspace(message.workspaceId, message.name);
  }

  if (message.type === "DELETE_WORKSPACE") {
    return deleteWorkspace(message.workspaceId);
  }

  if (message.type === "GET_WORKSPACE") {
    const workspace = workspaces.get(message.workspaceId);
    return workspace ? workspaceToPublic(workspace) : null;
  }

  if (message.type === "CONFIRM_DELETE_EMPTY_WORKSPACE") {
    pendingDeletePrompts.delete(message.workspaceId);
    if (message.deleteWorkspace) {
      return deleteWorkspace(message.workspaceId);
    }
    return true;
  }

  return undefined;
});

const initPromise = init();
