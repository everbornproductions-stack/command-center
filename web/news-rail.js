// The AI News side panel: a small card that can sit on the left or the right, or shrink to a tab.
// Pure helpers only (the page code is web/features/news-rail.js). The choice is kept on this computer.

export const RAIL_KEY = "cc.newsRail";
export const MAX_LINKS = 8;

export function readRail(storage) {
  let raw = {};
  try { raw = JSON.parse(storage?.getItem(RAIL_KEY) || "{}") || {}; } catch { raw = {}; }
  return { side: raw.side === "left" ? "left" : "right", min: raw.min !== false, hidden: raw.hidden === true };
}

export function saveRail(storage, state) {
  try { storage?.setItem(RAIL_KEY, JSON.stringify({ side: state.side === "left" ? "left" : "right", min: state.min !== false, hidden: state.hidden === true })); } catch { /* the panel still works for this visit */ }
}

// News items that have a safe https link, newest section first, at most MAX_LINKS.
export function railLinks(news) {
  const sections = news?.issue?.sections || {};
  const out = [];
  for (const key of ["ai", "meldmind", "highlights", "prompts"]) {
    for (const item of sections[key] || []) {
      const url = String(item?.sourceUrl || "");
      if (!/^https:\/\//i.test(url) || !item?.title) continue;
      out.push({ id: String(item.id || url), title: String(item.title).slice(0, 90), url, source: String(item.sourceName || "").slice(0, 30) });
      if (out.length >= MAX_LINKS) return out;
    }
  }
  return out;
}
