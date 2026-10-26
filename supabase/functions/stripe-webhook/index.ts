// Supabase Edge Function: Stripe webhook -> licence.
// Deploy (Chris runs this, not the build): supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets:
//   STRIPE_WEBHOOK_SECRET        the signing secret of the webhook endpoint (whsec_...), set with
//                                `supabase secrets set`. Read from the environment only.
//   STRIPE_READ_KEY              optional restricted key with read access to Checkout Sessions only.
//                                Used to read a one-time session's line items so the plan is found by
//                                price or product id when the event does not carry it. Set with
//                                `supabase secrets set`; never written to a file or a log.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by Supabase to the function
// In Stripe (Developers, Webhooks) the endpoint is this function's URL, with these events:
//   checkout.session.completed, invoice.paid, customer.subscription.updated,
//   customer.subscription.deleted, charge.refunded
// Pure logic (signature check, price to plan, event to action, applying it) lives in ./logic.js and
// is unit-tested from Node. Price ids are mapped in ./price-tiers.js. No card data is ever read or
// stored, and no email or key is written to the logs.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyStripeSignature, processEvent } from "./logic.js";

const SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const READ_KEY = Deno.env.get("STRIPE_READ_KEY") ?? "";
const FOUNDERS_EARLY_SEATS = 100;

const db = {
  async claimEvent(id: string, type: string) {
    const { error } = await supabase.from("stripe_events").insert({ event_id: id, type });
    if (!error) return true;
    if (error.code === "23505") return false; // already processed
    throw new Error(`stripe_events insert failed: ${error.code}`);
  },
  async releaseEvent(id: string) {
    await supabase.from("stripe_events").delete().eq("event_id", id);
  },
  async findLicense({ subscriptionId }: { subscriptionId: string }) {
    const { data, error } = await supabase.from("licenses").select("*").eq("stripe_subscription_id", subscriptionId).maybeSingle();
    if (error) throw new Error(`licenses lookup failed: ${error.code}`);
    return data;
  },
  async listLicenses(q: { customerId?: string; email?: string; lifetimeOnly?: boolean }) {
    let query = supabase.from("licenses").select("*").eq("source", "stripe");
    if (q.customerId) query = query.eq("stripe_customer_id", q.customerId);
    else if (q.email) query = query.ilike("email", q.email.replace(/[\\%_]/g, "\\$&"));
    if (q.lifetimeOnly) query = query.like("plan", "lifetime-%").is("stripe_subscription_id", null);
    const { data, error } = await query.limit(20);
    if (error) throw new Error(`licenses list failed: ${error.code}`);
    return data ?? [];
  },
  async insertLicense(row: Record<string, unknown>) {
    const { data, error } = await supabase.from("licenses").insert(row).select("id").single();
    if (error) throw new Error(`licenses insert failed: ${error.code}`);
    return data;
  },
  async updateLicense(id: string, patch: Record<string, unknown>) {
    const { error } = await supabase.from("licenses").update(patch).eq("id", id);
    if (error) throw new Error(`licenses update failed: ${error.code}`);
  },
  async fetchLineItems(sessionId: string) {
    if (!READ_KEY || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=10&expand[]=data.price.product`, { headers: { authorization: `Bearer ${READ_KEY}` } });
    if (!r.ok) throw new Error(`line items read failed: ${r.status}`);
    const j = await r.json();
    return Array.isArray(j?.data) ? j.data : null;
  },
  async countLifetime() {
    const { count } = await supabase.from("licenses").select("id", { count: "exact", head: true }).eq("source", "stripe").like("plan", "lifetime-%");
    return count ?? 0;
  },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  // Not configured means nothing is accepted: no "allow during setup".
  if (!SECRET) {
    console.error("stripe-webhook: not configured (set STRIPE_WEBHOOK_SECRET); rejecting event");
    return new Response("not configured", { status: 500 });
  }
  const raw = await req.text();
  const sig = await verifyStripeSignature({ secret: SECRET, rawBody: raw, header: req.headers.get("stripe-signature") });
  if (!sig.ok) { console.warn(`stripe-webhook: rejected (${sig.reason})`); return new Response("bad signature", { status: 400 }); }

  let event;
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  try {
    const r = await processEvent(event, db);
    console.log(`stripe-webhook: ${event.type} -> ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
    if (r.status === "unresolved") console.warn(`stripe-webhook: paid session ${r.sessionId} has no plan id in the event and STRIPE_READ_KEY is not set; Stripe will retry`);
    if (r.needsEmail) console.warn("stripe-webhook: a licence was created without a buyer email; fix it by hand");
    if (typeof r.founderCount === "number" && r.founderCount >= FOUNDERS_EARLY_SEATS) {
      console.warn(`stripe-webhook: ${r.founderCount} lifetime founders. The first ${FOUNDERS_EARLY_SEATS} seats are gone; change the founder Payment Link price in Stripe.`);
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    // The event id was released, so Stripe's retry runs again.
    console.error(`stripe-webhook: failed (${(e as Error).message})`);
    return new Response("error", { status: 500 });
  }
});
