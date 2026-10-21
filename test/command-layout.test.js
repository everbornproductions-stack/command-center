// Command columns. The orders panel used to be position:sticky inside the scrolling
// view, with a max-height and no overflow, so the wheel moved Live Ops and the
// left panel could not scroll. Each column is its own scrollport on a wide window.
// At the stacked breakpoints the page scrolls again.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const css = fs.readFileSync(path.join(ROOT, "web", "styles.css"), "utf8");
const block = (re) => {
  const m = css.match(re);
  assert.ok(m, re);
  return m[1];
};

test("the orders panel, the right column, and the live feed each scroll on a wide window", () => {
  const orders = block(/\.cmd \.orders \{([^}]+)\}/);
  assert.match(orders, /min-height:\s*0/);
  assert.match(orders, /overflow-y:\s*auto/);
  assert.doesNotMatch(orders, /sticky/);
  assert.doesNotMatch(orders, /100vh/);
  const cmd = block(/\.cmd \{([^}]+)\}/);
  assert.match(cmd, /minmax\(0,\s*1fr\)/);
  assert.match(cmd, /min-height:\s*0/);
  assert.match(cmd, /height:\s*100%/);
  // Live ops has no inner scrollbar; the right column scrolls as a whole.
  assert.doesNotMatch(block(/\.cmd \.ops \{([^}]+)\}/), /overflow-y:\s*auto/);
  assert.match(block(/\.cmd-side \{([^}]+)\}/), /overflow-y:\s*auto/);
  assert.match(block(/\.cmd-side \{([^}]+)\}/), /min-height:\s*0/);
  assert.match(block(/\.cmd \.output \{([^}]+)\}/), /overflow-y:\s*auto/);
  assert.match(block(/\.cmd \.output \{([^}]+)\}/), /min-height:\s*0/);
  const feed = block(/\.feed-list \{([^}]+)\}/);
  assert.match(feed, /min-height:\s*0/);
  assert.match(feed, /overflow:\s*auto/);
  assert.match(feed, /flex:\s*1/);
  assert.match(css, /@media \(min-width:\s*1251px\) \{ \.view:has\(> \.cmd\) \{ overflow: hidden; \} \}/);
});

test("stacked layouts let the page scroll instead of trapping the columns", () => {
  const stacked = css.slice(css.indexOf("@media (max-width: 1250px)"), css.indexOf("@media (max-width: 760px)"));
  assert.match(stacked, /\.cmd \.orders \{[^}]*overflow:\s*visible/);
  assert.match(stacked, /height:\s*auto/);
  assert.match(stacked, /\.view:has\(> \.cmd\) \{ overflow: auto; \}/);
  const phone = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(phone, /\.cmd \.orders \{ grid-row: auto; overflow: visible; max-height: none; \}/);
});
