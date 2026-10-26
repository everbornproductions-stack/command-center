import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import {
  STAGES,
  FLOW_STAGES,
  STAGE_LABELS,
  FLOW_STAGE_LABELS,
  isFlowStagesEnabled,
  resolveStageId,
  flowStageOf,
  labelsFor,
  buildStageList,
  buildFlowchart,
  normalizeStackedSteps,
  applyStageAction,
  present,
} from "../server/walkthroughs.js";
import {
  STEP_LABELS,
  FLOW_STEP_LABELS,
  resolveStepId,
  createJob,
  pauseJob,
  resumeJob,
  stopJob,
  saveJob,
  loadSavedJobs,
  runSteps,
} from "../server/build-all.js";
import { progressHtml } from "../web/build-all-ui.js";

test("flag_flowstages defaults to on and can be turned off", () => {
  assert.equal(isFlowStagesEnabled({ settings: {}, env: {} }), true);
  assert.equal(isFlowStagesEnabled({ settings: {}, env: { CC_FLAG_FLOWSTAGES: "0" } }), false);
  assert.equal(isFlowStagesEnabled({ settings: { flag_flowstages: false }, env: {} }), false);
  assert.equal(isFlowStagesEnabled({ settings: { flag_flowstages: true }, env: {} }), true);
  assert.equal(isFlowStagesEnabled({ settings: { flags: { flag_flowstages: true } }, env: {} }), true);
  assert.equal(isFlowStagesEnabled({ settings: {}, env: { CC_FLAG_FLOWSTAGES: "1" } }), true);

  const legacy = { env: { CC_FLAG_FLOWSTAGES: "0" } };
  assert.deepEqual(labelsFor("simple", legacy), STAGE_LABELS.simple);
  assert.deepEqual(labelsFor("expert", legacy), STAGE_LABELS.expert);

  const walk = { id: "sp-1", type: "website", stage: "idea", status: "ready", idea: "A bakery site" };
  const legacyView = present(walk, "simple", legacy);
  assert.equal(legacyView.flowStagesEnabled, undefined);
  assert.equal(legacyView.stages[0].label, "Your idea");

  const flowView = present(walk, "simple", { flowStages: true });
  assert.equal(flowView.flowStagesEnabled, true);
  assert.equal(flowView.flowStage, "creative");
  assert.deepEqual(
    flowView.stages.map((s) => s.label),
    ["Creative", "Planning", "AI Movement", "Build", "Testing and Tweaks", "Finish"],
  );

  const expertFlowView = present(walk, "expert", { flowStages: true });
  assert.deepEqual(
    expertFlowView.stages.map((s) => s.label),
    ["Creative", "Planning", "AI Movement", "Build Mode", "Testing & Tweaks", "Finished Project"],
  );
});

test("Flow stage aliases resolve to internal stage and step IDs", () => {
  assert.equal(STAGES.length, 6);
  assert.equal(FLOW_STAGES.length, 6);

  const pairs = [
    ["creative", "idea"],
    ["planning", "questions"],
    ["ai-movement", "plan"],
    ["movement", "plan"],
    ["build-mode", "build"],
    ["testing", "review"],
    ["testing-and-tweaks", "review"],
    ["finish", "done"],
    ["finished-project", "done"],
  ];
  for (const [alias, internalId] of pairs) {
    assert.equal(resolveStageId(alias), internalId);
    assert.equal(resolveStageId(internalId), internalId);
  }
  assert.equal(flowStageOf("idea"), "creative");
  assert.equal(flowStageOf("questions"), "planning");
  assert.equal(flowStageOf("plan"), "ai-movement");
  assert.equal(flowStageOf("build"), "build-mode");
  assert.equal(flowStageOf("review"), "testing");
  assert.equal(flowStageOf("done"), "finish");

  assert.equal(resolveStepId("creative"), "idea");
  assert.equal(resolveStepId("planning"), "questions");
  assert.equal(resolveStepId("ai-movement"), "plan");
  assert.equal(resolveStepId("build-mode"), "build");
  assert.equal(resolveStepId("testing"), "test");
  assert.equal(resolveStepId("finish"), "publish");
  assert.equal(FLOW_STEP_LABELS.simple.idea, "Creative");
  assert.equal(FLOW_STEP_LABELS.expert.publish, "Finished Project");
  assert.equal(STEP_LABELS.idea, "Idea");
});

test("Simple breadcrumb and Expert horizontal flowchart structures", () => {
  const walk = { id: "sp-2", type: "website", stage: "plan", status: "ready" };
  const simpleList = buildStageList(walk, "simple", { flowStages: true });
  assert.equal(simpleList.length, 6);
  assert.equal(simpleList[0].state, "done");
  assert.equal(simpleList[1].state, "done");
  assert.equal(simpleList[2].state, "active");
  assert.equal(simpleList[2].clickable, true);

  const chart = buildFlowchart(walk, "expert", { flowStages: true });
  assert.equal(chart.layout, "horizontal");
  assert.equal(chart.mode, "flowchart");
  assert.equal(chart.nodes.length, 6);
  assert.equal(chart.edges.length, 5);
  assert.equal(chart.edges[0].from, "idea");
  assert.equal(chart.edges[0].to, "questions");
  assert.equal(chart.edges[0].completed, true);
  assert.equal(chart.edges[2].active, true);
});

test("Stage actions: add, remove, reorder, skip, and autofill", () => {
  const walk = { id: "sp-3", type: "website", stage: "idea", status: "ready", idea: "", answers: {} };

  // Autofill idea ("creative")
  applyStageAction(walk, "autofill", { stage: "creative" });
  assert.ok(walk.idea.length > 0);
  assert.ok(walk.autofilledStages.includes("idea"));
  assert.equal(walk.stage, "questions");

  // Autofill questions ("planning")
  applyStageAction(walk, "autofill", { stage: "planning" });
  assert.ok(walk.answers.audience);
  assert.ok(walk.answers.action);
  assert.equal(walk.stage, "plan");

  // Skip plan ("ai-movement")
  applyStageAction(walk, "skip", { stage: "ai-movement" });
  assert.ok(walk.skippedStages.includes("plan"));
  assert.equal(walk.stage, "build");

  // Add a custom stage after build
  applyStageAction(walk, "add", { label: "Brand check", afterStage: "build", instructions: "Verify tone." });
  const custom = walk.stageOrder.find((s) => s.custom);
  assert.ok(custom);
  assert.equal(custom.label, "Brand check");

  // Reorder custom stage up/left
  const beforeIdx = walk.stageOrder.findIndex((s) => s.id === custom.id);
  applyStageAction(walk, "reorder", { stage: custom.id, direction: "up" });
  const afterIdx = walk.stageOrder.findIndex((s) => s.id === custom.id);
  assert.equal(afterIdx, beforeIdx - 1);

  // Jump back to Creative without losing answers
  applyStageAction(walk, "jump", { stage: "creative" });
  assert.equal(walk.stage, "idea");
  assert.ok(walk.answers.audience);

  // Remove the custom stage
  applyStageAction(walk, "remove", { stage: custom.id });
  assert.equal(walk.stageOrder.some((s) => s.id === custom.id), false);
});

test("build-all pause, resume, and save job state", async () => {
  const ran = [];
  const job = createJob({
    surface: "start",
    title: "Pausable build",
    steps: [{ id: "idea" }, { id: "questions" }, { id: "plan" }],
    flowStages: true,
    experience: "expert",
  });
  assert.equal(job.steps[0].label, "Creative");
  assert.equal(job.steps[2].label, "AI Movement");

  const stepDefs = [
    {
      id: "idea",
      run: async () => {
        ran.push("idea");
        pauseJob(job.id);
        return { note: "Idea captured." };
      },
    },
    {
      id: "questions",
      run: async () => {
        ran.push("questions");
        return { note: "Questions answered." };
      },
    },
    {
      id: "plan",
      run: async () => {
        ran.push("plan");
        return { ok: true, note: "Planned." };
      },
    },
  ];

  const pausedView = await runSteps(job, stepDefs);
  assert.equal(pausedView.status, "paused");
  assert.equal(pausedView.paused, true);
  assert.deepEqual(ran, ["idea"]);
  assert.equal(pausedView.steps.find((s) => s.id === "idea").status, "done");
  assert.equal(pausedView.steps.find((s) => s.id === "questions").status, "queued");

  // Save job state
  const store = {};
  const docFn = (k, init) => (store[k] ??= init());
  const putDocFn = (k, v) => { store[k] = v; };
  const saved = saveJob(docFn, putDocFn, job);
  assert.ok(saved.savedAt > 0);
  assert.equal(loadSavedJobs(docFn).length, 1);

  // Check UI progressHtml for paused job
  const htmlPaused = progressHtml(pausedView, { flowStages: true });
  assert.ok(htmlPaused.includes("data-ba-resume"));
  assert.ok(htmlPaused.includes("data-ba-save"));
  assert.ok(htmlPaused.includes("data-ba-stop"));

  // Resume job and verify it continues from questions without re-running idea
  const resumedView = await resumeJob(job.id);
  assert.equal(resumedView.status, "done");
  assert.equal(resumedView.paused, false);
  assert.deepEqual(ran, ["idea", "questions", "plan"]);
  assert.deepEqual(resumedView.result, { ok: true, note: "Planned." });

  // Also verify stopJob on a paused job marks remaining steps skipped
  const job2 = createJob({ surface: "start", steps: [{ id: "idea" }, { id: "questions" }], flowStages: true });
  pauseJob(job2.id);
  await runSteps(job2, [
    { id: "idea", run: async () => ({ note: "ok" }) },
    { id: "questions", run: async () => ({ note: "ok" }) },
  ]);
  assert.equal(job2.status, "paused");
  stopJob(job2.id);
  assert.equal(job2.status, "stopped");
  assert.equal(job2.steps[1].status, "skipped");
});

test("HTTP walkthrough flow stages, stacked steps, pause/resume/save, and sub-projects/expand", async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  await s.api("/demo", { method: "POST", body: { on: true } });
  const srv = { url: "" };
  // thin fetch-like wrapper over the token-aware test api helper
  const fetch = async (u, o = {}) => {
    const res = await s.api(u.slice(4), { method: o.method || "GET", body: o.body ? JSON.parse(o.body) : undefined });
    return { status: res.status, json: async () => res.json };
  };

  // 1. Start walkthrough with flag_flowstages=1
  let r = await fetch(`${srv.url}/api/walkthrough?flag_flowstages=1&experience=simple`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "website" }),
  });
  assert.equal(r.status, 200);
  let walk = await r.json();
  assert.equal(walk.flowStagesEnabled, true);
  assert.equal(walk.flowStage, "creative");
  assert.equal(walk.breadcrumb.length, 6);
  assert.equal(walk.breadcrumb[0].label, "Creative");

  // 2. Submit idea using Flow stage alias route /creative
  r = await fetch(`${srv.url}/api/walkthrough/${walk.id}/creative?flag_flowstages=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: "Weekend sourdough bakery with pre-orders and bread menu." }),
  });
  assert.equal(r.status, 200);
  walk = await r.json();
  assert.equal(walk.stage, "questions");
  assert.equal(walk.flowStage, "planning");
  assert.ok(walk.projectId);

  // 3. Let AI fill the Planning stage via /autofill
  r = await fetch(`${srv.url}/api/walkthrough/${walk.id}/autofill?flag_flowstages=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage: "planning" }),
  });
  assert.equal(r.status, 200);
  walk = await r.json();
  assert.ok(walk.answers.audience);
  assert.equal(walk.stage, "plan");
  assert.equal(walk.flowStage, "ai-movement");

  // 4. Jump via clickable breadcrumb to any stage and back without losing work
  r = await fetch(`${srv.url}/api/walkthrough/${walk.id}/stage?flag_flowstages=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage: "creative" }),
  });
  assert.equal(r.status, 200);
  walk = await r.json();
  assert.equal(walk.stage, "idea");
  assert.ok(walk.answers.audience);

  assert.equal((await s.api("/settings", { method: "POST", body: { uiMode: "expert" } })).status, 200);

  // 5. Stack steps and auto-advance through stages
  const stackedInput = normalizeStackedSteps([
    { stage: "ai-movement", prompt: "Plan 3 pages for the bakery." },
    { stage: "build-mode", prompt: "Draft the home, menu, and pre-order copy." },
    { stage: "testing", prompt: "Add a pickup hours reminder." },
  ]);
  assert.equal(stackedInput.length, 3);

  r = await fetch(`${srv.url}/api/walkthrough/${walk.id}/stack?flag_flowstages=1&experience=expert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ steps: stackedInput, run: true }),
  });
  assert.equal(r.status, 200);
  walk = await r.json();
  assert.equal(walk.stage, "done");
  assert.equal(walk.flowStage, "finish");
  assert.ok(walk.deliverable.includes("##"));
  assert.equal(walk.stackedSteps.every((s) => s.status === "done"), true);
  assert.equal(walk.flowchart.mode, "flowchart");
  assert.equal(walk.flowchart.layout, "horizontal");

  // 6. Pause, save, and resume walkthrough
  r = await fetch(`${srv.url}/api/walkthrough/${walk.id}/pause`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 200);
  walk = await r.json();
  assert.equal(walk.paused, true);
  assert.equal(walk.status, "paused");

  r = await fetch(`${srv.url}/api/walkthrough/${walk.id}/save`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 200);
  walk = await r.json();
  assert.ok(walk.savedAt > 0);

  r = await fetch(`${srv.url}/api/walkthrough/${walk.id}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 200);
  walk = await r.json();
  assert.equal(walk.paused, false);
  assert.equal(walk.status, "ready");

  // 7. Sub-projects (parentId) and expandable project details
  const parentId = walk.projectId;
  r = await fetch(`${srv.url}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Bakery Holiday Sub-campaign",
      parentId,
      summary: "Holiday loaf pre-orders",
      categories: [
        { id: "images", name: "Images", links: [{ name: "Loaf photo", url: "https://example.com/photo.jpg" }] },
        { id: "videos", name: "Videos", links: [{ name: "Oven reel", url: "https://youtube.com/watch?v=123" }] },
      ],
    }),
  });
  assert.equal(r.status, 200);
  const subProj = await r.json();
  assert.equal(subProj.parentId, parentId);

  // Add links to parent project and expand it
  await fetch(`${srv.url}/api/projects/${parentId}/links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ categoryId: "images", name: "Bakery banner image", url: "https://example.com/banner.png" }),
  });
  await fetch(`${srv.url}/api/projects/${parentId}/links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ categoryId: "automations", name: "HighLevel order workflow", url: "https://app.gohighlevel.com/workflow" }),
  });

  r = await fetch(`${srv.url}/api/projects/${parentId}/subprojects`);
  assert.equal(r.status, 200);
  const subList = await r.json();
  assert.equal(subList.subProjects.length, 1);
  assert.equal(subList.subProjects[0].id, subProj.id);

  r = await fetch(`${srv.url}/api/projects/${parentId}/expand`);
  assert.equal(r.status, 200);
  const expanded = await r.json();
  assert.equal(expanded.id, parentId);
  assert.equal(expanded.counts.subProjects, 1);
  assert.ok(expanded.counts.prompts >= 1);
  assert.ok(expanded.counts.images >= 1);
  assert.ok(expanded.counts.automations >= 1);
  assert.ok(expanded.counts.documents >= 1);

  r = await fetch(`${srv.url}/api/projects/tree`);
  assert.equal(r.status, 200);
  const treeData = await r.json();
  const rootNode = treeData.tree.find((n) => n.id === parentId);
  assert.ok(rootNode);
  assert.equal(rootNode.subProjects.length, 1);
  assert.equal(rootNode.subProjects[0].id, subProj.id);
});

test("Flow stages UI files contain breadcrumb, flowchart, expandable project hooks, and no em/en dashes", () => {
  const files = [
    "server/walkthroughs.js",
    "server/plugins/walkthrough.js",
    "server/build-all.js",
    "server/plugins/buildall.js",
    "server/projects.js",
    "web/features/walkthrough.js",
    "web/build-all-ui.js",
    "web/features/webbuilders.js",
    "web/app.js",
  ];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    assert.ok(!text.includes("\u2014") && !text.includes("\u2013"), `${f} must not contain em or en dashes`);
  }
  const walkUi = fs.readFileSync("web/features/walkthrough.js", "utf8");
  assert.ok(walkUi.includes("sp-breadcrumb"));
  assert.ok(walkUi.includes("sp-flowchart"));
  assert.ok(walkUi.includes("data-stage-jump"));
  assert.ok(walkUi.includes("Let AI fill"));
  assert.ok(walkUi.includes("Queued steps"));

  const appUi = fs.readFileSync("web/app.js", "utf8");
  assert.ok(appUi.includes("data-pcard-expand"));
  assert.ok(appUi.includes("data-pcard-details"));
  assert.ok(appUi.includes("data-subproject-add"));
});
