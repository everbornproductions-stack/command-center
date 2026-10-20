// User-added apps and AIs: learn a task type, send matching work, then let scores move it.
// No real key and no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-added-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const added = await import("../server/added-caps.js");
const { PROVIDERS, TEXT_PROVIDERS } = await import("../server/registry.js");
const { rank } = await import("../server/router.js");
const brain = await import("../server/brain.js");

function addProvider(p) {
  PROVIDERS[p.id] = p;
  if (!TEXT_PROVIDERS.some((x) => x.id === p.id)) TEXT_PROVIDERS.push(p);
}
function removeProvider(id) {
  delete PROVIDERS[id];
  const at = TEXT_PROVIDERS.findIndex((x) => x.id === id);
  if (at >= 0) TEXT_PROVIDERS.splice(at, 1);
}

test("a name teaches the task type, and a blank name stays even", () => {
  assert.ok(added.inferCapabilities({ name: "Local Coder", models: ["qwen-coder"] }).includes("code"));
  assert.ok(added.inferCapabilities({ name: "Aider", models: [] }).includes("code"));
  assert.ok(added.inferCapabilities({ name: "OpenCode", models: [] }).includes("code"));
  assert.deepEqual(added.inferCapabilities({ name: "Work gateway", models: ["acme-1"] }), []);
  const spec = added.capsFor(["code"]);
  assert.ok(spec.code > spec.writing);
  assert.equal(added.capsFor([]).code, added.capsFor([]).writing);
  assert.throws(() => added.cleanCapabilities(["nope"]), /Unknown task type/);
});

test("matching tasks go to the added AI, and scores can teach a new task", () => {
  const caps = added.capsFor(added.inferCapabilities({ name: "Local Coder", models: ["qwen-coder"] }));
  const local = {
    id: "c-added-coder", name: "Local Coder", vendor: "Custom", color: "#22D3EE", kind: "text", auth: "local", api: "openai",
    custom: true, noKey: true, baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null,
    models: [{ id: "qwen-coder", name: "qwen-coder", tier: "economy", in: 0, out: 0, caps }],
  };
  addProvider(local);
  try {
    const c = store.ctx();
    c.secrets = { openai: { key: "sk-test-not-real" }, "c-added-coder": { key: "no-key" } };
    c.docs.settings = { preferFree: false, uiMode: "expert" };
    c.health = {};
    brain.resetBrain();
    brain.saveBrainSettings({ on: true, shareOptIn: false });
    assert.equal(rank({ capability: "code", difficulty: 1, mode: "quality" })[0].model, "qwen-coder");
    assert.notEqual(rank({ capability: "writing", difficulty: 1, mode: "quality" })[0].model, "qwen-coder");
    for (let i = 0; i < 40; i++) brain.observe({ provider: "c-added-coder", model: "qwen-coder", capability: "writing", difficulty: 1, ok: true, score: 9.5, cost: 0, ms: 800 });
    assert.equal(rank({ capability: "writing", difficulty: 1, mode: "quality" })[0].model, "qwen-coder", "scores raise writing");
    assert.equal(rank({ capability: "code", difficulty: 1, mode: "quality" })[0].model, "qwen-coder", "code still matches");
    const strengths = added.learnedStrengths(local.models);
    assert.ok(strengths.some((s) => s.capability === "writing" && s.model === "qwen-coder"));
  } finally {
    removeProvider("c-added-coder");
    brain.resetBrain();
  }
});

test("the form can name task types, and a bad one is refused", async () => {
  const s = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    const bad = await s.api("/providers/custom", { method: "POST", body: { name: "Desk coder", baseUrl: "http://127.0.0.1:9/v1", noKey: true, models: "qwen-coder", capabilities: ["nope"] } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /Unknown task type/);
    const ok = await s.api("/providers/custom", { method: "POST", body: { name: "Desk research", baseUrl: "http://127.0.0.1:9/v1", noKey: true, models: "acme-1", capabilities: ["research"] } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(ok.json.provider.capabilities, ["research"]);
    assert.equal(ok.json.provider.capabilitiesSource, "chosen");
    const named = await s.api("/providers/custom", { method: "POST", body: { name: "Aider", baseUrl: "http://127.0.0.1:9/v1", noKey: true, models: "local" } });
    assert.equal(named.status, 200, JSON.stringify(named.json));
    assert.ok(named.json.provider.capabilities.includes("code"));
    assert.equal(named.json.provider.capabilitiesSource, "name");
    const st = await s.api("/state");
    const row = st.json.providers.find((p) => p.id === named.json.provider.id);
    assert.ok(row.models[0].base.code > row.models[0].base.writing);
    assert.ok(row.addedCapabilities.includes("code"));
  } finally { await s.stop(); }
});

test("the page says matching tasks and scores, with no em-dash", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const guide = fs.readFileSync(path.join(ROOT, "docs", "USER-GUIDE.md"), "utf8");
  assert.match(app, /sends matching tasks to it/);
  assert.match(app, /Scores from your jobs make the pick sharper/);
  assert.match(guide, /Scores from your jobs make the pick sharper/);
  for (const file of ["server/added-caps.js", "web/app.js", "docs/USER-GUIDE.md"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes("\u2014"), false, file);
  }
});
