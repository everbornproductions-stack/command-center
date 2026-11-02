// 0.4.39 (Chris: agents as a team): the routes behind the Team page. Each agent has a desk with the tasks it holds.
// A task is a normal run, started the same way as Use (server/plugins/agents.js start: smart fallback, the ledger,
// spend caps, kept in MindMedia), tagged with the agent and a task record (server/agent-tasks.js). The live events
// move it (server/team-runs.js). Nothing here sends, posts or buys: Approve only copies or saves.
//   GET  /api/team?projectId=                  the team with live status, counts, tasks, duties, project memory
//   GET  /api/team/tasks?agent= ; GET /api/team/tasks/<id>     tasks; one task with its full result
//   POST /api/team/assign { agentId, text, title?, startAt?, projectId?, source? }   a new task (202)
//   POST /api/team/tasks/<id> { title, text, startAt }         edit a task that is waiting to start
//   POST /api/team/tasks/<id>/approve { how: approved | copied | saved }
//   POST /api/team/tasks/<id>/changes { text }                 ask the same agent for changes (a follow-up run)
//   POST /api/team/tasks/<id>/dismiss | /cancel | /retry
//   POST /api/team/agents/<id>/cap { cap }                      the spending cap per task
//   POST /api/team/agents/<id>/duties { text, every, day, time, capUsd }   a duty: a schedule that runs this agent
import * as T from "../agent-tasks.js";
import * as R from "../team-runs.js";
import * as S from "../schedules.js";
import { start, newRunId } from "./agents.js";
import { preRunLine } from "../precost.js";
import { memoryOf, LABELS as MEMORY_LABELS, FIELDS as MEMORY_FIELDS } from "../project-memory.js";
import { saveToMindMedia, updateAssetMeta } from "../project-media.js";
import { scheduler } from "../perf/scheduler.js";

export const id = "team";
const TICK_MS = Math.max(200, Number(process.env.CC_TEAM_TICK_MS) || 20000);
const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const projectOf = (v) => (typeof v === "string" && v ? v.slice(0, 120) : null);

export function init(h) {
  R.useSchedules(S);
  if (h.HOSTED) return;
  const c = h.ctx();
  // a task set for later starts when its time comes (while the app is open, like schedules)
  scheduler.register({ id: "team-tasks", everyMs: TICK_MS, lightEveryMs: Math.max(TICK_MS * 3, 60000), pause: true, run: () => h.runAs(c, () => { for (const t of T.dueTasks()) startTask(h, t).catch(() => {}); }) });
}
export function onEvent(ev) { R.onEvent(ev); }

// ---------- starting the work ----------
function capCheck(agentId, text) {
  const cap = T.capFor(agentId);
  const est = (() => { try { return preRunLine({ prompt: text }); } catch { return { usd: null }; } })();
  if (est && est.free === false && Number(est.usd) > cap) throw err(409, `This task is estimated at about $${Number(est.usd).toFixed(2)}, over this agent's $${cap.toFixed(2)} cap per task. Raise the cap in How it works for you, or make the task smaller.`, { code: "task_cap" });
}
async function startTask(h, t, { text } = {}) {
  const info = R.agentInfo(t.agentId);
  if (!info) { R.update(t.id, { status: "failed", error: "That agent is not on your team any more." }); throw err(404, "That agent is not on your team any more."); }
  const prompt = text || t.text;
  if (R.isOutside(t.agentId)) {
    if (!info.ready) throw err(409, info.readyNote || `${info.name} is not set up yet.`, { code: "not_ready" });
    let job;
    try { job = await R.dispatchOutside(t.agentId, { text: prompt, taskId: t.id, projectId: t.projectId }); }
    catch (e) { R.update(t.id, { status: "failed", error: e.message }); throw e; }
    R.update(t.id, { runId: job.id, status: job.status === "failed" ? "failed" : "working", step: job.status === "failed" ? "" : `Handed to ${info.name}`, error: job.error || null, startAt: null });
    return T.getTask(t.id);
  }
  capCheck(t.agentId, prompt);
  const opts = R.runOptionsFor(t.agentId, { prompt, projectId: t.projectId });
  const runId = newRunId();
  R.update(t.id, { runId, status: "working", step: "Starting", error: null, startAt: null, ai: "" });
  start(h, opts, { runId, task: false, onSettled: (m, e) => { if (m) R.fromRun(m); else R.runThrew(runId, e); } });
  return T.getTask(t.id);
}

// The full result of a task: the run's answer, or the outside agent's job text.
async function resultOf(h, t) {
  if (!t.runId) return "";
  if (R.isOutside(t.agentId)) return R.outsideJob(t.agentId, t.runId)?.text || t.preview || "";
  try { const m = await h.ctx().store.getMission(String(t.runId).replace(/[^a-z0-9-]/gi, "")); return m?.deliverable || t.preview || ""; } catch { return t.preview || ""; }
}

// ---------- the page ----------
function overview(projectId) {
  const tasks = T.listTasks({ limit: 300 });
  const agents = R.teamAgents().map((a) => {
    const mine = tasks.filter((t) => t.agentId === a.id);
    const counts = T.countsFor(mine);
    return { ...a, counts, ...T.agentStatus(counts), cap: T.capFor(a.id) };
  });
  // a task for someone who left the team stays visible under its own name
  const known = new Set(agents.map((a) => a.id));
  const duties = S.listSchedules().filter((s) => s.target?.kind === "agent").map((s) => ({ id: s.id, agentId: s.target.agentId, name: s.name, text: s.target.text || s.target.runText || "", when: S.whenWords(s.trigger?.cron || ""), cron: s.trigger?.cron || "", enabled: s.enabled, pausedReason: s.pausedReason, capUsd: s.capUsd, nextRun: s.nextRun, spent: s.spent }));
  const mem = memoryOf(projectId);
  const memory = projectId ? MEMORY_FIELDS.filter((f) => String(mem[f] || "").trim()).map((f) => MEMORY_LABELS[f]) : [];
  return { agents, counts: T.countsFor(tasks), tasks, orphans: [...new Set(tasks.filter((t) => !known.has(t.agentId)).map((t) => t.agentId))], duties, memory, projectId, neverSends: R.neverSendsLine(), defaultCap: T.DEFAULT_CAP, statusLabel: T.STATUS_LABEL };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/team/, "").replace(/\/$/, "") || "/";
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, overview(projectOf(url.searchParams.get("projectId"))));
    if (m === "POST" && p === "/assign") {
      const info = R.agentInfo(body?.agentId);
      if (!info) return h.json(res, 404, { error: "Pick an agent from your team." });
      if (R.isOutside(info.id) && !info.ready) return h.json(res, 409, { error: info.readyNote, code: "not_ready" });
      const text = String(body?.text || "").trim();
      if (!text) return h.json(res, 400, { error: `Say what ${info.name} should do.` });
      const startAt = Number(body?.startAt) > Date.now() + 30000 ? Number(body.startAt) : null;
      if (!startAt && !R.isOutside(info.id)) capCheck(info.id, text);
      const t = R.changed(T.createTask({ agentId: info.id, agentName: info.name, title: body?.title, text, status: "waiting", startAt, projectId: projectOf(body?.projectId), source: body?.source }), { was: "" });
      if (startAt) return h.json(res, 202, { task: T.publicTask(t) });
      try { return h.json(res, 202, { task: T.publicTask(await startTask(h, t)) }); }
      catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code, task: T.publicTask(T.getTask(t.id)) }); }
    }
    if (seg[0] === "tasks") {
      if (m === "GET" && seg.length === 1) return h.json(res, 200, { items: T.listTasks({ agentId: url.searchParams.get("agent") || undefined }) });
      const t = seg[1] && T.getTask(seg[1]);
      if (!t) return h.json(res, 404, { error: "No such task." });
      const action = seg[2];
      if (m === "GET" && !action) return h.json(res, 200, { task: T.publicTask(t), result: await resultOf(h, t), job: R.isOutside(t.agentId) && t.runId ? R.outsideJob(t.agentId, t.runId) : null });
      if (m === "POST" && !action) {
        if (t.status !== "waiting") return h.json(res, 409, { error: "Only a task that is waiting to start can be changed." });
        const patch = {};
        if (typeof body?.title === "string") patch.title = body.title;
        if (typeof body?.text === "string") patch.text = body.text;
        if (body && "startAt" in body) patch.startAt = Number(body.startAt) > Date.now() ? Number(body.startAt) : null;
        const next = R.update(t.id, patch);
        if (!next.startAt && !next.runId) return h.json(res, 200, { task: T.publicTask(await startTask(h, next)) });
        return h.json(res, 200, { task: T.publicTask(next) });
      }
      if (m === "POST" && action === "approve") {
        if (t.status !== "review" && !(t.status === "done" && t.outcome === "done")) return h.json(res, 409, { error: "This task is not waiting for your OK." });
        const how = ["approved", "copied", "saved"].includes(body?.how) ? body.how : "approved";
        let saved = null;
        if (how === "saved") {
          const text = await resultOf(h, t);
          if (!text.trim()) return h.json(res, 400, { error: "There is nothing to save yet." });
          saved = saveToMindMedia({ kind: "text", text, name: `${t.agentName}: ${t.title}`.slice(0, 120), status: "Approved", source: "Agent", dedupeKey: `mission:${t.runId}`, projectId: t.projectId || "" });
          try { if (saved?.reused && saved.items?.[0]?.id) updateAssetMeta(saved.projectId, saved.items[0].id, { status: "Approved" }); } catch { /* it is saved either way */ }
        }
        const next = R.update(t.id, { status: "done", outcome: how, approvedAt: Date.now(), needsOk: false });
        return h.json(res, 200, { task: T.publicTask(next), saved: saved ? { where: saved.savedWhere, link: saved.link } : null });
      }
      if (m === "POST" && action === "changes") {
        if (!["review", "done", "failed"].includes(t.status)) return h.json(res, 409, { error: "Wait until this task is finished, then ask for changes." });
        const ask = String(body?.text || "").trim();
        if (!ask) return h.json(res, 400, { error: "Say what to change." });
        const last = await resultOf(h, t);
        const prompt = `${t.text}\n\nYour last answer:\n${last.slice(0, 12000)}\n\nPlease change it like this: ${ask}`;
        R.update(t.id, { round: (t.round || 1) + 1, outcome: null, approvedAt: null, needsOk: false, preview: "", finishedAt: null });
        try { return h.json(res, 202, { task: T.publicTask(await startTask(h, T.getTask(t.id), { text: prompt })) }); }
        catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code }); }
      }
      if (m === "POST" && action === "dismiss") return h.json(res, 200, { task: T.publicTask(R.update(t.id, { status: "dismissed", outcome: "dismissed", needsOk: false })) });
      if (m === "POST" && action === "cancel") {
        if (t.status === "working" && R.isOutside(t.agentId) && t.runId) R.stopOutside(t.agentId, t.runId);
        else if (t.status !== "waiting") return h.json(res, 409, { error: "Only a task that is waiting to start can be cancelled." });
        return h.json(res, 200, { task: T.publicTask(R.update(t.id, { status: "dismissed", outcome: "cancelled", step: "" })) });
      }
      if (m === "POST" && action === "retry") {
        if (t.status !== "failed") return h.json(res, 409, { error: "Only a failed task can be tried again." });
        try { return h.json(res, 202, { task: T.publicTask(await startTask(h, t)) }); }
        catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code }); }
      }
      return false;
    }
    if (seg[0] === "agents" && seg[1]) {
      const info = R.agentInfo(seg[1]);
      if (!info) return h.json(res, 404, { error: "No such agent on your team." });
      if (m === "POST" && seg[2] === "cap") return h.json(res, 200, T.setCap(info.id, body?.cap));
      if (m === "POST" && seg[2] === "duties") {
        if (!info.canDuty) return h.json(res, 400, { error: `${info.name} takes tasks one at a time. Duties are for your AI employees and your own agents.` });
        h.guard("scheduler");
        const text = String(body?.text || "").trim();
        if (!text) return h.json(res, 400, { error: `Say what ${info.name} should do each time.` });
        const cron = T.dutyCron(body || {});
        const out = S.createSchedule({ name: `${info.name}: ${text.replace(/\s+/g, " ").slice(0, 60)}`, target: { kind: "agent", agentId: info.id, text, projectId: projectOf(body?.projectId) }, trigger: { type: "cron", cron }, capUsd: Number(body?.capUsd) > 0 ? Number(body.capUsd) : 1, after: { action: "none" } }, { agentExists: (x) => !!R.agentInfo(x) });
        return h.json(res, 200, { duty: out.schedule, when: S.whenWords(cron) });
      }
      return false;
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
