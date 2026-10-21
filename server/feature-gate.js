// Tier gate for guided builders.
// Phase 91 still owns the public prices and the live Square checkout. This file
// only answers whether the current licence may open a builder.
//
// Ranks: free, then pro, then extreme.
// Licence tiers map like this:
//   free -> free
//   pro and studio -> pro (studio stays the teams flag)
//   owner and extreme -> extreme (an owner copy includes every builder)
//
// "extreme" is understood here even before the licence table grows a public
// Extreme row. Do not add prices in this file.

export const RANKS = { free: 0, pro: 1, extreme: 2 };

const TIER_RANK = {
  free: "free",
  pro: "pro",
  studio: "pro",
  owner: "extreme",
  extreme: "extreme",
};

export function rankName(tier) {
  return TIER_RANK[String(tier || "free").toLowerCase()] || "free";
}

export function allows(need, tier) {
  const want = RANKS[String(need || "free").toLowerCase()];
  const have = RANKS[rankName(tier)];
  if (want == null) return false;
  return have >= want;
}

export function tierLabel(tier) {
  const t = String(tier || "free").toLowerCase();
  if (t === "extreme") return "Extreme";
  if (t === "owner") return "Owner";
  if (t === "studio") return "Studio";
  if (t === "pro") return "Pro";
  return "Free";
}

export function lockMessage(need) {
  if (need === "extreme") return "This builder is part of Extreme.";
  if (need === "pro") return "This builder is part of Pro.";
  return "This builder is included.";
}

// Throws a 402 the plugin loader already turns into JSON.
export function assertTier(need, tier) {
  if (allows(need, tier)) return { tier, rank: rankName(tier) };
  const err = new Error(lockMessage(need));
  err.status = 402;
  err.code = "tier";
  err.need = need;
  throw err;
}
