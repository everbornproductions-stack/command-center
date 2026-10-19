// Phase 1: onboarding tour. The sample run must only ever hit the demo AIs: refused with demo off,
// refused when real keys exist, a Single on Free, a Mission on Pro/owner. State persists per user.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";
import { sampleDecision, SAMPLE_GOAL, DEFAULTS } from "../server/plugins/tour.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("sampleDecision: demo off → refused; real keys → refused; otherwise mission when allowed, else single", () => {
  assert.equal(sampleDecision({ demo: false, realKeys: false, canMission: true }).code, "demo_off");
  assert.equal(sampleDecision({ demo: true, realKeys: true, canMission: true }).code, "real_keys");
  assert.equal(sampleDecision({ demo: false, realKeys: true, canMission: true }).code, "demo_off", "demo check comes first");
  assert.deepEqual(sampleDecision({ demo: true, realKeys: false, canMission: true }), { ok: true, kind: "mission" });
  assert.deepEqual(sampleDecision({ demo: true, realKeys: false, canMission: false }), { ok: true, kind: "single" });
  assert.equal(DEFAULTS.completed, false);
});

test("free copy: state, sample gating (demo off → 400; demo on → single, no mission created), complete / skip / reset persist", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/tour", { noToken: true })).status, 401);
    const g = await s.api("/tour");
    assert.equal(g.status, 200);
    assert.equal(g.json.completed, false); assert.equal(g.json.skippedAt, null); assert.equal(g.json.sampleRuns, 0);
    assert.equal(g.json.demo, false); assert.equal(g.json.realKeys, false); assert.equal(g.json.canMission, false);
    assert.equal(g.json.sample.goal, SAMPLE_GOAL);

    const off = await s.api("/tour/sample", { method: "POST" });
    assert.equal(off.status, 400); assert.equal(off.json.code, "demo_off");
    assert.equal((await s.api("/tour")).json.sampleRuns, 0, "a refused sample is not counted");

    const demo = await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal(demo.json.demo, true);
    assert.equal((await s.api("/tour")).json.demo, true);
    assert.equal((await s.api("/tour")).json.realKeys, false, "demo keys do not count as real keys");

    const single = await s.api("/tour/sample", { method: "POST" });
    assert.equal(single.status, 200); assert.equal(single.json.kind, "single"); assert.equal(single.json.prompt, SAMPLE_GOAL);
    assert.ok(!(await s.api("/missions")).json.some((m) => m.kind === "mission"), "no mission was started on the Free tier");
    assert.equal((await s.api("/tour")).json.sampleRuns, 1);
    // the browser then posts the prompt as a Single, which Free allows
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: single.json.prompt } })).status, 202);

    const done = await s.api("/tour/complete", { method: "POST" });
    assert.equal(done.status, 200); assert.equal(done.json.completed, true); assert.ok(done.json.completedAt > 0);
    const file = path.join(s.dir, "tour.state.json");
    assert.ok(fs.existsSync(file), "tour.state.json written in the temp data dir");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).completed, true);
    const skipped = await s.api("/tour/skip", { method: "POST" });
    assert.ok(skipped.json.skippedAt > 0); assert.equal(skipped.json.completed, true, "skip does not undo completion");
    const reset = await s.api("/tour/reset", { method: "POST" });
    assert.equal(reset.json.completed, false); assert.equal(reset.json.skippedAt, null); assert.equal(reset.json.sampleRuns, 0);
    assert.equal((await s.api("/tour/nothing", { method: "POST" })).status, 404);
    assert.ok((await s.api("/state")).json.plugins.includes("tour"));
  } finally { await s.stop(); }
});

test("owner copy: demo on → the sample starts a real demo mission (then aborted so the test stays short)", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/tour")).json.canMission, true);
    await s.api("/demo", { method: "POST", body: { on: true } });
    const r = await s.api("/tour/sample", { method: "POST" });
    assert.equal(r.status, 202); assert.equal(r.json.kind, "mission"); assert.equal(r.json.goal, SAMPLE_GOAL);
    let mission = null;
    for (let i = 0; i < 100 && !mission; i++) { mission = (await s.api("/missions")).json.find((m) => m.kind === "mission"); if (!mission) await sleep(100); }
    assert.ok(mission, "a mission appeared within 10 s");
    assert.ok(["scheduled", "planning", "running", "assembling", "done", "done-with-errors"].includes(mission.status), `status ${mission.status}`);
    assert.equal((await s.api("/tour")).json.sampleRuns, 1);
    await s.api(`/mission/${mission.id}/abort`, { method: "POST" });
  } finally { await s.stop(); }
});
