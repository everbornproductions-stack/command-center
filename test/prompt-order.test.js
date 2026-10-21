// A guessed Pro prompt must not stop Send. Missing facts are asked only after the person chooses that prompt.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { attachPack, detectApplied } from "../web/features/prompt-order.js";
import { TEMPLATES } from "../server/prompts/catalog.js";
import { heuristicMatch, detectIntent } from "../server/prompts/intent.js";
import { renderTemplate } from "../server/prompts/render.js";

const REVIEW = "I have a Craving Finder chat open in Grok Bot. Take a look and see if there are better ways to do the app and new suggestions.";

test("a halted prompt is not attached, and a ready one is", () => {
  assert.equal(attachPack(null), null);
  assert.equal(attachPack({ removed: true, templateId: "friday-coach" }), null);
  assert.equal(attachPack({ templateId: "friday-coach", halted: true, applied: true, inputs: {} }), null);
  assert.equal(attachPack({ templateId: "friday-coach", halted: false, applied: false, inputs: { week: "ok" } }), null);
  assert.deepEqual(attachPack({ templateId: "friday-coach", inputs: { week: "shipped" } }), { templateId: "friday-coach", inputs: { week: "shipped" } });
  assert.deepEqual(attachPack({ templateId: "buy-back-time", applied: true, halted: false, inputs: { tasks: "email" } }), { templateId: "buy-back-time", inputs: { tasks: "email" } });
});

test("auto-apply waits until the required facts are filled", () => {
  assert.equal(detectApplied({ autoApply: true, halted: true }), false);
  assert.equal(detectApplied({ autoApply: true, halted: false }), true);
  assert.equal(detectApplied({ keepApplied: true, halted: true }), false);
  assert.equal(detectApplied({ keepApplied: true, halted: false }), true);
  assert.equal(detectApplied({}), false);
});

test("Send does not stop for a missing fact, and the questions stay under the orders box", () => {
  const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../web/features/prompts.js", import.meta.url), "utf8");
  assert.match(app, /attachPack\(pp\)/);
  assert.doesNotMatch(app, /pp\?\.templateId && pp\.halted\) return toast/);
  assert.match(ui, /detectApplied/);
  assert.match(ui, /pack\.askFacts/);
  assert.match(ui, /Save these facts/);
  assert.match(ui, /Send without it/);
  assert.match(ui, /function sendWithoutIt/);
  assert.match(ui, /promptPack = \{ removed: true \}/);
  assert.match(ui, /getElementById\("go"\)\?\.click\(\)/);
  assert.doesNotMatch(app + ui, /\u2014/);
});

test("Chris's open-ended review is not auto-applied and does not hard-block", async () => {
  const h = heuristicMatch(REVIEW, TEMPLATES);
  assert.equal(h.id, null);
  assert.equal(h.autoApply, false);
  const picked = await detectIntent(REVIEW, TEMPLATES, { ask: async () => '{"id":"analyze-improve","why":"review the app"}' });
  assert.equal(picked.id, "analyze-improve");
  assert.equal(picked.source, "router");
  assert.equal(picked.autoApply, false, "a guessed template must not attach itself");
  assert.equal(picked.suggest, true);
  const halted = renderTemplate("analyze-improve", {}, {});
  assert.equal(halted.halted, true);
  assert.match(halted.message, /I need a few facts before I can run Analyze and improve/);
  assert.equal(detectApplied({ autoApply: picked.autoApply, halted: true }), false);
  assert.equal(attachPack({ templateId: picked.id, halted: true, applied: true, inputs: {} }), null);
});

test("an order whose words match a Pro prompt still starts when no pack is attached", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const r = await s.api("/chat", { method: "POST", body: { prompt: "buy back my time" } });
    assert.equal(r.status, 202);
    assert.notEqual(r.json?.code, "prompt_halt");
    const review = await s.api("/chat", { method: "POST", body: { prompt: REVIEW } });
    assert.equal(review.status, 202);
    assert.notEqual(review.json?.code, "prompt_halt");
    const blocked = await s.api("/chat", { method: "POST", body: { prompt: "buy back my time", promptPack: { templateId: "buy-back-time", inputs: {} } } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, "prompt_halt");
    assert.match(blocked.json.error, /I need a few facts before I can run Buy back my time/);
    assert.ok(blocked.json.questions.some((q) => /Tasks that eat the week/.test(q)));
  } finally { await s.stop(); }
});
