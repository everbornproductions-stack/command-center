// N15: the Report box under each community message stays hidden until Report is clicked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("community css hides .cc-report[hidden] even though .row sets display:flex", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "web", "features", "community.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /\.cc-report\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(src, /class="row cc-report" hidden/);
});
