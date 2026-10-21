// Licence check against the Supabase project (see supabase/schema.sql).
// The tier is Free unless an active licence says otherwise:
//   - no licence server configured, or not reachable past the grace period → free (never owner)
//   - owner comes only from an active owner licence row (EVERBORN-OWNER promo / owner key),
//     CC_OWNER_EMAILS in hosted mode, or CC_DEV_OWNER=1 in an unpackaged developer run
// Where the licence server address comes from (local mode): Settings → Cloud if both fields are
// filled in, else the shipped server/cloud-defaults.json, else CC_SUPABASE_URL / CC_SUPABASE_ANON_KEY.
// Hosted mode always uses the environment.
import crypto from "node:crypto";
import path from "node:path";
import { ROOT, readJson } from "./paths.js";
import { HOSTED, ctx, doc, putDoc, allContexts, runAs } from "./store.js";
import { CFG, rest } from "./hosted.js";
import { VERSION } from "./update.js";
import { emit } from "./events.js";
import { bindLicenseState, compareRows, evaluateGate, LIMITS } from "./feature-gate.js";
import { GRANDFATHER_PLAN_ID, GRANDFATHER_PRO_MONTHLY, LIFETIME_PLAN_ID, moneyPlain } from "./price-config.js";

// One table. Studio is Pro. Owner is Extreme. See server/feature-gate.js.
export const TIERS = LIMITS;

// Offline grace: keep the last known good tier until current_period_end or this long after the
// last successful check, whichever is sooner. After that the copy drops to Free.
export const GRACE_MS = 7 * 24 * 3600 * 1000;
// The Electron shell sets CC_PACKAGED=1 for installed builds (electron/main.cjs).
export const PACKAGED = process.env.CC_PACKAGED === "1";
const DEFAULTS_FILE = process.env.CC_CLOUD_DEFAULTS_FILE || path.join(ROOT, "server", "cloud-defaults.json");

const lic = () => doc("license", () => ({ key: null, deviceId: crypto.randomBytes(8).toString("hex"), tier: null, status: null, email: null, checkedAt: 0, lastOkAt: 0, lastError: null, periodEnd: null, message: null }));
const saveLic = (patch) => putDoc("license", { ...lic(), ...patch });

const trim = (v) => String(v ?? "").trim();
const complete = (c) => !!(c && trim(c.url) && trim(c.anonKey));
const sameUrl = (a, b) => trim(a).replace(/\/$/, "").toLowerCase() === trim(b).replace(/\/$/, "").toLowerCase();

// The non-secret licence server shipped with the app (publishable key only; never the service key).
export function shippedCloud() {
  const d = readJson(DEFAULTS_FILE, {}) || {};
  return { url: trim(d.url), anonKey: trim(d.anonKey) };
}

export function cloud() {
  if (HOSTED) return { url: CFG.url, anonKey: CFG.anonKey, source: "env" };
  const s = doc("settings")?.cloud;
  if (complete(s)) return { url: trim(s.url), anonKey: trim(s.anonKey), source: "settings" };
  const d = shippedCloud();
  if (complete(d)) return { ...d, source: "shipped" };
  const e = { url: trim(process.env.CC_SUPABASE_URL), anonKey: trim(process.env.CC_SUPABASE_ANON_KEY) };
  if (complete(e)) return { ...e, source: "env" };
  return { url: "", anonKey: "", source: null };
}
export const cloudConfigured = () => complete(cloud());
const isOwnerEmail = () => HOSTED && !!ctx().email && CFG.ownerEmails.includes(ctx().email);

// Developer override: only with an explicit env var, and never in a packaged build.
export function devOwnerAllowed(env = process.env, packaged = PACKAGED) {
  return !packaged && env.CC_DEV_OWNER === "1";
}

// Pure tier resolution (unit-tested in test/license.test.js). Never returns owner on an error path.
export function resolveTier({ lic: l, now = Date.now(), ownerEmail = false, devOwner = false } = {}) {
  if (ownerEmail) return { tier: "owner", reason: "owner_email" };
  if (devOwner) return { tier: "owner", reason: "dev_override" };
  if (l?.tier && TIERS[l.tier] && l.status === "active") {
    const lastOk = Number(l.lastOkAt || l.checkedAt || 0);
    let graceUntil = lastOk + GRACE_MS;
    // offline: the paid period is the other bound (a successful check is authoritative on its own)
    if (l.lastError && l.periodEnd) { const pe = new Date(l.periodEnd).getTime(); if (!Number.isNaN(pe)) graceUntil = Math.min(graceUntil, pe); }
    if (now <= graceUntil) return applyLifetime(l, { tier: l.tier, reason: l.lastError ? "grace" : "active", graceUntil });
    return { tier: "free", reason: "grace_expired", graceUntil };
  }
  return { tier: "free", reason: l?.status ? `licence_${l.status}` : "no_licence" };
}

// A lifetime founder licence is Pro for life, including when the row was tagged Extreme by mistake.
function applyLifetime(l, result) {
  if (!result || result.tier === "free" || result.tier === "owner") return result;
  if (l?.plan !== LIFETIME_PLAN_ID) return result;
  if (result.tier !== "pro" && result.tier !== "extreme") return result;
  return { ...result, tier: "pro", lifetime: true };
}

// Free trial (Phase 9, server/growth.js, behind CC_TRIAL): asked only when the licence says Free.
// Returns { tier: "pro", reason: "trial", trialEndsAt, daysLeft } or null; never owner.
let trialResolver = null;
export const setTrialResolver = (fn) => { trialResolver = typeof fn === "function" ? fn : null; };
function withTrial(r) {
  if (r.tier !== "free" || !trialResolver) return r;
  const t = trialResolver();
  return t?.tier === "pro" ? { tier: "pro", reason: "trial", trialEndsAt: t.trialEndsAt, daysLeft: t.daysLeft } : r;
}

export function licenseState() {
  const c = cloud();
  const configured = complete(c);
  const l = lic();
  const r = withTrial(resolveTier({ lic: l, ownerEmail: isOwnerEmail(), devOwner: devOwnerAllowed() }));
  const T = TIERS[r.tier];
  let message = l.message;
  if (r.reason === "owner_email") message = "Owner account";
  else if (r.reason === "dev_override") message = "Developer override (CC_DEV_OWNER=1, unpackaged run)";
  else if (r.reason === "trial") message = `Free trial: Pro for ${r.daysLeft} more day${r.daysLeft === 1 ? "" : "s"}. Nothing is charged.`;
  else if (!configured) message = "No licence server configured: this copy runs on the Free tier.";
  else if (r.lifetime && r.reason === "active") message = "Lifetime founder: Pro for life.";
  else if (l.plan === GRANDFATHER_PLAN_ID && r.tier === "pro" && r.reason === "active") message = `Pro, grandfathered at $${moneyPlain(GRANDFATHER_PRO_MONTHLY)}/month. That price stays.`;
  else if (r.reason === "grace") message = `Licence server unreachable (${l.lastError}); keeping ${T.label} until ${new Date(r.graceUntil).toLocaleString()}.`;
  else if (r.reason === "grace_expired") message = `Licence could not be re-checked for ${Math.round(GRACE_MS / 86400000)} days (${l.lastError || "offline"}); back on Free until a check succeeds.`;
  return {
    configured, cloudSource: c.source, cloudUrl: c.url || null,
    tier: r.tier, reason: r.reason,
    limits: {
      ...T,
      councilsPerMonth: T.councilsPerMonth === Infinity ? null : T.councilsPerMonth,
      projects: T.projects === Infinity ? null : T.projects,
      connectedServices: T.connectedServices === Infinity ? null : T.connectedServices,
    },
    key: l.key ? l.key.replace(/^(.{3}).*(.{4})$/, "$1-••••-••••-$2") : null,
    email: l.email || ctx().email || null, status: l.status, checkedAt: l.checkedAt, lastOkAt: l.lastOkAt || null, graceUntil: r.graceUntil || null,
    message, deviceId: l.deviceId, trialEndsAt: r.trialEndsAt || null,
    compare: compareRows(),
    plan: l.plan || null,
    grandfathered: l.plan === GRANDFATHER_PLAN_ID && r.tier === "pro",
    lifetime: !!r.lifetime,
  };
}

// Growth (Phase 9) asks the same licence server about referrals.
export const licenceRpc = (fn, body) => rpc(fn, body);

async function rpc(fn, body) {
  if (HOSTED) return rest(`rpc/${fn}`, { method: "POST", body, token: ctx().token }).then((j) => (Array.isArray(j) ? j[0] : j));
  const c = cloud();
  // legacy anon keys are JWTs and go in both headers; new publishable keys (sb_publishable_…) go in apikey only
  const headers = { apikey: c.anonKey, "content-type": "application/json" };
  if (c.anonKey.startsWith("eyJ")) headers.authorization = `Bearer ${c.anonKey}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`${c.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
    return Array.isArray(j) ? j[0] : j;
  } finally { clearTimeout(t); }
}

export async function activate(key) {
  if (!cloudConfigured()) throw new Error("No licence server configured (Settings → Cloud).");
  const l = lic();
  const k = trim(key).toUpperCase();
  if (!k) throw new Error("Licence key required.");
  const r = await rpc("verify_license", { p_key: k, p_device_id: l.deviceId, p_name: HOSTED ? "hub" : process.env.COMPUTERNAME || "PC", p_platform: HOSTED ? "web" : process.platform, p_version: VERSION });
  const now = Date.now();
  if (r?.ok) {
    const patch = { key: k, tier: r.tier, status: r.status, email: r.email, periodEnd: r.period_end || null, checkedAt: now, lastOkAt: now, lastError: null, message: r.message || "ok" };
    if (Object.prototype.hasOwnProperty.call(r, "plan")) patch.plan = r.plan || null;
    saveLic(patch);
    emit("log", { text: `Licence active: ${r.tier} (${r.email})` });
    try {
      const { queueWelcome } = await import("./welcome-mail.js");
      const source = String(r.tier || "").toLowerCase() === "pro" ? "pro-purchase" : "license";
      await queueWelcome({ email: r.email, firstName: r.first_name || r.name || "", source });
    } catch (e) {
      emit("log", { text: `Welcome email was not sent: ${e.message}`, level: "error" });
    }
    return licenseState();
  }
  // a different key that fails leaves the stored licence alone; the stored key failing means it really is not active
  if (l.key && k !== l.key) throw new Error(r?.message || "Licence key not accepted");
  saveLic({ key: l.key || k, tier: null, status: r?.status || "unknown", email: r?.email || l.email, periodEnd: r?.period_end || null, checkedAt: now, lastOkAt: now, lastError: null, message: r?.message || "Licence not active" });
  emit("log", { text: `Licence problem: ${r?.message || "not active"}`, level: "error" });
  return licenseState();
}

export async function redeem(code, email) {
  if (!cloudConfigured()) throw new Error("No licence server configured (Settings → Cloud).");
  const r = await rpc("redeem_promo", { p_code: code, p_email: HOSTED ? ctx().email : email });
  if (!r?.key) throw new Error(r?.message || "Could not redeem");
  return activate(r.key);
}

// Hosted: find the licence that belongs to the signed-in email (RLS lets a user read only that row).
export async function loadHostedLicense() {
  const email = ctx().email;
  if (!HOSTED || !email) return licenseState();
  const now = Date.now();
  try {
    const rows = await rest(`licenses?select=key,tier,status,email,current_period_end&email=ilike.${encodeURIComponent(email)}&order=created_at.desc&limit=5`, { token: ctx().token });
    const best = (rows || []).find((r) => r.status === "active") || rows?.[0];
    if (best) saveLic({ key: best.key, tier: best.tier, status: best.status, email: best.email, periodEnd: best.current_period_end || null, checkedAt: now, lastOkAt: now, lastError: null, message: best.status === "active" ? "ok" : `Licence is ${best.status}` });
    else saveLic({ tier: null, status: null, checkedAt: now, lastOkAt: now, lastError: null, message: "No licence on this email" });
  } catch (e) { saveLic({ lastError: e.message, checkedAt: now }); }
  return licenseState();
}

export async function recheck() {
  if (!cloudConfigured()) return licenseState();
  if (HOSTED && !lic().key) return loadHostedLicense();
  if (!lic().key) return licenseState();
  try { return await activate(lic().key); }
  catch (e) { saveLic({ lastError: e.message, checkedAt: Date.now() }); return licenseState(); }
}

export function startLicenseLoop() {
  const tick = () => { for (const c of allContexts()) runAs(c, () => recheck().catch(() => {})); };
  tick();
  setInterval(tick, 12 * 3600 * 1000).unref();
}

// Validate a Settings → Cloud change (local mode). Returns the normalised values and whether the
// project changed. Empty values are refused; a packaged build cannot point at a different project.
export function validateCloudChange({ url, anonKey }) {
  url = trim(url); anonKey = trim(anonKey);
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!url || !anonKey) throw bad("Both the project URL and the publishable key are required.");
  if (!/^https?:\/\/[^\s/]+(\/.*)?$/.test(url)) throw bad("The project URL must be an http(s) address.");
  const shipped = shippedCloud();
  if (PACKAGED && complete(shipped) && !sameUrl(url, shipped.url)) throw bad("This build checks licences against its own licence server; the project cannot be changed.");
  const current = cloud();
  return { url: url.replace(/\/$/, ""), anonKey, changed: !sameUrl(url, current.url) || anonKey !== current.anonKey };
}
// After the project changed, forget the verified tier so a switch can never raise it; the key is
// kept and re-verified against the new project on the next check.
export function resetVerifiedTier(reason = "cloud settings changed") {
  saveLic({ tier: null, status: null, lastOkAt: 0, lastError: null, periodEnd: null, checkedAt: Date.now(), message: `Re-check needed (${reason}).` });
}

// ---------- tier gates (one place; routes and plugin helpers both go through guard) ----------

// Councils are counted per UTC calendar month from the mission store (kind === "council"),
// plus the councils of this user that are still running (they are only written when they finish).
export const monthStartUtc = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
export function councilsThisMonth(now = Date.now()) {
  const since = monthStartUtc(now);
  const c = ctx();
  const stored = c.store.listMissions((m) => ({ kind: m.kind, startedAt: m.startedAt })).filter((m) => m && m.kind === "council" && Number(m.startedAt) >= since).length;
  return stored + (c.councilsInFlight || 0);
}
export const subscriptionsLocked = () => !TIERS[licenseState().tier].subscriptionsTab;

// Throws a 402 with the Pro message when the current user's tier does not allow `feature`.
//   guard("missions") | guard("scheduler") | guard("subscriptions") | guard("council") | guard("projects", { count })
//   guard("connectedService", { count }) | guard("emailAccounts", { count })
//   guard("phone") | guard("historySearch") | guard("sharedLearning") | guard("scores")
//   guard("desktop") | guard("appScan") | guard("backgroundRuns") | guard("missionPause") | guard("learnedFromRatings")
// desktop is desktop control (including Antigravity). appScan is the program scan and its suggestions.
// missions is already Pro. These ids are the feature-gate names. isProFeature reads the same table.
export function isProFeature(feature) {
  return !!TIERS[licenseState().tier]?.[feature];
}
export function guard(feature, info = {}) {
  const s = licenseState();
  const T = TIERS[s.tier] || TIERS.free;
  const spec = { ...info };
  delete spec.env;
  if ((feature === "council" || feature === "councilsPerMonth") && spec.used == null && spec.count == null) spec.used = councilsThisMonth();
  const result = evaluateGate(T, feature, spec);
  if (!result.ok) {
    const err = new Error(result.message);
    err.status = 402;
    err.code = result.code;
    err.built = result.built;
    throw err;
  }
  return s;
}
bindLicenseState(licenseState);
// Older name, kept for plugins.
export const requireFeature = (feature) => guard(feature);
