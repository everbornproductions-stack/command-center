// Headline text on an image, made inside Meldmind (0.4.21, dogfood 02): a real PNG, not a script to run.
// No native packages: node:zlib reads and writes the PNG, and the letters come from a small Montserrat ExtraBold
// alpha atlas (server/overlay-font.json, SIL Open Font License) that is scaled with bilinear sampling.
// Reads 8-bit PNGs (gray, RGB, palette, with alpha), not interlaced. JPEG and WebP sources are drawn in the page
// with a canvas instead (web/overlay.js) and the finished PNG is saved through savePng().
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_PIXELS = 36_000_000;
export const isPng = (b) => Buffer.isBuffer(b) && b.length > 33 && b.subarray(0, 8).equals(SIG);

const bad = (msg, code = "overlay") => Object.assign(new Error(msg), { code, status: 400 });

// ---------- PNG read ----------
function crcTable() { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const CRC = crcTable();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function decodePng(buf) {
  if (!isPng(buf)) throw bad("That is not a PNG picture.", "not_png");
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("latin1", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!w || !h) throw bad("The PNG header is damaged.", "bad_png");
  if (w * h > MAX_PIXELS) throw bad("That picture is too big to add text to here.", "too_big");
  if (interlace) throw bad("This PNG is interlaced. Add the headline in the picture editor instead.", "interlaced");
  if (depth !== 8) throw bad("Only 8-bit PNG pictures are supported here.", "depth");
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!chans) throw bad("This PNG type is not supported here.", "ctype");
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { throw bad("The PNG data is damaged.", "bad_png"); }
  const stride = w * chans, out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= chans ? cur[x - chans] : 0, b = prev[x], c = x >= chans ? prev[x - chans] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  // to RGBA
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const s = i * chans;
    if (ctype === 6) { rgba[p] = out[s]; rgba[p + 1] = out[s + 1]; rgba[p + 2] = out[s + 2]; rgba[p + 3] = out[s + 3]; }
    else if (ctype === 2) { rgba[p] = out[s]; rgba[p + 1] = out[s + 1]; rgba[p + 2] = out[s + 2]; rgba[p + 3] = 255; }
    else if (ctype === 0) { rgba[p] = rgba[p + 1] = rgba[p + 2] = out[s]; rgba[p + 3] = 255; }
    else if (ctype === 4) { rgba[p] = rgba[p + 1] = rgba[p + 2] = out[s]; rgba[p + 3] = out[s + 1]; }
    else { const k = out[s]; rgba[p] = plte?.[k * 3] ?? 0; rgba[p + 1] = plte?.[k * 3 + 1] ?? 0; rgba[p + 2] = plte?.[k * 3 + 2] ?? 0; rgba[p + 3] = trns && k < trns.length ? trns[k] : 255; }
  }
  return { w, h, rgba };
}

// ---------- PNG write ----------
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
export function encodePng({ w, h, rgba }) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- the font ----------
let FONT = null;
function font() {
  if (FONT) return FONT;
  const j = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "overlay-font.json"), "utf8"));
  FONT = { ...j, bits: zlib.inflateSync(Buffer.from(j.alpha, "base64")) };
  return FONT;
}
const SUBS = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-" };
function glyphOf(F, ch) {
  const g = F.glyphs[ch.codePointAt(0)] || F.glyphs[(SUBS[ch] || "?").codePointAt(0)];
  return g;
}
export function textWidth(text, px) {
  const F = font(), s = px / F.size;
  let w = 0;
  for (const ch of String(text)) w += (glyphOf(F, ch)?.[0] || 0) * s;
  return w;
}
export function wrapLines(text, px, maxW) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (textWidth(t, px) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function blend(buf, w, h, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
  const p = (y * w + x) * 4, ia = 1 - a;
  buf[p] = Math.round(buf[p] * ia + r * a); buf[p + 1] = Math.round(buf[p + 1] * ia + g * a); buf[p + 2] = Math.round(buf[p + 2] * ia + b * a);
  buf[p + 3] = Math.min(255, Math.round(buf[p + 3] + (255 - buf[p + 3]) * a));
}
function drawGlyph(img, F, g, penX, baseY, px, color, alphaMul, dx = 0, dy = 0) {
  const [, l, t, gw, gh, off] = g;
  if (!gw || !gh) return;
  const s = px / F.size;
  const x0 = Math.floor(penX + l * s + dx), y0 = Math.floor(baseY + t * s + dy);
  const dw = Math.max(1, Math.ceil(gw * s)), dh = Math.max(1, Math.ceil(gh * s));
  for (let yy = 0; yy < dh; yy++) {
    const sy = Math.min(gh - 1.001, Math.max(0, (yy + 0.5) / s - 0.5)), sy0 = Math.floor(sy), fy = sy - sy0;
    for (let xx = 0; xx < dw; xx++) {
      const sx = Math.min(gw - 1.001, Math.max(0, (xx + 0.5) / s - 0.5)), sx0 = Math.floor(sx), fx = sx - sx0;
      const i = off + sy0 * gw + sx0;
      const v = F.bits[i] * (1 - fx) * (1 - fy) + F.bits[i + 1] * fx * (1 - fy) + (F.bits[i + gw] ?? 0) * (1 - fx) * fy + (F.bits[i + gw + 1] ?? 0) * fx * fy;
      blend(img.rgba, img.w, img.h, x0 + xx, y0 + yy, color[0], color[1], color[2], (v / 255) * alphaMul);
    }
  }
}

const hex = (c, d = [255, 255, 255]) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "")); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : d; };

/**
 * Put a headline on a decoded image. opts: position top|center|bottom, color "#rrggbb", maxLines (4), band (true).
 * Returns { w, h, rgba, lines, px }. The input is not changed.
 */
export function drawHeadline(img, text, opts = {}) {
  const F = font();
  const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (!t) throw bad("Write the headline to put on the picture.", "no_text");
  const out = { w: img.w, h: img.h, rgba: Buffer.from(img.rgba) };
  const margin = Math.round(img.w * 0.07), maxW = img.w - margin * 2, maxLines = Math.max(1, Math.min(6, opts.maxLines || 4));
  let px = Math.round(img.w * 0.095), lines = wrapLines(t, px, maxW);
  const minPx = Math.round(img.w * 0.04);
  while ((lines.length > maxLines || lines.some((l) => textWidth(l, px) > maxW)) && px > minPx) { px = Math.round(px * 0.92); lines = wrapLines(t, px, maxW); }
  lines = lines.slice(0, maxLines);
  const lead = Math.round(px * 1.18), blockH = lines.length * lead;
  const pos = ["top", "center", "bottom"].includes(opts.position) ? opts.position : "bottom";
  const top = pos === "top" ? margin : pos === "center" ? Math.round((img.h - blockH) / 2) : img.h - margin - blockH;
  // a soft dark band behind the words so they read on any picture
  if (opts.band !== false) {
    const pad = Math.round(px * 1.3), u0 = top - pad, u1 = top + blockH + pad, b0 = Math.max(0, u0), b1 = Math.min(img.h, u1);
    for (let y = b0; y < b1; y++) {
      const e = Math.min(y - u0, u1 - y) / pad; // 0 at the unclipped edges, 1 inside (an edge off the picture does not fade)
      const a = 0.62 * Math.min(1, Math.max(0, e));
      for (let x = 0; x < img.w; x++) blend(out.rgba, img.w, img.h, x, y, 0, 0, 0, a);
    }
  }
  const color = hex(opts.color), shadow = Math.max(1, Math.round(px * 0.03));
  lines.forEach((line, k) => {
    const w = textWidth(line, px);
    let pen = opts.align === "left" ? margin : Math.round((img.w - w) / 2);
    const base = top + k * lead; // glyph tops are measured from the line top
    for (const ch of line) {
      const g = glyphOf(F, ch);
      if (!g) continue;
      drawGlyph(out, F, g, pen, base, px, [0, 0, 0], 0.55, shadow, shadow);
      drawGlyph(out, F, g, pen, base, px, color, 1);
      pen += g[0] * (px / F.size);
    }
  });
  return { ...out, lines, px };
}

/** A PNG buffer in, a PNG buffer out. */
export function overlayPng(buf, text, opts = {}) {
  const img = decodePng(buf);
  const r = drawHeadline(img, text, opts);
  return { png: encodePng(r), w: r.w, h: r.h, lines: r.lines, px: r.px };
}

// a blank 1080x1080 warm gradient, for a headline card when there is no picture at all
export function gradientPng(w = 1080, h = 1080, c1 = "#2b1d12", c2 = "#a8672d") {
  const a = hex(c1), b = hex(c2), rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (x / w + y / h) / 2, p = (y * w + x) * 4; for (let i = 0; i < 3; i++) rgba[p + i] = Math.round(a[i] + (b[i] - a[i]) * k); rgba[p + 3] = 255; }
  return encodePng({ w, h, rgba });
}

// ---------- the headline a task asks for ----------
const HEAD_RE = /(?:head\s?line|title|text|tagline|slogan|says?|reads?|wording|words?|caption)\b[^"“”'\n]{0,30}?["“]([^"”\n]{3,120})["”]/i;
const HEAD_RE2 = /(?:head\s?line|title|text|tagline|slogan|says?|reads?)\s*(?:is|:)\s*["“']?([^"”'\n.][^"”\n]{2,100}?)["”']?(?:\.|,|\n|$)/i;
export function extractHeadline(goal) {
  const g = String(goal || "");
  const q = HEAD_RE.exec(g);
  const m = q || HEAD_RE2.exec(g);
  const t = m ? (q ? m[1].trim() : m[1].trim().replace(/[.,]+$/, "")) : "";
  return t.length >= 3 ? t : "";
}

// ---------- saving a finished PNG (from the server compositor or from the page's canvas) ----------
export function dataUrlToPng(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!m) throw bad("Send the picture as a PNG data address.", "bad_data");
  const buf = Buffer.from(m[1], "base64");
  if (!isPng(buf)) throw bad("That is not a PNG picture.", "not_png");
  if (buf.length > 12_000_000) throw bad("That picture is too big (12 MB at most).", "too_big");
  return buf;
}
