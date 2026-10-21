// Optional heavy tools. They are never inside the installer.
// A download runs only when approve is true (the Install click).
// With no local copy, chooseRoute says to use a connected AI.

import fs from "node:fs";
import path from "node:path";
import { ADDONS, addonById, formatBytes } from "../../web/perf/registry.js";

const ID_OK = /^[a-z0-9-]{1,40}$/;

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function indexPath(dir) {
  return path.join(dir, "addons", "index.json");
}

function readIndex(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(dir), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeIndex(dir, data) {
  const file = indexPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

export function sourceUrlFor(id) {
  const meta = addonById(id);
  if (!meta) return "";
  if (process.env.CC_PACKAGED === "1") return meta.url || "";
  try {
    const map = JSON.parse(process.env.CC_ADDON_URLS || "{}");
    if (map && typeof map[id] === "string" && map[id]) return map[id];
  } catch { /* a bad env map means no download url */ }
  return meta.url || "";
}

function folderSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) n += folderSize(p);
    else {
      try { n += fs.statSync(p).size; } catch { /* a file vanished mid-count */ }
    }
  }
  return n;
}

export function addonDir(dataDir, id) {
  const root = path.resolve(dataDir, "addons");
  const dest = path.resolve(root, id);
  if (dest !== root && !dest.startsWith(root + path.sep)) throw fail(400, "That add-on path is not allowed.");
  return dest;
}

export function listAddons(dataDir) {
  const saved = readIndex(dataDir);
  return ADDONS.map((meta) => {
    const row = saved[meta.id] || {};
    const dir = path.join(dataDir, "addons", meta.id);
    const installedBytes = row.installed ? folderSize(dir) : 0;
    const installed = !!(row.installed && installedBytes > 0);
    return {
      id: meta.id,
      name: meta.name,
      bytes: meta.bytes,
      sizeLabel: `about ${formatBytes(meta.bytes)}`,
      summary: meta.summary,
      cloud: meta.cloud,
      approved: !!row.approved,
      installed,
      installedBytes: installed ? installedBytes : 0,
      route: installed ? "local" : "cloud",
    };
  });
}

export function chooseRoute(dataDir, id) {
  const meta = addonById(id);
  if (!meta) throw fail(404, "No such add-on.");
  const row = listAddons(dataDir).find((a) => a.id === id);
  if (row.installed) return { id, route: "local", note: `${meta.name} is on this PC.` };
  return { id, route: "cloud", bytes: meta.bytes, sizeLabel: `about ${formatBytes(meta.bytes)}`, note: meta.cloud };
}

async function downloadTo(url, dest, cap) {
  let parsed;
  try { parsed = new URL(url); } catch { throw fail(400, "The add-on address is not a valid URL."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw fail(400, "An add-on download uses http or https.");
  const res = await fetch(parsed, { redirect: "follow" });
  if (!res.ok) throw fail(502, `The add-on download answered HTTP ${res.status}.`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > cap) throw fail(400, "The download is larger than the size that was shown.");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > cap) throw fail(400, "The download is larger than the size that was shown.");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  return buf.length;
}

export async function installAddon(id, { approve, dataDir, sourceUrl } = {}) {
  if (!ID_OK.test(String(id || ""))) throw fail(400, "No such add-on.");
  const meta = addonById(id);
  if (!meta) throw fail(404, "No such add-on.");
  if (approve !== true) throw fail(400, `This stays off this PC until you click Install. The size is about ${formatBytes(meta.bytes)}.`);
  if (!dataDir) throw fail(500, "No data folder for add-ons.");
  const url = sourceUrl || sourceUrlFor(id);
  const saved = readIndex(dataDir);
  saved[id] = { ...(saved[id] || {}), approved: true, approvedAt: Date.now() };
  if (!url) {
    saved[id].installed = false;
    writeIndex(dataDir, saved);
    return {
      ...listAddons(dataDir).find((a) => a.id === id),
      message: `${meta.name} is not on a download server yet. ${meta.cloud}`,
    };
  }
  const destDir = addonDir(dataDir, id);
  fs.mkdirSync(destDir, { recursive: true });
  const file = path.join(destDir, "payload");
  const cap = Math.max(meta.bytes * 2, 1024);
  const bytes = await downloadTo(url, file, cap);
  saved[id].installed = true;
  saved[id].installedAt = Date.now();
  saved[id].bytes = bytes;
  writeIndex(dataDir, saved);
  return listAddons(dataDir).find((a) => a.id === id);
}

export function removeAddon(id, dataDir) {
  if (!ID_OK.test(String(id || ""))) throw fail(400, "No such add-on.");
  if (!addonById(id)) throw fail(404, "No such add-on.");
  const saved = readIndex(dataDir);
  delete saved[id];
  writeIndex(dataDir, saved);
  const dir = addonDir(dataDir, id);
  fs.rmSync(dir, { recursive: true, force: true });
  return listAddons(dataDir).find((a) => a.id === id);
}
