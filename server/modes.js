// Priority for a run: how the router trades quality, price and speed.
// "economy" is the old name for Max savings. A registry model tier named economy
// is a different thing (a cheap model) and is not a priority.

export const PRIORITY_MODES = ["quality", "balanced", "savings", "speed"];
const PRIORITY = new Set(PRIORITY_MODES);

export const MODE_LABEL = {
  quality: "Quality",
  balanced: "Balanced",
  savings: "Max savings",
  speed: "Speed",
};

// Cost penalty inside rank() and "who's best". Speed still notices price, less than Balanced.
export const COST_WEIGHT = { quality: 0.15, balanced: 0.5, savings: 1.1, speed: 0.35, economy: 1.1 };
// Learned latency penalty. Speed cares the most. With no track record that penalty is 0,
// so rank() also adds a registry speed bonus while the mode is Speed.
export const LATENCY_WEIGHT = { quality: 0.3, balanced: 0.8, savings: 0.6, speed: 1.6, economy: 0.6 };

export function normalizeMode(mode) {
  const v = String(mode ?? "").trim().toLowerCase();
  if (v === "economy") return "savings";
  return PRIORITY.has(v) ? v : null;
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
  return "quality";
}

// A second look at the work: Quality steps down to Balanced, Speed stays fast, the rest save.
export function reviewMode(mode) {
  const m = normalizeMode(mode) || "balanced";
  if (m === "quality") return "balanced";
  if (m === "speed") return "speed";
  return "savings";
}
