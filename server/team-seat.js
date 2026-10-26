// Seat cap for team spaces (Phase 61).
// server/feature-gate.js is the table: Extreme and Owner get 5 seats.
// Free, Pro, and Studio get none. A Studio licence is Pro, not Extreme.
// This file calls that gate when it is present, and uses the same numbers when it is not.
// Phase 8 workspaces stay on their own permission set.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { licenseState } from "./license.js";

export const EXTREME_TEAM_SEATS = 5;
const EXTREME_LIKE = new Set(["extreme", "owner"]);
const gateFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "feature-gate.js");

let loaded;
async function loadGate() {
  if (loaded !== undefined) return loaded;
  if (!fs.existsSync(gateFile)) { loaded = null; return null; }
  try { loaded = await import("./feature-gate.js"); }
  catch { loaded = null; }
  return loaded;
}

function fallback(tier, occupied) {
  const limit = EXTREME_LIKE.has(tier) ? EXTREME_TEAM_SEATS : 0;
  if (occupied < limit) return { ok: true, feature: "teamSeats", tier, limit, seats: EXTREME_TEAM_SEATS, source: "fallback" };
  // At the top cap, nothing higher is for sale, so the code matches evaluateGate
  // (sellingTier falls through to pro). With no seats at all, the step up is Extreme.
  const topped = limit > 0;
  return {
    ok: false, feature: "teamSeats", tier, limit, seats: EXTREME_TEAM_SEATS, source: "fallback",
    code: topped ? "pro_required" : "extreme_required",
    message: topped
      ? `Extreme includes ${EXTREME_TEAM_SEATS} seats. This team is full.`
      : `Team spaces are part of Extreme. Extreme includes ${EXTREME_TEAM_SEATS} seats. Add a license key in Settings.`,
  };
}

// occupied is how many seats are taken before this change, counting the owner.
// Pass gateMod in tests. Omit it in the app so the real gate is used when it exists.
// 0.4.21 wording. A full team says how many seats are used and how to free one. A buyer who already has a
// license (Pro or Studio) is told to upgrade, never to "add a license key". Free is the only plan told to add one.
export function seatMessage(result, tier, n) {
  if (result.ok) return result.message;
  const limit = Number(result.limit) || 0;
  if (limit > 0) return `${n} of ${limit} seats used. Remove someone to invite another.`;
  if (tier === "pro" || tier === "studio") return `Team spaces are part of Extreme. You are on ${tier === "studio" ? "Studio" : "Pro"}, so open Settings > Your plan to move up. Extreme includes ${EXTREME_TEAM_SEATS} people total, counting you.`;
  return result.message;
}

export async function seatCheck(occupied, { gateMod, tier } = {}) {
  const current = tier || licenseState().tier;
  const n = Math.max(0, Number(occupied) || 0);
  const g = gateMod === undefined ? await loadGate() : gateMod;
  if (g?.evaluateGate && g?.LIMITS) {
    const limits = g.LIMITS[current] || g.LIMITS.free || { teamSeats: 0, label: current || "Free" };
    const result = g.evaluateGate(limits, "teamSeats", { seats: n });
    const raw = limits.teamSeats;
    const limit = raw === Infinity ? Infinity : Number(raw) || 0;
    const out = { ...result, tier: current, limit, seats: g.EXTREME_TEAM_SEATS || EXTREME_TEAM_SEATS, source: "feature-gate" };
    if (!out.ok) out.message = seatMessage(out, current, n);
    return out;
  }
  const out = fallback(current, n);
  if (!out.ok) out.message = seatMessage(out, current, n);
  return out;
}

export async function assertSeats(occupied, opts) {
  const r = await seatCheck(occupied, opts);
  if (!r.ok) throw Object.assign(new Error(r.message), { status: 402, code: r.code || "extreme_required" });
  return r;
}
