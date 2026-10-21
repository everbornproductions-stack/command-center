// Auto-detected subscriptions from the email scan. High-confidence receipts from known AI services
// (sender domain + amount + plan name or renewal date) add a row with no confirm step, labelled
// auto-detected; vague ones stay suggestions. A rescan keeps auto rows current but never overwrites a
// field the person edited; Undo removes a row and the next scan does not add it back; one row per service.
// Mail is a local Gmail mock with fake messages; no real inbox, key or URL is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer, tmpDir, ROOT } from "./helpers.js";

createRequire(import.meta.url)("./vault-shim.cjs"); // test-only stand-in for the OS keychain, so the in-process vault can hold a fake token
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-subs-auto-");
const R = await import("../server/receipts.js");
const SV = await import("../server/services.js");
const SUB = await import("../server/subscriptions.js");
const { setSecret } = await import("../server/vault.js");
const { putDoc, newContext, FileStore, setDefaultContext } = await import("../server/store.js");
const local = newContext("local", new FileStore(process.env.CC_DATA_DIR)); // the local single-user context, as the server sets it up
await local.store.loadAll(local);
setDefaultContext(local);

const DAY = 86400000;
const msg = (id, from, subject, date, text) => ({ id, from, subject, date, text });
const OPENAI_OCT = msg("m-openai-oct", "OpenAI <noreply@tm.openai.com>", "Your ChatGPT Plus receipt", "Tue, 14 Oct 2026 09:00:00 +0000", "ChatGPT Plus subscription\nTotal charged: $20.00 per month\nYour plan renews on 2026-11-14.");
const OPENAI_SEP = msg("m-openai-sep", "OpenAI <noreply@tm.openai.com>", "Your ChatGPT Plus receipt", "Sun, 14 Sep 2026 09:00:00 +0000", "ChatGPT Plus subscription\nTotal charged: $20.00 per month\nYour plan renews on 2026-10-14.");
const CLAUDE_OCT = msg("m-claude-oct", "Anthropic <invoice@mail.anthropic.com>", "Your receipt from Anthropic", "Fri, 10 Oct 2026 12:00:00 +0000", "Claude Pro plan\nAmount paid $20.00 monthly\nNext billing date: November 10, 2026");
const MJ_OCT = msg("m-mj-oct", "Midjourney <billing@midjourney.com>", "Midjourney invoice", "Sun, 05 Oct 2026 10:00:00 +0000", "Standard Plan\nAmount paid $30.00\nBilled monthly.");
const VAGUE = msg("m-vague", "Billing <billing@somecloud.example>", "Payment received", "Mon, 06 Oct 2026 10:00:00 +0000", "We received your payment of $12.00. Thank you.");
const FORWARD = msg("m-forward", "Sam <sam@friends.example>", "Fwd: ChatGPT Plus receipt", "Mon, 06 Oct 2026 11:00:00 +0000", "Look at this. ChatGPT Plus, total $20.00 a month.");
// next month: prices and renewal dates move
const OPENAI_NOV = msg("m-openai-nov", "OpenAI <noreply@tm.openai.com>", "Your ChatGPT Plus receipt", "Fri, 14 Nov 2026 09:00:00 +0000", "ChatGPT Plus subscription\nTotal charged: $25.00 per month\nYour plan renews on 2026-12-14.");
const CLAUDE_NOV = msg("m-claude-nov", "Anthropic <invoice@mail.anthropic.com>", "Your receipt from Anthropic", "Mon, 10 Nov 2026 12:00:00 +0000", "Claude Pro plan\nAmount paid $22.00 monthly\nNext billing date: December 10, 2026");
const MJ_NOV = msg("m-mj-nov", "Midjourney <billing@midjourney.com>", "Midjourney invoice", "Wed, 05 Nov 2026 10:00:00 +0000", "Standard Plan\nAmount paid $30.00\nBilled monthly.");

function gmailMessage(f) {
  return { id: f.id, threadId: f.id, payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: f.from }, { name: "Subject", value: f.subject }, { name: "Date", value: f.date }], parts: [{ mimeType: "text/plain", body: { data: Buffer.from(f.text, "utf8").toString("base64url") } }] } };
}
async function gmailMock(inbox) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    hits.push({ method: req.method, path: u.pathname });
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== "Bearer ya29.FAKE-AUTO-TOKEN") return send(401, { error: { message: "Invalid Credentials" } });
    const id = decodeURIComponent(u.pathname.split("/").pop());
    if (id === "messages") return send(200, { messages: inbox.map((m) => ({ id: m.id, threadId: m.id })) });
    const f = inbox.find((m) => m.id === id);
    return f ? send(200, gmailMessage(f)) : send(404, { error: { message: "not found" } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) };
}
const rows = () => SUB.loadSubscriptions();
const row = (id) => rows().find((s) => s.id === id);

test("confidence: known vendor domain + amount + plan or renewal is high; vague or name-only is not", () => {
  for (const m of [OPENAI_OCT, CLAUDE_OCT, MJ_OCT]) { const r = R.parseReceipt(m); assert.equal(r.high, true, m.id); assert.ok(r.confidence >= R.HIGH_CONFIDENCE, m.id); }
  assert.equal(R.parseReceipt(VAGUE).high, false);
  assert.equal(R.parseReceipt(FORWARD).high, false, "a product name without the vendor's sender domain stays a suggestion");
  assert.equal(R.parseReceipt({ ...OPENAI_OCT, text: "Total charged: $20.00" }).high, false, "no plan and no renewal date");
  assert.equal(R.isHighConfidence({ ok: true, serviceId: "chatgpt", price: null, confidence: 0.9, fields: { service: { conf: 0.95 }, plan: { conf: 0.85 } } }), false, "no amount");
});

test("scan auto-adds high-confidence rows, keeps vague ones as suggestions, updates on rescan, respects edits and undo, no duplicates", { timeout: 60000 }, async () => {
  const inbox = [OPENAI_OCT, CLAUDE_OCT, MJ_OCT, OPENAI_SEP, VAGUE, FORWARD]; // newest first, like Gmail
  const m = await gmailMock(inbox);
  process.env.CC_GMAIL_API_URL = `${m.base}/gmail`;
  try {
    await setSecret("mail-gmail", { key: "oauth", access: "ya29.FAKE-AUTO-TOKEN", expiresAt: Date.now() + 3600 * 1000 });
    putDoc("subscriptions", []);

    // ---- first scan ----
    let r = await SV.scanMail("gmail", { subs: SUB.subscriptionView() });
    assert.deepEqual(r.added.map((x) => x.id).sort(), ["chatgpt", "claude", "midjourney"]);
    for (const id of ["chatgpt", "claude", "midjourney"]) {
      const s = row(id);
      assert.equal(s.autoDetected, true, id); assert.equal(s.edited, undefined, id);
      assert.equal(s.origin.price, "email", id); assert.ok(s.confidence.price > 0.8, id);
      assert.equal(s.source.kind, "email"); assert.equal(s.source.auto, true);
    }
    assert.equal(row("chatgpt").price, 20); assert.equal(row("chatgpt").renews, "2026-11-14", "the older September receipt did not replace October");
    assert.equal(row("chatgpt").plan, "ChatGPT Plus");
    assert.equal(row("claude").plan, "Claude Pro"); assert.equal(row("claude").renews, "2026-11-10");
    assert.equal(row("midjourney").price, 30);
    // vague and name-only messages wait for a click
    assert.equal(r.found, 2);
    const vague = r.candidates.find((c) => c.messageId === "m-vague"); assert.equal(vague.low, true); assert.equal(vague.high, false);
    const fwd = r.candidates.find((c) => c.messageId === "m-forward"); assert.equal(fwd.high, false); assert.equal(fwd.matches.id, "chatgpt");
    assert.equal(rows().length, 3, "only the three high-confidence services became rows");
    // no duplicates: two OpenAI receipts, one row
    assert.equal(rows().filter((s) => s.vendor === "openai").length, 1);

    // ---- the person edits Claude's price by hand ----
    const edited = SUB.saveSubscription({ id: "claude", price: 18 });
    assert.equal(edited.edited, true); assert.equal(edited.origin.price, "user"); assert.equal(edited.autoDetected, true);
    // a request body cannot set or clear the flags
    SUB.saveSubscription({ id: "chatgpt", autoDetected: false, edited: true });
    assert.equal(row("chatgpt").autoDetected, true); assert.equal(row("chatgpt").edited, undefined);

    // ---- Undo Midjourney: gone, and remembered ----
    assert.throws(() => SV.undoAutoRow("nope"), /gone/);
    const u = SV.undoAutoRow("midjourney");
    assert.equal(u.removed, true); assert.equal(row("midjourney"), undefined);
    assert.deepEqual(SV.mailView().autoDismissed, ["midjourney"]);

    // ---- next month: the periodic rescan ----
    inbox.unshift(OPENAI_NOV, CLAUDE_NOV, MJ_NOV);
    const out = await SV.rescanConnected();
    assert.equal(out.length, 1); assert.equal(out[0].ok, true, out[0].error);
    assert.equal(row("chatgpt").price, 25, "auto row: price updated"); assert.equal(row("chatgpt").renews, "2026-12-14", "auto row: renewal updated");
    assert.equal(row("chatgpt").origin.price, "email"); assert.equal(row("chatgpt").source.messageId, "m-openai-nov");
    assert.equal(row("claude").price, 18, "user-edited price is kept"); assert.equal(row("claude").origin.price, "user");
    assert.equal(row("claude").renews, "2026-12-10", "the renewal the person did not touch still updates");
    assert.equal(row("claude").edited, true);
    assert.equal(row("midjourney"), undefined, "undo is remembered: the rescan does not add it back");
    assert.ok(!SV.mailView().pending.some((c) => c.serviceId === "midjourney"), "nor as a suggestion");
    assert.equal(rows().length, 2); assert.equal(rows().filter((s) => s.vendor === "openai").length, 1);
    assert.ok(SV.mailView().autoRescanAt > 0);

    // a second rescan with nothing new changes nothing and adds nothing
    const again = await SV.rescanConnected();
    assert.equal(again[0].added, 0); assert.equal(again[0].updated, 0); assert.equal(again[0].found, 0);

    // ---- Remove on an auto row is remembered too; a fresh install's blank seed row is filled, not duplicated ----
    SV.removeSubscription("chatgpt");
    putDoc("services.mail", { gmail: {}, outlook: {}, pending: [], seen: {}, autoDismissed: {} });
    putDoc("subscriptions", [{ id: "claude", provider: "anthropic", name: "Claude", plan: "UNKNOWN", monthly: null, renews: null }, { id: "chatgpt-pro", provider: "openai", vendor: "openai", name: "ChatGPT Pro", plan: "Pro", price: 200, cycle: "monthly", monthly: 200 }]);
    r = await SV.scanMail("gmail", { subs: SUB.subscriptionView() });
    assert.equal(rows().filter((s) => s.vendor === "anthropic" || s.provider === "anthropic").length, 1, "the blank Claude row was adopted");
    assert.equal(row("claude").autoDetected, true); assert.equal(row("claude").price, 22);
    assert.equal(row("chatgpt-pro").price, 200, "a row the person filled in is never overwritten");
    assert.equal(row("chatgpt-pro").autoDetected, undefined);
    assert.ok(r.candidates.some((c) => c.serviceId === "chatgpt" && c.matches?.id === "chatgpt-pro"), "its receipt is a suggestion instead");
    assert.equal(rows().filter((s) => s.vendor === "openai").length, 1, "no second OpenAI row");
    assert.ok(row("midjourney")?.autoDetected, "Midjourney is back only because the dismissal list was cleared");

    // mail was only read
    for (const h of m.hits) assert.equal(h.method, "GET");
  } finally { delete process.env.CC_GMAIL_API_URL; await m.close(); }
});

test("Pro gate, Undo route and the daily rescan job on the shared scheduler", { timeout: 60000 }, async () => {
  const free = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    assert.equal((await free.api("/services/subscriptions/claude/undo", { method: "POST", body: {} })).status, 402, "Free: locked");
  } finally { await free.stop(); }
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  try {
    // sample emails never add rows on their own
    let r = await s.api("/services/mail/scan", { method: "POST", body: { source: "demo" } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.added.length, 0); assert.equal(r.json.found, 3);
    // Undo only applies to auto-detected rows
    r = await s.api("/services/subscriptions/claude/undo", { method: "POST", body: {} });
    assert.equal(r.status, 400); assert.match(r.json.error, /Only auto-detected rows/);
    // the rescan is one job on the shared scheduler: daily, paused while idle
    const perf = await s.api("/perf");
    const job = perf.json.jobs.find((j) => j.id === "subscriptions-rescan");
    assert.ok(job, "subscriptions-rescan registered"); assert.equal(job.everyMs, 24 * 3600 * 1000); assert.equal(job.pause, true);
  } finally { await s.stop(); }
});

test("UI: auto-detected label with Undo, Remove and Edit; no em-dashes", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "features", "services.js"), "utf8");
  assert.match(src, />auto-detected<\/span>/);
  assert.match(src, /data-auto-label/);
  assert.match(src, /data-undo[^>]*>Undo<\/button>/);
  assert.match(src, /data-edit[^>]*>Edit<\/button>/);
  assert.match(src, /data-del[^>]*>Remove<\/button>/);
  assert.match(src, /\/services\/subscriptions\/\$\{encodeURIComponent\(id\)\}\/undo/);
  assert.match(src, /data-lock/, "detected fields stay read-only until Edit");
  for (const f of ["web/features/services.js", "server/services.js", "server/receipts.js", "server/subscriptions.js", "server/plugins/services.js", "test/subscriptions-auto.test.js"]) assert.equal(fs.readFileSync(path.join(ROOT, f), "utf8").includes(String.fromCharCode(0x2014)), false, f);
});
