// 0.4.17 "smooth first run": one welcome screen instead of five stops, the answer at the top
// in Simple, three main answer actions with the rest under More, an update notice that never
// covers the page, a top bar that never overlaps, and no "No AI connected yet" after Try it now.
// The server parts start the real server on a temp data dir in demo mode, with no real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { WELCOME, TEXT_SIZES, setupPhase } from "../web/simple-ui.js";
import { MAIN_ACTIONS, KEEP_IN_VIEW, MORE_LABEL, planActions } from "../web/answer-actions.js";
import { applyDesktopPrompt, shouldShowDesktopPrompt, QUIET } from "../server/desktop-prompt.js";
import { settingsSaved } from "../server/onboarding.js";
import { idsFor } from "../web/perf/registry.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASHES = /[\u2013\u2014]/;
const slice = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from) + 1));

test("a fresh install gets the one welcome screen; Run setup again keeps the older pages", () => {
  assert.equal(setupPhase({ fresh: true }), "welcome");
  assert.equal(setupPhase({ fresh: true, requested: "scan" }), "scan");
  assert.equal(setupPhase({ fresh: false }), "scan");
  assert.equal(setupPhase({ fresh: false, expertSetup: { done: false, pendingScan: true } }), "scan");
  assert.equal(setupPhase({ fresh: false, expertSetup: { done: false } }), "expert");
  assert.deepEqual(TEXT_SIZES.map(([id]) => id), ["default", "large", "xlarge"]);
  for (const v of Object.values(WELCOME)) assert.doesNotMatch(v, DASHES, v);
  assert.equal(WELCOME.skip, "Skip setup");
  assert.equal(WELCOME.tryIt, "Try it now");
});

test("the welcome screen holds mode, text size, first AI, apps, the 0.4.16 slot, privacy, and Skip setup", () => {
  const app = read("web", "app.js");
  const welcome = slice(app, "function renderWelcome", "\n}\n");
  for (const bit of ["welcomeLookHtml()", "welcomeAiHtml(st)", "welcomeAppsHtml()", 'id="su-skip-all"', 'id="su-start"', 'id="su-privacy"', 'id="su-backup-slot"', 'data-slot="credit-backup"', 'renderExtras("welcome", "#su-backup-slot")']) {
    assert.ok(welcome.includes(bit), bit);
  }
  const look = slice(app, "function welcomeLookHtml", "function welcomeAiHtml");
  assert.match(look, /data-ui-pick="simple"/);
  assert.match(look, /data-ui-pick="expert"/);
  assert.match(look, /id="su-text-sizes"/);
  const ai = slice(app, "function welcomeAiHtml", "function welcomeAppsHtml");
  assert.match(ai, /id="su-try"/);
  assert.match(ai, /id="su-or-key"/);
  assert.match(ai, /https:\/\/openrouter\.ai\/keys/);
  assert.match(slice(app, "function welcomeAppsHtml", "async function saveWelcomeKey"), /appSignIn/);
  // Simple is the default when nothing was picked, and finishing writes the onboarding flag (decision 20).
  const finish = slice(app, "async function finishWelcome", "function applyTextSize");
  assert.match(finish, /S\.uiMode === "expert" \? "expert" : "simple"/);
  assert.match(finish, /finishAiSetup\("command"/);
  assert.match(app, /if \(st\.phase === "welcome"\) return renderWelcome\(v, st\);/);
  // Escape skips when the focus is not in a field.
  assert.match(app, /e\.key !== "Escape" \|\| S\.view !== "setup" \|\| S\.setup\?\.phase !== "welcome"/);
  // The reserved slot loads its features with the setup page.
  assert.match(read("web", "perf", "registry.js"), /if \(f\.setup \|\| f\.welcome\) add\(f\)/);
  assert.ok(Array.isArray(idsFor("setup")));
  assert.match(read("web", "features", "index.js"), /welcome: \{ order: 10, render\(container\)/);
});

test("Try it now loads the practice AIs before chat opens, so chat never says No AI connected yet", () => {
  const app = read("web", "app.js");
  const tryIt = slice(app, '$("#su-try").addEventListener', '$("#su-skip-all")');
  const demo = tryIt.indexOf('api("/demo"');
  const loaded = tryIt.indexOf("await refresh()");
  const done = tryIt.indexOf("await finishWelcome()");
  assert.ok(demo > -1 && loaded > demo && done > loaded, "demo on, then refresh, then chat");
  const composer = slice(app, "function renderComposerAis", "function renderOps");
  assert.match(composer, /S\.demo \? `<div class="composer-empty dim small">Practice AIs are on\. Nothing is spent\.<\/div>`/);
});

test("first run shows no desktop card and no tour; the tour is a quiet link offered once, later", () => {
  // A new install that finished the welcome screen is quiet. Never, Done and Not now keep working.
  const quiet = applyDesktopPrompt({ status: "pending", laterCount: 0 }, "quiet");
  assert.equal(quiet.status, QUIET);
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.17", ...quiet }), false);
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.17", ...applyDesktopPrompt(quiet, "later") }), false);
  assert.deepEqual(applyDesktopPrompt({ status: "never", laterCount: 0 }, "quiet"), { status: "never", laterCount: 0 });
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.17", status: "pending", laterCount: 0 }), true, "an existing install keeps the old rule");
  const tour = read("web", "features", "tour.js");
  assert.match(tour, /export const TOUR_AFTER_ANSWERS = 3;/);
  assert.match(tour, /!!S\.firstRunDone/);
  const invite = slice(tour, "function maybeInvite", "function newsMarkup");
  assert.match(invite, /if \(tour\.offeredAt && !offeredThisSession\)/);
  assert.match(invite, /api\("\/tour\/offered"/);
  assert.match(invite, /host\.appendChild\(d\)/, "inside the page, not a floating toast");
  assert.doesNotMatch(invite, /document\.body\.appendChild\(d\)/);
  // Picking Expert on the welcome screen is not history, so a reload keeps the welcome screen.
  assert.equal(settingsSaved({ uiMode: "expert", uiModeChosen: true, expertConfirmed: true }, {}), false);
});

test("Simple puts the answer under the chat box, names one AI, and offers a council only when one can run", () => {
  const app = read("web", "app.js");
  const out = slice(app, "function renderOutput", "function paintFailure");
  assert.match(out, /simpleAnswer\.hidden = !l\.id/);
  assert.match(out, /arrangeAnswerActions\(\$\("#deliv-extras"\)/);
  const line = slice(app, "function paintAnswerLine", "async function askCouncil");
  assert.match(line, /simpleAnswerLine\(S\.councilOffer, answeredBy\)/);
  assert.match(line, /id="cc-ask-council"/);
  assert.match(slice(app, "async function askCouncil", "function l0Prompt"), /councilRequest\(prompt/);
  assert.match(app, /function seatName\(c, a\)/);
  assert.match(app, /S\.councilOffer = st\.councilOffer/);
  const css = read("web", "styles.css");
  assert.match(css, /\.view:has\(> \.cmd\.simple-chat\) \{ overflow: auto; \}/);
});

test("three main actions under each answer, everything else under More", () => {
  assert.deepEqual(MAIN_ACTIONS.map((a) => a.label), ["Copy", "Double-check", "Test with personas"]);
  assert.equal(MORE_LABEL, "More actions");
  assert.ok(KEEP_IN_VIEW.has("desk"), "the practice label and Written by stay in view");
  const plan = planActions(["prompts", "personas", "share", "export", "desk", "publish", "ratings"]);
  assert.deepEqual(plan.stay, ["desk"]);
  assert.deepEqual(plan.more, ["prompts", "share", "export", "publish", "ratings"]);
  assert.ok(!plan.more.includes("personas"), "Test with personas is a main action");
  const src = read("web", "answer-actions.js");
  assert.match(src, /find: "#cc-check"/);
  assert.match(src, /find: "\[data-feature='personas'\] button"/);
  assert.match(src, /appendChild\(block\)/, "blocks move, they are not removed");
  assert.doesNotMatch(src, /\.remove\(\)/);
});

test("notices sit in their own row, and the top bar folds instead of overlapping", () => {
  const html = read("web", "index.html");
  assert.match(html, /<div class="view-col">\s*<div class="notices" id="notices">\s*<div id="update-bar"/);
  assert.match(html, /id="nav-toggle" aria-controls="tabs" aria-expanded="false">Menu<\/button>/);
  const css = read("web", "styles.css");
  const bar = css.slice(css.indexOf(".update-bar {"), css.indexOf("}", css.indexOf(".update-bar {")));
  assert.doesNotMatch(bar, /grid-area: view/, "the update notice no longer sits on top of the page");
  assert.match(css, /\.view-col \{ grid-area: view;/);
  assert.match(css, /@media \(max-width: 1100px\) and \(min-width: 761px\)/);
  assert.match(css, /\.topbar\.nav-collapsed #tabs \{ display: none; \}/);
  const app = read("web", "app.js");
  assert.match(slice(app, "function ensureFeatureTabs", "function squeezeTopbar"), /squeezeTopbar\(\);\r?\n\}/);
  assert.match(app, /function squeezeLevel\(bar, root\)/);
  assert.match(app, /attributeFilter: \["data-text"\]/);
  const updates = read("web", "features", "updates.js");
  assert.match(updates, /document\.getElementById\("notices"\) \|\| host\)\.appendChild\(note\)/);
  assert.doesNotMatch(updates, /host\.prepend\(note\)/, "the failed check is not in the top bar");
  const render = slice(app, "function renderUpdateBar", "function updateBoxHtml");
  assert.match(render, /S\.updateErrorHidden/);
  assert.match(render, /Couldn't check for updates/);
});

test("server: finishing the welcome screen quiets the desktop card, and the tour link is offered once", async () => {
  const s = await startServer();
  try {
    const before = await s.api("/tour");
    assert.equal(before.status, 200);
    assert.equal(before.json.offeredAt, null);
    const done = await s.api("/setup/done", { method: "POST" });
    assert.equal(done.status, 200);
    const after = await s.api("/tour");
    assert.equal(after.json.desktopPrompt, null, "no desktop card after first run");
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "desktop.prompt.json"), "utf8"));
    assert.equal(saved.status, "quiet");
    const offered = await s.api("/tour/offered", { method: "POST" });
    assert.equal(offered.status, 200);
    const at = offered.json.offeredAt;
    assert.ok(at > 0);
    const again = await s.api("/tour/offered", { method: "POST" });
    assert.equal(again.json.offeredAt, at, "the first offer time is kept");
  } finally { await s.stop(); }
});

test("server: an install that already finished setup keeps its desktop card choice", async () => {
  const s = await startServer({
    seed(dir) {
      fs.writeFileSync(path.join(dir, "onboarding.json"), JSON.stringify({ version: 1, completed: true, completedAt: Date.now(), reason: "user" }));
      fs.writeFileSync(path.join(dir, "whatsnew.state.json"), JSON.stringify({ seen: null, installed: "0.0.0", firstInstall: false }));
    },
  });
  try {
    const done = await s.api("/setup/done", { method: "POST" });
    assert.equal(done.status, 200);
    const t = await s.api("/tour");
    assert.equal(t.json.desktopPrompt?.title, "New: let Meldmind use your desktop");
  } finally { await s.stop(); }
});
