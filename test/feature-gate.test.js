// Tier gate for the remaining phases. Square and the live licence table are not involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decide, FEATURES, PRO_PRICE, TEAM_SEATS } from "../server/feature-gate.js";
import { startServer } from "./helpers.js";

const TIERS = ["free", "pro", "studio", "owner", "extreme"];

test("decide: industry packs are Pro and up, team spaces are above Pro, seats stop at 5", () => {
  assert.equal(PRO_PRICE, "$15.99/month");
  assert.equal(TEAM_SEATS, 5);
  assert.equal(FEATURES.industryPacks.tier, "pro");
  assert.equal(FEATURES.teamSpaces.tier, "above");
  for (const feature of ["secondOpinion", "highlevelTools", "ownSupabase"]) {
    for (const tier of TIERS) assert.equal(decide(tier, feature).ok, true, `${tier} ${feature}`);
  }
  for (const tier of ["free"]) assert.equal(decide(tier, "industryPacks").code, "pro_required");
  for (const tier of ["pro", "studio", "owner", "extreme"]) assert.equal(decide(tier, "industryPacks").ok, true);
  for (const tier of ["free", "pro"]) {
    assert.equal(decide(tier, "teamSpaces").code, "studio_required");
    assert.match(decide(tier, "teamSpaces").message, /placeholder/);
    assert.doesNotMatch(decide(tier, "teamSpaces").message, /\$\d/);
  }
  for (const tier of ["studio", "owner", "extreme"]) {
    assert.equal(decide(tier, "teamSpaces").ok, true);
    assert.equal(decide(tier, "teamSeats", { count: 5 }).ok, true);
    assert.equal(decide(tier, "teamSeats", { count: 6 }).code, "seat_cap");
  }
  assert.equal(decide("free", "not-a-feature").code, "pro_required");
  const src = fs.readFileSync(new URL("../server/feature-gate.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\u2014/);
  assert.doesNotMatch(src, /square\.com|checkout/i);
});

test("a stored Extreme licence opens the gate when the live table has no Extreme tier", async () => {
  const s = await startServer({
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({
        tier: "extreme", status: "active", lastOkAt: Date.now(), checkedAt: Date.now(),
      }));
    },
  });
  try {
    const row = await s.api("/opinion");
    assert.equal(row.status, 200);
    assert.equal(row.json.tier, "extreme");
    assert.equal(row.json.open, true);
    assert.equal((await s.api("/state")).json.license.tier, "free", "the live licence table still has no Extreme tier");
  } finally { await s.stop(); }
});
