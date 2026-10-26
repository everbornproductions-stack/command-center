// Get everything connected. The checklist is every integration except the council
// AI key steps. Status is Connected, Not connected, or Handoff. No real keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { PROVIDERS } from "../server/registry.js";
import { buildCatalog, offerShow, statusOf, blankRecord, isFirstRun } from "../server/connect-setup.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";
const NEED = ["gmail", "drive", "calendar", "ghl", "capcut", "kling", "elevenlabs", "suno", "flow", "cursor"];

function fakeAccess(p) {
  if (p.auth === "handoff") return { auth: "handoff", connected: true };
  if (p.auth === "local") return { auth: "local", connected: true };
  if (p.id === "kling") return { auth: "key", connected: true };
  return { auth: p.auth || "key", connected: false };
}

function catalog() {
  return buildCatalog({
    providers: PROVIDERS,
    access: fakeAccess,
    dual: (id) => ["kling", "elevenlabs", "syncso", "fal", "replicate"].includes(id),
    google: () => ({ connected: true, scopes: [{ id: "gmail" }], clientId: "must-not-leak", clientSecretSaved: true }),
    publish: () => [{ id: "ghl", connected: false, viaPaste: false, clientId: "must-not-leak", clientSecretSaved: false }],
    library: () => ({ connected: false, clientReady: false, clientId: "must-not-leak" }),
    grokbot: () => ({ ready: false, url: "https://secret.example/hook", key: "sk-not-real" }),
    extensionPaired: () => false,
    mailAccounts: (provider) => provider === "google" ? [
      { id: "google", label: "Business", connected: true, isDefault: true, access: "must-not-leak" },
      { id: "ma_personal", label: "Personal", connected: false, isDefault: false, refresh: "must-not-leak" },
    ] : provider === "outlook" ? [
      { id: "outlook", label: "Work mail", connected: true, isDefault: true, access: "must-not-leak" },
    ] : [],
    outlook: () => ({ clientId: "must-not-leak", clientSecretSaved: true }),
  });
}

test("checklist covers the integrations and leaves AI key detection alone", () => {
  const items = catalog();
  const ids = items.map((it) => it.id);
  for (const id of NEED) assert.ok(ids.includes(id), id);
  for (const id of ["anthropic", "openai", "xai", "google", "perplexity", "openrouter", "deepseek", "groq", "mistral"]) {
    assert.equal(ids.includes(id), false, `${id} stays in the AI key setup`);
  }
  for (const it of items) assert.ok(["Connected", "Not connected", "Handoff"].includes(it.status), it.id);
  assert.equal(items.find((it) => it.id === "suno").status, "Handoff");
  assert.equal(items.find((it) => it.id === "flow").status, "Handoff");
  assert.equal(items.find((it) => it.id === "cursor").status, "Connected");
  assert.equal(items.find((it) => it.id === "capcut").status, "Not connected");
  assert.equal(items.find((it) => it.id === "kling").status, "Connected");
  assert.equal(items.find((it) => it.id === "gmail").status, "Connected");
  assert.deepEqual(items.find((it) => it.id === "gmail").accounts, [
    { id: "google", label: "Business", connected: true, isDefault: true },
    { id: "ma_personal", label: "Personal", connected: false, isDefault: false },
  ]);
  assert.equal(items.find((it) => it.id === "gmail").mail.provider, "google");
  assert.deepEqual(items.find((it) => it.id === "outlook").accounts, [{ id: "outlook", label: "Work mail", connected: true, isDefault: true }]);
  assert.equal(items.find((it) => it.id === "outlook").flow.type, "mail");
  assert.equal(items.find((it) => it.id === "drive").status, "Not connected");
  assert.equal(items.find((it) => it.id === "calendar").status, "Not connected");
  assert.equal(items.find((it) => it.id === "calendar").flow.type, "browser-google");
  assert.equal(items.find((it) => it.id === "calendar").flow.want.calendar, true);
  assert.match(items.find((it) => it.id === "calendar").blurb, /Grok Bot can still take calendar work/);
  assert.equal(items.find((it) => it.id === "ghl").flow.type, "publish");
  assert.equal(items.find((it) => it.id === "kling").flow.type, "keysetup");
  assert.equal(items.find((it) => it.id === "capcut").flow.type, "mcp");
  for (const id of ["gmail", "drive", "ghl", "capcut"]) {
    const steps = items.find((it) => it.id === id).steps;
    assert.ok(Array.isArray(steps) && steps.length >= 3, id);
  }
  assert.match(items.find((it) => it.id === "capcut").steps.join(" "), /outside the US/);
  assert.match(items.find((it) => it.id === "ghl").steps.join(" "), /waits for a click/);
  assert.ok(items.every((it) => Array.isArray(it.steps) && it.steps.length > 0));
  const dumped = JSON.stringify(items);
  assert.equal(dumped.includes("must-not-leak"), false);
  assert.equal(dumped.includes("sk-not-real"), false);
  assert.equal(dumped.includes("secret.example"), false);
  assert.equal(dumped.includes(EM), false);
  assert.equal(statusOf({ auth: "handoff", connected: true }), "Handoff");
  assert.equal(statusOf({ connected: true }), "Connected");
  assert.equal(statusOf({}), "Not connected");
  assert.equal(offerShow(blankRecord(), { firstRun: true }), true);
  assert.equal(offerShow({ ...blankRecord(), legacy: true }, { firstRun: false }), false);
  assert.equal(offerShow({ ...blankRecord(), opened: true }, { firstRun: false }), false);
  assert.equal(offerShow({ ...blankRecord(), dismissedAt: 5, opened: true }, { firstRun: true }), false);
  assert.equal(isFirstRun(null, {}), true);
  assert.equal(isFirstRun({ completed: true }, {}), false);
  assert.equal(isFirstRun(null, { onboarded: true }), false);
});

test("the page, Help menu, and Settings can run setup again, and Simple hides the extra line", () => {
  const ui = read("web", "features", "connect-setup.js");
  const app = read("web", "app.js");
  const nav = read("web", "nav.js");
  const help = read("web", "features", "help.js");
  const main = read("electron", "main.cjs");
  assert.match(ui, /Get everything connected/);
  assert.match(ui, /id="cs-restart-all">Run the whole setup again</);
  assert.match(ui, /Start over: welcome screen, Find my AIs, then connections\. Nothing you saved is changed without asking\./);
  assert.match(ui, /window\.CC\.restartFullSetup/);
  assert.match(ui, /keysetup\?\.open/);
  assert.match(ui, /\/connect\/mcp/);
  assert.match(ui, /\/browser\/google\/start/);
  assert.match(ui, /\/publish\/connect\//);
  assert.match(ui, /\/libraries\//);
  assert.match(ui, /\/setup\/open/);
  assert.match(ui, /Add another/);
  assert.match(ui, /data-add/);
  assert.match(ui, /\/mail-accounts/);
  assert.match(ui, /accountId/);
  assert.match(ui, /\/services\/mail\/start/);
  assert.doesNotMatch(ui, /type="password"/);
  assert.doesNotMatch(ui, /\/keys/);
  assert.match(ui, /cs-detail/);
  assert.match(ui, /cs-steps/);
  assert.match(ui, /uiMode/);
  assert.match(app, /connectWizard/);
  assert.match(app, /connect-setup/);
  assert.match(nav, /Get everything connected/);
  assert.match(help, /Get everything connected/);
  assert.match(main, /label: "Help"/);
  assert.match(main, /Get everything connected/);
  assert.equal([ui, app, nav, help].join("\n").includes(EM), false);
});

test("a fresh install offers the checklist, a finished install does not, and a key is never stored", async () => {
  const fresh = await startServer();
  const fake = "sk-connect-setup-test-not-a-real-key";
  try {
    const view = await fresh.api("/connectsetup");
    assert.equal(view.status, 200);
    assert.equal(view.json.show, true);
    const ids = view.json.items.map((it) => it.id);
    for (const id of NEED) assert.ok(ids.includes(id), id);
    assert.equal(view.json.items.find((it) => it.id === "suno").status, "Handoff");
    assert.equal(view.json.items.find((it) => it.id === "flow").status, "Handoff");
    assert.equal(view.json.items.find((it) => it.id === "cursor").status, "Connected");
    assert.equal(view.json.items.find((it) => it.id === "capcut").status, "Not connected");
    assert.equal((await fresh.api("/onboarding")).json.show, true, "AI setup is still the first step");
    assert.equal(view.json.items.find((it) => it.id === "gmail").mail.provider, "google");
    const added = await fresh.api("/mail-accounts", { method: "POST", body: { provider: "google", label: "Business" } });
    assert.equal(added.status, 200);
    const listed = await fresh.api("/connectsetup");
    const acct = listed.json.items.find((it) => it.id === "gmail").accounts.find((a) => a.label === "Business");
    assert.equal(acct.connected, false);
    assert.deepEqual(Object.keys(acct).sort(), ["connected", "id", "isDefault", "label"]);
    assert.equal(listed.json.items.find((it) => it.id === "outlook").mail.provider, "outlook");
    assert.equal(JSON.stringify(view.json).includes(fake), false);
    const skipped = await fresh.api("/connectsetup/skip", { method: "POST", body: { id: "kling", key: fake } });
    assert.equal(skipped.status, 200);
    assert.equal(skipped.json.items.find((it) => it.id === "kling").skipped, true);
    assert.equal(JSON.stringify(skipped.json).includes(fake), false);
    assert.equal((await fresh.api("/onboarding")).json.show, true, "skipping a row does not finish AI setup");
    const unknown = await fresh.api("/connectsetup/skip", { method: "POST", body: { id: "anthropic", key: fake } });
    assert.equal(unknown.status, 400);
    const later = await fresh.api("/connectsetup/later", { method: "POST" });
    assert.equal(later.json.show, false);
    assert.equal(later.json.dismissed, true);
    const file = path.join(fresh.dir, "connectsetup.state.json");
    const saved = fs.readFileSync(file, "utf8");
    assert.equal(saved.includes(fake), false);
    assert.equal(fresh.log.includes(fake), false);
    const again = await fresh.api("/connectsetup/reset", { method: "POST" });
    assert.equal(again.json.show, true);
    assert.equal(again.json.items.find((it) => it.id === "kling").skipped, false);
    assert.equal((await fresh.api("/state")).json.plugins.includes("connectsetup"), true);
    assert.equal((await fresh.api("/connectsetup")).json.show, false, "opened once, so the next launch does not auto-open");
    assert.equal((await fresh.api("/state")).json.connectSetup.show, false);
  } finally { await fresh.stop(); }

  const done = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "onboarding.json"), JSON.stringify({
    version: 1, completed: true, reason: "user", completedAt: 1,
  })) });
  try {
    const view = await done.api("/connectsetup");
    assert.equal(view.json.show, false, "an install that already finished setup is not prompted");
    assert.equal(JSON.stringify(view.json).includes("sk-"), false);
  } finally { await done.stop(); }
});
