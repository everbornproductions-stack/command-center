// Preload for the app window and the local update / engine-down pages. Exposes a few desktop
// actions (restart, update) that work without the local server. Nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ccDesktop", {
  desktop: true,
  restart: () => ipcRenderer.invoke("app:restart"),
  checkForUpdates: () => ipcRenderer.invoke("upd:check"),
  installUpdate: () => ipcRenderer.invoke("upd:install"),
  later: () => ipcRenderer.invoke("upd:later"),
  updateState: () => ipcRenderer.invoke("upd:state"),
  engineState: () => ipcRenderer.invoke("engine:state"),
  openLog: () => ipcRenderer.invoke("app:open-log"),
  logReload: (reason) => ipcRenderer.invoke("app:log-reload", String(reason || "").slice(0, 200)),
  onUpdate: (f) => { ipcRenderer.on("upd:state", (_e, s) => f(s)); },
  onEngine: (f) => { ipcRenderer.on("engine:status", (_e, s) => f(s)); },
  // quick launcher (Phase 24): close it, and optionally bring the main window forward
  quickDone: (o) => ipcRenderer.invoke("quick:done", { open: !!(o && o.open) }),
  quickHide: () => ipcRenderer.invoke("quick:hide"),
});
