// Real app drivers with stand-ins. No Edge, no UI Automation process, no model, no real key, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpDir, ROOT, startServer } from "./helpers.js";

const DIR = tmpDir("cc-drivers-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_APP_DRIVERS = "fake";
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));

const Apps = await import("../server/control-apps.js");
const Drivers = await import("../server/app-drivers.js");
const Agents = await import("../server/external-agents.js");

function setTier() {
  store.putDoc("license", { tier: "pro", status: "active", lastOkAt: Date.now(), checkedAt: Date.now(), key: "PRO-TEST" });
}
function reset() {
  Drivers.resetDriverHooks();
  store.putDoc("control.apps", { apps: [], using: null, stopped: {} });
  store.putDoc("phone.approvals", { items: [] });
  store.ctx().ledger = [];
}
function dropAgents() {
  for (const app of Apps.loadState().apps) Agents.unregisterExternalAgent(`app-${app.id}`);
}
function pageSession(page, calls) {
  return {
    async goto(url) { calls.goto.push(url); page.url = url; },
    async snapshot() { return { ...page, fields: page.fields, buttons: page.buttons }; },
    async click(ref) { calls.click.push(ref); },
    async type(ref, text) { calls.type.push({ ref, text }); },
    async close() { calls.closed += 1; },
  };
}

test("Edge through Playwright refuses a password and a Square screen, shows the banner, and Stop halts the next step", async () => {
  reset();
  setTier();
  const calls = { goto: [], click: [], type: [], opened: null, closed: 0 };
  let title = "Invoices";
  Drivers.setDriverHooks({
    processes() { throw new Error("the owned profile must not look at a running browser"); },
    browser(plan) {
      calls.opened = plan;
      const page = {
        url: "https://invoices.example/home",
        get title() { return title; },
        fields: [{ ref: "f0", label: "Password", type: "password" }, { ref: "f1", label: "Note", type: "text" }],
        buttons: [{ ref: "b0", label: "Open" }, { ref: "b1", label: "Send" }],
      };
      return pageSession(page, calls);
    },
  });
  const app = Apps.addApp({ name: "Driver Invoices", kind: "website", capabilities: ["analysis"], origin: "https://invoices.example/home", profile: "edge" });
  assert.equal(app.signedIn, false);
  Apps.setAllowed(app.id, true);
  const typed = await Apps.runLive(app.id, {
    actions: [
      { action: "type", ref: "f0", text: "hunter2" },
      { action: "type", ref: "f1", text: "hello" },
      { action: "click", ref: "b0" },
    ],
  });
  assert.equal(typed.driver, "playwright");
  assert.equal(typed.signedIn, false);
  assert.equal(typed.warning, "");
  assert.equal(JSON.stringify(typed).includes("hunter2"), false);
  assert.ok(typed.log.some((line) => /Refused a password/.test(line)));
  assert.deepEqual(calls.type, [{ ref: "f1", text: "hello" }]);
  assert.deepEqual(calls.click, ["b0"]);
  assert.equal(calls.opened.signedIn, false);
  assert.equal(calls.opened.channel, "msedge");
  assert.ok(calls.opened.dir.includes(`${path.sep}app-profiles${path.sep}`));
  assert.ok(calls.closed >= 1);
  const send = await Apps.runLive(app.id, { actions: [{ action: "click", ref: "b1" }] });
  assert.equal(send.status, "needs_approval");
  assert.match(send.reason, /send/);
  assert.equal(calls.click.includes("b1"), false);
  assert.match(Apps.publicState().using.text, /Meldmind is using Driver Invoices/);
  title = "Square checkout";
  const before = calls.click.length;
  const billed = await Apps.runLive(app.id, { actions: [{ action: "click", ref: "b0" }] });
  assert.equal(billed.status, "refused");
  assert.match(billed.reason, /Square/);
  assert.equal(calls.click.length, before);
  title = "Invoices";
  const stopped = await Apps.runLive(app.id, {
    stopAfter: 1,
    actions: [{ action: "click", ref: "b0" }, { action: "click", ref: "b0" }],
  });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.steps.length, 1);
  const pay = Apps.addApp({ name: "Driver Pay", kind: "website", capabilities: ["analysis"], origin: "https://squareup.com/pay" });
  Apps.setAllowed(pay.id, true);
  const refused = await Apps.runLive(pay.id, { actions: [{ action: "click", ref: "b0" }] });
  assert.equal(refused.status, "refused");
  assert.match(refused.reason, /Square/);
  dropAgents();
});

test("a signed-in profile is used only after an explicit opt-in, and a running browser blocks it", async () => {
  reset();
  setTier();
  const prev = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(os.tmpdir(), "cc-profile-test");
  let opened = 0;
  try {
    Drivers.setDriverHooks({
      processes() { return true; },
      browser() { opened += 1; throw new Error("should not open"); },
    });
    const app = Apps.addApp({
      name: "Driver Mail", kind: "website", capabilities: ["analysis"],
      origin: "https://mail.example/inbox", profile: "chrome", signedIn: true,
    });
    assert.equal(app.signedIn, true);
    Apps.setAllowed(app.id, true);
    await assert.rejects(() => Apps.runLive(app.id, {}), (err) => err.code === "browser_open");
    assert.equal(opened, 0);
    Drivers.setDriverHooks({
      processes() { return false; },
      browser(plan) {
        opened += 1;
        assert.equal(plan.signedIn, true);
        assert.equal(plan.channel, "chrome");
        assert.match(plan.dir, /Chrome[/\\]User Data$/);
        assert.equal(plan.dir.includes("app-profiles"), false);
        return {
          async goto() {},
          async snapshot() { return { url: "https://mail.example/inbox", title: "Inbox", fields: [], buttons: [] }; },
          async click() {},
          async type() {},
          async close() {},
        };
      },
    });
    const read = await Apps.runLive(app.id, {});
    assert.equal(read.status, "done");
    assert.equal(read.driver, "playwright");
    assert.equal(read.signedIn, true);
    assert.match(read.warning, /cookies/);
    assert.equal(opened, 1);
    const quiet = Apps.addApp({ name: "Driver Owned", kind: "website", capabilities: ["research"], origin: "https://notes.example", profile: "edge", signedIn: false });
    assert.equal(quiet.signedIn, false);
  } finally {
    if (prev === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prev;
    dropAgents();
  }
});

test("Windows UI Automation stays on the allowed program, refuses a password edit, and waits before delete", async () => {
  reset();
  setTier();
  const invoked = [];
  let focusLost = true;
  Drivers.setDriverHooks({
    uia(cmd) {
      if (cmd.op === "invoke") {
        invoked.push(cmd.id);
        return { ok: true };
      }
      if (focusLost) return { focusLost: true, foreground: "Other.exe" };
      return {
        focusLost: false,
        foreground: "Ledger.exe",
        nodes: [
          { id: "pw", name: "Password", password: true, value: "hunter2" },
          { id: "ok", name: "Save" },
          { id: "del", name: "Delete", action: "click" },
        ],
      };
    },
  });
  const app = Apps.addApp({ name: "Driver Ledger", kind: "desktop", capabilities: ["analysis"], exe: "Ledger.exe" });
  Apps.setAllowed(app.id, true);
  const left = await Apps.runLive(app.id, {});
  assert.equal(left.status, "stopped");
  assert.match(left.reason, /Focus left/);
  assert.equal(invoked.length, 0);
  focusLost = false;
  const secret = await Apps.runLive(app.id, { actions: [{ id: "pw", name: "Password" }, { id: "ok", name: "Save" }] });
  assert.equal(JSON.stringify(secret).includes("hunter2"), false);
  assert.ok(secret.log.some((line) => /password edit/i.test(line)));
  assert.deepEqual(invoked, ["ok"]);
  const del = await Apps.runLive(app.id, { actions: [{ id: "del", name: "Delete", action: "click" }] });
  assert.equal(del.status, "needs_approval");
  assert.equal(invoked.includes("del"), false);
  assert.match(Apps.publicState().using.text, /Meldmind is using Driver Ledger/);
  dropAgents();
});

test("screenshot control asks first, drops the older picture, and refuses a billing screen before any click", async () => {
  reset();
  setTier();
  const seen = [];
  const clicks = [];
  Drivers.setDriverHooks({
    target() { return { vendor: "anthropic", model: "claude-haiku-5-5" }; },
    screen() { throw new Error("a supplied picture must not grab the screen"); },
    computer(req) {
      const body = JSON.stringify(req.body);
      seen.push(body);
      assert.equal(req.body.tools[0].type, "computer_toolset_20260801");
      assert.equal(body.includes("sk-"), false);
      assert.equal(req.headers, undefined);
      const data = req.body.messages[0].content.find((part) => part.type === "image").source.data;
      if (data === "shot-send") return { action: "click", x: 8, y: 9, why: "Send the form" };
      return { action: "click", x: 2, y: 3, why: "" };
    },
    click(point) { clicks.push(point); },
  });
  const app = Apps.addApp({ name: "Driver Canvas", kind: "desktop", capabilities: ["analysis"], screenshot: true, exe: "Canvas.exe" });
  Apps.setAllowed(app.id, true);
  const estimate = await Apps.runLive(app.id, { shots: [{ id: "shot-aaa", title: "Desk", width: 2560, height: 1440, data: "shot-aaa" }] });
  assert.equal(estimate.status, "estimate");
  assert.equal(estimate.cap, 1);
  assert.equal(seen.length, 0);
  assert.equal(clicks.length, 0);
  const pictures = await Apps.runLive(app.id, {
    seenEstimate: true,
    shots: [
      { id: "shot-aaa", title: "Desk", width: 2560, height: 1440, data: "shot-aaa" },
      { id: "shot-bbb", title: "Desk", width: 800, height: 600, data: "shot-bbb" },
      { id: "shot-ccc", title: "Desk", width: 800, height: 600, data: "shot-ccc" },
    ],
  });
  assert.equal(pictures.steps.length, 2);
  assert.equal(pictures.steps[0].width, 1280);
  assert.deepEqual(pictures.sentImages, ["shot-bbb"]);
  assert.match(pictures.reason, /cap/);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].includes("shot-bbb"), false);
  assert.equal(seen[1].includes("shot-aaa"), false);
  assert.equal(seen[1].includes("shot-bbb"), true);
  assert.equal(clicks.length, 2);
  const square = await Apps.runLive(app.id, {
    seenEstimate: true,
    shots: [{ id: "shot-pay", title: "Square checkout", width: 800, height: 600, data: "shot-pay" }],
  });
  assert.equal(square.status, "refused");
  assert.match(square.reason, /Square/);
  assert.equal(seen.length, 2);
  assert.equal(clicks.length, 2);
  const send = await Apps.runLive(app.id, {
    seenEstimate: true,
    shots: [{ id: "shot-send", title: "Desk", width: 800, height: 600, data: "shot-send" }],
  });
  assert.equal(send.status, "needs_approval");
  assert.equal(clicks.length, 2);
  const stored = JSON.stringify(store.ctx().ledger);
  assert.equal(stored.includes("shot-aaa"), false);
  assert.equal(stored.includes("sk-"), false);
  dropAgents();
});

test("suggestApp is how the planner assigns an app step, and writing stays with a text model", () => {
  reset();
  setTier();
  const app = Apps.addApp({ name: "Driver Analysis", kind: "desktop", capabilities: ["analysis"], exe: "Analysis.exe" });
  Apps.setAllowed(app.id, true);
  const writer = Apps.addApp({ name: "Driver Pen", kind: "desktop", capabilities: ["writing"], exe: "Pen.exe" });
  Apps.setAllowed(writer.id, true);
  assert.equal(Apps.suggestApp("analysis").id, app.id);
  assert.equal(Apps.suggestApp("writing").id, writer.id);
  assert.equal(Apps.suggestApp("code"), null);
  const mission = fs.readFileSync(path.join(ROOT, "server", "mission.js"), "utf8");
  const assign = mission.slice(mission.indexOf("suggestApp(") - 180, mission.indexOf("suggestApp(") + 40);
  assert.match(assign, /capability !== "writing"/);
  assert.match(mission, /runLive\(/);
  const drivers = fs.readFileSync(path.join(ROOT, "server", "app-drivers.js"), "utf8");
  assert.match(drivers, /playwright-core/);
  assert.match(drivers, /computer_toolset_20260801/);
  assert.match(drivers, /UIAutomationClient/);
  assert.match(drivers, /IsPasswordProperty/);
  assert.equal(drivers.includes("\u2014"), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version, "0.4.8");
  dropAgents();
});

test("a live route stays off the real browser when the test driver is faked", async () => {
  const pro = await startServer({
    env: { CC_APP_DRIVERS: "fake" },
    seed(dir) {
      fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ tier: "pro", status: "active", lastOkAt: Date.now(), checkedAt: Date.now(), key: "PRO-TEST" }));
    },
  });
  try {
    const added = await pro.api("/control-apps/apps", { method: "POST", body: { name: "Driver Forms", kind: "website", capabilities: ["analysis"], origin: "https://forms.example" } });
    assert.equal(added.status, 200, added.text);
    assert.equal(added.json.signedIn, false);
    await pro.api("/control-apps/allow", { method: "POST", body: { id: added.json.id, allowed: true } });
    const live = await pro.api("/control-apps/run", { method: "POST", body: { id: added.json.id, live: true, title: "Open the form" } });
    assert.equal(live.status, 400, live.text);
    assert.equal(live.json.code, "driver_off");
    assert.equal(live.text.includes("sk-"), false);
    const fixture = await pro.api("/control-apps/run", { method: "POST", body: { id: added.json.id, page: { buttons: [{ ref: "go", label: "Open" }], actions: [{ action: "click", ref: "go" }] } } });
    assert.equal(fixture.json.status, "done");
    assert.equal(fixture.json.driver, undefined);
  } finally { await pro.stop(); }
});
