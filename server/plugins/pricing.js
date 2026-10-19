// Live model pricing (Phase 24): Settings > Model prices. The table itself is server/live-pricing.js.
//   GET    /api/pricing/live                 every model: built-in, live (OpenRouter), your own and the price in use
//   POST   /api/pricing/live/refresh         fetch now (a click; otherwise once a day)
//   POST   /api/pricing/live/settings        { on } use live prices or not (local mode; the hub follows CC_LIVE_PRICING)
//   DELETE /api/pricing/override/<model>     drop your own price for a model so the live one (or built-in) applies again
// Your own price is still set with POST /api/pricing (Settings > models) and always wins.
import { loadSaved, refresh, setOn, startLoop, view, knownModel } from "../live-pricing.js";
import { clearPricing } from "../registry.js";

export const id = "pricing";

export function init(h) {
  if (!h.HOSTED) loadSaved();
  startLoop();
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/pricing/, "").replace(/\/$/, "");
  const m = req.method;
  if (m === "GET" && p === "/live") return h.json(res, 200, view());
  if (m === "POST" && p === "/live/refresh") {
    const v = await refresh({ force: true });
    if (!v.error) h.emit("log", { text: `Model prices updated from OpenRouter (${v.matched} models matched).` });
    return h.json(res, v.error ? 502 : 200, v);
  }
  if (m === "POST" && p === "/live/settings") {
    if (h.HOSTED) return h.json(res, 400, { error: "On the hub, live prices are set by the hub owner (CC_LIVE_PRICING)." });
    if (typeof body.on !== "boolean") return h.json(res, 400, { error: "on must be true or false" });
    return h.json(res, 200, setOn(body.on));
  }
  const o = p.match(/^\/override\/(.+)$/);
  if (m === "DELETE" && o) {
    const model = decodeURIComponent(o[1]);
    if (!knownModel(model)) return h.json(res, 404, { error: "unknown model" });
    return h.json(res, 200, { ok: true, removed: clearPricing(model), view: view() });
  }
  return false;
}
