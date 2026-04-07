const DEFAULT_TARGET_MODE = "new-window";
const TARGET_MODE_KEY = "restoreTargetMode";
const MAX_RECENTLY_CLOSED = 100;

const groupCache = new Map();

function getBrowserApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }
  return chrome;
}

function safeDateMs(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }
  return numberValue;
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

function makeGroupLabel(groupId, tabs) {
  const tabWithTitle = tabs.find((tab) => typeof tab.title === "string" && tab.title.trim().length > 0);
  if (tabWithTitle) {
    return tabWithTitle.title.trim();
  }
  return `Group ${String(groupId)}`;
}

function extractGroupId(tabRecord) {
  if (!tabRecord || typeof tabRecord !== "object") {
    return null;
  }

  if (tabRecord.groupId != null && tabRecord.groupId !== -1) {
    return String(tabRecord.groupId);
  }

  const extData = tabRecord.extData || tabRecord.sessionData || {};
  const maybeGroupId =
    extData.groupId ??
    extData.tabGroupId ??
    extData["tabview-group"] ??
    extData["firefox-tab-group-id"];

  if (maybeGroupId == null) {
    return null;
  }

  return String(maybeGroupId);
}

function buildUrlList(tabs) {
  return tabs
    .map((tab) => normalizeUrl(tab.url))
    .filter((url) => Boolean(url));
}

function mapClosedGroups(recentEntries) {
  const groups = [];
  const tabBucketsByGroupId = new Map();

  for (const entry of recentEntries) {
    if (entry.window) {
      const closedWindow = entry.window;
      const closedTabs = Array.isArray(closedWindow.tabs) ? closedWindow.tabs : [];
      const groupedTabs = new Map();

      for (const tab of closedTabs) {
        const groupId = extractGroupId(tab);
        if (!groupId) {
          continue;
        }
        if (!groupedTabs.has(groupId)) {
          groupedTabs.set(groupId, []);
        }
        groupedTabs.get(groupId).push(tab);
      }

      for (const [groupId, tabs] of groupedTabs.entries()) {
        const urls = buildUrlList(tabs);
        if (urls.length === 0) {
          continue;
        }

        groups.push({
          id: `window:${closedWindow.sessionId || "unknown"}:${groupId}`,
          title: makeGroupLabel(groupId, tabs),
          tabCount: urls.length,
          closedAt: safeDateMs(entry.lastModified),
          payload: {
            type: "window-group",
            sessionId: closedWindow.sessionId || null,
            urls
          }
        });
      }
    }

    if (entry.tab) {
      const tab = entry.tab;
      const groupId = extractGroupId(tab);
      if (!groupId) {
        continue;
      }

      if (!tabBucketsByGroupId.has(groupId)) {
        tabBucketsByGroupId.set(groupId, []);
      }
      tabBucketsByGroupId.get(groupId).push({
        tab,
        closedAt: safeDateMs(entry.lastModified)
      });
    }
  }

  for (const [groupId, rows] of tabBucketsByGroupId.entries()) {
    const tabs = rows.map((row) => row.tab);
    const urls = buildUrlList(tabs);
    if (urls.length === 0) {
      continue;
    }
    const newestClosedAt = rows.reduce((acc, row) => {
      if (!row.closedAt) {
        return acc;
      }
      return Math.max(acc, row.closedAt);
    }, 0);

    groups.push({
      id: `tab:${groupId}`,
      title: makeGroupLabel(groupId, tabs),
      tabCount: urls.length,
      closedAt: newestClosedAt || null,
      payload: {
        type: "tab-group",
        urls
      }
    });
  }

  groups.sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  return groups;
}

async function createTabsInWindow(urls, windowId) {
  const api = getBrowserApi();
  const validUrls = urls.filter((url) => Boolean(url));
  if (validUrls.length === 0) {
    throw new Error("No restorable URLs found in this group.");
  }

  if (windowId == null) {
    const firstUrl = validUrls[0];
    const remaining = validUrls.slice(1);
    const createdWindow = await api.windows.create({ url: firstUrl });
    for (const url of remaining) {
      await api.tabs.create({ windowId: createdWindow.id, url, active: false });
    }
    return;
  }

  for (let i = 0; i < validUrls.length; i += 1) {
    await api.tabs.create({
      windowId,
      url: validUrls[i],
      active: i === 0
    });
  }
}

async function restoreGroup(groupId, targetMode) {
  const api = getBrowserApi();
  const cached = groupCache.get(groupId);
  if (!cached) {
    throw new Error("That closed group is no longer available. Refresh and try again.");
  }

  const normalizedTarget = targetMode === "current-window" ? "current-window" : "new-window";
  const payload = cached.payload;

  if (normalizedTarget === "new-window" && payload.type === "window-group" && payload.sessionId) {
    await api.sessions.restore(payload.sessionId);
    return;
  }

  if (normalizedTarget === "new-window") {
    await createTabsInWindow(payload.urls, null);
    return;
  }

  const currentWindow = await api.windows.getCurrent();
  await createTabsInWindow(payload.urls, currentWindow.id);
}

async function loadTargetMode() {
  const api = getBrowserApi();
  const stored = await api.storage.local.get(TARGET_MODE_KEY);
  const value = stored[TARGET_MODE_KEY];
  return value === "current-window" ? "current-window" : DEFAULT_TARGET_MODE;
}

async function saveTargetMode(value) {
  const api = getBrowserApi();
  const normalized = value === "current-window" ? "current-window" : "new-window";
  await api.storage.local.set({ [TARGET_MODE_KEY]: normalized });
  return normalized;
}

async function getClosedGroups() {
  const api = getBrowserApi();
  const recentEntries = await api.sessions.getRecentlyClosed({ maxResults: MAX_RECENTLY_CLOSED });
  const mapped = mapClosedGroups(recentEntries);

  groupCache.clear();
  for (const group of mapped) {
    groupCache.set(group.id, group);
  }

  return mapped.map((group) => ({
    id: group.id,
    title: group.title,
    tabCount: group.tabCount,
    closedAt: group.closedAt
  }));
}

getBrowserApi().runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "GET_CLOSED_GROUPS") {
    return getClosedGroups();
  }

  if (message.type === "RESTORE_GROUP") {
    return restoreGroup(message.groupId, message.targetMode);
  }

  if (message.type === "GET_TARGET_MODE") {
    return loadTargetMode();
  }

  if (message.type === "SET_TARGET_MODE") {
    return saveTargetMode(message.targetMode);
  }

  return undefined;
});
