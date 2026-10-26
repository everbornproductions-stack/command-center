// Live web search with cited sources (Phase 15).
// A pluggable search engine using the person's own key (Tavily, Brave Search, Serper), or the
// model's built-in search where the provider has one (Perplexity Sonar, xAI Live Search). Results
// are numbered and injected into the prompt so the answer can cite [1], [2], ...; the UI turns
// those into clickable source chips. Every search is a ledger line with its cost and respects the
// monthly caps of the alerts plugin. Demo mode uses a pretend engine (no network, no cost).
// Keys live in the vault under "search-<engine>" and are never logged or echoed.
import { doc, putDoc } from "./store.js";
import { getSecret, maskedKey, hasSecret } from "./vault.js";
import { emit } from "./events.js";
import { recordSearch, summary as ledgerSummary } from "./ledger.js";
import { networkCause } from "./health.js";
import { demoActive } from "./mock.js";
import { PROVIDERS } from "./registry.js";
import { localFetch, isLoopback } from "./loopback-fetch.js";
import { freeSearchBlock } from "./feature-gate.js";

export const KIND = "search.settings";
export const MODES = ["single", "council", "mission"];
export const FILTERS = ["web", "news", "academic"];
export const DEFAULTS = { engine: "auto", maxResults: 5, filter: "web", searxngUrl: "", on: { single: false, council: false, mission: false }, caps: {}, prices: {} };

// List prices as published on 2026-10-18 (per search unless noted); editable in Settings > Web search.
export const ENGINES = {
  tavily: { id: "tavily", name: "Tavily", vendor: "Tavily", color: "#2DD4BF", looks: "tvly-...", envName: "TAVILY_API_KEY", baseUrl: "https://api.tavily.com",
    keysUrl: "https://app.tavily.com/home", pricingUrl: "https://www.tavily.com/#pricing", perSearch: 0.008, note: "1 credit per basic search; pay as you go is $8 per 1,000 credits. A free monthly allowance exists." },
  brave: { id: "brave", name: "Brave Search", vendor: "Brave", color: "#FB542B", looks: "BSA...", envName: "BRAVE_SEARCH_API_KEY", baseUrl: "https://api.search.brave.com",
    keysUrl: "https://api-dashboard.search.brave.com/app/keys", pricingUrl: "https://brave.com/search/api/", perSearch: 0.005, note: "Base plan $5 per 1,000 queries; the free plan has a monthly allowance." },
  serper: { id: "serper", name: "Serper", vendor: "Serper", color: "#60A5FA", looks: "a 40-character hex key", envName: "SERPER_API_KEY", baseUrl: "https://google.serper.dev",
    keysUrl: "https://serper.dev/api-key", pricingUrl: "https://serper.dev/", perSearch: 0.001, note: "Google results; $1 per 1,000 queries on the smallest pack, cheaper in bulk." },
  exa: { id: "exa", name: "Exa", vendor: "Exa", color: "#7C3AED", looks: "a long hex key", envName: "EXA_API_KEY", baseUrl: "https://api.exa.ai",
    keysUrl: "https://dashboard.exa.ai/api-keys", pricingUrl: "https://exa.ai/pricing", perSearch: 0.005, note: "Default $0.005 per search. Edit it to match your Exa plan." },
  pplx: { id: "pplx", name: "Perplexity", vendor: "Perplexity", color: "#20B8CD", looks: "pplx-...", envName: "PERPLEXITY_API_KEY", baseUrl: "https://api.perplexity.ai",
    keysUrl: "https://www.perplexity.ai/settings/api", pricingUrl: "https://docs.perplexity.ai", perSearch: 0.005, note: "Default $0.005 per search. Edit it to match your Perplexity plan. Sonar chat search stays under the model's own search." },
};
// No key. DuckDuckGo is the default when you have not added a paid engine. SearXNG is used when you paste an instance address.
export const FREE = {
  duckduckgo: { id: "duckduckgo", name: "DuckDuckGo", vendor: "DuckDuckGo", color: "#DE5833", baseUrl: "https://html.duckduckgo.com", perSearch: 0, note: "No key. Free web results. On for every plan, with a daily limit on Free." },
  searxng: { id: "searxng", name: "SearXNG", vendor: "SearXNG", color: "#3050C8", baseUrl: "", perSearch: 0, note: "Your own SearXNG instance. No key. Paste its address in Settings." },
};
// Built-in search of a text provider: no separate engine, the model searches as it answers.
export const NATIVE = {
  perplexity: { name: "Perplexity Sonar", perSearch: 0.005, unit: "request", note: "Sonar adds a request fee of about $5 per 1,000 requests on top of tokens." },
  xai: { name: "xAI Live Search", perSearch: 0.025, unit: "source", note: "Grok charges $25 per 1,000 sources used." },
  google: { name: "Gemini grounding", perSearch: 0, unit: "request", note: "Gemini searches inside the Gemini call. The token line is the bill. This search line is $0." },
};
const DEMO_ENGINE = { id: "demo", name: "Demo search", color: "#F472B6" };

// Test and development hook: CC_SEARCH_URL_<ENGINE> points one engine at a local mock. Installed builds ignore it.
if (process.env.CC_PACKAGED !== "1") {
  for (const e of [...Object.values(ENGINES), ...Object.values(FREE)]) {
    const o = process.env[`CC_SEARCH_URL_${e.id.toUpperCase()}`];
    if (o) e.baseUrl = o;
  }
}

export const normalizeFilter = (f) => (FILTERS.includes(String(f || "web")) ? String(f || "web") : "web");
export function applyFilter(q, filter) {
  const base = String(q || "").trim();
  const f = normalizeFilter(filter);
  if (!base) return "";
  if (f === "news") return `${base} news`.slice(0, 300);
  if (f === "academic") return `${base} (site:arxiv.org OR site:scholar.google.com OR site:pubmed.ncbi.nlm.nih.gov)`.slice(0, 300);
  return base.slice(0, 300);
}
// Public web calls are skipped when CC_SEARCH_OFFLINE=1 (the test suite). Loopback mocks still run.
export function mayCallLive(url) {
  if (isLoopback(url)) return true;
  if (process.env.CC_SEARCH_OFFLINE === "1") return false;
  return /^https?:\/\//i.test(String(url || ""));
}

export const secretId = (engine) => `search-${engine}`;
export const engineKeyed = (engine) => !!ENGINES[engine] && hasSecret(secretId(engine), ENGINES[engine].envName);
export const engineMasked = (engine) => maskedKey(secretId(engine), ENGINES[engine]?.envName);

export function searxngBase() {
  return String(FREE.searxng.baseUrl || searchSettings().searxngUrl || "").trim().replace(/\/$/, "");
}
export function searchSettings() {
  const s = { ...DEFAULTS, ...doc(KIND, () => ({ ...DEFAULTS })) };
  s.on = { ...DEFAULTS.on, ...(s.on || {}) };
  s.caps = s.caps && typeof s.caps === "object" ? s.caps : {};
  s.prices = s.prices && typeof s.prices === "object" ? s.prices : {};
  s.filter = normalizeFilter(s.filter);
  s.searxngUrl = String(s.searxngUrl || "");
  return s;
}
export function saveSearchSettings(patch) {
  const cur = searchSettings();
  const next = { ...cur };
  if (patch.engine !== undefined) {
    const e = String(patch.engine);
    if (!(e === "auto" || e === "model" || ENGINES[e] || FREE[e])) throw Object.assign(new Error("unknown search engine"), { status: 400 });
    next.engine = e;
  }
  if (patch.filter !== undefined) {
    const f = String(patch.filter || "");
    if (!FILTERS.includes(f)) throw Object.assign(new Error("filter must be web, news, or academic"), { status: 400 });
    next.filter = f;
  }
  if (patch.searxngUrl !== undefined) {
    const u = String(patch.searxngUrl || "").trim();
    if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw Object.assign(new Error("SearXNG address must be an http(s) URL."), { status: 400 });
    next.searxngUrl = u.replace(/\/$/, "");
  }
  if (patch.maxResults !== undefined) next.maxResults = Math.min(10, Math.max(1, Math.round(Number(patch.maxResults) || 5)));
  if (patch.on && typeof patch.on === "object") { next.on = { ...cur.on }; for (const m of MODES) if (typeof patch.on[m] === "boolean") next.on[m] = patch.on[m]; }
  if (patch.caps && typeof patch.caps === "object") { next.caps = {}; for (const [k, v] of Object.entries(patch.caps)) if ((ENGINES[k] || NATIVE[k]) && Number(v) > 0) next.caps[k] = Number(v); }
  if (patch.prices && typeof patch.prices === "object") { next.prices = { ...cur.prices }; for (const [k, v] of Object.entries(patch.prices)) { if (!(ENGINES[k] || NATIVE[k])) continue; if (v === null || v === "") delete next.prices[k]; else if (Number(v) >= 0) next.prices[k] = Number(v); } }
  putDoc(KIND, next);
  return searchSettings();
}
export const priceOf = (engine) => { const s = searchSettings(); return s.prices[engine] ?? (ENGINES[engine]?.perSearch ?? NATIVE[engine]?.perSearch ?? 0); };
// Monthly caps for the alerts plugin, keyed the way the ledger names search spend (search-<engine>).
export function searchCaps() { const out = {}; for (const [k, v] of Object.entries(searchSettings().caps)) out[ENGINES[k] ? secretId(k) : k] = v; return out; }
export const nameOfLedgerProvider = (pid) => (pid === "demo-search" ? DEMO_ENGINE.name : (ENGINES[String(pid).replace(/^search-/, "")] || FREE[String(pid).replace(/^search-/, "")])?.name || null);

// Is the monthly cap for this engine spent? Read straight from the ledger so a cap raised or removed
// a moment ago counts at once (the alerts plugin does the amber / stop notifications).
export function capStopped(engine) {
  const cap = searchSettings().caps[engine];
  if (!cap) return false;
  const id = ENGINES[engine] ? secretId(engine) : engine;
  return (ledgerSummary().byProvider?.[id]?.month || 0) >= cap;
}

export const nativeSupported = (provider, model) => provider === "xai" || provider === "google" || (provider === "perplexity" && !!PROVIDERS.perplexity?.models?.some((m) => m.id === model && m.web)) || (provider === "perplexity" && !model);

function freeChoice(id) {
  if (id === "searxng") {
    const base = searxngBase();
    return base ? { engine: "searxng", name: FREE.searxng.name, baseUrl: base } : { engine: null, reason: "SearXNG needs an address. Paste it in Settings > Web search." };
  }
  return { engine: "duckduckgo", name: FREE.duckduckgo.name, baseUrl: FREE.duckduckgo.baseUrl };
}

// Which engine would run right now, and why not when none can.
export function resolveEngine({ provider, model } = {}) {
  const s = searchSettings();
  const keyed = Object.keys(ENGINES).filter(engineKeyed);
  if (s.engine === "model") {
    if (provider && nativeSupported(provider, model)) return { engine: provider, native: true, name: NATIVE[provider].name };
    if (!provider) return { engine: null, native: true, name: "the model's own search", reason: "Perplexity, Grok and Gemini search on their own; other members answer without the web." };
    return { engine: null, reason: `${PROVIDERS[provider]?.name || provider} has no built-in search. Pick DuckDuckGo, or add Brave, Tavily, Exa or Perplexity in Settings > Web search.` };
  }
  if (FREE[s.engine]) return freeChoice(s.engine);
  if (ENGINES[s.engine]) return engineKeyed(s.engine) ? { engine: s.engine, name: ENGINES[s.engine].name } : { engine: null, reason: `${ENGINES[s.engine].name} has no key yet: Settings > Web search.` };
  if (keyed.length) return { engine: keyed[0], name: ENGINES[keyed[0]].name };
  if (provider && nativeSupported(provider, model)) return { engine: provider, native: true, name: NATIVE[provider].name };
  if (demoActive()) return { engine: "demo", name: DEMO_ENGINE.name, demo: true };
  if (searxngBase()) return freeChoice("searxng");
  return freeChoice("duckduckgo");
}

// True when a search engine can feed pages to any model (not only one with built-in search).
export function searchCoversAnyModel() {
  const p = resolveEngine({});
  return !!(p.engine && !p.native);
}

export function previewSearch({ prompt, needWeb = false, provider, model, explicit } = {}) {
  const s = searchSettings();
  const on = explicit === true || (explicit !== false && (!!needWeb || !!s.on.single));
  if (!on) return { willSearch: false, note: "This question can be answered without a live search." };
  const pick = resolveEngine({ provider, model });
  if (!pick.engine) return { willSearch: false, note: pick.reason || "No search provider is ready." };
  const how = pick.native ? `${pick.name} searches inside the answer` : `${pick.name} fetches pages first`;
  return { willSearch: true, engine: pick.engine, name: pick.name, native: !!pick.native, demo: !!pick.demo, note: `The router will search: ${how}, then cite the pages as [1], [2].` };
}

// A search query from a prompt: drop the project-memory block, collapse whitespace, keep it short.
export function queryFor(prompt, engine) {
  let q = String(prompt || "").split(/\n\s*PROJECT MEMORY for /)[0].replace(/\s+/g, " ").trim();
  if (engine === "brave") q = q.split(" ").slice(0, 50).join(" ");
  return q.slice(0, 300);
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const clean = (t, n = 300) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);

// Pure: engine response → [{ title, url, host, snippet }]
export function parseResults(engine, json, max = 5) {
  let rows = [];
  if (engine === "tavily" || engine === "exa" || engine === "pplx" || engine === "duckduckgo" || engine === "searxng") {
    const list = json?.results || json?.organic || [];
    rows = list.map((r) => ({ title: r.title, url: r.url || r.link, snippet: r.snippet || r.content || r.text || (Array.isArray(r.highlights) ? r.highlights.join(" ") : "") }));
    if (!rows.length && engine === "duckduckgo") {
      if (json?.AbstractURL) rows.push({ title: json.Heading || json.AbstractSource, url: json.AbstractURL, snippet: json.AbstractText });
      for (const t of json?.RelatedTopics || []) {
        const item = t.FirstURL ? t : null;
        if (item) rows.push({ title: item.Text, url: item.FirstURL, snippet: item.Text });
        for (const n of t.Topics || []) if (n.FirstURL) rows.push({ title: n.Text, url: n.FirstURL, snippet: n.Text });
      }
    }
  } else if (engine === "brave") rows = (json?.web?.results || json?.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
  else if (engine === "serper") rows = (json?.organic || json?.news || []).map((r) => ({ title: r.title, url: r.link || r.url, snippet: r.snippet }));
  return rows.filter((r) => /^https?:\/\//.test(String(r.url || ""))).slice(0, max).map((r) => ({ title: clean(r.title, 160) || hostOf(r.url), url: r.url, host: hostOf(r.url), snippet: clean(r.snippet) }));
}

export function parseDuckHtml(html, max = 5) {
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < max) {
    let url = m[1].replace(/&amp;/g, "&");
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) { try { url = decodeURIComponent(uddg[1]); } catch {} }
    if (!/^https?:\/\//.test(url)) continue;
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out.push({ title, url, snippet: "" });
  }
  return out.filter((r) => /^https?:\/\//.test(r.url)).slice(0, max).map((r) => ({ title: clean(r.title, 160) || hostOf(r.url), url: r.url, host: hostOf(r.url), snippet: "" }));
}

// Pure: numbered sources → the block appended to a prompt
export function sourcesBlock(sources, engineName) {
  if (!sources?.length) return "";
  const lines = sources.map((s) => `[${s.n}] ${s.title}${s.host ? ` (${s.host})` : ""}\n${s.url}${s.snippet ? `\n${s.snippet}` : ""}`);
  return `WEB SEARCH RESULTS (fetched live just now${engineName ? ` by ${engineName}` : ""}). Use them where they help and cite each fact with its number in square brackets, like [1] or [2], right after the sentence the source supports. Only cite these numbers; never invent a source.\n\n${lines.join("\n\n")}`;
}
export const numbered = (rows, offset = 0) => rows.map((r, i) => ({ n: offset + i + 1, ...r }));

// Sources from a provider's own citations (Perplexity, xAI): URLs, sometimes with titles.
export function sourcesFromCitations(citations, offset = 0) {
  const seen = new Set(); const out = [];
  for (const c of citations || []) {
    const url = typeof c === "string" ? c : c?.url;
    if (!url || !/^https?:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: clean(typeof c === "object" ? c.title : "", 160) || hostOf(url), url, host: hostOf(url), snippet: "" });
  }
  return numbered(out, offset);
}

async function fetchWithTimeout(url, opts, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await localFetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// Last failure per engine (cleared by the next good call). Read by page-reader.js for the warning before a run.
export const engineTrouble = new Map();

export class SearchError extends Error { constructor(engine, status, message, { network = false, rejected = false } = {}) { super(message); this.engine = engine; this.status = status; this.network = network; this.rejected = rejected; } }

// One call to the engine. Throws SearchError; never logs or echoes the key.
async function callEngine(engine, query, max, filter = "web") {
  const e = ENGINES[engine];
  const sec = getSecret(secretId(engine), e.envName);
  if (!sec?.key) throw new SearchError(engine, 401, `${e.name}: no API key saved. Add it in Settings > Web search.`, { rejected: true });
  const f = normalizeFilter(filter);
  let res;
  try {
    if (engine === "tavily") res = await fetchWithTimeout(`${e.baseUrl}/search`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sec.key}` }, body: JSON.stringify({ query, max_results: max, search_depth: "basic", include_answer: false, include_images: false, topic: f === "news" ? "news" : "general", ...(f === "academic" ? { include_domains: ["arxiv.org", "scholar.google.com", "pubmed.ncbi.nlm.nih.gov"] } : {}) }) });
    else if (engine === "brave") res = await fetchWithTimeout(`${e.baseUrl}${f === "news" ? "/res/v1/news/search" : "/res/v1/web/search"}?q=${encodeURIComponent(query)}&count=${max}`, { headers: { accept: "application/json", "x-subscription-token": sec.key } });
    else if (engine === "exa") res = await fetchWithTimeout(`${e.baseUrl}/search`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": sec.key }, body: JSON.stringify({ query, numResults: max, ...(f === "news" ? { category: "news" } : f === "academic" ? { category: "research paper" } : {}) }) });
    else if (engine === "pplx") res = await fetchWithTimeout(`${e.baseUrl}/search`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sec.key}` }, body: JSON.stringify({ query, max_results: max }) });
    else res = await fetchWithTimeout(`${e.baseUrl}${f === "news" ? "/news" : "/search"}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": sec.key }, body: JSON.stringify({ q: query, num: max }) });
  } catch (err) {
    throw new SearchError(engine, 0, `Could not reach ${e.name}: ${networkCause(err)}`, { network: true });
  }
  const txt = await res.text().catch(() => "");
  let json = null; try { json = JSON.parse(txt); } catch {}
  if (!res.ok) {
    const msg = clean(json?.detail?.error || json?.detail || json?.message || json?.error?.message || json?.error || txt, 160);
    if (res.status === 401 || res.status === 403) throw new SearchError(engine, res.status, `Key rejected (${res.status})${msg ? `: ${msg}` : ""}`, { rejected: true });
    if (res.status === 402 || res.status === 429) throw new SearchError(engine, res.status, `${e.name}: ${res.status === 429 ? "rate limited or out of quota" : "payment required"}${msg ? ` (${msg})` : ""}`);
    throw new SearchError(engine, res.status, `${e.name}: HTTP ${res.status}${msg ? ` ${msg}` : ""}`);
  }
  return parseResults(engine, json, max);
}

async function callFree(engine, query, max, filter) {
  const spec = engine === "searxng" ? { ...FREE.searxng, baseUrl: searxngBase() } : FREE.duckduckgo;
  const name = spec.name;
  if (!spec.baseUrl) throw new SearchError(engine, 400, `${name} needs an address in Settings > Web search.`);
  if (!mayCallLive(spec.baseUrl)) throw new SearchError(engine, 0, `Could not reach ${name}: this run is not calling the public web.`, { network: true });
  const f = normalizeFilter(filter);
  let res;
  try {
    if (engine === "duckduckgo" && /html\.duckduckgo\.com/.test(spec.baseUrl)) {
      res = await fetchWithTimeout(`${spec.baseUrl.replace(/\/$/, "")}/html/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" }, body: `q=${encodeURIComponent(query)}` });
      const html = await res.text();
      if (!res.ok) throw new SearchError(engine, res.status, `${name}: HTTP ${res.status}`);
      return parseDuckHtml(html, max);
    }
    const root = spec.baseUrl.replace(/\/$/, "");
    const path = engine === "searxng" ? `/search?q=${encodeURIComponent(query)}&format=json&categories=${f === "news" ? "news" : f === "academic" ? "science" : "general"}` : `/search?q=${encodeURIComponent(query)}&count=${max}`;
    res = await fetchWithTimeout(`${root}${path}`, { headers: { accept: "application/json" } });
  } catch (err) {
    if (err instanceof SearchError) throw err;
    throw new SearchError(engine, 0, `Could not reach ${name}: ${networkCause(err)}`, { network: true });
  }
  const txt = await res.text().catch(() => "");
  let json = null; try { json = JSON.parse(txt); } catch {}
  if (!res.ok) throw new SearchError(engine, res.status, `${name}: HTTP ${res.status}`);
  if (engine === "duckduckgo" && !json) return parseDuckHtml(txt, max);
  return parseResults(engine, json, max);
}

function demoResults(query, max) {
  const slug = (query || "demo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "demo";
  const topics = ["Overview", "Latest figures", "How others do it", "Pitfalls to avoid", "A worked example"];
  return topics.slice(0, Math.max(1, Math.min(max, 5))).map((t, i) => ({ title: `${t}: ${clean(query, 60)} (demo)`, url: `https://example.com/demo/${slug}/${i + 1}`, host: "example.com", snippet: `Pretend search result ${i + 1} made by demo mode. No network call was made and nothing was spent. Real engines return live pages here.` }));
}

// Run one search and log it. Returns { engine, name, demo, sources: [{n,title,url,host,snippet}], ms, cost }.
// `offset` continues the numbering (missions search more than once).
export async function runSearch(query, { engine, missionId = null, taskId = null, role = "search", maxResults, offset = 0, filter } = {}) {
  const s = searchSettings();
  const max = Math.min(10, Math.max(1, maxResults || s.maxResults));
  const useFilter = normalizeFilter(filter || s.filter);
  const q = applyFilter(queryFor(query, engine), useFilter);
  if (!q) throw new SearchError(engine, 400, "Nothing to search for.");
  const t0 = Date.now();
  if (engine !== "demo") {
    const block = freeSearchBlock();
    if (block) throw new SearchError(engine, 402, block);
  }
  if (engine === "demo") {
    const sources = numbered(demoResults(q, max), offset);
    recordSearch({ provider: "demo-search", engine: "demo", results: sources.length, cost: 0, missionId, taskId, ms: Date.now() - t0, role });
    emit("log", { text: `Demo search: ${sources.length} pretend results for "${clean(q, 60)}" (no cost).`, missionId });
    return { engine, name: DEMO_ENGINE.name, demo: true, sources, ms: Date.now() - t0, cost: 0 };
  }
  const e = ENGINES[engine] || (FREE[engine] ? { ...FREE[engine], name: engine === "searxng" ? FREE.searxng.name : FREE.duckduckgo.name } : null);
  if (!e) throw new SearchError(engine, 400, "unknown search engine");
  if (ENGINES[engine] && capStopped(engine)) throw new SearchError(engine, 402, `${e.name} hit its monthly cap. Raise the cap in Settings > Web search or wait for the month to roll over.`);
  let rows;
  try { rows = FREE[engine] ? await callFree(engine, q, max, useFilter) : await callEngine(engine, q, max, useFilter); } catch (err) { engineTrouble.set(engine, { message: err.message, rejected: !!err.rejected, at: Date.now() }); throw err; }
  engineTrouble.delete(engine);
  const sources = numbered(rows, offset);
  const cost = priceOf(engine);
  const ms = Date.now() - t0;
  recordSearch({ provider: secretId(engine), engine, results: sources.length, cost, missionId, taskId, ms, role });
  emit("log", { text: `Web search (${e.name}): ${sources.length} result${sources.length === 1 ? "" : "s"} for "${clean(q, 60)}" in ${(ms / 1000).toFixed(1)}s, $${cost.toFixed(4)}.`, missionId });
  return { engine, name: e.name, demo: false, sources, ms, cost };
}

// Called by chat, council and mission. Decides whether to search (explicit flag from the request,
// else the saved per-mode toggle), picks the engine, runs it and returns what to add to the prompt.
// Returns null when search is off. When the model searches on its own: { native: true, provider }.
// A failed search never fails the run: it is logged and the run goes on without the web.
export async function augment({ prompt, kind, provider, model, missionId, taskId, explicit, offset = 0, role = "search", needWeb = false, filter } = {}) {
  const s = searchSettings();
  const on = explicit === true || (explicit !== false && (!!s.on[kind] || !!needWeb));
  if (!on) return null;
  const useFilter = normalizeFilter(filter || s.filter);
  const pick = resolveEngine({ provider, model });
  if (pick.native) return pick.engine ? { native: true, provider: pick.engine, name: pick.name, sources: [], block: "", prompt, filter: useFilter } : null;
  if (!pick.engine) { emit("log", { text: `Search the web is on, but ${pick.reason}`, level: "error", missionId }); return { skipped: true, reason: pick.reason, sources: [], block: "", prompt }; }
  try {
    const r = await runSearch(prompt, { engine: pick.engine, missionId, taskId, offset, role, filter: useFilter });
    const block = sourcesBlock(r.sources, r.name);
    return { engine: r.engine, name: r.name, demo: r.demo, sources: r.sources, block, prompt: block ? `${prompt}\n\n${block}` : prompt, cost: r.cost };
  } catch (err) {
    emit("log", { text: `Web search skipped: ${err.message}`, level: "error", missionId });
    return { skipped: true, reason: err.message, sources: [], block: "", prompt };
  }
}

// Log what a provider's own search cost (citations came back with the answer).
export function recordNative(provider, citations, { missionId = null, taskId = null, role = "search" } = {}) {
  const n = NATIVE[provider]; if (!n) return 0;
  const count = sourcesFromCitations(citations).length; // distinct pages only
  const cost = n.unit === "source" ? priceOf(provider) * count : priceOf(provider);
  recordSearch({ provider, engine: provider, results: count, cost, missionId, taskId, ms: null, role, native: true });
  return cost;
}
