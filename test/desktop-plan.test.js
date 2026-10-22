// Desktop control never presses every control it reads (0.4.16 ship blocker). A desktop step with no list
// plans first and presses nothing; only a confirmed list is pressed, in order, and Stop halts it.
// Stand-in UI Automation, no real program, no key, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-desk-plan-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_APP_DRIVERS = "fake";
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const Apps = await import("../server/control-apps.js");
const Drivers = await import("../server/app-drivers.js");
const Agents = await import("../server/external-agents.js");

const NODES = [
  { id: "file", name: "File" },
  { id: "new", name: "New invoice" },
  { id: "pw", name: "Password", password: true },
  { id: "save", name: "Save" },
  { id: "del", name: "Delete", action: "click" },
  { id: "print", name: "Print" },
];
let invoked = [];
let onInvoke = null;
function setup() {
  Drivers.resetDriverHooks();
  store.putDoc("control.apps", { apps: [], using: null, stopped: {}, plans: {} });
  store.putDoc("phone.approvals", { items: [] });
  store.putDoc("license", { tier: "pro", status: "active", lastOkAt: Date.now(), checkedAt: Date.now(), key: "PRO-TEST" });
  invoked = [];
  onInvoke = null;
  Drivers.setDriverHooks({
    uia(cmd) {
      if (cmd.op === "invoke") { invoked.push(cmd.id); onInvoke?.(cmd.id); return { ok: true }; }
      return { focusLost: false, foreground: "Books.exe", nodes: NODES };
    },
  });
  const app = Apps.addApp({ name: `Books ${Math.random().toString(36).slice(2, 6)}`, kind: "desktop", capabilities: ["analysis"], exe: "Books.exe" });
  Apps.setAllowed(app.id, true);
  return app;
}
const done = () => { for (const a of Apps.loadState().apps) Agents.unregisterExternalAgent(`app-${a.id}`); };

test("no action list: zero presses, a planned list from the step's words, and nothing to press when it names none", async () => {
  const app = setup();
  const r = await Apps.runLive(app.id, { title: "Make an invoice", instructions: "Click New invoice, then Save.", live: true });
  assert.equal(r.status, "needs_confirm");
  assert.deepEqual(invoked, [], "nothing was pressed");
  assert.deepEqual(r.plan.map((a) => a.ref), ["new", "save"], "named controls, in the order the step names them");
  assert.ok(!r.plan.some((a) => a.ref === "pw"), "never a password field");
  assert.match(r.reason, /Nothing was pressed yet/);
  assert.ok(Apps.publicState().plans.some((p) => p.id === r.planId), "the list waits where the person can see it");
  assert.equal(Apps.publicState().using, null, "no banner while it only waits");
  const none = await Apps.runLive(app.id, { title: "Tidy up", instructions: "Make it nicer." });
  assert.equal(none.status, "nothing_to_press");
  assert.deepEqual(invoked, []);
  // a mission step plans even when it carries actions
  const fromMission = await Apps.runLive(app.id, { title: "Save it", instructions: "Save", fromMission: true, actions: [{ id: "del" }, { id: "print" }] });
  assert.equal(fromMission.status, "needs_confirm");
  assert.deepEqual(fromMission.plan.map((a) => a.ref), ["save"]);
  assert.deepEqual(invoked, []);
  done();
});

test("a planned list needs the confirm click; a send-style yes or Get it done does not press it", async () => {
  const app = setup();
  const r = await Apps.runLive(app.id, { title: "Save", instructions: "Save" });
  await assert.rejects(() => Apps.runLive(app.id, { planId: r.planId }), (e) => e.code === "confirm_plan");
  await assert.rejects(() => Apps.runLive(app.id, { planId: r.planId, confirm: true }), (e) => e.code === "confirm_plan");
  assert.deepEqual(invoked, []);
  const other = setup();
  await assert.rejects(() => Apps.runLive(other.id, { planId: r.planId, confirmPlan: true }), (e) => e.code === "no_plan", "a list is for its own app only");
  assert.deepEqual(invoked, []);
  // the /run route cannot carry a plan id; only the confirm route presses
  const route = fs.readFileSync(path.join(ROOT, "server", "plugins", "control-apps.js"), "utf8");
  assert.match(route, /delete payload\.planId; delete payload\.confirmPlan;/);
  assert.match(route, /plans[\s\S]*confirm[\s\S]*confirmPlan: true/);
  assert.match(fs.readFileSync(path.join(ROOT, "server", "mission.js"), "utf8"), /fromMission: true/);
  done();
});

test("only the confirmed controls are pressed, in order, once", async () => {
  const app = setup();
  const r = await Apps.runLive(app.id, { title: "Invoice", instructions: "Press New invoice and then Save." });
  assert.deepEqual(r.plan.map((a) => a.ref), ["new", "save"]);
  const pressed = await Apps.runLive(app.id, { planId: r.planId, confirmPlan: true });
  assert.equal(pressed.status, "done");
  assert.deepEqual(invoked, ["new", "save"], "exactly the list, nothing else in the window");
  await assert.rejects(() => Apps.runLive(app.id, { planId: r.planId, confirmPlan: true }), (e) => e.code === "no_plan", "a list is pressed once");
  assert.deepEqual(invoked, ["new", "save"]);
  // a list the person gave directly: controls that are not in the window are never pressed
  invoked = [];
  const given = await Apps.runLive(app.id, { actions: [{ id: "ghost", name: "Ghost" }, { id: "save", name: "Save" }] });
  assert.equal(given.status, "done");
  assert.deepEqual(invoked, ["save"]);
  done();
});

test("Stop halts a confirmed list between controls", async () => {
  const app = setup();
  const r = await Apps.runLive(app.id, { title: "Invoice", instructions: "File, New invoice, Save, Print" });
  assert.equal(r.plan.length, 4);
  onInvoke = () => { if (invoked.length === 1) Apps.stopUsing(app.id); };
  const out = await Apps.runLive(app.id, { planId: r.planId, confirmPlan: true });
  assert.equal(out.status, "stopped");
  assert.deepEqual(invoked, ["file"], "nothing after Stop");
  done();
});

test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {} });
