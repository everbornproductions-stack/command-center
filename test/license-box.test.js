// Settings > Plan: one box for a licence key or a promo code, and plain errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = tmpDir("cc-unit-");
process.env.CC_MODE = "";
const { looksLikeLicenceKey, plainLicenceError } = await import("../server/license.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a license key is EVB-XXXX-XXXX-XXXX; promo codes are not keys", () => {
  assert.equal(looksLikeLicenceKey("EVB-AAAA-BBBB-CCCC"), true);
  assert.equal(looksLikeLicenceKey(" evb-a2b3-c4d5-e6f7 "), true);
  assert.equal(looksLikeLicenceKey("EVERBORN-OWNER"), false);
  assert.equal(looksLikeLicenceKey("TEST-ABCD-EFGH"), false);
});

test("license server replies become plain sentences", () => {
  assert.match(plainLicenceError("Code is invalid, used up, or expired", "code"), /^This code was already used/);
  assert.match(plainLicenceError("License key not found", "key"), /not found.*promo code/);
  assert.match(plainLicenceError("Enter the email this code is for", "code"), /Enter your email/);
});

const promoCloud = (calls) => ({
  rpc: (fn, body) => {
    calls.push({ fn, body });
    if (fn === "redeem_promo") {
      if (body.p_code === "EVERBORN-OWNER") return { key: "EVB-OWNR-AAAA-BBBB", tier: "owner", message: "ok" };
      return { key: null, tier: null, message: "Code is invalid, used up, or expired" };
    }
    if (fn === "verify_license") {
      if (body.p_key === "EVB-OWNR-AAAA-BBBB") return { ok: true, tier: "owner", status: "active", email: "chris@example.com", message: "ok" };
      return { ok: false, status: "unknown", message: "Licence key not found" };
    }
    return {};
  },
});

test("server: Redeem with an empty promo box says so and never activates", async () => {
  const calls = [];
  const s = await startServer({ cloud: promoCloud(calls) });
  try {
    const r = await s.api("/license", { method: "POST", body: { action: "redeem", code: "", key: "EVB-AAAA-BBBB-CCCC" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "Enter a promo code.");
    assert.equal(calls.filter((c) => c.fn === "verify_license" && c.body.p_key === "EVB-AAAA-BBBB-CCCC").length, 0);
    const empty = await s.api("/license", { method: "POST", body: {} });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error, "Enter your license key or promo code.");
  } finally { await s.stop(); }
});

test("server: a promo code typed in the key box is redeemed, not looked up as a key", async () => {
  const calls = [];
  const s = await startServer({ cloud: promoCloud(calls) });
  try {
    const noMail = await s.api("/license", { method: "POST", body: { key: "everborn-owner" } });
    assert.equal(noMail.status, 400);
    assert.match(noMail.json.error, /Enter your email/);
    const r = await s.api("/license", { method: "POST", body: { key: "everborn-owner", email: "chris@example.com" } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.tier, "owner");
    const redeem = calls.find((c) => c.fn === "redeem_promo");
    assert.equal(redeem.body.p_code, "EVERBORN-OWNER");
    assert.equal(calls.some((c) => c.fn === "verify_license" && c.body.p_key === "EVERBORN-OWNER"), false);
  } finally { await s.stop(); }
});

test("server: a used-up code says it was already used; an unknown key says not found", async () => {
  const calls = [];
  const s = await startServer({ cloud: promoCloud(calls) });
  try {
    const used = await s.api("/license", { method: "POST", body: { key: "TEST-ABCD-EFGH", email: "ada@example.com" } });
    assert.equal(used.status, 400);
    assert.match(used.json.error, /^This code was already used/);
    const unknown = await s.api("/license", { method: "POST", body: { key: "EVB-ZZZZ-ZZZZ-ZZZZ" } });
    assert.match(unknown.json.message, /license key was not found/);
  } finally { await s.stop(); }
});

test("Plan panel: one box, one Activate button, no separate Redeem row", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(app, /License key or promo code/);
  assert.match(app, /id="lic-go" data-busy-label="Checking\.\.\."/);
  assert.doesNotMatch(app, /id="lic-redeem"/);
  assert.doesNotMatch(app, /id="lic-code"/);
});
