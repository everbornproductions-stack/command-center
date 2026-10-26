import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { lockLabel, isLocked, planName } from "../web/tier-lock.js";

test("plan locks say the plan up front", () => {
  assert.equal(lockLabel("pro", "free"), "Needs Pro. You are on Free.");
  assert.equal(lockLabel("extreme", "pro"), "Needs Extreme. You are on Pro.");
  assert.equal(lockLabel("free", "free"), "");
  assert.equal(lockLabel("pro", "extreme"), "");
  assert.equal(lockLabel("pro", "owner"), "");
  assert.equal(isLocked("studio", "free"), true);
  assert.equal(planName("studio"), "Pro");
});
test("source: builder cards show the lock", () => {
  const t = fs.readFileSync(path.join(ROOT, "web", "features", "webbuilders.js"), "utf8");
  assert.match(t, /lockLabel\(row\.tier/);
});
