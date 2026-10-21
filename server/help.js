// Help articles live in docs/help and ship inside the app. Ask Meldmind may answer only
// from those articles. With no connected AI, or when that AI cannot be reached, the
// reply is a search of the same articles.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";

export const HELP_DIR = path.join(ROOT, "docs", "help");

export const CAN_DO = [
  "Chat, a council, or a mission from one box. Nothing starts until you click Send.",
  "Pro prompts you can thumbs up or thumbs down. You can change your vote. A simple score shows on each prompt.",
  "Weekly prompt packs for writing, email, marketing and ads, and the other categories. New this week shows for 7 days.",
  "A Builders category: one prompt for each guided builder, such as Snap my receipt and log it, the accounting builders, and Review Responder, plus Remix. Picking one opens that builder when it is installed. If it is not installed yet, the words go in the chat.",
  "Inspired by names the source, and the name is a link when there is a page.",
  "Popular prompts are suggested first when you fill marching orders.",
  "Publishing, posting, and sending wait for your click.",
];

const STOP = new Set("a an the and or of to in on for with your you it is are was be as at by if so not from that this after any its into than then also just more most out up do does can when what who how all one them they their our we but about over per via nor yet".split(" "));
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

export function parseArticle(text, filename = "article.md") {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${filename}: missing front matter`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!kv) throw new Error(`${filename}: bad front matter line`);
    meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  const article = {
    id: meta.id || path.basename(filename, ".md"),
    title: meta.title || "",
    summary: meta.summary || "",
    lastUpdatedVersion: meta.lastUpdatedVersion || "",
    body: m[2].trim(),
  };
  if (!article.title || !article.summary || !article.body || !article.lastUpdatedVersion) {
    throw new Error(`${filename}: title, summary, lastUpdatedVersion, and body are required`);
  }
  return article;
}

export function loadHelp(dir = HELP_DIR) {
  const catalog = JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8"));
  if (!catalog || typeof catalog.lastUpdatedVersion !== "string" || !catalog.lastUpdatedVersion) {
    throw new Error("docs/help/catalog.json needs lastUpdatedVersion");
  }
  const articles = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()
    .map((f) => parseArticle(fs.readFileSync(path.join(dir, f), "utf8"), f));
  return { catalog, articles };
}

export function searchArticles(articles, query, limit = 5) {
  const q = tokens(query).filter((w) => w.length > 1 && !STOP.has(w));
  const ranked = (articles || []).map((article) => {
    if (!q.length) return { article, score: 1 };
    const title = `${article.title} ${article.summary}`.toLowerCase();
    const body = String(article.body || "").toLowerCase();
    let score = 0;
    for (const w of q) {
      if (title.includes(w)) score += 5;
      if (body.includes(w)) score += 1;
    }
    return { article, score };
  }).filter((row) => row.score > 0);
  ranked.sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id));
  return ranked.slice(0, limit).map((row) => row.article);
}

export function excerpt(body, n = 220) {
  const t = String(body || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 3)}...`;
}

export function hitOf(article) {
  return { id: article.id, title: article.title, summary: article.summary, excerpt: excerpt(article.body) };
}

// A connected text AI: a saved key, not a demo, and not a red light (rejected, unpaid, or unreachable).
export function pickHelpProvider(providers, { hasSecret, statusOf } = {}) {
  for (const p of Object.values(providers || {})) {
    if (!p || p.kind !== "text" || p.demo || String(p.id || "").startsWith("demo-")) continue;
    if (typeof hasSecret === "function" && !hasSecret(p.id, p.keyEnv)) continue;
    const st = typeof statusOf === "function" ? statusOf(p.id) : null;
    if (st?.status === "red") continue;
    const models = p.models || [];
    const model = models.find((m) => m.tier === "economy") || models.find((m) => m.default) || models[0];
    if (!model) continue;
    return { providerId: p.id, model: model.id };
  }
  return null;
}

// The package version's What's new bullets must show up in help articles stamped with that version.
export function releaseHelpOk({ version, news, articles, catalog }) {
  const problems = [];
  if (String(catalog?.lastUpdatedVersion || "") !== String(version || "")) {
    problems.push(`docs/help/catalog.json lastUpdatedVersion is "${catalog?.lastUpdatedVersion || ""}"; it must be ${version}`);
  }
  const updated = (articles || []).filter((a) => a.lastUpdatedVersion === version);
  if (!updated.length) problems.push(`no help article has lastUpdatedVersion ${version}`);
  const corpus = updated.map((a) => `${a.title}\n${a.summary}\n${a.body}`).join("\n").toLowerCase();
  const bullets = news?.[version]?.bullets || [];
  for (const bullet of bullets) {
    const words = distinctiveWords(bullet);
    if (!words.length) continue;
    const hit = words.filter((w) => corpus.includes(w));
    const need = words.length === 1 ? 1 : Math.min(words.length, Math.max(2, Math.ceil(words.length * 0.4)));
    if (hit.length < need) {
      const missing = words.filter((w) => !corpus.includes(w)).slice(0, 8).join(", ");
      problems.push(`What's new bullet has no matching help update: ${bullet} (missing ${missing})`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export const NO_AI = "No connected AI is available, so this is a search of the help articles.";
export const AI_DOWN = "The connected AI could not be reached, so this is a search of the help articles.";

export function searchReply(note, articles, question) {
  const hits = searchArticles(articles, question, 4).map(hitOf);
  const answer = [note, ...hits.map((h) => `${h.title}: ${h.excerpt}`)].join("\n\n");
  return { source: "search", answer, hits };
}
