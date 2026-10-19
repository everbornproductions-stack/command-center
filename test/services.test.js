// Phase 25: subscriptions and services page. Pure checks on the receipt parser against fake receipt
// emails for every listed service (plus a low-confidence one and two parse failures), dates, billing
// cycles and the duplicate / unused hints; then the running server against one local mock that plays
// OpenRouter, DeepSeek, the OpenAI and Anthropic cost APIs, Google and Microsoft sign-in, Gmail and
// Microsoft Graph. No real inbox, key or URL is ever used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-services-");
const R = await import("../server/receipts.js");
const SV = await import("../server/services.js");

const FIX_DIR = path.join(ROOT, "test", "fixtures", "receipts");
const FIXTURES = fs.readdirSync(FIX_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), "utf8")));
const DAY = 86400000;
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

test("receipt parser: every listed service, a low-confidence receipt and two parse failures", () => {
  const ids = new Set(FIXTURES.map((f) => f.expect.serviceId).filter(Boolean));
  for (const s of ["google-ai", "kling", "suno", "chatgpt", "claude", "midjourney", "elevenlabs"]) assert.ok(ids.has(s), `a fixture for ${s}`);
  for (const f of FIXTURES) {
    const r = R.parseReceipt(f);
    const e = f.expect;
    if (e.fail) { assert.equal(r.ok, false, f.id); assert.match(r.reason, new RegExp(e.reason), f.id); continue; }
    assert.equal(r.ok, true, `${f.id}: ${r.reason || ""}`);
    if ("serviceId" in e) assert.equal(r.serviceId, e.serviceId, f.id);
    if (e.service) assert.equal(r.service, e.service, f.id);
    if (e.plan) assert.equal(r.plan, e.plan, f.id);
    if (e.price != null) assert.equal(r.price, e.price, f.id);
    if (e.cycle) assert.equal(r.cycle, e.cycle, f.id);
    if (e.renews) assert.equal(r.renews, e.renews, f.id);
    if (e.monthly != null) assert.equal(r.monthly, e.monthly, f.id);
    if (e.minConfidence) { assert.ok(r.confidence >= e.minConfidence, `${f.id} confidence ${r.confidence}`); assert.equal(r.low, false, f.id); }
    if (e.maxConfidence) assert.ok(r.confidence <= e.maxConfidence, `${f.id} confidence ${r.confidence}`);
    if (e.low) assert.equal(r.low, true, f.id);
    for (const [k, v] of Object.entries(r.fields)) if (v) assert.ok(v.conf > 0 && v.conf <= 1, `${f.id} ${k}`);
  }
  // Google's sender domain alone is not enough: a Google Play receipt is not Google AI
  const play = R.parseReceipt({ from: "Google Play <googleplay-noreply@google.com>", subject: "Your Google Play Order Receipt", date: "Thu, 15 Oct 2026 12:00:00 +0000", text: "Some Game Coins\nTotal: $4.99" });
  assert.notEqual(play.serviceId, "google-ai");
  // Google AI Pro mentions Flow: the row is linked to the Flow provider for credit activity
  assert.equal(R.parseReceipt(FIXTURES.find((f) => f.id === "g-google-ai-pro")).provider, "flow");
  // no renewal sentence but a receipt date and a cycle: next renewal estimated one cycle later, marked as such
  const est = R.parseReceipt({ from: "Midjourney <billing@midjourney.com>", subject: "Midjourney invoice", date: "Mon, 05 Oct 2026 10:00:00 +0000", text: "Standard Plan\nAmount paid $30.00\nBilled monthly." });
  assert.equal(est.renews, "2026-11-05"); assert.equal(est.renewsEstimated, true); assert.equal(est.fields.renews.estimated, true);
});

test("dates, cycles and monthly figures", () => {
  assert.equal(R.parseDate("2026-11-20"), "2026-11-20");
  assert.equal(R.parseDate("Nov 3, 2026"), "2026-11-03");
  assert.equal(R.parseDate("Sept. 9 2026"), "2026-09-09");
  assert.equal(R.parseDate("3rd December 2026".replace("3rd", "3")), "2026-12-03");
  assert.equal(R.parseDate("11/30/2026"), "2026-11-30");
  assert.equal(R.parseDate("30/11/2026"), "2026-11-30");
  assert.equal(R.parseDate("2026-02-30"), null);
  assert.equal(R.parseDate("soon"), null);
  assert.equal(R.addCycle("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(R.addCycle("2026-10-19", "yearly"), "2027-10-19");
  assert.equal(R.addCycle("2026-10-19", "weekly"), "2026-10-26");
  assert.equal(R.monthlyOf(120, "yearly"), 10);
  assert.equal(R.monthlyOf(10, "weekly"), 43.33);
  assert.equal(R.monthlyOf(20, "monthly"), 20);
  assert.equal(R.monthlyOf(null, "monthly"), null);
  assert.equal(R.vendorOf({ provider: "flow" }), "google");
  assert.equal(R.vendorOf({ name: "ChatGPT Pro" }), "openai");
  assert.equal(R.vendorOf({ name: "Some New Tool" }), "some-new-tool");
});

test("hints: two plans from one vendor, and a paid service with no ledger or credit activity in 30 days", () => {
  const now = Date.now(), old = now - 90 * DAY;
  const view = [
    { id: "chatgpt", name: "ChatGPT", plan: "Plus", provider: "openai", vendor: "openai", monthly: 20, addedAt: old },
    { id: "chatgpt-pro", name: "ChatGPT Pro", provider: "openai", vendor: "openai", monthly: 200, addedAt: old },
    { id: "claude", name: "Claude", provider: "anthropic", vendor: "anthropic", monthly: 100, price: 100, cycle: "monthly", addedAt: old },
    { id: "kling", name: "Kling AI", provider: "kling", vendor: "kling", monthly: 10, addedAt: now - 5 * DAY },
    { id: "or", name: "OpenRouter top-up", provider: "openrouter", vendor: "openrouter", monthly: 10, addedAt: old },
    { id: "eleven", name: "ElevenLabs", provider: "elevenlabs", vendor: "elevenlabs", monthly: 22, addedAt: old, creditsUpdatedAt: now - 2 * DAY },
    { id: "free", name: "Free thing", provider: "groq", vendor: "groq", monthly: 0, addedAt: old },
    { id: "unpriced", name: "Midjourney", vendor: "midjourney", monthly: null, addedAt: old },
  ];
  const entries = [{ provider: "openai", ts: now - 3 * DAY }, { provider: "anthropic", ts: now - 40 * DAY }];
  const history = { openrouter: [{ ts: now - 20 * DAY, left: 5 }, { ts: now - 10 * DAY, left: 4 }] };
  const h = SV.hintsFor(view, { entries, history, now });
  const dup = h.filter((x) => x.kind === "duplicate");
  assert.equal(dup.length, 1); assert.deepEqual(dup[0].ids.sort(), ["chatgpt", "chatgpt-pro"]); assert.match(dup[0].text, /2 plans from OpenAI/);
  const unused = h.filter((x) => x.kind === "unused").map((x) => x.ids[0]);
  assert.deepEqual(unused, ["claude"], "only Claude: OpenAI was used, Kling is too new, OpenRouter credits moved, ElevenLabs credits were updated, $0 and unpriced rows are skipped");
  for (const x of h) assert.doesNotMatch(x.text, /—/);
});

test("read-only scopes only; no em-dashes in user-facing words", () => {
  assert.deepEqual(SV.MAIL_SCOPES.gmail, ["https://www.googleapis.com/auth/gmail.readonly"]);
  assert.deepEqual(SV.MAIL_SCOPES.outlook, ["https://graph.microsoft.com/Mail.Read", "offline_access"]);
  const words = [...R.SERVICES.map((s) => s.name), ...Object.values(SV.LIVE).map((l) => l.how + (l.adminHint || "")), ...Object.values(SV.NO_LIVE), ...SV.DEMO_RECEIPTS.map((d) => d.text + d.subject)];
  for (const w of words) assert.doesNotMatch(w, /—/, w);
  for (const f of ["server/services.js", "server/receipts.js", "server/plugins/services.js", "web/features/services.js"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /—/, f);
});

// ---------- the running server against one local mock ----------
const KEYS = { openrouter: "sk-or-v1-fakefakefakefakefake", deepseek: "sk-0123456789abcdef0123456789abcdef", openaiAdmin: "sk-admin-GOODfakefakefakefake", openaiAdminBad: "sk-admin-BADfakefakefakefake", anthropicAdmin: "sk-ant-admin01-GOODfakefakefake" };
const TOK = { gAccess1: "ya29.FAKE-ACCESS-ONE", gAccess2: "ya29.FAKE-ACCESS-TWO", gRefresh: "1//FAKE-REFRESH-TOKEN", gSecret: "GOCSPX-fake-client-secret", msAccess: "EwB-FAKE-MS-ACCESS", msRefresh: "M.FAKE-MS-REFRESH" };
const SECRETS = [...Object.values(KEYS), ...Object.values(TOK)];

function gmailMessage(f) {
  const enc = (s) => Buffer.from(s, "utf8").toString("base64url");
  const part = f.html ? { mimeType: "text/html", body: { data: enc(f.html) } } : { mimeType: "text/plain", body: { data: enc(f.text) } };
  return { id: f.id, threadId: f.id, payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: f.from }, { name: "Subject", value: f.subject }, { name: "Date", value: f.date }], parts: [part] } };
}
async function mocks() {
  const hits = [];
  const st = { gExpiresIn: 3600, gAccess: TOK.gAccess1, gmail401: false };
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const u = new URL(req.url, "http://127.0.0.1");
    const p = u.pathname;
    hits.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || req.headers["x-api-key"] || null, body });
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const bearer = (k) => req.headers.authorization === `Bearer ${k}`;
    // OpenRouter
    if (p === "/or/v1/models") return send(200, { data: [{ id: "openrouter/auto" }] });
    if (p === "/or/v1/key") return bearer(KEYS.openrouter) ? send(200, { data: { label: "fake", usage: 12.5, usage_monthly: 4.25, limit: null, limit_remaining: null, is_free_tier: false } }) : send(401, { error: { message: "No auth" } });
    if (p === "/or/v1/credits") return send(200, { data: { total_credits: 50, total_usage: 48.6 } });
    // DeepSeek
    if (p === "/ds/models") return send(200, { data: [{ id: "deepseek-chat" }] });
    if (p === "/ds/user/balance") return send(200, { is_available: true, balance_infos: [{ currency: "USD", total_balance: "0.00", granted_balance: "0.00", topped_up_balance: "0.00" }] });
    // OpenAI organization costs and usage (admin key only)
    if (p.startsWith("/openai/v1/organization/")) {
      if (!bearer(KEYS.openaiAdmin)) return send(401, { error: { message: "Invalid admin key" } });
      if (p.endsWith("/costs")) return u.searchParams.get("page") === "p2" ? send(200, { data: [{ results: [{ amount: { value: 0.75, currency: "usd" } }] }], has_more: false }) : send(200, { data: [{ results: [{ amount: { value: 1.5, currency: "usd" } }] }, { results: [{ amount: { value: 2.25, currency: "usd" } }] }], has_more: true, next_page: "p2" });
      if (p.endsWith("/usage/completions")) return send(200, { data: [{ results: [{ input_tokens: 1000, output_tokens: 200 }] }], has_more: false });
    }
    // Anthropic cost and usage reports (amounts in cents)
    if (p.startsWith("/anthropic/v1/organizations/")) {
      if (req.headers["x-api-key"] !== KEYS.anthropicAdmin) return send(401, { error: { type: "authentication_error", message: "invalid x-api-key" } });
      if (p.endsWith("/cost_report")) return send(200, { data: [{ starting_at: "2026-10-01T00:00:00Z", results: [{ currency: "USD", amount: "1234.5" }] }], has_more: false });
      if (p.endsWith("/usage_report/messages")) return send(200, { data: [{ results: [{ uncached_input_tokens: 10, cache_read_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 2 }, output_tokens: 7 }] }], has_more: false });
    }
    // Google sign-in and Gmail
    if (p === "/gtoken/token") {
      const f = new URLSearchParams(body);
      if (f.get("grant_type") === "authorization_code") {
        if (f.get("code") !== "good-code" || !f.get("code_verifier") || f.get("client_secret") !== TOK.gSecret) return send(400, { error: "invalid_grant" });
        st.gAccess = TOK.gAccess1;
        return send(200, { access_token: st.gAccess, refresh_token: TOK.gRefresh, expires_in: st.gExpiresIn, scope: "https://www.googleapis.com/auth/gmail.readonly", token_type: "Bearer" });
      }
      if (f.get("grant_type") === "refresh_token" && f.get("refresh_token") === TOK.gRefresh) { st.gAccess = TOK.gAccess2; return send(200, { access_token: st.gAccess, expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly" }); }
      return send(400, { error: "invalid_grant" });
    }
    if (p.startsWith("/gmail/gmail/v1/users/me/messages")) {
      if (st.gmail401 || !bearer(st.gAccess)) return send(401, { error: { message: "Invalid Credentials" } });
      const id = decodeURIComponent(p.split("/").pop());
      if (id === "messages") return send(200, { messages: FIXTURES.map((f) => ({ id: f.id, threadId: f.id })) });
      const f = FIXTURES.find((x) => x.id === id);
      return f ? send(200, gmailMessage(f)) : send(404, { error: { message: "not found" } });
    }
    // Microsoft sign-in and Graph
    if (p === "/ms/common/oauth2/v2.0/token") {
      const f = new URLSearchParams(body);
      if (f.get("code") !== "ms-code" || !f.get("code_verifier") || !/Mail\.Read/.test(f.get("scope") || "")) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: TOK.msAccess, refresh_token: TOK.msRefresh, expires_in: 3600, scope: "https://graph.microsoft.com/Mail.Read" });
    }
    if (p === "/graph/v1.0/me/messages") {
      if (!bearer(TOK.msAccess)) return send(401, { error: { message: "InvalidAuthenticationToken" } });
      const pick = FIXTURES.filter((f) => ["g-claude-max", "g-elevenlabs", "g-fail"].includes(f.id));
      return send(200, { value: pick.map((f) => ({ id: `ms-${f.id}`, subject: f.subject, from: { emailAddress: { name: f.from.replace(/<.*$/, "").trim(), address: f.from.match(/<([^>]+)>/)[1] } }, receivedDateTime: new Date(f.date).toISOString(), body: f.html ? { contentType: "html", content: f.html } : { contentType: "text", content: f.text }, webLink: `https://outlook.office365.com/owa/?ItemID=${f.id}&exvsurl=1&viewmodel=ReadMessageItem` })) });
    }
    send(404, { error: { message: `mock: no route ${p}` } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, hits, st, close: () => new Promise((r) => server.close(r)) };
}

function seedData(dir) {
  const now = Date.now(), old = now - 90 * DAY;
  const subs = [
    { id: "claude", provider: "anthropic", name: "Claude", plan: "Max 5x", price: 100, cycle: "monthly", monthly: 100, renews: null, unit: "messages", addedAt: old },
    { id: "chatgpt", provider: "openai", name: "ChatGPT", plan: "Plus", price: 20, cycle: "monthly", monthly: 20, renews: null, unit: "messages", addedAt: old },
    { id: "chatgpt-pro", provider: "openai", vendor: "openai", name: "ChatGPT Pro", price: 200, cycle: "monthly", monthly: 200, renews: null, addedAt: old },
    { id: "grok", provider: "xai", name: "Grok", plan: "SuperGrok", price: 30, cycle: "monthly", monthly: 30, renews: localDay(now + 2 * DAY), remindDays: 3, addedAt: old },
    { id: "kling", provider: "kling", name: "Kling AI", price: 10, cycle: "monthly", monthly: 10, renews: localDay(now + 2 * DAY), remindDays: 1, addedAt: now - 5 * DAY },
    { id: "hedra", provider: "hedra", name: "Hedra", price: 10, cycle: "monthly", monthly: 10, renews: "2025-01-15", addedAt: now - 5 * DAY },
  ];
  fs.writeFileSync(path.join(dir, "subscriptions.json"), JSON.stringify(subs));
  const lines = [
    { ts: now - 60000, kind: "call", provider: "xai", model: "grok-4.7", inTok: 10, outTok: 10, cost: 4.5, exact: true },
    { ts: now - 120000, kind: "call", provider: "openai", model: "gpt-x", inTok: 10, outTok: 10, cost: 0.01, exact: true },
  ];
  fs.writeFileSync(path.join(dir, "ledger.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

test("services page against mock APIs and mailboxes: live balances, admin keys, caps, mail scan, confirm, reminders, totals, hints", { timeout: 120000 }, async () => {
  const m = await mocks();
  const s = await startServer({
    seed: seedData,
    env: {
      CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
      CC_BASE_URL_OPENROUTER: `${m.base}/or/v1`, CC_BASE_URL_DEEPSEEK: `${m.base}/ds`, CC_BASE_URL_OPENAI: `${m.base}/openai/v1`, CC_BASE_URL_ANTHROPIC: `${m.base}/anthropic`,
      CC_GOOGLE_AUTH_URL: `${m.base}/gauth`, CC_GOOGLE_TOKEN_URL: `${m.base}/gtoken`, CC_GMAIL_API_URL: `${m.base}/gmail`, CC_MS_LOGIN_URL: `${m.base}/ms`, CC_GRAPH_API_URL: `${m.base}/graph`,
    },
  });
  const all = [];
  const api = async (p, o) => { const r = await s.api(p, o); all.push(r.text); return r; };
  try {
    // ---- (a) API providers ----
    for (const pid of ["openrouter", "deepseek"]) assert.equal((await api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).status, 200, pid);
    assert.equal((await api("/alerts/caps", { method: "POST", body: { caps: { xai: 5, openrouter: 5 } } })).status, 200);
    let v = (await api("/services/refresh", { method: "POST", body: {} })).json;
    const row = (pid) => v.apis.find((r) => r.provider === pid);
    assert.equal(row("openrouter").credits.value, 1.4); assert.equal(row("openrouter").credits.total, 50); assert.equal(row("openrouter").credits.source, "api");
    assert.equal(row("openrouter").mtd.value, 4.25); assert.equal(row("openrouter").mtd.source, "api");
    assert.equal(row("openrouter").level, "amber"); assert.ok(row("openrouter").why.some((w) => /low balance/.test(w)));
    assert.ok(row("openrouter").why.some((w) => /85% of the cap when spend outside this app/.test(w)), "API month-to-date counts against the cap too");
    assert.equal(row("deepseek").credits.value, 0); assert.equal(row("deepseek").level, "red"); assert.equal(row("deepseek").mtd.source, "ledger");
    assert.equal(row("xai").mtd.source, "ledger"); assert.equal(row("xai").mtd.value, 4.5); assert.equal(row("xai").capPct, 90); assert.equal(row("xai").level, "amber"); assert.match(row("xai").noLive, /ledger/);
    assert.match(row("xai").mtd.label, /auto-detected: this app's ledger/);
    assert.equal(row("openai").mtd.source, "ledger", "no admin key yet: OpenAI falls back to the ledger");
    // optional admin keys: a regular key is refused with advice, a bad admin key is never kept, a good one is
    let r = await api("/services/admin-key", { method: "POST", body: { provider: "openai", key: "sk-proj-abcdefabcdefabcdef" } });
    assert.equal(r.status, 400); assert.match(r.json.error, /regular API key/);
    r = await api("/services/admin-key", { method: "POST", body: { provider: "openai", key: KEYS.openaiAdminBad } });
    assert.equal(r.json.kept, false); assert.equal(r.json.label, "Key rejected"); assert.equal(r.json.view.admin.openai.keyed, false);
    r = await api("/services/admin-key", { method: "POST", body: { provider: "openai", key: KEYS.openaiAdmin } });
    assert.equal(r.json.kept, true, JSON.stringify(r.json)); assert.match(r.json.masked, /^sk-a…/);
    r = await api("/services/admin-key", { method: "POST", body: { provider: "anthropic", key: KEYS.anthropicAdmin } });
    assert.equal(r.json.kept, true);
    v = (await api("/services/refresh", { method: "POST", body: {} })).json;
    assert.equal(row("openai").mtd.value, 4.5, "two pages of cost buckets"); assert.equal(row("openai").mtd.source, "api"); assert.equal(row("openai").inTok, 1000);
    assert.equal(row("anthropic").mtd.value, 12.345, "cents to dollars"); assert.equal(row("anthropic").inTok, 17); assert.equal(row("anthropic").outTok, 7);
    assert.equal(v.admin.openai.keyed, true); assert.equal(v.admin.anthropic.keyed, true);

    // ---- totals and hints ----
    const t = v.totals;
    assert.equal(t.subscriptions, 370); // 100 + 20 + 200 + 30 + 10 + 10
    assert.ok(Math.abs(t.api - (4.25 + 0 + 4.5 + 4.5 + 12.345)) < 0.02, `api total ${t.api}`);
    assert.ok(Math.abs(t.monthToDate - (t.subscriptions + t.metered)) < 0.02);
    assert.ok(t.monthEstimate >= t.monthToDate);
    const dup = v.hints.find((h) => h.kind === "duplicate"); assert.deepEqual(dup.ids.sort(), ["chatgpt", "chatgpt-pro"]);
    assert.deepEqual(v.hints.filter((h) => h.kind === "unused").map((h) => h.ids[0]), ["claude"]);
    const hedra = v.subscriptions.find((x) => x.id === "hedra");
    assert.equal(hedra.renewsRolled, true); assert.ok(hedra.nextRenewal >= localDay(Date.now()), "a past renewal rolls forward by its cycle");

    // ---- (c) reminders: per row lead time, once per renewal date ----
    r = await api("/services/sweep", { method: "POST", body: {} });
    const sentNow = r.json.sent.map((x) => x.id);
    const sentAll = new Set([...sentNow, ...r.json.view.reminders.sent.map((x) => x.id)]); // the startup sweep may have sent it first
    assert.ok(sentAll.has("grok"), "Grok renews in 2 days with a 3-day reminder");
    assert.ok(!sentAll.has("kling"), "Kling renews in 2 days but wants 1 day of notice");
    assert.equal((await api("/services/sweep", { method: "POST", body: {} })).json.sent.length, 0, "no second reminder for the same renewal");
    assert.equal(v.subscriptions.find((x) => x.id === "grok").signal, "renewing");

    // ---- manual add and edit, labelled "you entered" ----
    r = await api("/services/subscriptions", { method: "POST", body: { name: "Runway", plan: "Standard", price: 144, cycle: "yearly", renews: localDay(Date.now() + 40 * DAY), remindDays: 7, origin: { price: "email" } } });
    assert.equal(r.status, 200); assert.equal(r.json.saved.monthly, 12); assert.equal(r.json.saved.origin.price, "user", "origin cannot be set from the request"); assert.equal(r.json.saved.remindDays, 7);
    assert.equal((await api("/services/subscriptions", { method: "POST", body: { name: "Bad", renews: "next week" } })).status, 400);
    assert.equal((await api("/services/subscriptions", { method: "POST", body: { name: "Bad", remindDays: 99 } })).status, 400);

    // ---- (b) Gmail: read-only OAuth with PKCE, scan, confirm or edit ----
    r = await api("/services/mail/start", { method: "POST", body: { source: "gmail", origin: s.base } });
    assert.equal(r.status, 400); assert.equal(r.json.code, "client_id");
    assert.equal((await api("/services/mail/client", { method: "POST", body: { source: "gmail", clientId: "1234-fake.apps.googleusercontent.com", clientSecret: TOK.gSecret } })).json.gmail.hasClientSecret, true);
    r = await api("/services/mail/start", { method: "POST", body: { source: "gmail", origin: s.base } });
    const auth = new URL(r.json.url);
    assert.equal(auth.origin + auth.pathname, `${m.base}/gauth/o/oauth2/v2/auth`);
    assert.equal(auth.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256"); assert.ok(auth.searchParams.get("code_challenge"));
    assert.equal(auth.searchParams.get("redirect_uri"), `${s.base}/`); assert.equal(auth.searchParams.get("access_type"), "offline");
    assert.equal((await api("/services/mail/finish", { method: "POST", body: { code: "good-code", state: "mail-wrong" } })).status, 400, "unknown state");
    r = await api("/services/mail/finish", { method: "POST", body: { code: "good-code", state: auth.searchParams.get("state") } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.mail.gmail.connected, true);
    r = await api("/services/mail/scan", { method: "POST", body: { source: "gmail" } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.scanned, FIXTURES.length); assert.equal(r.json.found, FIXTURES.length - 2); assert.equal(r.json.failed.length, 2);
    for (const f of r.json.failed) { assert.match(f.link, /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\//); assert.ok(f.reason); }
    const cands = r.json.candidates;
    const low = cands.find((c) => c.messageId === "g-low"); assert.equal(low.low, true); assert.ok(low.confidence < 0.6);
    const claude = cands.find((c) => c.messageId === "g-claude-max");
    assert.equal(claude.matches.id, "claude", "matched to the existing Claude row"); assert.equal(claude.plan, "Claude Max 20x"); assert.ok(claude.fields.price.conf > 0.8);
    assert.match(claude.link, /#all\/g-claude-max$/);
    for (const c of cands) { assert.equal(c.subject, undefined); assert.equal(c.text, undefined); assert.equal(c.html, undefined); }
    // confirm Claude with one edit: plan from email, price changed by the person
    r = await api(`/services/pending/${claude.id}/confirm`, { method: "POST", body: { edits: { price: 180, plan: "Claude Max 20x" } } });
    assert.equal(r.status, 200, r.text);
    const saved = r.json.saved;
    assert.equal(saved.id, "claude"); assert.equal(saved.price, 180); assert.equal(saved.origin.price, "user"); assert.equal(saved.origin.plan, "email"); assert.ok(saved.confidence.plan > 0.8);
    assert.equal(saved.origin.renews, "email"); assert.equal(saved.renews, "2026-11-30"); assert.equal(saved.source.kind, "email"); assert.equal(saved.source.messageId, "g-claude-max");
    assert.equal(saved.confidence.price, undefined, "an edited value has no confidence: the person entered it");
    // confirm Midjourney as a new row; dismiss the low-confidence one
    const mj = cands.find((c) => c.messageId === "g-midjourney");
    r = await api(`/services/pending/${mj.id}/confirm`, { method: "POST", body: {} });
    assert.equal(r.json.saved.name, "Midjourney"); assert.equal(r.json.saved.cycle, "yearly"); assert.equal(r.json.saved.monthly, 48); assert.equal(r.json.saved.origin.price, "email");
    assert.equal((await api(`/services/pending/${low.id}/dismiss`, { method: "POST", body: {} })).status, 200);
    assert.equal((await api(`/services/pending/${low.id}/confirm`, { method: "POST", body: {} })).status, 404);
    // a rescan never brings back what was confirmed, dismissed or is still pending
    r = await api("/services/mail/scan", { method: "POST", body: { source: "gmail" } });
    assert.equal(r.json.found, 0); assert.equal(r.json.skipped, FIXTURES.length - 2);
    // the access token expires: the next call refreshes it with the refresh token
    m.st.gExpiresIn = 30;
    let a2 = new URL((await api("/services/mail/start", { method: "POST", body: { source: "gmail", origin: s.base } })).json.url);
    assert.equal((await api("/services/mail/finish", { method: "POST", body: { code: "good-code", state: a2.searchParams.get("state") } })).status, 200);
    r = await api("/services/mail/scan", { method: "POST", body: { source: "gmail" } });
    assert.equal(r.status, 200, r.text);
    assert.ok(m.hits.some((h) => h.path === "/gtoken/token" && /grant_type=refresh_token/.test(h.body)), "refresh grant used");
    // Gmail refuses the token: the page says sign in again
    m.st.gmail401 = true;
    r = await api("/services/mail/scan", { method: "POST", body: { source: "gmail" } });
    assert.equal(r.status, 409, "not 401, which would sign the person out of a hosted hub"); assert.equal(r.json.code, "sign_in"); assert.match(r.json.error, /Connect it again/);
    assert.equal((await api("/services")).json.mail.gmail.needsSignIn, true);
    m.st.gmail401 = false;

    // ---- (b) Outlook ----
    await api("/services/mail/client", { method: "POST", body: { source: "outlook", clientId: "00000000-0000-0000-0000-000000000000" } });
    r = await api("/services/mail/start", { method: "POST", body: { source: "outlook", origin: s.base } });
    const ms = new URL(r.json.url);
    assert.equal(ms.searchParams.get("scope"), "https://graph.microsoft.com/Mail.Read offline_access");
    assert.equal((await api("/services/mail/finish", { method: "POST", body: { code: "ms-code", state: ms.searchParams.get("state") } })).status, 200);
    r = await api("/services/mail/scan", { method: "POST", body: { source: "outlook" } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.found, 2); assert.equal(r.json.failed.length, 1);
    const eleven = r.json.candidates.find((c) => c.messageId === "ms-g-elevenlabs");
    assert.equal(eleven.plan, "Creator"); assert.match(eleven.link, /^https:\/\/outlook\.office365\.com\/owa\/\?ItemID=/);
    // disconnect removes the tokens from the vault
    assert.equal((await api("/services/mail/outlook", { method: "DELETE" })).json.outlook.connected, false);

    // ---- demo samples work with no mailbox at all ----
    r = await api("/services/mail/scan", { method: "POST", body: { source: "demo" } });
    assert.equal(r.status, 200); assert.equal(r.json.found, 3); assert.equal(r.json.candidates.find((c) => c.messageId === "demo-render").low, true);

    // ---- mail APIs were only ever read: GET only, with the bearer token ----
    const mailHits = m.hits.filter((h) => h.path.startsWith("/gmail/") || h.path.startsWith("/graph/"));
    assert.ok(mailHits.length > 5);
    for (const h of mailHits) { assert.equal(h.method, "GET", h.path); assert.match(h.auth || "", /^Bearer /); }
    assert.ok(!m.hits.some((h) => /\/(send|modify|trash|delete)/i.test(h.path)));

    // ---- nothing but extracted fields and message ids on disk; no secret anywhere ----
    const files = fs.readdirSync(s.dir).filter((f) => f.endsWith(".json") || f.endsWith(".jsonl"));
    const disk = files.map((f) => fs.readFileSync(path.join(s.dir, f), "utf8")).join("\n");
    assert.match(disk, /g-claude-max/, "the message id is kept");
    for (const f of FIXTURES) { assert.ok(!disk.includes(`FIXTURE-BODY-MARKER-${f.id.slice(2).toUpperCase()}`) && !disk.includes(f.text?.slice(0, 30) || "\u0000"), `${f.id} body not stored`); assert.ok(!disk.includes(f.subject), `${f.id} subject not stored`); }
    assert.ok(!/FIXTURE-BODY-MARKER/.test(disk));
    for (const sec of SECRETS) { assert.ok(!disk.includes(sec), "secret on disk outside the vault"); for (const t2 of all) assert.ok(!t2.includes(sec), "secret in a response"); assert.ok(!s.log.includes(sec), "secret in the log"); }
  } finally { await s.stop(); await m.close(); }
});

test("Free tier: the page is locked and every change is refused with the Pro message", { timeout: 60000 }, async () => {
  const s = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    assert.deepEqual((await s.api("/services")).json, { locked: true });
    for (const [p, body] of [["/services/refresh", {}], ["/services/mail/scan", { source: "demo" }], ["/services/subscriptions", { name: "x" }]]) assert.equal((await s.api(p, { method: "POST", body })).status, 402, p);
  } finally { await s.stop(); }
});
