// Growth (Phase 9): free trial with credits, the "No keys needed" managed plan, and referral rewards.
//
// Everything here is behind a feature flag and OFF unless the host turns it on:
//   CC_TRIAL=1       free trial: Pro features for a while plus trial credits, a counter and an upgrade prompt
//   CC_MANAGED=1     managed plan: calls go through an Everborn-managed key pool, metered per user
//   CC_REFERRALS=1   referral codes and links, a credit ledger and a rewards view
// Every price and amount below is a PLACEHOLDER. Chris decides real pricing. Nothing here charges money,
// talks to Square or any payment service, or sends anything on its own.
//
// The key pool lives only in the host's environment (its secret store), never in a file, the vault or git:
//   CC_MANAGED_POOL='[{"provider":"openai","keyEnv":"CC_POOL_OPENAI"}]'   which providers, and the env var
//   CC_POOL_OPENAI='key-1,key-2'                                           holding that provider's keys
// A pool key is used only for a person who turned the managed plan on, has no key of their own (or of the
// active workspace) for that provider, and still has an allowance. It is never sent to the page, shown
// masked, logged or written to disk; the ledger line says "managed" instead.
import crypto from "node:crypto";
import { ctx, doc, putDoc, HOSTED } from "./store.js";
import { PROVIDERS } from "./registry.js";
import { setManagedResolver, getOwnSecret } from "./vault.js";
import { licenseState, setTrialResolver, cloudConfigured, licenceRpc } from "./license.js";
import { emit } from "./events.js";

// ---------- placeholders (Chris decides real numbers) ----------
export const PLACEHOLDER = Object.freeze({
  placeholder: true,
  trialDays: 14,
  trialCreditsUsd: 5,
  referralFriendUsd: 5,
  referralRewardUsd: 5,
  managedMarkupPct: 10,
  managedMonthlyCapUsd: 25,
  note: "All amounts are placeholders. Nothing is charged.",
});
export const HOMEPAGE = "https://everbornproductions.com/command-center/";

export const flags = () => ({
  trial: process.env.CC_TRIAL === "1",
  managed: process.env.CC_MANAGED === "1",
  referrals: process.env.CC_REFERRALS === "1",
});

const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const off = (what) => err(404, `${what} is turned off on this install.`, "flag_off");
const round = (n, d = 6) => +Number(n || 0).toFixed(d);
const DAY = 86400000;
const monthKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const deviceId = () => doc("license")?.deviceId || null;

// ---------- credit ledger ----------
// lines: { ts, kind: trial | referral-welcome | referral-reward | managed-usage, amount (USD, + or -), note, day? }
const creditsDoc = () => { const d = doc("growth.credits", () => ({ lines: [] })); d.lines ||= []; return d; };
const saveCredits = (d) => putDoc("growth.credits", d);
export function creditBalance() { return round(creditsDoc().lines.reduce((a, l) => a + (Number(l.amount) || 0), 0)); }
function addCredit(kind, amount, note, extra = {}) {
  const d = creditsDoc();
  d.lines.push({ ts: Date.now(), kind, amount: round(amount), note, ...extra });
  saveCredits(d);
  emit("growth.update", {});
}

// ---------- free trial ----------
const trialDoc = () => doc("growth.trial", () => undefined) || null;
export function trialStatus(now = Date.now()) {
  const t = trialDoc();
  if (!t?.startedAt) return { started: false, active: false };
  const endsAt = Number(t.endsAt) || 0;
  const active = now < endsAt;
  return { started: true, active, startedAt: t.startedAt, endsAt, daysLeft: active ? Math.ceil((endsAt - now) / DAY) : 0 };
}

// licence.js asks this when the licence says Free: an active trial gives the Pro limits, never owner
setTrialResolver(() => {
  if (!flags().trial) return null;
  const t = trialStatus();
  return t.active ? { tier: "pro", reason: "trial", trialEndsAt: t.endsAt, daysLeft: t.daysLeft } : null;
});

export function startTrial() {
  if (!flags().trial) throw off("The free trial");
  if (trialDoc()?.startedAt) throw err(409, "The free trial was already used on this install.", "trial_used");
  const lic = licenseState();
  if (lic.tier !== "free") throw err(409, `You already have ${lic.limits?.label || lic.tier}. The trial is for the Free tier.`, "has_plan");
  const now = Date.now();
  putDoc("growth.trial", { startedAt: now, endsAt: now + PLACEHOLDER.trialDays * DAY, deviceId: deviceId() });
  addCredit("trial", PLACEHOLDER.trialCreditsUsd, `Free trial credits (placeholder $${PLACEHOLDER.trialCreditsUsd})`);
  emit("log", { text: `Free trial started: ${PLACEHOLDER.trialDays} days of Pro and $${PLACEHOLDER.trialCreditsUsd} of trial credits (placeholders). Nothing is charged.` });
  return overview();
}

// ---------- managed key pool ----------
export function poolConfig(env = process.env) {
  let list = [];
  try { list = JSON.parse(env.CC_MANAGED_POOL || "[]"); } catch { list = []; }
  const out = {};
  for (const e of Array.isArray(list) ? list : []) {
    const p = PROVIDERS[e?.provider];
    if (!p || p.kind !== "text" || p.demo || p.custom || !/^[A-Z][A-Z0-9_]{2,60}$/.test(String(e.keyEnv || ""))) continue;
    const keys = String(env[e.keyEnv] || "").split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length) out[p.id] = keys;
  }
  return out;
}
export const poolProviders = () => Object.keys(poolConfig());

const managedDoc = () => { const d = doc("growth.managed", () => ({ on: false, usage: {} })); d.usage ||= {}; return d; };
const saveManaged = (d) => putDoc("growth.managed", d);
const monthUsage = (d = managedDoc()) => d.usage[monthKey()] || { calls: 0, inTok: 0, outTok: 0, cost: 0, fromCredits: 0, billable: 0 };
// a paid licence (not a trial) keeps using the pool after the credits are gone; usage is metered only
const paidPlan = () => { const l = licenseState(); return l.tier !== "free" && l.reason !== "trial"; };

// Why the pool can or cannot be used for this person right now (null = it can).
export function managedBlock() {
  if (!flags().managed) return "flag_off";
  if (!poolProviders().length) return "no_pool";
  const d = managedDoc();
  if (!d.on) return "not_on";
  if (monthUsage(d).cost >= PLACEHOLDER.managedMonthlyCapUsd) return "monthly_cap";
  if (creditBalance() > 0) return null;
  return paidPlan() ? null : "no_credits";
}

const userSalt = (c) => String(c?.userId || "local");
// vault.getSecret() asks this last, after the workspace's key, your own key and the environment.
// metering: true answers "would this provider's call have gone through the pool", ignoring the allowance,
// so a call that finishes after the credits ran out is still metered.
function resolve(c, providerId, { metering = false } = {}) {
  if (!flags().managed) return null;
  const keys = poolConfig()[providerId];
  if (!keys) return null;
  if (!c?.docs?.["growth.managed"]?.on) return null;
  if (!metering && managedBlock()) return null;
  // one key per person, spread across the pool (stable, so the same person keeps the same key)
  const i = crypto.createHash("sha256").update(userSalt(c)).digest().readUInt32BE(0) % keys.length;
  return { key: keys[i], managed: true, scope: "managed" };
}
setManagedResolver(resolve);

export function setManaged(on) {
  if (!flags().managed) throw off("The managed plan");
  if (on && !poolProviders().length) throw err(409, "The managed key pool is not set up on this install, so the managed plan cannot be turned on.", "no_pool");
  const d = managedDoc();
  d.on = !!on;
  d.changedAt = Date.now();
  saveManaged(d);
  emit("log", { text: on ? "Managed plan on: AIs without your own key go through Everborn's managed pool. Usage is metered; nothing is charged." : "Managed plan off: only your own keys are used." });
  emit("growth.update", {});
  return overview();
}

// One ledger line made through the pool (the ledger tags it managed): meter it and draw the credits.
export function meter(entry) {
  if (!entry?.managed) return;
  const cost = Math.max(0, Number(entry.cost) || 0);
  const d = managedDoc();
  const k = monthKey(entry.ts);
  const u = (d.usage[k] ||= { calls: 0, inTok: 0, outTok: 0, cost: 0, fromCredits: 0, billable: 0 });
  const fromCredits = Math.min(cost, Math.max(0, creditBalance()));
  u.calls += entry.kind === "call" ? 1 : 0;
  u.inTok += Number(entry.inTok) || 0;
  u.outTok += Number(entry.outTok) || 0;
  u.cost = round(u.cost + cost);
  u.fromCredits = round(u.fromCredits + fromCredits);
  u.billable = round(u.billable + cost - fromCredits);
  saveManaged(d);
  if (fromCredits > 0) {
    // one credit line per day for managed usage, updated in place
    const c = creditsDoc();
    const day = dayKey(entry.ts);
    let line = c.lines.find((l) => l.kind === "managed-usage" && l.day === day);
    if (!line) { line = { ts: Date.now(), kind: "managed-usage", amount: 0, note: `Managed AI usage ${day}`, day }; c.lines.push(line); }
    line.amount = round(line.amount - fromCredits);
    line.ts = Date.now();
    saveCredits(c);
  }
  emit("growth.update", {});
}

// ---------- referrals ----------
const CODE_RE = /^REF-[A-Z2-9]{8}$/;
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => "REF-" + Array.from(crypto.randomBytes(8), (b) => ALPHA[b % ALPHA.length]).join("");
const refDoc = () => {
  const d = doc("growth.referrals", () => ({ code: newCode(), createdAt: Date.now(), redeemed: null, stats: null, statsAt: 0 }));
  if (!d.code) { d.code = newCode(); putDoc("growth.referrals", d); }
  return d;
};
const saveRef = (d) => putDoc("growth.referrals", d);
export const referralLink = (code) => `${HOMEPAGE}?ref=${encodeURIComponent(code)}`;
const who = () => ({ p_device_id: deviceId(), p_email: HOSTED ? ctx().email || null : null });

// Enter a friend's code. The licence server confirms it (and does the abuse checks); the welcome credit is
// added only after it says yes. Without a licence server, the code is kept as pending and nothing is added.
export async function redeemReferral(code) {
  if (!flags().referrals) throw off("Referral rewards");
  const k = String(code || "").trim().toUpperCase();
  if (!CODE_RE.test(k)) throw err(400, "That is not a referral code (it looks like REF-XXXXXXXX).", "bad_code");
  const d = refDoc();
  if (k === d.code) throw err(400, "That is your own code. Share it with a friend instead.", "own_code");
  if (d.redeemed?.status === "confirmed") throw err(409, "A referral code was already used on this install.", "already_redeemed");
  d.redeemed = { code: k, at: Date.now(), status: "pending", message: "Waiting for the licence server to confirm." };
  if (!cloudConfigured()) {
    d.redeemed.message = "No licence server is configured, so the code is saved as pending. No credit is added until it is confirmed.";
    saveRef(d);
    return overview();
  }
  try {
    const r = await licenceRpc("redeem_referral", { p_code: k, p_referrer_code: d.code, ...who() });
    if (r?.ok) {
      d.redeemed = { code: k, at: Date.now(), status: "confirmed", message: "Confirmed." };
      saveRef(d);
      addCredit("referral-welcome", PLACEHOLDER.referralFriendUsd, `Welcome credit for using ${k} (placeholder $${PLACEHOLDER.referralFriendUsd})`, { code: k });
      emit("log", { text: `Referral code ${k} confirmed: $${PLACEHOLDER.referralFriendUsd} credit added (placeholder).` });
    } else {
      d.redeemed = r?.status === "rejected" ? null : { ...d.redeemed, message: r?.message || "Not confirmed yet." };
      saveRef(d);
      if (r?.status === "rejected") throw err(400, r?.message || "That referral code was not accepted.", "rejected");
    }
  } catch (e) {
    if (e.status) throw e;
    d.redeemed = { ...d.redeemed, message: `Could not reach the licence server (${e.message}). Saved as pending; no credit added.` };
    saveRef(d);
  }
  return overview();
}

// Ask the licence server how many people used my code. Each confirmed friend earns one reward credit,
// added once (the count of reward lines never goes above the confirmed count).
export async function refreshReferrals() {
  if (!flags().referrals) throw off("Referral rewards");
  const d = refDoc();
  if (!cloudConfigured()) return overview();
  try {
    const r = await licenceRpc("referral_stats", { p_code: d.code, ...who() });
    const confirmed = Math.max(0, Math.floor(Number(r?.confirmed) || 0));
    d.stats = { confirmed, pending: Math.max(0, Math.floor(Number(r?.pending) || 0)) };
    d.statsAt = Date.now();
    d.statsError = null;
    saveRef(d);
    const have = creditsDoc().lines.filter((l) => l.kind === "referral-reward").length;
    for (let i = have; i < confirmed; i++) addCredit("referral-reward", PLACEHOLDER.referralRewardUsd, `A friend joined with your code (placeholder $${PLACEHOLDER.referralRewardUsd})`);
  } catch (e) {
    d.statsError = `Could not reach the licence server (${e.message}).`;
    saveRef(d);
  }
  return overview();
}

// ---------- the upgrade prompt ----------
function upgrade(f, trial, block) {
  const lic = licenseState();
  if (lic.tier !== "free" && lic.reason !== "trial") return { show: false };
  if (f.trial && trial.started && !trial.active) return { show: true, reason: "trial_ended", text: "Your free trial has ended. Upgrade to Pro to keep missions, the scheduler and unlimited councils." };
  if (f.managed && block === "no_credits") return { show: true, reason: "credits_used", text: "Your credits are used up, so the managed AIs are paused. Upgrade to Pro or add your own API key to keep going." };
  if (f.trial && trial.active && trial.daysLeft <= 3) return { show: true, reason: "trial_ending", text: `Your free trial ends in ${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"}. Upgrade to Pro to keep missions, the scheduler and unlimited councils.` };
  return { show: false };
}

// Everything the page needs. Never includes a pool key or a key env var's value.
export function overview() {
  const f = flags();
  const trial = f.trial ? trialStatus() : { started: false, active: false };
  const block = f.managed ? managedBlock() : "flag_off";
  const d = f.managed ? managedDoc() : null;
  const u = d ? monthUsage(d) : null;
  const ref = f.referrals ? refDoc() : null;
  const credits = f.trial || f.managed || f.referrals ? creditsDoc().lines.slice(-50).reverse() : [];
  return {
    flags: f,
    placeholder: PLACEHOLDER,
    tier: licenseState().tier,
    trial: f.trial ? { ...trial, days: PLACEHOLDER.trialDays, credits: PLACEHOLDER.trialCreditsUsd, canStart: !trial.started && licenseState().tier === "free" } : null,
    credits: { balance: creditBalance(), lines: credits },
    managed: f.managed ? {
      on: !!d.on, available: !block, block,
      providers: poolProviders().map((id) => ({ id, name: PROVIDERS[id]?.name || id, ownKey: !!getOwnSecret(id, PROVIDERS[id]?.keyEnv) })),
      month: monthKey(), usage: u,
      wouldBill: round((u.billable || 0) * (1 + PLACEHOLDER.managedMarkupPct / 100), 4),
      cap: PLACEHOLDER.managedMonthlyCapUsd,
    } : null,
    referrals: f.referrals ? { code: ref.code, link: referralLink(ref.code), redeemed: ref.redeemed, stats: ref.stats, statsAt: ref.statsAt || null, statsError: ref.statsError || null, server: cloudConfigured() } : null,
    upgrade: upgrade(f, trial, block),
  };
}
