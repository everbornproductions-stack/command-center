// Phase 2: savings receipt per job (R7). The running server in a temp data dir, demo AIs only (local mock,
// no real key or URL): a finished chat has a receipt priced against the flagship, the Credits tab totals and
// recent list include it, and the browser code exports a PNG and mounts on the Credits tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("savings receipt: per run, totals, recent list", { timeout: 120000 }, async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/receipt/totals", { noToken: true })).status, 401);
    assert.equal((await s.api("/receipt/nothing-here")).status, 404, "no calls, no receipt");
    let t = (await s.api("/receipt/totals")).json;
    assert.equal(t.runs, 0); assert.equal(t.month.saved, 0);
    assert.deepEqual((await s.api("/receipt/recent")).json, []);

    await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a two-line tagline for a bakery.", provider: "demo-nova", model: "nova-lite" } })).status, 202);
    let m = null;
    for (let i = 0; i < 240 && !m; i++) { m = (await s.api("/missions")).json.find((x) => x.kind === "single" && x.status === "done"); if (!m) await sleep(250); }
    assert.ok(m, "the chat finished");

    const r = (await s.api(`/receipt/${m.id}`)).json;
    assert.equal(r.missionId, m.id);
    assert.ok(r.calls >= 1 && r.inTok > 0 && r.outTok > 0);
    assert.ok(r.actual > 0, "this run cost something");
    assert.ok(r.flagship?.model, "priced against a named flagship");
    assert.ok(r.flagshipCost >= r.actual, "the cheap demo model costs less than the flagship would");
    assert.ok(Math.abs(r.saved - Math.max(0, r.flagshipCost - r.actual)) < 1e-4);
    assert.ok(r.savedPct >= 0 && r.savedPct <= 100);
    assert.ok(r.byModel["nova-lite"]?.calls >= 1, "per-model breakdown");

    t = (await s.api("/receipt/totals")).json;
    assert.equal(t.runs, 1);
    assert.ok(t.month.actual > 0 && t.month.flagship >= t.month.actual);
    assert.ok(Math.abs(t.month.saved - (t.month.flagship - t.month.actual)) < 1e-3);
    const recent = (await s.api("/receipt/recent")).json;
    assert.equal(recent[0].missionId, m.id);
    assert.equal(recent[0].flagshipCost, r.flagshipCost);
  } finally { await s.stop(); }
});

test("receipt UI: PNG export, Credits tab panel, no em-dashes", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web/features/receipt.js"), "utf8");
  assert.match(ui, /toDataURL\("image\/png"\)/, "exports a PNG");
  assert.match(ui, /credits:\s*\{/, "registers a Credits tab panel");
  const app = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");
  assert.match(app, /renderExtras\("credits", "#credits-extras"\)/, "the Credits tab mounts feature panels");
  for (const f of ["server/plugins/receipt.js", "web/features/receipt.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
