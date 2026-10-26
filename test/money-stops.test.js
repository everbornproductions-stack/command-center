// Spending limits really stop a run, and Stop on Build it all for me really stops the project behind it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-money-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const savedDevOwner = process.env.CC_DEV_OWNER;
delete process.env.CC_DEV_OWNER;
after(() => { if (savedDevOwner) process.env.CC_DEV_OWNER = savedDevOwner; });

const Guard = await import("../server/cost-guard.js");
const Providers = await import("../server/providers.js");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("a used-up monthly budget stops a paid call even with no estimate, and never blocks free or practice AIs", async () => {
  store.putDoc("license", { tier: null, status: null, lastOkAt: 0, checkedAt: 0 });
  store.putDoc("cost.guard", { optedIn: true, cap: 1, paused: false });
  store.ctx().ledger = [];
  assert.equal(Guard.assertSpendAllowed({ provider: "openai" }).ok, true, "nothing spent yet");
  store.ctx().ledger.push({ ts: Date.now(), kind: "call", provider: "openai", model: "gpt-6-luna", cost: 5, inTok: 1, outTok: 1 });
  assert.equal(Guard.publicState().level, "stop");
  assert.throws(() => Guard.assertSpendAllowed({ provider: "openai" }), (e) => e.code === "budget_cap");
  assert.equal(Guard.assertSpendAllowed({ provider: "demo-nova" }).ok, true);
  // the provider layer itself refuses before any network call, so chat, missions and builders all stop
  assert.throws(() => Providers.streamChat({ provider: "openai", model: "gpt-5", messages: [{ role: "user", content: "hi" }] }), (e) => e.code === "cap" && e.status === 402 && !/[–—]/.test(e.message));
  store.putDoc("cost.guard", { optedIn: true, cap: 100000, paused: false });
  assert.doesNotThrow(() => Guard.assertSpendAllowed({ provider: "openai" }));
});

test("a mission stops when its own limit is reached, and Build it all halts the project on Stop", () => {
  const m = read("server", "mission.js");
  assert.match(m, /const runLimit = \(\) =>/);
  assert.match(m, /while \(done\.size < mission\.tasks\.length\) \{[\s\S]{0,300}limitReached = true; break;[^\n]*\n\s*runLimit\(\);/);
  assert.match(m, /else if \(limitNote\(\)\)/);
  const b = read("server", "plugins", "buildall.js");
  assert.equal((b.match(/if \(stopped\(\)\) await halt\(\);/g) || []).length, 2, "plan and build both halt");
  assert.match(read("server", "plugins", "walkthrough.js"), /sub === "halt"/);
});

test("Stop reaches the project: the walkthrough pauses instead of running on", { timeout: 240000 }, async () => {
  const s = await startServer();
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    let paused = false;
    for (let i = 0; i < 4 && !paused; i++) {
      const w = (await s.api("/walkthrough", { method: "POST", body: { type: "website", experience: "simple" } })).json;
      await s.api(`/walkthrough/${w.id}/idea`, { method: "POST", body: { idea: "A weekend bakery site for Harbor and Rye." } });
      const types = (await s.api("/walkthrough/types")).json;
      const qs = types.find((t) => t.id === w.type)?.questions || [];
      const answers = {};
      for (const q of qs) answers[q.key || q.id] = "Bakery";
      await s.api(`/walkthrough/${w.id}/answers`, { method: "POST", body: { answers } });
      await s.api(`/walkthrough/${w.id}/plan`, { method: "POST", body: {} });
      for (let t = 0; t < 100; t++) { if ((await s.api(`/walkthrough/${w.id}`)).json.status !== "planning") break; await new Promise((r) => setTimeout(r, 100)); }
      await s.api(`/walkthrough/${w.id}/build`, { method: "POST", body: {} });
      const halted = await s.api(`/walkthrough/${w.id}/halt`, { method: "POST", body: {} });
      assert.equal(halted.status, 200);
      let status = "";
      for (let t = 0; t < 200; t++) { status = (await s.api(`/walkthrough/${w.id}`)).json.status; if (status !== "building") break; await new Promise((r) => setTimeout(r, 100)); }
      paused = status === "paused";
    }
    assert.equal(paused, true, "the halted project ended paused, not finished");
  } finally { await s.stop(); }
});
