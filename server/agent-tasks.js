// 0.4.39 (Chris: agents as a team): "if someone selects an agent what happens? In the agent area shouldn't there be a
// way to see what agent is doing what for them and handling things they have assigned?" Each agent on the Team page
// has a desk, and the desk holds tasks. A task is a normal run (the same path as Use: smart fallback, the ledger and
// the spend caps) tagged with the agent, plus this small record in the person's own data (store.js documents, never
// the repo).
//
// Fields: id, agentId, agentName, title, text, status, runId, createdAt, updatedAt, approvedAt, outcome, and a few
// extras for the desk (source, projectId, startAt, step, ai, cost, error, preview, needsOk, scheduleRunId, round).
// Status: waiting (Waiting to start) -> working -> review (Ready for your OK) or done; failed; dismissed.
// A finished task waits for the person's OK when its result would be sent or posted somewhere. Approve only copies
// or saves: nothing here sends, posts or buys anything (house rule and docs/DECISIONS.md).
// Title, text and preview go through the secret and private-number filters before they are kept.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { redact } from "./redact-text.js";
import { maskPrivate } from "./mask-private.js";

export const DOC = "agents.tasks";
export const TEAM_DOC = "agents.team";
export const STATUSES = ["waiting", "working", "review", "done", "failed", "dismissed"];
export const STATUS_LABEL = { waiting: "Waiting to start", working: "Working", review: "Ready for your OK", done: "Done", failed: "Failed", dismissed: "Dismissed" };
export const OPEN = new Set(["waiting", "working", "review", "failed"]);
export const OUTCOMES = ["approved", "copied", "saved", "done", "dismissed", "cancelled"];
export const OUTCOME_LABEL = { approved: "Approved", copied: "Approved and copied", saved: "Approved, saved to MindMedia", done: "Finished, kept in MindMedia", dismissed: "Dismissed", cancelled: "Cancelled" };
export const SOURCES = ["desk", "use", "duty", "chat", "project"];
export const LIMITS = { tasks: 300, title: 120, text: 20000, preview: 400, step: 120, error: 300 };
export const DEFAULT_CAP = 0.25;
export const MAX_CAP = 50;

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const now = () => Date.now();
const clean = (v, max) => maskPrivate(redact(String(v ?? "").replace(/\r\n/g, "\n").trim(), max * 2)).slice(0, max);
const oneLine = (v, max) => clean(String(v ?? "").replace(/\s+/g, " "), max);
const newId = () => `tk-${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;

function tasksDoc() {
  const d = doc(DOC, () => ({ list: [] }));
  if (!Array.isArray(d.list)) d.list = [];
  return d;
}
function save(d) {
  // the newest first; old finished tasks fall off the end, open ones are kept
  if (d.list.length > LIMITS.tasks) {
    const open = d.list.filter((t) => OPEN.has(t.status));
    const rest = d.list.filter((t) => !OPEN.has(t.status)).slice(0, Math.max(0, LIMITS.tasks - open.length));
    const keep = new Set([...open, ...rest].map((t) => t.id));
    d.list = d.list.filter((t) => keep.has(t.id));
  }
  putDoc(DOC, d);
}

// A short title from the request: its first line, cut on a word.
export function titleFrom(text) {
  const first = String(text || "").replace(/\r\n/g, "\n").split("\n").map((s) => s.trim()).find(Boolean) || "A task";
  if (first.length <= 70) return first;
  const cut = first.slice(0, 70);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, "")}...`;
}

// Would this result be sent or posted somewhere? Then it waits for the person's OK. An employee says so by its kinds
// (email, post, page); anyone else by the words of the job.
const SEND_KINDS = new Set(["email", "post", "page"]);
const SEND_WORDS = /\b(post|posts|posting|caption|captions|tweet|tweets|email|emails|e-mail|reply|replies|respond|response to|send|sends|message|messages|text message|dm|dms|newsletter|publish|announcement|invite|invitation|follow[\s-]?up|outreach|review responses?)\b/i;
export function wouldSend({ kinds = [], text = "", title = "" } = {}) {
  if ((kinds || []).some((k) => SEND_KINDS.has(k))) return true;
  return SEND_WORDS.test(`${title} ${text}`);
}

export const publicTask = (t) => t && ({ ...t, statusLabel: STATUS_LABEL[t.status] || t.status, outcomeLabel: t.outcome ? OUTCOME_LABEL[t.outcome] || t.outcome : "" });

export function listTasks({ agentId, limit = 200 } = {}) {
  const list = tasksDoc().list.filter((t) => !agentId || t.agentId === agentId);
  return list.slice(0, Math.max(1, Math.min(LIMITS.tasks, limit))).map(publicTask);
}
export const getTask = (id) => tasksDoc().list.find((t) => t.id === id) || null;
export const findByRun = (runId) => (runId ? tasksDoc().list.find((t) => t.runId === runId) || null : null);
export const findByScheduleRun = (id) => (id ? tasksDoc().list.find((t) => t.scheduleRunId === id) || null : null);

export function createTask(input = {}) {
  const agentId = String(input.agentId || "").slice(0, 80);
  if (!agentId) throw err(400, "Pick the agent for this task.");
  const text = clean(input.text, LIMITS.text);
  if (!text) throw err(400, "Say what the agent should do.");
  const title = oneLine(input.title || titleFrom(text), LIMITS.title) || "A task";
  const t = {
    id: newId(), agentId, agentName: oneLine(input.agentName || agentId, 80), title, text,
    status: STATUSES.includes(input.status) ? input.status : "waiting", runId: input.runId ? String(input.runId).slice(0, 80) : null,
    createdAt: now(), updatedAt: now(), approvedAt: null, outcome: null,
    source: SOURCES.includes(input.source) ? input.source : "desk", projectId: typeof input.projectId === "string" && input.projectId ? input.projectId.slice(0, 120) : null,
    startAt: Number.isFinite(Number(input.startAt)) && Number(input.startAt) > now() ? Number(input.startAt) : null,
    step: "", ai: "", cost: 0, error: null, preview: "", needsOk: !!input.needsOk, round: 1,
    scheduleRunId: input.scheduleRunId ? String(input.scheduleRunId).slice(0, 80) : null, scheduleId: input.scheduleId ? String(input.scheduleId).slice(0, 80) : null,
    finishedAt: null,
  };
  const d = tasksDoc();
  d.list.unshift(t);
  save(d);
  return t;
}

// Only these fields can change after a task is made; text fields are cleaned the same way.
const PATCHABLE = ["title", "text", "status", "runId", "approvedAt", "outcome", "startAt", "step", "ai", "cost", "error", "preview", "needsOk", "round", "finishedAt", "projectId"];
export function updateTask(id, patch = {}) {
  const d = tasksDoc();
  const t = d.list.find((x) => x.id === id);
  if (!t) throw err(404, "No such task.");
  for (const k of PATCHABLE) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === "title") v = oneLine(v, LIMITS.title) || t.title;
    else if (k === "text") { v = clean(v, LIMITS.text); if (!v) throw err(400, "Say what the agent should do."); }
    else if (k === "preview") v = clean(v, LIMITS.preview);
    else if (k === "step") v = oneLine(v, LIMITS.step);
    else if (k === "error") v = v ? oneLine(v, LIMITS.error) : null;
    else if (k === "ai") v = oneLine(v, 60);
    else if (k === "status" && !STATUSES.includes(v)) continue;
    else if (k === "outcome" && v !== null && !OUTCOMES.includes(v)) continue;
    else if (k === "cost") v = +(Number(v) || 0).toFixed(6);
    t[k] = v;
  }
  t.updatedAt = now();
  save(d);
  return t;
}

// Waiting tasks whose start time has come (the plugin's timer starts them).
export const dueTasks = (at = now()) => tasksDoc().list.filter((t) => t.status === "waiting" && t.startAt && t.startAt <= at && !t.runId);

// Counts for the strip at the top of the Team page and the badge on each agent.
const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
export function countsFor(list, at = now()) {
  const c = { working: 0, review: 0, waiting: 0, failed: 0, doneToday: 0 };
  for (const t of list) {
    if (t.status === "working") c.working++;
    else if (t.status === "review") c.review++;
    else if (t.status === "waiting") c.waiting++;
    else if (t.status === "failed") c.failed++;
    else if (t.status === "done" && sameDay(t.finishedAt || t.updatedAt, at)) c.doneToday++;
  }
  return c;
}
// The agent's one status word on the team list: Needs your OK wins, then Working, then Done (today), else Free.
export function agentStatus(c) {
  if (c.review) return { status: "review", label: c.review === 1 ? "1 needs OK" : `${c.review} need OK` };
  if (c.working) return { status: "working", label: "Working" };
  if (c.doneToday) return { status: "done", label: "Done" };
  return { status: "free", label: "Free" };
}

// ---------- the person's settings per agent (the spending cap per task) ----------
function teamDoc() {
  const d = doc(TEAM_DOC, () => ({ caps: {} }));
  if (!d.caps || typeof d.caps !== "object") d.caps = {};
  return d;
}
export const capFor = (agentId) => { const v = Number(teamDoc().caps[agentId]); return v > 0 ? v : DEFAULT_CAP; };
export function setCap(agentId, usd) {
  const v = +Number(usd).toFixed(2);
  if (!Number.isFinite(v) || v <= 0 || v > MAX_CAP) throw err(400, `Set a cap per task above $0 and up to $${MAX_CAP}.`);
  const d = teamDoc();
  d.caps[String(agentId).slice(0, 80)] = v;
  putDoc(TEAM_DOC, d);
  return { agentId, cap: v };
}

// ---------- duties: plain choices to a cron line ----------
// every: "day" | "week" (day 0-6, Sunday is 0) | "month" (date 1-28); time "HH:MM" (24 hour)
export function dutyCron({ every, day, time } = {}) {
  const m = String(time || "09:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw err(400, "Pick a time, for example 09:00.");
  const hh = Number(m[1]), mm = Number(m[2]);
  if (every === "day") return `${mm} ${hh} * * *`;
  if (every === "week") {
    const d = Number(day);
    if (!Number.isInteger(d) || d < 0 || d > 6) throw err(400, "Pick a day of the week.");
    return `${mm} ${hh} * * ${d}`;
  }
  if (every === "month") {
    const d = Number(day);
    if (!Number.isInteger(d) || d < 1 || d > 28) throw err(400, "Pick a date from 1 to 28.");
    return `${mm} ${hh} ${d} * *`;
  }
  throw err(400, "Pick how often: every day, every week or every month.");
}
