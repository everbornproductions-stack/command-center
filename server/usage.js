// Anonymous usage counts. The desktop app sends one ping a day: a random install id,
// the version, the operating system, the plan, and feature counts. No prompts, chats,
// emails, files, or licence keys. The Settings switch is off on a new install until the person
// turns it on (Chris, 2026-10-21). An existing install keeps its choice (server/privacy.js).
// The hub stores the ping (service key stays on the server). The owner report is aggregates only.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { isLoopback, localFetch } from "./loopback-fetch.js";
import { METRICS_PRICES, monthlyCents, fromCents } from "./metrics-prices.js";

export const SHARE_LABEL = "Share anonymous usage counts to help improve Meldmind";
export const SHARE_DETAIL = "Once a day, if this is on, Meldmind sends counts only: a random install id, the app version, the operating system, your plan, how many times each feature was used, and anonymous quality signals (provider, task type, thumbs up/down or retry/accept, cost and latency bucket). No prompts, answers, chats, file names, emails, keys, or identifying ids. You can turn this off here.";
export const HUB_PING_URL = "https://hub.meldmind.ai/api/metrics/ping";
export const KIND = "usage";
const FEATURE_NAME = /^[a-z][a-z0-9]{0,23}$/;
const FEATURE_DENY = new Set(["email", "prompt", "content", "file", "files", "key", "name", "text", "message", "secret", "token", "chat"]);
const INSTALL_ID = /^[a-f0-9]{32}$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OS = new Set(["win32", "darwin", "linux", "web", "other"]);
const TIERS = new Set(["free", "pro", "studio", "extreme", "owner"]);
const ALLOWED_PING_KEYS = new Set(["installId", "version", "os", "tier", "day", "features"]);
const PAID_SOURCES = new Set(["stripe", "manual"]);
const REPORT_TIERS = ["free", "pro", "extreme", "owner"];

export function utcDay(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStart(day) {
  const d = new Date(`${day}T00:00:00.000Z`);
  const delta = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - delta);
  return d.toISOString().slice(0, 10);
}

export function pingDestination(env = process.env) {
  const raw = String(env.CC_USAGE_URL ?? "").trim();
  if (/^(off|0|false|none)$/i.test(raw)) return "";
  if (raw) return raw;
  const hub = String(env.CC_HUB_URL || "").trim().replace(/\/$/, "");
  if (hub) return `${hub}/api/metrics/ping`;
  return HUB_PING_URL;
}

export function usageHttpOpen(env = process.env) {
  return env.CC_MODE === "hosted" || env.CC_USAGE_INGEST === "1";
}

export function isUsageHttp(pathname, env = process.env) {
  if (!usageHttpOpen(env)) return false;
  return pathname === "/api/metrics/ping" || pathname === "/api/metrics/report";
}

export function osName({ hosted = false, platform = process.platform } = {}) {
  if (hosted) return "web";
  if (platform === "win32" || platform === "darwin" || platform === "linux") return platform;
  return "other";
}

export function checkIntervalMs(env = process.env) {
  const n = Number(env.CC_USAGE_CHECK_MS);
  if (Number.isFinite(n) && n >= 50) return n;
  return 15 * 60 * 1000;
}

export function firstDelayMs(env = process.env) {
  const wait = checkIntervalMs(env);
  if (env.CC_USAGE_CHECK_MS) return wait;
  return Math.min(wait, 5000);
}

function freshState() {
  return freshUsageDoc(false);
}

export function freshUsageDoc(share = false) {
  return { v: 1, share: !!share, installId: crypto.randomBytes(16).toString("hex"), day: utcDay(), counts: {}, seen: [], lastSentDay: null };
}

export function loadState() {
  const s = doc(KIND, freshState);
  let changed = false;
  if (typeof s.share !== "boolean") { s.share = false; changed = true; }
  if (!INSTALL_ID.test(String(s.installId || ""))) { s.installId = crypto.randomBytes(16).toString("hex"); changed = true; }
  if (!s.counts || typeof s.counts !== "object") { s.counts = {}; changed = true; }
  if (!Array.isArray(s.seen)) { s.seen = []; changed = true; }
  if (changed) putDoc(KIND, s);
  return s;
}

export function publicState(s = loadState()) {
  return { share: s.share === true, label: SHARE_LABEL, detail: SHARE_DETAIL, sentToday: s.lastSentDay === utcDay() };
}

export function setShare(on) {
  const s = loadState();
  s.share = !!on;
  putDoc(KIND, s);
  return publicState(s);
}

export function cleanFeatures(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const keys = Object.keys(input);
  if (keys.length > 40) return out;
  for (const k of keys) {
    if (!FEATURE_NAME.test(k) || FEATURE_DENY.has(k)) continue;
    const n = input[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 100000) continue;
    out[k] = n;
  }
  return out;
}

export function noteUse(feature, id) {
  if (!FEATURE_NAME.test(String(feature || ""))) return;
  const s = loadState();
  if (s.share !== true) return;
  const today = utcDay();
  if (s.day !== today) {
    const yesterday = addDays(today, -1);
    if (s.day === yesterday && s.lastSentDay !== s.day) return;
    s.day = today;
    s.counts = {};
    s.seen = [];
  }
  const key = `${feature}:${String(id || "").slice(0, 80)}`;
  if (id) {
    if (s.seen.includes(key)) { putDoc(KIND, s); return; }
    s.seen.push(key);
    if (s.seen.length > 400) s.seen.splice(0, s.seen.length - 400);
  }
  s.counts[feature] = (s.counts[feature] || 0) + 1;
  putDoc(KIND, s);
}

export function usesFromEvent(ev) {
  const out = [];
  const add = (feature, id) => {
    const name = String(feature || "");
    const key = String(id || "").slice(0, 80);
    if (!FEATURE_NAME.test(name) || !/^[A-Za-z0-9:_-]{1,80}$/.test(key)) return;
    out.push({ feature: name, id: key });
  };
  if (!ev || typeof ev !== "object") return out;
  if (ev.type === "mission.update" && ev.mission && typeof ev.mission === "object") {
    add(ev.mission.kind, ev.mission.id);
    if (ev.mission.searchEngine) add("search", ev.mission.id);
  } else if (ev.type === "council.update" && ev.council && typeof ev.council === "object") {
    add("council", ev.council.id);
    if (ev.council.searchEngine) add("search", ev.council.id);
  } else if (ev.type === "compare.update" && ev.run && typeof ev.run === "object") add("compare", ev.run.id);
  else if (ev.type === "browser.job" && ev.job && typeof ev.job === "object") add("browser", ev.job.id);
  else if (ev.type === "media.job" && ev.job && typeof ev.job === "object") add("media", ev.job.id);
  else if (ev.type === "schedules.run" && ev.run && typeof ev.run === "object") add("schedule", ev.run.id);
  else if (ev.type === "library.update" && ev.action === "created") add("library", ev.id);
  else if (ev.type === "agent.start" && ev.role === "image") add("image", ev.missionId || ev.seq);
  return out;
}

export function validatePing(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  for (const k of Object.keys(body)) if (!ALLOWED_PING_KEYS.has(k)) return { ok: false };
  const installId = String(body.installId || "");
  const version = String(body.version || "");
  const os = String(body.os || "");
  const tier = String(body.tier || "");
  const day = String(body.day || "");
  if (!INSTALL_ID.test(installId)) return { ok: false };
  if (!VERSION_RE.test(version) || version.length > 32) return { ok: false };
  if (!OS.has(os)) return { ok: false };
  if (!TIERS.has(tier)) return { ok: false };
  if (!DAY_RE.test(day)) return { ok: false };
  const today = utcDay(now);
  if (day !== today && day !== addDays(today, -1)) return { ok: false };
  if (!body.features || typeof body.features !== "object" || Array.isArray(body.features)) return { ok: false };
  const features = cleanFeatures(body.features);
  if (Object.keys(features).length !== Object.keys(body.features).length) return { ok: false };
  return { ok: true, value: { installId, version, os, tier, day, features } };
}

export function buildPayload({ installId, version, os, tier, day, features }) {
  return {
    installId: String(installId),
    version: String(version),
    os: String(os),
    tier: TIERS.has(tier) ? tier : "free",
    day: String(day),
    features: cleanFeatures(features),
  };
}

async function restFetch(url, opts, fetchImpl) {
  const fn = fetchImpl || (isLoopback(url) ? localFetch : fetch);
  return fn(url, opts);
}

export async function postPing(url, payload, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await restFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    }, fetchImpl);
    await res.text().catch(() => "");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { sent: true };
  } finally { clearTimeout(t); }
}

export async function sendDuePing({ tier, version, os, destination, fetchImpl, now = new Date() } = {}) {
  const url = destination ?? pingDestination();
  if (!url) return { sent: false, reason: "no_destination" };
  const s = loadState();
  if (s.share !== true) return { sent: false, reason: "off" };
  const today = utcDay(now);
  const yesterday = addDays(today, -1);
  if (s.day && s.day !== today && s.day !== yesterday) {
    s.day = today;
    s.counts = {};
    s.seen = [];
    putDoc(KIND, s);
  } else if (s.day && s.day !== today && s.lastSentDay === s.day) {
    s.day = today;
    s.counts = {};
    s.seen = [];
    putDoc(KIND, s);
  }
  const current = loadState();
  const day = current.day || today;
  if (current.lastSentDay === day) return { sent: false, reason: "already" };
  if (loadState().share !== true) return { sent: false, reason: "off" };
  const payload = buildPayload({
    installId: current.installId,
    version,
    os,
    tier: tier || "free",
    day,
    features: current.counts || {},
  });
  const checked = validatePing(payload, now);
  if (!checked.ok) return { sent: false, reason: "invalid" };
  if (loadState().share !== true) return { sent: false, reason: "off" };
  await postPing(url, checked.value, fetchImpl);
  const saved = loadState();
  saved.lastSentDay = checked.value.day;
  if (saved.day !== today) {
    saved.day = today;
    saved.counts = {};
    saved.seen = [];
  }
  putDoc(KIND, saved);
  return { sent: true };
}

export function secretOk(presented, secret) {
  if (!secret || presented == null || presented === "") return false;
  const a = crypto.createHash("sha256").update(String(presented)).digest();
  const b = crypto.createHash("sha256").update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}

export function presentedSecret(req) {
  const header = String(req.headers["x-cc-metrics-secret"] || "");
  if (header) return header;
  const auth = String(req.headers.authorization || req.headers.Authorization || "");
  const m = auth.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : "";
}

export async function insertUsagePing(ping, env = process.env, fetchImpl) {
  const base = String(env.CC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.CC_SUPABASE_SERVICE_KEY || "";
  if (!base || !key) throw new Error("service key is not configured");
  const res = await restFetch(`${base}/rest/v1/rpc/record_usage_ping`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      p_install_id: ping.installId,
      p_day: ping.day,
      p_version: ping.version,
      p_os: ping.os,
      p_tier: ping.tier,
      p_features: ping.features,
    }),
  }, fetchImpl);
  await res.text().catch(() => "");
  if (!res.ok) throw new Error(`insert HTTP ${res.status}`);
  return { ok: true };
}

async function fetchTable(table, select, env, fetchImpl) {
  const base = String(env.CC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.CC_SUPABASE_SERVICE_KEY || "";
  if (!base || !key) throw new Error("service key is not configured");
  const rows = [];
  const page = 1000;
  for (let offset = 0; offset < 200000; offset += page) {
    const url = `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${page}&offset=${offset}`;
    const res = await restFetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" },
    }, fetchImpl);
    if (!res.ok) throw new Error(`${table} HTTP ${res.status}`);
    const text = await res.text();
    const batch = text ? JSON.parse(text) : [];
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

function moneyText(cents) {
  return fromCents(cents).toFixed(2);
}

export function mrrNote(prices = METRICS_PRICES) {
  const life = Object.values(prices.lifetime).map((n) => `$${Number(n)}`).join(" or ");
  return `Paying users are active Pro or Extreme licences on a monthly or yearly plan whose source is Stripe or manual. The studio tier is the legacy name for Extreme and uses Extreme prices. Promo codes, the owner tier, Free, lifetime founders, and every status other than active are not paying users. Past due licences are counted apart and are not in MRR. A license with no plan is counted as that tier's monthly price. Monthly list prices are Pro $${moneyText(monthlyCents("pro", "monthly", prices))} and Extreme $${moneyText(monthlyCents("extreme", "monthly", prices))}. Yearly list prices are Pro $${prices.pro.yearly} ($${moneyText(monthlyCents("pro", "yearly", prices))} a month) and Extreme $${prices.extreme.yearly} ($${moneyText(monthlyCents("extreme", "yearly", prices))} a month). Lifetime founder licences are ${life}. They add 0 to MRR. Their count and one-time revenue are reported separately. This report does not call Stripe and does not include emails, license keys, or install ids.`;
}

function reportTier(tier, prices = METRICS_PRICES) {
  const name = String(tier || "").toLowerCase();
  return prices.legacyTier[name] || name;
}

function lifetimeAmount(plan, prices) {
  const match = String(plan).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Object.prototype.hasOwnProperty.call(prices.lifetime, amount) ? prices.lifetime[amount] : null;
}

function classifyLicense(row, prices = METRICS_PRICES) {
  const tier = reportTier(row.tier, prices);
  const plan = String(row.plan || "").toLowerCase().trim();
  if (plan.startsWith("lifetime")) {
    const amount = lifetimeAmount(plan, prices);
    return amount == null ? null : { kind: "lifetime", amount };
  }
  let product = tier;
  let cadence = "monthly";
  if (plan) {
    if (plan.startsWith("pro")) product = "pro";
    else if (plan.startsWith("extreme") || plan.startsWith("studio")) product = "extreme";
    else if (plan.startsWith("developer")) product = "developer";
    if (plan.includes("year")) cadence = "yearly";
    else if (plan.includes("month") || plan === "pro" || plan === "extreme" || plan === "studio") cadence = "monthly";
    else return null;
  }
  if (!prices[product]) return null;
  return { kind: "recurring", mrrCents: monthlyCents(product, cadence, prices) };
}

function round4(n) { return Math.round(n * 10000) / 10000; }

function latestByInstall(rows) {
  const map = new Map();
  for (const row of rows) {
    const prev = map.get(row.installId);
    if (!prev || row.day > prev.day) map.set(row.installId, row);
  }
  return map;
}

export function buildReport({ pings = [], licenses = [], asOf = utcDay(), prices = METRICS_PRICES } = {}) {
  const rows = [];
  const seenDay = new Set();
  for (const raw of pings) {
    if (!raw) continue;
    const installId = String(raw.installId || raw.install_id || "");
    const day = String(raw.day || "").slice(0, 10);
    if (!installId || !DAY_RE.test(day) || day > asOf) continue;
    const key = `${installId}:${day}`;
    if (seenDay.has(key)) continue;
    seenDay.add(key);
    rows.push({
      installId,
      day,
      version: String(raw.version || ""),
      os: String(raw.os || ""),
      tier: TIERS.has(raw.tier) ? raw.tier : "free",
      features: cleanFeatures(raw.features),
    });
  }
  const inRange = (from, to) => rows.filter((r) => r.day >= from && r.day <= to);
  const distinct = (list) => new Set(list.map((r) => r.installId)).size;
  const wauFrom = addDays(asOf, -6);
  const mauFrom = addDays(asOf, -29);
  const dauRows = inRange(asOf, asOf);
  const wauRows = inRange(wauFrom, asOf);
  const mauRows = inRange(mauFrom, asOf);

  const first = new Map();
  const weeks = new Map();
  for (const row of rows) {
    const start = weekStart(row.day);
    if (!weeks.has(row.installId)) weeks.set(row.installId, new Set());
    weeks.get(row.installId).add(start);
    const prev = first.get(row.installId);
    if (!prev || row.day < prev) first.set(row.installId, row.day);
  }
  const cohorts = new Map();
  for (const [installId, day] of first) {
    const week = weekStart(day);
    if (!cohorts.has(week)) cohorts.set(week, []);
    cohorts.get(week).push(installId);
  }
  const retention = [...cohorts.keys()].sort().map((week) => {
    const ids = cohorts.get(week);
    const rate = (ahead) => {
      const end = addDays(week, ahead * 7 + 6);
      if (asOf < end) return null;
      const target = addDays(week, ahead * 7);
      const retained = ids.filter((id) => weeks.get(id)?.has(target)).length;
      return { retained, rate: ids.length ? round4(retained / ids.length) : 0 };
    };
    return { week, installs: ids.length, week1: rate(1), week4: rate(4) };
  });

  const latest = latestByInstall(rows);
  const installsByVersion = {};
  const installsByOs = {};
  for (const row of latest.values()) {
    if (row.version) installsByVersion[row.version] = (installsByVersion[row.version] || 0) + 1;
    if (row.os) installsByOs[row.os] = (installsByOs[row.os] || 0) + 1;
  }
  const activeLatest = latestByInstall(wauRows);
  const activeByTier = Object.fromEntries(REPORT_TIERS.map((tier) => [tier, 0]));
  for (const row of activeLatest.values()) {
    const tier = reportTier(row.tier, prices);
    if (activeByTier[tier] != null) activeByTier[tier] += 1;
  }
  const featureTotals = {};
  for (const row of wauRows) {
    for (const [name, n] of Object.entries(row.features)) featureTotals[name] = (featureTotals[name] || 0) + n;
  }
  const topFeatures = Object.entries(featureTotals)
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature))
    .slice(0, 20);

  let payingUsers = 0;
  let pastDue = 0;
  let mrrCents = 0;
  let lifetimeCount = 0;
  let lifetimeCents = 0;
  const lifetimeByPrice = {};
  for (const amount of Object.values(prices.lifetime)) {
    lifetimeByPrice[String(amount)] = { count: 0, revenueUsd: 0 };
  }
  for (const raw of licenses) {
    if (!raw || typeof raw !== "object") continue;
    const status = String(raw.status || "").toLowerCase();
    const source = String(raw.source || "").toLowerCase();
    if (!PAID_SOURCES.has(source)) continue;
    const seat = classifyLicense(raw, prices);
    if (!seat) continue;
    if (status === "past_due" && seat.kind === "recurring") pastDue += 1;
    if (status !== "active") continue;
    if (seat.kind === "lifetime") {
      lifetimeCount += 1;
      lifetimeCents += Math.round(Number(seat.amount) * 100);
      const bucket = lifetimeByPrice[String(seat.amount)];
      if (bucket) {
        bucket.count += 1;
        bucket.revenueUsd = fromCents(Math.round(bucket.count * Number(seat.amount) * 100));
      }
      continue;
    }
    payingUsers += 1;
    mrrCents += seat.mrrCents;
  }

  return {
    asOf,
    windows: {
      dau: asOf,
      wau: { from: wauFrom, to: asOf, days: 7 },
      mau: { from: mauFrom, to: asOf, days: 30 },
    },
    dau: distinct(dauRows),
    wau: distinct(wauRows),
    mau: distinct(mauRows),
    retention,
    installsByVersion,
    installsByOs,
    activeByTier,
    activeByTierWindow: "wau",
    topFeatures,
    topFeaturesWindow: "wau",
    payingUsers,
    pastDue,
    mrrUsd: fromCents(mrrCents),
    lifetimeCount,
    lifetimeRevenueUsd: fromCents(lifetimeCents),
    lifetimeByPrice,
    mrrNote: mrrNote(prices),
  };
}

export async function fetchReport({ asOf = utcDay(), env = process.env, fetchImpl } = {}) {
  const pings = await fetchTable("usage_pings", "install_id,day,version,os,tier,features", env, fetchImpl);
  const licenses = await fetchTable("licenses", "tier,status,source,plan", env, fetchImpl);
  return buildReport({
    pings: pings.map((row) => ({
      installId: row.install_id,
      day: row.day,
      version: row.version,
      os: row.os,
      tier: row.tier,
      features: row.features || {},
    })),
    licenses,
    asOf,
  });
}

// Where the anonymous quality signals go: next to the daily ping on the same hub, or the same mock in tests.
export function signalsDestination(env = process.env) {
  const ping = pingDestination(env);
  if (!ping) return "";
  return /\/ping\/?$/.test(ping) ? ping.replace(/\/ping\/?$/, "/signals") : `${ping.replace(/\/$/, "")}/signals`;
}

// Once a day, only while the person has the track-record switch on (brain settings shareOptIn === true).
// The payload is rebuilt and checked against the allowed keys right before it leaves. Nothing sends on a failed check.
export async function sendDueSignals({ consent, buildPayload: build, validate, version, destination, fetchImpl, now = new Date() } = {}) {
  const url = destination ?? signalsDestination();
  if (!url) return { sent: false, reason: "no_destination" };
  if (consent() !== true) return { sent: false, reason: "off" };
  const s = loadState();
  const today = utcDay(now);
  if (s.signalsDay === today) return { sent: false, reason: "already" };
  const payload = build({ installId: s.installId, version });
  if (!payload.signals.length) return { sent: false, reason: "nothing_yet" };
  const checked = validate(payload);
  if (!checked.ok) return { sent: false, reason: "invalid" };
  if (consent() !== true) return { sent: false, reason: "off" };
  await postPing(url, payload, fetchImpl);
  const saved = loadState();
  saved.signalsDay = today;
  putDoc(KIND, saved);
  return { sent: true, count: payload.signals.length };
}

export function startUsageLoop(run, env = process.env) {
  const wait = checkIntervalMs(env);
  let busy = false;
  // a slow send never overlaps the next tick, so one day never sends twice
  const tick = () => {
    if (busy) return;
    busy = true;
    Promise.resolve().then(run).catch((e) => console.error(`[usage] ${e.message || e}`)).finally(() => { busy = false; });
  };
  const first = setTimeout(tick, firstDelayMs(env));
  first.unref?.();
  const timer = setInterval(tick, wait);
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

export async function handleUsageHttp(req, res, url, json, readBody, env = process.env) {
  if (!usageHttpOpen(env)) return json(res, 404, { error: "not found" });
  if (req.method === "POST" && url.pathname === "/api/metrics/ping") {
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return json(res, 415, { error: "content-type must be application/json" });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "usage ping refused" }); }
    const ping = validatePing(body);
    if (!ping.ok) return json(res, 400, { error: "usage ping refused" });
    try {
      await insertUsagePing(ping.value, env);
      return json(res, 200, { ok: true });
    } catch (e) {
      console.error(`[usage] insert failed: ${e.message || e}`);
      return json(res, 502, { error: "usage ping could not be stored" });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/metrics/report") {
    const secret = env.CC_METRICS_SECRET || "";
    if (!secret) return json(res, 404, { error: "not found" });
    if (!secretOk(presentedSecret(req), secret)) return json(res, 401, { error: "admin secret required" });
    const asOf = url.searchParams.get("asOf") || utcDay();
    if (!DAY_RE.test(asOf)) return json(res, 400, { error: "asOf must be YYYY-MM-DD" });
    try { return json(res, 200, await fetchReport({ asOf, env })); }
    catch (e) {
      console.error(`[usage] report failed: ${e.message || e}`);
      return json(res, 502, { error: "report could not be read" });
    }
  }
  return json(res, 405, { error: "method not allowed" });
}
