// Phase 62. Industry packs fill Marching orders. Nothing is sent. SSNs are stripped.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";

const SSN = "123-45-6789";

function seedTier(tier) {
  return (dir) => {
    fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({
      tier, status: "active", lastOkAt: Date.now(), checkedAt: Date.now(),
    }));
  };
}

test("free hides the prompt text and refuses a fill", async () => {
  const s = await startServer();
  try {
    const g = await s.api("/industries");
    assert.equal(g.status, 200);
    assert.equal(g.json.open, false);
    assert.equal(g.json.tier, "free");
    const blob = JSON.stringify(g.json);
    assert.equal(blob.includes("DRAFT ONLY"), false);
    assert.equal(blob.includes("SCF / credit-repair mode"), false);
    const fill = await s.api("/industries/fill", { method: "POST", body: { id: "cr-dispute", inputs: { client: "Ada", facts: "a late payment" } } });
    assert.equal(fill.status, 402);
    assert.equal(fill.json.code, "pro_required");
  } finally { await s.stop(); }
});

test("Pro can see the packs, and an owner fill stays a draft with the SSN removed", async () => {
  const pro = await startServer({ seed: seedTier("pro") });
  const owner = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const seen = await pro.api("/industries");
    assert.equal(seen.json.open, true);
    assert.equal(seen.json.tier, "pro");
    assert.ok(seen.json.packs.some((p) => p.id === "credit-repair" && p.scf));
    assert.match(JSON.stringify(seen.json), /DRAFT ONLY/);

    const facts = `Client said the account ${SSN} was not theirs. Born on 01/02/1990.`;
    const fill = await owner.api("/industries/fill", { method: "POST", body: { id: "cr-dispute", inputs: { client: "Ada", facts } } });
    assert.equal(fill.status, 200, fill.text);
    assert.equal(fill.json.sent, false);
    assert.equal(fill.json.draft, true);
    assert.equal(fill.json.scf, true);
    assert.match(fill.json.orders, /DRAFT ONLY/);
    assert.match(fill.json.orders, /\[CROA\]/);
    assert.match(fill.json.orders, /\[RESPA REVIEW\]/);
    assert.equal(fill.json.orders.includes(SSN), false);
    assert.ok(fill.json.redacted.includes("ssn") || fill.json.orders.includes("[REDACTED]"));
    assert.equal(owner.log.includes(SSN), false);
    const ins = await owner.api("/industries/fill", { method: "POST", body: { id: "ins-renewal", inputs: { client: "Bea", facts: "renews in June" } } });
    assert.match(ins.json.orders, /DRAFT ONLY/);
    assert.match(ins.json.orders, /\[RESPA REVIEW\]/);
    assert.equal(ins.json.sent, false);
  } finally {
    await pro.stop();
    await owner.stop();
  }
});

test("industry pages use plain words and do not send", () => {
  for (const rel of ["server/industry-packs.js", "server/plugins/industries.js", "web/features/industries.js"]) {
    const text = fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /\u2014/, rel);
  }
  const ui = fs.readFileSync(new URL("../web/features/industries.js", import.meta.url), "utf8");
  assert.match(ui, /mountIndustryPacks/);
  assert.doesNotMatch(ui, /fetch\(|\/publish\/post/);
});
