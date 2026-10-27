// Really save the file a task names (0.4.21, dogfood 03 and 04): "save as index.html", "save it as campaign.md".
// The text is written to the project's folder (MindMedia) and kept there as an item. The result says where
// it went, or says plainly that nothing was saved. A card is never titled as a file unless a file exists.
import fs from "node:fs";
import path from "node:path";
import { projectMediaDir } from "./media-jobs.js";
import { saveToMindMedia } from "./project-media.js";
import { extractCodeFiles, safeFileName } from "./code-files.js";
import { fileExt, namedFile } from "./step-guard.js";
import { find as findInFolder } from "./code-source.js";

const PREVIEW_EXT = new Set(["html", "htm"]);
const TEXT_EXT = new Set(["md", "txt", "csv", "json", "css", "js", "mjs", "xml", "svg", "py", "yml", "yaml"]);
export const MAX_FILE_CHARS = 600000;
export const NOT_SAVED_LINE = "Not saved: Meldmind can only show this code here.";

// the body of the file out of a deliverable: a whole html document, the matching code block, or the text itself
export function fileBody(text, name) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const ext = fileExt(name);
  const blocks = extractCodeFiles(t);
  const same = blocks.find((b) => b.name.toLowerCase() === name.toLowerCase());
  if (same) return same.text;
  if (PREVIEW_EXT.has(ext)) {
    const html = blocks.find((b) => b.lang === "html" || /<html[\s>]|<!doctype html/i.test(b.text));
    if (html) return html.text;
    const m = /(<!doctype html[\s\S]*?<\/html\s*>|<html[\s\S]*?<\/html\s*>)/i.exec(t);
    if (m) return m[1].trim() + "\n";
    const open = /<!doctype html[\s\S]*$|<html[\s\S]*$/i.exec(t);
    if (open) return open[0].trim() + "\n";
  } else if (blocks.length === 1 && ["css", "js", "mjs", "json", "py", "xml", "svg", "yml", "yaml"].includes(ext)) {
    return blocks[0].text;
  }
  // a text or markdown file is the deliverable itself, minus a single wrapping fence
  const wrapped = /^\s*```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/.exec(t);
  return (wrapped ? wrapped[1] : t).trim() + "\n";
}

/**
 * Write the file. Returns { ok, name, path, bytes, previewable, ext, assetId, projectId, where } or
 * { ok: false, name, error } when the write failed or there was nothing to write.
 */
export function saveNamedFile({ goal = "", name, text, projectId = "", missionId = "", source = "Mission", status = "Draft" } = {}) {
  const want = safeFileName(name || namedFile(goal));
  if (!want) return null; // the task named no file: nothing to promise
  // a code file is never the whole answer: with several code blocks and none named for it, nothing is guessed
  if (["js", "mjs", "cjs", "ts", "py", "json", "css", "xml", "svg", "yml", "yaml"].includes(fileExt(want)) && extractCodeFiles(text).length > 1 && !codeFor(text, want)) return { ok: false, name: want, error: NOT_SAVED_LINE };
  const body = fileBody(text, want);
  if (!body.trim()) return { ok: false, name: want, error: `Not saved: there was nothing to write to ${want}.` };
  if (body.length > MAX_FILE_CHARS) return { ok: false, name: want, error: `Not saved: ${want} is too big (${Math.round(body.length / 1000)}k characters).` };
  try {
    const pid = String(projectId || "") || "unfiled";
    const dir = projectMediaDir(pid);
    let file = path.join(dir, want);
    if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) return { ok: false, name: want, error: `Not saved: ${want} is not a safe file name.` };
    // never overwrite another run's file: name-2.html, name-3.html
    const base = path.basename(want).replace(/\.[^.]+$/, ""), ext = path.extname(want);
    for (let n = 2; fs.existsSync(file) && n < 200; n++) file = path.join(dir, `${base}-${n}${ext}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
    const check = fs.readFileSync(file, "utf8");
    if (check !== body) return { ok: false, name: want, error: `Not saved: ${want} could not be read back after writing.` };
    let saved = null;
    try { saved = saveToMindMedia({ files: [{ name: path.basename(file), path: file }], projectId: pid, source, status, dedupeKey: missionId ? `file:${missionId}:${path.basename(file)}` : undefined }); } catch { /* the file exists; the MindMedia item is a bonus */ }
    const e = fileExt(file);
    return { ok: true, name: path.basename(file), requested: want, path: file, bytes: Buffer.byteLength(body), ext: e, previewable: PREVIEW_EXT.has(e), readable: PREVIEW_EXT.has(e) || TEXT_EXT.has(e), projectId: pid, assetId: saved?.items?.[0]?.id || null, where: saved?.where || null };
  } catch (err) {
    return { ok: false, name: want, error: `Not saved: ${String(err.message || err).slice(0, 160)}` };
  }
}

// read a saved file back for the preview pane, only from inside the project media folder
export function readSavedFile(info, limit = 300000) {
  if (!info?.path) return null;
  const pid = String(info.projectId || "") || "unfiled";
  const root = path.resolve(projectMediaDir(pid)) + path.sep;
  const full = path.resolve(info.path);
  if (!full.startsWith(root) || !fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8").slice(0, limit);
}

// ---- code steps: write into the person's own project folder (0.4.21, dogfood 12) ----
// "save in place as cronwords.js", "add cronwords.test.js": the code block goes to that path inside the project folder,
// is read back, and the caller records it as a write_file tool call. Never outside the folder.
const CODE_WRITE_EXT = new Set(["js", "mjs", "cjs", "json", "py", "css", "html", "htm", "ts", "md", "txt", "yml", "yaml", "xml", "svg", "csv"]);
export const isWritableName = (n) => CODE_WRITE_EXT.has(fileExt(n));

/** The code that belongs in `name` out of a step's output, or "" when there is no clear block for it. */
export function codeFor(text, name, { onlyName = false } = {}) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const blocks = extractCodeFiles(t);
  const low = String(name).toLowerCase();
  const same = blocks.find((b) => b.name.toLowerCase() === low || b.name.toLowerCase().endsWith("/" + low));
  if (same) return same.text;
  if (onlyName && blocks.length === 1) return blocks[0].text;
  return "";
}

/** A path inside root, or null when it climbs out (../), is absolute, or has a drive or odd characters. */
export function insideFolder(root, rel) {
  const r = String(rel || "").replace(/\\/g, "/").trim();
  if (!r || path.isAbsolute(r) || /^[a-z]:/i.test(r) || r.startsWith("~") || r.split("/").includes("..") || /[\0<>|*?"]/.test(r)) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, r);
  return full.startsWith(base + path.sep) ? full : null;
}

/**
 * Write `text` to `name` inside one of the project folders. An existing file of that name (found in the folder) is
 * replaced in place; a new one goes to the folder's top. Returns { ok, name, path, bytes, folder, existed, before } or
 * { ok: false, name, error }. `before` is the old text, for the export check.
 */
export function writeProjectFile({ folders = [], name, text } = {}) {
  const want = String(name || "").replace(/\\/g, "/").trim();
  if (!want) return { ok: false, name: "", error: "Not saved: no file name." };
  if (!folders.length) return { ok: false, name: want, error: NOT_SAVED_LINE };
  if (!String(text || "").trim()) return { ok: false, name: want, error: `Not saved: there was nothing to write to ${want}.` };
  if (String(text).length > MAX_FILE_CHARS) return { ok: false, name: want, error: `Not saved: ${want} is too big.` };
  const outside = { ok: false, name: want, error: `Not saved: ${want} is outside your project folder.` };
  try {
    let target = null, folder = null, existed = false;
    for (const root of folders) {
      if (!insideFolder(root, want)) return outside;
      let hit = null;
      try { hit = findInFolder(path.resolve(root), want); } catch { hit = null; }
      if (hit) { target = hit; folder = path.resolve(root); existed = true; break; }
    }
    if (!target) { folder = path.resolve(folders[0]); target = insideFolder(folder, want); }
    if (!target || !target.startsWith(folder + path.sep)) return outside;
    if (/(^|[\\/])(\.env[\w.]*|id_rsa[\w.]*|.*\.(pem|key|p12|pfx)|vault\.bin)$/i.test(target)) return { ok: false, name: want, error: `Not saved: ${want} is a private file.` };
    const before = existed ? fs.readFileSync(target, "utf8") : null;
    const body = String(text).replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf8");
    if (fs.readFileSync(target, "utf8") !== body) return { ok: false, name: want, error: `Not saved: ${want} could not be read back after writing.` };
    return { ok: true, name: want, path: target, bytes: Buffer.byteLength(body), folder, existed, before };
  } catch (err) {
    return { ok: false, name: want, error: `Not saved: ${String(err.message || err).slice(0, 160)}` };
  }
}
