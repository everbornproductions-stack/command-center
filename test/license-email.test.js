// Unlock by the signed-in email, the verified email from an id_token, the "I paid" re-check timer,
// and the guard that keeps Square out of server/, web/ and supabase/. A local licence stub stands in
// for Supabase. Nothing calls Stripe. Waits are real timers.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { emailFromIdToken } from "../server/signed-in-email.js";
import { createPaidWatch, rankOf, WATCH_EVERY_MS, WATCH_FOR_MS } from "../web/paid-watch.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL = "buyer@example.com";
const writeIdentity = (dir) => fs.writeFileSync(path.join(dir, "signin-identity.json"), JSON.stringify({ email: EMAIL, provider: "google", at: 1 }));

// Seal vault.bin the way the app does (server/vault.js): DPAPI on Windows, the test keychain stand-in
// (test/vault-shim.cjs) elsewhere. The licence session lives only there.
function sealVault(obj) {
  const plain = JSON.stringify(obj);
  if (process.platform === "win32") {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes($env:CC_VAULT_IN); [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))"],
    { env: { ...process.env, CC_VAULT_IN: plain }, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, "could not seal the test vault");
    return r.stdout.trim();
  }
  const key = crypto.createHash("sha256").update("command-ai-test-vault").digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "ss1:" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
const seedSession = (dir, { access = "tok_live", refresh = "ref_live", expiresInMs = 3600 * 1000 } = {}) =>
  fs.writeFileSync(path.join(dir, "vault.bin"), sealVault({ "licence-session": { key: "session", access, refresh, expiresAt: Date.now() + expiresInMs } }));
// identity only: signed in, but no session the licence server can verify
const seedIdentity = writeIdentity;
// identity plus a signed licence session
const seedProved = (opts) => (dir) => { writeIdentity(dir); seedSession(dir, opts); };
const seedKeyAndIdentity = (tier) => (dir) => {
  seedProved()(dir);
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null }));
};

async function waitFor(s, test) {
  let st;
  for (let i = 0; i < 60; i++) {
    st = await s.api("/state");
    if (test(st.json.license)) return st.json.license;
    await sleep(100);
  }
  throw new Error(`never reached: ${JSON.stringify(st.json.license)}`);
}

const jwt = (claims) => `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

test("the verified email comes from the id_token: Google needs email_verified, Microsoft needs a personal account or a verified domain", () => {
  assert.equal(emailFromIdToken(jwt({ email: "Pat@Example.com", email_verified: true }), "google"), "pat@example.com");
  assert.equal(emailFromIdToken(jwt({ email: "pat@example.com", email_verified: "true" }), "google"), "pat@example.com");
  assert.equal(emailFromIdToken(jwt({ email: "pat@example.com", email_verified: false }), "google"), null);
  assert.equal(emailFromIdToken(jwt({ email: "pat@example.com" }), "google"), null);
  assert.equal(emailFromIdToken(jwt({ email: "pat@example.com" }), "microsoft"), null, "no personal tenant, no verified domain");
  assert.equal(emailFromIdToken(jwt({ preferred_username: "pat@outlook.com", tid: "9188040d-6c67-4c5b-b112-36a304b66dad" }), "microsoft"), "pat@outlook.com");
  assert.equal(emailFromIdToken(jwt({ email: "pat@corp.example", xms_edov: true }), "microsoft"), "pat@corp.example");
  assert.equal(emailFromIdToken(jwt({ email: "not-an-email", email_verified: true }), "google"), null);
  assert.equal(emailFromIdToken("garbage", "google"), null);
  assert.equal(emailFromIdToken(undefined, "google"), null);
  assert.equal(emailFromIdToken(jwt({ email: "pat@example.com", email_verified: true }), "github"), null);
});

test("a paid license on the signed-in email unlocks with no key, never sends or logs the key, and the pay links carry the email", async () => {
  const box = { ok: true, tier: "extreme", plan: "extreme-monthly" };
  const s = await startServer({
    cloud: { rpc: (fn, body) => (fn === "activate_license_by_email"
      ? (box.ok ? { ok: true, tier: box.tier, status: "active", email: body.p_email, period_end: null, devices: 0, max_devices: 2, message: "ok", plan: box.plan }
        : { ok: false, tier: "free", status: "unknown", message: "No active licence on this email yet" })
      : { ok: false, tier: "free", status: "unknown", message: "stub: not found" }) },
    seed: seedProved(),
  });
  try {
    const lic = await waitFor(s, (l) => l.tier === "extreme");
    assert.equal(lic.plan, "extreme-monthly");
    assert.equal(lic.key, null);
    assert.equal(lic.unlockEmail, EMAIL);
    assert.equal(lic.canUnlockByEmail, true);
    const call = s.stub.hits.find((h) => h.path.endsWith("/rpc/activate_license_by_email"));
    assert.ok(call, "the license server was asked by email");
    assert.equal(call.body.p_email, EMAIL);
    assert.equal(call.headers.authorization, "Bearer tok_live", "the call carries the signed session, not just the publishable key");
    assert.ok(call.body.p_device_id);
    assert.equal(s.stub.hits.some((h) => /verify_license/.test(h.path)), false, "no key was checked");
    assert.equal(s.log.includes(EMAIL), false, "the email is not logged");

    const plans = (await s.api("/billing-plans")).json;
    assert.equal(new URL(plans.monthly.payLink).searchParams.get("prefilled_email"), EMAIL);
    assert.equal(new URL(plans.developerYearly.payLink).searchParams.get("prefilled_email"), EMAIL);

    // The plan ends on the server: the next check drops this copy to Free.
    box.ok = false;
    assert.equal((await s.api("/license/recheck", { method: "POST" })).status, 200);
    const gone = await waitFor(s, (l) => l.tier === "free");
    assert.equal(gone.unlockEmail, null);
  } finally { await s.stop(); }
});

test("a license server that is down keeps the unlocked tier for the grace period", async () => {
  const box = { down: false };
  const s = await startServer({
    cloud: { rpc: (fn, body) => (box.down ? { httpStatus: 500, rows: [{ message: "down" }] }
      : { ok: true, tier: "pro", status: "active", email: body.p_email, period_end: new Date(Date.now() + 20 * 86400000).toISOString(), devices: 0, max_devices: 2, message: "ok", plan: "pro-yearly" }) },
    seed: seedProved(),
  });
  try {
    await waitFor(s, (l) => l.tier === "pro");
    box.down = true;
    await s.api("/license/recheck", { method: "POST" });
    await sleep(300);
    const st = (await s.api("/state")).json.license;
    assert.equal(st.tier, "pro");
    assert.match(st.message, /unreachable/);
  } finally { await s.stop(); }
});

test("a key stays unless the email license is a higher tier", async () => {
  const email = { tier: "pro" };
  const s = await startServer({
    cloud: { rpc: (fn, body) => (fn === "verify_license"
      ? { ok: true, tier: "pro", status: "active", email: "k@example.com", period_end: null, devices: 1, max_devices: 2, message: "ok" }
      : { ok: true, tier: email.tier, status: "active", email: body.p_email, period_end: null, devices: 0, max_devices: 2, message: "ok", plan: `${email.tier}-monthly` }) },
    seed: seedKeyAndIdentity(),
  });
  try {
    const first = await waitFor(s, (l) => l.tier === "pro" && l.key);
    assert.ok(first.key, "the key license is kept when the email license is not higher");
    assert.equal(first.unlockEmail, null);
    email.tier = "extreme";
    await s.api("/license/recheck", { method: "POST" });
    const up = await waitFor(s, (l) => l.tier === "extreme");
    assert.equal(up.unlockEmail, EMAIL);
  } finally { await s.stop(); }
});

test("signed in but with no verified session, the plan is never asked by email", async () => {
  const s = await startServer({
    cloud: { rpc: (fn, body) => ({ ok: true, tier: "extreme", status: "active", email: body.p_email, period_end: null, devices: 0, max_devices: 2, message: "ok", plan: "extreme-monthly" }) },
    seed: seedIdentity,
  });
  try {
    const r = await s.api("/license/recheck", { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(r.json.tier, "free", "an address alone unlocks nothing");
    assert.match(r.json.message, /Sign in again/);
    assert.equal(s.stub.hits.some((h) => /activate_license_by_email/.test(h.path)), false, "no lookup without proof");
  } finally { await s.stop(); }
});

test("an expired session is refreshed first; a refused refresh means no lookup", async () => {
  const box = { refreshOk: true };
  const s = await startServer({
    cloud: {
      rpc: (fn, body) => ({ ok: true, tier: "pro", status: "active", email: body.p_email, period_end: null, devices: 0, max_devices: 2, message: "ok", plan: "pro-monthly" }),
      auth: (grant, body) => (grant === "refresh_token" && body.refresh_token === "ref_live" && box.refreshOk
        ? { access_token: "tok_new", refresh_token: "ref_new", expires_in: 3600 }
        : { httpStatus: 400, body: { error: "invalid_grant" } }),
    },
    seed: seedProved({ expiresInMs: -1000 }),
  });
  try {
    await waitFor(s, (l) => l.tier === "pro");
    const call = s.stub.hits.find((h) => h.path.endsWith("/rpc/activate_license_by_email"));
    assert.equal(call.headers.authorization, "Bearer tok_new");
    assert.ok(s.stub.hits.some((h) => h.path === "/auth/v1/token"), "the session was refreshed");
    assert.equal(s.log.includes("tok_new") || s.log.includes("ref_new"), false, "tokens are not logged");
  } finally { await s.stop(); }

  const s2 = await startServer({
    cloud: { rpc: () => ({ ok: true, tier: "pro", status: "active" }), auth: () => ({ httpStatus: 400, body: { error: "invalid_grant" } }) },
    seed: seedProved({ expiresInMs: -1000 }),
  });
  try {
    const r = await s2.api("/license/recheck", { method: "POST" });
    assert.equal(r.json.tier, "free");
    assert.equal(s2.stub.hits.some((h) => /activate_license_by_email/.test(h.path)), false);
  } finally { await s2.stop(); }
});

test("licence-session: id_token exchange, token reuse and refresh talk to the Auth endpoint and keep tokens only in the store", async () => {
  const { exchangeIdToken, sessionToken, SESSION_VAULT_ID } = await import("../server/licence-session.js");
  const cloud = { url: "https://example.supabase.test/", anonKey: "sb_publishable_test" };
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push({ url, body: JSON.parse(o.body), headers: o.headers }); return { ok: true, json: async () => ({ access_token: "a1", refresh_token: "r1", expires_in: 3600 }) }; };
  const store = {};
  const save = async (id, v) => { if (v) store[id] = v; else delete store[id]; };
  const read = (id) => store[id] || null;
  const NOW = 1_000_000;

  assert.equal(await exchangeIdToken({ cloud, provider: "github", idToken: "x", fetchImpl, save }), false, "only Google and Microsoft");
  assert.equal(await exchangeIdToken({ cloud, provider: "google", idToken: "", fetchImpl, save }), false);
  assert.equal(calls.length, 0);
  assert.equal(await exchangeIdToken({ cloud, provider: "microsoft", idToken: "idt", fetchImpl, save, now: NOW }), true);
  assert.equal(calls[0].url, "https://example.supabase.test/auth/v1/token?grant_type=id_token");
  assert.deepEqual(calls[0].body, { provider: "azure", id_token: "idt" });
  assert.equal(calls[0].headers.apikey, "sb_publishable_test");
  assert.deepEqual(store[SESSION_VAULT_ID], { key: "session", access: "a1", refresh: "r1", expiresAt: NOW + 3600 * 1000 });
  assert.equal(JSON.stringify(store).includes("idt"), false, "the id_token is not kept");

  assert.equal(await sessionToken({ cloud, fetchImpl, read, save, now: NOW + 1000 }), "a1");
  assert.equal(calls.length, 1, "a fresh token is reused");
  assert.equal(await sessionToken({ cloud, fetchImpl, read, save, now: NOW + 3600 * 1000 }), "a1", "refreshed");
  assert.equal(calls[1].url, "https://example.supabase.test/auth/v1/token?grant_type=refresh_token");
  assert.deepEqual(calls[1].body, { refresh_token: "r1" });

  const refused = async () => ({ ok: false, json: async () => ({ error: "bad" }) });
  assert.equal(await sessionToken({ cloud, fetchImpl: refused, read, save, now: NOW + 99 * 3600 * 1000 }), null);
  assert.equal(store[SESSION_VAULT_ID], undefined, "a refused refresh drops the session");
  assert.equal(await sessionToken({ cloud, fetchImpl, read, save }), null, "no session, no token");
});

test("without a signed-in email nothing is asked by email, and the I paid check says to sign in", async () => {
  const s = await startServer({ cloud: { rpc: () => ({ ok: false, tier: "free", status: "unknown", message: "stub: not found" }) } });
  try {
    const r = await s.api("/license/recheck", { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(r.json.tier, "free");
    assert.equal(r.json.canUnlockByEmail, false);
    assert.equal(s.stub.hits.some((h) => /activate_license_by_email/.test(h.path)), false);
  } finally { await s.stop(); }
});

// ---------- the I paid timer (web/paid-watch.js) ----------

function fakeClock() {
  let t = 1_000_000;
  const timers = new Set();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, ms, at: t + ms }; timers.add(h); return h; },
    clearTimer: (h) => timers.delete(h),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers].filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        t = next.at; next.at += next.ms; next.fn();
      }
      t = end;
    },
    get open() { return timers.size; },
  };
}
const flush = () => new Promise((r) => setImmediate(r));

test("after an Upgrade click the check runs every few seconds for two minutes, then stops", async () => {
  const clock = fakeClock();
  let calls = 0;
  const w = createPaidWatch({ check: async () => { calls++; return { tier: "free", status: null }; }, current: () => ({ tier: "free" }), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  assert.equal(clock.open, 0, "no timer before the click");
  w.start();
  assert.equal(w.watching, true);
  for (let i = 0; i < 10; i++) { clock.advance(WATCH_EVERY_MS); await flush(); }
  assert.equal(calls, 10);
  clock.advance(WATCH_FOR_MS); await flush();
  assert.equal(w.watching, false, "stopped after two minutes");
  assert.equal(clock.open, 0);
  const done = calls;
  clock.advance(60000); await flush();
  assert.equal(calls, done);
});

test("the watch stops and reports the unlock when the tier goes up", async () => {
  const clock = fakeClock();
  let tier = "free", unlocked = null;
  const w = createPaidWatch({
    check: async () => ({ tier, status: tier === "free" ? null : "active" }),
    current: () => ({ tier: "free" }), onUnlock: (l) => { unlocked = l; },
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  w.start();
  clock.advance(WATCH_EVERY_MS); await flush();
  assert.equal(unlocked, null);
  tier = "pro";
  clock.advance(WATCH_EVERY_MS); await flush();
  assert.equal(unlocked.tier, "pro");
  assert.equal(w.watching, false);
  assert.equal(clock.open, 0);
});

test("window focus checks right away on Free and Pro, not more than once per interval, and not on Extreme", async () => {
  const clock = fakeClock();
  let calls = 0;
  let cur = { tier: "free", status: null };
  const w = createPaidWatch({ check: async () => { calls++; return cur; }, current: () => cur, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  await w.focus();
  assert.equal(calls, 1);
  await w.focus();
  assert.equal(calls, 1, "rate limited");
  clock.advance(WATCH_EVERY_MS + 1);
  await w.focus();
  assert.equal(calls, 2);
  cur = { tier: "extreme", status: "active" };
  clock.advance(WATCH_EVERY_MS + 1);
  assert.equal(await w.focus(), null, "already on the top public tier");
  assert.equal(calls, 2);
  assert.equal(rankOf({ tier: "pro", status: "cancelled" }), 0);
  assert.equal(rankOf({ tier: "extreme", status: "active" }), 2);
});

// ---------- Square is gone ----------

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === ".git") continue;
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("square.link, squareup and SQUARE_ appear nowhere in server/, web/ or supabase/ (old migrations excepted)", () => {
  const OLD_MIGRATIONS = /[\\/]supabase[\\/]migrations[\\/](?!20261025_)/;
  const files = ["server", "web", "supabase"].flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => !OLD_MIGRATIONS.test(f))
    .filter((f) => /\.(js|mjs|cjs|ts|html|css|json|sql|md|txt)$/i.test(f));
  assert.ok(files.length > 50, "the scan found the source files");
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (/square\.link|squareup/i.test(text) || /SQUARE_/.test(text)) bad.push(path.relative(ROOT, f));
  }
  assert.deepEqual(bad, []);
  assert.equal(fs.existsSync(path.join(ROOT, "supabase", "functions", "square-webhook")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "supabase", "functions", "stripe-webhook", "index.ts")), true);
});

test("the Stripe migration adds the Stripe columns and tables with row level security, drops Square, and holds no secret", () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261025_stripe.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.stripe_events/);
  assert.match(sql, /alter table public\.stripe_events enable row level security/);
  assert.match(sql, /add column if not exists stripe_customer_id/);
  assert.match(sql, /add column if not exists stripe_subscription_id/);
  assert.match(sql, /drop column if exists square_customer_id/);
  assert.match(sql, /drop column if exists square_subscription_id/);
  assert.match(sql, /drop table if exists public\.square_events/);
  assert.match(sql, /function public\.find_active_license_by_email/);
  assert.match(sql, /revoke all on function public\.find_active_license_by_email\(text\) from public, anon, authenticated/);
  assert.match(sql, /function public\.activate_license_by_email/);
  assert.doesNotMatch(sql, /whsec_|sk_live|sk_test|rk_live/);
  // Proof: the 0.4.19 migration reads the email from the signed session and shuts anon out.
  const proof = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261026_stripe_unlock_proof.sql"), "utf8");
  assert.match(proof, /auth\.uid\(\)/);
  assert.match(proof, /email_confirmed_at is not null/);
  assert.match(proof, /revoke all on function public\.activate_license_by_email\(text, text, text, text, text\) from public, anon/);
  assert.match(proof, /grant execute on function public\.activate_license_by_email\(text, text, text, text, text\) to authenticated/);
  assert.doesNotMatch(proof, /to anon/);
  assert.equal((proof.match(/No active licence on this email yet/g) || []).length, 2, "every miss gives the same reply");
  const schema = fs.readFileSync(path.join(ROOT, "supabase", "schema.sql"), "utf8");
  assert.match(schema, /stripe_events/);
  assert.match(schema, /alter table public\.stripe_events enable row level security/);
  assert.doesNotMatch(schema, /square_/i);
  // The function reads the secret from the environment only.
  const index = fs.readFileSync(path.join(ROOT, "supabase", "functions", "stripe-webhook", "index.ts"), "utf8");
  assert.match(index, /Deno\.env\.get\("STRIPE_WEBHOOK_SECRET"\)/);
  assert.doesNotMatch(index + fs.readFileSync(path.join(ROOT, "supabase", "functions", "stripe-webhook", "logic.js"), "utf8"), /whsec_[A-Za-z0-9]{8,}/);
});
