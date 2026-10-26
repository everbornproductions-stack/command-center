// "I paid" re-check. After the person opens an Upgrade link, ask the license check again every few
// seconds for two minutes, and again whenever the window comes back into focus, until the tier goes
// up. No timers run until start() is called. check() returns the license state from the server
// (POST /api/license/recheck). Nothing here reads or logs an email or a key.
export const WATCH_EVERY_MS = 5000;
export const WATCH_FOR_MS = 2 * 60 * 1000;
export const TIER_RANK = { free: 0, pro: 1, studio: 1, extreme: 2, owner: 3 };

export const rankOf = (lic) => (lic && lic.status === "active" ? (TIER_RANK[lic.tier] ?? 0) : 0);

export function createPaidWatch({
  check, onUnlock, current = () => null,
  everyMs = WATCH_EVERY_MS, forMs = WATCH_FOR_MS,
  now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval,
} = {}) {
  let timer = null, endsAt = 0, base = 0, busy = false, lastRun = 0;

  async function run() {
    if (busy) return null;
    busy = true; lastRun = now();
    try {
      const lic = await check();
      if (rankOf(lic) > base) {
        base = rankOf(lic);
        stop();
        try { onUnlock?.(lic); } catch { /* the screen can fail without stopping the check */ }
      }
      return lic;
    } catch { return null; } finally { busy = false; }
  }

  function stop() { if (timer) clearTimer(timer); timer = null; endsAt = 0; }

  function start() {
    base = rankOf(current());
    endsAt = now() + forMs;
    if (timer) clearTimer(timer);
    timer = setTimer(() => { if (now() >= endsAt) stop(); else run(); }, everyMs);
    timer?.unref?.();
  }

  // Window focus: check right away while watching, and also when the copy is on Free or Pro (a
  // purchase may have happened in another browser). Not more than once per everyMs.
  function focus() {
    if (now() - lastRun < everyMs) return null;
    if (!timer) base = rankOf(current());
    if (!timer && rankOf(current()) >= TIER_RANK.extreme) return null;
    return run();
  }

  return { start, stop, focus, check: run, get watching() { return !!timer; } };
}
