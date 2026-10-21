// Provider balances: "credits left" for every AI provider on the Subscriptions page.
//  - Live adapters ask the provider's own balance or billing API with the saved vault key:
//      OpenRouter   GET /credits (total_credits - total_usage), else GET /key (limit_remaining)
//      DeepSeek     GET /user/balance
//      OpenAI       GET /organization/costs (needs an admin key, sk-admin-...): month-to-date spend
//      Anthropic    GET /v1/organizations/cost_report (needs an admin key, sk-ant-admin...): month-to-date spend
//      xAI          management API prepaid balance (needs a management key and the team id)
//    Gemini, Groq, Together, Fireworks, Mistral and Perplexity have no balance API for API keys.
//  - Where no live number exists (no API, or the key lacks permission) the page shows an ESTIMATE:
//    the budget or credit amount the person saved, minus what this app's ledger spent. It is always
//    labelled "estimated" and comes with a plain hint of which key would give live numbers.
//  - Errors use the decision 12 wording: "Key rejected (401)", "Could not reach <provider>: <reason>".
// Base URLs and fetch are injectable (configure(), or per call) so tests use local mock servers only.
// Keys are only ever sent in headers, never in a URL, and never logged.
import { PROVIDERS } from "./registry.js";
import { networkCause, providerMessage } from "./health.js";
import { localFetch } from "./loopback-fetch.js";

const DEV = process.env.CC_PACKAGED !== "1";
const XAI_MGMT_DEFAULT = "https://management-api.x.ai";

let cfg = { fetch: null, baseUrls: {}, timeoutMs: 10000 };
// tests: configure({ fetch, baseUrls: { openrouter: "http://127.0.0.1:port/v1" }, timeoutMs })
export function configure(o = {}) { cfg = { ...cfg, ...o, baseUrls: { ...cfg.baseUrls, ...(o.baseUrls || {}) } }; return cfg; }
export function resetConfig() { cfg = { fetch: null, baseUrls: {}, timeoutMs: 10000 }; }

export class BalanceError extends Error { constructor(msg, o = {}) { super(msg); Object.assign(this, o); } }

const vendorOf = (pid) => ({ openai: "OpenAI", anthropic: "Anthropic", xai: "xAI", google: "Google Gemini" }[pid] || PROVIDERS[pid]?.vendor || PROVIDERS[pid]?.name || pid);

export function baseFor(pid, o = {}) {
  if (o.base) return String(o.base).replace(/\/+$/, "");
  if (cfg.baseUrls[pid]) return String(cfg.baseUrls[pid]).replace(/\/+$/, "");
  if (pid === "xai-management") return ((DEV && process.env.CC_BASE_URL_XAI_MANAGEMENT) || XAI_MGMT_DEFAULT).replace(/\/+$/, "");
  return String(PROVIDERS[pid]?.baseUrl || "").replace(/\/+$/, "");
}

// One GET with a timeout. Never puts a key in the URL; never logs the key.
export async function getJson(pid, url, headers = {}, o = {}) {
  const f = o.fetch || cfg.fetch || localFetch;
  const ms = o.timeoutMs || cfg.timeoutMs || 10000;
  let r;
  try { r = await f(url, { headers, signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw new BalanceError(`Could not reach ${vendorOf(pid)}: ${networkCause(e)}`, { network: true }); }
  const txt = await r.text().catch(() => "");
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) {
    const m = providerMessage(j, txt);
    const rejected = r.status === 401 || r.status === 403;
    throw new BalanceError(`${rejected ? `Key rejected (${r.status})` : `${vendorOf(pid)} answered HTTP ${r.status}`}${m ? `: ${m}` : ""}`, { status: r.status, rejected, forbidden: r.status === 403 });
  }
  return j ?? {};
}

const monthStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);
const r2 = (n) => +Number(n || 0).toFixed(2);
const r4 = (n) => +Number(n || 0).toFixed(4);

async function pages(pid, makeUrl, headers, each, o, max = 6) {
  let page = null, n = 0;
  do { const j = await getJson(pid, makeUrl(page), headers, o); for (const b of j.data || []) each(b); page = j.has_more ? j.next_page : null; n++; } while (page && n < max);
}

// ---------- live adapters: (secret, opts) -> { creditsLeft?, creditsTotal?, creditsUnit?, mtd?, ... } ----------
async function openrouter(secret, o = {}) {
  const base = baseFor("openrouter", o), h = { authorization: `Bearer ${secret.key}` };
  const d = (await getJson("openrouter", `${base}/key`, h, o)).data || {};
  const out = { creditsUnit: "USD", free: !!d.is_free_tier };
  if (d.usage_monthly != null) out.mtd = r4(d.usage_monthly);
  try {
    const c = (await getJson("openrouter", `${base}/credits`, h, o)).data || {};
    if (c.total_credits != null) { out.creditsTotal = r2(c.total_credits); out.creditsLeft = r2(Number(c.total_credits) - Number(c.total_usage || 0)); }
  } catch (e) { if (e.network) throw e; out.note = "This key cannot read account credits (/credits); showing the key's own limit."; }
  if (out.creditsLeft == null && d.limit_remaining != null) { out.creditsLeft = r2(d.limit_remaining); out.creditsTotal = d.limit != null ? r2(d.limit) : null; out.creditsScope = "key limit"; }
  return out;
}

async function deepseek(secret, o = {}) {
  const j = await getJson("deepseek", `${baseFor("deepseek", o)}/user/balance`, { authorization: `Bearer ${secret.key}` }, o);
  const infos = j.balance_infos || [];
  const b = infos.find((x) => x.currency === "USD") || infos[0];
  if (!b) return { note: "DeepSeek returned no balance." };
  return { creditsLeft: r2(b.total_balance), creditsUnit: b.currency || "USD", available: j.is_available !== false };
}

async function openai(secret, o = {}) {
  const base = baseFor("openai", o), h = { authorization: `Bearer ${secret.key}` };
  const start = Math.floor(monthStart(o.now ? new Date(o.now) : new Date()).getTime() / 1000);
  const url = (path) => (page) => { const u = new URL(`${base}${path}`); u.searchParams.set("start_time", String(start)); u.searchParams.set("bucket_width", "1d"); u.searchParams.set("limit", "31"); if (page) u.searchParams.set("page", page); return u.toString(); };
  let mtd = 0, cur = "usd";
  await pages("openai", url("/organization/costs"), h, (b) => { for (const r of b.results || []) { mtd += Number(r.amount?.value || 0); cur = r.amount?.currency || cur; } }, o);
  const out = { mtd: r4(mtd), mtdCurrency: String(cur).toUpperCase() };
  try { let i = 0, x = 0; await pages("openai", url("/organization/usage/completions"), h, (b) => { for (const r of b.results || []) { i += Number(r.input_tokens || 0); x += Number(r.output_tokens || 0); } }, o); out.inTok = i; out.outTok = x; } catch (e) { if (e.network) throw e; }
  return out;
}

async function anthropic(secret, o = {}) {
  const base = baseFor("anthropic", o), h = { "x-api-key": secret.key, "anthropic-version": "2023-06-01" };
  const from = monthStart(o.now ? new Date(o.now) : new Date()).toISOString();
  const url = (path) => (page) => { const u = new URL(`${base}${path}`); u.searchParams.set("starting_at", from); u.searchParams.set("bucket_width", "1d"); u.searchParams.set("limit", "31"); if (page) u.searchParams.set("page", page); return u.toString(); };
  // cost_report amounts are decimal strings in the lowest currency unit (cents)
  let cents = 0, cur = "USD";
  await pages("anthropic", url("/v1/organizations/cost_report"), h, (b) => { for (const r of b.results || []) { cents += Number(r.amount || 0); cur = r.currency || cur; } }, o);
  const out = { mtd: r4(cents / 100), mtdCurrency: String(cur).toUpperCase() };
  try {
    let i = 0, x = 0;
    await pages("anthropic", url("/v1/organizations/usage_report/messages"), h, (b) => { for (const r of b.results || []) { i += Number(r.uncached_input_tokens || 0) + Number(r.cache_read_input_tokens || 0) + Object.values(r.cache_creation || {}).reduce((a, v) => a + Number(v || 0), 0); x += Number(r.output_tokens || 0); } }, o);
    out.inTok = i; out.outTok = x;
  } catch (e) { if (e.network) throw e; }
  return out;
}

// xAI management API: prepaid balance for a team. The total is in cents; prepaid credit shows as a negative amount.
async function xai(secret, o = {}) {
  if (!secret.teamId) throw new BalanceError("Add the xAI team id next to the management key to see the live balance.", { status: 400 });
  const base = baseFor("xai-management", o);
  const j = await getJson("xai", `${base}/v1/billing/teams/${encodeURIComponent(secret.teamId)}/prepaid/balance`, { authorization: `Bearer ${secret.key}` }, o);
  const raw = j?.total?.val ?? j?.total ?? null;
  if (raw == null || !Number.isFinite(Number(raw))) return { note: "xAI returned no prepaid balance." };
  return { creditsLeft: r2(Math.max(0, -Number(raw)) / 100), creditsUnit: "USD" };
}

export const ADAPTERS = {
  openrouter: { kind: "key", how: "Credits and key info from OpenRouter", fetch: openrouter },
  deepseek: { kind: "key", how: "Balance from DeepSeek", fetch: deepseek },
  openai: { kind: "admin", how: "Month-to-date cost and usage from the OpenAI organization costs API", fetch: openai, adminEnv: "OPENAI_ADMIN_KEY", adminHint: "sk-admin-…", adminUrl: "https://platform.openai.com/settings/organization/admin-keys", looksNormal: /^sk-(proj|svcacct)-/ },
  anthropic: { kind: "admin", how: "Month-to-date cost and usage from the Anthropic cost and usage reports", fetch: anthropic, adminEnv: "ANTHROPIC_ADMIN_KEY", adminHint: "sk-ant-admin01-…", adminUrl: "https://platform.claude.com/settings/admin-keys", looksNormal: /^sk-ant-api/ },
  xai: { kind: "admin", how: "Prepaid balance from the xAI management API", fetch: xai, adminEnv: "XAI_MANAGEMENT_KEY", adminHint: "xAI management key", adminUrl: "https://console.x.ai", needsTeam: true, looksNormal: null },
};

// Providers with no balance API for API keys: always an estimate.
export const NO_API = {
  google: "The Gemini API has no balance or spend endpoint. The free tier is used first where it fits, so this is an estimate.",
  groq: "Groq has no balance API, so this is an estimate.",
  together: "Together AI has no balance API for API keys, so this is an estimate.",
  fireworks: "Fireworks AI has no balance API for API keys, so this is an estimate.",
  mistral: "Mistral has no balance API, so this is an estimate.",
  perplexity: "Perplexity has no balance API, so this is an estimate.",
};

// What would turn the estimate into live numbers, in plain words.
export function liveHint(pid, { adminKeyed = false, error = null } = {}) {
  const A = ADAPTERS[pid];
  if (error) return /Key rejected/.test(error) ? `Check the ${vendorOf(pid)} ${A?.kind === "admin" ? (pid === "xai" ? "management" : "admin") : "API"} key in Settings to see live numbers.` : "Showing the last known or estimated numbers until the next check works.";
  if (pid === "openai" && !adminKeyed) return "Add an OpenAI admin key to see live spend.";
  if (pid === "anthropic" && !adminKeyed) return "Add an Anthropic admin key to see live spend.";
  if (pid === "xai" && !adminKeyed) return "Add an xAI management key to see the live balance.";
  if (A?.kind === "admin") return null;
  if (A) return null;
  return NO_API[pid] || "This provider has no balance API, so this is an estimate.";
}

export const NO_INFO_HINT = "Set a monthly budget for this provider to see an estimate.";

// Run one live adapter. Returns { ok: true, at, ...numbers } or throws a BalanceError with plain wording.
export async function checkLive(pid, secret, o = {}) {
  const A = ADAPTERS[pid];
  if (!A) throw new BalanceError(`${vendorOf(pid)} has no balance API.`, { noApi: true });
  if (!secret?.key) throw new BalanceError(`No ${A.kind === "admin" ? "admin" : "API"} key saved for ${vendorOf(pid)}.`, { missing: true });
  return { ok: true, at: o.now || Date.now(), ...(await A.fetch(secret, o)) };
}

// Small in-memory cache in front of checkLive: the page open and the 15 minute timer share it.
const cache = new Map(); // pid -> { at, keyTag, value | error }
const keyTag = (s) => (s?.key ? `${s.key.length}:${s.key.slice(-4)}:${s.teamId || ""}` : "");
export function clearCache() { cache.clear(); }
export async function cachedLive(pid, secret, { maxAgeMs = 0, ...o } = {}) {
  const c = cache.get(pid), now = Date.now();
  if (c && maxAgeMs > 0 && now - c.at < maxAgeMs && c.keyTag === keyTag(secret)) { if (c.error) throw c.error; return c.value; }
  try { const value = await checkLive(pid, secret, o); cache.set(pid, { at: now, keyTag: keyTag(secret), value }); return value; }
  catch (e) { cache.set(pid, { at: now, keyTag: keyTag(secret), error: e }); throw e; }
}

// The estimate shown when there is no live balance.
//  budget: { amount, kind: "monthly" | "credit", at?, source: "budget" | "cap" }
//  spentMonth: this app's ledger spend this month; spentSince: ledger spend since budget.at (credit kind)
//  liveMtd: month-to-date from a live spend API (OpenAI / Anthropic admin key), used instead of the ledger
export function estimateCredits({ budget, spentMonth = 0, spentSince = null, liveMtd = null } = {}) {
  const amount = Number(budget?.amount);
  if (!(amount > 0)) return null;
  if (budget.kind === "credit") {
    const spent = Number(spentSince ?? spentMonth ?? 0);
    return { value: r2(Math.max(0, amount - spent)), total: r2(amount), unit: "USD", source: "estimate", estimated: true, basis: "credit", label: `estimated: the $${r2(amount)} credit you entered, minus $${r2(spent)} this app spent since then` };
  }
  const fromLive = liveMtd != null;
  const spent = Number(fromLive ? liveMtd : spentMonth || 0);
  const what = budget.source === "cap" ? "monthly spend cap" : "monthly budget";
  return { value: r2(Math.max(0, amount - spent)), total: r2(amount), unit: "USD", source: "estimate", estimated: true, basis: budget.source === "cap" ? "cap" : "budget", label: `estimated: your $${r2(amount)} ${what}, minus $${r2(spent)} spent this month (${fromLive ? "live spend from the API" : "this app's ledger"})` };
}

// Pick the budget for a provider: a saved budget or credit amount first, then the spend cap.
export function budgetFor(pid, { budgets = {}, caps = {} } = {}) {
  const b = budgets[pid];
  if (b && Number(b.amount) > 0) return { amount: Number(b.amount), kind: b.kind === "credit" ? "credit" : "monthly", at: b.at || null, source: "budget" };
  if (Number(caps[pid]) > 0) return { amount: Number(caps[pid]), kind: "monthly", source: "cap" };
  return null;
}
