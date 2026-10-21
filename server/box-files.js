// Files that stay on this computer. Idea notes and marching orders may name them.
// The bytes are not posted with a suggestion. Downloads are attachments, never a page.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./paths.js";
import { scrubText } from "./prompts/safety.js";

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
export const MAX_FILES = 4;
// A 12 MB video is about 16.8 MB of base64, plus the JSON wrapper.
const MAX_B64 = 18_000_000;
const MAX_PENDING = 20;
const PREVIEW_CHARS = 4000;

const SECRET = /password|passphrase|social security|\bssn\b|api[_ -]?key|secret key|bearer /i;
const FILE_ID = /^f_[a-f0-9]{12}$/;
const IDEA_ID = /^sg_[a-f0-9]{12}$/;
const EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const fail = (status, message) => Object.assign(new Error(message), { status });

export function assertNoSecret(value) {
  const clean = String(value ?? "");
  if (SECRET.test(clean)) throw fail(400, "Do not include a password, an SSN, or a key.");
  const scrubbed = scrubText(clean);
  if (scrubbed.redacted.length) throw fail(400, "Do not include a password, an SSN, or an account number.");
  return scrubbed.text;
}

export function safeName(raw) {
  const base = path.basename(String(raw || "file")).replace(/[\u0000-\u001f]/g, "").trim();
  const clean = base.replace(/[^\w. ()-]+/g, "_").slice(0, 80);
  if (!clean || clean === "." || clean === "..") return "file";
  return clean;
}

function extOf(name) {
  return path.extname(safeName(name)).slice(1).toLowerCase();
}

function starts(buf, bytes) {
  return buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
}

export function classifyFile(name, buf) {
  const ext = extOf(name);
  const mime = EXT[ext];
  if (!mime) throw fail(400, "That file type is not allowed. Use an image, a video, a PDF, a text file, or a Word document.");
  if (ext === "png" && !starts(buf, [0x89, 0x50, 0x4e, 0x47])) throw fail(400, "That image could not be read.");
  if ((ext === "jpg" || ext === "jpeg") && !starts(buf, [0xff, 0xd8, 0xff])) throw fail(400, "That image could not be read.");
  if (ext === "gif") {
    const mark = buf.slice(0, 6).toString("ascii");
    if (mark !== "GIF87a" && mark !== "GIF89a") throw fail(400, "That image could not be read.");
  }
  if (ext === "webp" && !(buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP")) {
    throw fail(400, "That image could not be read.");
  }
  if (ext === "webm" && !starts(buf, [0x1a, 0x45, 0xdf, 0xa3])) throw fail(400, "That video could not be read.");
  if ((ext === "mp4" || ext === "mov") && buf.slice(4, 8).toString("ascii") !== "ftyp") throw fail(400, "That video could not be read.");
  if (ext === "pdf" && buf.slice(0, 4).toString("ascii") !== "%PDF") throw fail(400, "That PDF could not be read.");
  if (ext === "doc" && !starts(buf, [0xd0, 0xcf, 0x11, 0xe0])) throw fail(400, "That document could not be read.");
  if (ext === "docx" && !starts(buf, [0x50, 0x4b, 0x03, 0x04])) throw fail(400, "That document could not be read.");
  if (mime.startsWith("text/")) {
    if (buf.includes(0)) throw fail(400, "That file type is not allowed.");
    const text = buf.toString("utf8");
    if (/<\s*(script|html|iframe)\b/i.test(text)) throw fail(400, "That file type is not allowed.");
    return { name: safeName(name), mime, kind: "text", text };
  }
  if (mime.startsWith("video/")) return { name: safeName(name), mime, kind: "video", text: "" };
  if (mime.startsWith("image/")) return { name: safeName(name), mime, kind: "image", text: "" };
  return { name: safeName(name), mime, kind: "bin", text: "" };
}

export function limitForName(name) {
  const ext = extOf(name);
  if (ext === "mp4" || ext === "webm" || ext === "mov") {
    return { max: MAX_VIDEO_BYTES, message: "That video is over 12 MB. Trim it shorter first." };
  }
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif") {
    return { max: MAX_IMAGE_BYTES, message: "That picture is over 8 MB. Make it smaller first." };
  }
  return { max: MAX_FILE_BYTES, message: "That file is over 4 MB." };
}

export function decodeUpload(body) {
  const raw = String(body?.data || "");
  if (!raw) throw fail(400, "Choose a file first.");
  const limit = limitForName(body?.name);
  if (raw.length > MAX_B64) throw fail(400, limit.message);
  let buf;
  try { buf = Buffer.from(raw, "base64"); } catch { throw fail(400, "That file could not be read."); }
  const info = classifyFile(body?.name, buf);
  const sized = info.kind === "video" || info.kind === "image" ? limit : limitForName("notes.txt");
  if (!buf.length || buf.length > sized.max) throw fail(400, sized.message);
  return { ...info, buf };
}

function describe(info) {
  const named = assertNoSecret(info.name);
  if (info.kind === "text") {
    const text = assertNoSecret(info.text).trim();
    const preview = text.slice(0, PREVIEW_CHARS);
    const note = preview.length < text.length
      ? `From ${named}:\n${preview}\nThe rest of the file stays on this computer.`
      : `From ${named}:\n${preview}`;
    return { name: named, mime: info.mime, kind: info.kind, note };
  }
  return {
    name: named,
    mime: info.mime,
    kind: info.kind,
    note: `Attached: ${named}. The file stays on this computer.`,
  };
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pendingDir() {
  return ensure(path.join(DATA_DIR, "idea-files", "pending"));
}

function ideaDir(ideaId) {
  if (!IDEA_ID.test(String(ideaId || ""))) throw fail(404, "That idea is not on this computer.");
  return ensure(path.join(DATA_DIR, "idea-files", "ideas", ideaId));
}

function orderDir() {
  return ensure(path.join(DATA_DIR, "order-files"));
}

function fileIdOk(id) {
  if (!FILE_ID.test(String(id || ""))) throw fail(404, "That file is not on this computer.");
  return id;
}

function writePair(dir, meta, buf) {
  fs.writeFileSync(path.join(dir, `${meta.id}.bin`), buf);
  fs.writeFileSync(path.join(dir, `${meta.id}.json`), JSON.stringify(meta));
}

function readPair(dir, id) {
  fileIdOk(id);
  const metaPath = path.join(dir, `${id}.json`);
  const binPath = path.join(dir, `${id}.bin`);
  if (!fs.existsSync(metaPath) || !fs.existsSync(binPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const buf = fs.readFileSync(binPath);
  return { ...meta, buf };
}

function movePair(from, to, id) {
  for (const ext of [".bin", ".json"]) {
    const src = path.join(from, id + ext);
    const dest = path.join(to, id + ext);
    try { fs.renameSync(src, dest); }
    catch {
      fs.copyFileSync(src, dest);
      fs.rmSync(src, { force: true });
    }
  }
}

function newId() {
  return `f_${crypto.randomBytes(6).toString("hex")}`;
}

function guardPendingCount() {
  const names = fs.readdirSync(pendingDir()).filter((f) => f.endsWith(".json"));
  if (names.length >= MAX_PENDING) throw fail(400, "Too many files are waiting. Send an idea or remove a file first.");
}

export function savePending(body) {
  const decoded = decodeUpload(body);
  const described = describe(decoded);
  guardPendingCount();
  const meta = { id: newId(), name: described.name, mime: described.mime, bytes: decoded.buf.length, kind: described.kind };
  writePair(pendingDir(), meta, decoded.buf);
  return { id: meta.id, name: meta.name, mime: meta.mime, bytes: meta.bytes, kind: meta.kind };
}

export function dropPending(id) {
  fileIdOk(id);
  const dir = pendingDir();
  fs.rmSync(path.join(dir, `${id}.bin`), { force: true });
  fs.rmSync(path.join(dir, `${id}.json`), { force: true });
  return { deleted: true };
}

export function pendingMeta(id) {
  const row = readPair(pendingDir(), id);
  if (!row) throw fail(400, "That file is not on this computer.");
  return { id: row.id, name: row.name, mime: row.mime, bytes: row.bytes, kind: row.kind || "" };
}

export function claimPending(ideaId, fileIds) {
  const ids = Array.isArray(fileIds) ? fileIds : [];
  if (!ids.length) return [];
  if (ids.length > MAX_FILES) throw fail(400, "Up to 4 files can go with one idea.");
  const metas = ids.map((id) => pendingMeta(id));
  const dir = ideaDir(ideaId);
  const from = pendingDir();
  return metas.map((meta) => {
    movePair(from, dir, meta.id);
    return { id: meta.id, name: meta.name, mime: meta.mime, bytes: meta.bytes, kind: meta.kind || "" };
  });
}

export function addIdeaUpload(ideaId, body, already = 0) {
  if (already >= MAX_FILES) throw fail(400, "Up to 4 files can go with one idea.");
  const decoded = decodeUpload(body);
  const described = describe(decoded);
  const meta = { id: newId(), name: described.name, mime: described.mime, bytes: decoded.buf.length, kind: described.kind };
  writePair(ideaDir(ideaId), meta, decoded.buf);
  return { id: meta.id, name: meta.name, mime: meta.mime, bytes: meta.bytes, kind: meta.kind };
}

export function readPending(id) {
  try { return readPair(pendingDir(), id); }
  catch { return null; }
}

export function readIdeaFile(ideaId, fileId) {
  if (!IDEA_ID.test(String(ideaId || ""))) return null;
  try { return readPair(path.join(DATA_DIR, "idea-files", "ideas", ideaId), fileId); }
  catch { return null; }
}

export function removeIdeaFiles(ideaId) {
  if (!IDEA_ID.test(String(ideaId || ""))) return;
  fs.rmSync(path.join(DATA_DIR, "idea-files", "ideas", ideaId), { recursive: true, force: true });
}

export function saveOrderUpload(body) {
  const decoded = decodeUpload(body);
  const described = describe(decoded);
  const meta = { id: newId(), name: described.name, mime: described.mime, bytes: decoded.buf.length, kind: described.kind };
  writePair(orderDir(), meta, decoded.buf);
  return {
    id: meta.id,
    name: meta.name,
    mime: meta.mime,
    bytes: meta.bytes,
    kind: meta.kind,
    note: described.note,
    sends: false,
  };
}

export function readOrderFile(id) {
  try { return readPair(orderDir(), id); }
  catch { return null; }
}

export function writeAttachment(res, file) {
  const ascii = String(file?.name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";
  const mime = file.mime && file.mime !== "text/html" && file.mime !== "image/svg+xml" ? file.mime : "application/octet-stream";
  const buf = file.buf;
  res.writeHead(200, {
    "content-type": mime,
    "content-disposition": `attachment; filename="${ascii}"`,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "content-length": buf.length,
  });
  res.end(buf);
}
