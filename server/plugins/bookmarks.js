// Organize my existing browser bookmarks (Phase 13): read a profile after an allow click, sort with the AI the
// person picked, preview and edit, apply with a backup, undo. The core is server/bookmarks.js.
import * as B from "../bookmarks.js";
export const id = "bookmarks";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/bookmarks/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, B.view());
    if (m === "POST" && p === "/read") return h.json(res, 200, await B.read(body || {}));
    if (m === "GET" && p === "/draft") return h.json(res, 200, B.getDraft(url.searchParams.get("id")));
    if (m === "GET" && p === "/models") return h.json(res, 200, B.modelsFor(url.searchParams.get("draft")));
    if (m === "POST" && p === "/categorize") return h.json(res, 200, await B.categorize(body || {}));
    if (m === "POST" && p === "/apply") return h.json(res, 200, await B.apply(body || {}));
    if (m === "POST" && p === "/export") return h.json(res, 200, { html: B.exportHtml(body || {}) });
    if (m === "POST" && p === "/undo") return h.json(res, 200, await B.undo(body || {}));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
