// Weekly prompt packs. Bundled JSON in server/prompts/packs, plus rows from
// the prompt_packs table when Supabase answers. Same id, or a near-duplicate
// title, is kept once. A newer added_week wins.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACK_DIR = path.join(here, "packs");

export const PACK_CATEGORIES = [
  "writing",
  "email",
  "marketing and ads",
  "social media",
  "sales",
  "coding",
  "research and summaries",
  "business planning",
  "studying and learning",
  "images and design",
  "video",
  "productivity",
  "customer support",
  "finance and accounting",
  "legal and contracts (informational)",
  "HR and hiring",
  "real estate",
  "mortgage",
  "insurance",
  "credit repair",
  "creators",
  "personal life",
  "builders",
];

export function safeSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

export function normalizePackRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim().slice(0, 80);
  const title = String(raw.title || "").trim().slice(0, 140);
  const category = String(raw.category || "").trim();
  const prompt = String(raw.prompt || "").trim().slice(0, 4000);
  if (!id || !title || !prompt) return null;
  if (!PACK_CATEGORIES.includes(category)) return null;
  if (category !== "builders" && !/\[[^\]\n]{1,80}\]/.test(prompt)) return null;
  const week = String(raw.added_week || "").trim();
  const feature = raw.feature === "remix" ? "remix" : (raw.builder ? "builders" : "");
  return {
    id,
    title,
    category,
    industry: String(raw.industry || "").trim().slice(0, 80),
    prompt,
    source_name: String(raw.source_name || "").trim().slice(0, 120),
    source_url: safeSourceUrl(raw.source_url),
    popularity_note: String(raw.popularity_note || "").trim().slice(0, 200),
    added_week: /^\d{4}-W\d{2}$/.test(week) ? week : "",
    builder: String(raw.builder || "").trim().slice(0, 40),
    feature,
  };
}

export function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

export function nearDuplicateTitle(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const dist = levenshtein(x, y);
  const max = Math.max(x.length, y.length);
  if (dist <= 2 && Math.min(x.length, y.length) >= 10) return true;
  return max >= 12 && dist / max <= 0.12;
}

function weekRank(row) {
  const m = String(row?.added_week || "").match(/^(\d{4})-W(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number(m[2]);
}

function prefer(a, b) {
  if (weekRank(b) > weekRank(a)) return b;
  if (weekRank(a) > weekRank(b)) return a;
  return b;
}

export function dedupePrompts(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    const clean = row?.id && row?.title && row?.prompt ? row : normalizePackRow(row);
    if (!clean) continue;
    const prev = byId.get(clean.id);
    byId.set(clean.id, prev ? prefer(prev, clean) : clean);
  }
  const ordered = [...byId.values()].sort((a, b) => weekRank(b) - weekRank(a) || a.title.localeCompare(b.title));
  const kept = [];
  for (const row of ordered) {
    if (kept.some((other) => other.id !== row.id && nearDuplicateTitle(other.title, row.title))) continue;
    kept.push(row);
  }
  return kept;
}

export function readPackDir(dir = PACK_DIR) {
  const rows = [];
  if (!fs.existsSync(dir)) return rows;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of list) {
      const clean = normalizePackRow(row);
      if (clean) rows.push(clean);
    }
  }
  return rows;
}

export function mergePacks(bundled, cloudRows) {
  return dedupePrompts([...(bundled || []), ...(cloudRows || [])]);
}

// Where a builder prompt goes. Missing features fill the chat and send nothing.
export function openPlan(prompt, { features = [] } = {}) {
  const text = String(prompt?.prompt || prompt?.title || "").trim();
  const feature = prompt?.feature === "remix" ? "remix" : (prompt?.builder ? "builders" : "");
  if (!feature || !features.includes(feature)) return { kind: "chat", text };
  if (feature === "remix") return { kind: "remix", text, storageKey: "cc.remixIdea" };
  return { kind: "builder", id: String(prompt.builder || ""), text, storageKey: "cc.builderText", openKey: "cc.builderOpen" };
}

export function creditLine(prompt) {
  const name = String(prompt?.source_name || "").trim();
  if (!name) return "";
  return `Inspired by ${name}`;
}
