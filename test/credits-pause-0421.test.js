// 0.4.21 item P-credits: an AI that is out of credits is paused (red "Out of credits") instead of retried on every
// step, rechecked on a backoff of 5 min, 15 min, 1 h then hourly, and put back the moment existing tracking
// (live balance, tracked balance, a free-tier reset) shows credits again. Nothing here spends money: every
// provider is a local mock and the paid-only ones are counted to prove no completion was sent.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, waitBudget, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-credits-pause-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_STATUS_PAGES = "off";
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY"]) process.env[k] = "";

// one mock for every provider: /<prefix>/v1/models, /or/v1/key, /or/v1/credits, /<prefix>/v1/chat/completions
const mock = { credits: { total_credits: 0, total_usage: 0 }, chat: [], listed: [], chatStatus: 200 };
const srv = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
  const u = new URL(req.url, "http://127.0.0.1");
  const prefix = u.pathname.split("/")[1];
  if (/\/models$/.test(u.pathname)) { mock.listed.push(prefix); return send(200, { data: [{ id: "mock" }] }); }
  if (u.pathname === "/or/v1/key") return send(200, { data: { limit_remaining: null, usage: 0, is_free_tier: false } });
  if (u.pathname === "/or/v1/credits") return send(200, { data: mock.credits });
  if (/\/chat\/completions$/.test(u.pathname)) {
    const j = JSON.parse(body || "{}");
    mock.chat.push({ prefix, model: j.model, max: j.max_tokens ?? j.max_completion_tokens ?? null });
    if (mock.chatStatus !== 200 && prefix === mock.failPrefix) return send(mock.chatStatus, { error: { message: "Payment required: your prepaid balance is empty." } });
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
for (const [id, pre] of [["MISTRAL", "mistral"], ["XAI", "xai"], ["GROQ", "groq"], ["OPENROUTER", "or"], ["OPENAI", "openai"]]) process.env[`CC_BASE_URL_${id}`] = `${BASE}/${pre}/v1`;

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const H = await import("../server/health.js");
const P = await import("../server/pause.js");
const FB = await import("../server/fallback.js");
const PB = await import("../server/provider-balance.js");
const CT = await import("../server/credit-tracker.js");
PB.configure({ baseUrls: { openrouter: `${BASE}/or/v1` } });

const c = store.ctx();
const key = (id) => { c.secrets[id] = { key: `test-not-real-${id}-0123456789` }; };
for (const id of ["mistral", "xai", "groq", "openrouter", "openai"]) key(id);
const MIN = 60 * 1000, HOUR = 60 * MIN;
const reset = (id) => { delete c.health[id]; P.noteKeySaved(id); FB.clearTrouble(id, "test"); };
const goRed = (id, status = 402, body = { error: { message: "Payment required: your prepaid balance is empty." } }) => H.noteCall(id, false, 5, status, { status, body });
const poll = async (fn, label, ms = 25000) => {
  const end = Date.now() + waitBudget(ms);
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`timed out waiting for ${label}`);
};

test("a real 402 pauses the AI as red Out of credits and routing leaves it out", async () => {
  const { rank } = await import("../server/router.js");
  c.docs.settings = { uiMode: "expert", preferFree: false };
  reset("xai"); reset("groq");
  H.noteCall("groq", true, 20);
  goRed("xai");
  const info = P.describePause("xai");
  assert.ok(info, "paused");
  assert.equal(info.label, "Out of credits");
  assert.equal(info.kind, "credits");
  assert.ok(["red", "amber"].includes(H.getStatus("xai").status), "the health light is red or amber; the screens show red for any paused AI");
  assert.ok(!rank({ capability: "writing", difficulty: 2, mode: "balanced" }).some((m) => m.provider === "xai"), "routing skips it");
  const acc = (await import("../server/provider-access.js")).accessFor((await import("../server/registry.js")).PROVIDERS.xai);
  assert.equal(acc.label, "Out of credits");
  assert.equal(acc.pause.kind, "credits");
  assert.match(acc.pause.nextCheckText, /^Checks again in 5 min$/);
  // a 403 whose body says credits is the same pause
  reset("xai"); goRed("xai", 403, { error: "Your team has either used all available credits or reached its monthly spending limit." });
  assert.equal(P.describePause("xai")?.kind, "credits");
  // a plain per-minute 429 is a short pause, not "Out of credits"
  reset("xai"); goRed("xai", 429, { error: { message: "Rate limit reached. Try again in 20s." } });
  const rate = P.describePause("xai");
  assert.equal(rate.kind, "rate");
  assert.equal(rate.label, "Rate limited");
  assert.ok(rate.nextCheckAt - H.getStatus("xai").realFailAt <= 61 * 1000, "about a minute");
  // the provider's retry-after wins
  reset("xai"); H.noteCall("xai", false, 5, Object.assign(new Error("xAI: HTTP 429 slow down"), { status: 429, retryAfterMs: 20000 })); // the error object, as the fallback chain passes it
  assert.equal(P.describePause("xai").nextCheckAt - H.getStatus("xai").realFailAt, 20000);
  reset("xai"); reset("groq");
});

test("backoff is 5 min, 15 min, 1 h, then hourly, and a paid-only AI is never sent a completion", async () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(P.backoffMs), [5 * MIN, 15 * MIN, HOUR, HOUR, HOUR]);
  reset("mistral");
  goRed("mistral");
  const base = H.getStatus("mistral").realFailAt;
  mock.chat.length = 0; mock.listed.length = 0;
  assert.equal(P.describePause("mistral", base).nextCheckAt, base + 5 * MIN);
  // not due yet: nothing is checked
  await P.checkRespectingPause({ now: base + 4 * MIN });
  assert.equal(mock.listed.filter((x) => x === "mistral").length, 0, "no check before the first 5 minutes");
  const steps = [];
  let now = base + 5 * MIN;
  for (let i = 0; i < 4; i++) {
    await P.checkRespectingPause({ now });
    assert.ok(P.describePause("mistral", now), "still paused after a recheck with no way to know");
    const next = P.describePause("mistral", now).nextCheckAt;
    steps.push(next - now);
    now = next;
  }
  assert.deepEqual(steps, [15 * MIN, HOUR, HOUR, HOUR]);
  assert.ok(mock.listed.filter((x) => x === "mistral").length >= 4, "the key check ran each time");
  assert.equal(mock.chat.filter((x) => x.prefix === "mistral").length, 0, "no completion was sent to a paid-only AI");
  assert.match(P.describePause("mistral", now - 30 * MIN).nextCheckText, /Checks again in 30 min/);
  reset("mistral");
});

test("a free route is probed with 1 token on a free model; success puts the AI back", async () => {
  const FB_MODELS = Object.fromEntries(Object.entries(FB.FREE_TIERS).map(([k, v]) => [k, v.models]));
  for (const [pid, model] of Object.entries(H.FREE_PROBE)) assert.ok(FB_MODELS[pid].includes(model), `${pid} probe model is a free-tier model`);
  reset("groq");
  mock.chat.length = 0;
  goRed("groq");
  const base = H.getStatus("groq").realFailAt;
  await P.checkRespectingPause({ now: base + 5 * MIN });
  const calls = mock.chat.filter((x) => x.prefix === "groq");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, H.FREE_PROBE.groq);
  assert.equal(calls[0].max, 1);
  assert.equal(P.describePause("groq"), null, "green again");
  assert.equal(H.getStatus("groq").status, "green");
  reset("groq");
});

test("recovery by a live balance: OpenRouter credits go from 0 to above 0 with no completion call", async () => {
  reset("openrouter");
  mock.chat.length = 0;
  mock.credits = { total_credits: 0, total_usage: 0 };
  goRed("openrouter");
  const base = H.getStatus("openrouter").realFailAt;
  let r = await P.recheckProvider("openrouter", { now: base + 5 * MIN });
  assert.equal(r.recovered, false);
  assert.ok(P.describePause("openrouter"), "no credits bought yet: still red");
  mock.credits = { total_credits: 10, total_usage: 6.8 };
  const events = [];
  const { bus } = await import("../server/events.js");
  const on = (ev) => { if (ev.type === "provider.status" && ev.provider === "openrouter") events.push(ev.status); };
  bus.on("event", on);
  r = await P.recheckProvider("openrouter", { now: base + 20 * MIN });
  bus.off("event", on);
  assert.equal(r.recovered, true);
  assert.equal(r.via, "balance");
  assert.equal(P.describePause("openrouter"), null);
  assert.equal(H.getStatus("openrouter").status, "green");
  assert.match(H.getStatus("openrouter").detail, /\$3\.20 left/);
  assert.ok(events.includes("green"), "the provider.status event fired");
  assert.equal(mock.chat.length, 0, "not one completion was sent");
  const { rank } = await import("../server/router.js");
  c.docs.settings = { uiMode: "expert", preferFree: false };
  assert.ok(rank({ capability: "writing", difficulty: 2, mode: "balanced" }).some((m) => m.provider === "openrouter"), "back in routing");
  reset("openrouter");
});

test("recovery by tracked balance: raising it after the failure rechecks at once, an old balance does not", async () => {
  reset("mistral");
  CT.clearTracked("mistral");
  CT.setBalance("mistral", { amount: 3 }); // typed before the failure
  goRed("mistral");
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(P.describePause("mistral"), "an old tracked balance does not undo a real failure");
  let r = await P.recheckProvider("mistral", { now: Date.now() + 1000 });
  assert.equal(r.recovered, false);
  await new Promise((r2) => setTimeout(r2, 15));
  CT.setBalance("mistral", { amount: 5 }); // a top-up typed in: emits credits.raised
  await poll(() => !P.describePause("mistral"), "the AI to go green after the balance was raised");
  assert.equal(H.getStatus("mistral").status, "green");
  assert.match(H.getStatus("mistral").detail, /Tracked: \$5\.00 left/);
  assert.equal(mock.chat.filter((x) => x.prefix === "mistral").length, 0, "no completion was sent");
  assert.equal(P.creditLine("mistral").text, "Tracked: $5.00 left");
  CT.clearTracked("mistral");
  reset("mistral");
});

test("Gemini free tier resets at midnight Pacific; the recheck is never later than that", () => {
  // 12:00 noon PDT on Oct 26, 2026 -> midnight PDT Oct 27 is 07:00 UTC
  assert.equal(P.nextPacificMidnight(Date.UTC(2026, 9, 26, 19, 0, 0)), Date.UTC(2026, 9, 27, 7, 0, 0));
  // 05:00 PST on Nov 2 (after the clocks went back): midnight PST Nov 3 is 08:00 UTC
  assert.equal(P.nextPacificMidnight(Date.UTC(2026, 10, 2, 13, 0, 0)), Date.UTC(2026, 10, 3, 8, 0, 0));
  // the day the clocks go back (Nov 1, 2026) is 25 hours long
  assert.equal(P.nextPacificMidnight(Date.UTC(2026, 10, 1, 10, 0, 0)), Date.UTC(2026, 10, 2, 8, 0, 0));
  key("google");
  const midnight = P.nextPacificMidnight(Date.now());
  const failAt = midnight - 2 * MIN;
  c.health.google = { status: "amber", detail: "Out of credits or spending limit reached: quota", realFailAt: failAt, checkedAt: failAt };
  P.noteKeySaved("google"); // starts the schedule over without touching the light
  c.health.google.realFailAt = failAt;
  assert.equal(P.describePause("google", failAt).nextCheckAt, midnight, "midnight comes before the 5 minute step");
  assert.equal(P.creditLine("google").text, "Free tier, resets at midnight Pacific");
  delete c.health.google; delete c.secrets.google;
});

test("a saved key starts over at once: the backoff restarts and the old failure is forgotten", async () => {
  reset("mistral");
  goRed("mistral");
  const base = H.getStatus("mistral").realFailAt;
  await P.checkRespectingPause({ now: base + 5 * MIN });
  assert.equal(P.describePause("mistral", base + 5 * MIN).nextCheckAt - (base + 5 * MIN), 15 * MIN, "on step 2");
  P.noteKeySaved("mistral");
  assert.equal(H.getStatus("mistral").realFailAt, 0, "the failure no longer holds the light");
  const again = P.describePause("mistral");
  assert.ok(again.nextCheckAt - H.getStatus("mistral").checkedAt <= 5 * MIN + 5, "back to the 5 minute step");
  const index = fs.readFileSync(path.join(ROOT, "server/index.js"), "utf8").replace(/\r\n/g, "\n");
  const at = index.indexOf('if (method === "POST" && p === "/keys")');
  const block = index.slice(at, index.indexOf('method === "DELETE" && seg[0] === "keys"'));
  assert.match(block, /noteKeySaved\(body\.provider\);[\s\S]*await checkProvider\(body\.provider\)/, "POST /keys forgets the failure, then checks right away");
  reset("mistral");
});

test("run-level skip: after the first 402 an AI is not asked again in the same run", async () => {
  for (const id of ["xai", "groq"]) { reset(id); key(id); }
  c.docs.settings = { uiMode: "expert", preferFree: false };
  mock.failPrefix = "xai"; mock.chatStatus = 402; mock.chat.length = 0;
  const skipProviders = new Set();
  const seen = [];
  const run = { missionId: "m-test", role: "work", mode: "balanced", cls: { capability: "writing", difficulty: 1 }, skipProviders, onTrouble: (pid, kind) => seen.push([pid, kind]) };
  const opts = { provider: "xai", model: "grok-4.3", allowStandIn: true, maxTokens: 50, messages: [{ role: "user", content: "hi" }] };
  const first = await FB.completeFallback(opts, run);
  assert.notEqual(first.provider, "xai", "a stand-in answered");
  assert.deepEqual(seen[0], ["xai", "credits"]);
  assert.ok(skipProviders.has("xai"));
  const xaiCalls = () => mock.chat.filter((x) => x.prefix === "xai").length;
  assert.equal(xaiCalls(), 1);
  // the shared "troubled" table forgets it (as after a health check) but the run still remembers
  FB.clearTrouble("xai", "test");
  for (let step = 0; step < 3; step++) {
    const r = await FB.completeFallback(opts, run);
    assert.notEqual(r.provider, "xai");
  }
  assert.equal(xaiCalls(), 1, "xAI was called once for the whole run, not once per step");
  mock.chatStatus = 200; mock.failPrefix = null;
  for (const id of ["xai", "groq"]) reset(id);
  FB.clearTrouble("xai", "test"); FB.clearTrouble("groq", "test");
  // every call in mission.js and council.js hands the run's skip set to the fallback chain
  const mission = fs.readFileSync(path.join(ROOT, "server/mission.js"), "utf8").replace(/\r\n/g, "\n");
  const council = fs.readFileSync(path.join(ROOT, "server/council.js"), "utf8").replace(/\r\n/g, "\n");
  const calls = (src) => (src.match(/(?:fallbackChat|completeFallback)\(\{/g) || []).length;
  assert.equal((mission.match(/skipProviders: skipSet, onTrouble: runTrouble/g) || []).length, calls(mission) - (mission.match(/completeFallback\(\{ provider: "[^"]+"/g) || []).length, "planner, workers, QA, revise and assemble all pass the run skip set");
  assert.ok(calls(council) >= 2 && (council.match(/skipProviders: skipSet/g) || []).length === 2);
});

test("server: the Check again route reads the balance first, may send one 1 token test on the click, and the AI goes green", async () => {
  mock.chat.length = 0; mock.failPrefix = "mistral"; mock.chatStatus = 402;
  const s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "on", CC_BASE_URL_MISTRAL: `${BASE}/mistral/v1`,
    MISTRAL_API_KEY: "", XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
  } });
  try {
    mock.chatStatus = 200;
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "mistral", key: "fakemistralkeyfakemistralkey0123" } })).json.status.status, "green");
    mock.chatStatus = 402;
    const posted = await s.api("/chat", { method: "POST", body: { prompt: "Say hi.", provider: "mistral", model: "mistral-small-latest" } });
    assert.equal(posted.status, 202);
    await poll(async () => { const p = (await s.api("/state")).json.providers.find((x) => x.id === "mistral"); return p?.access?.paused; }, "mistral to show as paused");
    const red = (await s.api("/state")).json.providers.find((x) => x.id === "mistral");
    assert.equal(red.access.label, "Out of credits");
    assert.equal(red.access.pause.checkAgainTitle, "A one word test. If you have no credits it costs nothing.");
    assert.match(red.access.pause.nextCheckText, /^Checks again in \d+ min$|^Checks again soon$/);
      // still out of credits: the click sends one tiny test and the AI stays red, backoff starts over
    const before = mock.chat.filter((x) => x.prefix === "mistral").length;
    let r = await s.api("/providers/mistral/recheck", { method: "POST", body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.recovered, false);
    assert.equal(r.json.pause?.label, "Out of credits");
    assert.equal(mock.chat.filter((x) => x.prefix === "mistral").length - before, 1, "exactly one test on the click");
    // credits are back: the click turns it green
    mock.chatStatus = 200;
    r = await s.api("/providers/mistral/recheck", { method: "POST", body: {} });
    assert.equal(r.json.recovered, true);
    assert.equal(r.json.status.status, "green");
    const back = (await s.api("/state")).json.providers.find((x) => x.id === "mistral");
    assert.equal(back.access.paused, false);
    assert.equal(back.status.status, "green");
  } finally { await s.stop(); mock.failPrefix = null; mock.chatStatus = 200; }
});

test("the screens show an out of credits AI as red, with the next check, and never as working", () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
  const app = read("web/app.js"), label = read("web/access-label.js"), live = read("server/live-bubble.js"), lv = read("web/features/liveview.js"), svc = read("web/features/services.js");
  assert.match(label, /PAUSE_LABEL = "Out of credits"/);
  assert.match(label, /A one word test\. If you have no credits it costs nothing\./);
  assert.match(app, /pausedNow\(p\) \? "red"/, "the AI bar light is red");
  assert.match(app, /pauseNext\(p\)/, "the AI bar shows when it checks again");
  assert.match(app, /outAis/, "Simple mode lists the out of credits AI");
  assert.match(app, /data-recheck/);
  assert.match(svc, /data-recheck/, "Subscriptions has Check again");
  assert.match(live, /m\.paused/, "Live Ops does not probe or count an out of credits AI as working");
  assert.match(lv, /m\.paused \? "red"/);
  for (const text of [label, app.match(/function recheckHtml[\s\S]*?\n}\n/)[0]]) assert.doesNotMatch(text, /[—–]/);
});

test("the free probe, the paid-only rule and the labels keep to the words rules", () => {
  const src = fs.readFileSync(path.join(ROOT, "server/pause.js"), "utf8");
  const words = [...src.matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1]).join("\n");
  assert.doesNotMatch(words, /[—–]/);
  assert.equal(P.checkAgainText(5 * MIN), "Checks again in 5 min");
  assert.equal(P.checkAgainText(HOUR), "Checks again in 1 hour");
  assert.equal(P.checkAgainText(2 * HOUR), "Checks again in 2 hours");
  assert.equal(P.checkAgainText(1000), "Checks again soon");
});
