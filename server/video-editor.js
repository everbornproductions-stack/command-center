// Video sound and subtitle editor (flag_videoeditor, 0.4.19). Slice C3.
// A project here is a list of edits on top of one video that already lives in the data folder.
// The original file is only ever read. Preview and Export write NEW files, never over the source.
// ffmpeg runs as a child process (found by resolveFfmpeg in media-modify.js). Nothing is uploaded or posted.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveFfmpeg, NO_TRIM } from "./media-modify.js";
import { outputFile, getJob, listJobs, projectMediaDir } from "./media-jobs.js";
import { DATA_DIR } from "./paths.js";
import { doc, putDoc } from "./store.js";

export const NO_FFMPEG = "This computer has no video tool yet. Install ffmpeg to preview or export. Your edits are saved and nothing was changed.";
export { NO_TRIM };
export const DOC = "video.editor";
export const LIMITS = { subtitles: 500, overlays: 50, sounds: 12, segments: 40, text: 400, upload: 12 * 1024 * 1024, projects: 100 };
export const TRANSITIONS = [
  { id: "cut", label: "Cut", color: "" },
  { id: "black", label: "Fade to black", color: "black" },
  { id: "white", label: "Fade to white", color: "white" },
];
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"]);
const SOUND_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".mp4", ".webm", ".mov"]);
const MIME = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac" };
const ID = /^ve_[a-f0-9]{10}$/;
const JOB = /^vj_[a-f0-9]{10}$/;

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const round = (n, p = 100) => Math.round(n * p) / p;
const newId = (pre) => `${pre}_${crypto.randomBytes(5).toString("hex")}`;
const cleanText = (v, max = LIMITS.text) => String(v ?? "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);
const store = () => doc(DOC, () => ({ items: [] }));

// ---------- file safety ----------
// A source is a finished media job output, or a file inside the data folder. Never anywhere else.
export function underData(rel) {
  const root = path.resolve(DATA_DIR);
  const full = path.resolve(root, String(rel || ""));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}
export const relOf = (full) => path.relative(path.resolve(DATA_DIR), full).split(path.sep).join("/");

export function cleanSrc(src) {
  if (!src || typeof src !== "object") return null;
  if (src.kind === "job" || src.jobId) {
    const jobId = String(src.jobId || "").slice(0, 80);
    if (!jobId) return null;
    return { kind: "job", jobId, i: Math.max(0, Math.floor(Number(src.i) || 0)) };
  }
  const rel = String(src.rel || src.file || "").replace(/\\/g, "/").slice(0, 500);
  if (!rel || !underData(rel)) return null;
  return { kind: "file", rel };
}
export function resolveSrc(src) {
  const s = cleanSrc(src);
  if (!s) return null;
  const full = s.kind === "job" ? outputFile(s.jobId, s.i) : underData(s.rel);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}
export const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || "application/octet-stream";

// ---------- ffmpeg process handling ----------
const children = new Set();
let exitHooked = false;
function killAll() { for (const c of children) { try { c.kill("SIGKILL"); } catch { /* gone */ } } children.clear(); }
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.once("exit", killAll);
}
export const runningChildren = () => children.size;

function spawnFfmpeg(spec, args, { cwd, ms, onLine, onChild } = {}) {
  hookExit();
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(spec.cmd, [...spec.prefix, ...args], { cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true }); }
    catch (e) { reject(e); return; }
    children.add(child);
    onChild?.(child);
    let tail = "";
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); children.delete(child); fn(v); };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      finish(reject, Object.assign(new Error("timeout"), { timeout: true }));
    }, ms || 120000);
    child.stderr.on("data", (c) => {
      const t = c.toString("utf8");
      tail = (tail + t).slice(-6000);
      onLine?.(t);
    });
    child.on("error", (e) => finish(reject, e));
    child.on("close", (code, signal) => {
      if (code === 0) finish(resolve, { stderr: tail });
      else finish(resolve, { stderr: tail, code, signal, failed: true });
    });
  });
}

// ---------- probe ----------
export function parseProbe(text) {
  const s = String(text || "");
  const d = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
  const v = s.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
  return { duration: round(duration), width: v ? Number(v[1]) : 0, height: v ? Number(v[2]) : 0, hasVideo: /Video:/.test(s), hasAudio: /Audio:/.test(s) };
}
export async function probe(file) {
  const spec = resolveFfmpeg();
  if (!spec) return null;
  try {
    const r = await spawnFfmpeg(spec, ["-hide_banner", "-nostdin", "-i", file], { ms: 15000 });
    return parseProbe(r.stderr);
  } catch { return null; }
}

// ---------- project model ----------
const emptyInfo = () => ({ duration: 0, width: 0, height: 0, hasAudio: true });
export function cleanProject(input, base = {}) {
  const p = { ...base, ...input };
  const info = { ...emptyInfo(), ...(base.info || {}), ...(input.info && typeof input.info === "object" ? input.info : {}) };
  info.duration = num(info.duration, 0, 0, 86400);
  info.width = num(info.width, 0, 0, 20000);
  info.height = num(info.height, 0, 0, 20000);
  info.hasAudio = info.hasAudio !== false;
  const cap = info.duration || 86400;
  let segments = (Array.isArray(p.segments) ? p.segments : []).slice(0, LIMITS.segments).map((s) => ({ start: round(num(s?.start, 0, 0, cap)), end: round(num(s?.end, cap, 0, cap)) })).filter((s) => s.end - s.start >= 0.1);
  if (!segments.length) segments = [{ start: 0, end: round(cap === 86400 ? 10 : cap) }];
  const total = round(segments.reduce((a, s) => a + (s.end - s.start), 0));
  const cap2 = total || 86400;
  const tk = TRANSITIONS.some((t) => t.id === p.transition?.kind) ? p.transition.kind : "cut";
  const sounds = (Array.isArray(p.sounds) ? p.sounds : []).slice(0, LIMITS.sounds).map((s) => {
    const src = cleanSrc(s?.src);
    if (!src) return null;
    return { id: /^sd_[a-f0-9]{10}$/.test(String(s.id || "")) ? s.id : newId("sd"), label: cleanText(s.label || "Sound", 80) || "Sound", src, start: round(num(s.start, 0, 0, cap2)), from: round(num(s.from, 0, 0, 86400)), length: round(num(s.length, 0, 0, 86400)), volume: Math.round(num(s.volume, 100, 0, 200)), fadeIn: round(num(s.fadeIn, 0, 0, 30)), fadeOut: round(num(s.fadeOut, 0, 0, 30)) };
  }).filter(Boolean);
  const subtitles = (Array.isArray(p.subtitles) ? p.subtitles : []).slice(0, LIMITS.subtitles).map((s) => {
    const start = round(num(s?.start, 0, 0, cap2));
    const end = round(num(s?.end, start + 2, 0, cap2));
    return { id: /^st_[a-f0-9]{10}$/.test(String(s?.id || "")) ? s.id : newId("st"), start, end: end > start ? end : round(Math.min(cap2, start + 0.5)), text: cleanText(s?.text) };
  }).filter((s) => s.text.trim() && s.end > s.start).sort((a, b) => a.start - b.start);
  const overlays = (Array.isArray(p.overlays) ? p.overlays : []).slice(0, LIMITS.overlays).map((o) => {
    const start = round(num(o?.start, 0, 0, cap2));
    const end = round(num(o?.end, Math.min(cap2, start + 3), 0, cap2));
    return { id: /^ov_[a-f0-9]{10}$/.test(String(o?.id || "")) ? o.id : newId("ov"), start, end: end > start ? end : round(Math.min(cap2, start + 0.5)), text: cleanText(o?.text, 200), x: Math.round(num(o?.x, 50, 0, 100)), y: Math.round(num(o?.y, 12, 0, 100)), size: Math.round(num(o?.size, 6, 2, 20)), color: /^#[0-9a-fA-F]{6}$/.test(String(o?.color || "")) ? o.color : "#ffffff" };
  }).filter((o) => o.text.trim() && o.end > o.start);
  return {
    id: ID.test(String(p.id || "")) ? p.id : newId("ve"),
    name: cleanText(p.name || "Untitled video", 120).trim() || "Untitled video",
    projectId: p.projectId ? String(p.projectId).replace(/[^a-z0-9-_]/gi, "_").slice(0, 80) : null,
    source: cleanSrc(p.source) || base.source || null,
    info,
    segments,
    transition: { kind: tk, seconds: round(num(p.transition?.seconds, 0.5, 0.1, 3)) },
    fadeIn: round(num(p.fadeIn, 0, 0, 10)),
    fadeOut: round(num(p.fadeOut, 0, 0, 10)),
    audio: { volume: Math.round(num(p.audio?.volume, 100, 0, 200)), muted: !!p.audio?.muted },
    sounds,
    subtitles,
    overlays,
    exports: Array.isArray(base.exports) ? base.exports.slice(-20) : [],
    createdAt: base.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}
export const totalLength = (p) => round((p.segments || []).reduce((a, s) => a + (s.end - s.start), 0));

export const listProjects = () => store().items.map(summary);
export const getProject = (id) => store().items.find((x) => x.id === String(id || "")) || null;
const summary = (p) => ({ id: p.id, name: p.name, projectId: p.projectId, length: totalLength(p), subtitles: p.subtitles.length, sounds: p.sounds.length, updatedAt: p.updatedAt, exports: p.exports.length });
function save(p) {
  const s = store();
  const i = s.items.findIndex((x) => x.id === p.id);
  if (i >= 0) s.items[i] = p; else s.items.unshift(p);
  putDoc(DOC, { items: s.items.slice(0, LIMITS.projects) });
  return p;
}

export async function createProject(body = {}) {
  const src = cleanSrc(body.source || body);
  if (!src) throw err(400, "Pick a video first. Nothing was changed.", { code: "no_source" });
  const file = resolveSrc(src);
  if (!file) throw err(404, "That video is not on this computer anymore. Nothing was changed.", { code: "missing" });
  if (!VIDEO_EXT.has(path.extname(file).toLowerCase())) throw err(400, "That file is not a video this editor can open. Nothing was changed.", { code: "not_video" });
  if (store().items.length >= LIMITS.projects) throw err(400, "Too many video projects. Delete one first.", { code: "full" });
  const info = (await probe(file)) || {};
  const job = src.kind === "job" ? getJob(src.jobId) : null;
  const p = cleanProject({
    name: body.name || job?.params?.prompt?.slice(0, 60) || path.basename(file),
    projectId: body.projectId || job?.projectId || null,
    source: src,
    info: { duration: info.duration || num(body.duration, 0, 0, 86400), width: info.width || 0, height: info.height || 0, hasAudio: info.hasAudio !== false },
    segments: [{ start: 0, end: info.duration || num(body.duration, 10, 0.1, 86400) }],
  });
  return save(p);
}

export function updateProject(id, body = {}) {
  const base = getProject(id);
  if (!base) throw err(404, "That video project was not found.", { code: "not_found" });
  const next = cleanProject({ ...body, source: base.source, id: base.id, info: base.info }, base);
  return save(next);
}
export function removeProject(id) {
  const s = store();
  const p = getProject(id);
  if (!p) throw err(404, "That video project was not found.", { code: "not_found" });
  putDoc(DOC, { items: s.items.filter((x) => x.id !== p.id) });
  try { fs.rmSync(path.join(DATA_DIR, "video-editor", p.id), { recursive: true, force: true }); } catch { /* best effort */ }
  return { ok: true };
}

// Files the person can pick from: finished media jobs with a saved video or sound.
export function listSources() {
  const out = [];
  for (const j of listJobs()) {
    if (j.status !== "done") continue;
    (j.outputs || []).forEach((o, i) => {
      if (/^https?:/i.test(o)) return;
      const ext = path.extname(o).toLowerCase();
      const kind = VIDEO_EXT.has(ext) && j.kind === "video" ? "video" : SOUND_EXT.has(ext) && (j.kind === "voice" || j.kind === "video") ? "sound" : "";
      if (!kind) return;
      if (!outputFile(j.id, i)) return;
      out.push({ jobId: j.id, i, kind, name: path.basename(o), label: String(j.params?.prompt || j.params?.text || path.basename(o)).slice(0, 80), projectId: j.projectId || null });
    });
  }
  return out.slice(0, 100);
}

// Save a small upload (base64) in the data folder and hand back a source reference.
export function saveUpload({ name, data, kind } = {}) {
  const ext = path.extname(String(name || "")).toLowerCase();
  const ok = kind === "sound" ? SOUND_EXT : VIDEO_EXT;
  if (!ok.has(ext)) throw err(400, "That file type is not supported here. Nothing was saved.", { code: "bad_type" });
  const buf = Buffer.from(String(data || ""), "base64");
  if (!buf.length) throw err(400, "The file was empty. Nothing was saved.", { code: "empty" });
  if (buf.length > LIMITS.upload) throw err(400, "That file is too big for the editor. Pick a smaller one. Nothing was saved.", { code: "too_big" });
  const dir = path.join(DATA_DIR, "video-editor", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(String(name), ext).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "file";
  const file = path.join(dir, `${base}-${crypto.randomBytes(3).toString("hex")}${ext}`);
  fs.writeFileSync(file, buf, { flag: "wx" });
  return { src: { kind: "file", rel: relOf(file) }, name: path.basename(file) };
}

// ---------- subtitles ----------
const clock = (t, comma = ",") => {
  const ms = Math.round(Math.max(0, t) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${comma}${p(ms % 1000, 3)}`;
};
export function toSrt(subs) {
  return (subs || []).map((s, i) => `${i + 1}\n${clock(s.start)} --> ${clock(s.end)}\n${s.text}\n`).join("\n");
}
export function parseSrt(text) {
  const out = [];
  const blocks = String(text || "").replace(/\r/g, "").replace(/^﻿/, "").split(/\n{2,}/);
  const t = (a, b, c, d) => Number(a) * 3600 + Number(b) * 60 + Number(c) + Number(String(d).padEnd(3, "0")) / 1000;
  for (const block of blocks) {
    const lines = block.split("\n").filter((l, i, arr) => !(i === 0 && /^\d+$/.test(l.trim()) && arr.length > 1 && /-->/.test(arr[1] || "")));
    const m = (lines[0] || "").match(/(\d+):(\d+):(\d+)[,.](\d{1,3})\s*-->\s*(\d+):(\d+):(\d+)[,.](\d{1,3})/);
    if (!m) continue;
    const body = lines.slice(1).join("\n").trim();
    if (!body) continue;
    out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: body });
    if (out.length >= LIMITS.subtitles) break;
  }
  return out;
}
export function importSrt(id, text, mode = "replace") {
  const base = getProject(id);
  if (!base) throw err(404, "That video project was not found.", { code: "not_found" });
  const rows = parseSrt(text);
  if (!rows.length) throw err(400, "No subtitles were found in that text. Nothing was changed.", { code: "no_subtitles" });
  const subtitles = mode === "append" ? [...base.subtitles, ...rows] : rows;
  return updateProject(id, { ...base, subtitles });
}

// ---------- ASS file for subtitles and text overlays ----------
const assTime = (t) => {
  const cs = Math.round(Math.max(0, t) * 100);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};
const assText = (s) => String(s).replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\n/g, "\\N");
const bgr = (hex) => `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase();
export function buildAss(p, W, H) {
  const w = W || 1280, h = H || 720;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${w}`, `PlayResY: ${h}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Sub,Arial,${Math.round(h * 0.055)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,${Math.round(w * 0.06)},${Math.round(w * 0.06)},${Math.round(h * 0.06)},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const s of p.subtitles) lines.push(`Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Sub,,0,0,0,,${assText(s.text)}`);
  for (const o of p.overlays) {
    const size = Math.round(h * o.size / 100);
    // \an5 centres the text on the point. \q2 keeps the line from wrapping by itself, so the box is set by margins below.
    const x = Math.round(w * o.x / 100), y = Math.round(h * o.y / 100);
    const half = Math.max(40, Math.min(x, w - x));
    lines.push(`Dialogue: 1,${assTime(o.start)},${assTime(o.end)},Sub,,${Math.max(0, x - half)},${Math.max(0, w - x - half)},0,,{\\an5\\pos(${x},${y})\\fs${size}\\c${bgr(o.color)}}${assText(o.text)}`);
  }
  return lines.join("\n") + "\n";
}

// ---------- the ffmpeg plan ----------
const f = (n) => String(round(n, 1000));
export function buildPlan(p, { source, soundFiles = [], preview = false, from = 0, length = 0 } = {}) {
  const info = p.info || emptyInfo();
  const total = totalLength(p);
  const segs = p.segments;
  const trans = TRANSITIONS.find((t) => t.id === p.transition.kind) || TRANSITIONS[0];
  const td = p.transition.seconds;
  const g = [];
  const vlabels = [], alabels = [];
  segs.forEach((s, i) => {
    const len = s.end - s.start;
    const last = i === segs.length - 1;
    const v = [`trim=start=${f(s.start)}:end=${f(s.end)}`, "setpts=PTS-STARTPTS"];
    const a = [`atrim=start=${f(s.start)}:end=${f(s.end)}`, "asetpts=PTS-STARTPTS"];
    const fade = (kind, d, color) => {
      const dd = Math.min(d, len / 2);
      if (dd < 0.05) return;
      const st = kind === "in" ? 0 : len - dd;
      v.push(`fade=t=${kind}:st=${f(st)}:d=${f(dd)}${color ? `:color=${color}` : ""}`);
      a.push(`afade=t=${kind}:st=${f(st)}:d=${f(dd)}`);
    };
    if (i > 0 && trans.color) fade("in", td, trans.color);
    if (i === 0 && p.fadeIn) fade("in", p.fadeIn, "black");
    if (!last && trans.color) fade("out", td, trans.color);
    if (last && p.fadeOut) fade("out", p.fadeOut, "black");
    g.push(`[0:v]${v.join(",")}[v${i}]`);
    vlabels.push(`[v${i}]`);
    if (info.hasAudio) { g.push(`[0:a]${a.join(",")}[a${i}]`); alabels.push(`[a${i}]`); }
  });
  g.push(`${vlabels.join("")}concat=n=${segs.length}:v=1:a=0[vc]`);
  const post = [];
  const needAss = p.subtitles.length || p.overlays.length;
  if (needAss) post.push("ass=subs.ass");
  if (preview) post.push("scale=-2:360");
  post.push("format=yuv420p");
  g.push(`[vc]${post.join(",")}[vout]`);

  // sound line: the original sound first, then each added sound on the timeline
  if (info.hasAudio) {
    g.push(`${alabels.join("")}concat=n=${segs.length}:v=0:a=1[ac]`);
    g.push(`[ac]volume=${p.audio.muted ? 0 : f(p.audio.volume / 100)}[base]`);
  } else {
    g.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${f(total)},asetpts=PTS-STARTPTS[base]`);
  }
  const mixIn = ["[base]"];
  p.sounds.forEach((s, k) => {
    if (!soundFiles[k]) return;
    const len = s.length > 0 ? Math.min(s.length, Math.max(0.1, total - s.start)) : Math.max(0.1, total - s.start);
    const chain = [`atrim=start=${f(s.from)}:end=${f(s.from + len)}`, "asetpts=PTS-STARTPTS", `volume=${f(s.volume / 100)}`];
    if (s.fadeIn) chain.push(`afade=t=in:st=0:d=${f(Math.min(s.fadeIn, len / 2))}`);
    if (s.fadeOut) chain.push(`afade=t=out:st=${f(Math.max(0, len - Math.min(s.fadeOut, len / 2)))}:d=${f(Math.min(s.fadeOut, len / 2))}`);
    const ms = Math.round(s.start * 1000);
    chain.push(`adelay=${ms}|${ms}`);
    g.push(`[${mixIn.length}:a]${chain.join(",")}[s${k}]`);
    mixIn.push(`[s${k}]`);
  });
  if (mixIn.length > 1) {
    g.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:duration=first:dropout_transition=0,volume=${mixIn.length},alimiter=limit=0.95[aout]`);
  } else g.push("[base]anull[aout]");

  const inputs = ["-i", source];
  p.sounds.forEach((s, k) => { if (soundFiles[k]) inputs.push("-i", soundFiles[k]); });
  const args = ["-hide_banner", "-y", "-nostdin", ...inputs, "-filter_complex", g.join(";"), "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", preview ? "ultrafast" : "medium", "-crf", preview ? "30" : "20", "-c:a", "aac", "-b:a", preview ? "96k" : "160k", "-movflags", "+faststart"];
  if (preview) {
    const start = Math.max(0, Math.min(from, Math.max(0, total - 0.5)));
    const len = Math.min(length > 0 ? length : 30, 60, total - start);
    if (start > 0) args.push("-ss", f(start));
    args.push("-t", f(len));
  } else args.push("-t", f(total));
  return { args, ass: needAss ? buildAss(p, info.width, info.height) : "", total, filter: g.join(";") };
}

// ---------- preview and export jobs ----------
const jobs = new Map();
const active = new Map(); // editor project id -> job id
export const jobView = (j) => j && ({ id: j.id, project: j.project, kind: j.kind, state: j.state, percent: j.percent, error: j.error || "", output: j.output || "", name: j.name || "", startedAt: j.startedAt, finishedAt: j.finishedAt || 0 });
export const getRunJob = (id) => (JOB.test(String(id || "")) ? jobs.get(id) || null : null);
function prune() {
  const done = [...jobs.values()].filter((j) => j.state !== "running").sort((a, b) => a.startedAt - b.startedAt);
  while (jobs.size > 30 && done.length) jobs.delete(done.shift().id);
}

export function startRender(projectId, { preview = false, from = 0, length = 0 } = {}) {
  const p = getProject(projectId);
  if (!p) throw err(404, "That video project was not found.", { code: "not_found" });
  const spec = resolveFfmpeg();
  if (!spec) throw err(400, NO_FFMPEG, { code: "no_ffmpeg" });
  if (active.has(p.id)) throw err(409, "A preview or export is already running for this video. Wait for it or cancel it.", { code: "busy", job: active.get(p.id) });
  const source = resolveSrc(p.source);
  if (!source) throw err(404, "The original video is not on this computer anymore. Nothing was changed.", { code: "missing" });
  const soundFiles = p.sounds.map((s) => resolveSrc(s.src));
  const missing = soundFiles.findIndex((x) => !x);
  if (missing >= 0) throw err(404, `The sound "${p.sounds[missing].label}" is not on this computer anymore. Remove it or pick another. Nothing was changed.`, { code: "missing_sound" });
  const plan = buildPlan(p, { source, soundFiles, preview, from, length });
  const dir = path.join(DATA_DIR, "video-editor", p.id);
  fs.mkdirSync(dir, { recursive: true });
  if (plan.ass) fs.writeFileSync(path.join(dir, "subs.ass"), plan.ass);

  // Output is always a new file. Exports go to the project's media folder. Previews to the editor's own folder.
  let final, part;
  if (preview) {
    final = path.join(dir, "preview.mp4");
    part = path.join(dir, "preview.part.mp4");
  } else {
    const mdir = projectMediaDir(p.projectId);
    const slug = p.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "video";
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    let n = 0;
    do { final = path.join(mdir, `${slug}-edited-${stamp}${n ? "-" + n : ""}.mp4`); n++; } while (fs.existsSync(final));
    part = path.join(mdir, `.${path.basename(final, ".mp4")}.part.mp4`);
  }
  const sameAs = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  if (sameAs(final, source) || sameAs(part, source) || soundFiles.some((x) => sameAs(final, x) || sameAs(part, x))) throw err(400, "The new file would overwrite an original. Nothing was changed.", { code: "overwrite" });

  const job = { id: newId("vj"), project: p.id, kind: preview ? "preview" : "export", state: "running", percent: 0, startedAt: Date.now(), name: path.basename(final), cancelled: false, child: null };
  jobs.set(job.id, job);
  active.set(p.id, job.id);
  prune();
  const expect = Math.max(0.1, plan.total);
  const run = spawnFfmpeg(spec, [...plan.args, part], {
    cwd: dir, ms: preview ? 180000 : 1800000,
    onChild: (c) => { job.child = c; },
    onLine: (t) => {
      const m = [...t.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
      if (m) job.percent = Math.min(99, Math.round(((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / (preview ? Math.min(60, expect) : expect)) * 100));
    },
  }).then((r) => {
    if (job.cancelled) { job.state = "cancelled"; job.error = "Cancelled. Nothing was changed."; return; }
    if (r.failed || !fs.existsSync(part) || !fs.statSync(part).size) { job.state = "error"; job.error = "The render did not finish. Your original video was not changed."; return; }
    if (fs.existsSync(final)) { if (!preview) { job.state = "error"; job.error = "A file with that name appeared. Nothing was overwritten."; return; } fs.rmSync(final, { force: true }); }
    fs.renameSync(part, final);
    job.state = "done"; job.percent = 100; job.output = preview ? "" : relOf(final);
    if (!preview) {
      const cur = getProject(p.id);
      if (cur) save({ ...cur, exports: [...cur.exports, { file: relOf(final), name: path.basename(final), at: Date.now(), length: plan.total }].slice(-20) });
    }
  }).catch((e) => {
    job.state = job.cancelled ? "cancelled" : "error";
    job.error = job.cancelled ? "Cancelled. Nothing was changed." : e.timeout ? "The render took too long and was stopped. Your original video was not changed." : "The render did not finish. Your original video was not changed.";
  }).finally(() => {
    job.finishedAt = Date.now(); job.child = null;
    if (active.get(p.id) === job.id) active.delete(p.id);
    try { fs.rmSync(part, { force: true }); } catch { /* best effort */ }
  });
  job.done = run;
  return job;
}

export function cancelRender(id) {
  const j = getRunJob(id);
  if (!j) throw err(404, "That render was not found.", { code: "not_found" });
  if (j.state !== "running") return j;
  j.cancelled = true;
  try { j.child?.kill("SIGKILL"); } catch { /* gone */ }
  return j;
}

export function previewFile(id) {
  const p = getProject(id);
  if (!p) return null;
  const file = path.join(DATA_DIR, "video-editor", p.id, "preview.mp4");
  return fs.existsSync(file) ? file : null;
}

// Stream a file with Range support so the player can seek.
export function streamFile(req, res, file, mime = mimeOf(file)) {
  const size = fs.statSync(file).size;
  const range = String(req.headers.range || "").match(/^bytes=(\d*)-(\d*)$/);
  const base = { "content-type": mime, "accept-ranges": "bytes", "x-content-type-options": "nosniff", "cache-control": "no-store" };
  let start = 0, end = size - 1, code = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(size - 1, Number(range[2])); }
    else { start = Math.max(0, size - Number(range[2])); }
    if (start > end || start >= size) { res.writeHead(416, { ...base, "content-range": `bytes */${size}` }); res.end(); return; }
    code = 206;
    base["content-range"] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(code, { ...base, "content-length": end - start + 1 });
  const rs = fs.createReadStream(file, { start, end });
  rs.on("error", () => { try { res.destroy(); } catch { /* gone */ } });
  res.on("close", () => rs.destroy());
  rs.pipe(res);
}
