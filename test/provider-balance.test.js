// Provider balances ("credits left" on the AI providers panel). Every provider API is a local mock:
// OpenRouter /credits and /key, DeepSeek /user/balance, the OpenAI organization costs API and the
// Anthropic cost report. Also: a 401, an unreachable host, a provider with no balance API (estimate plus
// hint), the running server's GET /api/providers/balances?refresh=1, and a source check that the UI never
// renders "not available" for credits. No real URL or key is ever used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-balance-");
const B = await import("../server/provider-balance.js");

const KEYS = { openrouter: "sk-or-v1-fakebalancefakebalance", deepseek: "sk-0123456789abcdef0123456789abcdef", openaiAdmin: "sk-admin-FAKEbalancefakebalance", anthropicAdmin: "sk-ant-admin01-FAKEbalancefake", xaiMgmt: "xai-mgmt-FAKEbalancefake" };

async function mock() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const p = u.pathname;
    hits.push({ path: p, query: u.search, auth: req.headers.authorization || req.headers["x-api-key"] || null });
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const bearer = (k) => req.headers.authorization === `Bearer ${k}`;
    if (p === "/or/v1/models") return send(200, { data: [{ id: "openrouter/auto" }] });
    if (p === "/or/v1/key") return bearer(KEYS.openrouter) ? send(200, { data: { usage: 7, usage_monthly: 3.5, limit: null, limit_remaining: null } }) : send(401, { error: { message: "No auth credentials found" } });
    if (p === "/or/v1/credits") return bearer(KEYS.openrouter) ? send(200, { data: { total_credits: 25, total_usage: 7.75 } }) : send(401, { error: { message: "No auth" } });
    // an OpenRouter key that may not read /credits: only its own limit
    if (p === "/orlimited/v1/key") return send(200, { data: { usage: 1, limit: 10, limit_remaining: 9 } });
    if (p === "/orlimited/v1/credits") return send(403, { error: { message: "Only management keys can read credits" } });
    if (p === "/ds/user/balance") return bearer(KEYS.deepseek) ? send(200, { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "70.00" }, { currency: "USD", total_balance: "12.34" }] }) : send(401, { error: { message: "Authentication Fails" } });
    if (p.startsWith("/openai/v1/organization/")) {
      if (!bearer(KEYS.openaiAdmin)) return send(401, { error: { message: "Invalid admin key" } });
      if (p.endsWith("/costs")) return send(200, { data: [{ results: [{ amount: { value: 2.5, currency: "usd" } }] }, { results: [{ amount: { value: 1.25, currency: "usd" } }] }], has_more: false });
      if (p.endsWith("/usage/completions")) return send(200, { data: [{ results: [{ input_tokens: 500, output_tokens: 50 }] }], has_more: false });
    }
    if (p.startsWith("/anthropic/v1/organizations/")) {
      if (req.headers["x-api-key"] !== KEYS.anthropicAdmin || !req.headers["anthropic-version"]) return send(401, { error: { message: "invalid x-api-key" } });
      if (p.endsWith("/cost_report")) return send(200, { data: [{ results: [{ amount: "650.5", currency: "USD" }] }, { results: [{ amount: "100", currency: "USD" }] }], has_more: false });
      if (p.endsWith("/usage_report/messages")) return send(200, { data: [{ results: [{ uncached_input_tokens: 40, cache_read_input_tokens: 2, output_tokens: 9 }] }], has_more: false });
    }
    if (p === "/xai-mgmt/v1/billing/teams/team-1/prepaid/balance") return bearer(KEYS.xaiMgmt) ? send(200, { changes: [], total: { val: "-1850" } }) : send(401, { error: "bad management key" });
    send(404, { error: "not mocked" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = null;
  return { base, hits, close: () => (closed ||= new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); })) };
}

test("live adapters against local mocks: OpenRouter, DeepSeek, OpenAI admin costs, Anthropic admin cost report, xAI management", async () => {
  const m = await mock();
  try {
    B.configure({ baseUrls: { openrouter: `${m.base}/or/v1`, deepseek: `${m.base}/ds`, openai: `${m.base}/openai/v1`, anthropic: `${m.base}/anthropic`, "xai-management": `${m.base}/xai-mgmt` } });
    const or = await B.checkLive("openrouter", { key: KEYS.openrouter });
    assert.equal(or.ok, true); assert.equal(or.creditsLeft, 17.25, "total_credits - total_usage"); assert.equal(or.creditsTotal, 25); assert.equal(or.mtd, 3.5);
    const lim = await B.checkLive("openrouter", { key: KEYS.openrouter }, { base: `${m.base}/orlimited/v1` });
    assert.equal(lim.creditsLeft, 9, "falls back to limit_remaining"); assert.equal(lim.creditsScope, "key limit"); assert.match(lim.note, /cannot read account credits/);
    const ds = await B.checkLive("deepseek", { key: KEYS.deepseek });
    assert.equal(ds.creditsLeft, 12.34); assert.equal(ds.creditsUnit, "USD");
    const oa = await B.checkLive("openai", { key: KEYS.openaiAdmin });
    assert.equal(oa.mtd, 3.75); assert.equal(oa.inTok, 500); assert.equal(oa.outTok, 50);
    const an = await B.checkLive("anthropic", { key: KEYS.anthropicAdmin });
    assert.equal(an.mtd, 7.505, "cents to dollars"); assert.equal(an.inTok, 42); assert.equal(an.outTok, 9);
    const xa = await B.checkLive("xai", { key: KEYS.xaiMgmt, teamId: "team-1" });
    assert.equal(xa.creditsLeft, 18.5);
    // keys travel in headers only, never in a URL
    for (const h of m.hits) for (const k of Object.values(KEYS)) assert.ok(!h.path.includes(k) && !h.query.includes(k), "key in URL");
    assert.ok(m.hits.some((h) => h.path.endsWith("/organization/costs") && /start_time=/.test(h.query)));
    assert.ok(m.hits.some((h) => h.path.endsWith("/cost_report") && /starting_at=/.test(h.query)));
  } finally { B.resetConfig(); await m.close(); }
});

test("a refused key says Key rejected (401); an unreachable host says Could not reach <provider>", async () => {
  const m = await mock();
  try {
    B.configure({ baseUrls: { openrouter: `${m.base}/or/v1`, openai: `${m.base}/openai/v1` } });
    await assert.rejects(B.checkLive("openrouter", { key: "sk-or-v1-wrongwrongwrong" }), (e) => { assert.match(e.message, /^Key rejected \(401\)/); assert.equal(e.rejected, true); assert.doesNotMatch(e.message, /fetch failed/); return true; });
    await assert.rejects(B.checkLive("openai", { key: "sk-admin-wrongwrongwrong" }), { message: /^Key rejected \(401\)/ });
    await m.close();
    await assert.rejects(B.checkLive("openrouter", { key: KEYS.openrouter }), (e) => { assert.match(e.message, /^Could not reach OpenRouter: /); assert.equal(e.network, true); assert.doesNotMatch(e.message, /fetch failed/); return true; });
    // a timeout is plain too
    const slow = http.createServer(() => {}); await new Promise((r) => slow.listen(0, "127.0.0.1", r));
    await assert.rejects(B.checkLive("deepseek", { key: KEYS.deepseek }, { base: `http://127.0.0.1:${slow.address().port}`, timeoutMs: 200 }), { message: /^Could not reach DeepSeek: timed out/ });
    slow.closeAllConnections?.(); await new Promise((r) => slow.close(r));
  } finally { B.resetConfig(); await m.close(); }
});

test("injectable fetch and the cache: a second call inside maxAgeMs does not ask again", async () => {
  let calls = 0;
  const fake = async (url, o) => { calls++; assert.ok(!String(url).includes("sk-")); assert.equal(o.headers.authorization, `Bearer ${KEYS.deepseek}`); return new Response(JSON.stringify({ balance_infos: [{ currency: "USD", total_balance: "5.00" }] }), { status: 200 }); };
  try {
    B.configure({ fetch: fake, baseUrls: { deepseek: "http://127.0.0.1:9/ds" } });
    B.clearCache();
    assert.equal((await B.cachedLive("deepseek", { key: KEYS.deepseek }, { maxAgeMs: 60000 })).creditsLeft, 5);
    assert.equal((await B.cachedLive("deepseek", { key: KEYS.deepseek }, { maxAgeMs: 60000 })).creditsLeft, 5);
    assert.equal(calls, 1);
    await B.cachedLive("deepseek", { key: KEYS.deepseek }, { maxAgeMs: 0 });
    assert.equal(calls, 2, "maxAgeMs 0 always asks");
  } finally { B.resetConfig(); B.clearCache(); }
});

test("no balance API: an estimate labelled estimated, plus a plain hint; nothing saved says what to add", () => {
  assert.equal(B.ADAPTERS.google, undefined, "Gemini has no balance API");
  for (const pid of ["google", "groq", "together", "fireworks", "mistral", "perplexity"]) assert.match(B.liveHint(pid), /estimate/, pid);
  assert.equal(B.liveHint("openai"), "Add an OpenAI admin key to see live spend.");
  assert.equal(B.liveHint("anthropic"), "Add an Anthropic admin key to see live spend.");
  assert.match(B.liveHint("xai"), /xAI management key/);
  assert.match(B.liveHint("openrouter", { error: "Key rejected (401)" }), /Check the OpenRouter API key/);

  const budget = B.budgetFor("google", { budgets: { google: { amount: 20, kind: "monthly" } } });
  const est = B.estimateCredits({ budget, spentMonth: 4.5 });
  assert.equal(est.value, 15.5); assert.equal(est.total, 20); assert.equal(est.source, "estimate"); assert.equal(est.estimated, true);
  assert.match(est.label, /^estimated: /); assert.match(est.label, /monthly budget/);
  // the spend cap is the fallback budget
  const cap = B.estimateCredits({ budget: B.budgetFor("groq", { caps: { groq: 10 } }), spentMonth: 2 });
  assert.equal(cap.value, 8); assert.match(cap.label, /monthly spend cap/);
  // a credit bought counts spend since it was entered
  const cr = B.estimateCredits({ budget: { amount: 50, kind: "credit", at: 1 }, spentSince: 12.25 });
  assert.equal(cr.value, 37.75); assert.match(cr.label, /credit you entered/);
  // an admin key's live month-to-date replaces the ledger in the estimate
  assert.equal(B.estimateCredits({ budget: { amount: 100, kind: "monthly", source: "budget" }, spentMonth: 1, liveMtd: 30 }).value, 70);
  // never below zero
  assert.equal(B.estimateCredits({ budget: { amount: 5, kind: "monthly" }, spentMonth: 9 }).value, 0);
  // nothing saved: no number, and the hint says what to add
  assert.equal(B.estimateCredits({ budget: B.budgetFor("mistral", {}), spentMonth: 3 }), null);
  assert.equal(B.NO_INFO_HINT, "Set a monthly budget for this provider to see an estimate.");
});

test("running server: GET /api/providers/balances?refresh=1 returns live numbers, estimates and hints", { timeout: 90000 }, async () => {
  const m = await mock();
  const now = Date.now();
  const s = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "ledger.jsonl"), [
      { ts: now - 60000, kind: "call", provider: "groq", model: "llama", inTok: 10, outTok: 10, cost: 3, exact: true },
      { ts: now - 60000, kind: "call", provider: "mistral", model: "mistral-small", inTok: 10, outTok: 10, cost: 1, exact: true },
      { ts: now - 60000, kind: "call", provider: "openai", model: "gpt-x", inTok: 10, outTok: 10, cost: 0.5, exact: true },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n"),
    env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BASE_URL_OPENROUTER: `${m.base}/or/v1`, CC_BASE_URL_DEEPSEEK: `${m.base}/ds` },
  });
  try {
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openrouter", key: KEYS.openrouter } })).status, 200);
    assert.equal((await s.api("/services/budget", { method: "POST", body: { provider: "groq", amount: 10, kind: "monthly" } })).status, 200);
    const r = await s.api("/providers/balances?refresh=1");
    assert.equal(r.status, 200, r.text);
    const by = Object.fromEntries(r.json.balances.map((b) => [b.provider, b]));
    assert.equal(by.openrouter.credits.source, "api"); assert.equal(by.openrouter.credits.value, 17.25);
    assert.equal(by.groq.credits.source, "estimate"); assert.equal(by.groq.credits.value, 7); assert.match(by.groq.hint, /no balance API/);
    assert.equal(by.mistral.credits, null); assert.match(by.mistral.hint, /Set a monthly budget for this provider to see an estimate\./);
    assert.match(by.openai.hint, /Add an OpenAI admin key to see live spend\./);
    for (const b of r.json.balances) assert.ok(b.credits || b.hint, `${b.provider} has a number or a hint`);
    assert.ok(r.json.at > 0);
    assert.doesNotMatch(r.text, /not available/i);
    assert.doesNotMatch(r.text, /—/);
    for (const k of Object.values(KEYS)) assert.ok(!r.text.includes(k), "no key in the answer");
    // without refresh the cached numbers come back and no provider is asked again
    const before = m.hits.length;
    const c = await s.api("/providers/balances");
    assert.equal(c.json.balances.find((b) => b.provider === "openrouter").credits.value, 17.25);
    assert.equal(m.hits.length, before);
  } finally { await s.stop(); await m.close(); }
});

test("source: the UI never renders 'not available' for credits; the refresh button spins and says Checking...", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web/features/services.js"), "utf8");
  assert.doesNotMatch(ui, /not available/i);
  assert.match(ui, /\/providers\/balances\?refresh=1/);
  assert.match(ui, /Checking\.\.\./);
  assert.match(ui, /id="sv-refresh" disabled aria-busy="true"><span class="sv-spin"/);
  assert.match(ui, /estimated/);
  for (const f of ["server/provider-balance.js", "server/services.js", "web/features/services.js", "server/plugins/services.js", "server/plugins/providers.js"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /—/, f);
  // the scheduler checks balances every 15 minutes while the app is in use
  assert.match(fs.readFileSync(path.join(ROOT, "server/plugins/services.js"), "utf8"), /everyMs: 15 \* 60 \* 1000/);
});
