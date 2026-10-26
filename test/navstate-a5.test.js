// Slice A5 tests: Toggle All, direct AI setup, navigation state, never-say-no planner
// workaround chain, Setup/Settings/Help improvements, and People & Connections fixes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { DEFAULT_FLAG_NAVSTATE as SERVER_DEFAULT_FLAG, isNavStateEnabled as serverNavStateEnabled } from "../server/web-config.js";
import {
  DEFAULT_FLAG_NAVSTATE as WEB_DEFAULT_FLAG,
  isNavStateEnabled as webNavStateEnabled,
  createDraftStore,
  captureViewDraft,
  restoreViewDraft,
  createNavHistory,
  saveProfileDraft,
  loadProfileDraft,
  clearProfileDraft,
  mergeProfileWithDraft,
} from "../web/nav-state.js";
import { resolveProjectMode } from "../web/mode.js";
import { normalizeProjectUiMode, ensureSampleProject, saveProject, listProjects } from "../server/projects.js";
import { allAppsAllowed, toggleAllAppsLabel } from "../web/nav-state.js";
import {
  WORKAROUND_ORDER,
  checkWorkaroundSafety,
  decomposeIntoSmallerSteps,
  buildWorkaroundPlan,
  resolveTaskWorkaround,
} from "../server/mission.js";
import {
  contextTipsForView,
  doThisNextForState,
  matchScreensForQuery,
  PERSONA_STARTER_PACKS,
  getPersonaStarterPack,
} from "../web/help-rank.js";
import { ROLE_ALIASES, normalizeInviteRole } from "../server/plugins/workspaces.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASHES = /[\u2013\u2014]/;

test("flag_navstate defaults to false in tests and turns on via settings or env", () => {
  assert.equal(SERVER_DEFAULT_FLAG, false);
  assert.equal(WEB_DEFAULT_FLAG, false);
  assert.equal(serverNavStateEnabled({}, {}), false);
  assert.equal(serverNavStateEnabled({ flag_navstate: true }, {}), true);
  assert.equal(serverNavStateEnabled({}, { CC_FLAG_NAVSTATE: "1" }), true);
  assert.equal(serverNavStateEnabled({ flag_navstate: false }, { CC_FLAG_NAVSTATE: "1" }), false);
  assert.equal(webNavStateEnabled({}), false);
  assert.equal(webNavStateEnabled({ flags: { flag_navstate: true } }), true);
  assert.equal(webNavStateEnabled({ settings: { flag_navstate: true } }), true);
});

test("Toggle All helpers and UI: Select All / Deselect All in apps and setup", () => {
  assert.equal(allAppsAllowed([]), false);
  assert.equal(allAppsAllowed([{ id: "a", allowed: true }, { id: "b", allowed: false }]), false);
  assert.equal(allAppsAllowed([{ id: "a", allowed: true }, { id: "b", allowed: true }]), true);
  assert.equal(toggleAllAppsLabel([{ id: "a", allowed: false }]), "Select All");
  assert.equal(toggleAllAppsLabel([{ id: "a", allowed: true }]), "Deselect All");

  const appsUi = read("web", "features", "apps.js");
  assert.match(appsUi, /data-toggle-all=/);
  assert.match(appsUi, /\/apps\/allow-all/);
  const appJs = read("web", "app.js");
  assert.match(appJs, /id="su-tools-toggle"/);
  assert.match(appJs, /data-setup-tools-toggle="1"/);
});

test("direct AI setup from #strip tiles and connected-state awareness across setup surfaces", () => {
  const appJs = read("web", "app.js");
  assert.match(appJs, /function openProviderSetup\(providerId\)/);
  assert.match(appJs, /S\.settingsMore = true;/);
  assert.match(appJs, /S\.focusProvider = providerId;/);
  assert.match(appJs, /tile-connected/);
  assert.match(appJs, /id="su-agy-connected"/);

  const agyUi = read("web", "features", "antigravity.js");
  assert.match(agyUi, /id="agy-connected-badge"/);
  assert.ok(agyUi.includes(`id="agy-install" type="button" \${isInstalled ? "hidden disabled" : ""}`));

  const csUi = read("web", "features", "connect-setup.js");
  assert.ok(csUi.includes(`data-connected="\${it.status === "Connected" ? "1" : "0"}"`));
  assert.match(csUi, /openProviderSetup/);
});

test("navigation state: draft store, Back stack, Business Profile draft, and per-project uiMode", () => {
  const store = createDraftStore();
  const fakeView = {
    querySelectorAll() {
      return [
        { tagName: "INPUT", type: "text", id: "orders", value: "draft prompt text" },
        { tagName: "INPUT", type: "checkbox", id: "s-private-mode", checked: true },
        { tagName: "INPUT", type: "password", id: "secret-key", value: "should-not-save" },
      ];
    },
  };
  const saved = captureViewDraft("command", fakeView, store);
  assert.equal(saved.fields["id:orders"].value, "draft prompt text");
  assert.equal(saved.fields["id:s-private-mode"].checked, true);
  assert.equal(saved.fields["id:secret-key"], undefined, "password inputs are never stored in view drafts");

  const targetEl = { tagName: "INPUT", type: "text", id: "orders", value: "" };
  const restoreRoot = {
    querySelectorAll() {
      return [targetEl];
    },
  };
  const restoredCount = restoreViewDraft("command", restoreRoot, store);
  assert.equal(restoredCount.restored, 1);
  assert.equal(targetEl.value, "draft prompt text");

  // Back history stack
  const pushed = [];
  const nav = createNavHistory({
    historyApi: { pushState: (st) => pushed.push(st) },
  });
  nav.record({ view: "command", settingsMore: false });
  nav.record({ view: "settings", settingsMore: true, navFocus: "#settings-keys" });
  assert.equal(nav.canGoBack(), true);
  assert.equal(pushed.length, 2);
  const prev = nav.back();
  assert.equal(prev.view, "command");
  assert.equal(nav.canGoBack(), false);

  // Business Profile draft persistence across navigation
  saveProfileDraft({ business: "Acme Studio", role: "Founder" });
  const draft = loadProfileDraft();
  assert.equal(draft.business, "Acme Studio");
  const merged = mergeProfileWithDraft({ business: "Old Name", industry: "Design" }, draft);
  assert.equal(merged.business, "Acme Studio");
  assert.equal(merged.industry, "Design");
  clearProfileDraft();
  assert.equal(loadProfileDraft(), null);

  // Per-project uiMode resolution
  assert.equal(normalizeProjectUiMode("expert"), "expert");
  assert.equal(normalizeProjectUiMode("SIMPLE"), "simple");
  assert.equal(normalizeProjectUiMode("invalid"), null);
  assert.equal(resolveProjectMode({ id: "p1", uiMode: "expert" }, { uiMode: "simple", uiModeChosen: true }), "expert");
  assert.equal(resolveProjectMode({ id: "p1", uiMode: null }, { uiMode: "simple", uiModeChosen: true }), "simple");
});

test("never-say-no planner workaround chain and safety gates (PLAN.md Section 2 Rule 1)", () => {
  assert.deepEqual(WORKAROUND_ORDER, ["installed_app", "browser_helper", "smaller_steps", "closest_option"]);

  // Safety checks: never bypass user approval gates for send, pay, delete, or sign;
  // never touch billing or password screens.
  const sendCheck = checkWorkaroundSafety("Send the quarterly email to the client list");
  assert.equal(sendCheck.requiresApproval, true);
  assert.equal(sendCheck.approvalKind, "send");
  assert.equal(sendCheck.safeToAutomate, true);

  const payCheck = checkWorkaroundSafety("Pay the contractor invoice");
  assert.equal(payCheck.requiresApproval, true);
  assert.equal(payCheck.approvalKind, "pay");

  const secretCheck = checkWorkaroundSafety("Open my billing password page and update card");
  assert.equal(secretCheck.touchesSecretScreen, true);
  assert.equal(secretCheck.safeToAutomate, false);

  // Step decomposition
  const steps = decomposeIntoSmallerSteps("First research competitors, then draft the landing page, and finally polish the copy");
  assert.ok(steps.length >= 2);

  const app = { id: "blender", name: "Blender" };
  const MA = { id: "browser", name: "Browser helper", TAGS: ["web"] };
  const rank = () => [{ provider: "demo-claude", model: "demo-sonnet", estCost: 0 }];
  const none = () => null;

  // Order: installed_app, then browser_helper, then smaller_steps, then closest_option
  const withApp = resolveTaskWorkaround({ title: "Edit video clip", capability: "video" }, { suggestAppFn: () => app, MA, openRankFn: rank });
  assert.equal(withApp.workaround.step, "installed_app");
  const withBrowser = resolveTaskWorkaround({ title: "Check public page", capability: "research" }, { suggestAppFn: none, MA, openRankFn: rank });
  assert.equal(withBrowser.workaround.step, "browser_helper");
  const small = resolveTaskWorkaround({ title: "Check public page", capability: "research" }, { suggestAppFn: none, MA: null, openRankFn: rank });
  assert.equal(small.workaround.step, "smaller_steps");
  const closest = resolveTaskWorkaround({ title: "Check public page", capability: "research" }, { suggestAppFn: none, MA: null, openRankFn: none });
  assert.equal(closest.workaround.step, "closest_option");
  assert.equal(closest.status, "done");

  // Secret screens never use app or browser automation
  const secretWorkaround = resolveTaskWorkaround(
    { title: "Change account password and billing card", capability: "reasoning" },
    { suggestAppFn: () => app, MA, openRankFn: rank },
  );
  assert.equal(secretWorkaround.workaround.step, "closest_option");
  assert.equal(secretWorkaround.workaround.safety.touchesSecretScreen, true);

  const plan = buildWorkaroundPlan({ goal: "Research local cafes and then write a summary", cls: { capability: "research" }, browser: false, suggestAppFn: none, openRankFn: rank });
  assert.ok(plan.tasks.length >= 2);
  assert.equal(plan.step, "smaller_steps");
  const planApp = buildWorkaroundPlan({ goal: "Edit a clip", suggestAppFn: () => app, openRankFn: rank });
  assert.equal(planApp.step, "installed_app");
  const planEnd = buildWorkaroundPlan({ goal: "Write a poem", browser: false, suggestAppFn: none, openRankFn: none });
  assert.equal(planEnd.step, "closest_option");
  assert.ok(planEnd.deliverable);
});

test("Help context tips, Do this next cards, screen search jump targets, and persona starter packs", () => {
  const tips = contextTipsForView("projects", []);
  assert.equal(tips.view, "projects");
  assert.ok(tips.tips.length >= 2);

  const nextNoAi = doThisNextForState({ providers: [], projects: [] });
  assert.equal(nextNoAi[0].id, "connect-ai");

  const jumpHits = matchScreensForQuery("billing subscription credits");
  assert.ok(jumpHits.some((h) => h.view === "subscriptions" || h.view === "credits"));

  assert.ok(PERSONA_STARTER_PACKS.length >= 3);
  const founderPack = getPersonaStarterPack("founder");
  assert.equal(founderPack.id, "founder");
  assert.ok(founderPack.sampleProject.starterPrompt.length > 10);

  // People & Connections role aliases and userchat hub button
  assert.equal(ROLE_ALIASES.collaborator, "member");
  assert.equal(ROLE_ALIASES.client, "viewer");
  assert.equal(normalizeInviteRole("collaborator"), "member");
  assert.equal(normalizeInviteRole("client"), "viewer");
  const uc = read("web", "features", "userchat.js");
  assert.match(uc, /Local only until you set up a hub\./);
  assert.match(uc, /id="uc-setup-hub"/);
});

test("server integration: /api/apps/allow-all guard, per-project uiMode, and /api/setup/done sampleProject", async () => {
  const s = await startServer();
  try {
    // Enable flag_navstate in settings
    const savedSettings = await s.api("/settings", { method: "POST", body: { flag_navstate: true } });
    assert.equal(savedSettings.status, 200);

    const st = await s.api("/state");
    assert.equal(st.status, 200);
    assert.equal(st.json.flags?.flag_navstate, true);

    // Setup done creates / returns sampleProject when flag_navstate is enabled
    const done = await s.api("/setup/done", { method: "POST" });
    assert.equal(done.status, 200);
    assert.ok(done.json.sampleProject, "sampleProject returned from /api/setup/done");
    assert.equal(done.json.sampleProject.sample, true);
    assert.ok(done.json.sampleProject.starterPrompt);

    // Per-project uiMode via POST /api/projects and PUT /api/projects/:id
    const created = await s.api("/projects", {
      method: "POST",
      body: { name: "Mode Test Project", uiMode: "expert" },
    });
    assert.equal(created.status, 200);
    assert.equal(created.json.uiMode, "expert");

    const updated = await s.api(`/projects/${created.json.id}`, {
      method: "PUT",
      body: { uiMode: "simple" },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.uiMode, "simple");

    // Toggle All is refused on Free or until desktop control is on
    const allowAll = await s.api("/apps/allow-all", { method: "POST", body: { allowed: true } });
    assert.ok([400, 402].includes(allowAll.status), JSON.stringify(allowAll.json));
  } finally {
    await s.stop();
  }
});

test("no em dashes or en dashes in any Slice A5 touched files", () => {
  const files = [
    ["server", "web-config.js"],
    ["server", "projects.js"],
    ["server", "apps.js"],
    ["server", "plugins", "apps.js"],
    ["server", "mission.js"],
    ["server", "plugins", "workspaces.js"],
    ["web", "nav-state.js"],
    ["web", "mode.js"],
    ["web", "help-rank.js"],
    ["web", "features", "apps.js"],
    ["web", "features", "antigravity.js"],
    ["web", "features", "connect-setup.js"],
    ["web", "features", "prompts.js"],
    ["web", "features", "help.js"],
    ["web", "features", "userchat.js"],
    ["web", "features", "workspaces.js"],
  ];
  for (const rel of files) {
    const content = read(...rel);
    assert.doesNotMatch(content, DASHES, `${rel.join("/")} must not contain en/em dashes`);
  }
});
