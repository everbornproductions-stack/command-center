// 0.4.39 (Chris: agents as a team): who is on the team, and how a run moves a task on its desk.
//  - The team: the AI employees on the team (server/employees.js), My agents (server/custom-agents.js) and the outside
//    agents Meldmind already knows (Grok Bot, the browser helper; server/agents.js). One id each: "emp-<id>" for an
//    employee (the same id its runs carry), the agent id for My agents, "grokbot" / "browser-helper" for outside ones.
//  - A run tagged with a task (Assign, Use, a duty) moves the task on the live events the app already sends:
//    mission.update and agent.start for a chat run, schedules.run for a duty, external.handoff for an outside agent.
//    Each change goes out as "team.task", and the Live feed gets "<agent> started / finished <task>".
//  - Finished: Ready for your OK when the result would be sent or posted somewhere, otherwise Done. Nothing here sends.
import { emit } from "./events.js";
import { PROVIDERS } from "./registry.js";
import * as T from "./agent-tasks.js";
import * as E from "./employees.js";
import * as A from "./custom-agents.js";
import * as GB from "./grokbot.js";
import * as BH from "./browser.js";
import { demosHidden, visibleCustomAgents } from "./demo-visibility.js";

const EMP = "emp-";
const CAT_ICON = { "Front desk and support": "☎️", Sales: "💼", Marketing: "📣", "Content and creators": "✍️", Operations: "⚙️", Money: "📊", Hiring: "🤝", "Small business": "🏪", "Legal basics": "⚖️", Research: "🔍", "Coding and tech": "💻" };
const CAT_TINT = { "Front desk and support": "#e8f0fe", Sales: "#fff4e0", Marketing: "#fde8f1", "Content and creators": "#fde8f1", Operations: "#eef2f6", Money: "#e6f4ea", Hiring: "#f1eefb", "Small business": "#fff4e0", "Legal basics": "#eef2f6", Research: "#e8f0fe", "Coding and tech": "#e6f4ea" };
const NEVER_SENDS = "Never posts or sends: everything waits for your OK";

const providerName = (id) => PROVIDERS[id]?.name || (id ? String(id) : "");
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

// ---------- the team ----------
function employeeRow(e) {
  return { id: `${EMP}${e.id}`, kind: "employee", name: e.name, role: e.oneLiner, icon: CAT_ICON[e.category] || "🤖", tint: CAT_TINT[e.category] || "#eef2f6", kinds: e.kinds || [], job: e.oneLiner, starters: e.starters || [], canDuty: true, ready: true, readyNote: "", employeeId: e.id, category: e.category };
}
function customRow(a) {
  const job = String(a.description || a.instructions || "").replace(/\s+/g, " ").trim();
  return { id: a.id, kind: "custom", name: a.name, role: a.description ? a.description : "Your own agent", icon: "🧩", tint: "#f1eefb", kinds: [], job: job.length > 220 ? `${job.slice(0, 217)}...` : job, starters: a.starters || [], canDuty: true, ready: true, readyNote: "", noSend: a.noSend === true, model: a.modelName || "" };
}
function outsideRows() {
  const g = safe(() => GB.readiness(), { ready: false, detail: "not set up" });
  const b = safe(() => BH.readiness(), { ready: false, detail: "not set up" });
  return [
    { id: GB.AGENT_ID, kind: "outside", name: GB.NAME, role: "Outside agent: Gmail, Drive, signed-in browsing", icon: "🤖", tint: "#eef2f6", kinds: [], job: "Does signed-in work for you, such as Gmail, Google Drive and websites you are signed in to. Meldmind hands it a task and waits for the result.", starters: [], canDuty: false, ready: !!g.ready, readyNote: g.ready ? "" : `Grok Bot is ${g.detail}.` },
    { id: BH.AGENT_ID, kind: "outside", name: BH.NAME, role: "Outside agent: reads web pages for you", icon: "🌐", tint: "#e8f0fe", kinds: [], job: "Opens web pages in its own window and reads them for you. It asks for your OK before any send, post, delete or purchase.", starters: [], canDuty: false, ready: !!b.ready, readyNote: b.ready ? "" : `The browser helper is ${b.detail}.` },
  ];
}
export function teamAgents() {
  const emps = safe(() => E.teamList(), []).map((v) => E.getEmployee(v.id)).filter(Boolean).map(employeeRow);
  const mine = safe(() => visibleCustomAgents(A.listAgents(), { hidden: demosHidden() }), []).map(customRow);
  return [...emps, ...mine, ...outsideRows()];
}
// Any agent the person can give a task to, on the team or not (an employee from the library joins when used).
export function agentInfo(id) {
  const s = String(id || "");
  if (s.startsWith(EMP)) { const e = E.getEmployee(s.slice(EMP.length)); return e ? employeeRow(e) : null; }
  if (s === GB.AGENT_ID || s === BH.AGENT_ID) return outsideRows().find((r) => r.id === s);
  const a = A.getAgent(s);
  return a ? customRow(A.agentView(a)) : null;
}
export const isOutside = (id) => id === GB.AGENT_ID || id === BH.AGENT_ID;

// What runChat needs for one run of this agent (the same options as Use / Run).
export function runOptionsFor(id, { prompt, projectId = null } = {}) {
  const s = String(id || "");
  if (s.startsWith(EMP)) return E.employeeRunOptions(s.slice(EMP.length), { prompt, projectId });
  const a = A.getAgent(s);
  if (!a) throw Object.assign(new Error("That agent is not on your team any more."), { status: 404 });
  return A.runOptions(a, { prompt, projectId });
}
// The outside agent's own hand-off (a click: the person pressed Assign).
export async function dispatchOutside(id, { text, taskId, projectId }) {
  const M = id === GB.AGENT_ID ? GB : BH;
  return M.dispatch({ task: text, source: { kind: "click", taskId, projectId: projectId || null } });
}
export function outsideJob(id, jobId) {
  const M = id === GB.AGENT_ID ? GB : BH;
  return safe(() => M.publicJob(M.findJob(jobId)), null);
}
export function stopOutside(id, jobId) {
  if (id === GB.AGENT_ID) return safe(() => GB.cancelJob(jobId, "cancelled by you"), null);
  return safe(() => BH.stopJob(jobId, "stopped by you"), null);
}
export const neverSendsLine = () => NEVER_SENDS;

// ---------- moving a task ----------
// One change out to the open windows; a start or a finish also goes to the Live feed in plain words.
export function changed(t, { was } = {}) {
  if (!t) return t;
  emit("team.task", { task: T.publicTask(t) });
  if (was !== t.status) {
    if (t.status === "working" && was !== "working") emit("log", { text: `${t.agentName} started ${t.title}`, missionId: t.runId || undefined });
    else if (t.status === "review") emit("log", { text: `${t.agentName} finished ${t.title}. It is ready for your OK.`, missionId: t.runId || undefined });
    else if (t.status === "done" && (was === "working" || was === "waiting")) emit("log", { text: `${t.agentName} finished ${t.title}`, missionId: t.runId || undefined });
    else if (t.status === "failed") emit("log", { text: `${t.agentName} could not finish ${t.title}: ${t.error || "the run failed"}`, level: "error", missionId: t.runId || undefined });
  }
  return t;
}
export function update(id, patch) {
  const before = T.getTask(id);
  if (!before) return null;
  const was = before.status;
  return changed(T.updateTask(id, patch), { was });
}

// Ready for your OK or Done, from what the agent does and what was asked.
export function finishStatus(t) {
  const info = agentInfo(t.agentId);
  return T.wouldSend({ kinds: info?.kinds || [], text: t.text, title: t.title }) ? "review" : "done";
}
const doneOutcome = (status) => (status === "done" ? "done" : null);

// A run's own record (mission.update or the finished run) moves its task.
export function fromRun(m) {
  const t = T.findByRun(m?.id);
  if (!t || t.status === "dismissed" || (t.status === "done" && t.outcome && t.outcome !== "done")) return null;
  const ai = providerName(m.provider);
  if (m.status === "running") {
    if (t.status === "working" && t.ai === ai) return null;
    return update(t.id, { status: "working", ai, step: t.step || "Starting", cost: m.cost || 0, error: null });
  }
  if (m.status === "waiting") return update(t.id, { status: "working", ai, step: "Waiting for your own AI plan to answer", error: null });
  if (m.status === "done") {
    const status = finishStatus(t);
    return update(t.id, { status, ai, step: "", cost: m.cost || 0, preview: m.deliverable || "", error: null, finishedAt: Date.now(), needsOk: status === "review", outcome: doneOutcome(status) });
  }
  if (m.status === "failed" || m.status === "aborted") return update(t.id, { status: "failed", ai, step: "", cost: m.cost || 0, error: m.error || (m.status === "aborted" ? "Stopped by you." : "The run failed."), finishedAt: Date.now() });
  return null;
}
// The run could not start at all (no AI connected, a spend cap): the task says why.
export function runThrew(runId, e) {
  const t = T.findByRun(runId);
  if (!t || t.status !== "working") return null;
  return update(t.id, { status: "failed", step: "", error: e?.message || "The run could not start.", finishedAt: Date.now() });
}

// Use / Run on the Hire or My agents tab: the run becomes a task on that agent's desk.
export function trackUse({ agent, prompt, runId, projectId }) {
  if (!agent?.id || !runId || T.findByRun(runId)) return null;
  const t = T.createTask({ agentId: agent.id, agentName: agent.name, text: prompt, status: "working", runId, projectId, source: "use" });
  return changed(t, { was: "waiting" });
}

// A duty (a schedule that runs an agent) puts each run on the desk.
function fromScheduleRun(r) {
  if (!r?.id || !r.scheduleId) return null;
  let t = T.findByScheduleRun(r.id);
  if (!t) {
    const s = safe(() => SCHED?.getSchedule(r.scheduleId), null);
    if (!s || s.target?.kind !== "agent") return null;
    const info = agentInfo(s.target.agentId);
    if (!info) return null;
    const name = String(s.name || "").replace(new RegExp(`^${info.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), "") || "Duty";
    t = changed(T.createTask({ agentId: info.id, agentName: info.name, title: name, text: s.target.text || s.target.runText || name, status: "waiting", runId: `s-${r.id.slice(3)}`, projectId: s.target.projectId, source: "duty", scheduleRunId: r.id, scheduleId: s.id }), { was: "" });
  }
  if (r.status === "running") return update(t.id, { status: "working", step: t.step || "Starting" });
  if (r.status === "done") { const status = finishStatus(t); return update(t.id, { status, cost: r.cost || 0, preview: r.output || r.preview || "", finishedAt: Date.now(), needsOk: status === "review", outcome: doneOutcome(status), step: "" }); }
  if (r.status === "needs_approval") return update(t.id, { status: "review", cost: r.cost || 0, preview: r.output || r.preview || "", finishedAt: Date.now(), needsOk: true, step: "" });
  if (r.status === "failed" || r.status === "stopped") return update(t.id, { status: "failed", error: r.error || "The duty did not run.", finishedAt: Date.now(), step: "" });
  if (r.status === "rejected") return update(t.id, { status: "dismissed", outcome: "dismissed" });
  return null;
}
let SCHED = null;
export function useSchedules(mod) { SCHED = mod; }

// An outside agent's job moves its task.
function fromHandoff(ev) {
  const t = T.findByRun(ev.jobId);
  if (!t || t.status === "dismissed" || (t.status === "done" && t.outcome && t.outcome !== "done")) return null;
  const st = ev.status;
  if (st === "queued") return update(t.id, { status: "working", step: `Handed to ${t.agentName}. Waiting for it to pick up.` });
  if (st === "working") return update(t.id, { status: "working", step: `${t.agentName} is working on it` });
  if (st === "needs_approval") return update(t.id, { status: "review", step: "", needsOk: true, preview: ev.result || "" });
  if (st === "done") { const status = finishStatus(t); return update(t.id, { status, step: "", preview: ev.result || "", finishedAt: Date.now(), needsOk: status === "review", outcome: doneOutcome(status) }); }
  if (st === "failed") return update(t.id, { status: "failed", step: "", error: ev.result || "The job failed.", finishedAt: Date.now() });
  return null;
}

// Every bus event goes through here (server/plugins/team.js onEvent).
export function onEvent(ev) {
  if (!ev?.type) return;
  if (ev.type === "mission.update" && ev.mission?.kind === "single") fromRun(ev.mission);
  else if (ev.type === "agent.start" && ev.missionId) {
    const t = T.findByRun(ev.missionId);
    if (t && t.status === "working") update(t.id, { step: "Writing the answer", ai: providerName(ev.provider) });
  }
  else if (ev.type === "schedules.run" && ev.run) fromScheduleRun(ev.run);
  else if (ev.type === "external.handoff" && ev.jobId && (ev.agent === GB.AGENT_ID || ev.agent === BH.AGENT_ID)) fromHandoff(ev);
}
