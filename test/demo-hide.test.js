// Pretend AIs (Nova, Atlas, Sage) hide once a real key is connected, including on the
// next launch, and they come back only when every real AI is removed. A real job is
// not routed to them while a real AI exists. The page is the engine port, not the
// pretend-AI port. No real key and no real URL: the provider mock is local.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { startServer } from "./helpers.js";

const GOOD_GEMINI = "AIzaFAKEfakeFAKEfakeFAKEfake0123456789";

function demoIds(list) {
  return (list || []).filter((p) => p.demo || String(p.id || p.provider || "").startsWith("demo-")).map((p) => p.id || p.provider);
}

async function startMock() {
  const srv = http.createServer((req, res) => {
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith("/gemini/v1beta/models") && req.headers["x-goog-api-key"] === GOOD_GEMINI) {
      return send(200, { models: [{ name: "models/gemini-4-argon" }] });
    }
    send(400, { error: { message: "API key not valid" } });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => srv.close(r)) };
}

function stopKeepDir(s) {
  const child = s.child;
  return new Promise((resolve) => {
    const finish = () => resolve();
    const t = setTimeout(finish, 5000);
    child.once("exit", () => { clearTimeout(t); finish(); });
    if (child.exitCode !== null) return finish();
    if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true });
    else { try { child.kill("SIGTERM"); } catch {} }
  });
}

test("demo AIs hide when a real key is connected, stay hidden after restart, and return when it is removed", async () => {
  const mock = await startMock();
  const env = { CC_BASE_URL_GOOGLE: `${mock.url}/gemini/v1beta/openai`, CC_STATUS_PAGES: "off", GEMINI_API_KEY: "" };
  const s = await startServer({ env });
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    let st = (await s.api("/state")).json;
    assert.equal(st.demo, true);
    assert.ok(demoIds(st.providers).includes("demo-nova"));
    const modelsOn = (await s.api("/models")).json;
    assert.ok(modelsOn.some((m) => String(m.provider).startsWith("demo-")));
    const routeOn = (await s.api("/route?prompt=Write%20a%20two-line%20welcome")).json;
    assert.ok(routeOn.ranked.some((m) => String(m.provider).startsWith("demo-")));

    const saved = await s.api("/keys", { method: "POST", body: { provider: "google", key: GOOD_GEMINI } });
    assert.equal(saved.json.demoRetired, true);
    st = (await s.api("/state")).json;
    assert.equal(st.demo, false);
    assert.deepEqual(demoIds(st.providers), []);
    const modelsOff = (await s.api("/models")).json;
    assert.equal(modelsOff.some((m) => String(m.provider).startsWith("demo-")), false);
    const compare = (await s.api("/compare/models")).json;
    assert.equal((compare.models || []).some((m) => m.demo || String(m.provider).startsWith("demo-")), false);
    const routeOff = (await s.api("/route?prompt=Write%20a%20two-line%20welcome")).json;
    assert.equal(routeOff.ranked.some((m) => String(m.provider).startsWith("demo-")), false, "a real job is not sent to a demo AI");
    assert.ok(routeOff.ranked.some((m) => m.provider === "google"));

    const tools = (await s.api("/tools")).json;
    assert.equal((tools.providers || []).some((p) => String(p.id).startsWith("demo-")), false, "the tools picker hides demo AIs");
    const pictures = (await s.api("/images/providers")).json;
    assert.equal((pictures.items || []).some((p) => p.demo || String(p.id).startsWith("demo-")), false, "the image picker hides the demo provider");

    const cmp = await s.api("/compare", { method: "POST", body: { prompt: "Name a colour.", columns: [{ provider: "demo-nova", model: "nova-lite" }, { provider: "demo-atlas", model: "atlas-pro" }] } });
    assert.equal(cmp.status, 400, "a hidden demo AI is not a column that can run");
    assert.match(cmp.json.error, /demo-nova/);

    const posted = await s.api("/chat", { method: "POST", body: { prompt: "Say hi in three words.", provider: "demo-nova", model: "nova-lite" } });
    assert.equal(posted.status, 202);
    let chat = null;
    for (let i = 0; i < 50 && !chat; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const list = (await s.api("/missions")).json;
      const row = (list || []).find((m) => String(m.title || "").includes("Say hi"));
      if (row) chat = (await s.api(`/missions/${row.id}`)).json;
    }
    assert.ok(chat, "the chat that named a demo AI was recorded");
    assert.equal(String(chat.provider).startsWith("demo-"), false, "that chat was not sent to the demo AI");
    assert.equal(chat.provider, "google");

    await s.api("/council", { method: "POST", body: { prompt: "Name one colour.", members: [{ provider: "demo-nova", model: "nova-lite" }, { provider: "demo-atlas", model: "atlas-pro" }], chair: { provider: "demo-sage", model: "sage-mini" } } });
    let convened = "";
    for (let i = 0; i < 40 && !convened; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const recent = (await s.api("/state")).json.recent || [];
      convened = recent.map((e) => e.text || "").find((t) => t.startsWith("Council convened")) || "";
    }
    assert.match(convened, /Google Gemini/, "the council sat a real AI");
    assert.doesNotMatch(convened, /Nova|Atlas|Sage/, "the council was not seated with demo AIs");

    // The window is the engine. The log must not claim the pretend-AI port is the app.
    assert.match(s.log, /Meldmind/);
    assert.doesNotMatch(s.log, /server ready on \d+ \(demo /);

    await s.api("/keys/google", { method: "DELETE" });
    st = (await s.api("/state")).json;
    assert.equal(st.demo, true, "demo AIs come back when every real AI is removed");
    assert.ok(demoIds(st.providers).includes("demo-nova"));

    await s.api("/keys", { method: "POST", body: { provider: "google", key: GOOD_GEMINI } });
    st = (await s.api("/state")).json;
    assert.equal(st.demo, false);

    // Turning demo back on is allowed, and it stays, but routing still skips the pretend AIs.
    const back = await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal(back.json.demo, true);
    st = (await s.api("/state")).json;
    assert.ok(demoIds(st.providers).includes("demo-nova"));
    const routeKeep = (await s.api("/route?prompt=Write%20a%20two-line%20welcome")).json;
    assert.equal(routeKeep.ranked.some((m) => String(m.provider).startsWith("demo-")), false);
    const kept = await s.api("/compare", { method: "POST", body: { prompt: "Name a colour.", columns: [{ provider: "demo-nova", model: "nova-lite" }, { provider: "demo-atlas", model: "atlas-pro" }] } });
    assert.equal(kept.status, 202, JSON.stringify(kept.json));
    assert.ok(kept.json.columns.every((c) => c.status === "skipped" && String(c.provider).startsWith("demo-")), "demo mode on still does not call a demo AI");

    // A relaunch with the key still saved must not bring the pretend server back just because demo was left on.
    await s.api("/settings", { method: "POST", body: { demo: true, demoKeep: false } });
    await stopKeepDir(s);
    await s.stub.close();
    const s2 = await startServer({ dataDir: s.dir, env });
    try {
      const again = (await s2.api("/state")).json;
      assert.equal(again.demo, false, "a saved real key hides demo AIs before the window opens");
      assert.deepEqual(demoIds(again.providers), []);
      assert.doesNotMatch(s2.log, /pretend AIs listening/);
    } finally { await s2.stop(); }
  } finally { await s.stop().catch(() => {}); await mock.close(); }
});
