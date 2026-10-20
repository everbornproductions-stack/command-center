// Pause unpaid AIs, auth labels, Free/Paid, and upgrade tips. No real key or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-access-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { PROVIDERS } = await import("../server/registry.js");
const { AUTH_TYPES, accessFor } = await import("../server/provider-access.js");
const { isCreditStatus, describePause, RECHECK_MS, PAUSE_LABEL } = await import("../server/pause.js");
const { planInfo, setPlan, applyPreferFree, QUALITY_CLOSE, SCORE_CLOSE } = await import("../server/plans.js");
const { chooseTip, TIP_MARGIN, TIP_WINDOW_MS } = await import("../server/tips.js");
const { rank } = await import("../server/router.js");

test("every provider has a real auth type, and the labels match how it connects", () => {
  for (const p of Object.values(PROVIDERS)) assert.ok(AUTH_TYPES.includes(p.auth), `${p.id} auth`);
  for (const id of ["anthropic", "openai", "xai", "google", "perplexity", "openrouter", "deepseek", "groq", "mistral", "kling", "syncso", "elevenlabs", "replicate", "fal", "hedra"]) {
    assert.equal(PROVIDERS[id].auth, "key", id);
  }
  assert.equal(PROVIDERS.capcut.auth, "mcp");
  assert.equal(PROVIDERS.capcut.mcpUrl, "https://www.capcut.com/api/external_mcp");
  assert.equal(PROVIDERS.capcut.mcpOauth, true);
  assert.equal(PROVIDERS.suno.auth, "handoff");
  assert.equal(PROVIDERS.flow.auth, "handoff");
  assert.equal(PROVIDERS.cursor.auth, "local");
  assert.equal(PROVIDERS.hedra.api, null);
  assert.equal(PROVIDERS.hedra.keyEnv, "HEDRA_API_KEY");
  const cap = accessFor(PROVIDERS.capcut);
  assert.equal(cap.label, "Not connected");
  assert.equal(cap.connect, true);
  assert.notEqual(cap.label, "No key");
  assert.equal(accessFor(PROVIDERS.suno).label, "Handoff");
  assert.equal(accessFor(PROVIDERS.flow).label, "Handoff");
  assert.equal(accessFor(PROVIDERS.cursor).label, "Local app");
  const hedra = accessFor(PROVIDERS.hedra);
  assert.equal(hedra.label, "No key");
  assert.equal(hedra.auth, "key");
});

test("credit and rate lights pause; a rejected key, an incident, and a low balance do not", () => {
  assert.equal(isCreditStatus("amber", "Out of credits or spending limit reached"), true);
  assert.equal(isCreditStatus("amber", "rate limited"), true);
  assert.equal(isCreditStatus("red", "payment required: no credits"), true);
  assert.equal(isCreditStatus("red", "Key rejected (401)"), false);
  assert.equal(isCreditStatus("amber", "minor incident: elevated errors"), false);
  assert.equal(isCreditStatus("amber", "slow (30s)"), false);
  assert.equal(isCreditStatus("amber", "low balance"), false);
  assert.equal(RECHECK_MS, 15 * 60 * 1000);
  assert.equal(PAUSE_LABEL, "Paused: no credits");
});

test("a paused provider drops out of auto-picks while another model has a key", () => {
  const c = store.ctx();
  c.secrets.anthropic = { key: "sk-ant-test-not-real" };
  c.secrets.groq = { key: "gsk_test-not-real" };
  c.docs.settings = { uiMode: "expert", preferFree: false };
  c.health.anthropic = { status: "amber", detail: "Out of credits or spending limit reached", checkedAt: Date.now() };
  c.health.groq = { status: "green", detail: "ok", checkedAt: Date.now() };
  const info = describePause("anthropic");
  assert.ok(info);
  assert.match(info.message, /Claude is paused: no credits/);
  assert.match(info.message, /https:\/\/platform\.claude\.com\/settings\/billing/);
  const ranked = rank({ capability: "writing", difficulty: 2, mode: "balanced" });
  assert.ok(ranked.length);
  assert.ok(!ranked.some((m) => m.provider === "anthropic"));
  assert.ok(ranked.some((m) => m.provider === "groq"));
  c.health.anthropic = { status: "green", detail: "ok", checkedAt: Date.now() };
  assert.equal(describePause("anthropic"), null);
  const back = rank({ capability: "writing", difficulty: 2, mode: "balanced" });
  assert.ok(back.some((m) => m.provider === "anthropic"));
});

test("free is preferred only on a near tie, and a saved plan wins over the guess", () => {
  assert.equal(planInfo("google").plan, "free");
  assert.equal(planInfo("google").source, "guess");
  assert.equal(planInfo("groq").plan, "free");
  assert.equal(setPlan("google", "paid").plan, "paid");
  assert.equal(planInfo("google").source, "you");
  assert.equal(setPlan("google", "unknown").plan, "unknown");
  const far = applyPreferFree([
    { provider: "anthropic", plan: "paid", quality: 90, score: 80 },
    { provider: "groq", plan: "free", quality: 70, score: 60 },
  ], true);
  assert.equal(far[0].provider, "anthropic");
  const pair = [
    { provider: "anthropic", plan: "paid", quality: 80, score: 70 },
    { provider: "groq", plan: "free", quality: 80 - QUALITY_CLOSE, score: 70 - SCORE_CLOSE },
  ];
  const close = applyPreferFree(pair, true);
  assert.equal(close[0].provider, "groq");
  assert.equal(close[0].preferFree, true);
  assert.equal(applyPreferFree(pair, false)[0].provider, "anthropic");
});

test("an upgrade tip needs a clear gap, stays quiet for 7 days, and stores no prompt", () => {
  const candidates = [{ provider: "anthropic", name: "Claude", why: "credits", quality: 90, billing: "https://platform.claude.com/settings/billing", keys: "https://platform.claude.com/settings/keys" }];
  const tip = chooseTip({ capability: "writing", usedProvider: "groq", usedQuality: 70, candidates, enabled: true });
  assert.ok(tip);
  assert.match(tip.text, /Add credits to use it/);
  assert.equal(tip.href, candidates[0].billing);
  assert.equal(chooseTip({ capability: "writing", usedProvider: "groq", usedQuality: 80, candidates, margin: TIP_MARGIN }), null);
  assert.equal(chooseTip({ capability: "writing", usedProvider: "groq", usedQuality: 70, candidates, enabled: false }), null);
  const again = chooseTip({ capability: "writing", usedProvider: "groq", usedQuality: 70, candidates, last: { "anthropic|writing": Date.now() }, windowMs: TIP_WINDOW_MS });
  assert.equal(again, null);
  assert.equal(JSON.stringify(tip).includes("sk-"), false);
});

test("server: CapCut is Not connected, and a failed sign-in shows the US note", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" } });
  try {
    const st = (await s.api("/state")).json;
    const cap = st.providers.find((p) => p.id === "capcut");
    assert.equal(cap.access.auth, "mcp");
    assert.equal(cap.access.label, "Not connected");
    assert.notEqual(cap.access.label, "No key");
    assert.equal(st.providers.find((p) => p.id === "suno").access.label, "Handoff");
    assert.equal(st.providers.find((p) => p.id === "cursor").access.label, "Local app");
    assert.equal(st.providers.find((p) => p.id === "hedra").access.label, "No key");
    const r = await s.api("/connect/mcp", { method: "POST", body: { provider: "capcut", url: "http://127.0.0.1:9/mcp" } });
    assert.equal(r.status, 200);
    assert.equal(r.json.quiet, true);
    assert.match(r.json.error, /US access coming soon/);
    assert.equal(JSON.stringify(r.json).includes("ECONNREFUSED"), false);
    assert.equal(s.log.includes("ECONNREFUSED"), false);
    const plan = await s.api("/access/plan", { method: "POST", body: { provider: "groq", plan: "paid" } });
    assert.equal(plan.json.plan, "paid");
    assert.equal(plan.json.source, "you");
  } finally { await s.stop(); }
});
