// 0.4.21 budget fixes: the app's own cap is not a provider fault, tiny caps are refused, five parallel runs cannot all pass.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-budget0421-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const savedDevOwner = process.env.CC_DEV_OWNER;
delete process.env.CC_DEV_OWNER;
after(() => { if (savedDevOwner) process.env.CC_DEV_OWNER = savedDevOwner; });

const Guard = await import("../server/cost-guard.js");
const Fallback = await import("../server/fallback.js");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("the app's own budget stop is never filed as provider credits", () => {
  store.putDoc("license", { tier: null, status: null, lastOkAt: 0, checkedAt: 0 });
  store.putDoc("cost.guard", { optedIn: true, cap: 1, paused: false });
  store.ctx().ledger = [{ ts: Date.now(), kind: "call", provider: "openai", model: "gpt-6-luna", cost: 5, inTok: 1, outTok: 1 }];
  let err;
  try { Guard.assertSpendAllowed({ provider: "openai" }); } catch (e) { err = e; }
  assert.equal(err.code, "budget_cap");
  assert.equal(Fallback.troubleKind(err), null);
  assert.equal(Fallback.troubleKind({ status: 402, message: "This month's budget is used up. Raise the cap." }), null);
  assert.equal(Fallback.troubleKind({ status: 402, message: "Your credit balance is too low" }), "credits");
});

test("a budget under one cent is refused with a plain message, and the saved cap reads back", () => {
  store.putDoc("license", { tier: null, status: null, lastOkAt: 0, checkedAt: 0 });
  store.putDoc("cost.guard", { optedIn: false, cap: null, paused: false });
  store.ctx().ledger = [];
  assert.throws(() => Guard.saveGuard({ on: true, cap: 0.0002 }), (e) => e.status === 400 && /at least \$0\.01/.test(e.message) && !/[–—]/.test(e.message));
  const ok = Guard.saveGuard({ on: true, cap: 0.01 });
  assert.equal(ok.cap, 0.01);
  assert.equal(Guard.activeCap(), 0.01);
});

test("parallel paid runs hold a reservation, so they cannot all pass a tiny budget", () => {
  store.putDoc("cost.guard", { optedIn: true, cap: 0.01, paused: false });
  store.ctx().ledger = [];
  const passed = [];
  let blocked = 0;
  for (let i = 0; i < 5; i++) {
    try { passed.push(Guard.assertSpendAllowed({ provider: "openai", hold: true })); } catch (e) { assert.equal(e.code, "budget_cap"); blocked++; }
  }
  assert.ok(passed.length >= 1 && passed.length < 5 && blocked >= 1, `${passed.length} passed, ${blocked} blocked`);
  for (const p of passed) p.release();
  assert.doesNotThrow(() => Guard.assertSpendAllowed({ provider: "openai", hold: true }).release());
  // practice AIs are never held or blocked
  assert.equal(Guard.assertSpendAllowed({ provider: "demo-nova", hold: true }).ok, true);
});

test("source: the mission limit text keeps enough digits and Expert gets the Continue buttons", () => {
  const m = read("server", "mission.js");
  assert.match(m, /n < 0\.01 \? n\.toFixed\(4\)/);
  const app = read("web", "app.js");
  assert.match(app, /limitHit/);
  assert.match(app, /S\.guardCap/);
  assert.equal(read("web", "features", "smarter-control.js").includes('min="1" step="1" placeholder="Monthly cap"'), false);
});
