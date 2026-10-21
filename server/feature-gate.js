// Named product gates. Pro, Studio, and Owner get every Pro gate.
// Free gets only the gates marked free. license.js guard() asks assertGate()
// for these names, and the tier table copies flagsFor() so the UI can read them.
// Numeric limits (projects, councils, email accounts) stay in server/license.js.

export const GATES = {
  backgroundRuns: { min: "pro", label: "Background runs" },
  missionPause: { min: "pro", label: "Pause, edit and resume" },
  learnedFromRatings: { min: "free", label: "What ratings taught" },
};

const RANK = { free: 0, pro: 1, studio: 2, owner: 3 };
const PRO_PRICE = "$15.99/month";

export function gateAllows(tier, name) {
  const g = GATES[name];
  if (!g) return false;
  return (RANK[tier] ?? 0) >= (RANK[g.min] ?? 1);
}

export function flagsFor(tier) {
  const out = {};
  for (const name of Object.keys(GATES)) out[name] = gateAllows(tier, name);
  return out;
}

export function gateError(name) {
  const label = GATES[name]?.label || "This feature";
  return Object.assign(
    new Error(`${label} is part of Pro (${PRO_PRICE}). Add a licence key in Settings.`),
    { status: 402, code: "pro_required" },
  );
}

export function assertGate(tier, name) {
  if (!GATES[name]) {
    const err = new Error("This feature is part of Pro ($15.99/month). Add a licence key in Settings.");
    err.status = 402;
    err.code = "pro_required";
    throw err;
  }
  if (!gateAllows(tier, name)) throw gateError(name);
}
