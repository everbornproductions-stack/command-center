// (d) Square webhook logic module, imported straight into Node (no Deno needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySquareSignature, computeSquareSignature, mapSquareStatus, genLicenseKey, KEY_RE, timingSafeEqual } from "../supabase/functions/square-webhook/logic.js";

const KEY = "test-signature-key";
const URL_ = "https://ezbpstloczzdlcxwliwu.supabase.co/functions/v1/square-webhook";
const BODY = JSON.stringify({ event_id: "e1", type: "subscription.created", data: { object: { subscription: { id: "s1", status: "PENDING" } } } });
const sign = (key, url, body) => createHmac("sha256", key).update(url + body).digest("base64");

test("missing secret or URL → rejected as not configured", async () => {
  assert.deepEqual(await verifySquareSignature({ signatureKey: "", notificationUrl: URL_, rawBody: BODY, signature: sign(KEY, URL_, BODY) }), { ok: false, reason: "not_configured" });
  assert.deepEqual(await verifySquareSignature({ signatureKey: KEY, notificationUrl: "", rawBody: BODY, signature: sign(KEY, URL_, BODY) }), { ok: false, reason: "not_configured" });
});

test("bad or missing signature → rejected", async () => {
  assert.equal((await verifySquareSignature({ signatureKey: KEY, notificationUrl: URL_, rawBody: BODY, signature: "" })).ok, false);
  assert.equal((await verifySquareSignature({ signatureKey: KEY, notificationUrl: URL_, rawBody: BODY, signature: null })).reason, "missing_signature");
  assert.equal((await verifySquareSignature({ signatureKey: KEY, notificationUrl: URL_, rawBody: BODY, signature: sign("other-key", URL_, BODY) })).reason, "bad_signature");
  assert.equal((await verifySquareSignature({ signatureKey: KEY, notificationUrl: URL_, rawBody: BODY + " ", signature: sign(KEY, URL_, BODY) })).reason, "bad_signature");
  // signed over a different URL (what req.url behind a proxy would give) → rejected
  assert.equal((await verifySquareSignature({ signatureKey: KEY, notificationUrl: URL_, rawBody: BODY, signature: sign(KEY, "http://internal:8000/square-webhook", BODY) })).reason, "bad_signature");
});

test("good signature → accepted; our HMAC matches Node's", async () => {
  assert.equal(await computeSquareSignature({ signatureKey: KEY, notificationUrl: URL_, rawBody: BODY }), sign(KEY, URL_, BODY));
  assert.deepEqual(await verifySquareSignature({ signatureKey: KEY, notificationUrl: URL_, rawBody: BODY, signature: sign(KEY, URL_, BODY) }), { ok: true });
});

test("PENDING is not active", () => {
  assert.equal(mapSquareStatus("PENDING"), "pending");
  assert.notEqual(mapSquareStatus("PENDING"), "active");
  assert.equal(mapSquareStatus("ACTIVE"), "active");
  assert.equal(mapSquareStatus("active"), "active");
  assert.equal(mapSquareStatus("PAUSED"), "past_due");
  assert.equal(mapSquareStatus("CANCELED"), "cancelled");
  assert.equal(mapSquareStatus("DEACTIVATED"), "cancelled");
  assert.equal(mapSquareStatus(undefined), "cancelled");
});

test("licence keys match ^EVB(-[A-HJ-NP-Z2-9]{4}){3}$ and use the random bytes unbiased", () => {
  for (let i = 0; i < 200; i++) assert.match(genLicenseKey(), KEY_RE);
  assert.equal(genLicenseKey((n) => new Uint8Array(n)), "EVB-AAAA-AAAA-AAAA");
  assert.equal(genLicenseKey((n) => new Uint8Array(n).fill(31)), "EVB-9999-9999-9999");
  assert.equal(genLicenseKey((n) => new Uint8Array(n).fill(32)), "EVB-AAAA-AAAA-AAAA"); // & 31 wraps, no modulo bias
  assert.equal(genLicenseKey((n) => new Uint8Array(n).fill(255)), "EVB-9999-9999-9999");
  assert.doesNotMatch(genLicenseKey(), /[0O1I]/);
});

test("timingSafeEqual compares correctly for equal and unequal lengths", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
});
