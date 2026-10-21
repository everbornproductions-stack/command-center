// Installed programs, by name only.
// Windows: uninstall registry values and Start menu shortcut names.
// Every platform: command names on PATH.
// This module lists names. It does not open those files.

import path from "node:path";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";

const UNINSTALL_KEYS = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];

const SKIP_NAME = /security update|update for windows|hotfix|\bkb\d{5,}\b/i;

export function parseRegUninstall(text) {
  const out = [];
  const blocks = String(text || "").split(/\r?\n(?=HKEY_)/);
  for (const block of blocks) {
    if (/SystemComponent\s+REG_DWORD\s+0x1\b/i.test(block)) continue;
    const name = /DisplayName\s+REG_\w+\s+(.+)/i.exec(block)?.[1]?.trim();
    if (!name || SKIP_NAME.test(name)) continue;
    const publisher = /Publisher\s+REG_\w+\s+(.+)/i.exec(block)?.[1]?.trim() || "";
    out.push({ name, publisher, source: "registry" });
  }
  return out;
}

async function walkNames(io, dir, depth, out, take) {
  if (depth > 4 || out.length >= 400) return;
  let ents = [];
  try { ents = await io.listDir(dir); } catch { return; }
  for (const ent of ents) {
    if (out.length >= 400) return;
    const name = String(ent?.name || "");
    if (!name || name === "." || name === "..") continue;
    if (ent.directory) await walkNames(io, path.join(dir, name), depth + 1, out, take);
    else take(name);
  }
}

export async function scanRegistry(io) {
  const out = [];
  for (const key of UNINSTALL_KEYS) {
    let text = "";
    try { text = await io.regQuery(key); } catch { continue; }
    out.push(...parseRegUninstall(text));
  }
  return out;
}

export async function scanStartMenu(io) {
  const roots = [io.env.ProgramData, io.env.APPDATA].filter(Boolean).map((root) => path.join(root, "Microsoft", "Windows", "Start Menu", "Programs"));
  const out = [];
  for (const root of roots) {
    await walkNames(io, root, 0, out, (name) => {
      if (!/\.lnk$/i.test(name)) return;
      out.push({ name: name.replace(/\.lnk$/i, ""), publisher: "", source: "start-menu" });
    });
  }
  return out;
}

export async function scanPath(io) {
  const platform = io.platform || "linux";
  const raw = io.env.PATH || io.env.Path || "";
  const dirs = String(raw).split(platform === "win32" ? ";" : ":").map((d) => d.trim()).filter(Boolean).slice(0, 40);
  const winExt = new Set([".exe", ".cmd", ".bat", ".com"]);
  const out = [];
  let seen = 0;
  for (const dir of dirs) {
    let ents = [];
    try { ents = await io.listDir(dir); } catch { continue; }
    for (const ent of ents) {
      if (seen >= 1500 || out.length >= 400) return out;
      seen += 1;
      if (!ent || ent.directory) continue;
      const file = String(ent.name || "");
      if (!file) continue;
      const ext = path.extname(file).toLowerCase();
      if (platform === "win32") {
        if (!winExt.has(ext)) continue;
      } else if (typeof io.isExecutable === "function") {
        let ok = false;
        try { ok = await io.isExecutable(path.join(dir, file)); } catch { ok = false; }
        if (!ok) continue;
      }
      out.push({ name: path.basename(file, ext), file, publisher: "", source: "path" });
    }
  }
  return out;
}

export async function scanInstalled(io) {
  const found = [];
  if ((io.platform || "") === "win32") {
    found.push(...await scanRegistry(io));
    found.push(...await scanStartMenu(io));
  }
  found.push(...await scanPath(io));
  return found;
}

export function liveIo() {
  return {
    platform: process.platform,
    env: process.env,
    regQuery(key) {
      return new Promise((resolve, reject) => {
        execFile("reg", ["query", key, "/s"], { windowsHide: true, timeout: 8000, maxBuffer: 4_000_000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(String(stdout || ""));
        });
      });
    },
    async listDir(dir) {
      const ents = await fs.readdir(dir, { withFileTypes: true });
      return ents.map((ent) => ({ name: ent.name, directory: ent.isDirectory() }));
    },
    async isExecutable(file) {
      const st = await fs.stat(file);
      return st.isFile() && (st.mode & 0o111) !== 0;
    },
  };
}
