// Open the pages behind search results (0.4.21, audit rows 39 and 40, dogfood D06).
// A search title or snippet is not a page. This module fetches each source URL (the fetcher is injectable so tests
// never touch the network), says plainly when a page could not be opened, pulls the details the question asked for
// out of the page text, and only lets a source count as "opened" when real page text came back.
import { localFetch } from "./loopback-fetch.js";
import { htmlToText } from "./receipts.js";
import { engineTrouble, mayCallLive, resolveEngine, engineKeyed, ENGINES, searchSettings, searxngBase } from "./search.js";
import { demoActive } from "./mock.js";
import { isPublicHttpUrl } from "./safe-url.js";

export const PAGE_CHARS = 6000;
const MIN_TEXT = 25; // less than this is a blank or script-only page, not a read

export const searchTrouble = (engine) => engineTrouble.get(engine) || null;
export const resetSearchTrouble = () => engineTrouble.clear();

/** Before any search is spent: can a search run, and if not, which single step fixes it. */
export function searchPreflight({ provider, model } = {}) {
  const s = searchSettings();
  const keyed = Object.keys(ENGINES).filter(engineKeyed);
  const bad = keyed.filter((e) => engineTrouble.get(e)?.rejected);
  const pick = resolveEngine({ provider, model });
  if (demoActive() && !keyed.length) return { ok: true, level: "info", engine: "demo", message: "Demo mode: search results are pretend and no real page is opened." };
  if (pick.native) return { ok: true, level: "ok", engine: pick.engine, native: true, message: `${pick.name} will search inside the answer. Meldmind cannot open those pages itself, so they are not marked as opened.` };
  if (!pick.engine) return { ok: false, level: "blocked", engine: null, message: `Web search cannot run. ${pick.reason || "Add a search key in Settings > Web search (Tavily, Brave, Serper, Exa or Perplexity)."}` };
  const engineBad = engineTrouble.get(pick.engine);
  if (engineBad?.rejected) {
    const others = keyed.filter((e) => e !== pick.engine && !engineTrouble.get(e)?.rejected).map((e) => ENGINES[e].name);
    return { ok: false, level: "blocked", engine: pick.engine, message: `Your ${pick.name} key was refused. ${others.length ? `Meldmind will use ${others[0]} instead.` : "Fix it in Settings > Web search, or pick DuckDuckGo there (no key)."}`, switchTo: others[0] || null };
  }
  if (!keyed.length && !s.searxngUrl && !searxngBase()) {
    return { ok: true, level: "warn", engine: pick.engine, message: `No search key is added, so Meldmind uses ${pick.name} (free, no key). It is often blocked and may return nothing. For steady results add a key in Settings > Web search (Tavily, Brave or Serper).`, free: true };
  }
  if (bad.length && keyed.length > bad.length) return { ok: true, level: "warn", engine: pick.engine, message: `${bad.map((e) => ENGINES[e].name).join(" and ")} key was refused earlier. ${pick.name} will be used.` };
  return { ok: true, level: "ok", engine: pick.engine, message: `${pick.name} will search, then Meldmind opens the pages.` };
}

export const MAX_REDIRECTS = 5;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

// Read at most `cap` bytes of a reply body, then stop (0.4.23, audit X4: no size cap before).
async function readCapped(res, cap = MAX_PAGE_BYTES) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text().catch(() => "")).slice(0, cap);
  const chunks = []; let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = cap - n;
      if (value.length >= room) { chunks.push(value.subarray(0, room)); n = cap; break; }
      chunks.push(value); n += value.length;
    }
  } finally { try { await reader.cancel(); } catch {} }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** Default fetcher: real network through localFetch, with a timeout. Returns { status, ok, contentType, body }.
 *  0.4.23 (audit X4): redirects are followed by hand, at most MAX_REDIRECTS hops, and EVERY hop's address is
 *  checked again with isPublicHttpUrl, so a public page cannot bounce the reader to 169.254.169.254 or a
 *  private address. The body is capped at MAX_PAGE_BYTES. `fetchImpl` is for tests only. */
export async function defaultFetcher(url, { signal, timeoutMs = 9000, fetchImpl = localFetch } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  const done = () => { clearTimeout(t); signal?.removeEventListener("abort", onAbort); };
  // 0.4.22 (Aikido SSRF review): a source address is opened only when it is a public web address.
  if (!isPublicHttpUrl(url)) { done(); return { status: 403, ok: false, contentType: "", body: "" }; }
  try {
    let at = String(url);
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(at, { headers: { accept: "text/html, text/plain;q=0.9", "user-agent": "Mozilla/5.0 (compatible; Meldmind)" }, signal: ctl.signal, redirect: "manual" });
      const loc = res.status >= 300 && res.status < 400 ? res.headers?.get?.("location") : null;
      if (!loc) {
        const body = await readCapped(res);
        return { status: res.status, ok: res.ok, contentType: res.headers?.get?.("content-type") || "", body, url: at };
      }
      try { await res.body?.cancel?.(); } catch {}
      if (hop >= MAX_REDIRECTS) return { status: 508, ok: false, contentType: "", body: "", reason: "too many redirects" };
      let next;
      try { next = new URL(loc, at).href; } catch { return { status: 502, ok: false, contentType: "", body: "" }; }
      if (!isPublicHttpUrl(next)) return { status: 403, ok: false, contentType: "", body: "", blockedRedirect: true };
      at = next;
    }
  } finally {
    done();
  }
}

const PAYWALL = /\b(subscribe to (continue|read)|enable javascript|are you a robot|verify you are (a )?human|access denied|captcha|just a moment|attention required)\b/i;

function whyFailed(status) {
  if (status === 401 || status === 403) return "the site blocked it";
  if (status === 404 || status === 410) return "the page is gone";
  if (status === 429) return "the site asked us to slow down";
  if (status >= 500) return "the site had an error";
  return `the site answered ${status}`;
}

/** Open one page. Never throws except to pass a stop signal on. Result always has ok and a plain reason when not ok. */
export async function openPage(url, { fetcher = defaultFetcher, signal, maxChars = PAGE_CHARS } = {}) {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) return { ok: false, url: u, reason: "not a web address" };
  if (!mayCallLive(u)) return { ok: false, url: u, reason: "this run is not calling the public web" };
  let r;
  try {
    r = await fetcher(u, { signal });
  } catch (err) {
    if (signal?.aborted || err?.code === "aborted" || err?.name === "ResearchStopped") throw err;
    const msg = err?.name === "AbortError" ? "it took too long" : String(err?.cause?.code || err?.code || err?.message || "no answer");
    return { ok: false, url: u, reason: `could not connect (${msg})` };
  }
  if (!r || (r.ok === false) || (r.status && r.status >= 400)) return { ok: false, url: u, status: r?.status, reason: whyFailed(r?.status || 0) };
  const raw = String(r.body ?? "");
  const type = String(r.contentType || "");
  const isHtml = /html|xml/i.test(type) || /^\s*<(!doctype|html|head|body)/i.test(raw);
  const text = (isHtml ? htmlToText(raw) : raw).replace(/\s+/g, " ").trim();
  if (text.length < MIN_TEXT) return { ok: false, url: u, status: r.status, reason: "the page had no readable text" };
  if (text.length < 1500 && PAYWALL.test(text)) return { ok: false, url: u, status: r.status, reason: "the site asked for a check or a login" };
  const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  return { ok: true, url: u, status: r.status || 200, title, text: text.slice(0, maxChars), chars: text.length };
}

// What the question asks for. Each ask has a finder that returns short matched snippets from page text.
const ASKS = [
  { key: "price", re: /\b(price|prices|pricing|cost|costs|fee|fees|how much|rate|rates)\b/i, find: /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:per|\/)\s?\w+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|dollars|euros)\b)/g },
  { key: "date", re: /\b(date|dates|when|deadline|launch(?:ed)?|released?|founded|year)\b/i, find: /\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}|\d{4}-\d{2}-\d{2}|(?:19|20)\d{2})\b/g },
  { key: "percent", re: /\b(percent|percentage|share|growth|rate|frequency|how often|how many)\b/i, find: /\b\d+(?:\.\d+)?\s?(?:%|percent|times a (?:day|week|month|year)|per (?:day|week|month|year))/gi },
  { key: "email", re: /\b(email|e-mail|contact)\b/i, find: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  { key: "phone", re: /\b(phone|call|telephone|contact)\b/i, find: /(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g },
  { key: "number", re: /\b(number|count|total|size|how many|statistics?|stats?|figure|figures|population|users)\b/i, find: /\b\d[\d,]*(?:\.\d+)?\s?(?:million|billion|thousand|k|m|bn)?\b(?=\s+[a-z])/gi },
];

export function askedDetails(question) {
  const q = String(question || "");
  return ASKS.filter((a) => a.re.test(q)).map((a) => a.key);
}

const sentenceAround = (text, idx, len) => {
  let s = text.lastIndexOf(". ", idx); s = s < 0 ? Math.max(0, idx - 120) : s + 2;
  let e = text.indexOf(". ", idx + len); e = e < 0 ? Math.min(text.length, idx + len + 120) : e + 1;
  return text.slice(s, Math.min(e, s + 260)).trim();
};

/** From one opened page, the lines that hold the details asked for. Returns [{ kind, value, line }] (at most 2 per kind). */
export function pullDetails(text, question, { keywords } = {}) {
  const t = String(text || "");
  const out = [];
  const words = (keywords || (String(question || "").toLowerCase().match(/[a-z]{5,}/g) || [])).slice(0, 12);
  for (const key of askedDetails(question)) {
    const ask = ASKS.find((a) => a.key === key);
    const found = [];
    for (const m of t.matchAll(new RegExp(ask.find.source, ask.find.flags.includes("g") ? ask.find.flags : ask.find.flags + "g"))) {
      const line = sentenceAround(t, m.index, m[0].length);
      const score = words.reduce((n, w) => n + (line.toLowerCase().includes(w) ? 1 : 0), 0);
      found.push({ kind: key, value: m[0].trim(), line, score, at: m.index });
      if (found.length > 40) break;
    }
    const seen = new Set();
    found.sort((a, b) => b.score - a.score || a.at - b.at);
    for (const f of found) {
      if (seen.has(f.line)) continue;
      seen.add(f.line);
      if (f.score === 0 && key === "number") continue; // a bare number with no link to the question is noise
      out.push({ kind: f.kind, value: f.value, line: f.line });
      if (seen.size >= 2) break;
    }
  }
  return out;
}

/** Open the first `limit` sources. Sources must be [{ n, url, title }]. Never marks a page opened from the listing alone. */
export async function openSources(sources, { question = "", limit = 4, fetcher, signal, concurrency = 3 } = {}) {
  const list = (sources || []).slice(0, limit);
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const s = list[i];
      const page = await openPage(s.url, { fetcher, signal });
      results[i] = page.ok
        ? { n: s.n, url: s.url, title: s.title || page.title, host: s.host, opened: true, chars: page.chars, excerpt: page.text.slice(0, 500), text: page.text, details: pullDetails(page.text, question) }
        : { n: s.n, url: s.url, title: s.title, host: s.host, opened: false, reason: page.reason, status: page.status };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  const rest = (sources || []).slice(limit).map((s) => ({ n: s.n, url: s.url, title: s.title, host: s.host, opened: false, reason: "not opened (limit reached)", skipped: true }));
  return [...results, ...rest];
}

/** Plain summary line for a report or chat answer. */
export function coverageLine(reads) {
  const list = reads || [];
  if (!list.length) return "No pages were found to open.";
  const tried = list.filter((r) => !r.skipped);
  const ok = tried.filter((r) => r.opened);
  const failed = tried.filter((r) => !r.opened);
  let line = `Opened ${ok.length} of ${tried.length} page${tried.length === 1 ? "" : "s"}.`;
  if (failed.length) line += ` Could not open: ${failed.map((r) => `${r.host || r.url} (${r.reason})`).join("; ")}.`;
  if (!ok.length) line += " Nothing below was checked against a page. It comes from search listings only.";
  return line;
}

/** The text block the writer AI reads: opened pages with extracted details, and a clear list of pages it must not claim to have read. */
export function pagesBlock(reads) {
  const list = reads || [];
  const ok = list.filter((r) => r.opened);
  const bad = list.filter((r) => !r.opened && !r.skipped);
  const parts = [];
  for (const r of ok) {
    const det = (r.details || []).map((d) => `  - ${d.kind}: ${d.value} (${d.line})`).join("\n");
    parts.push(`[${r.n}] ${r.title || r.host || r.url}\n${r.url}\nPAGE OPENED. ${det ? `Details found:\n${det}\n` : ""}Text:\n${r.text}`);
  }
  if (bad.length) parts.push(`PAGES THAT COULD NOT BE OPENED (do not say you read them; their search listing is not proof):\n${bad.map((r) => `[${r.n}] ${r.url} - ${r.reason}`).join("\n")}`);
  return parts.join("\n\n");
}

/** Per source: opened pages are "Opened"; everything else says it was only a search listing. Never "verified" from a title. */
export function sourceStatus(source, reads) {
  const r = (reads || []).find((x) => x.url === source.url || (x.n && x.n === source.n));
  if (r?.opened) return { status: "opened", label: "Opened the page" };
  if (r && !r.skipped) return { status: "could-not-open", label: `Could not open (${r.reason})` };
  return { status: "listing-only", label: "Search listing only, not opened" };
}
