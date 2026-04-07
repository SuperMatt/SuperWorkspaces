function getBrowserApi() {
  if (typeof browser !== "undefined") {
    return browser;
  }
  return chrome;
}

const api = getBrowserApi();
const messageNode = document.getElementById("message");
const keepButton = document.getElementById("keep-button");
const deleteButton = document.getElementById("delete-button");

function getWorkspaceId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("workspaceId");
}

async function init() {
  const workspaceId = getWorkspaceId();
  if (!workspaceId) {
    messageNode.textContent = "Missing workspace.";
    keepButton.disabled = true;
    deleteButton.disabled = true;
    return;
  }
  const workspace = await api.runtime.sendMessage({
    type: "GET_WORKSPACE",
    workspaceId
  });
  if (workspace && workspace.name) {
    messageNode.textContent = `Delete "${workspace.name}"?`;
  }
}

keepButton.addEventListener("click", async () => {
  const workspaceId = getWorkspaceId();
  if (workspaceId) {
    await api.runtime.sendMessage({
      type: "CONFIRM_DELETE_EMPTY_WORKSPACE",
      workspaceId,
      deleteWorkspace: false
    });
  }
  window.close();
});

deleteButton.addEventListener("click", async () => {
  const workspaceId = getWorkspaceId();
  if (workspaceId) {
    await api.runtime.sendMessage({
      type: "CONFIRM_DELETE_EMPTY_WORKSPACE",
      workspaceId,
      deleteWorkspace: true
    });
  }
  window.close();
});

void init();
