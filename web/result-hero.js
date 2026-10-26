// The finished result card (0.4.21, L-easy): the result is shown big, one main button sits next to it, and
// everything else waits behind "More". Pure: no DOM, so the tests and the page share it. It never sends,
// posts or spends. Publish and Post only open the normal preview, where the person still clicks to send.

export const MAIN = {
  image: { id: "download", label: "Download" },
  video: { id: "download", label: "Download" },
  audio: { id: "download", label: "Download" },
  mod: { id: "download", label: "Download" },
  site: { id: "publish", label: "Publish" },
  campaign: { id: "post", label: "Post" },
};

// The kind of thing a result is. Anything unknown is treated as a document that can be downloaded.
export function normalKind(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "website" || k === "webbuilders") return "site";
  if (k === "social" || k === "post") return "campaign";
  if (k === "images") return "image";
  if (k === "media") return "video";
  return MAIN[k] ? k : "document";
}

// What a publish route must accept for each kind of result (matches server ACCEPTS: text, image, video, audio, site).
const ACCEPT_KIND = { image: "image", video: "video", audio: "audio", site: "site", campaign: "text", document: "text", mod: "file" };

// Only routes that are connected AND take this kind of result. Everything else is hidden, never shown greyed out.
export function usableRoutes(channels, kind) {
  const need = ACCEPT_KIND[normalKind(kind)] || "text";
  return (Array.isArray(channels) ? channels : []).filter((c) => c && c.ready === true && (!Array.isArray(c.accepts) || c.accepts.includes(need)));
}

// The one main button. A site or a campaign with no working route falls back to Download so the button is never a dead end.
export function mainAction(kind, channels) {
  const k = normalKind(kind);
  const base = MAIN[k] || { id: "download", label: "Download" };
  if ((base.id === "publish" || base.id === "post") && !usableRoutes(channels, k).length) {
    return { id: "download", label: "Download", fallback: true, note: base.id === "publish" ? "Nothing is connected to publish to yet. Download it, or connect a place under More." : "Nothing is connected to post to yet. Download it, or connect a place under More." };
  }
  return { ...base };
}

// Quick tweaks for pictures. Each one is a plain change phrase that the maker already understands.
const IMAGE_TWEAKS = [
  { id: "brighter", label: "Brighter", change: "make it brighter and sunnier", skip: /\b(bright|sunny|sunlit)\b/i },
  { id: "moody", label: "Moodier", change: "make it moodier with darker light", skip: /\b(moody|dark|night|dusk)\b/i },
  { id: "sunset", label: "At sunset", change: "at sunset with warm golden light", skip: /\b(sunset|sunrise|golden hour)\b/i },
  { id: "closer", label: "Closer up", change: "a closer view, zoomed in", skip: /\b(close[- ]?up|closer|zoomed)\b/i },
  { id: "bw", label: "Black and white", change: "in black and white", skip: /\b(black and white|monochrome|b&w)\b/i },
  { id: "painting", label: "As a painting", change: "as an oil painting", skip: /\b(painting|painted|oil)\b/i },
];
const VIDEO_TWEAKS = [
  { id: "slower", label: "Slower", change: "make it slower and calmer", skip: /\b(slow|calm)\b/i },
  { id: "livelier", label: "Livelier", change: "make it livelier with more movement", skip: /\b(lively|energetic|fast)\b/i },
];
const AUDIO_TWEAKS = [
  { id: "warmer", label: "Warmer voice", change: "a warmer, friendlier voice", skip: /\b(warm|friendly)\b/i },
  { id: "slower", label: "Slower", change: "speak more slowly", skip: /\b(slow)\b/i },
];

// 2 to 4 options for a result. Pictures get 4 (3 if the request already says one of them), video and voice get 2.
export function quickOptions(kind, prompt) {
  const k = normalKind(kind);
  const pool = k === "image" ? IMAGE_TWEAKS : k === "video" ? VIDEO_TWEAKS : k === "audio" ? AUDIO_TWEAKS : [];
  const text = String(prompt || "");
  const fresh = pool.filter((o) => !o.skip.test(text));
  const want = k === "image" ? 4 : 2;
  return fresh.slice(0, want).map(({ id, label, change }) => ({ id, label, change }));
}

// The "More" list: the other things you can do with this result. Other modules add buttons through addButton.
const hooks = [];
export function addButton(spec) {
  if (!spec || !spec.id || typeof spec.label !== "string" || typeof spec.onClick !== "function") return false;
  if (hooks.some((h) => h.id === spec.id)) return false;
  hooks.push({ id: spec.id, label: spec.label, kinds: Array.isArray(spec.kinds) ? spec.kinds : null, onClick: spec.onClick });
  return true;
}
export function hookButtons(kind) {
  const k = normalKind(kind);
  return hooks.filter((h) => !h.kinds || h.kinds.includes(k)).map(({ id, label, onClick }) => ({ id, label, onClick }));
}
export const clearHooks = () => { hooks.length = 0; };

// The whole layout in one plain object: { main, quick, more }. more is every button except the main one.
export function heroPlan({ kind, prompt, channels, saved = true } = {}) {
  const k = normalKind(kind);
  const main = mainAction(k, channels);
  const more = [];
  if (main.id !== "download") more.push({ id: "download", label: "Download" });
  if (main.id === "download" || main.fallback) {
    // the main button is a download, so a connected place is still offered, quietly
    if (usableRoutes(channels, k).length && k !== "mod") more.push({ id: "post", label: k === "site" ? "Publish" : "Send to a connected place" });
  }
  if (saved) more.push({ id: "open", label: "Open in MindMedia" });
  if (k === "image" || k === "video" || k === "audio") more.push({ id: "again", label: "Make another" });
  for (const h of hookButtons(k)) more.push({ id: h.id, label: h.label, hook: true });
  return { kind: k, main, quick: quickOptions(k, prompt), more };
}

// Guess the kind of a text result so the right main button shows. Only clear signs count; a plain answer stays a document.
export function guessKind(text, hint) {
  const h = normalKind(hint);
  if (h === "site" || h === "campaign") return h;
  const t = String(text || "");
  if (/<!doctype html|<html[\s>]/i.test(t)) return "site";
  if (/(^|\n)\s*(?:#{1,3}\s*)?(?:day\s*\d+|week\s*\d+|post\s*\d+)\b/i.test(t) && /#\w{3,}|caption|hashtag|call to action/i.test(t)) return "campaign";
  return "document";
}
