// Phase 59 routes. The monthly budget cap.
import { clearBudgetTrouble } from "../fallback.js";
import { publicState, saveGuard, continuePlus, continueChoices, budgetTest } from "../cost-guard.js";

export const id = "cost-guard";

// A bigger budget means any AI marked "out of credits" only because of our own budget text is free again.
function withCleared(state) {
  const cleared = clearBudgetTrouble();
  return cleared.length ? { ...state, clearedProviders: cleared, clearedNote: "Your budget went up, so the AIs that were paused by the old limit are back." } : state;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/cost-guard/, "") || "/";
  try {
    if (req.method === "GET" && (p === "/" || p === "")) return h.json(res, 200, publicState());
    if (req.method === "GET" && p === "/choices") return h.json(res, 200, continueChoices());
    if (req.method === "POST" && p === "/test") return h.json(res, 200, budgetTest({ estimate: body?.estimate }));
    if (req.method === "POST" && p === "/continue") return h.json(res, 200, withCleared(continuePlus(body?.amount ?? 1)));
    if (req.method === "POST" && (p === "/" || p === "")) return h.json(res, 200, body?.cap != null ? withCleared(saveGuard(body)) : saveGuard(body || {}));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
