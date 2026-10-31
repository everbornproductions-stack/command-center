// Real .xlsx and .docx files from an AI's answer (0.4.27, dogfood batch 1: bakery-sales.xlsx, workout-plan.docx),
// and .pptx decks from markdown (0.4.28, dogfood batch 3: slides).
// The AI gives a markdown table (or a csv block) for a spreadsheet and markdown for a Word document; this file turns
// that into a real Office Open XML file. No npm dependency: a small ZIP writer (zlib deflate + CRC32) and plain XML.
import zlib from "node:zlib";

// ---------------- ZIP ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive from [{ name, data }] (data: string or Buffer). Deflated entries, UTF-8 names, no extras. */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const d = new Date();
  const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
  const dosDate = (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), "utf8");
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const stored = packed.length >= raw.length;
    const body = stored ? raw : packed;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // utf-8 names
    lh.writeUInt16LE(stored ? 0 : 8, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // made by
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(stored ? 0 : 8, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------------- XML helpers ----------------
// characters XML 1.0 does not allow are dropped; the five specials are escaped
export function xmlText(s) {
  return String(s ?? "")
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ---------------- parsing tables ----------------
const SEP_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const looksRow = (l) => /\|/.test(l) && l.trim().length > 1;

/** The cells of one pipe-table line. "\|" stays a pipe inside a cell. */
export function splitRow(line) {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (s[i] === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += s[i];
  }
  out.push(cur.trim());
  return out;
}

/** CSV text to rows. Quotes, doubled quotes, commas and new lines inside quotes. A tab-only text splits on tabs. */
export function parseCsv(text) {
  const t = String(text || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const delim = !t.includes(",") && t.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") { q = true; cell = ""; }
    else if (ch === delim) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.trim() || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const stripInline = (s) => String(s || "").replace(/^\s*(\*\*|__)([\s\S]*)\1\s*$/, "$2").replace(/^\s*`([^`]*)`\s*$/, "$1").replace(/<br\s*\/?>/gi, "\n").trim();
// fences that hold code (a script that would build the file) are not part of the document or the sheet
const BUILD_SCRIPT = /\b(?:openpyxl|xlsxwriter|python-docx|from docx|import docx|docx\.Document|Document\(\)|exceljs|SheetJS|require\(["'](?:xlsx|docx|exceljs)["']\)|from ["'](?:xlsx|docx|exceljs)["']|pandas|to_excel|Workbook\(\)|python-pptx|from pptx|import pptx|pptxgenjs|PptxGenJS|Presentation\(\))/i;

/** Split text into prose parts and fenced blocks: [{ fence: false, text } | { fence: true, lang, text }]. */
function fenceParts(text) {
  const t = String(text || "").replace(/\r\n?/g, "\n");
  const out = [];
  const re = /^([ \t]*)(```|~~~)([^\n`]*)\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm;
  let last = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push({ fence: false, text: t.slice(last, m.index) });
    out.push({ fence: true, lang: m[3].trim().toLowerCase().split(/\s+/)[0] || "", text: m[4].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < t.length) out.push({ fence: false, text: t.slice(last) });
  return out;
}

/** Markdown with build scripts taken out and ```markdown fences opened up. `scripts` counts what was dropped. */
export function documentText(text) {
  let scripts = 0;
  const parts = fenceParts(text).map((p) => {
    if (!p.fence) return p.text;
    if (["markdown", "md"].includes(p.lang)) return p.text;
    if (BUILD_SCRIPT.test(p.text) || ["python", "py", "javascript", "js", "node", "vba", "powershell", "ps1", "bash", "sh"].includes(p.lang) && /\b(?:xlsx|docx|pptx|workbook|document|presentation|slides?)\b/i.test(p.text)) { scripts++; return ""; }
    return "```" + p.lang + "\n" + p.text + "\n```";
  });
  return { text: parts.join("").replace(/\n{3,}/g, "\n\n").trim(), scripts };
}

// the title just above a table: the nearest heading or a line that is only bold text
function titleAbove(lines, i, stop) {
  for (let k = i - 1; k >= Math.max(stop, i - 6); k--) {
    const l = lines[k].trim();
    if (!l) continue;
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(l);
    if (h) return stripInline(h[1]).replace(/[*_`]/g, "").replace(/:$/, "").trim();
    const b = /^(?:\*\*|__)(.+?)(?:\*\*|__):?$/.exec(l);
    if (b) return b[1].replace(/[*_`]/g, "").replace(/:$/, "").trim();
    if (/^table\s*\d*\s*[:.-]/i.test(l)) return l.replace(/[*_`]/g, "").replace(/:$/, "").trim();
  }
  return "";
}

/** Every pipe table in markdown: [{ title, rows }]. The separator line is dropped; ragged rows are padded. */
export function markdownTables(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let prevEnd = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!looksRow(lines[i]) || !SEP_ROW.test(lines[i + 1])) continue;
    const head = splitRow(lines[i]);
    const rows = [head];
    let j = i + 2;
    for (; j < lines.length && looksRow(lines[j]) && !SEP_ROW.test(lines[j]); j++) rows.push(splitRow(lines[j]));
    const width = Math.max(...rows.map((r) => r.length));
    out.push({ title: titleAbove(lines, i, prevEnd), rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")].slice(0, width)) });
    prevEnd = j;
    i = j - 1;
  }
  return out;
}

// a table that describes the layout of a sheet ("Row | A | B | C") is not the sheet itself
function isLayoutTable(rows) {
  const head = rows[0].map((c) => stripInline(c).replace(/\s*\(.*\)$/, "").trim());
  const letters = head.filter((c) => /^[A-Z]{1,2}$/.test(c)).length;
  return letters >= 2 && letters >= head.length - 1;
}

/**
 * The table(s) in an AI answer to put in a spreadsheet: [{ name, rows }].
 * ```csv blocks win. Otherwise markdown tables: several titled tables become several sheets, else the largest table.
 */
export function tablesFromAnswer(text) {
  const parts = fenceParts(text);
  const csv = parts.filter((p) => p.fence && ["csv", "tsv"].includes(p.lang)).map((p) => parseCsv(p.text)).filter((r) => r.length >= 2);
  if (csv.length) {
    const titles = [];
    let prose = "";
    for (const p of parts) {
      if (p.fence && ["csv", "tsv"].includes(p.lang)) { const lines = prose.split("\n"); titles.push(titleAbove(lines, lines.length, 0)); prose = ""; }
      else if (!p.fence) prose += p.text;
    }
    return csv.map((rows, i) => ({ name: titles[i] || `Sheet${i + 1}`, rows }));
  }
  const md = parts.map((p) => (!p.fence ? p.text : ["markdown", "md", ""].includes(p.lang) && !BUILD_SCRIPT.test(p.text) ? `\n${p.text}\n` : "\n")).join("");
  const tables = markdownTables(md).filter((t) => t.rows.length >= 2 && t.rows[0].length >= 1 && !isLayoutTable(t.rows));
  if (!tables.length) return [];
  const titled = tables.filter((t) => t.title);
  if (tables.length >= 2 && titled.length === tables.length && new Set(titled.map((t) => t.title.toLowerCase())).size === tables.length) {
    return tables.map((t) => ({ name: t.title, rows: t.rows }));
  }
  const size = (t) => t.rows.length * t.rows[0].length;
  const best = tables.reduce((a, b) => (size(b) > size(a) ? b : a));
  return [{ name: best.title || "Sheet1", rows: best.rows }];
}

// ---------------- XLSX ----------------
const colName = (i) => { let s = "", n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** One cell from the AI's text: { f } formula, { n, fmt } number, { s, bold } text, or null when empty. */
export function parseCell(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  let bold = false;
  const b = /^(\*\*|__)([\s\S]+)\1$/.exec(s);
  if (b) { bold = true; s = b[2].trim(); }
  const code = /^`([^`]+)`$/.exec(s);
  if (code) s = code[1].trim();
  s = s.replace(/<br\s*\/?>/gi, "\n");
  if (/^=[^=]/.test(s)) return { f: s.slice(1).trim(), bold };
  // numbers: 1450, -3.5, 1,450.50, $1,450, (500), 12%, 1.2e3. Leading zeros (zip codes, ids) stay text.
  const compact = s.replace(/\s+/g, "");
  const m = /^([-+])?(\$|£|€)?(\()?([-+])?(\$|£|€)?(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?(\))?(%)?$/.exec(compact);
  const digits = m ? (m[6] || "").replace(/,/g, "") : "";
  if (m && (m[6] || m[7]) && !/^0\d/.test(digits) && !!m[3] === !!m[8]) {
    const neg = m[1] === "-" || m[4] === "-" || !!m[3];
    let n = Number(`${digits || "0"}${m[7] || ""}`);
    if (Number.isFinite(n)) {
      if (neg) n = -n;
      if (m[9]) return { n: +(n / 100).toPrecision(15), fmt: "pct", bold };
      if (m[2] || m[5]) return { n, fmt: "money", bold };
      return { n, fmt: "", bold };
    }
  }
  if (/^[-+]?\d+(\.\d+)?[eE][-+]?\d+$/.test(s)) return { n: Number(s), fmt: "", bold };
  return { s: s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/`([^`]+)`/g, "$1"), bold };
}

// styles: 0 normal, 1 bold, 2 money, 3 bold money, 4 percent, 5 bold percent
const STYLE = { "": [0, 1], money: [2, 3], pct: [4, 5] };
const XLSX_STYLES = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(rows) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array(width).fill(8);
  const body = rows.map((r, ri) => {
    const cells = r.map((raw, ci) => {
      const c = parseCell(raw);
      if (!c) return "";
      const ref = `${colName(ci)}${ri + 1}`;
      const bold = ri === 0 || c.bold;
      const shown = c.f != null ? Math.min(14, c.f.length) : c.n != null ? String(c.n).length + (c.fmt ? 3 : 0) : Math.max(...String(c.s).split("\n").map((x) => x.length));
      widths[ci] = Math.max(widths[ci], Math.min(60, shown + 2));
      const st = STYLE[c.fmt || ""]?.[bold ? 1 : 0] || 0;
      const sAttr = st ? ` s="${st}"` : "";
      if (c.f != null) return `<c r="${ref}"${sAttr}><f>${xmlText(c.f)}</f></c>`;
      if (c.n != null) return `<c r="${ref}"${sAttr}><v>${c.n}</v></c>`;
      return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlText(c.s)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");
  const dim = `A1:${colName(width - 1)}${Math.max(1, rows.length)}`;
  const freeze = rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : "";
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

// Excel sheet names: 31 characters, none of []:*?/\ and not blank, unique
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((s, i) => {
    let base = String(s.name || "").replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base, n = 2;
    while (used.has(name.toLowerCase())) { const suf = ` (${n++})`; name = base.slice(0, 31 - suf.length) + suf; }
    used.add(name.toLowerCase());
    return name;
  });
}

/** A real .xlsx (or .xlsm with { macro: true }) from { sheets: [{ name, rows: [[cell, ...], ...] }] }. */
export function xlsxFromTable({ sheets = [] } = {}, { macro = false } = {}) {
  const list = (sheets || []).filter((s) => Array.isArray(s?.rows));
  if (!list.length) list.push({ name: "Sheet1", rows: [] });
  const names = sheetNames(list);
  const mainType = macro ? "application/vnd.ms-excel.sheet.macroEnabled.main+xml" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  const files = [
    { name: "[Content_Types].xml", data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${mainType}"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    ...docProps(),
    { name: "xl/workbook.xml", data: `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: XLSX_STYLES },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows.map((r) => (Array.isArray(r) ? r : [r]))) })),
  ];
  return zip(files);
}

function docProps() {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return [
    { name: "docProps/core.xml", data: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Meldmind</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: "docProps/app.xml", data: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Meldmind</Application></Properties>` },
  ];
}

// ---------------- DOCX ----------------
/** Inline markdown to runs: **bold**, *italic*, ***both***, `code`, [text](link) shown as text. */
export function inlineRuns(text, base = {}) {
  const s = String(text || "").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1").replace(/<br\s*\/?>/gi, "\n");
  const out = [];
  const re = /(\*\*\*|___)(.+?)\1|(\*\*|__)(.+?)\3|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])|`([^`]+)`/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index), ...base });
    if (m[2] != null) out.push(...inlineRuns(m[2], { ...base, b: true, i: true }));
    else if (m[4] != null) out.push(...inlineRuns(m[4], { ...base, b: true }));
    else if (m[5] != null) out.push(...inlineRuns(m[5], { ...base, i: true }));
    else if (m[6] != null) out.push(...inlineRuns(m[6], { ...base, i: true }));
    else if (m[7] != null) out.push({ t: m[7], ...base, code: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last), ...base });
  return out.filter((r) => r.t);
}
function runXml(r) {
  const pr = `${r.b ? "<w:b/>" : ""}${r.i ? "<w:i/>" : ""}${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : ""}`;
  return String(r.t).split("\n").map((part, k) => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}${k ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlText(part)}</w:t></w:r>`).join("");
}
const para = (runs, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs.map(runXml).join("")}</w:p>`;

/** Markdown to blocks: heading, para, list item, table, code. */
export function markdownBlocks(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paraBuf = [];
  let listId = 0, inList = null;
  const flush = () => { if (paraBuf.length) { blocks.push({ type: "para", text: paraBuf.join(" ") }); paraBuf = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const fence = /^(```|~~~)\s*([\w-]*)/.exec(t);
    if (fence) {
      flush(); inList = null;
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i]);
      blocks.push({ type: "code", lines: code });
      continue;
    }
    if (!t) { flush(); if (inList && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1] || "")) inList = null; continue; }
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(t);
    if (h) { flush(); inList = null; blocks.push({ type: "heading", level: Math.min(3, h[1].length), text: h[2] }); continue; }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); inList = null; continue; }
    if (looksRow(t) && SEP_ROW.test(lines[i + 1] || "")) {
      flush(); inList = null;
      const rows = [splitRow(t)];
      for (i += 2; i < lines.length && looksRow(lines[i]) && !SEP_ROW.test(lines[i]); i++) rows.push(splitRow(lines[i]));
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push({ type: "table", rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")]) });
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const level = Math.min(2, Math.floor(li[1].replace(/\t/g, "    ").length / 2));
      const text = li[3].replace(/^\[[ xX]\]\s+/, "");
      if (!inList || (level === 0 && inList.ordered !== ordered)) inList = { ordered, id: ++listId };
      blocks.push({ type: "item", ordered: level === 0 ? inList.ordered : ordered, level, list: inList.id, text });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(t);
    if (quote) { flush(); inList = null; blocks.push({ type: "quote", text: quote[1] }); continue; }
    if (inList && /^\s{2,}\S/.test(line)) { const prev = blocks[blocks.length - 1]; if (prev?.type === "item") { prev.text += " " + t; continue; } }
    inList = null;
    paraBuf.push(t);
  }
  flush();
  return blocks;
}

const DOCX_STYLES = `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

function numberingXml(lists) {
  const lvl = (ordered, i) => ordered
    ? `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${["decimal", "lowerLetter", "lowerRoman"][i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`
    : `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${["•", "◦", "▪"][i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:lvl>`;
  const abs = [0, 1].map((a) => `<w:abstractNum w:abstractNumId="${a}"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2].map((i) => lvl(a === 1, i)).join("")}</w:abstractNum>`).join("");
  // every list gets its own number so a numbered list starts again at 1
  const nums = lists.map((l) => `<w:num w:numId="${l.num}"><w:abstractNumId w:val="${l.ordered ? 1 : 0}"/>${l.ordered ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ""}</w:num>`).join("");
  return `${XML_HEAD}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abs}${nums}</w:numbering>`;
}

const TEXT_WIDTH = 9360; // twips: Letter with 1 inch margins
function tableXml(rows) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const lens = Array(width).fill(1);
  for (const r of rows) r.forEach((c, i) => { lens[i] = Math.max(lens[i], Math.min(40, stripInline(c).length)); });
  const total = lens.reduce((a, b) => a + b, 0);
  const cols = lens.map((l) => Math.max(720, Math.round((TEXT_WIDTH * l) / total)));
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`;
  const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
  const grid = `<w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
  const trs = rows.map((r, ri) => {
    const cells = Array.from({ length: width }, (_, ci) => {
      const runs = inlineRuns(r[ci] || "", ri === 0 ? { b: true } : {});
      const shade = ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>' : "";
      return `<w:tc><w:tcPr><w:tcW w:w="${cols[ci]}" w:type="dxa"/>${shade}</w:tcPr>${para(runs, '<w:spacing w:after="0"/>')}</w:tc>`;
    }).join("");
    return `<w:tr>${ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells}</w:tr>`;
  }).join("");
  return `<w:tbl>${tblPr}${grid}${trs}</w:tbl>`;
}

/** A real .docx from markdown: headings, paragraphs, bold and italic, bullet and numbered lists, tables. */
export function docxFromMarkdown(md) {
  const blocks = markdownBlocks(documentText(md).text);
  const lists = [];
  const listNum = new Map();
  const body = [];
  for (const b of blocks) {
    if (b.type === "heading") body.push(para(inlineRuns(b.text), `<w:pStyle w:val="Heading${b.level}"/>`));
    else if (b.type === "para") body.push(para(inlineRuns(b.text)));
    else if (b.type === "quote") body.push(para(inlineRuns(b.text), '<w:pStyle w:val="Quote"/>'));
    else if (b.type === "code") for (const l of b.lines.length ? b.lines : [""]) body.push(para([{ t: l }], '<w:pStyle w:val="Code"/>'));
    else if (b.type === "table") { body.push(tableXml(b.rows)); body.push(para([], '<w:spacing w:after="120"/>')); }
    else if (b.type === "item") {
      const key = `${b.list}:${b.ordered ? 1 : 0}`;
      if (!listNum.has(key)) { const num = lists.length + 1; listNum.set(key, num); lists.push({ num, ordered: b.ordered }); }
      body.push(para(inlineRuns(b.text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${b.level}"/><w:numId w:val="${listNum.get(key)}"/></w:numPr>`));
    }
  }
  if (!body.length) body.push("<w:p/>");
  const sect = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const doc = `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join("")}${sect}</w:body></w:document>`;
  const hasNum = lists.length > 0;
  return zip([
    { name: "[Content_Types].xml", data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${hasNum ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    ...docProps(),
    { name: "word/document.xml", data: doc },
    { name: "word/styles.xml", data: DOCX_STYLES },
    ...(hasNum ? [{ name: "word/numbering.xml", data: numberingXml(lists) }] : []),
    { name: "word/_rels/document.xml.rels", data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${hasNum ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' : ""}</Relationships>` },
  ]);
}

// ---------------- PPTX (0.4.28) ----------------
// "save it as pitch.pptx": the AI writes the deck as markdown, one "## " heading per slide; a leading "# " is the
// title slide. Bullets (one level of nesting), short paragraphs, a table, and a "Notes:" line for speaker notes.
// 16:9, white background, dark text, one accent colour.
const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";
const SLIDE_W = 12192000, SLIDE_H = 6858000; // 13.333 x 7.5 inches
const MARGIN_X = 731520, CONTENT_W = SLIDE_W - 2 * MARGIN_X;
const DARK = "1F2937", MUTED = "4B5563", ACCENT = "2563EB", LIGHT = "F3F4F6", LINE = "D1D5DB";
const BODY_Y = 1645920, BODY_H = SLIDE_H - BODY_Y - 457200;
const MAX_ITEMS = 8; // more lines than this on one slide continue on the next
const MAX_TABLE_ROWS = 10, MAX_TABLE_COLS = 6; // a bigger table becomes bullet rows

const plainText = (s) => inlineRuns(s).map((r) => r.t).join("").replace(/\s+/g, " ").trim();
const NOTES_LINE = /^\s*(?:>\s*)?(?:\*\*|__)?\s*(?:speaker\s+)?notes?\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i;
const slideTitle = (s) => plainText(s).replace(/^slide\s*\d+\s*[:.)–-]\s*/i, "").replace(/:$/, "").trim();

/**
 * Markdown to slides: [{ kind: "title", title, subtitle: [lines], notes } | { kind: "content", title, items, table, notes }].
 * items: [{ type: "bullet" | "number" | "text" | "sub" | "code", level, text }]. An answer with no usable slide gives [].
 */
export function markdownSlides(md, { title = "" } = {}) {
  const lines = documentText(md).text.replace(/\r\n?/g, "\n").split("\n");
  // which heading level makes a slide: "## " when there is one, else "# " when there are several, else "### "
  const count = [0, 0, 0, 0];
  let inFence = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    const h = !inFence && /^(#{1,3})\s+\S/.exec(l.trim());
    if (h) count[h[1].length]++;
  }
  const level = count[2] ? 2 : count[1] >= 2 ? 1 : count[3] ? 3 : 0;
  const slides = [];
  let cur = null, notes = null;
  const pre = { items: [], tables: [] };
  const target = () => cur || pre;
  const start = (kind, t) => { cur = { kind, title: slideTitle(t), items: [], tables: [], notes: [] }; slides.push(cur); notes = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const fence = /^(```|~~~)/.exec(t);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i]);
      if (notes) notes.push(...code); else for (const c of code) target().items.push({ type: "code", level: 0, text: c });
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(t);
    if (h) {
      const n = h[1].length;
      if (level && n === level) start("content", h[2]);
      else if (level && n < level) start(!slides.length ? "title" : "content", h[2]);
      else { notes = null; target().items.push({ type: "sub", level: 0, text: h[2] }); }
      continue;
    }
    const nm = NOTES_LINE.exec(t);
    if (nm && cur) { notes = cur.notes; if (nm[1].trim()) notes.push(nm[1]); continue; }
    if (notes) { if (t) notes.push(t); continue; }
    if (!t || /^(?:-{3,}|\*{3,}|_{3,})$/.test(t) || /^!\[[^\]]*\]\([^)]*\)$/.test(t)) continue;
    if (looksRow(t) && SEP_ROW.test(lines[i + 1] || "")) {
      const rows = [splitRow(t)];
      for (i += 2; i < lines.length && looksRow(lines[i]) && !SEP_ROW.test(lines[i]); i++) rows.push(splitRow(lines[i]));
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      target().tables.push(rows.map((r) => [...r, ...Array(width - r.length).fill("")].slice(0, width)));
      continue;
    }
    const li = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const indent = li[1].replace(/\t/g, "    ").length;
      target().items.push({ type: /\d/.test(li[2]) ? "number" : "bullet", level: indent >= 2 ? 1 : 0, text: li[3].replace(/^\[[ xX]\]\s+/, "") });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(t);
    const items = target().items;
    const prev = items[items.length - 1];
    // a wrapped list line or a wrapped paragraph joins the line above it
    if (!q && prev && /^\s{2,}\S/.test(line) && (prev.type === "bullet" || prev.type === "number")) { prev.text += " " + t; continue; }
    if (!q && prev && prev.type === "text" && !prev.quote && lines[i - 1]?.trim()) { prev.text += " " + t; continue; }
    items.push({ type: "text", level: 0, text: q ? q[1] : t, quote: !!q });
  }
  // a closing line to the person ("Let me know if you want changes.") is not part of the last slide
  const lastItems = slides.length ? slides[slides.length - 1].items : [];
  while (lastItems.length && lastItems[lastItems.length - 1].type === "text" && /^(?:let me know|feel free|i hope|hope this|would you like|if you(?:'d| would) like|happy to|want me to)\b/i.test(plainText(lastItems[lastItems.length - 1].text))) lastItems.pop();
  // text before the first slide heading ("Here is your deck:") is dropped when there are slides; with no slide
  // headings at all, a list or a table is one slide
  if (!slides.length) {
    const lists = pre.items.filter((x) => x.type === "bullet" || x.type === "number").length;
    if (lists >= 2 || pre.tables.length) slides.push({ kind: "content", title: title || "Overview", items: pre.items, tables: pre.tables, notes: [] });
  }
  const out = [];
  for (const s of slides) {
    const noteText = s.notes.map((x) => plainText(x)).filter(Boolean).join("\n");
    if (s.kind === "title") {
      const texts = s.items.filter((x) => x.type === "text").map((x) => plainText(x.text));
      if (!s.tables.length && s.items.length <= 3) { out.push({ kind: "title", title: s.title, subtitle: s.items.map((x) => plainText(x.text)).filter(Boolean), notes: noteText }); continue; }
      // a title with a lot under it: the title slide keeps the first line, the rest is an Overview slide
      out.push({ kind: "title", title: s.title, subtitle: texts.slice(0, 1), notes: noteText });
      if (texts.length) s.items = s.items.filter((x, k) => k !== s.items.findIndex((y) => y.type === "text"));
      s.title = "Overview";
      s.notes = [];
    }
    // a table that is too big for a slide becomes bullet rows ("Monday: 1,450, 980")
    let items = s.items;
    let table = null;
    for (const rows of s.tables) {
      if (!table && rows.length >= 2 && rows.length <= MAX_TABLE_ROWS && rows[0].length <= MAX_TABLE_COLS) table = rows;
      else items = items.concat(rows.slice(1).map((r) => { const cells = r.filter((c) => c.trim()); return { type: "bullet", level: 0, text: cells.length > 1 ? `${cells[0]}: ${cells.slice(1).join(", ")}` : cells.join("") }; }));
    }
    // long slides continue on the next one; a nested line stays with its parent
    const room = table ? 4 : MAX_ITEMS;
    const chunks = [[]];
    for (const it of items) {
      const last = chunks[chunks.length - 1];
      if (last.length >= room && it.level === 0) chunks.push([it]); else last.push(it);
    }
    const notesHere = s.kind === "title" ? "" : s.notes.map((x) => plainText(x)).filter(Boolean).join("\n");
    chunks.forEach((c, k) => out.push({ kind: "content", title: k ? `${s.title} (continued)` : s.title, items: c, table: k ? null : table, notes: k ? "" : notesHere }));
  }
  return out;
}

const emu = (n) => Math.round(n);
const rPrXml = (r, size, color) => `<a:rPr lang="en-US" sz="${size}"${r.b ? ' b="1"' : ""}${r.i ? ' i="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${r.code ? '<a:latin typeface="Consolas"/><a:cs typeface="Consolas"/>' : ""}</a:rPr>`;
function runsXml(runs, size, color) {
  const out = [];
  for (const r of runs) {
    String(r.t).split("\n").forEach((part, k) => {
      if (k) out.push(`<a:br>${rPrXml(r, size, color)}</a:br>`);
      if (part) out.push(`<a:r>${rPrXml(r, size, color)}<a:t>${xmlText(part)}</a:t></a:r>`);
    });
  }
  return out.join("");
}
const spGroup = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
function phShape({ id, name, ph, x, y, w, h, anchor = "t", paras, autofit = true }) {
  const body = `<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}">${autofit ? "<a:normAutofit/>" : ""}</a:bodyPr><a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlText(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${body}</p:sp>`;
}
const accentBar = (id, x, y, w, h = 54864) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Accent ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${ACCENT}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;

function itemXml(it) {
  if (it.type === "bullet" || it.type === "number") {
    const size = it.level ? 2000 : 2400;
    const marL = it.level ? 800100 : 342900, indent = it.level ? -285750 : -342900;
    const bu = it.type === "number" ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : `<a:buFont typeface="Arial"/><a:buChar char="${it.level ? "–" : "•"}"/>`;
    return `<a:p><a:pPr marL="${marL}" lvl="${it.level}" indent="${indent}"><a:spcBef><a:spcPts val="${it.level ? 400 : 900}"/></a:spcBef><a:buClr><a:srgbClr val="${ACCENT}"/></a:buClr>${bu}</a:pPr>${runsXml(inlineRuns(it.text), size, it.level ? MUTED : DARK)}</a:p>`;
  }
  const pPr = (before) => `<a:pPr marL="0" indent="0"><a:spcBef><a:spcPts val="${before}"/></a:spcBef><a:buNone/></a:pPr>`;
  if (it.type === "sub") return `<a:p>${pPr(1200)}${runsXml(inlineRuns(it.text, { b: true }), 2200, ACCENT)}</a:p>`;
  if (it.type === "code") return `<a:p>${pPr(0)}${runsXml([{ t: it.text || " ", code: true }], 1600, DARK)}</a:p>`;
  return `<a:p>${pPr(900)}${runsXml(inlineRuns(it.text, it.quote ? { i: true } : {}), 2000, it.quote ? MUTED : DARK)}</a:p>`;
}

function tableFrame(rows, id, x, y, w, maxH) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const lens = Array(width).fill(1);
  for (const r of rows) r.forEach((c, i) => { lens[i] = Math.max(lens[i], Math.min(30, plainText(c).length)); });
  const floor = lens.reduce((a, b) => a + b, 0) / width / 2; // no column narrower than half the average
  const weights = lens.map((l) => Math.max(l, floor));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const cols = weights.map((l) => Math.round((w * l) / wsum));
  const rowH = Math.max(320040, Math.min(457200, Math.floor(maxH / rows.length)));
  const size = rows.length > 7 || width > 4 ? 1400 : 1600;
  const ln = (side) => `<a:${side} w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="${LINE}"/></a:solidFill><a:prstDash val="solid"/></a:${side}>`;
  const trs = rows.map((r, ri) => {
    const fill = ri === 0 ? ACCENT : ri % 2 === 0 ? LIGHT : "FFFFFF";
    const tcs = Array.from({ length: width }, (_, ci) => {
      const runs = inlineRuns(r[ci] || "", ri === 0 ? { b: true } : {});
      const p = runs.length ? `<a:p>${runsXml(runs, size, ri === 0 ? "FFFFFF" : DARK)}</a:p>` : `<a:p><a:endParaRPr lang="en-US" sz="${size}"/></a:p>`;
      return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${p}</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">${["lnL", "lnR", "lnT", "lnB"].map(ln).join("")}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
    }).join("");
    return `<a:tr h="${rowH}">${tcs}</a:tr>`;
  }).join("");
  const sumW = cols.reduce((a, b) => a + b, 0);
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${sumW}" cy="${rowH * rows.length}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${cols.map((c) => `<a:gridCol w="${c}"/>`).join("")}</a:tblGrid>${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function slideXml(s) {
  const shapes = [];
  if (s.kind === "title") {
    const titleP = `<a:p><a:pPr algn="ctr"/>${runsXml(inlineRuns(s.title, { b: true }), 4000, DARK)}</a:p>`;
    shapes.push(phShape({ id: 2, name: "Title 1", ph: '<p:ph type="ctrTitle"/>', x: MARGIN_X, y: 1828800, w: CONTENT_W, h: 1737360, anchor: "b", paras: titleP }));
    shapes.push(accentBar(3, (SLIDE_W - 1371600) / 2, 3703320, 1371600, 64008));
    if (s.subtitle.length) {
      const sub = s.subtitle.map((l) => `<a:p><a:pPr marL="0" indent="0" algn="ctr"><a:buNone/></a:pPr>${runsXml(inlineRuns(l), 2400, MUTED)}</a:p>`).join("");
      shapes.push(phShape({ id: 4, name: "Subtitle 2", ph: '<p:ph type="subTitle" idx="1"/>', x: MARGIN_X, y: 3886200, w: CONTENT_W, h: 1463040, paras: sub }));
    }
  } else {
    const titleP = `<a:p>${runsXml(inlineRuns(s.title, { b: true }), 3600, DARK)}</a:p>`;
    shapes.push(phShape({ id: 2, name: "Title 1", ph: '<p:ph type="title"/>', x: MARGIN_X, y: 365760, w: CONTENT_W, h: 1005840, anchor: "b", paras: titleP }));
    shapes.push(accentBar(3, MARGIN_X + 91440, 1417320, 1371600));
    const rows = s.table;
    const lines = s.items.length;
    const textH = rows ? (lines ? Math.min(BODY_H * 0.45, 420000 * lines + 182880) : 0) : BODY_H;
    if (lines) shapes.push(phShape({ id: 4, name: "Content 2", ph: '<p:ph idx="1"/>', x: MARGIN_X, y: BODY_Y, w: CONTENT_W, h: textH, paras: s.items.map(itemXml).join("") }));
    if (rows) shapes.push(tableFrame(rows, 5, MARGIN_X + 91440, BODY_Y + textH + (lines ? 137160 : 91440), CONTENT_W - 182880, BODY_H - textH - 137160));
  }
  return `${XML_HEAD}<p:sld ${P_NS}><p:cSld><p:spTree>${spGroup}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function notesXml(text) {
  const paras = String(text).split("\n").map((l) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlText(l)}</a:t></a:r></a:p>`).join("");
  return `${XML_HEAD}<p:notes ${P_NS}><p:cSld><p:spTree>${spGroup}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const SOLID_PH = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const THEME = `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Meldmind"><a:themeElements><a:clrScheme name="Meldmind"><a:dk1><a:srgbClr val="${DARK}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="111827"/></a:dk2><a:lt2><a:srgbClr val="${LIGHT}"/></a:lt2><a:accent1><a:srgbClr val="${ACCENT}"/></a:accent1><a:accent2><a:srgbClr val="0EA5E9"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6><a:hlink><a:srgbClr val="${ACCENT}"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Meldmind"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Meldmind"><a:fillStyleLst>${SOLID_PH.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${SOLID_PH}<a:prstDash val="solid"/></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${SOLID_PH.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
const lvlPr = (n, size, extra = "") => `<a:lvl${n}pPr marL="${342900 + (n - 1) * 457200}" indent="${extra ? -342900 : 0}" algn="l" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${extra}<a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`;
const BU = (ch) => `<a:spcBef><a:spcPts val="900"/></a:spcBef><a:buClr><a:srgbClr val="${ACCENT}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="${ch}"/>`;
const TITLE_PH = (paras) => phShape({ id: 2, name: "Title 1", ph: '<p:ph type="title"/>', x: MARGIN_X, y: 365760, w: CONTENT_W, h: 1005840, anchor: "b", paras });
const MASTER = `${XML_HEAD}<p:sldMaster ${P_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${spGroup}${TITLE_PH('<a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p>')}${phShape({ id: 3, name: "Text Placeholder 2", ph: '<p:ph type="body" idx="1"/>', x: MARGIN_X, y: BODY_Y, w: CONTENT_W, h: BODY_H, paras: '<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Text</a:t></a:r></a:p>' })}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="3600" b="1" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${lvlPr(1, 2400, BU("•"))}${lvlPr(2, 2000, BU("–"))}${lvlPr(3, 1800, BU("•"))}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${lvlPr(1, 1800)}</p:otherStyle></p:txStyles></p:sldMaster>`;
const layoutXml = (type, name, shapes) => `${XML_HEAD}<p:sldLayout ${P_NS} type="${type}" preserve="1"><p:cSld name="${name}"><p:spTree>${spGroup}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const LAYOUT_TITLE = layoutXml("title", "Title Slide", phShape({ id: 2, name: "Title 1", ph: '<p:ph type="ctrTitle"/>', x: MARGIN_X, y: 1828800, w: CONTENT_W, h: 1737360, anchor: "b", paras: '<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="4000"/><a:t>Title</a:t></a:r></a:p>' }) + phShape({ id: 3, name: "Subtitle 2", ph: '<p:ph type="subTitle" idx="1"/>', x: MARGIN_X, y: 3886200, w: CONTENT_W, h: 1463040, paras: '<a:p><a:pPr marL="0" indent="0" algn="ctr"><a:buNone/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>Subtitle</a:t></a:r></a:p>' }));
const LAYOUT_CONTENT = layoutXml("obj", "Title and Content", TITLE_PH('<a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p>') + phShape({ id: 3, name: "Content 2", ph: '<p:ph idx="1"/>', x: MARGIN_X, y: BODY_Y, w: CONTENT_W, h: BODY_H, paras: '<a:p><a:r><a:rPr lang="en-US"/><a:t>Text</a:t></a:r></a:p>' }));
const NOTES_MASTER = `${XML_HEAD}<p:notesMaster ${P_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${spGroup}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(685800, 1143000, 5486400, 3086100)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>${phShape({ id: 3, name: "Notes Placeholder 2", ph: '<p:ph type="body" sz="quarter" idx="3"/>', x: 685800, y: 4400550, w: 5486400, h: 3600450, paras: '<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Notes</a:t></a:r></a:p>', autofit: false })}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:notesStyle><a:lvl1pPr marL="0" algn="l" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
const relsXml = (list) => `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;

/** A real .pptx from markdown: one slide per "## " heading, a leading "# " as the title slide, "Notes:" as speaker notes. */
export function pptxFromMarkdown(md, { title = "" } = {}) {
  const slides = markdownSlides(md, { title });
  if (!slides.length) slides.push({ kind: "title", title: title || "Presentation", subtitle: [], notes: "" });
  const n = slides.length;
  const withNotes = slides.map((s, i) => (s.notes ? i + 1 : 0)).filter(Boolean);
  const hasNotes = withNotes.length > 0;
  const deckTitle = title || slides[0].title || "Presentation";
  // presentation.xml.rels: rId1 the master, rId2..rId(n+1) the slides, then the rest
  const after = n + 2;
  const presRels = [["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ...slides.map((_, i) => [`rId${i + 2}`, "slide", `slides/slide${i + 1}.xml`]), [`rId${after}`, "presProps", "presProps.xml"], [`rId${after + 1}`, "viewProps", "viewProps.xml"], [`rId${after + 2}`, "theme", "theme/theme1.xml"], [`rId${after + 3}`, "tableStyles", "tableStyles.xml"], ...(hasNotes ? [[`rId${after + 4}`, "notesMaster", "notesMasters/notesMaster1.xml"]] : [])];
  const presentation = `${XML_HEAD}<p:presentation ${P_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="rId${after + 4}"/></p:notesMasterIdLst>` : ""}<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const ov = (part, type) => `<Override PartName="${part}" ContentType="${CT}.${type}"/>`;
  const types = [
    ov("/ppt/presentation.xml", "presentationml.presentation.main+xml"),
    ov("/ppt/slideMasters/slideMaster1.xml", "presentationml.slideMaster+xml"),
    ov("/ppt/slideLayouts/slideLayout1.xml", "presentationml.slideLayout+xml"),
    ov("/ppt/slideLayouts/slideLayout2.xml", "presentationml.slideLayout+xml"),
    ...slides.map((_, i) => ov(`/ppt/slides/slide${i + 1}.xml`, "presentationml.slide+xml")),
    ov("/ppt/theme/theme1.xml", "theme+xml"),
    ...(hasNotes ? [ov("/ppt/theme/theme2.xml", "theme+xml"), ov("/ppt/notesMasters/notesMaster1.xml", "presentationml.notesMaster+xml"), ...withNotes.map((k) => ov(`/ppt/notesSlides/notesSlide${k}.xml`, "presentationml.notesSlide+xml"))] : []),
    ov("/ppt/presProps.xml", "presentationml.presProps+xml"),
    ov("/ppt/viewProps.xml", "presentationml.viewProps+xml"),
    ov("/ppt/tableStyles.xml", "presentationml.tableStyles+xml"),
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    ov("/docProps/app.xml", "extended-properties+xml"),
  ].join("");
  const files = [
    { name: "[Content_Types].xml", data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types}</Types>` },
    { name: "_rels/.rels", data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: "docProps/core.xml", data: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(deckTitle)}</dc:title><dc:creator>Meldmind</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: "docProps/app.xml", data: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Meldmind</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${n}</Slides><Notes>${withNotes.length}</Notes></Properties>` },
    { name: "ppt/presentation.xml", data: presentation },
    { name: "ppt/_rels/presentation.xml.rels", data: relsXml(presRels) },
    { name: "ppt/presProps.xml", data: `${XML_HEAD}<p:presentationPr ${P_NS}/>` },
    { name: "ppt/viewProps.xml", data: `${XML_HEAD}<p:viewPr ${P_NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>` },
    { name: "ppt/tableStyles.xml", data: `${XML_HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>` },
    { name: "ppt/theme/theme1.xml", data: THEME },
    { name: "ppt/slideMasters/slideMaster1.xml", data: MASTER },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: relsXml([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "slideLayout", "../slideLayouts/slideLayout2.xml"], ["rId3", "theme", "../theme/theme1.xml"]]) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: LAYOUT_TITLE },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: relsXml([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]) },
    { name: "ppt/slideLayouts/slideLayout2.xml", data: LAYOUT_CONTENT },
    { name: "ppt/slideLayouts/_rels/slideLayout2.xml.rels", data: relsXml([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]) },
    ...slides.flatMap((s, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(s) },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: relsXml([["rId1", "slideLayout", `../slideLayouts/slideLayout${s.kind === "title" ? 1 : 2}.xml`], ...(s.notes ? [["rId2", "notesSlide", `../notesSlides/notesSlide${i + 1}.xml`]] : [])]) },
      ...(s.notes ? [
        { name: `ppt/notesSlides/notesSlide${i + 1}.xml`, data: notesXml(s.notes) },
        { name: `ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, data: relsXml([["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", `../slides/slide${i + 1}.xml`]]) },
      ] : []),
    ]),
    ...(hasNotes ? [
      { name: "ppt/theme/theme2.xml", data: THEME },
      { name: "ppt/notesMasters/notesMaster1.xml", data: NOTES_MASTER },
      { name: "ppt/notesMasters/_rels/notesMaster1.xml.rels", data: relsXml([["rId1", "theme", "../theme/theme2.xml"]]) },
    ] : []),
  ];
  return zip(files);
}
