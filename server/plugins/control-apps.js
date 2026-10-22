// Phases 45 to 51 routes. A hosted hub does not drive a desktop or a signed-in browser.
import { HOSTED, ctx } from "../store.js";
import { publicState, addApp, setAllowed, stopUsing, runJob, runLive, getPlan, cancelPlan } from "../control-apps.js";

export const id = "control-apps";

// A mission step that waited on a planned list gets the result of the Press these click.
async function fillMissionStep(plan, result, h) {
  if (!plan?.missionId || !plan.taskId) return;
  const { missionSummary, publicMission } = await import("../mission.js");
  const m = await ctx().store.getMission(plan.missionId);
  const t = m?.tasks?.find((x) => x.id === plan.taskId);
  if (!t) return;
  t.output = result.status === "done" ? (result.log || []).join("\n") || `${plan.app} finished this step.` : `${result.reason || (result.log || []).slice(-1)[0] || "Stopped."}`;
  t.status = result.status === "done" ? "done" : "failed";
  if (t.status === "failed") t.error = t.output;
  t.appPlan = null;
  t.finishedAt = Date.now();
  ctx().store.saveMission(m, missionSummary(m));
  h.emit("task.update", { missionId: m.id, task: publicMission(m).tasks.find((x) => x.id === t.id) });
  h.emit("mission.update", { mission: publicMission(m) });
}

export async function routes(req, res, url, body, h) {
  if (HOSTED && req.method !== "GET") return h.json(res, 400, { error: "This runs in the desktop app." });
  const p = url.pathname.replace(/^\/api\/control-apps/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && (p === "/" || p === "")) return h.json(res, 200, publicState());
    if (req.method === "POST" && p === "/apps") return h.json(res, 200, addApp(body || {}));
    if (req.method === "POST" && p === "/allow") return h.json(res, 200, setAllowed(String(body?.id || ""), !!body?.allowed));
    if (req.method === "POST" && p === "/stop") return h.json(res, 200, stopUsing(String(body?.id || "")));
    if (req.method === "POST" && p === "/run") {
      const payload = { ...(body || {}) };
      // a planned list is pressed only through its own confirm route below
      delete payload.planId; delete payload.confirmPlan;
      const out = payload.live ? await runLive(String(payload.id || ""), payload) : runJob(String(payload.id || ""), payload);
      return h.json(res, 200, out);
    }
    // Press these: the person confirmed the exact list. Only those controls are pressed, in order; Stop still works.
    if (req.method === "POST" && seg[0] === "plans" && seg[1] && seg[2] === "confirm" && !seg[3]) {
      const plan = getPlan(decodeURIComponent(seg[1]));
      if (!plan) return h.json(res, 404, { error: "That list is gone. Nothing was pressed.", code: "no_plan" });
      const out = await runLive(plan.appId, { planId: plan.id, confirmPlan: true, title: plan.title, live: true });
      await fillMissionStep(plan, out, h).catch(() => {});
      return h.json(res, 200, out);
    }
    if (req.method === "POST" && seg[0] === "plans" && seg[1] && seg[2] === "cancel" && !seg[3]) {
      const plan = getPlan(decodeURIComponent(seg[1]));
      const out = cancelPlan(decodeURIComponent(seg[1]));
      if (plan) await fillMissionStep(plan, { status: "stopped", reason: "You cancelled the list. Nothing was pressed." }, h).catch(() => {});
      return h.json(res, 200, out);
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
