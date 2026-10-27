// Phase 2: spend caps and alerts (R10). The running server in a temp data dir, priced AIs on a local mock (no real key or URL):
// amber at 80% and stop at 100% each raise one in-app alert, the router leaves a capped
// AI out, a pinned chat to it is answered by a stand-in, and with no stand-in it is never called at all.
// Practice AIs add $0 to the ledger (0.4.20), so the capped AI is a priced one (OpenAI) on a loopback mock;
// a second priced AI (xAI, same mock) is the stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startMockOpenAI } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const month = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

async function chat(s, body) {
  const before = new Set((await s.api("/missions")).json.map((m) => m.id));
  assert.equal((await s.api("/chat", { method: "POST", body })).status, 202);
  for (let i = 0; i < 240; i++) {
    const m = (await s.api("/missions")).json.find((x) => !before.has(x.id) && x.kind === "single" && ["done", "failed"].includes(x.status));
    if (m) return (await s.api(`/missions/${m.id}`)).json;
    await sleep(250);
  }
  throw new Error("chat did not finish");
}
const callsOf = async (s, pid) => (await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "call" && e.provider === pid).length;

test("spend caps: amber at 80%, stop at 100%, router excludes, hard stop with no stand-in", { timeout: 180000 }, async () => {
  const mock = await startMockOpenAI();
  const s = await startServer({ env: { CC_STATUS_PAGES: "off", CC_BASE_URL_OPENAI: mock.base, CC_BASE_URL_XAI: mock.base } });
  try {
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key: "sk-test-not-a-real-key-0001" } })).json.status.status, "green");
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: "xai-test-not-a-real-key-0001" } })).json.status.status, "green"); // the stand-in
    await s.api("/demo", { method: "POST", body: { on: true } });
    const first = await chat(s, { prompt: "Write a two-line tagline for a bakery.", provider: "openai", model: "gpt-6-luna" });
    assert.equal(first.status, "done", first.error);
    const spend = (await s.api("/state")).json.ledger.byProvider["openai"].month;
    assert.ok(spend > 0, "the chat cost something");

    // 90% of the cap: amber, one alert
    let st = (await s.api("/alerts/caps", { method: "POST", body: { caps: { "openai": spend / 0.9 } } })).json;
    assert.equal(st.perProvider["openai"].level, "amber");
    assert.ok(!st.stop.includes("openai"), "amber keeps working");
    st = (await s.api("/alerts/state")).json;
    assert.ok(st.fired[`cap80:openai:${month()}`], "the 80% alert fired");

    // over the cap: stop, one alert
    st = (await s.api("/alerts/caps", { method: "POST", body: { caps: { "openai": spend / 2 } } })).json;
    assert.equal(st.perProvider["openai"].level, "stop");
    assert.ok(st.stop.includes("openai"));
    st = (await s.api("/alerts/state")).json;
    assert.ok(st.fired[`cap100:openai:${month()}`], "the 100% alert fired");

    // the router sends it no new work while another AI is available
    const route = (await s.api(`/route?prompt=${encodeURIComponent("Summarize this paragraph in one line.")}`)).json;
    assert.ok(route.ranked.length > 0);
    assert.ok(!route.ranked.some((m) => m.provider === "openai"), "a capped AI is left out of the ranking");

    // a chat pinned to it, with Let Meldmind choose on, is answered by a stand-in and never reaches it
    // (a pinned pick with Let Meldmind choose off stops with a plain message; see test/gemini-0421-q.test.js)
    const novaBefore = await callsOf(s, "openai");
    const stood = await chat(s, { prompt: "Write a one-line greeting.", provider: "openai", model: "gpt-6-luna", allowStandIn: true });
    assert.equal(stood.status, "done", stood.error);
    assert.notEqual(stood.provider, "openai", "another AI stood in");
    assert.equal(await callsOf(s, "openai"), novaBefore, "no call went to the capped AI");

    // smart fallback off: no stand-in, so the chat stops with a clear note and still never calls it
    assert.equal((await s.api("/fallback/settings", { method: "POST", body: { on: false } })).status, 200);
    const stopped = await chat(s, { prompt: "Write a one-line greeting.", provider: "openai", model: "gpt-6-luna" });
    assert.equal(stopped.status, "failed");
    assert.match(stopped.error, /monthly spend cap/);
    assert.equal(await callsOf(s, "openai"), novaBefore, "hard stop: still no call to the capped AI");

    // removing the cap lets it work again
    st = (await s.api("/alerts/caps", { method: "POST", body: { caps: {} } })).json;
    assert.deepEqual(st.stop, []);
    const back = await chat(s, { prompt: "Write a one-line greeting.", provider: "openai", model: "gpt-6-luna" });
    assert.equal(back.status, "done", back.error);
    assert.equal(back.provider, "openai");
  } finally { await s.stop(); await mock.close(); }
});
