// Dogfood 11, item P-sched: "After the run: save as a note" (server/schedules.js) plus the words the
// schedule screen uses for it. Drives server/schedules.js in this process with a fake clock, a fake runner
// and a temporary data folder, so no real AI, key, network or the repo's data/ folder is touched.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mm-sched-p-"));
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const S = await import("../server/schedules.js");
const pm = await import("../server/project-media.js");

let now = new Date(2026, 9, 26, 9, 0, 0).getTime(); // Sunday, October 26 2026, 9:00
const calls = [];
let runResult = () => ({ status: "done", cost: 0.001, deliverable: "Three short ideas for the week." });
S.configure({
  now: () => now,
  run: async (s, o) => { calls.push({ id: s.id, ...o }); return runResult(s, o); },
  alert: () => {},
  send: async () => ({ status: 200 }),
});

const cron = (over = {}) => ({ name: "Weekly brief", target: { kind: "chat", text: "Summarise the week." }, trigger: { type: "cron", cron: "0 9 * * 1" }, capUsd: 5, ...over });
const read = (f) => fs.readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8").replace(/\r\n/g, "\n");

after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {} });

test("save as a note is the default after action for a new Mission or Agent schedule", () => {
  const m = S.createSchedule(cron({ name: "Mission note", target: { kind: "mission", text: "Write 3 ideas.", projectId: "my-project" } })).schedule;
  assert.equal(m.after.action, "note");
  const a = S.createSchedule(cron({ name: "Agent note", target: { kind: "agent", agentId: "ag-x", text: "" } }), { agentExists: () => true }).schedule;
  assert.equal(a.after.action, "note");
  const c = S.createSchedule(cron()).schedule;
  assert.equal(c.after.action, "none", "a Chat schedule still keeps the result here");
  const picked = S.createSchedule(cron({ name: "Chosen", after: { action: "none" } })).schedule;
  assert.equal(picked.after.action, "none", "the person's own choice is kept");
  const hook = S.createSchedule(cron({ name: "Sent", after: { action: "webhook", url: "https://example.com/inbox" } })).schedule;
  assert.equal(hook.after.action, "webhook");
  for (const id of [m.id, a.id, c.id, picked.id, hook.id]) S.deleteSchedule(id);
});

test("a finished run saves the note in the project folder and in MindMedia, and says the path", async () => {
  const { schedule } = S.createSchedule(cron({ name: "Everborn Monday ideas", target: { kind: "mission", text: "Write 3 ideas.", projectId: "my-project" } }));
  const r = S.trigger(schedule.id, { source: "manual" });
  await S.idle();
  const run = S.getRun(r.id);
  assert.equal(run.status, "done", run.error || "");
  assert.equal(run.saveError, null, run.saveError || "");
  assert.match(run.savedPath, /^projects\/my-project\/notes\/Everborn-Monday-ideas-2026-10-26\.md$/);
  const abs = path.join(DIR, run.savedPath);
  const folder = path.join(DIR, "projects", "my-project", "notes");
  assert.ok(abs.startsWith(folder + path.sep), "the note stays inside the project folder");
  assert.equal(fs.readFileSync(abs, "utf8"), "Three short ideas for the week.");
  assert.ok(run.mindMediaId, "the run carries the MindMedia id");
  const items = pm.listMindMedia({ project: "my-project" }).items;
  const item = items.find((i) => i.id === run.mindMediaId);
  assert.ok(item, "the note is a MindMedia item");
  assert.equal(item.source, "schedule");
  assert.equal(item.kind, "text");
  // a second run the same day gets its own file; the first note is never overwritten
  const r2 = S.trigger(schedule.id, { source: "manual" });
  await S.idle();
  assert.equal(S.getRun(r2.id).savedPath, "projects/my-project/notes/Everborn-Monday-ideas-2026-10-26-2.md");
  assert.equal(fs.readFileSync(abs, "utf8"), "Three short ideas for the week.");
  S.deleteSchedule(schedule.id);
});

test("a save that fails says Not saved and never claims a save", async () => {
  const blocked = path.join(DIR, "projects", "blocked-project");
  fs.mkdirSync(blocked, { recursive: true });
  fs.writeFileSync(path.join(blocked, "notes"), "a file, not a folder"); // the folder can never be made
  const { schedule } = S.createSchedule(cron({ name: "Blocked note", target: { kind: "chat", text: "Say hi.", projectId: "blocked-project" }, after: { action: "note" } }));
  const r = S.trigger(schedule.id, { source: "manual" });
  await S.idle();
  const run = S.getRun(r.id);
  assert.equal(run.status, "done");
  assert.equal(run.savedPath, null, "no path is claimed");
  assert.equal(run.mindMediaId, null);
  assert.ok(run.saveError, "the reason is on the run");
  assert.equal(fs.existsSync(path.join(blocked, "notes", "Blocked-note-2026-10-26.md")), false);
  S.deleteSchedule(schedule.id);
});

test("source: the schedule screen shows Saved to and Not saved for a run", () => {
  const src = read("web/features/schedules.js");
  assert.match(src, /Saved to \$\{esc\(r\.savedPath\)\}/);
  assert.match(src, /Not saved: \$\{esc\(r\.saveError\)\}/);
  assert.match(src, /value="note"[^>]*>Save as a note in the project \(and MindMedia\)</);
  assert.equal(/[–—]/.test(src), false, "no dashes in the schedule screen");
});
