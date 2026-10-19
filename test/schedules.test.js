// Scheduled and triggered agents (Phase 22).
// Part 1 drives server/schedules.js in this process with a fake clock, a fake runner and a fake sender:
// cron fires once per slot, folders, caps, the approval step. Part 2 starts the real server in demo mode
// (temp data folder, fast tick) with a local mock receiver: the webhook's token check, a new file in a
// watched folder, a cap that stops and alerts, and a send that waits for approval. No real URL or key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-sched-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const S = await import("../server/schedules.js");

let now = new Date(2026, 9, 19, 10, 2, 0).getTime(); // a Monday, 10:02 local time
const calls = [], alerts = [], sent = [];
let runResult = () => ({ status: "done", cost: 0.001, deliverable: "Here is the result." });
S.configure({
  now: () => now,
  run: async (s, o) => { calls.push({ id: s.id, ...o }); return runResult(s, o); },
  alert: (key, title, body, level) => alerts.push({ key, title, body, level }),
  send: async (url, payload) => { sent.push({ url, payload }); return { status: 200 }; },
});
const chat = (over = {}) => ({ name: "Morning brief", target: { kind: "chat", text: "Summarise yesterday." }, trigger: { type: "cron", cron: "*/5 * * * *" }, capUsd: 5, ...over });
const runsOf = (id) => S.listRuns({ scheduleId: id });

test("cron: five fields, presets, ranges, steps and clear refusals", () => {
  const c = S.parseCron("0 9 * * 1-5");
  assert.equal(S.cronMatches(c, new Date(2026, 9, 19, 9, 0).getTime()), true); // Monday 9:00
  assert.equal(S.cronMatches(c, new Date(2026, 9, 18, 9, 0).getTime()), false); // Sunday
  assert.equal(S.cronMatches(S.parseCron("@daily"), new Date(2026, 9, 19, 0, 0).getTime()), true);
  assert.equal(S.cronMatches(S.parseCron("0 0 * * 7"), new Date(2026, 9, 18, 0, 0).getTime()), true); // 7 is Sunday
  assert.equal(S.cronMatches(S.parseCron("15,45 */2 * * *"), new Date(2026, 9, 19, 4, 45).getTime()), true);
  assert.equal(S.nextRun(c, new Date(2026, 9, 17, 12, 0).getTime()), new Date(2026, 9, 19, 9, 0).getTime()); // Saturday -> Monday 9:00
  for (const bad of ["", "* * * *", "61 * * * *", "* 24 * * *", "a b c d e", "*/0 * * * *", "5-1 * * * *"]) assert.throws(() => S.parseCron(bad), (e) => e.status === 400, bad);
});

test("a fake clock fires a cron job once per slot", async () => {
  const { schedule } = S.createSchedule(chat());
  const fired = [];
  for (let i = 0; i < 90; i++) { // 30 minutes in 20-second steps, two ticks per step
    now += 20000;
    fired.push(...S.tick(now), ...S.tick(now));
  }
  await S.idle();
  const slots = runsOf(schedule.id).map((r) => r.slot).sort();
  assert.equal(fired.length, 6, "10:05, 10:10 ... 10:30");
  assert.equal(new Set(slots).size, slots.length, "no slot twice");
  assert.deepEqual(slots.map((t) => new Date(t).getMinutes()), [5, 10, 15, 20, 25, 30]);
  assert.ok(runsOf(schedule.id).every((r) => r.status === "done" && r.source === "cron" && r.cost === 0.001));
  assert.match(calls.at(-1).prompt, /Summarise yesterday\.[\s\S]*started by its schedule \(\*\/5 \* \* \* \*\)/);
  // a late tick still fires that slot once; a long gap (app closed) does not replay every missed slot
  now += 7 * 60000; assert.equal(S.tick(now).length, 1); assert.equal(S.tick(now).length, 0);
  now += 3 * 3600000; assert.equal(S.tick(now).length, 1);
  await S.idle();
  S.deleteSchedule(schedule.id);
});

test("pausing skips the cron; resuming does not replay missed slots", async () => {
  const { schedule } = S.createSchedule(chat({ name: "Paused" }));
  S.setEnabled(schedule.id, false);
  now += 60 * 60000; assert.equal(S.tick(now).length, 0);
  S.setEnabled(schedule.id, true);
  assert.equal(S.tick(now).length, 0, "the slot at resume time is not fired");
  await S.idle(); S.deleteSchedule(schedule.id);
});

test("a schedule over its cap stops and alerts", async () => {
  const { schedule } = S.createSchedule(chat({ name: "Capped", trigger: { type: "webhook" }, capUsd: 0.0015 }));
  S.trigger(schedule.id, { source: "webhook" }); await S.idle();
  assert.equal(S.getSchedule(schedule.id).enabled, true, "under the cap after one run");
  S.trigger(schedule.id, { source: "webhook" }); await S.idle();
  const s = S.getSchedule(schedule.id);
  assert.equal(s.enabled, false); assert.equal(s.pausedReason, "cap");
  assert.equal(alerts.length, 1); assert.equal(alerts[0].level, "stop"); assert.match(alerts[0].title, /Capped.*\$0\.0015 monthly cap/);
  const before = calls.length;
  assert.throws(() => S.trigger(schedule.id, { source: "webhook" }), (e) => e.status === 409);
  assert.throws(() => S.trigger(schedule.id, { source: "manual" }), (e) => e.status === 409 && e.code === "cap");
  await S.idle();
  assert.equal(calls.length, before, "no run over the cap");
  assert.equal(runsOf(schedule.id)[0].status, "stopped");
  assert.throws(() => S.setEnabled(schedule.id, true), (e) => e.status === 409, "resume refused until the cap is raised");
  S.updateSchedule(schedule.id, { capUsd: 1 });
  assert.equal(S.setEnabled(schedule.id, true).enabled, true);
  assert.equal(S.view(S.getSchedule(schedule.id)).spent, 0.002);
  S.deleteSchedule(schedule.id);
});

test("a sending step waits in needs approval; approve sends once, reject sends nothing", async () => {
  const { schedule, token } = S.createSchedule(chat({ name: "Poster", trigger: { type: "webhook" }, after: { action: "webhook", url: "http://127.0.0.1:9/inbox" } }));
  assert.ok(token && !JSON.stringify(S.listSchedules()).includes(token), "token shown once, never listed");
  assert.equal(S.view(S.getSchedule(schedule.id)).hookHash, undefined);
  const r1 = S.trigger(schedule.id, { source: "webhook" }); await S.idle();
  assert.equal(S.getRun(r1.id).status, "needs_approval");
  assert.equal(sent.length, 0, "nothing sent before the click");
  const done = await S.approve(r1.id);
  assert.equal(done.status, "done"); assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "http://127.0.0.1:9/inbox"); assert.equal(sent[0].payload.text, "Here is the result."); assert.equal(sent[0].payload.run_id, r1.id);
  await assert.rejects(S.approve(r1.id), (e) => e.status === 409);
  const r2 = S.trigger(schedule.id, { source: "manual" }); await S.idle();
  assert.equal(S.reject(r2.id).status, "rejected"); assert.equal(sent.length, 1);
  // a failed run never reaches the approval step
  runResult = () => ({ status: "failed", error: "provider down", cost: 0 });
  const r3 = S.trigger(schedule.id, { source: "manual" }); await S.idle();
  assert.equal(S.getRun(r3.id).status, "failed"); assert.equal(S.getRun(r3.id).error, "provider down");
  runResult = () => ({ status: "done", cost: 0.001, deliverable: "Here is the result." });
  assert.throws(() => S.createSchedule(chat({ after: { action: "webhook", url: "file:///etc/passwd" } })), (e) => e.status === 400);
  S.deleteSchedule(schedule.id);
});

test("a new file in a watched folder triggers one run with its contents", async () => {
  const drop = tmpDir("cc-drop-");
  fs.writeFileSync(path.join(drop, "old.txt"), "already here");
  const { schedule } = S.createSchedule(chat({ name: "Inbox", target: { kind: "chat", text: "Summarise the new file." }, trigger: { type: "folder", folder: drop, pattern: "*.txt, *.csv" } }));
  assert.equal(S.tick(now).length, 0, "files already there are the baseline");
  fs.writeFileSync(path.join(drop, "orders.txt"), "3 loaves, 2 cakes");
  fs.writeFileSync(path.join(drop, "notes.md"), "not matched");
  fs.writeFileSync(path.join(drop, "big.csv.part"), "still downloading");
  assert.equal(S.tick(now).length, 0, "a new file waits one scan for its size to hold still");
  const fired = S.tick(now);
  assert.equal(fired.length, 1); assert.equal(fired[0].file.name, "orders.txt");
  assert.equal(S.tick(now).length, 0, "once per file");
  await S.idle();
  assert.match(calls.at(-1).prompt, /new file in the watched folder: orders\.txt[\s\S]*3 loaves, 2 cakes/);
  assert.throws(() => S.createSchedule(chat({ trigger: { type: "folder", folder: DIR } })), (e) => e.status === 400 && /data folder/.test(e.message));
  assert.throws(() => S.createSchedule(chat({ trigger: { type: "folder", folder: path.join(drop, "nope") } })), (e) => e.status === 400);
  assert.throws(() => S.createSchedule(chat({ trigger: { type: "folder", folder: "relative/dir" } })), (e) => e.status === 400);
  S.deleteSchedule(schedule.id);
});

// ---------------- the real server ----------------
async function receiver() {
  const hits = [];
  const srv = http.createServer(async (req, res) => { let b = ""; for await (const c of req) b += c; hits.push({ method: req.method, url: req.url, headers: req.headers, body: b ? JSON.parse(b) : null }); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { hits, url: `http://127.0.0.1:${srv.address().port}/inbox`, close: () => new Promise((r) => srv.close(r)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runSettled(s, id, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = (await s.api(`/schedules/runs/${id}`)).json; if (r && !["queued", "running"].includes(r.status)) return r; await sleep(150); }
  throw new Error("run did not finish");
}

test("server: webhook token, approval before sending, watched folder, cap stop and alert", async () => {
  const s = await startServer({ env: { CC_SCHEDULE_TICK_MS: "150" } });
  const rx = await receiver();
  const drop = tmpDir("cc-drop-srv-");
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const ag = (await s.api("/agents", { method: "POST", body: { name: "Order clerk", provider: "demo-nova", model: "nova-lite", instructions: "Turn orders into a short summary." } })).json;
    const created = await s.api("/schedules", { method: "POST", body: { name: "Order hook", target: { kind: "agent", agentId: ag.id, text: "Summarise this order." }, trigger: { type: "webhook" }, capUsd: 2, after: { action: "webhook", url: rx.url } } });
    assert.equal(created.status, 200);
    const { schedule, token } = created.json;
    assert.equal(schedule.hookPath, `/api/schedules/hook/${schedule.id}`);
    assert.ok(!JSON.stringify((await s.api("/schedules")).json).includes(token), "token never listed");
    const hook = (headers, body = { order: 7 }) => s.raw({ method: "POST", path: schedule.hookPath, headers: { "content-type": "application/json", ...headers }, body });

    // wrong or missing token: 401, nothing queued (the session token does not open it either)
    assert.equal((await hook({})).status, 401);
    assert.equal((await hook({ "x-cc-trigger-token": "wrong" })).status, 401);
    assert.equal((await hook({ "x-cc-token": s.token })).status, 401);
    assert.equal((await s.raw({ method: "POST", path: `/api/schedules/hook/sch-nothere1`, headers: { "content-type": "application/json", "x-cc-trigger-token": token }, body: {} })).status, 401);
    assert.equal((await s.raw({ method: "POST", path: schedule.hookPath, headers: { "content-type": "text/plain", "x-cc-trigger-token": token }, body: "hi" })).status, 415);
    assert.equal((await s.raw({ method: "GET", path: `${schedule.hookPath}?t=${token}` })).status, 405);
    assert.equal((await s.api("/schedules/runs")).json.items.length, 0);

    // the right token queues a run (header, Bearer or ?t=)
    const ok = await hook({ "x-cc-trigger-token": token });
    assert.equal(ok.status, 202); assert.equal(ok.json.status, "queued");
    const r = await runSettled(s, ok.json.run_id);
    assert.equal(r.status, "needs_approval", r.error || "");
    assert.equal(r.source, "webhook"); assert.ok(r.cost > 0); assert.ok(r.output.length > 0);
    assert.equal(rx.hits.length, 0, "nothing sent before Approve");
    const run = (await s.api(`/missions/${r.missionId}`)).json;
    assert.equal(run.customAgent?.id, ag.id); assert.match(run.prompt, /"order": ?7/);
    const ap = await s.api(`/schedules/runs/${r.id}/approve`, { method: "POST" });
    assert.equal(ap.status, 200); assert.equal(ap.json.status, "done");
    assert.equal(rx.hits.length, 1); assert.equal(rx.hits[0].body.run_id, r.id); assert.equal(rx.hits[0].body.text, r.output);
    assert.equal((await s.raw({ method: "POST", path: `${schedule.hookPath}?t=${encodeURIComponent(token)}` })).status, 202, "?t= and an empty body work too");
    // a new token retires the old one
    const rot = (await s.api(`/schedules/${schedule.id}/token`, { method: "POST" })).json;
    assert.equal((await hook({ "x-cc-trigger-token": token })).status, 401);
    assert.equal((await hook({ authorization: `Bearer ${rot.token}` })).status, 202);

    // a watched folder: a new file triggers a run
    fs.writeFileSync(path.join(drop, "before.txt"), "baseline");
    const fol = (await s.api("/schedules", { method: "POST", body: { name: "Drop box", target: { kind: "chat", text: "Summarise the new file." }, trigger: { type: "folder", folder: drop, pattern: "*.txt" }, capUsd: 2 } })).json.schedule;
    await sleep(500);
    fs.writeFileSync(path.join(drop, "new-order.txt"), "Two rye loaves for Friday.");
    let fr = null;
    for (let i = 0; i < 100 && !fr; i++) { await sleep(150); fr = (await s.api(`/schedules/runs?schedule=${fol.id}`)).json.items[0]; }
    assert.ok(fr, "a run was queued for the new file");
    fr = await runSettled(s, fr.id);
    assert.equal(fr.status, "done", fr.error || ""); assert.equal(fr.file.name, "new-order.txt");
    assert.equal((await s.api(`/schedules/runs?schedule=${fol.id}`)).json.items.length, 1, "the baseline file did not run");

    // a cap that the first run crosses: paused, alert in the feed, the next call refused
    const cap = (await s.api("/schedules", { method: "POST", body: { name: "Tiny cap", target: { kind: "chat", text: "Say hi." }, trigger: { type: "webhook" }, capUsd: 0.000001 } })).json;
    const c1 = await s.raw({ method: "POST", path: cap.schedule.hookPath, headers: { "content-type": "application/json", "x-cc-trigger-token": cap.token }, body: {} });
    assert.equal((await runSettled(s, c1.json.run_id)).status, "done");
    let sc = null;
    for (let i = 0; i < 40 && sc?.enabled !== false; i++) { await sleep(100); sc = (await s.api(`/schedules/${cap.schedule.id}`)).json.schedule; }
    assert.equal(sc.enabled, false); assert.equal(sc.pausedReason, "cap");
    const c2 = await s.raw({ method: "POST", path: cap.schedule.hookPath, headers: { "content-type": "application/json", "x-cc-trigger-token": cap.token }, body: {} });
    assert.equal(c2.status, 409);
    const recent = (await s.api("/state")).json.recent.map((e) => e.text || "").join("\n");
    assert.match(recent, /Tiny cap.*hit its \$0\.000001 monthly cap/);

    // every run is in the ledger under its own id
    const led = (await s.api("/state")).json.ledger.recent;
    assert.ok(led.some((e) => e.missionId === r.missionId), "the agent run's call is in the ledger");

    // Free tier: a mission schedule is refused up front (missions are Pro)
    assert.equal((await s.api("/schedules", { method: "POST", body: { name: "Weekly plan", target: { kind: "mission", text: "Plan the week." }, trigger: { type: "cron", cron: "0 8 * * 1" } } })).status, 402);
    // bad input
    assert.equal((await s.api("/schedules", { method: "POST", body: { name: "x", target: { kind: "chat", text: "y" }, trigger: { type: "cron", cron: "every day" } } })).status, 400);
    assert.equal((await s.api("/schedules", { method: "POST", body: { name: "x", target: { kind: "agent", agentId: "ag-missing" }, trigger: { type: "webhook" } } })).status, 404);
    assert.equal((await s.api("/schedules", { noToken: true })).status, 401);
    // delete
    assert.equal((await s.api(`/schedules/${schedule.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await hook({ authorization: `Bearer ${rot.token}` })).status, 401);
  } finally { await rx.close(); await s.stop(); }
});
