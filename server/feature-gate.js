// Tier gate for smarter control. Older caps stay in server/license.js (guard).
// Extreme is read from the stored licence when that tier is not in the live table yet.
// This file does not call Square and does not change a price.

import { licenseState } from "./license.js";
import { doc } from "./store.js";

export const PRO_APPS = 3;
export const PRO_RECIPES = 5;
const PRO_PRICE = "$15.99/month";
const GRACE_MS = 7 * 24 * 3600 * 1000;

function fail(message, code) {
  const err = new Error(message);
  err.status = 402;
  err.code = code;
  return err;
}

// owner and studio come from the live licence table. extreme is accepted from the stored row
// so this workstream can tell Extreme apart before the public tier table is switched on.
export function currentTier(now = Date.now()) {
  const live = licenseState();
  if (live.tier === "owner" || live.tier === "studio" || live.tier === "extreme") return live.tier;
  const stored = doc("license", () => ({})) || {};
  const raw = String(stored.tier || "").toLowerCase();
  const seen = Number(stored.lastOkAt || stored.checkedAt || 0);
  const fresh = stored.status === "active" && seen > 0 && now <= seen + GRACE_MS;
  if (fresh && raw === "extreme") return "extreme";
  if (live.tier === "pro" || live.reason === "trial") return "pro";
  if (fresh && raw === "pro") return "pro";
  return "free";
}

function bucket(tier) {
  if (tier === "extreme" || tier === "owner") return "extreme";
  if (tier === "pro" || tier === "studio") return "pro";
  return "free";
}

export function limitsFor(tier = currentTier()) {
  const band = bucket(tier);
  const extreme = band === "extreme";
  const pro = band === "pro" || extreme;
  return {
    tier,
    band,
    learnTune: true,
    desktop: pro,
    desktopApps: extreme ? Infinity : pro ? PRO_APPS : 0,
    recipes: extreme ? Infinity : pro ? PRO_RECIPES : 0,
    budgetIncluded: extreme,
    phone: pro,
  };
}

export function gate(feature, info = {}) {
  const limits = limitsFor();
  if (feature === "learnTune" || feature === "phoneApprovals") return limits;
  if (feature === "desktop" || feature === "desktopApps") {
    if (!limits.desktop) throw fail(`Desktop control is part of Pro (${PRO_PRICE}). Add a licence key in Settings.`, "pro_required");
    const n = Number(info.count ?? 0);
    if (n >= limits.desktopApps) {
      throw fail(`Pro includes ${PRO_APPS} desktop control apps. Unlimited desktop control apps are part of Extreme.`, "extreme_required");
    }
    return limits;
  }
  if (feature === "recipes") {
    if (!limits.recipes) throw fail(`Recipes are part of Pro (${PRO_PRICE}), with a limit. Unlimited recipes are part of Extreme.`, "pro_required");
    const n = Number(info.count ?? 0);
    if (n >= limits.recipes) throw fail(`Pro includes ${PRO_RECIPES} recipes. Unlimited recipes are part of Extreme.`, "extreme_required");
    return limits;
  }
  if (feature === "budgetCap") {
    if (limits.budgetIncluded || info.optedIn) return limits;
    throw fail("A monthly budget cap is part of Extreme. Anyone else can turn it on in Settings.", "extreme_required");
  }
  if (limits[feature]) return limits;
  throw fail("This feature is part of Pro. Add a licence key in Settings.", "pro_required");
}
