// Really save the file a task names (0.4.21, dogfood 03 and 04): "save as index.html", "save it as campaign.md".
// The text is written to the project's folder (MindMedia) and kept there as an item. The result says where
// it went, or says plainly that nothing was saved. A card is never titled as a file unless a file exists.
import fs from "node:fs";
import path from "node:path";
import { projectMediaDir } from "./media-jobs.js";
import { saveToMindMedia, safeMediaDir } from "./project-media.js";
import { extractCodeFiles, safeFileName } from "./code-files.js";
import { fileExt, namedFile } from "./step-guard.js";
import { find as findInFolder } from "./code-source.js";
import { xlsxFromTable, docxFromMarkdown, tablesFromAnswer, documentText } from "./office-files.js";

const PREVIEW_EXT = new Set(["html", "htm"]);
const TEXT_EXT = new Set(["md", "txt", "csv", "json", "css", "js", "mjs", "xml", "svg", "py", "yml", "yaml"]);
export const MAX_FILE_CHARS = 600000;
export const NOT_SAVED_LINE = "Not saved: Meldmind can only show this code here.";

// ---- 0.4.27 (dogfood batch 1): real Excel and Word files ----
// "save it as bakery-sales.xlsx", "a Word document ... workout-plan.docx": the file is built from the tables or the
// markdown in the answer. A script that would build the file is not the file.
export const OFFICE_EXT = new Set(["xlsx", "xlsm", "docx"]);
export const NO_TABLE_LINE = "Not saved: there was no table to put in the spreadsheet.";
export const SCRIPT_ONLY_LINE = "Not saved: the answer was a script that would build the document, not the document itself.";
const OFFICE_NAMED_RE = /\b(?:save|saved|write|export|name|call|put|store|output|as|into|to|file(?:name)?|named)\b[^.\n]{0,40}?\b([A-Za-z0-9][\w-]{0,60}\.(?:xlsx|xlsm|docx))\b/i;
const OFFICE_ANY_RE = /\b([A-Za-z0-9][\w-]{0,60}\.(?:xlsx|xlsm|docx))\b/i;
/** The file a task asks for, including .xlsx, .xlsm and .docx (step-guard's namedFile does not know those). */
export function wantedFile(goal) {
  const g = String(goal || "");
  const m = OFFICE_NAMED_RE.exec(g) || OFFICE_ANY_RE.exec(g);
  return m ? m[1] : namedFile(g);
}
/** One short instruction for the step and assembler prompts when the task wants a spreadsheet or a Word file. */
export function officeNote(goal) {
  const want = wantedFile(goal);
  const ext = fileExt(want);
  if (ext === "xlsx" || ext === "xlsm") return `\nThe person wants the spreadsheet ${want}. Give the sheet as a markdown table, one row per line, header row first (it is row 1, so data starts on row 2). Write formulas as cells that start with = (for example =SUM(B2:B8)). Do not write code to build the file: Meldmind builds ${want} from your table.`;
  if (ext === "docx") return `\nThe person wants the Word document ${want}. Write the document itself in Markdown with headings, lists and tables. Do not write code to build the file: Meldmind builds ${want} from your Markdown.`;
  return "";
}

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
  const want = safeFileName(name || wantedFile(goal));
  if (!want) return null; // the task named no file: nothing to promise
  if (OFFICE_EXT.has(fileExt(want))) return saveOfficeFile({ want, text, projectId, missionId, source, status });
  // a code file is never the whole answer: with several code blocks and none named for it, nothing is guessed
  if (["js", "mjs", "cjs", "ts", "py", "json", "css", "xml", "svg", "yml", "yaml"].includes(fileExt(want)) && extractCodeFiles(text).length > 1 && !codeFor(text, want)) return { ok: false, name: want, error: NOT_SAVED_LINE };
  const body = fileBody(text, want);
  if (!body.trim()) return { ok: false, name: want, error: `Not saved: there was nothing to write to ${want}.` };
  if (body.length > MAX_FILE_CHARS) return { ok: false, name: want, error: `Not saved: ${want} is too big (${Math.round(body.length / 1000)}k characters).` };
  try {
    const pid = String(projectId || "") || "unfiled";
    const dir = safeMediaDir(pid);
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

// a spreadsheet or Word file: built from the answer, written as bytes, read back by size
function saveOfficeFile({ want, text, projectId, missionId, source, status }) {
  const ext = fileExt(want);
  const t = String(text || "");
  if (t.length > MAX_FILE_CHARS) return { ok: false, name: want, error: `Not saved: ${want} is too big (${Math.round(t.length / 1000)}k characters).` };
  let buf;
  try {
    if (ext === "docx") {
      const doc = documentText(t);
      if (!doc.text.replace(/[#*_`>|\-\s]/g, "")) return { ok: false, name: want, error: doc.scripts ? SCRIPT_ONLY_LINE : `Not saved: there was nothing to write to ${want}.` };
      buf = docxFromMarkdown(doc.text);
    } else {
      const sheets = tablesFromAnswer(t);
      if (!sheets.length) return { ok: false, name: want, error: NO_TABLE_LINE };
      buf = xlsxFromTable({ sheets }, { macro: ext === "xlsm" });
    }
  } catch (err) {
    return { ok: false, name: want, error: `Not saved: ${want} could not be built (${String(err.message || err).slice(0, 120)}).` };
  }
  try {
    const pid = String(projectId || "") || "unfiled";
    const dir = safeMediaDir(pid);
    let file = path.join(dir, want);
    if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) return { ok: false, name: want, error: `Not saved: ${want} is not a safe file name.` };
    const base = path.basename(want).replace(/\.[^.]+$/, ""), dot = path.extname(want);
    for (let n = 2; fs.existsSync(file) && n < 200; n++) file = path.join(dir, `${base}-${n}${dot}`); // never overwrite
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    const size = fs.statSync(file).size;
    const head = Buffer.alloc(2);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); }
    if (size !== buf.length || head.toString("latin1") !== "PK") return { ok: false, name: want, error: `Not saved: ${want} could not be read back after writing.` };
    let saved = null;
    try { saved = saveToMindMedia({ files: [{ name: path.basename(file), path: file }], projectId: pid, source, status, dedupeKey: missionId ? `file:${missionId}:${path.basename(file)}` : undefined }); } catch { /* the file exists; the MindMedia item is a bonus */ }
    return { ok: true, name: path.basename(file), requested: want, path: file, bytes: size, ext: fileExt(file), previewable: false, readable: false, projectId: pid, assetId: saved?.items?.[0]?.id || null, where: saved?.where || null };
  } catch (err) {
    return { ok: false, name: want, error: `Not saved: ${String(err.message || err).slice(0, 160)}` };
  }
}

// read a saved file back for the preview pane, only from inside the project media folder
// (a spreadsheet or Word file is bytes, not text: it opens in its own app, so the preview text is empty)
export function readSavedFile(info, limit = 300000) {
  if (!info?.path) return null;
  const pid = String(info.projectId || "") || "unfiled";
  const root = path.resolve(projectMediaDir(pid)) + path.sep;
  const full = path.resolve(info.path);
  if (!full.startsWith(root) || !fs.existsSync(full)) return null;
  if (OFFICE_EXT.has(fileExt(full))) return "";
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
