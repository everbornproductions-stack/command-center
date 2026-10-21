// Plain requests. Drafting calls a cheap model and does not touch Gmail or Calendar.
// Approve is the one click that sends the email and creates the event.
import { approve, draft, getDraft } from "../actions.js";

export const id = "actions";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/actions/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "POST" && p === "/draft") return h.json(res, 200, await draft(body?.text));
    if (m === "GET" && seg[0] && !seg[1]) return h.json(res, 200, getDraft(seg[0]));
    if (m === "POST" && seg[0] && seg[1] === "approve") return h.json(res, 200, await approve(seg[0], body || {}));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code, ...(e.cost != null ? { cost: e.cost, note: e.note } : {}) });
  }
  return false;
}
