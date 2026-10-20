// Built-in browser helper (Phase 27): Settings > Integrations > Browser helper, jobs on a click, the OK / No
// answers, Stop, and the Google sign-in for Gmail and Drive. The core is server/browser.js; the desktop
// window is electron/browser-helper.cjs; Google is server/google.js.
import { configView, saveSettings, dispatch, listJobs, runJobs, decide, stopJob, hubCard, routeAdvice, TAGS } from "../browser.js";
import { agentNeeds } from "../grokbot.js";
import * as G from "../google.js";
export const id = "browser";

const PORT = Number(process.env.PORT || process.env.CC_PORT || 4747);
export const DEMO_TASK = () => `Open http://127.0.0.1:${PORT}/browser-demo.html, read the page, and fill in its contact form with a short hello from the browser helper.`;

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/browser/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, { config: configView(), jobs: listJobs(30), card: hubCard() });
    if (m === "GET" && p === "/route") return h.json(res, 200, routeAdvice(url.searchParams.get("prompt") || ""));
    if (m === "POST" && p === "/config") return h.json(res, 200, saveSettings(body || {}));
    if (m === "GET" && p === "/jobs") { const run = url.searchParams.get("run"); return h.json(res, 200, run ? runJobs(run) : listJobs(60)); }
    // a click: "Send to Browser helper" in Command, or "Try it on the demo page" in Settings
    if (m === "POST" && (p === "/jobs" || p === "/demo")) {
      const task = p === "/demo" ? DEMO_TASK() : String(body?.task || "").trim();
      if (!task) return h.json(res, 400, { error: "task required" });
      const job = await dispatch({ task, context: p === "/demo" ? "" : String(body?.context || ""), needs: agentNeeds(task).filter((t) => TAGS.includes(t)), accountId: body?.accountId || null, source: { kind: "click", projectId: typeof body?.projectId === "string" ? body.projectId.slice(0, 80) : null } });
      return h.json(res, 202, { job });
    }
    if (m === "POST" && seg[0] === "jobs" && seg[1] && seg[2] === "approve") return h.json(res, 200, { job: decide(seg[1], String(body?.approval || ""), true) });
    if (m === "POST" && seg[0] === "jobs" && seg[1] && seg[2] === "deny") return h.json(res, 200, { job: decide(seg[1], String(body?.approval || ""), false) });
    if (m === "POST" && seg[0] === "jobs" && seg[1] && seg[2] === "stop") return h.json(res, 200, { job: stopJob(seg[1]) });

    // Google sign-in (Gmail and Drive, read-only by default)
    if (seg[0] === "google") {
      if (m === "GET" && !seg[1]) return h.json(res, 200, G.view());
      if (m === "POST" && seg[1] === "client") return h.json(res, 200, await G.setClient({ clientId: body?.clientId, clientSecret: body?.clientSecret }));
      if (m === "POST" && seg[1] === "start") {
        const origin = String(body?.origin || "").replace(/\/$/, "");
        if (!/^https?:\/\/[^\s/]+$/.test(origin)) return h.json(res, 400, { error: "origin required" });
        return h.json(res, 200, G.start({ want: { gmail: !!body?.gmail, drive: !!body?.drive, send: !!body?.send }, redirectUri: `${origin}/`, accountId: body?.accountId || null }));
      }
      if (m === "POST" && seg[1] === "finish") return h.json(res, 200, await G.finish({ code: body?.code, state: body?.state }));
      if (m === "DELETE" && !seg[1]) return h.json(res, 200, await G.disconnect());
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
