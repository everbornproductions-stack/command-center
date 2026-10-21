// Preload for the browser helper's bar (electron/browser-bar.html) only. The website in the helper window
// gets no preload at all. The bar can show the state and answer Stop, OK and No for the open job; the main
// process checks that these come from the bar itself.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ccBar", {
  onState: (f) => { ipcRenderer.on("bar:state", (_e, s) => f(s)); },
  stop: (jobId) => ipcRenderer.invoke("bar:stop", String(jobId || "")),
  ok: (jobId, approvalId) => ipcRenderer.invoke("bar:ok", String(jobId || ""), String(approvalId || "")),
  no: (jobId, approvalId) => ipcRenderer.invoke("bar:no", String(jobId || ""), String(approvalId || "")),
  openLink: (url) => {
    const u = String(url || "");
    if (u !== "https://1password.com" && u !== "https://bitwarden.com") return Promise.resolve(false);
    return ipcRenderer.invoke("bar:open-tip", u);
  },
});
