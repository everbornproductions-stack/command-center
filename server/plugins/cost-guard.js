// Phase 59 routes. The monthly budget cap.
import { publicState, saveGuard } from "../cost-guard.js";

export const id = "cost-guard";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/cost-guard/, "") || "/";
  try {
    if (req.method === "GET" && (p === "/" || p === "")) return h.json(res, 200, publicState());
    if (req.method === "POST" && (p === "/" || p === "")) return h.json(res, 200, saveGuard(body || {}));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
