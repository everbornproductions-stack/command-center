// Phases 45 to 51 routes. A hosted hub does not drive a desktop or a signed-in browser.
import { HOSTED } from "../store.js";
import { publicState, addApp, setAllowed, stopUsing, runJob } from "../control-apps.js";

export const id = "control-apps";

export async function routes(req, res, url, body, h) {
  if (HOSTED && req.method !== "GET") return h.json(res, 400, { error: "This runs in the desktop app." });
  const p = url.pathname.replace(/^\/api\/control-apps/, "") || "/";
  try {
    if (req.method === "GET" && (p === "/" || p === "")) return h.json(res, 200, publicState());
    if (req.method === "POST" && p === "/apps") return h.json(res, 200, addApp(body || {}));
    if (req.method === "POST" && p === "/allow") return h.json(res, 200, setAllowed(String(body?.id || ""), !!body?.allowed));
    if (req.method === "POST" && p === "/stop") return h.json(res, 200, stopUsing(String(body?.id || "")));
    if (req.method === "POST" && p === "/run") return h.json(res, 200, runJob(String(body?.id || ""), body || {}));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
