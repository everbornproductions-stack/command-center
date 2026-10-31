// 0.4.28 batch 4: two mission bugs found by dogfooding the installed 0.4.27 (2026-10-30), reproduced with fakes.
//  1. catalog-json: the step was judged cut off, the app asked the AI to carry on, and the AI answered "The JSON was
//     not cut off. The previous response ends with the closing ] and code fence ...". That sentence was glued right
//     after the closing fence and catalog.json was saved with it inside, so the file was not valid JSON.
//  2. bash-rotate: the mission sat in "planning" for 20 minutes with no log line, no plan and no error.
// The catalog texts come from the dogfood mission.json (test/fixtures/catalog-0428.json). Fakes only: loopback
// mocks, fake keys that are never sent anywhere, no network, no data/ folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT, startServer, waitBudget } from "./helpers.js";

const DIR = tmpDir("cc-m2-0428-");
const HOME = tmpDir("cc-m2-0428-home-");
Object.assign(process.env, { CC_DATA_DIR: DIR, CC_SUBCLI_HOME: HOME, CC_SUBCLI_NO_PATH: "1", CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "off" });
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "PERPLEXITY_API_KEY", "GROQ_API_KEY"]) process.env[k] = "";
delete process.env.CC_DEV_OWNER;

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const G = await import("../server/step-guard.js");
const C = await import("../server/code-files.js");
const S = await import("../server/save-named-files.js");
const W = await import("../server/plan-watchdog.js");
const L = await import("../server/cli-limit.js");
const PF = await import("../server/plan-first.js");
const AGY = await import("../server/antigravity-cli.js");

const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "catalog-0428.json"), "utf8"));
const missionSrc = fs.readFileSync(path.join(ROOT, "server", "mission.js"), "utf8").replace(/\r\n/g, "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMIT_LINE = "You've hit your session limit \u00b7 resets 2:30pm (America/Los_Angeles)";

// ---------- 1. the catalog continuation ----------
test("catalog-json: the exact step output (a complete ```json array of 15 objects) is not judged cut off", () => {
  const body = /```json\n([\s\S]*?)\n```/.exec(FX.step)[1];
  assert.equal(JSON.parse(body).length, 15, "the fixture is the real 15 product array");
  assert.deepEqual(G.checkTruncation(FX.step, { ext: "json", capability: "code" }), { truncated: false, reason: "" });
  assert.equal(G.judgeStep(FX.step, { goal: "Create a product catalog as a JSON file for a handmade jewelry shop. Save it as catalog.json", title: "Convert lineup into validated catalog.json", ext: "json", capability: "code" }).ok, true);
  // the final answer (one ```json block with no file name above it) is not cut off either
  assert.equal(G.checkTruncation(FX.final, { ext: "json" }).truncated, false);
  // a JSON block that really stops is still caught
  assert.equal(G.checkTruncation(FX.step.slice(0, 3000) + "\n```", { ext: "json" }).truncated, true);
});

test("catalog-json: every 'it was already complete' reply is dropped, and the output is kept as it was", () => {
  for (const reply of [FX.stepReply, ...FX.replies]) {
    assert.equal(G.saysComplete(reply), true, reply.slice(0, 80));
  }
  assert.equal(G.joinContinuation(FX.step, FX.stepReply), FX.step, "the step keeps its own output");
  for (const reply of FX.replies) assert.equal(G.joinContinuation(FX.final, reply), FX.final, "the final answer keeps its own text");
  // more of the same wording
  for (const s of ["Nothing to add: the file above is complete.", "The answer was not truncated.", "There's nothing more to continue.", "It is already complete and ends with the closing brace.", "The output is complete. No missing content left."]) assert.equal(G.saysComplete(s), true, s);
  // real carry-ons are never dropped
  for (const s of ["  \"description\": \"Small pearls.\"\n  }\n]\n```", "and the last two steps follow.", "Then preheat the oven to 200C.", "The plan is complete when every step has an owner.", "```json\n{ \"id\": 16 }\n```", "}\n\nfunction main() {}"]) assert.equal(G.saysComplete(s), false, s);
});

test("catalog-json: a complete-reply makes the step complete; only a code block left open still counts as cut off", () => {
  assert.equal(G.checkTruncation(FX.step, { ext: "json", stop: "length", complete: true }).truncated, false, "the AI's word wins over a stop reason");
  assert.equal(G.judgeStep(FX.step.slice(0, 2000), { ext: "json", complete: true }).kind, "truncated", "an open code block is still cut off");
  // mission.js wires it into the step carry-on and the final-answer carry-on
  assert.match(missionSrc, /if \(saysComplete\(r\.text\)\) \{ t\.saidComplete = true; log\(`\$\{PROVIDERS\[r\.provider\]\?\.name \|\| r\.provider\} said "\$\{t\.title\}" was already complete, so Meldmind kept the answer as it was\.`\); break; \}/);
  assert.match(missionSrc, /complete: !!t\.saidComplete/);
  assert.match(missionSrc, /if \(saysComplete\(r\.text\)\) \{ mission\.assemblerSaidComplete = true;/);
  assert.equal((missionSrc.match(/complete: !!mission\.assemblerSaidComplete/g) || []).length, 2, "the carry-on loop and the finish check");
});

test("prose from a carry-on is never glued onto or into a code block", () => {
  const closed = "**data.json**\n```json\n[1, 2]\n```";
  const j = G.joinContinuation(closed, "Hope this helps! Tell me if you want more rows.");
  assert.equal(j, "**data.json**\n```json\n[1, 2]\n```\n\nHope this helps! Tell me if you want more rows.");
  assert.equal(C.extractCodeFiles(j)[0].text, "[1, 2]\n", "the block holds only the code");
  // inside an open block: an intro line and a reopened fence are not put into the code
  const open = "```json\n[1,";
  assert.equal(G.joinContinuation(open, "Here is the rest of the file:\n```json\n 2]\n```"), "```json\n[1, 2]\n```");
  // a carry-on that closes the block with words on the same line is split onto its own paragraph
  const split = G.joinContinuation(open, "\n 2]\n```That is the whole array.");
  assert.equal(split, "```json\n[1,\n 2]\n```\n\nThat is the whole array.");
  assert.deepEqual(JSON.parse(C.extractCodeFiles(split)[0].text), [1, 2]);
  // a real carry-on of code still joins in place, overlap dropped
  assert.equal(G.joinContinuation("```js\nconst a = 1;\nconst b =", " 2;\n```"), "```js\nconst a = 1;\nconst b = 2;\n```");
});

test("saving catalog.json takes only the code block, never the sentence after the fence (the saved 0.4.27 file)", () => {
  // the exact text 0.4.27 saved from: a sentence glued onto the closing fence, then the file again in full
  const blocks = C.extractCodeFiles(FX.deliverable);
  assert.equal(blocks.length, 2, "the glued sentence ends the first block");
  for (const b of blocks) assert.equal(JSON.parse(b.text).length, 15);
  const b = C.bodyForFile("catalog.json", [{ text: FX.deliverable, from: "answer" }]);
  assert.ok(b, "the same file given twice is still one file");
  assert.equal(JSON.parse(b.body).length, 15);
  assert.doesNotMatch(b.body, /cut off|```/);
  // the step output 0.4.27 kept: "```Nothing is missing ..." glued onto the fence
  const glued = FX.step + FX.stepReply;
  const one = C.extractCodeFiles(glued);
  assert.equal(one.length, 1);
  assert.equal(JSON.parse(one[0].text).length, 15);
  // the finish step writes valid JSON from it
  let written = null;
  const out = S.saveEveryNamedFile({ goal: "Save it as C:\\x\\catalog.json", names: ["catalog.json"], deliverable: FX.deliverable, tasks: [], save: ({ name, text }) => { written = { name, text }; return { ok: true, name, path: path.join(DIR, "nothing-on-disk.json") }; } });
  assert.equal(out.length, 1);
  const body = /```json catalog\.json\n([\s\S]*)\n```\n$/.exec(written.text)[1];
  assert.equal(JSON.parse(body).length, 15);
  // a fence followed by a language or a file name inside a block is still a nested block, not prose
  assert.equal(C.unglueFences("```md\n# Readme\n```js app.js\nx()\n```\n```"), "```md\n# Readme\n```js app.js\nx()\n```\n```");
});

// ---------- 2. the planning watchdog ----------
const hangUntilAborted = (signal, seen) => new Promise((_, reject) => { signal.addEventListener("abort", () => { seen.push("aborted"); reject(Object.assign(new Error("stopped"), { code: "stopped" })); }, { once: true }); });

test("a planner that never answers is stopped at the watchdog, the next one gets one try, then the one-step plan", async () => {
  assert.equal(W.PLAN_WATCHDOG_MS, 3 * 60 * 1000, "about 3 minutes in real time");
  assert.equal(W.planWatchdogMs({}), W.PLAN_WATCHDOG_MS);
  assert.equal(W.planWatchdogMs({ CC_PLAN_WATCHDOG_MS: "250" }), 250);
  const seen = [], lines = [], asked = [];
  const planners = [{ provider: "plan-claude-code", providerName: "Claude Code (your plan)" }, { provider: "groq", providerName: "Groq" }, { provider: "xai", providerName: "Grok" }];
  const t0 = Date.now();
  const res = await W.planWithWatchdog({
    first: planners[0], timeoutMs: 300, log: (l) => lines.push(l),
    next: (tried) => planners.find((p) => !tried.includes(p.provider)) || null,
    call: (p, { signal }) => { asked.push(p.provider); return hangUntilAborted(signal, seen); },
  });
  const ms = Date.now() - t0;
  assert.equal(res.r, null);
  assert.equal(res.timedOut, true);
  assert.deepEqual(asked, ["plan-claude-code", "groq"], "two tries, never a third");
  assert.deepEqual(seen, ["aborted", "aborted"], "each stuck call is cancelled");
  assert.ok(ms >= 550 && ms < 5000, `done within the two waits (${ms} ms)`);
  assert.deepEqual(lines, ["Claude Code (your plan) did not send a plan within 1 second, so Meldmind stopped waiting for it.", "Groq did not send a plan within 1 second, so Meldmind stopped waiting for it."]);
  assert.equal(W.waitWords(W.PLAN_WATCHDOG_MS), "3 minutes");
  for (const l of [...lines, W.ONE_STEP_LINE]) assert.doesNotMatch(l, /\u2014/);
});

test("the second planner answering in time wins; a plain failure is thrown as before; the mission's own Stop is thrown", async () => {
  const seen = [];
  const res = await W.planWithWatchdog({
    first: { provider: "groq" }, timeoutMs: 200,
    next: () => ({ provider: "mistral", providerName: "Mistral" }),
    call: async (p, { signal }) => (p.provider === "groq" ? hangUntilAborted(signal, seen) : { text: '{"title":"x","tasks":[]}', provider: "mistral" }),
  });
  assert.equal(res.planner.provider, "mistral");
  assert.match(res.r.text, /"title"/);
  await assert.rejects(W.planWithWatchdog({ first: { provider: "groq" }, timeoutMs: 1000, call: async () => { throw new Error("No AI is available"); } }), /No AI is available/);
  const ctl = new AbortController();
  const p = W.planWithWatchdog({ first: { provider: "groq" }, timeoutMs: 5000, signal: ctl.signal, call: (_p, { signal }) => hangUntilAborted(signal, []) });
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(p, /stopped/);
});

test("a planner that says it hit its limit rests until its own reset time, and the next planner draws up the plan", async () => {
  const rested = [], lines = [];
  const res = await W.planWithWatchdog({
    first: { provider: "plan-claude-code", providerName: "Claude Code (your plan)" }, timeoutMs: 2000, log: (l) => lines.push(l),
    next: (tried) => (tried.includes("plan-claude-code") ? { provider: "groq", providerName: "Groq" } : null),
    rest: (pid, lim) => { rested.push({ pid, lim }); return true; },
    call: async (p) => { if (p.provider === "plan-claude-code") throw Object.assign(new Error(`Claude Code could not answer. ${LIMIT_LINE}`), { status: 502 }); return { text: "{}", provider: "groq" }; },
  });
  assert.equal(res.planner.provider, "groq");
  assert.equal(rested.length, 1);
  assert.equal(rested[0].pid, "plan-claude-code");
  assert.ok(rested[0].lim.until > Date.now(), "until the reset time it gave");
  assert.match(rested[0].lim.words, /2:30pm \(America\/Los_Angeles\)/);
  assert.equal(lines[0], "Claude Code (your plan) is out of its plan's quota for now, so it rests. Another AI draws up the plan.");
  // the real rest step uses cli-limit's reset time: Claude Code (your plan) and Antigravity leave the router until then
  const now = Date.now();
  const lim = W.limitOf(new Error(LIMIT_LINE));
  assert.ok(lim.until > now && lim.until <= now + 24 * 3600 * 1000, "the reset time from the limit line");
  assert.equal(await W.restPlanner("plan-claude-code", lim), true);
  assert.ok(PF.restingUntil("claude-code") > Date.now());
  assert.equal(await W.restPlanner("antigravity", { until: null }), true);
  assert.ok(AGY.agyRestingUntil() >= Date.now() + L.LIMIT_REST_MS - 60000, "no reset time given: a few hours");
  assert.equal(await W.restPlanner("groq", lim), false, "an API AI is benched by smart fallback, not here");
  // a limit from the only planner, with nobody else to ask, fails in plain words as before
  await assert.rejects(W.planWithWatchdog({ first: { provider: "plan-codex" }, timeoutMs: 1000, rest: () => true, call: async () => { throw Object.assign(new Error("Codex is out of its own plan's quota right now."), { code: "quota", limit: true }); } }), /out of its own plan's quota/);
});

test("mission.js: the planner runs under the watchdog, the steps before the plan have a time limit, and the log is saved", () => {
  assert.match(missionSrc, /import \{ planWithWatchdog, planWatchdogMs, ONE_STEP_LINE \} from "\.\/plan-watchdog\.js";/);
  assert.match(missionSrc, /log\(`Drawing up the plan\.`\);\n    update\(\); \/\/ the saved mission shows how far it got/);
  assert.match(missionSrc, /const watched = await planWithWatchdog\(\{\n        first: planner, call: callPlanner, signal: ctl\.signal, timeoutMs: planWatchdogMs\(\)/);
  assert.match(missionSrc, /if \(!err\?\.oneStep\) throw err;\n      log\(ONE_STEP_LINE\);/);
  assert.match(missionSrc, /withinTime\(classify\(goal, [^\n]*CLASSIFY_WAIT_MS, \(\) => heuristicClassify\(goal\)\)/);
  assert.match(missionSrc, /withinTime\(creditCheck\(\{\}\), CREDIT_CHECK_WAIT_MS/);
});

// ---------- end to end: a mission whose planners never answer still finishes ----------
const KEYS = { groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
async function mocks() {
  const hung = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    if (/Break the goal into/.test(sys)) { hung.push(url.pathname.split("/")[1]); return; } // the planner never answers
    let out = "Here is the rotate-logs script.\n\n```bash rotate-logs.sh\n#!/usr/bin/env bash\nset -euo pipefail\nLOG_DIR=/var/log/myapp\nfind \"$LOG_DIR\" -name '*.log' -mtime +7 -exec gzip {} \\;\nfind \"$LOG_DIR\" -name '*.gz' -mtime +30 -delete\necho done\n```\n";
    if (/Reply with JSON only: \{"capability"/.test(sys)) out = `{"capability":"code","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/QA/.test(sys) && /JSON/.test(sys)) out = `{"pass":true,"score":8,"issues":[]}`;
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, hung, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

test("end to end: both planners hang, each is stopped at the watchdog, and the mission does the goal in one step", { timeout: 300000 }, async () => {
  const m = await mocks();
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "off", CC_QA_TIMEOUT_MS: "1500", CC_PLAN_WATCHDOG_MS: "1500", CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", PERPLEXITY_API_KEY: "" } });
  after(async () => { await s.stop().catch(() => {}); await m.close().catch(() => {}); });
  for (const pid of ["groq", "mistral"]) await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } });
  const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
  const t0 = Date.now();
  const posted = await s.api("/mission", { method: "POST", body: { goal: "Write a bash script that compresses log files older than 7 days in /var/log/myapp with gzip and prints a summary. Use set -euo pipefail.", budget: 1, qa: false } });
  assert.equal(posted.status, 202, posted.text);
  let r = null;
  while (Date.now() - t0 < waitBudget(120000)) {
    const x = ((await s.api("/state")).json.missions || []).find((y) => y.kind === "mission" && !before.has(y.id) && ["done", "done-with-errors", "failed"].includes(y.status));
    if (x) { r = (await s.api(`/missions/${x.id}`)).json; break; }
    await sleep(250);
  }
  assert.ok(r, "the mission left planning and finished\n" + s.log.slice(-800));
  const log = (r.log || []).map((l) => l.text);
  assert.ok(m.hung.length >= 2, `both planners were asked (${m.hung.join(", ")})`);
  assert.equal(log.filter((l) => /did not send a plan within 2 seconds, so Meldmind stopped waiting for it\./.test(l)).length, 2, log.join("\n"));
  assert.ok(log.includes(W.ONE_STEP_LINE), log.join("\n"));
  assert.equal(r.tasks.length, 1, "one step: the whole goal");
  assert.notEqual(r.status, "failed", JSON.stringify({ status: r.status, error: r.error }));
});
