// Licence check against the Supabase project (see supabase/schema.sql).
// Local mode, no cloud configured → developer/owner build, everything unlocked.
// Local mode, cloud configured, no valid key → Free tier limits apply (see TIERS).
// Hosted mode → the tier is the licence on the signed-in user's email (or owner for CC_OWNER_EMAILS).
import crypto from "node:crypto";
import { HOSTED, ctx, doc, putDoc, allContexts, runAs } from "./store.js";
import { CFG, rest } from "./hosted.js";
import { VERSION } from "./update.js";
import { emit } from "./events.js";

export const TIERS = {
  free:   { missions: false, scheduler: false, councilsPerMonth: 3, projects: 1, subscriptionsTab: false, label: "Free" },
  pro:    { missions: true, scheduler: true, councilsPerMonth: Infinity, projects: Infinity, subscriptionsTab: true, label: "Pro" },
  studio: { missions: true, scheduler: true, councilsPerMonth: Infinity, projects: Infinity, subscriptionsTab: true, label: "Studio" },
  owner:  { missions: true, scheduler: true, councilsPerMonth: Infinity, projects: Infinity, subscriptionsTab: true, label: "Owner" },
};

const lic = () => doc("license", () => ({ key: null, deviceId: crypto.randomBytes(8).toString("hex"), tier: null, status: null, email: null, checkedAt: 0, message: null }));
const saveLic = (patch) => putDoc("license", { ...lic(), ...patch });

const cloud = () => HOSTED ? { url: CFG.url, anonKey: CFG.anonKey } : (doc("settings")?.cloud || { url: process.env.CC_SUPABASE_URL, anonKey: process.env.CC_SUPABASE_ANON_KEY });
export const cloudConfigured = () => { const c = cloud(); return !!(c?.url && c?.anonKey); };
const isOwnerEmail = () => HOSTED && !!ctx().email && CFG.ownerEmails.includes(ctx().email);

export function licenseState() {
  const configured = cloudConfigured();
  const l = lic();
  const tier = !configured ? "owner" : isOwnerEmail() ? "owner" : l.tier && l.status === "active" ? l.tier : "free";
  return { configured, tier, limits: { ...TIERS[tier], councilsPerMonth: TIERS[tier].councilsPerMonth === Infinity ? null : TIERS[tier].councilsPerMonth }, key: l.key ? l.key.replace(/^(.{3}).*(.{4})$/, "$1-••••-••••-$2") : null, email: l.email || ctx().email || null, status: l.status, checkedAt: l.checkedAt, message: isOwnerEmail() ? "Owner account" : l.message, deviceId: l.deviceId };
}

async function rpc(fn, body) {
  if (HOSTED) return rest(`rpc/${fn}`, { method: "POST", body, token: ctx().token }).then((j) => (Array.isArray(j) ? j[0] : j));
  const c = cloud();
  // legacy anon keys are JWTs and go in both headers; new publishable keys (sb_publishable_…) go in apikey only
  const headers = { apikey: c.anonKey, "content-type": "application/json" };
  if (c.anonKey.startsWith("eyJ")) headers.authorization = `Bearer ${c.anonKey}`;
  const r = await fetch(`${c.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
  return Array.isArray(j) ? j[0] : j;
}

export async function activate(key) {
  if (!cloudConfigured()) throw new Error("No cloud configured (Settings → Cloud).");
  const l = lic();
  const r = await rpc("verify_license", { p_key: key, p_device_id: l.deviceId, p_name: HOSTED ? "hub" : process.env.COMPUTERNAME || "PC", p_platform: HOSTED ? "web" : process.platform, p_version: VERSION });
  saveLic({ key: r.ok ? key.toUpperCase().trim() : l.key, tier: r.ok ? r.tier : null, status: r.status, email: r.email, checkedAt: Date.now(), message: r.message });
  emit("log", { text: r.ok ? `Licence active: ${r.tier} (${r.email})` : `Licence problem: ${r.message}`, level: r.ok ? undefined : "error" });
  return licenseState();
}

export async function redeem(code, email) {
  if (!cloudConfigured()) throw new Error("No cloud configured (Settings → Cloud).");
  const r = await rpc("redeem_promo", { p_code: code, p_email: HOSTED ? ctx().email : email });
  if (!r?.key) throw new Error(r?.message || "Could not redeem");
  return activate(r.key);
}

// Hosted: find the licence that belongs to the signed-in email (RLS lets a user read only that row).
export async function loadHostedLicense() {
  const email = ctx().email;
  if (!HOSTED || !email) return licenseState();
  try {
    const rows = await rest(`licenses?select=key,tier,status,email,current_period_end&email=ilike.${encodeURIComponent(email)}&order=created_at.desc&limit=5`, { token: ctx().token });
    const best = (rows || []).find((r) => r.status === "active") || rows?.[0];
    if (best) saveLic({ key: best.key, tier: best.tier, status: best.status, email: best.email, checkedAt: Date.now(), message: best.status === "active" ? "ok" : `Licence is ${best.status}` });
    else if (lic().tier) saveLic({ tier: null, status: null, checkedAt: Date.now(), message: "No licence on this email" });
  } catch (e) { saveLic({ message: e.message, checkedAt: Date.now() }); }
  return licenseState();
}

export async function recheck() {
  if (!cloudConfigured()) return licenseState();
  if (HOSTED && !lic().key) return loadHostedLicense();
  if (!lic().key) return licenseState();
  try { return await activate(lic().key); } catch (e) { saveLic({ message: e.message }); return licenseState(); }
}

export function startLicenseLoop() {
  const tick = () => { for (const c of allContexts()) runAs(c, () => recheck().catch(() => {})); };
  tick();
  setInterval(tick, 12 * 3600 * 1000).unref();
}

// Gate helper: throws a friendly error when the tier does not allow a feature.
export function requireFeature(feature) {
  const s = licenseState();
  if (!s.limits[feature]) throw Object.assign(new Error(`${feature === "missions" ? "Mission mode" : feature === "scheduler" ? "The off-peak scheduler" : "This feature"} is part of Pro ($15.99/month). Add a licence key in Settings.`), { status: 402 });
}
