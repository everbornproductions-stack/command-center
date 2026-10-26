// Really save the file a task names (0.4.21, dogfood 03 and 04): "save as index.html", "save it as campaign.md".
// The text is written to the project's folder (MindMedia) and kept there as an item. The result says where
// it went, or says plainly that nothing was saved. A card is never titled as a file unless a file exists.
import fs from "node:fs";
import path from "node:path";
import { projectMediaDir } from "./media-jobs.js";
import { saveToMindMedia } from "./project-media.js";
import { extractCodeFiles, safeFileName } from "./code-files.js";
import { fileExt, namedFile } from "./step-guard.js";

const PREVIEW_EXT = new Set(["html", "htm"]);
const TEXT_EXT = new Set(["md", "txt", "csv", "json", "css", "js", "mjs", "xml", "svg", "py", "yml", "yaml"]);
export const MAX_FILE_CHARS = 600000;

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
