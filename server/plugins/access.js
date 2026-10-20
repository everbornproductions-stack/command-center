// Save a provider's Free / Paid / Unknown plan. The router reads it; this plugin only stores it.
import { setPlan } from "../plans.js";

export const id = "access";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/access/, "").replace(/\/$/, "");
  if (req.method === "POST" && p === "/plan") {
    try {
      const info = setPlan(String(body.provider || ""), body.plan);
      return h.json(res, 200, { ok: true, ...info });
    } catch (e) {
      return h.json(res, e.status || 400, { error: e.message });
    }
  }
  return false;
}
