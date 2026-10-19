// Phase 2: spend caps and alerts (R10). The running server in a temp data dir, demo AIs only (local mock,
// no real key or URL): amber at 80% and stop at 100% each raise one in-app alert, the router leaves a capped
// AI out, a pinned chat to it is answered by a stand-in, and with no stand-in it is never called at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

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
  const s = await startServer();
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const first = await chat(s, { prompt: "Write a two-line tagline for a bakery.", provider: "demo-nova", model: "nova-lite" });
    assert.equal(first.status, "done", first.error);
    const spend = (await s.api("/state")).json.ledger.byProvider["demo-nova"].month;
    assert.ok(spend > 0, "the chat cost something");

    // 90% of the cap: amber, one alert
    let st = (await s.api("/alerts/caps", { method: "POST", body: { caps: { "demo-nova": spend / 0.9 } } })).json;
    assert.equal(st.perProvider["demo-nova"].level, "amber");
    assert.ok(!st.stop.includes("demo-nova"), "amber keeps working");
    st = (await s.api("/alerts/state")).json;
    assert.ok(st.fired[`cap80:demo-nova:${month()}`], "the 80% alert fired");

    // over the cap: stop, one alert
    st = (await s.api("/alerts/caps", { method: "POST", body: { caps: { "demo-nova": spend / 2 } } })).json;
    assert.equal(st.perProvider["demo-nova"].level, "stop");
    assert.ok(st.stop.includes("demo-nova"));
    st = (await s.api("/alerts/state")).json;
    assert.ok(st.fired[`cap100:demo-nova:${month()}`], "the 100% alert fired");

    // the router sends it no new work while another AI is available
    const route = (await s.api(`/route?prompt=${encodeURIComponent("Summarize this paragraph in one line.")}`)).json;
    assert.ok(route.ranked.length > 0);
    assert.ok(!route.ranked.some((m) => m.provider === "demo-nova"), "a capped AI is left out of the ranking");

    // a chat pinned to it is answered by a stand-in and never reaches it
    const novaBefore = await callsOf(s, "demo-nova");
    const stood = await chat(s, { prompt: "Write a one-line greeting.", provider: "demo-nova", model: "nova-lite" });
    assert.equal(stood.status, "done", stood.error);
    assert.notEqual(stood.provider, "demo-nova", "another AI stood in");
    assert.equal(await callsOf(s, "demo-nova"), novaBefore, "no call went to the capped AI");

    // smart fallback off: no stand-in, so the chat stops with a clear note and still never calls it
    assert.equal((await s.api("/fallback/settings", { method: "POST", body: { on: false } })).status, 200);
    const stopped = await chat(s, { prompt: "Write a one-line greeting.", provider: "demo-nova", model: "nova-lite" });
    assert.equal(stopped.status, "failed");
    assert.match(stopped.error, /monthly spend cap/);
    assert.equal(await callsOf(s, "demo-nova"), novaBefore, "hard stop: still no call to the capped AI");

    // removing the cap lets it work again
    st = (await s.api("/alerts/caps", { method: "POST", body: { caps: {} } })).json;
    assert.deepEqual(st.stop, []);
    const back = await chat(s, { prompt: "Write a one-line greeting.", provider: "demo-nova", model: "nova-lite" });
    assert.equal(back.status, "done", back.error);
    assert.equal(back.provider, "demo-nova");
  } finally { await s.stop(); }
});
