// 0.4.21 dogfood finding 01: a coding job sent to AIs that are out of quota/credits ended "done" in 15 s with an
// empty deliverable. Pins: quota 429 is remembered like no credits; known-out AIs are skipped BEFORE sending;
// an empty answer is a failure with a plain message (never "done"); the send check names the AI and the one-click fix;
// Auto splits a coding job across several AIs while an explicit Single stays Single.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, tmpDir, waitBudget } from "./helpers.js";
import { KEYS, mocks } from "./send-check-mock.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-sendcheck-");
const FB = await import("../server/fallback.js");

test("unit: a 429 that says the quota is gone is remembered like no credits; a short 429 stays a rate limit", () => {
  const k = (status, message) => FB.troubleKind({ status, message });
  assert.equal(k(429, "Gemini: HTTP 429 RESOURCE_EXHAUSTED: You exceeded your current quota. limit: 0, free_tier_requests"), "credits");
  assert.equal(k(429, "Gemini: HTTP 429 Quota exceeded for this project"), "credits");
  assert.equal(k(429, "Grok: HTTP 429 Too many requests, try again in 20s"), "rate");
  assert.equal(k(429, "Gemini: HTTP 429 quota exceeded for requests per minute, retry in 12s"), "rate");
  assert.equal(k(402, "OpenRouter: HTTP 402 Insufficient credits"), "credits");
});

test("unit: nothingCameBack names each AI in plain words, once, with no dashes", () => {
  const t = FB.nothingCameBack([{ provider: "google", kind: "credits" }, { provider: "openrouter", kind: "credits" }, { provider: "google", kind: "credits" }]);
  assert.match(t, /^Nothing came back\./);
  assert.equal((t.match(/Google Gemini|Gemini/g) || []).length, 1);
  assert.match(t, /out of quota or credits/);
  assert.match(t, /Add credits in Settings/);
  assert.match(t, /Try again/);
  assert.doesNotMatch(t, /[–—]/);
  assert.match(FB.nothingCameBack([{ provider: "xai", kind: "empty" }]), /sent back nothing/);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function finished(s, id, ms = 60000) {
  const end = Date.now() + waitBudget(ms);
  while (Date.now() < end) {
    const st = (await s.api("/state")).json;
    const m = st.missions.find((x) => x.id === id && ["done", "done-with-errors", "failed"].includes(x.status));
    if (m) return (await s.api(`/missions/${id}`)).json;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${id}\n${s.log.slice(-800)}`);
}
async function chat(s, body) { const r = await s.api("/chat", { method: "POST", body }); assert.equal(r.status, 202); return r.json.runId; }

test("server: known-out AIs are skipped before sending, empty answers fail plainly, the send check names the fix, Auto splits coding", async () => {
  const m = await mocks();
  const s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
    CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`,
    XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
  } });
  try {
    for (const pid of ["xai", "groq"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
    await s.api("/fallback/settings", { method: "POST", body: { freeTiers: { google: { on: false }, openrouter: { on: false }, groq: { on: false } } } });
    const CODE = "Write a TypeScript function that parses a CSV file, add unit tests, and fix the failing build script in this repository.";

    // 1. both healthy: Auto splits a coding job, an explicit Single stays Single, plain chat stays single
    let chk = (await s.api("/send-check", { method: "POST", body: { prompt: CODE } })).json;
    assert.equal(chk.coding, true); assert.equal(chk.autoMode, "mission"); assert.equal(chk.banner, null); assert.equal(chk.working.length, 2);
    chk = (await s.api("/send-check", { method: "POST", body: { prompt: CODE, explicit: true } })).json;
    assert.equal(chk.autoMode, "single", "a person who chose Single keeps Single");
    chk = (await s.api("/send-check", { method: "POST", body: { prompt: "Write a friendly thank-you note to a customer." } })).json;
    assert.equal(chk.autoMode, "single", "not a coding job");

    // 2. Grok answers 429 no-quota: the job still finishes on Groq, Grok is remembered, and the next send skips it BEFORE calling
    m.behave.xai = "quota";
    let id = await chat(s, { prompt: "Write a tagline for a bakery.", provider: "xai", model: "grok-4.3", allowStandIn: true });
    let run = await finished(s, id);
    assert.equal(run.status, "done", run.error); assert.match(run.deliverable, /^Answer from /);
    const fb = (await s.api("/fallback")).json;
    assert.equal(fb.skipped.find((x) => x.provider === "xai")?.kind, "credits", "quota 429 remembered as out of credits");
    assert.ok(fb.skipped[0].leftMs > 10 * 60 * 1000, "with a real cool-down");
    m.behave.xai = "ok";
    const from = m.seen.length;
    id = await chat(s, { prompt: "Another tagline.", provider: "xai", model: "grok-4.3", allowStandIn: true });
    run = await finished(s, id);
    assert.equal(run.status, "done"); assert.equal(m.calls("xai", from).length, 0, "no call to an AI known to be out");

    // 3. the send check names the AI that is out and the one-click fix
    chk = (await s.api("/send-check", { method: "POST", body: { prompt: CODE } })).json;
    assert.ok(chk.banner, "banner shown at send time");
    assert.deepEqual(chk.banner.providers, ["xai"]);
    assert.match(chk.banner.title, /Grok is out of credits or quota/);
    assert.equal(chk.banner.fix.switchTo.provider, "groq");
    assert.equal(chk.autoMode, "single", "only one AI works, so nothing to split");
    assert.doesNotMatch(JSON.stringify(chk.banner), /[–—]/);

    // 4. everything returns empty: the run FAILS with a plain message, an empty deliverable is never "done", cost stays 0
    await s.api("/fallback/settings", { method: "POST", body: { openrouterFirst: false } });
    m.behave.xai = "ok"; m.behave.groq = "empty";
    // clear the Grok trouble so both are tried
    for (const p of ["xai"]) await s.api("/fallback/clear", { method: "POST", body: { provider: p } }).catch(() => {});
    m.behave.xai = "empty";
    id = await chat(s, { prompt: "Say hello.", provider: "groq", model: "openai/gpt-oss-120b", allowStandIn: true });
    run = await finished(s, id);
    assert.equal(run.status, "failed", "never done with nothing in it");
    assert.equal((run.deliverable || "").trim(), "");
    assert.match(run.error, /^Nothing came back\./);
    assert.match(run.error, /Try again/);
    assert.equal(run.cost, 0, "cost stays honest");
    assert.ok(run.needsAttention?.retry, "marked for attention with a retry");
    const led = (await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "call" && e.missionId === id);
    assert.equal(led.reduce((a, e) => a + (e.cost || 0), 0), 0);

    // 5. a council where every seat returns nothing fails with the same plain words
    const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
    const c = await s.api("/council", { method: "POST", body: { prompt: "Say hello.", qa: false } });
    assert.equal(c.status, 202);
    const end = Date.now() + waitBudget(60000); let council = null;
    while (Date.now() < end && !council) {
      council = (await s.api("/state")).json.missions.find((x) => x.kind === "council" && !before.has(x.id) && ["done", "failed", "done-with-errors"].includes(x.status));
      if (!council) await sleep(250);
    }
    assert.ok(council, "council settled");
    assert.equal(council.status, "failed");
  } finally { await s.stop?.(); await m.close(); }
});
