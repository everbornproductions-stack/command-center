// Backup when API credits run out: routes at /api/answerwait. The behaviour lives in server/answer-wait.js
// (waiting jobs, the copy-over prompt, filling a box) and server/sub-routes.js (the official apps and the order).
// These routes never open a chat page and never read a clipboard: the page reads it in the desktop app and
// sends only the text inside a "MELDMIND ANSWER <job id>" block.
import { listJobs, continueInfo, deliver, stopWait, resumeAll, waitOn } from "../answer-wait.js";
import { routesView, saveRouteSettings, clearSignedOut } from "../sub-routes.js";
import { saveFallbackSettings } from "../fallback.js";

export const id = "answerwait";

export async function init() {
  try { resumeAll(); } catch {}
}

async function view({ refresh = false } = {}) {
  return { on: waitOn(), jobs: listJobs(40), ...(await routesView({ refresh })) };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/answerwait/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, await view({ refresh: url.searchParams.get("refresh") === "1" }));
    if (m === "POST" && seg[0] === "check" && !seg[1]) { clearSignedOut(); return h.json(res, 200, await view({ refresh: true })); }
    if (m === "POST" && seg[0] === "settings" && !seg[1]) {
      const b = body || {};
      if (b.on !== undefined) saveFallbackSettings({ subscriptions: b.on === true });
      if (b.routes !== undefined || b.website !== undefined || b.paths !== undefined) saveRouteSettings({ routes: b.routes, website: b.website, paths: b.paths, confirm: b.confirm === true });
      h.emit("log", { text: "Backup when API credits run out: settings saved." });
      return h.json(res, 200, await view());
    }
    if (seg[0] && seg[0].startsWith("ans-")) {
      const jobId = decodeURIComponent(seg[0]);
      if (m === "GET" && !seg[1]) return h.json(res, 200, continueInfo(jobId));
      if (m === "POST" && seg[1] === "answer" && !seg[2]) {
        const b = body || {};
        const route = b.route === "clipboard" ? "clipboard" : "paste";
        if (route === "paste" && b.confirm !== true) return h.json(res, 400, { error: "Paste reply only saves when you click Save reply.", code: "confirm" });
        return h.json(res, 200, await deliver(jobId, b.text, { route, by: route === "clipboard" ? "clipboard" : "pasted" }));
      }
      if (m === "POST" && seg[1] === "stop" && !seg[2]) return h.json(res, 200, await stopWait(jobId));
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code, needsConfirm: e.needsConfirm || undefined });
  }
  return false;
}
