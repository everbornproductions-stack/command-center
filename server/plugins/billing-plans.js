// GET /api/billing-plans: the monthly, yearly, and lifetime founder choices.
// Reads an optional founder-seats.json count from this install's data folder.
// Never calls Square and never charges.
import { ctx } from "../store.js";
import { proPlanCatalog } from "../billing-plans.js";

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
  return proPlanCatalog(founderSold());
}

export async function routes(req, res, url, _body, h) {
  const seg = url.pathname.replace(/^\/api\/billing-plans\/?/, "").split("/").filter(Boolean);
  if (req.method === "GET" && seg.length === 0) {
    h.json(res, 200, currentPlans());
    return true;
  }
  return false;
}
