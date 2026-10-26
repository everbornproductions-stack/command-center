// Cited report export. A small PDF and a Word .docx, built with Node only.
// No network and no extra package. The PDF is plain text operators so it stays readable.
import zlib from "node:zlib";

const xml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
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

function paragraphs(text) {
  return String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

// ---- Markdown to plain blocks (0.4.21): headings, bullets, numbers, fenced code and **bold** / *italic* / `code`,
// so the PDF and Word file read like the answer instead of showing # and * marks.
function inlineRuns(raw) {
  let t = String(raw || "").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)");
  const runs = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*[^*\n]+\*(?!\w))/g;
  let last = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > last) runs.push({ text: t.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) runs.push({ text: tok.slice(2, -2), b: true });
    else if (tok.startsWith("`")) runs.push({ text: tok.slice(1, -1), c: true });
    else runs.push({ text: tok.slice(1, -1), i: true });
    last = m.index + tok.length;
  }
  if (last < t.length) runs.push({ text: t.slice(last) });
  return runs.length ? runs : [{ text: "" }];
}
export function mdBlocks(text) {
  const out = [];
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let para = [];
  const flush = () => { if (para.length) { out.push({ t: "p", runs: inlineRuns(para.join(" ")) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*(```|~~~)/.test(lines[i])) { code.push(lines[i]); i++; }
      out.push({ t: "code", lines: code });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    const li = /^(\s*)([-*+])\s+(.*)$/.exec(line);
    const ol = /^(\s*)(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (/^Sources$/.test(line.trim())) { flush(); out.push({ t: "h", l: 2, runs: [{ text: "Sources" }] }); }
    else if (h) { flush(); out.push({ t: "h", l: Math.min(h[1].length, 3), runs: inlineRuns(h[2]) }); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ t: "hr" }); }
    else if (li) { flush(); out.push({ t: "li", mark: "-", runs: inlineRuns(li[3]), depth: Math.min(2, Math.floor(li[1].length / 2)) }); }
    else if (ol) { flush(); out.push({ t: "li", mark: `${ol[2]}.`, runs: inlineRuns(ol[3]), depth: Math.min(2, Math.floor(ol[1].length / 2)) }); }
    else para.push(line.trim());
  }
  flush();
  return out;
}
const plain = (runs) => runs.map((r) => r.text).join("");

export function reportDocx({ title, body }) {
  const run = (r, extra = "") => `<w:r><w:rPr>${r.c ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : ""}${r.b || extra.includes("b") ? "<w:b/>" : ""}${r.i ? "<w:i/>" : ""}${extra.replace("b", "")}</w:rPr><w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
  const para = (inner, ppr = "") => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${inner}</w:p>`;
  const parts = [];
  if (title) parts.push(para(run({ text: title }, '<w:sz w:val="40"/>b'), '<w:spacing w:after="200"/>'));
  for (const b of mdBlocks(body)) {
    if (b.t === "h") parts.push(para(b.runs.map((r) => run(r, `<w:sz w:val="${b.l === 1 ? 34 : b.l === 2 ? 30 : 26}"/>b`)).join(""), '<w:spacing w:before="200" w:after="80"/>'));
    else if (b.t === "p") parts.push(para(b.runs.map((r) => run(r)).join(""), '<w:spacing w:after="120"/>'));
    else if (b.t === "li") parts.push(para(run({ text: `${b.mark === "-" ? "•" : b.mark} ` }) + b.runs.map((r) => run(r)).join(""), `<w:ind w:left="${360 + b.depth * 360}" w:hanging="260"/><w:spacing w:after="60"/>`));
    else if (b.t === "code") for (const ln of b.lines.length ? b.lines : [""]) parts.push(para(run({ text: ln, c: true }, '<w:sz w:val="20"/>'), '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="0"/>'));
    else if (b.t === "hr") parts.push(para("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>'));
  }
  const xmlBody = parts.join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xmlBody}</w:body></w:document>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(types) },
    { name: "_rels/.rels", data: Buffer.from(rels) },
    { name: "word/document.xml", data: Buffer.from(document) },
  ]);
}

const pdfEscape = (s) => String(s || "").replace(/\t/g, "    ").replace(/[^\x20-\x7E]/g, " ").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function wrapText(text, width) {
  const out = [];
  let rest = String(text || "").trim();
  if (!rest) return [""];
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < Math.floor(width / 3)) cut = width;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trim();
  }
  out.push(rest);
  return out;
}

// Lines for the PDF: { text, font: 1 normal | 2 bold | 3 code, size, indent, gap }
function pdfLines(title, body) {
  const L = [];
  if (title) for (const t of wrapText(title, 55)) L.push({ text: t, font: 2, size: 18, indent: 0, gap: 0 });
  if (title) L.push({ text: "", font: 1, size: 11, indent: 0, gap: 0 });
  for (const b of mdBlocks(body)) {
    if (b.t === "h") { L.push({ text: "", font: 1, size: 8, indent: 0, gap: 0 }); for (const t of wrapText(plain(b.runs), b.l === 1 ? 55 : 65)) L.push({ text: t, font: 2, size: b.l === 1 ? 16 : b.l === 2 ? 14 : 12, indent: 0 }); }
    else if (b.t === "p") { for (const t of wrapText(plain(b.runs), 92)) L.push({ text: t, font: 1, size: 11, indent: 0 }); L.push({ text: "", font: 1, size: 6, indent: 0 }); }
    else if (b.t === "li") { const ws = wrapText(plain(b.runs), 86 - b.depth * 4); ws.forEach((t, i) => L.push({ text: (i === 0 ? `${b.mark} ` : "  ") + t, font: 1, size: 11, indent: 14 + b.depth * 14 })); }
    else if (b.t === "code") { for (const ln of b.lines.length ? b.lines : [""]) for (const t of (ln.length > 88 ? ln.match(/.{1,88}/g) : [ln])) L.push({ text: t, font: 3, size: 9.5, indent: 8 }); L.push({ text: "", font: 1, size: 6, indent: 0 }); }
    else if (b.t === "hr") L.push({ text: "-".repeat(60), font: 1, size: 9, indent: 0 });
  }
  return L;
}

export function reportPdf({ title, body }) {
  const lines = pdfLines(title || "Research report", body || "");
  const pages = [];
  let ops = [], y = 750;
  const newPage = () => { if (ops.length) pages.push(ops.join("\n")); ops = ["BT"]; y = 750; };
  newPage();
  for (const ln of lines) {
    const lead = Math.round(ln.size * 1.3);
    if (y - lead < 48) { ops.push("ET"); newPage(); }
    ops.push(`/F${ln.font} ${ln.size} Tf`);
    ops.push(`1 0 0 1 ${54 + ln.indent} ${y} Tm (${pdfEscape(ln.text)}) Tj`);
    y -= lead;
  }
  ops.push("ET");
  pages.push(ops.join("\n"));
  const pageCount = Math.min(pages.length, 60);
  const objects = [];
  const kids = [];
  for (let i = 0; i < pageCount; i++) kids.push(`${6 + i * 2} 0 R`);
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push(`2 0 obj << /Type /Pages /Count ${pageCount} /Kids [${kids.join(" ")}] >> endobj\n`);
  objects.push("3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n");
  objects.push("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n");
  objects.push("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj\n");
  for (let i = 0; i < pageCount; i++) {
    const stream = pages[i];
    objects.push(`${6 + i * 2} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${7 + i * 2} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >> endobj\n`);
    objects.push(`${7 + i * 2} 0 obj << /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`);
  }
  let pdf = "%PDF-1.4\n";
  const xref = [0];
  for (const obj of objects) {
    xref.push(Buffer.byteLength(pdf));
    pdf += obj;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${xref.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < xref.length; i++) pdf += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export function safeFileName(title, ext) {
  const base = String(title || "research-report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "research-report";
  return `${base}.${ext}`;
}
