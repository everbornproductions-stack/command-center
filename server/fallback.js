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
import { PROVIDERS, findModel } from "./registry.js";
import { hasSecret } from "./vault.js";
import { doc, putDoc, getContext, runAs } from "./store.js";
import { noteCall } from "./health.js";
import { bus, emit } from "./events.js";
import { chatWithTools } from "./mcp.js";
import { rank, heuristicClassify } from "./router.js";
import { allEntries } from "./ledger.js";
import { describePause } from "./pause.js";

export const KIND = "fallback.settings";
export const STATE = "fallback.state";
export const KINDS = ["credits", "rate", "key", "unreachable", "server", "cap"];
// how long a provider is skipped for new work after each kind of failure; a green health light ends it early
export const COOLDOWN_MS = { credits: 15 * 60 * 1000, rate: 90 * 1000, key: 30 * 60 * 1000, unreachable: 3 * 60 * 1000, server: 3 * 60 * 1000, cap: 0 };
export const REASON = { credits: "out of credits or spending limit", rate: "rate limited", key: "key rejected", unreachable: "unreachable", server: "provider error", cap: "monthly spend cap reached" };

// Free tiers the app knows about (list limits on 2026-10-18, deliberately conservative; editable in
// Settings > Smart fallback). "on" means the person says their key is on that tier.
export const FREE_TIERS = {
  google: { name: "Google AI Studio free tier", models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"], perDay: 250, perMinute: 10, defaultOn: true, note: "Flash models with an AI Studio key and no card. Untick if your key has billing on, so the ledger counts those calls." },
  openrouter: { name: "OpenRouter free route", models: ["openrouter/free"], perDay: 50, perMinute: 20, defaultOn: true, note: "openrouter/free picks the best free model; the daily count is small without credits on the account." },
  groq: { name: "Groq free tier", models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"], perDay: 1000, perMinute: 30, defaultOn: false, note: "Groq keys start on a free tier with rate limits; tick this if you have not added a card." },
};
export const DEFAULTS = { on: true, openrouterFirst: true, maxHops: 3, freeTiers: Object.fromEntries(Object.entries(FREE_TIERS).map(([k, v]) => [k, { on: v.defaultOn, perDay: v.perDay, perMinute: v.perMinute }])) };

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
const state = () => doc(STATE, () => ({ skip: {} }));
const nameOf = (pid) => PROVIDERS[pid]?.name || pid;
const minutes = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);

export function markTrouble(pid, kind, detail = "", { quiet = false, missionId = null } = {}) {
  if (!KINDS.includes(kind) || !PROVIDERS[pid]) return null;
  const st = state();
  const prev = st.skip[pid];
  const now = Date.now();
  const until = kind === "cap" ? null : now + COOLDOWN_MS[kind];
  const live = !!(prev && prev.kind === kind && (prev.until == null || prev.until > now));
  const announced = live && !!prev.announced; // the feed hears about each skip once, even when the health light marked it first
  const entry = { kind, detail: String(detail || "").replace(/\s+/g, " ").trim().slice(0, 160), since: live ? prev.since : now, until, count: (prev?.count || 0) + 1, announced: announced || !quiet };
  st.skip[pid] = entry;
  putDoc(STATE, st);
  emit("fallback.skip", { provider: pid, ...entry });
  if (!quiet && !announced) emit("log", { text: `${nameOf(pid)} skipped for new work${until ? ` for ${minutes(COOLDOWN_MS[kind])}` : ""}: ${REASON[kind]}${entry.detail ? ` (${entry.detail})` : ""}. It comes back on its own when it works again.`, level: "error", missionId });
  return entry;
}
export function clearTrouble(pid, why = "") {
  const st = state();
  if (!st.skip[pid]) return false;
  delete st.skip[pid];
  putDoc(STATE, st);
  emit("fallback.clear", { provider: pid, why });
  emit("log", { text: `${nameOf(pid)} is back in the rotation${why ? ` (${why})` : ""}.` });
  return true;
}
const cappedNow = () => doc("alerts.state", () => undefined)?.stop || []; // read only; the alerts plugin owns that document
// Why a provider is skipped right now, or null. The spend cap comes from the alerts plugin live.
export function trouble(pid) {
  const s = state().skip[pid];
  if (s && (s.until == null ? s.kind !== "cap" : Date.now() < s.until)) return { ...s, reason: REASON[s.kind] };
  if (cappedNow().includes(pid)) return { kind: "cap", detail: "100% of the monthly cap", since: null, until: null, reason: REASON.cap };
  return null;
}
export function troubled() {
  const out = {};
  for (const p of Object.values(PROVIDERS)) { if (p.kind !== "text") continue; const t = trouble(p.id); if (t) out[p.id] = t; }
  return out;
}
export function sweepExpired() {
  const st = state(); let changed = false;
  for (const [pid, s] of Object.entries(st.skip)) if (s.until != null && Date.now() >= s.until + 24 * 3600 * 1000) { delete st.skip[pid]; changed = true; }
  if (changed) putDoc(STATE, st);
}

// Health lights feed the table: a green light clears it, a red or amber light with a known cause fills it.
export function kindFromHealth(status, detail = "") {
  const d = String(detail || "").toLowerCase();
  if (status === "red") {
    if (/key rejected|workspace|api key not valid|invalid api key|incorrect api key/.test(d)) return "key";
    if (/payment|no credits|out of credits|spending limit|low balance/.test(d)) return "credits";
    if (/could not reach|network/.test(d)) return "unreachable";
    return "server";
  }
  if (status === "amber") {
    if (/rate limited/.test(d)) return "rate";
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
  if (/no api key saved/.test(m)) return "key";
  if (s === 402 || /credit|spending limit|spend limit|insufficient_quota|insufficient quota|exceeded your current quota|billing|balance is too low|payment required|out of credits/.test(m)) return "credits";
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
const modelName = (pid, model) => findModel(model)?.name || model;
export function nextChoice({ provider, model, tried = [], cls = {}, mode = "balanced", small = false, settings = fallbackSettings() }) {
  const triedProviders = new Set(tried.map((t) => t.provider));
  const triedModels = tried.map((t) => t.model);
  const capped = cappedNow();
  // 1. the same model through OpenRouter
  if (settings.openrouterFirst && !triedProviders.has("openrouter") && openrouterReady() && !capped.includes("openrouter")) {
    const id = openrouterId(provider, model);
    if (id) return { provider: "openrouter", model: id, name: `${modelName(provider, model)} via OpenRouter`, via: "openrouter", priceModel: model };
  }
  // 2. the next-best model for the job, from a provider not yet tried, not troubled, not capped
  const skip = troubled();
  const ok = (m) => !triedProviders.has(m.provider) && !triedModels.includes(m.model) && !skip[m.provider] && !capped.includes(m.provider) && m.provider !== provider;
  let list = rank({ capability: cls.capability || "reasoning", difficulty: cls.difficulty || 2, mode, needWeb: !!cls.needWeb, small, exclude: triedModels }).filter(ok);
  if (!list.length && cls.needWeb) list = rank({ capability: cls.capability || "reasoning", difficulty: cls.difficulty || 2, mode, small, exclude: triedModels }).filter(ok);
  const m = list[0];
  return m ? { provider: m.provider, model: m.model, name: m.name, via: null, priceModel: null, free: !!m.free } : null;
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
  // run.avoid: models already busy on this job (other council members), never picked as a stand-in
  const tried = (run.avoid || []).filter((a) => a?.provider && a?.model).map((a) => ({ provider: a.provider, model: a.model, avoid: true }));
  const chain = [];
  let via = null, priceModel = null, hop = 0;

  const switchTo = (next, kind, detail, restart) => {
    const from = { provider, model, name: modelName(provider, model), providerName: nameOf(provider) };
    const to = { provider: next.provider, model: next.model, name: next.name || modelName(next.provider, next.model), providerName: nameOf(next.provider), via: next.via || null };
    const reason = `${REASON[kind]}${detail ? `: ${String(detail).replace(/\s+/g, " ").trim().slice(0, 140)}` : ""}`;
    chain.push({ from, to, kind, reason, via: next.via || null, hop: ++hop, at: Date.now(), role: run.role || null, taskId: run.taskId || null });
    emit("log", { text: `${from.providerName} could not take this job (${reason}). ${to.name}${to.via ? "" : ` (${to.providerName})`} is standing in.`, missionId: run.missionId || null });
    provider = next.provider; model = next.model; via = next.via || null; priceModel = next.priceModel || null;
    return { type: "fallback", from, to, kind, reason, via: next.via || null, hop, restart: !!restart, taskId: run.taskId || null };
  };

  // known trouble before the first call: do not even try
  if (settings.on) {
    const t = trouble(provider);
    if (t) {
      tried.push({ provider, model });
      const next = nextChoice({ provider, model, tried, cls, mode, small, settings });
      if (next) yield switchTo(next, t.kind, `skipped, ${t.detail || "known problem"}`, false);
      else if (t.kind === "credits" || t.kind === "rate") {
        const info = describePause(provider);
        const e = new Error(info?.message || `${nameOf(provider)} is paused: no credits. Add credits to use it.`);
        e.code = "paused";
        e.status = 402;
        throw e;
      }
    }
  }

  while (true) {
    const free = freeNow(provider, model);
    let text = "";
    const t0 = Date.now();
    try {
      for await (const ev of chatWithTools({ ...opts, provider, model }, { missionId: run.missionId, taskId: run.taskId, tools: run.tools, allow: run.allow })) {
        if (ev.type === "delta") { text += ev.text; yield ev; }
        else if (ev.type === "done") {
          const usage = { ...(ev.usage || {}) };
          if (free) usage.free = true;
          if (priceModel && typeof usage.cost !== "number") usage.priceModel = priceModel;
          if (chain.length) usage.fallback = { from: chain[0].from.provider, fromModel: chain[0].from.model, kind: chain[chain.length - 1].kind, via, hops: chain.length };
          yield { ...ev, usage, provider, model, via, fallback: chain.length ? chain : null };
        } else yield ev;
      }
      return;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      // a spend-cap stop is not a provider fault: no failure on its record, no trouble mark, just a stand-in
      const kind = e.code === "cap" ? "cap" : troubleKind(e);
      if (!kind || !settings.on || hop >= settings.maxHops) throw e;
      if (kind !== "cap") { noteCall(provider, false, Date.now() - t0, e.status); markTrouble(provider, kind, e.message, { missionId: run.missionId || null }); }
      tried.push({ provider, model });
      const next = nextChoice({ provider, model, tried, cls, mode, small, settings });
      if (!next) throw e;
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
  return {
    settings: fallbackSettings(),
    skipped: Object.entries(skip).map(([pid, t]) => ({ provider: pid, providerName: nameOf(pid), kind: t.kind, reason: t.reason, detail: t.detail || "", since: t.since, until: t.until, leftMs: t.until ? Math.max(0, t.until - now) : null })),
    openrouter: { keyed: !!PROVIDERS.openrouter && hasSecret("openrouter", PROVIDERS.openrouter.keyEnv), ready: openrouterReady() },
    freeTiers: freeTierView(),
    recent, standInsMonth, freeMonth, reasons: REASON,
  };
}
