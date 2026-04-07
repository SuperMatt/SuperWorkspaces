function getBrowserApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }
  return chrome;
}

const api = getBrowserApi();
const workspacesList = document.getElementById("workspaces-list");
const statusNode = document.getElementById("status");
const refreshButton = document.getElementById("refresh-button");
const newWorkspaceButton = document.getElementById("new-workspace-button");

const expandedWorkspaceIds = new Set();

function setStatus(message) {
  statusNode.textContent = message || "";
}

function formatUpdatedAt(value) {
  if (!value) {
    return "Unknown update time";
  }
  const date = new Date(value);
  return date.toLocaleString();
}

function clearWorkspaces() {
  workspacesList.replaceChildren();
}

function makeWorkspaceListItem(workspace) {
  const item = document.createElement("li");
  item.className = "group-item";

  const heading = document.createElement("p");
  heading.className = "group-title";
  heading.textContent = workspace.name || "Untitled workspace";

  const meta = document.createElement("p");
  meta.className = "group-meta";
  const openSuffix = workspace.windowId != null ? " - open" : "";
  meta.textContent = `${workspace.tabCount} tabs - updated ${formatUpdatedAt(workspace.updatedAt)}${openSuffix}`;

  const openButton = document.createElement("button");
  openButton.className = "restore-button";
  openButton.type = "button";
  openButton.textContent = "Open in new window";
  openButton.addEventListener("click", async () => {
    try {
      openButton.disabled = true;
      setStatus("Opening workspace...");
      await api.runtime.sendMessage({
        type: "OPEN_WORKSPACE",
        workspaceId: workspace.id
      });
      setStatus(`Opened "${workspace.name}".`);
      await loadWorkspaces();
    } catch (error) {
      setStatus(`Open failed: ${error.message || String(error)}`);
    } finally {
      openButton.disabled = false;
    }
  });

  const renameButton = document.createElement("button");
  renameButton.className = "restore-button";
  renameButton.type = "button";
  renameButton.textContent = "Rename";
  renameButton.addEventListener("click", async () => {
    const nextName = prompt("Workspace name:", workspace.name || "Workspace");
    if (nextName == null) {
      return;
    }
    try {
      await api.runtime.sendMessage({
        type: "RENAME_WORKSPACE",
        workspaceId: workspace.id,
        name: nextName
      });
      setStatus(`Renamed workspace to "${nextName.trim() || "Workspace"}".`);
      await loadWorkspaces();
    } catch (error) {
      setStatus(`Rename failed: ${error.message || String(error)}`);
    }
  });

  const deleteButton = document.createElement("button");
  deleteButton.className = "restore-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", async () => {
    const ok = confirm(`Delete workspace "${workspace.name}"?`);
    if (!ok) {
      return;
    }
    try {
      await api.runtime.sendMessage({
        type: "DELETE_WORKSPACE",
        workspaceId: workspace.id
      });
      setStatus(`Deleted "${workspace.name}".`);
      await loadWorkspaces();
    } catch (error) {
      setStatus(`Delete failed: ${error.message || String(error)}`);
    }
  });

  const toggleButton = document.createElement("button");
  toggleButton.className = "restore-button";
  toggleButton.type = "button";
  const isExpanded = expandedWorkspaceIds.has(workspace.id);
  toggleButton.textContent = isExpanded ? "Hide pages" : "Show pages";
  toggleButton.addEventListener("click", async () => {
    if (expandedWorkspaceIds.has(workspace.id)) {
      expandedWorkspaceIds.delete(workspace.id);
    } else {
      expandedWorkspaceIds.add(workspace.id);
    }
    await loadWorkspaces();
  });

  item.append(heading, meta, openButton, renameButton, deleteButton, toggleButton);

  if (isExpanded) {
    const pageList = document.createElement("ul");
    pageList.className = "workspace-pages";
    const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
    if (tabs.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.textContent = "(no saved pages)";
      pageList.append(emptyItem);
    } else {
      for (const tab of tabs) {
        const row = document.createElement("li");
        const url = tab && typeof tab.url === "string" ? tab.url : "";
        row.textContent = url || "(invalid URL)";
        pageList.append(row);
      }
    }
    item.append(pageList);
  }

  return item;
}

async function loadWorkspaces() {
  clearWorkspaces();
  setStatus("Loading workspaces...");
  try {
    const workspaces = await api.runtime.sendMessage({ type: "GET_WORKSPACES" });
    if (!Array.isArray(workspaces) || workspaces.length === 0) {
      setStatus("No workspaces yet. Create one from the current window.");
      return;
    }

    const nodes = workspaces.map((workspace) => makeWorkspaceListItem(workspace));
    workspacesList.append(...nodes);
    setStatus(`${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} loaded.`);
  } catch (error) {
    setStatus(`Failed to load workspaces: ${error.message || String(error)}`);
  }
}

refreshButton.addEventListener("click", async () => {
  await loadWorkspaces();
});

newWorkspaceButton.addEventListener("click", async () => {
  try {
    newWorkspaceButton.disabled = true;
    setStatus("Creating workspace...");
    await api.runtime.sendMessage({ type: "NEW_WORKSPACE" });
    setStatus("New workspace created.");
    await loadWorkspaces();
  } catch (error) {
    setStatus(`Create failed: ${error.message || String(error)}`);
  } finally {
    newWorkspaceButton.disabled = false;
  }
});

async function init() {
  await loadWorkspaces();
}
init();
