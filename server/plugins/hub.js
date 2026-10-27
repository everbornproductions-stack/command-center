// GET  /api/hub            what works across two computers, what needs one setup step, what is coming
//                          (and, for the owner, the Owner checklist)
// POST /api/hub/checklist  { id, done }  owner only: tick an item by hand
import { hubFeatures } from "../hub-supabase.js";
import { sbState } from "../reportback.js";
import { checklist, mark } from "../owner-checklist.js";

export const id = "hub";

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/hub\/?/, "").split("/").filter(Boolean);
  const owner = h.licenseState().tier === "owner";
  if (req.method === "GET" && !seg.length) {
    const sqlSeen = { reportback: sbState.sql === null ? undefined : sbState.sql };
    return h.json(res, 200, { features: hubFeatures({ sqlSeen }), owner, checklist: owner ? checklist() : undefined });
  }
  if (req.method === "POST" && seg[0] === "checklist") {
    if (!owner) return h.json(res, 403, { error: "Only the owner can tick these." });
    try { return h.json(res, 200, { checklist: mark(String(body?.id || ""), body?.done !== false) }); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message }); }
  }
  return false;
}
