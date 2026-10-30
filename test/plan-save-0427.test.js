// 0.4.27 (dogfood batch 2, 3 of 10 worked): plans and saves for named files.
//  1. a plan step whose only job is to save a file is never planned and is dropped when it slips through
//  2. every file the goal names is saved (not only the first), found in the final answer or in any finished step
//  3. scripts (.ps1, .bat, .cmd, .sh ...) and full Windows paths count as named files
//  4. "Run invoice_totals.py" runs the saved script with the system Python and keeps the real output
// Local mock AIs and temp folders only: no real key, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, waitBudget } from "./helpers.js";

const tmp = (p = "ps0427-") => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } };
// the app's own data folder is never touched: every server module is loaded after this
const DATA = tmp("ps0427-data-");
process.env.CC_DATA_DIR = DATA;
test.after(() => rm(DATA));
const { namedFile, namedFiles, isSavableName, isSaveOnlyStep, dropSaveOnlySteps, NO_SAVE_STEP_LINE } = await import("../server/step-guard.js");
const { extractCodeFiles, bodyForFile, markdownTableToCsv } = await import("../server/code-files.js");
const { namedSources } = await import("../server/code-source.js");
const { findPythonCommand, findPython, runPython, runReport, isRunStep, pyMissingLine, resetPythonProbe } = await import("../server/run-node-test.js");
const { saveEveryNamedFile, fenced } = await import("../server/save-named-files.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BS = "\\";
const DOG = ["C:", "Users", "chris", "Desktop", "Everborn", "meldmind-dogfood", "batch-2026-10-30"].join(BS);

// ---------- 1. save-only plan steps ----------
test("1. save-only steps from the dogfood plans are dropped; real work, run steps and MindMedia saves stay", () => {
  for (const title of ["Save CSV to the specified file path", "Save script to the Desktop path", "Save CSV to the Everborn folder path", "Save HTML file to the Desktop folder", "Save script to the required path", "Save reminders to dental-reminders.md", "Write the CSV to disk", "Copy the script to the Desktop"]) {
    assert.equal(isSaveOnlyStep({ title, capability: "research", deps: ["t2"], instructions: "Take the final file from t2 and save it to the folder." }), true, title);
  }
  for (const title of ["Save files, run tests, and verify", "Write tipsplit.js with exact-cent splitting", "Write roof_estimate.py estimator script", "Build formula-driven xlsx and save to path", "Run script and verify totals", "Review script and test rotation logic", "Save it to my MindMedia library", "Save the post to Google Drive", "Write 20 sample leads CSV content"]) {
    assert.equal(isSaveOnlyStep({ title, capability: "writing", deps: ["t1"] }), false, title);
  }
  assert.equal(isSaveOnlyStep({ title: "Save the caption", capability: "save", deps: ["t1"] }), false, "a MindMedia save step is Meldmind's own");
  assert.equal(isSaveOnlyStep({ title: "Save the follow-up notes as followups.md", capability: "writing", deps: ["t2"], instructions: "Write three follow-up ideas and save them as followups.md." }), false, "a step that makes new content stays");
  assert.equal(isSaveOnlyStep({ title: "Save CSV to the specified file path", deps: [] }), false, "with nothing earlier to save, the step makes the file itself");
  assert.equal(isSaveOnlyStep({ title: "Save CSV to the Everborn folder path", deps: ["t2"], instructions: "Write the validated CSV text from t2 to the folder." }), true);
  assert.match(NO_SAVE_STEP_LINE, /Never plan a step whose only job is to save/);
  assert.doesNotMatch(NO_SAVE_STEP_LINE, /—/, "no em-dash");
});

test("1b. dropping a save step rewires the steps after it and never empties a plan", () => {
  const plan = { title: "x", tasks: [
    { id: "t1", title: "Write backup.ps1 with rotation", deps: [] },
    { id: "t2", title: "Review script and test rotation logic", deps: ["t1"] },
    { id: "t3", title: "Save script to the required path", deps: ["t2"] },
    { id: "t4", title: "Run the tests and report output", deps: ["t3", "t1"] },
  ] };
  const { plan: out, dropped } = dropSaveOnlySteps(plan);
  assert.deepEqual(dropped, ["Save script to the required path"]);
  assert.deepEqual(out.tasks.map((t) => t.id), ["t1", "t2", "t4"]);
  assert.deepEqual(out.tasks.find((t) => t.id === "t4").deps.sort(), ["t1", "t2"]);
  const only = { tasks: [{ id: "t1", title: "Save CSV to the specified file path", deps: [] }] };
  assert.equal(dropSaveOnlySteps(only).plan.tasks.length, 1, "a plan of one save step is left alone");
});

test("1c. the planner is told, and the mission drops save steps after planning", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "server", "mission.js"), "utf8");
  assert.match(src, /\$\{NO_SAVE_STEP_LINE\}/, "the planner prompt carries the no-save-step line");
  assert.match(src, /dropSaveOnlySteps\(plan\)/, "a plan that slips through is cleaned");
});

// ---------- 2 and 3. named files ----------
test("2. namedFiles finds every file, full Windows paths, and scripts; Node.js is a product", () => {
  const inv = `Write a Python script ... Save both files in ${DOG}${BS}invoice-total as invoice_totals.py and invoices.csv`;
  assert.deepEqual(namedFiles(inv), ["invoice_totals.py", "invoices.csv"]);
  const tip = `Write a small Node.js program. Put the logic in tipsplit.js exporting splitTips. Also write tipsplit.test.js using node:assert. Save both files in ${DOG}${BS}tip-split`;
  assert.deepEqual(namedFiles(tip), ["tipsplit.js", "tipsplit.test.js"]);
  assert.equal(namedFile(tip), "tipsplit.js", "never 'Node.js'");
  const ps = `Write a PowerShell script that zips a folder (like Backup-2026-10-30.zip). Save it as ${["C:", "Users", "x", "Desktop", "backup.ps1"].join(BS)}`;
  assert.equal(namedFile(ps), "backup.ps1");
  assert.deepEqual(namedFiles(ps), ["backup.ps1"]);
  for (const n of ["run.bat", "go.cmd", "deploy.sh", "q.sql", "a.py", "b.js", "c.csv", "d.md", "e.txt", "f.html", "g.json"]) {
    assert.equal(namedFile(`Save it as ${["C:", "Users", "x", n].join(BS)}`), n, n);
    assert.equal(isSavableName(n), true, n);
  }
  assert.equal(isSavableName("plan.xlsx"), false, "Word and Excel only when the office writer is there");
  assert.equal(isSavableName("plan.xlsx", { office: true }), true);
  // older cases still hold
  assert.equal(namedFile("Build one mobile-friendly landing page, a single index.html, warm cinematic"), "index.html");
  assert.equal(namedFile("Write the plan. Save it to the project as campaign.md."), "campaign.md");
  assert.equal(namedFile("Save as notes.markdown"), "notes.md");
  assert.equal(namedFile("A woman on a beach"), "");
  assert.equal(namedFile("Visit www.example.com for more"), "");
  assert.ok(namedSources("Create 12-row sample invoices.csv").includes("invoices.csv"), "a step that makes a CSV names it");
});

test("2b. a heading with an underscore names its code block ('## invoice_totals.py' was read as totals.py)", () => {
  const out = "## invoice_totals.py\n\n```python\nprint('hi')\n```\n";
  assert.equal(extractCodeFiles(out)[0].name, "invoice_totals.py");
  assert.equal(extractCodeFiles("__app.py__\n```python\nx = 1\n```")[0].name, "app.py", "emphasis underscores are still markdown");
});

test("2c. bodyForFile finds a file in any answer: named block, language block, page, or table", () => {
  const answer = "# Invoice totals\n\nRun it to see each client's total.\n\n| Client | Unpaid |\n|---|---|\n| Acme | 300.50 |\n";
  const step1 = "**File:** invoices.csv\n\n**Contents:**\n\n```csv\nclient,invoice_number,amount,paid\nAcme,INV-1,300.50,no\n```\n";
  const step2 = "## invoice_totals.py\n\n```python\nprint('total')\n```\n\n```text\ntotal\n```\n";
  const texts = [{ text: answer, from: "answer" }, { text: step2, from: "t2" }, { text: step1, from: "t1" }];
  assert.deepEqual(bodyForFile("invoice_totals.py", texts), { body: "print('total')\n", from: "t2", how: "named" });
  const csv = bodyForFile("invoices.csv", texts);
  assert.equal(csv.from, "t1", "the CSV block wins over the answer's summary table");
  assert.match(csv.body, /^client,invoice_number,amount,paid\n/);
  assert.equal(bodyForFile("backup.ps1", [{ text: "Here it is:\n```powershell\nWrite-Host 'hi'\n```\n\n```text\nhi\n```", from: "t1" }]).body, "Write-Host 'hi'\n");
  assert.equal(markdownTableToCsv("| a | b, c |\n|---|---|\n| 1 | **2** |\n"), 'a,"b, c"\n1,2\n');
  assert.equal(bodyForFile("leads.csv", [{ text: "| name | phone |\n| --- | --- |\n| Ann | 555-0100 |\n" }]).how, "table");
  const big = "<!DOCTYPE html><html><body><h1>Home</h1><form></form></body></html>";
  assert.equal(bodyForFile("page.html", [{ text: "<html><body>x</body></html>", from: "answer" }, { text: "```html\n" + big + "\n```", from: "t3" }]).from, "t3", "the whole page, not a stub");
  assert.equal(bodyForFile("notes.txt", [{ text: "```text\nsample output\n```" }]), null, "a text block is sample output, not the file");
});

test("2d. every named file is saved from the step outputs of a fake mission, never overwriting, only when on disk", async () => {
  const data = DATA;
  {
    const tasks = [
      { id: "t1", status: "done", output: "**Contents:**\n\n```csv\nclient,amount\nAcme,1\n```\n" },
      { id: "t2", status: "done", output: "## invoice_totals.py\n\n```python\nprint('ok')\n```\n", notSaved: { files: ["invoice_totals.py"], line: "Not saved: there was no code for invoice_totals.py in this answer." } },
      { id: "t3", status: "done", output: "Run output: ok" },
    ];
    const deliverable = "# Invoice totals\n\nBoth files are below in spirit; the assembler dropped the code.\n";
    const names = ["invoice_totals.py", "invoices.csv", "backup.ps1"];
    const r1 = saveEveryNamedFile({ goal: "x", names, deliverable, tasks, wrote: [], projectId: "", missionId: "m1", office: false });
    const py = r1.find((r) => r.requested === "invoice_totals.py");
    const csv = r1.find((r) => r.requested === "invoices.csv");
    assert.equal(py.ok, true, JSON.stringify(py));
    assert.equal(fs.readFileSync(py.path, "utf8"), "print('ok')\n");
    assert.equal(csv.ok, true, JSON.stringify(csv));
    assert.equal(fs.readFileSync(csv.path, "utf8"), "client,amount\nAcme,1\n");
    const ps = r1.find((r) => r.name === "backup.ps1");
    assert.equal(ps.ok, false);
    assert.match(ps.error, /^Not saved: there was no code for backup\.ps1/);
    // a second run never overwrites the first file
    const r2 = saveEveryNamedFile({ goal: "x", names: ["invoice_totals.py"], deliverable, tasks, wrote: [], office: false });
    assert.equal(r2[0].name, "invoice_totals-2.py");
    assert.ok(fs.existsSync(py.path) && fs.existsSync(r2[0].path));
    // a file a step already wrote is reported from its write, not saved twice
    const r3 = saveEveryNamedFile({ goal: "x", names: ["invoice_totals.py"], deliverable, tasks, wrote: [{ name: "invoice_totals.py", path: py.path, bytes: 12, taskId: "t2" }], office: false });
    assert.equal(r3[0].path, py.path);
    assert.equal(r3[0].inProjectFolder, true);
    // a write that vanished from the disk is not reported saved
    const r4 = saveEveryNamedFile({ goal: "x", names: ["gone.py"], deliverable, tasks, wrote: [{ name: "gone.py", path: path.join(data, "gone.py"), bytes: 3 }], office: false });
    assert.equal(r4[0].ok, false);
    assert.match(r4[0].error, /is not on the disk/);
    // Word and Excel names wait for the office writer
    assert.deepEqual(saveEveryNamedFile({ names: ["plan.xlsx"], deliverable, tasks, office: false }), []);
    let called = null;
    saveEveryNamedFile({ names: ["plan.xlsx"], deliverable: "| a | b |\n|---|---|\n| 1 | 2 |\n", tasks, office: true, save: (o) => { called = o; return { ok: false, name: o.name, error: "test" }; } });
    assert.equal(called.name, "plan.xlsx");
    assert.match(called.text, /\| a \| b \|/, "the office writer gets the answer with the table");
    assert.equal(fenced("a.md", "```js\nx\n```\n").split("\n")[0], "````md a.md", "a fence longer than any inside");
  }
});

test("2e. the finish step saves every named file and copies each one to the asked folder", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "server", "mission.js"), "utf8");
  assert.match(src, /const wantAll = namedFiles\(goal\)/);
  assert.match(src, /saveEveryNamedFile\(\{ goal, names: wantAll, deliverable: mission\.deliverable, tasks: mission\.tasks, wrote/);
  assert.match(src, /const files = \[\.\.\.savedAll\.filter\(\(r\) => r\.ok && r\.path\)/, "the asked-folder copy covers every saved file");
});

// ---------- 4. Python run steps ----------
test("4. a run step for a saved Python script runs it with python -I and keeps the exact output", { timeout: 120000 }, async (t) => {
  assert.deepEqual(findPythonCommand("Run invoice_totals.py and verify totals"), { file: "invoice_totals.py" });
  assert.deepEqual(findPythonCommand("python -I roof_estimate.py 2000 medium"), { file: "roof_estimate.py" });
  assert.deepEqual(findPythonCommand("Run the Python script and report the output"), { file: "" });
  assert.equal(findPythonCommand("node --test a.test.js"), null);
  assert.equal(isRunStep({ title: "Run invoice_totals.py and report totals" }), true);
  assert.equal(isRunStep({ title: "Run script and verify totals" }), true);
  assert.equal(isRunStep({ title: "Write invoice_totals.py script" }), false);
  const dir = tmp("ps0427-py-");
  try {
    const file = path.join(dir, "tiny.py");
    fs.writeFileSync(file, "import sys\nprint('grand total: 875.25')\nprint('isolated', sys.flags.isolated)\n");
    // no Python: said plainly
    const none = await runPython({ file, python: null });
    assert.deepEqual(none, { ran: false, line: pyMissingLine("tiny.py") });
    assert.match(none.line, /^Not run: Python is not installed on this computer/);
    assert.doesNotMatch(none.line, /—/);
    assert.match((await runPython({ file: path.join(dir, "missing.py"), python: { exe: "python", pre: [] } })).line, /missing\.py was not saved/);
    resetPythonProbe();
    const py = findPython();
    if (!py) { t.diagnostic("no Python 3 on this machine: only the not-installed path was checked"); return; }
    const r = await runPython({ file, python: py });
    assert.equal(r.ran, true, JSON.stringify(r));
    assert.equal(r.exit, 0, r.output);
    assert.equal(r.cmd, "python -I tiny.py");
    assert.match(r.output, /grand total: 875\.25/);
    assert.match(r.output, /isolated 1/, "runs in isolated mode");
    const rep = runReport(r);
    assert.match(rep, /^Ran: python -I tiny\.py\nExit code: 0\n\ngrand total: 875\.25/);
    // a script that never ends is stopped
    const slow = path.join(dir, "slow.py");
    fs.writeFileSync(slow, "import time\nprint('start', flush=True)\ntime.sleep(30)\n");
    const s = await runPython({ file: slow, python: py, timeoutMs: 3000 });
    assert.equal(s.ran, true);
    assert.equal(s.exit, null);
    assert.equal(s.timedOut, true);
    assert.match(s.output, /Stopped after 3 seconds/);
    await sleep(500); // let Windows release the folder after the tree is stopped
  } finally { rm(dir); }
});

// ---------- the whole mission, with mock AIs ----------
const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
const PLAN = JSON.stringify({ title: "Invoice totals", assembly: "Report the totals.", tasks: [
  { id: "t1", title: "Make the sample invoice data", capability: "code", difficulty: 1, needWeb: false, deps: [], instructions: "Twelve rows of client, invoice_number, amount, paid.", deliverable: "The CSV rows" },
  { id: "t2", title: "Write invoice_totals.py script", capability: "code", difficulty: 2, needWeb: false, deps: ["t1"], instructions: "Standard library only. Save it as invoice_totals.py.", deliverable: "invoice_totals.py" },
  { id: "t3", title: "Save CSV to the specified file path", capability: "research", difficulty: 1, needWeb: false, deps: ["t1"], instructions: "Save invoices.csv to the folder.", deliverable: "Saved file" },
  { id: "t4", title: "Run invoice_totals.py and report the totals", capability: "code", difficulty: 1, needWeb: false, deps: ["t2", "t3"], instructions: "python invoice_totals.py", deliverable: "Exact output" },
] });
const T1 = "**Contents:**\n\n```csv\nclient,invoice_number,amount,paid\nAcme,INV-1,300.50,no\nBolt,INV-2,95.00,yes\n```\n";
const T2 = "## invoice_totals.py\n\n```python\nprint('Acme: 300.50')\nprint('Grand total unpaid: 300.50')\n```\n";
async function mocks() {
  const seen = { plannerSystem: "" };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    let out;
    if (/Reply with JSON only: \{"capability"/.test(sys)) out = `{"capability":"code","difficulty":2,"needWeb":false,"summary":"mock"}`;
    else if (/Break the goal into/.test(sys)) { seen.plannerSystem = sys; out = PLAN; }
    else if (/You QA another AI/.test(sys)) out = `{"pass":true,"score":9,"issues":[]}`;
    else if (/You assemble/.test(sys)) out = "# Invoice totals\n\nThe script prints each client's unpaid total and the grand total.";
    else if (/TASK: Make the sample invoice data/.test(user)) out = T1;
    else if (/TASK: Write invoice_totals\.py/.test(user)) out = T2;
    else out = "I saved the file to the folder.";
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { seen, base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}

test("5. a whole mission: the save step is left out, both files are saved, and the Python step really runs", { timeout: 300000 }, async () => {
  const m = await mocks();
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "1500", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", PERPLEXITY_API_KEY: "" } });
  try {
    for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
    await s.api("/fallback/settings", { method: "POST", body: { on: false } }).catch(() => {});
    const goal = "Write a Python script that prints each client's unpaid total from invoices.csv. Also create a sample invoices.csv. Save both files as invoice_totals.py and invoices.csv";
    const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
    const posted = await s.api("/mission", { method: "POST", body: { goal, mode: "economy", qa: true, budgetUsd: 2 } });
    assert.equal(posted.status, 202, posted.text);
    let run = null;
    const t0 = Date.now();
    while (!run && Date.now() - t0 < waitBudget(120000)) {
      const x = ((await s.api("/state")).json.missions || []).find((y) => y.kind === "mission" && !before.has(y.id) && ["done", "done-with-errors", "failed"].includes(y.status));
      if (x) run = (await s.api(`/missions/${x.id}`)).json;
      else await sleep(250);
    }
    assert.ok(run, "mission finished\n" + s.log.slice(-800));
    assert.match(m.seen.plannerSystem, /Never plan a step whose only job is to save/);
    const titles = run.tasks.map((t) => t.title);
    assert.ok(!titles.includes("Save CSV to the specified file path"), titles.join(" | "));
    assert.ok(run.log.some((l) => /Left out a step that only saved a file/.test(l.text)), "the log says why");
    const saved = run.savedFiles || [];
    for (const n of ["invoice_totals.py", "invoices.csv"]) {
      const f = saved.find((x) => x.ok && path.basename(String(x.requested || x.name)) === n);
      assert.ok(f, `${n} saved: ${JSON.stringify(saved)}`);
      assert.ok(fs.existsSync(f.path), f.path);
    }
    assert.match(fs.readFileSync(saved.find((x) => /invoices/.test(x.name)).path, "utf8"), /^client,invoice_number,amount,paid\n/);
    const runStep = run.tasks.find((t) => t.title.startsWith("Run invoice_totals.py"));
    assert.ok(runStep, titles.join(" | "));
    assert.doesNotMatch(runStep.output, /only runs node tests/);
    if (findPython()) {
      assert.match(runStep.output, /^Ran: python -I invoice_totals\.py\nExit code: 0\n\nAcme: 300\.50\nGrand total unpaid: 300\.50/, runStep.output);
    } else {
      assert.match(runStep.output, /Python is not installed on this computer/);
    }
    assert.ok(!run.tasks.some((t) => t.notSaved), JSON.stringify(run.tasks.map((t) => t.notSaved)));
  } finally { await s.stop(); await m.close(); }
});
