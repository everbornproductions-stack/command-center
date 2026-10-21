// Weekly AI News. A draft is built from source text, What's new, prompt votes, and chat highlights.
// Publishing is a separate step. This module does not fetch pages and does not send email.

export const ADDRESS_PLACEHOLDER = "Everborn Productions\n[postal address placeholder]";
export const UNSUBSCRIBE_BASE = "https://everbornproductions.com/command-center/unsubscribe";

// Pages the owner can snapshot. The generator does not open these unless --fetch is passed.
export const SOURCE_LIST = [
  { provider: "OpenAI", url: "https://openai.com/news", note: "News" },
  { provider: "Anthropic", url: "https://www.anthropic.com/news", note: "News" },
  { provider: "Google", url: "https://blog.google/technology/ai/", note: "AI blog" },
  { provider: "xAI", url: "https://x.ai/news", note: "News" },
  { provider: "Mistral", url: "https://mistral.ai/news", note: "News" },
  { provider: "DeepSeek", url: "https://api-docs.deepseek.com/updates", note: "Updates" },
];

const SECRET = [
  /\bsk-[A-Za-z0-9_\-]{8,}\b/,
  /\bxai-[A-Za-z0-9]{8,}\b/,
  /\bgsk_[A-Za-z0-9]{8,}\b/,
  /\bAIza[0-9A-Za-z\-_]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:^|[^A-Za-z])[A-Za-z]:[\\/][^\s]{2,}/,
];

export function looksSecret(text) {
  const value = String(text || "");
  return SECRET.some((re) => re.test(value));
}

export function isoWeek(now = Date.now()) {
  const date = new Date(now);
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function kindOf(title, summary) {
  const blob = `${title} ${summary}`.toLowerCase();
  if (/\b(price|pricing|cheaper|\$|per million|token price)\b/.test(blob)) return "price";
  if (/\b(model|gpt|claude|gemini|grok|llama|release|available|launch)\b/.test(blob)) return "model";
  return "feature";
}

function itemId(provider, title, index) {
  const slug = `${provider}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || `item-${index + 1}`;
}

function normalizeItem(raw, provider, sourceUrl, index) {
  const title = String(raw?.title || "").trim().slice(0, 140);
  const summary = String(raw?.summary || raw?.text || "").trim().replace(/\s+/g, " ").slice(0, 320);
  const url = String(raw?.sourceUrl || raw?.url || sourceUrl || "").trim();
  if (!title || !summary || !/^https:\/\//i.test(url)) return null;
  if (looksSecret(`${title}\n${summary}`)) return null;
  const name = String(raw?.sourceName || raw?.provider || provider || "Source").slice(0, 40);
  return {
    id: String(raw?.id || itemId(name, title, index)).slice(0, 80),
    kind: ["model", "price", "feature"].includes(raw?.kind) ? raw.kind : kindOf(title, summary),
    title,
    summary,
    provider: name,
    sourceName: name,
    sourceUrl: url,
  };
}

export function itemsFromSource(source, indexOffset = 0) {
  if (!source || typeof source !== "object") return [];
  const provider = String(source.provider || "Source").slice(0, 40);
  const sourceUrl = String(source.url || source.sourceUrl || "").trim();
  if (!/^https:\/\//i.test(sourceUrl)) return [];
  if (Array.isArray(source.items)) {
    return source.items.map((item, index) => normalizeItem(item, provider, sourceUrl, indexOffset + index)).filter(Boolean);
  }
  const text = String(source.text || "");
  const chunks = text.split(/\n(?=#{1,3} )/).map((part) => part.trim()).filter(Boolean);
  const items = [];
  chunks.forEach((chunk, index) => {
    const lines = chunk.split(/\n/);
    const title = lines[0].replace(/^#{1,3}\s*/, "").trim();
    const summary = lines.slice(1).join(" ").trim();
    const item = normalizeItem({ title, summary }, provider, sourceUrl, indexOffset + index);
    if (item) items.push(item);
  });
  return items;
}

function versionRank(value) {
  const parts = String(value || "").split(".").map((n) => Number(n) || 0);
  return parts[0] * 1e6 + parts[1] * 1e3 + parts[2];
}

export function meldmindItems(news) {
  const versions = Object.keys(news || {}).filter((key) => /^\d+\.\d+\.\d+$/.test(key));
  versions.sort((a, b) => versionRank(b) - versionRank(a));
  const version = versions[0];
  if (!version) return [];
  const bullets = Array.isArray(news[version]?.bullets) ? news[version].bullets : [];
  return bullets
    .map((bullet) => String(bullet || "").trim())
    .filter((bullet) => bullet && !/shows once/i.test(bullet) && !looksSecret(bullet))
    .slice(0, 8)
    .map((bullet, index) => ({
      id: `meldmind-${version}-${index + 1}`,
      title: bullet.slice(0, 140),
      summary: bullet,
      version,
    }));
}

export function buildIssue({ week, sources, whatsNew, prompts, highlights, now = Date.now() } = {}) {
  const id = String(week || isoWeek(now));
  let ai = [];
  for (const source of sources || []) ai = ai.concat(itemsFromSource(source, ai.length));
  ai = ai.slice(0, 12);
  const meldmind = meldmindItems(whatsNew);
  const promptRows = (prompts || [])
    .map((row) => ({
      id: String(row.id || "").slice(0, 80),
      title: String(row.title || row.id || "Prompt").slice(0, 120),
      up: Math.max(0, Number(row.up) || 0),
      down: Math.max(0, Number(row.down) || 0),
    }))
    .filter((row) => row.id && !looksSecret(row.title))
    .sort((a, b) => (b.up - b.down) - (a.up - a.down) || b.up - a.up || a.title.localeCompare(b.title))
    .slice(0, 5);
  const highs = (highlights || [])
    .map((row, index) => ({
      id: String(row.id || `highlight-${index + 1}`).slice(0, 80),
      title: String(row.title || "Community").slice(0, 120),
      channel: String(row.channel || "general").slice(0, 20),
      excerpt: String(row.excerpt || "").replace(/\s+/g, " ").slice(0, 180),
    }))
    .filter((row) => row.excerpt && !looksSecret(row.excerpt))
    .slice(0, 5);
  return {
    id,
    week: id,
    title: `AI News ${id}`,
    status: "draft",
    createdAt: new Date(now).toISOString(),
    publishedAt: null,
    sections: { ai, meldmind, prompts: promptRows, highlights: highs },
  };
}

export function normalizeIssue(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.week || "").slice(0, 20);
  if (!id) return null;
  const built = buildIssue({
    week: id,
    sources: [],
    whatsNew: {},
    prompts: raw.sections?.prompts || raw.prompts || [],
    highlights: raw.sections?.highlights || raw.highlights || [],
    now: Date.parse(raw.createdAt) || Date.now(),
  });
  const ai = [];
  const incoming = raw.sections?.ai || raw.ai || [];
  for (const item of incoming) {
    const clean = normalizeItem(item, item?.provider, item?.sourceUrl, ai.length);
    if (clean) ai.push(clean);
  }
  built.sections.ai = ai;
  if (Array.isArray(raw.sections?.meldmind)) {
    built.sections.meldmind = raw.sections.meldmind
      .map((item, index) => ({
        id: String(item.id || `meldmind-${index + 1}`).slice(0, 80),
        title: String(item.title || item.summary || "").slice(0, 180),
        summary: String(item.summary || item.title || "").slice(0, 400),
        version: String(item.version || "").slice(0, 20),
      }))
      .filter((item) => item.summary && !looksSecret(item.summary))
      .slice(0, 8);
  }
  built.title = String(raw.title || built.title).slice(0, 80);
  built.status = raw.status === "published" ? "published" : "draft";
  built.createdAt = raw.createdAt || built.createdAt;
  built.publishedAt = raw.publishedAt || null;
  return built;
}

export function emptyNews() {
  return { draft: null, published: null, seen: null, reactions: [] };
}

export function reactionCounts(news, issueId, itemId, email = "") {
  const rows = (news?.reactions || []).filter((item) => item.issueId === issueId && item.itemId === itemId);
  const mine = rows.find((item) => item.email === email)?.reaction || null;
  return {
    up: rows.filter((item) => item.reaction === "up").length,
    down: rows.filter((item) => item.reaction === "down").length,
    mine,
  };
}

export function findIssueItem(issue, itemId) {
  const sections = issue?.sections || {};
  const lists = [sections.ai, sections.meldmind, sections.prompts, sections.highlights];
  for (const list of lists) {
    const hit = (list || []).find((item) => item.id === itemId);
    if (hit) return hit;
  }
  return null;
}

export function isUnread(news) {
  const issue = news?.published;
  if (!issue || issue.status !== "published") return false;
  return news.seen !== issue.id;
}

export function reactToItem(news, actor, { issueId, itemId, reaction }, now = Date.now()) {
  const next = {
    draft: news?.draft || null,
    published: news?.published || null,
    seen: news?.seen || null,
    reactions: Array.isArray(news?.reactions) ? news.reactions.slice() : [],
  };
  if (!actor?.email) return { ok: false, status: 401, error: "Sign in with the email on your licence first." };
  if (!next.published || next.published.id !== issueId || next.published.status !== "published") {
    return { ok: false, status: 404, error: "That issue is not published." };
  }
  if (!findIssueItem(next.published, itemId)) return { ok: false, status: 404, error: "That item is not in this issue." };
  const choice = reaction === "clear" ? "" : reaction;
  if (choice !== "" && choice !== "up" && choice !== "down") return { ok: false, status: 400, error: "Choose a reaction." };
  next.reactions = next.reactions.filter((item) => !(item.email === actor.email && item.issueId === issueId && item.itemId === itemId));
  if (choice) next.reactions.push({ email: actor.email, issueId, itemId, reaction: choice, at: now });
  return { ok: true, counts: reactionCounts(next, issueId, itemId, actor.email), news: next };
}

function esc(value) {
  return String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function itemLines(issue) {
  const lines = [];
  const ai = issue?.sections?.ai || [];
  if (ai.length) {
    lines.push("Newest in AI");
    for (const item of ai) lines.push(`- ${item.title} (${item.kind}). ${item.summary} Source: ${item.sourceName} ${item.sourceUrl}`);
    lines.push("");
  }
  const own = issue?.sections?.meldmind || [];
  if (own.length) {
    lines.push("New in Meldmind");
    for (const item of own) lines.push(`- ${item.summary}`);
    lines.push("");
  }
  const prompts = issue?.sections?.prompts || [];
  if (prompts.length) {
    lines.push("Top voted prompts");
    for (const item of prompts) lines.push(`- ${item.title} (${item.up} up, ${item.down} down)`);
    lines.push("");
  }
  const highs = issue?.sections?.highlights || [];
  if (highs.length) {
    lines.push("Community highlights");
    for (const item of highs) lines.push(`- ${item.title}: ${item.excerpt}`);
    lines.push("");
  }
  return lines;
}

export function renderEmail(issue, { unsubscribeUrl, address = ADDRESS_PLACEHOLDER } = {}) {
  const link = unsubscribeUrl || `${UNSUBSCRIBE_BASE}?token=preview`;
  const lines = [
    issue?.title || "AI News",
    "",
    ...itemLines(issue),
    "You are getting this note because you opted in to the Meldmind weekly AI News email.",
    "This file is a copy. It was not sent.",
    "",
    address,
    "",
    `Unsubscribe: ${link}`,
  ];
  const text = lines.join("\n");
  const blocks = itemLines(issue).map((line) => (line ? `<p>${esc(line)}</p>` : "")).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${esc(issue?.title || "AI News")}</title></head>
<body style="font-family: Georgia, serif; color: #1a1a1a; max-width: 640px; margin: 24px auto; line-height: 1.45;">
<h1>${esc(issue?.title || "AI News")}</h1>
${blocks}
<p>You are getting this note because you opted in to the Meldmind weekly AI News email. This file is a copy. It was not sent.</p>
<p style="white-space: pre-wrap;">${esc(address)}</p>
<p><a href="${esc(link)}">Unsubscribe</a></p>
</body>
</html>`;
  return { html, text, unsubscribeUrl: link };
}

export function shareText(item) {
  if (!item) return "";
  if (item.sourceUrl) return `${item.title}\n${item.summary || item.excerpt || ""}\n${item.sourceUrl}`.trim();
  if (item.excerpt) return `${item.title}\n${item.excerpt}`.trim();
  return `${item.title}\n${item.summary || ""}`.trim();
}
