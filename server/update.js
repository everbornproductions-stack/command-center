// Update notifier and in-app updater.
// Desktop app (Electron installer): electron/main.cjs hands this module a bridge to electron-updater
// (globalThis.__ccUpdater) before the server starts. The app checks GitHub Releases on launch and every
// 30 minutes; nothing downloads until the person clicks "Update available" or "Restart to update".
// Web / hosted / dev: there is no installer to replace, so the app asks a small JSON feed what the latest
// version is (once at start, then every 6 hours) and the banner links to the download page.
// User data lives in the per-user app-data folder (CC_DATA_DIR), never in the install folder, so updates keep it.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";
import { emit } from "./events.js";

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
export const VERSION = pkg.version;
export const FEED_URL = process.env.CC_UPDATE_FEED || "https://everbornproductions.com/command-center/latest.json";

let state = { current: VERSION, latest: null, notes: null, url: null, available: false, checkedAt: 0, error: null, desktop: false, phase: "idle", progress: null };
const bridge = () => globalThis.__ccUpdater || null;
export const updateState = () => ({ ...state, desktop: !!bridge() });

export function newer(a, b) { // true if a > b (semver-ish, ignores a leading v)
  const pa = String(a).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0), pb = String(b).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
}

function set(next) {
  const was = state.available;
  state = { ...state, ...next, current: VERSION };
  if (state.available && !was) emit("log", { text: `Update available: v${state.latest}. ${state.notes ? String(state.notes).slice(0, 120) : ""}` });
  emit("update.state", { update: updateState() });
  return updateState();
}

// Called by the desktop bridge when electron-updater reports progress or errors.
export function desktopEvent(ev = {}) {
  if (ev.type === "available") return set({ available: true, latest: ev.version, notes: ev.notes || "", phase: state.phase === "downloading" ? "downloading" : "available", error: null });
  if (ev.type === "none") return set({ available: false, latest: ev.version || VERSION, phase: "idle", error: null, checkedAt: Date.now() });
  if (ev.type === "progress") return set({ phase: "downloading", progress: Math.max(0, Math.min(100, Math.round(ev.percent || 0))) });
  if (ev.type === "downloaded") return set({ phase: "installing", progress: 100 });
  if (ev.type === "error") return set({ phase: state.available ? "available" : "idle", error: String(ev.message || "update failed").slice(0, 300) });
  return updateState();
}

export async function checkForUpdate() {
  const b = bridge();
  if (b) {
    try {
      const r = await b.check(); // { version, notes } of the newest release, or null
      const available = !!(r && r.version && newer(r.version, VERSION));
      return set({ available, latest: r?.version || VERSION, notes: r?.notes || "", url: null, checkedAt: Date.now(), error: r?.error || null, phase: available ? (state.phase === "downloading" ? "downloading" : "available") : "idle" });
    } catch (e) { return set({ checkedAt: Date.now(), error: e.message }); }
  }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(FEED_URL, { signal: ctl.signal, headers: { "cache-control": "no-cache" } });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const available = !!j.version && newer(j.version, VERSION);
    return set({ latest: j.version || null, notes: j.notes || "", url: j.url || null, available, checkedAt: Date.now(), error: null, minimum: j.minimum || null, phase: available ? "available" : "idle" });
  } catch (e) {
    return set({ checkedAt: Date.now(), error: e.message });
  }
}

// "Update and restart": desktop only. Downloads the release, then quits and runs the installer, which
// relaunches the app. Errors come back as phase "available" with an error message.
export async function installUpdate() {
  const b = bridge();
  if (!b) { const e = new Error("In-app install works in the desktop app. Download the new installer instead."); e.status = 400; e.code = "not_desktop"; throw e; }
  if (!state.available) { const e = new Error("No update to install. Check for updates first."); e.status = 409; e.code = "no_update"; throw e; }
  if (state.phase === "downloading" || state.phase === "installing") return updateState();
  set({ phase: "downloading", progress: 0, error: null });
  Promise.resolve().then(() => b.download()).then(() => { set({ phase: "installing", progress: 100 }); return b.install(); })
    .catch((e) => desktopEvent({ type: "error", message: e?.message || String(e) }));
  return updateState();
}

export function startUpdateLoop() {
  const b = bridge();
  if (b && typeof b.onEvent === "function") b.onEvent(desktopEvent);
  checkForUpdate();
  setInterval(checkForUpdate, (b ? 30 * 60 * 1000 : 6 * 3600 * 1000)).unref();
}
