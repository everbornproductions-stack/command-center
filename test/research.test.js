// Research on top of Phase 15: DuckDuckGo, Pro search, deep research, filters, citations.
// Every provider is a local mock. No real key, no public URL. Waits are real timers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { pdfText, docxText } from "../server/library-extract.js";

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("research plans: free daily, pro monthly, extreme unlimited, no em dashes", async () => {
  const prev = {
    tier: process.env.CC_RESEARCH_TIER,
    daily: process.env.CC_RESEARCH_FREE_DAILY,
    deep: process.env.CC_RESEARCH_DEEP_MONTHLY,
    pack: process.env.CC_PACKAGED,
  };
  process.env.CC_PACKAGED = "";
  delete process.env.CC_RESEARCH_FREE_DAILY;
  delete process.env.CC_RESEARCH_DEEP_MONTHLY;
  const { researchPlan, requireResearch, FREE_DAILY_SEARCHES, PRO_DEEP_PER_MONTH } = await import("../server/feature-gate.js");
  const { parseResults, parseDuckHtml, applyFilter, FILTERS } = await import("../server/search.js");
  const { followQueries } = await import("../server/research.js");
  const { reportPdf, reportDocx } = await import("../server/research-export.js");
  try {
    process.env.CC_RESEARCH_TIER = "free";
    const free = researchPlan();
    assert.equal(free.webSearch, true);
    assert.equal(free.proSearch, false);
    assert.equal(free.deepResearch, false);
    assert.equal(free.dailySearches, FREE_DAILY_SEARCHES);
    assert.equal(free.deepMonthly, 0);
    const proDeny = requireResearch("proSearch");
    assert.equal(proDeny.ok, false);
    assert.equal(proDeny.status, 402);
    assert.equal(proDeny.code, "pro_required");
    assert.match(proDeny.message, /Pro search/);
    assert.doesNotMatch(proDeny.message, /2014/);
    process.env.CC_RESEARCH_TIER = "pro";
    process.env.CC_RESEARCH_DEEP_MONTHLY = "1";
    assert.equal(researchPlan().deepMonthly, 1);
    assert.equal(researchPlan().proSearch, true);
    process.env.CC_RESEARCH_TIER = "studio";
    assert.equal(researchPlan().deepMonthly, 1);
    assert.equal(researchPlan().label, "Studio");
    process.env.CC_RESEARCH_DEEP_MONTHLY = "1";
    process.env.CC_RESEARCH_TIER = "extreme";
    const extreme = researchPlan();
    assert.equal(extreme.deepMonthly, null, "Extreme ignores the monthly test cap");
    assert.equal(extreme.dailySearches, null);
    assert.equal(requireResearch("deepResearch").ok, true);
    process.env.CC_RESEARCH_TIER = "owner";
    assert.equal(researchPlan().deepMonthly, null);
    delete process.env.CC_RESEARCH_DEEP_MONTHLY;
    process.env.CC_RESEARCH_TIER = "pro";
    assert.equal(researchPlan().deepMonthly, PRO_DEEP_PER_MONTH);

    const exa = parseResults("exa", { results: [{ title: "Paper", url: "https://exa.example/p", highlights: ["a", "b"] }] });
    assert.equal(exa[0].snippet, "a b");
    const pplx = parseResults("pplx", { results: [{ title: "P", url: "https://pplx.example/a", snippet: "s" }] });
    assert.equal(pplx[0].host, "pplx.example");
    const sx = parseResults("searxng", { results: [{ title: "S", url: "https://sx.example/q", content: "c" }] });
    assert.equal(sx[0].snippet, "c");
    const ddg = parseResults("duckduckgo", { AbstractURL: "https://ddg.example/abs", Heading: "Duck", AbstractText: "sum" });
    assert.equal(ddg[0].title, "Duck");
    const html = parseDuckHtml(`<a class="result__a" href="/l/?uddg=https%3A%2F%2Fpage.example%2Fa">Hello <b>web</b></a>`);
    assert.equal(html[0].url, "https://page.example/a");
    assert.equal(html[0].title, "Hello web");
    assert.deepEqual(FILTERS, ["web", "news", "academic"]);
    assert.match(applyFilter("solar", "news"), / news$/);
    assert.match(applyFilter("solar", "academic"), /site:arxiv\.org/);
    assert.equal(applyFilter("solar", "web"), "solar");
    const follow = followQueries("solar incentives today", [{ title: "Tax credit" }], "academic");
    assert.ok(follow.length >= 1);
    assert.match(follow.join(" "), /Tax credit|study/);

    const pdf = reportPdf({ title: "Solar report", body: "Capacity grew [1].\n\n## Cross-check\n\nChecked by Groq." });
    assert.match(pdfText(pdf), /Solar report/);
    assert.match(pdfText(pdf), /Cross-check/);
    const docx = reportDocx({ title: "Solar report", body: "Capacity grew [1].\n\nCross-check holds." });
    assert.match(docxText(docx), /Capacity grew/);
    assert.match(docxText(docx), /Cross-check holds/);

    for (const f of ["server/feature-gate.js", "server/research.js", "server/research-export.js", "server/plugins/research.js", "server/plugins/alerts.js", "web/features/search.js", "web/app.js", "web/mode.js", ".github/workflows/mac-ci.yml"]) {
      assert.doesNotMatch(read(f), /2014/, `${f} has an em dash`);
    }
    assert.match(read("server/research.js"), /export function abortResearch/);
    assert.match(read("server/plugins/research.js"), /\/abort/);
    assert.match(read("server/plugins/alerts.js"), /ev\.aborted/);
    assert.match(read("web/app.js"), /id="stop-research"/);
    assert.match(read("web/app.js"), /\/research\/\$\{S\.live\.id\}\/abort/);
    assert.match(read("web/app.js"), /Deep research stopped/);
    assert.doesNotMatch(read("web/mode.js"), /"search"/);
  } finally {
    for (const [k, v] of [["CC_RESEARCH_TIER", prev.tier], ["CC_RESEARCH_FREE_DAILY", prev.daily], ["CC_RESEARCH_DEEP_MONTHLY", prev.deep], ["CC_PACKAGED", prev.pack]]) {
      if (v == null || v === "") delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("Mac CI: tests on a tag or a manual start, no package and no secrets", () => {
  const wf = read(".github/workflows/mac-ci.yml");
  assert.match(wf, /runs-on: macos-latest/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /tags: \["v\*"\]/);
  assert.doesNotMatch(wf, /pull_request:/);
  assert.match(wf, /run: npm ci/);
  assert.match(wf, /run: npm test/);
  assert.match(wf, /run: npm run smoke/);
  assert.doesNotMatch(wf, /npm run dist/);
  assert.doesNotMatch(wf, /\$\{\{ secrets\./);
  assert.doesNotMatch(wf, /gh release/);
  assert.doesNotMatch(wf, /2014/);
  assert.match(read("docs/RELEASING.md"), /mac-ci\.yml/);
  assert.match(read("docs/ci/mac-build.yml"), /mac-release/);
  assert.match(read("docs/ci/mac-build.yml"), /not a workflow/);
});

const KEYS = { groq: "gsk_fakefakefakefakefake", xai: "xai-fakefakefakefakefake", google: "AQ.fakefakefakefakefake" };
function sse(res, chunks) {
  res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
async function mocks(opts = {}) {
  const holdWriter = !!opts.holdWriter;
  const hold = { holding: false, release: () => {} };
  let writers = 0;
  const seen = { ddg: [], llm: [], gemini: [] };
  let port = 0;
  const srv = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/ddg/search") {
      const q = url.searchParams.get("q") || "";
      seen.ddg.push(q);
      const slug = Buffer.from(q).toString("base64url").slice(0, 40);
      const results = [1, 2, 3, 4].map((i) => ({ title: `Result ${i}`, url: `http://127.0.0.1:${port}/page/${slug}/${i}`, snippet: `Snippet ${i} ${q.slice(0, 48)}` }));
      return send(200, { results });
    }
    if (url.pathname.startsWith("/page/")) {
      res.writeHead(200, { "content-type": "text/html", connection: "close" });
      res.end("<html><body><p>Solar capacity grew in the latest report.</p></body></html>");
      return;
    }
    if (url.pathname.includes(":streamGenerateContent")) {
      const j = JSON.parse(body || "{}");
      seen.gemini.push(j);
      const payload = { candidates: [{ content: { role: "model", parts: [{ text: "Gemini says the price moved [1]." }] }, finishReason: "STOP", groundingMetadata: { groundingChunks: [{ web: { uri: `http://127.0.0.1:${port}/page/ground/1`, title: "Grounded page" } }] } }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6 } };
      res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      res.end(`data: ${JSON.stringify(payload)}\n\n`);
      return;
    }
    if (url.pathname.endsWith("/models") || url.pathname.includes("/models")) {
      if (url.pathname.includes("v1beta")) return send(200, { models: [{ name: "models/gemini-3.8-flash" }] });
      return send(200, { data: [{ id: "openai/gpt-oss-120b" }, { id: "grok-4.7" }] });
    }
    if (url.pathname.endsWith("/chat/completions")) {
      const j = JSON.parse(body || "{}");
      seen.llm.push(j);
      const sys = j.messages?.[0]?.content || "";
      let text = "Solar grew [1] and the second source agrees [2].";
      if (/JSON only/i.test(sys)) text = `{"capability":"research","difficulty":2,"needWeb":false,"summary":"research note","title":"Continue the brief","tasks":[{"id":"t1","title":"Write the brief","capability":"writing","difficulty":1,"needWeb":false,"deps":[],"instructions":"Write the brief.","deliverable":"A short brief"}],"assembly":"Use the task output."}`;
      else if (/cited research report/i.test(sys)) {
        writers += 1;
        if (holdWriter && writers === 1) {
          hold.holding = true;
          const why = await new Promise((resolve) => {
            hold.release = () => resolve("go");
            req.on("aborted", () => resolve("aborted"));
            res.on("close", () => { if (!res.writableEnded) resolve("close"); });
          });
          hold.holding = false;
          if (why !== "go" || res.writableEnded || req.destroyed) return;
        }
        text = "Solar report\n\nCapacity grew [1]. Prices moved [2].";
      }
      else if (/second AI/i.test(sys)) text = "Holds up [1]. The limit section is thin.";
      return sse(res, [{ model: j.model, choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 12 } }]);
    }
    send(404, { error: "mock: no route " + url.pathname });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  return { base, seen, hold, close: () => new Promise((r) => srv.close(r)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitRun(s, pred, label, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = (await s.api("/state")).json;
    const hit = pred(st);
    if (hit) return hit;
    await sleep(400);
  }
  throw new Error(`timed out waiting for ${label}`);
}
const finished = (kind, after) => (st) => st.missions.find((m) => m.kind === kind && m.startedAt > after && ["done", "done-with-errors", "failed"].includes(m.status));

function getBuf(s, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: s.port, path: p, headers: { "x-cc-token": s.token, connection: "close" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("server: any model, citations, pro search, filters, deep research, free daily limit", async () => {
  const m = await mocks();
  let pro;
  let free;
  try {
  pro = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_RESEARCH_TIER: "pro", CC_RESEARCH_DEEP_MONTHLY: "1",
    CC_SEARCH_URL_DUCKDUCKGO: `${m.base}/ddg`,
    CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GOOGLE: `${m.base}/v1beta`,
    GROQ_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
  } });
  free = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_RESEARCH_TIER: "free", CC_RESEARCH_FREE_DAILY: "1",
    CC_SEARCH_URL_DUCKDUCKGO: `${m.base}/ddg`,
    CC_BASE_URL_GROQ: `${m.base}/groq/v1`,
    GROQ_API_KEY: "",
  } });
  {
    assert.ok((await pro.api("/state")).json.plugins.includes("research"));
    let v = (await pro.api("/search")).json;
    assert.equal(v.active.engine, "duckduckgo");
    assert.deepEqual(v.free.map((e) => e.id), ["duckduckgo", "searxng"]);
    assert.equal(v.research.tier, "pro");
    assert.equal(v.research.proSearch, true);
    assert.equal(v.research.deepMonthly, 1);
    assert.ok(v.native.some((n) => n.provider === "google" && /Gemini/.test(n.name)));

    assert.equal((await pro.api("/keys", { method: "POST", body: { provider: "groq", key: KEYS.groq } })).json.status.status, "green");
    assert.equal((await pro.api("/keys", { method: "POST", body: { provider: "xai", key: KEYS.xai } })).json.status.status, "green");

    const ddgBefore = m.seen.ddg.length;
    let t0 = Date.now();
    assert.equal((await pro.api("/chat", { method: "POST", body: { prompt: "what is the price today of solar panels", provider: "groq", model: "openai/gpt-oss-120b" } })).status, 202);
    let run = await waitRun(pro, finished("single", t0 - 1), "any-model search");
    let full = (await pro.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done");
    assert.ok(full.sources.length >= 1, "DuckDuckGo sources on a model with no built-in search");
    assert.equal(full.searchEngine, "DuckDuckGo");
    assert.match(full.deliverable, /\[1\]/);
    assert.ok(m.seen.ddg.length > ddgBefore);
    const injected = m.seen.llm.find((j) => /price today/.test(j.messages.at(-1).content || "") && /WEB SEARCH RESULTS/.test(j.messages.at(-1).content || ""));
    assert.ok(injected, "the chosen model received numbered sources");

    t0 = Date.now();
    assert.equal((await pro.api("/council", { method: "POST", body: { prompt: "Council solar outlook", members: [{ provider: "groq", model: "openai/gpt-oss-120b" }], qa: false, search: true } })).status, 202);
    run = await waitRun(pro, finished("council", t0 - 1), "council sources");
    full = (await pro.api(`/missions/${run.id}`)).json;
    const ans = full.answers?.["openai/gpt-oss-120b"];
    assert.ok(ans?.sources?.length, "each answer keeps its sources");
    assert.equal(ans.sources.length, full.sources.length);
    assert.equal(ans.sources[0].url, full.sources[0].url);

    const beforePro = m.seen.ddg.length;
    t0 = Date.now();
    assert.equal((await pro.api("/chat", { method: "POST", body: { prompt: "compare solar incentives", provider: "groq", model: "openai/gpt-oss-120b", searchMode: "pro" } })).status, 202);
    run = await waitRun(pro, finished("single", t0 - 1), "pro search");
    full = (await pro.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done");
    assert.ok(full.sources.length >= 4, `pro sources ${full.sources.length}`);
    const proQueries = m.seen.ddg.slice(beforePro);
    assert.ok(proQueries.length >= 2, `pro search steps ${proQueries.length}`);
    assert.ok(new Set(proQueries).size >= 2, "follow-up query differs from the first");

    let r = await pro.api("/search/test", { method: "POST", body: { q: "solar panels", filter: "news" } });
    assert.equal(r.status, 200);
    assert.match(m.seen.ddg.at(-1), / news$/);
    r = await pro.api("/search/test", { method: "POST", body: { q: "solar panels", filter: "academic" } });
    assert.equal(r.status, 200);
    assert.match(m.seen.ddg.at(-1), /site:arxiv\.org/);

    t0 = Date.now();
    r = await pro.api("/research/deep", { method: "POST", body: { prompt: "How did solar capacity change?", filter: "news" } });
    assert.equal(r.status, 202);
    assert.match(r.json.id, /^r-/);
    run = await waitRun(pro, finished("research", t0 - 1), "deep research", 180000);
    full = (await pro.api(`/research/${run.id}`)).json;
    assert.equal(full.status, "done", full.error || full.deliverable);
    assert.match(full.deliverable, /\[1\]/);
    assert.match(full.deliverable, /Cross-check/);
    assert.equal(full.crossCheck.checked, true);
    assert.notEqual(full.crossCheck.provider, full.provider);
    assert.ok(full.reads?.length >= 1, "pages were read");
    assert.equal(full.reads[0].text, undefined, "page text is not returned");
    assert.ok((await pro.api("/state")).json.recent.some((e) => e.type === "log" && /Deep research is done/.test(e.text)));
    assert.ok((await pro.api("/state")).json.missions.some((row) => row.id === run.id && row.kind === "research"));

    const pdf = await getBuf(pro, `/api/research/${run.id}/export?format=pdf`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers["content-type"], /pdf/);
    assert.match(pdfText(pdf.buf), /Cross-check|Solar/);
    const docx = await getBuf(pro, `/api/research/${run.id}/export?format=docx`);
    assert.equal(docx.status, 200);
    assert.match(docx.headers["content-type"], /wordprocessingml/);
    assert.match(docxText(docx.buf), /Cross-check|Solar|Sources/);

    const cont = await pro.api(`/research/${run.id}/mission`, { method: "POST", body: {} });
    assert.equal(cont.status, 202);
    assert.ok((await pro.api("/state")).json.recent.some((e) => e.type === "log" && /continues as a mission/.test(e.text)));

    const again = await pro.api("/research/deep", { method: "POST", body: { prompt: "A second deep run" } });
    assert.equal(again.status, 402);
    assert.equal(again.json.code, "deep_limit");

    await pro.api("/search/settings", { method: "POST", body: { engine: "model" } });
    assert.equal((await pro.api("/keys", { method: "POST", body: { provider: "google", key: KEYS.google } })).json.status.status, "green");
    t0 = Date.now();
    await pro.api("/chat", { method: "POST", body: { prompt: "ground this", provider: "google", model: "gemini-3.8-flash", search: true } });
    run = await waitRun(pro, finished("single", t0 - 1), "gemini grounding");
    full = (await pro.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done", full.error || "");
    assert.ok(m.seen.gemini.some((j) => j.tools?.some((t) => t.google_search)), "Gemini grounding tool was requested");
    assert.ok(full.sources.some((s) => /ground/.test(s.url)), "grounding chunks became sources");

    const freeView = (await free.api("/search")).json;
    assert.equal(freeView.research.tier, "free");
    assert.equal(freeView.research.dailySearches, 1);
    assert.equal(freeView.research.proSearch, false);
    assert.equal((await free.api("/keys", { method: "POST", body: { provider: "groq", key: KEYS.groq } })).json.status.status, "green");
    t0 = Date.now();
    await free.api("/chat", { method: "POST", body: { prompt: "first free search", provider: "groq", model: "openai/gpt-oss-120b", search: true } });
    run = await waitRun(free, finished("single", t0 - 1), "free search");
    assert.ok((await free.api(`/missions/${run.id}`)).json.sources.length >= 1);
    t0 = Date.now();
    await free.api("/chat", { method: "POST", body: { prompt: "second free search", provider: "groq", model: "openai/gpt-oss-120b", search: true } });
    run = await waitRun(free, finished("single", t0 - 1), "free search capped");
    full = (await free.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done");
    assert.equal(full.sources.length, 0);
    assert.ok((await free.api("/state")).json.recent.some((e) => e.type === "log" && /web searches a day/.test(e.text)));
    assert.equal((await free.api("/chat", { method: "POST", body: { prompt: "pro please", searchMode: "pro" } })).status, 402);
    assert.equal((await free.api("/research/deep", { method: "POST", body: { prompt: "deep please" } })).status, 402);

    const dumped = JSON.stringify(await pro.api("/search")) + JSON.stringify(await pro.api("/state")) + JSON.stringify(await free.api("/state")) + pro.log + free.log;
    for (const k of Object.values(KEYS)) assert.ok(!dumped.includes(k), "key never in a response or the log");
  }
  } finally {
    await pro?.stop();
    await free?.stop();
    await m.close();
  }
});

async function waitResearch(s, id, pred, label, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const row = (await s.api(`/research/${id}`)).json;
    if (row && pred(row)) return row;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("server: Stop aborts a deep research run before the report is written", async () => {
  const m = await mocks({ holdWriter: true });
  let s;
  try {
    s = await startServer({ env: {
      CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_RESEARCH_TIER: "pro", CC_RESEARCH_DEEP_MONTHLY: "4",
      CC_SEARCH_URL_DUCKDUCKGO: `${m.base}/ddg`,
      CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_XAI: `${m.base}/xai/v1`,
      GROQ_API_KEY: "", XAI_API_KEY: "",
    } });
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "groq", key: KEYS.groq } })).json.status.status, "green");
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEYS.xai } })).json.status.status, "green");
    assert.equal((await s.api("/research/r-missing/abort", { method: "POST", body: {} })).status, 404);

    const started = await s.api("/research/deep", { method: "POST", body: { prompt: "How did solar capacity change?" } });
    assert.equal(started.status, 202);
    const id = started.json.id;
    const tHold = Date.now();
    while (!m.hold.holding && Date.now() - tHold < 60000) await sleep(100);
    assert.equal(m.hold.holding, true, "the writer call is held");
    assert.equal((await s.api(`/research/${id}`)).json.status, "running");
    const stop = await s.api(`/research/${id}/abort`, { method: "POST", body: {} });
    assert.equal(stop.status, 200);
    assert.equal(stop.json.aborted, true);
    const stopped = await waitResearch(s, id, (row) => ["aborted", "done", "failed"].includes(row.status), "abort");
    assert.equal(stopped.status, "aborted", stopped.error || stopped.deliverable || stopped.status);
    assert.equal(stopped.deliverable || "", "");
    assert.equal((await getBuf(s, `/api/research/${id}/export?format=pdf`)).status, 409);
    assert.equal((await s.api(`/research/${id}/abort`, { method: "POST", body: {} })).status, 409);
    const logs = (await s.api("/state")).json.recent.filter((e) => e.type === "log" && /Deep research stopped/.test(e.text || ""));
    assert.ok(logs.length >= 1, "a stopped line is logged");
    assert.ok(logs.every((e) => !String(e.text).includes("⛔")), "stopping is not a failure alarm");

    const second = await s.api("/research/deep", { method: "POST", body: { prompt: "A finished deep run after stop" } });
    assert.equal(second.status, 202);
    const done = await waitResearch(s, second.json.id, (row) => ["done", "failed", "aborted"].includes(row.status), "second deep", 120000);
    assert.equal(done.status, "done", done.error || done.deliverable || "");
    assert.match(done.deliverable, /Cross-check/);
    assert.equal((await getBuf(s, `/api/research/${second.json.id}/export?format=pdf`)).status, 200);

    // ---- Slice D1: flag_agents (default OFF), LeadResearcher 2-5 facets, parallel sub-agents, external memory, CitationAgent, effort scaling, cost warning ----
    const resMod = await import("../server/research.js");
    assert.equal(resMod.FLAG_AGENTS, "flag_agents");
    assert.equal(resMod.COST_MULTIPLIER, 15);
    assert.match(resMod.COST_WARNING, /15 times the tokens/);
    assert.doesNotMatch(resMod.COST_WARNING, /2014/);

    const efSimple = resMod.scaleEffort("solar price today");
    assert.equal(efSimple.level, "simple");
    assert.equal(efSimple.subAgents, 1);
    assert.equal(efSimple.facets, 2);

    const efStandard = resMod.scaleEffort("How did solar panel efficiency and residential installation costs change this year?");
    assert.equal(efStandard.level, "standard");
    assert.equal(efStandard.subAgents, 3);
    assert.equal(efStandard.facets, 3);

    const efComplex = resMod.scaleEffort("Compare utility-scale solar versus distributed rooftop solar across cost, grid storage trade-offs, market competition, regulatory incentives, and 2030 forecast.");
    assert.equal(efComplex.level, "complex");
    assert.ok(efComplex.subAgents >= 4 && efComplex.subAgents <= 5);
    assert.ok(efComplex.facets >= 4 && efComplex.facets <= 5);

    const plan2 = resMod.planFacets("short query", { facets: 1 });
    assert.equal(plan2.facets.length, 2, "clamped to minimum 2 facets");
    const plan5 = resMod.planFacets("complex query", { facets: 9 });
    assert.equal(plan5.facets.length, 5, "clamped to maximum 5 facets");
    assert.equal(plan5.leadRole, "LeadResearcher");

    const citeCheck = resMod.citationPass(
      "Solar report\n\nSolar capacity grew rapidly in utility markets.\nInvented claim [99] and grounded claim [1].\n\n## Cross-check\n\nChecked by XAI.",
      [{ n: 1, title: "Utility Solar Report", url: "http://127.0.0.1/1", snippet: "Solar capacity grew rapidly in utility markets" }, { n: 2, title: "Grid Study", url: "http://127.0.0.1/2", snippet: "Grid storage" }],
      [{ n: 1, url: "http://127.0.0.1/1", title: "Utility Solar Report", text: "Solar capacity grew rapidly in utility markets." }],
    );
    assert.equal(citeCheck.role, "CitationAgent");
    assert.equal(citeCheck.invalidRemoved, 1, "stripped invented [99] citation");
    assert.ok(citeCheck.citationsAdded >= 1, "attached citation to ungrounded claim");
    assert.doesNotMatch(citeCheck.text, /\[99\]/);
    assert.match(citeCheck.text, /Solar capacity grew rapidly in utility markets \[1\]\./);

    assert.equal((await s.api("/research")).json.research.flag_agents, false, "flag_agents defaults to OFF");
    const flagRes = await s.api("/research/flag", { method: "POST", body: { flag_agents: true } });
    assert.equal(flagRes.status, 200);
    assert.equal(flagRes.json.flag_agents, true);

    const planApi = await s.api("/research/plan?prompt=Compare%20solar%20and%20wind%20costs%20and%20storage");
    assert.equal(planApi.status, 200);
    assert.equal(planApi.json.costWarning.multiplier, 15);

    const third = await s.api("/research/deep", { method: "POST", body: { prompt: "How did solar capacity and battery storage costs change this year?" } });
    assert.equal(third.status, 202);
    assert.equal(third.json.costWarning.multiplier, 15);
    assert.ok(third.json.effort.facets >= 2 && third.json.effort.facets <= 5);
    const done3 = await waitResearch(s, third.json.id, (row) => ["done", "failed", "aborted"].includes(row.status), "orchestrated deep", 120000);
    assert.equal(done3.status, "done", done3.error || done3.deliverable || "");
    assert.ok(done3.facets?.length >= 2 && done3.facets?.length <= 5, "2 to 5 facets planned");
    assert.ok(done3.subAgents?.every((sa) => sa.isolatedContext === true), "sub-agents ran in isolated contexts");
    assert.equal(done3.citationAudit?.role, "CitationAgent");
    assert.match(done3.deliverable, /\[1\]/);
    assert.match(done3.deliverable, /Cross-check/);

    const memRes = await s.api(`/research/${third.json.id}/memory`);
    assert.equal(memRes.status, 200);
    assert.equal(memRes.json.phase, "done");
    assert.ok(memRes.json.checkpoints?.some((c) => c.phase === "planned"));
    assert.ok(memRes.json.checkpoints?.some((c) => c.phase === "subagents"));
    assert.ok(memRes.json.checkpoints?.some((c) => c.phase === "cited"));
    assert.ok(fs.existsSync(path.join(s.dir, "research", `${third.json.id}.json`)), "external memory written to data/research/<id>.json");

    await s.api("/research/flag", { method: "POST", body: { flag_agents: false } });
    const dumped = JSON.stringify(await s.api("/state")) + s.log;
    for (const k of Object.values(KEYS)) assert.ok(!dumped.includes(k), "key never in a response or the log");
  } finally {
    try { m.hold.release(); } catch {}
    await s?.stop();
    await m.close();
  }
});
