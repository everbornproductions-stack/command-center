// Free first (0.4.18, Chris approved 2026-10-22). Light jobs (reading, summarizing, drafting, a first-pass
// review, research, a rewrite) try free AIs first, in the one order kept in server/free-ai.json:
//   1. free OpenRouter models (when an OpenRouter key exists)
//   2. Gemini on this computer (the Gemini command-line app, signed in with the person's Google account)
//   3. Google Antigravity (when signed in)
//   4. a local model through Ollama (when it is running and has a model)
// Hard work (final answers to hard questions, complex code, council judging) stays on the paid route.
// A free answer that fails a quick check (empty, an error, too short, a refusal, off topic) is redone by the
// normal paid route. Each route has a daily counter and a limit; a route at its limit, or one that said
// "rate limited", sits out (the same cooldowns as smart fallback). Nothing here signs in for anyone.
import { CONFIG } from "./gpu.js";
import { doc, putDoc, HOSTED } from "./store.js";
import { normalizeMode } from "./modes.js";
import { estimateCostAt, PROVIDERS } from "./registry.js";
import { hasSecret } from "./vault.js";
import { trouble, markTrouble, troubleKind, COOLDOWN_MS } from "./fallback.js";
import { routeById as subRoute, routeStatus, askApp } from "./sub-routes.js";
import { complete } from "./providers.js";

export const SETTINGS = "freefirst.settings";
export const USAGE = "freefirst.usage";
export const ORDER = CONFIG.order;
export const ROUTES = CONFIG.routes;
export const OLLAMA_URL = () => (process.env.CC_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");

// ---------- settings ----------
export function freeSettings() {
  let d = null;
  try { d = doc(SETTINGS, () => ({})); } catch { d = null; }
  const raw = d && typeof d === "object" ? d : {};
  const routes = {}, limits = {};
  for (const id of ORDER) {
    routes[id] = raw.routes?.[id] !== false;
    const n = Number(raw.limits?.[id]);
    limits[id] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : ROUTES[id].perDay;
  }
  // CC_FREE_FIRST=off is for test servers only (test/helpers.js)
  return { on: raw.on !== false && process.env.CC_FREE_FIRST !== "off", qualityToo: raw.qualityToo === true, routes, limits, ollamaModel: typeof raw.ollamaModel === "string" ? raw.ollamaModel : "" };
}
export function saveFreeSettings(patch = {}) {
  const cur = freeSettings();
  let rawOn = true;
  try { rawOn = doc(SETTINGS, () => ({})).on !== false; } catch {}
  const next = { ...cur, on: rawOn, routes: { ...cur.routes }, limits: { ...cur.limits } };
  if (typeof patch.on === "boolean") next.on = patch.on;
  if (typeof patch.qualityToo === "boolean") next.qualityToo = patch.qualityToo;
  for (const [id, v] of Object.entries(patch.routes || {})) if (ORDER.includes(id) && typeof v === "boolean") next.routes[id] = v;
  for (const [id, v] of Object.entries(patch.limits || {})) { const n = Number(v); if (ORDER.includes(id) && Number.isFinite(n) && n >= 0 && n <= 100000) next.limits[id] = Math.floor(n); }
  if (typeof patch.ollamaModel === "string" && /^[\w.:\/-]{0,80}$/.test(patch.ollamaModel)) next.ollamaModel = patch.ollamaModel;
  putDoc(SETTINGS, next);
  return freeSettings();
}

// ---------- which jobs are light ----------
const LIGHT = [
  ["summarize", /\b(summari[sz]e|summary|tl;?dr|key points|recap|condense|shorten)\b/i],
  ["rewrite", /\b(rewrite|rephrase|reword|paraphrase|proofread|fix (?:the )?(?:grammar|spelling|typos)|make (?:it|this) (?:shorter|clearer|friendlier|more formal))\b/i],
  ["draft", /\b(draft|first draft|outline|brainstorm|ideas for|write (?:a|an) (?:short )?(?:email|post|caption|bio|note|message|tweet))\b/i],
  ["review", /\b(first[- ]pass|quick (?:look|review|check)|look over|proof ?read)\b/i],
  ["research", /\b(research|look up|find out|what is|what are|who is|explain|define|compare)\b/i],
  ["reading", /\b(read (?:this|the)|extract|pull out|list the|translate|classify|tag these)\b/i],
];
const HARD = /\b(final (?:answer|version|decision)|council|judge|verdict|implement|refactor|debug|architecture|production|security review|legal advice|contract|prove|derive)\b/i;

// { light, type }. Hard: code at difficulty 2 or more, difficulty 3, a long request, or a hard-work word.
export function jobKind(prompt, cls = {}, { role = "answer" } = {}) {
  const p = String(prompt || "");
  if (role && role !== "answer") return { light: false, type: role };
  if (HARD.test(p)) return { light: false, type: "hard" };
  if (cls.capability === "code" && (cls.difficulty || 2) >= 2) return { light: false, type: "code" };
  if ((cls.difficulty || 1) >= 3 || p.length > 6000) return { light: false, type: "hard" };
  for (const [type, re] of LIGHT) if (re.test(p)) return { light: true, type };
  if (cls.capability === "writing" || cls.capability === "research" || cls.capability === "fast") return { light: true, type: cls.capability === "research" ? "research" : "draft" };
  return { light: false, type: "general" };
}

// Quality and Max quality skip Free first unless the person ticked "also in Quality"; Balanced, Max savings and Speed use it.
export function modeUsesFree(mode, s = freeSettings()) {
  const m = normalizeMode(mode) || "balanced";
  if (m === "quality" || m === "max") return s.qualityToo;
  return true;
}

// ---------- the quick check ----------
const REFUSAL = /^(?:i(?:'| a)m sorry|sorry,)?[^.]{0,40}\b(i can(?:no|')t|i am unable to|i'm not able to|i won't) (?:help|assist|do|provide|answer)/i;
const ERRORISH = /^(?:error|exception|traceback|rate limit|quota|429|503|internal server error)\b/i;
const STOP = new Set("the a an and or of to in on for with is are be this that it as at by from my your me you i we our what how why can could would please about into".split(" "));
const words = (s) => (String(s).toLowerCase().match(/[a-z][a-z0-9']{3,}/g) || []).filter((w) => !STOP.has(w));
export function passesCheck(text, prompt = "") {
  const t = String(text || "").trim();
  if (!t) return { ok: false, why: "empty" };
  if (ERRORISH.test(t)) return { ok: false, why: "error" };
  if (REFUSAL.test(t.slice(0, 200))) return { ok: false, why: "refusal" };
  const min = Math.min(60, Math.max(12, Math.round(String(prompt).length / 20)));
  if (t.length < min) return { ok: false, why: "too short" };
  // off topic: a longer question shares no meaningful word with the answer
  const pw = [...new Set(words(prompt))];
  if (pw.length >= 4) { const tw = new Set(words(t)); if (!pw.some((w) => tw.has(w))) return { ok: false, why: "off topic" }; }
  return { ok: true };
}

// ---------- counters and limits ----------
const today = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export function usage(now = Date.now()) {
  let d = null;
  try { d = doc(USAGE, () => ({})); } catch { d = null; }
  const day = today(now);
  const raw = d && typeof d === "object" ? d : {};
  const fresh = raw.day === day;
  return { day, counts: fresh ? { ...(raw.counts || {}) } : {}, jobs: fresh ? Number(raw.jobs) || 0 : 0, savedUsd: fresh ? Number(raw.savedUsd) || 0 : 0, skip: { ...(raw.skip || {}) } };
}
const saveUsage = (u) => putDoc(USAGE, u);
export function atLimit(id, s = freeSettings(), u = usage()) {
  const lim = s.limits[id];
  return lim > 0 && (u.counts[id] || 0) >= lim;
}
export function skipped(id, u = usage(), now = Date.now()) { return (u.skip[id] || 0) > now; }
export function noteRate(id, now = Date.now(), ms = COOLDOWN_MS.rate * 20) {
  const u = usage(now); u.skip[id] = now + ms; saveUsage(u);
}
export function noteFreeJob(id, savedUsd = 0, now = Date.now()) {
  const u = usage(now);
  u.counts[id] = (u.counts[id] || 0) + 1;
  u.jobs += 1;
  u.savedUsd = +(u.savedUsd + Math.max(0, Number(savedUsd) || 0)).toFixed(6);
  saveUsage(u);
  return u;
}
export function todayLine(u = usage()) {
  return `Free AI used today: ${u.jobs} job${u.jobs === 1 ? "" : "s"}, about $${u.savedUsd.toFixed(2)} saved`;
}
// What the paid pick would have cost (the receipt's price table), from rough token counts.
export function savedFor(paidModel, prompt, answer) {
  const tin = Math.ceil(String(prompt || "").length / 4), tout = Math.ceil(String(answer || "").length / 4);
  try { return +estimateCostAt(paidModel, tin, tout).toFixed(6); } catch { return 0; }
}

// ---------- availability ----------
let ollamaCache = { at: 0, models: null };
export async function ollamaModels({ fetchImpl = fetch, fresh = false } = {}) {
  if (!fresh && ollamaCache.models && Date.now() - ollamaCache.at < 60000) return ollamaCache.models;
  let models = [];
  try {
    const ctl = AbortSignal.timeout(1500);
    const r = await fetchImpl(`${OLLAMA_URL()}/api/tags`, { signal: ctl });
    if (r.ok) models = ((await r.json())?.models || []).map((m) => String(m.name || m.model || "")).filter(Boolean);
  } catch { models = null; }
  ollamaCache = { at: Date.now(), models };
  return models;
}
export const clearCache = () => { ollamaCache = { at: 0, models: null }; };

// { id, status: ready | missing | signin | nokey, label }
const LABEL = { ready: "Ready", missing: "Not installed", signin: "Sign in needed", nokey: "Needs an OpenRouter key", nomodel: "No model yet" };
export async function routeState(id, opts = {}) {
  const row = (status) => ({ id, name: ROUTES[id].name, plain: ROUTES[id].plain, status, label: LABEL[status] });
  if (HOSTED && id !== "openrouter-free") return row("missing");
  if (id === "openrouter-free") return row(PROVIDERS.openrouter && hasSecret("openrouter", PROVIDERS.openrouter.keyEnv) ? "ready" : "nokey");
  if (id === "gemini-cli" || id === "antigravity") {
    const st = await routeStatus(subRoute(id), opts);
    return { ...row(st.status === "ready" ? "ready" : st.status === "signin" ? "signin" : "missing"), path: st.path || "" };
  }
  if (id === "ollama") {
    const models = await ollamaModels(opts);
    if (models === null) return row("missing");
    return { ...row(models.length ? "ready" : "nomodel"), models };
  }
  return row("missing");
}
export async function allStates(opts = {}) { const out = []; for (const id of ORDER) out.push(await routeState(id, opts)); return out; }

// ---------- asking ----------
async function askOne(id, { prompt, system, signal, deps, s, state }) {
  if (id === "openrouter-free") {
    let last = null;
    for (const model of CONFIG.openrouterModels) {
      try {
        const r = await (deps.complete || complete)({ provider: "openrouter", model, maxTokens: 1500, signal, system: system || "You are a helpful assistant. Markdown allowed. No filler.", messages: [{ role: "user", content: prompt }] });
        return { ok: true, text: r.text, model, usage: r.usage };
      } catch (e) { last = e; if (troubleKind(e) === "rate") break; }
    }
    const kind = troubleKind(last);
    return { ok: false, code: kind === "rate" ? "quota" : "failed", message: last?.message || "no answer" };
  }
  if (id === "gemini-cli" || id === "antigravity") {
    const route = { ...subRoute(id), path: state.path || "" };
    const ask = system ? `${system}\n\n${prompt}` : prompt;
    const r = await (deps.askApp || askApp)(route, ask, { signal, timeoutMs: Number(process.env.CC_FREE_TIMEOUT_MS) || 120000 });
    return { ...r, model: id };
  }
  if (id === "ollama") {
    const model = (s.ollamaModel && state.models?.includes(s.ollamaModel)) ? s.ollamaModel : state.models?.[0];
    if (!model) return { ok: false, code: "failed", message: "no model" };
    try {
      const r = await (deps.fetch || fetch)(`${OLLAMA_URL()}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: signal || AbortSignal.timeout(180000),
        body: JSON.stringify({ model, stream: false, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
      });
      if (!r.ok) return { ok: false, code: r.status === 429 ? "quota" : "failed", message: `HTTP ${r.status}` };
      const j = await r.json();
      return { ok: true, text: String(j?.message?.content || ""), model };
    } catch (e) { return { ok: false, code: "failed", message: e.message }; }
  }
  return { ok: false, code: "failed", message: "unknown route" };
}

// Try the free routes in order. Resolves { ok: true, route, name, model, text, step, of } or { ok: false, tried }.
// onStep({ id, name, step, of }) fires before each try, for the status line.
export async function tryFree({ prompt, system = "", signal, onStep, deps = {} } = {}) {
  const s = freeSettings();
  const tried = [];
  if (!s.on) return { ok: false, tried, off: true };
  const live = ORDER.filter((id) => s.routes[id]);
  let step = 0;
  for (const id of live) {
    step++;
    const u = usage();
    if (atLimit(id, s, u)) { tried.push({ id, why: "limit" }); continue; }
    if (skipped(id, u)) { tried.push({ id, why: "rate limited" }); continue; }
    if (id === "openrouter-free" && trouble("openrouter")) { tried.push({ id, why: "openrouter trouble" }); continue; }
    const state = deps.state ? await deps.state(id) : await routeState(id);
    if (state.status !== "ready") { tried.push({ id, why: state.status }); continue; }
    onStep?.({ id, name: ROUTES[id].name, plain: ROUTES[id].plain, step, of: live.length });
    const r = await askOne(id, { prompt, system, signal, deps, s, state });
    if (signal?.aborted) return { ok: false, tried, stopped: true };
    if (!r.ok) {
      if (r.code === "quota") { noteRate(id); if (id === "openrouter-free") { try { markTrouble("openrouter", "rate", r.message, { quiet: true }); } catch {} } }
      tried.push({ id, why: r.code || "failed" });
      continue;
    }
    const chk = passesCheck(r.text, prompt);
    if (!chk.ok) { tried.push({ id, why: chk.why }); continue; }
    return { ok: true, route: id, name: ROUTES[id].name, model: r.model || id, text: String(r.text).trim(), usage: r.usage || null, step, of: live.length, tried };
  }
  return { ok: false, tried };
}

// The status line for Live ops and the answer: "Answering through Gemini on this computer, free route 2 of 4".
export const stepLine = ({ name, step, of }) => `Answering through ${name}, free route ${step} of ${of}`;
