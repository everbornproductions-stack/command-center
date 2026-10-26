// Guided builders B. Detection, tier gates, and the five steps.
// External APIs are local mocks. No real key, no data/ read, nothing posts before Publish.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, freePort, ROOT } from "./helpers.js";
import { register, get, detect } from "../server/builders/registry.js";
import "../server/builders/catalog.js";
import { builderGate } from "../server/feature-gate.js";
import {
  TAX_LINE, LEGAL_LINE, quietHoursOk, cleanInput, fingerprint, makeDraft, missingChecks, needsRemote, pendingRecipients, parseReceipt, parseInvoice,
} from "../server/builders/drafts.js";
import { xeroInvoicePayload, qboBillPayload } from "../server/builders/adapters.js";

const EM = "\u2014";
const TOKEN = "fixture-not-a-real-key";
const SSN = "123-45-6789";
const CHECKS = { tcpa: true, stop: true, quiet: true, a2p: true, canspam: true, croa: true, notLegal: true };
const ids = (rows) => rows.map((r) => r.id).sort();

test("registry keeps the shared register shape, and a sibling builder can sit beside these", () => {
  assert.equal(typeof register, "function");
  register({ id: "sibling-a", title: "From the other branch", tier: "free", detect: (ctx) => (ctx?.text === "sibling-only" ? { why: "replaced" } : false) });
  assert.equal(get("sibling-a").title, "From the other branch");
  assert.equal(get("sibling-a").detect({ text: "" }), false);
  register({ id: "sibling-a", title: "Replaced", tier: "pro", detect: (ctx) => (ctx?.text === "sibling-only" ? { why: "replaced" } : false) });
  assert.equal(detect({ text: "sibling-only" }).find((b) => b.id === "sibling-a").why, "replaced");
  assert.equal(detect({ text: "sibling-only" }).find((b) => b.id === "sibling-a").tier, "pro");
  assert.equal(detect({ text: "" }).some((b) => b.id === "sibling-a"), false);
});

test("builders appear only when the need is detected", () => {
  assert.deepEqual(ids(detect({ text: "", connected: {} })), []);
  assert.deepEqual(ids(detect({ text: "pipeline and workflow", connected: {} })), []);
  const hl = ids(detect({ text: "Set up HighLevel for me" }));
  assert.deepEqual(hl, ["hl-campaign", "hl-funnel", "hl-lead", "hl-pipeline", "hl-workflows"]);
  assert.equal(detect({ text: "ghl" }).length, 5);
  assert.equal(detect({ connected: { highlevel: true } }).every((b) => b.group === "highlevel"), true);
  const acct = ids(detect({ text: "I have a pile of receipts and one invoice" }));
  assert.deepEqual(acct, ["acct-invoice-make", "acct-invoice-read", "acct-qbo", "acct-receipt", "acct-xero"]);
  assert.equal(detect({ connected: { quickbooks: true } }).every((b) => b.group === "accounting"), true);
  assert.equal(detect({ connected: { xero: true } }).every((b) => b.group === "accounting"), true);
  assert.deepEqual(ids(detect({ text: "I need a booking page" })), ["biz-booking"]);
  assert.deepEqual(ids(detect({ text: "meeting notes from today" })), ["biz-notes"]);
  assert.deepEqual(ids(detect({ text: "add a website chat" })), ["biz-chat"]);
  assert.deepEqual(ids(detect({ text: "send the contract" })), ["biz-contract"]);
  assert.deepEqual(ids(detect({ text: "reply to a google review" })), ["biz-review"]);
  assert.equal(detect({ text: "just chatting", connected: { chatwoot: true } }).some((b) => b.id === "biz-chat"), false);
});

test("gates: Free, Pro, Studio, Extreme, Owner", () => {
  assert.equal(builderGate({ tier: "free", need: "free" }).ok, true);
  assert.equal(builderGate({ tier: "free", need: "pro" }).code, "pro_required");
  assert.equal(builderGate({ tier: "free", need: "extreme" }).code, "extreme_required");
  assert.equal(builderGate({ tier: "pro", need: "pro" }).ok, true);
  assert.equal(builderGate({ tier: "pro", need: "extreme" }).code, "extreme_required");
  assert.equal(builderGate({ tier: "studio", need: "pro" }).ok, true);
  assert.equal(builderGate({ tier: "studio", need: "extreme" }).ok, false);
  assert.equal(builderGate({ tier: "extreme", need: "extreme" }).ok, true);
  assert.equal(builderGate({ tier: "owner", need: "extreme" }).ok, true);
  for (const g of [builderGate({ tier: "free", need: "pro" }), builderGate({ tier: "pro", need: "extreme" }), builderGate({ tier: "owner", need: "free" })]) {
    assert.equal(g.message.includes(EM), false);
    assert.equal(/\$|Stripe/.test(g.message), false);
  }
});

test("drafts organize money, refuse tax advice, and hold sends", () => {
  assert.equal(quietHoursOk("10:00"), true);
  assert.equal(quietHoursOk("07:59"), false);
  assert.equal(quietHoursOk("21:00"), false);
  assert.equal(parseReceipt("North Bakery\n2026-10-21\nTotal $12.40").total, "12.40");
  assert.equal(parseInvoice("From: North Bakery\nInvoice INV-14\nTotal $40.00").number, "INV-14");
  const tax = makeDraft("acct-qbo", cleanInput({ text: "Is this deductible? North Bakery Total $12.40" }).input);
  assert.equal(tax.taxBlocked, true);
  assert.equal(tax.line, TAX_LINE);
  assert.equal(tax.merchant, "North Bakery");
  const campaign = makeDraft("hl-campaign", cleanInput({ text: `Your credit score will jump. SSN ${SSN}`, channel: "sms", sendTime: "10:00" }).input);
  assert.equal(campaign.message.includes(SSN), false);
  assert.match(campaign.message, /Credit repair note:/);
  assert.match(campaign.message, /STOP/);
  assert.equal(missingChecks("hl-campaign", { text: "credit score" }, { tcpa: true, stop: true, quiet: true, a2p: true, canspam: true }).some((c) => c.id === "croa"), true);
  assert.equal(makeDraft("biz-contract", cleanInput({ text: "write me a contract that is binding" }).input).legalBlocked, true);
  const xero = xeroInvoicePayload({ merchant: "North Bakery", date: "2026-10-21", total: "12.40" });
  assert.equal(xero.Invoices[0].Status, "DRAFT");
  assert.equal(xero.Invoices[0].Type, "ACCPAY");
  assert.equal(xero.Invoices[0].LineItems[0].UnitAmount, 12.4);
  const bill = qboBillPayload({ merchant: "North Bakery", total: "12.40" });
  assert.equal(bill.Line[0].Amount, 12.4);
  assert.equal(bill.Payment, undefined);
  assert.deepEqual(pendingRecipients(["a", "b"], ["a"]), ["b"]);
  assert.equal(needsRemote("biz-review", {}), false);
  assert.equal(needsRemote("acct-invoice-make", { invoiceNinja: false }), false);
  assert.equal(needsRemote("acct-invoice-make", { invoiceNinja: true }), true);
  const a = fingerprint(cleanInput({ text: "one" }).input);
  const b = fingerprint(cleanInput({ text: "two" }).input);
  assert.notEqual(a, b);
  assert.equal(LEGAL_LINE.includes("not legal advice"), true);
});

test("user-facing builder text has no em dash", () => {
  const files = [
    "server/builders/registry.js", "server/builders/catalog.js", "server/builders/drafts.js", "server/builders/adapters.js",
    "server/plugins/builders.js", "server/feature-gate.js", "web/features/builders.js", "docs/help/builders.md",
  ];
  for (const file of files) assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes(EM), false, file);
  assert.match(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version, /^\d+\.\d+\.\d+$/);
  const plan = fs.readFileSync(path.join(ROOT, "docs/BUILD-PLAN.md"), "utf8");
  assert.match(plan, /Phase 97/);
  assert.match(plan, /register\(\{ id, title, tier, detect\(ctx\) \}\)/);
});

test("publish waits for a click, and mocks never see a call before that", async () => {
  const hits = [];
  const port = await freePort();
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      hits.push({ method: req.method, path: url.pathname, headers: req.headers, body });
      const send = (obj) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (url.pathname === "/ocr") return send({ merchant: "North Bakery", date: "2026-10-21", total: "12.40" });
      if (url.pathname === "/invoice2data") return send({ from: "North Bakery", number: "INV-14", date: "2026-10-21", total: "40.00" });
      if (url.pathname === "/whisper") return send({ text: "We picked the menu.\nAction: send the price list" });
      if (url.pathname === "/opportunities/search") return send({ opportunities: [{ id: "o1" }, { id: "o2" }] });
      if (url.pathname === "/contacts/") return send({ contact: { id: "made-1" } });
      if (url.pathname.endsWith("/tags")) return send({ tags: body?.tags || [] });
      if (url.pathname === "/conversations/messages") return send({ messageId: "m1" });
      if (url.pathname.endsWith("/bill")) return send({ Bill: { Id: "bill-1" } });
      if (url.pathname.endsWith("/Invoices")) return send({ Invoices: [{ InvoiceID: "inv-1", Status: "DRAFT" }] });
      return send({ id: "ok" });
    });
  });
  await new Promise((resolve) => mock.listen(port, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = {
    CC_GHL_API_URL: base, CC_QBO_API_URL: base, CC_XERO_API_URL: `${base}/xero`,
    CC_OCR_URL: `${base}/ocr`, CC_INVOICE2DATA_URL: `${base}/invoice2data`, CC_WHISPER_URL: `${base}/whisper`,
    CC_CHATWOOT_URL: `${base}/chatwoot`, CC_CAL_API_URL: `${base}/cal`, CC_DOCUSEAL_URL: `${base}/docuseal`,
    CC_INVOICE_NINJA_URL: `${base}/ninja`,
  };
  const count = (method, suffix) => hits.filter((h) => h.method === method && h.path.endsWith(suffix)).length;
  const flow = async (api, id, body, extra = {}) => {
    const mark = extra.mark || (() => {});
    const preview = await api(`/builders/${id}/preview`, { method: "POST", body });
    mark("preview");
    const jobId = preview.json?.job?.id;
    const built = jobId ? await api(`/builders/${id}/build`, { method: "POST", body: { ...body, jobId } }) : null;
    mark("build");
    const tested = jobId && built?.status === 200 ? await api(`/builders/${id}/test`, { method: "POST", body: { ...body, jobId } }) : null;
    mark("test");
    const published = jobId && tested?.status === 200
      ? await api(`/builders/${id}/publish`, { method: "POST", body: { ...body, jobId, confirm: extra.confirm !== false, checks: extra.checks || {} } })
      : null;
    mark("publish");
    return { preview, built, tested, published, jobId };
  };

  const owner = await startServer({ env: { ...env, CC_DEV_OWNER: "1" } });
  try {
    const none = await owner.api("/builders");
    assert.deepEqual(none.json.builders, []);
    assert.deepEqual(none.json.steps, ["Describe", "Preview the AIs", "Build", "Test", "Publish"]);
    assert.match(none.json.notes.tax, /Ask your accountant/);
    assert.match(none.json.notes.docuseal, /AGPL/);
    assert.match(none.json.notes.ninja, /Elastic/);
    assert.match(none.json.notes.ocr, /PaddleOCR/);
    assert.match(none.json.notes.invoice, /invoice2data/);
    assert.match(none.json.notes.whisper, /Whisper/);

    const mentioned = await owner.api("/builders/detect", { method: "POST", body: { text: "HighLevel" } });
    assert.equal(mentioned.json.builders.length, 5);

    const early = await flow(owner.api, "hl-campaign", { text: "Hello from the shop", recipients: "c-1\nc-2", sendTime: "10:00", channel: "email" }, { checks: CHECKS });
    assert.equal(early.preview.status, 200);
    assert.equal(early.preview.json.posted, false);
    assert.equal(early.published.status, 409);
    assert.equal(early.published.json.code, "not_connected");
    assert.equal(count("POST", "/conversations/messages"), 0);

    const saved = await owner.api("/builders/connect", { method: "POST", body: { service: "highlevel", token: TOKEN, locationId: "loc-1" } });
    assert.equal(saved.status, 200);
    assert.equal(JSON.stringify(saved.json).includes(TOKEN), false);
    assert.equal(owner.log.includes(TOKEN), false);
    const connected = await owner.api("/builders");
    assert.equal(connected.json.connections.highlevel, true);
    assert.equal(connected.json.builders.length, 5);

    const quiet = await flow(owner.api, "hl-campaign", { text: "Night note", recipients: "c-1", sendTime: "22:00" }, { checks: CHECKS });
    assert.equal(quiet.published.status, 409);
    assert.equal(quiet.published.json.code, "quiet_hours");
    assert.equal(count("POST", "/conversations/messages"), 0);

    let beforePublish = null;
    const sent = await flow(owner.api, "hl-campaign", { text: "Hello from the shop", recipients: "c-1\nc-2", sendTime: "10:00" }, {
      checks: { tcpa: true, stop: true, quiet: true, a2p: true, canspam: true },
      mark(step) { if (step === "test") beforePublish = count("POST", "/conversations/messages"); },
    });
    assert.equal(beforePublish, 0);
    assert.equal(sent.published.status, 200);
    assert.equal(sent.published.json.posted, true);
    assert.equal(count("POST", "/conversations/messages"), 2);
    const msgs = hits.filter((h) => h.path === "/conversations/messages");
    assert.equal(msgs[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.match(msgs[0].body.message, /unsubscribe/i);
    assert.equal(JSON.stringify(sent.published.json).includes(TOKEN), false);
    const again = await owner.api("/builders/hl-campaign/publish", { method: "POST", body: { text: "Hello from the shop", recipients: "c-1\nc-2", sendTime: "10:00", jobId: sent.jobId, confirm: true, checks: CHECKS } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, "done");
    assert.equal(count("POST", "/conversations/messages"), 2);

    const noCheck = await flow(owner.api, "hl-campaign", { text: "Your credit score will jump", recipients: "c-9", sendTime: "10:00" }, { checks: { tcpa: true, stop: true, quiet: true, a2p: true, canspam: true } });
    assert.equal(noCheck.published.json.code, "checks");
    assert.ok(noCheck.published.json.missing.includes("croa"));
    assert.equal(count("POST", "/conversations/messages"), 2);
    assert.match(noCheck.preview.json.draft.message, /Credit repair note:/);
    assert.equal(noCheck.preview.json.draft.message.includes(SSN), false);

    const ssn = await owner.api("/builders/hl-campaign/preview", { method: "POST", body: { text: `Hello ${SSN}`, recipients: "c-1", sendTime: "10:00" } });
    assert.equal(JSON.stringify(ssn.json).includes(SSN), false);

    const tax = await flow(owner.api, "acct-qbo", { text: "Is this deductible? North Bakery\nTotal $12.40" }, { checks: CHECKS });
    assert.equal(tax.published.status, 409);
    assert.equal(tax.published.json.code, "tax");
    assert.match(tax.published.json.error, /Ask your accountant/);
    assert.equal(count("POST", "/bill"), 0);

    await owner.api("/builders/connect", { method: "POST", body: { service: "quickbooks", token: TOKEN, realmId: "realm-1" } });
    let qboAtTest = null;
    const qbo = await flow(owner.api, "acct-qbo", { text: "North Bakery\n2026-10-21\nTotal $12.40" }, { mark(step) { if (step === "test") qboAtTest = count("POST", "/bill"); } });
    assert.equal(qbo.tested.json.posted, false);
    assert.equal(qboAtTest, 0, "test does not post");
    assert.equal(qbo.published.status, 200, qbo.published.json?.error);
    assert.equal(qbo.published.json.posted, true);
    const bill = hits.filter((h) => h.path.endsWith("/bill")).at(-1);
    assert.equal(bill.body.Line[0].Amount, 12.4);
    assert.equal(bill.body.Payment, undefined);

    await owner.api("/builders/connect", { method: "POST", body: { service: "xero", token: TOKEN, tenantId: "tenant-1" } });
    const xero = await flow(owner.api, "acct-xero", { text: "North Bakery\n2026-10-21\nTotal $12.40" });
    assert.equal(xero.published.json.posted, true);
    const inv = hits.filter((h) => h.path === "/xero/Invoices").at(-1);
    assert.equal(inv.headers["xero-tenant-id"], "tenant-1");
    assert.equal(inv.body.Invoices[0].Status, "DRAFT");
    assert.equal(JSON.stringify(xero.published.json).includes(TOKEN), false);

    const ocrBefore = count("POST", "/ocr");
    let ocrAtBuild = null;
    const snap = await flow(owner.api, "acct-receipt", { text: "North Bakery\nTotal $9.00", engine: "paddleocr" }, { mark(step) { if (step === "build") ocrAtBuild = count("POST", "/ocr"); } });
    assert.equal(ocrAtBuild, ocrBefore, "preview and build do not call the reader");
    assert.equal(snap.tested.status, 200);
    assert.equal(count("POST", "/ocr"), ocrBefore + 1);
    assert.equal(snap.tested.json.draft.engine, "paddleocr");
    assert.equal(snap.published.json.posted, false);
    assert.equal(count("POST", "/ocr"), ocrBefore + 1);

    const readBefore = count("POST", "/invoice2data");
    const reader = await flow(owner.api, "acct-invoice-read", { text: "From: North Bakery\nInvoice INV-14\nTotal $40.00" });
    assert.equal(count("POST", "/invoice2data"), readBefore + 1);
    assert.equal(reader.tested.json.draft.number, "INV-14");
    assert.equal(reader.published.json.posted, false);

    const ninjaBefore = count("POST", "/invoices");
    const localInvoice = await flow(owner.api, "acct-invoice-make", { text: "Design work", to: "Ada", number: "INV-1001", amount: "40.00", invoiceNinja: false });
    assert.equal(localInvoice.published.json.posted, false);
    assert.equal(count("POST", "/invoices"), ninjaBefore);
    await owner.api("/builders/connect", { method: "POST", body: { service: "invoiceninja", token: TOKEN, url: `${base}/ninja` } });
    const ninja = await flow(owner.api, "acct-invoice-make", { text: "Design work", to: "Ada", amount: "40.00", invoiceNinja: true });
    assert.equal(ninja.published.json.posted, true);
    assert.equal(count("POST", "/invoices"), ninjaBefore + 1);

    const legal = await owner.api("/builders/biz-contract/preview", { method: "POST", body: { text: "write me a contract", templateId: "9", email: "a@example.com" } });
    assert.equal(legal.status, 400);
    assert.equal(legal.json.code, "legal");
    assert.equal(count("POST", "/submissions"), 0);
    await owner.api("/builders/connect", { method: "POST", body: { service: "docuseal", token: TOKEN } });
    const sign = await flow(owner.api, "biz-contract", { text: "Send my template", templateId: "9", email: "a@example.com" }, { checks: { notLegal: true } });
    assert.equal(sign.published.json.posted, true);
    const sub = hits.filter((h) => h.path === "/docuseal/api/submissions").at(-1);
    assert.equal(sub.body.template_id, "9");
    assert.equal(sub.body.send_email, true);
    assert.equal(JSON.stringify(sign.published.json).includes(TOKEN), false);

    const reviewHits = hits.length;
    const review = await flow(owner.api, "biz-review", { text: "The bread was warm." });
    assert.equal(review.published.json.posted, false);
    assert.match(review.published.json.reason, /not posted|Nothing was sent|Saved/i);
    assert.equal(hits.length, reviewHits);

    await owner.api("/builders/connect", { method: "POST", body: { service: "chatwoot", token: TOKEN, accountId: "1" } });
    const chat = await flow(owner.api, "biz-chat", { text: "Hello", website: "https://example.com", welcome: "Hello. How can we help?" });
    assert.equal(chat.published.json.posted, true);
    assert.equal(hits.filter((h) => h.path === "/chatwoot/api/v1/accounts/1/inboxes").length, 1);

    await owner.api("/builders/connect", { method: "POST", body: { service: "cal", token: TOKEN } });
    const book = await flow(owner.api, "biz-booking", { text: "A short call", title: "A time to talk", minutes: "30" });
    assert.equal(book.published.json.posted, true);
    assert.equal(hits.filter((h) => h.path === "/cal/v2/event-types").at(-1).body.length, 30);

    const lead = await flow(owner.api, "hl-lead", { text: "New leads", name: "Ada", email: "ada@example.com" });
    assert.equal(lead.published.json.posted, true);
    assert.equal(hits.filter((h) => h.path === "/contacts/").at(-1).body.email, "ada@example.com");

    const tags = await flow(owner.api, "hl-workflows", { text: "Start on a tag", tags: "new-lead, booked", contactId: "c-1" });
    assert.equal(tags.published.json.posted, true);
    assert.deepEqual(hits.filter((h) => h.path === "/contacts/c-1/tags").at(-1).body.tags, ["new-lead", "booked"]);

    const coach = await flow(owner.api, "hl-pipeline", { text: "Today", stages: "New, Won", counts: "2, 1" });
    assert.equal(coach.tested.json.posted, false);
    assert.equal(count("GET", "/opportunities/search"), 1);
    assert.equal(coach.published.json.posted, false);
    assert.match(coach.published.json.job.draft.summary, /Total 3/);

    const copy = await flow(owner.api, "hl-funnel", { text: "Warm bread", offer: "Warm bread on Fridays" });
    assert.equal(copy.published.json.posted, false);
    assert.match(copy.preview.json.draft.headline, /Warm bread/);

    const notes = await flow(owner.api, "biz-notes", { text: "We picked the menu." });
    assert.equal(count("POST", "/whisper"), 1);
    assert.equal(notes.published.json.posted, false);
    assert.ok(notes.tested.json.draft.actions.some((a) => /price list/.test(a)));

    const fresh = await owner.api("/builders/hl-funnel/preview", { method: "POST", body: { text: "Another page", offer: "Soup" } });
    const freshId = fresh.json.job.id;
    await owner.api("/builders/hl-funnel/build", { method: "POST", body: { text: "Another page", offer: "Soup", jobId: freshId } });
    await owner.api("/builders/hl-funnel/test", { method: "POST", body: { text: "Another page", offer: "Soup", jobId: freshId } });
    const unconfirmed = await owner.api("/builders/hl-funnel/publish", { method: "POST", body: { text: "Another page", offer: "Soup", jobId: freshId } });
    assert.equal(unconfirmed.status, 400);
    assert.equal(unconfirmed.json.code, "confirm");
    assert.equal(owner.log.includes(TOKEN), false);
    assert.equal(owner.log.includes(SSN), false);
  } finally {
    await owner.stop();
  }

  const pro = await startServer({
    env,
    seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-TEST-TEST-TEST", deviceId: "devb", tier: "pro", status: "active", lastOkAt: Date.now(), checkedAt: Date.now() })),
  });
  try {
    const state = await pro.api("/state");
    assert.equal(state.json.license.tier, "pro");
    const blocked = await flow(pro.api, "hl-campaign", { text: "Hello", recipients: "c-1", sendTime: "10:00" }, { checks: CHECKS });
    assert.equal(blocked.preview.status, 200);
    assert.equal(blocked.built.status, 402);
    assert.equal(blocked.built.json.code, "extreme_required");
    const lead = await flow(pro.api, "hl-lead", { text: "A form" });
    assert.equal(lead.built.status, 200);
    assert.equal(lead.published.json.posted, false);
  } finally { await pro.stop(); }

  const free = await startServer({ env });
  try {
    const blocked = await flow(free.api, "hl-lead", { text: "HighLevel form", email: "ada@example.com" });
    assert.equal(blocked.preview.status, 200);
    assert.equal(blocked.built.status, 402);
    assert.equal(blocked.built.json.code, "pro_required");
    const snap = await flow(free.api, "acct-receipt", { text: "North Bakery\nTotal $3.00" });
    assert.equal(snap.published.status, 200);
    assert.equal(snap.published.json.posted, false);
    assert.equal(snap.published.json.job.draft.merchant, "North Bakery");
  } finally { await free.stop(); }

  await new Promise((resolve) => mock.close(resolve));
});
