// Custom providers and key help (v0.3.1). Lets the user add any OpenAI-compatible or Anthropic-compatible
// API (OpenRouter, Groq, Together, Fireworks, DeepSeek, Mistral, Perplexity, Ollama, LM Studio, or a
// company gateway) with a name, base URL, key, optional model list (or auto-discovery via /models) and
// optional extra headers. Custom providers join PROVIDERS, so council, router, missions, the ledger and
// key checks treat them like built-in ones. The key and extra headers live in the vault (never logged,
// never sent back to the browser); the rest (name, URL, style, models) is the "providers.custom" document.
// Also: POST /api/providers/suggest tells which provider a pasted key belongs to (AIza... = Google).
// Desktop / local mode only for now; a hosted hub refuses custom providers (one PROVIDERS table is shared).
import crypto from "node:crypto";
import { HOSTED, doc, putDoc } from "../store.js";
import { PROVIDERS, TEXT_PROVIDERS } from "../registry.js";
import { setSecret, getSecret } from "../vault.js";
import { checkProvider } from "../health.js";
import { isBlockedFree } from "../savings.js";

export const id = "providers";
const DOC = "providers.custom";
const NO_KEY = "no-key";
const STYLES = ["openai", "anthropic"];
const COLORS = ["#22D3EE", "#F472B6", "#A3E635", "#FBBF24", "#C084FC", "#34D399", "#F87171", "#60A5FA"];

// Quick presets for the Add dialog. Built-in ones point at the existing card instead of a duplicate.
export const PRESETS = [
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", api: "openai", builtin: "openrouter", keys: "https://openrouter.ai/settings/keys" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", api: "openai", builtin: "groq", keys: "https://console.groq.com/keys" },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", api: "openai", keys: "https://api.together.ai/settings/api-keys" },
  { id: "fireworks", name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", api: "openai", keys: "https://fireworks.ai/account/api-keys" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", api: "openai", builtin: "deepseek", keys: "https://platform.deepseek.com/api_keys" },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", api: "openai", builtin: "mistral", keys: "https://console.mistral.ai/api-keys" },
  { id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai", api: "openai", builtin: "perplexity", keys: "https://www.perplexity.ai/settings/api" },
  { id: "ollama", name: "Ollama (this PC)", baseUrl: "http://localhost:11434/v1", api: "openai", noKey: true, keys: "https://ollama.com/download" },
  { id: "lmstudio", name: "LM Studio (this PC)", baseUrl: "http://localhost:1234/v1", api: "openai", noKey: true, keys: "https://lmstudio.ai" },
  { id: "aider", name: "Aider", baseUrl: "http://127.0.0.1:11434/v1", api: "openai", noKey: true, keys: "https://aider.chat/docs/llms/openai-compat.html", note: "Aider talks to an OpenAI-compatible server on this PC. This starts at Ollama's address. Change it if Aider uses another one." },
  { id: "opencode", name: "OpenCode", baseUrl: "http://127.0.0.1:4096/v1", api: "openai", noKey: true, keys: "https://opencode.ai/docs/server/", note: "Use this when OpenCode is serving an OpenAI-compatible /v1 on this PC. The default port is 4096. Change the address if yours is different." },
];

// Which provider does a pasted key belong to? Order matters: specific prefixes first.
// Google AI Studio: new auth keys start with AQ. (since May 2026); older standard keys start with AIza (39 characters).
const KEY_RULES = [
  [/^sk-ant-/, "anthropic", "high"],
  [/^sk-or-/, "openrouter", "high"],
  [/^xai-/, "xai", "high"],
  [/^AQ\.[A-Za-z0-9_.-]{8,}$/, "google", "high"],
  [/^AIza[0-9A-Za-z_-]{20,}$/, "google", "high"],
  [/^pplx-/, "perplexity", "high"],
  [/^gsk_/, "groq", "high"],
  [/^fw_/, "fireworks", "high"],
  [/^tgp_/, "together", "high"],
  [/^sk-(proj|svcacct|admin)-/, "openai", "high"],
  [/^sk_[0-9a-f]{20,}/, "elevenlabs", "medium"],
  [/^sk-[0-9a-f]{32}$/, "deepseek", "medium"],
  [/^sk-[A-Za-z0-9_-]{20,}$/, "openai", "low"],
];
export function normalizePastedKey(key) {
  return String(key || "").trim().replace(/^\uFEFF/, "").replace(/^['"]+|['"]+$/g, "").replace(/^bearer\s+/i, "").trim();
}
export function suggestProvider(key) {
  const k = normalizePastedKey(key);
  if (!k) return null;
  for (const [re, provider, confidence] of KEY_RULES) if (re.test(k)) {
    const p = PROVIDERS[provider] || PRESETS.find((x) => x.id === provider);
    return { provider, name: p?.name || provider, confidence, builtin: !!PROVIDERS[provider] };
  }
  return null;
}

const list = () => doc(DOC, () => ({ list: [] })).list || [];
const save = (items) => putDoc(DOC, { list: items });
const err = (status, message) => Object.assign(new Error(message), { status });

function cleanUrl(u) {
  let url;
  try { url = new URL(String(u || "").trim()); } catch { throw err(400, "Base URL must be a full address, e.g. https://api.example.com/v1"); }
  if (!/^https?:$/.test(url.protocol)) throw err(400, "Base URL must start with http:// or https://");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw err(400, "Use https:// for providers that are not on this PC.");
  return url.toString().replace(/\/+$/, "");
}
function cleanHeaders(h) {
  const out = {};
  if (!h) return out;
  const entries = Array.isArray(h) ? h.map((x) => [x.name, x.value]) : Object.entries(h);
  for (const [name, value] of entries) {
    const n = String(name || "").trim(); if (!n) continue;
    if (!/^[A-Za-z0-9-]{1,64}$/.test(n)) throw err(400, `Header name "${n}" is not valid.`);
    if (/^(host|content-length|content-type)$/i.test(n)) continue;
    out[n] = String(value ?? "").slice(0, 2000);
  }
  return out;
}
const cleanModels = (m) => [...new Set((Array.isArray(m) ? m : String(m || "").split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean))].slice(0, 100);

// Turn a stored entry into a PROVIDERS record the rest of the app understands.
function toProvider(e, i = 0) {
  return {
    id: e.id, name: e.name, vendor: "Custom", color: e.color || COLORS[i % COLORS.length], kind: "text", auth: e.noKey ? "local" : "key", api: e.api, custom: true, noKey: !!e.noKey,
    baseUrl: e.baseUrl, keyEnv: null, keyHint: e.noKey ? "no key needed" : "API key",
    links: { keys: e.keysUrl || null, console: e.baseUrl.replace(/\/v\d+.*$/, "") || null },
    statusApi: null,
    models: (e.models || []).map((m, j) => ({ id: m, name: m, tier: j === 0 ? "balanced" : "economy", in: 0, out: 0, caps: { reasoning: 75, code: 75, writing: 75, research: 70, creative: 72, analysis: 75, math: 72, fast: 75 }, default: j === 0 })),
  };
}
function register(e, i) {
  if (isBlockedFree(e)) return;
  const p = toProvider(e, i);
  if (PROVIDERS[e.id] && !PROVIDERS[e.id].custom) return; // never shadow a built-in
  PROVIDERS[e.id] = p;
  const at = TEXT_PROVIDERS.findIndex((x) => x.id === e.id);
  if (at >= 0) TEXT_PROVIDERS[at] = p; else TEXT_PROVIDERS.push(p);
}
function unregister(pid) {
  if (!PROVIDERS[pid]?.custom) return;
  delete PROVIDERS[pid];
  const at = TEXT_PROVIDERS.findIndex((x) => x.id === pid);
  if (at >= 0) TEXT_PROVIDERS.splice(at, 1);
}
export function registerAll() { if (HOSTED) return 0; const l = list(); l.forEach(register); return l.length; }

// GET <base>/models with the key and headers; returns model ids.
export async function discoverModels({ baseUrl, api = "openai", key, headers = {} }) {
  const h = { ...headers };
  if (api === "anthropic") { if (key && key !== NO_KEY) h["x-api-key"] = key; h["anthropic-version"] = "2023-06-01"; }
  else if (key && key !== NO_KEY) h.authorization = `Bearer ${key}`;
  const url = api === "anthropic" ? `${baseUrl}/v1/models?limit=100` : `${baseUrl}/models`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  let r;
  try { r = await fetch(url, { headers: h, signal: ctl.signal }); }
  catch (e) { throw err(502, `Could not reach ${baseUrl} (${e.name === "AbortError" ? "timed out" : e.message}).`); }
  finally { clearTimeout(t); }
  if (!r.ok) throw err(r.status === 401 || r.status === 403 ? 400 : 502, r.status === 401 || r.status === 403 ? "The provider refused the key (HTTP " + r.status + ")." : `The provider answered HTTP ${r.status} for /models.`);
  const j = await r.json().catch(() => ({}));
  const ids = Array.isArray(j.data) ? j.data.map((m) => m.id) : Array.isArray(j.models) ? j.models.map((m) => m.id || m.name || m.model) : [];
  return ids.filter(Boolean).map(String).slice(0, 400);
}

const view = (e) => ({ id: e.id, name: e.name, baseUrl: e.baseUrl, api: e.api, models: e.models, noKey: !!e.noKey, keysUrl: e.keysUrl || null, headerNames: Object.keys(getSecret(e.id)?.headers || {}), keyed: !!getSecret(e.id), createdAt: e.createdAt });

export async function init() { try { registerAll(); } catch (e) { console.error("[providers] could not load custom providers:", e.message); } }

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/providers/, "").split("/").filter(Boolean);
  const method = req.method;

  if (method === "GET" && seg[0] === "presets") return h.json(res, 200, { presets: PRESETS.map((p) => ({ ...p, builtin: p.builtin && PROVIDERS[p.builtin] ? p.builtin : null })) });
  if (method === "POST" && seg[0] === "suggest") return h.json(res, 200, { suggestion: suggestProvider(body.key) }); // suggestion only: the key is never echoed or logged
  if (method === "GET" && seg[0] === "custom" && !seg[1]) return h.json(res, 200, { hosted: HOSTED, custom: list().map(view) });
  if (HOSTED && seg[0] === "custom") return h.json(res, 400, { error: "Custom providers are added in the desktop app for now." });

  if (method === "POST" && seg[0] === "discover") {
    const existing = body.id ? list().find((x) => x.id === body.id) : null;
    const discoverUrl = cleanUrl(body.baseUrl || existing?.baseUrl);
    if (isBlockedFree({ name: body.name || existing?.name, baseUrl: discoverUrl, id: body.id })) throw err(400, "Freebuff is not available in Meldmind.");
    const sec = existing ? getSecret(existing.id) : null;
    const models = await discoverModels({ baseUrl: discoverUrl, api: STYLES.includes(body.api) ? body.api : existing?.api || "openai", key: String(body.key || "").trim() || sec?.key, headers: { ...(sec?.headers || {}), ...cleanHeaders(body.headers) } });
    return h.json(res, 200, { models });
  }

  // create or update
  if (method === "POST" && seg[0] === "custom" && !seg[1]) {
    const items = list();
    const name = String(body.name || "").trim().slice(0, 60);
    if (!name) throw err(400, "Give the provider a name.");
    const baseUrl = cleanUrl(body.baseUrl);
    if (isBlockedFree({ name, baseUrl, id: body.id })) throw err(400, "Freebuff is not available in Meldmind.");
    const api = STYLES.includes(body.api) ? body.api : "openai";
    const noKey = !!body.noKey;
    const editing = body.id ? items.find((x) => x.id === body.id) : null;
    if (body.id && !editing) throw err(404, "custom provider not found");
    const pid = editing?.id || "c-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "provider") + "-" + crypto.randomBytes(3).toString("hex");
    if (!editing && PROVIDERS[pid]) throw err(409, "That id is taken; try another name.");
    const prev = editing ? getSecret(pid) : null;
    const key = noKey ? NO_KEY : String(body.key || "").trim() || prev?.key || "";
    if (!key) throw err(400, "Paste the API key (or tick 'no key needed' for Ollama, LM Studio, Aider, or OpenCode).");
    const headers = body.headers === undefined ? prev?.headers || {} : cleanHeaders(body.headers);
    let models = cleanModels(body.models);
    if (!models.length) {
      try { models = (await discoverModels({ baseUrl, api, key, headers })).slice(0, 40); }
      catch (e) { throw err(400, `${e.message} Type the model names instead (comma separated).`); }
      if (!models.length) throw err(400, "The provider listed no models. Type the model names instead (comma separated).");
    }
    const entry = { id: pid, name, baseUrl, api, models, noKey, keysUrl: body.keysUrl ? String(body.keysUrl).slice(0, 300) : editing?.keysUrl || null, color: editing?.color, createdAt: editing?.createdAt || Date.now(), updatedAt: Date.now() };
    await setSecret(pid, Object.keys(headers).length ? { key, headers } : { key });
    const next = editing ? items.map((x) => (x.id === pid ? entry : x)) : [...items, entry];
    save(next);
    register(entry, next.indexOf(entry));
    const t0 = Date.now() - 1;
    const status = await checkProvider(pid).catch(() => null);
    const demoRetired = h.retireDemoIfReal ? await h.retireDemoIfReal(t0) : false;
    return h.json(res, 200, { ok: true, provider: view(entry), status, demoRetired });
  }

  if (method === "DELETE" && seg[0] === "custom" && seg[1]) {
    const pid = decodeURIComponent(seg[1]);
    const items = list();
    if (!items.some((x) => x.id === pid)) throw err(404, "custom provider not found");
    save(items.filter((x) => x.id !== pid));
    unregister(pid);
    await setSecret(pid, null);
    return h.json(res, 200, { ok: true });
  }
  return false;
}
