// App connections (Zapier, Make, any MCP server by URL, custom webhooks).
// Free includes 1. Pro and Studio include several (5). Extreme and Owner are unlimited.
// This does not change Square, checkout, or the licence prices. Extreme is recognised
// from an active licence row even though the checkout does not sell it here.
import { licenseState, GRACE_MS } from "./license.js";
import { ctx } from "./store.js";

export const PRO_APP_CONNECTIONS = 5;

export function connectionLimit(tier) {
  const t = String(tier || "free").toLowerCase();
  if (t === "extreme" || t === "owner") return Infinity;
  if (t === "pro" || t === "studio") return PRO_APP_CONNECTIONS;
  return 1;
}

export function limitMessage(limit) {
  if (limit === 1) return "Free includes 1 app connection. Pro includes several (5). Extreme is unlimited.";
  return `This plan includes ${limit} app connections. Extreme is unlimited.`;
}

// The resolved licence tier, with an active Extreme row kept even when the tier table has no Extreme plan.
export function gateTier(now = Date.now()) {
  const s = licenseState();
  if (s.tier === "owner" || s.tier === "pro" || s.tier === "studio") return s.tier;
  let raw = null;
  try { raw = ctx().docs?.license || null; } catch { raw = null; }
  if (raw && String(raw.tier || "").toLowerCase() === "extreme" && raw.status === "active") {
    const lastOk = Number(raw.lastOkAt || raw.checkedAt || 0);
    let until = lastOk + GRACE_MS;
    if (raw.lastError && raw.periodEnd) {
      const pe = new Date(raw.periodEnd).getTime();
      if (!Number.isNaN(pe)) until = Math.min(until, pe);
    }
    if (lastOk && now <= until) return "extreme";
  }
  return "free";
}

export function assertRoom(count, tier = gateTier()) {
  const limit = connectionLimit(tier);
  if (count >= limit) {
    const err = new Error(limitMessage(limit));
    err.status = 402;
    err.code = "app_connection_limit";
    err.limit = limit;
    throw err;
  }
  return { tier, limit, used: count };
}

export function gateView(used) {
  const tier = gateTier();
  const limit = connectionLimit(tier);
  return {
    tier,
    limit: limit === Infinity ? null : limit,
    unlimited: limit === Infinity,
    used,
    remaining: limit === Infinity ? null : Math.max(0, limit - used),
  };
}
