// When the hosted hub's container should wake up for schedules (see docs/hosted-hub.md, "Schedules on the hub").
// No Cloudflare imports here, so node tests can load it. worker/index.js gives these functions a "host":
//   get(key) / put(key, value)   Durable Object storage
//   armedAt()                    the time (ms) of the pending wake-up, or null
//   arm(at) / disarm()           set or clear the one pending wake-up (a Durable Object alarm through
//                                Container.schedule, which does not start the container by itself)
//   tick()                       POST the tick route on the container (this starts it) and return the Response
//
// Cost rule: the container is started only for (a) a schedule that is due, (b) one refresh a day,
// (c) a retry an hour after a failed tick. The 15-minute cron only reads storage.
export const CLOCK_CALLBACK = "runScheduleTick";
export const TICK_PATH = "/api/internal/schedules/tick";
export const TICK_HEADER = "x-cc-tick-secret";
export const NEXT_DUE_HEADER = "x-cc-next-due";
export const REFRESH_MS = 24 * 3600 * 1000;   // re-read every schedule from Supabase once a day
export const RETRY_MS = 3600 * 1000;          // after a failed tick, try again in an hour (never every 15 minutes)
export const GRACE_MS = 2 * 60 * 1000;        // an armed wake-up this late is treated as lost and the cron ticks
export const STALE_MS = 15 * 60 * 1000;       // a stored time this old is replaced by a newer hint

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

export function hubUrl(env) {
  return String(env?.CC_HUB_URL || "").trim().replace(/\/$/, "") || "http://hub.internal";
}

// The tick request sent to the container. CC_TICK_SECRET is a wrangler secret, never written into wrangler.jsonc.
export function tickRequest(env) {
  return new Request(`${hubUrl(env)}${TICK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [TICK_HEADER]: env?.CC_TICK_SECRET || "" },
  });
}

// What the 15-minute cron does. Pure: no storage, no network.
export function planCron({ nextDue, lastTickAt, now, refreshMs = REFRESH_MS }) {
  const last = num(lastTickAt), due = num(nextDue);
  if (!Number.isFinite(last)) return { action: "tick", why: "first run" };
  if (now - last >= refreshMs) return { action: "tick", why: "daily refresh" };
  if (!Number.isFinite(due)) return { action: "sleep", why: "no schedules" };
  if (due <= now - GRACE_MS) return { action: "tick", why: "wake-up was missed" };
  return { action: "arm", at: due, why: "waiting for the next schedule" };
}

// A schedule change on the hub sends the user's earliest next slot. Keep the earlier of the two times,
// unless the stored one is old (then the hint is the newer information).
export function mergeHint(stored, hint, now) {
  const h = num(hint), s = num(stored);
  if (!Number.isFinite(h) || h <= 0) return Number.isFinite(s) ? s : null;
  if (!Number.isFinite(s) || s < now - STALE_MS) return h;
  return Math.min(s, h);
}

async function ensureArmed(host, at) {
  const cur = num(await host.armedAt());
  if (Number.isFinite(cur) && Math.floor(cur / 1000) === Math.floor(at / 1000)) return false;
  await host.arm(at);
  return true;
}

// Start the container, run due schedules, and store when the next one is due.
export async function runTick(host, now = Date.now()) {
  let body = null, problem = "";
  try {
    const res = await host.tick();
    if (res && res.ok) body = await res.json().catch(() => null);
    else problem = `tick answered ${res ? res.status : "nothing"}`;
    if (res && res.ok && !body) problem = "tick answered without JSON";
  } catch (e) {
    problem = `tick failed: ${e && e.message ? e.message : e}`;
  }
  await host.put("lastTickAt", now);
  if (!body) {
    // 401 (no CC_TICK_SECRET), 404, or a container that did not start: retry in an hour, not every 15 minutes.
    console.error(`[hub-clock] ${problem}; next try in an hour`);
    const retry = now + RETRY_MS;
    await host.put("nextDue", retry);
    await ensureArmed(host, retry);
    return { ok: false, problem, nextDue: retry };
  }
  const nd = Number.isFinite(num(body.nextDue)) ? num(body.nextDue) : null;
  await host.put("nextDue", nd);
  if (nd === null) await host.disarm();
  else await ensureArmed(host, nd);
  return { ok: true, runs: Number(body.runs) || 0, nextDue: nd };
}

export async function onCron(host, now = Date.now()) {
  const plan = planCron({ nextDue: await host.get("nextDue"), lastTickAt: await host.get("lastTickAt"), now });
  if (plan.action === "tick") return { ...plan, result: await runTick(host, now) };
  if (plan.action === "arm") await ensureArmed(host, plan.at);
  return plan;
}

export async function onHint(host, hint, now = Date.now()) {
  const stored = await host.get("nextDue");
  const next = mergeHint(stored, hint, now);
  if (next !== null && next !== num(stored)) {
    await host.put("nextDue", next);
    await ensureArmed(host, next);
  }
  return next;
}
