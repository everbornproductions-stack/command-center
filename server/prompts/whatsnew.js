// 0.4.28 "What's new" on the Prompts page, and weekly pack rows filed into the categories.
// Pure: no I/O, so the tests pass their own date and rows.
//
// What's new holds one week's pack: the rows whose added_week is this ISO week. When this week has
// no pack yet, it holds the newest earlier pack and says which week, so it is never empty while any
// pack exists. A pack dated for a later week stays hidden until that week starts, so next week's pack
// can ship early and roll over on its own.
//
// Every released pack row is also filed into its normal category (a shelf in web/features/prompt-board.js)
// and stays there after its week ends, so the categories keep growing. A row that repeats a prompt
// already in that category (same id or a near-duplicate title) is filed once.
import { PACK_CATEGORIES, nearDuplicateTitle } from "./packs.js";

export const WHATS_NEW_ID = "whatsnew";
export const WHATS_NEW_LABEL = "What's new";

// Pack category to shelf id. The shelf ids are the categories the Prompts page already shows.
export const PACK_SHELF = {
  writing: "marketing",
  email: "sales",
  "marketing and ads": "marketing",
  "social media": "marketing",
  sales: "sales",
  coding: "build",
  "research and summaries": "planning",
  "business planning": "planning",
  "studying and learning": "productivity",
  "images and design": "creative",
  video: "creative",
  productivity: "productivity",
  "customer support": "sales",
  "finance and accounting": "planning",
  "legal and contracts (informational)": "planning",
  "HR and hiring": "leadership",
  "real estate": "industry",
  mortgage: "industry",
  insurance: "industry",
  "credit repair": "industry",
  creators: "creative",
  "personal life": "productivity",
  builders: "build",
};

// Words that point to a pack category when a row or a new prompt has none.
const CATEGORY_HINTS = [
  ["video", /\b(video|reel|reels|clip|b-roll|shot list|storyboard|voiceover|voice-over)\b/i],
  ["images and design", /\b(image|images|photo|picture|logo|thumbnail|poster|flyer|banner|graphic|design)\b/i],
  ["builders", /\b(builder)\b/i],
  ["coding", /\b(code|script that|function|website|web page|landing page|html|css|spreadsheet formula|formula)\b/i],
  ["finance and accounting", /\b(budget|invoice|expenses?|spreadsheet|numbers|cash flow|profit)\b/i],
  ["email", /\b(email|e-mail|newsletter)\b/i],
  ["social media", /\b(post|caption|hashtag|social)\b/i],
  ["marketing and ads", /\b(ad|ads|marketing|campaign|offer|headline|tagline)\b/i],
  ["sales", /\b(sales|follow-up|follow up|prospect|lead|pitch|quote)\b/i],
  ["customer support", /\b(support|complaint|customer reply|faq)\b/i],
  ["HR and hiring", /\b(hire|hiring|interview|job post|onboarding|employee)\b/i],
  ["business planning", /\b(plan|proposal|sop|process|report|memo|one-pager|business)\b/i],
  ["research and summaries", /\b(summary|summarize|research|compare|notes)\b/i],
  ["studying and learning", /\b(learn|teach|study|lesson|quiz)\b/i],
  ["writing", /\b(write|rewrite|edit|draft|story|article|blog)\b/i],
];

export function inferCategory(row) {
  const given = String(row?.category || "").trim();
  if (PACK_CATEGORIES.includes(given)) return given;
  const lower = given.toLowerCase();
  const exact = PACK_CATEGORIES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const text = [given, row?.title, row?.prompt, row?.text].filter(Boolean).join(" ");
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(text)) return cat;
  return "productivity";
}

export function shelfForPack(row) {
  return PACK_SHELF[row?.category] || PACK_SHELF[inferCategory(row)] || "planning";
}

// ISO week of a date, as "2026-W44" (weeks start Monday, UTC).
export function isoWeekOf(now = Date.now()) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  const d = new Date(Number.isFinite(t) ? t : Date.now());
  const day = d.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - day));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday.getTime() - jan1) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function weekRank(spec) {
  const m = String(spec || "").match(/^(\d{4})-W(\d{2})$/);
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
}

// "week 44 of 2026"
export function weekWords(spec) {
  const m = String(spec || "").match(/^(\d{4})-W(\d{2})$/);
  return m ? `week ${Number(m[2])} of ${m[1]}` : "";
}

// Rows whose week has started. A row with no week counts as released.
export function releasedRows(rows, now = Date.now()) {
  const limit = weekRank(isoWeekOf(now));
  return (rows || []).filter((row) => {
    const rank = weekRank(row?.added_week);
    return !rank || rank <= limit;
  });
}

// { week, thisWeek, current, label, rows }. week is "" only when no pack has a week yet.
export function pickWhatsNew(rows, now = Date.now()) {
  const thisWeek = isoWeekOf(now);
  const released = releasedRows(rows, now);
  const weeks = [...new Set(released.map((row) => row?.added_week).filter((w) => weekRank(w)))]
    .sort((a, b) => weekRank(b) - weekRank(a));
  const week = weeks[0] || "";
  const current = !!week && week === thisWeek;
  const picked = week ? released.filter((row) => row.added_week === week) : [];
  let label = "No weekly pack yet. New prompts show up here each week.";
  if (current) label = `New this week (${weekWords(week)}). Next week's pack replaces these, and they stay in their categories.`;
  else if (week) label = `No new pack yet this week. Showing the newest pack, from ${weekWords(week)}. These are also in their categories.`;
  return { id: WHATS_NEW_ID, title: WHATS_NEW_LABEL, week, thisWeek, current, label, rows: picked };
}

// Released pack rows with a shelf, minus any row that repeats a prompt already in that shelf.
// existing: rows already on the shelves ({ id, name or title, shelf }).
export function fileIntoShelves(rows, existing = [], now = Date.now()) {
  const placed = (existing || []).map((row) => ({ id: String(row?.id || ""), title: row?.name || row?.title || "", shelf: row?.shelf || "" }));
  const out = [];
  for (const row of releasedRows(rows, now)) {
    if (!row?.id) continue;
    const shelf = shelfForPack(row);
    const title = row.title || row.name || "";
    const dup = placed.some((other) => other.shelf === shelf && (other.id === row.id || nearDuplicateTitle(other.title, title)));
    if (dup) continue;
    placed.push({ id: row.id, title, shelf });
    out.push({ ...row, shelf });
  }
  return out;
}
