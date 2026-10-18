// Update notifier. The app asks a small JSON file on your website what the latest version is
// (once at start, then every 6 hours). If it is newer than package.json, the UI shows a banner
// with the release notes and a download link. Nothing is installed automatically; the person
// clicks. When the app ships as an Electron installer, electron-updater replaces the download
// step with a one-click install from the same feed.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";
import { emit } from "./events.js";

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
export const VERSION = pkg.version;
export const FEED_URL = process.env.CC_UPDATE_FEED || "https://everbornproductions.com/command-center/latest.json";

let state = { current: VERSION, latest: null, notes: null, url: null, available: false, checkedAt: 0, error: null };
export const updateState = () => state;

function newer(a, b) { // true if a > b (semver-ish)
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
}

export async function checkForUpdate() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(FEED_URL, { signal: ctl.signal, headers: { "cache-control": "no-cache" } });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const available = !!j.version && newer(j.version, VERSION);
    const was = state.available;
    state = { current: VERSION, latest: j.version || null, notes: j.notes || "", url: j.url || null, available, checkedAt: Date.now(), error: null, minimum: j.minimum || null };
    if (available && !was) emit("log", { text: `Update available: v${j.version}. ${j.notes ? String(j.notes).slice(0, 120) : ""}` });
  } catch (e) {
    state = { ...state, checkedAt: Date.now(), error: e.message };
  }
  return state;
}

export function startUpdateLoop() {
  checkForUpdate();
  setInterval(checkForUpdate, 6 * 3600 * 1000).unref();
}
