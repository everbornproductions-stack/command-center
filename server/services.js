// Subscriptions and services page (Phase 25), core.
//  (a) API providers: live credits and month-to-date spend where an API exists (OpenRouter /credits and
//      /key, DeepSeek /user/balance, OpenAI and Anthropic cost and usage reports through an OPTIONAL admin
//      key in the vault), otherwise month-to-date from this app's ledger; amber / red tied to the spend caps.
//  (b) Subscriptions without an API: an optional, read-only Gmail or Outlook connection scans receipt and
//      renewal emails; each extracted row has a confidence and a link to its email and waits for the person
//      to confirm or edit it. Only the extracted fields and the message id are kept, never a body or subject.
//  (c) Monthly total across APIs and subscriptions, and "possible duplicate or unused" hints.
// Renewal reminders live in the alerts plugin (renewalSweep), which reads remindDays from each row.
import crypto from "node:crypto";
import { PROVIDERS } from "./registry.js";
import { doc, putDoc, ctx, HOSTED } from "./store.js";
import { getSecret, setSecret, hasSecret, maskedKey } from "./vault.js";
import { summary as ledgerSummary, allEntries } from "./ledger.js";
import { allStatus, networkCause, providerMessage } from "./health.js";
import { emit } from "./events.js";
import { subscriptionView, totals as subTotals, saveSubscription } from "./subscriptions.js";
import { parseReceipt, htmlToText, LOW_CONFIDENCE } from "./receipts.js";
import { activeExtra, listAccounts, markAccount, onRemoveLegacy } from "./mail-accounts.js";

// Test and development hook (like CC_BASE_URL_<ID>): local mocks for the mail and sign-in endpoints. Installed builds ignore it.
const DEV = process.env.CC_PACKAGED !== "1";
const env = (name, dflt) => (DEV && process.env[name]) || dflt;

const LIVE_DOC = "services.live";       // { [providerId]: { ok, at, creditsLeft, creditsTotal, creditsUnit, mtd, mtdCurrency, inTok, outTok, note, error } }
const HISTORY_DOC = "services.history"; // { [providerId]: [{ ts, left }] } credit balance snapshots (activity for the unused hint)
const MAIL_DOC = "services.mail";       // { gmail: {...}, outlook: {...}, pending: [candidate], seen: { "<src>:<messageId>": "confirmed" | "dismissed" } }
const DAY = 86400000;

export class ServiceError extends Error { constructor(msg, o = {}) { super(msg); Object.assign(this, o); } }
const fail = (status, msg, o = {}) => new ServiceError(msg, { status, ...o });

async function getJson(url, headers = {}) {
  let r;
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new ServiceError(`Could not reach ${new URL(url).host}: ${networkCause(e)}`, { network: true }); }
  const txt = await r.text().catch(() => "");
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) {
    const m = providerMessage(j, txt);
    const rejected = r.status === 401 || r.status === 403;
    throw new ServiceError(`${rejected ? `Key rejected (${r.status})` : `HTTP ${r.status} from ${new URL(url).host}`}${m ? `: ${m}` : ""}`, { status: r.status, rejected });
  }
  return j ?? {};
}
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const monthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const r4 = (n) => +Number(n || 0).toFixed(4);

// ---------- (a) live balances and spend ----------
async function liveOpenRouter(key) {
  const base = PROVIDERS.openrouter.baseUrl, h = { authorization: `Bearer ${key}` };
  const d = (await getJson(`${base}/key`, h)).data || {};
  const out = { creditsUnit: "USD", free: !!d.is_free_tier };
  if (d.usage_monthly != null) out.mtd = r4(d.usage_monthly);
  try {
    const c = (await getJson(`${base}/credits`, h)).data || {};
    if (c.total_credits != null) { out.creditsTotal = +Number(c.total_credits).toFixed(2); out.creditsLeft = +(Number(c.total_credits) - Number(c.total_usage || 0)).toFixed(2); }
  } catch (e) { if (e.network) throw e; out.note = "This key cannot read account credits (/credits); showing the key's own limit."; }
  if (out.creditsLeft == null && d.limit_remaining != null) { out.creditsLeft = +Number(d.limit_remaining).toFixed(2); out.creditsTotal = d.limit != null ? +Number(d.limit).toFixed(2) : null; out.creditsScope = "key limit"; }
  return out;
}
async function liveDeepSeek(key) {
  const j = await getJson(`${PROVIDERS.deepseek.baseUrl}/user/balance`, { authorization: `Bearer ${key}` });
  const infos = j.balance_infos || [];
  const b = infos.find((x) => x.currency === "USD") || infos[0];
  if (!b) return { note: "DeepSeek returned no balance." };
  return { creditsLeft: +Number(b.total_balance).toFixed(2), creditsUnit: b.currency || "USD", available: j.is_available !== false };
}
async function pages(makeUrl, headers, each, max = 6) {
  let page = null, n = 0;
  do { const j = await getJson(makeUrl(page), headers); for (const b of j.data || []) each(b); page = j.has_more ? j.next_page : null; n++; } while (page && n < max);
}
async function liveOpenAI(adminKey) {
  const base = PROVIDERS.openai.baseUrl, h = { authorization: `Bearer ${adminKey}` };
  const start = Math.floor(monthStart().getTime() / 1000);
  const url = (path) => (page) => { const u = new URL(`${base}${path}`); u.searchParams.set("start_time", String(start)); u.searchParams.set("bucket_width", "1d"); u.searchParams.set("limit", "31"); if (page) u.searchParams.set("page", page); return u.toString(); };
  let mtd = 0, cur = "usd";
  await pages(url("/organization/costs"), h, (b) => { for (const r of b.results || []) { mtd += Number(r.amount?.value || 0); cur = r.amount?.currency || cur; } });
  const out = { mtd: r4(mtd), mtdCurrency: String(cur).toUpperCase() };
  try { let i = 0, o = 0; await pages(url("/organization/usage/completions"), h, (b) => { for (const r of b.results || []) { i += Number(r.input_tokens || 0); o += Number(r.output_tokens || 0); } }); out.inTok = i; out.outTok = o; } catch (e) { if (e.network) throw e; }
  return out;
}
async function liveAnthropic(adminKey) {
  const base = PROVIDERS.anthropic.baseUrl, h = { "x-api-key": adminKey, "anthropic-version": "2023-06-01" };
  const url = (path) => (page) => { const u = new URL(`${base}${path}`); u.searchParams.set("starting_at", monthStart().toISOString()); u.searchParams.set("bucket_width", "1d"); u.searchParams.set("limit", "31"); if (page) u.searchParams.set("page", page); return u.toString(); };
  // cost_report amounts are decimal strings in the lowest currency unit (cents)
  let cents = 0, cur = "USD";
  await pages(url("/v1/organizations/cost_report"), h, (b) => { for (const r of b.results || []) { cents += Number(r.amount || 0); cur = r.currency || cur; } });
  const out = { mtd: r4(cents / 100), mtdCurrency: String(cur).toUpperCase() };
  try {
    let i = 0, o = 0;
    await pages(url("/v1/organizations/usage_report/messages"), h, (b) => { for (const r of b.results || []) { i += Number(r.uncached_input_tokens || 0) + Number(r.cache_read_input_tokens || 0) + Object.values(r.cache_creation || {}).reduce((a, x) => a + Number(x || 0), 0); o += Number(r.output_tokens || 0); } });
    out.inTok = i; out.outTok = o;
  } catch (e) { if (e.network) throw e; }
  return out;
}

export const LIVE = {
  openrouter: { kind: "key", how: "Credits and key info from OpenRouter", fetch: liveOpenRouter },
  deepseek: { kind: "key", how: "Balance from DeepSeek", fetch: liveDeepSeek },
  openai: { kind: "admin", how: "Month-to-date cost and usage from the OpenAI organization costs API", fetch: liveOpenAI, adminEnv: "OPENAI_ADMIN_KEY", adminHint: "sk-admin-…", adminUrl: "https://platform.openai.com/settings/organization/admin-keys", looksNormal: /^sk-(proj|svcacct)-/ },
  anthropic: { kind: "admin", how: "Month-to-date cost and usage from the Anthropic cost and usage reports", fetch: liveAnthropic, adminEnv: "ANTHROPIC_ADMIN_KEY", adminHint: "sk-ant-admin01-…", adminUrl: "https://platform.claude.com/settings/admin-keys", looksNormal: /^sk-ant-api/ },
};
export const NO_LIVE = {
  xai: "xAI has no balance endpoint for API keys that this app uses, so month-to-date comes from this app's ledger.",
  google: "The Gemini API has no balance or spend endpoint, so month-to-date comes from this app's ledger.",
};
export const adminId = (pid) => `admin-${pid}`;
const adminSecret = (pid) => getSecret(adminId(pid), LIVE[pid]?.adminEnv);
const liveKey = (pid) => (LIVE[pid].kind === "admin" ? adminSecret(pid)?.key : getSecret(pid, PROVIDERS[pid]?.keyEnv)?.key);

function noteHistory(pid, left) {
  if (left == null) return;
  const h = doc(HISTORY_DOC, () => ({}));
  const list = h[pid] || (h[pid] = []);
  const last = list[list.length - 1];
  if (!last || last.left !== left || Date.now() - last.ts > 6 * 3600 * 1000) list.push({ ts: Date.now(), left });
  if (list.length > 120) list.splice(0, list.length - 120);
  putDoc(HISTORY_DOC, h);
}

// Fetch every live source that has a key. A failed fetch keeps the last good numbers, marked with the error.
export async function refreshLive({ only } = {}) {
  const live = { ...doc(LIVE_DOC, () => ({})) };
  for (const pid of Object.keys(LIVE)) {
    if (only && only !== pid) continue;
    const key = liveKey(pid);
    if (!key) { delete live[pid]; continue; }
    try { const r = await LIVE[pid].fetch(key); live[pid] = { ok: true, at: Date.now(), ...r }; noteHistory(pid, r.creditsLeft); }
    catch (e) { live[pid] = { ...(live[pid] || {}), ok: false, at: Date.now(), error: e.message, rejected: !!e.rejected, network: !!e.network }; }
  }
  putDoc(LIVE_DOC, live);
  return live;
}
export const liveAt = () => Math.max(0, ...Object.values(doc(LIVE_DOC, () => ({}))).map((x) => x.at || 0));

// Paste an admin key → one cost call → vault. A refused or unreachable key is never kept; the previous one is put back.
export async function saveAdminKey(pid, key) {
  const L = LIVE[pid];
  if (L?.kind !== "admin") throw fail(400, "Admin keys are only used for OpenAI and Anthropic.");
  key = String(key || "").trim();
  if (!key) throw fail(400, "Paste the admin key first.");
  if (key.length > 4000 || /\s/.test(key)) throw fail(400, "That does not look like an API key (it has spaces or is far too long).");
  if (L.looksNormal.test(key)) throw fail(400, `That looks like a regular API key. The usage and cost reports need an admin key (${L.adminHint}), made by an organization owner at ${L.adminUrl}`, { code: "not_admin" });
  const prev = getSecret(adminId(pid));
  await setSecret(adminId(pid), { key });
  try {
    const r = await L.fetch(key);
    const live = { ...doc(LIVE_DOC, () => ({})), [pid]: { ok: true, at: Date.now(), ...r } };
    putDoc(LIVE_DOC, live);
    return { ok: true, kept: true, label: "Admin key works", tone: "green", detail: `Month-to-date: $${r.mtd.toFixed(2)}.`, masked: maskedKey(adminId(pid)) };
  } catch (e) {
    await setSecret(adminId(pid), prev && !prev.fromEnv ? prev : null);
    return { ok: false, kept: false, label: e.rejected ? "Key rejected" : e.network ? `Could not reach ${PROVIDERS[pid].name}` : "Not saved", tone: e.rejected || e.network ? "red" : "amber", detail: e.message, masked: maskedKey(adminId(pid)) };
  }
}
export async function removeAdminKey(pid) {
  if (LIVE[pid]?.kind !== "admin") throw fail(400, "unknown admin key");
  await setSecret(adminId(pid), null);
  const live = { ...doc(LIVE_DOC, () => ({})) }; delete live[pid]; putDoc(LIVE_DOC, live);
}
export const adminView = () => Object.fromEntries(Object.entries(LIVE).filter(([, L]) => L.kind === "admin").map(([pid, L]) => [pid, { keyed: !!adminSecret(pid), masked: adminSecret(pid) ? maskedKey(adminId(pid), L.adminEnv) : null, fromEnv: !!adminSecret(pid)?.fromEnv, hint: L.adminHint, url: L.adminUrl, how: L.how }]));

// One row per AI provider with a key or with spend this month.
export function apiRows() {
  const led = ledgerSummary(), st = allStatus(), live = doc(LIVE_DOC, () => ({})), caps = doc("alerts.caps", () => ({}));
  const rows = [];
  for (const p of Object.values(PROVIDERS)) {
    if (p.kind !== "text" || (p.demo && !hasSecret(p.id))) continue;
    const keyed = hasSecret(p.id, p.keyEnv), L = live[p.id];
    const ledgerMtd = r4(led.byProvider[p.id]?.month || 0);
    if (!keyed && !ledgerMtd && !L) continue;
    const apiMtd = L?.mtd != null ? L.mtd : null;
    const mtd = apiMtd != null
      ? { value: apiMtd, source: "api", label: `auto-detected: ${p.name} API`, at: L.at, stale: L.ok === false }
      : { value: ledgerMtd, source: "ledger", label: "auto-detected: this app's ledger" };
    const bal = st[p.id]?.balance;
    let credits = null;
    if (L?.creditsLeft != null) credits = { value: L.creditsLeft, total: L.creditsTotal ?? null, unit: L.creditsUnit || "USD", source: "api", label: `auto-detected: ${p.name} API${L.creditsScope ? ` (${L.creditsScope})` : ""}`, at: L.at, stale: L.ok === false };
    else if (bal?.left != null) credits = { value: bal.left, total: bal.limit ?? null, unit: bal.unit || "USD", source: "api", label: `auto-detected: ${p.name} API (health check)`, at: st[p.id].checkedAt };
    const cap = Number(caps[p.id]) > 0 ? Number(caps[p.id]) : null;
    const capPct = cap ? Math.round((ledgerMtd / cap) * 100) : null;
    const capPctAll = cap && apiMtd != null ? Math.round((apiMtd / cap) * 100) : null;
    let level = "ok"; const why = [];
    const up = (l, w) => { if (l === "red" || (l === "amber" && level === "ok")) level = l; why.push(w); };
    if (capPct != null && capPct >= 100) up("red", `hit its $${cap} monthly cap: the router sends it no new work`);
    else if (capPct != null && capPct >= 80) up("amber", `at ${capPct}% of its $${cap} monthly cap`);
    if (capPctAll != null && capPctAll > (capPct ?? 0) && capPctAll >= 80) up(capPctAll >= 100 ? "red" : "amber", `${capPctAll}% of the cap when spend outside this app is counted`);
    if (credits && credits.unit === "USD" && credits.value <= 0) up("red", "no credits left");
    else if (credits && credits.unit === "USD" && credits.value < 2) up("amber", `low balance: $${credits.value}`);
    if (st[p.id]?.status === "red") up("red", st[p.id].detail);
    if (L?.ok === false && L.error) why.push(`last live check failed: ${L.error}`);
    const supported = LIVE[p.id] ? { how: LIVE[p.id].how, needsAdmin: LIVE[p.id].kind === "admin", adminKeyed: LIVE[p.id].kind === "admin" ? !!adminSecret(p.id) : undefined } : null;
    rows.push({
      provider: p.id, name: p.name, color: p.color, keyed, demo: !!p.demo, custom: !!p.custom,
      credits, mtd, ledgerMtd, apiMtd, inTok: L?.inTok ?? null, outTok: L?.outTok ?? null, note: L?.note || null,
      cap, capPct, capPctAll, level, why,
      live: supported, noLive: !supported ? NO_LIVE[p.id] || "No balance API: month-to-date comes from this app's ledger." : null,
      links: { billing: p.links?.billing || null, usage: p.links?.usage || p.links?.billing || null },
    });
  }
  return rows.sort((a, b) => (b.mtd.value || 0) - (a.mtd.value || 0) || a.name.localeCompare(b.name));
}

// ---------- (c) totals and hints ----------
const VENDOR_NAME = { openai: "OpenAI", anthropic: "Anthropic", google: "Google", xai: "xAI", kling: "Kling", suno: "Suno", midjourney: "Midjourney", elevenlabs: "ElevenLabs", cursor: "Cursor", perplexity: "Perplexity", runway: "Runway" };
const vendorName = (v) => VENDOR_NAME[v] || String(v || "").replace(/(^|-)([a-z])/g, (_, s, c) => (s ? " " : "") + c.toUpperCase());

export function totalsOf(rows) {
  const t = subTotals(), led = ledgerSummary();
  const api = rows.reduce((a, r) => a + (r.mtd.value || 0), 0);
  const inRows = new Set(rows.map((r) => r.provider));
  let other = 0;
  for (const [pid, b] of Object.entries(led.byProvider)) if (!inRows.has(pid) && !String(pid).startsWith("demo-")) other += b.month || 0;
  const now = new Date(), day = now.getDate(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const metered = api + other, projected = (metered / day) * dim;
  const r2 = (n) => +n.toFixed(2);
  return { subscriptions: t.known, subscriptionsEstimated: t.estimated, unconfirmed: t.unconfirmed, count: t.count, api: r2(api), other: r2(other), metered: r2(metered), projectedMetered: r2(projected), monthToDate: r2(t.known + metered), monthEstimate: r2(t.known + t.estimated + projected), dayOfMonth: day, daysInMonth: dim };
}

// view: subscriptionView() rows; entries: ledger lines; history: credit snapshots per provider
export function hintsFor(view, { entries = [], history = {}, now = Date.now() } = {}) {
  const out = [];
  const paid = view.filter((s) => Number(s.monthly) > 0 || (s.monthly == null && Number(s.listPrice) > 0));
  const byVendor = new Map();
  for (const s of paid) { const v = s.vendor; if (!v) continue; if (!byVendor.has(v)) byVendor.set(v, []); byVendor.get(v).push(s); }
  for (const [v, list] of byVendor) if (list.length > 1) out.push({ kind: "duplicate", vendor: v, ids: list.map((s) => s.id), text: `${list.map((s) => `${s.name}${s.plan && s.plan !== "UNKNOWN" ? ` (${s.plan})` : ""}`).join(" and ")}: ${list.length} plans from ${vendorName(v)}. Possible duplicate.` });
  const since = now - 30 * DAY;
  for (const s of view) {
    if (!(Number(s.monthly) > 0) || !s.provider) continue;
    if ((s.addedAt || 0) > since) continue; // too new to judge
    const used = entries.some((e) => e.provider === s.provider && e.ts >= since);
    const h = history[s.provider] || [];
    const moved = h.some((x, i) => i > 0 && x.ts >= since && x.left !== h[i - 1].left);
    const manual = (s.creditsUpdatedAt || 0) >= since;
    if (!used && !moved && !manual) out.push({ kind: "unused", vendor: s.vendor, ids: [s.id], text: `${s.name}: paid${s.price != null ? ` ($${s.price}${s.cycle && s.cycle !== "monthly" ? ` ${s.cycle}` : " a month"})` : ""}, but no use in this app and no credit change in 30 days. Possibly unused.` });
  }
  return out;
}

// ---------- (b) read-only mail connection ----------
const MAIL = {
  gmail: {
    name: "Gmail", scopes: ["https://www.googleapis.com/auth/gmail.readonly"], clientEnv: "CC_GMAIL_CLIENT_ID",
    authUrl: () => `${env("CC_GOOGLE_AUTH_URL", "https://accounts.google.com")}/o/oauth2/v2/auth`, tokenUrl: () => `${env("CC_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com")}/token`,
    api: () => env("CC_GMAIL_API_URL", "https://gmail.googleapis.com"), extra: { access_type: "offline", prompt: "consent" },
    setup: "Google Cloud console: create an OAuth client of type Desktop app, enable the Gmail API, and paste its client ID and client secret here.", consoleUrl: "https://console.cloud.google.com/apis/credentials",
  },
  outlook: {
    name: "Outlook", scopes: ["https://graph.microsoft.com/Mail.Read", "offline_access"], clientEnv: "CC_OUTLOOK_CLIENT_ID",
    authUrl: () => `${env("CC_MS_LOGIN_URL", "https://login.microsoftonline.com")}/common/oauth2/v2.0/authorize`, tokenUrl: () => `${env("CC_MS_LOGIN_URL", "https://login.microsoftonline.com")}/common/oauth2/v2.0/token`,
    api: () => env("CC_GRAPH_API_URL", "https://graph.microsoft.com"), extra: { response_mode: "query" }, sendScopeOnToken: true,
    setup: "Microsoft Entra admin center: register an app with a Mobile and desktop redirect of http://localhost, add the delegated Mail.Read permission, and paste its application (client) ID here.", consoleUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
  },
};
export const MAIL_SOURCES = Object.keys(MAIL);
export const MAIL_SCOPES = Object.fromEntries(Object.entries(MAIL).map(([k, v]) => [k, [...v.scopes]]));
const mailSecretId = (src) => `mail-${src}`;
const mailDoc = () => { const d = doc(MAIL_DOC, () => ({ gmail: {}, outlook: {}, pending: [], seen: {} })); d.pending ||= []; d.seen ||= {}; for (const s of MAIL_SOURCES) d[s] ||= {}; return d; };
const saveMail = (d) => putDoc(MAIL_DOC, d);
const clientIdOf = (src) => mailDoc()[src].clientId || (DEV || !HOSTED ? process.env[MAIL[src].clientEnv] : "") || null;
const mailSecret = (src) => getSecret(mailSecretId(src)) || null;
const srcOk = (src) => { if (!MAIL[src]) throw fail(400, "mail source must be gmail or outlook"); return MAIL[src]; };

export async function setMailClient(src, { clientId, clientSecret } = {}) {
  srcOk(src);
  const d = mailDoc();
  if (clientId !== undefined) {
    const id = String(clientId || "").trim();
    if (id && !/^[A-Za-z0-9._-]{8,200}$/.test(id)) throw fail(400, "That does not look like an OAuth client ID.");
    d[src].clientId = id || null; saveMail(d);
  }
  if (clientSecret !== undefined) {
    const sec = String(clientSecret || "").trim();
    if (sec && (sec.length > 400 || /\s/.test(sec))) throw fail(400, "That does not look like a client secret.");
    const cur = mailSecret(src) || { key: "oauth" };
    await setSecret(mailSecretId(src), { ...cur, key: "oauth", clientSecret: sec || null });
  }
  return mailView();
}

const oauthPending = new Map(); // state -> { src, verifier, redirectUri, user, at, accountId }
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const userId = () => { try { return ctx().userId; } catch { return null; } };

export function mailStart(src, { redirectUri, accountId } = {}) {
  const M = srcOk(src);
  const clientId = clientIdOf(src);
  if (!clientId) throw fail(400, `Add your ${M.name} OAuth client ID first. ${M.setup}`, { code: "client_id" });
  if (!/^https?:\/\/[^\s]+$/.test(String(redirectUri || ""))) throw fail(400, "redirectUri required");
  let extraId = null;
  if (accountId && accountId !== src) {
    const a = activeExtra(src, accountId);
    if (!a) throw fail(404, "That mail account is not in the list.");
    extraId = a.id;
  }
  for (const [k, p] of oauthPending) if (Date.now() - p.at > 10 * 60 * 1000 || (p.src === src && p.user === userId())) oauthPending.delete(k);
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = "mail-" + b64url(crypto.randomBytes(24));
  oauthPending.set(state, { src, verifier, redirectUri, user: userId(), at: Date.now(), accountId: extraId });
  const u = new URL(M.authUrl());
  u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", clientId); u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", M.scopes.join(" ")); u.searchParams.set("code_challenge", challenge); u.searchParams.set("code_challenge_method", "S256"); u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(M.extra || {})) u.searchParams.set(k, v);
  return { url: u.toString(), state, source: src, scopes: [...M.scopes] };
}

async function tokenRequest(src, form) {
  const M = MAIL[src];
  const sec = mailSecret(src);
  const body = new URLSearchParams({ ...form, client_id: clientIdOf(src), ...(sec?.clientSecret ? { client_secret: sec.clientSecret } : {}), ...(M.sendScopeOnToken ? { scope: M.scopes.join(" ") } : {}) });
  let r;
  try { r = await fetch(M.tokenUrl(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString(), signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new ServiceError(`Could not reach ${new URL(M.tokenUrl()).host}: ${networkCause(e)}`, { network: true }); }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok || !j?.access_token) throw new ServiceError(`${M.name} sign-in failed${j?.error_description || j?.error ? `: ${String(j.error_description || j.error).slice(0, 160)}` : ` (HTTP ${r.status})`}`, { status: r.status >= 500 ? 502 : 400, rejected: r.status === 400 || r.status === 401 });
  return j;
}
async function storeTokens(src, tok) {
  const cur = mailSecret(src) || {};
  await setSecret(mailSecretId(src), { key: "oauth", clientSecret: cur.clientSecret || null, access: tok.access_token, refresh: tok.refresh_token || cur.refresh || null, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
}

export async function mailFinish({ code, state }) {
  const p = oauthPending.get(String(state || ""));
  if (!p) throw fail(400, "This sign-in link is stale or was not started here. Start again from the Subscriptions page.", { code: "state" });
  if (HOSTED && p.user !== userId()) throw fail(403, "This sign-in belongs to another account.");
  oauthPending.delete(state);
  if (!code) throw fail(400, "No code came back from the sign-in.");
  const tok = await tokenRequest(p.src, { grant_type: "authorization_code", code: String(code), redirect_uri: p.redirectUri, code_verifier: p.verifier });
  if (tok.scope && /mail\.(readwrite|send)|gmail\.(modify|send|compose|insert)|https:\/\/mail\.google\.com\/(\s|$)/i.test(tok.scope)) {
    throw fail(400, "The sign-in granted more than read-only mail access. Nothing was saved; check the OAuth client's scopes.");
  }
  if (p.src === "outlook") {
    const { assertServiceSlots } = await import("./service-limit.js");
    await assertServiceSlots(["outlook"]);
  }
  if (p.accountId) {
    const a = activeExtra(p.src, p.accountId);
    if (!a) throw fail(404, "That mail account is not in the list. Nothing was saved.");
    await setSecret(a.vaultId, { key: "oauth", access: tok.access_token, refresh: tok.refresh_token || null, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
    markAccount(a.id, { scopes: [...MAIL[p.src].scopes], connectedAt: Date.now(), needsSignIn: false });
    emit("log", { text: `${MAIL[p.src].name} account "${a.label}" connected read-only for receipt scanning. Its token is in the vault.` });
    return { ok: true, source: p.src, accountId: a.id };
  }
  await storeTokens(p.src, tok);
  const d = mailDoc(); d[p.src] = { ...d[p.src], connectedAt: Date.now(), needsSignIn: false }; saveMail(d);
  emit("log", { text: `${MAIL[p.src].name} connected read-only for receipt scanning; its token is in the vault.` });
  return { ok: true, source: p.src };
}

export async function mailDisconnect(src) {
  srcOk(src);
  const cur = mailSecret(src);
  await setSecret(mailSecretId(src), cur?.clientSecret ? { key: "oauth", clientSecret: cur.clientSecret } : null);
  const d = mailDoc(); d[src] = { clientId: d[src].clientId || null }; saveMail(d);
  return mailView();
}

async function extraAccess(src, extra) {
  const s = getSecret(extra.vaultId) || null;
  if (!s?.access) throw fail(400, `${MAIL[src].name} account "${extra.label}" is not connected. Connect it first.`, { code: "not_connected" });
  if (s.expiresAt && s.expiresAt - Date.now() < 60000) {
    if (!s.refresh) { markAccount(extra.id, { needsSignIn: true }); throw fail(409, `${MAIL[src].name} sign-in for "${extra.label}" expired. Connect it again.`, { code: "sign_in" }); }
    try {
      const tok = await tokenRequest(src, { grant_type: "refresh_token", refresh_token: s.refresh });
      await setSecret(extra.vaultId, { key: "oauth", access: tok.access_token, refresh: tok.refresh_token || s.refresh, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
      return tok.access_token;
    } catch (e) { if (e.network) throw e; markAccount(extra.id, { needsSignIn: true }); throw fail(409, `${MAIL[src].name} sign-in for "${extra.label}" expired (${e.message}). Connect it again.`, { code: "sign_in" }); }
  }
  return s.access;
}
async function accessToken(src, accountId) {
  const extra = activeExtra(src, accountId);
  if (extra) return extraAccess(src, extra);
  const s = mailSecret(src);
  if (!s?.access) throw fail(400, `${MAIL[src].name} is not connected. Connect it first.`, { code: "not_connected" });
  if (s.expiresAt && s.expiresAt - Date.now() < 60000) {
    if (!s.refresh) { markSignIn(src); throw fail(409, `${MAIL[src].name} sign-in expired. Connect it again.`, { code: "sign_in" }); }
    try { const tok = await tokenRequest(src, { grant_type: "refresh_token", refresh_token: s.refresh }); await storeTokens(src, tok); return tok.access_token; }
    catch (e) { if (e.network) throw e; markSignIn(src); throw fail(409, `${MAIL[src].name} sign-in expired (${e.message}). Connect it again.`, { code: "sign_in" }); }
  }
  return s.access;
}
function markSignIn(src) { const d = mailDoc(); d[src].needsSignIn = true; saveMail(d); }

// Mail APIs are only ever read with GET. "Sign in again" is a 409, never a 401: a 401 would sign the person out of a hosted hub.
async function mailGet(src, url, extra = {}, accountId) {
  const token = await accessToken(src, accountId);
  try { return await getJson(url, { authorization: `Bearer ${token}`, accept: "application/json", ...extra }); }
  catch (e) {
    if (e.status === 401) {
      const acct = activeExtra(src, accountId);
      if (acct) markAccount(acct.id, { needsSignIn: true }); else markSignIn(src);
      throw fail(409, `${MAIL[src].name} refused the sign-in (401). Connect it again.`, { code: "sign_in" });
    }
    throw e;
  }
}

const SUBJECT_TERMS = ["receipt", "invoice", "renewal", "renew", "subscription", "payment", "plan", "membership", "billing"];
const decode64 = (s) => Buffer.from(String(s || ""), "base64url").toString("utf8");
function gmailBody(payload) {
  let plain = "", html = "";
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = decode64(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && !html) html = decode64(p.body.data);
    for (const c of p.parts || []) walk(c);
  };
  walk(payload);
  return plain || htmlToText(html);
}
const header = (payload, name) => (payload?.headers || []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
const gmailLink = (id) => `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
const outlookLink = (webLink) => (/^https:\/\/([a-z0-9-]+\.)*(outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com)\//i.test(String(webLink || "")) ? String(webLink) : "https://outlook.office.com/mail/");

async function* gmailMessages({ days, max, accountId }) {
  const base = MAIL.gmail.api();
  const q = `newer_than:${days}d {${SUBJECT_TERMS.map((t) => `subject:${t}`).join(" ")}}`;
  const list = await mailGet("gmail", `${base}/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(max) })}`, {}, accountId);
  for (const m of list.messages || []) {
    yield { id: m.id, load: async () => { const full = await mailGet("gmail", `${base}/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=full`, {}, accountId); return { from: header(full.payload, "From"), subject: header(full.payload, "Subject"), date: header(full.payload, "Date") || (full.internalDate ? new Date(Number(full.internalDate)).toISOString() : ""), text: gmailBody(full.payload) }; }, link: gmailLink(m.id) };
  }
}
async function* outlookMessages({ max, accountId }) {
  const base = MAIL.outlook.api();
  const search = `"${SUBJECT_TERMS.slice(0, 6).join(" OR ")}"`;
  const qs = `$search=${encodeURIComponent(search)}&$top=${max}&$select=id,subject,from,receivedDateTime,body,webLink`;
  const list = await mailGet("outlook", `${base}/v1.0/me/messages?${qs}`, { prefer: 'outlook.body-content-type="text"' }, accountId);
  for (const m of list.value || []) {
    const from = m.from?.emailAddress ? `${m.from.emailAddress.name || ""} <${m.from.emailAddress.address || ""}>` : "";
    yield { id: m.id, load: async () => ({ from, subject: m.subject || "", date: m.receivedDateTime || "", text: m.body?.contentType === "html" ? htmlToText(m.body.content) : String(m.body?.content || "") }), link: outlookLink(m.webLink) };
  }
}
async function* demoMessages() { for (const m of DEMO_RECEIPTS) yield { id: m.id, load: async () => m, link: null }; }

const candidateId = (src, mid) => "c-" + crypto.createHash("sha256").update(`${src}:${mid}`).digest("hex").slice(0, 12);

// Scan one mailbox (or the built-in samples: src "demo"). New candidates wait in `pending` for a confirm or edit.
export async function scanMail(src, { days = 400, max = 50, subs = [], accountId } = {}) {
  if (src !== "demo") srcOk(src);
  days = Math.max(7, Math.min(800, Math.round(Number(days) || 400)));
  max = Math.max(1, Math.min(100, Math.round(Number(max) || 50)));
  const acct = src === "demo" ? null : activeExtra(src, accountId);
  const d = mailDoc();
  const it = src === "gmail" ? gmailMessages({ days, max, accountId }) : src === "outlook" ? outlookMessages({ max, accountId }) : demoMessages();
  let scanned = 0, skipped = 0;
  const found = [], failed = [];
  for await (const m of it) {
    const key = acct ? `${src}:${acct.id}:${m.id}` : `${src}:${m.id}`;
    const cid = candidateId(src, acct ? `${acct.id}:${m.id}` : m.id);
    if (d.seen[key] || d.pending.some((c) => c.id === cid)) { skipped++; continue; }
    scanned++;
    let email;
    try { email = await m.load(); } catch (e) { if (e.code === "sign_in" || e.network) throw e; failed.push({ messageId: m.id, link: m.link, reason: e.message }); continue; }
    const r = parseReceipt(email); // the body lives only in this loop iteration
    if (!r.ok) { failed.push({ messageId: m.id, link: m.link, reason: r.reason }); continue; }
    const match = subs.find((s) => (r.serviceId && s.id === r.serviceId) || (s.vendor && s.vendor === r.vendor));
    const day = (() => { const t = new Date(email.date); return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10); })();
    found.push({
      id: cid, source: src, messageId: m.id, link: m.link, receivedAt: day,
      serviceId: r.serviceId, service: r.service, vendor: r.vendor, provider: r.provider, url: r.url,
      plan: r.plan, price: r.price, currency: r.currency, cycle: r.cycle, monthly: r.monthly, renews: r.renews, renewsEstimated: r.renewsEstimated,
      confidence: r.confidence, low: r.low, fields: Object.fromEntries(Object.entries(r.fields).filter(([, v]) => v).map(([k, v]) => [k, { conf: v.conf, ...(v.estimated ? { estimated: true } : {}) }])),
      matches: match ? { id: match.id, name: match.name } : null, foundAt: Date.now(),
      ...(acct ? { accountId: acct.id, accountLabel: acct.label } : {}),
    });
  }
  d.pending.push(...found);
  if (d.pending.length > 200) d.pending.splice(0, d.pending.length - 200);
  const summary = { at: Date.now(), scanned, skipped, found: found.length, low: found.filter((c) => c.low).length, failed: failed.slice(0, 20) };
  if (src !== "demo" && acct) markAccount(acct.id, { lastScanAt: summary.at, lastScan: summary, needsSignIn: false });
  else if (src !== "demo") d[src] = { ...d[src], lastScanAt: summary.at, lastScan: summary, needsSignIn: false };
  else d.demoScan = summary;
  saveMail(d);
  return { ...summary, candidates: found };
}

const FIELD_CONF = { name: "service", plan: "plan", price: "price", cycle: "cycle", renews: "renews" };
const same = (a, b) => String(a ?? "") === String(b ?? "");
// Confirm a candidate, with the person's edits. Edited fields are labelled "you entered"; the rest "auto-detected: email" with their confidence.
export function confirmCandidate(id, { edits = {}, target } = {}, save = saveSubscription) {
  const d = mailDoc();
  const c = d.pending.find((x) => x.id === id);
  if (!c) throw fail(404, "That suggestion is gone (already confirmed or dismissed).");
  const detected = { name: c.service, plan: c.plan, price: c.price, cycle: c.cycle, renews: c.renews };
  const intoId = target === "new" ? null : target || c.matches?.id || null;
  const row = {}, origin = {}, confidence = {};
  for (const k of Object.keys(detected)) {
    if (edits[k] !== undefined && !same(edits[k], detected[k])) { row[k] = edits[k] === "" ? null : edits[k]; origin[k] = "user"; }
    else if (detected[k] != null && !(k === "name" && intoId)) { row[k] = detected[k]; origin[k] = "email"; confidence[k] = c.fields[FIELD_CONF[k]]?.conf ?? c.confidence; }
  }
  if (edits.remindDays !== undefined && edits.remindDays !== "") { row.remindDays = edits.remindDays; origin.remindDays = "user"; }
  if (!intoId) { const taken = subscriptionView().some((s) => s.id === c.serviceId); row.id = c.serviceId && !taken ? c.serviceId : undefined; row.name ||= c.service; }
  else row.id = intoId;
  if (c.provider) row.provider = c.provider;
  if (c.vendor) row.vendor = c.vendor;
  if (c.currency && c.currency !== "USD") row.currency = c.currency;
  if (c.url && !intoId) row.url = c.url;
  row.source = { kind: "email", mail: c.source, messageId: c.messageId, link: c.link, confidence: c.confidence, at: Date.now() };
  const saved = save(row, { origin, confidence });
  d.pending = d.pending.filter((x) => x.id !== id);
  d.seen[`${c.source}:${c.messageId}`] = "confirmed";
  saveMail(d);
  return saved;
}
export function dismissCandidate(id) {
  const d = mailDoc();
  const c = d.pending.find((x) => x.id === id);
  if (!c) throw fail(404, "That suggestion is gone (already confirmed or dismissed).");
  d.pending = d.pending.filter((x) => x.id !== id);
  d.seen[`${c.source}:${c.messageId}`] = "dismissed";
  saveMail(d);
}

export function mailView() {
  const d = mailDoc();
  const out = { pending: d.pending, demoScan: d.demoScan || null, lowConfidence: LOW_CONFIDENCE };
  for (const src of MAIL_SOURCES) {
    const M = MAIL[src], s = mailSecret(src), row = d[src];
    out[src] = { name: M.name, scopes: [...M.scopes], readOnly: true, clientId: clientIdOf(src), clientIdFromEnv: !row.clientId && !!clientIdOf(src), hasClientSecret: !!s?.clientSecret, connected: !!s?.access, needsSignIn: !!row.needsSignIn, connectedAt: row.connectedAt || null, lastScanAt: row.lastScanAt || null, lastScan: row.lastScan || null, accounts: listAccounts(src), setup: M.setup, consoleUrl: M.consoleUrl };
  }
  return out;
}

// ---------- the page ----------
export function servicesView() {
  const rows = apiRows();
  const subs = subscriptionView();
  const hints = hintsFor(subs, { entries: allEntries(), history: doc(HISTORY_DOC, () => ({})) });
  const reminded = doc("alerts.reminded", () => ({}));
  const sent = Object.entries(reminded).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, ts]) => { const i = k.lastIndexOf(":"); return { id: k.slice(0, i), renews: k.slice(i + 1), at: ts }; });
  return {
    month: monthKey(), apis: rows, subscriptions: subs, totals: totalsOf(rows), hints,
    mail: mailView(), admin: adminView(), liveAt: liveAt() || null, noLive: NO_LIVE,
    reminders: { defaultDays: 3, sent },
  };
}

// Built-in sample emails for demo mode (fake data only): one confident, one partial, one unknown sender.
onRemoveLegacy("gmail", () => mailDisconnect("gmail"));
onRemoveLegacy("outlook", () => mailDisconnect("outlook"));

export const DEMO_RECEIPTS = [
  { id: "demo-suno", from: "Suno <billing@suno.com>", subject: "Your Suno receipt", date: new Date(Date.now() - 10 * DAY).toUTCString(), text: "Thanks for subscribing to Suno.\nPro Plan (monthly)\nTotal charged: $10.00\nYour plan renews on " + new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10) + "." },
  { id: "demo-midjourney", from: "Midjourney <noreply@midjourney.com>", subject: "Midjourney invoice", date: new Date(Date.now() - 3 * DAY).toUTCString(), text: "Standard Plan\nAmount paid $30.00\nBilled monthly." },
  { id: "demo-render", from: "Pixel Render Farm <hello@pixelrender.example>", subject: "Payment received", date: new Date(Date.now() - 5 * DAY).toUTCString(), text: "We received your payment of $12.00. Thank you." },
];
