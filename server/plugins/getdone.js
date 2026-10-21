// Get it done routes. Session token required (not a public relay).
import { view, saveRule, revokeRule, endGrant, noteJobEnd } from "../getdone.js";

export const id = "getdone";

export function onEvent(ev) {
  noteJobEnd(ev);
}

async function halt(runId) {
  const id = String(runId || "");
  endGrant(id, "stopped");
  try {
    const { abortMission } = await import("../mission.js");
    abortMission(id);
  } catch { /* a chat or a handoff has no mission to abort */ }
  try {
    const { findJob, listJobs, stopJob } = await import("../browser.js");
    const own = findJob(id);
    if (own && own.status !== "done" && own.status !== "failed") stopJob(id, "stopped by you");
    for (const j of listJobs(80)) {
      if (j.source?.runId === id && j.status !== "done" && j.status !== "failed" && j.id !== id) {
        try { stopJob(j.id, "stopped by you"); } catch { /* already finished */ }
      }
    }
  } catch { /* browser helper not in this process */ }
  return view();
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/getdone/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, view());
    if (m === "POST" && seg[0] === "rules" && !seg[1]) return h.json(res, 200, { rule: saveRule({ jobKind: body?.jobKind, send: body?.send === true }), ...view() });
    if (m === "DELETE" && seg[0] === "rules" && seg[1] && !seg[2]) {
      revokeRule(decodeURIComponent(seg[1]));
      return h.json(res, 200, view());
    }
    if (m === "POST" && seg[0] === "stop" && seg[1] && !seg[2]) return h.json(res, 200, await halt(decodeURIComponent(seg[1])));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message });
  }
  return false;
}
