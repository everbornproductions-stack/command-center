// "Use my plan first": a signed-in official app (a fake one here) ranks before paid API models, answers
// through the person's subscription, is counted in the meter, and sits out when it is out of quota.
// In-process, a fake app, fake keys that are never sent anywhere, no network, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-planfirst-");
const HOME = tmpDir("cc-planfirst-home-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_SUBCLI_HOME = HOME;
process.env.CC_SUBCLI_NO_PATH = "1";
process.env.CC_SUBCLI_EXEC = process.execPath;
process.env.CC_CLAUDE_BIN = path.join(ROOT, "test", "fixtures", "fake-sub-cli.mjs");
process.env.ANTHROPIC_API_KEY = "sk-ant-test-never-sent";
process.env.OPENAI_API_KEY = "sk-test-never-sent";
delete process.env.CC_DEV_OWNER;

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const SR = await import("../server/sub-routes.js");
const PF = await import("../server/plan-first.js");
const { rank } = await import("../server/router.js");
const { streamChat } = await import("../server/providers.js");

const credentials = path.join(HOME, ".claude", ".credentials.json");
fs.mkdirSync(path.dirname(credentials), { recursive: true });
fs.writeFileSync(credentials, "{}");

const setPlanFirst = (on) => store.putDoc("settings", { ...(store.doc("settings", () => ({})) || {}), planFirst: on });
const job = { capability: "writing", difficulty: 1, mode: "balanced" };

test("switched off on purpose: no plan rows, and the ranking is the old one", async () => {
  setPlanFirst(false);
  await SR.allStatus({ refresh: true });
  assert.equal(rank(job).some((m) => m.planRoute), false);
});

test("on: the plan ranks before every paid API model", async () => {
  setPlanFirst(true);
  SR.clearStatusCache();
  await SR.allStatus({ refresh: true });
  const list = rank(job);
  const at = list.findIndex((m) => m.planRoute);
  assert.ok(at >= 0, `a plan row is listed: ${list.map((m) => m.model).join(", ")}`);
  const firstPaid = list.findIndex((m) => !m.planRoute && m.estCost > 0 && !m.free && !m.localFree);
  assert.ok(firstPaid > at, "the first paid model comes after the plan");
  assert.equal(list[at].planFirst, true);
  assert.equal(list[at].provider, "plan-claude-code");
  assert.equal(list[at].estCost, 0);
  // an app that is turned off in Settings is not listed
  SR.saveRouteSettings({ routes: { "claude-code": false } });
  assert.equal(rank(job).some((m) => m.planRoute), false);
  SR.saveRouteSettings({ routes: { "claude-code": true } });
});

test("answering through the plan costs nothing and is counted", async () => {
  process.env.FAKE_SUBCLI_MODE = "ok";
  let text = "", done = null;
  for await (const ev of streamChat({ provider: "plan-claude-code", model: "plan-claude-code", messages: [{ role: "user", content: "Say hello to the bakery." }] })) {
    if (ev.type === "delta") text += ev.text;
    if (ev.type === "done") done = ev;
  }
  assert.match(text, /Answer from the fake app/);
  assert.equal(done.usage.cost, 0);
  const view = PF.planMeterView();
  assert.equal(view.on, true);
  assert.equal(view.routes.find((r) => r.id === "claude-code").answersToday, 1);
});

test("out of quota: a clear stop, a few hours out, and the next best choice takes the job", async () => {
  process.env.FAKE_SUBCLI_MODE = "quota";
  await assert.rejects(async () => { for await (const _ of streamChat({ provider: "plan-claude-code", model: "plan-claude-code", messages: [{ role: "user", content: "Again" }] })) { /* drain */ } }, (e) => e.status === 429 && /quota/i.test(e.message));
  assert.equal(PF.outOfQuota("claude-code"), true);
  assert.equal(rank(job).some((m) => m.planRoute), false, "it sits out");
  // 0.4.28: a limit with no reset time rests a few hours (was one hour, and the app was asked again too soon)
  assert.equal(PF.outOfQuota("claude-code", Date.now() + 61 * 60 * 1000), true, "still resting after an hour");
  assert.equal(PF.outOfQuota("claude-code", Date.now() + PF.OUT_MS + 60 * 1000), false, "and comes back after a few hours");
  assert.equal(PF.planMeterView().routes.find((r) => r.id === "claude-code").outOfQuota, true);
});
