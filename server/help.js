// Help articles live in docs/help and ship inside the app. Ask Meldmind may answer only
// from those articles. With no connected AI, or when that AI cannot be reached, the
// reply is a search of the same articles.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";
export { tokens, distinctiveWords, searchArticles, helpOrder, tryThese, queryWords } from "../web/help-rank.js";
import { distinctiveWords, searchArticles } from "../web/help-rank.js";

export const HELP_DIR = path.join(ROOT, "docs", "help");

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
