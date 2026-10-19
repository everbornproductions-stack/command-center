// Supabase Edge Function: Square webhook → licence.
// Deploy: supabase functions deploy square-webhook --no-verify-jwt
// Secrets (all required unless noted):
//   SQUARE_WEBHOOK_SIGNATURE_KEY  from Square Developer → Webhooks → the subscription's signature key
//   SQUARE_WEBHOOK_URL            the exact notification URL registered in Square (what the signature is computed over;
//                                 req.url can differ behind Supabase's proxy, so it is never used)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SQUARE_ACCESS_TOKEN           optional, to look up the buyer email
//   RESEND_API_KEY                optional, to email the key
// In Square Developer dashboard → Webhooks, subscribe this URL to:
//   subscription.created, subscription.updated, invoice.payment_made, invoice.payment_failed (or payment.updated)
// Pure logic (signature check, status mapping, key generation) lives in ./logic.js and is unit-tested from Node.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifySquareSignature, mapSquareStatus, genLicenseKey } from "./logic.js";

const SIG_KEY = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") ?? "";
const NOTIFY_URL = Deno.env.get("SQUARE_WEBHOOK_URL") ?? "";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function emailKey(to: string, key: string) {
  const rk = Deno.env.get("RESEND_API_KEY");
  if (!rk) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${rk}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "Everborn Command <hello@everbornproductions.com>", to, subject: "Your Everborn Command Pro licence key",
      html: `<p>Thanks for subscribing.</p><p>Your licence key: <b style="font-family:monospace;font-size:18px">${key}</b></p><p>Open Everborn Command → Settings → Licence, paste the key, done. Up to 3 devices.</p>` }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  // Not configured means nothing is accepted: no "allow during setup".
  if (!SIG_KEY || !NOTIFY_URL) {
    console.error("square-webhook: not configured (set SQUARE_WEBHOOK_SIGNATURE_KEY and SQUARE_WEBHOOK_URL); rejecting event");
    return new Response("not configured", { status: 500 });
  }
  const raw = await req.text();
  const sig = await verifySquareSignature({ signatureKey: SIG_KEY, notificationUrl: NOTIFY_URL, rawBody: raw, signature: req.headers.get("x-square-hmacsha256-signature") });
  if (!sig.ok) { console.warn(`square-webhook: rejected (${sig.reason})`); return new Response("bad signature", { status: 401 }); }

  const ev = JSON.parse(raw);
  const eventId = ev.event_id ?? crypto.randomUUID();
  const { error: dup } = await supabase.from("square_events").insert({ event_id: eventId, type: ev.type, payload: ev });
  if (dup) return new Response("duplicate", { status: 200 }); // already processed

  const obj = ev.data?.object ?? {};
  const sub = obj.subscription;
  if (sub) {
    const subId = sub.id as string;
    const customerId = sub.customer_id as string | undefined;
    // ACTIVE → active; PENDING → pending (not paid yet, grants nothing); PAUSED → past_due; else cancelled
    const mapped = mapSquareStatus(sub.status);
    const periodEnd = sub.charged_through_date ? new Date(sub.charged_through_date).toISOString() : null;
    // find email through the customer record if we do not have it yet
    let email = sub.buyer_email_address ?? null;
    const { data: existing } = await supabase.from("licenses").select("id,key,email").eq("square_subscription_id", subId).maybeSingle();
    if (existing) {
      await supabase.from("licenses").update({ status: mapped, current_period_end: periodEnd, square_customer_id: customerId }).eq("id", existing.id);
    } else {
      if (!email && customerId) {
        const token = Deno.env.get("SQUARE_ACCESS_TOKEN");
        if (token) {
          const r = await fetch(`https://connect.squareup.com/v2/customers/${customerId}`, { headers: { authorization: `Bearer ${token}`, "Square-Version": "2025-01-23" } });
          const j = await r.json().catch(() => ({}));
          email = j.customer?.email_address ?? null;
        }
      }
      const key = genLicenseKey();
      await supabase.from("licenses").insert({ key, email: email ?? `unknown+${subId}@everbornproductions.com`, tier: "pro", status: mapped, source: "square", square_customer_id: customerId, square_subscription_id: subId, current_period_end: periodEnd });
      if (email) await emailKey(email, key);
    }
  }
  const invoice = obj.invoice;
  if (invoice?.subscription_id) {
    const paid = ev.type === "invoice.payment_made";
    const failed = ev.type === "invoice.payment_failed" || String(invoice.status).toUpperCase() === "FAILED";
    if (paid) await supabase.from("licenses").update({ status: "active" }).eq("square_subscription_id", invoice.subscription_id);
    if (failed) await supabase.from("licenses").update({ status: "past_due" }).eq("square_subscription_id", invoice.subscription_id);
  }
  return new Response("ok", { status: 200 });
});
