// Seat cap for team spaces (Phase 61).
// Pull request 84 owns server/feature-gate.js and marks teamSeats as a gate
// (Extreme, Studio, and Owner: 5 seats; Free and Pro: none). This file calls
// that gate when it is present, and uses the same numbers when it is not.
// The screen ships here either way. Phase 8 workspaces stay on their own Studio gate.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { licenseState } from "./license.js";

export const EXTREME_TEAM_SEATS = 5;
const EXTREME_LIKE = new Set(["extreme", "studio", "owner"]);
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
      : `Team spaces are part of Extreme. Extreme includes ${EXTREME_TEAM_SEATS} seats. Add a licence key in Settings.`,
  };
}

// occupied is how many seats are taken before this change, counting the owner.
// Pass gateMod in tests. Omit it in the app so the real gate is used when it exists.
export async function seatCheck(occupied, { gateMod, tier } = {}) {
  const current = tier || licenseState().tier;
  const n = Math.max(0, Number(occupied) || 0);
  const g = gateMod === undefined ? await loadGate() : gateMod;
  if (g?.evaluateGate && g?.LIMITS) {
    const limits = g.LIMITS[current] || g.LIMITS.free || { teamSeats: 0, label: current || "Free" };
    const result = g.evaluateGate(limits, "teamSeats", { seats: n });
    const raw = limits.teamSeats;
    const limit = raw === Infinity ? Infinity : Number(raw) || 0;
    return { ...result, tier: current, limit, seats: g.EXTREME_TEAM_SEATS || EXTREME_TEAM_SEATS, source: "feature-gate" };
  }
  return fallback(current, n);
}

export async function assertSeats(occupied, opts) {
  const r = await seatCheck(occupied, opts);
  if (!r.ok) throw Object.assign(new Error(r.message), { status: 402, code: r.code || "extreme_required" });
  return r;
}
