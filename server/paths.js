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

// Windows can lock a file it just created (scanner, indexer) and then refuse the
// rename or the next read with EPERM / EBUSY. A short retry lets that lock go.
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES", "UNKNOWN", "EMFILE"]);
function pause(ms) {
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* a lock that needs a real pause */ }
  }
}
export function retrySync(fn) {
  const waits = [0, 40, 80, 160, 320];
  let last;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) pause(waits[i]);
    try { return fn(); }
    catch (e) {
      last = e;
      if (!RETRYABLE.has(e?.code) || i === waits.length - 1) throw e;
    }
  }
  throw last;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(retrySync(() => fs.readFileSync(file, "utf8")));
  } catch {
    return fallback;
  }
}
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A pid in the temp name keeps two writers from sharing one .tmp file.
  const tmp = `${file}.${process.pid}.tmp`;
  const text = JSON.stringify(obj, null, 2);
  try {
    retrySync(() => {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
    });
  } catch (e) {
    // The lock outlasted the retries. Write the destination directly so the
    // mission is not dropped, then remove the temp file.
    if (!RETRYABLE.has(e?.code)) {
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
    try { fs.writeFileSync(file, text); }
    catch (e2) {
      try { fs.unlinkSync(tmp); } catch {}
      throw e2;
    }
    try { fs.unlinkSync(tmp); } catch {}
  }
}
