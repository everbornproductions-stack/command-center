// Extreme gate. Hosted runs (a schedule or a mission that keeps going while the
// PC is off) go through this file only. Owner includes Extreme. Free, Pro, and
// Studio do not. This does not set a price and it does not call Square.
import { licenseState } from "./license.js";

export const HOSTED_RUNS = "hostedRuns";
const YES = new Set(["extreme", "owner"]);

export function hostedRunsAllowed(tier) {
  return YES.has(String(tier || "").toLowerCase());
}

export function gateHostedRuns(tier) {
  const name = tier === undefined ? licenseState().tier : tier;
  if (hostedRunsAllowed(name)) return { tier: name, feature: HOSTED_RUNS, allowed: true };
  throw Object.assign(
    new Error("Running while this PC is off is part of Extreme. A schedule or mission stays on this computer until then."),
    { status: 402, code: "extreme_required" }
  );
}
