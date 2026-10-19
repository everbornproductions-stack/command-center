// Phase 26: smart fallback. Pure checks on error classification, the OpenRouter model map, cooldowns
// and defaults, then the running server against local mock providers whose behaviour the test flips
// between ok / 402 / 403-credits / 429 / 401 / 500 / a cut connection: pinned chats, OpenRouter retry, the next
// model when OpenRouter fails too, pre-emptive skipping, recovery after a health check, free tiers for
// small jobs, spend caps, the master switch, council and mission. No real URL or key is ever used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-fallback-");
const FB = await import("../server/fallback.js");

test("troubleKind: status codes and provider wording map to a skip reason; ordinary errors do not", () => {
  const k = (status, message) => FB.troubleKind({ status, message });
  assert.equal(k(402, "ChatGPT: HTTP 402 Payment Required"), "credits");
  assert.equal(k(403, "Grok: HTTP 403 Your team has either used all available credits or reached its monthly spending limit."), "credits", "403 with credit wording is credits, not a bad key");
  assert.equal(k(429, "ChatGPT: HTTP 429 You exceeded your current quota, please check your plan and billing details."), "credits", "an OpenAI quota 429 is credits");
  assert.equal(k(400, "Claude: Your credit balance is too low to access the Anthropic API."), "credits");
  assert.equal(k(429, "Grok: HTTP 429 Too many requests"), "rate");
  assert.equal(k(401, "Claude: invalid x-api-key"), "key");
  assert.equal(k(403, "Gemini: HTTP 403 forbidden"), "key");
  assert.equal(k(401, "Claude: no API key saved. Add it in Settings."), "key");
  assert.equal(k(0, "Grok: network error (fetch failed)"), "unreachable");
  assert.equal(k(503, "Mistral: HTTP 503 upstream"), "server");
  assert.equal(k(400, "Grok: HTTP 400 messages must not be empty"), null, "a bad request is the caller's problem");
  assert.equal(k(404, "Grok: HTTP 404 model not found"), null);
  assert.equal(FB.troubleKind(Object.assign(new Error("x"), { name: "AbortError" })), null);
  assert.equal(FB.troubleKind(null), null);
});

test("openrouterId: vendor namespaces, open models kept, custom gateways and OpenRouter itself skipped", () => {
  assert.equal(FB.openrouterId("anthropic", "claude-sonnet-5-5"), "anthropic/claude-sonnet-5-5");
  assert.equal(FB.openrouterId("openai", "gpt-6.1-sol"), "openai/gpt-6.1-sol");
  assert.equal(FB.openrouterId("xai", "grok-4.7"), "x-ai/grok-4.7");
  assert.equal(FB.openrouterId("google", "gemini-3.8-flash"), "google/gemini-3.8-flash");
  assert.equal(FB.openrouterId("mistral", "mistral-large-latest"), "mistralai/mistral-large-latest");
  assert.equal(FB.openrouterId("groq", "openai/gpt-oss-120b"), "openai/gpt-oss-120b");
  assert.equal(FB.openrouterId("openrouter", "openrouter/auto"), null);
  assert.equal(FB.openrouterId("c-mine-abc", "m"), null);
});

test("defaults, cooldowns, reasons, health mapping; no em-dashes in user-facing words", () => {
  assert.equal(FB.DEFAULTS.on, true); assert.equal(FB.DEFAULTS.openrouterFirst, true); assert.equal(FB.DEFAULTS.maxHops, 3);
  assert.deepEqual(Object.keys(FB.DEFAULTS.freeTiers).sort(), ["google", "groq", "openrouter"]);
  assert.equal(FB.DEFAULTS.freeTiers.google.on, true); assert.equal(FB.DEFAULTS.freeTiers.groq.on, false);
  for (const k of FB.KINDS) { assert.ok(k in FB.COOLDOWN_MS, k); assert.ok(FB.REASON[k], k); assert.doesNotMatch(FB.REASON[k], /—/); }
  assert.ok(FB.COOLDOWN_MS.rate < FB.COOLDOWN_MS.credits && FB.COOLDOWN_MS.credits <= FB.COOLDOWN_MS.key);
  for (const t of Object.values(FB.FREE_TIERS)) { assert.ok(t.models.length && t.perDay > 0 && t.perMinute > 0); assert.doesNotMatch(t.name + t.note, /—/); }
  assert.equal(FB.kindFromHealth("red", "Key rejected (401): invalid x-api-key"), "key");
  assert.equal(FB.kindFromHealth("red", "Payment required: no credits"), "credits");
  assert.equal(FB.kindFromHealth("red", "Could not reach Grok: connection refused"), "unreachable");
  assert.equal(FB.kindFromHealth("amber", "Rate limited"), "rate");
  assert.equal(FB.kindFromHealth("amber", "Out of credits or spending limit reached: ..."), "credits");
  assert.equal(FB.kindFromHealth("amber", "minor incident: elevated errors"), null, "an incident is a penalty, not a skip");
  assert.equal(FB.kindFromHealth("amber", "slow (30s)"), null);
  assert.equal(FB.kindFromHealth("green", "ok"), null);
  assert.equal(FB.kindFromHealth("grey", "no key"), null);
});

// ---------- the running server against mock providers ----------
const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", google: "AIzaFAKEfakeFAKEfakeFAKEfake0123456789", openrouter: "sk-or-v1-fakefakefakefakefake", deepseek: "sk-0123456789abcdef0123456789abcdef", mistral: "fakemistralkeyfakemistralkey0000" };
function sse(res, chunks) { res.writeHead(200, { "content-type": "text/event-stream" }); for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.write("data: [DONE]\n\n"); res.end(); }
function answerFor(j) {
  const sys = j.messages.find((m) => m.role === "system")?.content || "";
  const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
  if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "Mock plan", tasks: [{ id: "t1", title: "Draft it", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write it.", deliverable: "Draft" }, { id: "t2", title: "Check it", capability: "analysis", difficulty: 1, needWeb: false, deps: ["t1"], instructions: "Check it.", deliverable: "Notes" }], assembly: "One doc." });
  if (/strict judge/.test(sys)) { const letters = [...user.matchAll(/### Answer ([A-J])/g)].map((m) => m[1]); return JSON.stringify({ scores: Object.fromEntries(letters.map((l, i) => [l, 7 + (i % 3)])), best: letters[0], notes: {}, disagreement: "none" }); }
  if (/You QA another AI/.test(sys)) return `{"pass":true,"score":8,"issues":[]}`;
  return `Answer from ${j.model}.`;
}
// One mock with a path prefix per provider. behave[prefix] = "ok" | 402 | "403credits" | 429 | 401 | 500 | "drop"
// (the socket is cut, like a provider that cannot be reached); the models / balance endpoints always work so
// keys save green and health checks pass.
async function mocks() {
  const behave = { xai: "ok", groq: "ok", google: "ok", or: "ok", ds: "ok", mistral: "ok" };
  const seen = []; // { prefix, model, auth }
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    if (/\/models$/.test(url.pathname)) return send(200, prefix === "google" ? { models: [{ name: "models/gemini-3.8-flash" }, { name: "models/gemini-3.5-flash-lite" }] } : { data: [{ id: "mock" }] });
    if (url.pathname === "/or/v1/key") return send(200, { data: { limit_remaining: 10, usage: 1, limit: 11 } });
    if (url.pathname === "/ds/user/balance") return send(200, { balance_infos: [{ total_balance: "5.00", currency: "USD" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: `mock: no route ${url.pathname}` });
    const j = JSON.parse(body);
    seen.push({ prefix, model: j.model, auth: req.headers.authorization || null, system: j.messages.find((m) => m.role === "system")?.content || "" });
    const b = behave[prefix];
    if (b === "drop") return req.socket.destroy();
    if (b === 402) return send(402, { error: { message: "Payment required: your prepaid balance is empty." } });
    if (b === "403credits") return send(403, { code: "forbidden", error: "Your team has either used all available credits or reached its monthly spending limit." });
    if (b === 429) return send(429, { error: { message: "Rate limit reached for this model. Try again in 20s." } });
    if (b === 401) return send(401, { error: { message: "Incorrect API key provided: sk-xxxx." } });
    if (b === 500) return send(500, { error: { message: "internal error" } });
    const text = answerFor(j);
    const extra = prefix === "or" ? { cost: 0.0012 } : {};
    return sse(res, [{ model: j.model, choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 10, ...extra } }]);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, behave, seen, since: () => seen.length, calls: (prefix, from = 0) => seen.slice(from).filter((x) => x.prefix === prefix), close: () => new Promise((r) => srv.close(r)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitRun(s, pred, label, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const st = (await s.api("/state")).json; const hit = pred(st); if (hit) return hit; await sleep(250); }
  throw new Error(`timed out waiting for ${label}\n--- server log tail ---\n${s.log.slice(-1500)}`);
}
const finished = (kind, after) => (st) => st.missions.find((m) => m.kind === kind && m.startedAt > after && ["done", "done-with-errors", "failed"].includes(m.status));
const GROQ = "openai/gpt-oss-120b", FLASH = "gemini-3.8-flash";

test("server: pinned chat falls back on 402, 403-credits, 429, 401 and a cut connection; OpenRouter retry with exact cost; next model when OpenRouter fails; pre-emptive skip; recovery; free tiers; caps; switch off; council; mission", async () => {
  const m = await mocks();
  const s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
    CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_GOOGLE: `${m.base}/google/v1beta/openai`, CC_BASE_URL_OPENROUTER: `${m.base}/or/v1`, CC_BASE_URL_DEEPSEEK: `${m.base}/ds`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`,
    XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
  } });
  try {
    assert.equal((await s.api("/fallback", { noToken: true })).status, 401, "session token required");
    let v = (await s.api("/fallback")).json;
    assert.equal(v.settings.on, true); assert.equal(v.settings.openrouterFirst, true); assert.deepEqual(v.skipped, []); assert.equal(v.openrouter.keyed, false);
    assert.ok((await s.api("/state")).json.plugins.includes("fallback"), "the plugin is mounted");
    assert.equal((await s.api("/fallback/settings", { method: "POST", body: { maxHops: 99 } })).status, 400);
    assert.equal((await s.api("/fallback/settings", { method: "POST", body: { freeTiers: { google: { perDay: -1 } } } })).status, 400);

    // keys for xai, groq, mistral (OpenRouter and Google come later so the first fallbacks are plain model switches)
    for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
    // free tiers off for now so the ledger numbers below are plain
    await s.api("/fallback/settings", { method: "POST", body: { freeTiers: { google: { on: false }, openrouter: { on: false }, groq: { on: false } } } });

    // 1. a pinned chat to xAI, which answers 402: the job goes on with another model, and says so
    m.behave.xai = 402;
    let t0 = Date.now(), from = m.since();
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a tagline for a bakery.", provider: "xai", model: "grok-4.3" } })).status, 202);
    let run = await waitRun(s, finished("single", t0 - 1), "single after 402");
    let full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done", full.error); assert.match(full.deliverable, /^Answer from /);
    assert.equal(full.fallbacks.length, 1); assert.equal(full.fallbacks[0].from.provider, "xai"); assert.equal(full.fallbacks[0].kind, "credits"); assert.notEqual(full.fallbacks[0].to.provider, "xai"); assert.equal(full.fallbacks[0].via, null);
    assert.equal(full.provider, full.fallbacks[0].to.provider, "the run records who really answered");
    assert.equal(m.calls("xai", from).length, 1, "xAI was tried once");
    let led = (await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "call" && e.missionId === run.id && e.role === "answer");
    assert.equal(led.length, 1); assert.notEqual(led[0].provider, "xai"); assert.deepEqual(led[0].fallback, { from: "xai", fromModel: "grok-4.3", kind: "credits", via: null, hops: 1 }); assert.ok(led[0].cost > 0);
    let st = (await s.api("/state")).json;
    assert.ok(st.recent.some((e) => e.type === "log" && /Grok could not take this job \(out of credits or spending limit/.test(e.text)), "the feed says who stood in and why");
    assert.ok(st.recent.some((e) => e.type === "log" && /Grok skipped for new work for 15 min: out of credits/.test(e.text)));
    assert.ok(st.recent.some((e) => e.type === "agent.msg" && e.from === "xai" && /stand in/.test(e.text)));
    v = (await s.api("/fallback")).json;
    assert.equal(v.skipped.length, 1); assert.equal(v.skipped[0].provider, "xai"); assert.equal(v.skipped[0].kind, "credits"); assert.ok(v.skipped[0].leftMs > 10 * 60 * 1000);
    assert.equal(v.recent[0].from, "xai"); assert.equal(v.standInsMonth, 1);
    assert.equal(st.providers.find((p) => p.id === "xai").status.status, "red", "the health light shows it too");

    // 2. pre-emptive: xAI is known to be out of credits, so the next pinned chat never even calls it
    m.behave.xai = "ok"; from = m.since(); t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Another tagline.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "pre-empted single");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done"); assert.equal(m.calls("xai", from).length, 0, "no call to a provider known to be out of credits");
    assert.equal(full.fallbacks[0].kind, "credits"); assert.match(full.fallbacks[0].reason, /skipped/);
    // the router leaves it out of auto-picks as well
    const route = (await s.api(`/route?prompt=${encodeURIComponent("Write a short tagline")}`)).json;
    assert.ok(!route.ranked.some((r) => r.provider === "xai"), "auto routing skips xAI");

    // 3. recovery: a health check that passes puts it back, with no manual reset, and the next chat reaches it
    const chk = (await s.api("/check/xai", { method: "POST" })).json;
    assert.equal(chk.status, "green");
    v = (await s.api("/fallback")).json; assert.deepEqual(v.skipped, [], "back in the rotation after a green check");
    assert.ok((await s.api("/state")).json.recent.some((e) => e.type === "log" && /Grok is back in the rotation/.test(e.text)));
    from = m.since(); t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Third tagline.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "recovered single");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.fallbacks.length, 0); assert.equal(full.provider, "xai"); assert.equal(m.calls("xai", from).length, 1);

    // 4. 403 with credit wording, 429, 401, a server error and a cut connection each count as trouble of the right kind
    const cases = [["403credits", "credits"], [429, "rate"], [401, "key"], [500, "server"], ["drop", "unreachable"]];
    for (const [b, kind] of cases) {
      await s.api("/fallback/clear", { method: "POST", body: {} });
      m.behave.xai = b; t0 = Date.now();
      await s.api("/chat", { method: "POST", body: { prompt: `Tagline under ${b}.`, provider: "xai", model: "grok-4.3" } });
      run = await waitRun(s, finished("single", t0 - 1), `single under ${b}`);
      full = (await s.api(`/missions/${run.id}`)).json;
      assert.equal(full.status, "done", `${b}: ${full.error}`); assert.equal(full.fallbacks[0]?.kind, kind, `${b} is ${kind}`); assert.equal(full.fallbacks[0].from.provider, "xai");
      assert.equal((await s.api("/fallback")).json.skipped.find((x) => x.provider === "xai")?.kind, kind);
    }
    m.behave.xai = "ok";
    await s.api("/fallback/clear", { method: "POST", body: { provider: "xai" } });
    assert.equal((await s.api("/fallback/clear", { method: "POST", body: { provider: "nope" } })).status, 404);
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "deepseek", key: KEYS.deepseek } })).json.status.status, "green");

    // 5. OpenRouter first: the same model through OpenRouter, with its exact billed cost in the ledger
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openrouter", key: KEYS.openrouter } })).json.status.status, "green");
    assert.equal((await s.api("/fallback")).json.openrouter.ready, true);
    m.behave.xai = 402; from = m.since(); t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Tagline via OpenRouter.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "openrouter retry");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done"); assert.equal(full.fallbacks.length, 1); assert.equal(full.fallbacks[0].via, "openrouter"); assert.equal(full.fallbacks[0].to.provider, "openrouter"); assert.equal(full.fallbacks[0].to.model, "x-ai/grok-4.3");
    const orCall = m.calls("or", from); assert.equal(orCall.length, 1); assert.equal(orCall[0].model, "x-ai/grok-4.3"); assert.equal(orCall[0].auth, `Bearer ${KEYS.openrouter}`);
    led = (await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "call" && e.missionId === run.id && e.role === "answer");
    assert.equal(led[0].provider, "openrouter"); assert.equal(led[0].model, "x-ai/grok-4.3"); assert.equal(led[0].exact, true); assert.equal(led[0].cost, 0.0012); assert.equal(led[0].fallback.via, "openrouter");

    // 6. OpenRouter is out of credits too: then the next-best model from another provider
    await s.api("/fallback/clear", { method: "POST", body: {} });
    m.behave.or = 402; from = m.since(); t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Tagline when both fail.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "two hops");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done", full.error); assert.equal(full.fallbacks.length, 2);
    assert.equal(full.fallbacks[0].to.provider, "openrouter"); assert.ok(!["xai", "openrouter"].includes(full.fallbacks[1].to.provider), "third choice is a different provider");
    assert.equal(m.calls("xai", from).length, 1); assert.equal(m.calls("or", from).length, 1);
    led = (await s.api("/state")).json.ledger.recent.find((e) => e.kind === "call" && e.missionId === run.id && e.role === "answer");
    assert.equal(led.fallback.hops, 2); assert.equal(led.fallback.via, null);
    v = (await s.api("/fallback")).json; assert.deepEqual(v.skipped.map((x) => x.provider).sort(), ["openrouter", "xai"]);
    assert.equal(v.openrouter.ready, false, "a skipped OpenRouter is not used for the retry");
    // the OpenRouter retry is not tried while it is skipped
    from = m.since(); t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Tagline, OpenRouter skipped.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "or skipped");
    assert.equal(m.calls("or", from).length, 0);
    m.behave.or = "ok"; m.behave.xai = "ok";
    await s.api("/fallback/clear", { method: "POST", body: {} });

    // 7. no stand-in when smart fallback is off: the run fails and says why
    await s.api("/fallback/settings", { method: "POST", body: { on: false } });
    m.behave.xai = 402; from = m.since(); t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Tagline with fallback off.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "fallback off");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "failed"); assert.match(full.error, /402/); assert.equal(full.fallbacks.length, 0);
    assert.equal(m.calls("xai", from).length, 1);
    await s.api("/fallback/settings", { method: "POST", body: { on: true } });
    m.behave.xai = "ok";
    await s.api("/fallback/clear", { method: "POST", body: {} });

    // 8. free tier for small jobs: Gemini Flash takes the classify call at $0 until the daily allowance is used
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "google", key: KEYS.google } })).json.status.status, "green");
    v = (await s.api("/fallback/settings", { method: "POST", body: { freeTiers: { google: { on: true, perDay: 1, perMinute: 10 } } } })).json;
    const gt = v.freeTiers.find((t) => t.provider === "google");
    assert.equal(gt.on, true); assert.equal(gt.perDay, 1); assert.equal(gt.keyed, true); assert.equal(gt.eligibleNow, true); assert.equal(gt.usedToday, 0);
    const preview = (await s.api(`/route?prompt=${encodeURIComponent("Give me a title")}`)).json;
    const FREE_MODELS = FB.FREE_TIERS.google.models;
    assert.ok(FREE_MODELS.includes(preview.classification.source), `the classifier ran on a free model (${preview.classification.source})`);
    led = (await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "call" && e.role === "classify");
    assert.equal(led[0].provider, "google"); assert.ok(FREE_MODELS.includes(led[0].model)); assert.equal(led[0].free, true); assert.equal(led[0].cost, 0);
    v = (await s.api("/fallback")).json;
    const gt2 = v.freeTiers.find((t) => t.provider === "google");
    assert.equal(gt2.usedToday, 1); assert.equal(gt2.eligibleNow, false, "the daily allowance (1) is used"); assert.equal(v.freeMonth, 1);
    // the next small job is not free and does not go to Gemini on the free tier's account
    await s.api(`/route?prompt=${encodeURIComponent("Give me another title")}`);
    led = (await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "call" && e.role === "classify");
    assert.equal(led[0].free, false, "never past the allowance the app knows about");
    assert.equal(led.filter((e) => e.free).length, 1);
    await s.api("/fallback/settings", { method: "POST", body: { freeTiers: { google: { on: false } } } });

    // 9. spend caps: a provider at 100% of its monthly cap is never a stand-in and is shown as skipped for the cap
    const groqSpend = (await s.api("/state")).json.ledger.byProvider.groq?.month || 0;
    assert.ok(groqSpend > 0, "Groq has spend this month from the stand-ins above");
    await s.api("/alerts/caps", { method: "POST", body: { caps: { groq: Math.max(0.000001, groqSpend / 2) } } });
    v = (await s.api("/fallback")).json;
    const capped = v.skipped.find((x) => x.provider === "groq");
    assert.ok(capped && capped.kind === "cap", JSON.stringify(v.skipped));
    assert.deepEqual((await s.api("/fallback/clear", { method: "POST", body: { provider: "groq" } })).json.cleared, [], "a cap cannot be cleared here");
    m.behave.xai = 402; m.behave.or = 402; from = m.since(); t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Tagline with Groq capped.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "capped stand-in");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done", full.error); assert.ok(full.fallbacks.every((f) => f.to.provider !== "groq"), "a capped provider never stands in");
    assert.equal(m.calls("groq", from).length, 0);
    await s.api("/alerts/caps", { method: "POST", body: { caps: {} } });
    m.behave.xai = "ok"; m.behave.or = "ok";
    await s.api("/fallback/clear", { method: "POST", body: {} });

    // 10. council: a member whose provider is out of credits is replaced; the stand-in is on the council record
    m.behave.mistral = 402; t0 = Date.now();
    assert.equal((await s.api("/council", { method: "POST", body: { prompt: "Council: best bakery tagline?", members: [{ provider: "mistral", model: "mistral-small-latest" }, { provider: "groq", model: GROQ }], qa: true } })).status, 202);
    run = await waitRun(s, finished("council", t0 - 1), "council", 90000);
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done");
    assert.ok(full.fallbacks.length >= 1, "a member stood in"); assert.equal(full.fallbacks[0].from.provider, "mistral");
    assert.ok(!full.members.some((x) => x.provider === "mistral"), "the member list shows who really answered");
    assert.ok(full.members.some((x) => x.standIn?.for === "mistral"));
    assert.equal(Object.keys(full.answers).length, 2, "two answers still"); assert.ok(full.verdict?.text);
    assert.ok(!full.members.some((x) => x.provider === "groq" && x.standIn), "the stand-in is not the other member's model");
    m.behave.mistral = "ok";
    await s.api("/fallback/clear", { method: "POST", body: {} });

    // 11. mission: a specialist's provider fails mid-mission; the task is handed to a stand-in and the mission finishes
    m.behave.groq = 429; t0 = Date.now();
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "Write a one-line bakery tagline and check it.", mode: "economy", qa: false, budgetUsd: 1 } })).status, 202);
    run = await waitRun(s, finished("mission", t0 - 1), "mission", 120000);
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.ok(["done", "done-with-errors"].includes(full.status), `mission ${full.status}: ${full.error || ""}`);
    assert.ok(full.deliverable, "a deliverable came out");
    assert.ok(!full.tasks.some((t) => t.provider === "groq" && t.status === "done" && !t.standIn), "no task finished on the rate-limited provider");
    const groqPicked = full.tasks.some((t) => t.standIn?.for === "groq") || full.planner?.standIn?.for === "groq" || full.assembler?.standIn?.for === "groq";
    const groqSkipped = (await s.api("/fallback")).json.skipped.some((x) => x.provider === "groq");
    assert.ok(groqPicked || groqSkipped, "Groq either stood aside or was skipped once it answered 429");
    m.behave.groq = "ok";

    // 12. keys never leave the server
    const everything = JSON.stringify(await s.api("/fallback")) + JSON.stringify(await s.api("/state")) + s.log;
    for (const k of Object.values(KEYS)) assert.ok(!everything.includes(k), "key never in a response or the log");
  } finally { await s.stop(); await m.close(); }
});
