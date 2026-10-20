// Legitimate ways to spend less. Free local models are tried first. Freebuff is never a provider.
// The same model sold by two providers keeps the cheaper seller. Off-peak discounts already live in
// estimateCostAt. A reported prompt-cache read is priced at the provider's cache rate. Batch is the
// published half-price for work that can wait; a live run still pays the live price.
import { estimateCostAt } from "./registry.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// Fraction of the input price for a reported cache read. Only rates checked against the
// provider's own pricing are listed. An unknown provider is not given a discount.
// google: Gemini 2.5 and later, including implicit cache hits, bill cached tokens at 10%.
// xai: Grok 4.7 bills cached input at $0.50 per 1M when input is $2 (a quarter). Other Grok
// models publish a different cached price, so they are not discounted here.
const CACHE_RATE = { anthropic: 0.1, openai: 0.5, google: 0.1, xai: 0.25 };
const XAI_CACHE_MODELS = new Set(["grok-4.7"]);

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
// A missing or unknown rate bills the whole call at the live price. It does not borrow another provider's rate.
export function cachedCallCost(model, usage, when = new Date()) {
  const input = Number(usage?.input) || 0;
  const output = Number(usage?.output) || 0;
  const read = Math.min(input, Math.max(0, Number(usage?.cacheRead) || 0));
  const rate = CACHE_RATE[usage?.cacheRate];
  if (!(read > 0) || rate == null) return estimateCostAt(model, input, output, when);
  const fresh = Math.max(0, input - read);
  return estimateCostAt(model, fresh, output, when) + estimateCostAt(model, read, 0, when) * rate;
}

// Gemini usageMetadata. promptTokenCount already includes cached tokens.
export function geminiUsage(meta, fallback = {}) {
  const reported = meta && (meta.promptTokenCount != null || meta.candidatesTokenCount != null);
  const cacheRead = Math.max(0, Number(meta?.cachedContentTokenCount) || 0);
  return {
    input: meta?.promptTokenCount ?? fallback.input,
    output: meta?.candidatesTokenCount ?? fallback.output,
    estimated: !reported,
    ...(cacheRead > 0 ? { cacheRead, cacheRate: "google" } : {}),
  };
}

// OpenAI-compatible usage. Only ChatGPT and Grok 4.7 get a cache rate. Groq, Mistral, DeepSeek,
// and the rest keep the live price: their cache fields are not the OpenAI half-price rate.
// DeepSeek's published hit price is not a fraction of the peak price in this table, and the
// off-peak rule already discounts that peak price, so a second fraction would stack.
export function compatCache(providerId, model, usage) {
  const read = Math.max(0, Number(usage?.prompt_tokens_details?.cached_tokens) || Number(usage?.prompt_cache_hit_tokens) || 0);
  if (!(read > 0)) return {};
  if (providerId === "openai") return { cacheRead: read, cacheRate: "openai" };
  if (providerId === "xai" && XAI_CACHE_MODELS.has(model)) return { cacheRead: read, cacheRate: "xai" };
  return {};
}

// Anthropic bills a cache breakpoint. Only long system text is marked, so short calls stay as they are.
export function cacheSystem(system) {
  if (typeof system !== "string" || system.length < 4000) return system;
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

export const BATCH_PROVIDERS = new Set(["openai", "anthropic", "google", "groq", "mistral"]);

// estCost is the live price (already including an off-peak discount when one is open).
// listCost is the same call with no time discount. Batch is half the list price, so it
// does not also take the off-peak discount.
export function batchNote(provider, estCost, listCost) {
  if (!BATCH_PROVIDERS.has(provider) || !(Number(estCost) > 0)) return null;
  const live = Number(estCost);
  const list = Number(listCost) > 0 ? Number(listCost) : live;
  const half = (list / 2).toFixed(4);
  if (list > live * 1.01) {
    return `Batch price is about $${half} (half the list price) when this can wait. A run you send now pays the live price. The batch price does not also take the off-peak discount.`;
  }
  return `Batch price is about $${half} (half the live price) when this can wait. A run you send now pays the live price. An off-peak discount is already in the estimate when one is open.`;
}
