// Backup when API credits run out (2026-10-21): the outcome rule, the copy-over prompt, the marked block,
// the MCP answer checks, the official apps on this PC (a fake app on PATH: success, not signed in, quota,
// timeout with the whole process tree stopped, no shell), and the website switch. In-process, no network,
// no real key, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT, waitBudget } from "./helpers.js";

const DIR = tmpDir("cc-answerwait-");
const HOME = tmpDir("cc-answerwait-home-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_SUBCLI_HOME = HOME;
process.env.CC_SUBCLI_NO_PATH = "1";
process.env.CC_SUBCLI_EXEC = process.execPath;
const FAKE = path.join(ROOT, "test", "fixtures", "fake-sub-cli.mjs");
const EM = String.fromCharCode(0x2014);

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const AW = await import("../server/answer-wait.js");
const SR = await import("../server/sub-routes.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = waitBudget(15000)) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); }
  return null;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function signIn(on) {
  const f = path.join(HOME, ".claude", ".credentials.json");
  if (on) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "{}"); }
  else fs.rmSync(f, { force: true });
}

// one handler stands in for the run each test waits on
const filled = [];
AW.onSlotAnswer("single", async (job, res) => { filled.push({ job, res }); });

test("only out-of-credits and billing failures wait; rate limits, bad keys and caps do not", () => {
  assert.equal(AW.creditOutage({ status: 402, message: "Claude: HTTP 402 Payment Required" }), true);
  assert.equal(AW.creditOutage({ status: 429, message: "ChatGPT: You exceeded your current quota, please check your plan and billing details." }), true);
  assert.equal(AW.creditOutage(Object.assign(new Error("Claude is paused: no credits."), { code: "paused", kind: "credits" })), true);
  assert.equal(AW.creditOutage(Object.assign(new Error("Claude is paused: no credits."), { code: "paused", kind: "rate" })), false);
  assert.equal(AW.creditOutage({ status: 429, message: "Too many requests" }), false);
  assert.equal(AW.creditOutage({ status: 401, message: "invalid api key" }), false);
  assert.equal(AW.creditOutage(Object.assign(new Error("cap"), { code: "cap" })), false);
  assert.equal(AW.creditOutage(null), false);
  assert.equal(AW.waitOn(), true, "the switch is on by default");
});

test("the copy-over prompt asks for the answer back: hub first, then the MCP tool, then the marked block", () => {
  const job = { id: "ans-TESTJOB123", aiName: "Claude", ask: "What is a good name for a bakery? sk-ant-abcdefghijklmnop", system: "Answer as an expert." };
  const plain = AW.buildCopyPrompt(job);
  assert.match(plain, /What is a good name for a bakery\?/);
  assert.doesNotMatch(plain, /sk-ant-abcdef/, "a key-shaped token is removed");
  assert.match(plain, /SEND YOUR ANSWER BACK TO MELDMIND/);
  assert.match(plain, /1\. If you can use tools .* call the Meldmind tool submit_answer with job_id "ans-TESTJOB123"/);
  assert.match(plain, /2\. In every case, also end your reply with this block/);
  assert.ok(plain.includes("MELDMIND ANSWER ans-TESTJOB123\n(your full answer here)\nEND MELDMIND ANSWER"));
  assert.doesNotMatch(plain, /POST https?:/, "no hub, no hub block");
  const hub = AW.buildCopyPrompt(job, { hub: { url: "https://hub.example.test/api/handoff/ans-TESTJOB123/done", token: "tok_1234567890abcdef" } });
  assert.match(hub, /1\. If you can make web requests, post your full answer to Meldmind: POST https:\/\/hub\.example\.test/);
  assert.match(hub, /2\. If you can use tools/);
  assert.match(hub, /3\. In every case/);
  assert.ok(hub.indexOf("POST https://") < hub.indexOf("submit_answer") && hub.indexOf("submit_answer") < hub.indexOf("MELDMIND ANSWER ans-"));
  // our own template is never taken for an answer (the clipboard holds it right after Continue in)
  assert.equal(AW.extractMarked(plain, "ans-TESTJOB123"), null);
  assert.ok(!plain.includes(EM) && !hub.includes(EM));
  assert.match(AW.mcpPrompt(job), /submit_answer with job_id "ans-TESTJOB123"/);
});

test("marker parsing takes only the text inside this job's block; another id is ignored", () => {
  const text = "Sure! Here you go.\n\nMELDMIND ANSWER ans-OTHERJOB99\nnot this one\nEND MELDMIND ANSWER\n\nSome chatter.\n**MELDMIND ANSWER ans-RIGHTJOB1**\nLine one.\n\nLine two.\n**END MELDMIND ANSWER**\nThanks, bye.";
  assert.equal(AW.extractMarked(text, "ans-RIGHTJOB1"), "Line one.\n\nLine two.");
  assert.equal(AW.extractMarked(text, "ans-OTHERJOB99"), "not this one");
  assert.equal(AW.extractMarked(text, "ans-NOTHERE01"), null);
  assert.equal(AW.extractMarked("MELDMIND ANSWER ans-RIGHTJOB1\nno end line", "ans-RIGHTJOB1"), null, "an unfinished block is not taken");
  assert.equal(AW.extractMarked("plain reply with no block", "ans-RIGHTJOB1"), null);
  const fenced = "MELDMIND ANSWER ans-RIGHTJOB1\r\n```\r\ncode answer\r\n```\r\nEND MELDMIND ANSWER";
  assert.equal(AW.extractMarked(fenced, "ans-RIGHTJOB1"), "code answer");
});

test("answers: job id, size and state are checked, only the block is kept, and the log has no answer text", async () => {
  process.env.CC_CLAUDE_BIN = path.join(DIR, "no-such-claude");
  const info = AW.openWait({ kind: "single", runId: "s-test1", provider: "anthropic", model: "claude-x", ask: "Name a colour." });
  assert.match(info.jobId, AW.ID_RE);
  const copy = await until(() => AW.findJob(info.jobId)?.step === "copy" && AW.findJob(info.jobId));
  assert.ok(copy, "no app is set up, so the chain goes straight to copy it over");
  assert.match(AW.listWaiting().find((j) => j.id === info.jobId).prompt, /Name a colour\./);

  await assert.rejects(AW.submitAnswer({ jobId: "nope", answer: "x" }), (e) => e.status === 400);
  await assert.rejects(AW.submitAnswer({ jobId: "ans-unknownjob1", answer: "x" }), (e) => e.status === 404);
  await assert.rejects(AW.submitAnswer({ jobId: info.jobId, answer: "   " }), (e) => e.status === 400);
  await assert.rejects(AW.submitAnswer({ jobId: info.jobId, answer: "x".repeat(AW.ANSWER_MAX + 1) }), (e) => e.status === 413);
  await assert.rejects(AW.deliver(info.jobId, "no block here", { route: "clipboard" }), (e) => e.code === "no_block");

  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(" ")); };
  try {
    const out = await AW.submitAnswer({ jobId: info.jobId, answer: `chatter outside SECRETWORD\nMELDMIND ANSWER ${info.jobId}\nTeal, the answer.\nEND MELDMIND ANSWER` });
    assert.equal(out.status, "answered");
  } finally { console.log = orig; }
  const got = filled.find((f) => f.job.id === info.jobId);
  assert.equal(got.res.text, "Teal, the answer.");
  assert.equal(got.res.tag, "via Claude subscription");
  assert.ok(lines.some((l) => l === `answer-wait ${info.jobId} answered-mcp`));
  assert.ok(lines.every((l) => !l.includes("Teal") && !l.includes("SECRETWORD")), "never the answer in the log");
  await assert.rejects(AW.submitAnswer({ jobId: info.jobId, answer: "again" }), (e) => e.status === 409);
  assert.equal(JSON.stringify(AW.findJob(info.jobId)).includes("Teal"), false, "the job never keeps the answer");

  // the waiting job is a document: a new context on the same folder still has it (an app restart)
  const fresh = store.newContext("local", new store.FileStore(DIR));
  await fresh.store.loadAll(fresh);
  const again = await store.runAs(fresh, async () => AW.findJob(info.jobId));
  assert.equal(again?.status, "answered");
  delete process.env.CC_CLAUDE_BIN;
});

test("Stop waiting ends the wait and tells the run", async () => {
  process.env.CC_CLAUDE_BIN = path.join(DIR, "no-such-claude");
  const info = AW.openWait({ kind: "single", runId: "s-test2", provider: "anthropic", model: "claude-x", ask: "Stop me." });
  await until(() => AW.findJob(info.jobId)?.step === "copy");
  const out = await AW.stopWait(info.jobId);
  assert.equal(out.status, "stopped");
  assert.equal(filled.find((f) => f.job.id === info.jobId)?.res.stopped, true);
  await assert.rejects(AW.submitAnswer({ jobId: info.jobId, answer: "late" }), (e) => e.status === 409);
  delete process.env.CC_CLAUDE_BIN;
});

test("official app: installed and signed in answers on its own, with the question on stdin and no shell", async () => {
  const logFile = path.join(DIR, "fake-ok.json");
  process.env.CC_CLAUDE_BIN = FAKE; process.env.FAKE_SUBCLI_MODE = "ok"; process.env.FAKE_SUBCLI_LOG = logFile;
  process.env.ANTHROPIC_API_KEY = "sk-ant-should-never-reach-the-app";
  signIn(true);
  SR.clearStatusCache();
  const row = (await SR.allStatus({ refresh: true })).find((r) => r.id === "claude-code");
  assert.equal(row.status, "ready"); assert.equal(row.label, "Installed and signed in");
  const info = AW.openWait({ kind: "single", runId: "s-test3", provider: "anthropic", model: "claude-x", ask: "What is two plus two?" });
  const done = await until(() => filled.find((f) => f.job.id === info.jobId));
  assert.ok(done, "the app answered");
  assert.equal(done.res.tag, "via Claude Code (subscription)");
  assert.match(done.res.text, /Answer from the fake app: What is two plus two\?/);
  const seen = JSON.parse(fs.readFileSync(logFile, "utf8"));
  assert.deepEqual(seen.args, SR.routeById("claude-code").args, "only the fixed flags are on the command line");
  assert.ok(!seen.args.join(" ").includes("two plus two"), "the question is never an argument");
  assert.match(seen.input, /answering a question only/);
  assert.match(seen.input, /What is two plus two\?/);
  assert.deepEqual(seen.keys, [], "no API key reaches the app, so it uses the person's plan");
  assert.notEqual(path.resolve(seen.cwd), path.resolve(ROOT), "it runs in an empty scratch folder");
  delete process.env.ANTHROPIC_API_KEY;

  // the spawn itself: shell false, the prompt on stdin
  const calls = [];
  const { spawn } = await import("node:child_process");
  const spy = (file, args, opts) => { calls.push({ file, args, opts }); return spawn(file, args, opts); };
  const res = await SR.askApp({ ...SR.routeById("claude-code"), path: FAKE }, "Spy question", { spawnImpl: spy, timeoutMs: waitBudget(15000) });
  assert.equal(res.ok, true, res.message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.shell, false);
  assert.ok(!calls[0].args.some((a) => a.includes("Spy question")));
});

test("official app: not signed in, out of quota, or failing falls through to copy it over", async () => {
  process.env.CC_CLAUDE_BIN = FAKE;
  // no sign-in file: the route is "Not signed in" and is never tried
  signIn(false);
  SR.clearStatusCache();
  assert.equal((await SR.allStatus({ refresh: true })).find((r) => r.id === "claude-code").status, "signin");
  let info = AW.openWait({ kind: "single", runId: "s-test4", provider: "anthropic", model: "claude-x", ask: "Q4" });
  let job = await until(() => AW.findJob(info.jobId)?.step === "copy" && AW.findJob(info.jobId));
  assert.deepEqual(job.tried, [], "not tried at all");
  assert.match(AW.publicJob(job).headline, /^Out of API credits\. Answering through your Claude subscription\. Step \d of 3\.$/);
  await AW.stopWait(info.jobId);

  // signed in but the app says it is not: tried, then it sits out until its sign-in file changes
  signIn(true);
  process.env.FAKE_SUBCLI_MODE = "signin";
  info = AW.openWait({ kind: "single", runId: "s-test5", provider: "anthropic", model: "claude-x", ask: "Q5" });
  job = await until(() => AW.findJob(info.jobId)?.step === "copy" && AW.findJob(info.jobId));
  assert.deepEqual(job.tried.map((t) => t.code), ["signin"]);
  assert.equal((await SR.allStatus({ refresh: true })).find((r) => r.id === "claude-code").status, "signin");
  await AW.stopWait(info.jobId);
  SR.clearSignedOut();

  process.env.FAKE_SUBCLI_MODE = "quota";
  info = AW.openWait({ kind: "single", runId: "s-test6", provider: "anthropic", model: "claude-x", ask: "Q6" });
  job = await until(() => AW.findJob(info.jobId)?.step === "copy" && AW.findJob(info.jobId));
  assert.deepEqual(job.tried.map((t) => t.code), ["quota"]);
  assert.match(job.prompt, /MELDMIND ANSWER/);
  await AW.stopWait(info.jobId);
  process.env.FAKE_SUBCLI_MODE = "ok";
});

test("official app: a timeout stops the app and everything it started", async () => {
  const pidFile = path.join(DIR, "fake-hang.json");
  process.env.FAKE_SUBCLI_MODE = "hang"; process.env.FAKE_SUBCLI_PIDFILE = pidFile;
  const res = await SR.askApp({ ...SR.routeById("claude-code"), path: FAKE }, "Hang", { timeoutMs: waitBudget(1500) });
  assert.equal(res.ok, false); assert.equal(res.code, "timeout");
  assert.match(res.message, /took too long and was stopped/);
  const pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
  const gone = await until(() => !alive(pids.pid) && !alive(pids.kid), waitBudget(10000));
  assert.ok(gone, "the app and its child are gone");
  assert.equal(SR.runningCount(), 0);
  process.env.FAKE_SUBCLI_MODE = "ok";
});

test("routes: one ordered chain, status rows from detection, per-route switches, website mode off and confirm-only", async () => {
  assert.deepEqual(SR.CHAIN.map((s) => s.id), ["apps", "website", "copy"]);
  assert.equal(SR.CHAIN_LINE, "1. Official apps on this PC, 2. Website (if you turned it on), 3. You copy it over");
  process.env.CC_CLAUDE_BIN = FAKE; signIn(true);
  process.env.CC_CODEX_BIN = path.join(DIR, "missing-codex");
  SR.clearStatusCache();
  let v = await SR.routesView({ refresh: true });
  const by = Object.fromEntries(v.routes.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(by), ["claude-code", "codex", "gemini-cli", "antigravity"]);
  assert.equal(by["claude-code"].label, "Installed and signed in"); assert.equal(by["claude-code"].on, true);
  assert.equal(by.codex.label, "Not installed");
  assert.match(by.codex.setupUrl, /^https:\/\//);
  assert.equal(v.website, false, "website mode is off by default");
  assert.equal(v.appsNote, "Uses the official app for each AI, signed in with your own plan.");
  assert.ok(![v.websiteWarning, v.websiteLabel, v.chainLine, ...v.routes.map((r) => r.label)].join(" ").includes(EM));
  assert.throws(() => SR.saveRouteSettings({ website: true }), (e) => e.status === 400 && e.needsConfirm === true);
  assert.equal(SR.routeSettings().website, false);
  SR.saveRouteSettings({ website: true, confirm: true });
  assert.equal(SR.routeSettings().website, true);
  SR.saveRouteSettings({ routes: { "claude-code": false } });
  assert.equal((await SR.readyRoutesFor("anthropic")).length, 0, "a route switched off is never tried");
  // with website mode on (stored, not wired) the box says so and the chain still reaches copy it over
  const info = AW.openWait({ kind: "single", runId: "s-test7", provider: "anthropic", model: "claude-x", ask: "Q7" });
  const job = await until(() => AW.findJob(info.jobId)?.step === "copy" && AW.findJob(info.jobId));
  assert.equal(AW.publicJob(job).websiteNote, "Website mode is coming in a later update.");
  await AW.stopWait(info.jobId);
  SR.saveRouteSettings({ routes: { "claude-code": true }, website: false });
  assert.deepEqual(SR.routesFor("xai"), [], "Grok has no official app route: it stays on copy it over");
  delete process.env.CC_CODEX_BIN;
});

test.after(() => {
  SR.stopAllApps();
  for (const d of [DIR, HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});
