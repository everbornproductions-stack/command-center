// Free local models first, cheapest seller, off-peak, prompt-cache reads, and batch advice.
// Freebuff is refused. No real key and no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-savings-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { PROVIDERS, TEXT_PROVIDERS, estimateCostAt } = await import("../server/registry.js");
const { rank } = await import("../server/router.js");
const { cachedCallCost, cacheSystem, isBlockedFree, isLocalFree, batchNote } = await import("../server/savings.js");
const ledger = await import("../server/ledger.js");

const CAPS = { reasoning: 90, code: 92, writing: 90, research: 84, creative: 87, analysis: 90, math: 88, fast: 70 };
const LOCAL_CAPS = { reasoning: 70, code: 70, writing: 70, research: 70, creative: 70, analysis: 70, math: 70, fast: 70 };

function addProvider(p) {
  PROVIDERS[p.id] = p;
  if (!TEXT_PROVIDERS.some((x) => x.id === p.id)) TEXT_PROVIDERS.push(p);
}
function removeProvider(id) {
  delete PROVIDERS[id];
  const at = TEXT_PROVIDERS.findIndex((x) => x.id === id);
  if (at >= 0) TEXT_PROVIDERS.splice(at, 1);
}
function useKeys(map) {
  const c = store.ctx();
  c.secrets = map;
  c.docs.settings = { preferFree: false, uiMode: "expert" };
  c.health = {};
}

test("a connected local model is first on economy and yields on quality when the gap is large", () => {
  const local = {
    id: "c-ollama-test", name: "Ollama", vendor: "Custom", color: "#22D3EE", kind: "text", auth: "local", api: "openai",
    custom: true, noKey: true, baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null,
    models: [{ id: "llama-local", name: "Llama local", tier: "economy", in: 0, out: 0, caps: LOCAL_CAPS }],
  };
  addProvider(local);
  try {
    useKeys({ openai: { key: "sk-test-not-real" }, "c-ollama-test": { key: "no-key" } });
    const econ = rank({ capability: "writing", difficulty: 1, mode: "economy" });
    assert.equal(econ[0].provider, "c-ollama-test");
    assert.equal(econ[0].localFirst, true);
    const quality = rank({ capability: "writing", difficulty: 1, mode: "quality" });
    assert.equal(quality[0].model, "gpt-6.1-sol");
    assert.notEqual(quality[0].provider, "c-ollama-test");
  } finally { removeProvider("c-ollama-test"); }
});

test("the same model keeps the cheaper seller", () => {
  const seller = {
    id: "c-cheap-seller", name: "Cheap seller", vendor: "Custom", color: "#34D399", kind: "text", auth: "key", api: "openai",
    custom: true, baseUrl: "https://seller.example/v1", keyEnv: null,
    models: [{ id: "vendor/claude-sonnet-5-5", name: "Sonnet via seller", tier: "balanced", in: 0.4, out: 2, caps: { ...CAPS } }],
  };
  addProvider(seller);
  try {
    useKeys({ anthropic: { key: "sk-ant-test-not-real" }, "c-cheap-seller": { key: "seller-test-not-real" } });
    const cheap = rank({ capability: "writing", difficulty: 2, mode: "balanced" });
    assert.ok(cheap.some((m) => m.model === "vendor/claude-sonnet-5-5"));
    assert.ok(!cheap.some((m) => m.model === "claude-sonnet-5-5"));
    seller.models[0].in = 20;
    seller.models[0].out = 80;
    const native = rank({ capability: "writing", difficulty: 2, mode: "balanced" });
    assert.ok(native.some((m) => m.model === "claude-sonnet-5-5"));
    assert.ok(!native.some((m) => m.model === "vendor/claude-sonnet-5-5"));
  } finally { removeProvider("c-cheap-seller"); }
});

test("off-peak is already in the estimate, and a remote keyed custom model is not local", () => {
  const remote = {
    id: "c-remote-box", name: "Work gateway", vendor: "Custom", color: "#60A5FA", kind: "text", auth: "key", api: "openai",
    custom: true, baseUrl: "https://gateway.example/v1", keyEnv: null,
    models: [{ id: "gateway-model", name: "Gateway model", tier: "economy", in: 0, out: 0, caps: LOCAL_CAPS }],
  };
  addProvider(remote);
  try {
    useKeys({ deepseek: { key: "sk-test-not-real" } });
    const peak = rank({ capability: "writing", difficulty: 1, mode: "balanced", when: new Date("2026-10-20T02:30:00Z") });
    const off = rank({ capability: "writing", difficulty: 1, mode: "balanced", when: new Date("2026-10-20T12:30:00Z") });
    const a = peak.find((m) => m.model === "deepseek-v4-pro");
    const b = off.find((m) => m.model === "deepseek-v4-pro");
    assert.ok(a && b);
    assert.ok(b.estCost < a.estCost * 0.6, `${b.estCost} should be about half of ${a.estCost}`);
    assert.equal(isLocalFree({ provider: "c-remote-box", custom: true }, remote), false);
    useKeys({ deepseek: { key: "sk-test-not-real" }, "c-remote-box": { key: "remote-test-not-real" } });
    const mixed = rank({ capability: "writing", difficulty: 1, mode: "economy" });
    assert.notEqual(mixed[0].provider, "c-remote-box");
  } finally { removeProvider("c-remote-box"); }
});

test("a reported cache read costs less, and a live call is not priced as a batch", () => {
  const full = cachedCallCost("claude-sonnet-5-5", { input: 1000, output: 100, cacheRead: 0, cacheRate: "anthropic" });
  assert.equal(full, estimateCostAt("claude-sonnet-5-5", 1000, 100));
  const cached = cachedCallCost("claude-sonnet-5-5", { input: 1000, output: 100, cacheRead: 500, cacheRate: "anthropic" });
  assert.ok(cached < full);
  const openai = cachedCallCost("gpt-6.1-sol", { input: 1000, output: 100, cacheRead: 500, cacheRate: "openai" });
  const anthropic = cachedCallCost("gpt-6.1-sol", { input: 1000, output: 100, cacheRead: 500, cacheRate: "anthropic" });
  assert.ok(anthropic < openai);
  assert.equal(cacheSystem("short"), "short");
  const long = "x".repeat(4000);
  const marked = cacheSystem(long);
  assert.equal(marked[0].cache_control.type, "ephemeral");
  assert.equal(marked[0].text, long);
  useKeys({});
  store.ctx().ledger.length = 0;
  const hit = ledger.recordCall({ provider: "anthropic", model: "claude-sonnet-5-5", usage: { input: 8000, output: 200, cacheRead: 6000, cacheRate: "anthropic" } });
  const plain = ledger.recordCall({ provider: "anthropic", model: "claude-sonnet-5-5", usage: { input: 8000, output: 200 } });
  assert.ok(hit.cost < plain.cost);
  assert.equal(hit.cacheRead, 6000);
  assert.equal(plain.cacheRead, undefined);
  assert.equal(JSON.stringify(hit).includes("prompt"), false);
  const note = batchNote("openai", 0.02);
  assert.match(note, /half the live price/);
  assert.match(note, /pays the live price/);
  assert.equal(note.includes("\u2014"), false);
  assert.equal(batchNote("ollama", 0), null);
});

test("Freebuff is refused and never ranked", async () => {
  assert.equal(isBlockedFree({ name: "Freebuff", baseUrl: "http://127.0.0.1:9/v1" }), true);
  assert.equal(isBlockedFree({ id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" }), false);
  const blocked = {
    id: "c-freebuff", name: "Freebuff", vendor: "Custom", color: "#F87171", kind: "text", auth: "local", api: "openai",
    custom: true, noKey: true, baseUrl: "http://127.0.0.1:9/v1", keyEnv: null,
    models: [{ id: "x", name: "x", tier: "economy", in: 0, out: 0, caps: LOCAL_CAPS }],
  };
  addProvider(blocked);
  try {
    useKeys({ "c-freebuff": { key: "no-key" }, openai: { key: "sk-test-not-real" } });
    const ranked = rank({ capability: "writing", difficulty: 1, mode: "economy" });
    assert.ok(!ranked.some((m) => /freebuff/i.test(`${m.provider} ${m.providerName}`)));
  } finally { removeProvider("c-freebuff"); }

  const s = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    const pre = (await s.api("/providers/presets")).json.presets;
    const aider = pre.find((p) => p.id === "aider");
    const opencode = pre.find((p) => p.id === "opencode");
    assert.equal(aider.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(aider.noKey, true);
    assert.match(aider.note, /Ollama's address/);
    assert.equal(opencode.baseUrl, "http://127.0.0.1:4096/v1");
    assert.equal(opencode.noKey, true);
    assert.match(opencode.note, /4096/);
    assert.match(opencode.note, /OpenAI-compatible/);
    const byName = await s.api("/providers/custom", { method: "POST", body: { name: "Freebuff", baseUrl: "http://127.0.0.1:9/v1", noKey: true, models: ["x"] } });
    assert.equal(byName.status, 400);
    assert.match(byName.json.error, /Freebuff is not available/);
    const byUrl = await s.api("/providers/custom", { method: "POST", body: { name: "Local box", baseUrl: "https://api.freebuff.example/v1", noKey: true, models: ["x"] } });
    assert.equal(byUrl.status, 400);
    const saved = (await s.api("/providers/custom")).json.custom;
    assert.ok(!saved.some((c) => /freebuff/i.test(`${c.name} ${c.baseUrl}`)));
  } finally { await s.stop(); }
});

test("route preview shows the batch note, and the new words have no em-dash", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const guide = fs.readFileSync(path.join(ROOT, "docs", "USER-GUIDE.md"), "utf8");
  assert.match(app, /r\.cheaper\?\.batchNote/);
  assert.match(app, /No key needed \(Ollama, LM Studio, Aider, OpenCode\)/);
  assert.match(guide, /Freebuff is not used/);
  assert.match(guide, /pays the live price/);
  for (const file of ["server/savings.js", "web/app.js", "docs/USER-GUIDE.md", "server/plugins/providers.js"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes("\u2014"), false, file);
  }
});
