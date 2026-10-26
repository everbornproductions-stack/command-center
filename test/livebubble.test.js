// Slice A4 (flag_livebubble): Free AI bubble checks, credit badges, Clear idle projects.
// Pure parts run with injected probes and a fake clock. One server test runs the routes with the flag
// on and off. No real URL or key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-lbub-");
process.env.CC_HQ_DIR = tmpDir("cc-lbub-hq-");
process.env.CC_STATUS_PAGES = "off";

const { liveBubbleOn, DEFAULT_ON } = await import("../server/live-flag.js");
const LB = await import("../server/live-bubble.js");
const { buildLiveView, createState, makeFlow } = await import("../server/liveview.js");
const { createScheduler } = await import("../server/perf/scheduler.js");

test("flag: off by default, env turns it on or off", () => {
  assert.equal(DEFAULT_ON, false);
  assert.equal(liveBubbleOn({}), false);
  assert.equal(liveBubbleOn({ CC_FLAG_LIVEBUBBLE: "1" }), true);
  assert.equal(liveBubbleOn({ CC_FLAG_LIVEBUBBLE: "0" }), false);
});

test("checkOne: one retry, then gives up; limits match the brief", async () => {
  let calls = 0;
  const flaky = async () => { calls++; return calls === 1 ? { ok: false, detail: "timed out" } : { ok: true, detail: "ok" }; };
  const a = await LB.checkOne("google", { probe: flaky });
  assert.equal(a.ok, true);
  assert.equal(calls, 2);
  calls = 0;
  const dead = async () => { calls++; throw new Error("boom"); };
  const b = await LB.checkOne("google", { probe: dead });
  assert.equal(b.ok, false);
  assert.equal(calls, 2, "never more than one retry");
  assert.ok(LB.CHECK.timeoutMs >= 2000 && LB.CHECK.timeoutMs <= 3000);
  assert.ok(LB.CHECK.everyMs >= 15000 && LB.CHECK.everyMs <= 30000);
  assert.equal(LB.CHECK.cacheMs, 60000);
});

test("defaultProbe: a server that never answers times out (real wait)", async () => {
  const srv = http.createServer(() => { /* never answers */ });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { PROVIDERS } = await import("../server/registry.js");
  const old = PROVIDERS.groq.baseUrl;
  PROVIDERS.groq.baseUrl = `http://127.0.0.1:${srv.address().port}`;
  process.env[PROVIDERS.groq.keyEnv] = "test-key-not-real";
  try {
    const t0 = Date.now();
    const r = await LB.defaultProbe("groq", { timeoutMs: 400, secret: { key: "test-key-not-real" } });
    assert.equal(r.ok, false);
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    PROVIDERS.groq.baseUrl = old;
    delete process.env[PROVIDERS.groq.keyEnv];
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

test("checker: 60 s cache, forced Refresh, timer rides the scheduler and stops itself", async () => {
  let t = 1_000_000;
  const now = () => t;
  const sched = createScheduler({ now, state: () => ({ idle: false, battery: false, light: false }), setTimeout: () => ({ unref() {} }), clearTimeout: () => {} });
  let probes = 0;
  const ok = { google: true, groq: false };
  const probe = async (id) => { probes++; return ok[id] ? { ok: true } : { ok: false, detail: "HTTP 503" }; };
  const members = () => [{ id: "google", name: "Google" }, { id: "groq", name: "Groq" }];
  const ck = LB.createFreeChecker({ probe, now, sched, members, cfg: { ...LB.CHECK } });

  assert.equal(ck.snapshot().state, "checking");
  await ck.refresh();
  const first = probes;
  assert.equal(first, 3, "google once, groq twice (one retry)");
  let snap = ck.snapshot();
  assert.equal(snap.state, "ok");
  assert.equal(snap.count, 1);
  assert.equal(snap.label, "1 working");
  await ck.refresh();
  assert.equal(probes, first, "cached for 60 s");
  t += 61_000;
  await ck.refresh();
  assert.ok(probes > first, "cache expired");
  const before = probes;
  await ck.refresh({ force: true });
  assert.ok(probes > before, "Refresh forces a check");

  ok.google = false;
  await ck.refresh({ force: true });
  snap = ck.snapshot();
  assert.equal(snap.state, "empty");
  assert.equal(snap.empty, LB.FREE_EMPTY);
  assert.equal(snap.refresh, true);

  assert.equal(sched.list().length, 0);
  ck.watch("u1");
  ck.watch("u1");
  assert.equal(sched.list().length, 1);
  assert.equal(sched.list()[0].id, "livefree:u1");
  t += LB.CHECK.watchMs + 5000;
  sched.tick();
  assert.equal(sched.list().length, 0, "stops itself when nobody watches");
  assert.equal(ck.isWatching("u1"), false);
  sched.stop();
});

test("freeBubble: no members is the empty state", () => {
  const b = LB.freeBubble([]);
  assert.equal(b.state, "empty");
  assert.match(b.empty, /No free AI/);
});

test("badgeText and applyCleared", () => {
  assert.equal(LB.badgeText({ outOfCredits: true, viaMcp: true }), "via MCP");
  assert.equal(LB.badgeText({ outOfCredits: true, viaMcp: false }), "Out of credits");
  assert.equal(LB.badgeText(null), "");
  const idle = { id: "a", working: false, runs: [{ startedAt: 100, finishedAt: 200 }] };
  const busy = { id: "b", working: true, runs: [] };
  const fresh = { id: "c", working: false, runs: [{ startedAt: 900, finishedAt: 950 }] };
  const { shown, hidden } = LB.applyCleared([idle, busy, fresh], { a: 500, b: 500, c: 500 });
  assert.deepEqual(hidden.map((p) => p.id), ["a"]);
  assert.deepEqual(shown.map((p) => p.id).sort(), ["b", "c"]);
});

test("buildLiveView: no extras means no new fields; extras add badges and hide cleared projects", () => {
  const projects = [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }];
  const plain = buildLiveView({ state: createState(), projects, missions: [] });
  assert.equal("hiddenIdle" in plain, false);
  assert.equal("freeAi" in plain, false);
  assert.ok(plain.flow.nodes.every((n) => !("badge" in n)));

  const credit = { anthropic: { outOfCredits: true, viaMcp: false }, openai: { outOfCredits: true, viaMcp: true } };
  const hiddenView = buildLiveView({
    state: createState(), projects, missions: [],
    extras: { credit, cleared: { p1: 5000, p2: 5000 }, applyCleared: LB.applyCleared, free: LB.freeBubble([]) },
  });
  assert.equal(hiddenView.hiddenIdle, 2);
  assert.equal(hiddenView.projects.length, 0);
  assert.equal(hiddenView.freeAi.state, "empty");
  const shown = buildLiveView({ state: createState(), projects, missions: [], extras: { credit, cleared: {}, applyCleared: LB.applyCleared } });
  assert.equal(shown.projects.length, 2);
  assert.equal(shown.idleCount, 2);

  const run = { id: "r", providerIds: ["anthropic", "openai"], workers: [] };
  const flow = makeFlow([run], createState(), { credit });
  const a = flow.nodes.find((n) => n.id === "anthropic");
  const o = flow.nodes.find((n) => n.id === "openai");
  assert.equal(a.badge, "Out of credits");
  assert.equal(o.badge, "via MCP");
  assert.match(o.tip, /via MCP/);
});

test("no em dashes in the new files", () => {
  for (const f of ["server/live-bubble.js", "server/live-flag.js", "test/livebubble.test.js"]) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), new RegExp(String.fromCharCode(8212)), f);
  }
});

test("server: routes are absent with the flag off; with it on, free, clear-idle and show-all work", async () => {
  const off = await startServer({ env: { CC_STATUS_PAGES: "off", CC_DEV_OWNER: "1" } });
  try {
    assert.notEqual((await off.api("/liveview/free")).status, 200);
    assert.equal("freeAi" in (await off.api("/liveview")).json, false);
  } finally { await off.stop(); }

  const on = await startServer({ env: { CC_STATUS_PAGES: "off", CC_DEV_OWNER: "1", CC_FLAG_LIVEBUBBLE: "1" } });
  try {
    const v = (await on.api("/liveview")).json;
    assert.ok(v.freeAi);
    assert.equal(typeof v.hiddenIdle, "number");
    const f = await on.api("/liveview/free", { method: "POST" });
    assert.equal(f.status, 200);
    assert.equal(f.json.id, "free-ai");
    const c = await on.api("/liveview/clear-idle", { method: "POST" });
    assert.equal(c.status, 200);
    assert.equal(typeof c.json.cleared, "number");
    assert.ok(c.json.view.projects.every((p) => p.working));
    const s = await on.api("/liveview/show-all", { method: "POST" });
    assert.equal(s.status, 200);
    assert.equal(s.json.view.hiddenIdle, 0);
  } finally { await on.stop(); }
});
