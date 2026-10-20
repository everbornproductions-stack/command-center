// Antigravity CLI routes. A click starts a task, installs, or opens sign-in.
// Nothing here runs agy until that click. The manual handoff stays in /api/handoff.
import { addHubAgent } from "../agents.js";
import {
  allowAgy, beginSignIn, cardView, dispatchJob, findJob, hubCard, installAgy,
  listJobs, publicJob, refreshStatus, stopAgyJob, verifyAgy,
} from "../antigravity-cli.js";

export const id = "antigravity";

export async function init() {
  addHubAgent(hubCard);
  try { await refreshStatus(); } catch { /* the card still says what is missing */ }
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/antigravity/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, { card: cardView(), jobs: listJobs(30), hub: hubCard() });
    if (m === "POST" && seg[0] === "refresh" && !seg[1]) return h.json(res, 200, { card: await refreshStatus() });
    if (m === "POST" && seg[0] === "allow" && !seg[1]) return h.json(res, 200, { card: await allowAgy(body?.allow === true) });
    if (m === "POST" && seg[0] === "install" && !seg[1]) return h.json(res, 200, await installAgy({ confirm: body?.confirm === true }));
    if (m === "POST" && seg[0] === "signin" && !seg[1]) return h.json(res, 200, await beginSignIn({ confirm: body?.confirm === true }));
    if (m === "POST" && seg[0] === "verify" && !seg[1]) return h.json(res, 200, await verifyAgy({ confirm: body?.confirm === true }));
    if (m === "POST" && seg[0] === "jobs" && !seg[1]) {
      const job = await dispatchJob({ task: body?.task, source: { kind: "click" } });
      return h.json(res, 202, { job });
    }
    if (m === "GET" && seg[0] === "jobs" && seg[1] && !seg[2]) {
      const job = findJob(decodeURIComponent(seg[1]));
      if (!job) return h.json(res, 404, { error: "No such task." });
      return h.json(res, 200, { job: publicJob(job) });
    }
    if (m === "POST" && seg[0] === "jobs" && seg[1] && seg[2] === "stop") {
      const id = decodeURIComponent(seg[1]);
      const stopped = stopAgyJob(id);
      return h.json(res, 200, { stopped, job: publicJob(findJob(id)) });
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
