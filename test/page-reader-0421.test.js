// 0.4.21 (Chris note 7): Research and Deep Research really open pages. Fetcher is mocked; no real network, no real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-pagereader-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
process.env.CC_RESEARCH_TIER = "pro";
for (const k of ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY", "EXA_API_KEY", "PERPLEXITY_API_KEY"]) delete process.env[k];
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const PR = await import("../server/page-reader.js");
const S = await import("../server/search.js");
const R = await import("../server/research.js");

const PAGE = `<html><head><title>Acme pricing</title></head><body><p>${"Acme makes tools for small shops. ".repeat(3)}The Pro plan costs $49 per month. Founded on March 3, 2019. About 12% of users post daily. Write to hello@acme.example.</p></body></html>`;
const ok = (body, extra = {}) => async () => ({ ok: true, status: 200, contentType: "text/html", body, ...extra });
const status = (n) => async () => ({ ok: false, status: n, contentType: "text/html", body: "nope" });

test("openPage: reads a page, titles it, strips tags", async () => {
  const p = await PR.openPage("http://127.0.0.1:1/a", { fetcher: ok(PAGE) });
  assert.equal(p.ok, true);
  assert.equal(p.title, "Acme pricing");
  assert.match(p.text, /Pro plan costs \$49/);
  assert.doesNotMatch(p.text, /<p>/);
});

test("openPage: blocked, gone, down, empty, login wall and network errors all say why, none say opened", async () => {
  const cases = [
    [status(403), /blocked/], [status(404), /gone/], [status(429), /slow down/], [status(503), /error/],
    [ok("<html><body><script>x()</script></body></html>"), /no readable text/],
    [ok("<html><body><h1>Just a moment...</h1><p>Verify you are human. Please enable JavaScript and cookies to continue to the site.</p></body></html>"), /check or a login/],
    [async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); }, /could not connect \(ENOTFOUND\)/],
  ];
  for (const [fetcher, re] of cases) {
    const p = await PR.openPage("http://127.0.0.1:1/b", { fetcher });
    assert.equal(p.ok, false);
    assert.match(p.reason, re);
  }
  assert.equal((await PR.openPage("ftp://x/y", { fetcher: ok(PAGE) })).ok, false);
});

test("openPage: a stop signal is passed on, not swallowed", async () => {
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(PR.openPage("http://127.0.0.1:1/c", { signal: ctl.signal, fetcher: async (u, { signal }) => { if (signal.aborted) throw Object.assign(new Error("Stopped."), { code: "aborted" }); } }), /Stopped/);
});

test("pullDetails: price, date, percent and email come out of page text for the asked question", () => {
  const text = PR.pullDetails ? "Acme makes tools. The Pro plan costs $49 per month. Founded on March 3, 2019. About 12% of users post daily. Write to hello@acme.example." : "";
  const d = PR.pullDetails(text, "What does Acme cost, when was it founded and how often do users post? Contact email?");
  const kinds = new Set(d.map((x) => x.kind));
  for (const k of ["price", "date", "percent", "email"]) assert.ok(kinds.has(k), `has ${k}`);
  assert.ok(d.find((x) => x.kind === "price").value.startsWith("$49"));
  assert.ok(d.find((x) => x.kind === "email").value === "hello@acme.example");
  assert.deepEqual(PR.pullDetails(text, "Tell me about Acme"), [], "nothing asked, nothing pulled");
});

test("openSources: mixed results, limit, and nothing is 'opened' without page text", async () => {
  const fetcher = async (u) => (u.endsWith("/ok") ? { ok: true, status: 200, contentType: "text/html", body: PAGE } : { ok: false, status: 403, body: "" });
  const src = [
    { n: 1, url: "http://127.0.0.1:1/ok", title: "A", host: "a.test" },
    { n: 2, url: "http://127.0.0.1:1/blocked", title: "B", host: "b.test" },
    { n: 3, url: "http://127.0.0.1:1/ok3", title: "C", host: "c.test" },
  ];
  const reads = await PR.openSources(src, { question: "What does Acme cost?", limit: 2, fetcher });
  assert.deepEqual(reads.map((r) => r.opened), [true, false, false]);
  assert.equal(reads[1].reason, "the site blocked it");
  assert.equal(reads[2].skipped, true);
  assert.ok(reads[0].details.some((d) => d.kind === "price"));
  assert.match(PR.coverageLine(reads), /Opened 1 of 2 pages\. Could not open: b\.test \(the site blocked it\)\./);
  assert.equal(PR.sourceStatus(src[0], reads).status, "opened");
  assert.match(PR.sourceStatus(src[1], reads).label, /^Could not open/);
  assert.equal(PR.sourceStatus(src[2], reads).status, "listing-only");
  const block = PR.pagesBlock(reads);
  assert.match(block, /PAGE OPENED/);
  assert.match(block, /COULD NOT BE OPENED[\s\S]*\[2\]/);
  assert.match(PR.coverageLine([{ n: 1, url: "u", host: "h", opened: false, reason: "x" }]), /Nothing below was checked against a page/);
});

test("withPages: chat/mission prompt gets page text, the failed list, and the no-verified note", async () => {
  R.setPageFetcher(async (u) => (u.endsWith("/ok") ? { ok: true, status: 200, contentType: "text/html", body: PAGE } : { ok: false, status: 404, body: "" }));
  try {
    const sources = [{ n: 1, title: "Acme", url: "http://127.0.0.1:1/ok", host: "acme.test", snippet: "s" }, { n: 2, title: "Old", url: "http://127.0.0.1:1/gone", host: "old.test", snippet: "s" }];
    const web = { engine: "tavily", name: "Tavily", sources, block: S.sourcesBlock(sources, "Tavily"), prompt: `What does Acme cost?\n\n${S.sourcesBlock(sources, "Tavily")}` };
    const out = await R.withPages(web, { question: "What does Acme cost?" });
    assert.match(out.prompt, /PAGE OPENED/);
    assert.match(out.prompt, /Pro plan costs \$49/);
    assert.match(out.prompt, /could not be opened/i);
    assert.match(out.prompt, /Never say a fact is verified/);
    assert.match(out.coverage, /Opened 1 of 2/);
    assert.equal(out.pages.filter((p) => p.opened).length, 1);
    assert.equal((out.prompt.match(/WEB SEARCH RESULTS/g) || []).length, 1, "search block is not duplicated");
    // demo and built-in search are never dressed up as opened pages
    const demo = { demo: true, sources, block: "b", prompt: "p" };
    assert.equal(await R.withPages(demo, {}), demo);
    assert.equal(await R.withPages(null, {}), null);
  } finally { R.setPageFetcher(null); }
});

test("citationPass: a claim is only 'verified' when the cited page was opened", () => {
  const sources = [{ n: 1, title: "Opened", url: "http://127.0.0.1:1/1", snippet: "x" }, { n: 2, title: "Listing", url: "http://127.0.0.1:1/2", snippet: "Solar costs fell" }];
  const reads = [{ n: 1, url: sources[0].url, opened: true, text: "Solar costs fell sharply in 2024." }];
  const c = R.citationPass("Title\n\nSolar costs fell sharply this year [2].\nBattery prices dropped as well [1].", sources, reads);
  assert.equal(c.verifiedClaims, 1);
  assert.equal(c.listingOnlyClaims, 1);
  const none = R.citationPass("Title\n\nSolar costs fell sharply this year, many say.", sources, []);
  assert.equal(none.citationsAdded, 0, "no opened page, so no citation is invented");
  assert.equal(none.verifiedClaims, 0);
});

test("searchPreflight: names the one step when no search can run, and when a key was refused", () => {
  S.saveSearchSettings({ engine: "tavily" });
  let p = PR.searchPreflight({});
  assert.equal(p.ok, false);
  assert.match(p.message, /Tavily has no key yet: Settings > Web search/);
  S.saveSearchSettings({ engine: "auto" });
  p = PR.searchPreflight({});
  assert.equal(p.ok, true);
  assert.equal(p.level, "warn");
  assert.match(p.message, /No search key is added/);
  assert.doesNotMatch(p.message, /—/);
  process.env.TAVILY_API_KEY = "tvly-fake-test-key";
  assert.equal(PR.searchPreflight({}).level, "ok");
  S.engineTrouble.set("tavily", { message: "Key rejected (401)", rejected: true, at: Date.now() });
  p = PR.searchPreflight({});
  assert.equal(p.ok, false);
  assert.match(p.message, /Tavily key was refused/);
  PR.resetSearchTrouble();
  delete process.env.TAVILY_API_KEY;
});

test("beginDeep: refuses before running when search cannot run; warns (not blocks) with free search only", async () => {
  S.saveSearchSettings({ engine: "tavily" });
  assert.throws(() => R.beginDeep({ prompt: "How is Acme doing?" }), (e) => e.status === 400 && e.code === "no_search" && /Settings > Web search/.test(e.message));
  S.saveSearchSettings({ engine: "auto" });
});
