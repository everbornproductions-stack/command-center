// Slice B5: Momentum Mode (flag: momentum). Local scorer, action bar wiring, checkpoint and Resume,
// Low Power, Owner tuning. Nothing here runs a step: Momentum only suggests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import {
  DEFAULT_WEIGHTS, CATALOG, suggest, scoreAction, normalizeContext, terms, cleanWeights, variationText, checkpoint, shouldResume, guessLang, explain,
} from "../web/momentum.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASH = String.fromCharCode(0x2014);
const now = Date.now();
const withResult = (over = {}) => ({ hasResult: true, resultType: "text", resultAt: now - 20000, hasProject: true, text: "Here is the plan for your tea club newsletter this month.", now, ...over });

test("flag is on by default (0.4.21 restore), env switches it, other flags kept", () => {
  const was = process.env.CC_FLAG_MOMENTUM;
  try {
    delete process.env.CC_FLAG_MOMENTUM;
    assert.equal(flagOn("momentum"), true);
    assert.equal(flagView().momentum, true);
    process.env.CC_FLAG_MOMENTUM = "1";
    assert.equal(flagView().momentum, true);
    process.env.CC_FLAG_MOMENTUM = "0";
    assert.equal(flagOn("momentum"), false);
    for (const k of ["projectbar", "promptdrop", "nextactions", "projectmedia", "finishrouter", "finishpath", "takeover"]) assert.ok(k in flagView(), `${k} kept`);
  } finally { if (was === undefined) delete process.env.CC_FLAG_MOMENTUM; else process.env.CC_FLAG_MOMENTUM = was; }
});

test("the formula uses the documented weights", () => {
  assert.deepEqual({ ...DEFAULT_WEIGHTS }, { stage_affinity: 3.0, result_type_match: 2.5, recency_boost: 1.5, language_match: 2.0, asset_state_bonus: 1.0, history_bonus: 0.5 });
  const c = normalizeContext(withResult());
  const a = CATALOG.find((x) => x.id === "variations");
  const t = terms(a, c);
  const want = t.stage_affinity * 3 + t.result_type_match * 2.5 + t.recency_boost * 1.5 + t.language_match * 2 + t.asset_state_bonus * 1 + t.history_bonus * 0.5 - t.penalties;
  assert.ok(Math.abs(scoreAction(a, c).score - want) < 0.02);
});

test("2 to 4 actions, fast, explainable, and no result means start-of-work actions", () => {
  const r = suggest(withResult());
  assert.ok(r.actions.length >= 2 && r.actions.length <= 4);
  assert.ok(r.took_ms < 10, `took ${r.took_ms}`);
  assert.equal(r.over_budget, false);
  for (const a of r.actions) { assert.ok(a.simple && a.expert.includes("Score")); assert.ok(a.parts.stage_affinity >= 0); }
  const idea = suggest({ now });
  assert.equal(idea.stage, "idea");
  assert.ok(idea.actions.length >= 2);
  assert.ok(idea.actions.every((a) => !["variations", "finish", "refine"].includes(a.id)), "no result, so no result actions");
  const times = [];
  for (let i = 0; i < 200; i++) { const t0 = performance.now(); suggest(withResult({ now: now + i })); times.push(performance.now() - t0); }
  assert.ok(times.sort((a, b) => a - b)[190] < 10);
});

test("prerequisites filter: translate needs text in another language, add-project needs a project", () => {
  assert.ok(!suggest(withResult(), { max: 4 }).actions.some((a) => a.id === "translate"));
  const spanish = "Aqui esta el plan para el boletin de este mes con todas las ideas que tenemos para ti";
  assert.equal(guessLang(spanish), "es");
  const es = suggest(withResult({ text: spanish }), { max: 4 });
  assert.ok(es.actions.some((a) => a.id === "translate"), "Spanish text offers Translate");
  assert.ok(!suggest(withResult({ hasProject: false }), { max: 4 }).actions.some((a) => a.id === "add-project"));
  const img = suggest(withResult({ resultType: "image", hasProject: true }), { max: 4 });
  assert.ok(img.actions.some((a) => a.id === "save-media"));
  assert.ok(!img.actions.some((a) => a.id === "shorten"));
});

test("dismissing and just-done actions drop, and the dismissal fades", () => {
  const top = suggest(withResult()).actions[0].id;
  assert.notEqual(suggest(withResult({ dismissed: { [top]: now } })).actions[0].id, top);
  assert.equal(suggest(withResult({ dismissed: { [top]: now - 4 * 3600 * 1000 } })).actions[0].id, top, "an old dismissal no longer counts");
  assert.notEqual(suggest(withResult({ justDone: top })).actions[0].id, top);
  const refine = CATALOG.find((a) => a.id === "refine");
  assert.ok(scoreAction(refine, normalizeContext(withResult({ history: { refine: 5 } }))).score > scoreAction(refine, normalizeContext(withResult())).score);
});

test("Low Power shows 2 actions; disabled actions never show; weights are clamped", () => {
  assert.equal(suggest(withResult(), { lowPower: true }).actions.length, 2);
  const off = suggest(withResult(), { disabled: ["variations", "refine"], max: 4 });
  assert.ok(off.actions.every((a) => !["variations", "refine"].includes(a.id)));
  assert.equal(cleanWeights({ stage_affinity: 99, recency_boost: -4, bogus: 1 }).stage_affinity, 6);
  assert.equal(cleanWeights({ recency_boost: -4 }).recency_boost, 0);
  assert.equal(cleanWeights({ nope: 1 }).language_match, 2);
  assert.match(explain(CATALOG[0], scoreAction(CATALOG[0], normalizeContext(withResult()))).expert, /Score/);
});

test("variations text, checkpoint and resume rules", () => {
  const v = variationText("**Bold** idea | here");
  assert.match(v, /3 different versions/);
  assert.ok(!v.includes("**") && !v.includes("|"));
  assert.equal(variationText("  "), "");
  const cp = checkpoint({ view: "command", draft: "x".repeat(900), stage: "bad", savedAt: 5 });
  assert.equal(cp.draft.length, 400);
  assert.equal(cp.stage, "idea");
  const s = { checkpoint: { draft: "hello", savedAt: now - 20 * 60000 }, exited: false };
  assert.equal(shouldResume(s, now, 10 * 60000), true);
  assert.equal(shouldResume(s, now, 60 * 60000), false, "too soon");
  assert.equal(shouldResume({ ...s, exited: true }, now), false);
  assert.equal(shouldResume({ checkpoint: { savedAt: now - 99999999 } }, now), false, "empty note");
  assert.equal(shouldResume({ checkpoint: { draft: "a", savedAt: now - 30 * 24 * 3600 * 1000 } }, now), false, "too old");
});

test("wiring: registry, flag-gated loading, no loops, no em dashes, wraps text", () => {
  assert.match(read("web", "perf", "registry.js"), /id: "momentum", deliverable: true/);
  assert.match(read("web", "app.js"), /S\.flags\?\.momentum/);
  assert.match(read("web", "app.js"), /import\("\.\/momentum-ui\.js"\)/);
  for (const f of ["web/momentum.js", "web/momentum-ui.js", "web/features/momentum.js", "server/plugins/momentum.js", "test/momentum.test.js"]) {
    const src = read(...f.split("/"));
    assert.ok(!src.includes(DASH), `${f} has an em dash`);
    if (f.endsWith("test.js")) continue;
    assert.ok(!/setInterval\s*\(/.test(src), `${f} must not poll`);
  }
  const ui = read("web", "momentum-ui.js");
  assert.match(ui, /overflow-wrap: anywhere/);
  assert.match(ui, /lightMode/);
  assert.ok(!/api\("\/(missions|chat|command|run)/.test(ui), "the bar never starts a job");
});

test("flag off: every route says so", async () => {
  const s = await startServer({ env: { CC_FLAG_MOMENTUM: "0", CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.momentum, false);
    const r = await s.api("/momentum/suggest", { method: "POST", body: {} });
    assert.equal(r.status, 404);
    assert.equal(r.json.code, "flag_off");
  } finally { await s.stop(); }
});

test("flag on: suggest, pick, checkpoint, resume through the server", async () => {
  const s = await startServer({ env: { CC_FLAG_MOMENTUM: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.momentum, true);
    const sg = await s.api("/momentum/suggest", { method: "POST", body: { project: "p1", context: { hasResult: true, resultAt: Date.now() - 5000, hasProject: true, text: "A short answer for you" } } });
    assert.equal(sg.status, 200, sg.json?.error);
    assert.ok(sg.json.actions.length >= 2 && sg.json.actions.length <= 4);
    assert.equal((await s.api("/momentum/pick", { method: "POST", body: { project: "p1", actionId: "nope" } })).status, 400);
    const pk = await s.api("/momentum/pick", { method: "POST", body: { project: "p1", actionId: "refine" } });
    assert.equal(pk.json.history.refine, 1);
    assert.equal((await s.api("/momentum/state?project=p1")).json.history.refine, 1);

    assert.equal((await s.api("/momentum/checkpoint", { method: "POST", body: { project: "p1", checkpoint: {} } })).json.saved, false, "empty is not saved");
    const cp = await s.api("/momentum/checkpoint", { method: "POST", body: { project: "p1", checkpoint: { view: "command", draft: "Write the welcome email", title: "Welcome" } } });
    assert.equal(cp.json.saved, true);
    assert.equal((await s.api("/momentum/state?project=p1")).json.resume, null, "not idle long enough for a Resume offer");
    const res = await s.api("/momentum/resume", { method: "POST", body: { project: "p1", accept: true } });
    assert.equal(res.json.checkpoint.draft, "Write the welcome email");
    assert.equal((await s.api("/momentum/resume", { method: "POST", body: { project: "p1" } })).json.checkpoint, null, "the offer does not repeat");
    await s.api("/momentum/checkpoint", { method: "POST", body: { project: "p2", checkpoint: { draft: "y".repeat(2000), runId: "r1" } } });
    assert.equal((await s.api("/momentum/resume", { method: "POST", body: { project: "p2" } })).json.checkpoint.draft.length, 400);
  } finally { await s.stop(); }
});

test("owner tuning: free refused, owner needs confirm, changes apply and undo", async () => {
  const free = await startServer({ env: { CC_FLAG_MOMENTUM: "1" } });
  try {
    const r = await free.api("/momentum/owner/tune", { method: "POST", body: { confirm: true, weights: { stage_affinity: 5 } } });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "owner_only");
    assert.equal((await free.api("/momentum/owner/view")).status, 403);
  } finally { await free.stop(); }
  const o = await startServer({ env: { CC_FLAG_MOMENTUM: "1", CC_DEV_OWNER: "1" } });
  try {
    const tier = (await o.api("/state")).json.license?.tier;
    if (tier !== "owner") return; // owner tier cannot be forced here; the pure rules above still hold
    assert.equal((await o.api("/momentum/owner/tune", { method: "POST", body: { weights: { stage_affinity: 5 } } })).status, 409);
    const t = await o.api("/momentum/owner/tune", { method: "POST", body: { confirm: true, weights: { stage_affinity: 5 }, idleMs: 7000, disabled: ["finish", "bogus"] } });
    assert.equal(t.json.weights.stage_affinity, 5);
    assert.equal(t.json.idleMs, 7000);
    assert.deepEqual(t.json.disabled, ["finish"]);
    const sg = await o.api("/momentum/suggest", { method: "POST", body: { context: { hasResult: true, resultAt: Date.now(), hasProject: true, text: "hello there friend" } } });
    assert.ok(!sg.json.actions.some((a) => a.id === "finish"));
    const un = await o.api("/momentum/owner/undo", { method: "POST", body: { confirm: true } });
    assert.equal(un.json.weights.stage_affinity, 3);
  } finally { await o.stop(); }
});
