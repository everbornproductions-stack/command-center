// Pure logic for the Stripe webhook, shared by the Deno edge function (index.ts) and the Node
// tests (test/stripe-webhook.test.js). Web standard APIs only (crypto.subtle, TextEncoder): no
// Deno- or Node-specific imports, so both runtimes can import this file as is.
// The webhook secret is passed in by the caller from the STRIPE_WEBHOOK_SECRET environment
// variable. Nothing in this file holds a secret, writes an email to a log, or stores card data.
import { PRICE_TIERS, PLANS, AMOUNT_PLANS } from "./price-tiers.js";

export const TOLERANCE_SECONDS = 300; // The usual replay window: 5 minutes.

// Licence keys look like EVB-7K2M-9QHD-4XTP: 32-letter alphabet without 0/O/1/I.
export const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const KEY_RE = /^EVB(-[A-HJ-NP-Z2-9]{4}){3}$/;

// 12 random bytes from a CSPRNG; `& 31` picks one of exactly 32 letters, so there is no modulo bias.
export function genLicenseKey(randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = randomBytes(12);
  let out = "EVB";
  for (let i = 0; i < 12; i++) {
    if (i % 4 === 0) out += "-";
    out += KEY_ALPHABET[bytes[i] & 31];
  }
  return out;
}

// ---------- signature ----------

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// Stripe signs HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as lowercase hex into Stripe-Signature.
export async function computeStripeSignature({ secret, timestamp, rawBody }) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${rawBody}`));
  return hex(new Uint8Array(mac));
}

// Constant-time comparison: the loop always runs over the longer input and never exits early.
export function timingSafeEqual(a, b) {
  const x = typeof a === "string" ? new TextEncoder().encode(a) : a;
  const y = typeof b === "string" ? new TextEncoder().encode(b) : b;
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// "t=1700000000,v1=abc,v1=def" -> { t: 1700000000, v1: ["abc","def"] } or null.
export function parseSignatureHeader(header) {
  const out = { t: NaN, v1: [] };
  for (const part of String(header ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") out.t = Number(v);
    else if (k === "v1" && v) out.v1.push(v);
  }
  return Number.isInteger(out.t) && out.t > 0 && out.v1.length ? out : null;
}

// { ok: true, timestamp } or { ok: false, reason: "not_configured" | "missing_signature" |
// "bad_header" | "timestamp_out_of_range" | "bad_signature" }. now is in seconds.
export async function verifyStripeSignature({ secret, rawBody, header, now = Math.floor(Date.now() / 1000), toleranceSeconds = TOLERANCE_SECONDS }) {
  if (!secret) return { ok: false, reason: "not_configured" };
  if (!header) return { ok: false, reason: "missing_signature" };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "bad_header" };
  if (Math.abs(now - parsed.t) > toleranceSeconds) return { ok: false, reason: "timestamp_out_of_range" };
  const expected = await computeStripeSignature({ secret, timestamp: parsed.t, rawBody: rawBody ?? "" });
  const match = parsed.v1.some((sig) => timingSafeEqual(expected, sig));
  return match ? { ok: true, timestamp: parsed.t } : { ok: false, reason: "bad_signature" };
}

// ---------- price to plan ----------

// Reads what the event says about a price from the several shapes Stripe uses
// (classic: price / plan; newer API versions: pricing.price_details).
function priceFacts(item) {
  if (!item || typeof item !== "object") return {};
  const price = item.price && typeof item.price === "object" ? item.price : null;
  const plan = item.plan && typeof item.plan === "object" ? item.plan : null;
  const detail = item.pricing?.price_details;
  const priceId = price?.id ?? plan?.id ?? (typeof item.price === "string" ? item.price : null) ?? (typeof detail === "string" ? detail : detail?.price) ?? null;
  const interval = price?.recurring?.interval ?? plan?.interval ?? null;
  const amount = price?.unit_amount ?? plan?.amount ?? (Number.isInteger(item.amount) && (item.quantity ?? 1) === 1 ? item.amount : null);
  const metadata = price?.metadata ?? plan?.metadata ?? {};
  return { priceId, interval, amount, metadata };
}

// Plan id for a price: PRICE_TIERS first, then price metadata (meldmind_plan), then amount + interval.
export function planForPrice({ priceId = null, amount = null, interval = null, metadata = {} } = {}, tiers = PRICE_TIERS) {
  if (priceId && tiers[priceId] && PLANS[tiers[priceId]]) return tiers[priceId];
  const meta = metadata?.meldmind_plan;
  if (meta && PLANS[meta]) return meta;
  if (Number.isInteger(amount)) {
    const iv = interval === "month" || interval === "year" ? interval : "once";
    const p = AMOUNT_PLANS[`${amount}:${iv}`];
    if (p) return p;
  }
  return null;
}

export const tierForPlan = (plan) => PLANS[plan]?.tier ?? null;
export const isLifetimePlan = (plan) => !!PLANS[plan]?.lifetime;

// Stripe subscription status -> licences.status. Only active (and a trial) grant access.
export function mapSubscriptionStatus(status) {
  switch (String(status ?? "").toLowerCase()) {
    case "active": case "trialing": return "active";
    case "past_due": case "unpaid": case "paused": return "past_due";
    case "incomplete": return "pending";
    default: return "cancelled"; // canceled, incomplete_expired, anything unknown
  }
}

const iso = (sec) => (Number.isFinite(Number(sec)) && Number(sec) > 0 ? new Date(Number(sec) * 1000).toISOString() : null);
const lower = (v) => { const s = String(v ?? "").trim().toLowerCase(); return s && s.includes("@") ? s : null; };
const idOf = (v) => (typeof v === "string" ? v : v?.id ?? null);

// ---------- events -> what to do ----------
//
// planEvent(event) returns { kind, ... } and never touches the network or the database:
//   { kind: "ignore", reason }
//   { kind: "grant",  email, customerId, subscriptionId, plan, tier, lifetime, status, periodEnd }
//        create the licence for this subscription (or lifetime payment), or update it if it exists
//   { kind: "update", subscriptionId, customerId, email?, status, periodEnd, plan?, tier? }
//        change an existing licence only; if none exists the caller does nothing
//   { kind: "end",    customerId, email, reason }   a full refund: end access now
export function planEvent(event) {
  const type = event?.type;
  const obj = event?.data?.object;
  if (!type || !obj) return { kind: "ignore", reason: "no_object" };

  if (type === "checkout.session.completed") {
    const email = lower(obj.customer_details?.email ?? obj.customer_email);
    const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
    if (!paid) return { kind: "ignore", reason: "not_paid" };
    if (obj.mode === "subscription") {
      // The session does not say which price. invoice.paid carries it and creates the licence.
      return { kind: "update", subscriptionId: idOf(obj.subscription), customerId: idOf(obj.customer), email, status: "active", periodEnd: undefined };
    }
    if (obj.mode === "payment") {
      const plan = planForPrice({ amount: Number.isInteger(obj.amount_total) ? obj.amount_total : null, interval: null, metadata: obj.metadata });
      if (!email) return { kind: "ignore", reason: "no_email" };
      if (!plan || !isLifetimePlan(plan)) return { kind: "ignore", reason: "not_a_plan" };
      return { kind: "grant", email, customerId: idOf(obj.customer), subscriptionId: null, plan, tier: tierForPlan(plan), lifetime: true, status: "active", periodEnd: null, paymentId: idOf(obj.payment_intent) };
    }
    return { kind: "ignore", reason: "mode" };
  }

  if (type === "invoice.paid") {
    const line = obj.lines?.data?.[0];
    const facts = priceFacts(line);
    const subscriptionId = idOf(obj.subscription) ?? idOf(obj.parent?.subscription_details?.subscription) ?? idOf(line?.subscription);
    if (!subscriptionId) return { kind: "ignore", reason: "not_a_subscription" };
    const plan = planForPrice({ ...facts, metadata: { ...(facts.metadata || {}), ...(obj.subscription_details?.metadata || {}) } });
    const periodEnd = iso(line?.period?.end ?? obj.period_end);
    const email = lower(obj.customer_email);
    const customerId = idOf(obj.customer);
    if (!plan) return { kind: "update", subscriptionId, customerId, email, status: "active", periodEnd };
    return { kind: "grant", email, customerId, subscriptionId, plan, tier: tierForPlan(plan), lifetime: false, status: "active", periodEnd };
  }

  if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    const item = obj.items?.data?.[0];
    const facts = priceFacts(item ?? obj);
    const plan = planForPrice({ ...facts, metadata: { ...(facts.metadata || {}), ...(obj.metadata || {}) } });
    const deleted = type === "customer.subscription.deleted";
    const status = deleted ? "cancelled" : mapSubscriptionStatus(obj.status);
    const periodEnd = iso(item?.current_period_end ?? obj.current_period_end);
    const out = { kind: "update", subscriptionId: idOf(obj.id), customerId: idOf(obj.customer), status, periodEnd };
    // A cancel set for the period end stays active until Stripe sends the deleted event.
    if (plan && status === "active") { out.plan = plan; out.tier = tierForPlan(plan); }
    return out;
  }

  if (type === "charge.refunded") {
    const full = obj.refunded === true || (Number.isInteger(obj.amount) && Number.isInteger(obj.amount_refunded) && obj.amount > 0 && obj.amount_refunded >= obj.amount);
    if (!full) return { kind: "ignore", reason: "partial_refund" };
    return { kind: "end", customerId: idOf(obj.customer), email: lower(obj.billing_details?.email ?? obj.receipt_email), reason: "refunded" };
  }

  return { kind: "ignore", reason: "event_type" };
}

// ---------- applying an event ----------
//
// processEvent works against a small database adapter, so the Deno function (real Supabase) and
// the Node tests (in memory) run the same code:
//   claimEvent(id, type) -> true when this event id is new (inserted into stripe_events), false on a replay
//   releaseEvent(id)     -> forget the id so Stripe's retry can run again after a failure
//   findLicense({ subscriptionId }) -> licence row or null
//   listLicenses({ customerId } | { email, lifetimeOnly }) -> array of licence rows
//   insertLicense(row) -> row;  updateLicense(id, patch)
//   countLifetime() -> number of lifetime founder licences
// Rows use the licences column names (stripe_customer_id, stripe_subscription_id, current_period_end).
export async function processEvent(event, db, { genKey = genLicenseKey, now = () => new Date() } = {}) {
  const id = event?.id;
  const act = planEvent(event);
  if (act.kind === "ignore") return { status: "ignored", reason: act.reason };
  if (!id) return { status: "ignored", reason: "no_event_id" };
  if (!(await db.claimEvent(id, event.type))) return { status: "duplicate" };
  try {
    return await applyAction(act, db, { genKey, now, eventId: id });
  } catch (e) {
    await db.releaseEvent(id).catch(() => {});
    throw e;
  }
}

async function applyAction(act, db, { genKey, now, eventId }) {
  if (act.kind === "grant") {
    let existing = act.subscriptionId ? await db.findLicense({ subscriptionId: act.subscriptionId }) : null;
    if (!existing && act.lifetime && act.email) existing = (await db.listLicenses({ email: act.email, lifetimeOnly: true })).find((r) => r.status !== "revoked") ?? null;
    if (existing) {
      if (existing.status === "revoked") return { status: "skipped", reason: "revoked", licenseId: existing.id };
      const patch = { tier: act.tier, plan: act.plan, status: act.status, current_period_end: act.periodEnd };
      if (act.customerId) patch.stripe_customer_id = act.customerId;
      await db.updateLicense(existing.id, patch);
      return { status: "updated", licenseId: existing.id, tier: act.tier, plan: act.plan };
    }
    const row = await db.insertLicense({
      key: genKey(),
      email: act.email ?? `unknown+${eventId}@stripe.invalid`,
      tier: act.tier, plan: act.plan, status: act.status, source: "stripe",
      stripe_customer_id: act.customerId, stripe_subscription_id: act.subscriptionId,
      current_period_end: act.periodEnd, max_devices: 2,
    });
    const out = { status: "created", licenseId: row?.id ?? null, tier: act.tier, plan: act.plan, needsEmail: !act.email };
    if (act.lifetime) out.founderCount = await db.countLifetime();
    return out;
  }

  if (act.kind === "update") {
    let existing = act.subscriptionId ? await db.findLicense({ subscriptionId: act.subscriptionId }) : null;
    if (!existing && act.customerId) existing = (await db.listLicenses({ customerId: act.customerId })).find((r) => r.stripe_subscription_id) ?? null;
    if (!existing) return { status: "no_license", reason: "wait_for_invoice" };
    if (existing.status === "revoked") return { status: "skipped", reason: "revoked", licenseId: existing.id };
    const patch = { status: act.status };
    if (act.periodEnd) patch.current_period_end = act.periodEnd;
    if (act.plan) { patch.plan = act.plan; patch.tier = act.tier; }
    if (act.customerId && !existing.stripe_customer_id) patch.stripe_customer_id = act.customerId;
    await db.updateLicense(existing.id, patch);
    return { status: "updated", licenseId: existing.id, licenseStatus: act.status, ...(act.plan ? { tier: act.tier, plan: act.plan } : {}) };
  }

  if (act.kind === "end") {
    const rows = act.customerId
      ? await db.listLicenses({ customerId: act.customerId })
      : act.email ? await db.listLicenses({ email: act.email, lifetimeOnly: true }) : [];
    const live = rows.filter((r) => r.status !== "revoked" && r.status !== "cancelled");
    for (const r of live) await db.updateLicense(r.id, { status: "cancelled", current_period_end: now().toISOString() });
    return live.length ? { status: "ended", count: live.length, reason: act.reason } : { status: "no_license", reason: "nothing_to_end" };
  }

  return { status: "ignored", reason: "kind" };
}
