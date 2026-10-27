// 0.4.22 daily limits for free AIs. One store doc keeps, per free AI: used today, the daily limit (when known),
// and when it is out until. The day rolls over on local midnight. A 429, "quota" or "daily limit" reply marks the AI
// out until its next reset, with a plain reason in the existing trouble table. The bids read limitLeft(id).
// Every function takes an optional `now` so tests never wait on a real clock.
import { PROVIDERS } from "./registry.js";
import { doc, putDoc } from "./store.js";
import { FREE_TIERS, fallbackSettings, markTrouble, freeUsage } from "./fallback.js";

export const DOC = "free.limits";
// limits for free AIs that are not API providers; null means "no known cap, only a reply can say it is out"
export const EXTRA_LIMITS = { freebuff: null, qwen: null };
export const OUT_PHRASE = /\b(429|quota|daily limit|rate limit(?:ed)?|too many requests|resource[_ ]exhausted)\b/i;

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const nextReset = (now = Date.now()) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };
const nameOf = (id) => PROVIDERS[id]?.name || (id === "freebuff" ? "Freebuff" : id === "qwen" ? "Qwen" : id);

// the saved doc, rolled to today (a new day clears used and out)
function load(now) {
  const d = doc(DOC, () => ({ day: dayKey(now), ais: {} }));
  if (d.day !== dayKey(now)) { d.day = dayKey(now); d.ais = {}; putDoc(DOC, d); }
  return d;
}
function limitOf(id) {
  if (FREE_TIERS[id]) {
    try { const n = Number(fallbackSettings().freeTiers[id]?.perDay); if (n > 0) return n; } catch { /* use the list limit */ }
    return FREE_TIERS[id].perDay;
  }
  return EXTRA_LIMITS[id] ?? null;
}
// calls the ledger already counted today (only for today's real clock; an injected past or future day counts its own notes)
const ledgerToday = (id, now) => { if (!FREE_TIERS[id] || dayKey(now) !== dayKey(Date.now())) return 0; try { return freeUsage(id).today; } catch { return 0; } };
const usedOf = (e, id, now) => Math.max(e?.used || 0, ledgerToday(id, now));
const entry = (d, id) => (d.ais[id] ||= { used: 0, out: null, reason: "" });

export function noteUse(id, { now = Date.now(), count = 1 } = {}) {
  const d = load(now);
  entry(d, id).used += count;
  putDoc(DOC, d);
  return limitLeft(id, { now });
}

// Mark an AI out until its next reset. Returns the entry, or null for an unknown id.
export const SHORT_BENCH_MS = 15 * 60 * 1000;
// A plain 429 or "rate limit" is usually a per-minute limit, so it benches the AI for about 15 minutes, not until
// midnight (0.4.23, audit X8). Only words that say the DAY's allowance is gone ("quota", "daily limit",
// "resource exhausted") bench it until the next reset. `short: true` asks for the short bench.
export const DAILY_PHRASE = /\b(quota|daily limit|per day|resource[_ ]exhausted)\b/i;
export function markOut(id, reason = "", { now = Date.now(), short = false } = {}) {
  if (!id) return null;
  const d = load(now);
  const e = entry(d, id);
  e.out = short ? Math.min(nextReset(now), now + SHORT_BENCH_MS) : nextReset(now);
  e.reason = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 120) || "hit its daily limit";
  putDoc(DOC, d);
  // the existing trouble table shows the plain reason; the bids already skip this AI through limitLeft
  try { if (PROVIDERS[id]) markTrouble(id, "credits", `${e.reason}. ${short ? "It is tried again in about 15 minutes." : "It comes back tomorrow."}`, { quiet: true }); } catch { /* the tracker alone still works */ }
  return { ...e };
}

// Read one failed reply: a 429 status, or words that say the allowance is gone. Returns true when the AI was marked out.
export function noteReply(id, { status = 0, text = "" } = {}, { now = Date.now() } = {}) {
  if (!(id in FREE_TIERS) && !(id in EXTRA_LIMITS)) return false; // a paid AI's 429 is the trouble table's job alone
  const hit = Number(status) === 429 || OUT_PHRASE.test(String(text || ""));
  if (!hit) return false;
  const daily = DAILY_PHRASE.test(String(text || ""));
  markOut(id, daily ? (Number(status) === 429 ? "hit its daily limit (429)" : "hit its daily limit") : "is busy for a few minutes (rate limit)", { now, short: !daily });
  return true;
}

// How many calls are left today: Infinity when there is no known cap, 0 when out.
export function limitLeft(id, { now = Date.now() } = {}) {
  const d = load(now);
  const e = d.ais[id];
  if (e?.out && now < e.out) return 0;
  const limit = limitOf(id);
  if (limit == null) return Infinity;
  return Math.max(0, limit - usedOf(e, id, now));
}

export function limitsView({ now = Date.now(), ids = null } = {}) {
  const d = load(now);
  const list = ids || [...new Set([...Object.keys(FREE_TIERS), ...Object.keys(EXTRA_LIMITS), ...Object.keys(d.ais)])];
  return list.map((id) => {
    const e = d.ais[id] || { used: 0, out: null, reason: "" };
    const limit = limitOf(id);
    const out = !!(e.out && now < e.out);
    const left = limitLeft(id, { now });
    return { id, name: nameOf(id), used: usedOf(e, id, now), limit, left: Number.isFinite(left) ? left : null, out, reason: out ? e.reason : "", resetsAt: nextReset(now) };
  });
}
