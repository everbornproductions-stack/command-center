// Quality, Balanced, Max savings and Speed change which model rank() picks.
// economy is the old name for Max savings. Local registry only. No real key or URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, tmpDir } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const DIR = tmpDir("cc-modes-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { rank } = await import("../server/router.js");
const { normalizeMode, councilPlan, planMode, reviewMode, costWeight, speedBoost, MODE_LABEL } = await import("../server/modes.js");

test("economy is Max savings, and Speed is its own priority", () => {
  assert.equal(normalizeMode("economy"), "savings");
  assert.equal(normalizeMode("Speed"), "speed");
  assert.equal(normalizeMode("nope"), null);
  assert.equal(costWeight("economy"), costWeight("savings"));
  assert.ok(costWeight("savings") > costWeight("balanced"));
  assert.ok(costWeight("speed") < costWeight("balanced"));
  assert.equal(speedBoost("quality", 99), 0);
  assert.ok(speedBoost("speed", 99) > speedBoost("speed", 40));
  assert.deepEqual(councilPlan(undefined, true), { priority: "savings", members: 3 });
  assert.deepEqual(councilPlan("quality", true), { priority: "quality", members: 4 });
  assert.deepEqual(councilPlan("speed"), { priority: "speed", members: 4 });
  assert.deepEqual(councilPlan("economy"), { priority: "savings", members: 3 });
  assert.equal(planMode("economy"), "balanced");
  assert.equal(planMode("speed"), "speed");
  assert.equal(planMode("quality"), "quality");
  assert.equal(reviewMode("quality"), "balanced");
  assert.equal(reviewMode("speed"), "speed");
  assert.equal(reviewMode("balanced"), "savings");
  assert.equal(MODE_LABEL.savings, "Max savings");
  assert.equal(JSON.stringify(MODE_LABEL).includes("\u2014"), false);
});

test("Quality, Max savings and Speed pick different models when both ChatGPT and Groq are keyed", () => {
  const c = store.ctx();
  c.secrets.openai = { key: "sk-test-not-a-real-key" };
  c.secrets.groq = { key: "gsk_test-not-a-real-key" };
  c.docs.settings = { uiMode: "expert", preferFree: false, defaultMode: "balanced" };
  c.health.openai = { status: "green", detail: "ok", checkedAt: Date.now() };
  c.health.groq = { status: "green", detail: "ok", checkedAt: Date.now() };
  const top = (mode) => rank({ capability: "writing", difficulty: 1, mode })[0];
  const quality = top("quality");
  const savings = top("savings");
  const economy = top("economy");
  const speed = top("speed");
  const balanced = top("balanced");
  assert.equal(quality.model, "gpt-6.1-sol", "Quality keeps the stronger ChatGPT model");
  assert.equal(savings.model, "gpt-6-luna", "Max savings keeps the cheaper ChatGPT model");
  assert.equal(economy.model, savings.model, "economy is the same pick as Max savings");
  assert.equal(speed.model, "openai/gpt-oss-120b", `Speed follows registry speed, picked ${speed.model}`);
  assert.notEqual(speed.model, savings.model);
  assert.notEqual(speed.model, quality.model);
  assert.notEqual(balanced.model, speed.model);
});

test("Single, Council and Mission all receive the picked priority", () => {
  const app = read("web", "app.js");
  const server = read("server", "index.js");
  const council = read("server", "council.js");
  const mission = read("server", "mission.js");
  assert.match(app, /\["quality", "Quality"\], \["balanced", "Balanced"\], \["savings", "Max savings"\], \["speed", "Speed"\]/);
  assert.match(app, /const picked = !simple && S\.costMode \? \{ mode: S\.costMode \} : \{\}/);
  assert.match(app, /mode: costMode, lite: costMode === "savings" \|\| costMode === "economy"/);
  assert.match(app, /goal: prompt, mode: costMode/);
  assert.match(server, /mode: job\.mode/);
  assert.match(server, /normalizeMode\(job\.mode \|\| s\.defaultMode\)/);
  assert.match(council, /councilPlan\(asked, lite\)/);
  assert.match(council, /reviewMode\(mode\)/);
  assert.match(mission, /planMode\(mode\)/);
  assert.match(mission, /reviewMode\(mode\)/);
  assert.match(mission, /Switching every task to Max savings/);
  assert.equal(app.includes("\u2014"), false);
  assert.equal(read("docs", "USER-GUIDE.md").includes("\u2014"), false);
});
