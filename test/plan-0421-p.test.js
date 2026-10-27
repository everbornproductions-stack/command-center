// 0.4.21 gap worker P (Dogfood 11 and 12). Local mocks only: no real key, no network, no spend.
//  1. the log and mission.planner name the AI that really planned (a stand-in included), the plan line
//     names the AIs that will really run each step, and "Who will read this" never names a dead planner.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { startServer, waitBudget, tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-plan-p-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
process.env.CC_STATUS_PAGES = "off";
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { PROVIDERS } = await import("../server/registry.js");
const H = await import("../server/health.js");
const { whoWillRead } = await import("../server/readers.js");

const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One mock for every provider, prefixed by path (/xai/v1, /groq/v1, /mistral/v1).
// The script may answer with { status, body } to make one call fail the way a real provider refuses.
async function mocks(script) {
  const seen = [];
  const counts = new Map();
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
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
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}

async function boot(m) {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "3000", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", PERPLEXITY_API_KEY: "" } });
  for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
  await s.api("/fallback/settings", { method: "POST", body: { on: true } }).catch(() => {});
  return s;
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
    const run = await runMission(s, { goal: "Write a short note to our customers about our summer hours.", mode: "economy", qa: true, budgetUsd: 1 });
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
    const readers = await s.api("/desk/readers", { method: "POST", body: { mode: "mission", prompt: "Write a short note to our customers about our summer hours." } });
    assert.equal(readers.status, 200, readers.text);
    assert.match(readers.json.line, /will read the full prompt/);
    assert.ok(readers.json.planner || readers.json.readers.length, readers.text);
    assert.doesNotMatch(readers.json.line, new RegExp(said[2]), `the paused AI is still named: ${readers.json.line}`);
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
