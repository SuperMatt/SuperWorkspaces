function getBrowserApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }
  return chrome;
}

const api = getBrowserApi();
const groupsList = document.getElementById("groups-list");
const statusNode = document.getElementById("status");
const refreshButton = document.getElementById("refresh-button");
const targetModeSelect = document.getElementById("target-mode");

function setStatus(message) {
  statusNode.textContent = message || "";
}

function formatClosedAt(value) {
  if (!value) {
    return "Unknown close time";
  }
  const date = new Date(value);
  return date.toLocaleString();
}

function clearGroups() {
  groupsList.replaceChildren();
}

function makeGroupListItem(group, targetMode) {
  const item = document.createElement("li");
  item.className = "group-item";

  const heading = document.createElement("p");
  heading.className = "group-title";
  heading.textContent = group.title || "Untitled group";

  const meta = document.createElement("p");
  meta.className = "group-meta";
  meta.textContent = `${group.tabCount} tabs - closed ${formatClosedAt(group.closedAt)}`;

  const restoreButton = document.createElement("button");
  restoreButton.className = "restore-button";
  restoreButton.type = "button";
  restoreButton.textContent = "Restore group";
  restoreButton.addEventListener("click", async () => {
    try {
      restoreButton.disabled = true;
      setStatus("Restoring group...");
      await api.runtime.sendMessage({
        type: "RESTORE_GROUP",
        groupId: group.id,
        targetMode
      });
      setStatus(`Restored "${group.title}".`);
      await loadGroups();
    } catch (error) {
      setStatus(`Restore failed: ${error.message || String(error)}`);
    } finally {
      restoreButton.disabled = false;
    }
  });

  item.append(heading, meta, restoreButton);
  return item;
}

async function loadTargetMode() {
  try {
    const targetMode = await api.runtime.sendMessage({ type: "GET_TARGET_MODE" });
    targetModeSelect.value = targetMode === "current-window" ? "current-window" : "new-window";
  } catch (_error) {
    targetModeSelect.value = "new-window";
  }
}

async function saveTargetMode() {
  const targetMode = targetModeSelect.value === "current-window" ? "current-window" : "new-window";
  await api.runtime.sendMessage({
    type: "SET_TARGET_MODE",
    targetMode
  });
}

async function loadGroups() {
  clearGroups();
  setStatus("Loading closed groups...");
  try {
    const groups = await api.runtime.sendMessage({ type: "GET_CLOSED_GROUPS" });
    if (!Array.isArray(groups) || groups.length === 0) {
      setStatus("No recently closed tab groups were found.");
      return;
    }

    const selectedMode = targetModeSelect.value === "current-window" ? "current-window" : "new-window";
    const nodes = groups.map((group) => makeGroupListItem(group, selectedMode));
    groupsList.append(...nodes);
    setStatus(`${groups.length} closed group${groups.length === 1 ? "" : "s"} available.`);
  } catch (error) {
    setStatus(`Failed to load groups: ${error.message || String(error)}`);
  }
}

targetModeSelect.addEventListener("change", async () => {
  await saveTargetMode();
  await loadGroups();
});

refreshButton.addEventListener("click", async () => {
  await loadGroups();
});

async function init() {
  await loadTargetMode();
  await loadGroups();
}

init();
