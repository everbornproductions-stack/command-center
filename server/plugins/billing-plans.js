// GET /api/billing-plans: the monthly, yearly, and lifetime founder choices.
// Reads an optional founder-seats.json count from this install's data folder.
// Never calls Stripe and never charges.
import { ctx } from "../store.js";
import { proPlanCatalog } from "../billing-plans.js";
import { featureBuilt } from "../feature-gate.js";
import { signedInEmail } from "../signed-in-email.js";

export const id = "billing-plans";

export function founderSold() {
  try {
    const d = ctx().docs?.["founder-seats"];
    if (!d || d.sold == null || d.sold === "") return null;
    const n = Number(d.sold);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  } catch {
    return null;
  }
}

export function currentPlans() {
  return proPlanCatalog(founderSold(), { email: signedInEmail() });
}

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/billing-plans\/?/, "").split("/").filter(Boolean);
  if (req.method === "GET" && seg.length === 0) {
    h.json(res, 200, currentPlans());
    return true;
  }
  // Gate check only. No screen, no Stripe call, no charge.
  if (req.method === "POST" && seg[0] === "check") {
    const feature = body?.feature;
    if (!feature) return h.json(res, 400, { error: "feature required" });
    try {
      h.guard(feature, body || {});
      return h.json(res, 200, { ok: true, feature, built: featureBuilt(feature) });
    } catch (e) {
      return h.json(res, e.status || 402, { error: e.message, code: e.code, built: e.built });
    }
  }
  return false;
}
