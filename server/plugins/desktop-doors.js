// Routes for the desktop doors. A hosted hub does not drive a desktop.
import { HOSTED } from "../store.js";
import * as Doors from "../desktop-doors.js";

export const id = "desktop-doors";

export async function routes(req, res, url, body, h) {
  if (HOSTED) return h.json(res, 400, { error: "This runs in the desktop app." });
  const p = url.pathname.replace(/^\/api\/desktop-doors/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && (p === "/" || p === "")) return h.json(res, 200, Doors.publicState());
    if (m === "POST" && p === "/apps") return h.json(res, 200, Doors.addApp(body || {}));
    if (m === "POST" && p === "/allow") return h.json(res, 200, Doors.setAllowed(String(body?.id || ""), !!body?.allowed));
    if (m === "POST" && p === "/stop") return h.json(res, 200, Doors.stopUsing(String(body?.id || "")));
    if (m === "GET" && p === "/planner") return h.json(res, 200, { apps: Doors.plannerRows() });
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message });
  }
  return false;
}
