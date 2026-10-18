// Everborn Command desktop shell. Starts the same Node server the web version uses, inside
// Electron's Node, then opens it in a window. Data lives in the per-user app folder, never
// inside the install directory.
const { app, BrowserWindow, shell, Menu, Tray, nativeImage, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

app.setName("Everborn Command"); // app-data folder: %APPDATA%\Everborn Command
const PORT = Number(process.env.CC_PORT || 4747);
const isPackaged = app.isPackaged;
const ROOT = path.join(__dirname, "..");
const userData = app.getPath("userData");

process.env.CC_PORT = String(PORT);
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || path.join(userData, "data");
// HQ adapter: only meaningful on Chris's PC; point it at a sibling folder if present, else nowhere.
if (!process.env.CC_HQ_DIR) {
  const guess = path.resolve(ROOT, "..");
  process.env.CC_HQ_DIR = fs.existsSync(path.join(guess, "hq", "state.json")) ? guess : path.join(userData, "hq");
}

let win = null, tray = null, serverStarted = false;

const single = app.requestSingleInstanceLock();
if (!single) { app.quit(); process.exit(0); }

async function waitForServer(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/state`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startServer() {
  if (serverStarted) return true;
  // Already running (e.g. the launcher script)? Just use it.
  try { const r = await fetch(`http://127.0.0.1:${PORT}/api/state`); if (r.ok) { serverStarted = true; return true; } } catch {}
  await import(path.join(ROOT, "server", "index.js").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
  serverStarted = await waitForServer();
  return serverStarted;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#090d14", title: "Everborn Command", autoHideMenuBar: true,
    icon: path.join(ROOT, "web", "icons", "icon-512.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${PORT}/`);
  // external links open in the system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) { shell.openExternal(url); return { action: "deny" }; } return { action: "allow" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) { e.preventDefault(); shell.openExternal(url); } });
  win.on("closed", () => { win = null; });
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(ROOT, "web", "icons", "icon-512.png")).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip("Everborn Command");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Everborn Command", click: () => { if (win) win.show(); else createWindow(); } },
      { label: "Open in browser", click: () => shell.openExternal(`http://localhost:${PORT}/`) },
      { label: `Data folder`, click: () => shell.openPath(process.env.CC_DATA_DIR) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]));
    tray.on("double-click", () => { if (win) win.show(); else createWindow(); });
  } catch {}
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } else createWindow(); });
app.on("window-all-closed", () => { /* keep serving in the tray */ });
app.on("activate", () => { if (!win) createWindow(); });

const LOG = path.join(userData, "everborn-command.log");
function log(...a) { try { fs.mkdirSync(userData, { recursive: true }); fs.appendFileSync(LOG, new Date().toISOString() + " " + a.join(" ") + "\n"); } catch {} console.log(...a); }
process.on("uncaughtException", (e) => log("uncaught:", e && e.stack || e));
process.on("unhandledRejection", (e) => log("unhandled:", e && e.stack || e));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  log(`starting v${app.getVersion()} packaged=${isPackaged} port=${PORT} data=${process.env.CC_DATA_DIR}`);
  let ok = false;
  try { ok = await startServer(); } catch (e) { log("server failed:", e && e.stack || e); }
  log(ok ? "server ready" : "server did not answer");
  createTray();
  createWindow();
  if (!ok) dialog.showErrorBox("Everborn Command", `The local server did not start on port ${PORT}. Details: ${LOG}`);
});
