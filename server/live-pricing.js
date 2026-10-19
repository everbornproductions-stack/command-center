// Live model pricing (Phase 24). Public list prices from the OpenRouter models API
// (GET https://openrouter.ai/api/v1/models, no key needed, nothing about the person is sent) are
// matched to the models in server/registry.js and fed into registry.modelPrice(), which the router,
// the ledger estimates and the savings receipts all read. Fetched at most once a day (retried an hour
// after a failure); the last good table is kept on this PC so a restart offline still has it.
// A price the person typed in Settings (the "pricing" document) always wins over a live one.
//
// Matching: OpenRouter ids are "<vendor>/<model>" (anthropic/..., openai/..., x-ai/..., google/...,
// deepseek/..., mistralai/..., perplexity/...); dots and dashes are treated the same. OpenRouter's own
// models match by id. Groq, custom providers, demo AIs and variable-price routes (openrouter/auto,
// openrouter/free) are never touched: their price is not OpenRouter's list price.
import { TEXT_PROVIDERS, setLivePrices, modelPrice, priceSource, livePrice, findModel } from "./registry.js";
import { HOSTED, ctx, putDoc } from "./store.js";

export const DEFAULT_URL = "https://openrouter.ai/api/v1/models";
const DOC = "pricing.live";
const DAY = 86400000, RETRY = 3600000;
// tests and development point this at a local fixture; installed builds always use OpenRouter
const feedUrl = () => (process.env.CC_PACKAGED !== "1" && process.env.CC_OPENROUTER_MODELS_URL) || DEFAULT_URL;

export const OR_PREFIX = { anthropic: "anthropic", openai: "openai", xai: "x-ai", google: "google", deepseek: "deepseek", mistral: "mistralai", perplexity: "perplexity" };
const norm = (id) => String(id || "").trim().toLowerCase().replace(/[._\s]+/g, "-");
const round = (n) => +n.toFixed(4);

// { normalized OpenRouter id -> { in, out, orId } } in USD per 1M tokens. Throws on a body that is not a models list.
export function parseModels(json) {
  const list = Array.isArray(json?.data) ? json.data : null;
  if (!list) throw new Error("the answer is not an OpenRouter models list (no data array)");
  const out = new Map();
  for (const x of list) {
    const id = String(x?.id || "");
    const inp = Number(x?.pricing?.prompt), outp = Number(x?.pricing?.completion);
    // -1 marks a variable price (routers); skip it and anything implausible
    if (!id || !Number.isFinite(inp) || !Number.isFinite(outp) || inp < 0 || outp < 0) continue;
    const perM = { in: round(inp * 1e6), out: round(outp * 1e6) };
    if (perM.in > 1000 || perM.out > 1000) continue;
    out.set(norm(id), { ...perM, orId: id });
  }
  return out;
}

function candidates(p, m) {
  if (m.or) return [m.or];
  if (p.id === "openrouter") return [m.id];
  const pre = OR_PREFIX[p.id];
  if (!pre) return [];
  const ids = [m.id];
  if (/-latest$/.test(m.id)) ids.push(m.id.replace(/-latest$/, ""));
  return ids.map((i) => `${pre}/${i}`);
}
// registry model id -> { in, out, orId } for every model OpenRouter lists
export function matchPrices(byNorm) {
  const out = {};
  for (const p of TEXT_PROVIDERS) {
    if (p.demo || p.custom) continue;
    for (const m of p.models || []) {
      if (m.variable) continue;
      for (const c of candidates(p, m)) { const hit = byNorm.get(norm(c)); if (hit) { out[m.id] = hit; break; } }
    }
  }
  return out;
}

// One table per server process (the prices are public, the same for everyone).
let state = { on: process.env.CC_LIVE_PRICING !== "off", fetchedAt: null, lastTry: null, listed: 0, prices: {}, error: null };
let inflight = null, timer = null;

function apply() { setLivePrices(state.on ? state.prices : {}); }
function persist() {
  if (HOSTED) return;
  try { putDoc(DOC, { on: state.on, fetchedAt: state.fetchedAt, lastTry: state.lastTry, listed: state.listed, prices: state.prices, error: state.error }); } catch {}
}
// local mode: the last good table and the on/off choice come back from the data folder
export function loadSaved() {
  if (HOSTED) return;
  let saved = null; try { saved = ctx().docs[DOC] || null; } catch {}
  if (saved && typeof saved === "object") state = { ...state, ...saved, prices: saved.prices && typeof saved.prices === "object" ? saved.prices : {} };
  apply();
}

export const due = (now = Date.now()) => state.on && (!state.lastTry || (state.error ? now - state.lastTry >= RETRY : !state.fetchedAt || now - state.fetchedAt >= DAY));

export function refresh({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && !due()) return Promise.resolve(view());
  inflight = (async () => {
    const t = Date.now();
    try {
      const r = await fetch(feedUrl(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let body; try { body = await r.json(); } catch { throw new Error("the answer was not JSON"); }
      const byNorm = parseModels(body);
      state = { ...state, fetchedAt: t, lastTry: t, listed: byNorm.size, prices: matchPrices(byNorm), error: null };
    } catch (e) {
      // the last good table stays in use
      state = { ...state, lastTry: t, error: `Could not reach OpenRouter: ${e.name === "TimeoutError" ? "no answer in 15 seconds" : e.message}` };
    } finally { inflight = null; }
    apply(); persist();
    return view();
  })();
  return inflight;
}

export function setOn(on) {
  state = { ...state, on: !!on };
  apply(); persist();
  if (state.on && due()) refresh().catch(() => {});
  return view();
}

// checks once an hour whether a refresh is due (daily, or an hour after a failure)
export function startLoop() {
  if (timer || process.env.CC_LIVE_PRICING === "off") return;
  const tick = () => { if (due()) refresh().catch(() => {}); };
  setTimeout(tick, 3000).unref?.();
  timer = setInterval(tick, RETRY); timer.unref?.();
}

// What Settings shows: every model with its built-in, live, own and used price (per the current user).
export function view() {
  const rows = [];
  for (const p of TEXT_PROVIDERS) {
    if (p.demo) continue;
    for (const m of p.models || []) {
      const l = livePrice(m.id);
      const own = (() => { try { return ctx().docs.pricing?.[m.id] || null; } catch { return null; } })();
      rows.push({ provider: p.id, providerName: p.name, model: m.id, name: m.name, builtIn: { in: m.in, out: m.out }, live: l ? { in: l.in, out: l.out, orId: l.orId } : null, override: own ? { in: own.in, out: own.out } : null, used: modelPrice(m.id), source: priceSource(m.id), variable: !!m.variable, matchable: !p.custom && !m.variable && (p.id === "openrouter" || !!OR_PREFIX[p.id]) });
    }
  }
  return {
    on: state.on, source: "OpenRouter models API", url: feedUrl() === DEFAULT_URL ? DEFAULT_URL : "a local test feed",
    fetchedAt: state.fetchedAt, lastTry: state.lastTry, nextAt: state.on ? (state.error ? (state.lastTry || 0) + RETRY : (state.fetchedAt || 0) + DAY) : null,
    listed: state.listed, matched: Object.keys(state.prices).length, error: state.error, rows,
  };
}

export const knownModel = (id) => !!findModel(id);
