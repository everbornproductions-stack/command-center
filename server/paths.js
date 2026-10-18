import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.CC_DATA_DIR || path.join(ROOT, "data");
export const WEB_DIR = path.join(ROOT, "web");
// Everborn HQ folder (optional). Default: the parent of command-center.
export const HQ_DIR = process.env.CC_HQ_DIR || path.resolve(ROOT, "..");

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
