// No plain browser confirm() is left in the feature pages (F13), the hub says Trash, News can be shown from Community (F7).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("source: feature pages use the themed confirm dialog", () => {
  const dir = path.join(ROOT, "web", "features");
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const t = read("web", "features", f);
    if (/(^|[^.\w])(window\.)?confirm\(/m.test(t.replace(/CC\.confirm\(/g, "").replace(/window\.CC\.confirm\(/g, ""))) bad.push(f);
  }
  assert.deepEqual(bad, []);
  const hub = read("web", "features", "mindmedia.js");
  assert.match(hub, /Move to Trash/);
  assert.match(hub, /restore it for 30 days/);
});

test("source: AI News has no floating panel to bring back, and Escape closes Who will read this", () => {
  assert.equal(/Show the AI News panel/.test(read("web", "features", "community.js")), false);
  assert.equal(/window\.CC\.newsRail = \{/.test(read("web", "features", "news-rail.js")), false);
  const desk = read("web", "features", "desk.js");
  assert.match(desk, /ev\.key === "Escape"/);
});

test("source: plain words on Images and Media, and readable small print under More actions", () => {
  for (const f of ["images.js", "media.js"]) {
    const t = read("web", "features", f);
    assert.match(t, /See the price/);
    assert.equal(/>Estimate</.test(t), false, f);
    assert.equal(/\(no key/.test(t), false, f);
  }
  assert.match(read("web", "styles.css"), /\.answer-more-body \.chip[^{]*\{ font-size: 0\.8125rem; \}/);
});
