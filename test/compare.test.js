// Phase 17: side-by-side comparison. The running server in a temp data dir with the three demo AIs (local
// mock, no real key or URL): 3 models answer in parallel and each column reports cost and latency; every
// call has a ledger entry; picking a winner writes a rating the router reads; a preset saves and reloads;
// a column whose provider is at its spend cap is skipped with a note and costs nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COLS = [{ provider: "demo-nova", model: "nova-lite" }, { provider: "demo-atlas", model: "atlas-pro" }, { provider: "demo-sage", model: "sage-mini" }];
const PROMPT = "Write a two-line tagline for a neighbourhood bakery.";

async function waitRun(s, id, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = await s.api(`/compare/${id}`); if (r.json?.status && r.json.status !== "running") return r.json; await sleep(250); }
  throw new Error("comparison did not finish");
}
const ledgerFor = async (s, id) => (await s.api("/state")).json.ledger.recent.filter((e) => e.missionId === id);

let savedPresets = null;
test("side-by-side comparison: parallel columns, ledger, winner rating, presets, spend cap skip", { timeout: 180000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);

    // the model list comes with an estimate per column, and needs the session token like every route
    assert.equal((await s.api("/compare/models", { noToken: true })).status, 401);
    const models = (await s.api(`/compare/models?chars=${PROMPT.length}`)).json;
    for (const c of COLS) { const m = models.models.find((x) => x.model === c.model); assert.ok(m && m.keyed && !m.capped && m.estCost > 0, `${c.model} listed with an estimate`); }

    // input checks
    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: PROMPT, columns: COLS.slice(0, 1) } })).status, 400, "one model is not a comparison");
    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: PROMPT, columns: [COLS[0], COLS[0]] } })).status, 400, "the same model twice is one column");
    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: PROMPT, columns: Array(7).fill(0).map((_, i) => COLS[i % 3]).concat([{ provider: "demo-nova", model: "nova-ultra" }]) } })).status, 202, "duplicates collapse: 4 different models are fine");
    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: " ", columns: COLS } })).status, 400);
    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: PROMPT, columns: [COLS[0], { provider: "demo-nova", model: "nope" }] } })).status, 400);
    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: PROMPT, columns: [COLS[0], { provider: "nobody", model: "x" }] } })).status, 400);

    // ---- 3 demo models in parallel ----
    const start = await s.api("/compare", { method: "POST", body: { prompt: PROMPT, columns: COLS } });
    assert.equal(start.status, 202);
    assert.equal(start.json.columns.length, 3);
    const run = await waitRun(s, start.json.id);
    assert.equal(run.status, "done");
    for (const c of run.columns) {
      assert.equal(c.status, "done", `${c.model}: ${c.note}`);
      assert.ok(c.text.length > 20, `${c.model} answered`);
      assert.ok(typeof c.cost === "number" && c.cost > 0, `${c.model} reports cost`);
      assert.ok(c.ms > 0 && c.ttftMs != null && c.ttftMs <= c.ms, `${c.model} reports latency (${c.ttftMs} / ${c.ms} ms)`);
      assert.ok(c.inTok > 0 && c.outTok > 0);
    }
    // parallel: every column had started before the first one finished
    const firstEnd = Math.min(...run.columns.map((c) => c.finishedAt));
    assert.ok(run.columns.every((c) => c.startedAt <= firstEnd), "columns ran in parallel");
    assert.equal(run.cost, +run.columns.reduce((a, c) => a + c.cost, 0).toFixed(6));

    // every call has a ledger entry, matching its column's cost
    const led = await ledgerFor(s, run.id);
    assert.equal(led.length, 3, "three ledger entries");
    for (const c of run.columns) { const e = led.find((x) => x.model === c.model); assert.ok(e, `ledger has ${c.model}`); assert.equal(e.role, "compare"); assert.equal(e.kind, "call"); assert.equal(e.cost, c.cost); }

    // the list shows it
    assert.ok((await s.api("/compare")).json.items.some((x) => x.id === run.id && x.status === "done"));

    // ---- pick winner: a rating the router reads ----
    const win = run.columns[1];
    assert.equal((await s.api(`/compare/${run.id}/winner`, { method: "POST", body: { column: 7 } })).status, 400);
    const w = await s.api(`/compare/${run.id}/winner`, { method: "POST", body: { column: win.i } });
    assert.equal(w.status, 200, w.text);
    assert.equal(w.json.run.winner.model, win.model);
    assert.equal(w.json.rating.up, true);
    assert.equal((await s.api(`/compare/${run.id}/winner`, { method: "POST", body: { column: 0 } })).status, 409, "one winner per comparison");
    const ratings = (await s.api(`/ratings/mission/${run.id}`)).json;
    assert.equal(ratings.length, 1); assert.equal(ratings[0].model, win.model); assert.equal(ratings[0].kind, "compare"); assert.equal(ratings[0].up, true);
    // the learning router has the thumb on this task type, and the pick for it reads the record
    const brain = (await s.api("/brain")).json;
    const cap = brain.capabilities.find((c) => c.capability === run.capability);
    assert.ok(cap, `the router learned ${run.capability}`);
    const row = cap.models.find((m) => m.model === win.model);
    assert.equal(row.up, 1, "winner has the thumbs-up");
    assert.ok(cap.models.filter((m) => m.model !== win.model).every((m) => m.up === 0), "losers have no thumb");
    assert.ok(cap.models.every((m) => m.jobs >= 1), "each column counted as a job");
    const pick = (await s.api(`/brain/pick?capability=${run.capability}&difficulty=${run.difficulty}`)).json;
    const ranked = pick.ranked.find((m) => m.model === win.model);
    assert.ok(ranked?.learned && ranked.learned.jobs >= 1, "the router's pick uses the record");
    // no prompt text in what the router stores
    assert.ok(!JSON.stringify((await s.api("/brain/export")).json).includes("bakery"));

    // ---- presets save and reload ----
    assert.equal((await s.api("/compare/presets", { method: "POST", body: { name: "", columns: COLS } })).status, 400);
    const pr = await s.api("/compare/presets", { method: "POST", body: { name: "Cheap trio", columns: COLS } });
    assert.equal(pr.status, 200);
    const again = await s.api("/compare/presets", { method: "POST", body: { name: "cheap trio", columns: COLS.slice(0, 2) } });
    assert.equal(again.json.id, pr.json.id, "same name updates the preset");
    let list = (await s.api("/compare/presets")).json.items;
    assert.equal(list.length, 1); assert.deepEqual(list[0].columns, COLS.slice(0, 2));
    await s.api("/compare/presets", { method: "POST", body: { name: "Cheap trio", columns: COLS } });
    list = (await s.api("/compare/presets")).json.items;
    assert.deepEqual(list[0].columns, COLS);
    savedPresets = fs.readFileSync(path.join(s.dir, "compare.presets.json"), "utf8");

    // ---- a provider at its spend cap is skipped with a note ----
    const capRes = await s.api("/alerts/caps", { method: "POST", body: { caps: { "demo-sage": 0.000001 } } });
    assert.equal(capRes.status, 200);
    assert.ok(capRes.json.stop.includes("demo-sage"), "sage is over its cap");
    assert.equal((await s.api("/compare/models")).json.models.find((m) => m.model === "sage-mini").capped, true);
    const capped = await s.api("/compare", { method: "POST", body: { prompt: PROMPT, columns: list[0].columns } });
    assert.equal(capped.status, 202);
    const sageCol = capped.json.columns.find((c) => c.provider === "demo-sage");
    assert.equal(sageCol.status, "skipped");
    assert.match(sageCol.note, /spend cap/);
    const run2 = await waitRun(s, capped.json.id);
    assert.equal(run2.status, "done");
    assert.equal(run2.columns.filter((c) => c.status === "done").length, 2);
    assert.equal(run2.columns.find((c) => c.provider === "demo-sage").cost, null);
    const led2 = await ledgerFor(s, run2.id);
    assert.equal(led2.length, 2, "only the two answered columns are in the ledger");
    assert.ok(!led2.some((e) => e.provider === "demo-sage"), "the capped provider was never called");
    // a skipped column cannot win
    assert.equal((await s.api(`/compare/${run2.id}/winner`, { method: "POST", body: { column: sageCol.i } })).status, 400);

    // a column without a key is skipped too (demo off removes the demo keys)
    await s.api("/demo", { method: "POST", body: { on: false } });
    const nokey = await s.api("/compare", { method: "POST", body: { prompt: PROMPT, columns: COLS.slice(0, 2) } });
    if (nokey.status === 202) assert.ok(nokey.json.columns.every((c) => c.status === "skipped" && /no API key|spend cap/.test(c.note)));
    else assert.equal(nokey.status, 400); // the demo AIs left the registry for this user
  } finally { await s.stop(); }
});

test("a saved preset reloads in a fresh start of the app, and deletes", { timeout: 60000 }, async () => {
  assert.ok(savedPresets, "the first test saved a preset document");
  const s = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "compare.presets.json"), savedPresets) });
  try {
    const list = (await s.api("/compare/presets")).json.items;
    assert.equal(list.length, 1); assert.equal(list[0].name, "Cheap trio"); assert.deepEqual(list[0].columns, COLS);
    assert.equal((await s.api(`/compare/presets/${list[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api("/compare/presets")).json.items.length, 0);
    assert.equal((await s.api("/compare/presets/nope", { method: "DELETE" })).status, 404);
  } finally { await s.stop(); }
});

test("Phase 17 files: no em-dashes in user-facing text", () => {
  for (const f of ["server/compare.js", "server/plugins/compare.js", "web/features/compare.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
