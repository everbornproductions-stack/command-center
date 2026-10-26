// 0.4.21 free-first routing. One place for the rules Chris asked for (FREE-AI-STUDY.md):
//  - cost order for every job: 1) this PC (Ollama, LM Studio) and no-key built-ins, 2) free allowances with room left
//    (Groq, Gemini free, OpenRouter free), 3) subscriptions the person already pays for (Claude Code, Codex, Gemini CLI,
//    Grok Bot), 4) paid API credits. A paid AI gets a step only when it pays off on cost, time or quality.
//  - "Free only (never spend money)": ON by default while no paid key is saved; honored by the router, missions, councils
//    and the fallback.
//  - the built-in free AIs are the last-resort stand-ins, OUTSIDE the hop limit, so a job never ends empty while one is
//    available.
//  - a live credit check before planning ("3 ready, 2 out of credits"), cached for 5 minutes.
//  - Ollama / LM Studio are found by probing localhost (short timeout) and added without typing.
//  - what every result shows: which AI did the step, what it cost, and why a step was handed off.
// Nothing here prints or stores a key. Probes and balance calls use the injectable fetch so tests never touch a network.
import { PROVIDERS } from "./registry.js";
import { hasSecret, getSecret } from "./vault.js";
import { doc, putDoc, currentUserId } from "./store.js";
import { FREE_TIERS, fallbackSettings, trouble, markTrouble } from "./fallback.js";
import { localFetch } from "./loopback-fetch.js";
import { readyPlanRoutes, outOfQuota, planId } from "./plan-first.js";
import { routeModels as agyRouteModels } from "./antigravity-cli.js";
import { GROKBOT_TEXT, grokbotReady } from "./grokbot-text.js";
import { cachedLive } from "./provider-balance.js";
import { describePause } from "./pause.js";

// ---------- who counts as free ----------
// Keys for these services normally sit on a free tier, so saving one does not turn Free only off.
export const FREE_KEY_PROVIDERS = new Set(["google", "groq", "openrouter", "mistral"]);
export const FREE_PAGES = [
  { id: "groq", name: "Groq", url: "https://console.groq.com/keys", provider: "groq", what: "Fast, free tier. Works well as a helper.", needs: "key" },
  { id: "google", name: "Google AI Studio (Gemini)", url: "https://aistudio.google.com/apikey", provider: "google", what: "Free Gemini Flash models. No card.", needs: "key" },
  { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/keys", provider: "openrouter", what: "One key, a free route that picks a free model.", needs: "key" },
  { id: "github", name: "GitHub Models", url: "https://github.com/marketplace/models", provider: null, what: "Free with a GitHub account.", needs: "key", later: true },
  { id: "cloudflare", name: "Cloudflare Workers AI", url: "https://dash.cloudflare.com", provider: null, what: "Free daily allowance. Needs an account id and a token.", needs: "key", later: true },
  { id: "mistral", name: "Mistral", url: "https://console.mistral.ai", provider: "mistral", what: "Free plan with low limits, no card.", needs: "key" },
  { id: "ollama", name: "Ollama (this PC)", url: "https://ollama.com/download", provider: null, what: "Free and private. Meldmind finds it by itself once it runs.", needs: "nothing", local: "ollama" },
  { id: "lmstudio", name: "LM Studio (this PC)", url: "https://lmstudio.ai", provider: null, what: "Free and private. Meldmind finds it by itself once it runs.", needs: "nothing", local: "lmstudio" },
];
const nameOf = (pid) => PROVIDERS[pid]?.name || (pid === GROKBOT_TEXT ? "Grok Bot" : pid === "antigravity" ? "Antigravity" : String(pid).startsWith("plan-") ? planName(pid) : pid);
const PLAN_NAMES = { "plan-claude-code": "Claude Code", "plan-codex": "Codex", "plan-gemini-cli": "Gemini CLI" };
const planName = (pid) => PLAN_NAMES[pid] || String(pid).replace(/^plan-/, "");

export const isLocalProvider = (pid) => !!PROVIDERS[pid]?.custom && !!PROVIDERS[pid]?.noKey;
export const isPlanProvider = (pid) => String(pid || "").startsWith("plan-");

// Free to run right now, whatever the allowance says: this PC, a free-tier model with its tier switched on, Antigravity, a demo.
export function isFreeModel(pid, model) {
  if (!pid) return false;
  if (PROVIDERS[pid]?.demo) return true;
  if (isLocalProvider(pid)) return true;
  if (pid === "antigravity") return true;
  const tier = FREE_TIERS[pid];
  if (tier && tier.models.includes(model)) { try { return !!fallbackSettings().freeTiers[pid]?.on; } catch { return false; } }
  return false;
}
// 0 this PC, 1 free, 2 subscription (no per-call charge), 3 paid
export function costTier(pid, model) {
  if (isLocalProvider(pid)) return 0;
  if (isFreeModel(pid, model)) return 1;
  if (isPlanProvider(pid) || pid === GROKBOT_TEXT) return 2;
  return 3;
}
export const TIER_WORD = ["this PC", "free", "your plan", "paid"];

// ---------- Free only ----------
export function hasPaidKey() {
  for (const p of Object.values(PROVIDERS)) {
    if (p.kind !== "text" || p.demo || p.custom || p.noKey) continue;
    if (FREE_KEY_PROVIDERS.has(p.id)) continue;
    try { if (hasSecret(p.id, p.keyEnv)) return true; } catch { /* a vault that cannot be read counts as no key */ }
  }
  return false;
}
// The saved choice wins. With no saved choice it is ON while no paid key is saved, OFF once one is.
export function freeOnlyOn() {
  const v = fallbackSettings().freeOnly;
  if (v === true || v === false) return v;
  return !hasPaidKey();
}
export function freeOnlyView() {
  const v = fallbackSettings().freeOnly;
  return { on: freeOnlyOn(), saved: v === true || v === false ? v : null, auto: !(v === true || v === false), hasPaidKey: hasPaidKey(), label: "Free only (never spend money)", line: freeOnlyOn() ? "Free only is on. Only AIs on this PC and free allowances are used, so nothing is charged." : "Free only is off. Free AIs still go first; a paid AI takes a step only when it is worth it." };
}
export const FREE_ONLY_BLOCK = "This needs a paid AI. Turn off Free only to run it.";
export function freeOnlyError() {
  return Object.assign(new Error(FREE_ONLY_BLOCK), { code: "free_only", status: 402, plain: FREE_ONLY_BLOCK });
}

// ---------- this PC: Ollama and LM Studio ----------
export const LOCAL_APPS = [
  { key: "ollama", name: "Ollama (this PC)", port: 11434, env: "CC_OLLAMA_URL" },
  { key: "lmstudio", name: "LM Studio (this PC)", port: 1234, env: "CC_LMSTUDIO_URL" },
];
let probeImpl = null;
// tests: setLocalProbe(async (url) => ({ ok, models: [ids] })) or null to go back to a real probe
export function setLocalProbe(fn) { probeImpl = typeof fn === "function" ? fn : null; localCache = null; }
const localBase = (a) => String(process.env[a.env] || `http://127.0.0.1:${a.port}`).replace(/\/+$/, "").replace(/\/v1$/, "");
async function probeOne(a, timeoutMs = 700) {
  const base = localBase(a);
  try {
    if (probeImpl) { const r = await probeImpl(base, a.key); return { ...a, base, found: !!r?.ok, models: (r?.models || []).map(String).slice(0, 40) }; }
    const r = await localFetch(`${base}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ...a, base, found: false, models: [] };
    const j = await r.json().catch(() => ({}));
    const models = (Array.isArray(j.data) ? j.data.map((m) => m.id) : []).filter(Boolean).map(String).slice(0, 40);
    return { ...a, base, found: true, models };
  } catch { return { ...a, base, found: false, models: [] }; }
}
let localCache = null;
export async function detectLocal({ force = false } = {}) {
  if (!force && localCache && Date.now() - localCache.at < 60000) return localCache.rows;
  const rows = await Promise.all(LOCAL_APPS.map((a) => probeOne(a)));
  localCache = { at: Date.now(), rows };
  return rows;
}
// Found and usable: add it as a custom, no-key provider (once) so the router and fallback can use it. Never types anything.
export async function ensureLocalProviders({ force = false } = {}) {
  const rows = await detectLocal({ force });
  const added = [];
  for (const r of rows) {
    if (!r.found || !r.models.length) continue;
    try {
      const mod = await import("./plugins/providers.js");
      const res = await mod.addDetectedLocal({ key: r.key, name: r.name, baseUrl: `${r.base}/v1`, models: r.models });
      if (res?.added) added.push(res.id);
    } catch { /* a PC that cannot add one just keeps the card hint */ }
  }
  return { rows, added };
}
// Is a custom local provider's app answering right now (from the last probe)?
export function localUp(pid) {
  const base = String(PROVIDERS[pid]?.baseUrl || "").replace(/\/v1$/, "").replace(/\/+$/, "");
  const hit = localCache?.rows.find((r) => r.base === base);
  return hit ? hit.found : true; // not probed yet: do not mark it down
}

// ---------- last resort ----------
// Free AIs that are connected and not already tried, best first. These hops do not count against maxHops.
// freeOnly drops the subscription apps and Grok Bot. Coding jobs put Claude Code first among the apps.
export function lastResortChoices({ tried = [], cls = {}, freeOnly = freeOnlyOn() } = {}) {
  const out = [];
  const used = (pid, model) => tried.some((t) => t.provider === pid && t.model === model);
  const add = (pid, model, name, why, extra = {}) => {
    if (!pid || !model || used(pid, model) || out.some((o) => o.provider === pid && o.model === model)) return;
    out.push({ provider: pid, model, name, via: null, priceModel: null, free: true, lastResort: true, why, ...extra });
  };
  const keyed = (pid) => { try { return !!PROVIDERS[pid] && hasSecret(pid, PROVIDERS[pid].keyEnv); } catch { return false; } };
  const settings = fallbackSettings();
  // built-in free tiers, in the order the study gives: Groq, Gemini, OpenRouter
  for (const pid of ["groq", "google", "openrouter"]) {
    const tier = FREE_TIERS[pid];
    if (!tier || !settings.freeTiers[pid]?.on || !keyed(pid) || trouble(pid) || describePause(pid)) continue;
    const model = pid === "groq" ? tier.models[tier.models.length - 1] : tier.models[0]; // gpt-oss-120b, then the first Gemini Flash, then openrouter/free
    add(pid, model, `${nameOf(pid)} free`, "built-in free AI");
  }
  // this PC
  for (const p of Object.values(PROVIDERS)) {
    if (!isLocalProvider(p.id) || trouble(p.id) || !localUp(p.id)) continue;
    const m = p.models?.find((x) => x.default) || p.models?.[0];
    if (m) add(p.id, m.id, p.name, "runs on this PC");
  }
  // Antigravity (free Google sign-in)
  try { for (const r of agyRouteModels() || []) add(r.provider, r.model, r.name || "Antigravity", "free Google sign-in app"); } catch { /* not installed */ }
  if (!freeOnly && settings.subscriptions !== false) {
    const plans = [];
    try { for (const r of readyPlanRoutes()) if (!outOfQuota(r.id)) plans.push(r); } catch { /* no apps */ }
    if (cls.capability === "code") plans.sort((a, b) => (b.id === "claude-code") - (a.id === "claude-code"));
    for (const r of plans) add(planId(r.id), planId(r.id), `${r.name} (your plan)`, "subscription you already pay for", { free: false });
    if (grokbotReady()) add(GROKBOT_TEXT, GROKBOT_TEXT, "Grok Bot", "your own assistant", { free: false });
  }
  return out;
}
// Cross-provider choices ahead of the paid ones, for the normal (counted) hops: a coding job reaches Claude Code first.
export function planFirstForCode({ tried = [], cls = {}, freeOnly = freeOnlyOn() } = {}) {
  if (freeOnly || cls.capability !== "code" || fallbackSettings().subscriptions === false) return null;
  try {
    const r = readyPlanRoutes().find((x) => x.id === "claude-code" && !outOfQuota(x.id));
    if (!r) return null;
    const pid = planId(r.id);
    if (tried.some((t) => t.provider === pid) || trouble(pid)) return null;
    return { provider: pid, model: pid, name: "Claude Code (your plan)", via: null, priceModel: null, free: false, why: "Claude Code first for coding" };
  } catch { return null; }
}

// ---------- the live credit check ----------
const liveCache = new Map(); // user -> { at, rows }
const LIVE_MS = 5 * 60 * 1000;
export function clearCreditCache() { liveCache.clear(); }
const who = () => String(currentUserId() || "local");

async function openrouterLive() {
  const p = PROVIDERS.openrouter;
  if (!p) return null;
  let sec = null;
  try { sec = getSecret("openrouter", p.keyEnv); } catch { return null; }
  if (!sec?.key) return null;
  try { return await cachedLive("openrouter", sec, { maxAgeMs: LIVE_MS, timeoutMs: 2500 }); }
  catch (e) { return { error: String(e?.message || e), rejected: !!e?.rejected, network: !!e?.network }; }
}

export function summaryLine(ready, out) {
  const r = `${ready} ready`;
  return out > 0 ? `${r}, ${out} out of credits` : r;
}

// Which connected AIs can take work right now, and which are out. Reads the trouble table, the pause bookkeeping,
// OpenRouter's live balance, the free counters, this PC's ports and the subscription apps.
// Calls no model. The slow parts (OpenRouter, ports) are cached for 5 minutes / 1 minute.
export async function creditCheck({ force = false, connected, whyOut, billingOf } = {}) {
  const [{ connectedAis, whyOut: realWhyOut }] = [await import("./send-check.js")];
  const ais = connected || connectedAis();
  const why = whyOut || realWhyOut;
  const local = await ensureLocalProviders({ force }).catch(() => ({ rows: [] }));
  let live = liveCache.get(who());
  if (force || !live || Date.now() - live.at > LIVE_MS) { live = { at: Date.now(), openrouter: await openrouterLive() }; liveCache.set(who(), live); }
  const ready = [];
  const out = [];
  const lowOf = (a) => {
    if (a.provider !== "openrouter") return null;
    const o = live.openrouter;
    if (o && !o.error && o.creditsLeft != null && o.creditsLeft <= 0 && !o.free) return { kind: "credits", detail: "no credit left on the account" };
    return null;
  };
  for (const a of ais) {
    if (isLocalProvider(a.provider) && !localUp(a.provider)) { out.push({ provider: a.provider, name: a.name, kind: "unreachable", why: `${a.name} is not running`, billing: null, local: true }); continue; }
    let w = why(a.provider);
    if (!w) { w = lowOf(a); if (w) { try { markTrouble(a.provider, w.kind, w.detail, { quiet: true }); } catch { /* the table is optional here */ } } }
    if (w) { out.push({ provider: a.provider, name: a.name, kind: w.kind, why: `${a.name} ${({ credits: "is out of credits or quota", rate: "is busy and asked us to slow down", key: "did not accept its key", unreachable: "could not be reached", server: "had a problem on its side", cap: "reached its spending limit" })[w.kind] || "cannot take work"}`, billing: w.billing || PROVIDERS[a.provider]?.links?.billing || null }); continue; }
    ready.push({ provider: a.provider, name: a.name, model: a.model, free: isFreeModel(a.provider, a.model), local: isLocalProvider(a.provider), tier: costTier(a.provider, a.model) });
  }
  // apps and free sign-ins are ready AIs too
  const extra = [];
  try { for (const r of agyRouteModels() || []) extra.push({ provider: r.provider, name: r.name || "Antigravity", model: r.model, free: true, local: false, tier: 1 }); } catch { /* none */ }
  try { for (const r of readyPlanRoutes()) if (!outOfQuota(r.id)) extra.push({ provider: planId(r.id), name: `${r.name} (your plan)`, model: planId(r.id), free: false, local: false, tier: 2 }); } catch { /* none */ }
  if (grokbotReady()) extra.push({ provider: GROKBOT_TEXT, name: "Grok Bot", model: GROKBOT_TEXT, free: false, local: false, tier: 2 });
  for (const e of extra) if (!ready.some((r) => r.provider === e.provider)) ready.push(e);
  const f = freeOnlyOn();
  const usable = f ? ready.filter((r) => r.tier <= 1) : ready;
  const summary = summaryLine(usable.length, out.length);
  const names = out.map((o) => o.name);
  const best = usable.slice().sort((a, b) => a.tier - b.tier)[0] || null;
  const replace = out.length && best ? `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} out, so Meldmind will use ${usable.filter((u) => u.tier <= (best.tier)).slice(0, 3).map((u) => u.name).join(" and ")} instead.` : out.length ? `${names.join(" and ")} ${names.length > 1 ? "are" : "is"} out and nothing else is ready. Add a free key from Get free AIs.` : "";
  return { summary, ready: usable, out, freeOnly: f, replace, nothingReady: usable.length === 0, local: local.rows.map((r) => ({ key: r.key, name: r.name, found: r.found, models: r.models.length })), openrouter: live.openrouter ? (live.openrouter.error ? { error: true } : { creditsLeft: live.openrouter.creditsLeft ?? null, free: !!live.openrouter.free }) : null, at: live.at };
}

// ---------- cost text, why-handed-off, estimate calibration ----------
export const money = (n) => { const v = Number(n) || 0; return v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`; };
// "$0 (free: Groq)", "$0 (this PC: Ollama)", "$0 (your plan: Claude Code)", "$0.04 (Claude)"
export function costText({ provider, model, cost = 0, free = false } = {}) {
  const n = nameOf(provider);
  const c = Number(cost) || 0;
  if (c > 0) return `${money(c)} (${n})`;
  if (isLocalProvider(provider)) return `$0 (this PC: ${n.replace(/ \(this PC\)$/, "")})`;
  if (isPlanProvider(provider) || provider === GROKBOT_TEXT) return `$0 (your plan: ${n.replace(/ \(your plan\)$/, "")})`;
  if (free || isFreeModel(provider, model)) return `$0 (free: ${n.replace(/ free$/, "")})`;
  return `$0 (${n})`;
}
// Plain words for why this AI did the step.
export function whyHandoff({ provider, model, standIn = null, difficulty = 2, freeOnly = freeOnlyOn(), tierWanted = null } = {}) {
  if (standIn?.reason) {
    const from = nameOf(standIn.for);
    const r = String(standIn.reason).replace(/:.*$/, "");
    return `Handed off from ${from}: ${r}.`;
  }
  const tier = costTier(provider, model);
  if (tier === 0) return "Free first: this PC did it, at no cost.";
  if (tier === 1) return "Free first: a free AI did it, at no cost.";
  if (tier === 2) return "Your own plan did it, so there was no extra charge.";
  if (freeOnly) return "";
  return difficulty >= 3 ? "A paid AI took this step because it is a hard one and free AIs fall short on quality." : "A paid AI took this step because no free AI was ready or strong enough.";
}
export function stepLine(t) {
  if (!t || t.agent || t.media || t.app) return null;
  const free = !!t.work?.free;
  return { costText: costText({ provider: t.provider, model: t.model, cost: t.cost, free }), why: whyHandoff({ provider: t.provider, model: t.model, standIn: t.standIn, difficulty: t.difficulty }) };
}

// Estimates ran 3 to 5 times low in dogfood (multi-step runs, stand-ins, QA retries). The base factor is the old
// 1.6 (QA) / 1.1; on top of it a safer multiplier grows with the number of steps, and once real runs exist the
// observed actual/estimated ratio replaces the default.
const CALIB = "estimate.calibration";
export function stepFactor(steps) { return steps >= 4 ? 3 : steps === 3 ? 2.5 : steps === 2 ? 1.8 : 1.3; }
export function calibration() {
  let d = null; try { d = doc(CALIB, () => ({ ratios: [] })); } catch { d = null; }
  const r = (d?.ratios || []).slice(-8);
  if (r.length < 2) return { observed: null, n: r.length };
  const sorted = r.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  return { observed: Math.min(8, Math.max(1, +med.toFixed(2))), n: r.length };
}
export function calibratedEstimate(rawSum, { qa = true, steps = 1 } = {}) {
  const base = qa ? 1.6 : 1.1;
  const cal = calibration();
  const factor = cal.observed ? Math.max(cal.observed, 1) : stepFactor(steps);
  return { raw: rawSum * base, value: rawSum * base * factor, factor, observed: cal.observed };
}
// After a run: remember actual / raw estimate (paid runs only; $0 runs say nothing about the price table).
export function noteActual(rawEstimate, actual) {
  const r = Number(rawEstimate) || 0, a = Number(actual) || 0;
  if (!(r > 0) || !(a > 0)) return;
  try { const d = doc(CALIB, () => ({ ratios: [] })); const ratios = [...(d.ratios || []), +(a / r).toFixed(3)].slice(-20); putDoc(CALIB, { ratios }); } catch { /* optional */ }
}
