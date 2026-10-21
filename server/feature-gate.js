// Feature gates that sit beside the Phase 36 limits.
// Guided builders use Free, Pro, and Extreme. Studio follows Pro.
// Owner follows Extreme. This file does not set a price.
// Remix (pull request 92) adds its own gates in this same file.
// A merge should keep both sets of exports.

import { licenseState, TIERS } from "./license.js";

const RANK = { free: 0, pro: 1, studio: 1, extreme: 2, owner: 3 };

export function normalizeBuilderTier(tier) {
  const t = String(tier || "free").toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANK, t) ? t : "free";
}

export function builderTierRank(tier) {
  return RANK[normalizeBuilderTier(tier)] ?? 0;
}

function needRank(need) {
  const name = normalizeBuilderTier(need);
  if (name === "extreme" || name === "owner") return RANK.extreme;
  if (name === "pro" || name === "studio") return RANK.pro;
  return RANK.free;
}

export function builderGate({ tier = "free", need = "free" } = {}) {
  const haveName = normalizeBuilderTier(tier);
  const needName = normalizeBuilderTier(need);
  const have = builderTierRank(haveName);
  const want = needRank(needName);
  const haveLabel = TIERS[haveName]?.label || "Free";
  const asked = want >= RANK.extreme ? "extreme" : want >= RANK.pro ? "pro" : "free";
  if (have >= want) {
    return {
      ok: true, tier: haveName, need: asked, status: 200, code: null,
      message: asked === "free" ? "This builder is included." : `This builder is included on ${haveLabel}.`,
    };
  }
  if (asked === "extreme") {
    return { ok: false, tier: haveName, need: "extreme", status: 402, code: "extreme_required", message: "This builder is part of Extreme." };
  }
  return { ok: false, tier: haveName, need: "pro", status: 402, code: "pro_required", message: "This builder is part of Pro." };
}

export function assertBuilder(opts = {}) {
  const g = builderGate({ ...opts, tier: opts.tier ?? licenseState().tier });
  if (!g.ok) throw Object.assign(new Error(g.message), { status: g.status, code: g.code });
  return g;
}
