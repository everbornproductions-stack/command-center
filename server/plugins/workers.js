// 0.4.29: Your AI helpers (the in-app AI worker pool). Routes under /api/workers. The engine is server/worker-pool.js.
//   GET  /api/workers            every helper with its status: ready, resting until <time>, needs sign-in, off, not installed
//   GET  /api/workers?refresh=1  checks again what is installed and signed in
//   POST /api/workers/:id        { enabled: true | false }  turns one helper on or off
// Nothing here runs a helper, signs in or sends anything.
import { workersView, setEnabled, workerSpec } from "../worker-pool.js";

export const id = "workers";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/workers/, "") || "/";
  const m = req.method;
  if (m === "GET" && (p === "/" || p === "")) {
    return h.json(res, 200, await workersView({ refresh: url.searchParams.get("refresh") === "1" }));
  }
  const one = /^\/([a-z0-9][a-z0-9:._-]{0,80})$/i.exec(p);
  if (m === "POST" && one) {
    const wid = decodeURIComponent(one[1]);
    if (!workerSpec(wid)) return h.json(res, 404, { error: "No helper with that name.", code: "unknown" });
    if (typeof body?.enabled !== "boolean") return h.json(res, 400, { error: "Say enabled: true or false.", code: "enabled" });
    setEnabled(wid, body.enabled);
    const view = await workersView();
    return h.json(res, 200, { ...view, worker: view.workers.find((w) => w.id === wid) || null });
  }
  return false;
}
