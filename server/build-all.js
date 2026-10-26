// Build it all for me. One switch on Start a project, the guided builders and Remix
// runs idea, questions, plan, build and test without stopping between them.
// It reuses the Get it done rules (server/getdone.js): it still stops to spend
// money, to permanently delete, and to post or send publicly. Posting can be let
// through by a second switch, "Also allow posting", which is off by default.
// The choice is remembered per person (doc buildall.prefs). Off by default.
import crypto from "node:crypto";
import { AUTO_LINE, SEND_LINE } from "./getdone.js";

export const PREF_DOC = "buildall.prefs";
export const SAVED_JOBS_DOC = "buildall.saved";
export const DEFAULT_PREFS = Object.freeze({ on: false, allowPost: false });
export const SURFACES = ["start", "builder", "webbuilder", "remix"];
export const STEP_LABELS = {
  idea: "Idea",
  questions: "Questions",
  plan: "Plan",
  build: "Build",
  test: "Test",
  publish: "Publish",
};

export const FLOW_STEP_LABELS = {
  simple: {
    idea: "Creative",
    questions: "Planning",
    plan: "AI Movement",
    build: "Build",
    test: "Testing and Tweaks",
    publish: "Finish",
  },
  expert: {
    idea: "Creative",
    questions: "Planning",
    plan: "AI Movement",
    build: "Build Mode",
    test: "Testing & Tweaks",
    publish: "Finished Project",
  },
};

export const STEP_ALIASES = Object.freeze({
  idea: "idea",
  creative: "idea",
  describe: "idea",
  questions: "questions",
  planning: "questions",
  plan: "plan",
  "ai-movement": "plan",
  movement: "plan",
  build: "build",
  "build-mode": "build",
  test: "test",
  review: "test",
  testing: "test",
  "testing-and-tweaks": "test",
  "testing-tweaks": "test",
  publish: "publish",
  done: "publish",
  finish: "publish",
  "finished-project": "publish",
});

export function resolveStepId(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (STEP_ALIASES[raw]) return STEP_ALIASES[raw];
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return STEP_ALIASES[slug] || raw;
}

// What makes the run stop and wait for the person. Same three as Get it done.
export const STOP_REASON = {
  spend: "This step spends money. Build it all for me stops here so you can decide.",
  delete: "This step deletes something for good. Build it all for me stops here so you can decide.",
  post: "This step posts or sends in public. Build it all for me stops here. Turn on Also allow posting to let it through next time.",
  needs: "This step needs you.",
};

export function normalizePrefs(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return { on: r.on === true, allowPost: r.allowPost === true };
}

export function loadPrefs(docFn) {
  try { return normalizePrefs(docFn(PREF_DOC, () => ({ ...DEFAULT_PREFS }))); }
  catch { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(docFn, putDocFn, patch = {}) {
  const cur = loadPrefs(docFn);
  const next = normalizePrefs({
    on: patch.on === undefined ? cur.on : patch.on === true,
    allowPost: patch.allowPost === undefined ? cur.allowPost : patch.allowPost === true,
  });
  putDocFn(PREF_DOC, next);
  return next;
}

// The permission line a run carries, the same words Get it done uses.
export function permissionLine({ allowPost } = {}) {
  return allowPost ? SEND_LINE : AUTO_LINE;
}

// Words that mean a step would spend, delete for good, or post. A step can also
// say so itself with risk: "spend" | "delete" | "post".
const SPEND_WORDS = /\b(?:charge|pay(?:ment)?|purchase|buy|checkout|subscribe to a paid|top[- ]?up)\b/i;
const DELETE_WORDS = /\b(?:delete (?:it )?(?:for good|permanently)|permanent(?:ly)? delete|erase|wipe|empty (?:the )?trash)\b/i;
const POST_WORDS = /\b(?:publish|post (?:it|this|to)|send (?:it|this|to|the)|go live|deploy)\b/i;

export function riskOf(step) {
  if (!step) return null;
  // "none": the step decides at run time and returns { stop } itself.
  if (step.risk === "none") return null;
  if (["spend", "delete", "post", "needs"].includes(step.risk)) return step.risk;
  const text = `${step.label || ""} ${step.text || ""}`;
  if (SPEND_WORDS.test(text)) return "spend";
  if (DELETE_WORDS.test(text)) return "delete";
  if (POST_WORDS.test(text)) return "post";
  return null;
}

// null when the step may run. Otherwise why it waits.
export function mustStop(step, { allowPost = false } = {}) {
  const risk = riskOf(step);
  if (!risk) return null;
  if (risk === "post" && allowPost) return null;
  return { kind: risk, reason: step.why || STOP_REASON[risk] };
}

// ---- questions ----
const STOP = new Set("what which who whom when where why how your you does do the and for with this that should need needs from into have is are can a an of to in on at it be any".split(" "));

// Sensible defaults by common question key. They never invent facts: each one is
// a choice the person can change, and the assumed list names it.
export const DEFAULTS_BY_KEY = {
  audience: "People who would want this, based on the idea",
  action: "Get in touch",
  pages: "Home, About, Contact",
  proof: "None yet. Leave facts as [ASK].",
  tone: "Friendly and plain",
  style: "Clean and simple",
  mood: "Matches the idea",
  length: "Short",
  budget: "Free tools only. No money is spent.",
  deadline: "No fixed date",
  timeline: "No fixed date",
  platform: "Instagram",
  platforms: "Instagram",
  goal: "The idea above",
  goals: "The idea above",
  name: "My project",
  offer: "The idea above",
  channels: "Email and social posts",
  users: "People who would want this, based on the idea",
};
export const GENERIC_DEFAULT = "Best guess from the idea. Check this. [ASK]";

function words(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}
function cues(q) {
  const set = new Set();
  for (const w of [...words(q.key), ...words(q.label)]) if (w.length > 3 && !STOP.has(w)) set.add(w.replace(/s$/, ""));
  return [...set];
}
function sentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Find a sentence in the description that speaks to this question.
export function answerFromDescription(q, description) {
  const list = sentences(description);
  if (!list.length) return "";
  const keys = cues(q);
  if (!keys.length) return "";
  let best = "";
  let score = 0;
  for (const s of list) {
    const ws = new Set(words(s).map((w) => w.replace(/s$/, "")));
    const hit = keys.filter((k) => ws.has(k)).length;
    if (hit > score) { score = hit; best = s; }
  }
  return score > 0 ? best.slice(0, 400) : "";
}

// Fill every question. Given answers win. Then the description. Then a default.
// A required question that only got a default is listed as assumed.
// Optional questions that got a default are listed too, marked optional.
export function fillAnswers(questions, description, given = {}) {
  const answers = {};
  const assumed = [];
  const fromDescription = [];
  for (const q of questions || []) {
    if (!q?.key) continue;
    const typed = String(given?.[q.key] ?? "").trim();
    if (typed) { answers[q.key] = typed.slice(0, 2000); continue; }
    const found = answerFromDescription(q, description);
    if (found) {
      answers[q.key] = found;
      fromDescription.push({ key: q.key, label: q.label || q.key, value: found });
      continue;
    }
    const value = q.default || DEFAULTS_BY_KEY[q.key] || GENERIC_DEFAULT;
    answers[q.key] = value;
    assumed.push({ key: q.key, label: q.label || q.key, value, required: !!q.required });
  }
  return { answers, assumed, fromDescription };
}

// ---- jobs ----
const jobs = new Map();
const JOB_MAX = 40;

function newId() {
  return "ba-" + crypto.randomBytes(6).toString("base64url");
}

export function createJob({ surface, title, steps, allowPost = false, owner = null, flowStages = false, experience = "simple" } = {}) {
  const id = newId();
  const labelMap = flowStages ? (FLOW_STEP_LABELS[experience === "expert" ? "expert" : "simple"] || STEP_LABELS) : STEP_LABELS;
  const job = {
    id,
    surface: SURFACES.includes(surface) ? surface : "start",
    title: String(title || "Build it all for me").slice(0, 120),
    status: "running",
    allowPost: allowPost === true,
    permission: permissionLine({ allowPost }),
    steps: (steps || []).map((s) => {
      const canonical = resolveStepId(s.id) || s.id;
      return {
        id: s.id,
        label: s.label || labelMap[canonical] || STEP_LABELS[canonical] || s.id,
        status: s.status || "queued",
        note: s.note || "",
      };
    }),
    current: null,
    waiting: null,
    assumed: [],
    result: null,
    error: null,
    stopRequested: false,
    pauseRequested: false,
    paused: false,
    savedAt: null,
    flowStages: !!flowStages,
    savedResults: {},
    _steps: null,
    owner,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(id, job);
  if (jobs.size > JOB_MAX) {
    const oldest = [...jobs.values()].filter((j) => j.status !== "running").sort((a, b) => a.startedAt - b.startedAt)[0];
    if (oldest) jobs.delete(oldest.id);
  }
  return job;
}

export function getJob(id) {
  return jobs.get(String(id || "")) || null;
}

export function listJobs(owner = null) {
  return [...jobs.values()].filter((j) => owner === null || j.owner === owner).sort((a, b) => b.startedAt - a.startedAt).map(publicJob);
}

export function stopJob(id) {
  const job = getJob(id);
  if (!job) return null;
  job.stopRequested = true;
  job.pauseRequested = false;
  job.paused = false;
  if (job.status === "running" || job.status === "paused") {
    for (const s of job.steps) if (s.status === "queued" || s.status === "paused") s.status = "skipped";
    if (job.status === "paused") {
      job.status = "stopped";
      job.current = null;
      job.finishedAt = Date.now();
    }
  }
  return job;
}

export function pauseJob(id) {
  const job = getJob(id);
  if (!job) return null;
  job.pauseRequested = true;
  job.paused = true;
  if (job.status === "waiting") {
    job.status = "paused";
  }
  return job;
}

export async function resumeJob(id, { steps, onProgress = () => {} } = {}) {
  const job = getJob(id);
  if (!job) return null;
  if (job.status === "done" || job.status === "stopped") return publicJob(job);
  const runList = steps || job._steps || [];
  job.pauseRequested = false;
  job.paused = false;
  job.stopRequested = false;
  job.waiting = null;
  job.error = null;
  job.status = "running";
  job.finishedAt = null;
  for (const s of job.steps) {
    if (s.status === "paused" || s.status === "waiting") s.status = "queued";
  }
  if (!runList.length) {
    return publicJob(job);
  }
  return runSteps(job, runList, { onProgress, resume: true });
}

export function saveJob(docFn, putDocFn, jobOrId) {
  const job = typeof jobOrId === "string" ? getJob(jobOrId) : jobOrId;
  if (!job) return null;
  job.savedAt = Date.now();
  const snap = publicJob(job);
  try {
    if (typeof docFn === "function" && typeof putDocFn === "function") {
      const store = docFn(SAVED_JOBS_DOC, () => ({ items: [] }));
      if (!Array.isArray(store.items)) store.items = [];
      const idx = store.items.findIndex((x) => x.id === snap.id);
      if (idx >= 0) store.items[idx] = snap;
      else store.items.unshift(snap);
      store.items = store.items.slice(0, 40);
      putDocFn(SAVED_JOBS_DOC, store);
    }
  } catch { /* saving to store is optional in memory-only unit tests */ }
  return snap;
}

export function loadSavedJobs(docFn, owner = null) {
  try {
    const store = docFn(SAVED_JOBS_DOC, () => ({ items: [] }));
    const list = Array.isArray(store?.items) ? store.items : [];
    return list.filter((j) => owner === null || !j.owner || j.owner === owner);
  } catch {
    return [];
  }
}

export function publicJob(job) {
  if (!job) return null;
  const out = {
    id: job.id,
    surface: job.surface,
    title: job.title,
    status: job.status,
    allowPost: job.allowPost,
    permission: job.permission,
    steps: job.steps.map((s) => ({ ...s })),
    current: job.current,
    waiting: job.waiting,
    assumed: job.assumed.slice(),
    result: job.result,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
  if (job.paused || job.pauseRequested || job.status === "paused" || job.savedAt || job.flowStages) {
    out.paused = !!(job.paused || job.status === "paused");
    out.savedAt = job.savedAt || null;
  }
  return out;
}

// The runner. steps = [{ id, label, risk?, why?, run(ctx) }]. Each run gets
// { job, results, stopped() } and returns a value, or { stop: { kind, reason } }
// when it finds out mid-step that it has to wait (a post, a needed tick).
// It never asks between ordinary steps. Stop ends it before the next step and
// is checked again by long steps through ctx.stopped().
// Pause cleanly suspends the job before the next step so resumeJob() can continue.
export async function runSteps(job, steps, { onProgress = () => {}, resume = false } = {}) {
  job._steps = steps;
  const results = resume && job.savedResults ? { ...job.savedResults } : {};
  job.savedResults = results;
  const tell = () => { try { onProgress(publicJob(job)); } catch { /* progress is optional */ } };
  const finish = (status) => {
    job.status = status;
    job.current = null;
    job.finishedAt = status === "paused" ? null : Date.now();
    tell();
    return publicJob(job);
  };
  tell();
  for (const step of steps) {
    const row = job.steps.find((s) => s.id === step.id);
    if (resume && row && (row.status === "done" || row.status === "skipped")) {
      continue;
    }
    if (job.stopRequested) {
      for (const s of job.steps) if (s.status === "queued") s.status = "skipped";
      return finish("stopped");
    }
    if (job.pauseRequested) {
      job.paused = true;
      if (row && row.status === "running") row.status = "queued";
      return finish("paused");
    }
    const wait = mustStop(step, { allowPost: job.allowPost });
    if (wait) {
      if (row) { row.status = "waiting"; row.note = wait.reason; }
      job.waiting = { step: step.id, kind: wait.kind, reason: wait.reason };
      return finish("waiting");
    }
    job.current = step.id;
    if (row) row.status = "running";
    tell();
    let out;
    try {
      out = await step.run({ job, results, stopped: () => job.stopRequested === true || job.pauseRequested === true });
    } catch (e) {
      if (row) { row.status = "failed"; row.note = String(e?.message || "This step did not finish.").slice(0, 300); }
      job.error = row?.note || "This step did not finish.";
      return finish("failed");
    }
    if (out && out.stop) {
      const kind = out.stop.kind || "needs";
      if (row) { row.status = "waiting"; row.note = out.stop.reason || STOP_REASON[kind] || STOP_REASON.needs; }
      job.waiting = { step: step.id, kind, reason: row?.note || STOP_REASON.needs };
      return finish("waiting");
    }
    if (job.stopRequested && !(out && out.done)) {
      if (row) { row.status = "stopped"; row.note = "Stopped by you."; }
      for (const s of job.steps) if (s.status === "queued") s.status = "skipped";
      return finish("stopped");
    }
    if (job.pauseRequested && !(out && out.done)) {
      job.paused = true;
      if (out !== undefined) {
        results[step.id] = out;
        job.savedResults = results;
        if (row) { row.status = out && out.skipped ? "skipped" : "done"; row.note = String(out?.note || "").slice(0, 300); }
      } else if (row) {
        row.status = "paused";
        row.note = "Paused by you.";
      }
      return finish("paused");
    }
    results[step.id] = out;
    job.savedResults = results;
    if (row) { row.status = out && out.skipped ? "skipped" : "done"; row.note = String(out?.note || "").slice(0, 300); }
    tell();
    if (job.pauseRequested) {
      job.paused = true;
      return finish("paused");
    }
  }
  job.result = results[steps[steps.length - 1]?.id] ?? null;
  return finish("done");
}

// A short wait that is real time, for polling a step that runs in the background.
export function pause(ms) {
  return new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });
}

// Poll until done(value) is true, the person stops, or the deadline passes.
export async function waitFor(read, done, { stopped = () => false, every = 300, limitMs = 10 * 60 * 1000 } = {}) {
  const until = Date.now() + limitMs;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (stopped()) return v;
    if (Date.now() > until) throw new Error("This step took too long. Nothing was sent.");
    await pause(every);
  }
}
