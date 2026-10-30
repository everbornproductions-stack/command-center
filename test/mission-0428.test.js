// 0.4.28: four mission bugs found by dogfooding the installed 0.4.27 (2026-10-30), each reproduced with fakes.
//  1. loan-calc: Claude Code (your plan) answered "You've hit your session limit · resets 2:30pm". It counted as a
//     provider error, so it was asked again, the step failed and every step after it was "Input missing".
//  2. chrome-ext: three named code blocks (manifest.json, popup.html, popup.js) were judged as one JSON document:
//     "The JSON is cut off", three carry-ons, then a failed step.
//  3. task-schedule: the goal named desktop-cleanup.ps1, the AI called its script something else and added usage
//     snippets: "Not saved: there was no code for desktop-cleanup.ps1 in this answer."
//  4. tip-split: tipsplit.test.js was replaced by 18 bytes ("All tests passed.") from the run step's answer.
// The evidence texts below are copied from the dogfood mission.json files (trimmed). In-process, a fake Claude Code,
// fake keys that are never sent anywhere, one loopback mock. No network, no data/ folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT, startMockOpenAI } from "./helpers.js";

const DIR = tmpDir("cc-m0428-");
const HOME = tmpDir("cc-m0428-home-");
const mock = await startMockOpenAI({ inTok: 10, outTok: 10 });
after(() => mock.close());

Object.assign(process.env, {
  CC_DATA_DIR: DIR, CC_SUBCLI_HOME: HOME, CC_SUBCLI_NO_PATH: "1", CC_SUBCLI_EXEC: process.execPath,
  CC_CLAUDE_BIN: path.join(ROOT, "test", "fixtures", "fake-sub-cli.mjs"), CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "off",
  CC_BASE_URL_GROQ: `${mock.base}/groq/v1`, GROQ_API_KEY: "gsk_test_never_sent",
});
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "MISTRAL_API_KEY", "PERPLEXITY_API_KEY"]) process.env[k] = "";
delete process.env.CC_DEV_OWNER;

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const L = await import("../server/cli-limit.js");
const SR = await import("../server/sub-routes.js");
const PF = await import("../server/plan-first.js");
const FB = await import("../server/fallback.js");
const AGY = await import("../server/antigravity-cli.js");
const { rank } = await import("../server/router.js");
const { streamChat } = await import("../server/providers.js");
const G = await import("../server/step-guard.js");
const C = await import("../server/code-files.js");
const S = await import("../server/save-named-files.js");
const M = await import("../server/mission.js");

const credentials = path.join(HOME, ".claude", ".credentials.json");
fs.mkdirSync(path.dirname(credentials), { recursive: true });
fs.writeFileSync(credentials, "{}");
store.putDoc("settings", { ...(store.doc("settings", () => ({})) || {}), planFirst: true });
FB.saveFallbackSettings({ freeOnly: false }); // only a free Groq key is saved here, which would turn Free only on by itself

const LIMIT_LINE = "You've hit your session limit \u00b7 resets 2:30pm (America/Los_Angeles)";
const missionSrc = fs.readFileSync(path.join(ROOT, "server", "mission.js"), "utf8").replace(/\r\n/g, "\n");

// ---------- 1. a CLI agent's session or usage limit is a limit ----------
test("the loan-calc limit line is read as a limit with its own reset time, in plain words", () => {
  const now = Date.UTC(2026, 9, 30, 20, 18, 0); // 1:18 PM in Los Angeles
  const lim = L.cliLimit(LIMIT_LINE, { now });
  assert.ok(lim, "it is a limit");
  assert.equal(lim.resetAt - now, 72 * 60 * 1000, "rests until 2:30 PM Los Angeles time");
  const p = SR.plainCliError(`\n${LIMIT_LINE}`, "Claude Code");
  assert.equal(p.code, "quota");
  assert.match(p.message, /out of its own plan's quota right now\. It resets at 2:30pm \(America\/Los_Angeles\)\./);
  assert.ok(p.until > Date.now());
  assert.doesNotMatch(p.message, /\u2014/);
  // no reset time: a few hours
  const none = L.cliLimit("Usage limit reached for your plan. Try again later.", { now });
  assert.equal(none.resetAt, null);
  assert.equal(none.until - now, L.LIMIT_REST_MS);
  assert.ok(L.LIMIT_REST_MS >= 2 * 3600 * 1000, "a few hours, not minutes");
});

test("Codex, Gemini CLI and Antigravity limit wording counts too, and an ordinary failure does not", () => {
  const now = Date.UTC(2026, 9, 30, 20, 0, 0);
  for (const s of [
    "You've hit your usage limit. Upgrade to Pro or try again in 2 days 3 hours.",
    "5-hour limit reached \u2219 resets 3pm",
    "Weekly limit reached \u00b7 resets Oct 31, 9am",
    "Claude AI usage limit reached|" + Math.floor((now + 3600e3) / 1000),
    "RESOURCE_EXHAUSTED: You have exhausted your capacity on this model. Your quota will reset after 3h12m.",
    "Quota exceeded for quota metric 'Gemini requests' and limit 'requests per day'",
    "Model quota reached. Resets in 3h 12m",
  ]) assert.ok(L.cliLimit(s, { now }), s);
  assert.equal(L.resetAtFrom("try again in 2 days 3 hours", now) - now, (48 + 3) * 3600e3);
  assert.equal(L.resetAtFrom("Your quota will reset after 3h12m.", now) - now, (3 * 60 + 12) * 60e3);
  assert.equal(L.cliLimit("SyntaxError: Unexpected token", { now }), null);
  assert.equal(SR.plainCliError("SyntaxError: Unexpected token", "Claude Code").code, "failed");
  // a real answer that talks about rate limits is an answer
  assert.equal(L.cliLimit("The API rate limit is 100 requests per minute, so batch the calls.", { short: true, now }), null);
  const a = AGY.plainAgyError("Model quota reached. Resets in 3h 12m");
  assert.equal(a.code, "quota");
  assert.match(a.message, /Antigravity is out of quota right now\. It resets in 3h 12m\./);
  assert.ok(a.until > Date.now());
});

test("Claude Code saying its session limit (exit 1 or exit 0) is a limit, not an answer", async () => {
  const route = SR.routeById("claude-code");
  for (const mode of ["session", "session-ok"]) {
    process.env.FAKE_SUBCLI_MODE = mode;
    const r = await SR.askApp({ ...route, path: process.env.CC_CLAUDE_BIN }, "Hello", { timeoutMs: 20000 });
    assert.equal(r.ok, false, mode);
    assert.equal(r.code, "quota", mode);
    assert.match(r.message, /resets at 2:30pm/, mode);
    assert.ok(r.until > Date.now(), mode);
  }
  delete process.env.FAKE_SUBCLI_MODE;
});

test("the worker rests until the reset time, leaves the ranking, and smart fallback gives the step to the next AI", async () => {
  await SR.allStatus({ refresh: true });
  const job = { capability: "math", difficulty: 1, mode: "balanced" };
  assert.ok(rank(job).some((m) => m.provider === "plan-claude-code"), "Claude Code (your plan) is ready first");
  process.env.FAKE_SUBCLI_MODE = "session";
  let thrown = null;
  try { for await (const _ of streamChat({ provider: "plan-claude-code", model: "plan-claude-code", messages: [{ role: "user", content: "Specify the amortization formula" }] })) { /* drain */ } } catch (e) { thrown = e; }
  assert.ok(thrown, "the call fails");
  assert.equal(thrown.status, 429);
  assert.equal(thrown.limit, true);
  assert.equal(FB.troubleKind(thrown), "credits", "counted like no credits, never a provider error that is asked again");
  assert.equal(FB.isLimitError(thrown), true);
  const back = PF.restingUntil("claude-code");
  assert.ok(back > Date.now(), "resting");
  assert.ok(back - Date.now() <= 24 * 3600e3, "until its own reset time (2:30 PM), not a fixed hour");
  assert.equal(PF.outOfQuota("claude-code"), true);
  assert.equal(PF.outOfQuota("claude-code", back + 1000), false, "back after the reset time");
  assert.equal(rank(job).some((m) => m.provider === "plan-claude-code"), false, "it sits out of the ranking");
  assert.ok(PF.planMeterView().routes.find((r) => r.id === "claude-code").backAt >= back - 1000);

  // the whole step through smart fallback: Claude Code is benched mid-run and the next AI answers
  PF.noteAnswer("claude-code"); // clear the rest so the step starts on Claude Code, as in the dogfood run
  const skip = new Set();
  const events = [];
  let text = "";
  for await (const ev of FB.fallbackChat({ allowStandIn: true, provider: "plan-claude-code", model: "plan-claude-code", messages: [{ role: "user", content: "Specify the amortization formula" }] }, { role: "work", cls: { capability: "math", difficulty: 1 }, skipProviders: skip })) {
    events.push(ev.type);
    if (ev.type === "delta") text += ev.text;
    if (ev.type === "fallback") assert.equal(ev.kind, "credits");
  }
  assert.ok(events.includes("fallback"), "handed on");
  assert.ok(events.includes("done"), "the step finished on another AI");
  assert.match(text, /bakery/i, "the loopback answer");
  assert.ok(skip.has("plan-claude-code"), "Claude Code is left out of the rest of this run");
  assert.equal(PF.outOfQuota("claude-code"), true);
  delete process.env.FAKE_SUBCLI_MODE;
});

test("Antigravity at its limit rests and leaves the router until its reset time", () => {
  const until = AGY.noteAgyLimit(Date.now() + 2 * 3600e3);
  assert.ok(AGY.agyRestingUntil() >= until - 1000);
  assert.deepEqual(AGY.routeModels(), []);
  const def = AGY.noteAgyLimit(null);
  assert.ok(def - Date.now() >= L.LIMIT_REST_MS - 5000, "no reset time: a few hours");
});

test("a re-assigned step that hits a limit is handed to the next AI (up to three) instead of failing the mission", () => {
  assert.match(missionSrc, /if \(isLimitError\(err\)\) runTrouble\(t\.provider\);/);
  assert.match(missionSrc, /for \(let hand = 0; alt && !ctl\.signal\.aborted && hand < 3; hand\+\+\)/);
  assert.match(missionSrc, /alt = \(isLimitError\(err2\) \|\| troubleKind\(err2\)\) \? nextAlt\(\) : null;/);
  assert.match(missionSrc, /if \(isLimitError\(err2\)\) runTrouble\(alt\.provider\);/);
});

test("the plan line never says an AI stands in for itself", () => {
  assert.equal(M.plannerLine({ provider: "google", model: "gemini-3.6-flash" }, { for: "google" }), "Google Gemini is drawing up the plan.");
  assert.equal(M.plannerLine({ provider: "google", model: "gemini-3.6-flash" }, { for: "google", forModel: "gemini-3.8-flash" }), "Gemini 3.6 Flash is drawing up the plan (standing in for Gemini 3.8 Flash).");
  assert.equal(M.plannerLine({ provider: "anthropic", model: "claude-haiku-5-5" }, { for: "openai" }), "Claude is drawing up the plan (standing in for ChatGPT).");
  assert.equal(M.plannerLine({ provider: "anthropic", model: "claude-haiku-5-5" }, null), "Claude is drawing up the plan.");
  assert.doesNotMatch(missionSrc, /is drawing up the plan \(standing in for \$\{stoodFor\}\)/);
});

// ---------- 2. each named code block is judged on its own ----------
const MANIFEST = `{
  "manifest_version": 3,
  "name": "Selection Word Counter",
  "version": "1.0.0",
  "description": "Counts the number of words in the currently selected text on the active tab.",
  "permissions": [
    "activeTab",
    "scripting"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Count Selected Words"
  }
}`;
const POPUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Word Counter</title>
  <style>
    body { margin: 0; padding: 14px 16px; width: 220px; }
    .count { font-size: 24px; font-weight: 700; color: #2563eb; }
  </style>
</head>
<body>
  <h1>Word Count</h1>
  <div id="output" class="muted">Checking selection...</div>
  <script src="popup.js"></script>
</body>
</html>`;
const POPUP_JS = `document.addEventListener("DOMContentLoaded", async () => {
  const output = document.getElementById("output");
  const showMessage = (text) => {
    output.className = "muted";
    output.textContent = text;
  };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showMessage("No active tab found.");
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString()
    });
    const selectedText = (results && results[0] && results[0].result) || "";
    const words = selectedText.trim().split(/\\s+/).filter(Boolean);
    showMessage(words.length ? \`\${words.length} words selected\` : "No text selected.");
  } catch (err) {
    showMessage("Cannot read selection on this page (restricted browser or Web Store page).");
  }
});`;
const extAnswer = (m = MANIFEST, h = POPUP_HTML, j = POPUP_JS) => `**manifest.json**\n\`\`\`json\n${m}\n\`\`\`\n\n**popup.html**\n\`\`\`html\n${h}\n\`\`\`\n\n**popup.js**\n\`\`\`javascript\n${j}\n\`\`\``;

test("chrome-ext: three complete named blocks are not cut off, judged as a JSON, JS or HTML file", () => {
  for (const ext of ["json", "js", "html"]) {
    assert.deepEqual(G.checkTruncation(extAnswer(), { ext }), { truncated: false, reason: "" }, ext);
    assert.equal(G.judgeStep(extAnswer(), { ext, title: "Write manifest, popup HTML and popup script", goal: "Build a tiny Chrome extension (Manifest V3) that counts the words in the text you select" }).ok, true, ext);
  }
  // the AI's own "the response was already complete" lines after the blocks change nothing
  assert.equal(G.checkTruncation(`${extAnswer()}\nThe response was actually already complete, so there is no remaining content to output.\n`, { ext: "json" }).truncated, false);
  // a single fenced JSON file that parses is fine too (it was cut off before because the fence is not JSON)
  assert.equal(G.checkTruncation(`Here it is:\n\`\`\`json\n${MANIFEST}\n\`\`\`\n`, { ext: "json" }).truncated, false);
});

test("chrome-ext: only the block that is really unfinished is flagged, and real truncation is still caught", () => {
  const cutJson = G.checkTruncation(extAnswer(MANIFEST.slice(0, MANIFEST.indexOf('"action"'))), { ext: "json" });
  assert.equal(cutJson.truncated, true);
  assert.match(cutJson.reason, /manifest\.json/);
  const cutJs = G.checkTruncation(extAnswer(MANIFEST, POPUP_HTML, POPUP_JS.slice(0, POPUP_JS.lastIndexOf("}"))), { ext: "json" });
  assert.equal(cutJs.truncated, true);
  assert.match(cutJs.reason, /popup\.js/);
  assert.doesNotMatch(cutJs.reason, /manifest|popup\.html/);
  const cutHtml = G.checkTruncation(extAnswer(MANIFEST, POPUP_HTML.replace("</html>", "")), { ext: "js" });
  assert.equal(cutHtml.truncated, true);
  assert.match(cutHtml.reason, /popup\.html/);
  // an unclosed fence, an unclosed <html>, JSON that stops mid-object: all still cut off
  assert.equal(G.checkTruncation(extAnswer().replace(/```$/, ""), { ext: "json" }).truncated, true);
  assert.equal(G.checkTruncation("<!doctype html><html><body><p>Half a pa", { ext: "html" }).truncated, true);
  assert.equal(G.checkTruncation('{"manifest_version": 3, "name": "x",', { ext: "json" }).truncated, true);
  assert.equal(G.checkTruncation('{"a": [1, 2', { ext: "json" }).truncated, true);
  assert.equal(G.checkTruncation("```json\n{\"a\": [1, 2\n```", { ext: "json" }).truncated, true);
});

// ---------- 3. the main block is saved under the asked name ----------
const PS_SCRIPT = `<#
.SYNOPSIS
    Moves files older than 30 days from the Desktop to 'Desktop\\Old Files' and registers
    a daily Windows Scheduled Task ('Daily Desktop Cleanup') at 6:00 PM.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [int]$DaysOld = 30,
    [string]$TaskName = 'Daily Desktop Cleanup',
    [switch]$RunCleanupOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$DesktopPath  = [Environment]::GetFolderPath('Desktop')
$TargetFolder = Join-Path -Path $DesktopPath -ChildPath 'Old Files'
$CutoffDate   = (Get-Date).AddDays(-$DaysOld)
if (-not (Test-Path -LiteralPath $TargetFolder -PathType Container)) {
    if ($PSCmdlet.ShouldProcess($TargetFolder, 'Create destination directory')) {
        New-Item -Path $TargetFolder -ItemType Directory -Force | Out-Null
    }
}
$FilesToMove = @(Get-ChildItem -LiteralPath $DesktopPath -File | Where-Object { $_.LastWriteTime -lt $CutoffDate })
foreach ($File in $FilesToMove) {
    $DestinationPath = Join-Path -Path $TargetFolder -ChildPath $File.Name
    if ($PSCmdlet.ShouldProcess($File.FullName, "Move to '$DestinationPath'")) {
        Move-Item -LiteralPath $File.FullName -Destination $DestinationPath -Force
    }
}
if (-not $RunCleanupOnly) {
    $TaskArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$PSCommandPath\`" -RunCleanupOnly"
    if ($PSCmdlet.ShouldProcess($TaskName, 'Register daily Scheduled Task at 6:00 PM')) {
        $Action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $TaskArguments
        $Trigger = New-ScheduledTaskTrigger -Daily -At '6:00PM'
        Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Force | Out-Null
    }
}`;
const TASK_STEP = `Here is the complete PowerShell script (\`Register-And-Run-DesktopCleanup.ps1\`). It uses \`[CmdletBinding(SupportsShouldProcess = $true)]\` to support \`-WhatIf\`.

### PowerShell Script

\`\`\`powershell
${PS_SCRIPT}
\`\`\`

### Usage

1. **Preview actions without making changes (\`-WhatIf\`):**
 \`\`\`powershell
   .\\DesktopCleanup.ps1 -WhatIf
   \`\`\`
2. **Register the scheduled task and run the cleanup immediately:**
 \`\`\`powershell
   .\\DesktopCleanup.ps1
   \`\`\`
3. **Run only the file cleanup (used automatically by the scheduled task):**
 \`\`\`powershell
   .\\DesktopCleanup.ps1 -RunCleanupOnly
   \`\`\``;

test("task-schedule: with no block named for desktop-cleanup.ps1, the clear main PowerShell block is the file", () => {
  const b = C.bodyForFile("desktop-cleanup.ps1", [{ text: TASK_STEP, from: "t1" }]);
  assert.ok(b, "found");
  assert.equal(b.how, "main");
  assert.match(b.body, /\[CmdletBinding\(SupportsShouldProcess = \$true\)\]/);
  assert.match(b.body, /Register-ScheduledTask/);
  // the finish step saves it under the asked name
  const saved = [];
  const out = S.saveEveryNamedFile({ goal: "Save it as C:\\Users\\pat\\Desktop\\x\\desktop-cleanup.ps1", names: ["desktop-cleanup.ps1"], deliverable: "", tasks: [{ id: "t1", title: "Design and write PowerShell script", status: "done", output: TASK_STEP }], save: ({ name, text }) => { saved.push({ name, text }); return { ok: true, name, requested: name, path: null, bytes: text.length }; } });
  assert.equal(out[0].ok, true, JSON.stringify(out[0]));
  assert.equal(saved[0].name, "desktop-cleanup.ps1");
  assert.match(saved[0].text, /param \(/);
  assert.doesNotMatch(saved[0].text, /^\s*\.\\DesktopCleanup\.ps1 -WhatIf\s*$/m);
});

test("task-schedule: a block under a full Windows path heading is named for that file", () => {
  const files = C.extractCodeFiles(`**File:** \`C:\\Users\\chris\\Desktop\\Everborn\\x\\desktop-cleanup.ps1\`\n\n\`\`\`powershell\n${PS_SCRIPT}\n\`\`\`\n`);
  assert.equal(files[0].name, "desktop-cleanup.ps1");
  assert.equal(C.extractCodeFiles("## invoice_totals.py\n```python\nx = 1\n```\n")[0].name, "invoice_totals.py", "0.4.27 names still work");
});

test("task-schedule: two scripts of about the same size stay a question, never a guess", () => {
  const two = "```python\ndef main():\n    a = 1\n    b = 2\n    print(a + b)\n```\n\n```python\ndef main():\n    c = 3\n    d = 4\n    print(c * d)\n```\n";
  assert.equal(C.bodyForFile("calc.py", [{ text: two, from: "t1" }]), null);
  assert.equal(C.mainBlock([{ text: "a\nb\nc" }, { text: "d\ne" }]), null, "not clearly bigger");
  assert.ok(C.mainBlock([{ text: "1\n2\n3\n4\n5\n6" }, { text: "x" }, { text: "y\nz" }]), "three times the lines");
  const named = "**calc.py**\n```python\nprint(1)\n```\n\n```python\ndef main():\n    pass\n" + "    x = 1\n".repeat(20) + "```\n";
  assert.equal(C.bodyForFile("calc.py", [{ text: named, from: "t1" }]).how, "named", "a block named for the file always wins");
});

// ---------- 4. a run step's output never replaces the written file ----------
const TEST_FILE = `'use strict';

const assert = require('node:assert');
const { splitTips } = require('./tipsplit');

{
  const result = splitTips(40, [
    { name: 'Ana', hours: 10 },
    { name: 'Ben', hours: 30 },
  ]);
  assert.strictEqual(result[0].amount, 10);
  assert.strictEqual(result[1].amount, 30);
}

console.log('All tests passed.');
`;
const T2 = `**tipsplit.test.js**\n\n\`\`\`javascript\n${TEST_FILE}\`\`\``;
const T3 = "**tipsplit.test.js**\n\n```\nAll tests passed.\n```\n\nNo changes were needed.";

test("tip-split: plain sentences are not code, and run or verify steps are told apart from writing steps", () => {
  assert.equal(C.looksLikeCode("All tests passed.\n", "js"), false);
  assert.equal(C.looksLikeCode(TEST_FILE, "js"), true);
  assert.equal(C.looksLikeCode("All done. The script ran.", "py"), false);
  assert.equal(C.looksLikeCode("Get-ChildItem -Path $env:USERPROFILE", "ps1"), true);
  assert.equal(C.looksLikeCode("Any words at all", "md"), true, "a text file is never refused for having words");
  assert.equal(S.isCheckStep({ title: "Run tests and fix any failures" }), true);
  assert.equal(S.isCheckStep({ title: "Verify calculator output against reference values" }), true);
  assert.equal(S.isCheckStep({ title: "Write tipsplit.test.js using node:assert" }), false);
  assert.equal(S.isCheckStep({ title: "Anything", run: true }), true);
});

test("tip-split: the finish step keeps the writing step's file and copies only that version", () => {
  const dir = tmpDir("cc-m0428-tip-");
  const file = path.join(dir, "tipsplit.test.js");
  fs.writeFileSync(file, "All tests passed.\n"); // what the 0.4.27 run step left on the disk (18 bytes)
  const tasks = [
    { id: "t2", title: "Write tipsplit.test.js using node:assert", status: "done", output: T2, writes: [{ name: "tipsplit.test.js", path: file, bytes: Buffer.byteLength(TEST_FILE) }] },
    { id: "t3", title: "Run tests and fix any failures", status: "done", output: T3, writes: [{ name: "tipsplit.test.js", path: file, bytes: 18 }] },
  ];
  const wrote = tasks.flatMap((t) => t.writes.map((w) => ({ ...w, taskId: t.id })));
  assert.equal(S.lastGoodWrite("tipsplit.test.js", wrote, tasks).taskId, "t2", "the writing step's write, not the run step's");
  const saved = [];
  const save = ({ name, text }) => { const p = path.join(dir, `saved-${name}`); const body = C.extractCodeFiles(text)[0].text; fs.writeFileSync(p, body); saved.push(body); return { ok: true, name, requested: name, path: p, bytes: Buffer.byteLength(body) }; };
  const out = S.saveEveryNamedFile({ goal: "write tipsplit.test.js", names: ["tipsplit.test.js"], deliverable: "", tasks, wrote, save });
  assert.equal(out[0].ok, true);
  assert.equal(saved.length, 1, "saved again from the writing step, because the disk copy was replaced");
  assert.match(saved[0], /require\('node:assert'\)/);
  assert.doesNotMatch(fs.readFileSync(out[0].path, "utf8"), /^All tests passed\.\n?$/);
  assert.ok(out[0].bytes > 100);
  // with no writing step at all, the run step's plain sentences are still not saved as a .js file
  const lone = S.saveEveryNamedFile({ goal: "x", names: ["tipsplit.test.js"], deliverable: "", tasks: [tasks[1]], wrote: [], save });
  assert.equal(lone[0].ok, false);
});

// Lead decision: "Run tests and fix any failures" is meant to fix the code. A check step's corrected FULL file wins
// (real code, at least 60 percent of the writer's length); a snippet or an output line never does.
const FIXED_TEST_FILE = TEST_FILE.replace("assert.strictEqual(result[1].amount, 30);", "assert.strictEqual(result[1].amount, 30);\n  assert.strictEqual(result.length, 2);");
const T3_FIXED = `Ran the tests and fixed one assertion.\n\n**tipsplit.test.js**\n\n\`\`\`javascript\n${FIXED_TEST_FILE}\`\`\``;
const T3_SNIPPET = "Fixed it:\n\n**tipsplit.test.js**\n\n```javascript\nassert.strictEqual(result.length, 2);\n```";

test("full-file rule: 60 percent of the writer's length, real code only", () => {
  assert.equal(S.FULL_FILE_SHARE, 0.6);
  assert.equal(S.fullReplacement(600, 1000), true);
  assert.equal(S.fullReplacement(599, 1000), false);
  assert.equal(S.fullReplacement(18, 3478), false, "the 0.4.27 output line");
  assert.equal(S.fullReplacement(10, 0), true, "nothing written before");
});

test("tip-split: a check step's corrected full file wins over the writer's version", () => {
  const dir = tmpDir("cc-m0428-fix-");
  const file = path.join(dir, "tipsplit.test.js");
  fs.writeFileSync(file, FIXED_TEST_FILE);
  const tasks = [
    { id: "t2", title: "Write tipsplit.test.js using node:assert", status: "done", output: T2, writes: [{ name: "tipsplit.test.js", path: file, bytes: Buffer.byteLength(TEST_FILE) }] },
    { id: "t3", title: "Run tests and fix any failures", status: "done", output: T3_FIXED, writes: [{ name: "tipsplit.test.js", path: file, bytes: Buffer.byteLength(FIXED_TEST_FILE) }] },
  ];
  const wrote = tasks.flatMap((t) => t.writes.map((w) => ({ ...w, taskId: t.id })));
  assert.equal(S.lastGoodWrite("tipsplit.test.js", wrote, tasks).taskId, "t3", "the corrected full file is the last good write");
  const out = S.saveEveryNamedFile({ goal: "x", names: ["tipsplit.test.js"], deliverable: "", tasks, wrote, save: () => assert.fail("no re-save needed") });
  assert.equal(out[0].ok, true);
  assert.equal(out[0].fromStep, "t3");
  // from the answers alone (nothing written): the check step's full file is taken, newest first
  const saved = [];
  const save = ({ name, text }) => { const body = C.extractCodeFiles(text)[0].text; saved.push(body); return { ok: true, name, requested: name, path: null, bytes: body.length }; };
  S.saveEveryNamedFile({ goal: "x", names: ["tipsplit.test.js"], deliverable: "", tasks: tasks.map((t) => ({ ...t, writes: [] })), wrote: [], save });
  assert.match(saved[0], /assert\.strictEqual\(result\.length, 2\);/, "the fixed version");
});

test("tip-split: a short snippet or an output line from a check step never replaces the writer's file", () => {
  const dir = tmpDir("cc-m0428-snip-");
  const file = path.join(dir, "tipsplit.test.js");
  fs.writeFileSync(file, TEST_FILE);
  for (const [out3, bytes] of [[T3_SNIPPET, 40], [T3, 18]]) {
    const tasks = [
      { id: "t2", title: "Write tipsplit.test.js using node:assert", status: "done", output: T2, writes: [{ name: "tipsplit.test.js", path: file, bytes: Buffer.byteLength(TEST_FILE) }] },
      { id: "t3", title: "Run tests and fix any failures", status: "done", output: out3, writes: [{ name: "tipsplit.test.js", path: path.join(dir, "other.js"), bytes }] },
    ];
    const wrote = tasks.flatMap((t) => t.writes.map((w) => ({ ...w, taskId: t.id })));
    assert.equal(S.lastGoodWrite("tipsplit.test.js", wrote, tasks).taskId, "t2");
    const saved = [];
    const save = ({ name, text }) => { const body = C.extractCodeFiles(text)[0].text; saved.push(body); return { ok: true, name, requested: name, path: null, bytes: body.length }; };
    S.saveEveryNamedFile({ goal: "x", names: ["tipsplit.test.js"], deliverable: "", tasks: tasks.map((t) => ({ ...t, writes: [] })), wrote: [], save });
    assert.match(saved[0], /require\('node:assert'\)/, "the writer's full file, not the snippet");
  }
});

test("tip-split: the step write and the asked-folder copy follow the full-file rule and say why", () => {
  assert.match(missionSrc, /if \(code && fullReplacement\(bytes, by\.bytes\)\) \{ log\(`Saved \$\{j\.name\} from "\$\{t\.title\}": a corrected full file/);
  assert.match(missionSrc, /under 60 percent of the \$\{by\.bytes\} bytes written/);
  assert.match(missionSrc, /did not replace it: \$\{k\.why\}\./);
  assert.match(missionSrc, /\|\| fullReplacement\(w\.bytes, prev\.bytes\)\) lastWrites\.set\(k, w\);/);
});

test("tip-split: a block with no code never replaces a file, and only one copy per file goes to the asked folder", () => {
  assert.match(missionSrc, /const code = looksLikeCode\(j\.code, fileExt\(j\.name\)\);/);
  assert.match(missionSrc, /Not saved: the block for \$\{j\.name\} had no code in it\./);
  assert.match(missionSrc, /if \(seen\.has\(k\) \|\| seenName\.has\(n\)\) return false;/);
  assert.doesNotMatch(missionSrc, /\.\.\.wrote\.filter\(\(w\) => w\.path\)\];/);
});

test("no em-dashes in the new user-facing lines", () => {
  for (const f of ["cli-limit.js", "save-named-files.js", "code-files.js"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "server", f), "utf8"), /\u2014/, f);
  assert.doesNotMatch(L.limitMessage("Claude Code", L.cliLimit(LIMIT_LINE)), /\u2014/);
  assert.doesNotMatch(L.limitMessage("Claude Code", L.cliLimit("Usage limit reached")), /\u2014/);
});
