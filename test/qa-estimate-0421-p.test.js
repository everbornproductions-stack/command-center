// 0.4.21 P-qaest (dogfood 11, 12): QA runs when QA is on, and the estimate covers every call of a run.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, waitBudget, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-qaest-");
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(process.env.CC_DATA_DIR)));
const { overheadCost, canTakeWork, liveFirst } = await import("../server/precost.js");
const { calibratedEstimate } = await import("../server/free-first.js");
const { estimateCost } = await import("../server/registry.js");
const { noteCall, markRecovered } = await import("../server/health.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };

test("unit: a 1-task estimate includes planner, assembly and QA and lands within 2x of a simulated real cost", () => {
  const row = { model: "claude-sonnet-5-5" }, cheap = { model: "claude-haiku-5-5" };
  const work = estimateCost(row.model, 1500, 800);
  const o = overheadCost({ steps: 1, qa: true, classifier: cheap, planner: row, assembler: row, reviewers: [cheap] });
  assert.ok(o.classify > 0 && o.plan > 0 && o.assemble > 0 && o.qa > 0, JSON.stringify(o));
  assert.equal(overheadCost({ steps: 1, qa: false, classifier: cheap, planner: row, assembler: row }).qa, 0);
  const est = calibratedEstimate(work, { qa: true, steps: 1, overhead: o.total }).value;
  // simulated real run: classify + plan + work + assemble + QA at realistic token counts
  const real = estimateCost(cheap.model, 400, 100) + estimateCost(row.model, 1000, 900) + work + estimateCost(row.model, 1800, 1000) + estimateCost(cheap.model, 1000, 150);
  assert.ok(est >= real / 2 && est <= real * 2, `estimate ${est} vs real ${real}`);
  const old = calibratedEstimate(work, { qa: true, steps: 1 }).value;
  assert.ok(est > old, "the old estimate left the planner and assembler out");
});

test("unit: free calls cost nothing and a dead AI is left out in favor of the stand-in", () => {
  assert.equal(overheadCost({ steps: 2, qa: true, classifier: { model: "x", free: true }, planner: { model: "x", free: true }, assembler: { model: "x", free: true }, reviewers: [{ model: "x", free: true }] }).total, 0);
  const dead = { provider: "groq" }, alive = { provider: "anthropic" };
  noteCall("groq", false, 10, 402, { message: "You have no credits left" });
  try {
    assert.equal(canTakeWork(dead), false);
    assert.equal(canTakeWork(alive), true);
    assert.deepEqual(liveFirst([dead, alive]).map((x) => x.provider), ["anthropic"]);
    assert.deepEqual(liveFirst([dead]).map((x) => x.provider), ["groq"], "if nothing else is left the list is kept");
  } finally { markRecovered("groq"); }
});

test("unit: the stand-in's price is what the estimate uses when the first choice is dead", () => {
  const first = { model: "claude-haiku-5-5" }, standIn = { model: "claude-opus-5-5" };
  const withFirst = overheadCost({ steps: 1, qa: true, classifier: first, planner: first, assembler: first, reviewers: [first] }).total;
  const withStandIn = overheadCost({ steps: 1, qa: true, classifier: first, planner: standIn, assembler: standIn, reviewers: [first] }).total;
  assert.ok(withStandIn > withFirst * 2, `${withStandIn} vs ${withFirst}`);
});

async function mocks() {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    seen.push(sys);
    let out = "Day 1: Everborn Productions turns a listing into a short video brokers can post the same day. ".repeat(3);
    if (/Reply with JSON only: \{"capability"/.test(sys)) out = `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    else if (/Break the goal into/.test(sys)) out = JSON.stringify({ title: "Plan", tasks: [{ id: "t1", title: "Do the job", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write a week plan for Everborn Productions.", deliverable: "The plan" }], assembly: "Use the single task output." });
    else if (/You QA another AI/.test(sys)) out = `{"pass":true,"score":8,"issues":[]}`;
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}

test("a 1-task mission with QA on shows a QA review on its step, and the estimate carries the extra calls", { timeout: 200000 }, async () => {
  const m = await mocks();
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "5000", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", PERPLEXITY_API_KEY: "" } });
  try {
    for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
    const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
    const posted = await s.api("/mission", { method: "POST", body: { goal: "Write a week plan for Everborn Productions.", mode: "economy", qa: true, budgetUsd: 2 } });
    assert.equal(posted.status, 202, posted.text);
    let run = null; const t0 = Date.now();
    while (Date.now() - t0 < waitBudget(90000) && !run) {
      const f = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && !before.has(x.id) && ["done", "done-with-errors", "failed"].includes(x.status));
      if (f) run = (await s.api(`/missions/${f.id}`)).json; else await sleep(250);
    }
    assert.ok(run, "mission finished");
    assert.equal(run.tasks.length, 1);
    const t = run.tasks[0];
    assert.ok(t.review, "the single step has a QA review");
    assert.ok(t.review.pass === true || t.review.unchecked === true, JSON.stringify(t.review));
    assert.ok(m.seen.some((x) => /You QA another AI/.test(x)), "a QA call was made");
    assert.ok(run.estimateFactor > 0 && typeof run.estimatedCost === "number");
  } finally { await s.stop(); await m.close(); }
});
