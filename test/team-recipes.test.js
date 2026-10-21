// Phase 61 add-on. Shared team recipes on Extreme. Phase 8 invites stay as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";

const KEY = "sk-test-TEAMKEY-9911";

test("free cannot open team spaces", async () => {
  const s = await startServer();
  try {
    const g = await s.api("/teamrecipes");
    assert.equal(g.status, 402);
    assert.equal(g.json.code, "extreme_required");
    assert.match(g.json.error, /Extreme/);
  } finally { await s.stop(); }
});

test("owner shares a recipe, the fifth extra person is over the cap, and no key comes back", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const made = await s.api("/workspaces", { method: "POST", body: { name: "Shop team" } });
    assert.equal(made.status, 200, made.text);
    const id = made.json.id || made.json.workspace?.id || (await s.api("/workspaces")).json.owned[0].id;
    assert.ok(id);
    for (let n = 1; n <= 4; n++) {
      const inv = await s.api(`/workspaces/${id}/members`, { method: "POST", body: { email: `person${n}@example.com`, role: "member" } });
      assert.equal(inv.status, 200, inv.text);
      assert.equal(inv.json.emailed, false);
      assert.ok(inv.json.link);
    }
    const shared = await s.api(`/teamrecipes/${id}/recipes`, { method: "POST", body: { pipelineId: "instagram-week", key: KEY } });
    assert.equal(shared.status, 200, shared.text);
    assert.equal(shared.text.includes(KEY), false);
    assert.equal(shared.json.seats, 5);
    assert.equal(shared.json.recipe.pipelineId, "instagram-week");
    assert.ok(shared.json.recipe.steps.length > 0);
    const fifth = await s.api(`/workspaces/${id}/members`, { method: "POST", body: { email: "person5@example.com", role: "viewer" } });
    assert.equal(fifth.status, 200, fifth.text);
    assert.equal(fifth.json.emailed, false);
    const over = await s.api(`/teamrecipes/${id}/recipes`, { method: "POST", body: { pipelineId: "instagram-week", key: KEY } });
    assert.equal(over.status, 402);
    assert.equal(over.json.code, "seat_cap");
    const view = await s.api("/teamrecipes");
    assert.equal(view.status, 200);
    const row = view.json.workspaces.find((w) => w.id === id);
    assert.equal(row.overCap, true);
    assert.equal(row.recipes.length, 1);
    assert.equal(JSON.stringify(view.json).includes(KEY), false);
    assert.match(view.json.note, /vault/);
    assert.match(view.json.note, /Extreme/);
    const src = fs.readFileSync(new URL("../server/team-spaces.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /\u2014|square/i);
    const ui = fs.readFileSync(new URL("../web/features/teamrecipes.js", import.meta.url), "utf8");
    assert.match(ui, /mountTeamSpaces/);
    assert.doesNotMatch(ui, /\u2014/);
  } finally { await s.stop(); }
});
