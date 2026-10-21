// PDF and DOCX export that keeps headings, bold, italic, lists, and code.
// No network and no extra package. The file is a download. Nothing is sent.
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(entries) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const chunk = Buffer.concat([local, name, data]);
    parts.push(chunk);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += chunk.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

function xml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineRuns(text) {
  const src = String(text ?? "");
  const runs = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g;
  let i = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > i) runs.push({ text: src.slice(i, m.index) });
    if (m[2] != null) runs.push({ text: m[2], bold: true });
    else if (m[3] != null) runs.push({ text: m[3], italic: true });
    else runs.push({ text: m[4], code: true });
    i = m.index + m[0].length;
  }
  if (i < src.length) runs.push({ text: src.slice(i) });
  return runs.filter((r) => r.text);
}

export function parseDocument(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { body.push(lines[i]); i++; }
      if (i < lines.length) i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: `h${h[1].length}`, text: h[2] }); i++; continue; }
    if (/^[-*] /.test(line)) {
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        blocks.push({ type: "li", text: lines[i].replace(/^[-*] /, "") });
        i++;
      }
      continue;
    }
    if (/^\d+\. /.test(line)) {
      let n = 1;
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        blocks.push({ type: "ol", n, text: lines[i].replace(/^\d+\. /, "") });
        i++; n++;
      }
      continue;
    }
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*] |\d+\. |```)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

function docxRuns(text, { bold = false, code = false } = {}) {
  return inlineRuns(text).map((r) => {
    const props = [];
    if (bold || r.bold) props.push("<w:b/>");
    if (r.italic) props.push("<w:i/>");
    if (code || r.code) props.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>');
    const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
    return `<w:r>${rPr}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
  }).join("");
}

function docxParagraph(block) {
  if (block.type === "h1" || block.type === "h2" || block.type === "h3") {
    const style = block.type === "h1" ? "Heading1" : block.type === "h2" ? "Heading2" : "Heading3";
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${docxRuns(block.text, { bold: true })}</w:p>`;
  }
  if (block.type === "li") {
    return `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>${docxRuns(block.text)}</w:p>`;
  }
  if (block.type === "ol") {
    return `<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr>${docxRuns(`${block.n}. ${block.text}`)}</w:p>`;
  }
  if (block.type === "code") {
    return String(block.text).split("\n").map((line) => `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${docxRuns(line || " ", { code: true })}</w:p>`).join("");
  }
  return `<w:p>${docxRuns(block.text)}</w:p>`;
}

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="160" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

export function toDocx({ title = "Meldmind", markdown = "" } = {}) {
  const blocks = parseDocument(markdown);
  if (title && !blocks.some((b) => b.type === "h1" && b.text === title)) blocks.unshift({ type: "h1", text: title });
  const body = blocks.map(docxParagraph).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: types },
    { name: "_rels/.rels", data: rels },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/styles.xml", data: DOCX_STYLES },
    { name: "word/document.xml", data: document },
  ]);
}

export function docxDocumentXml(buf) {
  const xmlBuf = unzipStored(buf, "word/document.xml");
  return xmlBuf ? xmlBuf.toString("utf8") : "";
}

function unzipStored(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) return data;
    if (method === 8) return zlib.inflateRawSync(data);
  }
  return null;
}

function pdfEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?");
}

function wrapRuns(runs, size, width) {
  const max = Math.max(8, Math.floor(width / (size * 0.52)));
  const lines = [];
  let line = [];
  let len = 0;
  const push = () => { if (line.length) { lines.push(line); line = []; len = 0; } };
  for (const run of runs) {
    const words = String(run.text).split(/(\s+)/);
    for (const word of words) {
      if (!word) continue;
      if (len && len + word.length > max && word.trim()) push();
      line.push({ ...run, text: word });
      len += word.length;
    }
  }
  push();
  return lines;
}

function pdfLine(runs, fontFallback) {
  const chunks = [];
  let font = "";
  for (const run of runs) {
    const next = run.code ? "F3" : (run.bold ? "F2" : run.italic ? "F4" : fontFallback);
    if (next !== font) { chunks.push(`/${next} ${run.size} Tf`); font = next; }
    chunks.push(`(${pdfEscape(run.text)}) Tj`);
  }
  return chunks.join(" ");
}

export function toPdf({ title = "Meldmind", markdown = "" } = {}) {
  const blocks = parseDocument(markdown);
  if (title && !(blocks[0]?.type === "h1" && blocks[0].text === title)) blocks.unshift({ type: "h1", text: title });
  const pages = [];
  let cmds = [];
  let y = 740;
  const margin = 54;
  const pageW = 612;
  const width = pageW - margin * 2;
  const newPage = () => { if (cmds.length) pages.push(cmds.join("\n")); cmds = []; y = 740; };
  const ensure = (h) => { if (y - h < 54) newPage(); };
  for (const block of blocks) {
    const heading = block.type === "h1" || block.type === "h2" || block.type === "h3";
    const size = block.type === "h1" ? 18 : block.type === "h2" ? 14 : block.type === "h3" ? 12 : block.type === "code" ? 10 : 11;
    const gap = heading ? 16 : 8;
    const runsIn = block.type === "code"
      ? String(block.text).split("\n").map((line) => [{ text: line || " ", code: true, size }])
      : [inlineRuns(block.type === "ol" ? `${block.n}. ${block.text}` : block.type === "li" ? `- ${block.text}` : block.text).map((r) => ({ ...r, bold: r.bold || heading, size }))];
    for (const runs of runsIn) {
      const lines = wrapRuns(runs.length ? runs : [{ text: " ", size }], size, width - (block.type === "li" || block.type === "ol" || block.type === "code" ? 16 : 0));
      for (const line of lines) {
        ensure(size + 4);
        y -= size + 3;
        const x = margin + (block.type === "li" || block.type === "ol" || block.type === "code" ? 16 : 0);
        cmds.push("BT");
        cmds.push(`1 0 0 1 ${x} ${y} Tm`);
        cmds.push(pdfLine(line.map((r) => ({ ...r, size })), heading ? "F2" : "F1"));
        cmds.push("ET");
      }
    }
    y -= gap;
  }
  if (cmds.length || !pages.length) pages.push(cmds.join("\n") || "BT /F1 11 Tf 54 740 Td ( ) Tj ET");

  const objects = [];
  const fontStart = 3;
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>";
  const pageIds = [];
  let next = 7;
  for (const stream of pages) {
    const contentId = next++;
    const pageId = next++;
    pageIds.push(pageId);
    const body = Buffer.from(stream);
    objects[contentId - 1] = `<< /Length ${body.length} >>\nstream\n${stream}\nendstream`;
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontStart} 0 R /F2 ${fontStart + 1} 0 R /F3 ${fontStart + 2} 0 R /F4 ${fontStart + 3} 0 R >> >> >>`;
  }
  objects[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  const packed = [];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    if (!objects[i]) continue;
    offsets[i + 1] = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    packed.push(i + 1);
  }
  const xref = Buffer.byteLength(out);
  const size = objects.length + 1;
  out += `xref\n0 ${size}\n`;
  out += "0000000000 65535 f \n";
  for (let i = 1; i < size; i++) out += `${String(offsets[i] || 0).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

export function pdfPageCount(buf) {
  const text = buf.toString("latin1");
  return (text.match(/\/Type \/Page\b/g) || []).length;
}

export function fileSlug(title) {
  const s = String(title || "meldmind").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return s || "meldmind";
}
