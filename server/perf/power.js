// Idle, battery, and Light mode. The scheduler reads this before each job.
// Electron sets __ccPerf.battery and __ccPerf.hidden in the same process.
// Tests set CC_ON_BATTERY=1. A missing flag means plugged in.

const HIDDEN_MS = 60 * 1000;
const QUIET_MS = 120 * 1000;

let lastActivity = Date.now();
let readers = {
  light: () => false,
  sockets: () => 0,
};

export function bindPerf(next = {}) {
  readers = { ...readers, ...next };
}

export function noteActivity(now = Date.now()) {
  lastActivity = now;
}

export function perfState(now = Date.now()) {
  const g = globalThis.__ccPerf || {};
  let battery = false;
  if (process.env.CC_ON_BATTERY === "1") battery = true;
  else if (process.env.CC_ON_BATTERY === "0") battery = false;
  else battery = g.battery === true;
  const sockets = Number(readers.sockets?.() || 0);
  const hiddenFor = g.hidden ? now - (Number(g.hiddenAt) || now) : 0;
  const hidden = g.hidden === true && hiddenFor >= HIDDEN_MS;
  const quiet = sockets <= 0 && now - lastActivity >= QUIET_MS;
  let light = false;
  try { light = !!readers.light?.(); } catch { light = false; }
  return { light, battery, idle: hidden || quiet, sockets };
}

export const IDLE_AFTER_MS = QUIET_MS;
export const HIDDEN_AFTER_MS = HIDDEN_MS;
