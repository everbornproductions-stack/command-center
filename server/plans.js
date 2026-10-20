// Free, Paid, or Unknown on each provider. A guess fills in when the user has not chosen.
// Simple mode prefers a free provider when its quality is close to the best pick.
import { PROVIDERS } from "./registry.js";
import { getStatus } from "./health.js";
import { doc, putDoc, ctx } from "./store.js";

export const PLANS = ["free", "paid", "unknown"];
export const PLAN_DOC = "plans";
export const QUALITY_CLOSE = 8;
export const SCORE_CLOSE = 4;
// Gemini AI Studio and Groq both ship a free allowance. The person can set Paid later.
export const GUESSED_FREE = { google: "free", groq: "free" };

function readSaved() {
  let d = null;
  try { d = ctx().docs?.[PLAN_DOC] || null; } catch { d = null; }
  if (!d || typeof d !== "object") return { providers: {} };
  if (!d.providers || typeof d.providers !== "object") d.providers = {};
  return d;
}
function savedMap() {
  const d = doc(PLAN_DOC, () => ({ providers: {} }));
  if (!d.providers || typeof d.providers !== "object") d.providers = {};
  return d;
}

export function planInfo(id) {
  const saved = readSaved().providers[id];
  if (PLANS.includes(saved)) return { plan: saved, source: "you" };
  let st = null;
  try { st = getStatus(id); } catch { st = null; }
  if (st?.balance?.free) return { plan: "free", source: "guess" };
  if (GUESSED_FREE[id]) return { plan: GUESSED_FREE[id], source: "guess" };
  return { plan: "unknown", source: "guess" };
}

export function planOf(id) {
  return planInfo(id).plan;
}

export function setPlan(id, plan) {
  if (!PROVIDERS[id]) throw Object.assign(new Error("unknown provider"), { status: 400 });
  if (!PLANS.includes(plan)) throw Object.assign(new Error("Plan must be Free, Paid, or Unknown."), { status: 400 });
  const d = savedMap();
  d.providers[id] = plan;
  putDoc(PLAN_DOC, d);
  return planInfo(id);
}

export function preferFreeOn(settings) {
  const s = settings || null;
  if (!s) return false;
  if (s.preferFree === true || s.preferFree === false) return s.preferFree;
  return s.uiMode === "simple";
}

export function readPreferFree() {
  let s = null;
  try { s = ctx().docs?.settings || null; } catch { s = null; }
  return preferFreeOn(s);
}

// Move a free provider to the front only when quality and score are both close to the leader.
export function applyPreferFree(scored, on) {
  if (!on || !Array.isArray(scored) || scored.length < 2) return scored;
  const top = scored[0];
  const free = scored.find((m) => m !== top && m.plan === "free" && top.quality - m.quality <= QUALITY_CLOSE && top.score - m.score <= SCORE_CLOSE);
  if (!free) return scored;
  return [{ ...free, preferFree: true }, ...scored.filter((m) => m !== free)];
}
