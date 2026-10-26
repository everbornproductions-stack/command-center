// 0.4.21 K-free: free AIs first. Mock providers only, no real key, no network, no data/ folder.
//  unit: cost tiers, Free only default, cost words, estimate calibration, summary string, Auto's mode choice
//  in-process fallback: the 3-hop limit with the free last resort; Free only never calls a paid mock
//  server: credit check summary, 402 marks an AI out (AI bar, readers list), Auto picks each mode, local AI detected
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, tmpDir, waitBudget } from "./helpers.js";
import { KEYS, mocks } from "./send-check-mock.js";

const m = await mocks();
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-freefirst-");
Object.assign(process.env, {
  CC_SUBCLI_HOME: tmpDir("cc-ff-home-"), CC_SUBCLI_NO_PATH: "1", // no real Claude Code, Codex or Gemini CLI from the machine running the test
  CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
  CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_OPENROUTER: `${m.base}/openrouter/v1`,
  XAI_API_KEY: KEYS.xai, GROQ_API_KEY: KEYS.groq, OPENROUTER_API_KEY: "sk-or-fakefakefakefakefake",
});
for (const k of ["GEMINI_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PERPLEXITY_API_KEY"]) process.env[k] = "";
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(process.env.CC_DATA_DIR)));
const FB = await import("../server/fallback.js");
const FF = await import("../server/free-first.js");
const SC = await import("../server/send-check.js");
const R = await import("../server/router.js");

const ask = [{ role: "user", content: "Say hello to my customers." }];
async function run(provider, model) {
  const seen = []; let text = "";
  for await (const ev of FB.fallbackChat({ provider, model, messages: ask, maxTokens: 300 }, { allowEmpty: false })) { seen.push(ev); if (ev.type === "delta") text += ev.text; }
  return { text, events: seen, done: seen.find((e) => e.type === "done"), hops: seen.filter((e) => e.type === "fallback") };
}
const reset = () => { for (const k of Object.keys(m.behave)) m.behave[k] = "ok"; m.behave.openrouter = "ok"; for (const p of ["xai", "groq", "openrouter"]) FB.clearTrouble(p); FF.clearCreditCache(); };

test("unit: cost tiers, Free only default, cost words, summary string", () => {
  assert.equal(FF.costTier("groq", "openai/gpt-oss-120b"), 1);
  assert.equal(FF.costTier("xai", "grok-4.3"), 3);
  assert.equal(FF.costTier("plan-claude-code", "plan-claude-code"), 2);
  assert.equal(FF.isFreeModel("groq", "openai/gpt-oss-20b"), true);
  assert.equal(FF.isFreeModel("groq", "some-paid-model"), false);
  assert.equal(FF.summaryLine(3, 2), "3 ready, 2 out of credits");
  assert.equal(FF.summaryLine(2, 0), "2 ready");
  assert.equal(FF.costText({ provider: "groq", model: "openai/gpt-oss-120b", cost: 0, free: true }), "$0 (free: Groq)");
  assert.equal(FF.costText({ provider: "anthropic", model: "x", cost: 0.04 }), "$0.04 (Claude)");
  assert.match(FF.costText({ provider: "plan-claude-code", model: "x", cost: 0 }), /^\$0 \(your plan: Claude Code\)$/);
  assert.match(FF.whyHandoff({ provider: "xai", model: "g", standIn: { for: "google", reason: "out of credits or spending limit: HTTP 402" } }), /^Handed off from .*: out of credits or spending limit\.$/);
  assert.match(FF.whyHandoff({ provider: "groq", model: "openai/gpt-oss-120b" }), /Free first/);
  for (const t of [FF.FREE_ONLY_BLOCK, FF.freeOnlyView().line]) assert.doesNotMatch(t, /[–—]/);
  assert.equal(FB.DEFAULTS.freeTiers.groq.on, true);
});

test("unit: Free only is on by default only while no paid key is saved", () => {
  // this process has an xAI key (paid), so the automatic default is OFF; a saved choice wins
  assert.equal(FF.hasPaidKey(), true);
  assert.equal(FF.freeOnlyOn(), false);
  FB.saveFallbackSettings({ freeOnly: true });
  assert.equal(FF.freeOnlyOn(), true);
  FB.saveFallbackSettings({ freeOnly: "auto" });
  assert.equal(FF.freeOnlyOn(), false);
});

test("unit: estimates are calibrated upward for multi-step runs and learn the observed ratio", () => {
  const one = FF.calibratedEstimate(0.05, { qa: true, steps: 1 }), three = FF.calibratedEstimate(0.05, { qa: true, steps: 3 });
  assert.ok(three.value > one.value * 1.5, "more steps, safer multiplier");
  assert.ok(three.value / 0.05 >= 3.5, "dogfood ran 3 to 5 times low");
  FF.noteActual(0.05, 0.25); FF.noteActual(0.04, 0.2); FF.noteActual(0.06, 0.3);
  assert.equal(FF.calibration().observed, 5);
  assert.ok(FF.calibratedEstimate(0.05, { qa: false, steps: 1 }).factor >= 5);
});

test("unit: Auto picks Single, Mission or Council and says so in one plain line", () => {
  const pick = (p, o = {}) => SC.chooseMode(p, { coding: false, workers: 3, ...o });
  assert.equal(pick("Say hello to my customers.").mode, "single");
  assert.equal(pick("Write a function that parses CSV and add tests.", { coding: true }).mode, "mission");
  assert.equal(pick("Should I raise my prices or add a cheaper plan? What do you think?").mode, "council");
  assert.equal(pick("Plan the launch:\n1. a landing page\n2. three emails\n3. five posts").mode, "mission");
  assert.equal(pick("Write a function that parses CSV.", { coding: true, workers: 1 }).mode, "single", "one working AI stays Single");
  for (const p of ["Say hello", "Should I do this or that?"]) { const l = pick(p).line; assert.doesNotMatch(l, /[–—]/); assert.ok(l.split("\n").length === 1); assert.match(l, /^Auto picked/); }
});

test("in-process: the 3-hop limit stops the counted stand-ins, then the built-in free AI still answers (outside the limit)", async () => {
  reset();
  FB.saveFallbackSettings({ freeOnly: "auto", maxHops: 1, openrouterFirst: true });
  m.behave.xai = 402; m.behave.openrouter = 402;
  const before = m.seen.length;
  const r = await run("xai", "grok-4.3");
  assert.match(r.text, /Answer from/);
  assert.ok(r.hops.length >= 2, "xai, then OpenRouter (the one counted hop), then Groq free");
  const last = r.hops[r.hops.length - 1];
  assert.equal(last.to.provider, "groq");
  assert.equal(last.lastResort, true, "the free hop is a last resort");
  assert.equal(r.hops.filter((h) => !h.lastResort).length, 1, "only one counted hop with maxHops 1");
  assert.equal(r.done.provider, "groq");
  assert.ok(m.seen.slice(before).some((x) => x.prefix === "groq"));
  FB.saveFallbackSettings({ maxHops: 3 });
});

test("in-process: an empty answer from one AI is a failure and the next AI takes the job, never an empty Done", async () => {
  reset();
  FB.saveFallbackSettings({ freeOnly: "auto", openrouterFirst: false });
  m.behave.xai = "empty";
  const r = await run("xai", "grok-4.3");
  assert.match(r.text, /Answer from/);
  assert.ok(r.hops.length >= 1 && r.done.provider !== "xai");
  assert.equal(FB.badAnswer("I'm sorry, but I can't help with that.", { stop: "end" }), true);
  assert.equal(FB.badAnswer("Here is a long useful answer ".repeat(20), { stop: "length" }), false);
  assert.equal(FB.badAnswer("ok", { stop: "length" }), true);
});

test("in-process: Free only never calls a paid mock and says so plainly when nothing free is left", async () => {
  reset();
  FB.saveFallbackSettings({ freeOnly: true });
  const before = m.seen.length;
  const r = await run("xai", "grok-4.3");
  assert.equal(r.done.provider, "groq", "swapped to a free AI before anything was sent");
  assert.equal(r.hops[0].kind, "freeonly");
  assert.equal(m.seen.slice(before).filter((x) => x.prefix === "xai").length, 0, "the paid mock was never called");
  assert.ok(R.rank({ capability: "writing", difficulty: 2, mode: "balanced" }).every((x) => FF.isFreeModel(x.provider, x.model)), "the router lists only free AIs");
  // every free AI is out: a plain message, still no paid call
  FB.markTrouble("groq", "credits", "test", { quiet: true }); FB.markTrouble("openrouter", "credits", "test", { quiet: true });
  const b2 = m.seen.length;
  await assert.rejects(() => run("xai", "grok-4.3"), (e) => e.code === "free_only" && e.message === FF.FREE_ONLY_BLOCK);
  assert.equal(m.seen.slice(b2).filter((x) => x.prefix === "xai").length, 0);
  FB.saveFallbackSettings({ freeOnly: "auto" }); reset();
});

test("credit check: summary string counts ready and out of credits and names what replaces them", async () => {
  reset();
  const ais = [{ provider: "a", name: "AAA", model: "m1" }, { provider: "b", name: "BBB", model: "m2" }, { provider: "c", name: "CCC", model: "m3" }, { provider: "d", name: "DDD", model: "m4" }, { provider: "e", name: "EEE", model: "m5" }];
  FF.setLocalProbe(async () => ({ ok: false }));
  const c = await FF.creditCheck({ connected: ais, whyOut: (p) => (p === "d" || p === "e" ? { kind: "credits" } : null) });
  FF.setLocalProbe(null);
  assert.deepEqual(c.ready.map((r) => r.provider).sort(), ["a", "b", "c"]);
  assert.equal(c.summary, "3 ready, 2 out of credits");
  assert.deepEqual(c.out.map((o) => o.name), ["DDD", "EEE"]);
  assert.match(c.replace, /DDD and EEE are out, so Meldmind will use .* instead\./);
});

test("server: a live 402 marks the AI out everywhere: AI bar, send check summary, readers list; Auto picks each mode", async () => {
  reset();
  const s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`,
    CC_SUBCLI_HOME: process.env.CC_SUBCLI_HOME, CC_SUBCLI_NO_PATH: "1", CC_OLLAMA_URL: `${m.base}/ollama`, CC_LMSTUDIO_URL: "http://127.0.0.1:9",
    XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
  } });
  try {
    for (const pid of ["xai", "groq"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green");
    await s.api("/fallback/settings", { method: "POST", body: { freeTiers: { google: { on: false }, openrouter: { on: false }, groq: { on: false } } } });
    const send = async (prompt, explicit = false) => (await s.api("/send-check", { method: "POST", body: { prompt, explicit } })).json;
    // Auto chooses each mode
    assert.equal((await send("Say hello to my customers.")).autoMode, "single");
    assert.equal((await send("Write a TypeScript function that parses a CSV file, add unit tests, and fix the failing build script in this repository.")).autoMode, "mission");
    const judg = await send("Should I raise my prices or add a cheaper plan? What do you think?");
    assert.equal(judg.autoMode, "council"); assert.match(judg.autoLine, /^Auto picked Council/);
    assert.equal((await send("Should I raise my prices or add a cheaper plan?", true)).autoMode, "single", "a chosen Single stays Single");
    const ok = await send("Say hello.");
    assert.equal(ok.summary, "3 ready", "xAI, Groq and the Ollama found on this PC"); assert.equal(ok.banner, null);
    // xai runs out on a live call
    m.behave.xai = 402;
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a tagline.", provider: "xai", model: "grok-4.3" } })).status, 202);
    const end = Date.now() + waitBudget(30000);
    for (;;) { const f = (await s.api("/fallback")).json; if (f.skipped.some((x) => x.provider === "xai")) break; assert.ok(Date.now() < end, "xai remembered as out"); await new Promise((r) => setTimeout(r, 250)); }
    const chk = await send("Say hello.");
    assert.equal(chk.summary, "2 ready, 1 out of credits");
    assert.equal(chk.banner.summary, "2 ready, 1 out of credits");
    assert.equal(chk.banner.fix.freeAis, true);
    const st = (await s.api("/state")).json;
    const xai = st.providers.find((p) => p.id === "xai");
    assert.equal(xai.status.status, "amber"); assert.match(xai.status.detail, /out of credits/i); assert.equal(xai.status.balance, undefined, "no balance shown while calls say no credits");
    const rd = (await s.api("/desk/readers", { method: "POST", body: { mode: "council", prompt: "Should I do this or that?" } })).json;
    assert.ok(!rd.readers.some((r) => r.id === "xai"), "the AI that is out is not a reader");
    assert.deepEqual(rd.out.filter((o) => o.id === "xai").map((o) => o.tag), ["out of credits"]);
    // Free only: state carries the switch; saving it is remembered
    assert.equal(st.freeOnly.on, false);
    await s.api("/fallback/settings", { method: "POST", body: { freeOnly: true } });
    assert.equal((await s.api("/state")).json.freeOnly.on, true);
    // the Get free AIs card data: key pages, local AI found by the port probe, Grok Bot status
    const fa = (await s.api("/free-ais?force=1")).json;
    for (const id of ["groq", "google", "openrouter", "github", "cloudflare", "mistral", "ollama", "lmstudio"]) assert.ok(fa.pages.some((p) => p.id === id), id);
    assert.match(fa.pages.find((p) => p.id === "groq").url, /^https:\/\/console\.groq\.com\/keys$/);
    assert.equal(fa.pages.find((p) => p.id === "ollama").connected, true, "Ollama found by the probe");
    assert.equal(fa.pages.find((p) => p.id === "lmstudio").connected, false, "LM Studio skipped silently when nothing answers");
    assert.ok("ready" in fa.grokbot);
    assert.doesNotMatch(JSON.stringify(fa), new RegExp(KEYS.groq), "no key value in the card data");
    const prov = (await s.api("/state")).json.providers.find((p) => p.noKey && p.custom && /Ollama/.test(p.name));
    assert.ok(prov, "Ollama was added as a free, no-key AI without typing");
  } finally { await s.close?.(); }
});

test.after(async () => { await m.close(); });
