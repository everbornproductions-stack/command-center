// Phase 24: live model pricing from the OpenRouter models API. A fixture list (test/fixtures/openrouter-models.json)
// served by a local mock stands in for OpenRouter; the same mock plays xAI so the router has a keyed model to
// price. Checks: matching (dots and dashes, -latest, Groq / variable routes / junk left alone), the router's
// costs, the ledger estimate and the savings receipt follow the live price, your own price wins, off means
// built-in, a failed refresh keeps the last good table. No real URL or key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-pricing-");
const LP = await import("../server/live-pricing.js");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "openrouter-models.json"), "utf8"));

test("parse and match: per-token strings become $ per 1M; ids match across dots, dashes and -latest; Groq and routers untouched", () => {
  const byNorm = LP.parseModels(FIXTURE);
  assert.equal(byNorm.size, 5, "variable (-1), missing and absurd prices are skipped");
  const m = LP.matchPrices(byNorm);
  assert.deepEqual(m["grok-4.3"], { in: 5, out: 20, orId: "x-ai/grok-4.3" });
  assert.deepEqual(m["claude-haiku-5-5"], { in: 0.2, out: 1, orId: "anthropic/claude-haiku-5.5" }, "a dot in the OpenRouter id matches a dash in ours");
  assert.equal(m["claude-sonnet-5-5"].in, 2.5);
  assert.equal(m["anthropic/claude-sonnet-5-5"].in, 2.5, "OpenRouter's own models match by id");
  assert.deepEqual(m["mistral-large-latest"], { in: 0.6, out: 1.8, orId: "mistralai/mistral-large" }, "-latest matches the plain name");
  assert.equal(m["openai/gpt-oss-120b"], undefined, "Groq's own price is not OpenRouter's");
  assert.equal(m["openrouter/auto"], undefined);
  assert.throws(() => LP.parseModels({ nope: true }), /not an OpenRouter models list/);
});

function sse(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 500 } })}\n\n`);
  res.write("data: [DONE]\n\n"); res.end();
}
async function mock() {
  const st = { feed: 200, feedHits: 0 };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/or/models") { st.feedHits++; return st.feed === 200 ? send(200, FIXTURE) : send(st.feed, { error: "down" }); }
    if (u.pathname === "/xai/v1/models") return send(200, { data: [{ id: "grok-4.3" }] });
    if (u.pathname === "/xai/v1/chat/completions") {
      const j = JSON.parse(body);
      const sys = j.messages.find((m) => m.role === "system")?.content || "";
      return sse(res, /Reply with JSON only/.test(sys) ? `{"capability":"writing","difficulty":2,"needWeb":false,"summary":"mock"}` : "A short answer.");
    }
    send(404, {});
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { st, base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_KEYS = { XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "" };

test("server: a pricing fixture updates the router's costs, the ledger and the receipt; your price wins; off and failures", { timeout: 90000 }, async () => {
  const m = await mock();
  const s = await startServer({ env: { ...NO_KEYS, CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_OPENROUTER_MODELS_URL: `${m.base}/or/models`, CC_BASE_URL_XAI: `${m.base}/xai/v1` } });
  const grok = async () => (await s.api("/models")).json.find((x) => x.model === "grok-4.3");
  const row = async (id) => (await s.api("/pricing/live")).json.rows.find((r) => r.model === id);
  try {
    assert.equal((await s.api("/pricing/live", { noToken: true })).status, 401);
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: "xai-fakefakefakefakefake" } })).json.status.status, "green");

    // the first check runs on its own a few seconds after start (once a day after that)
    let v; for (let i = 0; i < 60 && !(v?.fetchedAt); i++) { await sleep(200); v = (await s.api("/pricing/live")).json; }
    assert.ok(v.fetchedAt, "fetched on start"); assert.equal(v.error, null); assert.equal(v.on, true);
    assert.equal(v.listed, 5); assert.ok(v.matched >= 5);
    assert.equal(v.url, "a local test feed");
    const hits = m.st.feedHits;
    assert.equal((await s.api("/pricing/live")).json.fetchedAt, v.fetchedAt, "cached: reading the table does not fetch again");
    assert.equal(m.st.feedHits, hits);

    // router: the live price is what it ranks with
    let g = await grok();
    assert.equal(g.in, 5); assert.equal(g.out, 20);
    let r = (await s.api("/route?prompt=" + encodeURIComponent("Write a tagline for a bakery") + "&mode=balanced")).json;
    let rk = r.ranked.find((x) => x.model === "grok-4.3");
    assert.equal(rk.listCost, +((1500 * 5 + 800 * 20) / 1e6).toFixed(5), "router cost from the live price");
    const st = (await s.api("/state")).json;
    assert.equal(st.providers.find((p) => p.id === "xai").models.find((x) => x.id === "grok-4.3").priceSource, "live");
    assert.equal(st.providers.find((p) => p.id === "groq").models[0].priceSource, "built-in");

    // ledger estimate and receipt for one chat on grok-4.3 (1000 in, 500 out)
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "One line about rye bread.", provider: "xai", model: "grok-4.3" } })).status, 202);
    let run; for (let i = 0; i < 100 && !run; i++) { await sleep(150); run = (await s.api("/state")).json.missions.find((x) => x.kind === "single" && x.status === "done"); }
    assert.ok(run, "chat finished");
    const call = (await s.api("/state")).json.ledger.recent.find((e) => e.missionId === run.id && e.kind === "call");
    assert.equal(call.cost, +((1000 * 5 + 500 * 20) / 1e6).toFixed(6), "ledger estimate from the live price");
    const rc = (await s.api(`/receipt/${run.id}`)).json;
    assert.equal(rc.actual, 0.015);

    // your own price wins over the live one, everywhere
    assert.equal((await s.api("/pricing", { method: "POST", body: { model: "grok-4.3", in: 1, out: 2 } })).status, 200);
    g = await grok(); assert.equal(g.in, 1); assert.equal(g.out, 2);
    let pr = await row("grok-4.3");
    assert.equal(pr.source, "override"); assert.deepEqual(pr.live, { in: 5, out: 20, orId: "x-ai/grok-4.3" }); assert.deepEqual(pr.used, { in: 1, out: 2 });
    r = (await s.api("/route?prompt=" + encodeURIComponent("Write a tagline for a bakery"))).json;
    rk = r.ranked.find((x) => x.model === "grok-4.3");
    assert.equal(rk.listCost, +((1500 * 1 + 800 * 2) / 1e6).toFixed(5), "router uses your price");
    // a refresh never overwrites your price
    assert.equal((await s.api("/pricing/live/refresh", { method: "POST" })).status, 200);
    assert.equal((await grok()).in, 1);
    // drop it and the live price is back
    assert.equal((await s.api("/pricing/override/grok-4.3", { method: "DELETE" })).json.removed, true);
    assert.equal((await grok()).in, 5);
    assert.equal((await s.api("/pricing/override/no-such-model", { method: "DELETE" })).status, 404);

    // off: built-in prices
    assert.equal((await s.api("/pricing/live/settings", { method: "POST", body: { on: "yes" } })).status, 400);
    assert.equal((await s.api("/pricing/live/settings", { method: "POST", body: { on: false } })).json.on, false);
    g = await grok(); assert.equal(g.in, 1.25); assert.equal(g.out, 2.5);
    assert.equal((await row("grok-4.3")).source, "built-in");
    await s.api("/pricing/live/settings", { method: "POST", body: { on: true } });
    assert.equal((await grok()).in, 5);

    // OpenRouter down: a clear message, and the last good prices stay in use
    m.st.feed = 503;
    r = await s.api("/pricing/live/refresh", { method: "POST" });
    assert.equal(r.status, 502); assert.match(r.json.error, /^Could not reach OpenRouter: HTTP 503/);
    assert.equal((await grok()).in, 5, "last good table kept");

    // kept on disk for the next start (local mode), never with any key in it
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "pricing.live.json"), "utf8"));
    assert.equal(saved.prices["grok-4.3"].in, 5);
    assert.ok(!JSON.stringify(saved).includes("xai-fake"));
  } finally { await s.stop(); await m.close(); }
});

test("Phase 24 pricing files: no em-dashes in user-facing text", () => {
  for (const f of ["server/live-pricing.js", "server/plugins/pricing.js", "web/features/pricing.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
