// The Free / Pro / Extreme table stays three columns at 390px and on a desktop window.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { proPlanCatalog } from "../server/billing-plans.js";
import {
  compareColumnCount, extremeExtrasHtml, founderSpotsHtml, planCompareHtml, upgradeButtonsHtml,
} from "../web/plan-compare.js";

const css = fs.readFileSync(path.join(ROOT, "web", "styles.css"), "utf8");

test("three columns at 390px and on a wide window", () => {
  for (const width of [200, 390, 760, 1280, 1920]) assert.equal(compareColumnCount(width), 3, String(width));
  assert.equal(compareColumnCount(Number.NaN), 3);
  const html = planCompareHtml(proPlanCatalog(12).compare);
  assert.match(html, /class="plan-compare"/);
  assert.match(html, /data-cols="3"/);
  assert.match(html, /data-min-width="390"/);
  assert.equal(html.split('class="plan-col"').length - 1, 3);
  assert.match(html, /data-tier="free"/);
  assert.match(html, /data-tier="pro"/);
  assert.match(html, /data-tier="extreme"/);
  assert.match(html, /\$18\.99\/month/);
  assert.match(html, /\$29\.99\/month/);
  assert.doesNotMatch(html, /15\.99/);
  assert.doesNotMatch(html, /\$159/);
});

test("the narrow layout keeps three plan columns", () => {
  assert.match(css, /\.plan-compare \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  const blocks = [...css.matchAll(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 1);
  const narrow = blocks.filter((b) => b.includes(".plan-compare"));
  assert.ok(narrow.length >= 1);
  for (const block of narrow) {
    assert.match(block, /\.plan-compare \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.doesNotMatch(block, /\.plan-compare\s*\{[^}]*grid-template-columns:\s*1fr/);
  }
  assert.match(css, /\.grid\.cols-2, \.grid\.cols-3 \{ grid-template-columns: 1fr; \}/);
});

test("upgrade buttons sell the prices and open Stripe pay links", () => {
  const plans = proPlanCatalog(10);
  const free = upgradeButtonsHtml({ plans, tier: "free", primary: true });
  assert.match(free, /Go Pro, \$18\.99\/month/);
  assert.match(free, /Pro yearly, \$189\/year/);
  assert.match(free, /Go Extreme, \$29\.99\/month/);
  assert.match(free, /Extreme yearly, \$299\/year/);
  assert.match(free, /Lifetime founder, \$349/);
  assert.match(free, /href="https:\/\/buy\.stripe\.com\/00wbIUdIrcBz8uP9ybgQE00"/);
  assert.match(free, /href="https:\/\/buy\.stripe\.com\/dRm4gs0VF597bH1h0DgQE07"/);
  assert.match(free, /href="https:\/\/buy\.stripe\.com\/dRmdR20VF1WVdP9cKngQE03"/);
  assert.match(free, /href="https:\/\/buy\.stripe\.com\/6oU7sEgUD5978uP7q3gQE04"/);
  assert.match(free, /href="https:\/\/buy\.stripe\.com\/5kQ7sE8o7bxvh1ldOrgQE02"/);
  assert.match(free, /href="https:\/\/buy\.stripe\.com\/9B6fZafQzgRPdP9dOrgQE05"/);
  assert.match(free, /href="https:\/\/buy\.stripe\.com\/9B6dR2gUDeJH7qL7q3gQE06"/);
  assert.match(free, /Go Developer, \$34\.99\/month/);
  assert.match(free, /Developer yearly, \$349\/year/);
  assert.match(free, /data-upgrade-link="founder-lifetime"/);
  const later = upgradeButtonsHtml({ plans: proPlanCatalog(100), tier: "free" });
  assert.match(later, /Lifetime founder, \$499/);
  assert.match(later, /<button[^>]*data-pro-plan="founder-lifetime"/);
  assert.doesNotMatch(later, /5kQ7sE8o7bxvh1ldOrgQE02/);
  assert.doesNotMatch(free, /15\.99/);
  assert.doesNotMatch(free, /dbU38mQC/);
  assert.doesNotMatch(free, /\$159/);

  const pro = upgradeButtonsHtml({ plans, tier: "pro", primary: true });
  assert.match(pro, /Go Extreme/);
  assert.doesNotMatch(pro, /Go Pro, \$18\.99/);
  assert.doesNotMatch(pro, /15\.99/);

  const spots = founderSpotsHtml(plans);
  assert.match(spots, /Limited to the first 100 founders/);
  assert.match(spots, /\$349 for the first 100/);
  const extras = extremeExtrasHtml();
  assert.match(extras, /early access/);
  assert.match(extras, /Max quality/);
  assert.match(extras, /5 people total/);
  assert.match(extras, /counting the owner/);
  assert.match(extras, /owner plus 4 invited/);
  assert.equal(extras.includes("\u2014"), false);
  assert.doesNotMatch(spots, /spots left/);

  const counted = founderSpotsHtml(proPlanCatalog(40));
  assert.match(counted, /60 of 100 founder spots left/);
});
