// 0.4.22 panel fix: the app's own budget stop is never a provider "out of credits", raising the cap frees the AIs
// it wrongly benched, the estimate-case message names both numbers, and a 429 goes to another company first.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-budget0422p-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_HEALTH_PROBE = "off";
process.env.CC_SUBCLI_NO_PATH = "1";
process.env.CC_SUBCLI_HOME = tmpDir("cc-subcli-0422p-");
const hits = [];
const mock = http.createServer((req, res) => { hits.push(req.url); res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "Rate limit reached for this model. Try again in 20s." } })); });
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${mock.address().port}`;
process.env.CC_BASE_URL_XAI = `${base}/xai/v1`;
process.env.CC_BASE_URL_GROQ = `${base}/groq/v1`;
process.env.XAI_API_KEY = "test-key-xai-0422p";
process.env.GROQ_API_KEY = "test-key-groq-0422p";
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const savedDevOwner = process.env.CC_DEV_OWNER;
delete process.env.CC_DEV_OWNER;
after(() => { if (savedDevOwner) process.env.CC_DEV_OWNER = savedDevOwner; mock.close(); });

const Guard = await import("../server/cost-guard.js");
const FB = await import("../server/fallback.js");
const Health = await import("../server/health.js");
const Plugin = await import("../server/plugins/cost-guard.js");
const BUDGET = "This month's budget is used up. Raise the cap, or wait until next month. Free runs still work.";

test("kindFromHealth: a real 'no credits' is still credits, budget text never is", () => {
  assert.equal(FB.kindFromHealth("red", "Payment required: no credits"), "credits");
  assert.equal(FB.kindFromHealth("red", `Payment required: no credits: ${BUDGET}`), null);
  assert.equal(FB.kindFromHealth("amber", "Out of credits or spending limit reached: Your spending limit was reached."), null);
  assert.equal(FB.kindFromHealth("red", "budget_cap"), null);
});

test("a budget-cap 402 does not move the health light or fill the trouble table", () => {
  const before = Health.getStatus("openai");
  const err = Object.assign(new Error(BUDGET), { status: 402, code: "budget_cap" });
  Health.noteCall("openai", false, 5, err);
  const after1 = Health.getStatus("openai");
  assert.equal(after1.status, before.status);
  assert.equal(after1.detail, before.detail);
  assert.equal(FB.trouble("openai"), null);
  // a real provider 402 still turns the light red
  Health.noteCall("groq", false, 5, { status: 402, message: "Groq: HTTP 402 Payment Required" });
  assert.equal(Health.getStatus("groq").status, "red");
});

test("raising the cap or adding $1 frees AIs benched by budget text, and leaves real out-of-credits alone", async () => {
  store.putDoc("license", { tier: null, status: null, lastOkAt: 0, checkedAt: 0 });
  store.putDoc("cost.guard", { optedIn: true, cap: 1, paused: false });
  FB.markTrouble("openai", "credits", BUDGET, { quiet: true });
  FB.markTrouble("google", "credits", "Payment required: no credits: This month's budget is used up.", { quiet: true });
  FB.markTrouble("anthropic", "credits", "Your credit balance is too low to access the Anthropic API.", { quiet: true });
  const out = [];
  const h = { json: (res, status, body) => { out.push({ status, body }); return true; } };
  await Plugin.routes({ method: "POST" }, {}, new URL("http://x/api/cost-guard"), { cap: 5 }, h);
  assert.equal(out[0].status, 200);
  assert.match(out[0].body.clearedNote, /paused by the old limit are back/);
  assert.equal(FB.trouble("openai"), null);
  assert.equal(FB.trouble("google"), null);
  assert.equal(FB.trouble("anthropic")?.kind, "credits");
  FB.markTrouble("openai", "credits", BUDGET, { quiet: true });
  await Plugin.routes({ method: "POST" }, {}, new URL("http://x/api/cost-guard/continue"), { amount: 1 }, h);
  assert.equal(FB.trouble("openai"), null);
  assert.equal(FB.trouble("anthropic")?.kind, "credits");
  FB.clearTrouble("anthropic");
});

test("a cap below the estimate names both numbers; money really spent keeps the old words", async () => {
  store.putDoc("cost.guard", { optedIn: true, cap: 0.01, paused: false });
  store.ctx().ledger = [];
  let err;
  try { Guard.assertSpendAllowed({ provider: "openai", estimate: 0.5 }); } catch (e) { err = e; }
  assert.equal(err.code, "budget_cap");
  assert.equal(err.message, "This job is estimated at about $0.50, and your limit is $0.01. Raise the limit or pick Free only.");
  assert.ok(!/[–—]/.test(err.message));
  assert.equal(FB.troubleKind(err), null);
  const { failureCopy } = await import("../web/failure-cause.js");
  const c = failureCopy(err.message);
  assert.equal(c.kind, "budget");
  assert.equal(c.title, err.message);
  store.ctx().ledger = [{ ts: Date.now(), kind: "call", provider: "openai", model: "gpt-6-luna", cost: 5, inTok: 1, outTok: 1 }];
  try { Guard.assertSpendAllowed({ provider: "openai", estimate: 0.5 }); } catch (e) { err = e; }
  assert.match(err.message, /budget is used up/);
  assert.match(failureCopy(err.message).title, /Nothing more was spent/);
  store.ctx().ledger = [];
});

test("after a 429 the next hop is another company, not a sibling model of the same key", async () => {
  store.putDoc("cost.guard", { optedIn: false, cap: null, paused: false });
  Health.markRecovered("groq"); FB.clearTrouble("groq"); FB.clearTrouble("xai"); // the earlier real-402 check benched Groq
  hits.length = 0;
  const seen = [];
  const gen = FB.fallbackChat({ provider: "xai", model: "grok-4.3", messages: [{ role: "user", content: "Write a tagline." }], allowStandIn: true }, { small: false });
  try {
    for await (const ev of gen) { if (ev.type === "fallback") { seen.push(ev); break; } }
  } catch { /* every mock answers 429; only the first switch matters */ }
  assert.ok(seen.length >= 1, "a stand-in was chosen");
  assert.equal(seen[0].kind, "rate");
  assert.notEqual(seen[0].to.provider, "xai", "the first stand-in is not another model of the same key");
});
