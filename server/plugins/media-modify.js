// Plan, then run, for a picture or video already stored on this computer.
// POST /api/media-modify/plan
// POST /api/media-modify/run
// POST /api/media-modify/save
// GET  /api/media-modify/file/:id
import { plan, resultFile, run, saveResult } from "../media-modify.js";
import { writeAttachment } from "../box-files.js";

export const id = "media-modify";

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/media-modify\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (req.method === "POST" && seg[0] === "plan" && !seg[1]) return h.json(res, 200, plan(body || {}));
    if (req.method === "POST" && seg[0] === "run" && !seg[1]) return h.json(res, 200, await run(body || {}));
    if (req.method === "POST" && seg[0] === "save" && !seg[1]) return h.json(res, 200, saveResult(body || {}));
    if (req.method === "GET" && seg[0] === "file" && seg[1]) {
      const file = resultFile(seg[1]);
      if (!file) return h.json(res, 404, { error: "That result is not on this computer." });
      writeAttachment(res, file);
      return true;
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code, estimate: e.estimate });
  }
  return false;
}
