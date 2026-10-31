// 0.4.28 (dogfood bash-rotate): a mission sat in "planning" for 20 minutes with no log line, no plan and no error.
// The planner call was awaited with no time limit, so one AI that never answered (an app on this PC, a stalled
// stream) held the whole mission. The watchdog gives each planner a fixed wait in real time. When no plan comes
// back in that time the call is stopped, a plain line says so, and the next planner gets one try. After a second
// failure the caller does the whole goal in one step with the best AI left, so a mission never waits forever.
// A planner app that says it hit its plan or session limit rests (server/cli-limit.js) before the next one is asked.
// No network, no disk of its own: the call and the rest step are handed in.
// plan-first.js and antigravity-cli.js are loaded only when a planner app has to rest: a static import here would close
// an import loop through mission.js (sub-routes.js, antigravity-cli.js and the router all load before it).
import { cliLimit } from "./cli-limit.js";

export const PLAN_WATCHDOG_MS = 3 * 60 * 1000; // a plan that has not come back in 3 minutes is not coming
export const PLAN_TRIES = 2; // the planner, then one other, then the one-step plan
export const ONE_STEP_LINE = "No plan came back in time, so Meldmind does the whole job in one step with the best AI that is free now.";

/** The wait for one planner (ms). CC_PLAN_WATCHDOG_MS overrides it, for tests. */
export function planWatchdogMs(env = process.env) {
  const n = Number(env.CC_PLAN_WATCHDOG_MS);
  return n > 0 ? n : PLAN_WATCHDOG_MS;
}

/** "3 minutes", "90 seconds", "1 minute". */
export function waitWords(ms) {
  const s = Math.max(1, Math.round(Number(ms) / 1000));
  if (s < 120 && s % 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** Is this error a plan, session or quota limit? Returns { until, words } or null. */
export function limitOf(err) {
  if (!err) return null;
  const lim = cliLimit(String(err.message || ""));
  const until = Number(err.until) || 0;
  if (lim) return { until: until || lim.until, words: lim.words || "" };
  if (err.limit === true || err.code === "quota") return { until: until || null, words: "" };
  return null;
}

/** Rest a planner app that hit its limit, until its own reset time (else a few hours). Only apps on this PC rest here. */
export async function restPlanner(provider, lim = {}, now = Date.now()) {
  const pid = String(provider || "");
  if (pid.startsWith("plan-")) { const { noteOutOfQuota } = await import("./plan-first.js"); noteOutOfQuota(pid.slice(5), now, lim.until || null); return true; }
  if (pid === "antigravity") { const { noteAgyLimit } = await import("./antigravity-cli.js"); noteAgyLimit(lim.until || null, now); return true; }
  return false; // an API AI: smart fallback already benched it
}

const TIMED_OUT = Symbol("plan-timed-out");

/**
 * Ask planners in turn, each with a fixed real-time wait.
 *  next(tried): the next planner { provider, model, providerName } not in `tried` (provider ids), or null
 *  call(planner, { signal, onProvider }): resolves the planner's reply. onProvider(pid) says who really answers (a stand-in).
 * Resolves { r, planner } with the reply, or { r: null, timedOut, tried, error } when no plan came back.
 * A failure that is neither a time-out nor a limit is thrown, as before. The mission's own Stop or Pause is thrown too.
 */
export async function planWithWatchdog({ first, next = () => null, call, timeoutMs = planWatchdogMs(), signal = null, log = () => {}, rest = restPlanner, tries = PLAN_TRIES, nameOf = (p) => p?.providerName || p?.provider || "The planner" } = {}) {
  const tried = [];
  let timedOut = false, error = null;
  let p = first || next(tried);
  for (let i = 0; i < tries && p; i++) {
    const ac = new AbortController();
    const onParent = () => ac.abort(signal?.reason);
    if (signal) { if (signal.aborted) onParent(); else signal.addEventListener("abort", onParent, { once: true }); }
    let current = p.provider, timer = null;
    const waitFor = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); });
    const work = Promise.resolve().then(() => call(p, { signal: ac.signal, onProvider: (pid) => { if (pid) current = pid; } }));
    work.catch(() => {}); // a stopped call may reject later; nobody waits for it then
    try {
      const r = await Promise.race([work, waitFor]);
      if (r !== TIMED_OUT) return { r, planner: p, tried };
      timedOut = true;
      ac.abort(new Error("plan watchdog"));
      log(`${nameOf(p)} did not send a plan within ${waitWords(timeoutMs)}, so Meldmind stopped waiting for it.`);
    } catch (e) {
      if (signal?.aborted) throw e;
      const lim = limitOf(e);
      if (!lim) throw e;
      error = e;
      let rested = false;
      try { rested = await rest(current, lim); } catch { rested = false; }
      log(`${nameOf(p)} is out of its plan's quota for now${rested ? ", so it rests" : ""}. Another AI draws up the plan.`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onParent);
    }
    tried.push(p.provider);
    if (current && current !== p.provider) tried.push(current);
    p = i + 1 < tries ? next(tried) : null;
  }
  if (!timedOut && error) throw error; // limits only and nobody else to ask: the mission fails in plain words, as before
  return { r: null, timedOut, tried, error };
}
