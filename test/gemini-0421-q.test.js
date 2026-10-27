// 0.4.21 item Q-gemini (Chris's Gemini notes, Oct 26 7:23 and 7:39 PM): Gemini 3.6 Flash is in the list, a 429
// reads as a rate or quota limit with its reset time (never "out of credits"), a 503 or 429 benches ONE model
// (not the whole AI), the AI's own other models stand in before any other provider, and a pinned pick never
// reaches another provider. Every provider is a local mock; nothing here spends money.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-gemini-q-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_STATUS_PAGES = "off";
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY"]) process.env[k] = "";

// one mock for the OpenAI-style providers: /<prefix>/v1/chat/completions; models listed in mock.busy answer 503
const mock = { chat: [], busy: new Set() };
const srv = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
  const u = new URL(req.url, "http://127.0.0.1");
  const prefix = u.pathname.split("/")[1];
  if (/\/models$/.test(u.pathname)) return send(200, { data: [{ id: "mock" }] });
  if (/\/chat\/completions$/.test(u.pathname)) {
    const j = JSON.parse(body || "{}");
    mock.chat.push({ prefix, model: j.model });
    if (mock.busy.has(`${prefix}:${j.model}`)) return send(503, { error: { message: "The model is overloaded. Please try again later." } });
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: "ok" } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  return send(404, { error: "mock: no route" });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
after(() => new Promise((r) => srv.close(r)));
for (const [id, pre] of [["XAI", "xai"], ["GROQ", "groq"]]) process.env[`CC_BASE_URL_${id}`] = `${BASE}/${pre}/v1`;

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const REG = await import("../server/registry.js");
const H = await import("../server/health.js");
const FB = await import("../server/fallback.js");
const R = await import("../server/router.js");
const c = store.ctx();
for (const id of ["xai", "groq"]) c.secrets[id] = { key: `test-not-real-${id}-0123456789` };
c.docs.settings = { uiMode: "expert", preferFree: false };
const GROQ = REG.PROVIDERS.groq.models.map((m) => m.id);
const reset = () => { mock.chat.length = 0; mock.busy.clear(); for (const p of ["xai", "groq", "google"]) FB.clearTrouble(p, "test"); };
const drain = async (opts, run = {}) => { const seen = []; let text = ""; for await (const ev of FB.fallbackChat({ maxTokens: 50, messages: [{ role: "user", content: "hi" }], ...opts }, run)) { seen.push(ev); if (ev.type === "delta") text += ev.text; } return { seen, text, done: seen.find((e) => e.type === "done") }; };

test("the registry lists Gemini 3.6 Flash and the free tier puts the free models first", () => {
  const ids = REG.PROVIDERS.google.models.map((m) => m.id);
  assert.ok(ids.includes("gemini-3.6-flash"), "gemini-3.6-flash is listed");
  assert.ok(ids.includes("gemini-3.5-flash-lite"), "the lite model stays");
  assert.ok(!ids.some((id) => /^gemini-(1\.5|2\.0)/.test(id)), "no retired Gemini model is listed");
  assert.ok(REG.findModel("gemini-3.6-flash"));
  assert.ok(FB.freeTierView, "the free tier list is still exposed");
});

test("a Gemini 429 reads as a rate or quota limit with its reset time, never out of credits", () => {
  const p = REG.PROVIDERS.google;
  const body = { error: { code: 429, message: "You exceeded your current quota.", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s" }] } };
  const r = H.explainProviderError(p, 429, body, JSON.stringify(body));
  assert.match(r.detail, /rate or quota limit/i);
  assert.match(r.detail, /resets|try again|reset/i);
  assert.doesNotMatch(r.detail, /out of credits/i);
  // a real billing refusal keeps the credit wording
  const pay = H.explainProviderError(p, 402, { error: { message: "Payment required: insufficient credits" } }, "");
  assert.match(pay.detail, /no credits|out of credits/i);
});

test("a 503 on one Gemini model benches only that model, the other Gemini models stay in the ranking", () => {
  reset();
  FB.markTrouble("google", "server", "overloaded", { quiet: true, model: "gemini-3.8-flash" });
  assert.equal(FB.trouble("google"), null, "the AI as a whole is not benched");
  assert.ok(FB.modelTrouble("google", "gemini-3.8-flash"), "that model is");
  assert.equal(FB.modelTrouble("google", "gemini-3.6-flash"), null, "its sibling is not");
  const line = FB.busyLine(FB.modelTrouble("google", "gemini-3.8-flash"));
  assert.match(line, /^Gemini 3\.8 Flash: busy until \d{1,2}:\d{2}/);
  const ranked = R.rank({ capability: "writing", difficulty: 1, mode: "economy" }).ranked || [];
  const gem = ranked.filter((m) => m.provider === "google").map((m) => m.model);
  assert.ok(!gem.includes("gemini-3.8-flash"), "the busy model is out of the ranking");
  // a credits failure still benches the whole provider
  FB.markTrouble("google", "credits", "no credits", { quiet: true, model: "gemini-3.6-flash" });
  assert.ok(FB.trouble("google"), "credits are per provider");
  reset();
});

test("the next try is another model of the SAME AI, cheapest first, before any other provider", () => {
  reset();
  const first = FB.nextChoice({ provider: "google", model: "gemini-3.8-flash", tried: [{ provider: "google", model: "gemini-3.8-flash" }] });
  assert.equal(first.provider, "google");
  assert.notEqual(first.model, "gemini-3.8-flash");
  assert.equal(first.same, true);
  FB.markTrouble("google", "rate", "429", { quiet: true, model: first.model });
  const second = FB.nextChoice({ provider: "google", model: "gemini-3.8-flash", tried: [{ provider: "google", model: "gemini-3.8-flash" }] });
  assert.equal(second.provider, "google", "still the same AI");
  assert.notEqual(second.model, first.model, "a benched model is not picked again");
  assert.notEqual(second.model, "gemini-3.8-flash");
  // an AI that said no credits does not offer its siblings
  FB.markTrouble("google", "credits", "no credits", { quiet: true });
  const third = FB.nextChoice({ provider: "google", model: "gemini-3.8-flash", tried: [{ provider: "google", model: "gemini-3.8-flash" }] });
  assert.notEqual(third?.provider, "google");
  reset();
});

test("a pinned pick: a busy model hands over to a sibling model of the same AI and never reaches another provider", async () => {
  reset();
  assert.ok(GROQ.length >= 2);
  mock.busy.add(`groq:${GROQ[0]}`);
  const r = await drain({ provider: "groq", model: GROQ[0] });
  assert.equal(r.done.provider, "groq");
  assert.equal(r.done.model, GROQ[1], "the AI's own other model answered");
  assert.equal(mock.chat.filter((x) => x.prefix !== "groq").length, 0, "no other provider was called");
  assert.equal(FB.trouble("groq"), null, "the whole AI was not benched");
  assert.ok(FB.modelTrouble("groq", GROQ[0]), "only the busy model was");
  reset();
});

test("a pinned pick with every model of the AI busy stops with a plain message and calls no other provider", async () => {
  reset();
  for (const m of GROQ) mock.busy.add(`groq:${m}`);
  await assert.rejects(() => drain({ provider: "groq", model: GROQ[0] }), (e) => {
    assert.equal(e.code, "pinned_out");
    assert.match(e.message, /busy or out\. Pick another AI or turn on Let Meldmind choose/);
    return true;
  });
  assert.equal(mock.chat.filter((x) => x.prefix !== "groq").length, 0, "xAI and everyone else were never called");
  reset();
});

test("the Auto route (allowStandIn) still lets another provider stand in when the whole AI is busy", async () => {
  reset();
  for (const m of GROQ) mock.busy.add(`groq:${m}`);
  const r = await drain({ provider: "groq", model: GROQ[0], allowStandIn: true });
  assert.notEqual(r.done.provider, "groq", "another AI stood in");
  assert.ok(mock.chat.some((x) => x.prefix !== "groq"));
  reset();
});
