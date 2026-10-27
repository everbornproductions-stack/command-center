// 0.4.21 dogfood 12: code steps really write the named files into the project folder, node tests really run,
// nothing is called "done" or "saved" without a record, and a rewrite may not drop the file's exports.
// Local mock AIs and temp folders only: no real key, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, waitBudget } from "./helpers.js";
import { writeProjectFile, insideFolder, codeFor, NOT_SAVED_LINE } from "../server/named-file.js";
import { runNodeTest, parseNodeCommand, runReport, isRunStep, NOT_RUN_LINE } from "../server/run-node-test.js";
import { exportNames, compareExports, exportLossLine } from "../server/export-check.js";
import { claimCheck, isEmptyOutput } from "../server/step-guard.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cw0421-"));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } };

const ORIGINAL = `const DAYS = ["Sunday", "Monday"];\nfunction cronToWords(expr) { return "Every " + DAYS[1] + " " + expr; }\nmodule.exports = { cronToWords };\n`;
const FIXED = `const DAYS = ["Sunday", "Monday"];\nfunction cronToWords(expr) { return "Every " + DAYS[1] + " at " + expr; }\nmodule.exports = { cronToWords };\n`;
const REWRITE = `module.exports = function cronwords(expr) { return expr; };\n`;
const TESTFILE = `const assert = require("node:assert");\nconst { cronToWords } = require("./cronwords.js");\nassert.match(cronToWords("0 9 * * 1"), /Monday/);\nconsole.log("All tests passed.");\n`;

// ---------- unit: write ----------
test("write: the code goes into the project folder, is read back, and the old file's text is returned", () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "cronwords.js"), ORIGINAL);
    const r = writeProjectFile({ folders: [dir], name: "cronwords.js", text: FIXED });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.bytes, Buffer.byteLength(FIXED));
    assert.equal(fs.readFileSync(path.join(dir, "cronwords.js"), "utf8"), FIXED);
    assert.equal(r.before, ORIGINAL);
    assert.equal(r.existed, true);
    const n = writeProjectFile({ folders: [dir], name: "cronwords.test.js", text: TESTFILE });
    assert.equal(n.ok, true); assert.equal(n.existed, false);
    assert.ok(fs.existsSync(path.join(dir, "cronwords.test.js")));
  } finally { rm(dir); }
});

test("write: a path outside the folder is refused (../, absolute, drive letters), and no folder means 'Not saved'", () => {
  const dir = tmp(), outside = tmp();
  try {
    for (const bad of ["../evil.js", "sub/../../evil.js", path.join(outside, "evil.js"), "/etc/evil.js", "C:/evil.js", "~/evil.js"]) {
      const r = writeProjectFile({ folders: [dir], name: bad, text: "x = 1" });
      assert.equal(r.ok, false, bad);
      assert.match(r.error, /^Not saved/);
    }
    assert.equal(fs.readdirSync(outside).length, 0, "nothing was written outside");
    assert.equal(insideFolder(dir, "../x.js"), null);
    assert.ok(insideFolder(dir, "src/x.js").startsWith(path.resolve(dir) + path.sep));
    const none = writeProjectFile({ folders: [], name: "cronwords.js", text: "x = 1" });
    assert.equal(none.ok, false); assert.equal(none.error, NOT_SAVED_LINE);
    assert.equal(NOT_SAVED_LINE, "Not saved: Meldmind can only show this code here.");
    assert.equal(writeProjectFile({ folders: [dir], name: "a.js", text: "  \n" }).ok, false, "nothing to write");
  } finally { rm(dir); rm(outside); }
});

test("codeFor: the block named for the file, else the only block", () => {
  const text = "**cronwords.js**\n```js\nA\n```\n\n**cronwords.test.js**\n```js\nB\n```";
  assert.equal(codeFor(text, "cronwords.test.js").trim(), "B");
  assert.equal(codeFor(text, "other.js"), "");
  assert.equal(codeFor("```js\nonly\n```", "x.js", { onlyName: true }).trim(), "only");
});

// ---------- unit: run ----------
test("run: a node test in a temp project is really run, output and exit code captured; a failing one reports its exit", async () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "cronwords.js"), FIXED);
    fs.writeFileSync(path.join(dir, "cronwords.test.js"), TESTFILE);
    const ok = await runNodeTest({ cmd: "node cronwords.test.js", cwd: dir });
    assert.equal(ok.ran, true); assert.equal(ok.exit, 0); assert.match(ok.output, /All tests passed\./);
    assert.match(runReport(ok), /Ran: node cronwords\.test\.js\nExit code: 0/);
    fs.writeFileSync(path.join(dir, "bad.test.js"), `console.error("boom"); process.exit(3);`);
    const bad = await runNodeTest({ cmd: "node bad.test.js", cwd: dir });
    assert.equal(bad.exit, 3); assert.match(bad.output, /boom/);
    fs.writeFileSync(path.join(dir, "t.test.js"), `const { test } = require("node:test"); test("one", () => {});`);
    const nt = await runNodeTest({ cmd: "node --test t.test.js", cwd: dir });
    assert.equal(nt.ran, true); assert.equal(nt.exit, 0);
  } finally { rm(dir); }
});

test("run: anything that is not a plain node file inside the folder is not run", async () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "ok.js"), "console.log(1)");
    for (const cmd of ["npm test", "node -e \"process.exit(0)\"", "bash x.sh", "node ../x.js", "node a.js && rm -rf x", "python t.py", "node --inspect ok.js", "node ok.js extra", `node ${path.join(os.tmpdir(), "x.js")}`, "rm -rf /"]) {
      const r = await runNodeTest({ cmd, cwd: dir, spawn: () => { throw new Error("must not spawn: " + cmd); } });
      assert.equal(r.ran, false, cmd);
      assert.equal(r.line, NOT_RUN_LINE, cmd);
    }
    assert.equal(NOT_RUN_LINE, "Not run: Meldmind only runs node tests in your project folder.");
    const missing = await runNodeTest({ cmd: "node nope.test.js", cwd: dir });
    assert.equal(missing.ran, false); assert.match(missing.line, /nope\.test\.js was not found/);
    assert.equal(parseNodeCommand("node --test a/b.test.js").cmd, "node --test a/b.test.js");
  } finally { rm(dir); }
});

test("run: spawn is injectable, runs without a shell in the project folder, and a hung process is stopped and trimmed", async () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "x.test.js"), "");
    let seen;
    const fake = (exec, argv, opts) => {
      seen = { exec, argv, opts };
      const { EventEmitter } = require_events();
      const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => { c.killed = true; };
      setTimeout(() => { c.stdout.emit("data", "x".repeat(9000)); c.emit("close", 0); }, 5);
      return c;
    };
    const r = await runNodeTest({ cmd: "node x.test.js", cwd: dir, spawn: fake });
    assert.equal(seen.opts.shell, false); assert.equal(seen.opts.cwd, path.resolve(dir));
    assert.equal(seen.argv.at(-1), path.join(path.resolve(dir), "x.test.js"));
    assert.equal(seen.argv[0], "--permission", "0.4.23 (C1): AI-written code runs fenced in to the project folder");
    assert.ok(r.output.length < 4100, "output trimmed to about 4000 characters");
    let child;
    const hang = () => { const { EventEmitter } = require_events(); child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { child.killed = true; }; return child; };
    const t = await runNodeTest({ cmd: "node x.test.js", cwd: dir, spawn: hang, timeoutMs: 100 });
    assert.equal(t.timedOut, true); assert.equal(child.killed, true); assert.match(t.output, /Stopped after/);
  } finally { rm(dir); }
});
import { EventEmitter } from "node:events";
function require_events() { return { EventEmitter }; }

test("run: a 'run the tests' step is told from a step that writes tests", () => {
  assert.equal(isRunStep({ title: "Run tests and report exact output", instructions: "node cronwords.test.js" }), true);
  assert.equal(isRunStep({ title: "Write plain-Node test file", instructions: "so it can be run with node cronwords.test.js" }), false);
  assert.equal(isRunStep({ title: "Fix bugs in cronwords.js in place" }), false);
  assert.equal(isRunStep({ title: "Run the ad campaign", instructions: "Plan the week" }), false);
});

// ---------- unit: exports, claims, empty ----------
test("exports: a removed or renamed export is found, an added one is fine", () => {
  assert.deepEqual(exportNames(ORIGINAL), ["cronToWords"]);
  assert.deepEqual(exportNames("export function a() {}\nexport const b = 1;\nexport { c, d as e };"), ["a", "b", "c", "e"]);
  assert.deepEqual(exportNames("exports.x = 1; exports.y = 2;"), ["x", "y"]);
  const bad = compareExports(ORIGINAL, REWRITE);
  assert.equal(bad.ok, false); assert.ok(bad.removed.includes("cronToWords"));
  assert.equal(exportLossLine(["cronToWords"]), "Changed the file's exports (cronToWords is gone)");
  assert.equal(compareExports(ORIGINAL, FIXED).ok, true);
  assert.equal(compareExports(ORIGINAL, FIXED + "module.exports.extra = 1;").ok, true);
  assert.equal(compareExports("export function a() {}", "export function b() {}").removed[0], "a");
});

test("claims: 'saved' and 'test output' need a tool record; code inside fences and 'not saved' lines are not claims", () => {
  assert.equal(claimCheck("I saved cronwords.js in place.", []).reason, "Says it saved a file, but nothing was saved.");
  assert.equal(claimCheck("Wrote the file cronwords.test.js", [{ tool: "write_file", ok: true }]).ok, true);
  assert.equal(claimCheck("**Test output:**\n6 passed\nAll tests passed", []).ok, false);
  assert.equal(claimCheck("All 6 tests passed.", [{ tool: "run", ok: true }]).ok, true);
  assert.equal(claimCheck("```js\nconsole.log('All tests passed.')\n```\nHere is the test file.", []).ok, true);
  assert.equal(claimCheck("Not saved: there was no code for cronwords.js in this answer.", []).ok, true);
  assert.equal(claimCheck("Status: both files are not confirmed saved. Nothing was saved.", []).ok, true);
  assert.equal(claimCheck("Fixed file", []).ok, true);
  assert.equal(isEmptyOutput("  \n\u200b "), true);
});

// ---------- end to end against local mock AIs ----------
const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
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
    const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const title = (/TASK: (.*)/.exec(user) || [])[1] || "";
    const key = `${sys.slice(0, 20)}|${title}`;
    const n = (counts.get(key) || 0) + 1; counts.set(key, n);
    seen.push({ prefix, sys, user, title, n });
    const out = script({ prefix, sys, user, title, n });
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}
async function boot(m) {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "1500", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "" } });
  for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
  await s.api("/fallback/settings", { method: "POST", body: { on: false } }).catch(() => {});
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
  throw new Error("mission did not finish\n" + s.log.slice(-600));
}
const GOAL = "Fix cronwords.js in place (keep its exports), add cronwords.test.js with plain Node, run it with node, and report the exact output.";
const PLAN = JSON.stringify({ title: "Fix cronwords", assembly: "Report what was written and the exact test output.", tasks: [
  { id: "t1", title: "Fix bugs in cronwords.js in place", capability: "code", difficulty: 2, needWeb: false, deps: [], instructions: "Fix the day names in cronwords.js and save in place.", deliverable: "The fixed cronwords.js" },
  { id: "t2", title: "Write plain-Node test file", capability: "code", difficulty: 2, needWeb: false, deps: ["t1"], instructions: "Add cronwords.test.js using node:assert.", deliverable: "cronwords.test.js" },
  { id: "t3", title: "Run tests and report exact output", capability: "analysis", difficulty: 1, needWeb: false, deps: ["t2"], instructions: "Run node cronwords.test.js and report the exact output.", deliverable: "The exact output" },
] });
const script = (rewrite) => ({ sys, title }) => {
  if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"code","difficulty":2,"needWeb":false,"summary":"mock"}`;
  if (/Break the goal into/.test(sys)) return PLAN;
  if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
  if (/You assemble/.test(sys)) return "Both files are in place. The tests ran. See the notes below.";
  if (title === "Fix bugs in cronwords.js in place") return `**cronwords.js**\n\`\`\`js\n${rewrite ? REWRITE : FIXED}\`\`\``;
  if (title === "Write plain-Node test file") return `**cronwords.test.js**\n\`\`\`js\n${TESTFILE}\`\`\``;
  return "Test output: all tests passed.";
};
async function projectWith(s, dir) {
  const r = await s.api("/projects", { method: "POST", body: { name: "Cron work", categories: [{ id: "files", name: "Files", links: [{ title: "Folder", url: dir }] }] } });
  assert.equal(r.status, 200, r.text);
  return r.json.id;
}

test("mission: with a project folder the files are written, the tests really run, and the records are on the steps", { timeout: 300000 }, async () => {
  const m = await mocks(script(false));
  const s = await boot(m);
  const dir = fs.realpathSync(tmp());
  try {
    fs.writeFileSync(path.join(dir, "cronwords.js"), ORIGINAL);
    const projectId = await projectWith(s, dir);
    const run = await runMission(s, { goal: GOAL, projectId, mode: "economy", qa: true, budgetUsd: 2 });
    assert.equal(fs.readFileSync(path.join(dir, "cronwords.js"), "utf8"), FIXED, "fixed in place");
    assert.equal(fs.readFileSync(path.join(dir, "cronwords.test.js"), "utf8"), TESTFILE);
    const writes = run.toolCalls.filter((c) => c.tool === "write_file");
    assert.equal(writes.length, 2, JSON.stringify(run.toolCalls));
    assert.ok(writes.every((w) => w.path.startsWith(dir) && w.bytes > 0));
    const t1 = run.tasks.find((t) => t.id === "t1");
    assert.equal(t1.wroteLine, `Wrote cronwords.js (${Buffer.byteLength(FIXED)} bytes)`);
    assert.equal(t1.notSaved, null); assert.equal(t1.notDone, false);
    assert.match(t1.instructions, /Do not change exported names or the shape of exports\./, "editing an existing file keeps its exports");
    const run3 = run.toolCalls.find((c) => c.tool === "run");
    assert.ok(run3, "the run is a tool call"); assert.equal(run3.exit, 0); assert.match(run3.output, /All tests passed\./);
    const t3 = run.tasks.find((t) => t.id === "t3");
    assert.equal(t3.status, "done"); assert.match(t3.output, /Ran: node cronwords\.test\.js\nExit code: 0/); assert.match(t3.output, /All tests passed\./);
    assert.equal(t3.toolRecords[0].tool, "run");
    assert.equal(run.savedFile.ok, true, JSON.stringify(run.savedFile));
    assert.equal(run.incomplete, null, JSON.stringify(run.incomplete));
    assert.match(run.deliverable, /Wrote cronwords\.js \(\d+ bytes\)/);
  } finally { await s.stop(); await m.close(); rm(dir); }
});

test("mission: a rewrite that drops cronToWords is not written, and QA fails the step with the plain reason", { timeout: 300000 }, async () => {
  const m = await mocks(script(true));
  const s = await boot(m);
  const dir = fs.realpathSync(tmp());
  try {
    fs.writeFileSync(path.join(dir, "cronwords.js"), ORIGINAL);
    const projectId = await projectWith(s, dir);
    const run = await runMission(s, { goal: GOAL, projectId, mode: "economy", qa: true, budgetUsd: 2 });
    assert.equal(fs.readFileSync(path.join(dir, "cronwords.js"), "utf8"), ORIGINAL, "the original file is untouched");
    const t1 = run.tasks.find((t) => t.id === "t1");
    assert.equal(t1.qaFailed, true);
    assert.equal(t1.review.pass, false);
    assert.equal(t1.review.issues[0], "Changed the file's exports (cronToWords is gone)");
    assert.notEqual(run.status, "done");
    assert.ok(run.incomplete?.reasons.some((r) => r.taskId === "t1"));
  } finally { await s.stop(); await m.close(); rm(dir); }
});

test("mission: with no project folder nothing is written, the steps say 'Not saved', the plan says so up front, the run says 'Not run'", { timeout: 300000 }, async () => {
  const m = await mocks(script(false));
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: GOAL, mode: "economy", qa: true, budgetUsd: 2 });
    assert.match(run.planNote, /Not saved: Meldmind can only show this code here\./);
    assert.ok(run.log.some((l) => /Not saved: Meldmind can only show this code here\./.test(l.text || l.msg || JSON.stringify(l))), "the plan line is in the log");
    const t1 = run.tasks.find((t) => t.id === "t1");
    assert.equal(t1.notSaved.line, "Not saved: Meldmind can only show this code here.");
    assert.equal(t1.notDone, true, "no green dot");
    assert.match(t1.output, /Not saved: Meldmind can only show this code here\./);
    assert.equal(run.toolCalls.filter((c) => c.tool === "write_file").length, 0);
    const t3 = run.tasks.find((t) => t.id === "t3");
    assert.equal(t3.notDone, true);
    assert.match(t3.output, /^Not run: /);
    assert.equal(run.savedFile.ok, false);
    assert.match(run.savedFile.error, /^Not saved: Meldmind can only show this code here\./);
    assert.match(run.deliverable, /Not saved: Meldmind can only show this code here\./);
    assert.notEqual(run.status, "done");
    assert.ok(run.incomplete.reasons.some((r) => r.kind === "not-saved"));
  } finally { await s.stop(); await m.close(); }
});

test("mission: a step that says it saved a file and shows test output with no record fails QA, even when the AI reviewer passes it", { timeout: 300000 }, async () => {
  const plan = JSON.stringify({ title: "Notes", assembly: "Hand over the notes.", tasks: [
    { id: "t1", title: "Write the code notes", capability: "code", difficulty: 1, needWeb: false, deps: [], instructions: "Explain the helper in a few lines.", deliverable: "Short notes" },
  ] });
  const m = await mocks(({ sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"code","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return plan;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    if (/You assemble/.test(sys)) return "The notes are below.";
    return "I saved the file cronwords.js in place.\n\nTest output:\nAll 6 tests passed.\n\nThe helper turns a cron string into words, one field at a time.";
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: "Explain the cron helper in short notes.", mode: "economy", qa: true, budgetUsd: 1 });
    const t1 = run.tasks.find((t) => t.id === "t1");
    assert.equal(t1.qaFailed, true);
    assert.equal(t1.review.pass, false);
    assert.equal(t1.review.issues[0], "Says it saved a file, but nothing was saved.");
    assert.ok(!m.seen.some((x) => /You QA another AI/.test(x.sys)), "no AI reviewer was needed for a claim with no proof");
    assert.notEqual(run.status, "done");
  } finally { await s.stop(); await m.close(); }
});

test("mission: a step that comes back empty is a failure and goes to the next AI, never 'done' on its own", { timeout: 300000 }, async () => {
  const plan = JSON.stringify({ title: "Summary", assembly: "Hand over the summary.", tasks: [
    { id: "t1", title: "Summarize the helper", capability: "analysis", difficulty: 1, needWeb: false, deps: [], instructions: "Write a short summary of what the helper does.", deliverable: "A summary" },
  ] });
  const m = await mocks(({ sys, title, n }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"analysis","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return plan;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    if (/You assemble/.test(sys)) return "Here is the summary.";
    return n === 1 ? "   " : "The helper turns a cron string into plain words, one field at a time, and handles ranges.";
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: "Summarize what the cron helper does.", mode: "economy", qa: false, budgetUsd: 1 });
    const t1 = run.tasks.find((t) => t.id === "t1");
    assert.equal(t1.retried, true, "the blank answer went to another AI");
    const asked = m.seen.filter((x) => x.title === "Summarize the helper").map((x) => x.prefix);
    assert.ok(asked.length >= 2 && new Set(asked).size >= 2, `two different AIs were asked: ${asked}`);
    assert.match(t1.output, /plain words/);
    assert.equal(t1.status, "done");
  } finally { await s.stop(); await m.close(); }
});
