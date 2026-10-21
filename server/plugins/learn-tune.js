// Phase 40 routes. Shows the last routing change and undoes it.
import { publicState, undo } from "../learn-tune.js";

export const id = "learn-tune";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/learn-tune/, "") || "/";
  try {
    if (req.method === "GET" && (p === "/" || p === "")) return h.json(res, 200, publicState());
    if (req.method === "POST" && p === "/undo") return h.json(res, 200, undo());
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
