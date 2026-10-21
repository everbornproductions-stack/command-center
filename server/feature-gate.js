// One gate for tiers added after the live licence table.
// Free, Pro, Studio, and Owner still come from server/license.js.
// Extreme is read from a stored active licence row when that name is not in the live table yet.
// This file does not charge anyone and does not change a price.
import { licenseState } from "./license.js";
import { doc } from "./store.js";

export const PRO_PRICE = "$15.99/month";
export const TEAM_SEATS = 5;
const TAIL = " Add a licence key in Settings.";
const GRACE_MS = 7 * 24 * 3600 * 1000;

const ABOVE_PRO = new Set(["studio", "owner", "extreme"]);
const PRO_AND_UP = new Set(["pro", "studio", "owner", "extreme"]);

export const FEATURES = {
  secondOpinion: { tier: "free", label: "Second opinion" },
  industryPacks: { tier: "pro", label: "Industry packs" },
  teamSpaces: { tier: "above", label: "Team spaces" },
  teamSeats: { tier: "above", label: "Team spaces", cap: TEAM_SEATS },
  highlevelTools: { tier: "free", label: "HighLevel tools" },
  ownSupabase: { tier: "free", label: "Use your own Supabase" },
};

function fail(message, code, feature) {
  const err = new Error(message);
  err.status = 402;
  err.code = code;
  err.feature = feature;
  return err;
}

export function currentTier(now = Date.now()) {
  const live = licenseState();
  if (live.tier === "owner" || live.tier === "studio") return live.tier;
  const stored = doc("license", () => ({})) || {};
  const raw = String(stored.tier || "").toLowerCase();
  const seen = Number(stored.lastOkAt || stored.checkedAt || 0);
  const fresh = stored.status === "active" && seen > 0 && now <= seen + GRACE_MS;
  if (fresh && raw === "extreme") return "extreme";
  if (live.tier === "pro" || live.reason === "trial") return "pro";
  if (fresh && raw === "pro") return "pro";
  return live.tier === "free" ? "free" : (live.tier || "free");
}

function proMessage(label) {
  return `${label} is part of Pro (${PRO_PRICE}).${TAIL}`;
}

function aboveMessage() {
  return `Team spaces are a paid tier above Pro. Studio includes them. Free and Pro do not. The price is a placeholder and nothing is charged from here.${TAIL}`;
}

function seatMessage() {
  return `Team spaces include ${TEAM_SEATS} people total, counting the owner. This space is over that cap. The price above Pro is a placeholder and nothing is charged from here.`;
}

// Pure check. `tier` is free, pro, studio, owner, or extreme.
export function decide(tier, feature, info = {}) {
  const meta = FEATURES[feature];
  const name = meta?.label || "This feature";
  if (!meta) {
    return { ok: false, tier, feature, code: "pro_required", message: proMessage("This feature") };
  }
  if (meta.tier === "free") return { ok: true, tier, feature, code: "open" };
  if (meta.tier === "pro") {
    if (PRO_AND_UP.has(tier)) return { ok: true, tier, feature, code: "open" };
    return { ok: false, tier, feature, code: "pro_required", message: proMessage(name) };
  }
  if (!ABOVE_PRO.has(tier)) {
    return { ok: false, tier, feature, code: "studio_required", message: aboveMessage() };
  }
  if (feature === "teamSeats") {
    const n = Number(info.count ?? 0);
    if (n > TEAM_SEATS) return { ok: false, tier, feature, code: "seat_cap", message: seatMessage() };
  }
  return { ok: true, tier, feature, code: "open", limit: TEAM_SEATS };
}

export function access(feature, info = {}) {
  return decide(currentTier(), feature, info);
}

export function gate(feature, info = {}) {
  const row = access(feature, info);
  if (row.ok) return row;
  throw fail(row.message, row.code, feature);
}
