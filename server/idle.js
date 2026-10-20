// Hosted mode only: drop a user's in-memory context after they have been idle.
// The next request loads them again from Supabase (server/auth.js). Local mode never evicts.
// CC_IDLE_EVICT_MIN is the idle time in minutes (default 30). Tests pass a fake clock as `now`.
import { HOSTED, allContexts, dropContext } from "./store.js";

export function idleMs(env = process.env) {
  const n = Number(env.CC_IDLE_EVICT_MIN);
  const min = Number.isFinite(n) && n > 0 ? n : 30;
  return min * 60 * 1000;
}

// Why this user must stay in memory. Empty means they may be evicted.
export function busyReasons(c, { sockets = 0 } = {}) {
  const reasons = [];
  // missionsInFlight: a mission executing now. scheduled: an off-peak mission whose timer still belongs to this context.
  if ((c.missionsInFlight || 0) > 0 || (c.scheduled && c.scheduled.size > 0)) reasons.push("mission");
  if ((c.councilsInFlight || 0) > 0) reasons.push("council");
  if ((c.mediaJobsInFlight || 0) > 0) reasons.push("media");
  if ((c.chatsInFlight || 0) > 0) reasons.push("chat");
  if ((sockets || 0) > 0 || (c.openSockets || 0) > 0) reasons.push("socket");
  if (typeof c.store?.hasPending === "function" && c.store.hasPending()) reasons.push("writes");
  return reasons;
}

// Evict every hosted context that has been idle for `idle` ms at time `now`.
// Never evicts while a mission, council, chat or media job is running, a WebSocket is open,
// or a cloud write is still pending. Pending writes are flushed first; a failed flush stays.
export async function evictIdle({ now = Date.now(), idle = idleMs(), hosted = HOSTED, socketCount = () => 0 } = {}) {
  if (!hosted) return [];
  const evicted = [];
  for (const c of allContexts()) {
    if (!c?.userId || c.userId === "local" || !c.ready) continue;
    const seen = c.lastSeen || c.createdAt || now;
    if (now - seen < idle) continue;
    const sockets = () => (socketCount(c) || 0);
    if (busyReasons(c, { sockets: sockets() }).some((r) => r !== "writes")) continue;
    if (typeof c.store?.flush === "function") {
      try { await c.store.flush(); }
      catch (e) { console.error(`[idle] flush failed for ${c.email || c.userId}: ${e.message}`); continue; }
    }
    if (busyReasons(c, { sockets: sockets() }).length) continue;
    dropContext(c.userId);
    evicted.push(c.userId);
    console.log(`[idle] evicted ${c.email || c.userId} after ${Math.round((now - seen) / 60000)} min idle`);
  }
  return evicted;
}
