// Labels shared by the strip and the provider list. No browser globals, so tests can import it.
export const PAUSE_LABEL = "Paused: no credits";

const CREDIT_RE = /out of credits|spending limit|spend limit|payment required|no credits|rate limited/;
const KEY_RE = /key rejected|invalid api key|incorrect api key/;

export function isPausedStatus(status, detail = "") {
  const d = String(detail || "").toLowerCase();
  if (!CREDIT_RE.test(d) || KEY_RE.test(d)) return false;
  return status === "amber" || status === "red";
}

export function pausedNow(p) {
  if (!p) return false;
  if (p.access?.paused) return true;
  return isPausedStatus(p.status?.status, p.status?.detail);
}

export function quietProvider(p) {
  if (!p) return false;
  if (pausedNow(p)) return true;
  const auth = p.access?.auth;
  if ((auth === "mcp" || auth === "oauth") && p.access?.connected === false) return true;
  return false;
}
