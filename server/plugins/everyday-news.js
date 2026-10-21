// What's new and suggestion routes. Try it is a sample. Send waits for a click.
// GET  /api/everyday-news
// POST /api/everyday-news/items/:id/later
// POST /api/everyday-news/items/:id/skip
// POST /api/everyday-news/skip-all
// POST /api/everyday-news/items/:id/try
// POST /api/everyday-news/items/:id/connect
// POST /api/everyday-news/suggestions/preview
// POST /api/everyday-news/suggestions/send
// POST /api/everyday-news/suggestions/files
// POST /api/everyday-news/suggestions/:id  (edit, status)
// POST /api/everyday-news/suggestions/:id/comments
// POST /api/everyday-news/suggestions/:id/move
// POST /api/everyday-news/suggestions/:id/delete
// GET  /api/everyday-news/files/:ideaId/:fileId
import * as N from "../everyday-news.js";
import { readIdeaFile, writeAttachment } from "../box-files.js";

export const id = "everyday-news";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/everyday-news\/?/, "");
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  const now = N.clockNow(body?.now ?? url.searchParams.get("now"));
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, N.view(now));
    if (m === "POST" && seg[0] === "items" && seg[2] === "later") {
      return h.json(res, 200, { item: N.remindLater(seg[1], now), ...N.view(now) });
    }
    if (m === "POST" && seg[0] === "items" && seg[2] === "skip") {
      return h.json(res, 200, { item: N.skipItem(seg[1]), ...N.view(now) });
    }
    if (m === "POST" && seg[0] === "skip-all") return h.json(res, 200, N.skipAll());
    if (m === "POST" && seg[0] === "items" && seg[2] === "try") return h.json(res, 200, N.tryItem(seg[1]));
    if (m === "POST" && seg[0] === "items" && seg[2] === "connect") return h.json(res, 200, N.connectItem(seg[1]));
    if (m === "POST" && seg[0] === "suggestions" && seg[1] === "preview") return h.json(res, 200, N.previewSuggestion(body || {}));
    if (m === "POST" && seg[0] === "suggestions" && seg[1] === "send") {
      const out = await N.sendSuggestion(body || {});
      h.emit("log", { text: out.delivered ? "Suggestion delivered to the local stub." : "Suggestion saved on this computer." });
      return h.json(res, 200, out);
    }
    if (m === "POST" && seg[0] === "suggestions" && seg[1] === "files" && !seg[2]) return h.json(res, 200, N.attachPending(body || {}));
    if (m === "DELETE" && seg[0] === "suggestions" && seg[1] === "files" && seg[2]) return h.json(res, 200, N.forgetPending(seg[2]));
    if (m === "GET" && seg[0] === "files" && seg[1] && seg[2]) {
      const file = readIdeaFile(seg[1], seg[2]);
      if (!file) return h.json(res, 404, { error: "That file is not on this computer." });
      writeAttachment(res, file);
      return true;
    }
    if (m === "POST" && seg[0] === "suggestions" && seg[2] === "files") return h.json(res, 200, N.attachToIdea(seg[1], body || {}));
    if (m === "POST" && seg[0] === "suggestions" && seg[2] === "comments") return h.json(res, 200, N.addIdeaComment(seg[1], body?.text));
    if (m === "POST" && seg[0] === "suggestions" && seg[2] === "move") return h.json(res, 200, N.moveIdea(seg[1], body?.direction));
    if (m === "POST" && seg[0] === "suggestions" && seg[2] === "delete") return h.json(res, 200, N.deleteIdea(seg[1]));
    if (m === "POST" && seg[0] === "suggestions" && seg[1] && !seg[2]) return h.json(res, 200, N.updateIdea(seg[1], body || {}));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
