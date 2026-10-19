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
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
