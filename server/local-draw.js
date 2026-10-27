// Local drawing route (0.4.21, dogfood 13). With no image AI connected, a flat graphic (quote card, banner, simple poster)
// is drawn here: an SVG built from the headline, colors and size in the task, then turned into a PNG by the desktop
// app (globalThis.__ccSvgRenderer, set by electron/main.cjs). Without the desktop app the SVG is saved and the PNG step
// is "Not made". A file is only reported after it is read back from disk.
import fs from "node:fs";
import path from "node:path";
import { saveToMindMedia, safeMediaDir } from "./project-media.js";
import { projectFolders } from "./code-source.js";
import { insideFolder } from "./named-file.js";
import { diskLine, onDisk } from "./step-guard.js";
export { diskLine };

const FLAT = /\b(quote\s*cards?|quote\s*graphics?|text\s*cards?|title\s*cards?|social\s*cards?|banners?|flat\s*graphics?|simple\s*(poster|graphic|card)s?|posters?|announcement\s*(card|graphic)s?)\b/i;
const NOT_FLAT = /\b(photo|photograph|photorealistic|realistic|portrait of|painting|3d|cinematic|illustration of|mockup|logo)\b/i;
/** Can Meldmind draw this itself, without an image AI? Only flat, text-led graphics. */
export function isFlatGraphic(goal) { const g = String(goal || ""); return FLAT.test(g) && !NOT_FLAT.test(g); }

export const SVG_ONLY_LINE = "Saved as SVG, PNG needs the desktop app.";
export const NOT_MADE = "Not made";

const NAMED_PNG = /([A-Za-z0-9_][\w.\\/-]{0,100}\.(?:png|jpe?g))\b/i;
/** The picture path a task names ("save to scratch-13\\quote-card.png"), or "". */
export function namedImage(goal) {
  const m = NAMED_PNG.exec(String(goal || ""));
  if (!m) return "";
  return m[1].replace(/\\/g, "/").replace(/\.jpe?g$/i, ".png");
}

/** { w, h } from "1080x1080", else a banner shape, else square. */
export function sizeFrom(goal) {
  const m = /\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/i.exec(String(goal || ""));
  if (m) return { w: Math.min(4000, +m[1]), h: Math.min(4000, +m[2]) };
  if (/\bbanner\b/i.test(goal)) return { w: 1500, h: 500 };
  return { w: 1080, h: 1080 };
}

const COLORS = {
  navy: "#0b1f3a", "dark navy": "#0b1f3a", black: "#0d0d0d", white: "#ffffff", gold: "#c9a227", red: "#c0392b", blue: "#1f5fbf",
  green: "#1e7a46", teal: "#12807a", purple: "#5b3a9d", pink: "#d6457f", orange: "#e07a1f", yellow: "#f2c200", gray: "#6b7280", grey: "#6b7280",
  cream: "#f6efe0", beige: "#e9dcc3", silver: "#c0c4cc", brown: "#6b4226",
};
const LIGHT = new Set(["white", "cream", "beige", "yellow", "silver"]);
/** Brand colors from the task: hex codes first, else color words. bg is the first dark or named background. */
export function colorsFrom(goal) {
  const g = String(goal || "");
  const hex = g.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || [];
  const out = { bg: "#0b1f3a", accent: "#c9a227", fg: "#ffffff" };
  if (hex.length) { out.bg = hex[0]; if (hex[1]) out.accent = hex[1]; if (hex[2]) out.fg = hex[2]; return out; }
  const bgM = /\b(dark navy|navy|black|dark blue|blue|red|green|teal|purple|pink|orange|gray|grey|brown|cream|beige|white)\b(?:\s+(?:background|card|bg))?/i.exec(g);
  if (bgM) { const k = bgM[1].toLowerCase().replace("dark blue", "navy"); out.bg = COLORS[k] || out.bg; if (LIGHT.has(k)) out.fg = "#14213d"; }
  if (/\bgold\b/i.test(g)) out.accent = COLORS.gold;
  else { const a = /\b(gold|silver|red|orange|yellow|teal|pink)\b/i.exec(g); if (a) out.accent = COLORS[a[1].toLowerCase()]; }
  return out;
}

const QUOTE = /["“]([^"”\n]{2,300})["”]/g;
/** The headline (first quoted text) and the small caps line (a quoted ALL CAPS text), from the task. */
export function textFrom(goal) {
  const quotes = [...String(goal || "").matchAll(QUOTE)].map((m) => m[1].trim()).filter((q) => !/\.(png|jpe?g|svg)$/i.test(q));
  const isCaps = (q) => q === q.toUpperCase() && /[A-Z]/.test(q);
  const footer = quotes.find(isCaps) || "";
  const headline = quotes.find((q) => !isCaps(q) || q === quotes[0]) || "";
  return { headline: headline === footer && quotes.length > 1 ? quotes.find((q) => q !== footer) || headline : headline, footer: footer === headline ? "" : footer };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function wrap(text, maxChars) {
  const lines = [];
  let cur = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (cur && (cur + " " + word).length > maxChars) { lines.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** One flat SVG from a headline, a small caps line, colors and size. A thin accent frame, centered serif headline. */
export function buildSvg({ headline = "", footer = "", w = 1080, h = 1080, bg = "#0b1f3a", accent = "#c9a227", fg = "#ffffff" } = {}) {
  const pad = Math.round(Math.min(w, h) * 0.07);
  const inner = w - pad * 3;
  let size = Math.round(Math.min(w, h) * 0.085), lines = [];
  for (; size >= 18; size -= 2) {
    lines = wrap(headline, Math.max(8, Math.floor(inner / (size * 0.5))));
    if (lines.length * size * 1.3 <= (h - pad * 5)) break;
  }
  const lh = Math.round(size * 1.3);
  const y0 = Math.round(h / 2 - ((lines.length - 1) * lh) / 2 + size * 0.3);
  const text = lines.map((l, i) => `<text x="${w / 2}" y="${y0 + i * lh}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" fill="${esc(fg)}">${esc(l)}</text>`).join("\n  ");
  const fs2 = Math.max(14, Math.round(Math.min(w, h) * 0.026));
  const foot = footer ? `<text x="${w / 2}" y="${h - pad * 1.6}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fs2}" letter-spacing="${Math.round(fs2 * 0.25)}" fill="${esc(accent)}">${esc(footer.toUpperCase())}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${esc(bg)}"/>
  <rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" fill="none" stroke="${esc(accent)}" stroke-width="${Math.max(2, Math.round(w / 360))}"/>
  ${text}
  ${foot}
</svg>
`;
}

/** The SVG for a task, from its own words. Returns { svg, w, h, headline } or null when the task has no headline text. */
export function svgForGoal(goal) {
  const { headline, footer } = textFrom(goal);
  if (!headline) return null;
  const { w, h } = sizeFrom(goal);
  return { svg: buildSvg({ headline, footer, w, h, ...colorsFrom(goal) }), w, h, headline };
}

const isPng = (b) => Buffer.isBuffer(b) && b.length > 67 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
/** Is there a way to turn an SVG into a PNG here? The desktop app sets it. */
export const canRenderPng = (hooks = {}) => typeof (hooks.render || globalThis.__ccSvgRenderer) === "function";

/** What the person is told at planning time about drawing locally. */
export function localDrawNote(hooks = {}) {
  return canRenderPng(hooks)
    ? "No image AI is connected, so Meldmind draws this flat graphic itself on this PC and saves a PNG."
    : `No image AI is connected, so Meldmind draws this flat graphic itself. ${SVG_ONLY_LINE} Add an image key in Settings to get a PNG here.`;
}

/** Why an image cannot be made, and what to add. Used when no route works. */
export function cantMakeImageLine(setup) {
  return `I can't make this image: no image AI is connected, and Meldmind can only draw flat graphics like quote cards and banners on its own. ${setup}`;
}

function uniquePath(file) {
  const dir = path.dirname(file), ext = path.extname(file), base = path.basename(file, ext);
  let f = file;
  for (let n = 2; fs.existsSync(f) && n < 200; n++) f = path.join(dir, `${base}-${n}${ext}`);
  return f;
}
// read a written file back: the size on disk, never the size we meant to write
function checkOnDisk(file, png) {
  try {
    const st = onDisk(file);
    if (!st.exists) return st;
    if (png) { const fd = fs.openSync(file, "r"); const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd); if (!head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { exists: false, bytes: st.bytes }; }
    return st;
  } catch { return { exists: false, bytes: 0 }; }
}
/**
 * Draw the goal and save it. name: the picture path the task names (".png"), else "image.png".
 * Returns { ok, pngMade, line, png: {name, path, bytes}|null, svg: {name, path, bytes}|null, disk }.
 * ok is true only when the PNG exists on disk. Nothing here claims a file that stat did not find.
 */
export async function drawLocally({ goal = "", svg, name, projectId = "", missionId = "", render, hooks = {} } = {}) {
  const made = svg ? { svg, w: sizeFrom(goal).w, h: sizeFrom(goal).h } : svgForGoal(goal);
  if (!made) return { ok: false, pngMade: false, png: null, svg: null, line: `${NOT_MADE}: the task has no headline text in quotes to draw.`, disk: "" };
  const want = String(name || namedImage(goal) || "image.png").replace(/\\/g, "/");
  const pid = String(projectId || "") || "unfiled";
  let dir;
  let rel = want;
  const folders = projectId ? (() => { try { return projectFolders(projectId); } catch { return []; } })() : [];
  if (folders.length && insideFolder(folders[0], want)) dir = path.resolve(folders[0]);
  else {
    try { dir = safeMediaDir(pid); } catch (e) { return { ok: false, pngMade: false, png: null, svg: null, line: `${NOT_MADE}: ${String(e.message || e).slice(0, 120)}`, disk: "" }; }
    rel = path.basename(want);
  }
  const pngTarget = uniquePath(path.join(dir, rel));
  const safe = path.resolve(pngTarget).startsWith(path.resolve(dir) + path.sep);
  if (!safe) return { ok: false, pngMade: false, png: null, svg: null, line: `${NOT_MADE}: ${want} is not a safe file name.`, disk: "" };
  try { fs.mkdirSync(path.dirname(pngTarget), { recursive: true }); } catch (e) { return { ok: false, pngMade: false, png: null, svg: null, line: `${NOT_MADE}: ${String(e.message || e).slice(0, 120)}`, disk: "" }; }
  const renderer = hooks.render || render || globalThis.__ccSvgRenderer;
  let buf = null, why = "";
  if (typeof renderer === "function") {
    try { buf = await renderer(made.svg, { width: made.w, height: made.h }); } catch (e) { why = String(e?.message || e).slice(0, 120); }
    if (buf && !isPng(Buffer.from(buf))) { buf = null; why = why || "The drawing came back empty."; }
  }
  const keep = (file) => { try { return saveToMindMedia({ files: [{ name: path.basename(file), path: file }], projectId: pid, source: "Mission", status: "Draft", dedupeKey: missionId ? `draw:${missionId}:${path.basename(file)}` : undefined }); } catch { return null; } };
  if (buf) {
    fs.writeFileSync(pngTarget, Buffer.from(buf));
    const c = checkOnDisk(pngTarget, true);
    if (c.exists) {
      const saved = keep(pngTarget);
      return { ok: true, pngMade: true, png: { name: path.basename(pngTarget), path: pngTarget, bytes: c.bytes, assetId: saved?.items?.[0]?.id || null }, svg: null, disk: diskLine(pngTarget), line: `Saved ${path.basename(pngTarget)} (${c.bytes} bytes) at ${pngTarget}.` };
    }
    why = "The PNG could not be read back after writing.";
  }
  // no PNG: keep the SVG so the work is not lost, and say the PNG was not made
  const svgTarget = uniquePath(pngTarget.replace(/\.[^.]+$/, ".svg"));
  try { fs.writeFileSync(svgTarget, made.svg, "utf8"); } catch (e) { return { ok: false, pngMade: false, png: null, svg: null, disk: diskLine(pngTarget), line: `${NOT_MADE}: ${String(e.message || e).slice(0, 120)}` }; }
  const c = checkOnDisk(svgTarget, false);
  if (!c.exists) return { ok: false, pngMade: false, png: null, svg: null, disk: diskLine(pngTarget), line: `${NOT_MADE}: the drawing could not be saved.` };
  keep(svgTarget);
  return { ok: false, pngMade: false, png: null, svg: { name: path.basename(svgTarget), path: svgTarget, bytes: c.bytes }, disk: `${diskLine(pngTarget)}; ${diskLine(svgTarget)}`, line: `${NOT_MADE}: ${path.basename(pngTarget)}. ${typeof renderer === "function" ? `The PNG drawing failed${why ? ` (${why})` : ""}. Saved ${path.basename(svgTarget)} instead (${c.bytes} bytes).` : `${SVG_ONLY_LINE} Saved ${path.basename(svgTarget)} (${c.bytes} bytes) at ${svgTarget}.`}` };
}

const RENDER_WORDS = /\b(pillow|\bPIL\b|imagemagick|matplotlib|canvas|cairo|opencv|render|draw|generate|create|make|produce|design)\b/i;
const CHECK_WORDS = /\b(verify|check|confirm|validate|inspect|review|qa)\b/i;
/**
 * Plan fix for a flat graphic with no image AI: any step that would render the picture with a program (Pillow and the
 * like) becomes one media step Meldmind does itself, and a step that only "verifies" it is dropped (the app checks the
 * file on disk). Returns { plan, changed }.
 */
export function localizeImagePlan(plan, goal) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  if (!tasks.length || tasks.some((t) => t.media?.kind === "image")) return { plan, changed: false };
  const idx = tasks.findIndex((t) => /\b(png|image|picture|card|graphic|banner|poster)\b/i.test(`${t.title} ${t.deliverable || ""}`) && !CHECK_WORDS.test(t.title || "") && (RENDER_WORDS.test(`${t.title}`) || /pillow|PIL\b|imagemagick|canvas/i.test(t.instructions || "")));
  if (idx < 0) return { plan, changed: false };
  const first = tasks[idx];
  const prompt = String(goal || "").slice(0, 800);
  const dropped = new Set(tasks.filter((t, i) => i !== idx && CHECK_WORDS.test(t.title || "") && (t.deps || []).includes(first.id)).map((t) => t.id));
  const next = tasks.filter((t) => !dropped.has(t.id)).map((t) => (t === first ? { ...t, title: "Draw the image on this PC", capability: "media", media: { kind: "image", prompt, local: true }, instructions: prompt, deliverable: "The PNG file" } : { ...t, deps: (t.deps || []).filter((d) => !dropped.has(d)) }));
  return { plan: { ...plan, tasks: next }, changed: true };
}
