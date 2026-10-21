// Word ranking for Help. Shared by the server and the Help tab.
// A normal sentence is split into words. Small filler words are dropped.
// A synonym counts, but a word that is actually in the question counts more.

export const STOP = new Set("a an the and or of to in on for with your you it is are was be as at by if so not from that this after any its into than then also just more most out up do does can when what who how all one them they their our we but about over per via nor yet i my me".split(" "));

export const SYNONYMS = {
  ask: ["question", "chat", "start"],
  question: ["ask", "chat", "start"],
  chat: ["ask", "question"],
  start: ["begin", "ask"],
  begin: ["start", "ask"],
  help: ["guide", "start"],
  bigger: ["large", "size", "text", "font"],
  text: ["size", "font", "reading", "bigger"],
  size: ["text", "font", "bigger"],
  font: ["text", "size"],
  large: ["bigger", "size", "text"],
  key: ["password", "api"],
  password: ["key"],
  api: ["key"],
  cost: ["money", "charge", "price", "free", "plan"],
  charge: ["cost", "money", "price"],
  money: ["cost", "charge", "price", "free", "plan"],
  price: ["cost", "money"],
  free: ["cost", "money", "plan"],
};

const SHORT_OK = new Set(["aq", "ai", "mcp"]);

export function tokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
}

export function distinctiveWords(text) {
  const out = [];
  for (const raw of tokens(text)) {
    if (STOP.has(raw)) continue;
    if (raw.length < 4 && !SHORT_OK.has(raw)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

export function queryWords(query) {
  const base = tokens(query).filter((w) => w.length > 1 && !STOP.has(w));
  const all = [];
  for (const w of base) {
    if (!all.includes(w)) all.push(w);
    for (const s of SYNONYMS[w] || []) if (!all.includes(s)) all.push(s);
  }
  return { base, all };
}

// Start here, then Getting started, then How to / Start a project articles, then the rest.
export function helpRank(article) {
  const id = article?.id || "";
  const title = article?.title || "";
  if (id === "start-here") return 0;
  if (id === "getting-started") return 1;
  if (id.startsWith("start-") || /^how to\b/i.test(title)) return 2;
  return 3;
}

export function helpOrder(articles) {
  return [...(articles || [])].sort((a, b) => helpRank(a) - helpRank(b) || String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id)));
}

export function searchArticles(articles, query, limit = 5) {
  const { base, all } = queryWords(query);
  const ranked = (articles || []).map((article) => {
    if (!all.length) return { article, score: 0 };
    const title = `${article.title} ${article.summary}`.toLowerCase();
    const body = String(article.body || "").toLowerCase();
    let score = 0;
    for (const w of all) {
      const weight = base.includes(w) ? 1 : 0.45;
      if (title.includes(w)) score += 5 * weight;
      else if (body.includes(w)) score += 1 * weight;
    }
    return { article, score };
  }).filter((row) => row.score > 0);
  ranked.sort((a, b) => b.score - a.score || helpRank(a.article) - helpRank(b.article) || a.article.id.localeCompare(b.article.id));
  return ranked.slice(0, limit).map((row) => row.article);
}

// Shown when a question matches nothing. This build does not store read counts,
// so these are the three guides a new person should open first.
export const TRY_THESE = ["start-here", "getting-started", "share-export"];

export function tryThese(articles) {
  const byId = new Map((articles || []).map((a) => [a.id, a]));
  const picked = TRY_THESE.map((id) => byId.get(id)).filter(Boolean);
  if (picked.length >= 3) return picked.slice(0, 3);
  for (const a of helpOrder(articles)) {
    if (picked.some((p) => p.id === a.id)) continue;
    picked.push(a);
    if (picked.length >= 3) break;
  }
  return picked;
}
