// 0.4.25: a cold start (about 30 s) no longer shows "Meldmind's engine is not responding". The first 90 s show a calm
// "Meldmind is starting up" line and the box waits 45 s; forced reasons still show it at once. Also: a project's own
// Simple/Expert choice gets a note with "Use X everywhere", and the practice answer heading keeps the whole request.
// Pure tests and source checks only: no server, no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { ENGINE_BOX_MS, STARTUP_GRACE_MS, STARTING_LINE, engineWaitView } from "../web/engine-wait.js";
import { projectModeNote, projectsWithOwnMode } from "../web/project-mode-note.js";
import { answerTitle, practiceAnswer, practiceVerdict } from "../server/demo-answers.js";

const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
const EM = "—";

test("engine wait: thresholds are 45 s for the box and 90 s of starting up", () => {
  assert.equal(ENGINE_BOX_MS, 45000);
  assert.equal(STARTUP_GRACE_MS, 90000);
  assert.match(STARTING_LINE, /^Meldmind is starting up\./);
  assert.equal(STARTING_LINE.includes(EM), false);
});

test("engine wait: a 30 s cold start shows only the starting-up line, never the box", () => {
  const startedAt = 1000;
  assert.equal(engineWaitView({ now: 1000, startedAt, downSince: 0 }), "ok");
  for (const s of [1, 5, 15.5, 16, 30, 44]) assert.equal(engineWaitView({ now: startedAt + s * 1000, startedAt, downSince: startedAt }), "starting", `${s} s`);
  assert.equal(engineWaitView({ now: startedAt + 45000, startedAt, downSince: startedAt }), "box", "45 s without an answer shows the box");
});

test("engine wait: after the first 90 s it says reconnecting, then the box at 45 s", () => {
  const startedAt = 0;
  assert.equal(engineWaitView({ now: 100000, startedAt, downSince: 95000 }), "reconnecting");
  assert.equal(engineWaitView({ now: 139999, startedAt, downSince: 95000 }), "reconnecting");
  assert.equal(engineWaitView({ now: 140000, startedAt, downSince: 95000 }), "box");
});

test("engine wait: forced reasons show the box at once; a hub or phone never says starting up", () => {
  assert.equal(engineWaitView({ now: 2000, startedAt: 1000, downSince: 0, forced: true }), "box");
  assert.equal(engineWaitView({ now: 5000, startedAt: 1000, downSince: 1000, local: false }), "reconnecting");
});

test("app.js: the socket close goes through the starting-up rule, and the immediate reasons are kept", () => {
  assert.match(app, /import \{ ENGINE_BOX_MS, STARTING_LINE, engineWaitView \} from "\.\/engine-wait\.js";/);
  assert.match(app, /const ENGINE_TIMEOUT_MS = ENGINE_BOX_MS;/);
  const close = app.slice(app.indexOf("ws.onclose = (e) =>"), app.indexOf("ws.onmessage"));
  assert.match(close, /if \(e\.code === 4401 \|\| e\.code === 4403\) return;/, "4401 / 4403 handling is kept");
  assert.match(close, /paintEngineWait\(\)/);
  assert.doesNotMatch(close, /engineDown\(true\)/, "a close never jumps straight to the box");
  // session mismatch still shows the box at once
  const msg = app.slice(app.indexOf("ws.onmessage"), app.indexOf("function noteOnboarding"));
  assert.match(msg, /downSince = Date\.now\(\) - ENGINE_TIMEOUT_MS - 1; desktopReason = "this window's session does not match the engine; use Restart engine";\s*engineDown\(true\);/);
  // the desktop watchdog's stuck signal still shows the box at once
  assert.match(app, /window\.ccDesktop\?\.onEngine\?\.\(\(st\) => \{ desktopReason = st\.reason \|\| null; if \(st\.stuck\) engineDown\(true\); \}\);/);
  // the line never takes clicks and goes away when the engine answers
  const starting = app.slice(app.indexOf("function engineStarting("), app.indexOf("function paintEngineWait("));
  assert.match(starting, /pointer-events:none/);
  assert.match(starting, /role", "status"/);
  assert.match(app, /if \(!on\) \{ downSince = 0; desktopReason = null; clearTimeout\(engineWaitTimer\); engineStarting\(false\);/);
});

test("project mode note: only when the project's own choice differs from the global one", () => {
  assert.equal(projectModeNote({ id: "a" }, "simple"), null);
  assert.equal(projectModeNote({ id: "a", uiMode: "simple" }, "simple"), null);
  assert.equal(projectModeNote(null, "simple"), null);
  const n = projectModeNote({ id: "b", uiMode: "expert" }, "simple");
  assert.deepEqual(n, { own: "expert", global: "simple", text: "This project is set to Expert.", button: "Use Simple everywhere", keep: "Keep Expert here" });
  const m = projectModeNote({ id: "c", uiMode: "simple" }, "expert");
  assert.equal(m.text, "This project is set to Simple."); assert.equal(m.button, "Use Expert everywhere");
  assert.equal(JSON.stringify([n, m]).includes(EM), false);
  assert.deepEqual(projectsWithOwnMode([{ id: "a" }, { id: "b", uiMode: "expert" }, { id: "c", uiMode: "simple" }, { id: "d", uiMode: null }, null]), ["b", "c"]);
});

test("app.js: setUiMode's 'everywhere' clears every project's own choice; the toggle still saves as before", () => {
  const set = app.slice(app.indexOf("function setUiMode("), app.indexOf("function toggleSimpleCreate("));
  assert.match(set, /const patch = \{ uiMode: mode, uiModeChosen: true \};/, "the global choice is still saved");
  assert.match(set, /api\("\/settings", \{ method: "POST", body: patch \}\)/);
  assert.match(set, /if \(opts\.everywhere\) \{[\s\S]*?for \(const id of projectsWithOwnMode\(S\.projects\)\)[\s\S]*?api\("\/projects", \{ method: "POST", body: \{ id, uiMode: null \} \}\)/);
  assert.match(set, /\} else if \(activeProj\) \{\s*activeProj\.uiMode = mode;\s*api\("\/projects", \{ method: "POST", body: \{ id: activeProj\.id, uiMode: mode \} \}\)/, "the plain toggle still saves the active project's mode");
  const note = app.slice(app.indexOf("function paintProjectModeNote("), app.indexOf("function setUiMode("));
  assert.match(note, /projectModeNote\(proj, globalUiMode\(\)\)/);
  assert.match(note, /setUiMode\(note\.global, \{ everywhere: true, confirmed: true \}\)/);
  assert.match(note, /getElementById\("notices"\)/, "docked in the notices row, never over a control");
  assert.match(app, /function syncChrome\(\) \{[\s\S]*?paintProjectModeNote\(\);\s*\}/);
  // picking a project with no own choice follows the global one
  assert.match(app, /const wantMode = resolveProjectMode\(pickedProj, S\.settings,/);
});

test("answer heading keeps the whole request (not cut at the first full stop)", () => {
  const bakery = "Write a week of Instagram posts for my two-location bakery. Save them as posts.md.";
  assert.equal(answerTitle(bakery), "Write a week of Instagram posts for my two-location bakery. Save them as posts.md");
  assert.equal(practiceAnswer(`TASK: ${bakery}`, "nova-ultra").split("\n")[0], "## Write a week of Instagram posts for my two-location bakery. Save them as posts.md");
  // too long: the whole first sentence when it fits
  const two = "Plan a soft launch for the new cafe on Main Street. Then list every supplier we need to call, with phone numbers and the best time to reach each one.";
  assert.equal(answerTitle(two), "Plan a soft launch for the new cafe on Main Street");
  // a first sentence longer than 90: cut at a word boundary with "..."
  const long = "Write 3 LinkedIn posts for Everborn Productions aimed at California mortgage brokers, 80 to 140 words each, with a call to book a free 15 minute call. Save them as posts.md.";
  const t = answerTitle(long);
  assert.ok(t.endsWith("...")); assert.ok(t.length <= 93, t);
  assert.ok(long.startsWith(t.slice(0, -3)), "cut on a word boundary");
  assert.equal(long[t.length - 3], " ", "the cut is at a space, never inside a word");
  // a full stop inside a word is not a sentence end
  assert.equal(answerTitle("Rename notes.txt to plan.md and keep a copy of the old one in the archive folder for later reading please, thanks a lot."), "Rename notes.txt to plan.md and keep a copy of the old one in the archive folder for later...");
  assert.equal(answerTitle(""), "");
  const verdict = practiceVerdict(`QUESTION:\n${bakery}\n\nANSWERS:\n### Answer A (Nova (demo))\nx`, "nova-ultra");
  assert.match(verdict, /^## Write a week of Instagram posts for my two-location bakery\. Save them as posts\.md\n/);
});
