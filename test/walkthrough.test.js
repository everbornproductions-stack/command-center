// Start a project: six types, six stages, council plan, router assignment, review, export,
// and a read-only example per type. Demo AIs only. No real key or URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { menuModel, groupFor } from "../web/nav.js";
import {
  TYPES, resolveExperience, parsePlan, scaffoldPlan, assignRoute, present, exampleEvents, exportMarkdown, missingAnswers,
} from "../server/walkthroughs.js";
import { EXAMPLES, exampleByType, EXAMPLE_NOTE, loadExamples } from "../server/walkthrough-examples.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const FILES = [
  "server/walkthroughs.js",
  "server/walkthrough-examples.js",
  "server/plugins/walkthrough.js",
  "web/features/walkthrough.js",
];

test("six project types, simple by default, expert when asked", () => {
  assert.deepEqual(TYPES.map((t) => t.id), ["website", "music-video", "marketing", "app", "business-plan", "reels"]);
  for (const t of TYPES) {
    assert.ok(t.questions.filter((q) => q.required).length >= 2, t.id);
    assert.ok(t.nextSteps.length >= 2, t.id);
    assert.equal(exampleByType(t.id)?.type, t.id);
    const ex = exampleByType(t.id);
    for (const q of t.questions) if (q.required) assert.ok(ex.answers[q.key], `${t.id} example answers ${q.key}`);
    assert.match(ex.deliverable, /Example data/);
    assert.match(ex.idea, /./);
  }
  assert.equal(resolveExperience({}), "simple");
  assert.equal(resolveExperience({ requested: "expert" }), "expert");
  assert.equal(resolveExperience({ requested: "nope" }), "simple");
  assert.equal(resolveExperience({ settings: { experience: "expert" }, requested: "simple" }), "expert");
  assert.equal(resolveExperience({ settings: { uiMode: "simple" }, requested: "expert" }), "simple");
  assert.equal(resolveExperience({ settings: { onboarded: true } }), "expert");
  assert.equal(missingAnswers(TYPES[0], {}).length, 2);
  assert.deepEqual(missingAnswers(TYPES[0], { audience: "neighbors", action: "call" }), []);
});

test("a council verdict becomes steps, and a bad verdict falls back to the starter plan", () => {
  const parsed = parsePlan('Here you go:\n```json\n{"title":"Harbor site","steps":[{"id":"t1","title":"Home copy","capability":"writing","deps":[]},{"id":"t2","title":"Checklist","capability":"nope","deps":[1]}],"assembly":"Join them."}\n```');
  assert.equal(parsed.source, "council");
  assert.equal(parsed.steps[1].capability, "writing");
  assert.deepEqual(parsed.steps[1].deps, ["t1"]);
  assert.equal(parsePlan("no json here"), null);
  const starter = scaffoldPlan(TYPES[0], "A weekend bakery site");
  assert.equal(starter.source, "template");
  assert.ok(starter.steps.length >= 3);
  const routed = assignRoute(starter.steps, () => [
    { provider: "anthropic", model: "claude", name: "Claude", providerName: "Claude", score: 90, estCost: 0.01 },
    { provider: "openai", model: "gpt", name: "GPT", providerName: "GPT", score: 80, estCost: 0.02 },
  ]);
  assert.equal(routed[0].provider, "anthropic");
  assert.ok(routed.some((s) => s.provider === "openai"));
  const simple = present({ id: "sp-1", type: "website", stage: "plan", idea: "Hi there friends", answers: {}, plan: { ...starter, steps: routed } }, "simple");
  assert.equal(simple.experience, "simple");
  assert.equal(simple.plan.steps[0].model, undefined);
  assert.equal(simple.plan.steps[0].routedTo, "a research AI");
  const expert = present({ id: "sp-1", type: "website", stage: "plan", idea: "Hi there friends", answers: {}, plan: { ...starter, steps: routed } }, "expert");
  assert.equal(expert.plan.steps[0].model, "claude");
  assert.equal(expert.modeLabel, "Expert");
});

test("each example plays on the flow map and stays labeled example data", () => {
  for (const ex of EXAMPLES) {
    assert.match(ex.deliverable, /Example data/);
    assert.match(EXAMPLE_NOTE, /Example data/);
    const events = exampleEvents(ex);
    assert.ok(events.some((e) => e.type === "mission.update" && /Example data/.test(e.mission.title)));
    assert.ok(events.some((e) => e.type === "agent.start" && e.provider));
    assert.ok(events.some((e) => e.type === "agent.done"));
    assert.equal(events.some((e) => e.type === "ledger.entry"), false);
    const view = { example: true, typeName: "Website", idea: ex.idea, questions: [], answers: {}, plan: ex.plan, deliverable: ex.deliverable, nextSteps: ex.nextSteps };
    assert.match(exportMarkdown(view), /^EXAMPLE DATA/);
  }
});

test("Help lists Start a project, and the home card and tour mention it", () => {
  const model = menuModel(["command", "settings"]);
  const work = model.find((g) => g.id === "work").items;
  assert.equal(work.filter((i) => i.view === "start").length, 1);
  assert.equal(model.find((g) => g.id === "help").items.filter((i) => i.view === "start").length, 0);
  assert.equal(groupFor("start"), "work");
  const withStart = menuModel(["command", "settings", "start"]);
  const work2 = withStart.find((g) => g.id === "work").items.filter((i) => i.view === "start");
  assert.equal(work2.length, 1);
  assert.equal(work2[0].label, "Start a project");
  const ui = read("web/features/walkthrough.js");
  assert.match(ui, /id="sp-home"/);
  assert.match(ui, /Watch an example/);
  assert.match(ui, /Simple mode keeps the route/);
  assert.match(ui, /Expert mode shows which AI/);
  assert.match(read("web/features/index.js"), /"walkthrough"/);
  assert.match(read("web/features/tour.js"), /Start a project/);
  assert.match(read("web/nav.js"), /Replay the tour/);
  assert.match(read("web/nav.js"), /Watch example projects/);
  assert.match(read("web/features/help.js"), /Replay the tour/);
  assert.match(read("web/features/help.js"), /Watch example projects/);
  assert.match(read("web/app.js"), /ev\?\.example === true \|\| ev\?\.overlay === true/, "example playback does not become a mission toast");
  assert.match(ui, /Nothing runs until you click Build it/);
  assert.match(ui, /Watch an example uses labeled example data/);
  for (const f of FILES) assert.ok(!read(f).includes("\u2014") && !read(f).includes("\u2013"), `dash in ${f}`);
});

test("a missing examples folder still shows a labeled placeholder", () => {
  const missing = loadExamples(path.join(ROOT, "walkthroughs", "examples-not-here"));
  assert.equal(missing.length, 6);
  assert.deepEqual(missing.map((e) => e.type), TYPES.map((t) => t.id));
  for (const ex of missing) {
    assert.equal(ex.placeholder, true);
    assert.match(ex.idea, /Example data/);
    assert.match(ex.deliverable, /Example data/);
    assert.equal(ex.plan.source, "placeholder");
    assert.ok(ex.plan.steps[0].provider);
    assert.ok(ex.nextSteps.length >= 2);
    const events = exampleEvents(ex);
    assert.ok(events.some((e) => e.type === "agent.start" && e.provider));
    assert.equal(events.some((e) => e.type === "ledger.entry"), false);
  }
  assert.notEqual(exampleByType("website").plan.source, "placeholder");
  const bad = loadExamples(path.join(ROOT, "walkthroughs"));
  assert.ok(bad.every((e) => e.placeholder === true));
});

async function waitWalk(s, id, pred, label) {
  let last = null;
  for (let i = 0; i < 200; i++) {
    const r = await s.api(`/walkthrough/${id}`);
    last = r.json;
    if (pred(last)) return last;
    if (last?.status === "failed") throw new Error(`${label} failed: ${last.error}\n${s.log.slice(-2000)}`);
    await sleep(500);
  }
  throw new Error(`timeout ${label}: ${JSON.stringify({ stage: last?.stage, status: last?.status, error: last?.error })}\n${s.log.slice(-2000)}`);
}

test("examples and help are read-only and do not call an AI", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/walkthrough", { noToken: true })).status, 401);
    const list = await s.api("/walkthrough");
    assert.equal(list.json.experience, "simple");
    assert.equal(list.json.types.length, 6);
    const help = await s.api("/walkthrough/help");
    const slugs = help.json.docs.map((d) => d.slug);
    assert.equal((await s.api("/walkthrough/help/../secrets")).status, 404);
    assert.equal((await s.api("/walkthrough/help/not-a-guide")).status, 404);
    if (slugs.includes("watch-example-projects")) {
      const page = await s.api("/walkthrough/help/watch-example-projects");
      assert.equal(page.status, 200);
      assert.match(page.json.markdown, /Example data/);
    }
    const before = (await s.api("/missions")).json.length;
    const play = await s.api("/walkthrough/example/website/play?immediate=1", { method: "POST", body: { immediate: true } });
    assert.equal(play.status, 200, play.text);
    assert.equal(play.json.view.example, true);
    assert.equal(play.json.view.readonly, true);
    assert.match(play.json.view.disclaimer, /Example data/);
    assert.match(play.json.view.markdown, /^EXAMPLE DATA/);
    assert.equal(play.json.view.plan.steps[0].model, undefined, "simple example hides the model");
    assert.equal((await s.api("/settings", { method: "POST", body: { uiMode: "expert", uiModeChosen: true } })).json.uiMode, "expert");
    const expert = await s.api("/walkthrough/example/music-video");
    assert.equal(expert.json.experience, "expert");
    assert.ok(expert.json.plan.steps[0].provider);
    const lv = await s.api("/liveview");
    const run = lv.json.runs.find((r) => /Example data/.test(r.title || ""));
    assert.ok(run, "the example is on the live view");
    assert.ok(lv.json.flow.nodes.some((n) => n.id === "hub"), "the flow map has the router");
    assert.ok(lv.json.flow.nodes.length > 1, "the flow map shows the AIs the example used");
    assert.equal((await s.api("/missions")).json.length, before, "an example is not saved as a mission");
    assert.equal((await s.api("/walkthrough")).json.walks.length, 0, "an example is not a project");
    const blocked = await s.api("/walkthrough/example-website/revise", { method: "POST", body: { note: "change it" } });
    assert.equal(blocked.status, 404);
  } finally { await s.stop(); }
});

test("a walk goes from idea to export on the demo AIs, in Simple and Expert views", { timeout: 240000 }, async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const created = await s.api("/walkthrough", { method: "POST", body: { type: "website" } });
    assert.equal(created.status, 200, created.text);
    const id = created.json.id;
    assert.equal(created.json.stage, "idea");
    assert.equal(created.json.experience, "simple");
    assert.equal((await s.api(`/walkthrough/${id}/idea`, { method: "POST", body: { idea: "short" } })).status, 400);
    const idea = await s.api(`/walkthrough/${id}/idea`, { method: "POST", body: { idea: "A weekend bakery site for Harbor and Rye, so people can see the bread and ask about a cake." } });
    assert.equal(idea.json.stage, "questions");
    assert.ok(idea.json.projectId, "filed under a project");
    const missing = await s.api(`/walkthrough/${id}/answers`, { method: "POST", body: { answers: { audience: "neighbors" } } });
    assert.equal(missing.status, 400);
    assert.ok(missing.json.missing.includes("action"));
    const answers = await s.api(`/walkthrough/${id}/answers`, { method: "POST", body: { answers: { audience: "neighbors", action: "ask about a cake", pages: "home and menu" } } });
    assert.equal(answers.status, 200, answers.text);
    const plan = await s.api(`/walkthrough/${id}/plan`, { method: "POST", body: {} });
    assert.equal(plan.status, 202, plan.text);
    const planned = await waitWalk(s, id, (w) => w.stage === "plan" && w.plan?.steps?.length >= 3, "plan");
    assert.equal(planned.plan.source, "council");
    assert.equal(planned.plan.steps[0].model, undefined);
    assert.equal((await s.api(`/walkthrough/${id}/steps`, { method: "POST", body: { steps: [{ id: "t1", title: "Nope" }] } })).status, 403);
    assert.equal((await s.api("/settings", { method: "POST", body: { uiMode: "expert", uiModeChosen: true } })).json.uiMode, "expert");
    const asExpert = await s.api(`/walkthrough/${id}`);
    assert.equal(asExpert.json.experience, "expert");
    assert.ok(asExpert.json.plan.steps[0].provider, "expert shows the routed AI");
    const edited = await s.api(`/walkthrough/${id}/steps`, { method: "POST", body: { steps: [{ id: planned.plan.steps[0].id, title: "Audience notes" }] } });
    assert.equal(edited.status, 200, edited.text);
    assert.equal(edited.json.plan.steps[0].title, "Audience notes");
    const build = await s.api(`/walkthrough/${id}/build`, { method: "POST", body: {} });
    assert.equal(build.status, 202, build.text);
    const built = await waitWalk(s, id, (w) => w.stage === "review" && w.deliverable, "build");
    assert.ok(built.deliverable.length > 40);
    assert.ok(built.plan.steps.some((s) => s.status === "done" && s.output));
    const brain = JSON.parse(fs.readFileSync(path.join(s.dir, "brain.json"), "utf8"));
    const doneSteps = built.plan.steps.filter((st) => st.status === "done" && st.model && st.capability);
    assert.ok(doneSteps.length >= 1, "a built step names the routed model and task type");
    for (const step of doneSteps) {
      const key = `${step.capability}:${step.difficulty || 2}`;
      assert.ok(brain.stats[step.model]?.t?.[key]?.jobs > 0, `${step.model} recorded on ${key}`);
    }
    assert.doesNotMatch(JSON.stringify(brain), /Harbor and Rye/);
    const rev = await s.api(`/walkthrough/${id}/revise`, { method: "POST", body: { note: "Add a line that prices stay marked until the owner writes them." } });
    assert.equal(rev.status, 202, rev.text);
    const revised = await waitWalk(s, id, (w) => (w.revisions || []).length === 1 && w.status === "ready", "revise");
    assert.match(revised.deliverable, /./);
    const done = await s.api(`/walkthrough/${id}/finish`, { method: "POST", body: {} });
    assert.equal(done.json.stage, "done");
    assert.ok(done.json.nextSteps.length >= 2);
    const file = await s.api(`/walkthrough/${id}/export`);
    assert.match(file.json.filename, /\.md$/);
    assert.match(file.json.markdown, /Harbor and Rye/);
    assert.match(file.json.markdown, /Not sent anywhere/);
    assert.doesNotMatch(file.json.markdown, /^EXAMPLE DATA/);
    const log = s.log;
    assert.ok(!/demo-key|sk-|xai-|AIza/.test(log), "no key in the log");
  } finally { await s.stop(); }
});
