// Fixture drivers for desktop doors. No Edge, no profile read, no UI Automation, no screenshot model.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-doors-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const doors = await import("../server/desktop-doors.js");
const brain = await import("../server/brain.js");
const external = await import("../server/external-agents.js");
const { bus } = await import("../server/events.js");

describe("desktop doors", { concurrency: false }, () => {
test("free can see the lock, and allow is part of Pro", () => {
  const prev = process.env.CC_DEV_OWNER;
  delete process.env.CC_DEV_OWNER;
  try {
    assert.equal(doors.publicState().pro, false);
    assert.match(doors.publicState().note, /Desktop control is part of Pro/);
    assert.throws(() => doors.addApp({ name: "Invoices" }), /Desktop control is part of Pro/);
  } finally {
    if (prev) process.env.CC_DEV_OWNER = prev;
  }
});

test("an allowed app gets a node, a zero cost, and leaves the planner when revoked", () => {
  process.env.CC_DEV_OWNER = "1";
  const app = doors.addApp({ name: "Invoices", kind: "desktop", capabilities: ["analysis"], exe: "Invoices.exe" });
  assert.equal(app.status, "draft");
  assert.equal(doors.plannerRows().some((row) => row.model === app.model), false);
  const allowed = doors.setAllowed(app.id, true);
  assert.equal(allowed.allowed, true);
  assert.ok(external.resolveExternalAgent(`desk-${app.id}`));
  const before = bus.recent(400).length;
  const run = doors.dispatchMock(app.id);
  assert.equal(run.cost, 0);
  assert.equal(run.activity, "Mock step finished");
  const ev = bus.recent(400).slice(before);
  assert.ok(ev.some((item) => item.type === "agent.start"));
  assert.ok(ev.some((item) => item.type === "external.handoff" && item.status === "working"));
  assert.ok(ev.some((item) => item.type === "ledger.entry" && item.cost === 0));
  assert.ok(ev.some((item) => item.type === "agent.done"));
  assert.equal(JSON.stringify(ev).includes("sk-live"), false);
  doors.setAllowed(app.id, false);
  assert.equal(external.resolveExternalAgent(`desk-${app.id}`), null);
  assert.equal(doors.plannerRows().some((row) => row.model === app.model), false);
});

test("a fixture mission records the app and leaves writing on a text model", () => {
  process.env.CC_DEV_OWNER = "1";
  const app = doors.addApp({ name: "Invoices Desk", kind: "desktop", capabilities: ["analysis"], exe: "Invoices.exe" });
  doors.setAllowed(app.id, true);
  const assigned = doors.assignSteps([
    { capability: "writing", title: "Write the note", appId: app.id },
    { capability: "analysis", title: "Open invoices", appId: app.id },
  ]);
  assert.equal(assigned[0].kind, "text");
  assert.equal(assigned[1].kind, "app");
  assert.equal(assigned[1].capability, "analysis");
  doors.recordOutcome(app.id, { capability: "analysis", runId: "m-doors" });
  assert.ok(doors.whoNames().includes("Invoices Desk"));
  const row = brain.bestAtWhat().capabilities.find((cap) => cap.capability === "analysis");
  assert.ok(row.models.some((model) => model.model === app.model));
});

test("an MCP app uses the existing approval gate and not a second client", async () => {
  const src = fs.readFileSync(path.join(ROOT, "server", "desktop-doors.js"), "utf8");
  assert.match(src, /needsApproval/);
  assert.equal(src.includes("McpClient"), false);
  const read = { name: "list", annotations: { readOnlyHint: true } };
  const write = { name: "send", annotations: { readOnlyHint: false } };
  const quiet = { autoReadOnly: true, prefs: {} };
  const calls = [];
  const skipped = await doors.runMcpStep({ server: quiet, tool: read, callTool: async () => { calls.push("read"); return "ok"; } });
  assert.equal(skipped.ran, true);
  assert.equal(skipped.asked, false);
  const asked = await doors.runMcpStep({ server: quiet, tool: write, callTool: async () => { calls.push("write"); return "sent"; } });
  assert.equal(asked.asked, true);
  assert.equal(asked.ran, false);
  assert.equal(calls.includes("write"), false);
  const sent = await doors.runMcpStep({ server: quiet, tool: write, confirm: true, callTool: async () => { calls.push("write"); return "sent"; } });
  assert.equal(sent.ran, true);
  assert.deepEqual(calls, ["read", "write"]);
});

test("a fixture page is filled, a password is refused, and submit waits", async () => {
  process.env.CC_DEV_OWNER = "1";
  const html = `<form><input name="client" aria-label="Client"><input type="password" name="pw" aria-label="Password"><button type="submit">Send</button></form>`;
  const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/form`, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve(text));
      }).on("error", reject);
    });
    const app = doors.addApp({ name: "Client site", kind: "website", origin: `http://127.0.0.1:${port}/form` });
    doors.setAllowed(app.id, true);
    const held = await doors.runWebsite({
      id: app.id,
      url: `http://127.0.0.1:${port}/form`,
      html: body,
      actions: [{ action: "type", ref: "client", text: "Ada" }, { action: "type", ref: "pw", text: "secret-pass" }, { action: "submit" }],
    });
    assert.equal(held.needsApproval, true);
    assert.equal(held.filled.client, "Ada");
    assert.equal(held.filled.pw, undefined);
    assert.equal(JSON.stringify(held).includes("secret-pass"), false);
    assert.match(held.lines.join("\n"), /refused password field pw/);
    const halted = await doors.runWebsite({
      id: app.id,
      url: `http://127.0.0.1:${port}/form`,
      html: body,
      actions: [{ action: "type", ref: "client", text: "Ada" }],
      stopped: true,
    });
    assert.equal(halted.stopped, true);
    assert.equal(halted.filled.client, undefined);
    const helper = fs.readFileSync(path.join(ROOT, "server", "desktop-doors.js"), "utf8");
    assert.equal(helper.includes("persist:cc-browser-helper"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a running browser blocks the signed-in profile, and a closed fixture does not get read", () => {
  process.env.CC_DEV_OWNER = "1";
  const root = tmpDir("cc-profile-");
  const profile = path.join(root, "Profile");
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, "Cookies"), "do-not-read");
  assert.throws(() => doors.runSignedIn({ browserRunning: true, profilePath: profile, fixtureRoot: root }), /Close Edge or Chrome/);
  assert.equal(fs.readFileSync(path.join(profile, "Cookies"), "utf8"), "do-not-read");
  const closed = doors.runSignedIn({ browserRunning: false, profilePath: profile, fixtureRoot: root, origin: "https://chatgpt.com/c/1" });
  assert.equal(closed.touched, profile);
  assert.equal(closed.read, false);
  assert.equal(closed.relay, true);
  assert.throws(() => doors.runSignedIn({ browserRunning: false, profilePath: "/tmp/real-chrome", fixtureRoot: root }), /fixture profile/);
});

test("the desktop tree clicks the allowed button and refuses a password and a delete", () => {
  process.env.CC_DEV_OWNER = "1";
  const app = doors.addApp({ name: "Ledger", kind: "desktop", exe: "Ledger.exe", capabilities: ["analysis"] });
  doors.setAllowed(app.id, true);
  const tree = [
    { id: "open", name: "Invoices", type: "button" },
    { id: "pw", name: "Password", type: "password", password: true },
    { id: "del", name: "Delete", type: "button" },
  ];
  const away = doors.runDesktopTree({ id: app.id, tree, foregroundExe: "Other.exe", actions: [{ ref: "open" }] });
  assert.equal(away.did, false);
  const held = doors.runDesktopTree({ id: app.id, tree, foregroundExe: "Ledger.exe", actions: [{ ref: "open" }, { ref: "pw" }, { ref: "del" }] });
  assert.equal(held.needsApproval, true);
  assert.match(held.lines.join("\n"), /clicked Invoices/);
  assert.match(held.lines.join("\n"), /refused password edit pw/);
  assert.equal(held.lines.some((line) => /Delete/.test(line) && /clicked/.test(line)), false);
});

test("screenshot steps drop the previous image, stop at the cap, and refuse Stripe", () => {
  process.env.CC_DEV_OWNER = "1";
  const app = doors.addApp({ name: "Canvas", kind: "desktop", exe: "Canvas.exe", screenshot: true });
  doors.setAllowed(app.id, true);
  const run = doors.runScreenshot({
    id: app.id,
    steps: [
      { images: ["shot-1"], click: { x: 1, y: 1 }, target: "Invoices" },
      { images: ["shot-1", "shot-2"], click: { x: 2, y: 2 }, target: "Save" },
    ],
  });
  assert.deepEqual(run.sent[1], ["shot-2"]);
  const capped = doors.runScreenshot({
    id: app.id,
    capUsd: 1,
    steps: [
      { images: ["a", "b"], target: "One" },
      { images: ["c"], target: "Two" },
    ],
  });
  assert.equal(capped.stopped, true);
  assert.equal(capped.sent.length, 1);
  const refused = doors.runScreenshot({ id: app.id, steps: [{ images: ["d"], target: "Stripe checkout", click: { x: 9, y: 9 } }] });
  assert.equal(refused.refused, true);
  assert.equal(refused.clicks.length, 0);
});

test("the route is Pro and the copy has no em dash", async () => {
  const files = ["server/desktop-doors.js", "server/plugins/desktop-doors.js", "web/features/desktop-doors.js", "docs/help/desktop-apps.md"];
  for (const file of files) assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes("\u2014"), false, file);
  const free = await startServer();
  try {
    const view = await free.api("/desktop-doors");
    assert.equal(view.status, 200);
    assert.equal(view.json.pro, false);
    const denied = await free.api("/desktop-doors/apps", { method: "POST", body: { name: "Nope" } });
    assert.equal(denied.status, 402);
  } finally { await free.stop(); }
  const pro = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const made = await pro.api("/desktop-doors/apps", { method: "POST", body: { name: "Planner", kind: "desktop", exe: "Planner.exe" } });
    assert.equal(made.status, 200);
    assert.equal(made.json.status, "draft");
    const rows = await pro.api("/desktop-doors/planner");
    assert.equal(rows.json.apps.length, 0);
    await pro.api("/desktop-doors/allow", { method: "POST", body: { id: made.json.id, allowed: true } });
    const listed = await pro.api("/desktop-doors/planner");
    assert.equal(listed.json.apps[0].name, "Planner");
  } finally { await pro.stop(); }
});
});
