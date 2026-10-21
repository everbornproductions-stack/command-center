// Phase 60 routes. The phone, or this PC, says yes before a send or a buy.
import { publicState, decide, pushPayload } from "../phone-approvals.js";

export const id = "phone-approvals";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/phone-approvals/, "") || "/";
  try {
    if (req.method === "GET" && (p === "/" || p === "")) return h.json(res, 200, publicState());
    if (req.method === "GET" && p.startsWith("/push/")) {
      const payload = pushPayload(p.slice("/push/".length));
      if (!payload) return h.json(res, 404, { error: "That approval is not waiting." });
      return h.json(res, 200, payload);
    }
    if (req.method === "POST" && p === "/decide") {
      return h.json(res, 200, decide(String(body?.id || ""), !!body?.yes, body?.from === "phone" ? "phone" : "pc"));
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
