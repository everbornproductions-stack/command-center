// Phase 11: the user guide and release notes exist, are linked from the README, keep the brand and describe
// the locked behaviour (docs/DECISIONS.md), with no em-dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM_DASH = String.fromCharCode(0x2014);

test("docs: user guide and release notes exist, are linked from the README and keep the brand", () => {
  const readme = read("README.md"), guide = read("docs", "USER-GUIDE.md"), notes = read("docs", "RELEASE-NOTES.md");
  assert.match(readme, /\(docs\/USER-GUIDE\.md\)/);
  assert.match(readme, /\(docs\/RELEASE-NOTES\.md\)/);
  assert.match(guide, /^# Meldmind user guide/);
  assert.match(guide, /an Everborn product/);
  assert.match(notes, /^## v0\.4\.3 /m);
  // the guide describes the locked behaviour (decisions 4, 11, 12, 20)
  assert.match(guide, /Nothing downloads until you click Install now/);
  assert.match(guide, /Key rejected \(401\)/);
  assert.match(guide, /Run setup again/);
  assert.match(guide, /demo AIs leave on their own/);
  for (const [n, t] of [["README.md", readme], ["USER-GUIDE.md", guide], ["RELEASE-NOTES.md", notes]]) assert.ok(!t.includes(EM_DASH), `no em-dash in ${n}`);
});
