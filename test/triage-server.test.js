// Triage on the running server: a chat that names a provider but no model stays inside that provider and
// carries a triage object back; a provider with nothing ready falls through and the triage says so; the
// route preview returns the same triage. Local mock providers only. No real URL or key is ever used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, waitBudget, chatRunId, runSettled } from "./helpers.js";

const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
const CLASSIFIED = { capability: "writing", difficulty: 2, gates: { ambiguous: false, large: false, execution: true, stakes: false }, needWeb: false, summary: "mock triage", reason: "clear single-file task" };

async function mocks() {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: `mock: no route ${url.pathname}` });
    const j = JSON.parse(body || "{}");
    const sys = (j.messages || []).find((m) => m.role === "system")?.content || "";
    seen.push({ prefix, model: j.model, classify: /Reply with JSON only: \{"capability"/.test(sys) });
    const text = /Reply with JSON only: \{"capability"/.test(sys) ? JSON.stringify(CLASSIFIED) : `Answer from ${j.model}.`;
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: text } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 10 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(s, pred, label, ms = 60000) {
  const budget = waitBudget(ms);
  const t0 = Date.now();
  while (Date.now() - t0 < budget) {
    try { const hit = pred((await s.api("/state")).json); if (hit) return hit; } catch { /* poll again */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}\n--- server log tail ---\n${s.log.slice(-800)}`);
}

test("server: provider-only pin stays inside the provider and returns triage; nothing ready falls through and says so; /route has triage", async () => {
  const m = await mocks();
  const s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
    CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`,
    XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
  } });
  try {
    for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
    const models = (await s.api("/models")).json;
    const of = (pid) => new Set(models.filter((x) => x.provider === pid).map((x) => x.model));

    // 1. each keyed provider, named without a model, answers with one of its own models
    for (const pid of ["xai", "mistral", "groq"]) {
      const id = await chatRunId(s.api, { prompt: "Add a dark mode toggle to settings.js", provider: pid, allowStandIn: true });
      const run = await waitFor(s, runSettled(id), `chat pinned to ${pid}`);
      const full = (await s.api(`/missions/${run.id}`)).json;
      assert.equal(full.status, "done", full.error);
      assert.equal(full.provider, pid, `stayed inside ${pid}`);
      assert.ok(of(pid).has(full.model), `${full.model} is one of ${pid}'s models`);
      assert.ok(full.triage, "the run carries a triage object");
      assert.equal(full.triage.difficulty, 2);
      assert.equal(full.triage.tier, "standard");
      assert.equal(full.triage.capability, "writing");
      assert.equal(full.triage.summary, "mock triage");
      assert.equal(full.triage.reason, "clear single-file task");
      assert.deepEqual(full.triage.gates, CLASSIFIED.gates);
      assert.doesNotMatch(JSON.stringify(full.triage), /—/);
    }

    // 2. a provider with no key: the normal ranking picks, and the triage reason says so
    const id = await chatRunId(s.api, { prompt: "Add a dark mode toggle to settings.js", provider: "anthropic", allowStandIn: true });
    const run = await waitFor(s, runSettled(id), "chat pinned to a provider with no key");
    const full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done", full.error);
    assert.notEqual(full.provider, "anthropic");
    assert.match(full.triage.reason, /had no model ready, so another AI took it/);

    // 3. a pinned provider and model still pins both, and gets a triage from the local heuristic
    const pinned = await chatRunId(s.api, { prompt: "Rename the variable `cnt` to `count` in utils.js", provider: "mistral", model: [...of("mistral")][0] });
    const pr = (await s.api(`/missions/${(await waitFor(s, runSettled(pinned), "pinned chat")).id}`)).json;
    assert.equal(pr.provider, "mistral");
    assert.equal(pr.triage.source, "heuristic");
    assert.equal(pr.triage.tier, "trivial");

    // 4. the route preview returns the same triage shape
    const route = (await s.api(`/route?prompt=${encodeURIComponent("Add a dark mode toggle to settings.js")}`)).json;
    assert.deepEqual(Object.keys(route.triage).sort(), ["capability", "difficulty", "gates", "reason", "source", "summary", "tier"]);
    assert.equal(route.triage.tier, "standard");
  } finally {
    await s.stop();
    await m.close();
  }
});
