// Stop in a normal chat: the answer stops, what was written is kept, and nothing is called a failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("Stop ends a running chat and keeps the partial answer", { timeout: 120000 }, async () => {
  const s = await startServer();
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const started = await s.api("/chat", { method: "POST", body: { prompt: "Write a long, detailed plan for opening a bakery, with many steps and notes." } });
    assert.equal(started.status, 202, started.text);
    const id = started.json.runId || started.json.id;
    assert.ok(id);
    await sleep(400);
    const stop = await s.api(`/mission/${id}/abort`, { method: "POST" });
    assert.equal(stop.status, 200);
    assert.equal(stop.json.aborted, true, "a live chat can be stopped");
    let run;
    for (let i = 0; i < 100; i++) { run = (await s.api(`/missions/${id}`)).json; if (run?.status && run.status !== "running") break; await sleep(100); }
    assert.equal(run.status, "aborted");
    assert.match(run.error, /Stopped by you/);
    assert.equal(typeof run.deliverable, "string");
    assert.equal((await s.api(`/mission/${id}/abort`, { method: "POST" })).json.aborted, false, "a second Stop has nothing to stop");
  } finally { await s.stop(); }
});

test("both chat screens have a Stop button wired to the abort route", () => {
  const app = read("web", "app.js");
  assert.equal((app.match(/id="stop-chat"/g) || []).length, 2);
  assert.match(app, /\/mission\/\$\{encodeURIComponent\(id\)\}\/abort/);
  assert.match(app, /addEventListener\("click", stopChat\)/);
});
