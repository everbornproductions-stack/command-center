// Manual handoff routes at /api/handoff. The registry and the prompt live in server/handoff.js.
// These routes never request a provider page and never read a clipboard.
import { handoffView, addTarget, updateTarget, removeTarget, buildForTarget, saveManualReply } from "../handoff.js";

export const id = "handoff";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/handoff/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, handoffView());
    if (m === "POST" && seg[0] === "targets" && !seg[1]) return h.json(res, 200, addTarget(body || {}));
    if ((m === "PATCH" || m === "POST") && seg[0] === "targets" && seg[1] && !seg[2]) return h.json(res, 200, updateTarget(decodeURIComponent(seg[1]), body || {}));
    if (m === "DELETE" && seg[0] === "targets" && seg[1] && !seg[2]) return h.json(res, 200, removeTarget(decodeURIComponent(seg[1])));
    if (m === "POST" && seg[0] === "prompt" && !seg[1]) {
      const built = await buildForTarget({ targetId: body?.targetId, threadId: body?.threadId, draft: body?.draft });
      return h.json(res, 200, built);
    }
    if (m === "POST" && seg[0] === "reply" && !seg[1]) {
      const saved = await saveManualReply({ targetId: body?.targetId, threadId: body?.threadId, text: body?.text, draft: body?.draft, confirm: body?.confirm });
      return h.json(res, 200, saved);
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
