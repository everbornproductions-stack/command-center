// Main-process update controller (v0.3.2). Lives entirely in the Electron main process and needs
// neither the local server nor the web UI, so even a build whose engine or window is broken can
// still update itself. electron-updater reads the public GitHub Releases feed named in
// electron-builder.yml. Nothing downloads until the person clicks "Install now" (launch prompt,
// tray menu, engine-down dialog or Settings); then it downloads with progress and restarts into
// the new version. "Later" hides the launch prompt for this version until the next launch.
// Pure logic with injected autoUpdater and UI hooks, so tests can drive it with fakes.

function createUpdateController({ autoUpdater, log = () => {}, ui = {}, currentVersion = "0.0.0" }) {
  const listeners = [];
  let state = { phase: "idle", current: currentVersion, version: null, notes: "", percent: null, error: null, checkedAt: 0 };
  let dismissed = null;    // version the person said "Later" to (this launch only)
  let pending = null;      // in-flight check
  let installing = false;

  const emit = (ev) => { for (const f of listeners) { try { f(ev); } catch {} } };
  const setState = (patch) => { state = { ...state, ...patch }; try { ui.state && ui.state(state); } catch {} return state; };
  const notes = (info) => {
    const n = info && info.releaseNotes; if (!n) return "";
    const t = Array.isArray(n) ? n.map((x) => x.note || "").join(" ") : String(n);
    return t.replace(/<[^>]+>/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 600);
  };
  const newer = (a, b) => {
    const pa = String(a).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0), pb = String(b).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
  };

  autoUpdater.autoDownload = false;          // download only on click
  autoUpdater.autoInstallOnAppQuit = false;  // install only on click
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("update-available", (info) => {
    if (!newer(info.version, currentVersion)) return;
    setState({ phase: state.phase === "downloading" ? "downloading" : "available", version: info.version, notes: notes(info), error: null });
    emit({ type: "available", version: info.version, notes: state.notes });
  });
  autoUpdater.on("update-not-available", (info) => { setState({ phase: "idle", version: null, error: null, checkedAt: Date.now() }); emit({ type: "none", version: info && info.version }); });
  autoUpdater.on("download-progress", (p) => { setState({ phase: "downloading", percent: Math.max(0, Math.min(100, Math.round(p.percent || 0))) }); emit({ type: "progress", percent: p.percent }); });
  autoUpdater.on("update-downloaded", () => { setState({ phase: "downloaded", percent: 100 }); emit({ type: "downloaded" }); });
  autoUpdater.on("error", (e) => {
    const message = (e && e.message || String(e)).split("\n")[0].slice(0, 300);
    installing = false;
    setState({ phase: state.version ? "available" : "idle", error: message });
    emit({ type: "error", message });
  });

  // check({ launch: true }) shows the prompt; a manual check (tray) always shows the result.
  async function check({ prompt = false, manual = false } = {}) {
    if (installing) return state;
    if (!pending) {
      setState({ phase: state.phase === "available" ? "available" : "checking", error: null });
      pending = Promise.resolve().then(() => autoUpdater.checkForUpdates()).then((r) => {
        const i = r && r.updateInfo;
        const available = !!(i && i.version && newer(i.version, currentVersion));
        if (available) setState({ phase: state.phase === "downloading" ? "downloading" : "available", version: i.version, notes: notes(i) || state.notes });
        else setState({ phase: "idle", version: null });
        return setState({ checkedAt: Date.now() });
      }).catch((e) => setState({ phase: state.version ? "available" : "idle", error: (e && e.message || String(e)).split("\n")[0].slice(0, 300), checkedAt: Date.now() }))
        .finally(() => { pending = null; });
    }
    const s = await pending;
    if (s.phase === "available" && (manual || (prompt && dismissed !== s.version))) { try { ui.prompt && ui.prompt(s); } catch (e) { log("update prompt failed:", e && e.message); } }
    else if (manual) { try { ui.result && ui.result(s); } catch {} }
    return s;
  }

  function later() { dismissed = state.version; log(`update v${state.version}: later`); return state; }

  // download with progress, then quit and run the installer, which relaunches the app
  async function install() {
    if (installing) return state;
    if (!state.version) { const s = await check(); if (!s.version) throw Object.assign(new Error("No update to install."), { code: "no_update" }); }
    installing = true;
    setState({ phase: "downloading", percent: state.percent || 0, error: null });
    log(`downloading update v${state.version}`);
    try { await autoUpdater.downloadUpdate(); }
    catch (e) { installing = false; const message = (e && e.message || String(e)).split("\n")[0].slice(0, 300); setState({ phase: "available", error: message }); emit({ type: "error", message }); throw e; }
    setState({ phase: "downloaded", percent: 100 });
    log("installing update and restarting");
    try { ui.beforeQuit && ui.beforeQuit(); } catch {}
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return state;
  }

  // what server/update.js expects (globalThis.__ccUpdater), so Settings keeps working
  const bridge = {
    onEvent: (f) => listeners.push(f),
    async check() { const s = await check(); return s.version ? { version: s.version, notes: s.notes } : { version: currentVersion, notes: "" }; },
    download: () => autoUpdater.downloadUpdate(),
    install() { installing = true; try { ui.beforeQuit && ui.beforeQuit(); } catch {} log("installing update and restarting"); setImmediate(() => autoUpdater.quitAndInstall(true, true)); },
  };

  return { check, later, install, bridge, onEvent: (f) => listeners.push(f), get state() { return state; } };
}

module.exports = { createUpdateController };
