// 0.4.21 M-safety: the health check makes one tiny real call, an AI paused for credits stays paused until a
// real call works, and OpenRouter never shows "$50 left" for an account that bought no credits. Local mocks only.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tmpDir } from "./helpers.js";
import { interpretOpenRouter, openRouterLine } from "../server/openrouter-balance.js";

const DIR = tmpDir("cc-credit-truth-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_STATUS_PAGES = "off";
delete process.env.CC_HEALTH_PROBE;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { PROVIDERS } = await import("../server/registry.js");
const H = await import("../server/health.js");
const B = await import("../server/provider-balance.js");

function mock(state) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, "http://127.0.0.1").pathname;
    hits.push(`${req.method} ${p}`);
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    req.resume();
    if (p.endsWith("/models")) return send(200, { data: [{ id: "m1" }] });
    if (p.endsWith("/chat/completions")) {
      if (state.chat === 402) return send(402, { error: { message: "Insufficient credits. Add more." } });
      if (state.chat === 500) return send(500, { error: { message: "boom" } });
      if (state.chat === 429) return send(429, { error: { message: "Rate limit reached" } });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } })}\n\n`);
      return res.end("data: [DONE]\n\n");
    }
    if (p.endsWith("/key")) return send(200, { data: state.key || { usage: 0, limit: 50, limit_remaining: 50, is_free_tier: true } });
    if (p.endsWith("/credits")) return state.credits ? send(200, { data: state.credits }) : send(403, { error: { message: "no" } });
    send(404, {});
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, hits, base: `http://127.0.0.1:${server.address().port}` })));
}

test("OpenRouter: a $50 key limit with no credits bought is $0, never '$50 left'", () => {
  const free = interpretOpenRouter({ usage: 0, limit: 50, limit_remaining: 50, is_free_tier: true }, { total_credits: 0, total_usage: 0 });
  assert.equal(free.left, 0); assert.equal(free.noCredits, true);
  assert.match(openRouterLine(free), /no credits bought/);
  assert.doesNotMatch(openRouterLine(free), /\$50/);
  // credits could not be read but OpenRouter says free tier: still nothing left
  assert.equal(interpretOpenRouter({ limit_remaining: 50, is_free_tier: true }, null).left, 0);
  // bought and used some: the account balance wins, and a lower key limit caps it
  assert.equal(interpretOpenRouter({ limit_remaining: null }, { total_credits: 25, total_usage: 7.75 }).left, 17.25);
  const capped = interpretOpenRouter({ limit_remaining: 5 }, { total_credits: 25, total_usage: 1 });
  assert.equal(capped.left, 5); assert.equal(capped.scope, "key limit");
  // only a key limit is known (paid account, credits unreadable): labeled as the key's limit
  const k = interpretOpenRouter({ limit_remaining: 9, is_free_tier: false }, null);
  assert.equal(k.scope, "key limit"); assert.match(openRouterLine(k), /key's limit/);
});

test("the Subscriptions balance and the health light agree: no '$50 left' for an account with no credits", async () => {
  const state = { key: { usage: 0, limit: 50, limit_remaining: 50, is_free_tier: true }, credits: { total_credits: 0, total_usage: 0 } };
  const m = await mock(state);
  try {
    const live = await B.ADAPTERS.openrouter.fetch({ key: "sk-or-v1-fake" }, { base: m.base });
    assert.equal(live.creditsLeft, 0); assert.equal(live.noCredits, true);
    const p = PROVIDERS.openrouter, old = p.baseUrl;
    p.baseUrl = m.base; process.env.OPENROUTER_API_KEY = "sk-or-v1-fakefakefakefake";
    try {
      const st = await H.checkProvider("openrouter");
      assert.doesNotMatch(st.detail, /\$50|50 USD/);
      assert.match(st.detail, /no credits bought/);
      assert.equal(st.balance.left, 0);
    } finally { p.baseUrl = old; delete process.env.OPENROUTER_API_KEY; }
  } finally { m.server.close(); }
});

test("health check: the models list alone is not enough; a 402 on the tiny real call keeps the light off", async () => {
  const state = { chat: 402 };
  const m = await mock(state);
  const p = PROVIDERS.groq, old = p.baseUrl;
  p.baseUrl = m.base; process.env.GROQ_API_KEY = "gsk_fakefakefakefakefake";
  try {
    const st = await H.checkProvider("groq");
    assert.ok(m.hits.includes("POST /chat/completions"), "a real completion was tried");
    assert.notEqual(st.status, "green");
    assert.match(st.detail, /credits/i);
  } finally { p.baseUrl = old; delete process.env.GROQ_API_KEY; m.server.close(); }
});

test("a paused AI stays paused through list-only checks and a 429, and comes back only when a real call works", async () => {
  const state = { chat: 429 };
  const m = await mock(state);
  const p = PROVIDERS.groq, old = p.baseUrl;
  p.baseUrl = m.base; process.env.GROQ_API_KEY = "gsk_fakefakefakefakefake";
  try {
    H.noteCall("groq", false, 10, 402, { message: "Insufficient credits" });
    assert.match(H.getStatus("groq").detail, /credits/i);
    let st = await H.checkProvider("groq"); // list passes, the real call is refused (429)
    assert.notEqual(st.status, "green");
    assert.match(st.detail, /Rate or quota limit|Rate limited|credits/i);
    // the real call stops working in a way we cannot tell (the mock has no chat route): still paused
    state.chat = 500;
    st = await H.checkProvider("groq");
    assert.notEqual(st.status, "green", "an inconclusive probe does not clear a pause");
    // now a real call works
    state.chat = 200;
    st = await H.checkProvider("groq");
    assert.equal(st.status, "green");
    assert.ok(st.lastProbeOk > 0);
  } finally { p.baseUrl = old; delete process.env.GROQ_API_KEY; m.server.close(); }
});

test("the probe can be switched off for tests and never runs for a provider with no model", async () => {
  process.env.CC_HEALTH_PROBE = "off";
  const m = await mock({ chat: 402 });
  const p = PROVIDERS.groq, old = p.baseUrl;
  p.baseUrl = m.base; process.env.GROQ_API_KEY = "gsk_fakefakefakefakefake";
  try {
    const st = await H.checkProvider("groq");
    assert.equal(st.status, "green");
    assert.ok(!m.hits.includes("POST /chat/completions"));
    assert.deepEqual(await H.probeCompletion({ id: "x", kind: "text", models: [] }, null), { inconclusive: true });
  } finally { delete process.env.CC_HEALTH_PROBE; p.baseUrl = old; delete process.env.GROQ_API_KEY; m.server.close(); }
});

test("Who will read this lists only AIs that can run and names the AI that will really plan", async () => {
  const { markTrouble, clearTrouble } = await import("../server/fallback.js");
  const { canRun, runnableOnly } = await import("../server/runnable.js");
  const { whoWillRead } = await import("../server/readers.js");
  const seen = [];
  const rankFn = (o) => {
    seen.push(o.capability);
    return [{ provider: "openai", providerName: "ChatGPT", model: "gpt-6.1-sol", score: 90 }, { provider: "anthropic", providerName: "Claude", model: "claude-opus-5-5", score: 80 }, { provider: "xai", providerName: "Grok", model: "grok-4.7", score: 70 }];
  };
  let w = whoWillRead({ prompt: "plan a launch", mode: "balanced", rankFn, search: false, agent: { use: false } });
  assert.equal(w.planner.name, "ChatGPT");
  assert.ok(seen.includes("reasoning"), "the planner is picked like the Mission planner does (reasoning)");
  markTrouble("openai", "credits", "Payment required", { quiet: true });
  try {
    assert.equal(canRun("openai"), false); assert.equal(canRun("anthropic"), true);
    assert.deepEqual(runnableOnly([{ provider: "openai" }, { provider: "xai" }]).map((m) => m.provider), ["xai"]);
    w = whoWillRead({ prompt: "plan a launch", mode: "balanced", rankFn, search: false, agent: { use: false } });
    assert.deepEqual(w.readers.map((r) => r.name), ["Claude", "Grok"], "the paused AI is not listed");
    assert.equal(w.planner.name, "Claude");
    assert.equal(w.readers.find((r) => r.name === "Claude").role, "plan");
  } finally { clearTrouble("openai"); }
  assert.equal(canRun("openai"), true);
  const src = (await import("node:fs")).readFileSync(new URL("../server/plugins/desk.js", import.meta.url), "utf8");
  assert.match(src, /runnableOnly\(rank\(\{ \.\.\.cls, mode: priority \}\)\)/);
  assert.match(src, /capability: "reasoning", difficulty: 3/);
});
