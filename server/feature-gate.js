// Plan gates that sit beside the Phase 36 limits.
// Builders ask this file which tier a tool needs.
// Remix (Phase 96) can add its own functions here.
// Nothing here sets a price or calls Square.

import { licenseState, TIERS } from "./license.js";

const RANK = { free: 0, pro: 1, studio: 1, extreme: 2, owner: 3 };

export function tierRank(tier) {
  const t = String(tier || "free").toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANK, t) ? RANK[t] : 0;
}

export function planLabel(tier) {
  const t = String(tier || "free").toLowerCase();
  if (TIERS[t]?.label) return TIERS[t].label;
  if (t === "extreme") return "Extreme";
  return "Free";
}

// need is "free", "pro", or "extreme". Studio counts as Pro. Owner counts as every tier.
export function builderGate(need, tier = licenseState().tier) {
  const want = String(need || "free").toLowerCase();
  const have = String(tier || "free").toLowerCase();
  const ok = tierRank(have) >= tierRank(want === "studio" ? "pro" : want);
  const needLabel = planLabel(want);
  const haveLabel = planLabel(have);
  if (ok) {
    return {
      ok: true, status: 200, code: null, tier: have, need: want,
      message: `${needLabel} tools are included on ${haveLabel}.`,
    };
  }
  return {
    ok: false, status: 402, code: "plan_required", tier: have, need: want,
    message: `This is part of ${needLabel}. You are on ${haveLabel}.`,
  };
}

export const PUBLISH_NEEDS = {
  local: "free",
  netlify: "pro",
  vercel: "pro",
  postiz: "pro",
  listmonk: "pro",
  mautic: "pro",
  highlevel: "pro",
};

export function publishGate(target, tier = licenseState().tier) {
  const key = String(target || "local").toLowerCase();
  const need = Object.prototype.hasOwnProperty.call(PUBLISH_NEEDS, key) ? PUBLISH_NEEDS[key] : "pro";
  const gate = builderGate(need, tier);
  if (gate.ok) return { ...gate, target: key };
  return {
    ...gate,
    target: key,
    message: key === "local"
      ? gate.message
      : `Publishing to ${key} is part of ${planLabel(need)}. You are on ${planLabel(tier)}. Nothing was sent.`,
  };
}
