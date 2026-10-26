// The AI News side panel: docked on wide screens, floating on mid screens, a pill on phones.
// Pure helpers only (the page code is web/features/news-rail.js). The choice is kept on this computer.

export const RAIL_KEY = "cc.newsRail";
export const MAX_LINKS = 8;
export const MAX_PINS = 5;
export const WIDE_MIN = 1100; // from this width the panel starts open and docked in its own column
export const PHONE_MAX = 760; // under this width the panel becomes a pill that opens the News screen

// Where the panel sits for a window this wide: "dock" (own column), "float" (small card over the page) or "phone".
export function railMode(width) {
  const w = Number(width) || 0;
  if (w && w < PHONE_MAX) return "phone";
  return w >= WIDE_MIN ? "dock" : "float";
}

const safePin = (p) => p && typeof p.url === "string" && /^https:\/\//i.test(p.url) && typeof p.title === "string" && p.title
  ? { title: p.title.slice(0, 90), url: p.url.slice(0, 500) } : null;

// width is optional: on a wide window the panel starts open unless the person has chosen otherwise.
export function readRail(storage, width) {
  let raw = {};
  try { raw = JSON.parse(storage?.getItem(RAIL_KEY) || "{}") || {}; } catch { raw = {}; }
  const min = typeof raw.min === "boolean" ? raw.min : railMode(width) !== "dock";
  const pins = (Array.isArray(raw.pins) ? raw.pins : []).map(safePin).filter(Boolean).slice(0, MAX_PINS);
  return { side: raw.side === "left" ? "left" : "right", min, hidden: raw.hidden === true, pins };
}

export function saveRail(storage, state) {
  try {
    storage?.setItem(RAIL_KEY, JSON.stringify({
      side: state.side === "left" ? "left" : "right",
      min: state.min === true,
      hidden: state.hidden === true,
      pins: (state.pins || []).map(safePin).filter(Boolean).slice(0, MAX_PINS),
    }));
  } catch { /* the panel still works for this visit */ }
}

// Add or remove a pinned link. Returns a new list, at most MAX_PINS, newest first.
export function togglePin(pins, link) {
  const next = safePin(link);
  const list = Array.isArray(pins) ? pins : [];
  if (!next) return list;
  if (list.some((p) => p.url === next.url)) return list.filter((p) => p.url !== next.url);
  return [next, ...list].slice(0, MAX_PINS);
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
