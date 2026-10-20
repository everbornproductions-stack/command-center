// Health lights. green = key works and no incident. amber = incident on the status page,
// slow, or balance running low. red = auth/5xx failure. grey = no key saved.
import { PROVIDERS, geminiBase } from "./registry.js";
import { getSecret } from "./vault.js";
import { emit } from "./events.js";
import { ctx, allContexts, runAs } from "./store.js";

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
  t[id] = { ...prev, ...patch, checkedAt: Date.now() };
  if (prev.status !== t[id].status || prev.detail !== t[id].detail) emit("provider.status", { provider: id, ...t[id] });
}

// Mark from a real call outcome (called by council/mission on success or error)
export function noteCall(id, ok, latencyMs, errStatus) {
  const cur = getStatus(id);
  if (ok) {
    const slow = latencyMs > 25000;
    set(id, { status: cur.incident ? "amber" : slow ? "amber" : "green", detail: slow ? `slow (${(latencyMs / 1000).toFixed(0)}s)` : cur.incident ? cur.incident : "ok", latencyMs, lastOk: Date.now() });
  } else if (errStatus === 401 || errStatus === 403) set(id, { status: "red", detail: `Key rejected (${errStatus})` });
  else if (errStatus === 429) set(id, { status: "amber", detail: "rate limited / out of credits" });
  else if (errStatus === 402) set(id, { status: "red", detail: "payment required: no credits" });
  else if (errStatus >= 500) set(id, { status: "amber", detail: `provider error ${errStatus}` });
  else if (errStatus === 0) set(id, { status: "amber", detail: "network error" });
  else if (errStatus >= 400) set(id, { status: "red", detail: `HTTP ${errStatus} from the provider` });
}

// Turn a provider's refusal into words a person can act on, keeping the provider's own message
// (with anything that looks like a key masked). Never just "key rejected" when the reason is known.
export function providerMessage(json, text) {
  const e = json?.error;
  let m = (typeof e === "string" ? e : e?.message) || json?.message || json?.detail || json?.error_description || (typeof text === "string" && !/^\s*</.test(text) ? text : "") || "";
  if (Array.isArray(json) && json[0]?.error?.message) m = json[0].error.message; // Google sometimes wraps errors in an array
  return String(m).replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1…").replace(/\bAQ\.[A-Za-z0-9_.-]{4,}/g, "AQ.…").replace(/\b(xai-|AIza|gsk_|pplx-|fw_|tgp_)[A-Za-z0-9_-]{4,}/g, "$1…").replace(/\s+/g, " ").trim().slice(0, 180);
}
export function explainProviderError(p, status, json, text) {
  const msg = providerMessage(json, text);
  const low = msg.toLowerCase();
  const tail = msg ? `: ${msg}` : "";
  if (/credit|spending limit|spend limit|quota|billing|insufficient_quota|exceeded your current|balance/.test(low) && status !== 401)
    return { status: "amber", detail: `Out of credits or spending limit reached${tail}` };
  if (p.api === "anthropic" && /workspace/.test(low))
    return { status: "red", detail: `This key needs a workspace: pick or paste your Anthropic workspace ID${tail}` };
  if (status === 400 && /api key not valid|api_key_invalid|invalid api key|incorrect api key/.test(low)) return { status: "red", detail: `Key rejected (${status})${tail}` };
  if (status === 401 || status === 403) return { status: "red", detail: `Key rejected (${status})${tail}` };
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
    const r = await fetch(url, { headers, signal: ctl.signal });
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

export async function checkProvider(id) {
  const p = PROVIDERS[id];
  if (!p) return;
  const sec = getSecret(p.id, p.keyEnv);
  const incident = await checkStatusPage(p);
  if (!sec) { set(id, { status: "grey", detail: incident ? `no key · ${incident}` : "no key", incident }); return getStatus(id); }
  // managed plan (Phase 9): the pool key is not used for checks; the first real call shows whether it works
  if (sec.managed) { set(id, { status: incident ? "amber" : "green", detail: incident ? `managed by Everborn · ${incident}` : "managed by Everborn", incident }); return getStatus(id); }
  if (p.kind !== "text") {
    // media providers with an API we can ping
    try {
      if (p.id === "elevenlabs") {
        const t0 = Date.now();
        const r = await fetchJson("https://api.elevenlabs.io/v1/user/subscription", { "xi-api-key": sec.key });
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
    if (!r.ok) {
      noteCall(id, false, latencyMs, r.status); // keeps the call stats; the words come from the provider's own message
      set(id, { ...explainProviderError(p, r.status, r.json, r.text), incident });
      return getStatus(id);
    }
    if (p.balanceApi === "openrouter-key") {
      const c = await fetchJson(`${p.baseUrl}/key`, { authorization: `Bearer ${sec.key}` });
      const d = c.json?.data;
      if (c.ok && d) {
        const left = d.limit_remaining ?? (d.limit != null ? d.limit - (d.usage || 0) : null);
        balance = { left: left != null ? +Number(left).toFixed(2) : null, unit: "USD", used: d.usage, usedMonth: d.usage_monthly, limit: d.limit, free: !!d.is_free_tier };
        if (balance.left == null) { balance = { ...balance, left: null }; }
      }
    } else if (p.balanceApi === "deepseek-balance") {
      const c = await fetchJson(`${p.baseUrl}/user/balance`, { authorization: `Bearer ${sec.key}` });
      const b = c.json?.balance_infos?.[0];
      if (c.ok && b) balance = { left: +Number(b.total_balance).toFixed(2), unit: b.currency || "USD" };
    }
    let st = incident ? "amber" : "green";
    let detail = incident || "ok";
    if (balance && balance.unit === "USD" && balance.left != null && balance.left < 2) { st = balance.left <= 0 ? "red" : "amber"; detail = `low balance: $${balance.left}`; }
    else if (balance && balance.left != null) detail = `${balance.left} ${balance.unit} left`;
    else if (balance && balance.used != null) detail = `$${Number(balance.used).toFixed(2)} used so far`;
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
  await Promise.allSettled(Object.keys(PROVIDERS).map((id) => checkProvider(id)));
  return allStatus();
}

// Re-checks every loaded user's providers (one user in local mode).
export function startHealthLoop(intervalMs = 5 * 60 * 1000) {
  const tick = () => { for (const c of allContexts()) runAs(c, () => checkAll().catch(() => {})); };
  tick();
  setInterval(tick, intervalMs).unref();
}
