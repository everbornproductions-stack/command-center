// 0.4.21 gap worker P (Dogfood 11 and 12). Local mocks only: no real key, no network, no spend.
//  1. the log and mission.planner name the AI that really planned (a stand-in included), the plan line
//     names the AIs that will really run each step, and "Who will read this" never names a dead planner.
//  2. no web search when the classifier says needWeb false and nobody asked for it, in the run and in the
//     "Who will read this" text.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { startServer, waitBudget, tmpDir, chatRunId, runSettled, newKindPred } from "./helpers.js";

const DIR = tmpDir("cc-plan-p-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
process.env.CC_STATUS_PAGES = "off";
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { PROVIDERS } = await import("../server/registry.js");
const H = await import("../server/health.js");
const { whoWillRead, searchWillRun } = await import("../server/readers.js");
const SEARCH = await import("../server/search.js");

const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000", tavily: "tvly-goodgoodgoodgoodgood" };
const OFF = { single: false, council: false, mission: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One mock for every provider, prefixed by path (/xai/v1, /groq/v1, /mistral/v1), plus a mock Tavily.
// The script may answer with { status, body } to make one call fail the way a real provider refuses.
async function mocks(script) {
  const seen = [];
  const counts = new Map();
  let tavilyHits = 0;
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (url.pathname === "/tavily/search") {
      tavilyHits++;
      return send(200, { results: [1, 2, 3].map((i) => ({ title: `page ${i}`, url: `https://tavily.example/p${i}`, content: `Snippet ${i}.`, score: 0.9 })) });
    }
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const users = j.messages.filter((m) => m.role === "user").map((m) => m.content);
    const user = users.join("\n");
    const last = users[users.length - 1] || "";
    const title = (/TASK: (.*)/.exec(user) || [])[1] || "";
    const key = `${sys.slice(0, 20)}|${title}`;
    const n = (counts.get(key) || 0) + 1; counts.set(key, n);
    seen.push({ prefix, sys, user, last, title, n });
    const out = script({ prefix, sys, user, last, title, n, counts });
    if (out && typeof out === "object" && out.status) return send(out.status, out.body || { error: { message: "mock refusal" } });
    let text = out, finish = "stop";
    if (out && typeof out === "object") ({ text, finish = "stop" } = out);
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: text } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)), hits: () => tavilyHits };
}

async function boot(m) {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "3000", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, CC_SEARCH_URL_TAVILY: `${m.base}/tavily`, XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", PERPLEXITY_API_KEY: "", BRAVE_SEARCH_API_KEY: "", SERPER_API_KEY: "" } });
  for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
  await s.api("/fallback/settings", { method: "POST", body: { on: true } }).catch(() => {});
  return s;
}

async function waitRun(s, pred, label, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < waitBudget(ms)) {
    const hit = pred((await s.api("/state")).json);
    if (hit) return (await s.api(`/missions/${hit.id}`)).json;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}\n` + s.log.slice(-600));
}

async function runMission(s, body, ms = 120000) {
  const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
  const posted = await s.api("/mission", { method: "POST", body });
  assert.equal(posted.status, 202, posted.text);
  const t0 = Date.now();
  while (Date.now() - t0 < waitBudget(ms)) {
    const m = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && !before.has(x.id) && ["done", "done-with-errors", "failed"].includes(x.status));
    if (m) return (await s.api(`/missions/${m.id}`)).json;
    await sleep(250);
  }
  throw new Error("mission did not finish\n" + s.log.slice(-600));
}

const GOAL = "Write a short note to our customers about our summer hours.";
const PLAN = JSON.stringify({
  title: "Summer hours note",
  tasks: [{ id: "t1", title: "Write the note", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write a short note to our customers about our summer hours.", deliverable: "a short note" }],
  assembly: "Hand over the note.",
});
const NOTE = "Our summer hours are Monday to Friday, 9 in the morning until 5 in the afternoon. Thank you for reading.";

test("the log and mission.planner name the AI that really planned, and the plan line names the AIs that will really run", { timeout: 300000 }, async () => {
  let plannerCalls = 0;
  const m = await mocks(({ sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) {
      plannerCalls++;
      if (plannerCalls === 1) return { status: 429, body: { error: { message: "Rate limit reached" } } }; // the first choice refuses
      return PLAN;
    }
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    if (/You assemble/.test(sys)) return NOTE;
    return NOTE;
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: GOAL, mode: "economy", qa: true, budgetUsd: 1 });
    assert.ok(["done", "done-with-errors"].includes(run.status), `${run.status}: ${run.error || ""}`);

    // exactly one line says who is drawing up the plan, and it is the AI that really answered
    const planLogs = run.log.filter((l) => /is drawing up the plan/.test(l.text));
    assert.equal(planLogs.length, 1, JSON.stringify(planLogs));
    const said = /^(.*) is drawing up the plan \(standing in for (.*)\)\.$/.exec(planLogs[0].text);
    assert.ok(said, `stand-in line: ${planLogs[0].text}`);
    const realId = Object.keys(PROVIDERS).find((id) => PROVIDERS[id].name === said[1]);
    const deadId = Object.keys(PROVIDERS).find((id) => PROVIDERS[id].name === said[2]);
    assert.ok(realId && deadId && realId !== deadId, `real ${realId}, dead ${deadId}`);
    assert.equal(run.planner.provider, realId, "mission.planner names who really planned");
    assert.equal(run.planner.standIn.for, deadId, "the stand-in says who it stood in for");
    assert.ok(run.fallbacks.some((f) => f.from.provider === deadId && f.to.provider === realId), JSON.stringify(run.fallbacks));

    // the plan line lists the AIs that will really run the steps, not the one that refused
    const planLine = (run.log.find((l) => /^Plan: \d+ tasks/.test(l.text)) || {}).text;
    assert.ok(planLine, `no plan line in ${JSON.stringify(run.log.map((l) => l.text))}`);
    assert.match(planLine, new RegExp(`Planned by ${said[1]}\\.`));
    const arrow = planLine.split("→")[1] || "";
    const runners = run.tasks.filter((t) => !t.agent && !t.media && !t.app && !t.save);
    assert.ok(runners.length >= 1);
    for (const t of runners) assert.ok(arrow.includes(PROVIDERS[t.provider]?.name || t.provider), `${t.provider} in ${planLine}`);
    assert.ok(!arrow.includes(said[2]), `the refused AI is not named as a runner: ${planLine}`);

    // the readers dialog for this mission names an AI that can run, never the paused one
    const readers = await s.api("/desk/readers", { method: "POST", body: { mode: "mission", prompt: GOAL } });
    assert.equal(readers.status, 200, readers.text);
    assert.match(readers.json.line, /will read the full prompt/);
    assert.ok(readers.json.planner || readers.json.readers.length, readers.text);
    // 0.4.21 (Gemini check): a 429 benches only the model that refused. The same AI may still be named when another
    // of its models can run, but never with the refused model.
    const refusedModel = run.fallbacks.find((f) => f.from.provider === deadId).from.model;
    const named = readers.json.readers.find((r) => r.id === deadId);
    assert.ok(!named || named.model !== refusedModel, `the refused model is still named: ${readers.json.line}`);
    if (readers.json.planner) assert.notEqual(readers.json.planner.model, refusedModel, "the planner is not the refused model");
  } finally { await s.stop(); await m.close(); }
});

test("Who will read this never names an AI whose key the health check rejected", () => {
  const rankFn = () => [
    { provider: "openai", providerName: "ChatGPT", model: "gpt-6.1-sol", score: 90 },
    { provider: "anthropic", providerName: "Claude", model: "claude-opus-5-5", score: 80 },
  ];
  H.noteCall("openai", false, 10, 401, ""); // health: red, "Key rejected (401)"
  try {
    assert.equal(H.isDeadNow("openai"), true);
    const w = whoWillRead({ prompt: "plan a launch", mode: "balanced", rankFn, search: false, agent: { use: false } });
    assert.equal(w.planner.name, "Claude", "the dead AI is never named as the planner");
    assert.ok(!w.readers.some((r) => r.id === "openai"), JSON.stringify(w.readers));
  } finally { H.noteCall("openai", true, 10); }
});

test("the desk planner pick skips AIs that are dead or holding after a real failure", () => {
  const src = fs.readFileSync(new URL("../server/plugins/desk.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /!isDeadNow\(m\.provider\) && !heldByRealFailure\(m\.provider\)/, "the mission planner line only names an AI that can run now");
  const readers = fs.readFileSync(new URL("../server/readers.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(readers, /!isDeadNow\(m\.provider\) && !heldByRealFailure\(m\.provider\)/);
});

test("the readers text offers web search only when a search will really run", () => {
  const rankFn = () => [{ provider: "openai", providerName: "ChatGPT", model: "gpt", score: 90 }];
  const quiet = { prompt: "plan a launch", mode: "balanced", rankFn, agent: { use: false } };
  const searchRow = (w) => w.readers.find((r) => r.kind === "service" && /^search:/.test(r.id));
  SEARCH.saveSearchSettings({ on: { single: true, council: true, mission: true } });
  try {
    // every switch is on, but the classifier says needWeb false and the words do not ask: no search row
    assert.equal(searchWillRun({ prompt: "plan a launch", kind: "mission" }), false, "needWeb false and no ask");
    assert.equal(searchWillRun({ prompt: "plan a launch", kind: "single" }), true, "the Single switch is an ask for Single");
    assert.equal(searchWillRun({ prompt: "plan a launch", kind: "council" }), true, "the Council switch is an ask for Council");
    const row = whoWillRead({ ...quiet, kind: "mission" });
    assert.equal(searchRow(row), undefined, JSON.stringify(row.readers));
    // the words ask for search: the row comes back
    const asked = whoWillRead({ ...quiet, prompt: "search the web for the latest solar prices", kind: "mission" });
    assert.ok(searchRow(asked), JSON.stringify(asked.readers));
    // switches off: nothing runs, and the classifier still gets its search
    SEARCH.saveSearchSettings({ on: OFF });
    assert.equal(searchWillRun({ prompt: "plan a launch", kind: "single" }), false, "switch off and needWeb false");
    assert.equal(searchWillRun({ prompt: "what is the latest news today", kind: "single" }), true, "needWeb is enough");
    assert.equal(searchWillRun({ prompt: "what is the latest news today", kind: "single", search: false }), false, "the request says no");
    assert.equal(searchWillRun({ prompt: "plan a launch", kind: "mission", search: true }), true, "the request says search");
  } finally { SEARCH.saveSearchSettings({ on: OFF }); }
});

test("no web search when needWeb is false and nobody asked, in the run and in the readers text", { timeout: 300000 }, async () => {
  const m = await mocks(({ sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return PLAN;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    if (/You assemble/.test(sys)) return NOTE;
    return NOTE;
  });
  const s = await boot(m);
  try {
    // an engine is ready (one test search on the mock key) and every search switch is on
    assert.equal((await s.api("/search/key", { method: "POST", body: { engine: "tavily", key: KEYS.tavily } })).json.ok, true);
    for (const mode of ["single", "council", "mission"]) assert.equal((await s.api("/search/toggle", { method: "POST", body: { mode, on: true } })).status, 200);
    assert.deepEqual((await s.api("/search")).json.on, { single: true, council: true, mission: true });

    // mission: needWeb false, the words do not ask, the switch is on. Nothing is searched (dogfood 11, 12).
    const before = m.hits();
    const run = await runMission(s, { goal: GOAL, mode: "economy", qa: true, budgetUsd: 1 });
    assert.ok(["done", "done-with-errors"].includes(run.status), `${run.status}: ${run.error || ""}`);
    assert.equal(run.searched, false, "no search ran for the mission");
    assert.equal(run.searchAsked, false);
    assert.equal(m.hits(), before, "the search engine was never called");
    const led = (await s.api("/state")).json.ledger;
    assert.equal((led.recent || []).filter((e) => e.kind === "search" && e.missionId === run.id).length, 0, "no search line in the ledger");

    // the dialog for that mission must not offer the search either
    const readers = await s.api("/desk/readers", { method: "POST", body: { mode: "mission", prompt: GOAL } });
    assert.equal(readers.status, 200, readers.text);
    assert.doesNotMatch(readers.json.servicesLine, /Web search/, readers.json.servicesLine);
    // and it still offers it when the words do ask
    const asking = await s.api("/desk/readers", { method: "POST", body: { mode: "mission", prompt: "Please search for the latest solar prices this week" } });
    assert.match(asking.json.servicesLine, /Web search/, asking.json.servicesLine);
    const councilReaders = await s.api("/desk/readers", { method: "POST", body: { mode: "council", prompt: GOAL } });
    assert.match(councilReaders.json.servicesLine, /Web search/, "Council searches on its own switch");

    // single and council with their switches off and needWeb false: nothing searched
    for (const mode of ["single", "council", "mission"]) await s.api("/search/toggle", { method: "POST", body: { mode, on: false } });
    const quiet = m.hits();
    const single = await waitRun(s, runSettled(await chatRunId(s.api, { prompt: "Write a welcome note for our new customers.", provider: "groq", model: "openai/gpt-oss-120b" })), "single without search");
    assert.equal(single.searched, false, "a quiet single chat does not search");
    const council = await waitRun(s, await newKindPred(s.api, "/council", { prompt: "Council: write a welcome note for our new customers.", members: [{ provider: "groq", model: "openai/gpt-oss-120b" }], qa: false }, "council"), "council without search");
    assert.equal(council.searched, false, "a quiet council does not search");
    assert.equal(m.hits(), quiet, "the search engine was never called");

    // the classifier asking for live information still searches: the feature is still there
    const hot = await waitRun(s, runSettled(await chatRunId(s.api, { prompt: "What is the latest solar news this week?", provider: "groq", model: "openai/gpt-oss-120b" })), "single with search");
    assert.equal(hot.searched, true, "needWeb true runs the search");
    assert.ok(hot.sources.length >= 3, `sources: ${hot.sources.length}`);
    assert.ok(m.hits() > quiet, "the engine ran for that one");
  } finally { await s.stop(); await m.close(); }
});
