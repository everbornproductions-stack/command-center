// Thin Finish router (flag_finishrouter, 0.4.19). Decides which Finish editor fits a piece of work.
// Order: clear rules first (file type, kind, tags, code), then a small local word-similarity score.
// No model download and no native code here: the ONNX path is a later add-on. It never calls an AI.
// A person can always correct the answer, and the correction stays on this PC.
import { doc, putDoc } from "./store.js";

export const THRESHOLDS = { direct: 0.85, confirm: 0.6 };
export const HISTORY_MAX = 200;

export const CATEGORIES = [
  { id: "image", label: "Image", editor: "Images" },
  { id: "video", label: "Video", editor: "Video" },
  { id: "program", label: "Program or code", editor: "Programs" },
  { id: "game", label: "Game", editor: "Games" },
  { id: "social", label: "Social media post", editor: "Social" },
  { id: "website", label: "Website", editor: "Websites" },
  { id: "accounting", label: "Accounting or money", editor: "Accounting" },
  { id: "document", label: "Document or report", editor: "Documents" },
  { id: "automation", label: "Automation", editor: "Automations" },
  { id: "music", label: "Music or audio", editor: "Music" },
  { id: "presentation", label: "Presentation", editor: "Presentations" },
  { id: "general", label: "General", editor: "General workspace" },
];
const IDS = new Set(CATEGORIES.map((c) => c.id));
export const isCategory = (id) => IDS.has(id);
export const labelOf = (id) => CATEGORIES.find((c) => c.id === id)?.label || "General";

const EXT = {
  image: "png jpg jpeg gif webp bmp svg heic tiff avif",
  video: "mp4 mov webm mkv avi m4v",
  music: "mp3 wav flac aac ogg m4a mid midi",
  presentation: "pptx ppt key odp",
  accounting: "xlsx xls csv ods qbo ofx",
  document: "docx doc pdf rtf odt md txt",
  program: "js ts py java cs cpp c go rs rb php sh ps1 swift kt",
  website: "html htm css",
  automation: "yml yaml cron",
  game: "gd godot unity tscn",
};
const EXT_MAP = new Map();
for (const [cat, list] of Object.entries(EXT)) for (const e of list.split(" ")) EXT_MAP.set(e, cat);
const LOOSE_EXT = new Set(["md", "txt", "csv", "pdf", "docx", "doc", "c", "key"]);

// Meldmind's own tabs say what kind of result this is.
const KIND_MAP = { image: "image", images: "image", video: "video", media: "video", music: "music", audio: "music", remix: "game", game: "game", site: "website", website: "website", webbuilders: "website", builders: "document", code: "program", program: "program", slides: "presentation", social: "social", post: "social", automation: "automation", schedule: "automation", pipeline: "automation" };

// Plain phrases that settle it on their own. Each hit adds its weight.
const RULES = [
  [/```(?:js|javascript|ts|typescript|python|py|java|c\+\+|cpp|go|rust|bash|sh|powershell)\b/i, "program", 0.9, "has a code block"],
  [/<!doctype html|<html[\s>]|<\/body>/i, "website", 0.92, "is an HTML page"],
  [/\b(invoice|balance sheet|profit and loss|p&l|ledger|expense report|receipt|bookkeeping|tax return|payroll)\b/i, "accounting", 0.88, "talks about money records"],
  [/\b(slide deck|slides?|pitch deck|powerpoint|keynote)\b/i, "presentation", 0.88, "mentions slides"],
  [/\b(hashtags?|caption|instagram|tiktok|reel|tweet|linkedin post|facebook post|story post)\b/i, "social", 0.86, "reads like a social post"],
  [/\b(cron|every (?:day|week|monday|morning|hour)|schedule(?:d)? (?:run|task|job)|zap|trigger when|workflow that)\b/i, "automation", 0.86, "describes a repeating job"],
  [/\b(landing page|homepage|home page|website|web page|webpage|navbar|hero section)\b/i, "website", 0.86, "talks about a website"],
  [/\b(song|lyrics|chorus|verse|melody|beat|soundtrack|podcast|voiceover|jingle)\b/i, "music", 0.86, "talks about sound"],
  [/\b(video|footage|b-roll|storyboard|subtitles?|trailer|timeline cut|clip)\b/i, "video", 0.86, "talks about video"],
  [/\b(game|level design|player character|sprite|tilemap|boss fight|power-?up)\b/i, "game", 0.86, "talks about a game"],
  [/\b(photo|picture|portrait|illustration|logo|poster|render|wallpaper)\b/i, "image", 0.86, "talks about a picture"],
];

// Short examples per category for the local similarity step.
const EXAMPLES = {
  image: "photo picture portrait illustration logo poster banner artwork render wallpaper sketch painting color light exposure retouch thumbnail icon",
  video: "video clip footage scene shot cut edit subtitles captions timeline trailer reel intro outro voiceover frames animation",
  program: "function code script bug fix class module api endpoint compile test deploy repo app command line library",
  game: "game level player character enemy sprite score quest puzzle tiles boss world mechanics items inventory",
  social: "post caption hashtags followers audience engagement story reel tweet thread share viral schedule content calendar",
  website: "website page landing homepage menu navigation section hero contact form domain hosting seo browser layout",
  accounting: "invoice payment total tax expense revenue budget ledger balance receipt client amount due paid price cost profit",
  document: "report document memo letter proposal summary essay article outline chapter section policy contract notes draft",
  automation: "automation workflow trigger schedule every run when then step pipeline zap integration notify repeat daily weekly",
  music: "song music lyrics melody chorus verse beat track audio album vocal instrument tempo mix master sound podcast",
  presentation: "presentation slide slides deck pitch speaker agenda title bullet theme transition keynote talk",
};

const STOP = new Set("a an the and or of to in on for with is are be it this that i you we my your our as at by from can will make made please want need some about into".split(" "));
export function words(text) {
  const out = [];
  for (const raw of String(text || "").toLowerCase().replace(/[^a-z0-9+#&\s]/g, " ").split(/\s+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}
function bag(list) { const m = new Map(); for (const w of list) m.set(w, (m.get(w) || 0) + 1); return m; }
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  for (const [k, v] of a) if (b.has(k)) dot += v * b.get(k);
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
let exampleBags = null;
const baseBags = () => (exampleBags ||= Object.fromEntries(Object.entries(EXAMPLES).map(([k, v]) => [k, bag(words(v))])));

function extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(String(name || "").trim()); return m ? m[1].toLowerCase() : ""; }
function mimeCat(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "music";
  if (m.includes("presentation")) return "presentation";
  if (m.includes("spreadsheet") || m === "text/csv") return "accounting";
  if (m === "text/html") return "website";
  return "";
}

// learned: [{ words: [...], category }] from the override history on this PC.
export function classify(input = {}, { learned = [] } = {}) {
  const text = String(input.text || "").slice(0, 20000);
  const signals = [];
  const score = {};
  const add = (cat, v, why, tier) => {
    score[cat] = Math.max(score[cat] || 0, v);
    signals.push({ category: cat, tier, weight: Math.round(v * 100) / 100, why });
  };

  // Step 1: rules.
  const ext = extOf(input.name) || String(input.ext || "").replace(/^\./, "").toLowerCase();
  if (ext && EXT_MAP.has(ext)) add(EXT_MAP.get(ext), LOOSE_EXT.has(ext) ? 0.7 : 0.95, `the file ends in .${ext}`, "rules");
  const mc = mimeCat(input.mime);
  if (mc) add(mc, 0.93, "the file type is " + String(input.mime).slice(0, 60), "rules");
  const kind = KIND_MAP[String(input.kind || "").toLowerCase()];
  if (kind) add(kind, 0.88, `it came from ${String(input.kind).slice(0, 20)}`, "rules");
  for (const t of Array.isArray(input.tags) ? input.tags : []) {
    const tag = String(t).toLowerCase().trim();
    const hit = CATEGORIES.find((c) => c.id !== "general" && (c.id === tag || c.label.toLowerCase().split(" ")[0] === tag));
    if (hit) add(hit.id, 0.9, `tagged "${tag.slice(0, 30)}"`, "rules");
  }
  if (text) {
    const hitsBy = {};
    for (const [re, cat, w, why] of RULES) if (re.test(text)) (hitsBy[cat] ||= []).push([w, why]);
    for (const [cat, hits] of Object.entries(hitsBy)) {
      const best = Math.max(...hits.map((h) => h[0]));
      add(cat, Math.min(0.97, best + 0.04 * (hits.length - 1)), hits.map((h) => h[1]).join(", "), "rules");
    }
  }

  // Step 2: local word similarity, for what the rules did not settle.
  const ws = words([input.name, text].filter(Boolean).join(" "));
  const hasRule = Object.keys(score).length > 0;
  if (ws.length) {
    const mine = bag(ws);
    const bags = { ...baseBags() };
    for (const l of learned) {
      if (!isCategory(l.category) || l.category === "general" || !Array.isArray(l.words)) continue;
      const b = new Map(bags[l.category] || []);
      for (const w of l.words) b.set(w, (b.get(w) || 0) + 2);
      bags[l.category] = b;
    }
    const sims = Object.entries(bags).map(([cat, b]) => [cat, cosine(mine, b)]).sort((x, y) => y[1] - x[1]);
    const [topCat, topSim] = sims[0];
    const second = sims[1]?.[1] || 0;
    if (topSim > 0.08) {
      const gap = (topSim - second) / topSim;
      const conf = Math.min(0.84, topSim * 2.2 * (0.6 + 0.4 * gap));
      const why = `the words are close to other ${labelOf(topCat).toLowerCase()} work`;
      if (!hasRule || (conf > (score[topCat] || 0) && conf >= THRESHOLDS.confirm)) add(topCat, conf, why, "similarity");
    }
  }

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  let primary = ranked[0] ? ranked[0][0] : "general";
  const confidence = ranked[0] ? Math.round(ranked[0][1] * 100) / 100 : 0;
  let decision;
  if (confidence >= THRESHOLDS.direct) decision = "direct";
  else if (confidence >= THRESHOLDS.confirm) decision = "confirm";
  else { decision = "general"; primary = "general"; }
  // Two rival rules at about the same strength should not pass in silence.
  if (decision === "direct" && ranked[1] && ranked[1][1] >= confidence - 0.02) decision = "confirm";
  const secondary = ranked.filter(([c]) => c !== primary).slice(0, 2).map(([c, v]) => ({ category: c, label: labelOf(c), confidence: Math.round(v * 100) / 100 }));
  const tiers = new Set(signals.filter((s) => s.category === primary).map((s) => s.tier));
  return {
    category: primary,
    label: labelOf(primary),
    editor: CATEGORIES.find((c) => c.id === primary)?.editor,
    confidence,
    decision,
    tier: decision === "general" ? "none" : tiers.has("rules") ? "rules" : "similarity",
    secondary,
    signals: signals.sort((a, b) => b.weight - a.weight).slice(0, 8),
    thresholds: THRESHOLDS,
  };
}

// ---- override history (stays on this PC; keywords only, never the full text) ----
const HIST = "finish-router-history";
export const readHistory = () => doc(HIST, () => ({ items: [] })).items;
export function topWords(text, n = 8) {
  const b = bag(words(text));
  return [...b.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, n).map(([w]) => w);
}
export function recordOverride({ original, corrected, text = "", name = "", kind = "", now = Date.now() } = {}) {
  if (!isCategory(corrected)) throw Object.assign(new Error("Pick one of the listed kinds of work."), { status: 400, code: "category" });
  const d = doc(HIST, () => ({ items: [] }));
  const entry = {
    id: "ov_" + now.toString(36) + Math.random().toString(36).slice(2, 6),
    ts: now,
    original: isCategory(original) ? original : "general",
    corrected,
    features: { ext: extOf(name), kind: String(kind || "").slice(0, 20), words: topWords([name, text].join(" ")) },
  };
  d.items = [entry, ...d.items].slice(0, HISTORY_MAX);
  putDoc(HIST, d);
  return entry;
}
export function clearHistory() { putDoc(HIST, { items: [] }); }
export const learnedFromHistory = () => readHistory().filter((e) => e.features?.words?.length).map((e) => ({ category: e.corrected, words: e.features.words }));
export const classifyWithLearning = (input) => classify(input, { learned: learnedFromHistory() });

// ---- General workspace: notes and a checklist kept per item ----
const GEN = "finish-general";
const clean = (s, n) => String(s || "").replaceAll(String.fromCharCode(8212), "-").slice(0, n);
export function readGeneral(ref) {
  const d = doc(GEN, () => ({ items: {} }));
  return d.items[clean(ref || "main", 60)] || { notes: "", checklist: [], ready: false };
}
export function saveGeneral(ref, body = {}) {
  const d = doc(GEN, () => ({ items: {} }));
  const key = clean(ref || "main", 60);
  const list = (Array.isArray(body.checklist) ? body.checklist : []).slice(0, 50).map((c) => ({ text: clean(c?.text, 200), done: !!c?.done })).filter((c) => c.text);
  const keys = Object.keys(d.items);
  if (!d.items[key] && keys.length >= 100) delete d.items[keys[0]];
  d.items[key] = { notes: clean(body.notes, 20000), checklist: list, ready: !!body.ready && list.every((c) => c.done), updatedAt: Date.now() };
  putDoc(GEN, d);
  return d.items[key];
}
