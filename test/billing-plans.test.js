// Prices live in server/price-config.js. Yearly and lifetime are not derived from monthly.
// Published pay links are opened by the browser. Tests do not fetch them. Nothing calls Stripe.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  founderQuote, mockStripeCheckout, proPlanCatalog,
} from "../server/billing-plans.js";
import {
  EXTREME_MONTHLY, EXTREME_MONTHLY_PLAN_ID, EXTREME_YEARLY, EXTREME_YEARLY_PLAN_ID,
  FOUNDER_LIMITED_LINE, FOUNDER_SPOTS_HIDDEN_UNTIL,
  EXTREME_MONTHLY_PAY_LINK, EXTREME_YEARLY_PAY_LINK,
  DEVELOPER_MONTHLY, DEVELOPER_MONTHLY_PAY_LINK, DEVELOPER_MONTHLY_PLAN_ID, DEVELOPER_YEARLY, DEVELOPER_YEARLY_PAY_LINK, DEVELOPER_YEARLY_PLAN_ID,
  payLinkWithEmail,
  LIFETIME_PAY_LINK, LIFETIME_PLAN_ID, MONTHLY_SETS, PRICE_SET,
  PRO_MONTHLY, PRO_MONTHLY_PAY_LINK, PRO_MONTHLY_PLAN_ID, PRO_YEARLY, PRO_YEARLY_PAY_LINK, PRO_YEARLY_PLAN_ID,
} from "../server/price-config.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";
const EN = "\u2013";

test("one config holds the current prices, and the monthly raise is a separate set", () => {
  assert.equal(PRICE_SET, "current");
  assert.equal(PRO_MONTHLY, 18.99);
  assert.equal(EXTREME_MONTHLY, 29.99);
  assert.equal(PRO_YEARLY, 189);
  assert.equal(EXTREME_YEARLY, 299);
  assert.deepEqual(MONTHLY_SETS.next, { pro: 24.99, extreme: 39.99 });
  assert.equal(PRO_MONTHLY_PLAN_ID, "pro-monthly-1899");
  assert.equal(EXTREME_MONTHLY_PLAN_ID, "extreme-monthly-2999");
  assert.equal(PRO_YEARLY_PLAN_ID, "pro-yearly-189");
  assert.equal(EXTREME_YEARLY_PLAN_ID, "extreme-yearly-299");
  assert.equal(LIFETIME_PLAN_ID, "founder-lifetime");
  assert.notEqual(PRO_YEARLY, Math.round(PRO_MONTHLY * 12));
  assert.notEqual(EXTREME_YEARLY, Math.round(EXTREME_MONTHLY * 12));
  assert.equal(DEVELOPER_MONTHLY, 34.99);
  assert.equal(DEVELOPER_YEARLY, 349);
  assert.equal(DEVELOPER_MONTHLY_PLAN_ID, "developer-monthly-3499");
  assert.equal(DEVELOPER_YEARLY_PLAN_ID, "developer-yearly-349");
});

test("spots stay hidden until 40 founders have bought", () => {
  assert.equal(FOUNDER_SPOTS_HIDDEN_UNTIL, 40);
  assert.equal(FOUNDER_LIMITED_LINE, "Limited to the first 100 founders");

  const unknown = founderQuote(null);
  assert.equal(unknown.stage, "unknown");
  assert.equal(unknown.price, null);
  assert.equal(unknown.showSpots, false);
  assert.equal(unknown.spotsLine, FOUNDER_LIMITED_LINE);
  assert.equal(founderQuote(-1).stage, "unknown");
  assert.equal(founderQuote("").spotsLine, FOUNDER_LIMITED_LINE);

  const under = founderQuote(37.9);
  assert.equal(under.sold, 37);
  assert.equal(under.price, 349);
  assert.equal(under.stage, "early");
  assert.equal(under.showSpots, false);
  assert.equal(under.spotsLeft, null);
  assert.equal(under.spotsLine, "Limited to the first 100 founders");
  assert.match(under.rule, /\$349 for the first 100/);
  assert.match(under.rule, /\$499/);
  assert.match(under.rule, /500/);

  const zero = founderQuote(0);
  assert.equal(zero.price, 349);
  assert.equal(zero.showSpots, false);
  assert.equal(zero.spotsLine, FOUNDER_LIMITED_LINE);

  const open = founderQuote(40);
  assert.equal(open.showSpots, true);
  assert.equal(open.spotsLeft, 60);
  assert.equal(open.earlyRemaining, 60);
  assert.equal(open.spotsLine, "60 of 100 founder spots left");

  const one = founderQuote(99);
  assert.equal(one.price, 349);
  assert.equal(one.earlyRemaining, 1);
  assert.equal(one.showSpots, true);
  assert.equal(one.spotsLine, "1 of 100 founder spots left");

  const later = founderQuote(100);
  assert.equal(later.price, 499);
  assert.equal(later.stage, "standard");
  assert.equal(later.showSpots, true);
  assert.equal(later.spotsLine, "400 spots left");

  const last = founderQuote(499);
  assert.equal(last.price, 499);
  assert.equal(last.remaining, 1);
  assert.equal(last.spotsLine, "1 spot left");

  for (const sold of [500, 501]) {
    const closed = founderQuote(sold);
    assert.equal(closed.open, false);
    assert.equal(closed.price, null);
    assert.equal(closed.stage, "closed");
    assert.equal(closed.showSpots, false);
    assert.equal(closed.spotsLine, "Sold out");
  }

  const forced = founderQuote(10, { spotsHiddenUntil: 10 });
  assert.equal(forced.showSpots, true);
  assert.equal(forced.spotsLine, "90 of 100 founder spots left");
  assert.equal(founderQuote(9, { spotsHiddenUntil: 10 }).showSpots, false);
});

test("mock checkout records the published pay links and does not charge", () => {
  const mock = { calls: [], checkout(row) { this.calls.push(row); } };
  const monthly = mockStripeCheckout("monthly", { client: mock });
  assert.equal(monthly.url, PRO_MONTHLY_PAY_LINK);
  assert.equal(monthly.amount, 18.99);
  assert.equal(monthly.charged, false);
  assert.equal(monthly.mocked, true);
  assert.equal(monthly.planId, PRO_MONTHLY_PLAN_ID);

  const yearly = mockStripeCheckout("pro-yearly", { client: mock });
  assert.equal(yearly.amount, 189);
  assert.equal(yearly.url, PRO_YEARLY_PAY_LINK);
  assert.equal(yearly.charged, false);

  const extreme = mockStripeCheckout("extreme-monthly", { client: mock });
  assert.equal(extreme.amount, 29.99);
  assert.equal(extreme.url, EXTREME_MONTHLY_PAY_LINK);
  assert.equal(extreme.planId, EXTREME_MONTHLY_PLAN_ID);

  const extremeYear = mockStripeCheckout(EXTREME_YEARLY_PLAN_ID);
  assert.equal(extremeYear.amount, 299);
  assert.equal(extremeYear.url, EXTREME_YEARLY_PAY_LINK);
  assert.equal(extremeYear.charged, false);

  const early = mockStripeCheckout("lifetime", { sold: 4, client: mock });
  assert.equal(early.amount, 349);
  assert.equal(early.url, LIFETIME_PAY_LINK);
  assert.equal(LIFETIME_PAY_LINK, "https://buy.stripe.com/5kQ7sE8o7bxvh1ldOrgQE02");
  assert.equal(early.charged, false);
  const later = mockStripeCheckout("founder-lifetime", { sold: 100 });
  assert.equal(later.amount, 499);
  assert.equal(later.url, null);
  assert.equal(later.charged, false);
  const closed = mockStripeCheckout("lifetime", { sold: 500 });
  assert.equal(closed.open, false);
  assert.equal(closed.amount, null);
  assert.equal(closed.charged, false);

  assert.equal(mock.calls.length, 4);
  assert.ok(mock.calls.every((row) => row.charged === false));
  assert.throws(() => mockStripeCheckout("studio"), /Unknown plan/);

  const catalog = proPlanCatalog(null);
  assert.equal(catalog.monthly.amount, 18.99);
  assert.equal(catalog.monthly.payLink, PRO_MONTHLY_PAY_LINK);
  assert.equal(catalog.monthly.pendingLink, false);
  assert.equal(catalog.monthly.button, "Go Pro, $18.99/month");
  assert.equal(catalog.yearly.amount, 189);
  assert.equal(catalog.yearly.payLink, PRO_YEARLY_PAY_LINK);
  assert.equal(catalog.extremeMonthly.amount, 29.99);
  assert.equal(catalog.extremeMonthly.payLink, EXTREME_MONTHLY_PAY_LINK);
  assert.equal(catalog.extremeYearly.amount, 299);
  assert.equal(catalog.extremeYearly.payLink, EXTREME_YEARLY_PAY_LINK);
  assert.equal(catalog.lifetime.payLink, LIFETIME_PAY_LINK);
  assert.equal(catalog.lifetime.pendingLink, false);
  assert.equal(catalog.lifetime.spotsLine, "Limited to the first 100 founders");
  assert.equal(catalog.lifetime.button, "Lifetime founder, $349 then $499");
  assert.equal(catalog.developerMonthly.amount, 34.99);
  assert.equal(catalog.developerMonthly.payLink, DEVELOPER_MONTHLY_PAY_LINK);
  assert.equal(catalog.developerYearly.amount, 349);
  assert.equal(catalog.developerYearly.payLink, DEVELOPER_YEARLY_PAY_LINK);
  assert.equal(catalog.grandfather, undefined);
  assert.equal(catalog.charged, false);
  assert.equal(catalog.priceSet, "current");
  assert.equal(catalog.compare.columns.length, 3);
});

test("live copy sells the prices through Stripe pay links and mentions no Square", () => {
  const src = read("server", "billing-plans.js");
  const plugin = read("server", "plugins", "billing-plans.js");
  const app = read("web", "app.js");
  const compare = read("web", "plan-compare.js");
  const growthUi = read("web", "features", "growth.js");
  const growth = read("server", "growth.js");
  const license = read("server", "license.js");
  const gate = read("server", "feature-gate.js");
  const prices = read("server", "price-config.js");
  const doc = read("docs", "billing.md");
  const help = read("docs", "help", "license.md");
  const brief = read("docs", "product-brief.md");
  for (const text of [src, plugin, app, compare, growthUi, growth, license, gate, doc, help]) {
    assert.equal(text.includes(EM), false);
    assert.equal(text.includes(EN), false);
  }
  for (const text of [src, plugin, prices]) {
    assert.doesNotMatch(text, /fetch\s*\(/);
    assert.doesNotMatch(text, /api\.stripe\.com/);
  }
  for (const link of [
    "00wbIUdIrcBz8uP9ybgQE00", "dRm4gs0VF597bH1h0DgQE07", "dRmdR20VF1WVdP9cKngQE03", "6oU7sEgUD5978uP7q3gQE04",
    "9B6fZafQzgRPdP9dOrgQE05", "9B6dR2gUDeJH7qL7q3gQE06", "5kQ7sE8o7bxvh1ldOrgQE02",
  ]) {
    assert.ok(prices.includes(`https://buy.stripe.com/${link}`), link);
    assert.ok(doc.includes(`https://buy.stripe.com/${link}`), `doc ${link}`);
  }
  assert.equal(prices.includes("9B65kwbAjdFDfXhfWzgQE01"), false, "the duplicate Pro link is not used");
  assert.equal(prices.includes(EM), false);
  assert.equal(prices.includes(EN), false);
  for (const text of [app, compare, growthUi, growth, license, gate, prices, src]) {
    assert.equal(text.includes("15.99"), false, "no old grandfather price in buy surfaces");
    assert.doesNotMatch(text, /square\.link|squareup|GRANDFATHER/i);
  }
  assert.match(doc, /^# Billing \(Stripe\)/);
  assert.match(doc, /\$18\.99/);
  assert.match(doc, /\$189/);
  assert.match(doc, /\$29\.99/);
  assert.match(doc, /\$299/);
  assert.match(doc, /\$34\.99/);
  assert.match(doc, /\$499/);
  assert.match(doc, /\$349/);
  assert.match(doc, /pro-monthly-1899/);
  assert.match(doc, /extreme-monthly-2999/);
  assert.match(doc, /prefilled_email/);
  assert.match(doc, /STRIPE_WEBHOOK_SECRET/);
  assert.match(doc, /5 people total/);
  assert.match(doc, /counting the owner/);
  assert.match(doc, /early access/);
  assert.match(doc, /Max quality/);
  assert.match(doc, /founder-lifetime/);
  assert.match(doc, /Limited to the first 100 founders/);
  assert.match(doc, /FOUNDER_SPOTS_HIDDEN_UNTIL/);
  assert.match(doc, /PRICE_SET/);
  assert.match(doc, /\$24\.99/);
  assert.match(doc, /\$39\.99/);
  assert.doesNotMatch(doc, /square/i);
  assert.match(help, /\$18\.99/);
  assert.match(help, /\$349/);
  assert.match(help, /early access/);
  assert.match(help, /Max quality/);
  assert.match(help, /five team seats/);
  assert.match(help, /Stripe checkout/);
  assert.match(help, /I paid, check now/);
  assert.match(help, /Limited to the first 100 founders/);
  assert.doesNotMatch(help, /square/i);
  assert.match(brief, /\$18\.99/);
  assert.doesNotMatch(app, /Go Pro, \$15\.99/);
  assert.match(read("docs", "mobile.md"), /\$18\.99/);
});

test("every pay link carries the signed-in email, URL-encoded, and only when it looks like one", () => {
  const bare = proPlanCatalog(null);
  const withMail = proPlanCatalog(null, { email: "Sam+test@Example.com" });
  for (const key of ["monthly", "yearly", "extremeMonthly", "extremeYearly", "developerMonthly", "developerYearly"]) {
    assert.equal(bare[key].payLink.includes("prefilled_email"), false, key);
    const u = new URL(withMail[key].payLink);
    assert.equal(u.hostname, "buy.stripe.com");
    assert.equal(u.searchParams.get("prefilled_email"), "Sam+test@Example.com", key);
    assert.ok(withMail[key].payLink.includes("prefilled_email=Sam%2Btest%40Example.com"), `${key} is URL-encoded`);
    assert.equal(withMail[key].payLink.startsWith(bare[key].payLink), true);
  }
  assert.ok(withMail.lifetime.payLink.includes("prefilled_email=Sam%2Btest%40Example.com"));
  assert.equal(proPlanCatalog(100, { email: "a@b.co" }).lifetime.payLink, null, "the later price has no link to decorate");
  assert.equal(payLinkWithEmail(PRO_MONTHLY_PAY_LINK, "not an email"), PRO_MONTHLY_PAY_LINK);
  assert.equal(payLinkWithEmail(PRO_MONTHLY_PAY_LINK, ""), PRO_MONTHLY_PAY_LINK);
  assert.equal(payLinkWithEmail(PRO_MONTHLY_PAY_LINK, null), PRO_MONTHLY_PAY_LINK);
  assert.equal(payLinkWithEmail("https://example.com/x", "a@b.co"), "https://example.com/x", "only Stripe links are touched");
  assert.equal(payLinkWithEmail(null, "a@b.co"), null);
  const rec = mockStripeCheckout("developer-yearly", { email: "a@b.co" });
  assert.equal(rec.planId, DEVELOPER_YEARLY_PLAN_ID);
  assert.equal(rec.amount, 349);
  assert.equal(new URL(rec.url).searchParams.get("prefilled_email"), "a@b.co");
  assert.equal(DEVELOPER_MONTHLY_PAY_LINK.startsWith("https://buy.stripe.com/"), true);
  assert.equal(DEVELOPER_YEARLY_PAY_LINK.startsWith("https://buy.stripe.com/"), true);
});

test("the plans route hides the counter under 40 and never calls Stripe", async () => {
  const open = await startServer();
  try {
    const r = await open.api("/billing-plans");
    assert.equal(r.status, 200);
    assert.equal(r.json.monthly.payLink, PRO_MONTHLY_PAY_LINK);
    assert.equal(r.json.monthly.amount, 18.99);
    assert.equal(r.json.yearly.amount, 189);
    assert.equal(r.json.yearly.payLink, PRO_YEARLY_PAY_LINK);
    assert.equal(r.json.extremeMonthly.payLink, EXTREME_MONTHLY_PAY_LINK);
    assert.equal(r.json.extremeMonthly.amount, 29.99);
    assert.equal(r.json.extremeYearly.payLink, EXTREME_YEARLY_PAY_LINK);
    assert.equal(r.json.extremeYearly.amount, 299);
    assert.equal(r.json.lifetime.payLink, LIFETIME_PAY_LINK);
    assert.equal(r.json.lifetime.stage, "unknown");
    assert.equal(r.json.lifetime.price, null);
    assert.equal(r.json.lifetime.showSpots, false);
    assert.equal(r.json.lifetime.spotsLine, "Limited to the first 100 founders");
    assert.equal(r.json.grandfather, undefined);
    assert.equal(r.json.developerMonthly.payLink, DEVELOPER_MONTHLY_PAY_LINK);
    assert.equal(r.json.charged, false);
    assert.equal(r.json.compare.columns.length, 3);
    const st = await open.api("/state");
    assert.equal(st.json.proPlans.yearly.amount, 189);
    assert.equal(st.json.proPlans.monthly.payLink, PRO_MONTHLY_PAY_LINK);
    assert.equal(st.json.proPlans.monthly.amount, 18.99);
    assert.doesNotMatch(open.log, /api\.stripe\.com/);
  } finally {
    await open.stop();
  }

  const early = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "founder-seats.json"), JSON.stringify({ sold: 12 })),
  });
  try {
    const r = await early.api("/billing-plans");
    assert.equal(r.json.lifetime.price, 349);
    assert.equal(r.json.lifetime.sold, 12);
    assert.equal(r.json.lifetime.earlyRemaining, 88);
    assert.equal(r.json.lifetime.showSpots, false);
    assert.equal(r.json.lifetime.spotsLine, "Limited to the first 100 founders");
    assert.equal(r.json.lifetime.payLink, LIFETIME_PAY_LINK);
    assert.equal(r.json.charged, false);
  } finally {
    await early.stop();
  }

  const counted = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "founder-seats.json"), JSON.stringify({ sold: 40 })),
  });
  try {
    const r = await counted.api("/billing-plans");
    assert.equal(r.json.lifetime.price, 349);
    assert.equal(r.json.lifetime.showSpots, true);
    assert.equal(r.json.lifetime.spotsLeft, 60);
    assert.equal(r.json.lifetime.spotsLine, "60 of 100 founder spots left");
  } finally {
    await counted.stop();
  }

  const standard = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "founder-seats.json"), JSON.stringify({ sold: 100 })),
  });
  try {
    const r = await standard.api("/billing-plans");
    assert.equal(r.json.lifetime.price, 499);
    assert.equal(r.json.lifetime.stage, "standard");
    assert.equal(r.json.lifetime.spotsLine, "400 spots left");
    assert.equal(r.json.lifetime.payLink, null);
    assert.equal(r.json.monthly.payLink, PRO_MONTHLY_PAY_LINK);
    assert.equal(r.json.monthly.amount, 18.99);
  } finally {
    await standard.stop();
  }

  const closed = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "founder-seats.json"), JSON.stringify({ sold: 500 })),
  });
  try {
    const r = await closed.api("/billing-plans");
    assert.equal(r.json.lifetime.open, false);
    assert.equal(r.json.lifetime.payLink, null);
    assert.equal(r.json.lifetime.price, null);
    assert.equal(r.json.lifetime.spotsLine, "Sold out");
    assert.equal(r.json.charged, false);
  } finally {
    await closed.stop();
  }
});

test("Windows and Mac CI both run the tests and neither publishes", () => {
  const win = read(".github", "workflows", "windows-ci.yml");
  const mac = read(".github", "workflows", "mac-ci.yml");
  assert.match(win, /runs-on: windows-latest/);
  assert.match(win, /run: npm test/);
  assert.match(mac, /runs-on: macos-latest/);
  assert.match(mac, /run: npm test/);
  assert.match(mac, /run: npm run smoke/);
  assert.doesNotMatch(mac, /dist:mac|gh release|secrets\./);
  assert.equal(mac.includes(EM), false);
});
