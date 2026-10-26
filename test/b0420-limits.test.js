// 0.4.20 area B item 3: a limit that continues, and true failure causes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";
import { failureKind, failureCopy, failureHtml } from "../web/failure-cause.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const DASHES = /[–—]/;

test("failure text is sorted into the true cause", () => {
  assert.equal(failureKind("This month's budget is used up. Raise the cap, or wait until next month."), "budget");
  assert.equal(failureKind("Stopped. This run reached its $2 spending limit and spent $2.01."), "budget");
  assert.equal(failureKind("OpenAI: HTTP 429 Too Many Requests"), "rate");
  assert.equal(failureKind("Anthropic: HTTP 402 credit balance is too low"), "credit");
  assert.equal(failureKind("Grok: HTTP 403 Your team has either used all available credits or reached its monthly spending limit."), "credit");
  assert.equal(failureKind("OpenAI: 401 Incorrect API key provided"), "key");
  assert.equal(failureKind("weird"), "other");
  assert.equal(failureKind(""), "other");
  for (const k of ["budget", "rate", "credit", "key", "other"]) {
    const c = failureCopy(k === "budget" ? "spending limit" : k === "rate" ? "429" : k === "credit" ? "402" : k === "key" ? "401" : "x");
    assert.equal(DASHES.test(c.title + c.hint), false);
  }
});

test("a budget stop offers Continue free and Add $1; other causes keep Try again", () => {
  const b = failureHtml({ text: "This month's budget is used up." });
  assert.match(b, /id="cc-limit-free"/);
  assert.match(b, /id="cc-limit-plus"/);
  const r = failureHtml({ text: "HTTP 429" });
  assert.match(r, /id="cc-fail-retry"/);
  assert.doesNotMatch(r, /cc-limit-free/);
});

test("the cost-guard routes raise the local limit and list free AIs, with no billing", async () => {
  const s = await startServer();
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const c = await s.api("/cost-guard/choices");
    assert.equal(c.status, 200);
    assert.ok(Array.isArray(c.json.free) && c.json.free.length >= 1, "the practice AIs are offered");
    assert.ok(c.json.free.every((f) => f.provider && f.model));
    const before = await s.api("/cost-guard");
    const after = await s.api("/cost-guard/continue", { method: "POST", body: { amount: 1 } });
    assert.equal(after.status, 200);
    assert.ok(after.json.cap >= 1 && after.json.cap >= (before.json.cap || 0), "the cap moved up");
    const bad = await s.api("/cost-guard/continue", { method: "POST", body: { amount: -3 } });
    assert.equal(bad.status, 400);
  } finally { await s.stop(); }
});

test("the chat wires the limit card and sends the free pick", () => {
  const app = read("web", "app.js");
  assert.match(app, /wireLimitButtons\(slot/);
  assert.match(app, /packBody\.provider = S\.forceFree\.provider/);
  assert.equal(DASHES.test(read("web", "failure-cause.js")), false);
});

test("a mission at its limit hands back what is finished (source)", () => {
  assert.match(read("server", "mission.js"), /limitReached = true; break;/);
  assert.doesNotMatch(read("server", "mission.js"), /if \(false\) \{/);
});

test("practice AI calls add $0 to the month's spend", () => {
  const src = read("server", "ledger.js");
  assert.match(src, /const c = isDemo\(e\) \? 0 : \(e\.cost \|\| 0\);/);
});

test("the budget card says what still works; the Pro note shows before the form; every call has a table", () => {
  assert.match(failureHtml({ text: "spending limit" }), /id="cc-still-works"/);
  assert.doesNotMatch(failureHtml({ text: "HTTP 429" }), /cc-still-works/);
  assert.match(read("web", "features", "webbuilders.js"), /id="bd-pro-note"/);
  assert.match(read("server", "feature-gate.js"), /priceNote:/);
  assert.match(read("web", "app.js"), /id="cc-call-table"/);
});

test("Images: Generate says why it is off, the price is automatic, no '0 batches'", () => {
  const src = read("web", "features", "images.js");
  assert.match(src, /Press Estimate first, or just press Generate/);
  assert.match(src, /autoEst/);
  assert.match(src, /No images yet/);
  const ba = read("server", "plugins", "buildall.js");
  assert.match(ba, /Waiting for you|needs\(r\.json\?\.error \|\| "The preview needs you\."\)/);
});
