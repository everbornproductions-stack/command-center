// Labels shared by the strip and the provider list. No browser globals, so tests can import it.
export const PAUSE_LABEL = "Out of credits";
export const RATE_LABEL = "Rate limited";
export const CHECK_AGAIN_TITLE = "A one word test. If you have no credits it costs nothing.";

const CREDIT_RE = /out of credits|spending limit|spend limit|payment required|no credits|rate limited|rate or quota limit/;
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

// "Out of credits" for credits, "Rate limited" for a plain slow-down. Always red on the bar.
export function pauseLabelFor(detail = "") {
  const d = String(detail || "").toLowerCase();
  return /rate limited|rate or quota limit/.test(d) && !/credit|spending limit|payment required|no credits/.test(d) ? RATE_LABEL : PAUSE_LABEL;
}
export function pauseLabel(p) { return p?.access?.pause?.label || pauseLabelFor(p?.status?.detail); }
// "Checks again in 15 min" and what is left, when the engine knows them
export function pauseNext(p) { return p?.access?.pause?.nextCheckText || ""; }
export function creditsText(p) { return p?.access?.credits?.text || ""; }
