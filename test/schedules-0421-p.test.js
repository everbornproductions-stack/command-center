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

test("the run prompt names the schedule, the plain trigger, the next run and where the result goes", async () => {
  assert.equal(S.whenWords("0 9 * * 1"), "every Monday at 9:00 AM");
  assert.equal(S.whenWords("0 17 * * 1-5"), "every weekday at 5:00 PM");
  assert.equal(S.whenWords("0 0 * * *"), "every day at 12:00 AM");
  assert.equal(S.whenWords("0 0 1 * *"), "every month at 12:00 AM");
  const { schedule } = S.createSchedule(cron({ name: "Everborn Monday ideas", target: { kind: "mission", text: "Write 3 ideas.", projectId: "my-project" }, after: { action: "note" } }));
  const r = S.trigger(schedule.id, { source: "manual" });
  await S.idle();
  const p = calls.at(-1).prompt;
  assert.match(p, /Schedule: Everborn Monday ideas/);
  assert.match(p, /Trigger: every Monday at 9:00 AM/);
  assert.match(p, /Next run: .*2026/);
  assert.match(p, /Result: Meldmind saves your answer as a note at projects\/my-project\/notes/);
  assert.match(p, /You are already scheduled; just do this run's job\. Do not say you cannot schedule or save\./);
  // a schedule that keeps its result here says so, and a paused one does not promise a run
  const keep = S.createSchedule(cron({ name: "Kept" }));
  S.trigger(keep.schedule.id, { source: "manual" });
  await S.idle();
  assert.match(calls.at(-1).prompt, /Result: Your answer is kept in Meldmind/);
  S.setEnabled(keep.schedule.id, false);
  S.trigger(keep.schedule.id, { source: "manual" });
  await S.idle();
  assert.match(calls.at(-1).prompt, /Next run: none, this schedule is paused/);
  S.deleteSchedule(keep.schedule.id);
  S.deleteSchedule(schedule.id);
});

const DOGFOOD = "Set up a small helper agent called 'Everborn Monday ideas' that runs every Monday at 9 AM and writes 3 short Instagram post ideas for Everborn Productions (a small studio making cinematic listing videos for real-estate agents and mortgage brokers) into a note saved in my project. It must not send any email, text or post anything anywhere. Run it once now so I can see the first result, and tell me where the note is saved and when it will run next.";

test("weeklyPrompt keeps the job and drops the setup clauses (dogfood 11 sentence)", () => {
  const w = S.weeklyPrompt(DOGFOOD);
  assert.doesNotMatch(w, /set up/i, w);
  assert.doesNotMatch(w, /every Monday/i, w);
  assert.doesNotMatch(w, /run it once/i, w);
  assert.doesNotMatch(w, /must not send/i, w);
  assert.doesNotMatch(w, /tell me where/i, w);
  assert.match(w, /3 short Instagram post ideas/);
  assert.match(w, /Everborn Productions/);
  assert.match(w, /into a note saved in my project/);
  assert.ok(w.length < DOGFOOD.length / 2, `short weekly job: ${w.length} of ${DOGFOOD.length}`);
  assert.equal(S.weeklyPrompt("Summarise the week."), "Summarise the week.", "a normal request is left alone");
  assert.equal(S.weeklyPrompt(""), "");
  assert.equal(S.weeklyPrompt("  Write 3 ideas.  "), "Write 3 ideas.");
});

test("create and edit keep the setup sentence and a short weekly prompt for each run", async () => {
  const { schedule } = S.createSchedule(cron({ name: "Everborn Monday ideas", target: { kind: "mission", text: DOGFOOD, projectId: "my-project" } }));
  assert.equal(schedule.target.setupText, DOGFOOD);
  assert.equal(schedule.target.runText, S.weeklyPrompt(DOGFOOD));
  const r = S.trigger(schedule.id, { source: "manual" });
  await S.idle();
  const p = calls.at(-1).prompt;
  assert.match(p, /^Writes 3 short Instagram post ideas/);
  assert.doesNotMatch(p, /Set up a small helper agent/);
  // a plain request is not split, and the form can set the weekly words by hand
  const plain = S.createSchedule(cron({ name: "Plain" }));
  assert.equal(plain.schedule.target.runText, "Summarise the week.");
  assert.equal(plain.schedule.target.setupText, null);
  S.deleteSchedule(plain.schedule.id);
  S.updateSchedule(schedule.id, cron({ name: "Everborn Monday ideas", target: { kind: "mission", text: DOGFOOD, runText: "Write 3 short Everborn post ideas.", projectId: "my-project" } }));
  assert.equal(S.getSchedule(schedule.id).target.runText, "Write 3 short Everborn post ideas.");
  assert.equal(S.getSchedule(schedule.id).target.setupText, DOGFOOD);
  S.deleteSchedule(schedule.id);
});

test("source: a new schedule starts with no day, and saving without a day says so", () => {
  const src = read("web/features/schedules.js");
  assert.match(src, /new Set\(empty \? \[\]/, "no day is picked for a new schedule");
  assert.match(src, /whenHtml\(e\.trigger\.cron \|\| "0 17 \* \* 1-5", !s\)/);
  assert.match(src, /Pick at least one day\./);
  assert.match(src, /#sf-days \[aria-pressed='true'\]/);
  assert.match(src, /\[data-preset\]/, "the presets still set the days");
});

test("source: the schedule screen shows where a note went and has the weekly prompt field", () => {
  const src = read("web/features/schedules.js");
  assert.match(src, /Saved to \$\{esc\(r\.savedPath\)\}/);
  assert.match(src, /Not saved: \$\{esc\(r\.saveError\)\}/);
  assert.match(src, /value="note"[^>]*>Save as a note in the project \(and MindMedia\)</);
  assert.match(src, /What it does each time/);
  assert.match(src, /id="sf-runtext"/);
  assert.equal(/[–—]/.test(src), false, "no dashes in the schedule screen");
});
