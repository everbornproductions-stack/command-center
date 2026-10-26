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

test("source: a hidden AI News panel comes back from the Community News screen, and Escape closes Who will read this", () => {
  assert.match(read("web", "features", "community.js"), /Show the AI News panel/);
  const rail = read("web", "features", "news-rail.js");
  assert.match(rail, /window\.CC\.newsRail = \{/);
  assert.equal(/Settings can bring it back/.test(rail), false);
  const desk = read("web", "features", "desk.js");
  assert.match(desk, /ev\.key === "Escape"/);
});
