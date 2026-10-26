// Momentum Mode (flag_momentum, 0.4.19): a local scorer that suggests the next step. Pure: no DOM, no
// network, no AI call, so the server, the page and the tests all use the same code. It only SUGGESTS.
// Nothing here runs a step, sends, posts or spends. A click on the bar fills a form or opens a page.
//
// score = stage_affinity * 3.0 + result_type_match * 2.5 + recency_boost * 1.5
//       + language_match * 2.0 + asset_state_bonus * 1.0 + history_bonus * 0.5 - penalties
// Each term before its weight is 0 to 1. Penalties are in score points.

export const DEFAULT_WEIGHTS = Object.freeze({
  stage_affinity: 3.0, result_type_match: 2.5, recency_boost: 1.5, language_match: 2.0, asset_state_bonus: 1.0, history_bonus: 0.5,
});
export const WEIGHT_KEYS = Object.freeze(Object.keys(DEFAULT_WEIGHTS));
export const MAX_WEIGHT = 6;
export const DEFAULT_IDLE_MS = 10 * 60 * 1000;
export const MIN_ACTIONS = 2;
export const MAX_ACTIONS = 4;
export const LOW_POWER_ACTIONS = 2;
export const BUDGET_MS = 10;

export const STAGES = ["idea", "result", "refine", "finish"];
export const TYPES = ["text", "image", "media", "code", "remix"];

// The catalog. Plain words for Simple mode, a short technical name for Expert.
//   stage: how well it fits each stage (0 to 1). types: result types it suits (empty = any).
//   langs: languages it suits (empty = any). needs: prerequisites, all must hold or it is dropped.
//   assets: "has" suits when there is a result or file in hand, "none" when there is not.
//   fresh: true means it matters most right after a result and fades as the result ages.
export const CATALOG = Object.freeze([
  { id: "variations", label: "Make 3 variations", expert: "3 variations", why: "You have a result, and three tries make it easy to pick.", stage: { result: 1, refine: 0.7, finish: 0.1 }, types: [], langs: [], needs: ["result"], assets: "has", fresh: true },
  { id: "refine", label: "Edit further", expert: "Refine", why: "Change the words and run it again.", stage: { result: 0.8, refine: 1, finish: 0.3 }, types: [], langs: [], needs: ["result"], assets: "has", fresh: true },
  { id: "finish", label: "Looks good, Finish", expert: "Finish", why: "You have a result, and Finish shows a card before anything goes out.", stage: { result: 0.6, refine: 0.5, finish: 1 }, types: [], langs: [], needs: ["result"], assets: "has", fresh: false },
  { id: "add-project", label: "Add to project", expert: "Add to project", why: "Keep this with the rest of your work.", stage: { result: 0.7, refine: 0.5, finish: 0.6 }, types: [], langs: [], needs: ["result", "project"], assets: "has", fresh: false },
  { id: "translate", label: "Translate it", expert: "Translate", why: "The words are not in English.", stage: { result: 0.5, refine: 0.4, finish: 0.5 }, types: ["text", "code"], langs: ["es", "fr", "de", "pt", "it", "zh", "ja", "ko", "ar", "ru"], needs: ["result", "text"], assets: "has", fresh: false },
  { id: "shorten", label: "Make it shorter", expert: "Shorten", why: "A shorter version is quicker to use.", stage: { result: 0.5, refine: 0.8, finish: 0.3 }, types: ["text"], langs: [], needs: ["result", "text"], assets: "has", fresh: true },
  { id: "to-remix", label: "Open in Remix", expert: "Send to Remix", why: "Remix can build on this.", stage: { result: 0.4, refine: 0.6, finish: 0.2 }, types: ["code", "remix"], langs: [], needs: ["result"], assets: "has", fresh: false },
  { id: "save-media", label: "Save to project media", expert: "Save to Media", why: "Keep the image or clip with your project.", stage: { result: 0.6, refine: 0.4, finish: 0.5 }, types: ["image", "media"], langs: [], needs: ["result", "project"], assets: "has", fresh: false },
  { id: "start", label: "Start something new", expert: "New command", why: "Nothing is made yet. Type what you want in the box.", stage: { idea: 1 }, types: [], langs: [], needs: [], assets: "none", fresh: false },
  { id: "pick-project", label: "Pick a project", expert: "Working in", why: "A project keeps your work together.", stage: { idea: 0.7, result: 0.2 }, types: [], langs: [], needs: ["no-project"], assets: "none", fresh: false },
  { id: "see-projects", label: "Open your projects", expert: "Projects", why: "See what you already have going.", stage: { idea: 0.5, result: 0.1 }, types: [], langs: [], needs: [], assets: "none", fresh: false },
  { id: "resume", label: "Pick up where you left off", expert: "Resume", why: "You stopped mid-way last time.", stage: { idea: 0.8 }, types: [], langs: [], needs: ["saved"], assets: "none", fresh: false },
]);

const clamp01 = (n) => (n > 1 ? 1 : n > 0 ? n : 0);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// A rough language guess with no library: letters outside basic Latin, then common words.
const STOP = {
  en: ["the", "and", "you", "for", "with", "this", "that", "are", "your"],
  es: ["el", "la", "los", "las", "que", "para", "con", "una", "por", "como"],
  fr: ["le", "les", "des", "une", "pour", "avec", "est", "dans", "vous", "que"],
  de: ["der", "die", "und", "das", "ist", "nicht", "mit", "ein", "für", "sie"],
  pt: ["os", "as", "uma", "para", "com", "não", "você", "são", "mais"],
  it: ["il", "che", "per", "una", "con", "non", "sono", "della", "gli"],
};
export function guessLang(text) {
  const t = String(text ?? "").slice(0, 600);
  if (!t.trim()) return "en";
  if (/[一-鿿]/.test(t)) return "zh";
  if (/[぀-ヿ]/.test(t)) return "ja";
  if (/[가-힯]/.test(t)) return "ko";
  if (/[؀-ۿ]/.test(t)) return "ar";
  if (/[Ѐ-ӿ]/.test(t)) return "ru";
  const words = t.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
  if (words.length < 4) return "en";
  let best = "en";
  let top = 0;
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    let n = 0;
    for (const w of words) if (set.has(w)) n++;
    if (n > top) { top = n; best = lang; }
  }
  return best;
}

export function cleanWeights(raw) {
  const out = { ...DEFAULT_WEIGHTS };
  if (raw && typeof raw === "object") {
    for (const k of WEIGHT_KEYS) {
      if (raw[k] === undefined) continue;
      const v = Number(raw[k]);
      if (Number.isFinite(v)) out[k] = Math.min(MAX_WEIGHT, Math.max(0, Math.round(v * 100) / 100));
    }
  }
  return out;
}

// Turns loose input into the context the scorer reads. Safe to call with anything.
export function normalizeContext(raw = {}) {
  const c = raw && typeof raw === "object" ? raw : {};
  const hasResult = !!c.hasResult;
  const stage = STAGES.includes(c.stage) ? c.stage : hasResult ? "result" : "idea";
  const type = TYPES.includes(c.resultType) ? c.resultType : "text";
  const now = num(c.now, Date.now());
  const resultAt = num(c.resultAt, 0);
  return {
    stage, type, now, hasResult,
    hasProject: !!c.hasProject,
    hasSaved: !!c.hasSaved,
    hasAsset: c.hasAsset === undefined ? hasResult : !!c.hasAsset,
    lang: typeof c.lang === "string" && c.lang ? c.lang.slice(0, 5).toLowerCase() : guessLang(c.text),
    isText: hasResult && ["text", "code"].includes(type),
    ageMs: resultAt > 0 ? Math.max(0, now - resultAt) : null,
    history: c.history && typeof c.history === "object" ? c.history : {},
    dismissed: c.dismissed && typeof c.dismissed === "object" ? c.dismissed : {},
    justDone: typeof c.justDone === "string" ? c.justDone : "",
    running: !!c.running,
  };
}

function prereqOk(a, c) {
  for (const n of a.needs || []) {
    if (n === "result" && !c.hasResult) return false;
    if (n === "project" && !c.hasProject) return false;
    if (n === "no-project" && c.hasProject) return false;
    if (n === "text" && !c.isText) return false;
    if (n === "saved" && !c.hasSaved) return false;
  }
  return true;
}

// The six terms for one action, each 0 to 1, with the penalties in score points.
export function terms(a, c) {
  const stage_affinity = clamp01(num(a.stage?.[c.stage], 0));
  const result_type_match = !c.hasResult ? 0.5 : a.types?.length ? (a.types.includes(c.type) ? 1 : 0) : 0.6;
  let recency_boost = 0.3;
  if (a.fresh && c.ageMs !== null) recency_boost = Math.exp(-c.ageMs / (5 * 60 * 1000));
  else if (!a.fresh) recency_boost = c.ageMs !== null ? 0.4 : 0.3;
  const language_match = a.langs?.length ? (a.langs.includes(c.lang) ? 1 : 0) : 0.5;
  const asset_state_bonus = a.assets === "has" ? (c.hasAsset ? 1 : 0) : a.assets === "none" ? (c.hasAsset ? 0 : 1) : 0.5;
  const used = num(c.history[a.id], 0);
  const history_bonus = clamp01(used / 5);
  let penalties = 0;
  const dis = num(c.dismissed[a.id], 0);
  if (dis > 0) penalties += 3 * Math.exp(-Math.max(0, c.now - dis) / (30 * 60 * 1000));
  if (c.justDone === a.id) penalties += 2;
  if (c.running) penalties += 0.5;
  return { stage_affinity, result_type_match, recency_boost, language_match, asset_state_bonus, history_bonus, penalties };
}

export function scoreAction(a, c, weights = DEFAULT_WEIGHTS) {
  const t = terms(a, c);
  let s = -t.penalties;
  const parts = {};
  for (const k of WEIGHT_KEYS) { parts[k] = Math.round(t[k] * weights[k] * 100) / 100; s += t[k] * weights[k]; }
  return { score: Math.round(s * 100) / 100, parts, penalties: Math.round(t.penalties * 100) / 100 };
}

// One plain sentence: the action's reason, plus the two biggest parts for Expert.
export function explain(a, scored) {
  const top = Object.entries(scored.parts).sort((x, y) => y[1] - x[1]).slice(0, 2).filter(([, v]) => v > 0)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
  return { simple: a.why, expert: `${a.why} Score ${scored.score} (${top.join(", ")}${scored.penalties ? `, penalty ${scored.penalties}` : ""}).` };
}

// Top actions for the context. opts: { weights, disabled: [ids], lowPower, catalog, expert, max }.
// Prerequisites filter first. Falls back to the stage defaults if nothing passes. Always 2 to 4.
export function suggest(rawCtx, opts = {}) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const c = normalizeContext(rawCtx);
  const weights = cleanWeights(opts.weights);
  const off = new Set(Array.isArray(opts.disabled) ? opts.disabled : []);
  const cap = opts.lowPower ? LOW_POWER_ACTIONS : Math.min(MAX_ACTIONS, Math.max(MIN_ACTIONS, num(opts.max, MAX_ACTIONS)));
  const catalog = Array.isArray(opts.catalog) ? opts.catalog : CATALOG;
  let rows = catalog.filter((a) => !off.has(a.id) && prereqOk(a, c)).map((a) => ({ a, s: scoreAction(a, c, weights) }));
  rows.sort((x, y) => y.s.score - x.s.score || x.a.id.localeCompare(y.a.id));
  // Drop actions the person just dismissed hard, but keep the bar full from the rest.
  const picked = rows.filter((r) => r.s.score > 0).slice(0, cap);
  if (picked.length < MIN_ACTIONS) {
    for (const id of STAGE_DEFAULTS[c.stage] || []) {
      if (picked.length >= MIN_ACTIONS) break;
      const a = catalog.find((x) => x.id === id);
      if (a && !off.has(id) && prereqOk(a, c) && !picked.some((p) => p.a.id === id)) picked.push({ a, s: scoreAction(a, c, weights) });
    }
  }
  const actions = picked.map(({ a, s }) => ({ id: a.id, label: a.label, expert: a.expert, score: s.score, parts: s.parts, penalties: s.penalties, ...explain(a, s) }));
  const took = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  return { stage: c.stage, actions, took_ms: Math.round(took * 100) / 100, over_budget: took > BUDGET_MS };
}

export const STAGE_DEFAULTS = Object.freeze({
  idea: ["start", "pick-project", "see-projects"],
  result: ["variations", "refine", "finish"],
  refine: ["refine", "variations"],
  finish: ["finish", "add-project"],
});

// One-tap variations: three prompts that each change one thing. Reuses the same angles as the next
// actions bar, written here so the server and the page share one copy.
const ANGLES = [
  "Same idea, but a different mood and colors.",
  "Same idea, but closer in, with more detail.",
  "Same idea, but simpler and cleaner.",
];
export function variationText(text, n = 3) {
  const base = String(text ?? "").replace(/[#*>`|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
  if (!base) return "";
  return `Give me ${n} different versions of this. Keep each one short and label them A, B and C.\n\n${base}\n${ANGLES.slice(0, n).join("\n")}`;
}

// A small, safe snapshot for autosave. Words are cut short and nothing secret is kept.
export function checkpoint(raw = {}) {
  const c = raw && typeof raw === "object" ? raw : {};
  const cut = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  return {
    view: cut(c.view, 24),
    stage: STAGES.includes(c.stage) ? c.stage : "idea",
    resultType: TYPES.includes(c.resultType) ? c.resultType : "text",
    runId: cut(c.runId, 64),
    draft: cut(c.draft, 400),
    title: cut(c.title, 80),
    savedAt: num(c.savedAt, Date.now()),
  };
}

// Whether a saved session is worth offering back: it has something in it and the person was away.
export function shouldResume(session, now = Date.now(), idleMs = DEFAULT_IDLE_MS) {
  if (!session || session.exited) return false;
  const s = session.checkpoint;
  if (!s || !(s.draft || s.runId)) return false;
  return now - num(s.savedAt, 0) >= Math.max(1000, num(idleMs, DEFAULT_IDLE_MS)) && now - num(s.savedAt, 0) < 14 * 24 * 3600 * 1000;
}
