// A Single run uses the Command bar priority when the person picked one, and the saved
// Default priority when they did not. Local mock only. No real key or URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT, chatRunId } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("the Command bar sends its priority on a Single run only after a click", () => {
  const app = read("web", "app.js");
  const server = read("server", "index.js");
  assert.match(app, /const picked = !simple && S\.costMode \? \{ mode: S\.costMode \} : \{\}/);
  assert.match(app, /body: \{ prompt, projectId, \.\.\.picked, \.\.\.packBody \}/);
  assert.match(server, /function chatPriority\(requested\)/);
  assert.match(server, /rank\(\{ \.\.\.cls, mode: priority \}\)/);
  assert.equal(app.includes("\u2014"), false);
});

function sse(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 8 } })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

async function mockOpenAI() {
  const srv = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock" }] }));
      return;
    }
    if (!url.pathname.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no route" }));
      return;
    }
    const j = JSON.parse(body || "{}");
    const sys = (j.messages || []).find((m) => m.role === "system")?.content || "";
    if (/Reply with JSON only/.test(sys)) return sse(res, '{"capability":"writing","difficulty":1,"needWeb":false,"summary":"note"}');
    sse(res, "Noted.");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise((r) => srv.close(r)) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitRun(s, id) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const hit = (await s.api("/state")).json.missions.find((m) => m.id === id && ["done", "failed", "done-with-errors"].includes(m.status));
    if (hit) return hit;
    await sleep(200);
  }
  throw new Error("timed out waiting for the single run\n" + s.log.slice(-800));
}

test("a Single run follows the picked priority and falls back to Default", async () => {
  const mock = await mockOpenAI();
  const s = await startServer({
    env: {
      CC_DEV_OWNER: "1",
      CC_STATUS_PAGES: "off",
      CC_BASE_URL_OPENAI: mock.base,
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      XAI_API_KEY: "",
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: "",
    },
  });
  const fake = "sk-test-not-a-real-key-0001";
  try {
    const saved = await s.api("/keys", { method: "POST", body: { provider: "openai", key: fake } });
    assert.equal(saved.json.status.status, "green");
    assert.equal((await s.api("/settings", { method: "POST", body: { defaultMode: "economy", preferFree: false, uiMode: "expert" } })).status, 200);

    let run = await waitRun(s, await chatRunId(s.api, { prompt: "Write a two-line welcome note." }));
    const fallback = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(fallback.model, "gpt-6-luna", "no Command bar choice uses the saved Default (economy)");

    run = await waitRun(s, await chatRunId(s.api, { prompt: "Write a two-line welcome note.", mode: "quality" }));
    const picked = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(picked.model, "gpt-6.1-sol", "Quality on the Command bar changes the Single pick");
    assert.notEqual(picked.model, fallback.model);

    run = await waitRun(s, await chatRunId(s.api, { prompt: "Write a two-line welcome note.", mode: "nope" }));
    const ignored = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(ignored.model, "gpt-6-luna", "an unknown priority falls back to Default");

    assert.ok(!s.log.includes(fake), "the key is not in the log");
  } finally {
    await s.stop();
    await mock.close();
  }
});
