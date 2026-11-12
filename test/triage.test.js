// Triage with four gates (ambiguous, large, execution, stakes): the heuristic's tiers, the model answer checks,
// rank() honouring the tier and a provider-only list, and the price ladder for new and custom providers.
// Local registry only. No real key or URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-triage-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const { rank, availableModels, heuristicClassify, cleanClassification, triageOf, tierName, tieBreak, TIER_TUNING } = await import("../server/router.js");
const { PROVIDERS, TEXT_PROVIDERS, tierByPrice, setLivePrices } = await import("../server/registry.js");
const { customModels } = await import("../server/plugins/providers.js");

const EM = /[—]/;

test("tierName names the four tiers and clamps anything else", () => {
  assert.equal(tierName(1), "trivial");
  assert.equal(tierName(2), "standard");
  assert.equal(tierName(3), "hard");
  assert.equal(tierName(4), "top");
  assert.equal(tierName(9), "top");
  assert.equal(tierName(-3), "trivial");
  assert.equal(tierName("nope"), "standard");
});

test("heuristicClassify: four gates and a plain reason", () => {
  const rename = heuristicClassify("Rename the variable `cnt` to `count` in utils.js");
  assert.equal(rename.difficulty, 1, rename.reason);
  assert.equal(rename.gates.execution, true);
  assert.equal(rename.source, "heuristic");

  const feature = heuristicClassify("Add a dark mode toggle to settings.js that saves the choice in localStorage");
  assert.equal(feature.difficulty, 2, feature.reason);
  assert.equal(feature.reason, "clear single-file task");

  const wide = heuristicClassify(`Refactor the entire sign-in flow across all services so sessions refresh end-to-end. ${"Update the API, the web client, the phone app and the docs to match, and keep old tokens working for a week. ".repeat(14)}`);
  assert.ok(wide.difficulty >= 3, `cross-system gave ${wide.difficulty}`);
  assert.equal(wide.gates.large, true);

  const pay = heuristicClassify("figure out why payments sometimes fail across the whole checkout and fix it");
  assert.equal(pay.difficulty, 4, pay.reason);
  assert.equal(pay.gates.stakes, true);
  assert.equal(pay.gates.ambiguous, true);
  assert.equal(pay.gates.large, true);
  assert.match(pay.reason, /open-ended/);
  assert.match(pay.reason, /high stakes/);

  // a short question stays trivial; one stakes word on a tiny edit is hard, not top
  assert.equal(heuristicClassify("What is the capital of France?").difficulty, 1);
  assert.equal(heuristicClassify("Rename the delete button label to Remove").difficulty, 3);
  // the old callers' shape is still there
  for (const r of [rename, feature, wide, pay]) {
    assert.ok(["reasoning", "code", "writing", "research", "creative", "analysis", "math"].includes(r.capability));
    assert.equal(typeof r.needWeb, "boolean");
    assert.deepEqual(Object.keys(r.gates).sort(), ["ambiguous", "execution", "large", "stakes"]);
    assert.doesNotMatch(r.reason, EM);
  }
  assert.equal(heuristicClassify(undefined).difficulty, 1, "no prompt does not throw");
});

test("cleanClassification: clamps the model's difficulty, fills missing gates, keeps stakes, strips dashes", () => {
  const h = heuristicClassify("Delete the old invoices table in production");
  const c = cleanClassification({ capability: "code", difficulty: 9, gates: { ambiguous: "yes", stakes: false }, summary: "drop a table — now", reason: "risky — cannot undo" }, h, "mock-model");
  assert.equal(c.difficulty, 4);
  assert.equal(c.gates.ambiguous, h.gates.ambiguous, "a non-boolean gate falls back to the heuristic");
  assert.equal(c.gates.stakes, true, "a stakes word in the prompt keeps stakes on");
  assert.doesNotMatch(c.reason + c.summary, EM);
  assert.equal(c.source, "mock-model");
  assert.equal(cleanClassification({ capability: "writing", difficulty: 0 }, { difficulty: 2, gates: {} }, "m").difficulty, 2, "0 is not a level");
  assert.equal(cleanClassification({ capability: "writing", difficulty: -5 }, { difficulty: 2, gates: {} }, "m").difficulty, 1);
  assert.equal(cleanClassification({ capability: "nope", difficulty: 2 }, h, "m"), null);
  assert.equal(cleanClassification({ capability: "fast", difficulty: 2 }, h, "m"), null);
  assert.equal(cleanClassification(null, h, "m"), null);
  // the model's own gates set a floor; gates filled in from the heuristic do not
  const plain = { difficulty: 2, gates: { ambiguous: true, large: true, execution: false, stakes: true } };
  assert.equal(cleanClassification({ capability: "code", difficulty: 1, gates: { ambiguous: true, large: true } }, plain, "m").difficulty, 4);
  assert.equal(cleanClassification({ capability: "code", difficulty: 1, gates: { stakes: true } }, plain, "m").difficulty, 3);
  assert.equal(cleanClassification({ capability: "code", difficulty: 2 }, plain, "m").difficulty, 2, "no gates from the model: its difficulty stands");
  const noReason = cleanClassification({ capability: "writing", difficulty: 1 }, heuristicClassify("hi"), "m");
  assert.ok(noReason.reason.length > 0);
});

test("triageOf: tier, gates and a note; a caller's own task type gets the heuristic's gates", () => {
  const t = triageOf(heuristicClassify("figure out why payments sometimes fail across the whole checkout and fix it"), { note: "Grok had no model ready, so another AI took it" });
  assert.equal(t.tier, "top");
  assert.equal(t.difficulty, 4);
  assert.match(t.reason, /; Grok had no model ready/);
  assert.equal(t.gates.stakes, true);
  const given = triageOf({ capability: "writing", difficulty: 2 }, { prompt: "Write a tagline for a bakery." });
  assert.equal(given.tier, "standard");
  assert.equal(given.capability, "writing");
  assert.equal(typeof given.gates.ambiguous, "boolean");
  assert.ok(given.reason);
  assert.equal(triageOf(null).tier, "trivial", "nothing to go on: an empty prompt is trivial");
});

test("tierByPrice: one, two and four models; unpriced models keep their tier", () => {
  assert.deepEqual(tierByPrice([{ id: "a", tier: "economy", in: 1, out: 2 }]).map((m) => m.tier), ["balanced"]);
  assert.deepEqual(tierByPrice([{ id: "cheap", in: 0.1, out: 0.4 }, { id: "dear", in: 5, out: 25 }]).map((m) => m.tier), ["economy", "flagship"]);
  const four = tierByPrice([{ id: "a", in: 10, out: 30 }, { id: "b", in: 3, out: 15 }, { id: "c", in: 1, out: 4 }, { id: "d", in: 0.1, out: 0.4 }]);
  assert.deepEqual(four.map((m) => m.tier), ["flagship", "balanced", "balanced", "economy"]);
  const mixed = tierByPrice([{ id: "a", in: 10, out: 30 }, { id: "x", tier: "balanced", in: null, out: null }, { id: "d", in: 0.1, out: 0.4 }]);
  assert.deepEqual(mixed.map((m) => m.tier), ["flagship", "balanced", "economy"]);
  assert.deepEqual(tierByPrice([{ id: "a", in: 1, out: 1 }, { id: "b", in: 1, out: 1 }]).map((m) => m.tier), ["balanced", "balanced"], "one price for all is not a ladder");
  assert.deepEqual(tierByPrice([]), []);
  assert.deepEqual(tierByPrice(null), []);
  const src = [{ id: "a", in: 1, out: 1, tier: "economy" }];
  tierByPrice(src);
  assert.equal(src[0].tier, "economy", "the input is not changed");
});

// A test-only provider with two models of equal skill: a flagship and an economy one.
const CAPS = { reasoning: 80, code: 80, writing: 80, research: 80, creative: 80, analysis: 80, math: 80, fast: 70 };
function addProvider(id, models) {
  const p = { id, name: `Test ${id}`, vendor: "Custom", color: "#888888", kind: "text", auth: "key", api: "openai", custom: true, baseUrl: "https://example.invalid/v1", keyEnv: null, links: {}, statusApi: null, models };
  PROVIDERS[id] = p;
  const at = TEXT_PROVIDERS.findIndex((x) => x.id === id);
  if (at >= 0) TEXT_PROVIDERS[at] = p; else TEXT_PROVIDERS.push(p);
  const c = store.ctx();
  c.secrets[id] = { key: "test-not-a-real-key" };
  c.health[id] = { status: "green", detail: "ok", checkedAt: Date.now() };
  return p;
}
function setup() {
  const c = store.ctx();
  c.secrets.openai = { key: "sk-test-not-a-real-key" };
  c.health.openai = { status: "green", detail: "ok", checkedAt: Date.now() };
  c.docs.settings = { uiMode: "expert", preferFree: false, defaultMode: "balanced" };
  addProvider("x", [
    { id: "x-big", name: "X Big", tier: "flagship", in: 5, out: 25, caps: CAPS, default: true },
    { id: "x-small", name: "X Small", tier: "economy", in: 0.1, out: 0.4, caps: CAPS },
  ]);
}

test("rank: providers keeps only that provider; difficulty 1 favours economy, 4 favours flagship", () => {
  setup();
  const all = rank({ capability: "writing", difficulty: 2, mode: "balanced" });
  assert.ok(all.some((m) => m.provider !== "x"), "other providers are ranked without the option");
  const onlyX = rank({ capability: "writing", difficulty: 2, mode: "balanced", providers: ["x"] });
  assert.deepEqual([...new Set(onlyX.map((m) => m.provider))], ["x"]);
  assert.equal(onlyX.length, 2);
  assert.deepEqual(rank({ capability: "writing", difficulty: 2, providers: ["no-such-provider"] }), []);
  assert.ok(rank({ capability: "writing", difficulty: 2, providers: [] }).some((m) => m.provider !== "x"), "an empty list means no limit");

  const easy = rank({ capability: "writing", difficulty: 1, mode: "balanced", providers: ["x"] });
  assert.equal(easy[0].model, "x-small", "trivial: the economy model first");
  assert.equal(easy[0].modelTier, "economy");
  assert.equal(easy[0].tierBonus, TIER_TUNING.economyBonus);
  const top = rank({ capability: "writing", difficulty: 4, mode: "balanced", providers: ["x"] });
  assert.equal(top[0].model, "x-big", "top: the flagship first");
  assert.equal(top[0].tierBonus, TIER_TUNING.flagshipBonus);
  // standard and hard keep the old scoring: no tier bonus at all
  for (const d of [2, 3]) for (const m of rank({ capability: "writing", difficulty: d, providers: ["x"] })) assert.equal(m.tierBonus, undefined, `difficulty ${d}`);
});

test("tieBreak: equal scores go to the cheaper tier, or the bigger one when stakes are high", () => {
  const big = { modelTier: "flagship", estCost: 0.03 }, mid = { modelTier: "balanced", estCost: 0.01 }, same = { modelTier: "balanced", estCost: 0.001 };
  assert.ok(tieBreak(big, mid) > 0, "cheaper first");
  assert.ok(tieBreak(mid, big) < 0);
  assert.ok(tieBreak(big, mid, true) < 0, "stakes: flagship first");
  assert.equal(tieBreak(mid, same), 0, "same tier keeps today's order");
  assert.equal(tieBreak({ modelTier: undefined }, mid), 0);
});

test("custom and new providers get a price ladder; built-in tiers do not change", () => {
  setup();
  const builtIn = Object.fromEntries(availableModels().filter((m) => m.provider === "openai").map((m) => [m.model, m.tier]));
  // no known prices: the first model balanced, the rest economy (the old default)
  const plain = customModels({ models: ["c-one", "c-two", "c-three"] });
  assert.deepEqual(plain.map((m) => m.tier), ["balanced", "economy", "economy"]);
  assert.deepEqual(plain.map((m) => [m.in, m.out]), [[0, 0], [0, 0], [0, 0]]);
  // live prices for some of them: those get a ladder, the unpriced one keeps its default
  setLivePrices({ "c-one": { in: 0.2, out: 0.6 }, "c-two": { in: 8, out: 24 } });
  try {
    const priced = customModels({ models: ["c-one", "c-two", "c-three"] });
    assert.deepEqual(priced.map((m) => m.tier), ["economy", "flagship", "economy"]);
    assert.equal(priced[1].in, 8);
    // a registered custom provider reads the live ladder in availableModels
    addProvider("y", plain.map((m) => ({ ...m, caps: CAPS })));
    const rows = Object.fromEntries(availableModels().filter((m) => m.provider === "y").map((m) => [m.model, m.tier]));
    assert.deepEqual(rows, { "c-one": "economy", "c-two": "flagship", "c-three": "economy" });
    const after = Object.fromEntries(availableModels().filter((m) => m.provider === "openai").map((m) => [m.model, m.tier]));
    assert.deepEqual(after, builtIn, "built-in tiers are untouched");
  } finally { setLivePrices({}); }
});

test("model-watch rows: a saved price places the new model on the provider's ladder", () => {
  setup();
  const c = store.ctx();
  const donor = PROVIDERS.x.models.find((m) => m.id === "x-small");
  c.docs["modelwatch.state"] = { accepted: [
    { provider: "x", hide: "x-small", model: { id: "x-small-2", name: "X Small 2", in: 9, out: 40 } },
  ] };
  try {
    const row = availableModels().find((m) => m.model === "x-small-2");
    assert.ok(row, "the accepted row is listed");
    assert.equal(row.tier, "flagship", "priced above the flagship, so it is the flagship now");
    c.docs["modelwatch.state"] = { accepted: [{ provider: "x", hide: "x-small", model: { id: "x-small-3", name: "X Small 3" } }] };
    assert.equal(availableModels().find((m) => m.model === "x-small-3").tier, donor.tier, "no price: the replaced model's tier");
  } finally { delete c.docs["modelwatch.state"]; }
});
