// 0.4.21 item 19: "Jobs go to the AI with the login". A signed-in subscription app takes jobs ahead of paid API models,
// after this PC and free allowances (the K-free cost order: this PC, free, your plan, paid). Fake apps only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-loginfirst-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_SUBCLI_NO_PATH = "1";
process.env.CC_SUBCLI_HOME = tmpDir("cc-loginfirst-home-");
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { readPlanFirst, applyPlanFirst } = await import("../server/plans.js");
const { loginLine, planMeterView } = await import("../server/plan-first.js");
const EM = String.fromCharCode(0x2014);

const rows = () => [
  { model: "ollama-x", localFree: true, estCost: 0 },
  { model: "groq-free", free: true, estCost: 0 },
  { model: "claude-api", estCost: 0.02 },
  { model: "gpt-api", estCost: 0.03 },
  { model: "plan-claude-code", planRoute: true, estCost: 0 },
];

test("on by default, off only when the person says so", () => {
  assert.equal(readPlanFirst(), true);
  store.putDoc("settings", { planFirst: false });
  assert.equal(readPlanFirst(), false);
  store.putDoc("settings", { planFirst: true });
  assert.equal(readPlanFirst(), true);
  store.putDoc("settings", {});
});

test("order: this PC, free, then the login, then paid API", () => {
  const out = applyPlanFirst(rows()).map((m) => m.model);
  assert.deepEqual(out, ["ollama-x", "groq-free", "plan-claude-code", "claude-api", "gpt-api"]);
  assert.equal(applyPlanFirst(rows())[2].planFirst, true);
  assert.deepEqual(applyPlanFirst(rows(), false).map((m) => m.model), rows().map((m) => m.model), "off means no change");
});

test("with no login there is nothing to reorder", () => {
  const noLogin = rows().filter((m) => !m.planRoute);
  assert.deepEqual(applyPlanFirst(noLogin).map((m) => m.model), noLogin.map((m) => m.model));
});

test("the line where the feature lives names who gets jobs, or the one step to take", () => {
  assert.match(loginLine(["Claude Code", "Codex"], true), /signed in to first: Claude Code, Codex\. No extra charge\. Free AIs on this PC still go before it\./);
  assert.match(loginLine([], true), /Sign in to Claude Code, Codex or Gemini CLI on this PC/);
  assert.match(loginLine([], false), /Turn on Use my plan first/);
  for (const l of [loginLine(["A"], true), loginLine([], true), loginLine([], false)]) assert.ok(!l.includes(EM));
  const v = planMeterView();
  assert.equal(v.on, true);
  assert.equal(typeof v.line, "string");
});
