// Main-process update controller (v0.3.2). Lives entirely in the Electron main process and needs
// neither the local server nor the web UI, so even a build whose engine or window is broken can
// still update itself. electron-updater reads the public GitHub Releases feed named in
// electron-builder.yml. Nothing downloads until the person clicks. The launch prompt is
// "Install now" / "Later": Install now downloads with progress and restarts, and Later hides
// that prompt for this version until the next launch. While the app is running, the hourly
// check says "Restart and update" / "Later". Later on that prompt downloads (the click) and
// installs when the app quits. Pure logic with injected autoUpdater and UI hooks, so tests
// can drive it with fakes.
// manualInstall (unsigned Mac builds, Phase 14): Apple only lets signed apps replace themselves, so
// "Install now" opens the release page for the new .dmg (ui.openDownload) and never downloads or quits.
//
// The installed app checks on launch and every CHECK_EVERY_MS (one hour). The feed is the PUBLIC repo
// everbornproductions-stack/command-center-releases, channel latest (latest.yml). private stays
// false so a GH_TOKEN on the machine is never sent and the private source repo is never read.
// If the GitHub provider errors (it has to follow several redirects to read latest.yml), one retry
// uses the same public latest.yml URL directly. Nothing downloads before a click.

const CHECK_EVERY_MS = 60 * 60 * 1000;
const GITHUB_FEED = {
  provider: "github",
  owner: "everbornproductions-stack",
  repo: "command-center-releases",
  private: false,
  releaseType: "release",
};
// Must end with a slash: electron-updater joins "latest.yml" onto this URL, and a missing slash
// replaces the last path segment instead of appending the file.
const GENERIC_FEED = {
  provider: "generic",
  url: "https://github.com/everbornproductions-stack/command-center-releases/releases/latest/download/",
  channel: "latest",
};

function cleanError(e) {
  const message = String((e && e.message) || e || "update check failed").split("\n")[0];
  return message
    .replace(/ghp_[A-Za-z0-9]+/g, "ghp_redacted")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_redacted")
    .replace(/\b(Bearer|token)\s+\S+/gi, "$1 redacted")
    .replace(/https?:\/\/\S+/g, (url) => url.split("?")[0])
    .slice(0, 300);
}

// Top-bar label. Null means no button (no update to offer).
// Launch keeps "Install now". A check while the app is already running says "Restart and update".
function promptButtons(state) {
  if (state && state.offer === "running") return { primary: "Restart and update", secondary: "Later" };
  return { primary: "Install now", secondary: "Later" };
}

// What to do on quit after the running prompt's Later. "wait" means the download is still going.
function quitInstallAction(state) {
  if (!state || !state.installOnQuit) return "skip";
  if (state.phase === "downloaded") return "install";
  if (state.phase === "downloading") return "wait";
  return "skip";
}

function buttonLabel(state) {
  if (!state) return null;
  if (state.phase === "downloaded" || state.phase === "installing") return "Restart to update";
  if (state.phase === "downloading") {
    const n = state.percent != null ? state.percent : state.progress;
    return `Downloading ${n ?? 0}%`;
  }
  if (state.phase === "available" || state.available) return "Update available";
  return null;
}

function applyUpdateFeed(autoUpdater, which = "github") {
  autoUpdater.channel = "latest";
  autoUpdater.allowPrerelease = false;
  // Renamed from Command-AI-Setup to Meldmind-Setup. electron-updater builds the previous
  // blockmap URL by swapping the version inside the new file name, so it looks for
  // Meldmind-Setup-<old>.exe.blockmap, which was never published. Download the whole installer.
  autoUpdater.disableDifferentialDownload = true;
  if (typeof autoUpdater.setFeedURL !== "function") return which;
  autoUpdater.setFeedURL(which === "generic" ? GENERIC_FEED : GITHUB_FEED);
  return which;
}

function createUpdateController({ autoUpdater, log = () => {}, ui = {}, currentVersion = "0.0.0", manualInstall = false }) {
  const listeners = [];
  let state = { phase: "idle", current: currentVersion, version: null, notes: "", percent: null, error: null, checkedAt: 0, offer: "launch", installOnQuit: false, manual: !!manualInstall };
  let dismissed = null;    // version the person said "Later" to (this launch only)
  let pending = null;      // in-flight check
  let installing = false;
  let arming = null;       // running-prompt Later download, still in flight
  const busyPhase = () => state.phase === "downloading" || state.phase === "downloaded" || state.phase === "installing";

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
  let feed = "github";
  try { feed = applyUpdateFeed(autoUpdater, "github") || "github"; }
  catch (e) { log("updater feed failed:", cleanError(e)); }

  autoUpdater.on("update-available", (info) => {
    if (!newer(info.version, currentVersion)) return;
    setState({ phase: busyPhase() ? state.phase : "available", version: info.version, notes: notes(info), error: null });
    emit({ type: "available", version: info.version, notes: state.notes });
  });
  autoUpdater.on("update-not-available", (info) => { setState({ phase: "idle", version: null, error: null, checkedAt: Date.now() }); emit({ type: "none", version: info && info.version }); });
  autoUpdater.on("download-progress", (p) => { setState({ phase: "downloading", percent: Math.max(0, Math.min(100, Math.round(p.percent || 0))) }); emit({ type: "progress", percent: p.percent }); });
  autoUpdater.on("update-downloaded", () => { setState({ phase: "downloaded", percent: 100 }); emit({ type: "downloaded" }); });
  autoUpdater.on("error", (e) => {
    const message = cleanError(e);
    log("updater error:", message);
    installing = false;
    setState({ phase: state.version ? "available" : "idle", error: message });
    emit({ type: "error", message });
  });

  async function runCheck() {
    try { return await autoUpdater.checkForUpdates(); }
    catch (e) {
      if (feed !== "generic" && typeof autoUpdater.setFeedURL === "function") {
        log("update check failed:", cleanError(e), "(retrying public latest.yml)");
        try { feed = applyUpdateFeed(autoUpdater, "generic"); }
        catch (e2) { log("updater feed failed:", cleanError(e2)); throw e; }
        return await autoUpdater.checkForUpdates();
      }
      throw e;
    }
  }

  // check({ prompt: true }) is the launch prompt (Install now / Later).
  // check({ prompt: true, running: true }) is the hourly prompt (Restart and update / Later).
  // A manual check (tray) always shows the result, and uses the running wording.
  async function check({ prompt = false, manual = false, running = false } = {}) {
    if (installing) return state;
    if (!pending) {
      if (!busyPhase()) setState({ phase: state.phase === "available" ? "available" : "checking", error: null });
      pending = Promise.resolve().then(() => runCheck()).then((r) => {
        const i = r && r.updateInfo;
        const available = !!(i && i.version && newer(i.version, currentVersion));
        if (available) {
          log(`update available: v${i.version} (have v${currentVersion})`);
          setState({ phase: busyPhase() ? state.phase : "available", version: i.version, notes: notes(i) || state.notes, error: null });
        } else if (!busyPhase()) {
          log(r ? `update check: no newer release (have v${currentVersion})` : "update check returned nothing");
          setState({ phase: "idle", version: null, error: null });
        }
        return setState({ checkedAt: Date.now() });
      }).catch((e) => {
        const message = cleanError(e);
        log("update check failed:", message);
        if (busyPhase()) return setState({ error: message, checkedAt: Date.now() });
        return setState({ phase: state.version ? "available" : "idle", error: message, checkedAt: Date.now() });
      }).finally(() => { pending = null; });
    }
    const s = await pending;
    if (s.phase === "available" && (manual || (prompt && dismissed !== s.version))) {
      const offer = (running || manual) && !manualInstall ? "running" : "launch";
      const next = setState({ offer });
      try { ui.prompt && ui.prompt(next); } catch (e) { log("update prompt failed:", e && e.message); }
      return next;
    }
    if (manual) { try { ui.result && ui.result(s); } catch {} }
    return state;
  }

  async function downloadForQuit() {
    autoUpdater.autoInstallOnAppQuit = false;
    setState({ installOnQuit: true, phase: "downloading", percent: state.percent || 0, error: null });
    log(`update v${state.version}: later, will install on quit`);
    try { await autoUpdater.downloadUpdate(); }
    catch (e) {
      const message = cleanError(e);
      log("update download failed:", message);
      setState({ phase: "available", installOnQuit: false, error: message });
      emit({ type: "error", message });
      throw e;
    }
    dismissed = state.version;
    setState({ phase: "downloaded", percent: 100, installOnQuit: true });
    log(`update v${state.version} downloaded; it will install when you quit`);
    return state;
  }

  function later() {
    if (state.offer === "running" && state.version && !manualInstall) {
      if (arming) return arming;
      arming = downloadForQuit().finally(() => { arming = null; });
      return arming;
    }
    dismissed = state.version;
    log(`update v${state.version}: later`);
    return state;
  }

  function whenQuitInstallReady() {
    if (state.installOnQuit && state.phase === "downloaded") return Promise.resolve(true);
    if (arming) return arming.then(() => !!(state.installOnQuit && state.phase === "downloaded")).catch(() => false);
    return Promise.resolve(false);
  }

  function installDownloaded() {
    if (installing || state.phase !== "downloaded") return state;
    installing = true;
    log("installing update on quit");
    try { ui.beforeQuit && ui.beforeQuit(); } catch {}
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return state;
  }

  const MANUAL_NOTE = "Automatic updates for Mac are coming soon. This Mac build cannot replace itself yet (it is not signed). Download the new version from the page that just opened. Install with a right-click, then Open.";
  function openDownload() {
    log(`update v${state.version}: opening the download page (manual install)`);
    try { ui.openDownload && ui.openDownload(state.version); } catch (e) { log("could not open the download page:", e && e.message); }
    return setState({ phase: "available", error: MANUAL_NOTE });
  }

  // download with progress, then quit and run the installer, which relaunches the app
  async function install() {
    if (installing) return state;
    if (!state.version) { const s = await check(); if (!s.version) throw Object.assign(new Error("No update to install."), { code: "no_update" }); }
    if (manualInstall) return openDownload();
    installing = true;
    setState({ phase: "downloading", percent: state.percent || 0, error: null });
    log(`downloading update v${state.version}`);
    try { await autoUpdater.downloadUpdate(); }
    catch (e) { installing = false; const message = cleanError(e); log("update download failed:", message); setState({ phase: "available", error: message }); emit({ type: "error", message }); throw e; }
    setState({ phase: "downloaded", percent: 100 });
    log("installing update and restarting");
    try { ui.beforeQuit && ui.beforeQuit(); } catch {}
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return state;
  }

  // what server/update.js expects (globalThis.__ccUpdater), so Settings keeps working
  const bridge = {
    onEvent: (f) => listeners.push(f),
    async check() {
      const s = await check();
      const found = !!(s.version && newer(s.version, currentVersion));
      return found ? { version: s.version, notes: s.notes || "", error: s.error || null } : { version: currentVersion, notes: "", error: s.error || null };
    },
    download: () => { if (!manualInstall) return autoUpdater.downloadUpdate(); openDownload(); return Promise.reject(Object.assign(new Error(MANUAL_NOTE), { code: "manual_install" })); },
    install() {
      if (manualInstall) return; installing = true; try { ui.beforeQuit && ui.beforeQuit(); } catch {} log("installing update and restarting"); setImmediate(() => autoUpdater.quitAndInstall(true, true)); },
  };

  return { check, later, install, installDownloaded, whenQuitInstallReady, bridge, manualInstall, onEvent: (f) => listeners.push(f), get state() { return state; } };
}

module.exports = { createUpdateController, CHECK_EVERY_MS, GITHUB_FEED, GENERIC_FEED, applyUpdateFeed, buttonLabel, promptButtons, quitInstallAction, cleanError };
