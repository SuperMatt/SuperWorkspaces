function getBrowserApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }
  return chrome;
}

const api = getBrowserApi();
const nameInput = document.getElementById("workspace-name-input");
const statusNode = document.getElementById("status");
const confirmButton = document.getElementById("confirm-button");
const cancelButton = document.getElementById("cancel-button");

function setStatus(message) {
  statusNode.textContent = message || "";
}

function getWorkspaceId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("workspaceId");
}

async function init() {
  const workspaceId = getWorkspaceId();
  if (!workspaceId) {
    setStatus("Missing workspace.");
    confirmButton.disabled = true;
    return;
  }
  try {
    const workspaces = await api.runtime.sendMessage({ type: "GET_WORKSPACES" });
    const workspace = Array.isArray(workspaces) ? workspaces.find((ws) => ws.id === workspaceId) : null;
    if (!workspace) {
      setStatus("Workspace not found.");
      confirmButton.disabled = true;
      return;
    }
    nameInput.value = workspace.name || "Workspace";
    nameInput.focus();
    nameInput.select();
  } catch (error) {
    setStatus(`Failed to load request: ${error.message || String(error)}`);
    confirmButton.disabled = true;
  }
}

confirmButton.addEventListener("click", async () => {
  const workspaceId = getWorkspaceId();
  if (!workspaceId) {
    return;
  }
  try {
    confirmButton.disabled = true;
    setStatus("Saving name...");
    await api.runtime.sendMessage({
      type: "RENAME_WORKSPACE",
      workspaceId,
      name: nameInput.value.trim()
    });
    window.close();
  } catch (error) {
    setStatus(`Save failed: ${error.message || String(error)}`);
    confirmButton.disabled = false;
  }
});

cancelButton.addEventListener("click", () => {
  window.close();
});

nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    confirmButton.click();
  }
  if (event.key === "Escape") {
    cancelButton.click();
  }
});

void init();
