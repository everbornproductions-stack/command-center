// Smarter control: routing undo, app doors, recipes, the monthly budget, phone approvals.
// Fixture jobs stay in this file. Live drivers are covered in test/app-drivers.test.js.
// No real key, no data/ folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-smarter-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));

const savedDevOwner = process.env.CC_DEV_OWNER;
delete process.env.CC_DEV_OWNER;
after(() => { if (savedDevOwner) process.env.CC_DEV_OWNER = savedDevOwner; });

const Gate = await import("../server/feature-gate.js");
const Tune = await import("../server/learn-tune.js");
const Apps = await import("../server/control-apps.js");
const Recipes = await import("../server/recipes.js");
const Guard = await import("../server/cost-guard.js");
const Phone = await import("../server/phone-approvals.js");
const Brain = await import("../server/brain.js");
const Agents = await import("../server/external-agents.js");

const EM = "\u2014";
const TOKEN = "ab".repeat(32);

function setTier(tier) {
  if (!tier) {
    store.putDoc("license", { tier: null, status: null, lastOkAt: 0, checkedAt: 0 });
    return;
  }
  store.putDoc("license", { tier, status: "active", lastOkAt: Date.now(), checkedAt: Date.now(), key: "TEST-KEY" });
}
function resetDocs() {
  store.putDoc("learn.tune", { weights: { quality: 0, cost: 0, speed: 0 }, signals: { quality: 0, cost: 0, speed: 0 }, appliedLean: null, seenMode: null, quietMode: null, changes: [] });
  store.putDoc("control.apps", { apps: [], using: null, stopped: {} });
  store.putDoc("control.recipes", { list: [] });
  store.putDoc("phone.approvals", { items: [] });
  store.putDoc("cost.guard", { optedIn: false, cap: null, paused: false });
  store.putDoc("settings", { budgetMonthly: 100, defaultMode: "balanced", qa: true, missionBudget: 2, name: "Meldmind" });
  store.ctx().ledger = [];
}

test("routing leans from thumbs and a priority change, and undo puts it back", () => {
  resetDocs();
  setTier(null);
  assert.equal(Tune.leanFor("openrouter/free"), "cost");
  assert.equal(Tune.leanFor("claude-opus-5-5"), "quality");
  assert.equal(Tune.leanFor("claude-haiku-5-5"), "speed");
  const rows = [
    { model: "expensive", score: 10, estCost: 1, quality: 80, caps: { fast: 50 } },
    { model: "cheap", score: 9.5, estCost: 0.001, quality: 70, caps: { fast: 50 } },
  ];
  assert.equal(Tune.applyTune(rows)[0].model, "expensive");
  let view = null;
  for (let i = 0; i < 3; i++) view = Tune.noteThumb({ model: "openrouter/free", up: true });
  assert.equal(view.appliedLean, "cost");
  assert.equal(view.mode, "savings");
  assert.match(view.plain, /lower cost/);
  assert.equal(view.canUndo, true);
  assert.equal(Tune.applyTune(rows)[0].model, "cheap");
  const stored = JSON.stringify(store.doc("learn.tune"));
  assert.equal(stored.includes("prompt"), false);
  assert.equal(stored.includes("sk-"), false);
  const back = Tune.undo();
  assert.equal(back.mode, "balanced");
  assert.equal(back.canUndo, false);
  assert.equal(Tune.applyTune(rows)[0].model, "expensive");
  store.putDoc("settings", { ...store.doc("settings"), defaultMode: "quality" });
  const shifted = Tune.publicState();
  assert.match(shifted.change.why, /Quality/);
  assert.equal(Tune.undo().mode, "balanced");
});

test("tiers: desktop and recipes are capped on Pro and unlimited on Extreme; budget is Extreme or opt-in", () => {
  resetDocs();
  setTier(null);
  assert.equal(Gate.currentTier(), "free");
  assert.throws(() => Gate.gate("desktop"), (e) => e.status === 402 && e.code === "pro_required");
  assert.throws(() => Gate.gate("recipes"), (e) => e.status === 402);
  assert.throws(() => Gate.gate("budgetCap"), (e) => e.status === 402 && /Extreme/.test(e.message) && !e.message.includes(EM));
  assert.equal(Gate.gate("budgetCap", { optedIn: true }).band, "free");
  setTier("pro");
  assert.equal(Gate.currentTier(), "pro");
  assert.equal(Gate.gate("desktop", { count: 2 }).desktopApps, 3);
  assert.throws(() => Gate.gate("desktop", { count: 3 }), (e) => e.code === "extreme_required");
  assert.throws(() => Gate.gate("recipes", { count: 5 }), (e) => e.code === "extreme_required");
  setTier("extreme");
  assert.equal(Gate.currentTier(), "extreme");
  assert.equal(Gate.gate("recipes", { count: 40 }).recipes, Infinity);
  assert.equal(Gate.gate("budgetCap").budgetIncluded, true);
  setTier(null);
});

test("app cards, scores, MCP, website, profile, window tree, and the $1 screenshot cap", () => {
  resetDocs();
  setTier(null);
  assert.throws(() => Apps.addApp({ name: "Nope" }), (e) => e.status === 402);
  setTier("pro");
  const a = Apps.addApp({ name: "Invoices", kind: "website", capabilities: ["analysis"], origin: "https://chatgpt.com/app", profile: "edge" });
  assert.equal(a.status, "draft");
  assert.equal(a.scores.analysis, 90);
  assert.equal(Apps.plannerRows().length, 0);
  Apps.setAllowed(a.id, true);
  assert.equal(Apps.plannerRows()[0].name, "Invoices");
  assert.ok(Agents.listExternalAgents().some((agent) => agent.name === "Invoices"));
  const writing = Apps.runJob(a.id, { capability: "writing", page: { actions: [{ action: "click", ref: "go" }] } });
  assert.equal(writing.handed, false);
  assert.match(writing.reason, /text model/);
  assert.throws(() => Apps.runJob(a.id, { browserRunning: true, page: { actions: [] } }), (e) => e.code === "browser_open");
  const page = Apps.runJob(a.id, {
    capability: "analysis",
    title: "Open invoices",
    page: {
      fields: [{ ref: "pw", label: "Password", type: "password" }],
      buttons: [{ ref: "go", label: "Open" }, { ref: "send", label: "Send" }],
      actions: [
        { action: "type", ref: "pw", text: "hunter2" },
        { action: "click", ref: "go" },
        { action: "click", ref: "send" },
      ],
    },
  });
  const dumped = JSON.stringify(page);
  assert.equal(dumped.includes("hunter2"), false);
  assert.equal(page.status, "needs_approval");
  assert.equal(page.relay, true);
  assert.match(page.warning, /cookies/);
  assert.ok(page.log.some((line) => /Refused a password/.test(line)));
  const stopped = Apps.runJob(a.id, {
    stopAfter: 1,
    page: { buttons: [{ ref: "go", label: "Open" }], actions: [{ action: "click", ref: "go" }, { action: "click", ref: "go" }] },
  });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.steps.length, 1);
  const done = Apps.runJob(a.id, {
    confirm: true,
    page: { buttons: [{ ref: "go", label: "Open" }], actions: [{ action: "click", ref: "go" }] },
  });
  assert.equal(done.status, "done");
  assert.equal(done.who?.model, "Invoices");
  Apps.setAllowed(a.id, false);
  assert.equal(Apps.plannerRows().length, 0);
  assert.equal(Agents.listExternalAgents().some((agent) => agent.name === "Invoices"), false);

  const desk = Apps.addApp({ name: "Ledger", kind: "desktop", capabilities: ["analysis"], exe: "Ledger.exe" });
  Apps.setAllowed(desk.id, true);
  const left = Apps.runJob(desk.id, { tree: { foreground: "Other.exe", exe: "Ledger.exe", nodes: [{ id: "ok", name: "Save" }] } });
  assert.match(left.reason, /Focus left/);
  const secret = Apps.runJob(desk.id, { tree: { foreground: "Ledger.exe", nodes: [{ id: "pw", name: "Password", password: true, value: "hunter2" }, { id: "ok", name: "Save" }] } });
  assert.equal(JSON.stringify(secret).includes("hunter2"), false);
  assert.ok(secret.log.some((line) => /password edit/i.test(line)));
  const del = Apps.runJob(desk.id, { tree: { foreground: "Ledger.exe", actions: [{ id: "del", name: "Delete", action: "click" }] } });
  assert.equal(del.status, "needs_approval");

  const shot = Apps.addApp({ name: "Canvas", kind: "desktop", capabilities: ["analysis"], screenshot: true });
  Apps.setAllowed(shot.id, true);
  assert.throws(() => Apps.runJob(desk.id, { useScreenshot: true, shots: [{ id: "a", title: "Desk", width: 10, height: 10 }] }), (e) => e.code === "screenshot_off");
  const estimate = Apps.runJob(shot.id, { shots: [{ id: "wide", title: "Desk", width: 2560, height: 1440 }] });
  assert.equal(estimate.status, "estimate");
  assert.equal(estimate.cap, 1);
  const pictures = Apps.runJob(shot.id, {
    seenEstimate: true,
    shots: [
      { id: "one", title: "Desk", width: 2560, height: 1440 },
      { id: "two", title: "Desk", width: 800, height: 600 },
      { id: "three", title: "Desk", width: 800, height: 600 },
    ],
  });
  assert.equal(pictures.steps.length, 2);
  assert.equal(pictures.steps[0].width, 1280);
  assert.deepEqual(pictures.sentImages, ["two"]);
  assert.match(pictures.reason, /cap/);
  const square = Apps.runJob(shot.id, { seenEstimate: true, shots: [{ id: "pay", title: "Square checkout", width: 800, height: 600 }] });
  assert.equal(square.status, "refused");
  assert.match(square.reason, /Square/);

  const mcp = Apps.addApp({ name: "Tools", kind: "mcp", capabilities: ["analysis"], mcpServerId: "demo-tools" });
  Apps.setAllowed(mcp.id, true);
  const read = Apps.runJob(mcp.id, { tool: { name: "clock", readOnlyHint: true, autoReadOnly: true } });
  assert.equal(read.status, "done");
  assert.equal(read.via, "mcp");
  const write = Apps.runJob(mcp.id, { tool: { name: "send_note", readOnlyHint: false, autoReadOnly: true } });
  assert.equal(write.status, "needs_approval");
  assert.equal(write.ran, undefined);
  for (const app of Apps.loadState().apps) Agents.unregisterExternalAgent(`app-${app.id}`);
});

test("recipes record once and wait on a scheduled send; Extreme is unlimited", () => {
  resetDocs();
  setTier("pro");
  const app = Apps.addApp({ name: "Forms", kind: "website", capabilities: ["analysis"] });
  Apps.setAllowed(app.id, true);
  Apps.runJob(app.id, { page: { buttons: [{ ref: "go", label: "Open" }], actions: [{ action: "click", ref: "go" }] } });
  const saved = Recipes.recordRecipe({ appId: app.id, name: "Open form", steps: [{ action: "click", ref: "go", text: "Open" }] });
  assert.equal(saved.steps.length, 1);
  const send = Recipes.recordRecipe({
    appId: app.id,
    name: "Monday send",
    cron: "* * * * *",
    steps: [{ action: "click", ref: "send", text: "Send the note" }],
  });
  const ran = Recipes.tick(Date.now());
  const hit = ran.find((row) => row.id === send.id);
  assert.equal(hit.performed, false);
  assert.equal(hit.lastStatus, "needs_approval");
  const layout = Recipes.replay(saved.id, { layoutChanged: true });
  assert.equal(layout.performed, false);
  assert.equal(layout.lastPlain, Recipes.LAYOUT_PLAIN);
  for (let i = 0; i < 3; i++) Recipes.recordRecipe({ appId: app.id, name: `Extra ${i}`, steps: [{ action: "click", ref: "go" }] });
  assert.equal(Recipes.publicState().recipes.length, 5);
  assert.throws(() => Recipes.recordRecipe({ appId: app.id, name: "Sixth", steps: [{ action: "click", ref: "go" }] }), (e) => e.code === "extreme_required");
  setTier("extreme");
  const more = Recipes.recordRecipe({ appId: app.id, name: "Sixth", steps: [{ action: "click", ref: "go" }] });
  assert.equal(more.name, "Sixth");
  Agents.unregisterExternalAgent(`app-${app.id}`);
  setTier(null);
});

test("monthly budget warns at 80 percent, stops paid runs at 100, and stays off until opt-in", () => {
  resetDocs();
  setTier(null);
  store.ctx().ledger.push({ ts: Date.now(), kind: "call", provider: "openai", model: "gpt-6-luna", cost: 90, inTok: 1, outTok: 1, savings: { saved: 1.25 } });
  assert.equal(Guard.assertSpendAllowed({ provider: "openai", estimate: 20 }).ok, true);
  const off = Guard.publicState();
  assert.equal(off.level, "off");
  assert.match(off.savedPlain, /1\.25/);
  assert.match(off.savedPlain, /Estimate/);
  Guard.saveGuard({ on: true, cap: 100 });
  assert.equal(Guard.publicState().level, "amber");
  store.ctx().ledger.push({ ts: Date.now(), kind: "call", provider: "openai", model: "gpt-6-luna", cost: 20, inTok: 1, outTok: 1 });
  assert.equal(Guard.publicState().level, "stop");
  assert.throws(() => Guard.assertSpendAllowed({ provider: "openai", estimate: 0.01 }), (e) => e.code === "budget_cap" && !e.message.includes(EM));
  assert.equal(Guard.assertSpendAllowed({ provider: "demo-nova", estimate: 5 }).ok, true);
  Guard.saveGuard({ cap: 200 });
  assert.equal(Guard.assertSpendAllowed({ provider: "openai", estimate: 0.01 }).ok, true);
  Guard.saveGuard({ on: false });
  store.putDoc("cost.guard", { optedIn: false, cap: null, paused: false });
  setTier("extreme");
  assert.equal(Guard.publicState().included, true);
  assert.equal(Guard.publicState().level, "stop");
  setTier(null);
});

test("phone approvals carry the action and the amount, and a decline sends nothing", () => {
  resetDocs();
  const pc = Phone.ask({ kind: "send", action: "Send the note to Ada", amount: 0 });
  assert.equal(pc.via, "pc");
  assert.equal(Phone.decide(pc.id, false, "pc").status, "declined");
  assert.throws(() => Phone.requireApproval(pc.id), (e) => e.code === "approval_required");
  store.putDoc("settings", { ...store.doc("settings"), phonePair: { on: true, token: TOKEN } });
  const phone = Phone.ask({ kind: "buy", action: "Buy stamps sk-abcdefghijklmnopqrstuvwxyz", amount: 4.5 });
  assert.equal(phone.via, "phone");
  const payload = Phone.pushPayload(phone.id);
  assert.deepEqual(Object.keys(payload).sort(), ["action", "amount"]);
  assert.equal(JSON.stringify(payload).includes("sk-"), false);
  assert.equal(payload.amount, 4.5);
  assert.throws(() => Phone.holdOutbound({ kind: "buy", action: "Buy stamps", amount: 4.5, approvalId: phone.id, confirmed: false }), (e) => e.code === "approval_required");
  Phone.decide(phone.id, true, "phone");
  assert.equal(Phone.holdOutbound({ kind: "buy", action: "Buy stamps", amount: 4.5, approvalId: phone.id, confirmed: false }).status, "approved");
  assert.throws(() => Phone.ask({ kind: "buy", action: "Buy", amount: "4111111111111111" }), (e) => e.status === 400);
  store.putDoc("settings", { ...store.doc("settings"), phonePair: { on: false, token: "" } });
  assert.equal(Phone.holdOutbound({ kind: "send", action: "Post", amount: null, confirmed: true }), null);
});

test("smarter control files stay plain and the version is unchanged", () => {
  const files = [
    "server/feature-gate.js", "server/learn-tune.js", "server/control-apps.js", "server/app-drivers.js", "server/recipes.js",
    "server/cost-guard.js", "server/phone-approvals.js", "web/features/smarter-control.js", "docs/help/smarter-control.md",
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.equal(text.includes(EM), false, file);
    assert.equal(/sk-ant-api03-[A-Za-z0-9]{8,}|sk-proj-[A-Za-z0-9]{8,}|AIza[0-9A-Za-z]{20}/.test(text), false, file);
  }
  assert.match(fs.readFileSync(path.join(ROOT, "server/mission.js"), "utf8"), /suggestApp\(/);
  assert.match(fs.readFileSync(path.join(ROOT, "server/mission.js"), "utf8"), /capability !== "writing"/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/BUILD-PLAN.md"), "utf8"), /Phase 57: Recipes/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/BUILD-PLAN.md"), "utf8"), /Phase 59: Cost guard/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/BUILD-PLAN.md"), "utf8"), /Phase 60: Phone approvals/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version, "0.4.15");
});

test("routes: a free copy cannot add an app, a Pro copy can run a fixture step", async () => {
  const free = await startServer();
  try {
    const denied = await free.api("/control-apps/apps", { method: "POST", body: { name: "Nope", kind: "desktop" } });
    assert.equal(denied.status, 402);
    const tune = await free.api("/learn-tune");
    assert.equal(tune.status, 200);
    assert.equal(tune.json.canUndo, false);
  } finally { await free.stop(); }

  const pro = await startServer({
    seed(dir) {
      fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ tier: "pro", status: "active", lastOkAt: Date.now(), checkedAt: Date.now(), key: "PRO-TEST" }));
    },
  });
  try {
    const added = await pro.api("/control-apps/apps", { method: "POST", body: { name: "Forms", kind: "website", capabilities: ["analysis"] } });
    assert.equal(added.status, 200, added.text);
    const allow = await pro.api("/control-apps/allow", { method: "POST", body: { id: added.json.id, allowed: true } });
    assert.equal(allow.json.planner.length, 1);
    const run = await pro.api("/control-apps/run", { method: "POST", body: { id: added.json.id, page: { buttons: [{ ref: "go", label: "Open" }], actions: [{ action: "click", ref: "go" }] } } });
    assert.equal(run.status, 200, run.text);
    assert.equal(run.json.status, "done");
    const recipe = await pro.api("/recipes", { method: "POST", body: { appId: added.json.id, name: "Open form" } });
    assert.equal(recipe.status, 200, recipe.text);
    const guard = await pro.api("/cost-guard", { method: "POST", body: { on: true, cap: 25 } });
    assert.equal(guard.json.optedIn, true);
    assert.equal(guard.json.cap, 25);
  } finally { await pro.stop(); }
});
