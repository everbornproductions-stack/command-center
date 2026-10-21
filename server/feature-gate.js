// Refocus gates. Find, the timeline, and the status labels are Pro.
// The rebuild mission is Extreme and has no cap. Owner can do both.
// This file does not read Square and it does not charge anything.
import { licenseState } from "./license.js";

export const FIND = "refocus";
export const REBUILD = "refocusRebuild";

const FIND_TIERS = new Set(["pro", "studio", "owner", "extreme"]);
const REBUILD_TIERS = new Set(["extreme", "owner"]);

const PRO_NOTE = "Refocus is part of Pro ($15.99/month). Add a licence key in Settings.";
const EXTREME_NOTE = "The full rebuild is part of Extreme. Your plan can find the work and list it. It does not start the rebuild.";

export function tierName(state = licenseState()) {
  const tier = String(state?.tier || "free");
  if (FIND_TIERS.has(tier) || tier === "free") return tier;
  return "free";
}

export function refocusGate(state = licenseState()) {
  const tier = tierName(state);
  const find = FIND_TIERS.has(tier);
  const rebuild = REBUILD_TIERS.has(tier);
  return {
    tier,
    find,
    timeline: find,
    status: find,
    rebuild,
    unlimited: rebuild,
    upgrade: find ? null : PRO_NOTE,
    rebuildUpgrade: rebuild ? null : (find ? EXTREME_NOTE : PRO_NOTE),
  };
}

function deny(message, code) {
  return Object.assign(new Error(message), { status: 402, code, upgrade: message });
}

export function assertRefocusFind(state = licenseState()) {
  const gate = refocusGate(state);
  if (!gate.find) throw deny(gate.upgrade, "pro_required");
  return gate;
}

export function assertRefocusRebuild(state = licenseState()) {
  const gate = refocusGate(state);
  if (!gate.rebuild) throw deny(gate.rebuildUpgrade, gate.find ? "extreme_required" : "pro_required");
  return gate;
}
