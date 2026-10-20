// Phases 57 to 62 are planned after app control. They are not built.
// Decision 14's original run order stays in DECISIONS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";

test("phases 57 to 62 are planned after app control and are not built", () => {
  const plan = read("docs", "BUILD-PLAN.md");
  const road = read("docs", "roadmap.md");
  const decisions = read("docs", "DECISIONS.md");
  assert.match(decisions, /1, 15, 16, 26, 28, 29, 25, 12, 27, 13, 17 to 24, 14, then 2 to 11/);
  assert.match(plan, /51, 57, 58, 59, 60, 61, 62, then Do last: 14,/);
  assert.match(plan, /Phase 8, built early by Grok Bot/);
  const block = plan.slice(plan.indexOf("### Phases 57 to 62"), plan.indexOf("## Planned, not in the run order"));
  for (const title of [
    "### Phase 57: Recipes",
    "### Phase 58: Second-opinion mode",
    "### Phase 59: Cost guard",
    "### Phase 60: Phone approvals",
    "### Phase 61: Team spaces",
    "### Phase 62: Industry starter packs",
  ]) {
    assert.ok(block.includes(title), title);
    const body = block.slice(block.indexOf(title), block.indexOf("###", block.indexOf(title) + 4));
    assert.match(body, /planned, not built/);
  }
  assert.match(block, /Do not rebuild them/);
  assert.match(block, /you saved \$X by smart routing/);
  assert.match(block, /Marching orders/);
  assert.match(block, /paid tier above Pro/);
  assert.match(road, /## After app control \(planned, not built\)/);
  assert.match(road, /Recipes/);
  assert.match(road, /Second-opinion mode/);
  assert.match(road, /Cost guard/);
  assert.match(road, /Phone approvals/);
  assert.match(road, /Team spaces/);
  assert.match(road, /Industry starter packs/);
  assert.equal(block.includes(EM), false);
  assert.equal(road.slice(road.indexOf("## After app control")).includes(EM), false);
});
