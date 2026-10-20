import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.CC_DATA_DIR || path.join(ROOT, "data");
export const WEB_DIR = path.join(ROOT, "web");
// Optional HQ folder for the HQ adapter (task board + media credit log). Only CC_HQ_DIR turns it on.
// A developer run from source still picks up a sibling HQ folder when one really exists; a packaged
// build (CC_PACKAGED=1, set by electron/main.cjs) never guesses.
function defaultHqDir() {
  if (process.env.CC_HQ_DIR) return process.env.CC_HQ_DIR;
  if (process.env.CC_PACKAGED === "1") return null;
  const parent = path.resolve(ROOT, "..");
  return fs.existsSync(path.join(parent, "hq", "state.json")) ? parent : null;
}
export const HQ_DIR = defaultHqDir();

// Hosted mode keeps everything in Supabase and never touches data/.
if (process.env.CC_MODE !== "hosted") {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "missions"), { recursive: true });
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
// A real pause. Windows can refuse a rename while another call still has the
// destination open (a /state poll reading missions). A tight spin would burn
// the core; this waits and then tries again.
function pauseMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {}
  }
}
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const body = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmp, body);
  let last;
  for (let i = 0; i < 6; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      last = e;
      if (!/EPERM|EBUSY|EACCES/i.test(e.code || "")) break;
      pauseMs(20 * (i + 1));
    }
  }
  try {
    fs.writeFileSync(file, body);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw last || e;
  }
  try { fs.unlinkSync(tmp); } catch {}
}
