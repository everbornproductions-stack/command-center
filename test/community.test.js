// Community track records teach every priority. Nothing is uploaded. No real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-community-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const brain = await import("../server/brain.js");
const community = await import("../server/community.js");
const { rank } = await import("../server/router.js");

function useOpenAI() {
  const c = store.ctx();
  c.secrets = { openai: { key: "sk-test-not-real" } };
  c.docs.settings = { preferFree: false, uiMode: "expert" };
  c.health = {};
  brain.resetBrain();
  brain.saveBrainSettings({ on: true, shareOptIn: true });
}

const ROWS = [
  { model: "gpt-6-astra", capability: "writing", jobs: 40, successRate: 1, avgScore: 9.5, costPerJob: 0.0001, avgSec: 2 },
  { model: "gpt-6.1-sol", capability: "writing", jobs: 40, successRate: 0.4, avgScore: 2, costPerJob: 0.2, avgSec: 8 },
  { model: "gpt-6-luna", capability: "writing", jobs: 40, successRate: 0.4, avgScore: 2, costPerJob: 0.2, avgSec: 8 },
];

test("quality, balanced, max savings, and speed all move when opted-in totals are on this computer", () => {
  useOpenAI();
  const modes = ["quality", "balanced", "savings", "speed", "economy"];
  const before = {};
  for (const mode of modes) before[mode] = rank({ capability: "writing", difficulty: 1, mode })[0].model;
  assert.notEqual(before.quality, "gpt-6-astra");
  assert.notEqual(before.economy, "gpt-6-astra");
  assert.notEqual(before.speed, "gpt-6-astra");
  community.replaceCommunity(ROWS);
  const after = {};
  for (const mode of modes) after[mode] = rank({ capability: "writing", difficulty: 1, mode })[0].model;
  for (const mode of modes) assert.equal(after[mode], "gpt-6-astra", mode);
  assert.notEqual(after.quality, before.quality);
  assert.notEqual(after.economy, before.economy);
  assert.notEqual(after.speed, before.speed);
  const raw = fs.readFileSync(path.join(DIR, "brain.community.json"), "utf8");
  assert.doesNotMatch(raw, /prompt|secret|sk-|email/i);
  brain.resetBrain();
  assert.equal(community.communitySummary().rows, 0);
  assert.notEqual(rank({ capability: "writing", difficulty: 1, mode: "quality" })[0].model, "gpt-6-astra");
});

test("a row with a prompt is refused and the share preview still sends nothing", async () => {
  useOpenAI();
  assert.throws(() => community.replaceCommunity([{ ...ROWS[0], prompt: "secret prompt" }]), /anonymous total/);
  assert.equal(community.communitySummary().rows, 0);
  const s = await startServer({ env: { CC_STATUS_PAGES: "off", CC_DEV_OWNER: "1" } });
  try {
    const bad = await s.api("/brain/community", { method: "POST", body: { rows: [{ model: "gpt-6-luna", capability: "writing", jobs: 3, key: "sk-test" }] } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.sent, false);
    const ok = await s.api("/brain/community", { method: "POST", body: { rows: ROWS } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.sent, false);
    assert.ok(ok.json.rows >= 3);
    const view = await s.api("/brain?mode=quality");
    assert.ok(view.json.capabilities.some((c) => c.capability === "writing" && c.models.some((m) => m.model === "gpt-6-astra")));
    for (const mode of ["balanced", "economy", "savings", "speed"]) {
      const again = await s.api(`/brain?mode=${mode}`);
      assert.equal(again.status, 200, mode);
      assert.ok(again.json.capabilities.some((c) => c.capability === "writing" && c.models[0].model === "gpt-6-astra"), mode);
    }
    assert.equal((await s.api("/brain/share-preview")).json.sent, false);
  } finally { await s.stop(); }
});

test("the page names every priority and does not upload", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "brain.js"), "utf8");
  const guide = fs.readFileSync(path.join(ROOT, "docs", "USER-GUIDE.md"), "utf8");
  assert.match(ui, /Add community track records/);
  assert.match(ui, /Quality, Balanced, Max savings, and Speed/);
  assert.match(ui, /Nothing is uploaded/);
  assert.match(ui, /This version sends nothing/);
  assert.match(guide, /Nothing is uploaded/);
  for (const file of ["server/community.js", "web/features/brain.js", "docs/USER-GUIDE.md"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes("\u2014"), false, file);
  }
});
