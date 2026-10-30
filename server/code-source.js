// Code tasks must read the code (0.4.21, dogfood 01): when a task names a file ("fix the parser in server/fallback.js",
// "lines 40 to 60 of app.js") and the project's folder on this PC is known, that file (or the named lines) is attached
// to every worker, so nobody writes a "patch" for code they never saw. No file found: the task says so instead.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listProjects } from "./projects.js";

const CODE_EXT = "js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|cs|cpp|c|h|php|swift|sql|sh|ps1|json|yml|yaml|toml|html|css|md|txt";
// 0.4.27 (dogfood batch 2): data and script files a task names (invoices.csv, backup.bat, run.cmd) are named files too
const NAME_EXT = `${CODE_EXT}|csv|bat|cmd|htm|xml|svg`;
const NAME_RE = new RegExp(`(?<![\\w/.\\\\-])((?:[\\w.-]+[\\\\/])*[\\w.-]+\\.(?:${NAME_EXT}))\\b`, "gi");
const SECRET = /(^|[\\/])(\.env[\w.]*|id_rsa[\w.]*|.*\.(pem|key|p12|pfx)|.*secret.*|.*credential.*|vault\.bin)$/i;
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", "release", "data"]);
export const MAX_BYTES = 200_000, MAX_CHARS = 24_000;

// the file names a task mentions, without web addresses
export function namedSources(goal) {
  const text = String(goal || "").replace(/https?:\/\/\S+/gi, " ").replace(/\b[\w-]+@[\w.-]+\.\w+\b/g, " ")
    .replace(/[a-zA-Z]:[\\/](?:[^\\/:*?"<>|\r\n`'\s]+[\\/])*(?=[^\\/:*?"<>|\r\n`'\s]+\.\w)/g, " "); // the folder part of a full path
  const out = [];
  for (const m of text.matchAll(NAME_RE)) {
    const n = m[1].replace(/\\/g, "/");
    // 0.4.23.1: "Node.js", "Next.js" and the like are products, not files ("Node.js was not found on disk")
    if (/^(?:\d+\.)+\d+$/.test(n) || /^(?:e\.g|i\.e|etc)\./i.test(n) || /^(?:node|next|nuxt|vue|react|express|three|d3|chart|p5|socket|alpine|ember|backbone|jquery|angular|nest|deno|bun|electron|svelte|astro|remix|gatsby|meteor)\.(?:js|ts)$/i.test(n) || out.includes(n)) continue;
    out.push(n);
    if (out.length >= 4) break;
  }
  return out;
}
// 0.4.23.1: a full path typed in the task ("C:\work\app\cronwords.js") is the person's own permission to use that one folder.
// Only an existing folder, never a system or secret place, never Meldmind's own data.
const PATH_RE = new RegExp(`(?<![\\w])([a-zA-Z]:[\\\\/](?:[^\\\\/:*?"<>|\\r\\n\`'\\s]+[\\\\/])*[^\\\\/:*?"<>|\\r\\n\`'\\s]+\\.(?:${CODE_EXT}))(?![\\w])`, "g");
const DENY_DIR = /(^|[\\/])(windows|program files|program files \(x86\)|programdata|\.ssh|\.aws|\.gnupg|appdata|data|node_modules|\.git)([\\/]|$)/i;
export function namedPaths(goal) {
  const text = String(goal || "").replace(/https?:\/\/\S+/gi, " ");
  const out = [];
  for (const m of text.matchAll(PATH_RE)) {
    const full = path.resolve(m[1]);
    const dir = path.dirname(full);
    const tmp = path.resolve(os.tmpdir());
    const rel = dir.toLowerCase().startsWith(tmp.toLowerCase()) ? dir.slice(tmp.length) : dir.slice(path.parse(dir).root.length); // the temp folder lives under AppData
    if (DENY_DIR.test(rel) || SECRET.test(full)) continue;
    if (!out.some((o) => o.full === full)) out.push({ full, dir, name: path.basename(full) });
    if (out.length >= 4) break;
  }
  return out;
}
/** Existing folders the task names by full path. */
export function namedFolders(goal) {
  const dirs = [];
  for (const n of namedPaths(goal)) { try { if (fs.statSync(n.dir).isDirectory() && !dirs.includes(n.dir)) dirs.push(n.dir); } catch { /* not a folder here */ } }
  return dirs;
}
// "lines 40 to 60", "line 12", "L40-L60"
export function namedLines(goal) {
  const m = /\blines?\s+(\d{1,6})\s*(?:to|-|through|and)\s*(\d{1,6})\b/i.exec(String(goal || "")) || /\bL(\d{1,6})\s*-\s*L?(\d{1,6})\b/.exec(String(goal || ""));
  if (m) { const a = Number(m[1]), b = Number(m[2]); return a <= b ? [a, b] : [b, a]; }
  const one = /\bline\s+(\d{1,6})\b/i.exec(String(goal || ""));
  return one ? [Number(one[1]), Number(one[1])] : null;
}

// folders on this PC that the project's links point at
export function projectFolders(projectId, projects = null) {
  const list = projects || (() => { try { return listProjects() || []; } catch { return []; } })();
  const pick = projectId ? list.filter((p) => p.id === projectId) : list;
  const out = [];
  for (const p of pick) for (const c of p.categories || []) for (const l of c.links || []) {
    const u = String(l?.url || "");
    let dir = "";
    if (/^[a-z]:[\\/]/i.test(u) || u.startsWith("/")) dir = u;
    else if (u.startsWith("file:///")) { try { dir = decodeURIComponent(new URL(u).pathname).replace(/^\/([a-z]:)/i, "$1"); } catch { /* not a path */ } }
    if (dir) { try { if (fs.statSync(dir).isDirectory()) out.push(path.resolve(dir)); } catch { /* not a folder on this PC */ } }
  }
  return [...new Set(out)];
}

export function find(root, rel, depth = 4) {
  const direct = path.resolve(root, rel);
  if (direct.startsWith(root + path.sep) && fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  if (rel.includes("/")) return null;
  const queue = [[root, 0]];
  while (queue.length) {
    const [dir, d] = queue.shift();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isFile() && e.name.toLowerCase() === rel.toLowerCase()) return path.join(dir, e.name);
      if (e.isDirectory() && d < depth && !SKIP_DIR.has(e.name) && !e.name.startsWith(".")) queue.push([path.join(dir, e.name), d + 1]);
    }
  }
  return null;
}

/** [{ name, path, text, from, to, truncated }] for every named file that is in a known project folder. */
export function attachSources(goal, { projectId = null, folders = null, lines = null } = {}) {
  const dirs = folders || projectFolders(projectId);
  if (!dirs.length) return [];
  const range = lines || namedLines(goal);
  const found = [];
  for (const name of namedSources(goal)) {
    for (const root of dirs) {
      let file = null;
      try { file = find(root, name); } catch { file = null; }
      if (!file || SECRET.test(file)) continue;
      try {
        const st = fs.statSync(file);
        if (st.size > MAX_BYTES * 5) continue;
        let text = fs.readFileSync(file, "utf8");
        let from = 1, to = text.split("\n").length, truncated = false;
        if (range) {
          const all = text.split("\n");
          from = Math.max(1, range[0] - 20); to = Math.min(all.length, range[1] + 20);
          text = all.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join("\n");
        }
        if (text.length > MAX_CHARS) { text = text.slice(0, MAX_CHARS); truncated = true; }
        found.push({ name, path: file, text, from, to, truncated });
      } catch { /* unreadable: skipped */ }
      break;
    }
  }
  return found;
}

export function sourceBlock(files, missing = []) {
  const parts = files.map((f) => `ATTACHED FILE ${f.name}${f.from > 1 || f.truncated ? ` (lines ${f.from} to ${f.to}${f.truncated ? ", cut at " + MAX_CHARS + " characters" : ""})` : ""}:\n\`\`\`\n${f.text}\n\`\`\``);
  if (files.length) parts.push("Work only from the attached code. Do not invent code, names or signatures that are not shown. If something you need is not in it, say what is missing.");
  if (missing.length) parts.push(`NOT ATTACHED: ${missing.join(", ")} (not found in the project folder). Do not write a patch for it; say you have not seen it.`);
  return parts.join("\n\n");
}
