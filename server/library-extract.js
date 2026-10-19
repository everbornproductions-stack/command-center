// Knowledge libraries (Phase 18): text out of the files a person adds. Plain text, Markdown, CSV, JSON,
// code and HTML are read as text; Word .docx is unzipped (word/document.xml); PDFs get a best-effort
// reader for plain text streams (scanned pages and unusual font encodings come out empty and are skipped
// with a note). No dependency, nothing leaves the PC here. Also walks a folder on this PC (local mode).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { htmlToText } from "./receipts.js";

export const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".mdx", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".xml", ".log", ".ini", ".toml", ".cfg", ".conf", ".sql", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".cs", ".c", ".h", ".cpp", ".hpp", ".php", ".sh", ".ps1", ".bat", ".css", ".scss", ".vue", ".svelte", ".tex", ".rst", ".org", ".srt", ".vtt"]);
export const HTML_EXT = new Set([".html", ".htm", ".xhtml"]);
export const BINARY_EXT = new Set([".docx", ".pdf"]);
export const supported = (name) => { const e = path.extname(String(name || "")).toLowerCase(); return TEXT_EXT.has(e) || HTML_EXT.has(e) || BINARY_EXT.has(e); };
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 2_000_000; // per file, after extraction

const decodeEntities = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const tidy = (s) => String(s || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// ---------- .docx: a zip; read word/document.xml ----------
export function unzipEntry(buf, wanted) {
  // end of central directory: signature 0x06054b50, searched from the end (comment up to 64 KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("broken zip entry");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) return data;
    if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 });
    throw new Error(`unsupported zip method ${method}`);
  }
  return null;
}
export function docxText(buf) {
  const xml = unzipEntry(buf, "word/document.xml");
  if (!xml) throw new Error("no word/document.xml inside (not a Word document)");
  return tidy(decodeEntities(xml.toString("utf8")
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/w:tr>/g, "\n").replace(/<\/w:tc>/g, " | ")
    .replace(/<[^>]+>/g, "")));
}

// ---------- PDF: best effort for text-based PDFs ----------
function pdfString(s) {
  // the inside of a (...) literal: escapes, octal codes
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
    const n = s[++i];
    if (n === "n") out += "\n"; else if (n === "r") out += "\r"; else if (n === "t") out += "\t"; else if (n === "b" || n === "f") out += " ";
    else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]; out += String.fromCharCode(parseInt(o, 8)); }
    else if (n === "\n" || n === "\r") { /* line continuation */ } else out += n ?? "";
  }
  return out;
}
const hexString = (h) => { const clean = h.replace(/\s+/g, ""); let out = ""; if (clean.length >= 4 && clean.startsWith("FEFF")) { for (let i = 4; i + 3 < clean.length; i += 4) out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16)); return out; } for (let i = 0; i + 1 < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16)); return out; };
function textOps(content) {
  const out = [];
  // BT ... ET blocks; inside: (..) Tj, [..] TJ, ' and ", T* / Td / TD for new lines
  const re = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|")|\[(?:\\.|[^\]])*\]\s*TJ|<[0-9A-Fa-f\s]+>\s*Tj|T\*|-?\d*\.?\d+\s+-?\d*\.?\d+\s+T[dD]|ET/g;
  let m;
  while ((m = re.exec(content))) {
    const t = m[0];
    if (t === "ET" || t === "T*" || /T[dD]$/.test(t)) { if (/T[dD]$/.test(t)) { const y = Number(t.trim().split(/\s+/)[1]); if (y !== 0) out.push("\n"); else out.push(" "); } else out.push("\n"); continue; }
    if (t.startsWith("(")) out.push(pdfString(t.slice(1, t.lastIndexOf(")"))));
    else if (t.startsWith("<")) out.push(hexString(t.slice(1, t.indexOf(">"))));
    else {
      const inner = t.slice(1, t.lastIndexOf("]"));
      const parts = inner.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>|-?\d*\.?\d+/g) || [];
      for (const p of parts) {
        if (p.startsWith("(")) out.push(pdfString(p.slice(1, -1)));
        else if (p.startsWith("<")) out.push(hexString(p.slice(1, -1)));
        else if (Number(p) < -180) out.push(" "); // a wide kern is a word gap
      }
    }
  }
  return out.join("");
}
export function pdfText(buf) {
  const src = buf.toString("latin1");
  if (!src.startsWith("%PDF")) throw new Error("not a PDF file");
  const parts = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(src))) {
    const dict = m[1];
    if (/\/Subtype\s*\/(Image|XML)|\/Type\s*\/(XRef|ObjStm|Metadata)|\/Length1|\/FontFile/.test(dict)) continue;
    const start = m.index + m[0].length;
    const end = src.indexOf("endstream", start);
    if (end < 0) break;
    let data = buf.subarray(start, end);
    try {
      if (/\/FlateDecode/.test(dict)) data = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 32 * 1024 * 1024 });
      else if (/\/Filter/.test(dict)) continue; // other filters (images, LZW, ...) are not text we can read
    } catch { continue; }
    const content = data.toString("latin1");
    if (!/\bBT\b/.test(content)) continue;
    parts.push(textOps(content));
    re.lastIndex = end;
  }
  return tidy(parts.join("\n").replace(/[^\S\n]+/g, " "));
}
// Share of letters, digits and ordinary punctuation: tells real text from a font's private codes.
export const readable = (s) => { const t = String(s || ""); if (!t.length) return 0; const ok = (t.match(/[\p{L}\p{N}\s.,;:!?'"()\-–%$€£&/]/gu) || []).length; return ok / t.length; };

// One file → { text } or { skipped: reason }
export function extract(name, buf) {
  const ext = path.extname(String(name || "")).toLowerCase();
  if (!buf || !buf.length) return { skipped: "empty file" };
  if (buf.length > MAX_FILE_BYTES) return { skipped: `larger than ${Math.round(MAX_FILE_BYTES / 1048576)} MB` };
  let text = "";
  try {
    if (ext === ".docx") text = docxText(buf);
    else if (ext === ".pdf") {
      text = pdfText(buf);
      if (text.replace(/\s/g, "").length < 20 || readable(text) < 0.85) return { skipped: "no readable text in this PDF (scanned pages or an unusual font encoding; save it as text or Word first)" };
    } else if (HTML_EXT.has(ext)) text = htmlToText(buf.toString("utf8"));
    else if (TEXT_EXT.has(ext)) {
      if (buf.subarray(0, 8000).includes(0)) return { skipped: "looks like a binary file" };
      text = tidy(buf.toString("utf8").replace(/^﻿/, ""));
    } else return { skipped: "file type not supported (text, Markdown, CSV, JSON, code, HTML, Word .docx and PDF are)" };
  } catch (e) { return { skipped: `could not read it: ${e.message}` }; }
  if (!text.trim()) return { skipped: "no text inside" };
  return { text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS };
}

// ---------- a folder on this PC ----------
const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".cache", "$RECYCLE.BIN", "System Volume Information"]);
export function walkFolder(root, { maxFiles = 2000, maxDepth = 12 } = {}) {
  const files = [], skipped = [];
  const walk = (dir, depth) => {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { skipped.push({ path: path.relative(root, dir) || ".", reason: `cannot open: ${e.code || e.message}` }); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= maxFiles) { skipped.push({ path: "(more files)", reason: `stopped at ${maxFiles} files` }); return; }
      if (e.name.startsWith(".") || e.isSymbolicLink()) continue; // hidden files and links are never followed
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (!supported(e.name)) { skipped.push({ path: path.relative(root, full), reason: "file type not supported" }); continue; }
      files.push({ full, rel: path.relative(root, full).split(path.sep).join("/") });
    }
  };
  walk(root, 0);
  return { files, skipped };
}
