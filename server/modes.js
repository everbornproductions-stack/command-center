// Priority for a run: how the router trades quality, price and speed.
// "economy" is the old name for Max savings. A registry model tier named economy
// is a different thing (a cheap model) and is not a priority.

export const PRIORITY_MODES = ["max", "quality", "balanced", "savings", "speed"];
const PRIORITY = new Set(PRIORITY_MODES);

export const MODE_LABEL = {
  max: "Max quality",
  quality: "Quality",
  balanced: "Balanced",
  savings: "Max savings",
  speed: "Speed",
};

// Cost penalty inside rank() and "who's best". Speed still notices price, less than Balanced.
// Max quality barely notices price so the best model can win, and spend caps still apply outside this weight.
export const COST_WEIGHT = { max: 0.05, quality: 0.15, balanced: 0.5, savings: 1.1, speed: 0.35, economy: 1.1 };
// Learned latency penalty. Speed cares the most. With no track record that penalty is 0,
// so rank() also adds a registry speed bonus while the mode is Speed.
export const LATENCY_WEIGHT = { max: 0.2, quality: 0.3, balanced: 0.8, savings: 0.6, speed: 1.6, economy: 0.6 };

export function normalizeMode(mode) {
  const v = String(mode ?? "").trim().toLowerCase();
  if (v === "economy") return "savings";
  if (v === "max quality" || v === "max-quality" || v === "maxquality") return "max";
  return PRIORITY.has(v) ? v : null;
}

// Longer answer and higher reasoning for Max quality. Other modes keep the caller's token budget.
// Spend caps are unchanged: a provider at its cap is still not called.
export function outputShape(mode) {
  if (normalizeMode(mode) !== "max") return { maxTokens: null, effort: null };
  return { maxTokens: 8000, effort: "high" };
}

const TIER_RANK = { flagship: 3, balanced: 2, economy: 1 };

function modelBeats(a, b, capability) {
  const ta = TIER_RANK[a?.tier] ?? 0;
  const tb = TIER_RANK[b?.tier] ?? 0;
  if (ta !== tb) return ta > tb;
  return (a?.caps?.[capability] || 0) > (b?.caps?.[capability] || 0);
}

// One model per connected provider: the highest tier, then the stronger one at that tier.
export function bestModelEach(models, capability = "reasoning") {
  const best = new Map();
  for (const m of models || []) {
    if (!m?.provider) continue;
    const prev = best.get(m.provider);
    if (!prev || modelBeats(m, prev, capability)) best.set(m.provider, m);
  }
  return [...best.values()];
}

export function costWeight(mode) {
  return COST_WEIGHT[normalizeMode(mode) || "balanced"];
}

export function latencyWeight(mode) {
  return LATENCY_WEIGHT[normalizeMode(mode) || "balanced"];
}

// Points added in Speed from the registry speed score (0-100). No learned latency yet.
export function speedBoost(mode, fast) {
  if (normalizeMode(mode) !== "speed") return 0;
  const n = Number(fast);
  if (!Number.isFinite(n)) return 0;
  return +((n - 60) * 0.55).toFixed(2);
}

// An explicit priority wins over the old lite flag.
// Max savings, or lite with no priority, uses three members. The others use four.
export function councilPlan(mode, lite = false) {
  const explicit = normalizeMode(mode);
  const priority = explicit || (lite ? "savings" : "balanced");
  const slim = priority === "savings" || (!!lite && !explicit);
  return { priority, members: slim ? 3 : 4 };
}

// Planning and assembly stay on a strong model in Max savings (the old economy behaviour).
// Speed uses the fast pick. Quality and Balanced plan at quality.
export function planMode(mode) {
  const m = normalizeMode(mode) || "balanced";
  if (m === "savings") return "balanced";
  if (m === "speed") return "speed";
  if (m === "max") return "max";
  return "quality";
}

// A second look at the work: Max quality steps down to Quality, Quality to Balanced, Speed stays fast.
export function reviewMode(mode) {
  const m = normalizeMode(mode) || "balanced";
  if (m === "max") return "quality";
  if (m === "quality") return "balanced";
  if (m === "speed") return "speed";
  return "savings";
}
