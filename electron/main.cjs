// Meldmind desktop shell (an Everborn product; internal name Everborn Command Center). Starts the same Node server the web version uses, inside
// Electron's Node, then opens it in a window. Data lives in the per-user app folder, never
// inside the install directory.
const { app, BrowserWindow, shell, Menu, Tray, nativeImage, dialog, safeStorage, ipcMain, globalShortcut, screen, session, powerMonitor, Notification } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

app.setName("Everborn Command"); // KEEP: app-data folder %APPDATA%\Everborn Command holds settings, keys and history; the product is shown as "Meldmind"
const crypto = require("node:crypto");
const { pickFreePort, isOurServer } = require("./ports.cjs");
const { createUpdateController, CHECK_EVERY_MS, quitInstallAction } = require("./updater.cjs");
const { createWatchdog, describeProbeError } = require("./watchdog.cjs");
const { createHotkey } = require("./hotkey.cjs");
const a11y = require("./accessibility.cjs");
a11y.early(app); // UI Automation needs an accessibility tree from the first page (0.4.21)
const PREFERRED_PORT = Number(process.env.CC_PORT || 4747);
let PORT = PREFERRED_PORT; // the real port is picked in startServer (first free one from 4747 up)
const INSTANCE = crypto.randomBytes(12).toString("hex");
process.env.CC_INSTANCE = INSTANCE;
const isPackaged = app.isPackaged;
const IS_MAC = process.platform === "darwin";
// Mac builds are unsigned until there is an Apple Developer account (docs/RELEASING.md). Apple only lets
// signed apps replace themselves, so until then "Install now" on a Mac opens the release page for the
// new .dmg instead of downloading. Set to true once Developer ID signing and notarization are on.
const MAC_SELF_UPDATE = false;
const RELEASES_PAGE = "https://github.com/everbornproductions-stack/command-center-releases/releases";
const ROOT = path.join(__dirname, "..");
const userData = app.getPath("userData");

process.env.CC_PORT = String(PORT);
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || path.join(userData, "data");
// Installed builds ignore developer overrides (CC_DEV_OWNER) and cannot be pointed at another licence server.
process.env.CC_PACKAGED = isPackaged ? "1" : "0";
// HQ adapter: only active when CC_HQ_DIR is set explicitly; the app never guesses a folder.

let win = null, tray = null, serverStarted = false;

// One copy only: a second launch focuses the window that is already open (Windows shows several
// "Meldmind.exe" processes per copy: main, GPU, network and window helpers; that is normal).
const single = app.requestSingleInstanceLock();
if (!single) { app.quit(); process.exit(0); }

async function waitForServer(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok && isOurServer(await r.json(), INSTANCE)) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// OS-backed key encryption for macOS (Keychain) and Linux (libsecret / kwallet). Windows keeps DPAPI
// inside the server. The server runs in this same process, so the channel is a global it reads;
// see server/vault.js. Must be set after app "ready" (safeStorage is unusable before that).
function exposeSafeStorage() {
  const backend = () => {
    if (process.platform === "darwin") return "macOS Keychain";
    if (process.platform === "linux") { try { return safeStorage.getSelectedStorageBackend(); } catch { return "libsecret"; } }
    return "Windows DPAPI";
  };
  globalThis.__ccSafeStorage = {
    get backend() { return backend(); },
    available() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        // Linux without a keyring falls back to "basic_text", which is not encryption
        if (process.platform === "linux" && backend() === "basic_text") return false;
        return true;
      } catch { return false; }
    },
    encrypt: (s) => safeStorage.encryptString(s).toString("base64"),
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, "base64")),
  };
}

// In-app updates (installed builds only), run from the main process by electron/updater.cjs so they
// work even when the local server or the web UI does not. On launch the app checks GitHub Releases
// before the engine starts and shows "Meldmind vX.Y.Z is ready" (Install now / Later). Install now
// downloads with a progress bar, then the installer runs silently and relaunches. While the app
// is open, the same check runs every hour and the prompt says "Restart and update" / "Later".
// Later on that prompt downloads the update and installs it when you quit. App data in
// %APPDATA%\Everborn Command is outside the install folder, so updates and reinstalls keep it.
let quittingForUpdate = false, updater = null, updateWin = null;
const sendAll = (channel, payload) => { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send(channel, payload); } catch {} } };
function setupUpdater() {
  if (updater || !isPackaged || process.env.CC_NO_AUTO_UPDATE === "1") return;
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch (e) { log("updater unavailable:", e && e.message); return; }
  autoUpdater.logger = { info: (m) => log("updater:", m), warn: (m) => log("updater warn:", m), error: (m) => log("updater error:", m), debug: () => {} };
  updater = createUpdateController({
    autoUpdater, log, currentVersion: app.getVersion(),
    manualInstall: IS_MAC && !MAC_SELF_UPDATE,
    ui: {
      openDownload: (version) => shell.openExternal(`${RELEASES_PAGE}/tag/v${version}`),
      state: (st) => {
        sendAll("upd:state", st);
        if (win) { try { win.setProgressBar(st.phase === "downloading" ? (st.percent || 0) / 100 : -1); } catch {} }
        rebuildTrayMenu();
      },
      prompt: () => showUpdateWindow(),
      failed: (st) => {
        const page = (st && st.downloadUrl) || `${RELEASES_PAGE}/latest`;
        dialog.showMessageBox({
          type: "warning", title: "Meldmind", message: "Couldn't check for updates",
          detail: (st && st.detail) || "The releases page did not answer. You can download the installer yourself.",
          buttons: ["Download", "Later"], defaultId: 0, cancelId: 1, noLink: true,
        }).then(({ response }) => { if (response === 0) shell.openExternal(page); }).catch(() => {});
      },
      result: (st) => { if (st.error) dialog.showMessageBox({ type: "warning", title: "Meldmind", message: "Couldn't check for updates", detail: st.detail || st.error, buttons: ["Download", "Later"], defaultId: 0, cancelId: 1, noLink: true }).then(({ response }) => { if (response === 0) shell.openExternal((st && st.downloadUrl) || `${RELEASES_PAGE}/latest`); }).catch(() => {}); else dialog.showMessageBox({ type: "info", title: "Meldmind", message: `You have the newest version (v${app.getVersion()}).` }); },
      beforeQuit: () => { quittingForUpdate = true; },
    },
  });
  globalThis.__ccUpdater = updater.bridge; // Settings > Check for updates keeps working through the server
  setInterval(() => updater.check({ prompt: true, running: true }).catch((e) => log("periodic update check failed:", e && e.message)), CHECK_EVERY_MS).unref();
}
function showUpdateWindow() {
  if (updateWin && !updateWin.isDestroyed()) { updateWin.show(); updateWin.focus(); return; }
  updateWin = new BrowserWindow({
    width: 480, height: 300, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    parent: win && !win.isDestroyed() ? win : undefined, modal: false, show: false, autoHideMenuBar: true,
    title: "Meldmind update", backgroundColor: "#090d14", icon: path.join(ROOT, "web", "icons", "icon-512.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "desk-preload.cjs") },
  });
  updateWin.setMenu(null);
  updateWin.loadFile(path.join(__dirname, "update.html"));
  updateWin.once("ready-to-show", () => { updateWin.show(); updateWin.focus(); });
  updateWin.on("closed", () => { updateWin = null; if (updater && !quittingForUpdate && updater.state.phase === "available") updater.later(); }); // closing it means Later
}
function restartApp(reason) { log(`restarting app${reason ? ` (${reason})` : ""}`); app.relaunch(); app.exit(0); }

// IPC from the app window and the local pages only (never from another site)
function trustedSender(e) { const u = e.senderFrame && e.senderFrame.url || ""; return u.startsWith("file://") || u.startsWith(`http://127.0.0.1:${PORT}/`) || u.startsWith(`http://localhost:${PORT}/`); }
function setupIpc() {
  const handle = (ch, f) => ipcMain.handle(ch, async (e, ...a) => { if (!trustedSender(e)) throw new Error("not allowed"); return f(...a); });
  handle("app:restart", () => restartApp("asked from the window"));
  handle("app:open-log", () => shell.openPath(userData));
  // Manual handoff opens the provider's own page in the default browser. http(s) only. No second window.
  handle("app:open-external", (url) => {
    const s = String(url || "").trim();
    let u;
    try { u = new URL(s); } catch { throw new Error("That address is not a valid URL."); }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) throw new Error("Only an http or https address can be opened.");
    return shell.openExternal(u.toString());
  });
  handle("app:log-reload", (reason) => { log("renderer:", reason); return true; });
  // A short notice when another AI reports back. The body is the person's own summary, shown on this PC only.
  handle("app:notify", (title, body) => {
    const t = String(title || "Meldmind").replace(/\s+/g, " ").trim().slice(0, 80) || "Meldmind";
    const b = String(body || "").replace(/\s+/g, " ").trim().slice(0, 180);
    if (!b || typeof Notification === "undefined" || !Notification.isSupported()) return false;
    const n = new Notification({ title: t, body: b });
    n.show();
    return true;
  });
  handle("upd:state", () => (updater ? updater.state : { phase: "unavailable", current: app.getVersion(), error: isPackaged ? "updates are not available in this build" : "updates work in the installed app" }));
  handle("upd:check", async () => (updater ? updater.check({ manual: true }) : null));
  handle("upd:install", async () => { if (!updater) throw new Error("updates work in the installed app"); showUpdateWindow(); return updater.install(); });
  handle("upd:later", async () => {
    const job = updater ? updater.later() : null;
    const wait = !!(updater && updater.state.offer === "running" && updater.state.installOnQuit);
    if (!wait && updateWin && !updateWin.isDestroyed()) updateWin.close();
    const s = await Promise.resolve(job).catch(() => updater && updater.state);
    if (wait && updateWin && !updateWin.isDestroyed() && updater.state.phase === "downloaded") updateWin.close();
    return s || true;
  });
  handle("engine:state", () => ({ port: PORT, stuck: !!(watchdog && watchdog.stuck), reason: watchdog ? watchdog.reason : null }));
  handle("quick:hide", () => { hideQuick(); return true; });
  handle("quick:done", (o) => { hideQuick(); if (o && o.open) focusWindow(); return true; });
}

// Quick launcher (Phase 24): a small always-on-top box opened by the global hotkey (default Alt+Space,
// set in Settings). It loads quick.html from this app's own server and sends one order there. The hotkey
// is only taken when nobody else holds it (electron/hotkey.cjs) and is given back on quit.
let quickWin = null;
const hotkey = createHotkey({ globalShortcut, onTrigger: () => toggleQuick(), log: (...a) => log(...a) });
function hideQuick() { if (quickWin && !quickWin.isDestroyed()) quickWin.hide(); }
function toggleQuick() {
  if (!serverStarted) { focusWindow(); return; }
  if (quickWin && !quickWin.isDestroyed() && quickWin.isVisible()) { hideQuick(); return; }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const w = 640, hgt = 150;
  if (!quickWin || quickWin.isDestroyed()) {
    quickWin = new BrowserWindow({
      width: w, height: hgt, frame: false, resizable: false, movable: true, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, transparent: true, title: "Meldmind quick launcher",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "desk-preload.cjs") },
    });
    quickWin.loadURL(`http://127.0.0.1:${PORT}/quick.html`);
    quickWin.on("blur", hideQuick);
    quickWin.on("closed", () => { quickWin = null; });
    quickWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    quickWin.webContents.on("will-navigate", (e) => e.preventDefault());
  }
  quickWin.setBounds({ x: Math.round(area.x + (area.width - w) / 2), y: Math.round(area.y + area.height * 0.22), width: w, height: hgt });
  quickWin.show(); quickWin.focus();
}
// the server's hotkey plugin reads and changes the shortcut through this (same process)
globalThis.__ccHotkey = { desktop: true, apply: (cfg) => { const st = hotkey.apply(cfg); rebuildTrayMenu(); return st; }, get state() { return hotkey.state; } };

// Engine watchdog: if the local server stops answering for 15 s, tell the window (it shows a
// "Restart engine" panel) and offer Restart / Install update in a native dialog, once per outage.
let watchdog = null, engineDialogOpen = false;
function setupWatchdog() {
  watchdog = createWatchdog({
    thresholdMs: 15000,
    probe: async () => {
      try {
        const ctl = AbortSignal.timeout(4000);
        const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: ctl });
        if (!r.ok) return { ok: false, reason: `the engine answered HTTP ${r.status}` };
        return isOurServer(await r.json(), INSTANCE) ? true : { ok: false, reason: `another program is answering on port ${PORT}` };
      } catch (e) { return { ok: false, reason: describeProbeError(e, PORT) }; }
    },
    onStuck: (reason) => { log("engine stuck:", reason); sendAll("engine:status", { stuck: true, reason }); rebuildTrayMenu(); offerEngineDialog(reason); },
    onRecovered: () => { log("engine answering again"); sendAll("engine:status", { stuck: false, reason: null }); rebuildTrayMenu(); },
  });
  setInterval(() => watchdog.tick().catch(() => {}), 3000).unref();
}
async function offerEngineDialog(reason) {
  if (engineDialogOpen || quittingForUpdate) return;
  engineDialogOpen = true;
  try {
    const st = updater ? await updater.check().catch(() => updater.state) : null;
    const canUpdate = !!(st && st.version);
    const buttons = ["Restart app", canUpdate ? `Install update v${st.version}` : "Check for updates", "Wait"];
    const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: "warning", title: "Meldmind", buttons, defaultId: 0, cancelId: 2, noLink: true,
      message: "Meldmind's engine is not responding",
      detail: `Reason: ${reason}.\n\nRestarting usually fixes this. Your settings, keys and history are kept.`,
    });
    if (response === 0) restartApp("engine stuck");
    else if (response === 1) { if (canUpdate) { showUpdateWindow(); updater.install().catch(() => {}); } else if (updater) updater.check({ manual: true }); else dialog.showMessageBox({ type: "info", title: "Meldmind", message: "Updates work in the installed app." }); }
  } finally { engineDialogOpen = false; }
}

async function startServer() {
  if (serverStarted) return true;
  // Always run our own server. Never attach to whatever already answers on 4747 (a dev copy from the
  // repo, an older build): it would use a different data folder and its own network settings.
  PORT = await pickFreePort(PREFERRED_PORT);
  if (PORT !== PREFERRED_PORT) log(`port ${PREFERRED_PORT} is busy (another program); using ${PORT}`);
  process.env.CC_PORT = String(PORT);
  delete process.env.PORT; // the server prefers PORT over CC_PORT
  if (!process.env.CC_DEMO_PORT || !(await require("./ports.cjs").isFree(Number(process.env.CC_DEMO_PORT)))) process.env.CC_DEMO_PORT = String(await pickFreePort(PORT + 52, { avoid: [PORT] }));
  exposeSafeStorage();
  // built-in browser helper (Phase 27): its own window and session; the server finds it on this global
  try { globalThis.__ccBrowserDriver = require("./browser-helper.cjs").createBrowserHelper({ log, icon: path.join(ROOT, "web", "icons", "icon-512.png") }); }
  catch (e) { log("browser helper window unavailable:", e && e.message); }
  // real PDFs for document tasks: the server prints its pages with Electron (server/doc-pdf.js)
  try { globalThis.__ccPdfRenderer = require("./pdf-render.cjs").createPdfRenderer({ BrowserWindow }); }
  catch (e) { log("PDF renderer unavailable:", e && e.message); }
  // flat graphics (quote cards, banners): the server turns its SVG into a PNG with Electron (server/local-draw.js)
  try { globalThis.__ccSvgRenderer = require("./svg-render.cjs").createSvgRenderer({ BrowserWindow }); }
  catch (e) { log("SVG renderer unavailable:", e && e.message); }
  // a file URL on every platform (pathToFileURL still encodes a space, as in "/Applications/Command AI.app/..."; the current bundle is Meldmind.app)
  await import(require("node:url").pathToFileURL(path.join(ROOT, "server", "index.js")).href);
  serverStarted = await waitForServer();
  return serverStarted;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    // 0.4.21: stay hidden until the first frame is ready, in the splash's own colour, so there is no blank grey or white flash.
    // The page paints its start screen from the first frame (web/index.html), so what shows first is already Meldmind.
    show: false, backgroundColor: "#070b12", title: "Meldmind", autoHideMenuBar: true,
    icon: path.join(ROOT, "web", "icons", "icon-512.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "desk-preload.cjs") },
  });
  let shown = false;
  const showNow = () => { if (shown || !win || win.isDestroyed()) return; shown = true; try { win.show(); } catch {} };
  win.once("ready-to-show", showNow);
  setTimeout(showNow, 6000); // never leave the app invisible if the page is slow to paint
  watchReloads(win); // attach before the first load so it is counted
  if (serverStarted) win.loadURL(`http://127.0.0.1:${PORT}/`);
  else showOffline(watchdog && watchdog.reason || `the engine did not start on port ${PORT}`);
  // the engine page failed to load (engine gone): show the local "Restart engine" page instead
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMain) => { if (isMain && url.startsWith("http://127.0.0.1")) { log("window load failed:", desc); showOffline(`the window could not load the engine (${desc})`); } });
  // external links open in the system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) { shell.openExternal(url); return { action: "deny" }; } return { action: "allow" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) { e.preventDefault(); shell.openExternal(url); } });
  // The page loads the engine port, never the pretend-AI port. Menus remeasure on resize, move, and display changes.
  const { createNavDisplayWatch } = require("./nav-display.cjs");
  const stopNav = createNavDisplayWatch({
    screen, win,
    send: (payload) => { try { if (win && !win.isDestroyed()) win.webContents.send("nav:display", payload); } catch {} },
  });
  const markHidden = (hidden) => {
    const g = globalThis.__ccPerf = globalThis.__ccPerf || {};
    if (hidden && !g.hidden) g.hiddenAt = Date.now();
    g.hidden = !!hidden;
    if (!hidden) g.hiddenAt = 0;
  };
  win.on("minimize", () => markHidden(true));
  win.on("hide", () => markHidden(true));
  win.on("restore", () => markHidden(false));
  win.on("show", () => markHidden(false));
  win.on("focus", () => markHidden(false));
  win.on("closed", () => { try { stopNav(); } catch {} win = null; });
}

// Reload-loop breaker: every main-frame load of the engine page is logged; more than 6 in 60 s means
// something is looping, so stop and show the local engine page with Restart / Check for updates.
const loads = [];
function watchReloads(w) {
  w.webContents.on("did-start-navigation", (details, oldUrl, _inPlace, oldIsMain) => {
    const url = (details && details.url) || oldUrl || "";
    const isMain = details && details.isMainFrame !== undefined ? details.isMainFrame : oldIsMain;
    if (!isMain || !url.startsWith("http://127.0.0.1")) return;
    const t = Date.now(); loads.push(t); while (loads.length && t - loads[0] > 60000) loads.shift();
    log(`window load #${loads.length} in 60 s: ${url.replace(/\?.*$/, "")}`);
    if (loads.length > 6) { log("reload loop detected; showing the engine page instead"); loads.length = 0; setImmediate(() => showOffline("the window kept reloading (reload loop stopped)")); }
  });
  w.webContents.on("render-process-gone", (_e, d) => log("window process gone:", d && d.reason, d && d.exitCode));
  w.webContents.on("unresponsive", () => log("window unresponsive"));
}
app.on("child-process-gone", (_e, d) => log("child process gone:", d && d.type, d && d.reason));

// After an update (or the first run of this build), drop service workers and HTTP / script caches left
// by an older version or by another program that once answered on the same port. Keys, settings and
// the onboarding-completed flag (onboarding.json in the data folder) are not touched. That flag is
// not stored in localStorage, which this clear would not be a safe place for anyway.
async function clearStaleWebState() {
  const marker = path.join(userData, "web-state-version.txt");
  let prev = null; try { prev = fs.readFileSync(marker, "utf8").trim(); } catch {}
  if (prev === app.getVersion()) return;
  try {
    const { session } = require("electron");
    await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({}).catch(() => {});
    log(`cleared old service workers and caches (was ${prev || "none"}, now ${app.getVersion()})`);
  } catch (e) { log("could not clear web caches:", e && e.message); }
  try { fs.writeFileSync(marker, app.getVersion()); } catch {}
}

function showOffline(reason) { if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, "offline.html"), { query: { reason: String(reason || "") } }); }
function focusWindow() { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else createWindow(); }

function trayTemplate() {
  const st = updater ? updater.state : null;
  const items = [
    { label: "Open Meldmind", click: focusWindow },
    { label: hotkey.state.registered ? `Quick launcher (${hotkey.state.accelerator})` : "Quick launcher", enabled: serverStarted, click: toggleQuick },
    { label: "Open in browser", click: () => shell.openExternal(`http://localhost:${PORT}/`) },
    { label: `Data folder`, click: () => shell.openPath(process.env.CC_DATA_DIR) },
    { type: "separator" },
  ];
  if (st && st.version) items.push({ label: st.phase === "downloading" ? `Downloading update ${st.percent || 0}%` : `Install update v${st.version}`, enabled: st.phase !== "downloading", click: () => { showUpdateWindow(); updater.install().catch(() => {}); } });
  items.push({ label: "Check for updates", enabled: !!updater, click: () => updater && updater.check({ manual: true }) });
  items.push({ label: watchdog && watchdog.stuck ? "Restart app (engine not responding)" : "Restart app", click: () => restartApp("tray") });
  items.push({ type: "separator" }, { label: `Meldmind v${app.getVersion()}`, enabled: false }, { label: "Quit", click: () => app.quit() });
  return items;
}
// macOS (Phase 14): without an application menu, Cmd+C / Cmd+V / Cmd+A / Cmd+Z do nothing in text
// fields and Cmd+Q does not quit, so the Mac build gets the standard app, Edit and Window menus.
// Windows keeps no menu bar.
function macMenuTemplate() {
  return [
    { label: "Meldmind", submenu: [
      { label: "About Meldmind", click: () => dialog.showMessageBox({ type: "info", title: "Meldmind", message: `Meldmind v${app.getVersion()}`, detail: "an Everborn product\nTake command of all your AIs.\nOn a Mac, the first open is a right-click, then Open. Automatic updates for Mac are coming soon." }) },
      { label: "Check for updates", click: () => updater ? updater.check({ manual: true }) : dialog.showMessageBox({ type: "info", title: "Meldmind", message: "Updates work in the installed app." }) },
      { type: "separator" }, { role: "hide", label: "Hide Meldmind" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { label: "Quit Meldmind", accelerator: "Command+Q", click: () => app.quit() },
    ] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "togglefullscreen" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
    { role: "windowMenu" },
    { label: "Help", submenu: [
      { label: "Get everything connected", click: () => { focusWindow(); if (win && !win.isDestroyed()) win.webContents.executeJavaScript("window.CC&&window.CC.connectSetup&&window.CC.connectSetup.open()").catch(() => {}); } },
    ] },
  ];
}

function rebuildTrayMenu() { if (tray) { try { tray.setContextMenu(Menu.buildFromTemplate(trayTemplate())); } catch {} } }

function createTray() {
  try {
    // the macOS menu bar is 22 pt high and draws 18 pt icons; the Windows tray uses 16 px
    const size = IS_MAC ? 18 : 16;
    const img = nativeImage.createFromPath(path.join(ROOT, "web", "icons", "icon-512.png")).resize({ width: size, height: size });
    tray = new Tray(img);
    tray.setToolTip("Meldmind, an Everborn product. Take command of all your AIs.");
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
    tray.on("double-click", focusWindow);
  } catch {}
}

// Speech recognition needs the microphone. Without an explicit grant, Chromium
// ends the recognizer immediately (often while the talk button is still held).
// Only the local app window is answered; the check stays allow for other
// permissions so notifications and clipboard keep working.
function allowMicrophone() {
  const ses = session.defaultSession;
  const local = (wc) => {
    try {
      const u = wc && wc.getURL ? wc.getURL() : "";
      return !u || u.startsWith("http://127.0.0.1:") || u.startsWith("http://localhost:") || u.startsWith("file:");
    } catch { return false; }
  };
  const mic = (permission, details) => {
    if (permission === "microphone" || permission === "audioCapture") return true;
    if (permission === "media") {
      const types = details && details.mediaTypes;
      if (!types || !types.length) return true;
      return types.includes("audio") || types.includes("unknown");
    }
    return false;
  };
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!local(wc)) { callback(false); return; }
    // A video-only prompt is not the microphone. Audio, or a media prompt with
    // no type (speech recognition), is granted.
    if (permission === "media" && details && Array.isArray(details.mediaTypes) && details.mediaTypes.includes("video") && !details.mediaTypes.includes("audio")) {
      callback(false);
      return;
    }
    if (mic(permission, details)) { callback(true); return; }
    callback(true);
  });
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    if (mic(permission, details)) return local(wc);
    return true;
  });
}

app.on("second-instance", () => {
  log("second launch: focusing the open window");
  focusWindow();
  // Closing the window leaves the app in the tray, so opening it again is not a new process.
  // Check here too, or a restart from the shortcut never looks for an update.
  if (updater) updater.check({ prompt: true }).catch((e) => log("second launch update check failed:", e && e.message));
});
// Running prompt: Later downloads the update, and quit installs it. The launch prompt's Later does not.
let holdingQuitForUpdate = false;
app.on("before-quit", (event) => {
  if (!updater || quittingForUpdate) return;
  const action = quitInstallAction(updater.state);
  if (action === "skip") return;
  event.preventDefault();
  const go = () => { quittingForUpdate = true; updater.installDownloaded(); };
  if (action === "install") { go(); return; }
  if (holdingQuitForUpdate) return;
  holdingQuitForUpdate = true;
  updater.whenQuitInstallReady().then((ok) => {
    holdingQuitForUpdate = false;
    if (ok) go();
    else { quittingForUpdate = true; app.quit(); }
  });
});
// give the quick-launcher shortcut back on quit (only the one this app registered)
app.on("will-quit", () => { try { hotkey.dispose(); globalShortcut.unregisterAll(); } catch {} });
app.on("window-all-closed", () => { if (quittingForUpdate) app.quit(); /* otherwise keep serving in the tray */ });
app.on("activate", () => { if (!win) createWindow(); });

const LOG = path.join(userData, "everborn-command.log");
function log(...a) { try { fs.mkdirSync(userData, { recursive: true }); fs.appendFileSync(LOG, new Date().toISOString() + " " + a.join(" ") + "\n"); } catch {} console.log(...a); }
process.on("uncaughtException", (e) => log("uncaught:", e && e.stack || e));
process.on("unhandledRejection", (e) => log("unhandled:", e && e.stack || e));
// 0.4.21 (dogfood 10): the app once closed about 5 s after Stop with nothing in this log. These lines leave a trail
// (who asked to quit, and the exit code) so the next time the log says why.
app.on("before-quit", () => log("before-quit (quitting for update:", String(quittingForUpdate) + ")"));
process.on("exit", (code) => { try { fs.appendFileSync(LOG, new Date().toISOString() + " process exit code=" + code + "\n"); } catch {} });

app.whenReady().then(async () => {
  a11y.afterReady(app); // Electron only accepts this once ready
  try {
    const g = globalThis.__ccPerf = globalThis.__ccPerf || {};
    g.battery = powerMonitor.isOnBatteryPower();
    powerMonitor.on("on-battery", () => { g.battery = true; });
    powerMonitor.on("on-ac", () => { g.battery = false; });
  } catch (e) { log("power monitor unavailable:", e && e.message); }
  Menu.setApplicationMenu(IS_MAC ? Menu.buildFromTemplate(macMenuTemplate()) : null);
  allowMicrophone();
  log(`starting v${app.getVersion()} packaged=${isPackaged} preferred port=${PREFERRED_PORT} data=${process.env.CC_DATA_DIR}`);
  setupIpc();
  // updates first: they must work even if the engine below fails to start
  try { setupUpdater(); } catch (e) { log("updater setup failed:", e && e.stack || e); }
  createTray();
  const launchCheck = updater ? updater.check({ prompt: true }).catch((e) => log("launch update check failed:", e && e.message)) : null;
  let ok = false, failReason = null;
  try { ok = await startServer(); } catch (e) { failReason = (e && e.message || String(e)).split("\n")[0]; log("server failed:", e && e.stack || e); }
  log(ok ? `server ready on ${PORT}` : "server did not answer");
  setupWatchdog();
  await clearStaleWebState();
  if (!ok) watchdog.fail(failReason ? `the engine failed to start: ${failReason}` : `the engine did not answer on port ${PORT} within 20 seconds`);
  createWindow();
  rebuildTrayMenu();
  if (updateWin && !updateWin.isDestroyed() && win) { try { updateWin.setParentWindow(win); } catch {} }
  if (!ok) { await launchCheck; if (!updateWin) offerEngineDialog(watchdog.reason); }
});
