// Up-front plan locks (0.4.21): say "Pro" on the card before anyone fills a form, not at Build.
const RANK = { free: 0, pro: 1, studio: 1, extreme: 2, owner: 3 };
export const planName = (t) => ({ free: "Free", pro: "Pro", studio: "Pro", extreme: "Extreme", owner: "Owner" }[String(t || "free").toLowerCase()] || "Pro");
export function isLocked(need, have) {
  return (RANK[String(need || "free").toLowerCase()] ?? 0) > (RANK[String(have || "free").toLowerCase()] ?? 0);
}
// "" when open to this plan, else a short plain label.
export function lockLabel(need, have) {
  return isLocked(need, have) ? `Needs ${planName(need)}. You are on ${planName(have)}.` : "";
}
