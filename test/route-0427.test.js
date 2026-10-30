// 0.4.27 routing fixes from the 2026-10-30 dogfood batch (10 real jobs on 0.4.25, Max savings).
//  1. long builds were cut off on Gemini Flash-Lite: lite models sit out of long steps, stop reasons are read the
//     same for every API, a stream with no finish reason counts as cut off, and Gemini / Groq get a bigger cap
//  2. too slow: plain text steps went to Claude Code (the CLI agent through the person's plan). Fast free API
//     models now go first in Max savings; slow agents only when a step needs tools
//  3. "QA could not check this step": reviewers are fast API models (agents last), a cut-off or wrapped JSON
//     verdict is still read, and the reviewer sees the end of a long output
// In-process, fake keys that are never sent anywhere, a fake Claude Code, one loopback mock. No network, no data/.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-route0427-");
const HOME = tmpDir("cc-route0427-home-");

// a loopback Gemini that streams words and then stops without a finish reason (a cut connection)
const gemini = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    gemini.lastBody = body;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "<html><body><p>Half a pa" }] } }] })}\n\n`);
  });
});
await new Promise((r) => gemini.listen(0, "127.0.0.1", r));
after(() => new Promise((r) => gemini.close(r)));

Object.assign(process.env, {
  CC_DATA_DIR: DIR, CC_SUBCLI_HOME: HOME, CC_SUBCLI_NO_PATH: "1", CC_SUBCLI_EXEC: process.execPath,
  CC_CLAUDE_BIN: path.join(ROOT, "test", "fixtures", "fake-sub-cli.mjs"), CC_STATUS_PAGES: "off",
  CC_BASE_URL_GOOGLE: `http://127.0.0.1:${gemini.address().port}/v1beta`,
  ANTHROPIC_API_KEY: "sk-ant-test-never-sent", GEMINI_API_KEY: "AIza-test-never-sent", GROQ_API_KEY: "gsk_test_never_sent",
});
for (const k of ["OPENAI_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "PERPLEXITY_API_KEY"]) process.env[k] = "";
delete process.env.CC_DEV_OWNER;

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const SR = await import("../server/sub-routes.js");
await import("../server/plan-first.js");
await import("../server/free-first-wire.js");
const R = await import("../server/router.js");
const FB = await import("../server/fallback.js");
const FF = await import("../server/free-first.js");
const P = await import("../server/providers.js");
const REG = await import("../server/registry.js");
const QA = await import("../server/qa-pick.js");

const credentials = path.join(HOME, ".claude", ".credentials.json");
fs.mkdirSync(path.dirname(credentials), { recursive: true });
fs.writeFileSync(credentials, "{}");
store.putDoc("settings", { ...(store.doc("settings", () => ({})) || {}), planFirst: true });
SR.clearStatusCache();
await SR.allStatus({ refresh: true });

const isFreeApi = (m) => !R.isSlowAgent(m) && FF.costTier(m.provider, m.model) <= 1;

// ---------- 2. speed: plain text steps go to fast free API models ----------
test("Max savings: a simple writing step goes to a fast free API model, not Claude Code", () => {
  const list = R.rank({ capability: "writing", difficulty: 1, mode: "savings" });
  const names = list.map((m) => m.model).join(", ");
  const planAt = list.findIndex((m) => m.provider === "plan-claude-code");
  assert.ok(planAt >= 0, `Claude Code (your plan) is ready in this test: ${names}`);
  assert.ok(["google", "groq"].includes(list[0].provider), `first pick is Gemini or Groq: ${names}`);
  const lastFree = list.map(isFreeApi).lastIndexOf(true);
  assert.ok(planAt > lastFree, `every free API model ranks before Claude Code: ${names}`);
  assert.equal(list[planAt].slowAgent, true);
  // still before any paid API model (the locked "plan before paid" order)
  const firstPaid = list.findIndex((m) => FF.costTier(m.provider, m.model) === 3);
  assert.ok(firstPaid < 0 || planAt < firstPaid, `Claude Code still comes before paid Claude: ${names}`);
});

test("every mode: the plan no longer jumps ahead of free Gemini and Groq on a normal step", () => {
  for (const mode of ["balanced", "speed", "quality"]) {
    const list = R.rank({ capability: "writing", difficulty: 2, mode });
    const planAt = list.findIndex((m) => m.planRoute);
    const firstPaid = list.findIndex((m) => FF.costTier(m.provider, m.model) === 3);
    const freeAhead = list.slice(0, firstPaid < 0 ? list.length : firstPaid).filter(isFreeApi);
    assert.ok(freeAhead.every((m) => list.indexOf(m) < planAt), `${mode}: ${list.map((m) => m.model).join(", ")}`);
  }
});

test("a step that needs tools keeps Claude Code without the slow-agent penalty", () => {
  const plain = R.rank({ capability: "code", difficulty: 2, mode: "savings" }).find((m) => m.planRoute);
  const tools = R.rank({ capability: "code", difficulty: 2, mode: "savings", needTools: true }).find((m) => m.planRoute);
  assert.equal(tools.slowAgent, undefined);
  assert.ok(tools.score > plain.score);
});

test("a code step in Max savings does not hop to Claude Code first when Gemini fails", () => {
  assert.equal(FF.planFirstForCode({ cls: { capability: "code" }, freeOnly: false, mode: "savings" }), null);
  assert.equal(FF.planFirstForCode({ cls: { capability: "code" }, freeOnly: false, mode: "balanced" })?.provider, "plan-claude-code");
  assert.equal(FF.planFirstForCode({ cls: { capability: "code" }, freeOnly: false, mode: "savings", needTools: true })?.provider, "plan-claude-code");
});

test("Gemini 4 Argon out of quota on a free key benches that model only, not the free Flash models", () => {
  assert.equal(FB.paidOnlyModel("google", "gemini-4-argon"), true);
  assert.equal(FB.paidOnlyModel("google", "gemini-3.8-flash"), false);
  assert.equal(FB.paidOnlyModel("openrouter", "x-ai/grok-4.3"), false, "an OpenRouter 402 still means the account is out");
  FB.markTrouble("google", "credits", "You exceeded your current quota", { quiet: true, model: "gemini-4-argon" });
  assert.equal(FB.trouble("google"), null);
  assert.equal(FB.modelTrouble("google", "gemini-4-argon")?.kind, "credits");
  const list = R.rank({ capability: "writing", difficulty: 1, mode: "savings" });
  assert.ok(list.some((m) => m.model === "gemini-3.8-flash"));
  assert.ok(!list.some((m) => m.model === "gemini-4-argon"));
  FB.clearTrouble("google");
});

// ---------- 1. long builds: no lite model, bigger cap, length stops detected ----------
test("long-output steps skip the lite models; short checks may still use them", () => {
  assert.equal(REG.isLiteModel("gemini-3.5-flash-lite"), true);
  assert.equal(REG.isLiteModel("openai/gpt-oss-20b"), true);
  assert.equal(REG.isLiteModel("gemini-3.8-flash"), false);
  assert.equal(REG.isLongOutputJob({ capability: "code", difficulty: 1 }), true);
  assert.equal(REG.isLongOutputJob({ capability: "writing", difficulty: 2 }), true);
  assert.equal(REG.isLongOutputJob({ capability: "writing", difficulty: 1 }), false);
  assert.equal(REG.isLongOutputJob({ capability: "analysis", difficulty: 1, maxTokens: 8000 }), true);
  for (const cls of [{ capability: "code", difficulty: 2 }, { capability: "writing", difficulty: 2 }]) {
    const list = R.rank({ ...cls, mode: "savings" });
    assert.ok(!list.some((m) => REG.isLiteModel(m.model)), `${cls.capability}: ${list.map((m) => m.model).join(", ")}`);
  }
  assert.ok(R.rank({ capability: "analysis", difficulty: 2, mode: "savings", small: true }).some((m) => REG.isLiteModel(m.model)));
});

test("a busy Gemini Flash on a long build hands over to a bigger model, never Flash-Lite", () => {
  const tried = [{ provider: "google", model: "gemini-3.8-flash" }];
  const pick = FB.sameProviderChoice({ provider: "google", model: "gemini-3.6-flash", tried, freeOnly: true, longOutput: true });
  assert.equal(pick, null, "only Flash-Lite is left among free Gemini models, so another AI is asked first");
  const short = FB.sameProviderChoice({ provider: "google", model: "gemini-3.6-flash", tried, freeOnly: true, longOutput: false });
  assert.equal(short.model, "gemini-3.5-flash-lite");
  const next = FB.nextChoice({ provider: "google", model: "gemini-3.6-flash", tried: [...tried, { provider: "google", model: "gemini-3.6-flash" }], cls: { capability: "code", difficulty: 2 }, mode: "savings", longOutput: true });
  assert.ok(next && !REG.isLiteModel(next.model) && !R.isSlowAgent(next.provider), `next: ${JSON.stringify(next)}`);
  const last = FF.lastResortChoices({ tried, cls: { capability: "code" }, freeOnly: true, longOutput: true }).find((c) => c.provider === "google");
  assert.equal(REG.isLiteModel(last.model), false);
});

test("stop reasons: every API's length stop reads as length; Gemini and Groq get a bigger cap on long builds", () => {
  for (const r of ["length", "max_tokens", "MAX_TOKENS", "max_output_tokens"]) assert.equal(P.normalStop(r), "length");
  assert.equal(P.normalStop("STOP"), "stop");
  assert.equal(P.normalStop("tool_calls"), "tool_calls");
  assert.equal(P.normalStop(null), null);
  assert.equal(P.outputCap("google", 8000), 32768);
  assert.equal(P.outputCap("groq", 8000), 32768);
  assert.equal(P.outputCap("google", 2500), 2500);
  assert.equal(P.outputCap("anthropic", 8000), 8000);
  assert.equal(P.outputCap("openrouter", 8000), 8000);
});

test("a Gemini stream that ends with no finish reason is cut off, so the step is carried on", async () => {
  let text = "", done = null;
  for await (const ev of P.streamChat({ provider: "google", model: "gemini-3.8-flash", maxTokens: 8000, messages: [{ role: "user", content: "Build the page." }] })) {
    if (ev.type === "delta") text += ev.text;
    if (ev.type === "done") done = ev;
  }
  assert.match(text, /Half a pa/);
  assert.equal(done.stop, "length");
  assert.equal(JSON.parse(gemini.lastBody).generationConfig.maxOutputTokens, 32768);
});

// ---------- 3. QA that can check ----------
const row = (provider, model, extra = {}) => ({ provider, model, providerName: provider, ...extra });
const fakeRank = (rows) => () => rows;

test("QA in Max savings: free API reviewers first, agents left out while API models can check", () => {
  const rows = [
    row("plan-claude-code", "plan-claude-code", { planRoute: true }), row("antigravity", "antigravity"),
    row("anthropic", "claude-sonnet-5-5"), row("google", "gemini-3.6-flash"), row("groq", "openai/gpt-oss-120b"),
  ];
  const picked = QA.pickReviewers(fakeRank(rows), { mode: "savings", taskProvider: "google", taskModel: "gemini-3.8-flash" });
  assert.deepEqual(picked.map((m) => m.provider), ["groq", "google", "anthropic"]);
  assert.ok(!picked.some((m) => R.isSlowAgent(m)));
  // Quality: another AI first, by the ranking
  const q = QA.pickReviewers(fakeRank(rows), { mode: "balanced", taskProvider: "google" });
  assert.deepEqual(q.map((m) => m.provider), ["anthropic", "groq", "google"]);
  // only agents ready: one is still asked, so the step is not left unchecked for want of a reviewer
  const only = QA.pickReviewers(fakeRank([row("antigravity", "antigravity")]), { mode: "savings", taskProvider: "google" });
  assert.deepEqual(only.map((m) => m.provider), ["antigravity"]);
  // a skipped AI is never picked
  assert.ok(!QA.pickReviewers(fakeRank(rows), { mode: "savings", taskProvider: "google", skip: ["groq"] }).some((m) => m.provider === "groq"));
});

test("QA stand-ins never go to a slow agent while an API model is left", () => {
  const next = FB.nextChoice({ provider: "google", model: "gemini-3.8-flash", tried: [{ provider: "google", model: "gemini-3.8-flash" }], cls: { capability: "analysis", difficulty: 2 }, mode: "savings", small: true, fast: true, skipSame: true });
  assert.ok(next && !R.isSlowAgent(next.provider), JSON.stringify(next));
});

test("QA verdicts are read from cut-off JSON, JSON in prose, and plain words; nonsense is still unreadable", () => {
  assert.deepEqual(QA.parseVerdict(`{"pass": true, "score": 9, "issues": [], "fix": null}`), { pass: true, score: 9, issues: [] });
  const cut = QA.parseVerdict(`{"pass": false, "score": 4, "issues": ["Midtown weekly total is wrong", "Grand tot`);
  assert.equal(cut.pass, false); assert.equal(cut.score, 4); assert.equal(cut.issues[0], "Midtown weekly total is wrong");
  const prose = QA.parseVerdict(`Here is my check of {the} output:\n{"pass": false, "score": "6/10", "issues": ["No form"], "fix": "Add the form."}\nThanks.`);
  assert.equal(prose.pass, false); assert.equal(prose.score, 6); assert.equal(prose.fix, "Add the form.");
  const words = QA.parseVerdict("PASS\nScore: 8/10. Clean and complete.");
  assert.equal(words.pass, true); assert.equal(words.score, 8);
  assert.equal(QA.parseVerdict("I looked at it and it seems fine overall."), null);
  assert.equal(QA.parseVerdict(""), null);
});

test("QA sees the end of a long deliverable, so a finished page is not called cut off", () => {
  const page = `<!DOCTYPE html><html><body>${"<p>card</p>".repeat(3000)}<footer>Contact</footer></body></html>`;
  assert.ok(page.length > QA.QA_TEXT_LIMIT);
  const ex = QA.qaExcerpt(page);
  assert.ok(ex.length < page.length);
  assert.ok(ex.endsWith("</html>"), "the real ending is kept");
  assert.match(ex, /left out of this excerpt only to keep the check short/);
  assert.equal(QA.qaExcerpt("short"), "short");
  assert.ok(QA.QA_MAX_TOKENS >= 1000);
});
