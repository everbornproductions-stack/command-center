// 0.4.33: OpenCode as a free helper (server/opencode-agent.js).
// A pretend OpenCode server (test/fixtures/fake-opencode.mjs) stands in for `opencode serve`, so no test calls the
// internet or needs the real binary. Covered: the free model pick (cost 0, never a training note), ok returns the
// text, never-answers returns timeout within the limit and aborts the session, an error part returns quota and rests
// the helper, the started process is stopped (idle and on stop), detection says ready when the binary exists, and the
// router row, the stream (ledger at cost 0) and the free-first lists. Real waits; every server and child is closed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { tmpDir, ROOT } from "./helpers.js";
import { startFake, PROVIDERS as FAKE_PROVIDERS } from "./fixtures/fake-opencode.mjs";

const DIR = tmpDir("cc-oc0433-");
const WORK = tmpDir("cc-oc0433-work-");
const FAKE_BIN = path.join(ROOT, "test", "fixtures", "fake-opencode.mjs");
Object.assign(process.env, { CC_DATA_DIR: DIR, CC_SUBCLI_HOME: tmpDir("cc-oc0433-home-"), CC_SUBCLI_NO_PATH: "1", CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "off" });
delete process.env.CC_OPENCODE_URL;
delete process.env.CC_OPENCODE_BIN;

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const OC = await import("../server/opencode-agent.js");
const WP = await import("../server/worker-pool.js");
const FF = await import("../server/free-first.js");
const { recordCall } = await import("../server/ledger.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
  s.setTimeout(1500, () => { s.destroy(); resolve(false); });
});
const resetPool = () => { const s = store.doc("settings", () => ({})) || {}; store.putDoc("settings", { ...s, workerPool: { workers: {} } }); };
const fakes = [];
const runners = [];
after(async () => {
  for (const r of runners) await r.stop().catch(() => {});
  for (const f of fakes) await f.close().catch(() => {});
});

test("free model pick: cost 0 only, never a training note, Meldmind's order", () => {
  const list = OC.freeModels(FAKE_PROVIDERS).map((m) => m.modelID);
  assert.deepEqual(list, ["big-pickle", "glm-5.3-flash-free"]);
  assert.equal(OC.pickFreeModel(FAKE_PROVIDERS).modelID, "big-pickle");
  assert.equal(OC.pickFreeModel(FAKE_PROVIDERS, { want: "glm-5.3-flash-free" }).modelID, "glm-5.3-flash-free");
  assert.equal(OC.pickFreeModel(FAKE_PROVIDERS, { want: "paid-pro" }).modelID, "big-pickle", "a priced model is never used");
  assert.equal(OC.pickFreeModel(FAKE_PROVIDERS, { want: "trainer-free" }).modelID, "big-pickle", "a training model is never used");
  assert.equal(OC.pickFreeModel({ providers: [] }), null);
});

test("ok: the answer text comes back, in a throwaway folder, with tools off and a free model", async () => {
  resetPool();
  const fake = await startFake({ mode: "ok" }); fakes.push(fake);
  const oc = OC.createOpenCode({ baseUrl: fake.base, pollMs: 150, workRoot: WORK });
  const t0 = Date.now();
  const r = await oc.ask("Reply with just the word OK.", { timeoutMs: 10000 });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.text, "OK from the fake OpenCode");
  assert.equal(r.model, "opencode/big-pickle");
  assert.ok(Date.now() - t0 < 8000);
  const sent = fake.state.log.find((l) => l.path.endsWith("/prompt_async"));
  assert.deepEqual(sent.body.model, { providerID: "opencode", modelID: "big-pickle" });
  assert.match(sent.body.parts[0].text, /answering a question only/);
  assert.equal(sent.body.tools.bash, false);
  assert.ok(sent.directory.startsWith(WORK), "a throwaway folder, never the project folder");
  assert.notEqual(path.resolve(sent.directory), path.resolve(process.cwd()));
  assert.equal(fs.existsSync(sent.directory), false, "the throwaway folder is removed");
  assert.ok(!fake.state.log.some((l) => l.path.endsWith("/abort")), "a finished answer is not aborted");
  assert.equal(WP.isResting("opencode"), false);
});

test("never answers: timeout within the limit, the session is aborted, the helper rests", async () => {
  resetPool();
  const fake = await startFake({ mode: "never" }); fakes.push(fake);
  const oc = OC.createOpenCode({ baseUrl: fake.base, pollMs: 200, workRoot: WORK });
  const t0 = Date.now();
  const r = await oc.ask("Say hi", { timeoutMs: 2500 });
  const took = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.code, "timeout");
  assert.ok(took >= 2400 && took < 7000, `took ${took} ms`);
  assert.ok(!/—/.test(r.message));
  assert.ok(fake.state.log.some((l) => l.method === "POST" && l.path.endsWith("/abort")), "the session was aborted");
  assert.equal(WP.isResting("opencode"), true, "a silent OpenCode rests so the next helper takes the step");
});

test("error part: quota in plain words, and the helper rests until it is back", async () => {
  resetPool();
  const fake = await startFake({ mode: "error" }); fakes.push(fake);
  const oc = OC.createOpenCode({ baseUrl: fake.base, pollMs: 150, workRoot: WORK });
  const r = await oc.ask("Say hi", { timeoutMs: 8000 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "quota");
  assert.match(r.message, /OpenCode is out of free usage for now/);
  assert.match(r.message, /Another helper will take the step/);
  assert.ok(fake.state.log.some((l) => l.path.endsWith("/abort")));
  assert.equal(WP.isResting("opencode"), true);
  assert.equal(WP.workerUsable("opencode"), false);
  assert.match(WP.poolState().workers.opencode.lastError, /free usage/i);
});

test("the started OpenCode process is stopped after the idle time and on stop, and never uses port 4747", async () => {
  resetPool();
  const mk = (idleMs) => OC.createOpenCode({
    findBinary: async () => FAKE_BIN,
    command: (bin, args) => ({ file: process.execPath, args: [bin, ...args] }),
    pollMs: 150, idleMs, workRoot: WORK, startWaitMs: 20000,
  });
  // idle stop
  const a = mk(1500); runners.push(a);
  const r = await a.ask("Reply with just the word OK.", { timeoutMs: 15000 });
  assert.equal(r.ok, true, r.message);
  const st = a.status();
  assert.equal(st.running, true);
  const port = Number(new URL(st.base).port);
  assert.notEqual(port, OC.MELDMIND_PORT);
  const pid = st.pid;
  assert.ok(alive(pid));
  const until = Date.now() + 15000;
  while (Date.now() < until && (alive(pid) || a.status().running)) await sleep(250);
  assert.equal(a.status().running, false, "stopped after the idle time");
  // a slow Windows runner can take a few seconds to end the process tree and free the port: wait for both
  const gone = Date.now() + 15000;
  while (Date.now() < gone && (alive(pid) || await portOpen(port))) await sleep(300);
  assert.equal(alive(pid), false, "the process is gone");
  assert.equal(await portOpen(port), false, "its port is closed");
  // explicit stop (Meldmind quitting) while the server is reused
  const b = mk(60000); runners.push(b);
  assert.equal((await b.ask("one", { timeoutMs: 15000 })).ok, true);
  const pid2 = b.status().pid;
  assert.equal((await b.ask("two", { timeoutMs: 15000 })).ok, true);
  assert.equal(b.status().pid, pid2, "the running server is reused");
  await b.stop();
  const until2 = Date.now() + 15000;
  while (Date.now() < until2 && alive(pid2)) await sleep(200);
  assert.equal(alive(pid2), false);
});

test("missing binary: plain words, nothing started", async () => {
  const oc = OC.createOpenCode({ findBinary: async () => "", workRoot: WORK });
  const r = await oc.ask("hi");
  assert.equal(r.code, "missing");
  assert.match(r.message, /Install OpenCode/);
  assert.equal(oc.status().running, false);
});

test("detection: ready when the binary exists, Install OpenCode when it does not (no custom provider step)", async () => {
  resetPool();
  const others = { apps: () => [], freebuff: () => ({ installed: false }), grokbot: () => ({ installed: false }), browser: () => ({ installed: false }) };
  process.env.CC_OPENCODE_BIN = FAKE_BIN;
  let det = await WP.detectAll({ detectors: others, refresh: true });
  assert.deepEqual(det.opencode, { installed: true, signedIn: true });
  let row = WP.listWorkers({ detected: det }).find((w) => w.id === "opencode");
  assert.equal(row.status, "ready");
  assert.equal(row.free, true);
  process.env.CC_OPENCODE_BIN = path.join(WORK, "no-such-opencode.exe");
  det = await WP.detectAll({ detectors: others, refresh: true });
  assert.equal(det.opencode.installed, false);
  row = WP.listWorkers({ detected: det }).find((w) => w.id === "opencode");
  assert.equal(row.status, "missing");
  assert.equal(row.needs, "Install OpenCode");
  assert.ok(!/custom provider/i.test(WP.workerSpec("opencode").needs));
  delete process.env.CC_OPENCODE_BIN;
});

test("routing: a free route row, the free-first lists, the stream records $0, and quota hands the step on", async () => {
  resetPool();
  process.env.CC_OPENCODE_BIN = FAKE_BIN;
  await OC.detectOpenCode({ refresh: true });
  const rows = OC.routeModels();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "opencode");
  assert.equal(FF.isFreeModel("opencode", "opencode"), true);
  assert.equal(FF.costTier("opencode", "opencode"), 1);
  assert.match(FF.costText({ provider: "opencode", model: "opencode" }), /\$0 \(free: OpenCode\)/);
  FF.setAppHooks({ ocRouteModels: OC.routeModels });
  const last = FF.lastResortChoices({ freeOnly: true });
  assert.ok(last.some((c) => c.provider === "opencode" && c.free), "OpenCode is a free last-resort route");

  // the stream: one delta and usage at cost 0, recorded as free in the ledger
  const okRunner = { ask: async () => ({ ok: true, text: "Hello there", model: "opencode/big-pickle" }) };
  const evs = [];
  for await (const ev of OC.opencodeChatStream({ messages: [{ role: "user", content: "Say hello" }] }, okRunner)) evs.push(ev);
  assert.equal(evs[0].text, "Hello there");
  const done = evs.find((e) => e.type === "done");
  assert.equal(done.usage.cost, 0);
  assert.equal(done.usage.free, true);
  const entry = recordCall({ provider: "opencode", model: "opencode", usage: done.usage, missionId: "t-oc", role: "work", ms: 5 });
  assert.equal(entry.cost, 0);
  assert.equal(entry.free, true);

  // quota: a limit error (429, limit) so smart fallback and the mission give the step to the next helper
  const quotaRunner = { ask: async () => { WP.noteRest("opencode", { error: "out of free usage" }); return { ok: false, code: "quota", message: "OpenCode is out of free usage for now." }; } };
  await assert.rejects(async () => { for await (const _ of OC.opencodeChatStream({ messages: [{ role: "user", content: "x" }] }, quotaRunner)) { /* nothing */ } }, (e) => e.limit === true && e.status === 429 && e.code === "quota");
  assert.deepEqual(OC.routeModels(), [], "a resting OpenCode leaves the router until it is back");
  WP.clearRest("opencode");
  assert.equal(OC.routeModels().length, 1);
  WP.setEnabled("opencode", false);
  assert.deepEqual(OC.routeModels(), [], "switched off in Your AI helpers");
  WP.setEnabled("opencode", true);
  delete process.env.CC_OPENCODE_BIN;
});

test("no OpenCode custom-provider preset, and the new words have no em-dash", () => {
  const P = fs.readFileSync(path.join(ROOT, "server", "plugins", "providers.js"), "utf8");
  assert.ok(!/id: "opencode"/.test(P));
  for (const f of ["server/opencode-agent.js", "server/worker-pool.js", "server/plugins/providers.js"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), false, f);
  }
});
