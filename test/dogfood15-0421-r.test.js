// 0.4.21 dogfood 15: a mission where every planner candidate is dead (429, 402, 403) must never crash with a raw
// JavaScript error ("Cannot read properties of undefined (reading 'name')"). It ends with a plain failure that says
// what the try cost and offers a one-AI answer. Local mock AIs only: no real key, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, waitBudget } from "./helpers.js";
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);

const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REFUSE = {
  xai: [429, { error: { message: "Rate limit reached for requests", type: "rate_limit" } }],
  groq: [402, { error: { message: "Payment required: insufficient credits" } }],
  mistral: [403, { error: { message: "This API needs paid credits" } }],
};

// script({prefix, sys, user}) returns a string (answer) or [status, json] (refusal)
async function mocks(script) {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    seen.push({ prefix, sys: sys.slice(0, 60) });
    const out = script({ prefix, sys, user, health: j.max_tokens != null && j.max_tokens <= 16 && !sys });
    if (Array.isArray(out)) return send(out[0], out[1]);
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}
async function boot(m) {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "off", CC_QA_TIMEOUT_MS: "1500", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", PERPLEXITY_API_KEY: "" } });
  for (const pid of ["xai", "groq", "mistral"]) await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } });
  return s;
}
async function runMission(s, body, ms = 90000) {
  const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
  const posted = await s.api("/mission", { method: "POST", body });
  assert.equal(posted.status, 202, posted.text);
  const t0 = Date.now();
  while (Date.now() - t0 < waitBudget(ms)) {
    const m = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && !before.has(x.id) && ["done", "done-with-errors", "failed"].includes(x.status));
    if (m) return (await s.api(`/missions/${m.id}`)).json;
    await sleep(250);
  }
  const last = ((await s.api("/state")).json.missions || []).filter((x) => !before.has(x.id)).map((x) => `${x.id} ${x.status}`);
  throw new Error("mission did not finish: " + last.join(", ") + "\n" + s.log.slice(-800));
}
const GOAL = "Write 3 LinkedIn posts for Everborn Productions aimed at California mortgage brokers, 80 to 140 words each, with a call to book a free 15 minute call. Save them as posts.md. Do not post anywhere.";
const PLAN = JSON.stringify({ title: "LinkedIn posts", tasks: [
  { id: "t1", title: "Write the three posts", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write three posts.", deliverable: "Three posts", agent: "Grok Bot", provider: "perplexity" },
  { id: "t2", title: "Compliance and spec check", capability: "analysis", difficulty: 2, needWeb: false, deps: ["t1"], instructions: "Check the posts.", deliverable: "Checked posts", provider: "openai" },
  { id: "t3", title: "Save final posts as markdown file", capability: "code", difficulty: 1, needWeb: false, deps: ["t2"], instructions: "Save posts.md", deliverable: "posts.md" },
], assembly: "Hand over the posts." });

function noRawError(r) {
  const all = JSON.stringify(r);
  assert.doesNotMatch(all, /Cannot read propert|is not a function|is not defined|TypeError|ReferenceError/, all.slice(0, 1500));
}

test("every AI refuses (429, 402, 403): the mission fails in plain words, no raw JS error, and offers a one-AI answer", { timeout: 300000 }, async () => {
  const m = await mocks(({ prefix }) => REFUSE[prefix]);
  const s = await boot(m);
  try {
    const r = await runMission(s, { goal: GOAL, budget: 1, qa: true });
    noRawError(r);
    // before 0.4.21 R: an AI paused for no credits threw code "paused" and the whole mission sat at "paused" forever
    assert.equal(r.status, "failed", JSON.stringify({ status: r.status, error: r.error, log: r.log }).slice(0, 900));
    assert.ok(r.error && r.error.length > 10, "a plain reason is shown");
    assert.equal(r.retry?.oneAI, true, "a one-AI answer is offered");
    assert.equal(r.retry.label, "Get a one-AI answer");
    assert.doesNotMatch(JSON.stringify(r.log || []), /Mission paused\. You can edit/);
  } finally { await s.stop(); await m.close(); }
});

test("planning works on a stand-in but every worker AI is dead: no raw JS error, plain failure with cost and retry", { timeout: 300000 }, async () => {
  let planned = 0;
  const m = await mocks(({ prefix, sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys) && prefix === "mistral" && !planned++) return PLAN;
    return REFUSE[prefix];
  });
  const s = await boot(m);
  try {
    const r = await runMission(s, { goal: GOAL, budget: 1, qa: true });
    noRawError(r);
    assert.equal(r.status, "failed", JSON.stringify({ status: r.status, error: r.error }).slice(0, 600));
    assert.ok(r.cost > 0, "planning was charged");
    assert.match(r.error, /This try cost \$\d+\.\d+ for planning\. You can try again or get a one-AI answer\./, r.error);
    assert.equal(r.retry?.oneAI, true);
  } finally { await s.stop(); await m.close(); }
});

test("only the person's Pause pauses a mission; an AI paused for no credits is a failed call", async () => {
  const { isMissionPause, costLine } = await import("../server/mission.js");
  const credits = Object.assign(new Error("Grok is paused: no credits."), { code: "paused", kind: "credits", status: 402 });
  const rate = Object.assign(new Error("Groq is paused: rate limited."), { code: "paused", kind: "rate", status: 402 });
  assert.equal(isMissionPause(credits), false);
  assert.equal(isMissionPause(rate), false);
  assert.equal(isMissionPause(Object.assign(new Error("Mission paused"), { code: "paused" })), true);
  assert.equal(isMissionPause(new Error("x")), false);
  assert.equal(isMissionPause(null), false);
  assert.equal(costLine(0.034, { tasks: [] }), "This try cost $0.03 for planning. You can try again or get a one-AI answer.");
  assert.equal(costLine(0.0021, { tasks: [{ cost: 0.001 }] }), "This try cost $0.0021 before it stopped. You can try again or get a one-AI answer.");
});

test("the failure card offers a one-AI answer, and a new run drops the old run's 'Mission done' line from the live feed", async () => {
  const fs = await import("node:fs");
  const { failureHtml } = await import("../web/failure-cause.js");
  assert.match(failureHtml({ text: "Nothing came back.", oneAI: true }), /id="cc-fail-oneai"[^>]*>Get a one-AI answer</);
  assert.doesNotMatch(failureHtml({ text: "Nothing came back." }), /cc-fail-oneai/);
  assert.doesNotMatch(failureHtml({ text: "This month's budget is used up.", oneAI: true }), /cc-fail-oneai/, "the budget card keeps its own two buttons");
  const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(app, /oneAI: !!m\.retry\?\.oneAI/);
  assert.match(app, /#cc-fail-oneai"\)\?\.addEventListener\("click", \(\) => \{ S\.pendingAvoid = ""; S\.forceSingleOnce = true; sendOrders\(\); \}\)/);
  assert.match(app, /let mode = oneAI \? "single" : autoPick \? "single" : picked;/);
  assert.match(app, /if \(S\.live\.id !== id && id\) dropOldFinishLines\(id\);/);
  const re = /const FINISH_LINE = (\/.*\/);/.exec(app);
  assert.ok(re, "FINISH_LINE is defined");
  const FINISH = eval(re[1]); // the same pattern the page uses
  assert.ok(FINISH.test("Mission done in 383s, $0.1471."));
  assert.ok(FINISH.test("Mission failed in 18s, $0.0340."));
  assert.ok(!FINISH.test("Mission failed: Nothing came back."), "the reason line of this run stays");
});

test("a health check cannot turn an AI green after a real 429/402 (covered end to end in pdf-0421)", () => {
  const fs = require_("node:fs");
  const src = fs.readFileSync(new URL("./pdf-0421.test.js", import.meta.url), "utf8");
  assert.match(src, /a background models-list check cannot turn it green/);
});
