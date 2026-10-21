// Graduate notice. A handoff-only AI that gains its own API or MCP route asks once:
// "X can now run directly. Add it to councils and missions?" One click approves.
// Not now dismisses. Grok Bot's webhook stays. An xAI key is not a Grok Bot route.
// No real URL or key is used, and the saved webhook is never called.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-graduate-");
const G = await import("../server/graduate.js");

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("stepGraduate: baseline, gain, first sight of both, direct-only stays quiet", () => {
  const ask = "Grok Bot can now run directly. Add it to councils and missions?";
  let state = G.stepGraduate(null, [{ id: "grokbot", name: "Grok Bot", handoff: true, direct: false }]);
  assert.deepEqual(Object.values(state.pending), []);
  state = G.stepGraduate(state, [{ id: "grokbot", name: "Grok Bot", handoff: true, direct: true }]);
  assert.equal(state.pending.grokbot.text, ask);
  state = G.stepGraduate(state, [{ id: "grokbot", name: "Grok Bot", handoff: true, direct: true }]);
  assert.equal(state.pending.grokbot.text, ask, "the ask stays until approve or dismiss");

  let both = G.stepGraduate(null, [{ id: "suno", name: "Suno", handoff: true, direct: true }]);
  assert.equal(both.pending.suno.text, "Suno can now run directly. Add it to councils and missions?");

  let direct = G.stepGraduate(null, [{ id: "grokbot", name: "Grok Bot", handoff: false, direct: true }]);
  assert.deepEqual(Object.values(direct.pending), [], "direct-only, never a handoff");
  direct = G.stepGraduate(direct, [{ id: "grokbot", name: "Grok Bot", handoff: false, direct: true }]);
  assert.deepEqual(Object.values(direct.pending), []);

  let none = G.stepGraduate(null, [{ id: "grokbot", name: "Grok Bot", handoff: false, direct: false }]);
  none = G.stepGraduate(none, [{ id: "grokbot", name: "Grok Bot", handoff: false, direct: true }]);
  assert.deepEqual(Object.values(none.pending), [], "none then direct is not a handoff graduating");

  let swapped = G.stepGraduate(null, [{ id: "grokbot", name: "Grok Bot", handoff: true, direct: false }]);
  swapped = G.stepGraduate(swapped, [{ id: "grokbot", name: "Grok Bot", handoff: false, direct: true }]);
  assert.equal(swapped.pending.grokbot.text, ask);

  swapped.approved.grokbot = { at: 1, directOk: true, include: true };
  swapped = G.stepGraduate(swapped, [{ id: "grokbot", name: "Grok Bot", handoff: true, direct: true }]);
  assert.equal(swapped.pending.grokbot, undefined);

  let quiet = G.stepGraduate(null, [{ id: "suno", name: "Suno", handoff: true, direct: false }]);
  quiet = G.stepGraduate(quiet, [{ id: "suno", name: "Suno", handoff: true, direct: true }]);
  quiet.dismissed.suno = { at: 1 };
  delete quiet.pending.suno;
  quiet = G.stepGraduate(quiet, [{ id: "suno", name: "Suno", handoff: true, direct: true }]);
  assert.equal(quiet.pending.suno, undefined);
});

test("names: Grok Bot MCP matches, Grok the model does not; council ids are refused", () => {
  assert.equal(G.grokBotMcp([{ name: "Grok Bot" }]), true);
  assert.equal(G.grokBotMcp([{ name: "grokbot tools" }]), true);
  assert.equal(G.grokBotMcp([{ name: "Grok" }]), false);
  assert.equal(G.grokBotMcp([{ name: "xAI" }]), false);
  assert.equal(G.isRouteActor("grokbot"), true);
  assert.equal(G.isRouteActor("suno"), true);
  assert.equal(G.isRouteActor("flow"), true);
  for (const id of ["xai", "openai", "anthropic", "google"]) assert.equal(G.isRouteActor(id), false, id);
  const src = ["server/graduate.js", "server/plugins/graduate.js", "web/features/graduate.js", "web/app.js", "web/styles.css"].map(read).join("\n");
  assert.doesNotMatch(src, /—/);
  assert.match(read("web/features/index.js"), /"graduate"/);
  assert.match(read("web/app.js"), /id="graduate-slot"/);
  assert.match(read("web/features/graduate.js"), /Add it/);
  assert.match(read("web/features/graduate.js"), /Not now/);
  assert.match(read("server/graduate.js"), /can now run directly/);
  assert.doesNotMatch(read("server/grokbot.js"), /graduate/);
});

function models(res) {
  const body = JSON.stringify({ data: [{ id: "grok-4.3" }] });
  res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" });
  res.end(body);
}

test("server: webhook baseline, xAI key is quiet, api route asks, approve includes Grok Bot, dismiss hides Suno", async () => {
  const hits = [];
  const mock = http.createServer((req, res) => {
    hits.push(req.url);
    models(res);
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  const s = await startServer({ env: { CC_BASE_URL_XAI: `${base}/v1`, CC_STATUS_PAGES: "off", XAI_API_KEY: "" } });
  const SENDER = "gbk_test_sender_key_0123456789";
  const ask = (name) => `${name} can now run directly. Add it to councils and missions?`;
  try {
    assert.equal((await s.api("/graduate", { noToken: true })).status, 401);
    let g = await s.api("/graduate");
    assert.equal(g.status, 200);
    assert.deepEqual(g.json.notices, []);
    const saved = await s.api("/grokbot/config", { method: "POST", body: { url: "http://127.0.0.1:9/hook", key: SENDER, auto: false } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.via, "webhook");
    assert.equal(saved.json.auto, false);
    assert.ok(!saved.text.includes(SENDER));
    g = await s.api("/graduate");
    assert.deepEqual(g.json.notices, [], "webhook alone is the baseline");
    assert.equal(hits.length, 0, "saving the webhook does not call it");

    const keyed = await s.api("/keys", { method: "POST", body: { provider: "xai", key: "xai-fakefakefakefakefake" } });
    assert.equal(keyed.status, 200);
    g = await s.api("/graduate");
    assert.deepEqual(g.json.notices, [], "an xAI key does not graduate Grok Bot");
    assert.equal((await s.api("/graduate/route", { method: "POST", body: { id: "xai", via: "api" } })).status, 400);
    assert.equal((await s.api("/graduate/route", { method: "POST", body: { id: "openai", via: "mcp" } })).status, 400);
    assert.equal((await s.api("/graduate/route", { method: "POST", body: { id: "anthropic", via: "api" } })).status, 400);
    assert.equal((await s.api("/graduate/route", { method: "POST", body: { id: "google", via: "mcp" } })).status, 400);

    const suno = await s.api("/graduate/route", { method: "POST", body: { id: "suno", via: "mcp" } });
    assert.equal(suno.status, 200);
    assert.ok(suno.json.notices.some((n) => n.id === "suno" && n.text === ask("Suno")));
    const later = await s.api("/graduate/dismiss", { method: "POST", body: { id: "suno" } });
    assert.equal(later.status, 200);
    assert.ok(!later.json.notices.some((n) => n.id === "suno"));
    g = await s.api("/graduate");
    assert.ok(!g.json.notices.some((n) => n.id === "suno"), "Not now stays quiet");

    const routed = await s.api("/graduate/route", { method: "POST", body: { id: "grokbot", via: "api" } });
    assert.equal(routed.status, 200);
    const notice = routed.json.notices.find((n) => n.id === "grokbot");
    assert.equal(notice.text, ask("Grok Bot"));
    g = await s.api("/graduate");
    assert.equal(g.json.notices.find((n) => n.id === "grokbot").text, ask("Grok Bot"));

    const ok = await s.api("/graduate/approve", { method: "POST", body: { id: "grokbot" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.approved, true);
    assert.ok(!ok.json.notices.some((n) => n.id === "grokbot"));
    const cfg = (await s.api("/grokbot")).json.config;
    assert.equal(cfg.auto, true, "approve turns councils and missions on");
    assert.equal(cfg.via, "webhook", "the handoff stays a webhook");
    g = await s.api("/graduate");
    assert.ok(!g.json.notices.some((n) => n.id === "grokbot"));
    assert.deepEqual(hits, ["/v1/models"], "the only call is the local xAI key check, never the webhook");
    const st = (await s.api("/state")).json;
    assert.ok(st.plugins.includes("graduate"));
    assert.ok(!JSON.stringify(st).includes(SENDER));
    assert.ok(!JSON.stringify(g.json).includes(SENDER));
  } finally {
    await s.stop();
    await new Promise((r) => mock.close(r));
  }
});
