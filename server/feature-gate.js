// Pro gate for public share links, PDF and Word export, and industry packs.
// Free stays closed. Pro, Studio, Owner, and a running Pro trial are open.
// This does not charge anyone and does not touch Square.
import { TIERS, licenseState } from "./license.js";

export const FEATURES = {
  publicShare: "Public share links",
  documentExport: "PDF and Word export",
  industryPacks: "Industry packs",
};

export function featureOpen(id) {
  const label = FEATURES[id] || "This feature";
  const s = licenseState();
  const T = TIERS[s.tier] || TIERS.free;
  const ok = !!FEATURES[id] && !!T[id];
  return { ok, tier: s.tier, feature: id, label, code: ok ? "open" : "pro_required" };
}

export function requirePro(id) {
  const r = featureOpen(id);
  if (r.ok) return r;
  const err = new Error(`${r.label} is part of Pro ($15.99/month). Add a licence key in Settings.`);
  err.status = 402;
  err.code = "pro_required";
  err.feature = id;
  throw err;
}
