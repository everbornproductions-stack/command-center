// Slice B2: always-visible Finish, Looks good / Edit further, Finish preview card, progress pill,
// Undo last step and Branch from here (flag: finishpath).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import {
  PAIR, FINISH_LABEL, UNDO_LABEL, BRANCH_LABEL, previewCard, pillInfo, latestDone, canUndo, undoLast, branchWalk, lastDoneStep,
} from "../web/finishpath.js";
import { planActions, PINNED } from "../web/answer-actions.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASH = String.fromCharCode(0x2014);

const walk = (over = {}) => ({
  id: "sp-main",
  type: "website",
  stage: "review",
  status: "ready",
  plan: {
    title: "Tea club",
    steps: [
      { id: "t1", title: "Audience", status: "done", output: "Office managers." },
      { id: "t2", title: "Draft", status: "done", output: "The draft." },
      { id: "t3", title: "Checks", status: "queued", output: null },
    ],
  },
  deliverable: "Everything together.",
  revisions: [],
  ...over,
});

test("flag is off by default and env turns it on or off", () => {
  const was = process.env.CC_FLAG_FINISHPATH;
  try {
    delete process.env.CC_FLAG_FINISHPATH;
    assert.equal(flagOn("finishpath"), false);
    assert.equal(flagView().finishpath, false);
    process.env.CC_FLAG_FINISHPATH = "1";
    assert.equal(flagOn("finishpath"), true);
    assert.equal(flagView().finishpath, true);
    process.env.CC_FLAG_FINISHPATH = "0";
    assert.equal(flagOn("finishpath"), false);
    for (const k of ["projectbar", "promptdrop", "nextactions", "projectmedia"]) assert.ok(k in flagView(), `${k} kept`);
  } finally { if (was === undefined) delete process.env.CC_FLAG_FINISHPATH; else process.env.CC_FLAG_FINISHPATH = was; }
});

test("plain words for the buttons", () => {
  assert.equal(FINISH_LABEL, "Finish");
  assert.deepEqual(PAIR, { good: "Looks good, Finish", edit: "Edit further" });
  assert.equal(UNDO_LABEL, "Undo last step");
  assert.equal(BRANCH_LABEL, "Branch from here");
});

test("preview card: one confirm, says nothing is sent, empty gives nothing", () => {
  const card = previewCard({ kind: "image", text: "A cosy bakery window at dawn, warm light", name: "Bakery", projectName: "Bakery" });
  assert.equal(card.confirm, "Finish");
  assert.match(card.lines.join(" "), /image set/);
  assert.match(card.lines.join(" "), /Nothing is sent/);
  assert.match(card.lines.join(" "), /Project: Bakery/);
  assert.equal(previewCard({ kind: "x", text: "hello there" }).kind, "command");
  assert.match(previewCard({ text: "hello" }).lines.join(" "), /none picked/);
  assert.equal(previewCard({ text: "   " }), null);
  assert.ok(previewCard({ text: "word ".repeat(400) }).excerpt.length <= 220);
});

test("progress pill and the newest finished job", () => {
  assert.equal(pillInfo([]), null);
  assert.equal(pillInfo([{ status: "done" }]), null);
  assert.match(pillInfo([{ status: "running", title: "Write a tagline" }]).text, /^Working: Write a tagline/);
  assert.match(pillInfo([{ status: "planning", title: "Plan" }]).text, /^Planning/);
  assert.equal(pillInfo([{ status: "running" }, { status: "planning" }]).text, "Working on 2 jobs");
  const rows = [{ id: "a", status: "done", finishedAt: 5, projectId: "p1" }, { id: "b", status: "done", finishedAt: 9, projectId: "p2" }, { id: "c", status: "failed", finishedAt: 20 }];
  assert.equal(latestDone(rows).id, "b");
  assert.equal(latestDone(rows, "p1").id, "a");
  assert.equal(latestDone(rows, "none"), null);
});

test("undo puts the last finished step back and keeps its words; branch keeps the main line", () => {
  const w = walk();
  assert.equal(lastDoneStep(w).id, "t2");
  assert.equal(canUndo(w), true);
  assert.equal(canUndo(walk({ example: true })), false);
  const u = undoLast(w);
  assert.equal(u.ok, true);
  assert.equal(u.walk.plan.steps[1].status, "queued");
  assert.equal(u.walk.plan.steps[1].output, null);
  assert.equal(u.walk.undone[0].output, "The draft.");
  assert.equal(u.walk.stage, "build");
  assert.equal(u.walk.deliverable, "");
  assert.equal(w.plan.steps[1].status, "done", "the input is not changed");
  assert.equal(undoLast(walk({ plan: { steps: [{ id: "t1", status: "queued" }] } })).ok, false);

  const b = branchWalk(w, "t1", "sp-new");
  assert.equal(b.ok, true);
  assert.equal(b.walk.id, "sp-new");
  assert.equal(b.walk.branchOf, "sp-main");
  assert.deepEqual(b.walk.plan.steps.map((s) => s.status), ["done", "queued", "queued"]);
  assert.equal(b.walk.plan.steps[1].output, null);
  assert.match(b.walk.plan.title, /branch/);
  assert.equal(w.plan.steps[1].status, "done");
  assert.equal(branchWalk(w, "nope", "x").ok, false);
});

test("the Finish pair is pinned and the feature is in the registry", () => {
  assert.ok(PINNED.has("finishpath"));
  assert.deepEqual(planActions(["finishpath", "share"]).more, ["share"]);
  assert.match(read("web", "perf", "registry.js"), /id: "finishpath", deliverable: true/);
});

test("source: no em dashes, text wraps inside its box, pages are wired to the flag", () => {
  for (const f of ["web/finishpath.js", "web/finishpath-ui.js", "web/features/finishpath.js", "server/plugins/finishpath.js"]) {
    assert.equal(read(...f.split("/")).includes(DASH), false, `${f} has an em dash`);
  }
  const ui = read("web", "finishpath-ui.js");
  assert.match(ui, /overflow-wrap: anywhere/);
  assert.match(ui, /min-width: 0/);
  assert.match(ui, /flags\?\.finishpath/);
  assert.match(ui, /role="status"/);
  for (const f of ["images", "media", "remix", "walkthrough"]) assert.match(read("web", "features", `${f}.js`), /finishpath-ui\.js/, f);
  assert.match(read("web", "app.js"), /finishpath-ui\.js/);
});

test("flag off: routes say so", async () => {
  const s = await startServer({ env: { CC_FLAG_FINISHPATH: "0", CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.finishpath, false);
    const r = await s.api("/finishpath/preview", { method: "POST", body: { text: "hello" } });
    assert.equal(r.status, 404);
    assert.equal(r.json.code, "flag_off");
  } finally { await s.stop(); }
});

test("flag on: preview, undo and branch through the server", async () => {
  const s = await startServer({
    env: { CC_FLAG_FINISHPATH: "1", CC_DEV_OWNER: "1" },
    seed: (dir) => fs.writeFileSync(path.join(dir, "walkthrough.items.json"), JSON.stringify({ items: [walk(), walk({ id: "sp-busy", status: "building" })] })),
  });
  try {
    assert.equal((await s.api("/state")).json.flags.finishpath, true);
    const pv = await s.api("/finishpath/preview", { method: "POST", body: { kind: "command", text: "A short answer", name: "Answer" } });
    assert.equal(pv.status, 200, pv.json?.error);
    assert.equal(pv.json.card.confirm, "Finish");
    assert.equal((await s.api("/finishpath/preview", { method: "POST", body: { text: " " } })).status, 400);

    assert.equal((await s.api("/finishpath/undo", { method: "POST", body: { walkId: "nope" } })).status, 404);
    assert.equal((await s.api("/finishpath/undo", { method: "POST", body: { walkId: "sp-busy" } })).status, 409);

    const br = await s.api("/finishpath/branch", { method: "POST", body: { walkId: "sp-main", stepId: "t1" } });
    assert.equal(br.status, 200, br.json?.error);
    assert.equal((await s.api("/finishpath/branch", { method: "POST", body: { walkId: "sp-main", stepId: "zz" } })).status, 400);
    const copy = await s.api(`/walkthrough/${br.json.walkId}`);
    assert.equal(copy.status, 200);
    assert.equal(copy.json.plan.steps.filter((x) => x.status === "done").length, 1);

    const un = await s.api("/finishpath/undo", { method: "POST", body: { walkId: "sp-main" } });
    assert.equal(un.status, 200, un.json?.error);
    assert.equal(un.json.undone.id, "t2");
    const main = await s.api("/walkthrough/sp-main");
    assert.equal(main.json.plan.steps[1].status, "queued");
    assert.equal(main.json.plan.steps[0].status, "done");
    const again = await s.api("/finishpath/undo", { method: "POST", body: { walkId: "sp-main" } });
    assert.equal(again.json.undone.id, "t1", "each undo takes back one more step");
  } finally { await s.stop(); }
});
