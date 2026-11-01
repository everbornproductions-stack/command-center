// 0.4.29: Your AI helpers (the in-app AI worker pool). Routes under /api/workers. The engine is server/worker-pool.js.
//   GET  /api/workers            every helper with its status: ready, resting until <time>, needs sign-in, off, not installed
//   GET  /api/workers?refresh=1  checks again what is installed and signed in
//   POST /api/workers/:id        { enabled: true | false }  turns one helper on or off
//   POST /api/workers/:id/install  0.4.33: installs a missing helper with npm (fixed package names, after a click)
//   POST /api/workers/:id/signin   0.4.33: opens the helper's own sign-in window; the person signs in there
// Nothing else here runs a helper, signs in or sends anything.
import { workersView, setEnabled, workerSpec } from "../worker-pool.js";
import { installHelper, signInHelper } from "../helper-install.js";

export const id = "workers";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/workers/, "") || "/";
  const m = req.method;
  if (m === "GET" && (p === "/" || p === "")) {
    return h.json(res, 200, await workersView({ refresh: url.searchParams.get("refresh") === "1" }));
  }
  // 0.4.33: POST /api/workers/<id>/install and /signin (after a click; the package names are fixed in helper-install.js)
  const act = /^\/([a-z0-9][a-z0-9._-]{0,40})\/(install|signin)$/i.exec(p);
  if (m === "POST" && act) {
    const wid = decodeURIComponent(act[1]);
    if (!workerSpec(wid)) return h.json(res, 404, { error: "No helper with that name.", code: "unknown" });
    const r = act[2] === "install" ? await installHelper(wid) : await signInHelper(wid);
    const view = await workersView({ refresh: true });
    return h.json(res, r.ok ? 200 : r.code === "page" || r.code === "no-node" ? 200 : 400, { ...r, error: r.ok || r.code === "page" || r.code === "no-node" ? undefined : r.message, view });
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
