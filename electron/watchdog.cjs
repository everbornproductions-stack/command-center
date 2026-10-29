// Engine watchdog (v0.3.2). The main process probes the local server; if it has not answered for
// thresholdMs (default 15 s) it calls onStuck(reason) once per outage, so the person is offered
// "Restart app" and "Install update" from a native dialog and the tray even when the web UI is stuck
// on "reconnecting". onRecovered fires when it answers again. tick() is driven by a timer in
// main.cjs and directly by tests with a fake clock.
// 0.4.25: a cold start can keep the engine busy for about 30 s, so during the first startupMs after launch
// (startedAt) the limit is startupThresholdMs (45 s) instead of thresholdMs. After that the 15 s rule
// (locked decision 4) applies as before.
function createWatchdog({ probe, onStuck = () => {}, onRecovered = () => {}, thresholdMs = 15000, startupMs = 0, startupThresholdMs = 0, startedAt, now = () => Date.now() }) {
  let lastOk = now(), stuck = false, lastReason = null, busy = false;
  const launched = Number.isFinite(startedAt) ? startedAt : lastOk;
  const limitNow = () => (now() - launched < startupMs ? Math.max(thresholdMs, startupThresholdMs) : thresholdMs);
  async function tick() {
    if (busy) return { stuck, reason: lastReason };
    busy = true;
    try {
      let ok = false, reason = null;
      try { const r = await probe(); ok = r === true || (r && r.ok === true); if (!ok) reason = (r && r.reason) || "the engine did not answer"; }
      catch (e) { reason = e && e.message || String(e); }
      if (ok) {
        lastOk = now(); lastReason = null;
        if (stuck) { stuck = false; try { onRecovered(); } catch {} }
      } else {
        lastReason = reason;
        if (!stuck && now() - lastOk >= limitNow()) { stuck = true; try { onStuck(reason, now() - lastOk); } catch {} }
      }
      return { stuck, reason: lastReason };
    } finally { busy = false; }
  }
  // the window failed to load at all (no server): count as down from now
  function fail(reason) { lastReason = reason; }
  return { tick, fail, get stuck() { return stuck; }, get reason() { return lastReason; }, get downForMs() { return stuck || lastReason ? now() - lastOk : 0; }, get limitMs() { return limitNow(); } };
}

// Turn a fetch error into words a person can act on.
function describeProbeError(e, port) {
  const code = e && e.cause && (e.cause.code || (e.cause.errors && e.cause.errors[0] && e.cause.errors[0].code));
  if (e && (e.name === "AbortError" || e.name === "TimeoutError")) return `the engine on port ${port} is not responding (timed out)`;
  if (code === "ECONNREFUSED") return `nothing is listening on port ${port} (the engine stopped or never started)`;
  if (code) return `the engine on port ${port} could not be reached (${code})`;
  return `the engine on port ${port} could not be reached (${(e && e.message) || "unknown error"})`;
}

module.exports = { createWatchdog, describeProbeError };
