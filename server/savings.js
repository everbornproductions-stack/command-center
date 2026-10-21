// Legitimate ways to spend less. Free local models are tried first. Freebuff is never a provider.
// The same model sold by two providers keeps the cheaper seller. Off-peak discounts already live in
// estimateCostAt. A reported prompt-cache read is priced at the provider's cache rate. Batch is the
// published half-price for work that can wait; a live run still pays the live price.
import { estimateCostAt } from "./registry.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const CACHE_RATE = { anthropic: 0.1, openai: 0.5 };

export function isBlockedFree(p) {
  const hay = `${p?.provider || ""} ${p?.id || ""} ${p?.name || ""} ${p?.providerName || ""} ${p?.baseUrl || ""}`.toLowerCase();
  return hay.includes("freebuff");
}

export function isLocalFree(m, meta = null) {
  const p = meta || {};
  if (isBlockedFree(m) || isBlockedFree(p)) return false;
  const id = `${m?.provider || ""} ${m?.providerName || ""} ${p.id || ""} ${p.name || ""}`.toLowerCase();
  if (/\b(ollama|aider|opencode)\b/.test(id) || id.includes("lm studio") || id.includes("lmstudio")) return true;
  if (!p.custom && !m?.custom) return false;
  let host = "";
  try { host = new URL(p.baseUrl || m?.baseUrl || "").hostname; } catch { host = ""; }
  const openai = (p.api || m?.api || "openai") === "openai";
  return openai && (LOCAL_HOSTS.has(host) || !!p.noKey || !!m?.noKey);
}

// How far a paid model may lead on quality before it beats a connected free local model.
// Max savings (and the old economy name) always tries the local model first.
export function localGap(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === "economy" || m === "savings") return Infinity;
  if (m === "max") return 0;
  if (m === "quality") return 6;
  if (m === "speed") return 12;
  return 15;
}

export function applyLocalFirst(scored, mode) {
  if (!Array.isArray(scored) || scored.length < 2) return scored;
  const local = scored.find((m) => m.localFree);
  if (!local || local === scored[0]) return scored;
  const gap = (scored[0].quality || 0) - (local.quality || 0);
  if (gap > localGap(mode)) return scored;
  return [{ ...local, localFirst: true }, ...scored.filter((m) => m !== local)];
}

// Strip one seller prefix so claude-sonnet and anthropic/claude-sonnet are one model.
export function canonicalModel(id) {
  const s = String(id || "").toLowerCase();
  const i = s.indexOf("/");
  return i > 0 ? s.slice(i + 1) : s;
}

export function keepCheapestSeller(scored) {
  if (!Array.isArray(scored) || scored.length < 2) return scored;
  const groups = new Map();
  for (const m of scored) {
    const key = canonicalModel(m.model);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const drop = new Set();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    let best = rows[0];
    for (const m of rows.slice(1)) {
      if (m.estCost < best.estCost - 1e-9) best = m;
      else if (Math.abs(m.estCost - best.estCost) <= 1e-9 && best.provider === "openrouter" && m.provider !== "openrouter") best = m;
    }
    for (const m of rows) if (m !== best) drop.add(m);
  }
  return drop.size ? scored.filter((m) => !drop.has(m)) : scored;
}

// Cache reads are cheaper. input already includes the cached tokens. rate is the fraction of the input price.
export function cachedCallCost(model, usage, when = new Date()) {
  const input = Number(usage?.input) || 0;
  const output = Number(usage?.output) || 0;
  const read = Math.min(input, Math.max(0, Number(usage?.cacheRead) || 0));
  const rate = CACHE_RATE[usage?.cacheRate] ?? 0.1;
  const fresh = Math.max(0, input - read);
  return estimateCostAt(model, fresh, output, when) + estimateCostAt(model, read, 0, when) * rate;
}

// Anthropic bills a cache breakpoint. Only long system text is marked, so short calls stay as they are.
export function cacheSystem(system) {
  if (typeof system !== "string" || system.length < 4000) return system;
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

export const BATCH_PROVIDERS = new Set(["openai", "anthropic", "google", "groq"]);

export function batchNote(provider, estCost) {
  if (!BATCH_PROVIDERS.has(provider) || !(Number(estCost) > 0)) return null;
  const half = (Number(estCost) / 2).toFixed(4);
  return `Batch price is about $${half} (half the live price) when this can wait. A run you send now pays the live price. An off-peak discount is already in the estimate when one is open.`;
}
