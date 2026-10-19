// Phase 17: side-by-side comparison. Three demo models answer in parallel (cost and latency
// per column, one ledger line per call), Pick winner writes a rating the router reads,
// a preset saves and reloads, and a provider at its spend cap is skipped. No real keys or URLs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { LIMITS, selectionError, spendCapNote, noKeyNote } from "../server/plugins/compare.js";

const MODELS = [
  { provider: "demo-nova", model: "nova-ultra" },
  { provider: "demo-atlas", model: "atlas-pro" },
  { provider: "demo-sage", model: "sage-mini" },
];

test("selection bounds, skip notes, and no em-dash in the feature", () => {
  assert.equal(LIMITS.min, 2);
  assert.equal(LIMITS.max, 6);
  assert.match(selectionError([]), /2 to 6/);
  assert.match(selectionError(MODELS.slice(0, 1)), /2 to 6/);
  assert.match(selectionError([...MODELS, ...MODELS, ...MODELS.slice(0, 1)]), /2 to 6/);
  assert.match(selectionError([...MODELS, MODELS[0]]), /only appear once/);
  assert.equal(selectionError(MODELS), null);
  for (const s of [spendCapNote("Sage (demo)"), noKeyNote("Nova (demo)")]) {
    assert.match(s, /No call was made/);
    assert.doesNotMatch(s, /\u2014/);
  }
  assert.match(spendCapNote("Sage (demo)"), /spend cap/);
  for (const f of ["server/plugins/compare.js", "web/features/compare.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /\u2014/, f);
    assert.match(src, /Pick winner|winner/);
  }
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/index.js"), "utf8"), /"compare"/);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitDone(s, id) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 90000) {
    const r = await s.api(`/compare/${id}`);
    last = r.json;
    if (r.status === 200 && last.status && last.status !== "running") return last;
    await sleep(250);
  }
  throw new Error("comparison did not finish: " + JSON.stringify(last)?.slice(0, 400));
}

test("server: parallel demo columns, ledger, winner rating, preset, spend cap skip", async () => {
  const s = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    assert.equal((await s.api("/compare", { noToken: true })).status, 401);
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    assert.ok((await s.api("/state")).json.plugins.includes("compare"));

    const view = (await s.api("/compare")).json;
    assert.equal(view.min, 2);
    assert.equal(view.max, 6);
    for (const m of MODELS) assert.ok(view.models.some((x) => x.provider === m.provider && x.model === m.model), m.model);

    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: "Write hi", models: MODELS.slice(0, 1) } })).status, 400);
    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: "  ", models: MODELS } })).status, 400);
    assert.equal((await s.api("/compare", { method: "POST", body: { prompt: "Write hi", models: [{ provider: "demo-nova", model: "no-such-model" }, MODELS[1]] } })).status, 400);

    const saved = await s.api("/compare/presets", { method: "POST", body: { name: "Demo trio", models: MODELS } });
    assert.equal(saved.status, 200);
    assert.ok(saved.json.id);
    const loaded = await s.api(`/compare/presets/${saved.json.id}`);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.json.name, "Demo trio");
    assert.deepEqual(loaded.json.models, MODELS);
    const listed = await s.api("/compare/presets");
    assert.ok(listed.json.items.some((p) => p.id === saved.json.id && p.name === "Demo trio"));

    const prompt = "Write a one-line tagline for a coffee roaster. Token ZEBRA-TAGLINE-8841.";
    const started = await s.api("/compare", { method: "POST", body: { prompt, presetId: saved.json.id } });
    assert.equal(started.status, 202);
    assert.equal(started.json.compare.columns.length, 3);
    const tooSoon = await s.api(`/compare/${started.json.id}/winner`, { method: "POST", body: { provider: "demo-atlas", model: "atlas-pro" } });
    if (tooSoon.status !== 409) {
      const mid = await s.api(`/compare/${started.json.id}`);
      assert.equal(mid.json.status, "running", "winner before the answers finish is refused");
    }

    const run = await waitDone(s, started.json.id);
    assert.equal(run.status, "done");
    assert.equal(run.classification.capability, "writing");
    assert.equal(run.columns.length, 3);
    const wall = run.finishedAt - run.startedAt;
    const sumMs = run.columns.reduce((a, c) => a + c.ms, 0);
    assert.ok(wall < sumMs, `columns ran in parallel (wall ${wall}ms, sum ${sumMs}ms)`);
    for (const c of run.columns) {
      assert.equal(c.status, "done", c.model);
      assert.ok(c.text && c.text.includes(c.model), "demo answer names its model");
      assert.equal(typeof c.cost, "number");
      assert.ok(c.cost > 0, `${c.model} cost`);
      assert.ok(c.ms > 0, `${c.model} latency`);
    }

    const state = (await s.api("/state")).json;
    const lines = state.ledger.recent.filter((e) => e.missionId === run.id && e.role === "compare");
    assert.equal(lines.length, 3, "one ledger line per call");
    for (const c of run.columns) {
      const e = lines.find((x) => x.model === c.model && x.provider === c.provider);
      assert.ok(e, c.model);
      assert.equal(e.kind, "call");
      assert.equal(e.cost, c.cost);
      assert.equal(e.ms, c.ms);
      assert.equal(JSON.stringify(e).includes("ZEBRA-TAGLINE-8841"), false, "ledger has no prompt text");
    }

    const picked = await s.api(`/compare/${run.id}/winner`, { method: "POST", body: { provider: "demo-atlas", model: "atlas-pro" } });
    assert.equal(picked.status, 200);
    assert.equal(picked.json.capability, "writing");
    assert.equal(picked.json.compare.winner.model, "atlas-pro");
    assert.equal(picked.json.compare.columns.find((c) => c.model === "atlas-pro").winner, true);
    const ratings = (await s.api(`/ratings/mission/${run.id}`)).json;
    assert.equal(ratings.length, 3);
    assert.equal(ratings.find((r) => r.model === "atlas-pro").up, true);
    assert.equal(ratings.filter((r) => !r.up).length, 2);
    assert.equal(JSON.stringify(ratings).includes("ZEBRA-TAGLINE-8841"), false, "ratings have no prompt text");
    const skills = (await s.api("/ratings/summary")).json.skills;
    assert.equal(skills["atlas-pro"].writing.wins, 1);
    assert.equal(skills["atlas-pro"].writing.total, 1);
    assert.equal(skills["nova-ultra"].writing.wins, 0);
    assert.equal(skills["nova-ultra"].writing.total, 1);
    assert.equal(skills["sage-mini"].writing.total, 1);
    const routerSkills = (await s.api("/state")).json.skills;
    assert.equal(routerSkills["atlas-pro"].writing.wins, 1, "the router skill table has the win");
    assert.equal(JSON.stringify(routerSkills).includes("ZEBRA-TAGLINE-8841"), false);

    const sageCost = run.columns.find((c) => c.model === "sage-mini").cost;
    const caps = await s.api("/alerts/caps", { method: "POST", body: { caps: { "demo-sage": sageCost / 2 } } });
    assert.equal(caps.status, 200);
    assert.ok(caps.json.stop.includes("demo-sage"));
    const marked = (await s.api("/compare")).json.models;
    assert.equal(marked.find((m) => m.model === "sage-mini").capped, true);
    assert.equal(marked.find((m) => m.model === "nova-ultra").capped, false);

    const again = await s.api("/compare", { method: "POST", body: { prompt: "Write a second tagline.", models: MODELS } });
    assert.equal(again.status, 202);
    const run2 = await waitDone(s, again.json.id);
    const skipped = run2.columns.find((c) => c.model === "sage-mini");
    assert.equal(skipped.status, "skipped");
    assert.match(skipped.note, /spend cap/);
    assert.match(skipped.note, /No call was made/);
    assert.equal(skipped.cost, null);
    for (const c of run2.columns.filter((c) => c.model !== "sage-mini")) {
      assert.equal(c.status, "done");
      assert.ok(c.cost > 0 && c.ms > 0);
    }
    const lines2 = (await s.api("/state")).json.ledger.recent.filter((e) => e.missionId === run2.id && e.role === "compare");
    assert.equal(lines2.length, 2);
    assert.ok(!lines2.some((e) => e.provider === "demo-sage"));

    assert.equal((await s.api(`/compare/presets/${saved.json.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api(`/compare/presets/${saved.json.id}`)).status, 404);
    assert.equal(s.log.includes("demo-key"), false, "the demo key never reaches the log");
  } finally { await s.stop(); }
});
