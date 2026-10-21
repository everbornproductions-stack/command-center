// When a chat names an imported ChatGPT or Claude conversation, that transcript
// rides along as context. Other imports stay out. Keys in the excerpt are hidden.
import { ctx } from "./store.js";
import { scrubText } from "./prompts/safety.js";

const KEYISH = /\b(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9]{12,}|gsk_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/g;
const SOURCE = { chatgpt: "ChatGPT", claude: "Claude" };

export function importedChats() {
  let rows = [];
  try {
    rows = ctx().store.listMissions((m) => {
      if (!m || m.kind !== "imported") return null;
      if (m.source !== "chatgpt" && m.source !== "claude") return null;
      return { id: m.id, title: String(m.title || "").trim(), source: m.source, text: String(m.deliverable || "").slice(0, 2000) };
    });
  } catch {
    return [];
  }
  return (rows || []).filter((r) => r && r.title);
}

export function quotedTitles(prompt) {
  const text = String(prompt || "");
  const found = new Set();
  const quoted = /["“]([^"”\n]{3,180})["”]/g;
  const bracket = /(?:^|\s)@\[([^\]]{3,180})\]/g;
  let m;
  while ((m = quoted.exec(text))) found.add(m[1].trim().toLowerCase());
  while ((m = bracket.exec(text))) found.add(m[1].trim().toLowerCase());
  return found;
}

export function matchImported(prompt, chats) {
  const text = String(prompt || "");
  const low = text.toLowerCase();
  const quoted = quotedTitles(text);
  const hits = [];
  for (const c of chats || []) {
    const title = String(c.title || "").trim();
    if (title.length < 3) continue;
    const key = title.toLowerCase();
    const isQuoted = quoted.has(key);
    const bare = title.length >= 12 && low.includes(key);
    if (!isQuoted && !bare) continue;
    hits.push({ ...c, rank: isQuoted ? 2 : 1 });
  }
  hits.sort((a, b) => b.rank - a.rank || String(b.title).length - String(a.title).length);
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h);
    if (out.length >= 3) break;
  }
  return out;
}

export function referenceBlock(prompt, chats, { maxChars = 4000 } = {}) {
  const hits = matchImported(prompt, chats);
  if (!hits.length) return { block: "", used: [] };
  const parts = ["IMPORTED CONVERSATIONS the person named. Use only these turns. Do not invent extra messages."];
  const used = [];
  let left = maxChars;
  for (const c of hits) {
    let body = scrubText(String(c.text || "")).text.replace(KEYISH, "[hidden]").trim();
    if (!body) continue;
    body = body.slice(0, Math.min(1800, left));
    const source = SOURCE[c.source] || "Imported";
    parts.push(`### ${c.title} (${source})\n${body}`);
    used.push({ id: c.id, title: c.title, source: c.source });
    left -= body.length;
    if (left <= 0) break;
  }
  if (!used.length) return { block: "", used: [] };
  return { block: parts.join("\n\n"), used };
}

export function withImported(prompt, ask) {
  try {
    const { block, used } = referenceBlock(prompt, importedChats());
    if (!block) return { ask, used: [] };
    return { ask: `${ask}\n\n${block}`, used };
  } catch {
    return { ask, used: [] };
  }
}
