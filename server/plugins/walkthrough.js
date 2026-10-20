// Start a project: idea, questions, a council plan, steps routed by the existing
// router, review, then export. Example walks are pre-recorded and read-only.
import { loadHelp } from "../help.js";
import { EXAMPLES, EXAMPLE_NOTE, exampleByType } from "../walkthrough-examples.js";
import {
  TYPES, typeById, resolveExperience, present, parsePlan, scaffoldPlan, planPrompt,
  assignRoute, formatAnswers, missingAnswers, exportMarkdown, slugTitle, exampleEvents, labelsFor,
} from "../walkthroughs.js";
import { normalizeMode } from "../modes.js";

export const id = "walkthrough";
const KIND = "walkthrough.items";
const running = new Set();

function load(h) {
  const d = h.doc(KIND, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  return d;
}
function persist(h, w) {
  const d = load(h);
  const i = d.items.findIndex((x) => x.id === w.id);
  w.updatedAt = Date.now();
  if (i >= 0) d.items[i] = w; else d.items.unshift(w);
  d.items = d.items.slice(0, 40);
  h.putDoc(KIND, d);
  return w;
}
function find(h, wid) {
  return load(h).items.find((x) => x.id === wid) || null;
}
function experience(h, requested) {
  let settings = {};
  try { settings = h.settings() || {}; } catch { settings = {}; }
  return resolveExperience({ settings, requested });
}
function presentWalk(w, exp) {
  return present(w, exp);
}

function helpDocs() {
  try { return loadHelp().articles.map((a) => ({ slug: a.id, title: a.title })); }
  catch { return []; }
}
function readHelp(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const article = loadHelp().articles.find((a) => a.id === slug);
    if (!article) return null;
    return { slug: article.id, title: article.title, markdown: article.body };
  } catch { return null; }
}

function presentExample(script, exp) {
  const type = typeById(script.type);
  const expert = exp === "expert";
  const view = {
    id: `example-${script.type}`,
    type: script.type,
    typeName: type?.name || script.type,
    example: true,
    readonly: true,
    label: "Example data",
    disclaimer: EXAMPLE_NOTE,
    experience: expert ? "expert" : "simple",
    modeLabel: expert ? "Expert" : "Simple",
    stage: "done",
    status: "ready",
    stages: ["idea", "questions", "plan", "build", "review", "done"].map((sid) => ({ id: sid, label: labelsFor(exp)[sid] })),
    idea: script.idea,
    answers: script.answers,
    questions: type?.questions || [],
    business: script.business,
    plan: {
      title: script.plan.title,
      source: "example",
      assembly: expert ? script.plan.assembly : undefined,
      steps: script.plan.steps.map((s) => ({
        id: s.id,
        title: s.title,
        deliverable: s.deliverable,
        status: "done",
        output: s.output,
        routedTo: expert ? (s.agentName || s.provider) : "an example AI",
        ...(expert ? { capability: s.capability, provider: s.provider, model: s.model, agentName: s.agentName, instructions: s.instructions, deps: s.deps || [] } : {}),
      })),
    },
    deliverable: script.deliverable,
    revisions: [],
    nextSteps: script.nextSteps,
    projectId: null,
    projectNote: "Example data is not filed under a project.",
    error: null,
  };
  view.markdown = exportMarkdown(view);
  return view;
}

function attachProject(h, w) {
  if (w.projectId) return;
  const type = typeById(w.type);
  const name = `${type?.name || "Project"}: ${String(w.idea || "").slice(0, 42)}`;
  const existing = h.listProjects?.() || [];
  try {
    h.guard?.("projects", { count: existing.length });
    const p = h.saveProject({
      name: name.slice(0, 80),
      summary: String(w.idea || "").slice(0, 180),
      color: type?.color || "#22d3ee",
      categories: [{ id: "deliverables", name: type?.category || "Deliverables", links: [] }],
    });
    w.projectId = p?.id || null;
    w.projectNote = "A project was created for this work.";
  } catch {
    const p = existing[0];
    if (p) {
      w.projectId = p.id;
      w.projectNote = `Filed under ${p.name}. This plan does not add another project.`;
    }
  }
}

function priorityFor(w, exp, body) {
  const asked = String(body?.priority || w.priority || "balanced").toLowerCase();
  if (exp === "expert") return normalizeMode(asked) || "balanced";
  return "balanced";
}

async function runPlan(h, w, exp) {
  const type = typeById(w.type);
  try {
    const expertMode = exp === "expert" ? priorityFor(w, exp) : null;
    const council = await h.runCouncil({
      prompt: planPrompt(type, w),
      projectId: w.projectId || null,
      lite: exp !== "expert",
      ...(expertMode ? { mode: expertMode } : {}),
      qa: true,
      search: false,
      tools: false,
      grokbot: false,
      browser: false,
    });
    const text = council?.verdict?.text || Object.values(council?.answers || {}).map((a) => a.text).find(Boolean) || "";
    const parsed = parsePlan(text) || scaffoldPlan(type, w.idea);
    if (parsed.source !== "council") parsed.councilFellBack = true;
    parsed.steps = assignRoute(parsed.steps, h.rank, priorityFor(w, exp));
    w.plan = { ...parsed, councilId: council?.id || null, councilNotes: String(text).slice(0, 1500) };
    w.stage = "plan";
    w.status = "ready";
    w.error = null;
    h.emit("log", { text: `Start a project: the council planned ${type.name}.`, missionId: council?.id });
  } catch (e) {
    w.stage = "questions";
    w.status = "failed";
    w.error = e.message || "The council could not build a plan.";
    h.emit("log", { text: `Start a project: plan failed (${w.error})`, level: "error" });
  }
  persist(h, w);
}

async function runBuild(h, w, exp, body) {
  const type = typeById(w.type);
  const mode = priorityFor(w, exp, body);
  w.priority = mode;
  w.plan.steps = assignRoute(w.plan.steps.map((s) => ({ ...s, status: "queued", output: null })), h.rank, mode);
  w.stage = "build";
  w.status = "building";
  w.error = null;
  persist(h, w);
  const overlay = `sp-${w.id}`;
  const tasks = () => w.plan.steps.map((s) => ({
    id: s.id, title: s.title, status: s.status, provider: s.provider, model: s.model, agentName: s.agentName,
  }));
  const emitMission = (status) => h.emit("mission.update", {
    overlay: true,
    mission: { id: overlay, kind: "mission", title: w.plan.title || type.name, projectId: w.projectId || null, status, cost: 0, tasks: tasks() },
  });
  emitMission("running");
  try {
    if (!w.plan.steps.some((s) => s.provider)) throw new Error("No AI is available. Add an API key in Settings, or turn on demo mode.");
    for (const step of w.plan.steps) {
      const blocked = (step.deps || []).some((d) => w.plan.steps.find((s) => s.id === d && s.status !== "done"));
      if (blocked) { step.status = "failed"; step.output = "Skipped: an earlier step did not finish."; continue; }
      step.status = "running";
      emitMission("running");
      h.emit("task.update", { overlay: true, missionId: overlay, task: tasks().find((t) => t.id === step.id) });
      h.emit("agent.start", {
        overlay: true, agent: `${overlay}:${step.id}`, provider: step.provider, model: step.model, role: "answer",
        missionId: overlay, taskId: step.id, label: `${step.agentName || "AI"}: ${step.title}`,
      });
      const prior = w.plan.steps.filter((s) => s.output).map((s) => `## ${s.title}\n${s.output}`).join("\n\n");
      const prompt = `${step.title}\n\nInstructions: ${step.instructions}\n\nNeeded: ${step.deliverable}\n\nIDEA:\n${w.idea}\n\nANSWERS:\n${formatAnswers(type, w.answers)}\n\n${prior ? `EARLIER STEPS:\n${prior}` : ""}`;
      const run = await h.runChat({
        prompt, provider: step.provider, model: step.model, projectId: w.projectId || null,
        search: false, tools: false, runId: `${overlay}-${step.id}`,
        capability: step.capability || "writing", difficulty: step.difficulty || 2,
        system: "You are one specialist on a small team. Be concrete. Do not invent numbers, dates, or personal data. Mark gaps as [ASK]. Do not send, post, or buy anything. Markdown is fine.",
      });
      step.output = run?.deliverable || "";
      step.status = run?.status === "done" && step.output ? "done" : "failed";
      step.runId = run?.id || null;
      if (run?.status !== "done") step.output = step.output || run?.error || "This step did not finish.";
      h.emit("agent.done", {
        overlay: true, agent: `${overlay}:${step.id}`, provider: step.provider, model: step.model, missionId: overlay,
        taskId: step.id, ms: (run?.finishedAt || Date.now()) - (run?.startedAt || Date.now()), cost: run?.cost || 0,
      });
      persist(h, w);
    }
    const pack = w.plan.steps.map((s) => `## ${s.title}\n${s.output || "(no output)"}`).join("\n\n");
    const host = w.plan.steps.find((s) => s.provider && s.status === "done") || w.plan.steps.find((s) => s.provider);
    const final = await h.runChat({
      prompt: `Assemble one deliverable: ${w.plan.title}\n\nHow to assemble: ${w.plan.assembly}\n\nPIECES:\n${pack}`,
      provider: host.provider, model: host.model, projectId: w.projectId || null,
      search: false, tools: false, runId: `${overlay}-final`,
      capability: "writing", difficulty: 3,
      system: "Assemble the pieces into one clean document. Keep [ASK] markers. Do not add facts that are not in the pieces. Do not send it anywhere.",
    });
    w.deliverable = final?.deliverable || pack;
    w.stage = "review";
    w.status = "ready";
    w.error = null;
    emitMission("done");
    h.emit("log", { text: `Start a project: ${type.name} is ready to review.` });
  } catch (e) {
    w.status = "failed";
    w.error = e.message || "The steps could not be built.";
    emitMission("failed");
    h.emit("log", { text: `Start a project: build failed (${w.error})`, level: "error" });
  }
  persist(h, w);
}

async function runRevise(h, w, note) {
  const host = w.plan?.steps?.find((s) => s.provider) || null;
  w.status = "revising";
  persist(h, w);
  try {
    if (!host?.provider) throw new Error("No AI is available to revise this. Add an API key in Settings, or turn on demo mode.");
    const run = await h.runChat({
      prompt: `Revise the deliverable.\n\nChange request:\n${note}\n\nCURRENT DELIVERABLE:\n${w.deliverable}`,
      provider: host.provider, model: host.model, projectId: w.projectId || null,
      search: false, tools: false, runId: `sp-${w.id}-rev-${(w.revisions || []).length + 1}`,
      capability: host.capability || "writing", difficulty: host.difficulty || 2,
      system: "Revise the deliverable as asked. Keep [ASK] markers. Do not invent facts. Do not send it anywhere.",
    });
    if (run?.deliverable) w.deliverable = run.deliverable;
    w.revisions = [...(w.revisions || []), { note: note.slice(0, 500), at: Date.now() }];
    w.stage = "review";
    w.status = run?.status === "done" ? "ready" : "failed";
    w.error = run?.status === "done" ? null : (run?.error || "The revision did not finish.");
  } catch (e) {
    w.status = "failed";
    w.error = e.message || "The revision did not finish.";
  }
  persist(h, w);
}

function readonly(h, res) {
  return h.json(res, 409, { error: "This is example data. It is read-only. Start your own project to make a real one.", code: "example_readonly" });
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/walkthrough\/?/, "");
  const parts = p.split("/").filter(Boolean);
  const exp = experience(h, url.searchParams.get("experience") || body?.experience);

  if (req.method === "GET" && parts.length === 0) {
    const items = load(h).items.filter((w) => !w.example);
    return h.json(res, 200, {
      experience: exp,
      modeLabel: exp === "expert" ? "Expert" : "Simple",
      types: TYPES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, color: t.color })),
      walks: items.map((w) => presentWalk(w, exp)),
      examples: EXAMPLES.map((e) => ({ type: e.type, label: "Example data", title: e.plan.title })),
    });
  }
  if (req.method === "GET" && parts[0] === "types") {
    return h.json(res, 200, TYPES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, questions: t.questions, nextSteps: t.nextSteps })));
  }
  if (req.method === "GET" && parts[0] === "help" && !parts[1]) return h.json(res, 200, { docs: helpDocs() });
  if (req.method === "GET" && parts[0] === "help" && parts[1]) {
    const doc = readHelp(parts[1]);
    if (!doc) return h.json(res, 404, { error: "Help page not found" });
    return h.json(res, 200, doc);
  }
  if (parts[0] === "example" && parts[1]) {
    const script = exampleByType(parts[1]);
    if (!script) return h.json(res, 404, { error: "No example for that project type" });
    if (req.method === "GET" && parts.length === 2) return h.json(res, 200, presentExample(script, exp));
    if (req.method === "POST" && parts[2] === "play") {
      const events = exampleEvents(script);
      const immediate = body?.immediate === true || url.searchParams.get("immediate") === "1";
      const emitAll = () => { for (const ev of events) { const { type, ...rest } = ev; h.emit(type, rest); } };
      if (immediate) emitAll();
      else events.forEach((ev, i) => { const t = setTimeout(() => { const { type, ...rest } = ev; h.emit(type, rest); }, 80 * i); t.unref?.(); });
      h.emit("log", { text: `Example data playing: ${script.plan.title}. No AI was called.` });
      return h.json(res, 200, { ok: true, readonly: true, example: true, events: events.length, view: presentExample(script, exp) });
    }
    return false;
  }

  if (req.method === "POST" && parts.length === 0) {
    const type = typeById(body?.type);
    if (!type) return h.json(res, 400, { error: "Pick a project type.", code: "bad_type" });
    const w = {
      id: "sp-" + Date.now().toString(36),
      type: type.id,
      stage: "idea",
      status: "ready",
      idea: "",
      answers: {},
      plan: null,
      deliverable: "",
      revisions: [],
      createdAt: Date.now(),
    };
    persist(h, w);
    return h.json(res, 200, presentWalk(w, exp));
  }

  const wid = parts[0];
  if (!wid || wid.includes("..")) return false;
  const w = find(h, wid);
  if (!w) return h.json(res, 404, { error: "Project walk not found" });
  if (w.example) return readonly(h, res);

  if (req.method === "GET" && parts.length === 1) return h.json(res, 200, presentWalk(w, exp));
  if (req.method === "GET" && parts[1] === "export") {
    if (!w.deliverable && !w.plan) return h.json(res, 409, { error: "Nothing to export yet." });
    const view = presentWalk(w, exp);
    if (w.stage === "done" || w.stage === "review") view.nextSteps = typeById(w.type)?.nextSteps || [];
    const markdown = exportMarkdown({ ...view, example: false });
    return h.json(res, 200, { filename: `${slugTitle(w.plan?.title || typeById(w.type)?.name)}.md`, markdown, example: false });
  }

  if (req.method !== "POST") return false;
  if (running.has(w.id) && ["plan", "build", "revise"].includes(parts[1])) {
    return h.json(res, 409, { error: "This project is already working. Wait for it to finish.", code: "busy" });
  }

  if (parts[1] === "idea") {
    const idea = String(body?.idea || "").trim();
    if (idea.length < 8) return h.json(res, 400, { error: "Describe the idea in a sentence or two." });
    if (idea.length > 4000) return h.json(res, 400, { error: "Keep the idea under 4000 characters." });
    w.idea = idea;
    w.stage = "questions";
    w.status = "ready";
    w.error = null;
    attachProject(h, w);
    persist(h, w);
    return h.json(res, 200, presentWalk(w, exp));
  }
  if (parts[1] === "answers") {
    if (!w.idea) return h.json(res, 400, { error: "Describe the idea first." });
    const type = typeById(w.type);
    const answers = {};
    for (const q of type.questions) answers[q.key] = String(body?.answers?.[q.key] || "").trim().slice(0, 2000);
    const missing = missingAnswers(type, answers);
    if (missing.length) return h.json(res, 400, { error: "A few answers are still needed. Nothing was invented to fill them.", code: "missing", missing });
    w.answers = answers;
    w.stage = "questions";
    w.status = "ready";
    w.error = null;
    persist(h, w);
    return h.json(res, 200, presentWalk(w, exp));
  }
  if (parts[1] === "plan") {
    if (!w.idea || !Object.keys(w.answers || {}).length) return h.json(res, 400, { error: "Answer the questions first." });
    w.stage = "plan";
    w.status = "planning";
    w.error = null;
    persist(h, w);
    running.add(w.id);
    h.json(res, 202, presentWalk(w, exp));
    runPlan(h, w, exp).finally(() => running.delete(w.id));
    return true;
  }
  if (parts[1] === "steps") {
    if (exp !== "expert") return h.json(res, 403, { error: "Editing the plan is an Expert mode option. In Simple mode the council's plan is used as it is.", code: "expert_only" });
    if (!w.plan?.steps?.length) return h.json(res, 400, { error: "There is no plan to edit yet." });
    const incoming = Array.isArray(body?.steps) ? body.steps : [];
    for (const s of w.plan.steps) {
      const edit = incoming.find((x) => x.id === s.id);
      if (!edit) continue;
      if (edit.title) s.title = String(edit.title).trim().slice(0, 80);
      if (typeof edit.instructions === "string") s.instructions = edit.instructions.trim().slice(0, 1000);
    }
    persist(h, w);
    return h.json(res, 200, presentWalk(w, exp));
  }
  if (parts[1] === "build") {
    if (!w.plan?.steps?.length) return h.json(res, 400, { error: "Build the plan first." });
    w.stage = "build";
    w.status = "building";
    persist(h, w);
    running.add(w.id);
    h.json(res, 202, presentWalk(w, exp));
    runBuild(h, w, exp, body).finally(() => running.delete(w.id));
    return true;
  }
  if (parts[1] === "revise") {
    if (w.stage !== "review" && w.stage !== "done") return h.json(res, 400, { error: "Review is available after the steps finish." });
    const note = String(body?.note || "").trim();
    if (note.length < 4) return h.json(res, 400, { error: "Say what you want changed." });
    running.add(w.id);
    h.json(res, 202, presentWalk(w, exp));
    runRevise(h, w, note).finally(() => running.delete(w.id));
    return true;
  }
  if (parts[1] === "finish") {
    if (!w.deliverable) return h.json(res, 400, { error: "There is no deliverable to finish." });
    w.stage = "done";
    w.status = "ready";
    persist(h, w);
    return h.json(res, 200, presentWalk(w, exp));
  }
  return false;
}
