// Supabase Edge Function: Square webhook → licence.
// Deploy: supabase functions deploy square-webhook --no-verify-jwt
// Secrets: SQUARE_WEBHOOK_SIGNATURE_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (optional, to email the key)
// In Square Developer dashboard → Webhooks, subscribe this URL to:
//   subscription.created, subscription.updated, invoice.payment_made, invoice.payment_failed (or payment.updated)
import { createClient } from "npm:@supabase/supabase-js@2";

const SIG_KEY = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") ?? "";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function validSignature(req: Request, raw: string) {
  // Square: HMAC-SHA256 of (notification URL + raw body) with the signature key, base64, header x-square-hmacsha256-signature
  const sig = req.headers.get("x-square-hmacsha256-signature") ?? "";
  if (!SIG_KEY) return true; // allow during setup; set the secret before going live
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIG_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(req.url + raw));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return b64 === sig;
}

function genKey() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const grp = () => Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join("");
  return `EVB-${grp()}-${grp()}-${grp()}`;
}

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
  const raw = await req.text();
  if (!(await validSignature(req, raw))) return new Response("bad signature", { status: 401 });
  const ev = JSON.parse(raw);
  const eventId = ev.event_id ?? crypto.randomUUID();
  const { error: dup } = await supabase.from("square_events").insert({ event_id: eventId, type: ev.type, payload: ev });
  if (dup) return new Response("duplicate", { status: 200 }); // already processed

  const obj = ev.data?.object ?? {};
  const sub = obj.subscription;
  if (sub) {
    const subId = sub.id as string;
    const customerId = sub.customer_id as string | undefined;
    const status = String(sub.status ?? "").toUpperCase(); // ACTIVE | CANCELED | DEACTIVATED | PAUSED | PENDING
    const mapped = status === "ACTIVE" ? "active" : status === "PAUSED" ? "past_due" : status === "PENDING" ? "active" : "cancelled";
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
      const key = genKey();
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
