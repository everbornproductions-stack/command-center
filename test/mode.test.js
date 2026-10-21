// Simple / Expert. New installs default to Simple and are asked once. Existing installs
// with no saved choice stay on Expert. One click persists the choice and does not
// count as setup history. Hotkeys stay wired in both modes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  ASK, CREATE_VIEWS, resolveMode, shouldAskMode, simpleAllows, simpleTop,
} from "../web/mode.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";

test("new installs are Simple until the question, existing installs stay Expert", () => {
  const freshDefaults = { uiMode: "simple", uiModeChosen: false, budgetMonthly: 100 };
  assert.equal(resolveMode(freshDefaults, { fresh: true }), "simple");
  assert.equal(shouldAskMode(freshDefaults, { fresh: true }), true);
  assert.equal(ASK.title, "Which mode do you want to start in?");
  assert.equal(ASK.simple, "Simple");
  assert.equal(ASK.expert, "Expert");
  assert.equal(JSON.stringify(ASK).includes(EM), false);

  const picked = { uiMode: "expert", uiModeChosen: true };
  assert.equal(resolveMode(picked, { fresh: true }), "expert");
  assert.equal(shouldAskMode(picked, { fresh: true }), false);
  assert.equal(resolveMode({ uiMode: "simple", uiModeChosen: true }, { fresh: false }), "simple");

  const older = { budgetMonthly: 40, defaultMode: "balanced", qa: true, missionBudget: 2, name: "Meldmind" };
  assert.equal(resolveMode(older, { fresh: false }), "expert");
  assert.equal(shouldAskMode(older, { fresh: false }), false);
  assert.equal(shouldAskMode(freshDefaults, { fresh: false }), false, "the question is first-run only");
  assert.equal(resolveMode(freshDefaults, { fresh: false }), "simple", "a stored Simple value stays after setup");
});

test("Simple top level is Chat, Projects, Create, Help, and Settings; Expert pages stay listed as hidden", () => {
  const views = ["command", "projects", "compare", "pipelines", "agents", "liveview", "schedules", "libraries", "artifacts", "history", "brain", "prompts", "images", "media", "publish", "remix", "builders", "webbuilders", "subscriptions", "credits", "workspaces", "reports", "marketplace", "settings", "setup", "help"];
  const top = simpleTop(views);
  assert.deepEqual(top.labels, ["Chat", "Projects", "My day", "Create", "Help", "Settings"]);
  assert.deepEqual(top.create, CREATE_VIEWS);
  assert.deepEqual(top.settings, ["settings", "setup", "tour"]);
  for (const id of ["liveview", "marketplace", "credits", "pipelines", "agents"]) {
    assert.equal(simpleAllows(id), false, id);
    assert.ok(top.hidden.includes(id), id);
  }
  for (const id of ["command", "projects", "settings", "setup", "help", "prompts", "images", "media", "publish", "remix", "builders", "webbuilders"]) {
    assert.equal(simpleAllows(id), true, id);
  }
  const withDay = [...views, "everyday-inbox", "everyday-plan", "userchat"];
  assert.deepEqual(simpleTop(withDay).day, ["everyday-inbox", "everyday-plan", "userchat"]);
  for (const id of ["everyday-inbox", "everyday-plan", "userchat"]) assert.equal(simpleAllows(id), true, id);
  assert.match(read("web", "nav.js"), /My day/);
  assert.match(read("web", "nav.js"), /Work/);
});

test("the shell keeps the toggle, the simple chat, and the hotkeys", () => {
  const app = read("web", "app.js");
  const html = read("web", "index.html");
  const hotkey = read("web", "features", "hotkey.js");
  const features = read("web", "perf", "registry.js");
  const nav = read("web", "nav.js");
  assert.match(html, /id="mode-toggle"/);
  assert.match(html, /data-ui-mode="simple"/);
  assert.match(html, /data-ui-mode="expert"/);
  assert.match(app, /function setUiMode/);
  assert.match(app, /function renderSimpleChat/);
  assert.match(app, /uiModeChosen: true/);
  assert.match(app, /PLACEHOLDER/);
  assert.match(read("web", "simple-ui.js"), /Ask anything\. Meldmind picks the best AI for you\./);
  assert.match(app, /aria-label="Marching orders"/);
  assert.match(app, /e\.key === "Enter" && \(e\.ctrlKey \|\| e\.metaKey\)/);
  assert.match(app, /getAttribute\("role"\) !== "button"/);
  assert.match(nav, /altKey \|\| ctrlKey \|\| metaKey/);
  assert.match(features, /"hotkey"/);
  assert.match(hotkey, /Alt\+Space/);
  assert.doesNotMatch(hotkey, /uiMode/);
  for (const t of [app, html, read("web", "mode.js"), read("web", "features", "tour.js")]) assert.equal(t.includes(EM), false);
});

test("the choice is saved and does not close first-run setup", async () => {
  const s = await startServer();
  try {
    const st = await s.api("/state");
    assert.equal(st.json.settings.uiMode, "simple");
    assert.equal(st.json.settings.uiModeChosen, false);
    assert.equal(st.json.onboarding.show, true);
    const saved = await s.api("/settings", { method: "POST", body: { uiMode: "expert", uiModeChosen: true } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.uiMode, "expert");
    assert.equal(saved.json.uiModeChosen, true);
    assert.equal(saved.json.budgetMonthly, 100);
    assert.equal(saved.json.missionBudget, 2);
    assert.equal((await s.api("/onboarding")).json.show, true);
    assert.equal((await s.api("/state")).json.settings.uiMode, "expert");
    const back = await s.api("/settings", { method: "POST", body: { uiMode: "simple" } });
    assert.equal(back.json.uiMode, "simple");
    assert.equal(back.json.uiModeChosen, true, "a later save does not clear the choice");
  } finally { await s.stop(); }
});
