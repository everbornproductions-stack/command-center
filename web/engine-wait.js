// What the window shows while the engine does not answer (0.4.25).
// A cold start with many missions takes about 30 s, and the old 15 s "engine is not responding" box fired on
// every slow launch. Now: in the first 90 s after the page started, a calm "starting up" line; the full box
// only after 45 s without an answer. Forced reasons (the desktop watchdog says stuck, the session does not
// match) still show the box at once. Pure, so tests can drive it with a fake clock.

export const ENGINE_BOX_MS = 45000;
export const STARTUP_GRACE_MS = 90000;
export const STARTING_LINE = "Meldmind is starting up. This can take up to a minute.";

// -> "ok" | "starting" | "reconnecting" | "box"
export function engineWaitView({ now = Date.now(), startedAt = now, downSince = 0, forced = false, local = true } = {}) {
  if (forced) return "box";
  if (!downSince) return "ok";
  if (now - downSince >= ENGINE_BOX_MS) return "box";
  if (local && now - startedAt < STARTUP_GRACE_MS) return "starting";
  return "reconnecting";
}
