// Smart fallback (Phase 26, core, every customer). A job never fails just because one provider is out of
// credits, rate limited, refusing the key, unreachable or over its monthly cap.
//
//  - A trouble table per user (document "fallback.state") remembers which provider is skipped for new
//    work, why, and until when. It is fed by failed calls (here) and by the health lights (provider.status
//    events): a green light clears the entry, so a provider switches back on the next successful health
//    check or call with no manual reset. The router (router.js rank) leaves troubled providers out
//    while another is available.
//  - fallbackChat wraps chatWithTools: when a call fails for one of those reasons the same model is
//    retried through OpenRouter first (mapped model id) when an OpenRouter key exists, then the next-best
//    model for the job by the person's priority (speed, quality and cost from the registry and learned
//    skills). Every hop is announced ({ type: "fallback" }) so the feed and the deliverable say which
//    model stood in and why; the ledger line carries it too.
//  - Small jobs (short classify / summarize / title / QA calls) prefer a free tier the person has
//    (Google AI Studio, OpenRouter's free route, Groq's free tier) and never go past the daily or
//    per-minute allowance the app knows about; those calls are recorded at $0 and flagged free.
//  - Spend caps (alerts plugin) are respected: a provider at 100% of its cap is never a stand-in.
import { PROVIDERS, findModel, estimateCostAt, modelPrice } from "./registry.js";
import { assertSpendAllowed } from "./cost-guard.js";
import { hasSecret } from "./vault.js";
import { doc, putDoc, getContext, runAs } from "./store.js";
import { noteCall, BUDGET_TEXT } from "./health.js";
import { bus, emit } from "./events.js";
import { chatWithTools } from "./mcp.js";
import { rank, heuristicClassify } from "./router.js";
import { allEntries } from "./ledger.js";
import { describePause } from "./pause.js";
import { noteReply as noteFreeReply } from "./free-limits.js";
import { freeOnlyOn, freeOnlyView, freeOnlyError, isFreeModel, costTier, lastResortChoices, planFirstForCode } from "./free-first.js";

export const KIND = "fallback.settings";
export const STATE = "fallback.state";
export const KINDS = ["credits", "rate", "key", "unreachable", "server", "cap"];
// how long a provider is skipped for new work after each kind of failure; a green health light ends it early
export const COOLDOWN_MS = { credits: 15 * 60 * 1000, rate: 90 * 1000, key: 30 * 60 * 1000, unreachable: 3 * 60 * 1000, server: 3 * 60 * 1000, cap: 0 };
export const REASON = { credits: "out of credits or spending limit", rate: "rate limited", key: "key rejected", unreachable: "unreachable", server: "provider error", cap: "monthly spend cap reached", empty: "sent back an empty answer", refused: "refused or cut off the job", freeonly: "Free only is on, so a free AI took it" };
// 0.4.21: plain words for "Nothing came back" (one short phrase per AI that failed)
const PLAIN_FAIL = { credits: (n) => `${n} is out of quota or credits`, rate: (n) => `${n} is busy and asked us to slow down`, key: (n) => `${n} did not accept its key`, unreachable: (n) => `${n} could not be reached`, server: (n) => `${n} had a problem on its side`, cap: (n) => `${n} is at its spending limit`, empty: (n) => `${n} sent back nothing`, refused: (n) => `${n} refused the job or cut it off` };
export function nothingCameBack(failures = []) {
  const seen = new Set();
  const parts = [];
  for (const f of failures) {
    const key = `${f.provider}:${f.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push((PLAIN_FAIL[f.kind] || PLAIN_FAIL.server)(PROVIDERS[f.provider]?.name || f.provider));
  }
  const list = parts.length ? `${parts.join(" and ")}. ` : "";
  const credit = failures.some((f) => f.kind === "credits");
  return `Nothing came back. ${list}${credit ? "Add credits in Settings, or press" : "Press"} Try again to send it to another AI.`;
}

// Free tiers the app knows about (list limits on 2026-10-18, deliberately conservative; editable in
// Settings > Smart fallback). "on" means the person says their key is on that tier.
export const FREE_TIERS = {
  google: { name: "Google AI Studio free tier", models: ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"], perDay: 250, perMinute: 10, defaultOn: true, note: "Flash models with an AI Studio key and no card. Untick if your key has billing on, so the ledger counts those calls." },
  openrouter: { name: "OpenRouter free route", models: ["openrouter/free"], perDay: 50, perMinute: 20, defaultOn: true, note: "openrouter/free picks the best free model; the daily count is small without credits on the account." },
  groq: { name: "Groq free tier", models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"], perDay: 1000, perMinute: 30, defaultOn: true, note: "Groq keys start on a free tier with rate limits. On by default so Groq is used as a free helper; untick it if your Groq account has a card on it." },
};
// subscriptions: when API credits run out and no API route is left, answer through the person's own plan
// (server/answer-wait.js). Off means a slot fails as before.
export const DEFAULTS = { on: true, openrouterFirst: true, maxHops: 3, subscriptions: true, freeOnly: null, freeTiers: Object.fromEntries(Object.entries(FREE_TIERS).map(([k, v]) => [k, { on: v.defaultOn, perDay: v.perDay, perMinute: v.perMinute }])) };

// ---------- settings ----------
export function fallbackSettings() {
  const s = doc(KIND, () => structuredClone(DEFAULTS));
  const freeTiers = {};
  for (const k of Object.keys(FREE_TIERS)) freeTiers[k] = { ...DEFAULTS.freeTiers[k], ...(s.freeTiers?.[k] || {}) };
  return { ...DEFAULTS, ...s, freeTiers };
}
export function saveFallbackSettings(patch = {}) {
  const cur = fallbackSettings();
  const next = { ...cur };
  if (patch.on !== undefined) next.on = !!patch.on;
  if (patch.openrouterFirst !== undefined) next.openrouterFirst = !!patch.openrouterFirst;
  if (patch.subscriptions !== undefined) next.subscriptions = !!patch.subscriptions;
  // 0.4.21 Free only: true or false is the person's choice; null or "auto" goes back to "on while no paid key is saved"
  if (patch.freeOnly !== undefined) next.freeOnly = patch.freeOnly === true || patch.freeOnly === "true" ? true : patch.freeOnly === false || patch.freeOnly === "false" ? false : null;
  if (patch.maxHops !== undefined) { const n = Number(patch.maxHops); if (!Number.isInteger(n) || n < 1 || n > 6) throw Object.assign(new Error("maxHops must be a whole number from 1 to 6"), { status: 400 }); next.maxHops = n; }
  if (patch.freeTiers && typeof patch.freeTiers === "object") {
    for (const [k, v] of Object.entries(patch.freeTiers)) {
      if (!FREE_TIERS[k] || !v || typeof v !== "object") continue;
      const t = { ...next.freeTiers[k] };
      if (v.on !== undefined) t.on = !!v.on;
      for (const f of ["perDay", "perMinute"]) if (v[f] !== undefined) { const n = Number(v[f]); if (!Number.isInteger(n) || n < 0 || n > 1e6) throw Object.assign(new Error(`${f} must be a whole number of requests`), { status: 400 }); t[f] = n; }
      next.freeTiers[k] = t;
    }
  }
  putDoc(KIND, next);
  return fallbackSettings();
}

// ---------- the trouble table ----------
// Two scopes. The whole provider sits out for credits, a rejected key or a dead host; a 429 or a 503
// belongs to ONE model of it, keyed "provider:model", so the provider's other models keep working
// (0.4.21 Gemini check: Gemini 3.8 Flash busy must not bench Gemini 3.6 Flash).
export const MODEL_KINDS = ["rate", "server"];
export const modelKey = (pid, model) => `${pid}:${model}`;
const state = () => doc(STATE, () => ({ skip: {}, models: {} }));
const modelBox = (st) => (st.models ||= {});
const stillOn = (e, now = Date.now()) => !!e && (e.until == null ? e.kind !== "cap" : now < e.until);
const nameOf = (pid) => PROVIDERS[pid]?.name || (pid === "freebuff" ? "Freebuff" : pid);
const minutes = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);
// The model's own name ("Gemini 3.8 Flash"), or the id when it is not in the registry.
export function modelName(pid, model) {
  return findModel(model)?.name || PROVIDERS[pid]?.models?.find((x) => x.id === model)?.name || model;
}

export function markTrouble(pid, kind, detail = "", { quiet = false, missionId = null, model = null } = {}) {
  if (!KINDS.includes(kind) || (!PROVIDERS[pid] && pid !== "freebuff")) return null; // Freebuff is an app-like coder, not in the registry
  const st = state();
  const perModel = !!model && MODEL_KINDS.includes(kind);
  const box = perModel ? modelBox(st) : st.skip;
  const key = perModel ? modelKey(pid, model) : pid;
  const prev = box[key];
  const now = Date.now();
  const until = kind === "cap" ? null : now + COOLDOWN_MS[kind];
  const live = !!(prev && prev.kind === kind && (prev.until == null || prev.until > now));
  const announced = live && !!prev.announced; // the feed hears about each skip once, even when the health light marked it first
  const entry = { provider: pid, model: perModel ? model : null, kind, detail: String(detail || "").replace(/\s+/g, " ").trim().slice(0, 160), since: live ? prev.since : now, until, count: (prev?.count || 0) + 1, announced: announced || !quiet };
  box[key] = entry;
  putDoc(STATE, st);
  emit("fallback.skip", { provider: pid, ...entry });
  const who = perModel ? `${nameOf(pid)} ${modelName(pid, model)}` : nameOf(pid);
  if (!quiet && !announced) emit("log", { text: `${who} skipped for new work${until ? ` for ${minutes(COOLDOWN_MS[kind])}` : ""}: ${REASON[kind]}${entry.detail ? ` (${entry.detail})` : ""}. It comes back on its own when it works again.`, level: "error", missionId });
  return entry;
}
export function clearTrouble(pid, why = "") {
  const st = state();
  let dropped = false;
  if (st.skip[pid]) { delete st.skip[pid]; dropped = true; }
  for (const [k, s] of Object.entries(modelBox(st))) if (s?.provider === pid || k.startsWith(`${pid}:`)) { delete st.skip[k]; delete st.models[k]; dropped = true; }
  if (!dropped) return false;
  putDoc(STATE, st);
  emit("fallback.clear", { provider: pid, why });
  emit("log", { text: `${nameOf(pid)} is back in the rotation${why ? ` (${why})` : ""}.` });
  return true;
}
const cappedNow = () => doc("alerts.state", () => undefined)?.stop || []; // read only; the alerts plugin owns that document
// Why a provider is skipped right now, or null. The spend cap comes from the alerts plugin live.
// Raising the cap or adding $1: any "out of credits" entry that only echoes the app's own budget text is dropped, for every AI.
export function clearBudgetTrouble() {
  const st = state();
  const gone = [];
  for (const [k, s] of Object.entries(st.skip || {})) if (s?.kind === "credits" && BUDGET_TEXT.test(String(s.detail || ""))) { delete st.skip[k]; gone.push(s.provider || k); }
  if (!gone.length) return [];
  putDoc(STATE, st);
  for (const pid of gone) emit("fallback.clear", { provider: pid, why: "your budget was raised" });
  return gone;
}
export function trouble(pid) {
  const s = state().skip[pid];
  if (s && (s.until == null ? s.kind !== "cap" : Date.now() < s.until)) return { ...s, provider: pid, reason: REASON[s.kind] };
  if (cappedNow().includes(pid)) return { kind: "cap", provider: pid, model: null, detail: "100% of the monthly cap", since: null, until: null, reason: REASON.cap };
  return null;
}
// One MODEL of a provider on a cooldown (a 429 or a 503 on that model only), or null.
export function modelTrouble(pid, model) {
  if (!pid || !model) return null;
  const s = state().models?.[modelKey(pid, model)];
  return stillOn(s) ? { ...s, reason: REASON[s.kind] } : null;
}
// Every model on a cooldown right now, keyed "provider:model".
export function troubledModels() {
  const out = {}, now = Date.now();
  for (const [key, s] of Object.entries(state().models || {})) if (stillOn(s, now)) out[key] = { ...s, reason: REASON[s.kind] };
  return out;
}
// The AI's own trouble right now: the whole provider, else one of its models. Null when it can work.
export function troubleFor(pid) {
  const p = trouble(pid);
  if (p) return p;
  for (const t of Object.values(troubledModels())) if (t.provider === pid) return t;
  return null;
}
// "Gemini 3.8 Flash: busy until 8:42 PM" for one model, "Grok: out of credits" for a whole AI.
const KIND_WORD = { rate: "busy", server: "busy", credits: "out of credits", key: "key rejected", unreachable: "unreachable", cap: "spending limit reached" };
const clockTime = (ms) => { try { return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } catch { return null; } };
export function busyLine(t) {
  if (!t) return null;
  const word = KIND_WORD[t.kind] || "busy";
  const who = t.model ? modelName(t.provider, t.model) : nameOf(t.provider);
  if (!t.until) return `${who}: ${word}`;
  const at = clockTime(t.until);
  return at ? `${who}: ${word} until ${at}` : `${who}: ${word}`;
}
export function troubled() {
  const out = {};
  for (const p of Object.values(PROVIDERS)) { if (p.kind !== "text") continue; const t = trouble(p.id); if (t) out[p.id] = t; }
  return out;
}
export function sweepExpired() {
  const st = state(); let changed = false;
  const old = 24 * 3600 * 1000;
  for (const [pid, s] of Object.entries(st.skip)) if (s.until != null && Date.now() >= s.until + old) { delete st.skip[pid]; changed = true; }
  for (const [k, s] of Object.entries(modelBox(st))) if (s?.until != null && Date.now() >= s.until + old) { delete st.models[k]; changed = true; }
  if (changed) putDoc(STATE, st);
}

// Health lights feed the table: a green light clears it, a red or amber light with a known cause fills it.
export function kindFromHealth(status, detail = "") {
  const d = String(detail || "").toLowerCase();
  if (BUDGET_TEXT.test(d)) return null; // the app's own budget stop is never a provider problem
  if (status === "red") {
    if (/key rejected|workspace|api key not valid|invalid api key|incorrect api key/.test(d)) return "key";
    if (/payment|no credits|out of credits|spending limit|low balance/.test(d)) return "credits";
    if (/could not reach|network/.test(d)) return "unreachable";
    return "server";
  }
  if (status === "amber") {
    if (/rate limited|rate or quota limit/.test(d)) return "rate";
    if (/out of credits|spending limit|low balance|payment/.test(d)) return "credits";
    if (/server error/.test(d)) return "server";
    if (/network error/.test(d)) return "unreachable";
  }
  return null; // grey (no key), or amber for an incident / slowness: a penalty in the ranking, not a skip
}
bus.on("event", (ev) => {
  if (ev.type !== "provider.status" || !PROVIDERS[ev.provider] || PROVIDERS[ev.provider].kind !== "text") return;
  const c = getContext(ev.user); if (!c) return;
  try {
    runAs(c, () => {
      if (ev.status === "green") clearTrouble(ev.provider, "health check passed");
      else if (ev.status === "grey") clearTrouble(ev.provider, "key removed");
      else { const k = kindFromHealth(ev.status, ev.detail); if (k) markTrouble(ev.provider, k, ev.detail, { quiet: true }); }
    });
  } catch {}
});

// ---------- classifying a failed call ----------
export function troubleKind(e) {
  if (!e) return null;
  const s = Number(e.status) || 0;
  const m = String(e.message || "").toLowerCase();
  if (e.name === "AbortError" || /mission aborted|aborted/.test(m) && !s) return null;
  // the app's own monthly budget stop is not a provider problem: never bench a provider for it
  if (e.code === "budget_cap" || /this month's budget is used up|monthly budget/.test(m)) return null;
  if (/no api key saved/.test(m)) return "key";
  if (s === 402 || /credit|spending limit|spend limit|insufficient_quota|insufficient quota|exceeded your current quota|billing|balance is too low|payment required|out of credits/.test(m)) return "credits";
  // 0.4.21: a 429 that says the quota is gone (no free-tier quota, limit 0) is not a short rate limit: remember it like no credits
  if (s === 429 && /quota|limit: ?0|free.?tier|check your plan/.test(m) && !/per minute|per second|retry in|try again in|requests per/.test(m)) return "credits";
  if (s === 429 || /rate limit|rate_limit|too many requests|resource_exhausted|quota/.test(m)) return "rate";
  if (s === 401 || s === 403 || /key rejected|invalid api key|incorrect api key|authentication_error|unauthorized|forbidden/.test(m)) return "key";
  if (s === 0 || /network error|could not reach|fetch failed|econnrefused|econnreset|enotfound|etimedout|timed out|socket hang up|connect timeout/.test(m)) return "unreachable";
  if (s >= 500) return "server";
  return null;
}

// ---------- OpenRouter: the same model through another door ----------
const OR_NAMESPACE = { anthropic: "anthropic", openai: "openai", xai: "x-ai", google: "google", deepseek: "deepseek", mistral: "mistralai", perplexity: "perplexity" };
export function openrouterId(provider, model) {
  if (!provider || !model || provider === "openrouter") return null;
  const ns = OR_NAMESPACE[provider];
  if (ns) return `${ns}/${model}`;
  if (PROVIDERS[provider]?.custom) return null; // a gateway of the person's own: no public mapping
  return model.includes("/") ? model : null;  // Groq serves open models under their public ids already
}
export const openrouterReady = () => !!PROVIDERS.openrouter && hasSecret("openrouter", PROVIDERS.openrouter.keyEnv) && !trouble("openrouter");

// ---------- free tiers ----------
function localDayStart(now = Date.now()) { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
// requests today and in the last minute on a provider's free models (every call counts, free or not)
export function freeUsage(pid) {
  const tier = FREE_TIERS[pid]; if (!tier) return { today: 0, minute: 0 };
  const models = new Set(tier.models);
  const now = Date.now(), day = localDayStart(now), minute = now - 60000;
  let today = 0, lastMinute = 0;
  const entries = allEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.ts < day) break;
    if (e.kind !== "call" || e.provider !== pid || !models.has(e.model)) continue;
    today++;
    if (e.ts >= minute) lastMinute++;
  }
  return { today, minute: lastMinute };
}
// Is this call free right now? The tier is on, the model is one of its free models, and the allowance has room.
export function freeNow(pid, model) {
  const tier = FREE_TIERS[pid]; if (!tier || !tier.models.includes(model)) return false;
  const s = fallbackSettings().freeTiers[pid]; if (!s?.on) return false;
  if (!PROVIDERS[pid] || !hasSecret(pid, PROVIDERS[pid].keyEnv) || trouble(pid)) return false;
  const u = freeUsage(pid);
  return u.today < s.perDay && u.minute < s.perMinute;
}
export function freeTierView() {
  const s = fallbackSettings();
  return Object.entries(FREE_TIERS).map(([pid, t]) => { const u = freeUsage(pid); const st = s.freeTiers[pid]; return { provider: pid, providerName: nameOf(pid), name: t.name, note: t.note, models: t.models, on: st.on, perDay: st.perDay, perMinute: st.perMinute, listPerDay: t.perDay, listPerMinute: t.perMinute, usedToday: u.today, usedMinute: u.minute, keyed: !!PROVIDERS[pid] && hasSecret(pid, PROVIDERS[pid].keyEnv), eligibleNow: t.models.some((m) => freeNow(pid, m)) }; });
}

// ---------- choosing a stand-in ----------
// 0. another model of the SAME provider first: cheapest and free first, never one already tried, never
//    one on a cooldown, never a paid model when Free only is on. A 429 or a 503 only benches the model
//    that got it, so the rest of this AI's family is still the first choice before any other provider.
export function sameProviderChoice({ provider, model, tried = [], freeOnly = freeOnlyOn(), capped = cappedNow() }) {
  const p = PROVIDERS[provider];
  if (!p || p.kind !== "text" || p.demo) return null;
  if (trouble(provider) || capped.includes(provider)) return null; // credits, a bad key or a cap sits the whole AI out
  const used = new Set(tried.map((t) => t.model));
  const ban = troubledModels();
  const list = (p.models || []).filter((m) => m.id !== model && !used.has(m.id) && !ban[modelKey(provider, m.id)] && (!freeOnly || isFreeModel(provider, m.id)));
  if (!list.length) return null;
  const price = (m) => { const pr = modelPrice(m.id); return (pr.in || 0) + (pr.out || 0); };
  const best = list.map((m, i) => [m, i]).sort((a, b) => costTier(provider, a[0].id) - costTier(provider, b[0].id) || price(a[0]) - price(b[0]) || a[1] - b[1])[0][0];
  return { provider, model: best.id, name: best.name, via: null, priceModel: null, free: !!isFreeModel(provider, best.id), same: true };
}

export function nextChoice({ provider, model, tried = [], cls = {}, mode = "balanced", small = false, settings = fallbackSettings(), allowStandIn = true, skipSame = false }) {
  const triedProviders = new Set(tried.map((t) => t.provider));
  const triedModels = tried.map((t) => t.model);
  const capped = cappedNow();
  const freeOnly = freeOnlyOn();
  // 0. another model of this same AI, before anything else (see above)
  const same = skipSame ? null : sameProviderChoice({ provider, model, tried, freeOnly, capped }); // an AI that refused earlier in this run is not asked again, not even a sibling model
  if (same) return same;
  // no other provider may stand in unless the caller allows it (Auto / unpinned routes do)
  if (allowStandIn !== true) return null;
  // 1. a coding job reaches Claude Code (the person's own plan) first
  const code = planFirstForCode({ tried, cls, freeOnly });
  if (code && !freeOnly) return code;
  // 2. the same model through OpenRouter (a paid route: never while Free only is on)
  if (!freeOnly && settings.openrouterFirst && !triedProviders.has("openrouter") && openrouterReady() && !capped.includes("openrouter")) {
    const id = openrouterId(provider, model);
    if (id) return { provider: "openrouter", model: id, name: `${modelName(provider, model)} via OpenRouter`, via: "openrouter", priceModel: model };
  }
  // 3. the next-best model for the job, from a provider not yet tried, not troubled, not capped.
  //    Free first: this PC, then free allowances, then paid. Quality and Max quality keep the ranking as it is.
  const skip = troubled();
  const skipModel = troubledModels();
  const ok = (m) => !triedProviders.has(m.provider) && !triedModels.includes(m.model) && !skip[m.provider] && !skipModel[modelKey(m.provider, m.model)] && !capped.includes(m.provider) && m.provider !== provider && (!freeOnly || isFreeModel(m.provider, m.model));
  let list = rank({ capability: cls.capability || "reasoning", difficulty: cls.difficulty || 2, mode, needWeb: !!cls.needWeb, small, exclude: triedModels }).filter(ok);
  if (!list.length && cls.needWeb) list = rank({ capability: cls.capability || "reasoning", difficulty: cls.difficulty || 2, mode, small, exclude: triedModels }).filter(ok);
  const qualityFirst = mode === "quality" || mode === "max";
  if (!qualityFirst && list.length > 1) list = list.map((m, i) => [m, i]).sort((a, b) => costTier(a[0].provider, a[0].model) - costTier(b[0].provider, b[0].model) || a[1] - b[1]).map((x) => x[0]);
  const m = list[0];
  return m ? { provider: m.provider, model: m.model, name: m.name, via: null, priceModel: null, free: !!m.free } : null;
}

// A refusal ("I can't help with that") or an answer that was cut off before it said anything useful.
const REFUSAL = /^\s*(i['’]?m sorry,? but i (can['’]?t|cannot|am unable)|i (can['’]?t|cannot|am unable to|won['’]?t) (help|assist|comply|provide|do)|sorry,? (but )?i (can['’]?t|cannot)|as an ai[^.]{0,40}(cannot|can['’]?t)|i['’]?m unable to (help|assist|comply|provide))/i;
export function badAnswer(text, doneEv = {}) {
  const t = String(text || "").trim();
  if (t.length < 400 && REFUSAL.test(t)) return true;
  const stop = String(doneEv.stop || "").toLowerCase();
  if (/length|max_tokens|truncat/.test(stop) && t.length < 120) return true;
  return false;
}

// ---------- the call wrapper ----------
// Same events as chatWithTools (delta, tool, done) plus { type: "fallback", from, to, reason, kind, via, hop, restart }.
// `done` carries provider / model actually used and usage.fallback / usage.free / usage.priceModel for the ledger.
// run: { missionId, taskId, tools, role, cls, mode, small, hint }
export async function* fallbackChat(opts, run = {}) {
  const settings = fallbackSettings();
  let provider = typeof opts.provider === "string" ? opts.provider : opts.provider?.id;
  let model = opts.model;
  const small = run.small ?? (Number(opts.maxTokens) > 0 && Number(opts.maxTokens) <= 700);
  const lastUser = [...(opts.messages || [])].reverse().find((m) => m.role === "user");
  const cls = run.cls || heuristicClassify(typeof lastUser?.content === "string" ? lastUser.content : "");
  const mode = run.mode || "balanced";
  // 0.4.21 Gemini check: the person pinned an AI (an explicit provider and model). Another provider may
  // only stand in when the route sets allowStandIn (Auto and the unpinned routes do). Otherwise the
  // stand-ins are other models of this same AI, and then a plain stop.
  const allowStandIn = opts.allowStandIn === true;
  const outOfOptions = () => Object.assign(new Error(`${modelName(provider, model)} is busy or out. Pick another AI or turn on Let Meldmind choose.`), { code: "pinned_out", status: 409 });
  const freeTier = !!PROVIDERS[provider]?.demo || freeNow(provider, model);
  const freeOnly = freeOnlyOn();
  // Free only: a paid first pick is swapped for a free AI before anything is sent (below). It never spends.
  const wantsPaid = freeOnly && !isFreeModel(provider, model);
  if (!wantsPaid) assertSpendAllowed({ provider, estimate: freeTier ? 0 : estimateCostAt(model, 1500, 800), free: freeTier });
  // run.avoid: models already busy on this job (other council members), never picked as a stand-in
  const tried = (run.avoid || []).filter((a) => a?.provider && a?.model).map((a) => ({ provider: a.provider, model: a.model, avoid: true }));
  const chain = [];
  let via = null, priceModel = null, hop = 0;

  let lastResortHops = 0;
  const switchTo = (next, kind, detail, restart) => {
    const from = { provider, model, name: modelName(provider, model), providerName: nameOf(provider) };
    const to = { provider: next.provider, model: next.model, name: next.name || modelName(next.provider, next.model), providerName: nameOf(next.provider), via: next.via || null };
    const reason = `${REASON[kind]}${detail ? `: ${String(detail).replace(/\s+/g, " ").trim().slice(0, 140)}` : ""}`;
    // last-resort free hops are numbered after the counted ones but never use up maxHops
    // (same-provider hops do not count either: this AI's own family goes before any other provider)
    if (next.lastResort) lastResortHops++; else if (!next.same) hop++;
    chain.push({ from, to, kind, reason, via: next.via || null, hop: hop + lastResortHops, at: Date.now(), role: run.role || null, taskId: run.taskId || null, lastResort: !!next.lastResort, same: !!next.same, why: next.why || null });
    emit("log", { text: `${from.providerName} could not take this job (${reason}). ${to.name}${to.via ? "" : ` (${to.providerName})`} is standing in.`, missionId: run.missionId || null });
    provider = next.provider; model = next.model; via = next.via || null; priceModel = next.priceModel || null;
    return { type: "fallback", from, to, kind, reason, via: next.via || null, hop: hop + lastResortHops, restart: !!restart, taskId: run.taskId || null, lastResort: !!next.lastResort, why: next.why || null };
  };

  // the next stand-in: the same AI's own models first, then the counted ranking (until maxHops),
  // then the built-in free AIs, which never use up a hop. No other provider unless allowStandIn is true.
  const rateHit = new Set(); // a 429 sends the job to another company first, a sibling model of the same key only if nobody else is left
  const stand = () => {
    const skipSame = !!run.skipProviders?.has(provider);
    if (!allowStandIn) return nextChoice({ provider, model, tried, cls, mode, small, settings, allowStandIn: false, skipSame });
    const other = (hop < settings.maxHops && rateHit.has(provider) && !skipSame) ? nextChoice({ provider, model, tried, cls, mode, small, settings, allowStandIn: true, skipSame: true }) : null;
    if (other && !other.same) return other;
    const counted = hop < settings.maxHops ? nextChoice({ provider, model, tried, cls, mode, small, settings, allowStandIn: true, skipSame }) : null;
    return counted || lastResortChoices({ tried, cls, freeOnly })[0] || null;
  };

  // Free only: never start on a paid AI
  if (wantsPaid) {
    tried.push({ provider, model });
    const next = nextChoice({ provider, model, tried, cls, mode, small, settings, allowStandIn }) || (allowStandIn ? lastResortChoices({ tried, cls, freeOnly })[0] : null);
    if (!next) throw freeOnlyError();
    yield switchTo(next, "freeonly", "", false);
  }
  // known trouble before the first call: do not even try
  if (settings.on) {
    // run.skipProviders: an AI that already said no credits / slow down earlier in this run is not asked again
    const t = trouble(provider) || modelTrouble(provider, model) || (run.skipProviders?.has(provider) ? { kind: "credits", detail: "it refused earlier in this run" } : null);
    if (t) {
      tried.push({ provider, model });
      const next = stand();
      if (next) yield switchTo(next, t.kind, `skipped, ${t.detail || "known problem"}`, false);
      else if (!allowStandIn) throw outOfOptions();
      else if (!t.model && (t.kind === "credits" || t.kind === "rate")) { // a benched MODEL alone is not a pause: the call is tried anyway
        const info = describePause(provider);
        const e = new Error(info?.message || `${nameOf(provider)} is paused: no credits. Add credits to use it.`);
        e.code = "paused";
        e.kind = t.kind;
        e.status = 402;
        throw e;
      }
    }
  }

  const failures = [];
  while (true) {
    const free = freeNow(provider, model);
    let text = "", sawTool = false, doneEv = null;
    const t0 = Date.now();
    try {
      for await (const ev of chatWithTools({ ...opts, provider, model }, { missionId: run.missionId, taskId: run.taskId, tools: run.tools, allow: run.allow, noSend: run.noSend === true })) {
        if (ev.type === "delta") { text += ev.text; yield ev; }
        else if (ev.type === "done") doneEv = ev;
        else { if (ev.type === "tool") sawTool = true; yield ev; }
      }
      // 0.4.21: a job that ends with no words and no tool work is a failure, never "done" with an empty deliverable
      if (doneEv && !text.trim() && !sawTool && !run.allowEmpty) throw Object.assign(new Error(`${nameOf(provider)} sent back an empty answer.`), { code: "empty", status: 502 });
      // 0.4.21: a refusal or an answer cut off before it said anything is a failure too: the next AI takes it
      if (doneEv && !sawTool && !run.allowEmpty && badAnswer(text, doneEv)) throw Object.assign(new Error(`${nameOf(provider)} refused the job or cut it off.`), { code: "refused", status: 502 });
      if (doneEv) {
        const usage = { ...(doneEv.usage || {}) };
        if (free) usage.free = true;
        if (priceModel && typeof usage.cost !== "number") usage.priceModel = priceModel;
        if (chain.length) usage.fallback = { from: chain[0].from.provider, fromModel: chain[0].from.model, kind: chain[chain.length - 1].kind, via, hops: chain.length, ...(chain.some((c) => c.lastResort) ? { lastResort: true } : {}) };
        yield { ...doneEv, usage, provider, model, via, fallback: chain.length ? chain : null };
      }
      return;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      // a spend-cap stop is not a provider fault: no failure on its record, no trouble mark, just a stand-in
      const kind = e.code === "empty" ? "empty" : e.code === "refused" ? "refused" : e.code === "cap" ? "cap" : troubleKind(e);
      if (kind) failures.push({ provider, kind });
      if (kind === "credits" || kind === "rate") noteFreeReply(provider, { status: e.status, text: e.message }); // 0.4.22 daily limit tracker
      if (kind === "rate") rateHit.add(provider);
      if (kind === "credits" || kind === "rate") { run.skipProviders?.add(provider); run.onTrouble?.(provider, kind); }
      if (!kind || !settings.on) { if (kind) { e.failures = failures; e.plain = nothingCameBack(failures); if (e.code === "empty" || e.code === "refused") e.message = e.plain; } throw e; }
      // A failure that belongs to one model is remembered on that model only, and never moves the
      // provider's own health light: the rest of the AI's models stay usable (0.4.21 Gemini check).
      const oneModel = !!model && (kind === "empty" || kind === "rate" || kind === "server");
      if (kind === "empty") { if (!oneModel) noteCall(provider, false, Date.now() - t0, e); markTrouble(provider, "server", "sent back an empty answer", { quiet: true, missionId: run.missionId || null, model }); }
      else if (kind === "refused") noteCall(provider, false, Date.now() - t0, e); // the AI is fine; this one job went to another
      else if (kind !== "cap") { if (!oneModel) noteCall(provider, false, Date.now() - t0, e); markTrouble(provider, kind, e.message, { missionId: run.missionId || null, model }); }
      tried.push({ provider, model });
      const next = stand();
      if (!next) {
        if (!allowStandIn) { const stop = outOfOptions(); stop.failures = failures; throw stop; }
        e.failures = failures; e.plain = nothingCameBack(failures); if (kind === "empty" || kind === "refused") e.message = e.plain; throw e;
      }
      yield switchTo(next, kind, e.message, text.length > 0);
    }
  }
}

// Non-streaming convenience, like providers.complete: { text, usage, stop, provider, model, via, fallback }.
export async function completeFallback(opts, run = {}, { onDelta, onFallback } = {}) {
  let text = "", usage = { input: 0, output: 0 }, stop = null, provider = opts.provider, model = opts.model, via = null, fallback = null;
  for await (const ev of fallbackChat(opts, run)) {
    if (ev.type === "delta") { text += ev.text; onDelta?.(ev.text); }
    else if (ev.type === "fallback") { if (ev.restart) text = ""; onFallback?.(ev); }
    else if (ev.type === "done") { usage = ev.usage; stop = ev.stop; provider = ev.provider; model = ev.model; via = ev.via; fallback = ev.fallback; }
  }
  return { text, usage, stop, provider, model, via, fallback };
}

// The compact form of a fallback event that runs keep (single.fallbacks, council.fallbacks, mission.fallbacks).
export const fallbackRecord = (ev) => ({ from: { provider: ev.from.provider, model: ev.from.model, name: ev.from.name }, to: { provider: ev.to.provider, model: ev.to.model, name: ev.to.name }, kind: ev.kind, reason: ev.reason, via: ev.via || null, hop: ev.hop, taskId: ev.taskId || null, at: Date.now() });

// Feed plumbing for callers: close the old agent, open the new one, and tell the graph who handed off to whom.
export function announce(ev, { missionId, taskId = null, agentFrom, agentTo, role, label }) {
  emit("agent.error", { agent: agentFrom, provider: ev.from.provider, model: ev.from.model, missionId, taskId, error: `${ev.from.providerName}: ${ev.reason}` });
  emit("agent.msg", { from: ev.from.provider, to: ev.to.provider, missionId, text: `stand in${ev.via ? " via OpenRouter" : ""}: ${ev.kind === "cap" ? "cap reached" : REASON[ev.kind]}` });
  emit("agent.start", { agent: agentTo, provider: ev.to.provider, model: ev.to.model, role, missionId, taskId, label: label || `${ev.to.providerName} standing in for ${ev.from.providerName} (${REASON[ev.kind]})${ev.via ? ", same model via OpenRouter" : ""}` });
}

// The view for Settings and the command strip.
export function fallbackView() {
  sweepExpired();
  const skip = troubled();
  const now = Date.now();
  const entries = allEntries();
  const recent = [];
  for (let i = entries.length - 1; i >= 0 && recent.length < 20; i--) { const e = entries[i]; if (e.kind === "call" && e.fallback) recent.push({ ts: e.ts, provider: e.provider, model: e.model, from: e.fallback.from, fromModel: e.fallback.fromModel, kind: e.fallback.kind, via: e.fallback.via, cost: e.cost, role: e.role, missionId: e.missionId }); }
  const month = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  let standInsMonth = 0, freeMonth = 0;
  for (let i = entries.length - 1; i >= 0; i--) { const e = entries[i]; if (e.ts < month) break; if (e.kind !== "call") continue; if (e.fallback) standInsMonth++; if (e.free) freeMonth++; }
  const skipRow = (pid, model, t) => ({ provider: pid, providerName: nameOf(pid), model: model || null, modelName: model ? modelName(pid, model) : null, kind: t.kind, reason: t.reason, detail: t.detail || "", since: t.since, until: t.until, leftMs: t.until ? Math.max(0, t.until - now) : null, line: busyLine({ ...t, provider: pid, model }) });
  return {
    settings: fallbackSettings(),
    skipped: [
      ...Object.entries(skip).map(([pid, t]) => skipRow(pid, null, t)),
      ...Object.values(troubledModels()).map((t) => skipRow(t.provider, t.model, t)),
    ],
    openrouter: { keyed: !!PROVIDERS.openrouter && hasSecret("openrouter", PROVIDERS.openrouter.keyEnv), ready: openrouterReady() },
    freeTiers: freeTierView(),
    freeOnly: freeOnlyView(),
    recent, standInsMonth, freeMonth, reasons: REASON,
  };
}
