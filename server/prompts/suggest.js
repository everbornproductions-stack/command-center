// Prompt suggestions while typing (0.4.17).
// Nothing shows until the person has typed a few letters. Prompts are ranked by how well they
// match the typed words and what the person is trying to make (an image, a video, a post...).
// "New this week" and votes only break a tie. When nothing matches well, nothing is shown.
// When the intent is clear, a direct action leads ("Make an image: fantasy dragon").
// Pure: no I/O, so the tests need no server.

export const MIN_CHARS = 3;
export const MIN_SCORE = 4;
export const SUGGEST_LIMIT = 6;

// The label on a suggestion row: Pro (a Pro prompt), Industry (an industry pack Pro prompt),
// Weekly (a weekly or Builders pack row), or Saved (one of the person's own prompts).
export function suggestSource(row) {
  if (row?.kind === "template") return row.industry ? "industry" : "pro";
  if (row?.kind === "custom") return "saved";
  return "weekly";
}

// Words that say nothing about the job. They never count as a match.
const STOP = new Set([
  "the", "and", "for", "with", "need", "needs", "want", "wants", "make", "made", "create", "generate", "give", "get",
  "can", "could", "you", "your", "please", "some", "this", "that", "these", "those", "about", "into", "from", "have",
  "has", "help", "write", "just", "like", "our", "my", "mine", "its", "it's", "are", "was", "were", "will", "would",
  "should", "let", "lets", "let's", "new", "one", "two", "how", "what", "who", "why", "when", "where", "which", "there",
  "their", "them", "they", "then", "than", "also", "very", "really", "quick", "quickly", "good", "great", "nice",
  "any", "all", "out", "off", "too", "use", "using", "something", "thing", "things", "today", "now", "draft", "drafts",
]);

// Leading words that ask for something. Dropped when the subject is pulled out.
const LEAD = new Set([
  "i", "need", "want", "would", "like", "to", "please", "can", "could", "you", "me", "make", "create", "generate",
  "give", "get", "write", "draft", "do", "a", "an", "the", "some", "my", "our", "for", "of", "about", "with", "on",
  "showing", "that", "shows", "show", "is", "of", "help", "build", "design", "new",
]);

// What the person is making. words are matched as whole words (a phrase may have a space).
// action: the page that makes it, when the app has one. Nothing runs from the action itself.
export const INTENTS = [
  { id: "image", words: ["image", "images", "picture", "pictures", "pic", "photo", "photos", "drawing", "draw", "illustration", "illustrate", "logo", "artwork", "art", "poster", "banner", "wallpaper", "icon", "thumbnail"], cats: ["images and design", "design", "images"], action: { view: "images", verb: "Make an image" } },
  { id: "video", words: ["video", "videos", "reel", "reels", "clip", "clips", "animation", "animate", "tiktok", "short film"], cats: ["video"], action: { view: "media", kind: "video", verb: "Make a video" } },
  { id: "voice", words: ["voice", "voiceover", "voice over", "narration", "narrate", "audio", "speech", "podcast", "read aloud"], cats: ["voice", "audio"], action: { view: "media", kind: "voice", verb: "Make a voiceover" } },
  { id: "post", words: ["post", "posts", "caption", "captions", "instagram", "facebook", "linkedin", "tweet", "tweets", "social", "hashtags", "hashtag"], cats: ["social media", "creators", "social"], action: { view: "webbuilders", verb: "Make a post" } },
  { id: "email", words: ["email", "emails", "e-mail", "newsletter", "follow-up", "followup", "inbox"], cats: ["email"] },
  { id: "ad", words: ["ad", "ads", "advert", "advertisement", "campaign", "promo", "promotion"], cats: ["marketing and ads", "ads"] },
  { id: "website", words: ["website", "websites", "site", "webpage", "web page", "landing page", "homepage", "home page"], cats: ["website", "websites"], action: { view: "webbuilders", verb: "Build a website" } },
  { id: "document", words: ["document", "doc", "report", "proposal", "contract", "letter", "resume", "pdf", "brief", "sop", "agenda"], cats: ["legal and contracts (informational)", "documents"] },
  { id: "code", words: ["code", "coding", "function", "bug", "program", "python", "javascript", "sql", "api"], cats: ["coding"] },
  { id: "research", words: ["research", "sources", "summarize", "summarise", "summary", "compare", "study", "learn"], cats: ["research and summaries", "studying and learning"] },
];

const BY_ID = Object.fromEntries(INTENTS.map((i) => [i.id, i]));

export function words(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [];
}

function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function queryWords(text) {
  return [...new Set(words(text).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];
}

function hasPhrase(low, phrase) {
  const p = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${p}($|[^a-z0-9])`).test(low);
}

// The strongest intent in the text, or null. Ties go to the earlier intent in the list.
export function detectIntent(text) {
  const low = String(text || "").toLowerCase();
  let best = null;
  for (const intent of INTENTS) {
    const hits = intent.words.filter((w) => hasPhrase(low, w)).length;
    if (hits && (!best || hits > best.hits)) best = { id: intent.id, hits };
  }
  return best ? best.id : null;
}

// The thing being made, in the person's words: "need a fun image for a fantasy dragon" -> "fantasy dragon".
export function subjectOf(text, intentId = detectIntent(text)) {
  const raw = String(text || "").trim().replace(/[.!?]+$/, "");
  const tokens = raw.split(/\s+/).filter(Boolean);
  const lowTokens = tokens.map((t) => t.toLowerCase().replace(/[^a-z0-9'-]/g, ""));
  const strip = (list) => {
    const out = [...list];
    while (out.length && LEAD.has(out[0].toLowerCase().replace(/[^a-z0-9'-]/g, ""))) out.shift();
    return out;
  };
  const intent = intentId ? BY_ID[intentId] : null;
  if (intent) {
    const at = lowTokens.findIndex((t) => intent.words.includes(t));
    if (at >= 0) {
      // "an instagram post for my bakery": skip every intent word in a row, then take what follows.
      let end = at;
      while (end + 1 < lowTokens.length && intent.words.includes(lowTokens[end + 1])) end += 1;
      const after = strip(tokens.slice(end + 1));
      if (after.length) return after.join(" ");
      const before = strip(tokens.slice(0, at)).filter((t) => !LEAD.has(t.toLowerCase()));
      if (before.length) return before.join(" ");
      return "";
    }
  }
  return strip(tokens).join(" ");
}

function catIntent(category) {
  const c = String(category || "").toLowerCase();
  if (!c) return null;
  const hit = INTENTS.find((i) => i.cats.includes(c));
  return hit ? hit.id : null;
}

// What a listed prompt makes, and how sure that is. A category or the title is strong. The
// prompt text alone is weak (a sales prompt may mention an email in passing).
export function intentOfRow(row) {
  const strong = catIntent(row?.category) || detectIntent(`${row?.title || row?.name || ""}`);
  if (strong) return { id: strong, strong: true };
  const weak = detectIntent(`${row?.prompt || ""} ${row?.description || ""}`);
  return weak ? { id: weak, strong: false } : null;
}

function rowScore(row, query, intentId) {
  const title = new Set(words(`${row.title || ""} ${row.name || ""}`).map(stem));
  const cat = new Set(words(row.category || "").map(stem));
  const tags = new Set(words([...(row.tags || []), ...(row.words || []), ...(row.phrases || [])].join(" ")).map(stem));
  const body = new Set(words(`${row.prompt || ""} ${row.description || ""}`).map(stem));
  let score = 0;
  for (const w of query) {
    if (title.has(w)) score += 3;
    else if (cat.has(w) || tags.has(w)) score += 2;
    else if (body.has(w)) score += 1;
  }
  const lexical = score;
  const own = intentOfRow(row);
  if (intentId && own) {
    if (own.id === intentId) score += own.strong ? 4 : 2;
    else score -= own.strong ? 4 : 1;
  }
  // A prompt needs a word in common, or to make exactly what was asked for.
  if (!lexical && !(own?.strong && own.id === intentId)) return 0;
  return score;
}

function tieBreak(a, b) {
  return (b.score - a.score) || (Number(!!b.row.fresh) - Number(!!a.row.fresh)) || ((Number(b.row.popularity) || 0) - (Number(a.row.popularity) || 0))
    || String(a.row.title || a.row.name || "").localeCompare(String(b.row.title || b.row.name || ""), undefined, { sensitivity: "base" });
}

// The direct action for a clear intent, when the app has a page for it.
export function actionFor(text, intentId = detectIntent(text), subject = subjectOf(text, intentId)) {
  const intent = intentId ? BY_ID[intentId] : null;
  if (!intent?.action || !subject) return null;
  return { intent: intent.id, view: intent.action.view, kind: intent.action.kind || null, label: `${intent.action.verb}: ${subject}`, text: String(text || "").trim(), subject };
}

// The whole answer for one typed text. An empty or very short box gets nothing.
export function rankSuggestions(text, pool, { limit = SUGGEST_LIMIT } = {}) {
  const value = String(text || "").trim();
  const empty = { intent: null, subject: "", action: null, items: [] };
  if (value.length < MIN_CHARS) return empty;
  const query = queryWords(value);
  const intent = detectIntent(value);
  if (!query.length && !intent) return empty;
  const subject = subjectOf(value, intent);
  const scored = (pool || []).filter(Boolean).map((row) => ({ row, score: rowScore(row, query, intent) }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort(tieBreak)
    .filter((r, i, all) => all.findIndex((x) => String(x.row.title || x.row.name || "").toLowerCase() === String(r.row.title || r.row.name || "").toLowerCase()) === i);
  return { intent, subject, action: actionFor(value, intent, subject), items: scored.slice(0, limit).map((r) => ({ ...r.row, relevance: r.score })) };
}
