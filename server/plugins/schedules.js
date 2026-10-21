// Scheduled and triggered agents (Phase 22): the routes behind the Schedules tab. The work lives in
// server/schedules.js; this file plugs in the runner (a custom agent or a plain chat through h.runChat, a
// mission through h.runMission, so ledger, spend caps, smart fallback, tool approvals and tier gates apply
// as for any run), the cap alert (alerts plugin) and the sender used after an approval.
//   GET  /api/schedules                         schedules, recent runs, agents to pick from, the desktop note
//   POST /api/schedules ; POST|DELETE /api/schedules/<id>     create, edit, delete (a webhook token is shown once)
//   POST /api/schedules/<id>/run                run now (202)
//   POST /api/schedules/<id>/pause | /resume
//   POST /api/schedules/<id>/token              a new webhook token (the old one stops working)
//   GET  /api/schedules/runs?schedule=<id>
//   POST /api/schedules/runs/<runId>/approve | /reject       send the held result, or drop it
//   POST /api/schedules/hook/<id>               the webhook itself (no session token; see server/schedules.js)
// Desktop: a timer in this process ticks the one local user while the app is open.
// Hosted: the Cloudflare cron calls POST /api/internal/schedules/tick (server/schedule-tick.js).
import * as S from "../schedules.js";
import * as A from "../custom-agents.js";
import { raise } from "./alerts.js";
import { scheduler } from "../perf/scheduler.js";

export const id = "schedules";
const TICK_MS = Math.max(100, Number(process.env.CC_SCHEDULE_TICK_MS) || 15000);
export const HOSTED_NOTE = "Schedules on the hub run while this browser is closed. Each slot runs once. A result that is sent out still waits until you click Approve.";

function agentOf(id) {
  const a = A.getAgent(id);
  if (!a) throw Object.assign(new Error("The agent for this schedule does not exist any more."), { status: 404 });
  return a;
}

async function runOne(h, s, { prompt, runId, budgetUsd }) {
  const projectId = s.target.projectId || null;
  if (s.target.kind === "mission") {
    const budget = Math.max(0.01, Math.min(Number(h.settings().missionBudget) || 2, budgetUsd));
    const m = await h.runMission({ goal: prompt, mode: s.target.mode || "balanced", projectId, qa: true, budgetUsd: budget });
    const ok = m.status === "done" || m.status === "done-with-errors";
    return { status: ok ? "done" : "failed", cost: m.cost, missionId: m.id, deliverable: m.deliverable || "", error: ok ? null : m.error || `The mission ended as ${m.status}.` };
  }
  const opts = s.target.kind === "agent" ? A.runOptions(agentOf(s.target.agentId), { prompt, projectId }) : { prompt, projectId };
  const m = await h.runChat({ ...opts, runId });
  return { status: m.status === "done" ? "done" : "failed", cost: m.cost, missionId: m.id, deliverable: m.deliverable || "", error: m.error || null };
}

async function send(url, payload) {
  const host = new URL(url).host;
  let r;
  try { r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "CommandAI-Schedules" }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new Error(`Could not reach ${host}: ${e.name === "TimeoutError" ? "timed out" : e.cause?.code || e.message}`); }
  if (!r.ok) throw new Error(`${host} refused the result (${r.status}).`);
  return { status: r.status };
}

export function init(h) {
  S.configure({ run: (s, o) => runOne(h, s, o), alert: (key, title, body, level) => raise(h, key, title, body, level), send });
  if (h.HOSTED) return; // the hub has no user at boot; the cron tick loads each due user
  const c = h.ctx();
  scheduler.register({
    id: "schedules",
    everyMs: TICK_MS,
    lightEveryMs: Math.max(TICK_MS * 4, 60000),
    pause: true,
    run: () => h.runAs(c, () => { try { S.tick(); } catch (e) { console.error("[schedules]", e.message); } }),
  });
}

const createOpts = (h, body) => {
  if (body?.target?.kind === "mission") h.guard("missions"); // missions are a Pro feature; the schedule is refused up front
  return { agentExists: (id) => !!A.getAgent(id) };
};

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/schedules/, "").replace(/\/$/, "") || "/";
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  try {
    if (m === "GET" && p === "/") {
      return h.json(res, 200, { items: S.listSchedules(), runs: S.listRuns({ limit: 100 }).map(S.publicRun), agents: A.listAgents().map((a) => ({ id: a.id, name: a.name })), note: h.HOSTED ? HOSTED_NOTE : S.NOTE, limits: S.LIMITS, statusLabel: S.STATUS_LABEL, defaultCap: S.DEFAULT_CAP });
    }
    if (m === "POST" && p === "/") return h.json(res, 200, S.createSchedule(body || {}, createOpts(h, body)));
    if (seg[0] === "runs") {
      if (m === "GET" && seg.length === 1) return h.json(res, 200, { items: S.listRuns({ scheduleId: url.searchParams.get("schedule") || undefined, limit: Number(url.searchParams.get("limit")) || 100 }).map(S.publicRun) });
      if (m === "GET" && seg.length === 2) { const r = S.getRun(seg[1]); return r ? h.json(res, 200, S.publicRun(r)) : h.json(res, 404, { error: "No such run." }); }
      if (m === "POST" && seg[2] === "approve") return h.json(res, 200, await S.approve(seg[1]));
      if (m === "POST" && seg[2] === "reject") return h.json(res, 200, S.reject(seg[1]));
      return false;
    }
    const s = seg[0] && S.getSchedule(seg[0]);
    if (!s) return h.json(res, 404, { error: "No such schedule." });
    if (m === "GET" && seg.length === 1) return h.json(res, 200, { schedule: S.view(s), runs: S.listRuns({ scheduleId: s.id }).map(S.publicRun) });
    if (m === "POST" && seg.length === 1) return h.json(res, 200, S.updateSchedule(s.id, body || {}, createOpts(h, body)));
    if (m === "DELETE" && seg.length === 1) return h.json(res, 200, S.deleteSchedule(s.id));
    if (m === "POST" && seg[1] === "run") { if (s.target.kind === "mission") h.guard("missions"); return h.json(res, 202, S.trigger(s.id, { source: "manual" })); }
    if (m === "POST" && seg[1] === "pause") return h.json(res, 200, S.setEnabled(s.id, false));
    if (m === "POST" && seg[1] === "resume") return h.json(res, 200, S.setEnabled(s.id, true));
    if (m === "POST" && seg[1] === "token") return h.json(res, 200, S.rotateToken(s.id));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
