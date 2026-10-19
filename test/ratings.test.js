// Phase 3: rate the result (R4). Pure checks on the router's skills table (human thumbs stored apart from
// council rounds, a changed mind replaces the old thumb, each source shifts the score on its own), then the
// running server in a temp data dir with demo AIs only (local mock, no real key or URL): a thumb on a
// finished chat feeds both routers, the summary and the skills matrix show human ratings separately.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-ratings-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const R = await import("../server/router.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = { writing: 70, code: 60, reasoning: 60, research: 60, creative: 60, analysis: 60, math: 60, fast: 60 };

test("human thumbs are kept apart from council rounds and each shifts the score on its own", () => {
  store.putDoc("skills", {});
  R.recordOutcome("m-a", "writing", true);
  R.recordOutcome("m-a", "writing", true);
  R.recordHuman("m-a", "writing", false);
  R.recordHuman("m-a", "writing", false);
  const row = R.skillTable()["m-a"].writing;
  assert.deepEqual({ wins: row.wins, total: row.total }, { wins: 2, total: 2 }, "thumbs are never counted as council rounds");
  assert.deepEqual({ up: row.up, down: row.down }, { up: 0, down: 2 });
  const d = R.learnedDeltas("m-a");
  assert.equal(d.council.writing, Math.round((1 - 0.35) * 30));
  assert.equal(d.human.writing, -12);
  assert.equal(R.learnedCaps("m-a", BASE).writing, 70 + d.council.writing - 12);
  assert.equal(R.learnedCaps("m-a", BASE).code, 60, "other capabilities are untouched");
});

test("one thumb is not enough; a changed mind replaces the old thumb, also across task types", () => {
  store.putDoc("skills", {});
  R.recordHuman("m-b", "code", true);
  assert.deepEqual(R.learnedDeltas("m-b"), { council: {}, human: {} });
  assert.equal(R.learnedCaps("m-b", BASE).code, 60);
  R.recordHuman("m-b", "code", true);
  assert.equal(R.learnedDeltas("m-b").human.code, 12);
  R.recordHuman("m-b", "code", false, { capability: "code", up: true });
  let row = R.skillTable()["m-b"].code;
  assert.deepEqual([row.up, row.down], [1, 1]);
  assert.equal(R.learnedDeltas("m-b").human.code, 0);
  R.recordHuman("m-b", "writing", true, { capability: "code", up: false });
  row = R.skillTable()["m-b"];
  assert.deepEqual([row.code.up, row.code.down, row.writing.up], [1, 0, 1]);
  assert.equal(row.code.total, 0, "still no council rounds");
});

test("rating a finished chat on the server: feeds both routers, shown apart from council votes", { timeout: 120000 }, async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/ratings/summary", { noToken: true })).status, 401);
    assert.equal((await s.api("/ratings", { method: "POST", body: { model: "nova-lite" } })).status, 400);
    await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a two-line tagline for a bakery.", provider: "demo-nova", model: "nova-lite" } })).status, 202);
    let m = null;
    for (let i = 0; i < 240 && !m; i++) { m = (await s.api("/missions")).json.find((x) => x.kind === "single" && x.status === "done"); if (!m) await sleep(250); }
    assert.ok(m, "the chat finished");

    const rate = (up, capability = "writing", note = "") => s.api("/ratings", { method: "POST", body: { missionId: m.id, kind: "single", provider: "demo-nova", model: "nova-lite", capability, up, note } });
    const r1 = await rate(true, "writing", "nice and short");
    assert.equal(r1.status, 200, r1.text);
    assert.equal(r1.json.up, true);
    assert.equal((await rate(true, "not-a-capability")).json.capability, "writing", "unknown task types fall back to writing");
    await rate(false, "writing", "too long");
    const mine = (await s.api(`/ratings/mission/${m.id}`)).json;
    assert.equal(mine.length, 1, "one rating per run per model");
    assert.equal(mine[0].up, false);

    const sum = (await s.api("/ratings/summary")).json;
    assert.equal(sum.count, 1);
    assert.deepEqual([sum.byModel["nova-lite"].up, sum.byModel["nova-lite"].down], [0, 1]);
    const caps = sum.skills["nova-lite"].caps.writing;
    assert.deepEqual(caps.human, { up: 0, down: 1 }, "changing your mind replaced the earlier thumbs");
    assert.deepEqual(caps.council, { wins: 0, rounds: 0 }, "no council rounds were invented from thumbs");
    assert.deepEqual(sum.skills["nova-lite"].deltas, { council: {}, human: {} }, "one thumb does not move the score yet");

    // the learning router (Phase 28) got the thumb on the run's task type, replacing the earlier one
    const brain = (await s.api("/brain")).json;
    const row = brain.capabilities.flatMap((c) => c.models).find((x) => x.model === "nova-lite");
    assert.ok(row, "the chat is in the learning router");
    assert.deepEqual([row.up, row.down], [0, 1]);

    // a second chat rated down: two human signals now move the score, and the matrix data says so
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a two-line tagline for a florist.", provider: "demo-nova", model: "nova-lite" } })).status, 202);
    let m2 = null;
    for (let i = 0; i < 240 && !m2; i++) { m2 = (await s.api("/missions")).json.find((x) => x.kind === "single" && x.status === "done" && x.id !== m.id); if (!m2) await sleep(250); }
    assert.ok(m2);
    await s.api("/ratings", { method: "POST", body: { missionId: m2.id, provider: "demo-nova", model: "nova-lite", capability: "writing", up: false } });
    const st = (await s.api("/state")).json;
    const model = st.providers.find((p) => p.id === "demo-nova").models.find((x) => x.id === "nova-lite");
    assert.equal(model.learned.human.writing, -12);
    assert.equal(model.learned.council.writing, undefined);
    assert.equal(model.caps.writing, Math.max(0, model.base.writing - 12));
  } finally { await s.stop(); }
});

test("browser code: the skills matrix shows council and your ratings on separate lines; no em-dash", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(app, /function skillCell/);
  assert.match(app, /council \$\{signed\(council\)\}/);
  assert.match(app, /you \$\{signed\(human\)\}/);
  const rt = fs.readFileSync(path.join(ROOT, "web", "features", "ratings.js"), "utf8");
  assert.doesNotMatch(rt, /—/);
});
