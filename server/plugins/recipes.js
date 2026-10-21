// Phase 57 routes. Record a task, then replay it. A schedule only runs while the app is open.
import { publicState, recordRecipe, replay, tick } from "../recipes.js";

export const id = "recipes";

export function init() {
  const timer = setInterval(() => { try { tick(Date.now()); } catch { /* a bad cron waits for the next pass */ } }, 60000);
  timer.unref?.();
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/recipes/, "") || "/";
  try {
    if (req.method === "GET" && (p === "/" || p === "")) return h.json(res, 200, publicState());
    if (req.method === "POST" && (p === "/" || p === "")) return h.json(res, 200, recordRecipe(body || {}));
    if (req.method === "POST" && p === "/replay") return h.json(res, 200, replay(String(body?.id || ""), body || {}));
    if (req.method === "POST" && p === "/tick") return h.json(res, 200, { ran: tick(Number(body?.now) || Date.now()) });
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
