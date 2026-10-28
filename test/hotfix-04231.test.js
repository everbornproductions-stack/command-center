// 0.4.23.1 hotfix: named files really get saved and run steps really run, with no linked folder, a full path in the task,
// a writing step that names a file; the owner's private routine stays out of plans; the summary tells the truth;
// a dead Grok Bot queue is never used; long job text is never cut off without a note.
// Local mock AIs and temp folders only: no real key, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, waitBudget } from "./helpers.js";
import { stripPrivateRules, cleanPlan, isPrivateRuleStep } from "../server/private-rules.js";
import { namedPaths, namedFolders, namedSources } from "../server/code-source.js";
import { finishedLine } from "../web/dock-context.js";
import { fitJobText, JOB_TEXT_MAX } from "../server/grokbot.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hf04231-")));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } };

// ---------- unit ----------
test("private rules: the owner's commit-and-push and cloud routine is removed, the user's own words are kept", () => {
  const leak = "Write the notes.\nCommit and push to the private GitHub repo when done.\nSave media to G:\\My Drive\\Everborn Cloud\\notes.";
  assert.equal(stripPrivateRules(leak, "write me 3 ideas"), "Write the notes.");
  assert.equal(stripPrivateRules(leak, "write notes and push to github"), leak, "the user asked for it");
  assert.equal(stripPrivateRules("A plain answer. Nothing has been saved anywhere yet.", "x"), "A plain answer.");
  const plan = { title: "t", assembly: "Assemble. Commit and push to GitHub.", tasks: [
    { id: "t1", title: "Write ideas", instructions: "Write 3 ideas.", deps: [] },
    { id: "t2", title: "Commit and push to the private GitHub repo", instructions: "git push", deps: ["t1"] },
    { id: "t3", title: "Check ideas", instructions: "Read them.", deps: ["t2"] },
  ] };
  const { plan: cleaned, dropped } = cleanPlan(plan, "write 3 ideas");
  assert.equal(dropped, 1);
  assert.deepEqual(cleaned.tasks.map((t) => t.id), ["t1", "t3"]);
  assert.deepEqual(cleaned.tasks[1].deps, ["t1"], "the gap is closed");
  assert.equal(cleaned.assembly, "Assemble.");
  assert.equal(isPrivateRuleStep({ title: "Back up files to GitHub and Drive" }, "write ideas"), true);
  assert.equal(isPrivateRuleStep({ title: "Back up files to GitHub and Drive" }, "back up my files to github"), false);
});

test("full paths in a task: the folder is used when it exists, system and secret places never", () => {
  const dir = tmp();
  try {
    const goal = `Fix ${dir}\\cronwords.js and save notes to followups.md`;
    assert.deepEqual(namedPaths(goal).map((p) => p.name), ["cronwords.js"]);
    assert.deepEqual(namedFolders(goal), [dir]);
    assert.deepEqual(namedSources(goal), ["cronwords.js", "followups.md"]);
    assert.deepEqual(namedSources("Write it in Node.js and Next.js, save as app.js"), ["app.js"], "product names are not files");
    assert.deepEqual(namedFolders("Edit C:\\Windows\\System32\\x.js"), []);
    assert.deepEqual(namedFolders("Edit C:\\Users\\someone\\.ssh\\config.json"), []);
    assert.deepEqual(namedFolders("Edit C:\\Users\\someone\\proj\\data\\a.json"), []);
    assert.deepEqual(namedFolders(`Edit ${dir}\\nope\\x.js`), [], "a folder that does not exist");
  } finally { rm(dir); }
});

test("summary line: all done only when every step is clean", () => {
  const clean = { status: "done", tasks: { a: { status: "done" }, b: { status: "done" } } };
  assert.equal(finishedLine(clean), "All 2 steps done.");
  const bad = { status: "done-with-errors", tasks: { a: { status: "done" }, b: { status: "done", notSaved: { line: "x" } }, c: { status: "failed" } } };
  assert.equal(finishedLine(bad), "Finished with problems: 1 of 3 steps worked, 2 did not.");
  assert.match(finishedLine({ status: "done", tasks: { a: { status: "waiting" } } }), /^Finished with problems/);
  assert.match(finishedLine({ status: "done-with-errors", tasks: { a: { status: "done" } } }), /^Finished with problems/);
});

test("job text: a long text is cut on a line break, says how much was left out, and the whole text is in a file", () => {
  assert.equal(fitJobText("short", "j1", "context"), "short");
  const big = Array.from({ length: 6000 }, (_, i) => `line ${i} ${"x".repeat(30)}`).join("\n");
  const out = fitJobText(big, "j-test", "context");
  assert.ok(out.length < big.length);
  assert.match(out, /\[Part of this text was left out: [\d,]+ of [\d,]+ characters\. The whole text is in this file on the sending computer: .+j-test-context\.txt\]$/);
  const file = /file on the sending computer: (.+)\]$/.exec(out)[1];
  assert.equal(fs.readFileSync(file, "utf8"), big);
  fs.rmSync(file, { force: true });
  assert.ok(JOB_TEXT_MAX >= 100000);
  assert.match(out.split("\n\n[Part")[0].split("\n").at(-1), /^line \d+ x+$/, "cut at the end of a whole line");
});

// ---------- end to end against local mock AIs ----------
const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
async function mocks(script) {
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const title = (/TASK: (.*)/.exec(user) || [])[1] || "";
    const out = script({ sys, user, title });
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
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
const FIXED = `const DAYS = ["Sunday", "Monday"];\nfunction cronToWords(expr) { return "Every " + DAYS[1] + " at " + expr; }\nmodule.exports = { cronToWords };\n`;
const TESTFILE = `const assert = require("node:assert");\nconst { cronToWords } = require("./cronwords.js");\nassert.match(cronToWords("0 9 * * 1"), /Monday/);\nconsole.log("All tests passed.");\n`;
const code = (name, text) => `**${name}**\n\`\`\`js\n${text}\`\`\``;
const plan = (goalDir) => JSON.stringify({ title: "Cron words", assembly: "Report what was written and the exact test output.", tasks: [
  { id: "t1", title: "Write cronwords.js", capability: "code", difficulty: 2, needWeb: false, deps: [], instructions: `Save it as cronwords.js${goalDir ? ` in ${goalDir}` : ""}.`, deliverable: "cronwords.js" },
  { id: "t2", title: "Write cronwords.test.js", capability: "code", difficulty: 2, needWeb: false, deps: ["t1"], instructions: "Add cronwords.test.js using node:assert.", deliverable: "cronwords.test.js" },
  { id: "t3", title: "Save the follow-up notes as followups.md", capability: "writing", difficulty: 1, needWeb: false, deps: ["t2"], instructions: "Write three follow-up ideas and save them as followups.md.", deliverable: "followups.md" },
  { id: "t4", title: "Run node cronwords.test.js and report the exact output", capability: "analysis", difficulty: 1, needWeb: false, deps: ["t2"], instructions: "Run node cronwords.test.js and report the exact output.", deliverable: "The exact output" },
  { id: "t5", title: "Commit and push to the private GitHub repo", capability: "agent", difficulty: 1, needWeb: false, deps: ["t4"], instructions: "Commit and push everything to the private GitHub repo and copy it to Google Drive.", deliverable: "pushed" },
] });
const script = (p) => ({ sys, title }) => {
  if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"code","difficulty":2,"needWeb":false,"summary":"mock"}`;
  if (/Break the goal into/.test(sys)) return p;
  if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
  if (/You assemble/.test(sys)) return "The files are saved and the test ran.";
  if (title === "Write cronwords.js") return code("cronwords.js", FIXED);
  if (title === "Write cronwords.test.js") return code("cronwords.test.js", TESTFILE);
  if (/followups\.md/.test(title)) return "1. Ask for a review.\n2. Post a thank-you.\n3. Share a tip.";
  return "Test output: all tests passed.";
};

test("mission: no linked folder still saves the named files and really runs the test; the private push step is left out", { timeout: 300000 }, async () => {
  const m = await mocks(script(plan("")));
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: "Write cronwords.js and cronwords.test.js, save follow-up notes as followups.md, run node cronwords.test.js and report the exact output.", mode: "economy", qa: true, budgetUsd: 2 });
    const writes = run.toolCalls.filter((c) => c.tool === "write_file");
    const names = writes.map((w) => path.basename(w.path)).sort();
    assert.deepEqual(names, ["cronwords.js", "cronwords.test.js", "followups.md"], JSON.stringify(run.toolCalls));
    for (const w of writes) assert.ok(fs.existsSync(w.path) && fs.statSync(w.path).size === w.bytes, `${w.path} is on disk`);
    assert.equal(fs.readFileSync(writes.find((w) => /cronwords\.js$/.test(w.path)).path, "utf8"), FIXED);
    assert.match(fs.readFileSync(writes.find((w) => /followups\.md$/.test(w.path)).path, "utf8"), /Ask for a review/);
    const ran = run.toolCalls.find((c) => c.tool === "run");
    assert.ok(ran && ran.exit === 0 && /All tests passed\./.test(ran.output), "the test really ran");
    assert.ok(!run.tasks.some((t) => /push/i.test(t.title)), "the private push step is gone");
    assert.ok(!run.tasks.some((t) => t.agent), "nothing went to an outside agent");
    assert.doesNotMatch(run.deliverable, /GitHub|Google Drive/i);
    assert.doesNotMatch(run.planNote || "", /Not saved: Meldmind can only show this code here/);
    for (const t of run.tasks) assert.equal(t.notSaved, null, `${t.id}: ${t.notSaved?.line}`);
  } finally { await s.stop(); await m.close(); }
});

test("mission: a full path in the task is the folder the files go to", { timeout: 300000 }, async () => {
  const dir = tmp();
  const m = await mocks(script(plan(dir)));
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: `Write ${dir}\\cronwords.js and cronwords.test.js, save follow-up notes as followups.md, then run node cronwords.test.js.`, mode: "economy", qa: true, budgetUsd: 2 });
    assert.equal(fs.readFileSync(path.join(dir, "cronwords.js"), "utf8"), FIXED);
    assert.equal(fs.readFileSync(path.join(dir, "cronwords.test.js"), "utf8"), TESTFILE);
    assert.ok(fs.existsSync(path.join(dir, "followups.md")));
    const ran = run.toolCalls.find((c) => c.tool === "run");
    assert.equal(ran.exit, 0);
    assert.match(ran.output, /All tests passed\./);
  } finally { await s.stop(); await m.close(); rm(dir); }
});
