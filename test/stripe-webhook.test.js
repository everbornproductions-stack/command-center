// Stripe webhook logic module, imported straight into Node (no Deno, no network, no Stripe).
// Events are signed samples. The signing secret is random for each run: no secret is in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import {
  AMOUNT_PLANS, PLANS, PRICE_TIERS,
} from "../supabase/functions/stripe-webhook/price-tiers.js";
import {
  KEY_RE, computeStripeSignature, genLicenseKey, mapSubscriptionStatus, parseSignatureHeader, planEvent, planForPrice,
  processEvent, timingSafeEqual, verifyStripeSignature,
} from "../supabase/functions/stripe-webhook/logic.js";

const SECRET = "whsec_" + randomBytes(24).toString("hex");
const NOW = 1_800_000_000; // seconds
const sign = (secret, t, body) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
const header = (secret, t, body) => `t=${t},v1=${sign(secret, t, body)}`;

// ---------- signature ----------

test("a correctly signed body verifies, and the module's own signer agrees with Node's HMAC", async () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
  assert.equal(await computeStripeSignature({ secret: SECRET, timestamp: NOW, rawBody: body }), sign(SECRET, NOW, body));
  const r = await verifyStripeSignature({ secret: SECRET, rawBody: body, header: header(SECRET, NOW, body), now: NOW + 5 });
  assert.deepEqual(r, { ok: true, timestamp: NOW });
});

test("no secret, no header, a broken header, a wrong secret and a changed body are all refused", async () => {
  const body = "{\"id\":\"evt_2\"}";
  const good = header(SECRET, NOW, body);
  assert.deepEqual(await verifyStripeSignature({ secret: "", rawBody: body, header: good, now: NOW }), { ok: false, reason: "not_configured" });
  assert.deepEqual(await verifyStripeSignature({ secret: SECRET, rawBody: body, header: "", now: NOW }), { ok: false, reason: "missing_signature" });
  assert.deepEqual(await verifyStripeSignature({ secret: SECRET, rawBody: body, header: null, now: NOW }), { ok: false, reason: "missing_signature" });
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: "garbage", now: NOW })).reason, "bad_header");
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: `t=${NOW}`, now: NOW })).reason, "bad_header");
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: header("whsec_other", NOW, body), now: NOW })).reason, "bad_signature");
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body + " ", header: good, now: NOW })).reason, "bad_signature");
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: `t=${NOW},v1=${"0".repeat(64)}`, now: NOW })).reason, "bad_signature");
});

test("a timestamp more than 5 minutes old (or ahead) is refused even when the signature is right", async () => {
  const body = "{\"id\":\"evt_3\"}";
  const h = header(SECRET, NOW, body);
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: h, now: NOW + 300 })).ok, true);
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: h, now: NOW + 301 })).reason, "timestamp_out_of_range");
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: h, now: NOW - 301 })).reason, "timestamp_out_of_range");
  // The old timestamp cannot be swapped for a new one: the signature covers it.
  const forged = `t=${NOW + 1000},v1=${sign(SECRET, NOW, body)}`;
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: forged, now: NOW + 1000 })).reason, "bad_signature");
});

test("a header with two v1 values (secret rotation) verifies when either one matches", async () => {
  const body = "{\"id\":\"evt_4\"}";
  const h = `t=${NOW},v1=${"a".repeat(64)},v1=${sign(SECRET, NOW, body)}`;
  assert.equal((await verifyStripeSignature({ secret: SECRET, rawBody: body, header: h, now: NOW })).ok, true);
  assert.deepEqual(parseSignatureHeader(h).v1.length, 2);
  assert.equal(parseSignatureHeader("v1=abc"), null);
});

test("licence keys match the key shape and timingSafeEqual handles unequal lengths", () => {
  for (let i = 0; i < 200; i++) assert.match(genLicenseKey(), KEY_RE);
  assert.equal(genLicenseKey((n) => new Uint8Array(n)), "EVB-AAAA-AAAA-AAAA");
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

// ---------- price to plan ----------

test("the seven prices map to a plan by amount and interval when no price id is filled in", () => {
  assert.deepEqual(PRICE_TIERS, {}, "PRICE_TIERS ships empty: the TODO list in price-tiers.js is Chris's to fill");
  const cases = [
    [1899, "month", "pro-monthly", "pro"], [18900, "year", "pro-yearly", "pro"],
    [2999, "month", "extreme-monthly", "extreme"], [29900, "year", "extreme-yearly", "extreme"],
    [3499, "month", "developer-monthly", "extreme"], [34900, "year", "developer-yearly", "extreme"],
    [34900, null, "lifetime-349", "pro"],
  ];
  for (const [amount, interval, plan, tier] of cases) {
    const got = planForPrice({ amount, interval });
    assert.equal(got, plan);
    assert.equal(PLANS[got].tier, tier);
  }
  assert.equal(planForPrice({ amount: 34900, interval: "year" }), "developer-yearly", "Developer yearly and Founder once share $349 and differ by interval");
  assert.equal(planForPrice({ amount: 1234, interval: "month" }), null);
  assert.equal(planForPrice({}), null);
  assert.equal(Object.keys(AMOUNT_PLANS).length >= 7, true);
});

test("a price id in the map wins over the amount, and price metadata is a second fallback", () => {
  assert.equal(planForPrice({ priceId: "price_x", amount: 1899, interval: "month" }, { price_x: "extreme-yearly" }), "extreme-yearly");
  assert.equal(planForPrice({ priceId: "price_y", amount: 5, interval: "month", metadata: { meldmind_plan: "developer-monthly" } }), "developer-monthly");
  assert.equal(planForPrice({ priceId: "price_z", amount: 1899, interval: "month" }, { price_z: "not-a-plan" }), "pro-monthly");
  assert.equal(mapSubscriptionStatus("active"), "active");
  assert.equal(mapSubscriptionStatus("trialing"), "active");
  assert.equal(mapSubscriptionStatus("past_due"), "past_due");
  assert.equal(mapSubscriptionStatus("incomplete"), "pending");
  assert.notEqual(mapSubscriptionStatus("incomplete"), "active");
  assert.equal(mapSubscriptionStatus("canceled"), "cancelled");
  assert.equal(mapSubscriptionStatus(undefined), "cancelled");
});

// ---------- an in-memory licence table ----------

function memoryDb({ failInsertOnce = false } = {}) {
  const events = new Set();
  const rows = [];
  let n = 0;
  let failing = failInsertOnce;
  const calls = { released: [] };
  return {
    rows, events, calls,
    async claimEvent(id) { if (events.has(id)) return false; events.add(id); return true; },
    async releaseEvent(id) { events.delete(id); calls.released.push(id); },
    async findLicense({ subscriptionId }) { return rows.find((r) => r.stripe_subscription_id === subscriptionId) ?? null; },
    async listLicenses(q) {
      return rows.filter((r) => r.source === "stripe"
        && (q.customerId ? r.stripe_customer_id === q.customerId : q.email ? r.email.toLowerCase() === q.email.toLowerCase() : true)
        && (!q.lifetimeOnly || (String(r.plan).startsWith("lifetime-") && !r.stripe_subscription_id)));
    },
    async insertLicense(row) {
      if (failing) { failing = false; throw new Error("database down"); }
      const r = { id: `lic_${++n}`, ...row };
      rows.push(r);
      return r;
    },
    async updateLicense(id, patch) { Object.assign(rows.find((r) => r.id === id), patch); },
    async countLifetime() { return rows.filter((r) => String(r.plan).startsWith("lifetime-")).length; },
  };
}

const KEYS = (() => { let i = 0; return () => `EVB-AAAA-AAAA-${["BBBB", "CCCC", "DDDD", "EEEE"][i++ % 4]}`; })();
const opts = { genKey: KEYS, now: () => new Date("2026-10-25T12:00:00Z") };
const sec = (iso) => Math.floor(new Date(iso).getTime() / 1000);

let seq = 0;
const ev = (type, object, id = `evt_${++seq}`) => ({ id, type, data: { object } });
const invoicePaid = ({ email = "Buyer@Example.com", sub = "sub_1", cust = "cus_1", amount = 1899, interval = "month", priceId = "price_pro_m", end = "2026-11-25T12:00:00Z" } = {}, id) =>
  ev("invoice.paid", {
    customer: cust, customer_email: email, subscription: sub,
    lines: { data: [{ amount, period: { end: sec(end) }, price: { id: priceId, unit_amount: amount, recurring: { interval } } }] },
  }, id);
const subscriptionObj = ({ sub = "sub_1", cust = "cus_1", status = "active", amount = 1899, interval = "month", priceId = "price_pro_m", end = "2026-11-25T12:00:00Z" } = {}) => ({
  id: sub, customer: cust, status, cancel_at_period_end: false,
  items: { data: [{ current_period_end: sec(end), price: { id: priceId, unit_amount: amount, recurring: { interval } } }] },
});

test("a Pro purchase: checkout alone grants nothing, the paid invoice creates one active Pro licence", async () => {
  const db = memoryDb();
  const checkout = ev("checkout.session.completed", { mode: "subscription", payment_status: "paid", customer: "cus_1", subscription: "sub_1", customer_details: { email: "buyer@example.com" } });
  assert.equal((await processEvent(checkout, db, opts)).status, "no_license");
  assert.equal(db.rows.length, 0);

  const paid = invoicePaid();
  const r = await processEvent(paid, db, opts);
  assert.equal(r.status, "created");
  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  assert.match(row.key, KEY_RE);
  assert.equal(row.email, "buyer@example.com");
  assert.equal(row.tier, "pro");
  assert.equal(row.plan, "pro-monthly");
  assert.equal(row.status, "active");
  assert.equal(row.source, "stripe");
  assert.equal(row.stripe_customer_id, "cus_1");
  assert.equal(row.stripe_subscription_id, "sub_1");
  assert.equal(row.current_period_end, "2026-11-25T12:00:00.000Z");
  assert.equal(row.max_devices, 2);
  assert.equal(JSON.stringify(row).includes("card"), false, "no card data");
});

test("the same event delivered again does nothing, and a renewal moves the period end only", async () => {
  const db = memoryDb();
  const paid = invoicePaid();
  assert.equal((await processEvent(paid, db, opts)).status, "created");
  assert.equal((await processEvent(paid, db, opts)).status, "duplicate");
  assert.equal((await processEvent(structuredClone(paid), db, opts)).status, "duplicate");
  assert.equal(db.rows.length, 1);
  const key = db.rows[0].key;

  const renewal = invoicePaid({ end: "2026-12-25T12:00:00Z" });
  assert.equal((await processEvent(renewal, db, opts)).status, "updated");
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].key, key);
  assert.equal(db.rows[0].current_period_end, "2026-12-25T12:00:00.000Z");
});

test("Pro upgrades to Extreme on the same licence and key, and the tier follows the new price", async () => {
  const db = memoryDb();
  await processEvent(invoicePaid(), db, opts);
  const { key, id } = db.rows[0];
  const up = ev("customer.subscription.updated", subscriptionObj({ amount: 2999, priceId: "price_ext_m", end: "2026-11-25T12:00:00Z" }));
  const r = await processEvent(up, db, opts);
  assert.equal(r.status, "updated");
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].id, id);
  assert.equal(db.rows[0].key, key);
  assert.equal(db.rows[0].tier, "extreme");
  assert.equal(db.rows[0].plan, "extreme-monthly");
  assert.equal(db.rows[0].status, "active");
  // Extreme to Developer yearly keeps Extreme limits and records the Developer plan.
  const dev = ev("customer.subscription.updated", subscriptionObj({ amount: 34900, interval: "year", priceId: "price_dev_y", end: "2027-10-25T12:00:00Z" }));
  await processEvent(dev, db, opts);
  assert.equal(db.rows[0].plan, "developer-yearly");
  assert.equal(db.rows[0].tier, "extreme");
  assert.equal(db.rows[0].current_period_end, "2027-10-25T12:00:00.000Z");
});

test("cancel at period end stays active until Stripe sends the deleted event, then the licence ends", async () => {
  const db = memoryDb();
  await processEvent(invoicePaid(), db, opts);
  const soft = subscriptionObj();
  soft.cancel_at_period_end = true;
  await processEvent(ev("customer.subscription.updated", soft), db, opts);
  assert.equal(db.rows[0].status, "active");

  const gone = ev("customer.subscription.deleted", subscriptionObj({ status: "canceled" }));
  const r = await processEvent(gone, db, opts);
  assert.equal(r.status, "updated");
  assert.equal(db.rows[0].status, "cancelled");
  assert.equal(db.rows[0].current_period_end, "2026-11-25T12:00:00.000Z", "the paid period is kept");
  assert.equal(db.rows[0].tier, "pro", "the row keeps its tier; status is what ends access");
});

test("a failed payment makes the licence past_due, and an event for an unknown subscription is not invented", async () => {
  const db = memoryDb();
  await processEvent(invoicePaid(), db, opts);
  await processEvent(ev("customer.subscription.updated", subscriptionObj({ status: "past_due" })), db, opts);
  assert.equal(db.rows[0].status, "past_due");
  const other = await processEvent(ev("customer.subscription.updated", subscriptionObj({ sub: "sub_nobody", cust: "cus_nobody" })), db, opts);
  assert.equal(other.status, "no_license");
  assert.equal(db.rows.length, 1);
});

test("a full refund ends access now; a partial refund changes nothing", async () => {
  const db = memoryDb();
  await processEvent(invoicePaid(), db, opts);
  const partial = ev("charge.refunded", { customer: "cus_1", amount: 1899, amount_refunded: 500, refunded: false, billing_details: { email: "buyer@example.com" } });
  assert.equal((await processEvent(partial, db, opts)).status, "ignored");
  assert.equal(db.rows[0].status, "active");

  const full = ev("charge.refunded", { customer: "cus_1", amount: 1899, amount_refunded: 1899, refunded: true, billing_details: { email: "buyer@example.com" } });
  const r = await processEvent(full, db, opts);
  assert.equal(r.status, "ended");
  assert.equal(db.rows[0].status, "cancelled");
  assert.equal(db.rows[0].current_period_end, "2026-10-25T12:00:00.000Z");
  assert.equal((await processEvent(ev("charge.refunded", { customer: "cus_1", amount: 1899, amount_refunded: 1899, refunded: true }), db, opts)).status, "no_license", "already ended");
});

test("Founder lifetime: a $349 one-time payment makes a Pro-for-life licence with no end date, once", async () => {
  const db = memoryDb();
  const checkout = ev("checkout.session.completed", { mode: "payment", payment_status: "paid", amount_total: 34900, customer: null, payment_intent: "pi_1", customer_details: { email: "Founder@Example.com" } });
  const r = await processEvent(checkout, db, opts);
  assert.equal(r.status, "created");
  assert.equal(r.founderCount, 1);
  const row = db.rows[0];
  assert.equal(row.plan, "lifetime-349");
  assert.equal(row.tier, "pro");
  assert.equal(row.current_period_end, null);
  assert.equal(row.stripe_subscription_id, null);
  assert.equal(row.email, "founder@example.com");

  const again = ev("checkout.session.completed", { mode: "payment", payment_status: "paid", amount_total: 34900, payment_intent: "pi_2", customer_details: { email: "founder@example.com" } });
  assert.equal((await processEvent(again, db, opts)).status, "updated");
  assert.equal(db.rows.length, 1, "no second licence for the same email");

  // A refund without a customer id ends the lifetime licence by email, and only lifetime ones.
  await processEvent(invoicePaid({ email: "founder@example.com", sub: "sub_f", cust: "cus_f" }), db, opts);
  const refund = ev("charge.refunded", { customer: null, amount: 34900, amount_refunded: 34900, refunded: true, billing_details: { email: "founder@example.com" } });
  const out = await processEvent(refund, db, opts);
  assert.equal(out.status, "ended");
  assert.equal(out.count, 1);
  assert.equal(db.rows.find((x) => x.plan === "lifetime-349").status, "cancelled");
  assert.equal(db.rows.find((x) => x.stripe_subscription_id === "sub_f").status, "active");
});

test("unpaid sessions, unknown amounts and other event types are ignored", async () => {
  const db = memoryDb();
  assert.equal((await processEvent(ev("checkout.session.completed", { mode: "payment", payment_status: "unpaid", amount_total: 34900, customer_details: { email: "a@b.co" } }), db, opts)).reason, "not_paid");
  assert.equal((await processEvent(ev("checkout.session.completed", { mode: "payment", payment_status: "paid", amount_total: 100, customer_details: { email: "a@b.co" } }), db, opts)).reason, "not_a_plan");
  assert.equal((await processEvent(ev("customer.created", { id: "cus_9" }), db, opts)).reason, "event_type");
  assert.equal((await processEvent({ type: "invoice.paid" }, db, opts)).status, "ignored");
  assert.equal((await processEvent(ev("invoice.paid", { customer: "c", lines: { data: [] } }), db, opts)).reason, "not_a_subscription");
  assert.equal(db.rows.length, 0);
});

test("a database error releases the event id so Stripe's retry can run", async () => {
  const db = memoryDb({ failInsertOnce: true });
  const paid = invoicePaid({ sub: "sub_retry" });
  await assert.rejects(processEvent(paid, db, opts), /database down/);
  assert.equal(db.events.has(paid.id), false);
  assert.deepEqual(db.calls.released, [paid.id]);
  assert.equal((await processEvent(paid, db, opts)).status, "created");
  assert.equal(db.rows.length, 1);
});

test("a revoked licence is never brought back by a later payment event", async () => {
  const db = memoryDb();
  await processEvent(invoicePaid(), db, opts);
  db.rows[0].status = "revoked";
  assert.equal((await processEvent(invoicePaid({ end: "2027-01-25T12:00:00Z" }), db, opts)).status, "skipped");
  assert.equal(db.rows[0].status, "revoked");
});

test("the newer Stripe API shape (parent subscription details, pricing on the line) is read too", () => {
  const act = planEvent(ev("invoice.paid", {
    customer: "cus_n", customer_email: "n@example.com",
    parent: { subscription_details: { subscription: "sub_n" } },
    lines: { data: [{ amount: 29900, quantity: 1, period: { end: sec("2027-10-25T12:00:00Z") }, pricing: { price_details: { price: "price_unknown" } }, price: { id: "price_unknown", unit_amount: 29900, recurring: { interval: "year" } } }] },
  }));
  assert.equal(act.kind, "grant");
  assert.equal(act.subscriptionId, "sub_n");
  assert.equal(act.plan, "extreme-yearly");
  assert.equal(act.tier, "extreme");
});
