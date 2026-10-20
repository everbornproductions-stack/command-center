// Guided "Start a project" walkthroughs.
// Six project types, six stages: idea, clarifying questions, a council plan,
// routed steps, review, then a deliverable with export and next steps.
// Simple and Expert come from the mode switch (web/mode.js). A request can ask
// only when that setting is not saved yet. Example projects never call an AI.
import { isFreshInstall, resolveMode } from "../web/mode.js";

export const STAGES = ["idea", "questions", "plan", "build", "review", "done"];

export const STAGE_LABELS = {
  simple: {
    idea: "Your idea",
    questions: "A few questions",
    plan: "The plan",
    build: "Building",
    review: "Review",
    done: "Your result",
  },
  expert: {
    idea: "Describe",
    questions: "Clarifying questions",
    plan: "Council plan",
    build: "Routed steps",
    review: "Review and revise",
    done: "Export",
  },
};

const CAPS = new Set(["reasoning", "code", "writing", "research", "creative", "analysis", "math"]);
const PLAIN_ROUTE = {
  reasoning: "a planning AI",
  code: "a coding AI",
  writing: "a writing AI",
  research: "a research AI",
  creative: "a creative AI",
  analysis: "a checking AI",
  math: "a numbers AI",
};

export const TYPES = [
  {
    id: "website",
    name: "Website",
    blurb: "Page list, copy, and a launch checklist.",
    color: "#22d3ee",
    category: "Website",
    questions: [
      { key: "audience", label: "Who is the site for?", required: true, placeholder: "Neighbors who want bread on the weekend" },
      { key: "action", label: "What should a visitor do?", required: true, placeholder: "Order ahead, or ask about a cake" },
      { key: "pages", label: "Which pages do you need?", required: false, placeholder: "Home, menu, about, contact" },
      { key: "proof", label: "Facts you can stand behind", required: false, placeholder: "Open since 2019. Leave blank if you have none yet." },
    ],
    nextSteps: [
      "Read the copy and replace every [ASK] with a fact you can stand behind.",
      "Nothing is published from here. You send or hand off the draft yourself when you want to.",
      "Open Live to see which step went to which AI.",
    ],
  },
  {
    id: "music-video",
    name: "Music video",
    blurb: "Concept, shot list, and prompts you can take to a video tool.",
    color: "#a78bfa",
    category: "Music Videos",
    questions: [
      { key: "song", label: "Song title, and what it is about", required: true, placeholder: "Glass Orchard, a walk home after the shop closes" },
      { key: "look", label: "Look and mood", required: true, placeholder: "Night, wet pavement, one warm window" },
      { key: "who", label: "Who is on camera?", required: false, placeholder: "One singer, no crowd" },
      { key: "length", label: "Length and where it will be posted", required: false, placeholder: "About 30 seconds, for Instagram" },
    ],
    nextSteps: [
      "Approve the shot list before any clip is made.",
      "A paid video step waits until you click Approve. Nothing is generated on its own.",
      "Keep the same wardrobe and light notes on every prompt so the shots match.",
    ],
  },
  {
    id: "marketing",
    name: "Marketing campaign",
    blurb: "Offer, audience, channel plan, and drafts you review before anything goes out.",
    color: "#34d399",
    category: "Campaigns",
    questions: [
      { key: "offer", label: "What are you offering?", required: true, placeholder: "A repair kit for last year's jacket" },
      { key: "audience", label: "Who is it for?", required: true, placeholder: "People who already bought the jacket" },
      { key: "channels", label: "Where should it show up?", required: false, placeholder: "Email and Instagram" },
      { key: "result", label: "The one result you want", required: false, placeholder: "Booked repairs this month" },
    ],
    nextSteps: [
      "Check every claim against a fact you can stand behind. Leave [ASK] until you can.",
      "Drafts stay here. Nothing is emailed or posted until you do that yourself.",
      "Open Live if you want to see who wrote which piece.",
    ],
  },
  {
    id: "app",
    name: "App/software",
    blurb: "Who it is for, the must-have screens, and a build order.",
    color: "#60a5fa",
    category: "Software",
    questions: [
      { key: "job", label: "Who uses it, and what job does it do?", required: true, placeholder: "Crew leads log job-site photos before they leave" },
      { key: "must", label: "What must the first version do?", required: true, placeholder: "Take a photo, add a note, save it to the job" },
      { key: "platform", label: "Phone, web, or desktop?", required: false, placeholder: "Phone first" },
      { key: "done", label: "What does done look like for this pass?", required: false, placeholder: "A clickable outline, not a store release" },
    ],
    nextSteps: [
      "Treat the outline as a plan, not as finished software.",
      "Cut anything that is not on the must-have list before you build.",
      "You start the build yourself. This walk does not deploy or ship code.",
    ],
  },
  {
    id: "business-plan",
    name: "Business plan",
    blurb: "A short plan from facts you supply. Missing numbers stay marked [ASK].",
    color: "#fbbf24",
    category: "Planning",
    questions: [
      { key: "business", label: "The business in one sentence", required: true, placeholder: "A monthly tea club for offices" },
      { key: "pays", label: "Who pays, and for what?", required: true, placeholder: "Office managers pay for a monthly delivery" },
      { key: "facts", label: "Facts you already know", required: false, placeholder: "Twelve offices asked for a sample. No revenue yet." },
      { key: "decision", label: "What decision should this plan support?", required: false, placeholder: "Whether to buy inventory for a pilot" },
    ],
    nextSteps: [
      "Do not treat [ASK] as a number. Fill it only when you have the fact.",
      "This is a draft for you. It is not sent to a bank, a partner, or a client.",
      "If a figure came from the example walk, it is not your figure.",
    ],
  },
  {
    id: "reels",
    name: "Social media reels",
    blurb: "A short set of reels: hook, caption, and what to film.",
    color: "#fb7185",
    category: "Social Posts",
    questions: [
      { key: "brand", label: "Brand and topic", required: true, placeholder: "Milo's Guitar, first chords for adults" },
      { key: "count", label: "How many reels?", required: true, placeholder: "Four" },
      { key: "platform", label: "Where will they run?", required: false, placeholder: "Instagram and TikTok" },
      { key: "next", label: "What should the viewer do next?", required: false, placeholder: "Book a trial lesson" },
    ],
    nextSteps: [
      "Film only what you are willing to post. The drafts are not posted for you.",
      "Read each caption out loud before you use it.",
      "A paid clip waits until you click Approve in Media.",
    ],
  },
];

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function typeById(id) {
  return TYPES.find((t) => t.id === id) || null;
}

export function readExperience(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "expert" || raw === "advanced") return "expert";
  if (raw === "simple") return "simple";
  return null;
}

// The mode switch wins. A request is used only when uiMode is not saved yet.
export function resolveExperience({ settings, requested, onboarding } = {}) {
  const s = settings || {};
  const alias = readExperience(s.experience);
  const merged = alias && !readExperience(s.uiMode) ? { ...s, uiMode: alias } : s;
  if (readExperience(merged.uiMode)) return resolveMode(merged, { fresh: isFreshInstall({ onboarding, settings: merged }) });
  const asked = readExperience(requested);
  if (asked) return asked;
  return resolveMode(merged, { fresh: isFreshInstall({ onboarding, settings: merged }) });
}

export function labelsFor(experience) {
  return STAGE_LABELS[experience === "expert" ? "expert" : "simple"];
}

function cleanCapability(value) {
  const c = String(value || "writing").toLowerCase();
  return CAPS.has(c) ? c : "writing";
}

export function normalizeSteps(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 5) : [];
  const steps = list.map((s, i) => ({
    id: /^t\d+$/.test(String(s?.id || "")) ? String(s.id) : `t${i + 1}`,
    title: clip(s?.title || `Step ${i + 1}`, 80) || `Step ${i + 1}`,
    capability: cleanCapability(s?.capability),
    difficulty: Math.min(3, Math.max(1, Number(s?.difficulty) || 2)),
    instructions: clip(s?.instructions || "", 1000),
    deliverable: clip(s?.deliverable || "The written piece", 300),
    deps: Array.isArray(s?.deps) ? s.deps : [],
    status: "queued",
    output: null,
  }));
  const ids = steps.map((s) => s.id);
  for (const s of steps) {
    const deps = [];
    for (const d of s.deps) {
      if (typeof d === "number" && ids[d - 1]) deps.push(ids[d - 1]);
      else if (ids.includes(String(d)) && String(d) !== s.id) deps.push(String(d));
    }
    s.deps = [...new Set(deps)];
  }
  return steps.filter((s) => s.title);
}

export function parsePlan(text) {
  const raw = String(text || "");
  const candidates = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      const steps = normalizeSteps(j.steps || j.tasks);
      if (!steps.length) continue;
      return { title: clip(j.title || "Project plan", 80), steps, assembly: clip(j.assembly || "Combine the steps into one document.", 400), source: "council" };
    } catch { /* try the next candidate */ }
  }
  return null;
}

export function scaffoldPlan(type, idea) {
  const topic = clip(idea, 48) || type.name;
  return {
    title: topic,
    source: "template",
    assembly: "One document: who it is for, the main draft, then a checklist. Keep every [ASK].",
    steps: normalizeSteps([
      { id: "t1", title: "Frame who it is for", capability: "research", difficulty: 2, deps: [], instructions: `Using only the idea and the answers, describe who this ${type.name.toLowerCase()} is for and the one action they should take.`, deliverable: "Audience and goal notes" },
      { id: "t2", title: "Draft the main piece", capability: type.id === "app" ? "code" : type.id === "music-video" ? "creative" : "writing", difficulty: 2, deps: ["t1"], instructions: "Write the main deliverable in plain language. Do not invent numbers. Mark gaps as [ASK].", deliverable: "Draft" },
      { id: "t3", title: "Checks and next actions", capability: "analysis", difficulty: 1, deps: ["t2"], instructions: "List what to check before this is used, and the next three actions for the person. Do not send or post anything.", deliverable: "Checklist" },
    ]),
  };
}

export function planPrompt(type, walk) {
  const answers = (type.questions || []).map((q) => `${q.label}: ${walk.answers?.[q.key] || "(not given)"}`).join("\n");
  return `WALKTHROUGH_PLAN
Project type: ${type.name}
IDEA:
${walk.idea}

ANSWERS:
${answers}

Reply with JSON only, no markdown, in this shape:
{"title":"<=8 words","steps":[{"id":"t1","title":"<=10 words","capability":"reasoning|code|writing|research|creative|analysis|math","difficulty":2,"deps":[],"instructions":"1-3 sentences","deliverable":"what the output contains"}],"assembly":"1-2 sentences"}
Use 3 to 5 steps. Do not invent prices, dates, or personal data that were not given. Mark unknown facts as [ASK]. Do not say that anything was sent or posted.`;
}

// The router picks a model per step. rank() is the existing router.
export function assignRoute(steps, rank, mode = "balanced") {
  const used = new Map();
  return (steps || []).map((s) => {
    let ranked = [];
    try { ranked = rank?.({ capability: s.capability || "writing", difficulty: s.difficulty || 2, mode, estIn: 900, estOut: 500 }) || []; }
    catch { ranked = []; }
    const top = ranked[0] || null;
    const floor = (top?.score || 0) - 6;
    let choice = top;
    for (const c of ranked.slice(0, 4)) {
      if ((used.get(c.provider) || 0) < 2 && c.score >= floor) { choice = c; break; }
    }
    // After two steps on one provider, give the next step to another AI in the shortlist
    // so a plan is not stuck on a single model when a second choice exists.
    if (choice?.provider && (used.get(choice.provider) || 0) >= 2) {
      const alt = ranked.slice(0, 4).find((c) => c.provider && c.provider !== choice.provider);
      if (alt) choice = alt;
    }
    if (choice?.provider) used.set(choice.provider, (used.get(choice.provider) || 0) + 1);
    return {
      ...s,
      provider: choice?.provider || null,
      model: choice?.model || null,
      agentName: choice ? `${choice.providerName || choice.name || choice.provider}` : null,
      score: choice?.score ?? null,
      estCost: choice?.estCost ?? null,
    };
  });
}

export function plainRoute(capability) {
  return PLAIN_ROUTE[capability] || "the best AI for this step";
}

function publicStep(s, expert) {
  const base = {
    id: s.id,
    title: s.title,
    deliverable: s.deliverable,
    status: s.status || "queued",
    output: s.output || null,
    routedTo: plainRoute(s.capability),
  };
  if (!expert) return base;
  return { ...base, capability: s.capability, difficulty: s.difficulty, deps: s.deps || [], instructions: s.instructions, provider: s.provider, model: s.model, agentName: s.agentName, score: s.score, estCost: s.estCost };
}

export function present(walk, experience) {
  const expert = experience === "expert";
  const type = typeById(walk.type);
  return {
    id: walk.id,
    type: walk.type,
    typeName: type?.name || walk.type,
    example: false,
    readonly: false,
    label: null,
    experience: expert ? "expert" : "simple",
    modeLabel: expert ? "Expert" : "Simple",
    stage: walk.stage,
    status: walk.status || "ready",
    stages: STAGES.map((id) => ({ id, label: labelsFor(expert ? "expert" : "simple")[id] })),
    idea: walk.idea || "",
    answers: walk.answers || {},
    questions: type?.questions || [],
    plan: walk.plan ? {
      title: walk.plan.title,
      assembly: expert ? walk.plan.assembly : undefined,
      source: walk.plan.source,
      councilId: expert ? walk.plan.councilId || null : undefined,
      steps: (walk.plan.steps || []).map((s) => publicStep(s, expert)),
    } : null,
    deliverable: walk.deliverable || "",
    revisions: (walk.revisions || []).map((r) => ({ note: r.note, at: r.at })),
    nextSteps: walk.stage === "done" || walk.stage === "review" ? (type?.nextSteps || []) : [],
    projectId: walk.projectId || null,
    projectNote: walk.projectNote || "",
    error: walk.error || null,
    updatedAt: walk.updatedAt || walk.createdAt || null,
  };
}

export function formatAnswers(type, answers) {
  return (type?.questions || []).map((q) => `${q.label}: ${answers?.[q.key] || "(not given)"}`).join("\n");
}

export function missingAnswers(type, answers) {
  return (type?.questions || []).filter((q) => q.required && !clip(answers?.[q.key], 2000)).map((q) => q.key);
}

export function exportMarkdown(view) {
  const lines = [];
  if (view.example) lines.push("EXAMPLE DATA. This is a sample project with made-up details. Nothing was sent and no AI was called.", "");
  lines.push(`# ${view.plan?.title || view.typeName || "Project"}`, "", `Type: ${view.typeName}`, "");
  if (view.idea) lines.push("## Idea", "", view.idea, "");
  const answered = (view.questions || []).filter((q) => view.answers?.[q.key]);
  if (answered.length) {
    lines.push("## Answers", "");
    for (const q of answered) lines.push(`- ${q.label}: ${view.answers[q.key]}`);
    lines.push("");
  }
  if (view.plan?.steps?.length) {
    lines.push("## Plan", "");
    for (const s of view.plan.steps) {
      lines.push(`### ${s.title}`, "", s.output || s.deliverable || "", "");
    }
  }
  if (view.deliverable) lines.push("## Deliverable", "", view.deliverable, "");
  if (view.nextSteps?.length) {
    lines.push("## Next steps", "");
    for (const n of view.nextSteps) lines.push(`- ${n}`);
    lines.push("");
  }
  lines.push("Made in Meldmind. Not sent anywhere.");
  return lines.join("\n");
}

export function slugTitle(title) {
  const s = String(title || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return s || "project";
}

// Pre-recorded playback for the live view and the flow map. No ledger line, no provider call.
export function exampleEvents(script) {
  const id = `ex-${script.type}`;
  const tasks = (script.plan?.steps || []).map((s) => ({
    id: s.id, title: s.title, status: "queued", provider: s.provider, model: s.model, agentName: s.agentName,
  }));
  const events = [{
    type: "mission.update",
    example: true,
    mission: { id, kind: "mission", title: `Example data: ${script.plan.title}`, projectId: null, status: "running", cost: 0, tasks },
  }];
  for (const s of script.plan?.steps || []) {
    const task = { id: s.id, title: s.title, status: "running", provider: s.provider, model: s.model, agentName: s.agentName };
    events.push({ type: "task.update", example: true, missionId: id, task });
    events.push({
      type: "agent.start", example: true, missionId: id, agent: `${id}:${s.id}`, provider: s.provider, model: s.model || "example",
      role: "answer", taskId: s.id, label: `Example: ${s.title}`,
    });
    events.push({
      type: "agent.done", example: true, missionId: id, agent: `${id}:${s.id}`, provider: s.provider, model: s.model || "example",
      taskId: s.id, ms: 400, cost: 0,
    });
  }
  events.push({
    type: "mission.update",
    example: true,
    mission: {
      id, kind: "mission", title: `Example data: ${script.plan.title}`, projectId: null, status: "done", cost: 0,
      tasks: tasks.map((t) => ({ ...t, status: "done" })),
    },
  });
  return events;
}
