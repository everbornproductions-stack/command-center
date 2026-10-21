// Every Free, Pro, and Extreme gate. Upgrade, downgrade, a lapsed trial, and a lifetime buyer.
// The licence server is a local stub. Nothing calls Square. Waits are real setTimeout calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { evaluateGate, FEATURES, LIMITS, publicCompare } from "../server/feature-gate.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seedKey = (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null }));

function infoFor(key, n) {
  if (key === "concurrentRuns") return { running: n };
  if (key === "councilsPerMonth" || key === "deepResearchPerMonth") return { used: n };
  if (key === "teamSeats") return { seats: n };
  return { count: n };
}

async function waitForTier(s, tier) {
  let st;
  for (let i = 0; i < 50; i++) {
    st = await s.api("/state");
    if (st.json.license.tier === tier) return st;
    await sleep(100);
  }
  throw new Error(`tier never became ${tier}: ${JSON.stringify(st.json.license)}`);
}

test("every gate allows under the cap and denies at the cap on Free, Pro, and Extreme", () => {
  for (const tier of ["free", "pro", "extreme"]) {
    const limits = LIMITS[tier];
    for (const [key, meta] of Object.entries(FEATURES)) {
      const value = limits[key];
      const built = meta.built !== false;
      if (meta.kind === "bool") {
        const r = evaluateGate(limits, key);
        assert.equal(r.built, built, `${tier} ${key} built`);
        assert.equal(r.ok, !!value, `${tier} ${key}`);
        if (!value) {
          assert.ok(r.code === "pro_required" || r.code === "extreme_required", `${tier} ${key} ${r.code}`);
          assert.match(r.message, /Add a licence key in Settings/);
        }
        continue;
      }
      if (value === Infinity) {
        const huge = evaluateGate(limits, key, infoFor(key, 100000));
        assert.equal(huge.ok, true, `${tier} ${key} unlimited`);
        assert.equal(huge.built, built);
        continue;
      }
      if (value > 0) {
        const under = evaluateGate(limits, key, infoFor(key, value - 1));
        assert.equal(under.ok, true, `${tier} ${key} under ${value}`);
      }
      const at = evaluateGate(limits, key, infoFor(key, value));
      assert.equal(at.ok, false, `${tier} ${key} at ${value}`);
      assert.match(at.message, /Add a licence key in Settings/);
    }
  }

  assert.match(evaluateGate(LIMITS.free, "missions").message, /Mission mode is part of Pro \(\$18\.99\/month\)/);
  assert.equal(evaluateGate(LIMITS.free, "missions").code, "pro_required");
  assert.match(evaluateGate(LIMITS.free, "council", { used: 5 }).message, /5 of 5 councils this month on Free/);
  assert.match(evaluateGate(LIMITS.free, "projects", { count: 3 }).message, /Free includes 3 projects/);
  assert.match(evaluateGate(LIMITS.free, "emailAccounts", { count: 1 }).message, /1 email account/);
  assert.match(evaluateGate(LIMITS.free, "connectedService", { count: 1 }).message, /1 connected service/);
  assert.match(evaluateGate(LIMITS.free, "deepResearch").message, /Deep Research is part of Pro/);
  assert.match(evaluateGate(LIMITS.free, "deepResearch").message, /Unlimited Deep Research is part of Extreme/);

  const proDeep = evaluateGate(LIMITS.pro, "deepResearchPerMonth", { used: 8 });
  assert.equal(proDeep.ok, false);
  assert.equal(proDeep.code, "extreme_required");
  assert.equal(evaluateGate(LIMITS.pro, "deepResearch", { used: 7 }).ok, true);
  assert.equal(evaluateGate(LIMITS.extreme, "deepResearch", { used: 100000 }).ok, true);

  assert.equal(evaluateGate(LIMITS.pro, "auditLog").ok, false);
  assert.equal(evaluateGate(LIMITS.pro, "auditLog").code, "extreme_required");
  assert.equal(evaluateGate(LIMITS.pro, "auditLog").built, false);
  assert.equal(evaluateGate(LIMITS.extreme, "auditLog").ok, true);
  assert.equal(evaluateGate(LIMITS.extreme, "auditLog").built, false);
  assert.equal(evaluateGate(LIMITS.extreme, "hostedBackground").built, false);
  assert.equal(evaluateGate(LIMITS.extreme, "budgetCap").ok, true);
  assert.equal(evaluateGate(LIMITS.free, "prioritySupport").code, "pro_required");
  assert.equal(evaluateGate(LIMITS.pro, "prioritySupport").ok, true);

  assert.equal(evaluateGate(LIMITS.pro, "aisPerCouncil", { count: 5 }).code, "extreme_required");
  assert.equal(evaluateGate(LIMITS.extreme, "aisPerCouncil", { count: 5 }).ok, true);
  assert.equal(evaluateGate(LIMITS.pro, "concurrent", { running: 3 }).code, "extreme_required");
  assert.equal(evaluateGate(LIMITS.pro, "concurrentRuns", { running: 2 }).ok, true);
  assert.equal(evaluateGate(LIMITS.free, "industryPacks", { count: 0 }).ok, false);
  assert.equal(evaluateGate(LIMITS.pro, "industryPacks", { count: 0 }).ok, true);
  assert.equal(evaluateGate(LIMITS.pro, "industryPacks", { count: 1 }).code, "extreme_required");
  assert.equal(evaluateGate(LIMITS.extreme, "teamSeats", { seats: 2 }).ok, true);
  assert.equal(evaluateGate(LIMITS.extreme, "teamSeats", { seats: 3 }).ok, false);

  assert.equal(LIMITS.pro.emailAccounts, 8);
  assert.equal(LIMITS.extreme.emailAccounts, 8);
  assert.equal(LIMITS.owner.emailAccounts, 8);
  assert.equal(evaluateGate(LIMITS.studio, "auditLog").ok, true);
  assert.equal(evaluateGate(LIMITS.owner, "deepResearch", { used: 100000 }).ok, true);
  assert.equal(LIMITS.studio.label, "Studio");

  const ws = fs.readFileSync(path.join(ROOT, "server", "plugins", "workspaces.js"), "utf8");
  assert.match(ws, /const STUDIO = new Set\(\["studio", "owner"\]\)/);
});

test("the comparison table is Free, Pro, and Extreme", () => {
  const table = publicCompare();
  assert.deepEqual(table.columns.map((c) => c.id), ["free", "pro", "extreme"]);
  assert.match(table.columns[1].price, /\$18\.99\/month/);
  assert.match(table.columns[1].price, /\$189\/year/);
  assert.match(table.columns[2].price, /\$29\.99\/month/);
  assert.match(table.columns[2].price, /\$299\/year/);
  assert.equal(table.minWidth, 390);
  const cell = (id) => table.rows.find((r) => r.id === id).cells;
  assert.deepEqual(cell("councils"), ["5 a month", "Unlimited", "Unlimited"]);
  assert.deepEqual(cell("ais"), ["4", "4", "8"]);
  assert.deepEqual(cell("runs"), ["1", "3", "8"]);
  assert.deepEqual(cell("missions"), ["No", "Yes", "Yes"]);
  assert.deepEqual(cell("deep"), ["No", "8 a month", "Unlimited"]);
  assert.deepEqual(cell("packs"), ["No", "1 pack", "All packs"]);
  assert.deepEqual(cell("audit"), ["No", "No", "Yes"]);
  assert.deepEqual(cell("team"), ["No", "No", "3"]);
  assert.deepEqual(cell("apps"), ["No", "3", "Unlimited"]);
  assert.deepEqual(cell("recipes"), ["No", "5", "Unlimited"]);
  assert.deepEqual(cell("hostedRuns"), ["No", "No", "Yes"]);
  assert.deepEqual(cell("hostedSchedules"), ["No", "No", "Yes"]);
  assert.deepEqual(cell("budget"), ["No", "No", "Yes"]);
  assert.deepEqual(cell("support"), ["No", "Yes", "Yes"]);
});

test("the check route answers every Free gate", async () => {
  const s = await startServer();
  try {
    for (const [key, meta] of Object.entries(FEATURES)) {
      const value = LIMITS.free[key];
      const n = meta.kind === "cap" && value !== Infinity ? value : 0;
      const r = await s.api("/billing-plans/check", { method: "POST", body: { feature: key, ...infoFor(key, n) } });
      if (meta.kind === "bool" ? value : n < value) {
        assert.equal(r.status, 200, `${key} ${r.text}`);
        assert.equal(r.json.ok, true);
        assert.equal(r.json.built, meta.built !== false);
      } else {
        assert.equal(r.status, 402, `${key} ${r.text}`);
        assert.ok(r.json.code === "pro_required" || r.json.code === "extreme_required");
      }
    }
    assert.equal((await s.api("/billing-plans/check", { method: "POST", body: { feature: "projects", count: 2 } })).status, 200);
    assert.equal((await s.api("/billing-plans/check", { method: "POST", body: {} })).status, 400);
    const five = [1, 2, 3, 4, 5].map((i) => ({ provider: "demo-nova", model: "nova-lite", n: i }));
    const council = await s.api("/council", { method: "POST", body: { prompt: "five members", members: five } });
    assert.equal(council.status, 402);
    assert.match(council.json.error, /AI/);
  } finally { await s.stop(); }
});

test("Pro upgrades to Extreme, drops back, and a lifetime row tagged Extreme stays Pro", async () => {
  const box = { tier: "pro", plan: "pro-monthly-1899" };
  const s = await startServer({
    cloud: { rpc: () => ({ ok: true, tier: box.tier, status: "active", email: "t@example.com", message: "ok", plan: box.plan }) },
    seed: seedKey,
  });
  try {
    const pro = await waitForTier(s, "pro");
    assert.equal(pro.json.license.plan, "pro-monthly-1899");
    assert.equal(pro.json.license.grandfathered, false);
    const audit = await s.api("/billing-plans/check", { method: "POST", body: { feature: "auditLog" } });
    assert.equal(audit.status, 402);
    assert.equal(audit.json.code, "extreme_required");
    assert.equal(audit.json.built, false);
    const deep = await s.api("/billing-plans/check", { method: "POST", body: { feature: "deepResearch", used: 8 } });
    assert.equal(deep.status, 402);
    assert.equal(deep.json.code, "extreme_required");
    const members = [1, 2, 3, 4, 5].map((i) => ({ provider: "demo-nova", model: "nova-lite", n: i }));
    const wide = await s.api("/council", { method: "POST", body: { prompt: "five on pro", members } });
    assert.equal(wide.status, 402);
    assert.equal(wide.json.code, "extreme_required");
    const runs = await s.api("/billing-plans/check", { method: "POST", body: { feature: "concurrentRuns", running: 3 } });
    assert.equal(runs.status, 402);

    box.tier = "extreme";
    box.plan = "extreme-monthly-2999";
    assert.equal((await s.api("/license/recheck", { method: "POST" })).status, 200);
    const extreme = await waitForTier(s, "extreme");
    assert.equal(extreme.json.license.plan, "extreme-monthly-2999");
    const opened = await s.api("/billing-plans/check", { method: "POST", body: { feature: "auditLog" } });
    assert.equal(opened.status, 200);
    assert.equal(opened.json.built, false);
    const hosted = await s.api("/billing-plans/check", { method: "POST", body: { feature: "hostedSchedules" } });
    assert.equal(hosted.status, 200);
    assert.equal(hosted.json.built, false);
    assert.equal((await s.api("/billing-plans/check", { method: "POST", body: { feature: "deepResearch", used: 100 } })).status, 200);
    assert.equal((await s.api("/council", { method: "POST", body: { prompt: "five on extreme", members } })).status, 202);
    assert.equal((await s.api("/billing-plans/check", { method: "POST", body: { feature: "concurrentRuns", running: 7 } })).status, 200);
    assert.equal((await s.api("/billing-plans/check", { method: "POST", body: { feature: "concurrentRuns", running: 8 } })).status, 402);

    box.tier = "pro";
    box.plan = "pro-yearly-189";
    await s.api("/license/recheck", { method: "POST" });
    const back = await waitForTier(s, "pro");
    assert.equal(back.json.license.plan, "pro-yearly-189");
    assert.equal((await s.api("/billing-plans/check", { method: "POST", body: { feature: "auditLog" } })).status, 402);
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "still pro" } })).status, 202);

    box.tier = "extreme";
    box.plan = "founder-lifetime";
    await s.api("/license/recheck", { method: "POST" });
    const life = await waitForTier(s, "pro");
    assert.equal(life.json.license.lifetime, true);
    assert.equal(life.json.license.tier, "pro");
    assert.match(life.json.license.message, /Pro for life/);
    const capped = await s.api("/billing-plans/check", { method: "POST", body: { feature: "deepResearch", used: 100 } });
    assert.equal(capped.status, 402);
    assert.equal(capped.json.code, "extreme_required");

    box.tier = "pro";
    box.plan = "pro-monthly-1599";
    await s.api("/license/recheck", { method: "POST" });
    const grand = await waitForTier(s, "pro");
    assert.equal(grand.json.license.grandfathered, true);
    assert.equal(grand.json.license.lifetime, false);
    assert.match(grand.json.license.message, /15\.99/);
    assert.match(grand.json.license.message, /stays/);
    assert.equal((await s.api("/billing-plans/check", { method: "POST", body: { feature: "missions" } })).status, 200);
  } finally { await s.stop(); }
});

test("a trial that is still running lapses to Free after a real wait", async () => {
  const endsAt = Date.now() + 15000;
  const s = await startServer({
    env: { CC_TRIAL: "1" },
    seed: (dir) => fs.writeFileSync(path.join(dir, "growth.trial.json"), JSON.stringify({ startedAt: endsAt - 14 * 86400000, endsAt })),
  });
  try {
    const first = await s.api("/state");
    if (first.json.license.reason === "trial") {
      assert.equal(first.json.license.tier, "pro");
      const left = endsAt - Date.now() + 400;
      await sleep(Math.max(400, left));
    } else {
      await sleep(400);
    }
    const after = await s.api("/state");
    assert.equal(after.json.license.tier, "free");
    assert.notEqual(after.json.license.reason, "trial");
    const mission = await s.api("/mission", { method: "POST", body: { goal: "after the trial" } });
    assert.equal(mission.status, 402);
    assert.match(mission.json.error, /Mission mode is part of Pro/);
  } finally { await s.stop(); }
});
