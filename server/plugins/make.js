// "Type it, get the finished thing" (0.4.21): the routes. The work lives in server/make-it.js.
//   POST /api/make/plan  { kind, request, seconds?, change?, previousPrompt?, another? }   what will run and what it costs (spends nothing)
//   POST /api/make/run   { ...plan fields, generatorPrompt?, okUsd?, projectId?, parentAssetId? }   makes it; images come back finished,
//                        video and voice come back as a job to poll
//   GET  /api/make/job/<id>   the job's progress and, when done, where the file is
import { plan, run, jobStatus } from "../make-it.js";
export const id = "make";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/make/, "") || "/";
  try {
    if (req.method === "POST" && p === "/plan") return h.json(res, 200, await plan(body || {}));
    if (req.method === "POST" && p === "/run") return h.json(res, 200, await run(body || {}));
    const m = p.match(/^\/job\/([^/]+)$/);
    if (req.method === "GET" && m) return h.json(res, 200, jobStatus(decodeURIComponent(m[1])));
  } catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code, next: e.next, plan: e.plan, estimate: e.estimate }); }
  return false;
}
