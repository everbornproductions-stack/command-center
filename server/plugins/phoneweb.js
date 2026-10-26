// Phone web companion plugin (/api/phoneweb/*).
// Gated behind flag_phoneweb (default OFF in tests).
import {
  FLAG_NAME,
  FLOW_STAGES,
  QUICK_ACTIONS,
  POST_PLATFORMS,
  IMAGE_LIGHTING,
  IMAGE_AMBIENCE,
  isPhoneWebEnabled,
  readPhoneState,
  stageInfo,
  setCompanionContext,
  queueDirection,
  queueView,
  consumeQueuedForRun,
  cancelDirection,
  buildLiveJobSummary,
  runQuickAction,
  resolvePhoneApproval,
} from "../phoneweb.js";
import { publicState as approvalsState } from "../phone-approvals.js";
import { beginFollowup } from "../followup.js";
import { liveMissionList } from "../mission.js";

export const id = "phoneweb";

let H = null;
export async function init(h) {
  H = h;
}

function buildState(h) {
  const s = h.settings ? h.settings() : {};
  const enabled = isPhoneWebEnabled(s);
  if (!enabled) {
    return { enabled: false, flag: FLAG_NAME };
  }
  const st = readPhoneState();
  const projects = (h.listProjects ? h.listProjects() : []).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color || "#22d3ee",
  }));
  const activeProjectId = st.projectId || s.activeProject || projects[0]?.id || "";
  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  const activeStage = st.stage || s.activeStage || "creative";
  const liveJob = buildLiveJobSummary({
    liveList: liveMissionList(),
    projectId: activeProjectId,
    stage: activeStage,
  });
  const queue = queueView({
    runId: liveJob.id,
    projectId: activeProjectId,
  });
  return {
    enabled: true,
    flag: FLAG_NAME,
    projectId: activeProjectId,
    projectName: activeProject?.name || "All projects",
    projects,
    stage: activeStage,
    stageLabel: stageInfo(activeStage).label,
    stages: FLOW_STAGES,
    homeLocation: st.homeLocation || "",
    homeMode: st.homeMode || "driving",
    updatedAt: st.updatedAt || 0,
    updatedBy: st.updatedBy || "desktop",
    liveJob,
    queue,
    approvals: approvalsState(),
    pairing: { on: s.phonePair?.on === true },
    quickActions: QUICK_ACTIONS,
    platforms: POST_PLATFORMS,
    lighting: IMAGE_LIGHTING,
    ambience: IMAGE_AMBIENCE,
    recentActions: (st.quickHistory || []).slice(0, 15),
  };
}

export function onEvent(ev, h) {
  if (!h || !isPhoneWebEnabled(h.settings?.())) return;
  if (ev.type === "mission.update" && ev.mission) {
    const m = ev.mission;
    const st = readPhoneState();
    const projectId = m.projectId || st.projectId || "";
    const liveJob = buildLiveJobSummary({ liveList: liveMissionList(), projectId, stage: st.stage });
    h.emit("phoneweb.progress", {
      runId: m.id,
      status: m.status,
      liveJob,
      queue: queueView({ runId: m.id, projectId }),
    });
  }
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/phoneweb/, "") || "/";
  const seg = p.split("/").filter(Boolean);

  if (req.method === "GET" && (p === "" || p === "/" || p === "/state")) {
    return h.json(res, 200, buildState(h));
  }

  if (!isPhoneWebEnabled(h.settings?.())) {
    return h.json(res, 403, {
      error: "Phone web companion is turned off.",
      code: "flag_disabled",
      flag: FLAG_NAME,
    });
  }

  if (req.method === "POST" && p === "/context") {
    try {
      const summary = setCompanionContext({
        projectId: body?.projectId,
        stage: body?.stage,
        homeLocation: body?.homeLocation,
        homeMode: body?.homeMode,
        from: body?.from || "phone",
        settings: h.settings,
        putSettings: (next) => h.putDoc("settings", next),
        emit: h.emit,
      });
      return h.json(res, 200, { ok: true, context: summary, state: buildState(h) });
    } catch (e) {
      return h.json(res, e.status || 400, { error: e.message, code: e.code || "bad_context" });
    }
  }

  if (req.method === "POST" && p === "/direction") {
    try {
      const st = readPhoneState();
      const effProject = body?.projectId !== undefined ? String(body.projectId || "") : st.projectId || "";
      const liveJob = buildLiveJobSummary({ liveList: liveMissionList(), projectId: effProject, stage: st.stage });
      const targetRunId = body?.runId !== undefined ? (body.runId ? String(body.runId) : null) : liveJob.id;
      const busy = targetRunId && (liveMissionList().some((m) => m.id === targetRunId) || ["running", "planning", "working", "waiting", "qa", "assembling", "paused"].includes(liveJob.status));

      if (!busy && body?.startIfIdle === true && !body?.queueOnly) {
        const text = String(body?.text || "").trim();
        if (!text) return h.json(res, 400, { error: "Type or speak a direction first.", code: "direction_empty" });
        if (targetRunId && ["done", "done-with-errors", "failed"].includes(liveJob.status)) {
          const started = await beginFollowup({
            runId: targetRunId,
            text,
            scope: body?.scope || "job",
            target: body?.target,
          });
          return h.json(res, 202, { ok: true, mode: "followup", runId: started.runId, scope: started.scope });
        }
        if (typeof h.runChat === "function") {
          const id = "s-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          h.runChat({ id, prompt: text, projectId: effProject || null }).catch(() => {});
          return h.json(res, 202, { ok: true, mode: "chat", runId: id });
        }
      }

      const queued = queueDirection({
        text: body?.text,
        runId: targetRunId,
        projectId: effProject,
        stage: body?.stage || st.stage,
        from: body?.from || "phone",
        inputMode: body?.inputMode || "text",
        explicit: body?.explicit,
        kind: body?.kind,
        emit: h.emit,
      });
      return h.json(res, 202, {
        ok: true,
        mode: "queued",
        direction: queued.entry,
        supersededIds: queued.supersededIds,
        queue: queued.queue,
      });
    } catch (e) {
      return h.json(res, e.status || 400, { error: e.message, code: e.code || "direction_failed" });
    }
  }

  if (req.method === "POST" && p === "/direction/consume") {
    const runId = body?.runId ? String(body.runId) : null;
    const projectId = body?.projectId ? String(body.projectId) : "";
    const consumed = consumeQueuedForRun(runId, projectId, { emit: h.emit });
    let followupRunId = null;
    if (consumed && body?.triggerFollowup === true && runId) {
      try {
        const started = await beginFollowup({
          runId,
          text: consumed.promptBlock,
          scope: body?.scope || "job",
          target: body?.target,
        });
        followupRunId = started.runId;
      } catch {}
    }
    return h.json(res, 200, {
      ok: true,
      consumed,
      followupRunId,
      queue: queueView({ runId, projectId }),
    });
  }

  if ((req.method === "DELETE" && seg[0] === "direction" && seg[1]) || (req.method === "POST" && p === "/direction/cancel")) {
    const dirId = req.method === "DELETE" ? seg[1] : String(body?.id || "");
    const out = cancelDirection(dirId, { emit: h.emit });
    if (!out) return h.json(res, 404, { error: "Direction not found.", code: "direction_not_found" });
    return h.json(res, 200, { ok: true, ...out });
  }

  if (req.method === "POST" && p === "/quick") {
    try {
      const entry = runQuickAction(body || {}, { emit: h.emit });
      return h.json(res, 200, { ok: true, entry, approvals: approvalsState() });
    } catch (e) {
      return h.json(res, e.status || 400, { error: e.message, code: e.code || "quick_failed" });
    }
  }

  if (req.method === "POST" && p === "/approval") {
    try {
      const out = resolvePhoneApproval({
        id: String(body?.id || ""),
        decision: String(body?.decision || ""),
        emit: h.emit,
      });
      return h.json(res, 200, { ok: true, ...out });
    } catch (e) {
      return h.json(res, e.status || 400, { error: e.message, code: e.code || "approval_failed" });
    }
  }

  return false;
}
