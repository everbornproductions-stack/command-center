// Growth routes (Phase 9). The work lives in server/growth.js; every part is behind its own flag.
//   GET  /api/growth                       flags, trial counter, credits, managed usage, referrals, upgrade prompt
//   POST /api/growth/trial/start           start the free trial (once per install)
//   POST /api/growth/managed { on }        turn the managed plan on or off
//   POST /api/growth/referrals/redeem { code }
//   POST /api/growth/referrals/refresh     ask the licence server how many friends joined
import * as G from "../growth.js";

export const id = "growth";

// every ledger line made through the managed pool is metered and drawn from the credits
export function onEvent(ev) {
  if (ev.type === "ledger.entry" && ev.entry?.managed) G.meter(ev.entry);
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/growth\/?/, "");
  const m = req.method;
  try {
    if (m === "GET" && p === "") return h.json(res, 200, G.overview());
    if (m === "POST" && p === "trial/start") return h.json(res, 200, G.startTrial());
    if (m === "POST" && p === "managed") return h.json(res, 200, G.setManaged(!!body?.on));
    if (m === "POST" && p === "referrals/redeem") return h.json(res, 200, await G.redeemReferral(body?.code));
    if (m === "POST" && p === "referrals/refresh") return h.json(res, 200, await G.refreshReferrals());
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
