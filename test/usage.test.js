// Anonymous usage counts: the daily ping, the off switch, and the owner report.
// Waits are real timers. Every server and stub is closed, and the temp data dir is removed.
// No real URL, no service key from production, no Stripe call.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { startServer, freePort, ROOT } from "./helpers.js";
import { buildReport, usesFromEvent, validatePing, SHARE_LABEL } from "../server/usage.js";
import { METRICS_PRICES, monthlyCents } from "../server/metrics-prices.js";

const EM = "\u2014";
const TODAY = new Date().toISOString().slice(0, 10);
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}
function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    setTimeout(resolve, 1000);
  });
}

test("report math: cohorts, activity, features, paying users, and no personal data", () => {
  assert.equal(METRICS_PRICES.pro.monthly, 18.99);
  assert.equal(METRICS_PRICES.pro.yearly, 189);
  assert.equal(METRICS_PRICES.extreme.monthly, 29.99);
  assert.equal(METRICS_PRICES.extreme.yearly, 299);
  assert.equal(monthlyCents("pro", "yearly") / 100, 15.75);
  assert.equal(monthlyCents("extreme", "yearly") / 100, 24.92);
  assert.deepEqual(METRICS_PRICES.lifetime, { 349: 349, 499: 499 });
  assert.equal(METRICS_PRICES.legacyTier.studio, "extreme");
  const report = buildReport({
    asOf: "2026-10-21",
    pings: [
      { installId: "a".repeat(32), day: "2026-09-01", version: "0.4.7", os: "win32", tier: "free", features: { single: 1 } },
      { installId: "a".repeat(32), day: "2026-09-08", version: "0.4.8", os: "win32", tier: "pro", features: { council: 2 } },
      { installId: "a".repeat(32), day: "2026-09-29", version: "0.4.8", os: "win32", tier: "pro", features: { council: 3 } },
      { installId: "b".repeat(32), day: "2026-09-01", version: "0.4.7", os: "darwin", tier: "free", features: { single: 1 } },
      { installId: "c".repeat(32), day: "2026-10-20", version: "0.4.8", os: "linux", tier: "free", features: { mission: 4 } },
      { installId: "d".repeat(32), day: "2026-10-21", version: "0.4.8", os: "win32", tier: "studio", features: { council: 2, single: 2 } },
      { installId: "e".repeat(32), day: "2026-10-22", version: "0.4.8", os: "linux", tier: "pro", features: { council: 9 } },
    ],
    licenses: [
      { tier: "pro", status: "active", source: "stripe" },
      { tier: "pro", status: "active", source: "promo" },
      { tier: "owner", status: "active", source: "promo" },
      { tier: "studio", status: "active", source: "manual" },
      { tier: "pro", status: "past_due", source: "stripe" },
      { tier: "pro", status: "cancelled", source: "stripe" },
      { tier: "free", status: "active", source: "stripe" },
      { tier: "pro", status: "active", source: "stripe", email: "hidden@example.com", key: "EVB-AAAA-BBBB-CCCC" },
      { tier: "pro", status: "active", source: "stripe", plan: "pro-yearly" },
      { tier: "studio", status: "active", source: "manual", plan: "extreme-yearly" },
      { tier: "pro", status: "active", source: "manual", plan: "lifetime-349" },
      { tier: "studio", status: "active", source: "stripe", plan: "lifetime-499" },
      { tier: "pro", status: "active", source: "promo", plan: "lifetime-349" },
      { tier: "pro", status: "active", source: "stripe", plan: "mystery" },
    ],
  });
  assert.equal(report.dau, 1);
  assert.equal(report.wau, 2);
  assert.equal(report.mau, 3);
  assert.equal(report.windows.wau.from, "2026-10-15");
  assert.equal(report.windows.mau.from, "2026-09-22");
  const older = report.retention.find((c) => c.week === "2026-08-31");
  assert.equal(older.installs, 2);
  assert.deepEqual(older.week1, { retained: 1, rate: 0.5 });
  assert.deepEqual(older.week4, { retained: 1, rate: 0.5 });
  const recent = report.retention.find((c) => c.week === "2026-10-19");
  assert.equal(recent.installs, 2);
  assert.equal(recent.week1, null);
  assert.equal(recent.week4, null);
  assert.deepEqual(report.installsByVersion, { "0.4.8": 3, "0.4.7": 1 });
  assert.deepEqual(report.installsByOs, { win32: 2, darwin: 1, linux: 1 });
  assert.deepEqual(report.activeByTier, { free: 1, pro: 0, extreme: 1, owner: 0 });
  assert.deepEqual(report.topFeatures, [
    { feature: "mission", count: 4 },
    { feature: "council", count: 2 },
    { feature: "single", count: 2 },
  ]);
  assert.equal(report.payingUsers, 5);
  assert.equal(report.pastDue, 1);
  const expectedMrr = (
    monthlyCents("pro", "monthly") * 2
    + monthlyCents("extreme", "monthly")
    + monthlyCents("pro", "yearly")
    + monthlyCents("extreme", "yearly")
  ) / 100;
  assert.equal(report.mrrUsd, expectedMrr);
  assert.equal(report.mrrUsd, 108.64);
  assert.equal(report.lifetimeCount, 2);
  assert.equal(report.lifetimeRevenueUsd, 848);
  assert.deepEqual(report.lifetimeByPrice, {
    349: { count: 1, revenueUsd: 349 },
    499: { count: 1, revenueUsd: 499 },
  });
  assert.match(report.mrrNote, /\$18\.99/);
  assert.match(report.mrrNote, /\$29\.99/);
  assert.match(report.mrrNote, /\$24\.92/);
  assert.match(report.mrrNote, /\$349 or \$499/);
  assert.match(report.mrrNote, /add 0 to MRR/);
  assert.match(report.mrrNote, /legacy name for Extreme/);
  assert.match(report.mrrNote, /does not call Stripe/);
  const dumped = JSON.stringify(report);
  assert.equal(dumped.includes("a".repeat(32)), false);
  assert.equal(dumped.includes("hidden@example.com"), false);
  assert.equal(dumped.includes("EVB-AAAA"), false);
  assert.equal(dumped.includes(EM), false);
});

test("a ping with an email, a prompt, or a file is refused, and events keep counts only", () => {
  const ok = validatePing({
    installId: "a".repeat(32), version: "0.4.8", os: "linux", tier: "free", day: TODAY, features: { council: 1 },
  });
  assert.equal(ok.ok, true);
  assert.equal(validatePing({ ...ok.value, email: "a@b.c" }).ok, false);
  assert.equal(validatePing({ ...ok.value, prompt: "hello" }).ok, false);
  assert.equal(validatePing({ ...ok.value, files: ["note.txt"] }).ok, false);
  assert.equal(validatePing({ ...ok.value, features: { email: 1 } }).ok, false);
  assert.equal(validatePing({ ...ok.value, features: { council: 1.5 } }).ok, false);
  const uses = usesFromEvent({
    type: "mission.update",
    mission: { id: "s-1", kind: "single", prompt: "write my private note", searchEngine: "demo", deliverable: "secret text" },
  });
  assert.deepEqual(uses, [{ feature: "single", id: "s-1" }, { feature: "search", id: "s-1" }]);
  assert.equal(JSON.stringify(uses).includes("private"), false);
  assert.equal(JSON.stringify(uses).includes("secret"), false);
});

test("the migration is insert-only and the switch is disclosed", () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261021_usage_pings.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.usage_pings/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for insert/);
  assert.match(sql, /grant insert on table public\.usage_pings to anon, authenticated/);
  assert.match(sql, /record_usage_ping/);
  assert.match(sql, /not been run/);
  assert.doesNotMatch(sql, /for select/);
  assert.doesNotMatch(sql, /grant select/i);
  assert.doesNotMatch(sql, /email\s+text/);
  assert.match(sql, /'email'/);
  assert.equal(sql.includes(EM), false);
  const files = [
    "server/usage.js", "web/features/usage.js",
    "docs/legal/privacy.md", "docs/help/privacy.md", "docs/help/getting-started.md",
    "docs/USER-GUIDE.md", "docs/WHATS-NEW.json", "docs/legal/shared-learning.md",
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(text.includes(SHARE_LABEL), true, rel);
    assert.equal(text.includes(EM), false, rel);
  }
  const usage = fs.readFileSync(path.join(ROOT, "server", "usage.js"), "utf8");
  assert.doesNotMatch(usage, /square\.link|squareup|SQUARE_/);
  assert.doesNotMatch(usage, /billing-plans|18\.99|29\.99|24\.92|15\.99|\b349\b|\b499\b|\b189\b/);
  const planSql = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261021_license_plan.sql"), "utf8");
  assert.match(planSql, /add column if not exists plan text/);
  assert.match(planSql, /not been run/);
  assert.match(planSql, /lifetime-349/);
  assert.match(planSql, /lifetime-499/);
  assert.doesNotMatch(planSql, /square\.link|SQUARE_/);
  assert.equal(planSql.includes(EM), false);
  assert.match(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"), /"metrics:report"/);
  assert.equal(VERSION, JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
});

test("the daily ping waits, sends counts once, and the off switch sends nothing", async () => {
  const port = await freePort();
  const hits = [];
  const sink = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    let json = null;
    try { json = JSON.parse(raw); } catch { json = null; }
    hits.push({ method: req.method, json, authorization: req.headers.authorization || "" });
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end('{"ok":true}');
  });
  await listen(sink, port);
  const url = `http://127.0.0.1:${port}/api/metrics/ping`;
  const onId = "a".repeat(32);
  const offId = "b".repeat(32);
  let on = null;
  let off = null;
  try {
    on = await startServer({
      env: { CC_USAGE_URL: url, CC_USAGE_CHECK_MS: "200" },
      seed(dir) {
        fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({
          v: 1, share: true, installId: onId, day: TODAY, counts: { council: 2, single: 1 }, seen: [], lastSentDay: null,
        }));
      },
    });
    const ping = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const hit = hits.find((h) => h.json?.installId === onId);
        if (hit) return hit;
        await sleep(40);
      }
      return null;
    })();
    assert.ok(ping, "the daily ping did not arrive");
    assert.equal(ping.method, "POST");
    assert.equal(ping.authorization, "");
    assert.equal(ping.json.version, VERSION);
    assert.equal(ping.json.tier, "free");
    assert.equal(ping.json.day, TODAY);
    assert.ok(["win32", "darwin", "linux"].includes(ping.json.os));
    assert.deepEqual(ping.json.features, { council: 2, single: 1 });
    assert.deepEqual(Object.keys(ping.json).sort(), ["day", "features", "installId", "os", "tier", "version"]);
    assert.equal(JSON.stringify(ping.json).includes("prompt"), false);
    const n = hits.filter((h) => h.json?.installId === onId).length;
    await sleep(700);
    assert.equal(hits.filter((h) => h.json?.installId === onId).length, n, "a second ping the same day");
    const view = (await on.api("/usage")).json;
    assert.equal(view.share, true);
    assert.equal(view.label, SHARE_LABEL);
    assert.equal((await on.api("/state")).json.plugins.includes("usage"), true);
    const closed = await on.api("/metrics/ping", { method: "POST", body: ping.json });
    assert.equal(closed.status, 404, "the desktop app does not accept a ping");

    off = await startServer({
      env: { CC_USAGE_URL: url, CC_USAGE_CHECK_MS: "150" },
      seed(dir) {
        fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({
          v: 1, share: false, installId: offId, day: TODAY, counts: { council: 9 }, seen: [], lastSentDay: null,
        }));
      },
    });
    const toggled = await off.api("/usage", { method: "POST", body: { share: false } });
    assert.equal(toggled.json.share, false);
    await sleep(800);
    assert.equal(hits.filter((h) => h.json?.installId === offId).length, 0, "off switch still sent a ping");
    assert.equal(JSON.stringify(hits).includes("@"), false);
  } finally {
    if (on) await on.stop();
    if (off) await off.stop();
    await closeServer(sink);
  }
});

test("the hub stores a ping and the owner report is JSON, with the secret required", async () => {
  const dbPort = await freePort();
  const pings = [];
  const licenses = [
    { tier: "pro", status: "active", source: "stripe", email: "hidden@example.com", key: "EVB-SECRET-KEY" },
    { tier: "pro", status: "active", source: "promo", email: "friend@example.com" },
    { tier: "studio", status: "active", source: "manual", plan: "extreme-yearly" },
    { tier: "pro", status: "active", source: "manual", plan: "lifetime-499", email: "founder@example.com" },
  ];
  const dbHits = [];
  const db = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url, `http://127.0.0.1:${dbPort}`);
    dbHits.push({ method: req.method, path: url.pathname, search: url.search, authorization: req.headers.authorization || "" });
    const send = (status, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(status, { "content-type": "application/json", connection: "close", "content-length": Buffer.byteLength(body) });
      res.end(body);
    };
    if (req.method === "POST" && url.pathname === "/rest/v1/rpc/record_usage_ping") {
      const b = JSON.parse(raw);
      pings.push({ install_id: b.p_install_id, day: b.p_day, version: b.p_version, os: b.p_os, tier: b.p_tier, features: b.p_features });
      return send(200, null);
    }
    if (req.method === "GET" && url.pathname === "/rest/v1/usage_pings") return send(200, pings);
    if (req.method === "GET" && url.pathname === "/rest/v1/licenses") {
      return send(200, licenses.map((row) => ({ tier: row.tier, status: row.status, source: row.source, plan: row.plan || null })));
    }
    return send(404, { message: "no route" });
  });
  await listen(db, dbPort);
  const secret = "metrics-test-secret";
  const serviceKey = "test-service-key-not-real";
  let hub = null;
  try {
    hub = await startServer({
      env: {
        CC_USAGE_INGEST: "1",
        CC_USAGE_URL: "off",
        CC_SUPABASE_URL: `http://127.0.0.1:${dbPort}`,
        CC_SUPABASE_ANON_KEY: "sb_publishable_test",
        CC_SUPABASE_SERVICE_KEY: serviceKey,
        CC_METRICS_SECRET: secret,
      },
    });
    const bad = await hub.raw({
      method: "POST",
      path: "/api/metrics/ping",
      headers: { "content-type": "application/json" },
      body: { installId: "c".repeat(32), version: VERSION, os: "linux", tier: "pro", day: TODAY, features: { council: 1 }, email: "hidden@example.com" },
    });
    assert.equal(bad.status, 400);
    assert.equal(pings.length, 0);
    const posted = await hub.raw({
      method: "POST",
      path: "/api/metrics/ping",
      headers: { "content-type": "application/json" },
      body: { installId: "c".repeat(32), version: VERSION, os: "linux", tier: "pro", day: TODAY, features: { council: 2 } },
    });
    assert.equal(posted.status, 200, posted.text);
    assert.equal(pings.length, 1);
    assert.equal(dbHits.some((h) => h.path === "/rest/v1/rpc/record_usage_ping" && h.authorization === `Bearer ${serviceKey}`), true);
    const open = await hub.raw({ path: "/api/metrics/report" });
    assert.equal(open.status, 401);
    const wrong = await hub.raw({ path: "/api/metrics/report", headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401);
    const report = await hub.raw({ path: `/api/metrics/report?asOf=${TODAY}`, headers: { authorization: `Bearer ${secret}` } });
    assert.equal(report.status, 200, report.text);
    assert.equal(report.json.dau, 1);
    assert.equal(report.json.payingUsers, 2);
    assert.equal(report.json.mrrUsd, 43.91);
    assert.equal(report.json.lifetimeCount, 1);
    assert.equal(report.json.lifetimeRevenueUsd, 499);
    assert.equal(report.json.topFeatures[0].feature, "council");
    assert.equal(report.text.includes("hidden@example.com"), false);
    assert.equal(report.text.includes("EVB-SECRET"), false);
    assert.equal(report.text.includes("c".repeat(32)), false);
    const licenseRead = dbHits.find((h) => h.path === "/rest/v1/licenses");
    assert.ok(licenseRead);
    assert.equal(licenseRead.search.includes("email"), false);
    assert.equal(licenseRead.search.includes("key"), false);
    assert.match(licenseRead.search, /tier/);
    assert.match(licenseRead.search, /plan/);
    const child = spawn(process.execPath, [path.join(ROOT, "scripts", "metrics-report.mjs")], {
      env: {
        ...process.env,
        CC_HUB_URL: `http://127.0.0.1:${hub.port}`,
        CC_METRICS_SECRET: secret,
        CC_METRICS_AS_OF: TODAY,
        CC_SUPABASE_URL: "",
        CC_SUPABASE_SERVICE_KEY: "",
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, err);
    const parsed = JSON.parse(out);
    assert.equal(parsed.payingUsers, 2);
    assert.equal(parsed.mrrUsd, 43.91);
    assert.equal(parsed.lifetimeRevenueUsd, 499);
    assert.equal(out.includes("hidden@example.com"), false);
    assert.equal(out.includes(EM), false);
  } finally {
    if (hub) await hub.stop();
    await closeServer(db);
  }
});
