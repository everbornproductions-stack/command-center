// Build it all for me. One switch on Start a project, the guided builders and Remix
// runs idea, questions, plan, build and test without stopping between them.
// It reuses the Get it done rules (server/getdone.js): it still stops to spend
// money, to permanently delete, and to post or send publicly. Posting can be let
// through by a second switch, "Also allow posting", which is off by default.
// The choice is remembered per person (doc buildall.prefs). Off by default.
import crypto from "node:crypto";
import { AUTO_LINE, SEND_LINE } from "./getdone.js";

export const PREF_DOC = "buildall.prefs";
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

export function createJob({ surface, title, steps, allowPost = false, owner = null } = {}) {
  const id = newId();
  const job = {
    id,
    surface: SURFACES.includes(surface) ? surface : "start",
    title: String(title || "Build it all for me").slice(0, 120),
    status: "running",
    allowPost: allowPost === true,
    permission: permissionLine({ allowPost }),
    steps: (steps || []).map((s) => ({ id: s.id, label: s.label || STEP_LABELS[s.id] || s.id, status: "queued", note: "" })),
    current: null,
    waiting: null,
    assumed: [],
    result: null,
    error: null,
    stopRequested: false,
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
  if (job.status === "running") {
    for (const s of job.steps) if (s.status === "queued") s.status = "skipped";
  }
  return job;
}

export function publicJob(job) {
  if (!job) return null;
  return {
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
}

// The runner. steps = [{ id, label, risk?, why?, run(ctx) }]. Each run gets
// { job, results, stopped() } and returns a value, or { stop: { kind, reason } }
// when it finds out mid-step that it has to wait (a post, a needed tick).
// It never asks between ordinary steps. Stop ends it before the next step and
// is checked again by long steps through ctx.stopped().
export async function runSteps(job, steps, { onProgress = () => {} } = {}) {
  const results = {};
  const tell = () => { try { onProgress(publicJob(job)); } catch { /* progress is optional */ } };
  const finish = (status) => {
    job.status = status;
    job.current = null;
    job.finishedAt = Date.now();
    tell();
    return publicJob(job);
  };
  tell();
  for (const step of steps) {
    const row = job.steps.find((s) => s.id === step.id);
    if (job.stopRequested) {
      for (const s of job.steps) if (s.status === "queued") s.status = "skipped";
      return finish("stopped");
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
      out = await step.run({ job, results, stopped: () => job.stopRequested === true });
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
    results[step.id] = out;
    if (row) { row.status = out && out.skipped ? "skipped" : "done"; row.note = String(out?.note || "").slice(0, 300); }
    tell();
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
