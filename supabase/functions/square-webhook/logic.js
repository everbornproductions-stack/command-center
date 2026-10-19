// Pure logic for the Square webhook, shared by the Deno edge function (index.ts) and the Node
// tests (test/webhook.test.js). Web standard APIs only (crypto.subtle, TextEncoder, btoa): no
// Deno- or Node-specific imports, so both runtimes can import this file as is.

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

// Square subscription status → licences.status. Only ACTIVE grants access; PENDING is a
// subscription that has not been paid yet and must not unlock anything.
export function mapSquareStatus(status) {
  switch (String(status ?? "").toUpperCase()) {
    case "ACTIVE": return "active";
    case "PENDING": return "pending";
    case "PAUSED": return "past_due";
    default: return "cancelled"; // CANCELED, DEACTIVATED, anything unknown
  }
}

// Square signs base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)) into x-square-hmacsha256-signature.
export async function computeSquareSignature({ signatureKey, notificationUrl, rawBody }) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(signatureKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(notificationUrl + rawBody));
  return toBase64(new Uint8Array(mac));
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

// { ok: true } or { ok: false, reason: "not_configured" | "missing_signature" | "bad_signature" }.
// notificationUrl must be the exact URL registered in Square (from SQUARE_WEBHOOK_URL), never req.url.
export async function verifySquareSignature({ signatureKey, notificationUrl, rawBody, signature }) {
  if (!signatureKey || !notificationUrl) return { ok: false, reason: "not_configured" };
  if (!signature) return { ok: false, reason: "missing_signature" };
  const expected = await computeSquareSignature({ signatureKey, notificationUrl, rawBody: rawBody ?? "" });
  return timingSafeEqual(expected, String(signature).trim()) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

function toBase64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
