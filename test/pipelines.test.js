// Phase 2: starter pipelines (R1). The running server in a temp data dir, demo AIs only (local mock, no real
// key or URL): the starters are listed, the Free tier is refused, a run is one mission filed under the
// project with its own savings receipt, off-peak queues or runs, custom pipelines save and delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STARTERS = ["instagram-week", "client-proposal", "music-video"];

test("starter pipelines are listed with inputs and steps; the Free tier cannot run them", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/pipelines", { noToken: true })).status, 401);
    const list = (await s.api("/pipelines")).json;
    for (const id of STARTERS) {
      const p = list.find((x) => x.id === id);
      assert.ok(p, `${id} ships`);
      assert.equal(p.builtIn, true);
      assert.ok(p.inputs.length >= 2 && p.steps.length >= 3, `${id} has inputs and steps`);
      for (const st of p.steps) for (const d of st.deps || []) assert.ok(d >= 1 && d <= p.steps.length, `${id}: step deps point at real steps`);
    }
    assert.equal((await s.api("/pipelines/run", { method: "POST", body: { id: "nope" } })).status, 404);
    const free = await s.api("/pipelines/run", { method: "POST", body: { id: "client-proposal", values: { client: "Test Bakery" } } });
    assert.equal(free.status, 402, "missions are a paid feature");
    assert.equal((await s.api("/pipelines/runs")).json.length, 0, "a refused run is not recorded");
  } finally { await s.stop(); }
});

test("one click runs a mission filed under the project, with a receipt; custom pipelines save and delete", { timeout: 240000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const proj = await s.api("/projects", { method: "POST", body: { name: "Test Bakery" } });
    assert.equal(proj.status, 200, proj.text);
    const projectId = proj.json.id;

    const r = await s.api("/pipelines/run", { method: "POST", body: { id: "client-proposal", values: { client: "Test Bakery", need: "a website" }, projectId } });
    assert.equal(r.status, 202, r.text);
    assert.match(r.json.goal, /Client proposal for Test Bakery/);
    const runs = (await s.api("/pipelines/runs")).json;
    assert.equal(runs[0].pipelineId, "client-proposal"); assert.equal(runs[0].projectId, projectId);

    let m = null;
    for (let i = 0; i < 600; i++) {
      m = (await s.api("/missions")).json.find((x) => x.kind === "mission" && x.projectId === projectId);
      if (m && ["done", "done-with-errors", "failed", "aborted"].includes(m.status)) break;
      await sleep(250);
    }
    assert.ok(m, "the pipeline started a mission for the project");
    assert.ok(["done", "done-with-errors"].includes(m.status), `mission finished (${m.status})`);
    const full = (await s.api(`/missions/${m.id}`)).json;
    assert.equal(full.projectId, projectId, "results are filed under the project");
    assert.ok(full.deliverable && full.deliverable.length > 20, "the mission produced a deliverable");
    const rc = await s.api(`/receipt/${m.id}`);
    assert.equal(rc.status, 200, "the run has a savings receipt");
    assert.ok(rc.json.calls > 0);

    // off-peak: queued for the next discount window when one is configured, otherwise it runs now
    const off = await s.api("/pipelines/run", { method: "POST", body: { id: "instagram-week", values: { brand: "Test Bakery" }, runAt: "offpeak" } });
    assert.equal(off.status, 202, off.text);
    if (off.json.scheduled) {
      assert.equal(off.json.scheduled.status, "scheduled");
      assert.ok((await s.api("/missions")).json.some((x) => x.id === off.json.scheduled.id && x.status === "scheduled"));
      await s.api(`/mission/${off.json.scheduled.id}/abort`, { method: "POST" });
    }

    // custom pipelines
    assert.equal((await s.api("/pipelines/save", { method: "POST", body: { name: "Empty" } })).status, 400, "a pipeline needs a step");
    const saved = await s.api("/pipelines/save", { method: "POST", body: { name: "My weekly recap", steps: [{ title: "Recap", capability: "writing", instructions: "Recap the week." }] } });
    assert.equal(saved.status, 200);
    assert.ok((await s.api("/pipelines")).json.some((x) => x.id === saved.json.id && !x.builtIn));
    await s.api(`/pipelines/${saved.json.id}`, { method: "DELETE" });
    assert.ok(!(await s.api("/pipelines")).json.some((x) => x.id === saved.json.id));
  } finally { await s.stop(); }
});

test("Phase 2 pipeline files: no em-dashes in user-facing text", () => {
  for (const f of ["server/plugins/pipelines.js", "web/features/pipelines.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
