// Free / Pro feature map. Rows in the server match the table in the app.
// A free install is refused on Pro routes. An owner install is not. No charge, no Square call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { compareRows, featureById, registerFeature, unregisterFeature } from "../server/feature-gate.js";
import { COMPARE_ROWS } from "../web/compare.js";

test("the feature map matches the Free vs Pro table", () => {
  registerFeature({ id: "zzGate", tier: "pro", label: "ZZ gate", landed: false });
  try {
    assert.equal(featureById("zzGate").tier, "pro");
    assert.equal(featureById("zzGate").landed, false);
    assert.equal(featureById("nope"), null);
  } finally {
    unregisterFeature("zzGate");
  }
  assert.equal(featureById("zzGate"), null);
  assert.deepEqual(compareRows(), COMPARE_ROWS);
  assert.equal(featureById("shareLinks").landed, true);
  assert.equal(featureById("desktop").landed, true);
  assert.equal(featureById("scheduler").tier, "pro");
  assert.equal(featureById("tryItNow").tier, "free");
  assert.equal(featureById("safety").tier, "free");
  assert.equal(featureById("safety").landed, false);
  const billing = fs.readFileSync(path.join(ROOT, "docs", "billing.md"), "utf8");
  assert.match(billing, /server\/feature-gate\.js/);
  assert.equal(billing.includes("\u2014"), false);
  assert.match(billing, /\$15\.99/);
  assert.match(billing, /square\.link\/u\/dbU38mQC/);
});

test("free tier is refused on share links and schedules; owner is not", async () => {
  const free = await startServer();
  try {
    const share = await free.api("/share/create", { method: "POST", body: { missionId: "m-free" } });
    assert.equal(share.status, 402);
    assert.equal(share.json.code, "pro_required");
    assert.match(share.json.error, /Public share links is part of Pro/);
    const sched = await free.api("/schedules", { method: "POST", body: { name: "Nope", target: { kind: "chat", text: "hi" }, trigger: { type: "webhook" } } });
    assert.equal(sched.status, 402);
    assert.match(sched.json.error, /Schedules is part of Pro/);
    const prompts = await free.api("/prompts/schedules", { method: "POST", body: {} });
    assert.equal(prompts.status, 402);
    const state = await free.api("/state");
    assert.ok(Array.isArray(state.json.license.compare));
    assert.deepEqual(state.json.license.compare, COMPARE_ROWS);
    const growth = await free.api("/growth");
    assert.deepEqual(growth.json.compare, COMPARE_ROWS);
    assert.equal(growth.json.upgrade.show, false);
  } finally { await free.stop(); }

  const owner = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await owner.api("/share/create", { method: "POST", body: {} })).status, 400);
    const made = await owner.api("/schedules", { method: "POST", body: { name: "Owner hook", target: { kind: "chat", text: "hi" }, trigger: { type: "webhook" } } });
    assert.equal(made.status, 200);
    assert.equal((await owner.api(`/schedules/${made.json.schedule.id}`, { method: "DELETE" })).status, 200);
    const prompts = await owner.api("/prompts/schedules", { method: "POST", body: {} });
    assert.equal(prompts.status, 200);
    assert.equal(prompts.json.installed.length, 4);
  } finally { await owner.stop(); }
});
