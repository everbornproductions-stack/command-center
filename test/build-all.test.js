// Build it all for me: idea, questions, plan, build and test without stopping.
// It still stops to spend money, to delete for good, and to post in public
// (posting only with Also allow posting). Stop works mid-run. The switch is off
// by default and remembered per person. Demo AIs and step stubs only. No real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT, waitBudget } from "./helpers.js";
import {
  DEFAULT_PREFS, normalizePrefs, loadPrefs, savePrefs, mustStop, riskOf, fillAnswers, createJob, runSteps, stopJob, getJob,
  permissionLine, GENERIC_DEFAULT,
} from "../server/build-all.js";
import { AUTO_LINE, SEND_LINE } from "../server/getdone.js";
import { switchHtml, progressHtml, BUILD_ALL_LINE } from "../web/build-all-ui.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DASHES = /[\u2013\u2014]/;

function memDoc() {
  const store = {};
  return {
    doc: (kind, init) => (kind in store ? store[kind] : init()),
    putDoc: (kind, v) => { store[kind] = JSON.parse(JSON.stringify(v)); },
    store,
  };
}
function stub(id, out = { note: "ok" }, extra = {}) {
  return { id, label: id, ran: 0, ...extra, async run() { this.ran++; await sleep(5); return out; } };
}
const ids = ["idea", "questions", "plan", "build", "test"];

test("the switch is off by default and the choice is remembered", () => {
  const m = memDoc();
  assert.deepEqual(loadPrefs(m.doc), { ...DEFAULT_PREFS });
  assert.equal(DEFAULT_PREFS.on, false);
  assert.equal(DEFAULT_PREFS.allowPost, false);
  assert.deepEqual(savePrefs(m.doc, m.putDoc, { on: true }), { on: true, allowPost: false });
  assert.deepEqual(loadPrefs(m.doc), { on: true, allowPost: false });
  assert.deepEqual(savePrefs(m.doc, m.putDoc, { allowPost: true }), { on: true, allowPost: true });
  assert.deepEqual(normalizePrefs({ on: "yes", allowPost: 1 }), { on: false, allowPost: false });
});

test("the permission line is the Get it done line", () => {
  assert.equal(permissionLine({}), AUTO_LINE);
  assert.equal(permissionLine({ allowPost: true }), SEND_LINE);
});

test("stops only to spend, delete for good, or post (posting with the second switch)", () => {
  assert.equal(mustStop({ label: "Plan" }), null);
  assert.equal(mustStop({ label: "Build the page" }), null);
  assert.equal(mustStop({ risk: "spend" }).kind, "spend");
  assert.equal(mustStop({ label: "Charge the card" }).kind, "spend");
  assert.equal(mustStop({ risk: "delete" }).kind, "delete");
  assert.equal(mustStop({ label: "Delete it permanently" }).kind, "delete");
  assert.equal(mustStop({ risk: "post" }).kind, "post");
  assert.equal(mustStop({ risk: "post" }, { allowPost: true }), null);
  assert.equal(mustStop({ risk: "spend" }, { allowPost: true }).kind, "spend", "posting switch does not allow spending");
  assert.equal(mustStop({ risk: "delete" }, { allowPost: true }).kind, "delete");
  assert.equal(riskOf({ label: "Publish to Instagram" }), "post");
});

test("questions are answered from the description, then defaults, and assumed answers are listed", () => {
  const qs = [
    { key: "audience", label: "Who is the site for?", required: true },
    { key: "action", label: "What should a visitor do?", required: true },
    { key: "pages", label: "Which pages do you need?", required: false },
    { key: "zzz", label: "Something odd", required: true },
  ];
  const desc = "A bakery website. The site is for neighbors who want bread. A visitor should order ahead.";
  const out = fillAnswers(qs, desc, { pages: "Home and menu" });
  assert.equal(out.answers.pages, "Home and menu", "a typed answer wins");
  assert.match(out.answers.audience, /neighbors/);
  assert.match(out.answers.action, /order ahead/);
  assert.equal(out.answers.zzz, GENERIC_DEFAULT);
  assert.deepEqual(out.assumed.map((a) => a.key), ["zzz"]);
  assert.equal(out.assumed[0].required, true);
  const blank = fillAnswers(qs, "", {});
  assert.ok(blank.assumed.length === 4);
  assert.ok(Object.values(blank.answers).every(Boolean), "every question gets an answer");
});

test("runs every step without stopping", async () => {
  const steps = ids.map((id) => stub(id));
  const job = createJob({ surface: "start", steps });
  const seen = [];
  const view = await runSteps(job, steps, { onProgress: (j) => seen.push(j.current) });
  assert.equal(view.status, "done");
  assert.ok(steps.every((s) => s.ran === 1));
  assert.deepEqual(view.steps.map((s) => s.status), ["done", "done", "done", "done", "done"]);
  for (const id of ids) assert.ok(seen.includes(id), `progress showed ${id}`);
});

test("stops at a spend, a delete, and a public post; posting runs only with Also allow posting", async () => {
  for (const risk of ["spend", "delete", "post"]) {
    const steps = [stub("idea"), stub("build"), stub("publish", { note: "sent" }, { risk })];
    const job = createJob({ surface: "builder", steps });
    const view = await runSteps(job, steps);
    assert.equal(view.status, "waiting", risk);
    assert.equal(view.waiting.kind, risk);
    assert.equal(steps[2].ran, 0, `${risk} step did not run`);
    assert.equal(view.steps[2].status, "waiting");
  }
  const steps = [stub("idea"), stub("publish", { note: "sent" }, { risk: "post" })];
  const allowed = await runSteps(createJob({ surface: "builder", steps, allowPost: true }), steps);
  assert.equal(allowed.status, "done");
  assert.equal(steps[1].ran, 1);
  // A step that finds out mid-run that it posts asks to stop.
  const late = [stub("idea"), { id: "publish", label: "Publish", async run({ job }) { return job.allowPost ? { note: "posted" } : { stop: { kind: "post", reason: "posts in public" } }; } }];
  const lateView = await runSteps(createJob({ surface: "webbuilder", steps: late }), late);
  assert.equal(lateView.status, "waiting");
  assert.equal(lateView.waiting.kind, "post");
});

test("Stop ends the run before the next step", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = { id: "plan", label: "Plan", ran: 0, async run({ stopped }) { this.ran++; await gate; return { note: stopped() ? "stopped" : "ok" }; } };
  const steps = [stub("idea"), slow, stub("build"), stub("test")];
  const job = createJob({ surface: "start", steps });
  const running = runSteps(job, steps);
  const until = Date.now() + waitBudget(5000);
  while (slow.ran === 0 && Date.now() < until) await sleep(10);
  assert.equal(slow.ran, 1, "the slow step started");
  stopJob(job.id);
  release();
  const view = await running;
  assert.equal(view.status, "stopped");
  assert.equal(steps[2].ran, 0);
  assert.equal(steps[3].ran, 0);
  assert.equal(getJob(job.id).status, "stopped");
});

test("the switch, the progress list and Stop are in the UI, in plain words", () => {
  const off = switchHtml({ on: false, allowPost: false });
  assert.match(off, /Build it all for me/);
  assert.match(off, /Also allow posting/);
  assert.doesNotMatch(off, /data-ba-on checked/);
  assert.match(switchHtml({ on: true }), /data-ba-on checked/);
  const p = progressHtml({ id: "ba-x", status: "running", steps: [{ id: "plan", label: "Plan", status: "running", note: "" }], assumed: [{ label: "Audience", value: "People nearby" }] });
  assert.match(p, /data-ba-stop/);
  assert.match(p, /Assumed/);
  assert.doesNotMatch(progressHtml({ id: "ba-y", status: "done", steps: [] }), /data-ba-stop/);
  assert.match(BUILD_ALL_LINE, /spend money/);
  for (const ui of ["web/features/walkthrough.js", "web/features/builders.js", "web/features/webbuilders.js", "web/features/remix.js"]) {
    assert.match(read(ui), /build-all-ui\.js/, ui);
  }
  for (const rel of ["server/build-all.js", "server/plugins/buildall.js", "web/build-all-ui.js", "docs/help/builders.md", "docs/help/guided-builders.md", "docs/help/remix.md", "docs/help/start-here.md"]) {
    assert.equal(DASHES.test(read(rel)), false, rel);
  }
  for (const rel of ["docs/help/builders.md", "docs/help/guided-builders.md", "docs/help/remix.md"]) assert.match(read(rel), /Build it all for me/, rel);
});

async function waitRun(s, id, ok, what) {
  const until = Date.now() + waitBudget(180000);
  let last = null;
  while (Date.now() < until) {
    const r = await s.api(`/buildall/${id}`);
    last = r.json;
    if (ok(last)) return last;
    await sleep(400);
  }
  throw new Error(`${what} did not finish: ${JSON.stringify(last)}`);
}

test("Start a project builds it all on the demo AIs, and the switch is remembered", { timeout: 300000 }, async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/buildall/prefs", { noToken: true })).status, 401);
    assert.deepEqual((await s.api("/buildall/prefs")).json, { on: false, allowPost: false }, "off on a new install");
    assert.deepEqual((await s.api("/buildall/prefs", { method: "POST", body: { on: true } })).json, { on: true, allowPost: false });
    assert.deepEqual((await s.api("/buildall/prefs")).json, { on: true, allowPost: false }, "remembered");
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const started = await s.api("/buildall/start", { method: "POST", body: { surface: "start", type: "website", idea: "A weekend bakery site for Harbor and Rye. It is for neighbors who want fresh bread." } });
    assert.equal(started.status, 202, started.text);
    assert.equal(started.json.status, "running");
    assert.deepEqual(started.json.steps.map((x) => x.id), ["idea", "questions", "plan", "build", "test"]);
    const done = await waitRun(s, started.json.id, (j) => j && j.status !== "running", "build it all");
    assert.equal(done.status, "done", JSON.stringify(done));
    assert.ok(done.steps.every((x) => x.status === "done"));
    assert.ok(done.result.walkId);
    assert.ok(done.result.deliverable.length > 20);
    assert.ok(done.assumed.some((a) => a.key === "action"), "the missing required answer was assumed and listed");
    const walk = await s.api(`/walkthrough/${done.result.walkId}`);
    assert.equal(walk.json.stage, "review", "left for the person to review");
    assert.equal((await s.api("/buildall/start", { method: "POST", body: { surface: "nope" } })).status, 400);
    assert.equal((await s.api("/buildall/ba-missing")).status, 404);
  } catch (e) { console.log(s.log.slice(-6000)); throw e; } finally { await s.stop(); }
});

test("a guided builder runs to the end, waits before a public post, and Stop works", { timeout: 240000 }, async () => {
  const s = await startServer();
  try {
    const local = await s.api("/buildall/start", { method: "POST", body: { surface: "builder", builderId: "biz-review", description: "Reply to a three star review about slow service." } });
    assert.equal(local.status, 202, local.text);
    const localDone = await waitRun(s, local.json.id, (j) => j && j.status !== "running", "review builder");
    assert.equal(localDone.status, "done", JSON.stringify(localDone));
    assert.equal(localDone.result.posted, false, "a review reply is saved here, not posted");

    const remote = await s.api("/buildall/start", { method: "POST", body: { surface: "builder", builderId: "biz-booking", description: "A booking page for a 30 minute call." } });
    const waiting = await waitRun(s, remote.json.id, (j) => j && j.status !== "running", "booking builder");
    assert.equal(waiting.status, "waiting", JSON.stringify(waiting));
    assert.equal(waiting.waiting.kind, "post");
    assert.equal(waiting.waiting.step, "publish");
    assert.ok(waiting.steps.slice(0, 5).every((x) => x.status === "done"), "everything before the post ran");

    const allowed = await s.api("/buildall/start", { method: "POST", body: { surface: "builder", builderId: "biz-booking", description: "A booking page for a 30 minute call.", allowPost: true } });
    const tried = await waitRun(s, allowed.json.id, (j) => j && j.status !== "running", "booking with posting");
    assert.equal(tried.status, "waiting");
    assert.equal(tried.waiting.kind, "needs", "posting was allowed, so it went on and asked for the missing connection");

    const stopped = await s.api("/buildall/start", { method: "POST", body: { surface: "builder", builderId: "biz-review", description: "Reply to a five star review." } });
    const halt = await s.api(`/buildall/${stopped.json.id}/stop`, { method: "POST" });
    assert.equal(halt.status, 200);
    const end = await waitRun(s, stopped.json.id, (j) => j && j.status !== "running", "stopped run");
    assert.ok(["stopped", "done"].includes(end.status));
    if (end.status === "stopped") assert.ok(end.steps.some((x) => x.status === "skipped" || x.status === "stopped"));
    assert.ok(!/demo-key|sk-|xai-|AIza/.test(s.log), "no key in the log");
  } finally { await s.stop(); }
});

test("the web builders and Remix run their steps in one go", { timeout: 240000 }, async () => {
  const s = await startServer();
  try {
    const web = await s.api("/buildall/start", { method: "POST", body: { surface: "webbuilder", builderId: "ad-copy", description: "Fresh sourdough every Saturday at Harbor and Rye." } });
    assert.equal(web.status, 202, web.text);
    const webDone = await waitRun(s, web.json.id, (j) => j && j.status !== "running", "ad copy");
    assert.notEqual(webDone.status, "failed", JSON.stringify(webDone));
    assert.equal(webDone.steps.find((x) => x.id === "build").status, "done", JSON.stringify(webDone));
    if (webDone.status === "done") assert.equal(webDone.result.sent, false, "saved on this computer");
    const remix = await s.api("/buildall/start", { method: "POST", body: { surface: "remix", description: "A tiny game where a cat collects stars.", remix: { appType: "game", own: { name: "Star Cat" }, source: "screenshots" } } });
    assert.equal(remix.status, 202, remix.text);
    const remixDone = await waitRun(s, remix.json.id, (j) => j && j.status !== "running", "remix");
    assert.notEqual(remixDone.status, "failed", JSON.stringify(remixDone));
    assert.equal(remixDone.steps.find((x) => x.id === "plan").status, "done", JSON.stringify(remixDone));
    console.log(`build-all statuses: web ${webDone.status}, remix ${remixDone.status} ${remixDone.waiting?.reason || ""}`);
  } catch (e) { console.log(s.log.slice(-4000)); throw e; } finally { await s.stop(); }
});
