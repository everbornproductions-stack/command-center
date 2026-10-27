// Health lights. green = key works and no incident. amber = incident on the status page,
// slow, or balance running low. red = auth/5xx failure. grey = no key saved.
import { PROVIDERS, geminiBase } from "./registry.js";
import { getSecret } from "./vault.js";
import { emit } from "./events.js";
import { ctx, allContexts, runAs } from "./store.js";
import { localFetch } from "./loopback-fetch.js";
import { interpretOpenRouter, openRouterLine } from "./openrouter-balance.js";

// Lights and live model lists are per user: a key is one user's key, so its health is too.
const GREY = () => ({ status: "grey", detail: "no key", latencyMs: null, checkedAt: 0, incident: null, balance: null });
export const liveModels = new Proxy({}, { get: (_, id) => ctx().liveModels[id], set: (_, id, v) => { ctx().liveModels[id] = v; return true; } });
const table = () => ctx().health;
export const getStatus = (id) => table()[id] || GREY();
export function allStatus() {
  const t = table();
  for (const p of Object.values(PROVIDERS)) t[p.id] ||= GREY();
  return t;
}

function set(id, patch) {
  const t = table();
  const prev = t[id] || GREY();
  const next = { ...prev, ...patch, checkedAt: Date.now() };
  // A later check that reached the provider must not keep an old "could not reach" flag.
  if (patch.network !== true) next.network = false;
  t[id] = next;
  if (prev.status !== next.status || prev.detail !== next.detail) emit("provider.status", { provider: id, ...next });
}

// Pull a status code and the provider's body off a failed call. Callers may pass a number
// (status only) or the error object (status plus body / message).
function callParts(errStatus, body) {
  if (errStatus && typeof errStatus === "object") { body = errStatus; errStatus = Number(errStatus.status); }
  let json = null, text = "";
  if (typeof body === "string") text = body;
  else if (body && typeof body === "object") {
    if (body.body && typeof body.body === "object") json = body.body;
    else if (body.json && typeof body.json === "object") json = body.json;
    text = String(body.text || body.message || "");
  }
  return { status: Number(errStatus), json, text };
}

// Mark from a real call outcome (called by council/mission on success or error).
// The body is explained the same way as a key check, so a 403 that is really
// "out of credits" is not stored as "Key rejected".
export function noteCall(id, ok, latencyMs, errStatus, body) {
  const cur = getStatus(id);
  if (ok) {
    const slow = latencyMs > 25000;
    set(id, { status: cur.incident ? "amber" : slow ? "amber" : "green", detail: slow ? `slow (${(latencyMs / 1000).toFixed(0)}s)` : cur.incident ? cur.incident : "ok", latencyMs, lastOk: Date.now(), realFailAt: 0 });
    return;
  }
  const parts = callParts(errStatus, body);
  if (parts.status === 0) { set(id, { status: "amber", detail: "network error", network: true }); return; }
  const p = PROVIDERS[id] || { id, name: id };
  const out = explainProviderError(p, parts.status, parts.json, parts.text);
  // A real 402/403/429 beats a models-list check: the light stays amber or red and the old "$N left" goes
  // until a real call works again (0.4.21).
  if ([402, 403, 429].includes(parts.status)) set(id, { ...out, balance: null, realFailAt: Date.now(), retryAfterMs: parts.status === 429 && Number(errStatus?.retryAfterMs) > 0 ? Number(errStatus.retryAfterMs) : null });
  else set(id, out);
}

// Credits are back (a balance above zero, a quota reset, or a free probe that answered): green again, so the
// AI rejoins routing. The normal provider.status event fires, which also clears the smart-fallback skip.
export function markRecovered(id, detail = "ok") {
  set(id, { status: "green", detail, realFailAt: 0, retryAfterMs: null, lastOk: Date.now(), lastProbeOk: Date.now() });
  return getStatus(id);
}

export const REAL_FAIL_HOLD_MS = 6 * 60 * 60 * 1000;
// A new key (or a top-up the person says they made) lets the next check decide again.
export function clearRealFailure(id) { const c = getStatus(id); if (c.realFailAt) set(id, { realFailAt: 0 }); }
// True when an AI cannot do work right now: out of credit, rate limited, or its key was refused.
// Lists and the receipt baseline use this so a dead AI is never named as planner or as the price to beat.
export function isDeadNow(id) {
  const c = getStatus(id);
  if (c.status === "red") return true;
  return c.status === "amber" && /out of credits|spending limit|payment required|no credits|rate limited/i.test(String(c.detail || ""));
}
// True while a real call failed with 402/403/429 and no real call has worked since.
export function heldByRealFailure(id) {
  const c = getStatus(id);
  return !!(c.realFailAt && Date.now() - c.realFailAt < REAL_FAIL_HOLD_MS && c.status !== "green");
}

// Turn a provider's refusal into words a person can act on, keeping the provider's own message
// (with anything that looks like a key masked). Never just "key rejected" when the reason is known.
export function providerMessage(json, text) {
  const e = json?.error;
  let m = (typeof e === "string" ? e : e?.message) || json?.message || json?.detail || json?.error_description || (typeof text === "string" && !/^\s*</.test(text) ? text : "") || "";
  if (Array.isArray(json) && json[0]?.error?.message) m = json[0].error.message; // Google sometimes wraps errors in an array
  return String(m).replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1…").replace(/\bAQ\.[A-Za-z0-9_.-]{4,}/g, "AQ.…").replace(/\b(xai-|AIza|gsk_|pplx-|fw_|tgp_)[A-Za-z0-9_-]{4,}/g, "$1…").replace(/\s+/g, " ").trim().slice(0, 180);
}
const BILLING_WORDS = /credit|spending limit|spend limit|quota|billing|insufficient_quota|exceeded your current|balance/;
const BAD_KEY_WORDS = /api key not valid|api_key_invalid|invalid api key|incorrect api key/;

export function explainProviderError(p, status, json, text) {
  const msg = providerMessage(json, text);
  const low = msg.toLowerCase();
  const tail = msg ? `: ${msg}` : "";
  const billing = BILLING_WORDS.test(low);
  // 401 is a refused key even when the body mentions a balance. Every other
  // credits / quota / billing refusal is amber, with the provider's top-up page.
  if (billing && status !== 401) {
    const url = p?.links?.billing;
    const lead = url ? `Out of credits or spending limit reached. Top up at ${url}` : "Out of credits or spending limit reached";
    return { status: "amber", detail: `${lead}${tail}` };
  }
  if (p.api === "anthropic" && /workspace/.test(low))
    return { status: "red", detail: `This key needs a workspace: pick or paste your Anthropic workspace ID${tail}` };
  if ((status === 400 || status === 403) && BAD_KEY_WORDS.test(low)) return { status: "red", detail: `Key rejected (${status})${tail}` };
  if (status === 401) return { status: "red", detail: `Key rejected (${status})${tail}` };
  // A 403 with no words at all is treated as a refused key. Any other 403 keeps the provider's detail.
  if (status === 403 && !msg) return { status: "red", detail: `Key rejected (${status})` };
  if (status === 403) return { status: "red", detail: `Access denied (403)${tail}` };
  if (status === 402) return { status: "red", detail: `Payment required: no credits${tail}` };
  if (status === 429) return { status: "amber", detail: `Rate limited${tail}` };
  if (status >= 500) return { status: "amber", detail: `${p.name} had a server error (${status})${tail}` };
  return { status: "red", detail: `HTTP ${status} from ${p.name}${tail}` };
}

// "fetch failed" says nothing; dig out the real reason (DNS, refused, TLS, proxy, timeout).
export function networkCause(e) {
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return "timed out";
  const c = e?.cause; const code = c?.code || c?.errors?.[0]?.code;
  const map = { ENOTFOUND: "address not found (DNS)", EAI_AGAIN: "DNS lookup failed", ECONNREFUSED: "connection refused", ECONNRESET: "connection reset", ETIMEDOUT: "connection timed out", UND_ERR_CONNECT_TIMEOUT: "connection timed out", EHOSTUNREACH: "host unreachable", ENETUNREACH: "network unreachable", CERT_HAS_EXPIRED: "TLS certificate expired", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate could not be verified", SELF_SIGNED_CERT_IN_CHAIN: "TLS certificate not trusted (a proxy or antivirus may be intercepting HTTPS)" };
  if (code) return `${map[code] || code}${c?.hostname ? ` (${c.hostname})` : ""}`;
  return c?.message || e?.message || "network error";
}

async function fetchJson(url, headers = {}, timeout = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await localFetch(url, { headers, signal: ctl.signal });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch {}
    return { ok: r.ok, status: r.status, json: j, text: txt };
  } finally { clearTimeout(t); }
}

async function checkStatusPage(p) {
  if (!p.statusApi || (process.env.CC_PACKAGED !== "1" && process.env.CC_STATUS_PAGES === "off")) return null; // tests switch status pages off
  try {
    if (p.statusApi === "google-incidents") {
      const r = await fetchJson("https://status.cloud.google.com/incidents.json", {}, 8000);
      const open = (Array.isArray(r.json) ? r.json : []).filter((i) => !i.end && /gemini|vertex|ai studio/i.test(i.service_name || ""));
      return open.length ? `incident: ${open[0].external_desc?.slice(0, 80) || open[0].service_name}` : null;
    }
    const r = await fetchJson(p.statusApi, {}, 8000);
    const ind = r.json?.status?.indicator; // none | minor | major | critical
    const desc = r.json?.status?.description;
    if (ind && ind !== "none") return `${ind} incident: ${desc}`;
  } catch {}
  return null;
}


// ---- the tiny real call (0.4.21) ----
const PAUSE_WORDS = /out of credits|spending limit|spend limit|payment required|no credits|rate limited|low balance/i;
export const PROBE_MS = 30 * 60 * 1000;
const probeOn = () => process.env.CC_HEALTH_PROBE !== "off";
const needsProbe = (prev, wasPaused) => probeOn() && (wasPaused || !prev.lastProbeOk || Date.now() - prev.lastProbeOk > PROBE_MS);
// the cheapest model this account can name, or OpenRouter's own free route
function probeModel(p, listJson) {
  if (p.id === "openrouter") return "openrouter/free";
  const reg = (p.models || []).slice().sort((a, b) => (a.in || 0) - (b.in || 0))[0]?.id;
  if (reg) return reg;
  const live = liveModels[p.id]?.[0] || (Array.isArray(listJson?.data) ? listJson.data[0]?.id : null);
  return live || null;
}
// Free routes a probe may use when an AI has no balance to read. A probe here can not cost money: it only
// names a model that is free (kept in step with FREE_TIERS in fallback.js by a test).
export const FREE_PROBE = { openrouter: "openrouter/free", google: "gemini-3.8-flash", groq: "openai/gpt-oss-20b" };
// { ok } when a one-word answer came back, { refused, status, json, text } when the provider said no
// (key, credits, rate limit), and { inconclusive } for anything else (no model, network, a mock without chat).
export async function probeCompletion(p, listJson, { free = false, maxTokens = 16 } = {}) {
  const model = free ? FREE_PROBE[p.id] : probeModel(p, listJson);
  if (!model || p.kind !== "text") return { inconclusive: true };
  try {
    const { complete } = await import("./providers.js");
    await complete({ provider: p.id, model, messages: [{ role: "user", content: "Reply with the word ok." }], maxTokens, signal: AbortSignal.timeout(20000) });
    return { ok: true };
  } catch (e) {
    const status = Number(e?.status) || 0;
    if (e?.code === "cap" || e?.budget) return { inconclusive: true }; // our own spending stop is not the provider's problem
    if ([401, 402, 403, 429].includes(status)) return { refused: true, status, json: e.body || null, text: e.message || "" };
    return { inconclusive: true };
  }
}

// `auto` is a background check. It cannot undo a real failure; a check the person asked for can.
// keyOnly (an automatic recheck of an AI with no free route): the models list may show the key was refused, and
// nothing else changes. It never sends a completion.
export async function checkProvider(id, { auto = false, keyOnly = false } = {}) {
  const p = PROVIDERS[id];
  if (!p) return;
  const sec = getSecret(p.id, p.keyEnv);
  const incident = await checkStatusPage(p);
  // A list of models proves the key is valid, not that there is money behind it. After a real 402/403/429
  // the light stays as the real call left it.
  if (auto && sec && heldByRealFailure(id) && !keyOnly) { set(id, { incident, checkedNote: "held after a real failure" }); return getStatus(id); }
  if (!sec) { set(id, { status: "grey", detail: incident ? `no key · ${incident}` : "no key", incident }); return getStatus(id); }
  // managed plan (Phase 9): the pool key is not used for checks; the first real call shows whether it works
  if (sec.managed) { set(id, { status: incident ? "amber" : "green", detail: incident ? `managed by Everborn · ${incident}` : "managed by Everborn", incident }); return getStatus(id); }
  if (p.kind !== "text") {
    // media providers with an API we can ping
    try {
      if (p.id === "elevenlabs") {
        const t0 = Date.now();
        const root = (process.env.CC_PACKAGED !== "1" && process.env.CC_BASE_URL_ELEVENLABS) || "https://api.elevenlabs.io";
        const r = await fetchJson(`${String(root).replace(/\/$/, "")}/v1/user/subscription`, { "xi-api-key": sec.key });
        if (r.ok) {
          const used = r.json.character_count, limit = r.json.character_limit;
          const pct = limit ? used / limit : 0;
          set(id, { status: pct > 0.9 ? "amber" : "green", detail: `${(limit - used).toLocaleString()} characters left`, latencyMs: Date.now() - t0, balance: { used, limit, unit: "characters", resetAt: r.json.next_character_count_reset_unix ? r.json.next_character_count_reset_unix * 1000 : null } });
        } else set(id, { status: r.status === 401 ? "red" : "amber", detail: `HTTP ${r.status}` });
      } else if (p.id === "kling") {
        set(id, { status: "green", detail: "key saved (credits tracked manually)" });
      } else set(id, { status: "green", detail: "key saved" });
    } catch (e) { set(id, { status: "amber", detail: e.message }); }
    return getStatus(id);
  }
  const t0 = Date.now();
  try {
    let r, balance = null;
    if (p.api === "anthropic") r = await fetchJson(`${p.baseUrl}/v1/models?limit=100`, { ...(sec.headers || {}), ...(sec.workspaceId ? { "anthropic-workspace-id": sec.workspaceId } : {}), "x-api-key": sec.key, "anthropic-version": "2023-06-01" });
    else if (p.id === "google" || p.api === "gemini") r = await fetchJson(`${geminiBase(p)}/models?pageSize=200`, { "x-goog-api-key": sec.key });
    else if (p.id === "perplexity") r = { ok: true, status: 200 }; // no cheap list endpoint; verified on first real call
    else r = await fetchJson(`${p.baseUrl}/models`, { ...(sec.headers || {}), ...(sec.key && sec.key !== "no-key" ? { authorization: `Bearer ${sec.key}` } : {}) });
    const latencyMs = Date.now() - t0;
    if (keyOnly) {
      if (!r.ok && r.status === 401) set(id, { ...explainProviderError(p, r.status, r.json, r.text), incident, latencyMs });
      else set(id, { incident, checkedNote: r.ok ? "key still works, waiting for a real call" : "held after a real failure" });
      return getStatus(id);
    }
    if (!r.ok) {
      // One write, so the light never flashes a refused key before the body is read.
      set(id, { ...explainProviderError(p, r.status, r.json, r.text), incident, latencyMs });
      return getStatus(id);
    }
    if (p.balanceApi === "openrouter-key") {
      const c = await fetchJson(`${p.baseUrl}/key`, { authorization: `Bearer ${sec.key}` });
      const d = c.json?.data;
      if (c.ok && d) {
        // the account's bought credits decide, not the key's own limit ("$50 left" with no credits bought was wrong)
        const cr = await fetchJson(`${p.baseUrl}/credits`, { authorization: `Bearer ${sec.key}` }).catch(() => null);
        const b = interpretOpenRouter(d, cr?.ok ? cr.json?.data || null : null);
        balance = { left: b.left, unit: "USD", used: d.usage, usedMonth: d.usage_monthly, limit: d.limit, free: b.free, noCredits: b.noCredits, scope: b.scope };
      }
    } else if (p.balanceApi === "deepseek-balance") {
      const c = await fetchJson(`${p.baseUrl}/user/balance`, { authorization: `Bearer ${sec.key}` });
      const b = c.json?.balance_infos?.[0];
      if (c.ok && b) balance = { left: +Number(b.total_balance).toFixed(2), unit: b.currency || "USD" };
    }
    let st = incident ? "amber" : "green";
    let detail = incident || "ok";
    if (balance?.noCredits) detail = openRouterLine(balance); // free models still work: not a warning light
    else if (balance && balance.unit === "USD" && balance.left != null && balance.left < 2) { st = balance.left <= 0 ? "red" : "amber"; detail = `low balance: $${balance.left}`; }
    else if (balance && p.balanceApi === "openrouter-key" && balance.left != null) detail = openRouterLine(balance);
    else if (balance && balance.left != null) detail = `${balance.left} ${balance.unit} left`;
    else if (balance && balance.used != null) detail = `$${Number(balance.used).toFixed(2)} used so far`;
    // 0.4.21: a models list answers even when the account has no credits, so a green light needs one tiny real call.
    // An AI that was paused (no credits, rate limited) stays paused until a call really works.
    const prev = getStatus(id);
    const wasPaused = (prev.status === "amber" || prev.status === "red") && PAUSE_WORDS.test(prev.detail || "");
    // An automatic recheck of a paused AI with no free route never sends a billable completion.
    if (auto && wasPaused && !FREE_PROBE[p.id]) { set(id, {}); return getStatus(id); }
    if (needsProbe(prev, wasPaused)) {
      const pr = await probeCompletion(p, r.json, { free: auto && wasPaused, maxTokens: wasPaused ? 1 : 16 });
      if (pr.ok) set(id, { lastProbeOk: Date.now() });
      else if (pr.refused) { set(id, { ...explainProviderError(p, pr.status, pr.json, pr.text), incident, latencyMs: Date.now() - t0 }); return getStatus(id); }
      else if (wasPaused) { set(id, {}); return getStatus(id); }
    }
    // keep the live model list so any model id the account can see is selectable
    if (r.json?.data && Array.isArray(r.json.data)) liveModels[id] = r.json.data.map((m) => m.id).filter(Boolean).slice(0, 400);
    else if (r.json?.models) liveModels[id] = r.json.models.map((m) => (m.name || "").replace(/^models\//, "")).filter(Boolean);
    set(id, { status: st, detail, latencyMs, incident, balance, lastOk: Date.now() });
  } catch (e) {
    set(id, { status: "red", detail: `Could not reach ${p.name}: ${networkCause(e)}`, incident, network: true });
  }
  return getStatus(id);
}

export async function checkAll() {
  await Promise.allSettled(Object.keys(PROVIDERS).map((id) => checkProvider(id, { auto: true })));
  return allStatus();
}

// Re-checks every loaded user's providers (one user in local mode).
export function startHealthLoop(intervalMs = 5 * 60 * 1000) {
  const tick = () => { for (const c of allContexts()) runAs(c, () => checkAll().catch(() => {})); };
  tick();
  setInterval(tick, intervalMs).unref();
}
