// Provider and model registry.
// Prices are USD per 1M tokens (text) and are editable at runtime per user (the "pricing"
// document: data/pricing.json locally, a user_docs row hosted). caps = 0-100 baseline for how
// good the model is at a job family; the router adjusts them with what the council learns.
import { doc, putDoc } from "./store.js";

export const CAPABILITIES = ["reasoning", "code", "writing", "research", "creative", "analysis", "math", "fast"];

const M = (id, name, tier, inp, out, caps, extra = {}) => ({ id, name, tier, in: inp, out, caps, ...extra });

export const PROVIDERS = {
  anthropic: {
    id: "anthropic", name: "Claude", vendor: "Anthropic", color: "#D97757", kind: "text", api: "anthropic",
    baseUrl: "https://api.anthropic.com", keyEnv: "ANTHROPIC_API_KEY", keyHint: "sk-ant-api03-…",
    links: { app: "https://claude.ai", console: "https://platform.claude.com", billing: "https://platform.claude.com/settings/billing", keys: "https://platform.claude.com/settings/keys", status: "https://status.claude.com" },
    statusApi: "https://status.claude.com/api/v2/status.json",
    models: [
      M("claude-opus-5-5", "Claude Opus 5.5", "flagship", 4, 20, { reasoning: 96, code: 96, writing: 94, research: 88, creative: 92, analysis: 95, math: 93, fast: 45 }, { default: true }),
      M("claude-sonnet-5-5", "Claude Sonnet 5.5", "balanced", 2, 10, { reasoning: 90, code: 92, writing: 90, research: 84, creative: 87, analysis: 90, math: 88, fast: 70 }),
      M("claude-haiku-5-5", "Claude Haiku 5.5", "economy", 0.1, 0.5, { reasoning: 74, code: 78, writing: 80, research: 70, creative: 74, analysis: 76, math: 72, fast: 95 }),
    ],
  },
  openai: {
    id: "openai", name: "ChatGPT", vendor: "OpenAI", color: "#10A37F", kind: "text", api: "openai",
    baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", keyHint: "sk-proj-…",
    links: { app: "https://chatgpt.com", console: "https://platform.openai.com", billing: "https://platform.openai.com/settings/organization/billing/overview", usage: "https://platform.openai.com/usage", keys: "https://platform.openai.com/api-keys", status: "https://status.openai.com" },
    statusApi: "https://status.openai.com/api/v2/status.json",
    models: [
      M("gpt-6-astra", "GPT-6 Astra", "flagship", 10, 50, { reasoning: 96, code: 95, writing: 92, research: 88, creative: 90, analysis: 95, math: 96, fast: 40 }),
      M("gpt-6.1-sol", "GPT-6.1 Sol", "balanced", 2, 10, { reasoning: 92, code: 92, writing: 90, research: 85, creative: 88, analysis: 91, math: 92, fast: 65 }, { default: true }),
      M("gpt-6-luna", "GPT-6 Luna", "economy", 0.1, 0.5, { reasoning: 78, code: 80, writing: 80, research: 72, creative: 76, analysis: 78, math: 82, fast: 95 }),
    ],
  },
  xai: {
    id: "xai", name: "Grok", vendor: "xAI", color: "#E8E8E8", kind: "text", api: "openai",
    baseUrl: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY", keyHint: "xai-…",
    links: { app: "https://grok.com", console: "https://console.x.ai", billing: "https://console.x.ai", keys: "https://console.x.ai", status: "https://status.x.ai" },
    statusApi: null,
    models: [
      M("grok-4.7", "Grok 4.7", "flagship", 2, 6, { reasoning: 93, code: 90, writing: 88, research: 92, creative: 91, analysis: 91, math: 93, fast: 50 }, { default: true }),
      M("grok-4.3", "Grok 4.3", "balanced", 1.25, 2.5, { reasoning: 86, code: 84, writing: 84, research: 88, creative: 86, analysis: 86, math: 88, fast: 80 }),
      M("grok-build-0.1", "Grok Build 0.1 (code)", "economy", 1, 2, { reasoning: 80, code: 90, writing: 70, research: 70, creative: 68, analysis: 78, math: 84, fast: 85 }),
    ],
  },
  google: {
    id: "google", name: "Google Gemini", vendor: "Google", color: "#4E8CFF", kind: "text", api: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", keyHint: "AIza… (from aistudio.google.com/apikey)",
    links: { app: "https://gemini.google.com", console: "https://aistudio.google.com", billing: "https://aistudio.google.com/usage", keys: "https://aistudio.google.com/apikey", status: "https://status.cloud.google.com" },
    statusApi: "google-incidents",
    models: [
      M("gemini-4-argon", "Gemini 4 Argon", "flagship", 2, 10, { reasoning: 94, code: 92, writing: 91, research: 92, creative: 90, analysis: 94, math: 94, fast: 55 }, { default: true }),
      M("gemini-3.8-flash", "Gemini 3.8 Flash", "balanced", 0.75, 3.75, { reasoning: 86, code: 86, writing: 86, research: 86, creative: 84, analysis: 87, math: 88, fast: 88 }),
      M("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "economy", 0.25, 1.5, { reasoning: 74, code: 76, writing: 78, research: 76, creative: 74, analysis: 76, math: 78, fast: 97 }),
    ],
  },
  perplexity: {
    id: "perplexity", name: "Perplexity", vendor: "Perplexity", color: "#20B8CD", kind: "text", api: "openai",
    baseUrl: "https://api.perplexity.ai/router/v1", keyEnv: "PERPLEXITY_API_KEY", keyHint: "pplx-…",
    links: { app: "https://www.perplexity.ai", console: "https://www.perplexity.ai/settings/api", billing: "https://www.perplexity.ai/settings/api", keys: "https://www.perplexity.ai/settings/api", status: "https://status.perplexity.com" },
    statusApi: "https://status.perplexity.com/api/v2/status.json",
    models: [
      M("sonar-pro", "Sonar Pro (web)", "flagship", 3, 15, { reasoning: 80, code: 60, writing: 78, research: 97, creative: 60, analysis: 82, math: 70, fast: 70 }, { default: true, web: true }),
      M("sonar", "Sonar (web)", "economy", 1, 1, { reasoning: 70, code: 50, writing: 70, research: 92, creative: 55, analysis: 72, math: 60, fast: 85 }, { web: true }),
    ],
  },
  openrouter: {
    id: "openrouter", name: "OpenRouter", vendor: "OpenRouter", color: "#8B5CF6", kind: "text", api: "openai",
    baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", keyHint: "sk-or-v1-…", balanceApi: "openrouter-key",
    links: { app: "https://openrouter.ai/chat", console: "https://openrouter.ai", billing: "https://openrouter.ai/settings/credits", keys: "https://openrouter.ai/settings/keys", status: "https://status.openrouter.ai" },
    statusApi: null,
    models: [
      M("openrouter/auto", "Auto-router (300+ models)", "balanced", 1, 5, { reasoning: 86, code: 86, writing: 86, research: 80, creative: 84, analysis: 86, math: 86, fast: 70 }, { default: true, variable: true }),
      M("openrouter/free", "Free route (best free model)", "economy", 0, 0, { reasoning: 70, code: 72, writing: 74, research: 66, creative: 70, analysis: 70, math: 72, fast: 70 }, { variable: true }),
      M("anthropic/claude-sonnet-5-5", "Claude Sonnet 5.5 (via OR)", "balanced", 2, 10, { reasoning: 90, code: 92, writing: 90, research: 84, creative: 87, analysis: 90, math: 88, fast: 70 }),
    ],
  },
  deepseek: {
    id: "deepseek", name: "DeepSeek", vendor: "DeepSeek", color: "#4D6BFE", kind: "text", api: "openai",
    baseUrl: "https://api.deepseek.com", keyEnv: "DEEPSEEK_API_KEY", keyHint: "sk-…",
    links: { app: "https://chat.deepseek.com", console: "https://platform.deepseek.com", billing: "https://platform.deepseek.com/usage", keys: "https://platform.deepseek.com/api_keys", status: "https://status.deepseek.com" },
    statusApi: "https://status.deepseek.com/api/v2/status.json", balanceApi: "deepseek-balance",
    models: [
      M("deepseek-v4-pro", "DeepSeek V4 Pro", "balanced", 1.32, 3.96, { reasoning: 91, code: 92, writing: 84, research: 76, creative: 80, analysis: 90, math: 95, fast: 55 }, { default: true }),
      M("deepseek-flash", "DeepSeek Flash", "economy", 0.3, 1.2, { reasoning: 82, code: 86, writing: 80, research: 72, creative: 76, analysis: 82, math: 88, fast: 85 }),
    ],
  },
  groq: {
    id: "groq", name: "Groq", vendor: "Groq", color: "#F55036", kind: "text", api: "openai",
    baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", keyHint: "gsk_…",
    links: { app: "https://groq.com", console: "https://console.groq.com", billing: "https://console.groq.com/settings/billing", keys: "https://console.groq.com/keys", status: "https://groqstatus.com" },
    statusApi: "https://groqstatus.com/api/v2/status.json",
    models: [
      M("openai/gpt-oss-120b", "GPT-OSS 120B (Groq)", "economy", 0.15, 0.6, { reasoning: 82, code: 82, writing: 80, research: 70, creative: 76, analysis: 82, math: 84, fast: 98 }, { default: true }),
      M("openai/gpt-oss-20b", "GPT-OSS 20B (Groq)", "economy", 0.075, 0.3, { reasoning: 72, code: 74, writing: 74, research: 62, creative: 70, analysis: 72, math: 76, fast: 99 }),
    ],
  },
  mistral: {
    id: "mistral", name: "Mistral", vendor: "Mistral AI", color: "#FF7000", kind: "text", api: "openai",
    baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY", keyHint: "…",
    links: { app: "https://chat.mistral.ai", console: "https://console.mistral.ai", billing: "https://console.mistral.ai/billing", keys: "https://console.mistral.ai/api-keys", status: "https://status.mistral.ai" },
    statusApi: "https://status.mistral.ai/api/v2/status.json",
    models: [
      M("mistral-large-latest", "Mistral Large 4", "balanced", 0.68, 2.09, { reasoning: 86, code: 86, writing: 88, research: 74, creative: 84, analysis: 86, math: 84, fast: 65 }, { default: true }),
      M("mistral-small-latest", "Mistral Small 4", "economy", 0.15, 0.6, { reasoning: 76, code: 78, writing: 80, research: 66, creative: 76, analysis: 76, math: 74, fast: 92 }),
    ],
  },

  // ---- Media and creative tools: tracked for credits, status and links. ----
  kling: {
    id: "kling", name: "Kling AI", vendor: "Kuaishou", color: "#7CF5A0", kind: "media", api: "kling",
    keyEnv: "KLING_ACCESS_KEY", keyHint: "access key + secret key (API)", unit: "credits",
    links: { app: "https://app.klingai.com", console: "https://app.klingai.com/global/dev", billing: "https://app.klingai.com/global/membership", status: null },
  },
  suno: {
    id: "suno", name: "Suno", vendor: "Suno", color: "#FF5A5F", kind: "media", api: null, unit: "credits",
    links: { app: "https://suno.com", console: "https://suno.com/create", billing: "https://suno.com/account", status: null },
  },
  flow: {
    id: "flow", name: "Google Flow (Veo)", vendor: "Google Labs", color: "#A78BFA", kind: "media", api: null, unit: "AI credits",
    links: { app: "https://flow.google.com", console: "https://labs.google", billing: "https://one.google.com/ai", status: null },
  },
  syncso: {
    id: "syncso", name: "Sync.so", vendor: "sync. labs", color: "#F59E0B", kind: "media", api: "syncso", keyEnv: "SYNC_API_KEY", keyHint: "sk-…", unit: "credits",
    links: { app: "https://sync.so", console: "https://sync.so", billing: "https://sync.so", status: null },
  },
  hedra: {
    id: "hedra", name: "Hedra", vendor: "Hedra", color: "#38BDF8", kind: "media", api: null, unit: "credits",
    links: { app: "https://www.hedra.com", console: "https://www.hedra.com/app", billing: "https://www.hedra.com/app", status: null },
  },
  elevenlabs: {
    id: "elevenlabs", name: "ElevenLabs", vendor: "ElevenLabs", color: "#FACC15", kind: "media", api: "elevenlabs", keyEnv: "ELEVENLABS_API_KEY", keyHint: "sk_…", unit: "characters",
    links: { app: "https://elevenlabs.io/app", console: "https://elevenlabs.io/app/settings/api-keys", billing: "https://elevenlabs.io/app/subscription", status: "https://status.elevenlabs.io" },
    statusApi: "https://status.elevenlabs.io/api/v2/status.json",
  },
  cursor: {
    id: "cursor", name: "Cursor", vendor: "Anysphere", color: "#E5E7EB", kind: "tool", api: null, unit: "requests",
    links: { app: "https://cursor.com", console: "https://cursor.com/dashboard", billing: "https://cursor.com/settings", status: "https://status.cursor.com" },
  },
  capcut: {
    id: "capcut", name: "CapCut", vendor: "ByteDance", color: "#F472B6", kind: "tool", api: null,
    links: { app: "https://www.capcut.com", console: "https://www.capcut.com", billing: "https://www.capcut.com", status: null },
  },
};

// Test and development hook: CC_BASE_URL_<ID> points one provider at a local mock. Installed builds ignore it.
if (process.env.CC_PACKAGED !== "1") for (const p of Object.values(PROVIDERS)) { const o = process.env[`CC_BASE_URL_${p.id.toUpperCase()}`]; if (o) p.baseUrl = o; }

export const TEXT_PROVIDERS = Object.values(PROVIDERS).filter((p) => p.kind === "text");

// ---- runtime price overrides (per user; the registry itself is never mutated) ----
const overrides = () => doc("pricing", () => ({}));
export function setPricing(modelId, { in: inp, out }) {
  const o = overrides();
  o[modelId] = { in: Number(inp), out: Number(out) };
  putDoc("pricing", o);
}
// list price for a model with the current user's overrides applied
export function modelPrice(modelId) {
  const m = findModel(modelId);
  if (!m) return { in: 0, out: 0 };
  const o = overrides()[modelId];
  return { in: o?.in ?? m.in, out: o?.out ?? m.out };
}

export function findModel(modelId) {
  for (const p of TEXT_PROVIDERS) {
    const m = p.models.find((x) => x.id === modelId);
    if (m) return m;
  }
  return null;
}
export function providerOfModel(modelId) {
  return TEXT_PROVIDERS.find((p) => p.models.some((m) => m.id === modelId)) || null;
}
export function estimateCost(modelId, inTok, outTok) {
  // list price (no time-of-day discount); use estimateCostAt() for the price right now
  if (!findModel(modelId)) return 0;
  const pr = modelPrice(modelId);
  return (inTok / 1e6) * pr.in + (outTok / 1e6) * pr.out;
}

// ---- time-of-day pricing rules (discount windows) ----
// A rule marks PEAK hours (in its time zone, weekdays only unless weekendPeak is true);
// outside peak the discount applies. DeepSeek publishes exactly this kind of schedule.
export const DEFAULT_RULES = [
  { id: "deepseek-offpeak", provider: "deepseek", name: "DeepSeek off-peak", pct: 50, tz: "UTC", peakHours: [[1, 4], [6, 10]], weekendPeak: false, enabled: true,
    note: "50% off outside the published peak windows (01–04 and 06–10 UTC, Mon–Fri)." },
  { id: "demo-offpeak", provider: "demo-atlas", name: "Atlas (demo) night rate", pct: 40, tz: "America/Los_Angeles", peakHours: [[8, 20]], weekendPeak: false, enabled: true,
    note: "Demo rule so the scheduler can be tried without real keys." },
];
export function loadRules() { return doc("rules", () => structuredClone(DEFAULT_RULES)); }
export const pricingRules = () => loadRules();
export function saveRules(next) { putDoc("rules", next); }

function zoned(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false, weekday: "short", minute: "numeric" }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return { hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekend: ["Sat", "Sun"].includes(get("weekday")) };
  } catch { return { hour: date.getUTCHours(), minute: date.getUTCMinutes(), weekend: [0, 6].includes(date.getUTCDay()) }; }
}
export function ruleActive(rule, when = new Date()) {
  if (!rule.enabled) return false;
  const z = zoned(when, rule.tz || "UTC");
  if (z.weekend && !rule.weekendPeak) return true; // no peak on weekends → discount all day
  const peak = (rule.peakHours || []).some(([a, b]) => z.hour >= a && z.hour < b);
  return !peak;
}
// Best active discount for a provider right now
export function activeDiscount(providerId, when = new Date()) {
  let best = null;
  for (const r of pricingRules()) if (r.provider === providerId && ruleActive(r, when) && (!best || r.pct > best.pct)) best = r;
  return best;
}
// Next moment (within 48 h) a discount becomes active for this provider; null if none / already active
export function nextDiscountStart(providerId, from = new Date()) {
  const rs = pricingRules().filter((r) => r.provider === providerId && r.enabled);
  if (!rs.length) return null;
  if (rs.some((r) => ruleActive(r, from))) return null;
  const t = new Date(from); t.setMinutes(0, 0, 0);
  for (let i = 1; i <= 48; i++) {
    const c = new Date(t.getTime() + i * 3600000);
    const r = rs.find((x) => ruleActive(x, c));
    if (r) return { at: c, rule: r };
  }
  return null;
}
export function effectivePrice(modelId, when = new Date()) {
  if (!findModel(modelId)) return null;
  const m = modelPrice(modelId);
  const p = providerOfModel(modelId);
  const d = p ? activeDiscount(p.id, when) : null;
  const f = d ? 1 - d.pct / 100 : 1;
  return { in: +(m.in * f).toFixed(4), out: +(m.out * f).toFixed(4), discount: d ? { pct: d.pct, name: d.name } : null };
}
export function estimateCostAt(modelId, inTok, outTok, when = new Date()) {
  const e = effectivePrice(modelId, when);
  if (!e) return 0;
  return (inTok / 1e6) * e.in + (outTok / 1e6) * e.out;
}
