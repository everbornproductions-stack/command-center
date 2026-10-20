// (a) No cloud config means Free, not Owner. Unit tests on the pure tier logic plus the running server.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir } from "./helpers.js";

// license.js imports paths.js, which creates the data dir at import time: point it at a temp folder first.
process.env.CC_DATA_DIR = tmpDir("cc-unit-");
process.env.CC_MODE = "";
const { resolveTier, devOwnerAllowed, GRACE_MS, TIERS } = await import("../server/license.js");

const DAY = 86400000;
const now = Date.UTC(2026, 9, 18, 12);

test("resolveTier: nothing known → free, never owner", () => {
  assert.equal(resolveTier({ lic: null, now }).tier, "free");
  assert.equal(resolveTier({ lic: { tier: null, status: null }, now }).tier, "free");
  assert.equal(resolveTier({ lic: { tier: "pro", status: "pending", lastOkAt: now }, now }).tier, "free");
  assert.equal(resolveTier({ lic: { tier: "pro", status: "cancelled", lastOkAt: now }, now }).tier, "free");
  assert.equal(resolveTier({ lic: { tier: "owner", status: "revoked", lastOkAt: now }, now }).tier, "free");
});

test("resolveTier: an active licence row gives its tier, including owner", () => {
  assert.equal(resolveTier({ lic: { tier: "pro", status: "active", lastOkAt: now - DAY }, now }).tier, "pro");
  assert.equal(resolveTier({ lic: { tier: "owner", status: "active", lastOkAt: now - DAY }, now }).tier, "owner");
  assert.equal(resolveTier({ lic: { tier: "pro", status: "active", lastOkAt: now - DAY }, now }).reason, "active");
});

test("resolveTier: offline grace keeps the tier until period end or 7 days, whichever is sooner, then free", () => {
  const base = { tier: "pro", status: "active", lastError: "fetch failed" };
  assert.equal(resolveTier({ lic: { ...base, lastOkAt: now - 2 * DAY, periodEnd: new Date(now + 20 * DAY).toISOString() }, now }).tier, "pro");
  assert.equal(resolveTier({ lic: { ...base, lastOkAt: now - 2 * DAY, periodEnd: new Date(now + 20 * DAY).toISOString() }, now }).reason, "grace");
  // period ended yesterday → free even though the last check was recent
  assert.equal(resolveTier({ lic: { ...base, lastOkAt: now - 2 * DAY, periodEnd: new Date(now - DAY).toISOString() }, now }).tier, "free");
  // 8 days since the last good check → free even though the period runs on
  assert.equal(resolveTier({ lic: { ...base, lastOkAt: now - GRACE_MS - DAY, periodEnd: new Date(now + 20 * DAY).toISOString() }, now }).tier, "free");
  assert.equal(resolveTier({ lic: { ...base, lastOkAt: now - GRACE_MS - DAY }, now }).reason, "grace_expired");
  // no period end known (promo licence): 7 days from the last good check
  assert.equal(resolveTier({ lic: { ...base, lastOkAt: now - 6 * DAY }, now }).tier, "pro");
  assert.equal(resolveTier({ lic: { ...base, lastOkAt: now - 8 * DAY }, now }).tier, "free");
});

test("resolveTier: owner email and dev override", () => {
  assert.equal(resolveTier({ lic: null, now, ownerEmail: true }).tier, "owner");
  assert.equal(resolveTier({ lic: null, now, devOwner: true }).tier, "owner");
});

test("devOwnerAllowed: needs CC_DEV_OWNER=1 and is ignored when packaged", () => {
  assert.equal(devOwnerAllowed({ CC_DEV_OWNER: "1" }, false), true);
  assert.equal(devOwnerAllowed({ CC_DEV_OWNER: "1" }, true), false);
  assert.equal(devOwnerAllowed({ CC_DEV_OWNER: "true" }, false), false);
  assert.equal(devOwnerAllowed({}, false), false);
});

test("TIERS: free is the limited tier", () => {
  assert.equal(TIERS.free.missions, false);
  assert.equal(TIERS.free.councilsPerMonth, 5);
  assert.equal(TIERS.free.projects, 3);
  assert.equal(TIERS.free.connectedServices, 1);
  assert.equal(TIERS.free.emailAccounts, 1);
  assert.equal(TIERS.free.phone, false);
  assert.equal(TIERS.free.historySearch, false);
  assert.equal(TIERS.free.sharedLearning, false);
  assert.equal(TIERS.free.scores, false);
  assert.equal(TIERS.pro.connectedServices, Infinity);
  assert.equal(TIERS.pro.emailAccounts, 8);
  assert.equal(TIERS.pro.phone, true);
  assert.equal(TIERS.free.subscriptionsTab, false);
});

test("server: no cloud configured → tier free; empty cloud values → 400 and tier unchanged", async () => {
  const s = await startServer();
  try {
    const st = await s.api("/state");
    assert.equal(st.status, 200);
    assert.equal(st.json.license.tier, "free");
    assert.equal(st.json.license.configured, false);
    assert.equal(st.json.license.limits.missions, false);

    const empty = await s.api("/cloud", { method: "POST", body: { url: "", anonKey: "" } });
    assert.equal(empty.status, 400);
    assert.match(empty.json.error, /required/i);
    const urlOnly = await s.api("/cloud", { method: "POST", body: { url: "https://example.supabase.co" } });
    assert.equal(urlOnly.status, 400);
    const keyOnly = await s.api("/cloud", { method: "POST", body: { anonKey: "sb_publishable_x" } });
    assert.equal(keyOnly.status, 400);

    const after = await s.api("/state");
    assert.equal(after.json.license.tier, "free");
    assert.equal(after.json.settings.cloud, undefined);
    // settings.json on disk did not get a cloud block either
    const settingsFile = path.join(s.dir, "settings.json");
    if (fs.existsSync(settingsFile)) assert.equal(JSON.parse(fs.readFileSync(settingsFile, "utf8")).cloud, undefined);
  } finally { await s.stop(); }
});

test("server: shipped defaults are used when settings are empty (licence check goes to the shipped URL)", async () => {
  const s = await startServer({
    cloud: { rpc: (fn) => (fn === "verify_license" ? { ok: true, tier: "pro", status: "active", email: "t@example.com", period_end: null, message: "ok" } : {}) },
    seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null })),
  });
  try {
    let st;
    for (let i = 0; i < 40; i++) { st = await s.api("/state"); if (st.json.license.tier === "pro") break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(st.json.license.configured, true);
    assert.equal(st.json.license.cloudSource, "shipped");
    assert.equal(st.json.license.tier, "pro");
    const hit = s.stub.hits.find((h) => h.path === "/rest/v1/rpc/verify_license");
    assert.ok(hit, "verify_license was called on the shipped URL");
    assert.equal(hit.headers.apikey, "sb_publishable_test");
    assert.equal(hit.body.p_key, "EVB-AAAA-BBBB-CCCC");
  } finally { await s.stop(); }
});

test("server: changing the cloud project never raises the tier (verified tier is reset)", async () => {
  const s = await startServer({
    cloud: { rpc: () => ({ ok: true, tier: "pro", status: "active", email: "t@example.com", message: "ok" }) },
    seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null })),
  });
  try {
    let st;
    for (let i = 0; i < 40; i++) { st = await s.api("/state"); if (st.json.license.tier === "pro") break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(st.json.license.tier, "pro");
    // point at a project that does not answer: the tier must drop, not stay pro
    const r = await s.api("/cloud", { method: "POST", body: { url: "http://127.0.0.1:9/", anonKey: "sb_publishable_other" } });
    assert.equal(r.status, 200);
    assert.notEqual(r.json.license.tier, "owner");
    assert.equal(r.json.license.tier, "free");
  } finally { await s.stop(); }
});

test("server: CC_DEV_OWNER=1 gives owner only when not packaged", async () => {
  const dev = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try { assert.equal((await dev.api("/state")).json.license.tier, "owner"); } finally { await dev.stop(); }
  const packaged = await startServer({ env: { CC_DEV_OWNER: "1", CC_PACKAGED: "1" } });
  try { assert.equal((await packaged.api("/state")).json.license.tier, "free"); } finally { await packaged.stop(); }
});
