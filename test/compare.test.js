// Phase 17: side-by-side comparison. Three demo models answer in parallel and each column
// reports cost and latency; picking a winner writes a rating the router reads; a preset saves
// and reloads; a column whose provider is at its spend cap is skipped with a note; every call
// has a ledger entry. Demo providers only. No real URL or key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";
import { selectionError, capSkipNote, MIN_MODELS, MAX_MODELS } from "../server/plugins/compare.js";

test("selection: 2 to 6 distinct models, cap note has no em dash", () => {
  assert.equal(MIN_MODELS, 2);
  assert.equal(MAX_MODELS, 6);
  assert.equal(selectionError([{ provider: "a", model: "b" }]), "Pick 2 to 6 models.");
  assert.equal(selectionError(Array.from({ length: 7 }, (_, i) => ({ provider: "p", model: "m" + i }))), "Pick 2 to 6 models.");
  assert.equal(selectionError([{ provider: "a", model: "b" }, { provider: "a", model: "b" }]), "Each model can only be picked once.");
  assert.equal(selectionError([{ provider: "a", model: "b" }, { provider: "", model: "c" }]), "Each model needs a provider and a model id.");
  assert.equal(selectionError([{ provider: "a", model: "b" }, { provider: "c", model: "d" }]), null);
  const note = capSkipNote("Sage (demo)");
  assert.match(note, /spend cap/);
  assert.doesNotMatch(note, /\u2014/);
  const ui = fs.readFileSync(path.join(import.meta.dirname, "..", "web", "features", "compare.js"), "utf8");
  const srv = fs.readFileSync(path.join(import.meta.dirname, "..", "server", "plugins", "compare.js"), "utf8");
  const hook = fs.readFileSync(path.join(import.meta.dirname, "..", "web", "features", "index.js"), "utf8");
  assert.doesNotMatch(ui + srv, /\u2014/, "no em dashes in the comparison copy");
  assert.match(hook, /"compare"/);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitCompare(s, id, ms = 60000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    const r = await s.api(`/compare/${id}`);
    last = r.json;
    if (r.status === 200 && last && last.status !== "running") return last;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${id} (${last?.status})`);
}

const TRIO = [
  { provider: "demo-nova", model: "nova-ultra" },
  { provider: "demo-atlas", model: "atlas-pro" },
  { provider: "demo-sage", model: "sage-mini" },
];

test("server: parallel demo columns, cost and speed, winner feeds the router, preset, spend cap skip, ledger", async () => {
  const s = await startServer();
  const prompt = "Write a short welcome note for a new customer. CODEWORD-ZEBRA-17";
  try {
    assert.equal((await s.api("/compare", { noToken: true })).status, 401, "session token required");
    assert.ok((await s.api("/state")).json.plugins.includes("compare"));
    await s.api("/demo", { method: "POST", body: { on: true } });

    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: "", models: TRIO } })).status, 400);
    assert.match((await s.api("/compare", { method: "POST", body: { prompt: "Write hi", models: [TRIO[0]] } })).json.error, /2 to 6/);
    const seven = Array.from({ length: 7 }, (_, i) => ({ provider: "demo-nova", model: "m" + i }));
    assert.match((await s.api("/compare", { method: "POST", body: { prompt: "Write hi", models: seven } })).json.error, /2 to 6/);
    assert.match((await s.api("/compare", { method: "POST", body: { prompt: "Write hi", models: [TRIO[0], TRIO[0], TRIO[1]] } })).json.error, /once/);
    assert.match((await s.api("/compare", { method: "POST", body: { prompt: "Write hi", models: [TRIO[0], { provider: "demo-nova", model: "no-such" }] } })).json.error, /Unknown model/);

    const saved = await s.api("/compare/presets", { method: "POST", body: { name: "Demo trio", models: TRIO } });
    assert.equal(saved.status, 200);
    const presetId = saved.json.preset.id;
    assert.equal(saved.json.preset.name, "Demo trio");
    assert.equal(saved.json.preset.models.length, 3);
    const reloaded = await s.api("/compare/presets");
    const again = reloaded.json.presets.find((p) => p.id === presetId);
    assert.ok(again, "preset reloads");
    assert.deepEqual(again.models, TRIO);
    const onDisk = JSON.parse(fs.readFileSync(path.join(s.dir, "compare.presets.json"), "utf8"));
    assert.ok(onDisk.items.some((p) => p.id === presetId && p.name === "Demo trio"));
    const temp = await s.api("/compare/presets", { method: "POST", body: { name: "Temp", models: TRIO } });
    assert.equal((await s.api(`/compare/presets/${temp.json.preset.id}`, { method: "DELETE" })).status, 200);
    assert.ok(!(await s.api("/compare/presets")).json.presets.some((p) => p.id === temp.json.preset.id));
    assert.equal((await s.api("/compare/presets/missing", { method: "DELETE" })).status, 404);

    const started = await s.api("/compare", { method: "POST", body: { prompt, presetId } });
    assert.equal(started.status, 202);
    assert.equal(started.json.compare.columns.length, 3);
    assert.equal(started.json.compare.classification.capability, "writing");
    const run = await waitCompare(s, started.json.id);
    assert.equal(run.status, "done");
    assert.equal(run.columns.length, 3);
    for (const c of run.columns) {
      assert.equal(c.status, "done", c.note || c.error || c.status);
      assert.equal(typeof c.cost, "number");
      assert.ok(c.cost > 0, `${c.model} cost`);
      assert.equal(typeof c.ms, "number");
      assert.ok(c.ms > 0, `${c.model} latency`);
      assert.match(c.text, new RegExp(c.model), "each column is that model's own answer");
    }
    const starts = run.columns.map((c) => c.startedAt);
    const ends = run.columns.map((c) => c.finishedAt);
    assert.ok(Math.max(...starts) < Math.min(...ends), `columns overlapped (starts ${starts.join(",")} ends ${ends.join(",")})`);

    let state = (await s.api("/state")).json;
    const lines = state.ledger.recent.filter((e) => e.kind === "call" && e.missionId === run.id);
    assert.equal(lines.length, 3, "every call has a ledger entry");
    for (const c of run.columns) {
      const line = lines.find((e) => e.model === c.model);
      assert.ok(line, c.model);
      assert.equal(line.role, "compare");
      assert.equal(line.provider, c.provider);
      assert.equal(line.cost, c.cost);
      assert.equal(line.ms, c.ms);
      assert.ok(!("prompt" in line) && !("text" in line));
    }

    const picked = await s.api(`/compare/${run.id}/winner`, { method: "POST", body: { model: "nova-ultra" } });
    assert.equal(picked.status, 200);
    assert.equal(picked.json.winner, "nova-ultra");
    const ratings = (await s.api(`/ratings/mission/${run.id}`)).json;
    const win = ratings.find((r) => r.model === "nova-ultra");
    assert.equal(win.up, true);
    assert.equal(win.kind, "compare");
    assert.equal(win.capability, "writing");
    assert.equal(win.provider, "demo-nova");
    assert.equal(win.cost, run.columns.find((c) => c.model === "nova-ultra").cost);
    assert.equal(win.ms, run.columns.find((c) => c.model === "nova-ultra").ms);
    assert.equal(ratings.find((r) => r.model === "atlas-pro").up, false);
    assert.equal(ratings.find((r) => r.model === "sage-mini").up, false);
    state = (await s.api("/state")).json;
    assert.ok(state.skills["nova-ultra"].writing.wins >= 1, "the router stored the win");
    assert.ok(state.skills["nova-ultra"].writing.total >= 1);
    assert.ok(state.skills["atlas-pro"].writing.total >= 1 && state.skills["atlas-pro"].writing.wins === 0);
    const summary = (await s.api("/ratings/summary")).json;
    assert.equal(summary.skills["nova-ultra"].writing.wins, state.skills["nova-ultra"].writing.wins);
    assert.ok(summary.byModel["nova-ultra"].up >= 1);
    const blob = JSON.stringify(lines) + JSON.stringify(ratings) + JSON.stringify(state.skills);
    assert.ok(!blob.includes("CODEWORD-ZEBRA-17"), "no prompt text in the ledger, the rating, or the skills");
    assert.ok(!s.log.includes("CODEWORD-ZEBRA-17"));
    assert.ok(!blob.includes("demo-key"));

    // a provider already over its monthly cap is skipped, with a note, and is not called
    await s.api("/credits", { method: "POST", body: { provider: "demo-sage", units: 1, cost: 2, note: "seed cap" } });
    const caps = await s.api("/alerts/caps", { method: "POST", body: { caps: { "demo-sage": 1 } } });
    assert.ok(caps.json.stop.includes("demo-sage"));
    const started2 = await s.api("/compare", { method: "POST", body: { prompt: "Write a second welcome note.", presetId } });
    assert.equal(started2.status, 202);
    const sageCol = started2.json.compare.columns.find((c) => c.provider === "demo-sage");
    assert.equal(sageCol.status, "skipped");
    assert.equal(sageCol.note, capSkipNote("Sage (demo)"));
    const run2 = await waitCompare(s, started2.json.id);
    assert.equal(run2.status, "done");
    const sageDone = run2.columns.find((c) => c.provider === "demo-sage");
    assert.equal(sageDone.status, "skipped");
    assert.equal(sageDone.cost, null);
    assert.equal(sageDone.text, "");
    for (const c of run2.columns.filter((c) => c.provider !== "demo-sage")) {
      assert.equal(c.status, "done");
      assert.ok(c.cost > 0 && c.ms > 0);
    }
    state = (await s.api("/state")).json;
    const lines2 = state.ledger.recent.filter((e) => e.kind === "call" && e.missionId === run2.id);
    assert.equal(lines2.length, 2);
    assert.ok(lines2.every((e) => e.provider !== "demo-sage" && e.role === "compare" && e.ms > 0));
    assert.equal((await s.api(`/compare/${run2.id}/winner`, { method: "POST", body: { model: "sage-mini" } })).status, 400);
  } finally { await s.stop(); }
});
