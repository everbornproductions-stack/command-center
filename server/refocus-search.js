// Refocus search: the query words, the places on this PC to look, and the scoring.
// Read only. Nothing here sends anything anywhere. The roots are computed from an injectable
// home folder, environment, and drive list, so tests run against a temp folder and never the
// real home. The app's own data folder is never walked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VIDEO = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "wmv", "mpg", "mpeg"]);
export const AUDIO = new Set(["mp3", "wav", "m4a", "flac", "aac", "ogg", "opus", "wma", "aiff"]);
export const DOCS = new Set(["pdf", "docx", "doc", "txt", "md", "csv", "xlsx", "xls", "pptx", "rtf", "json", "html", "htm", "odt"]);
export const IMAGES = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "tif", "tiff", "svg"]);
export const TEXT = new Set(["txt", "md", "csv", "json", "html", "htm"]);
const KNOWN = new Set([...VIDEO, ...AUDIO, ...DOCS, ...IMAGES]);

export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "$recycle.bin", "system volume information", "windows", "program files",
  "program files (x86)", "programdata", "appdata", "recovery", "perflogs", "msocache", "$windows.~bt", "$windows.~ws",
  "library", "applications", "system", "private", "proc", "sys", "dev", "__pycache__", ".cache", ".venv", "venv",
  ".npm", ".nuget", ".gradle", ".cargo", ".rustup", "everborn command", "temp", "tmp",
]);

const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "my", "in", "on", "to", "with", "about", "from", "all", "any", "me", "find", "show", "files", "file", "stuff", "things"]);

// Category words. A word on the left also matches these name words and these file types.
const MEDIA_WORDS = ["music", "video", "videos", "song", "songs", "mv", "lyric", "lyrics", "clip", "clips"];
const EXPAND = {
  video: { words: MEDIA_WORDS, types: ["video"] },
  videos: { words: MEDIA_WORDS, types: ["video"] },
  music: { words: MEDIA_WORDS, types: ["audio", "video"] },
  song: { words: MEDIA_WORDS, types: ["audio", "video"] },
  songs: { words: MEDIA_WORDS, types: ["audio", "video"] },
  audio: { words: ["audio", "song", "songs", "music", "track"], types: ["audio"] },
  photo: { words: ["photo", "photos", "image", "images", "picture", "pictures", "img"], types: ["image"] },
  photos: { words: ["photo", "photos", "image", "images", "picture", "pictures", "img"], types: ["image"] },
  image: { words: ["photo", "photos", "image", "images", "picture", "pictures", "img"], types: ["image"] },
  images: { words: ["photo", "photos", "image", "images", "picture", "pictures", "img"], types: ["image"] },
  pictures: { words: ["photo", "photos", "image", "images", "picture", "pictures", "img"], types: ["image"] },
  billing: { words: ["billing", "invoice", "invoices", "receipt", "receipts", "payment", "payments", "square", "highlevel", "subscription", "subscriptions"], types: [] },
  invoice: { words: ["billing", "invoice", "invoices", "receipt", "receipts", "payment", "payments"], types: [] },
  invoices: { words: ["billing", "invoice", "invoices", "receipt", "receipts", "payment", "payments"], types: [] },
  docs: { words: ["doc", "docs", "document", "documents"], types: ["doc"] },
  documents: { words: ["doc", "docs", "document", "documents"], types: ["doc"] },
};

export function typeOf(name) {
  const ext = String(name || "").toLowerCase().split(".").pop();
  if (!ext || ext === String(name || "").toLowerCase()) return "other";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (IMAGES.has(ext)) return "image";
  if (DOCS.has(ext)) return "doc";
  return "other";
}

export function wordsIn(s) {
  return String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// The query as groups. Each group is one typed word plus the words and file types it stands for.
export function expandQuery(topic) {
  const raw = wordsIn(topic);
  let tokens = raw.filter((w) => !STOP.has(w));
  if (!tokens.length) tokens = raw;
  tokens = [...new Set(tokens)].slice(0, 12);
  return tokens.map((t) => {
    const e = EXPAND[t];
    const alts = new Set([t, ...(e?.words || [])]);
    if (t.length > 4 && t.endsWith("s")) alts.add(t.slice(0, -1));
    return { word: t, alts: [...alts], types: e?.types || [] };
  });
}

function hits(alt, words, joined) {
  if (alt.length <= 3) return words.has(alt);
  return joined.includes(alt);
}

// Score one thing. name and folders are text, kind is the file type ("video", "doc", ...).
// The result says how many query words matched and a score for ranking.
export function scoreFields({ name = "", folders = "", text = "", kind = "" } = {}, groups) {
  const fields = [
    { w: 5, s: name }, { w: 3, s: folders }, { w: 1, s: text },
  ].map((f) => ({ w: f.w, words: new Set(wordsIn(f.s)), joined: String(f.s || "").toLowerCase().replace(/[^a-z0-9]+/g, "") + " " + String(f.s || "").toLowerCase() }));
  let matched = 0;
  let score = 0;
  for (const g of groups || []) {
    let best = 0;
    for (const f of fields) {
      if (hits(g.word, f.words, f.joined)) { best = Math.max(best, f.w * 2); continue; }
      if (g.alts.some((a) => hits(a, f.words, f.joined))) best = Math.max(best, f.w);
    }
    if (!best && kind && g.types.includes(kind)) best = 2;
    if (best) { matched++; score += best; }
  }
  return { matched, score: matched ? score + matched * 10 : 0 };
}

// ---------- roots ----------
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function list(p) { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } }

export function defaultDrives(platform = process.platform) {
  if (platform === "win32") {
    const out = [];
    for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ":\\"; if (isDir(d)) out.push(d); }
    return out;
  }
  if (platform === "darwin") return list("/Volumes").map((n) => path.join("/Volumes", n));
  return [];
}

// Every place Refocus looks on this PC. Each root: { path, label, madeBy, kind }.
export function localRoots({ home, env = process.env, drives, platform = process.platform, projectDirs = [], wide = false } = {}) {
  const h = home || env.CC_REFOCUS_HOME || os.homedir();
  const driveList = drives || (env.CC_REFOCUS_DRIVES !== undefined ? String(env.CC_REFOCUS_DRIVES).split(/[;,]/).map((s) => s.trim()).filter(Boolean) : defaultDrives(platform));
  const out = [];
  const seen = new Set();
  const add = (p, label, kind = "folder", madeBy = "This PC") => {
    if (!p) return;
    const key = path.resolve(p).toLowerCase();
    if (seen.has(key) || !isDir(p)) return;
    seen.add(key);
    out.push({ path: path.resolve(p), label, kind, madeBy });
  };
  for (const n of ["Videos", "Downloads", "Desktop", "Documents", "Music", "Pictures", "Movies"]) add(path.join(h, n), n);
  for (const n of list(h)) {
    if (/^onedrive( - .+)?$/i.test(n)) add(path.join(h, n), n, "cloud");
    if (/^google ?drive$/i.test(n) || /^googledrive-/i.test(n)) add(path.join(h, n), "Google Drive", "cloud");
    if (/^claude/i.test(n)) add(path.join(h, n), n, "ai", "Claude");
  }
  for (const k of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) if (env[k]) add(env[k], path.basename(env[k]) || "OneDrive", "cloud");
  for (const n of list(path.join(h, "Library", "CloudStorage"))) if (/^googledrive-|^onedrive/i.test(n)) add(path.join(h, "Library", "CloudStorage", n), /^google/i.test(n) ? "Google Drive" : "OneDrive", "cloud");
  for (const n of list(path.join(h, "Documents"))) if (/^claude/i.test(n)) add(path.join(h, "Documents", n), `Documents/${n}`, "ai", "Claude");
  for (const d of driveList) {
    for (const n of ["My Drive", "Shared drives", "Other computers"]) add(path.join(d, n), `Google Drive (${d.replace(/[\\/]+$/, "")} ${n})`, "cloud");
    if (wide) add(d, `Drive ${d.replace(/[\\/]+$/, "")}`, "drive");
  }
  for (const p of projectDirs) add(p, `Project folder ${path.basename(p)}`, "project");
  for (const p of String(env.CC_REFOCUS_ROOTS || "").split(path.delimiter).map((s) => s.trim()).filter(Boolean)) add(p, path.basename(p), "folder");
  if (wide) add(h, "Home folder", "folder");
  return out;
}

export function claudeSessionDirs({ home, env = process.env } = {}) {
  const h = home || env.CC_REFOCUS_HOME || os.homedir();
  return [path.join(h, ".claude", "projects")].filter(isDir);
}

// ---------- walking ----------
function inside(child, parent) {
  if (!parent) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function textOf(file, max) {
  try {
    const st = fs.statSync(file);
    if (st.size > max) return "";
    return fs.readFileSync(file, "utf8").replace(/<[^>]+>/g, " ").slice(0, max);
  } catch { return ""; }
}

// Walk the roots and score every file and folder name. Bounded by depth, entries, and time.
export async function searchFiles({ topic, roots, wide = false, dataDir = null, limits = {} } = {}) {
  const groups = expandQuery(topic);
  const maxDepth = limits.depth ?? (wide ? 8 : 5);
  const maxEntries = limits.entries ?? (wide ? 150000 : 40000);
  const textMax = limits.textBytes ?? 256 * 1024;
  const deadline = Date.now() + (limits.ms ?? (wide ? 25000 : 10000));
  const anyType = wide;
  const items = [];
  const searched = [];
  let budget = maxEntries;
  const rootSet = new Set((roots || []).map((r) => path.resolve(r.path).toLowerCase()));
  for (const root of roots || []) {
    const row = { place: root.label, path: root.path, kind: root.kind, madeBy: root.madeBy, scanned: 0, count: 0, error: null };
    searched.push(row);
    const stack = [{ dir: root.path, depth: 0 }];
    while (stack.length) {
      if (budget <= 0 || Date.now() > deadline) { row.error = row.error || "stopped early (search limit reached)"; break; }
      const { dir, depth } = stack.pop();
      if (dataDir && inside(dir, dataDir)) continue;
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
      catch (e) { if (depth === 0) row.error = e.code || e.message; continue; }
      for (const ent of entries) {
        if (budget-- <= 0) break;
        row.scanned++;
        const full = path.join(dir, ent.name);
        const rel = path.relative(root.path, dir);
        const folders = `${root.label} ${rel}`;
        if (ent.isDirectory()) {
          const low = ent.name.toLowerCase();
          if (SKIP_DIRS.has(low) || low.startsWith(".") || low.startsWith("$")) continue;
          if (dataDir && inside(full, dataDir)) continue;
          const s = scoreFields({ name: ent.name, folders: rel }, groups);
          if (s.matched) items.push(fileItem({ full, name: ent.name, root, rel, isFolder: true, score: s }));
          // a folder that is its own root (Documents/Claude, a project folder) is walked once, as that root
          if (depth + 1 <= maxDepth && !rootSet.has(path.resolve(full).toLowerCase())) stack.push({ dir: full, depth: depth + 1 });
          continue;
        }
        if (!ent.isFile()) continue;
        const kind = typeOf(ent.name);
        const ext = ent.name.toLowerCase().split(".").pop();
        if (!anyType && !KNOWN.has(ext)) continue;
        let text = "";
        let s = scoreFields({ name: ent.name, folders, kind }, groups);
        if (TEXT.has(ext) && s.matched < groups.length) {
          text = textOf(full, textMax);
          if (text) s = scoreFields({ name: ent.name, folders, kind, text }, groups);
        }
        if (s.matched) items.push(fileItem({ full, name: ent.name, root, rel, kind, text, score: s }));
      }
    }
  }
  for (const r of searched) r.count = items.filter((i) => i.rootPath === r.path).length;
  return { items, searched, groups };
}

function fileItem({ full, name, root, rel, isFolder = false, kind = "folder", text = "", score }) {
  let date = 0;
  try { date = fs.statSync(full).mtimeMs; } catch { date = 0; }
  const where = rel ? `${root.label}/${rel.split(path.sep).join("/")}` : root.label;
  return {
    id: `pc:${full}`,
    title: name,
    text: text ? text.slice(0, 2000) : `${name} in ${where}`,
    summary: isFolder ? `Folder in ${where}` : `${kind === "other" ? "File" : kind[0].toUpperCase() + kind.slice(1)} in ${where}`,
    status: "done",
    date: Math.round(date),
    source: root.madeBy === "This PC" ? "This PC" : root.madeBy,
    sourceKind: root.madeBy === "Claude" ? "claude-folder" : "pc-file",
    madeBy: root.madeBy,
    path: full,
    where,
    fileType: isFolder ? "folder" : kind,
    rootPath: root.path,
    score: score.score,
    matched: score.matched,
  };
}

// Claude Code session transcripts (~/.claude/projects/**/*.jsonl). Only the message text is read.
export async function searchClaudeSessions({ topic, dirs, limits = {} } = {}) {
  const groups = expandQuery(topic);
  const maxFiles = limits.files ?? 400;
  const maxBytes = limits.bytes ?? 2 * 1024 * 1024;
  const items = [];
  const searched = [];
  for (const dir of dirs || []) {
    const row = { place: "Claude Code sessions", path: dir, kind: "ai", madeBy: "Claude", scanned: 0, count: 0, error: null };
    searched.push(row);
    const stack = [{ d: dir, depth: 0 }];
    while (stack.length && row.scanned < maxFiles) {
      const { d, depth } = stack.pop();
      let entries;
      try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { if (depth === 0) row.error = e.code || e.message; continue; }
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory() && depth < 3) { stack.push({ d: full, depth: depth + 1 }); continue; }
        if (!ent.isFile() || !/\.(jsonl|json|md)$/i.test(ent.name)) continue;
        if (row.scanned++ >= maxFiles) break;
        const session = readSession(full, maxBytes);
        if (!session.text) continue;
        const project = path.basename(path.dirname(full));
        const s = scoreFields({ name: session.title, folders: project, text: session.text }, groups);
        if (!s.matched) continue;
        let date = 0;
        try { date = fs.statSync(full).mtimeMs; } catch { date = 0; }
        items.push({
          id: `claude-session:${full}`, title: session.title || ent.name, text: session.text.slice(0, 4000),
          status: "done", date: Math.round(date), source: "Claude", sourceKind: "claude-session", madeBy: "Claude",
          path: full, where: `Claude Code session (${project})`, fileType: "chat", score: s.score, matched: s.matched,
        });
        row.count++;
      }
    }
  }
  return { items, searched };
}

function partsText(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text || "" : "")).join("\n");
  return "";
}

export function readSession(file, maxBytes = 2 * 1024 * 1024) {
  let raw = "";
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, fs.fstatSync(fd).size));
      fs.readSync(fd, buf, 0, buf.length, 0);
      raw = buf.toString("utf8");
    } finally { fs.closeSync(fd); }
  } catch { return { title: "", text: "" }; }
  if (!/\.jsonl$/i.test(file)) return { title: path.basename(file), text: raw };
  let title = "";
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === "summary" && j.summary && !title) title = String(j.summary);
    const t = partsText(j.message?.content ?? j.content ?? j.text);
    if (t) {
      if (!title && (j.message?.role === "user" || j.type === "user")) title = t.replace(/\s+/g, " ").slice(0, 100);
      out.push(t);
    }
  }
  return { title, text: out.join("\n") };
}

// Rank by how many query words matched, then score, then newest first.
export function rank(items) {
  return [...(items || [])].sort((a, b) => (b.matched || 0) - (a.matched || 0) || (b.score || 0) - (a.score || 0) || (Number(b.date) || 0) - (Number(a.date) || 0));
}
