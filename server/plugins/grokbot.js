// Grok Bot agent (Phase 12): Settings > Integrations > Grok Bot, hand-offs on a click, pasting a result in
// by hand, cancelling. The core (vault, dispatch, callback, mock) is server/grokbot.js. The callback route
// /api/grokbot/callback/<job_id> is answered by index.js before the session-token check, never here.
import { configView, saveConfig, dispatch, listJobs, runJobs, pasteResult, cancelJob, routeAdvice, hubCard, agentNeeds, isCallback } from "../grokbot.js";
export const id = "grokbot";

export async function routes(req, res, url, body, h) {
  if (isCallback(url.pathname)) return h.json(res, 404, { error: "not found" });
  const p = url.pathname.replace(/^\/api\/grokbot/, "");
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, { config: configView(), jobs: listJobs(50), card: hubCard() });
    if (m === "GET" && p === "/route") return h.json(res, 200, routeAdvice(url.searchParams.get("prompt") || ""));
    if (m === "POST" && p === "/config") return h.json(res, 200, await saveConfig(body || {}));
    if (m === "GET" && p === "/jobs") { const run = url.searchParams.get("run"); return h.json(res, 200, run ? runJobs(run) : listJobs(100)); }
    // a click: "Send to Grok Bot" in Command, or "Send a test job" in Settings
    if (m === "POST" && p === "/jobs") {
      const task = String(body?.task || "").trim();
      if (!task) return h.json(res, 400, { error: "task required" });
      const job = await dispatch({ task, context: String(body?.context || ""), needs: agentNeeds(task), source: { kind: "click", projectId: typeof body?.projectId === "string" ? body.projectId.slice(0, 80) : null, getItDone: body?.getItDone === true, sendMessages: body?.sendMessages === true } });
      return h.json(res, job.status === "failed" ? 502 : 202, { job });
    }
    if (m === "POST" && p === "/test") {
      const job = await dispatch({ task: "Test from Meldmind: please report back with status done and the text OK. Do not open, send or change anything.", source: { kind: "click" } });
      return h.json(res, job.status === "failed" ? 502 : 202, { job });
    }
    if (m === "POST" && seg[0] === "jobs" && seg[1] && seg[2] === "result") return h.json(res, 200, { job: pasteResult(seg[1], body?.text, Array.isArray(body?.artifacts) ? body.artifacts : undefined) });
    if (m === "POST" && seg[0] === "jobs" && seg[1] && seg[2] === "cancel") return h.json(res, 200, { job: cancelJob(seg[1]) });
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
