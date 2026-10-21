// Phase 15: live web search with cited sources. Pure checks on parsing, numbering and the prompt
// block, then the running server against local mock engines (Tavily, Brave, Serper), a mock
// OpenAI-compatible model (so the injected prompt can be read back) and a mock xAI with its own
// citations. No real search API or model is ever called; keys never appear in a response or the log.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, tmpDir, chatRunId, newKindPred, runSettled } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-search-");
const { ENGINES, NATIVE, DEFAULTS, parseResults, sourcesBlock, numbered, queryFor, sourcesFromCitations } = await import("../server/search.js");

test("engines: https key pages, a key shape, a list price and a note; defaults are off", () => {
  for (const e of Object.values(ENGINES)) {
    assert.match(e.keysUrl, /^https:\/\//); assert.match(e.baseUrl, /^https?:\/\//);
    assert.ok(e.looks && e.note && e.perSearch > 0, `${e.id} has looks, note and a price`);
    for (const s of [e.name, e.looks, e.note]) assert.doesNotMatch(s, /—/, "no em-dashes");
  }
  assert.ok(NATIVE.perplexity && NATIVE.xai);
  assert.deepEqual(DEFAULTS.on, { single: false, council: false, mission: false });
  assert.equal(DEFAULTS.engine, "auto");
});

test("parseResults: each engine's shape, bad urls dropped, snippets trimmed; numbering and block", () => {
  const t = parseResults("tavily", { results: [{ title: "A", url: "https://a.example/x", content: "  one   two " }, { title: "", url: "ftp://nope", content: "" }] });
  assert.deepEqual(t, [{ title: "A", url: "https://a.example/x", host: "a.example", snippet: "one two" }]);
  const b = parseResults("brave", { web: { results: [{ title: "B", url: "https://www.b.example/y", description: "d" }] } });
  assert.equal(b[0].host, "b.example");
  const s = parseResults("serper", { organic: [{ title: "C", link: "https://c.example/z", snippet: "s" }, { title: "D", link: "https://d.example", snippet: "s" }] }, 1);
  assert.equal(s.length, 1, "max respected");
  const long = parseResults("tavily", { results: [{ title: "", url: "https://e.example/p", content: "x".repeat(900) }] });
  assert.equal(long[0].title, "e.example", "host stands in for a missing title"); assert.equal(long[0].snippet.length, 300);
  const n = numbered([...t, ...b], 2);
  assert.deepEqual(n.map((x) => x.n), [3, 4]);
  const block = sourcesBlock(n, "Tavily");
  assert.match(block, /^WEB SEARCH RESULTS \(fetched live just now by Tavily\)/);
  assert.match(block, /\[3\] A \(a\.example\)\nhttps:\/\/a\.example\/x\none two/);
  assert.match(block, /\[4\] B \(b\.example\)/);
  assert.equal(sourcesBlock([], "x"), "");
});

test("queryFor: project memory stripped, whitespace collapsed, Brave limited to 50 words, 300 chars max", () => {
  assert.equal(queryFor("What   is new\nin  solar?\n\nPROJECT MEMORY for Acme (follow this):\nBRAND VOICE:\nshort"), "What is new in solar?");
  assert.equal(queryFor("w ".repeat(80), "brave").split(" ").length, 50);
  assert.equal(queryFor("a".repeat(500)).length, 300);
});

test("sourcesFromCitations: urls or {url,title}, dedupe, offset", () => {
  const s = sourcesFromCitations(["https://x.example/a", { url: "https://x.example/a", title: "dup" }, { url: "https://y.example/b", title: "Y" }, "notaurl"], 1);
  assert.deepEqual(s.map((x) => [x.n, x.title, x.host]), [[2, "x.example", "x.example"], [3, "Y", "y.example"]]);
});

// ---------- the running server against local mocks ----------
const KEYS = { tavily: "tvly-goodgoodgoodgoodgood", brave: "BSAgoodgoodgoodgoodgood", serper: "0123456789abcdef0123456789abcdef01234567", bad: "tvly-badbadbadbadbadbad", groq: "gsk_fakefakefakefakefake", xai: "xai-fakefakefakefakefake" };
const PAGES = (n, tag) => Array.from({ length: n }, (_, i) => ({ title: `${tag} page ${i + 1}`, url: `https://${tag}.example/p${i + 1}`, text: `Snippet ${i + 1} from ${tag}.` }));
function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n"); res.end();
}
async function mocks() {
  const seen = { tavily: [], brave: [], serper: [], llm: [], xai: [] };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/tavily/search") {
      const j = JSON.parse(body); seen.tavily.push({ auth: req.headers.authorization, body: j });
      if (req.headers.authorization !== `Bearer ${KEYS.tavily}`) return send(401, { detail: { error: "Unauthorized: missing or invalid API key." } });
      return send(200, { results: PAGES(j.max_results, "tavily").map((p) => ({ title: p.title, url: p.url, content: p.text, score: 0.9 })) });
    }
    if (url.pathname === "/brave/res/v1/web/search") {
      seen.brave.push({ token: req.headers["x-subscription-token"], q: url.searchParams.get("q"), count: url.searchParams.get("count") });
      if (req.headers["x-subscription-token"] !== KEYS.brave) return send(401, { message: "invalid token" });
      return send(200, { web: { results: PAGES(Number(url.searchParams.get("count")), "brave").map((p) => ({ title: p.title, url: p.url, description: p.text })) } });
    }
    if (url.pathname === "/serper/search") {
      const j = JSON.parse(body); seen.serper.push({ key: req.headers["x-api-key"], body: j });
      if (req.headers["x-api-key"] !== KEYS.serper) return send(403, { message: "Unauthorized." });
      return send(200, { organic: PAGES(j.num, "serper").map((p) => ({ title: p.title, link: p.url, snippet: p.text })) });
    }
    // OpenAI-compatible mock model (Groq) and a mock xAI that returns citations of its own
    if (url.pathname.endsWith("/v1/models")) return send(200, { data: [{ id: "openai/gpt-oss-120b" }, { id: "grok-4.3" }] });
    if (url.pathname === "/llm/v1/chat/completions") {
      const j = JSON.parse(body); seen.llm.push(j);
      const wantsJson = /JSON only/i.test(j.messages[0]?.content || "");
      const text = wantsJson ? `{"capability":"research","difficulty":1,"needWeb":true,"summary":"mock"}` : "Solar grew fast last year [1] and prices fell [2]. Nothing to cite here [9].";
      return sse(res, [{ model: j.model, choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 12 } }]);
    }
    if (url.pathname === "/xai/v1/chat/completions") {
      const j = JSON.parse(body); seen.xai.push(j);
      return sse(res, [{ model: j.model, choices: [{ delta: { content: "Grok says [1] and [2]." } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 6 }, citations: ["https://grok.example/one", "https://grok.example/two", "https://grok.example/one"] }]);
    }
    send(404, { error: "mock: no route " + url.pathname });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, seen, close: () => new Promise((r) => srv.close(r)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitRun(s, pred, label, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const st = (await s.api("/state")).json; const hit = pred(st); if (hit) return hit; await sleep(400); }
  throw new Error(`timed out waiting for ${label}`);
}

test("server: engines, keys (refused never kept), toggles, injected prompt with [n] sources, ledger lines, caps, built-in search, council, mission, demo engine", async () => {
  const m = await mocks();
  const s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
    CC_SEARCH_URL_TAVILY: `${m.base}/tavily`, CC_SEARCH_URL_BRAVE: `${m.base}/brave`, CC_SEARCH_URL_SERPER: `${m.base}/serper`,
    CC_BASE_URL_GROQ: `${m.base}/llm/v1`, CC_BASE_URL_XAI: `${m.base}/xai/v1`,
    TAVILY_API_KEY: "", BRAVE_SEARCH_API_KEY: "", SERPER_API_KEY: "", GROQ_API_KEY: "", XAI_API_KEY: "",
  } });
  try {
    assert.equal((await s.api("/search", { noToken: true })).status, 401, "session token required");
    let v = (await s.api("/search")).json;
    assert.equal(v.engine, "auto"); assert.deepEqual(v.on, { single: false, council: false, mission: false }); assert.equal(v.maxResults, 5);
    assert.deepEqual(v.engines.map((e) => e.id), ["tavily", "brave", "serper"]); assert.ok(v.engines.every((e) => !e.keyed && e.masked === null));
    assert.equal(v.active.engine, null); assert.match(v.active.reason, /No search provider is set up/);
    assert.ok((await s.api("/state")).json.plugins.includes("search"));

    // demo mode: a pretend engine, no network, no cost
    await s.api("/demo", { method: "POST", body: { on: true } });
    v = (await s.api("/search")).json;
    assert.equal(v.active.engine, "demo"); assert.equal(v.demo, true);
    let r = await s.api("/search/test", { method: "POST", body: { q: "solar panel prices" } });
    assert.equal(r.status, 200); assert.equal(r.json.demo, true); assert.equal(r.json.cost, 0); assert.equal(r.json.sources.length, 5);
    assert.deepEqual(r.json.sources.map((x) => x.n), [1, 2, 3, 4, 5]); assert.match(r.json.sources[0].url, /^https:\/\/example\.com\/demo\//);
    assert.equal(m.seen.tavily.length + m.seen.brave.length + m.seen.serper.length, 0, "demo never calls an engine");

    // a refused key is never kept
    r = await s.api("/search/key", { method: "POST", body: { engine: "tavily", key: KEYS.bad } });
    assert.equal(r.status, 200); assert.equal(r.json.ok, false); assert.equal(r.json.kept, false); assert.equal(r.json.label, "Key rejected"); assert.match(r.json.detail, /^Key rejected \(401\)/);
    assert.equal(r.json.masked, null); assert.equal((await s.api("/search")).json.engines[0].keyed, false);
    assert.equal((await s.api("/search/key", { method: "POST", body: { engine: "nope", key: "x" } })).status, 400);
    assert.equal((await s.api("/search/key", { method: "POST", body: { engine: "tavily", key: "has space" } })).status, 400);
    // a working key: one test search, then the vault
    r = await s.api("/search/key", { method: "POST", body: { engine: "tavily", key: KEYS.tavily } });
    assert.equal(r.json.ok, true); assert.equal(r.json.kept, true); assert.equal(r.json.tone, "green"); assert.equal(r.json.masked, `${KEYS.tavily.slice(0, 4)}…${KEYS.tavily.slice(-4)}`);
    assert.equal(r.json.cost, ENGINES.tavily.perSearch);
    assert.equal(m.seen.tavily.at(-1).body.max_results, 1, "the key check asks for one result");
    v = (await s.api("/search")).json;
    assert.equal(v.engines[0].keyed, true); assert.equal(v.active.engine, "tavily", "auto picks the keyed engine over demo");
    // a refused replacement puts the old key back
    r = await s.api("/search/key", { method: "POST", body: { engine: "tavily", key: KEYS.bad } });
    assert.equal(r.json.kept, false); assert.equal(r.json.masked, `${KEYS.tavily.slice(0, 4)}…${KEYS.tavily.slice(-4)}`, "old key restored");

    // the mock model so the injected prompt can be read back
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "groq", key: KEYS.groq } })).json.status.status, "green");
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEYS.xai } })).json.status.status, "green");

    // single chat with the saved toggle on: numbered results in the prompt, sources on the run, a ledger line
    r = await s.api("/search/toggle", { method: "POST", body: { mode: "single", on: true } });
    assert.deepEqual(r.json.on, { single: true, council: false, mission: false });
    assert.equal((await s.api("/search/toggle", { method: "POST", body: { mode: "weird", on: true } })).status, 400);
    const llmBefore = m.seen.llm.length;
    let run = await waitRun(s, runSettled(await chatRunId(s.api, { prompt: "What is new in solar?", provider: "groq", model: "openai/gpt-oss-120b" })), "single");
    let full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done"); assert.equal(full.sources.length, 5); assert.equal(full.searchEngine, "Tavily");
    assert.deepEqual(full.sources.map((x) => x.n), [1, 2, 3, 4, 5]); assert.equal(full.sources[2].url, "https://tavily.example/p3");
    assert.match(full.deliverable, /\[1\]/);
    const ask = m.seen.llm.slice(llmBefore).find((j) => /WEB SEARCH RESULTS/.test(j.messages.at(-1).content));
    assert.ok(ask, "the model got the search block");
    const content = ask.messages.at(-1).content;
    assert.ok(content.startsWith("What is new in solar?\n\nWEB SEARCH RESULTS"), "block follows the prompt");
    assert.match(content, /\[1\] tavily page 1 \(tavily\.example\)\nhttps:\/\/tavily\.example\/p1\nSnippet 1 from tavily\./); assert.match(content, /\[5\] tavily page 5/);
    assert.equal(ask.search_parameters, undefined, "no native search asked of a model without one");
    let led = (await s.api("/state")).json.ledger;
    const searchLines = led.recent.filter((e) => e.kind === "search" && e.missionId === run.id);
    assert.equal(searchLines.length, 1); assert.equal(searchLines[0].provider, "search-tavily"); assert.equal(searchLines[0].cost, ENGINES.tavily.perSearch); assert.equal(searchLines[0].results, 5);
    assert.ok(!("query" in searchLines[0]), "no query text in the ledger");
    assert.ok(led.byProvider["search-tavily"].month >= 2 * ENGINES.tavily.perSearch - 1e-9);
    assert.equal(run.cost, full.cost); assert.ok(full.cost >= ENGINES.tavily.perSearch, "the search is part of the run's cost");

    // off by request, even with the toggle on; and the toggle off
    run = await waitRun(s, runSettled(await chatRunId(s.api, { prompt: "No web please", provider: "groq", model: "openai/gpt-oss-120b", search: false })), "single without search");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.sources.length, 0); assert.ok(!m.seen.llm.some((j) => /No web please\n\nWEB SEARCH/.test(j.messages.at(-1).content)));
    await s.api("/search/toggle", { method: "POST", body: { mode: "single", on: false } });

    // Brave and Serper: their own headers and shapes; a chosen engine wins over auto
    r = await s.api("/search/key", { method: "POST", body: { engine: "brave", key: KEYS.brave } }); assert.equal(r.json.kept, true);
    r = await s.api("/search/key", { method: "POST", body: { engine: "serper", key: "wrong" } }); assert.equal(r.json.kept, false); assert.equal(r.json.label, "Key rejected");
    r = await s.api("/search/key", { method: "POST", body: { engine: "serper", key: KEYS.serper } }); assert.equal(r.json.kept, true);
    await s.api("/search/settings", { method: "POST", body: { engine: "brave", maxResults: 3 } });
    r = await s.api("/search/test", { method: "POST", body: { q: "a b c" } });
    assert.equal(r.json.engine, "brave"); assert.equal(r.json.sources.length, 3); assert.equal(m.seen.brave.at(-1).token, KEYS.brave); assert.equal(m.seen.brave.at(-1).count, "3");
    await s.api("/search/settings", { method: "POST", body: { engine: "serper" } });
    r = await s.api("/search/test", { method: "POST", body: { q: "a b c" } });
    assert.equal(r.json.engine, "serper"); assert.equal(r.json.sources[0].host, "serper.example"); assert.equal(m.seen.serper.at(-1).key, KEYS.serper); assert.equal(m.seen.serper.at(-1).body.num, 3);
    assert.equal((await s.api("/search/settings", { method: "POST", body: { engine: "bing" } })).status, 400);
    v = (await s.api("/search/settings", { method: "POST", body: { engine: "tavily", maxResults: 5, prices: { tavily: 0.01 } } })).json;
    assert.equal(v.engines[0].perSearch, 0.01, "price per search is editable"); assert.equal(v.engines[0].listPrice, ENGINES.tavily.perSearch);
    await s.api("/search/settings", { method: "POST", body: { prices: { tavily: null } } });

    // the model's own search (xAI): search_parameters sent, its citations become the sources, cost per source in the ledger
    await s.api("/search/settings", { method: "POST", body: { engine: "model" } });
    v = (await s.api("/search")).json; assert.equal(v.active.engine, null, "no provider picked yet means no single engine");
    const tavBefore = m.seen.tavily.length;
    run = await waitRun(s, runSettled(await chatRunId(s.api, { prompt: "Grok, what changed?", provider: "xai", model: "grok-4.3", search: true })), "xai single");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.deepEqual(m.seen.xai.at(-1).search_parameters, { mode: "on", return_citations: true, max_search_results: 5 });
    assert.equal(m.seen.xai.at(-1).messages.at(-1).content, "Grok, what changed?", "nothing injected when the model searches itself");
    assert.equal(full.sources.length, 2, "citations deduped"); assert.equal(full.sources[1].url, "https://grok.example/two"); assert.equal(full.searchEngine, "xAI Live Search");
    assert.equal(m.seen.tavily.length, tavBefore, "no engine call");
    led = (await s.api("/state")).json.ledger;
    const nat = led.recent.find((e) => e.kind === "search" && e.missionId === run.id);
    assert.equal(nat.provider, "xai"); assert.equal(nat.native, true); assert.equal(nat.results, 2); assert.equal(nat.cost, +(2 * NATIVE.xai.perSearch).toFixed(6));
    // a model without its own search gets no block and the run still completes
    run = await waitRun(s, runSettled(await chatRunId(s.api, { prompt: "Groq cannot search", provider: "groq", model: "openai/gpt-oss-120b", search: true })), "groq single under model engine");
    assert.equal((await s.api(`/missions/${run.id}`)).json.sources.length, 0);
    await s.api("/search/settings", { method: "POST", body: { engine: "tavily" } });

    // council: one search shared by every member and the chair
    const llm2 = m.seen.llm.length;
    run = await waitRun(s, await newKindPred(s.api, "/council", { prompt: "Council: solar outlook?", members: [{ provider: "groq", model: "openai/gpt-oss-120b" }], qa: false, search: true }, "council"), "council");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done"); assert.equal(full.sources.length, 5); assert.equal(full.searchEngine, "Tavily");
    const councilAsks = m.seen.llm.slice(llm2).filter((j) => /WEB SEARCH RESULTS/.test(j.messages.at(-1).content));
    assert.ok(councilAsks.length >= 2, "the answer and the verdict both saw the sources");
    assert.ok(councilAsks.some((j) => /Keep the \[n\] citations/.test(j.messages.at(-1).content)), "the chair keeps the numbering");
    assert.equal((await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "search" && e.missionId === run.id).length, 1, "one search for the whole council");

    // mission: the goal is searched once and the sources ride along as context; tasks that need the web search again
    run = await waitRun(s, await newKindPred(s.api, "/mission", { goal: "Brief me on the latest solar news this week.", mode: "economy", qa: false, budgetUsd: 1, search: true }, "mission"), "mission", 180000);
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.ok(["done", "done-with-errors"].includes(full.status), `mission ${full.status}: ${full.error || ""}`);
    assert.ok(full.sources.length >= 5, `mission sources (${full.sources.length})`);
    assert.deepEqual(full.sources.map((x) => x.n), full.sources.map((_, i) => i + 1), "numbering continues across searches");
    const missionSearches = (await s.api("/state")).json.ledger.recent.filter((e) => e.kind === "search" && e.missionId === run.id);
    assert.ok(missionSearches.length >= 1 && missionSearches.every((e) => e.provider === "search-tavily"));
    assert.ok(full.cost >= missionSearches.reduce((a, e) => a + e.cost, 0) - 1e-9, "search spend is in the mission cost");

    // monthly cap: amber at 80%, stopped at 100%, searches refused, runs go on without the web
    v = (await s.api("/search/settings", { method: "POST", body: { caps: { tavily: 0.02 } } })).json;
    assert.equal(v.caps.tavily, 0.02);
    const al = (await s.api("/alerts/state")).json;
    assert.equal(al.perProvider["search-tavily"].level, "stop"); assert.ok(al.stop.includes("search-tavily"));
    assert.equal((await s.api("/search")).json.engines[0].capStopped, true);
    r = await s.api("/search/test", { method: "POST", body: { q: "over the cap" } });
    assert.equal(r.status, 402); assert.match(r.json.error, /monthly cap/);
    const tav2 = m.seen.tavily.length;
    run = await waitRun(s, runSettled(await chatRunId(s.api, { prompt: "Capped chat", provider: "groq", model: "openai/gpt-oss-120b", search: true })), "capped single");
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done"); assert.equal(full.sources.length, 0); assert.equal(m.seen.tavily.length, tav2, "no engine call past the cap");
    assert.ok((await s.api("/state")).json.recent.some((e) => e.type === "log" && /Web search skipped: Tavily hit its monthly cap/.test(e.text)));
    v = (await s.api("/search/settings", { method: "POST", body: { caps: {} } })).json;
    assert.deepEqual(v.caps, {});
    assert.equal((await s.api("/search/test", { method: "POST", body: { q: "cap lifted" } })).status, 200);

    // remove a key
    v = (await s.api("/search/key/brave", { method: "DELETE" })).json;
    assert.equal(v.engines.find((e) => e.id === "brave").keyed, false);
    assert.equal((await s.api("/search/key/nope", { method: "DELETE" })).status, 400);
    assert.equal((await s.api("/search/nothing", { method: "POST" })).status, 404);

    // keys never leave the server except to the engine
    const everything = JSON.stringify(await s.api("/search")) + JSON.stringify(await s.api("/state")) + s.log;
    for (const k of [KEYS.tavily, KEYS.brave, KEYS.serper, KEYS.bad]) assert.ok(!everything.includes(k), "key never in a response or the log");
    assert.ok(!everything.includes("goodgoodgood") && !everything.includes("badbadbad"), "not even a fragment");
  } finally { await s.stop(); await m.close(); }
});
