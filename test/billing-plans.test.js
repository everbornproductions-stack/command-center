// Phase 35: yearly Pro and the lifetime founder deal sit beside the existing monthly checkout.
// The monthly Square link is unchanged. Tests use a mock checkout. Nothing calls Square.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  MONTHLY_LINK, founderQuote, proPlanCatalog, mockSquareCheckout,
} from "../server/billing-plans.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const MONTHLY_ANCHOR = '<a class="btn primary" href="https://square.link/u/dbU38mQC" target="_blank" rel="noopener">Go Pro, $15.99/month</a>';
const SETTINGS_ANCHOR = '<a href="https://square.link/u/dbU38mQC" target="_blank" rel="noopener">Go Pro, $15.99/month</a>';

test("founder price is $299 for the first 100, then $499, and closes at 500", () => {
  assert.equal(founderQuote(null).stage, "unknown");
  assert.equal(founderQuote(null).price, null);
  assert.equal(founderQuote(0).price, 299);
  assert.equal(founderQuote(99).price, 299);
  assert.equal(founderQuote(99).earlyRemaining, 1);
  assert.equal(founderQuote(100).price, 499);
  assert.equal(founderQuote(100).stage, "standard");
  assert.equal(founderQuote(499).price, 499);
  assert.equal(founderQuote(499).remaining, 1);
  assert.equal(founderQuote(500).open, false);
  assert.equal(founderQuote(500).price, null);
  assert.equal(founderQuote(500).stage, "closed");
  assert.equal(founderQuote(501).open, false);
  assert.equal(founderQuote(-1).stage, "unknown");
  assert.equal(founderQuote(37.9).sold, 37);
  assert.equal(founderQuote(37.9).price, 299);
});

test("mock checkout keeps the monthly link and does not charge the new plans", () => {
  const mock = { calls: [], checkout(row) { this.calls.push(row); } };
  const monthly = mockSquareCheckout("monthly", { client: mock });
  assert.equal(monthly.url, MONTHLY_LINK);
  assert.equal(monthly.url, "https://square.link/u/dbU38mQC");
  assert.equal(monthly.amount, 15.99);
  assert.equal(monthly.charged, false);
  assert.equal(monthly.mocked, true);
  const yearly = mockSquareCheckout("pro-yearly", { client: mock });
  assert.equal(yearly.amount, 159);
  assert.equal(yearly.url, null);
  assert.equal(yearly.charged, false);
  const early = mockSquareCheckout("lifetime", { sold: 4, client: mock });
  assert.equal(early.amount, 299);
  assert.equal(early.url, null);
  assert.equal(early.charged, false);
  const later = mockSquareCheckout("founder-lifetime", { sold: 100 });
  assert.equal(later.amount, 499);
  assert.equal(later.charged, false);
  const closed = mockSquareCheckout("lifetime", { sold: 500 });
  assert.equal(closed.open, false);
  assert.equal(closed.amount, null);
  assert.equal(closed.charged, false);
  assert.equal(mock.calls.length, 3);
  assert.ok(mock.calls.every((row) => row.charged === false));
  assert.throws(() => mockSquareCheckout("studio"), /Unknown plan/);
  const catalog = proPlanCatalog(null);
  assert.equal(catalog.monthly.payLink, MONTHLY_LINK);
  assert.equal(catalog.yearly.payLink, null);
  assert.equal(catalog.charged, false);
});

test("billing code and the pay buttons do not call Square", () => {
  const src = read("server", "billing-plans.js");
  const plugin = read("server", "plugins", "billing-plans.js");
  const app = read("web", "app.js");
  const doc = read("docs", "billing.md");
  for (const text of [src, plugin]) {
    assert.doesNotMatch(text, /\bfetch\s*\(/);
    assert.doesNotMatch(text, /connect\.squareup\.com|squareup\.com\/v2/);
    assert.equal(text.includes("\u2014"), false);
  }
  assert.equal(app.split(MONTHLY_ANCHOR).length - 1, 1);
  assert.equal(app.split(SETTINGS_ANCHOR).length - 1, 1);
  assert.match(app, /Pro yearly, \$159\/year/);
  assert.match(app, /\$299 for the first 100, then \$499, capped at 500/);
  assert.equal(app.includes("\u2014"), false);
  assert.match(doc, /\$15\.99/);
  assert.match(doc, /https:\/\/square\.link\/u\/dbU38mQC/);
  assert.match(doc, /\$159/);
  assert.match(doc, /\$299 for the first 100/);
  assert.match(doc, /\$499/);
  assert.match(doc, /500/);
  assert.equal(doc.includes("\u2014"), false);
});

test("the plans route and the state payload use the seat file and never Square", async () => {
  const open = await startServer();
  try {
    const r = await open.api("/billing-plans");
    assert.equal(r.status, 200);
    assert.equal(r.json.monthly.payLink, "https://square.link/u/dbU38mQC");
    assert.equal(r.json.monthly.amount, 15.99);
    assert.equal(r.json.yearly.amount, 159);
    assert.equal(r.json.yearly.payLink, null);
    assert.equal(r.json.lifetime.stage, "unknown");
    assert.equal(r.json.lifetime.price, null);
    assert.equal(r.json.charged, false);
    const st = await open.api("/state");
    assert.equal(st.json.proPlans.yearly.amount, 159);
    assert.equal(st.json.proPlans.monthly.payLink, "https://square.link/u/dbU38mQC");
    assert.doesNotMatch(open.log, /connect\.squareup\.com|squareup\.com\/v2/);
  } finally {
    await open.stop();
  }

  const early = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "founder-seats.json"), JSON.stringify({ sold: 12 })),
  });
  try {
    const r = await early.api("/billing-plans");
    assert.equal(r.json.lifetime.price, 299);
    assert.equal(r.json.lifetime.sold, 12);
    assert.equal(r.json.lifetime.earlyRemaining, 88);
    assert.equal(r.json.charged, false);
  } finally {
    await early.stop();
  }

  const standard = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "founder-seats.json"), JSON.stringify({ sold: 100 })),
  });
  try {
    const r = await standard.api("/billing-plans");
    assert.equal(r.json.lifetime.price, 499);
    assert.equal(r.json.lifetime.stage, "standard");
    assert.equal(r.json.monthly.payLink, "https://square.link/u/dbU38mQC");
  } finally {
    await standard.stop();
  }

  const closed = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "founder-seats.json"), JSON.stringify({ sold: 500 })),
  });
  try {
    const r = await closed.api("/billing-plans");
    assert.equal(r.json.lifetime.open, false);
    assert.equal(r.json.lifetime.price, null);
    assert.equal(r.json.charged, false);
  } finally {
    await closed.stop();
  }
});
