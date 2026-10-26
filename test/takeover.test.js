// Multi-AI takeover and Owner tools (Slice D3, flag_takeover).
// Part 1 drives server/takeover.js in this process with a fake MCP server and a fake scheduler.
// Part 2 starts the real server: the flag is OFF by default, owner routes refuse a free account.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, waitBudget, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-takeover-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const T = await import("../server/takeover.js");
const { takeoverOn, flagView } = await import("../server/flags.js");
const { riskyAction } = await import("../server/action-policy.js");

const calls = [];
const created = [];
let tier = "free";
const TASKS = JSON.stringify({ tasks: [
  { id: "t1", name: "Morning digest", prompt: "Summarise my inbox. key sk-ABCDEF1234567890ABCDEF", schedule: "0 9 * * 1-5" },
  { id: "t2", name: "Odd timing", prompt: "Check prices", schedule: "every other Tuesday" },
] });
const tools = [
  { name: "list_scheduled_tasks", inputSchema: { type: "object", properties: {} } },
  { name: "delete_scheduled_task", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "pause_scheduled_task", inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } },
  { name: "create_project", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name"] } },
];
const client = { callTool: async (name, args) => { calls.push({ name, args }); return { text: name === "list_scheduled_tasks" ? TASKS : "ok", isError: false }; } };
T.configure({
  now: () => 1000,
  listServers: () => [{ id: "acme", name: "Acme AI", enabled: true }, { id: "dead", name: "Dead AI", enabled: true }],
  connect: async (id) => { if (id === "dead") throw new Error("refused"); return { tools, client }; },
  tier: () => tier,
  listProjects: () => [{ id: "p1", name: "Launch", summary: "Spring launch plan", categories: [{ id: "c", name: "Social" }] }],
  createSchedule: (input) => { created.push(input); return { schedule: { id: "sch-1" } }; },
  bridgeReady: () => false,
});

test("flag: takeover is ON by default and env or a saved setting turns it off", () => {
  delete process.env.CC_FLAG_TAKEOVER;
  assert.equal(takeoverOn({}), true);
  assert.equal(takeoverOn({ flag_takeover: true }), true);
  assert.equal(flagView().takeover, true);
  process.env.CC_FLAG_TAKEOVER = "1";
  assert.equal(takeoverOn({ flag_takeover: false }), true);
  assert.equal(flagView().takeover, true);
  process.env.CC_FLAG_TAKEOVER = "0";
  assert.equal(takeoverOn({ flag_takeover: true }), false);
  delete process.env.CC_FLAG_TAKEOVER;
  // flagView lists every flag in the shared table, so new slices do not break this test
  for (const k of ["nextactions", "projectbar", "projectmedia", "promptdrop", "takeover"]) assert.ok(k in flagView(), k);
});

test("looking uses only plain list tools and reports servers that fail", async () => {
  assert.equal(T.isLookTool(tools[0]), true);
  assert.equal(T.isLookTool(tools[1]), false);
  assert.equal(T.isLookTool({ name: "list_tasks", inputSchema: { required: ["q"] } }), false);
  assert.equal(riskyAction(tools[1]), true);
  const r = await T.lookForTasks();
  assert.deepEqual(calls.map((c) => c.name), ["list_scheduled_tasks"]);
  assert.equal(r.report.find((x) => x.source === "Acme AI").count, 2);
  assert.equal(r.report.find((x) => x.source === "Dead AI").ok, false);
  const a = r.view.tasks.find((t) => t.extId === "t1");
  assert.equal(a.cron, "0 9 * * 1-5");
  assert.ok(!/sk-ABCDEF/.test(a.prompt), "secrets are stripped");
  assert.equal(a.canPause, true);
  assert.equal(r.view.tasks.find((t) => t.extId === "t2").needsTime, true);
});

test("take over needs a confirm, makes a paused schedule, and never twice", async () => {
  const view = T.reviewView();
  const a = view.tasks.find((t) => t.extId === "t1");
  assert.throws(() => T.takeOver(a.id, {}), (e) => e.code === "confirm");
  assert.equal(created.length, 0);
  const done = T.takeOver(a.id, { confirm: true });
  assert.equal(done.scheduleId, "sch-1");
  assert.equal(created[0].enabled, false);
  assert.equal(created[0].trigger.cron, "0 9 * * 1-5");
  assert.equal(created[0].target.kind, "chat");
  assert.throws(() => T.takeOver(a.id, { confirm: true }), (e) => e.code === "already");
  const b = view.tasks.find((t) => t.extId === "t2");
  assert.throws(() => T.takeOver(b.id, { confirm: true }), (e) => e.code === "needs_time");
  T.takeOver(b.id, { confirm: true, cron: "30 8 * * 1" });
  assert.equal(created[1].trigger.cron, "30 8 * * 1");
});

test("pausing the original is separate, confirmed, and uses the pause tool", async () => {
  const a = T.reviewView().tasks.find((t) => t.extId === "t1");
  await assert.rejects(T.pauseOriginal(a.id, {}), (e) => e.code === "confirm");
  const before = calls.length;
  await T.pauseOriginal(a.id, { confirm: true });
  assert.deepEqual(calls[before], { name: "pause_scheduled_task", args: { task_id: "t1" } });
  assert.equal(T.reviewView().tasks.find((t) => t.extId === "t1").pausedOriginal, true);
});

test("export import reads JSON, rejects junk, and dismiss hides a row", () => {
  assert.throws(() => T.importExport({ text: "not json" }), (e) => e.code === "unreadable");
  assert.throws(() => T.importExport({ text: "" }), (e) => e.code === "empty");
  const v = T.importExport({ text: JSON.stringify([{ name: "Weekly", prompt: "Report", cron: "@weekly" }]), label: "ChatGPT export" });
  const w = v.tasks.find((t) => t.name === "Weekly");
  assert.equal(w.canPause, false);
  const after = T.dismissTask(w.id);
  assert.ok(!after.tasks.some((t) => t.name === "Weekly"));
});

test("mirroring shows the brief first and sends only on confirm", async () => {
  const prev = await T.mirrorPreview("p1");
  assert.match(prev.brief, /Launch/);
  assert.match(prev.brief, /Social/);
  assert.deepEqual(prev.targets.map((t) => t.id), ["acme"]);
  assert.equal(prev.targets[0].tool, "create_project");
  const before = calls.length;
  await assert.rejects(T.mirrorPush("p1", { kind: "mcp", id: "acme" }), (e) => e.code === "confirm");
  assert.equal(calls.length, before);
  await assert.rejects(T.mirrorPush("p1", { kind: "mcp", id: "nope", confirm: true }), (e) => e.code === "target");
  await T.mirrorPush("p1", { kind: "mcp", id: "acme", confirm: true });
  const sent = calls[calls.length - 1];
  assert.equal(sent.name, "create_project");
  assert.equal(sent.args.name, "Launch");
  assert.match(sent.args.description, /Spring launch plan/);
  await assert.rejects(T.mirrorPreview("missing"), (e) => e.code === "project");
});

test("owner tools: owner tier only, confirm, ranges, and undo", () => {
  tier = "pro";
  assert.throws(() => T.ownerChange({ transport: "mcp" }, { confirm: true }), (e) => e.code === "owner_only");
  assert.throws(() => T.ownerView(), (e) => e.code === "owner_only");
  tier = "owner";
  assert.throws(() => T.ownerChange({ transport: "mcp" }, {}), (e) => e.code === "confirm");
  assert.throws(() => T.ownerChange({ transport: "bogus" }, { confirm: true }), (e) => e.code === "range");
  assert.throws(() => T.ownerChange({ nope: 1 }, { confirm: true }), (e) => e.code === "unknown");
  assert.throws(() => T.ownerChange({ finishLow: 0.9, finishHigh: 0.7 }, { confirm: true }), (e) => e.code === "range");
  assert.equal(T.ownerSettings().transport, "auto");
  const r = T.ownerChange({ transport: "mcp", momentumBarSize: "4" }, { confirm: true });
  assert.equal(r.settings.transport, "mcp");
  assert.equal(r.settings.momentumBarSize, 4);
  const v = T.ownerView({ routing: () => ({ plain: "Routing is as set." }), toolLog: () => [{ tool: "x" }] });
  assert.equal(v.routing.plain, "Routing is as set.");
  assert.equal(v.history.length, 1);
  T.ownerUndo({ confirm: true });
  assert.equal(T.ownerSettings().transport, "auto");
  assert.throws(() => T.ownerUndo({ confirm: true }), (e) => e.code === "empty");
});

test("no em dashes in the slice files", () => {
  for (const f of ["server/takeover.js", "server/plugins/takeover.js", "web/takeover-panel.js", "test/takeover.test.js"]) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes(String.fromCharCode(8212)), f);
  }
});

test("web panel: rows escape text and owner panel shows only controls", async () => {
  const P = await import("../web/takeover-panel.js");
  assert.equal(P.takeoverEnabled({ flags: { takeover: true } }), true);
  assert.equal(P.takeoverEnabled({ flags: {}, settings: {} }), false);
  assert.equal(P.isOwnerTier({ license: { tier: "owner" } }), true);
  assert.equal(P.isOwnerTier({ license: { tier: "pro" } }), false);
  const html = P.taskRowHtml({ id: "tk-1", name: "<img src=x>", sourceName: "A", when: "", prompt: "", needsTime: true });
  assert.ok(!html.includes("<img"));
  assert.match(html, /data-tk-take/);
  assert.match(html, /data-tk-cron/);
  assert.match(P.ownerHtml({ settings: T.OWNER_DEFAULTS, history: [] }), /Owner tools/);
});

test("server: flag OFF by env, ON by default, owner routes refuse a free account", { timeout: waitBudget(90000) }, async () => {
  const off = await startServer({ env: { CC_FLAG_TAKEOVER: "0" } });
  try {
    const r = await off.api("/takeover/state");
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "flag_off");
    assert.equal((await off.api("/takeover/state", { noToken: true })).status, 401);
  } finally { await off.stop(); }
  const on = await startServer({ env: { CC_FLAG_TAKEOVER: "1" } });
  try {
    const st = await on.api("/takeover/state");
    assert.equal(st.status, 200);
    assert.equal(st.json.owner, false);
    assert.deepEqual(st.json.review.tasks, []);
    const look = await on.api("/takeover/look", { method: "POST", body: {} });
    assert.equal(look.status, 200);
    assert.deepEqual(look.json.report, []);
    assert.equal((await on.api("/takeover/owner")).status, 403);
    assert.equal((await on.api("/takeover/owner/change", { method: "POST", body: { patch: { transport: "mcp" }, confirm: true } })).status, 403);
    const imp = await on.api("/takeover/import", { method: "POST", body: { text: JSON.stringify([{ name: "Weekly", prompt: "Report", cron: "@weekly" }]) } });
    assert.equal(imp.status, 200);
    const id = imp.json.tasks[0].id;
    assert.equal((await on.api(`/takeover/task/${id}/take`, { method: "POST", body: {} })).json.code, "confirm");
    const took = await on.api(`/takeover/task/${id}/take`, { method: "POST", body: { confirm: true } });
    assert.equal(took.status, 200);
    const sched = await on.api("/schedules");
    const mine = sched.json.items.find((s) => s.id === took.json.scheduleId);
    assert.equal(mine.enabled, false);
    const state = await on.api("/state");
    assert.equal(state.json.flags.takeover, true);
  } finally { await on.stop(); }
});

test("0.4.21: prompt keeps its lines, Safer copy has something to copy, every-minute schedules are refused", async () => {
  const src = { id: "x", name: "Other AI", kind: "export" };
  const t = T.normalizeTask({ id: "multi", name: "Weekly", prompt: "Summarise the week.\nSend it to the team.\nSave a note.", cron: "0 9 * * 1" }, src);
  assert.equal(t.prompt.split("\n").length, 3);
  const { taskRowHtml, saferCopy, riskyLines } = await import("../web/takeover-panel.js");
  assert.equal(riskyLines(t.prompt).length, 1);
  assert.equal(saferCopy(t.prompt), "Summarise the week.\nSave a note.");
  const html = taskRowHtml({ id: "a", name: "Weekly", sourceName: "Other AI", prompt: t.prompt, active: true });
  assert.match(html, /Contains words that send, delete or pay \(1\)/);
  assert.match(html, /data-tk-safer-text="Summarise the week/);
  const allBad = taskRowHtml({ id: "b", name: "Bad", sourceName: "Other AI", prompt: "Send it.\nDelete it.", active: true });
  assert.match(allBad, /disabled title="Every line sends, deletes or pays/);
  assert.equal(T.everyMinute("* * * * *"), true);
  assert.equal(T.everyMinute("*/1 * * * *"), true);
  assert.equal(T.everyMinute("0 9 * * 1-5"), false);
  assert.equal(T.everyMinute("*/5 * * * *"), false);
});
