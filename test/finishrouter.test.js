// Slice C1: Finish router and General workspace (flag: finishrouter).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import { classify, CATEGORIES, THRESHOLDS, words } from "../server/finish-router.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASH = String.fromCharCode(0x2014);

// Labeled regression set: every category has at least three cases. Each is [expected, input].
const SET = [
  ["image", { name: "sunset-portrait.png" }], ["image", { mime: "image/jpeg" }], ["image", { text: "Retouch this portrait photo, warmer light" }],
  ["video", { name: "promo.mp4" }], ["video", { text: "Cut the footage into a 30 second trailer with subtitles" }], ["video", { mime: "video/webm" }],
  ["program", { name: "server.py" }], ["program", { text: "Here is the fix:\n```js\nconst a = 1;\n```" }], ["program", { text: "write a function and a test for the api endpoint, then deploy the repo" }],
  ["game", { text: "A puzzle game with a player character, sprites and a boss fight" }], ["game", { kind: "remix" }], ["game", { name: "level1.tscn" }],
  ["social", { text: "Caption for Instagram with five hashtags" }], ["social", { text: "tweet thread about our launch" }], ["social", { kind: "post" }],
  ["website", { text: "<!doctype html><html><body>Hi</body></html>" }], ["website", { text: "Build the landing page with a hero section" }], ["website", { name: "index.html" }],
  ["accounting", { text: "Invoice 1042, total due 300 dollars" }], ["accounting", { name: "ledger-2026.xlsx" }], ["accounting", { text: "Monthly expense report and profit and loss" }],
  ["document", { text: "Draft a proposal memo with an outline, chapter summary and sections" }], ["document", { name: "notes.docx" }], ["document", { tags: ["document"] }],
  ["automation", { text: "Every Monday morning run the report and notify the team" }], ["automation", { name: "flow.yml" }], ["automation", { text: "workflow that triggers when a form arrives" }],
  ["music", { text: "Lyrics with a chorus and a verse for my song" }], ["music", { name: "demo.wav" }], ["music", { mime: "audio/mpeg" }],
  ["presentation", { text: "Make a slide deck for the pitch" }], ["presentation", { name: "board.pptx" }], ["presentation", { text: "slides with speaker notes and an agenda" }],
  ["general", { text: "ok thanks" }], ["general", { text: "remember to call mom" }], ["general", { text: "zzz qqq" }],
];

test("flag is on by default and env turns it off or on", () => {
  const was = process.env.CC_FLAG_FINISHROUTER;
  try {
    delete process.env.CC_FLAG_FINISHROUTER;
    assert.equal(flagOn("finishrouter"), true);
    assert.equal(flagView().finishrouter, true);
    assert.equal(flagView().projectmedia, true, "other flags stay");
    process.env.CC_FLAG_FINISHROUTER = "1";
    assert.equal(flagOn("finishrouter"), true);
    assert.equal(flagView().finishrouter, true);
    process.env.CC_FLAG_FINISHROUTER = "0";
    assert.equal(flagOn("finishrouter"), false);
  } finally { if (was === undefined) delete process.env.CC_FLAG_FINISHROUTER; else process.env.CC_FLAG_FINISHROUTER = was; }
});

test("twelve categories and the two thresholds", () => {
  assert.equal(CATEGORIES.length, 12);
  assert.equal(CATEGORIES.at(-1).id, "general");
  assert.deepEqual(THRESHOLDS, { direct: 0.85, confirm: 0.6 });
});

test("regression set: most are right, and every category is found at least once", () => {
  let right = 0;
  const found = new Set();
  const misses = [];
  for (const [want, input] of SET) {
    const r = classify(input);
    if (r.category === want) { right++; found.add(want); } else misses.push(`${want} got ${r.category}: ${JSON.stringify(input)}`);
  }
  assert.ok(right / SET.length >= 0.9, `accuracy ${right}/${SET.length}: ${misses.join(" | ")}`);
  for (const c of CATEGORIES) assert.ok(found.has(c.id), `${c.id} never found`);
});

test("decisions follow the thresholds", () => {
  const sure = classify({ name: "promo.mp4" });
  assert.equal(sure.decision, "direct");
  assert.ok(sure.confidence >= 0.85);
  assert.equal(sure.tier, "rules");
  const maybe = classify({ name: "notes.md" });
  assert.equal(maybe.decision, "confirm", "a loose file type asks first");
  assert.ok(maybe.confidence >= 0.6 && maybe.confidence < 0.85);
  const none = classify({ text: "zzz qqq" });
  assert.equal(none.decision, "general");
  assert.equal(none.category, "general");
  assert.equal(classify({}).category, "general");
});

test("two rival rules do not pass in silence", () => {
  const r = classify({ text: "a video clip and a game with a boss fight" });
  assert.equal(r.decision, "confirm");
  assert.ok(r.secondary.length >= 1);
});

test("similarity step handles plain wording the rules do not name", () => {
  const r = classify({ text: "melody and tempo for the album, mix and master the track" });
  assert.equal(r.category, "music");
  assert.ok(r.signals.length > 0 && r.signals.every((s) => typeof s.why === "string" && s.why));
});

test("learned corrections nudge the answer", () => {
  const input = { text: "quarterly frobnicate widget gizmo" };
  assert.equal(classify(input).category, "general");
  const learned = [{ category: "accounting", words: words("quarterly frobnicate widget gizmo") }];
  assert.equal(classify(input, { learned }).category, "accounting");
});

test("no em dashes in the new files", () => {
  for (const f of [["server", "finish-router.js"], ["server", "plugins", "finishrouter.js"], ["web", "features", "finish-router.js"], ["test", "finishrouter.test.js"]]) {
    assert.equal(read(...f).includes(DASH), false, f.join("/"));
  }
});

test("web feature is registered lazily for the publish view", () => {
  assert.match(read("web", "perf", "registry.js"), /id: "finish-router", views: \["publish"\]/);
  assert.match(read("web", "features", "publish.js"), /mountFinishRouter/);
});

test("flag off: every route says so", async () => {
  const s = await startServer({ env: { CC_FLAG_FINISHROUTER: "0", CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.finishrouter, false);
    const r = await s.api("/finishrouter/classify", { method: "POST", body: { text: "hello" } });
    assert.equal(r.status, 404);
    assert.equal(r.json.code, "flag_off");
  } finally { await s.stop(); }
});

test("flag on: classify, override history, learning, re-classify and General workspace", async () => {
  const s = await startServer({ env: { CC_FLAG_FINISHROUTER: "1", CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.finishrouter, true);
    const cats = await s.api("/finishrouter/categories");
    assert.equal(cats.json.categories.length, 12);
    assert.equal((await s.api("/finishrouter/classify", { method: "POST", body: {} })).status, 400);

    const c = await s.api("/finishrouter/classify", { method: "POST", body: { name: "promo.mp4" } });
    assert.equal(c.status, 200);
    assert.equal(c.json.category, "video");
    assert.equal(c.json.decision, "direct");

    const text = "quarterly frobnicate widget gizmo";
    const before = await s.api("/finishrouter/reclassify", { method: "POST", body: { text } });
    assert.equal(before.json.category, "general");

    assert.equal((await s.api("/finishrouter/override", { method: "POST", body: { original: "general", corrected: "nonsense", text } })).status, 400);
    const ov = await s.api("/finishrouter/override", { method: "POST", body: { original: "general", corrected: "accounting", text, name: "q3.txt" } });
    assert.equal(ov.status, 200);
    assert.equal(ov.json.entry.corrected, "accounting");
    assert.equal(JSON.stringify(ov.json.entry).includes(text), false, "history keeps words, not the full text");

    const hist = await s.api("/finishrouter/history");
    assert.equal(hist.json.items.length, 1);
    assert.deepEqual([hist.json.items[0].original, hist.json.items[0].corrected], ["general", "accounting"]);

    const after = await s.api("/finishrouter/reclassify", { method: "POST", body: { text } });
    assert.equal(after.json.category, "accounting", "Re-classify uses what you taught it");

    const g0 = await s.api("/finishrouter/general?ref=job1");
    assert.deepEqual(g0.json.checklist, []);
    const put = await s.api("/finishrouter/general", { method: "PUT", body: { ref: "job1", notes: "Plan " + DASH + " later", checklist: [{ text: "Check", done: true }, { text: "Send", done: false }], ready: true } });
    assert.equal(put.json.ready, false, "not ready until every step is ticked");
    assert.equal(put.json.notes.includes(DASH), false);
    const done = await s.api("/finishrouter/general", { method: "PUT", body: { ref: "job1", notes: "x", checklist: [{ text: "Check", done: true }], ready: true } });
    assert.equal(done.json.ready, true);
    assert.equal((await s.api("/finishrouter/general?ref=job1")).json.checklist.length, 1);

    assert.equal((await s.api("/finishrouter/history", { method: "DELETE" })).status, 200);
    assert.equal((await s.api("/finishrouter/history")).json.items.length, 0);
  } finally { await s.stop(); }
});
