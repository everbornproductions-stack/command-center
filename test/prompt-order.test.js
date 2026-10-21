// A guessed Pro prompt must not stop Send. Missing facts are asked only after the person chooses that prompt.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { attachPack, detectApplied } from "../web/features/prompt-order.js";

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
  assert.doesNotMatch(app + ui, /\u2014/);
});

test("an order whose words match a Pro prompt still starts when no pack is attached", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const r = await s.api("/chat", { method: "POST", body: { prompt: "buy back my time" } });
    assert.equal(r.status, 202);
    assert.notEqual(r.json?.code, "prompt_halt");
    const blocked = await s.api("/chat", { method: "POST", body: { prompt: "buy back my time", promptPack: { templateId: "buy-back-time", inputs: {} } } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, "prompt_halt");
    assert.match(blocked.json.error, /I need a few facts before I can run Buy back my time/);
    assert.ok(blocked.json.questions.some((q) => /Tasks that eat the week/.test(q)));
  } finally { await s.stop(); }
});
