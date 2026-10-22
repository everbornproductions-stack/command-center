// Popularity for prompts. A Wilson lower bound keeps a new prompt with one
// vote from looking perfect, and a small prior keeps a prompt with no votes
// from sinking under everything else. The "New this week" badge lasts 7 days
// from the Monday of added_week.
import { rankSuggestions } from "./suggest.js";

const PRIOR_UP = 2;
const PRIOR_DOWN = 2;
const Z = 1.96;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function wilsonLower(up, down, z = Z) {
  const good = Math.max(0, Number(up) || 0);
  const bad = Math.max(0, Number(down) || 0);
  const n = good + bad;
  if (n <= 0) return 0;
  const phat = good / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return (centre - margin) / denom;
}

// Sort key. The prior is not shown to the person.
export function popularityScore(up, down) {
  return wilsonLower((Number(up) || 0) + PRIOR_UP, (Number(down) || 0) + PRIOR_DOWN);
}

export function scoreLabel(up, down) {
  const good = Math.max(0, Number(up) || 0);
  const bad = Math.max(0, Number(down) || 0);
  if (good + bad === 0) return "No votes yet";
  const n = Math.round(wilsonLower(good, bad) * 100);
  return `Score ${n} (${good} up, ${bad} down)`;
}

// Monday 00:00 UTC of an ISO week such as 2026-W43.
export function isoWeekStart(spec) {
  const m = String(spec || "").match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday;
}

export function isNewThisWeek(addedWeek, now = Date.now()) {
  const start = isoWeekStart(addedWeek);
  if (!start) return false;
  const t = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(t)) return false;
  return t >= start.getTime() && t < start.getTime() + WEEK_MS;
}

export function rankPrompts(rows, now = Date.now()) {
  const ranked = (rows || []).map((row) => {
    const up = Math.max(0, Number(row.up) || 0);
    const down = Math.max(0, Number(row.down) || 0);
    const added = row.added_week || row.addedWeek || "";
    const fresh = isNewThisWeek(added, now);
    const bump = fresh && up + down < 5 ? 0.04 : 0;
    return {
      ...row,
      up,
      down,
      fresh,
      popularity: popularityScore(up, down) + bump,
      scoreLabel: scoreLabel(up, down),
    };
  });
  ranked.sort((a, b) => b.popularity - a.popularity || String(a.title || a.name || "").localeCompare(String(b.title || b.name || ""), undefined, { sensitivity: "base" }));
  return ranked;
}

// Suggestions for what is typed in the orders box (0.4.17). An empty box gets nothing, prompts are
// ranked by how well they match the words and the intent (server/prompts/suggest.js), and votes or
// "New this week" only break a tie. No match means no suggestions, never the popular list instead.
// Before 0.4.17 an empty box showed the popular list, and "for" matched every prompt.
export function suggestForOrders(text, prompts, limit = 6, now = Date.now()) {
  return rankSuggestions(text, rankPrompts(prompts, now), { limit }).items;
}
