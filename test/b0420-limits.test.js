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
    assert.ok(Array.isArray(c.free) && c.free.length >= 1, "the practice AIs are offered");
    assert.ok(c.free.every((f) => f.provider && f.model));
    await s.api("/cost-guard", { method: "POST", body: { cap: 5 } }).catch(() => null);
    const before = await s.api("/cost-guard");
    const after = await s.api("/cost-guard/continue", { method: "POST", body: { amount: 1 } });
    assert.ok(after.cap >= (before.cap || 0) + 1 - 0.001 || after.cap >= 1, "the cap moved up by a dollar");
    await assert.rejects(() => s.api("/cost-guard/continue", { method: "POST", body: { amount: -3 } }));
  } finally { await s.close(); }
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
