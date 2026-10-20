// Phase 2: savings receipt per job (R7). The running server in a temp data dir, demo AIs only (local mock,
// no real key or URL): a finished chat has a receipt priced against the flagship, the Credits tab totals and
// recent list include it, and the browser code exports a PNG and mounts on the Credits tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT, tmpDir } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("savings receipt: per run, totals, recent list", { timeout: 120000 }, async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/receipt/totals", { noToken: true })).status, 401);
    assert.equal((await s.api("/receipt/nothing-here")).status, 404, "no calls, no receipt");
    let t = (await s.api("/receipt/totals")).json;
    assert.equal(t.runs, 0); assert.equal(t.month.saved, 0);
    assert.deepEqual((await s.api("/receipt/recent")).json, []);

    await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a two-line tagline for a bakery.", provider: "demo-nova", model: "nova-lite" } })).status, 202);
    let m = null;
    for (let i = 0; i < 240 && !m; i++) { m = (await s.api("/missions")).json.find((x) => x.kind === "single" && x.status === "done"); if (!m) await sleep(250); }
    assert.ok(m, "the chat finished");

    const r = (await s.api(`/receipt/${m.id}`)).json;
    assert.equal(r.missionId, m.id);
    assert.ok(r.calls >= 1 && r.inTok > 0 && r.outTok > 0);
    assert.ok(r.actual > 0, "this run cost something");
    assert.ok(r.flagship?.model, "priced against a named flagship");
    assert.ok(r.flagshipCost >= r.actual, "the cheap demo model costs less than the flagship would");
    assert.ok(Math.abs(r.saved - Math.max(0, r.flagshipCost - r.actual)) < 1e-4);
    assert.ok(r.savedPct >= 0 && r.savedPct <= 100);
    assert.ok(r.byModel["nova-lite"]?.calls >= 1, "per-model breakdown");

    assert.equal(r.label, "Estimated, based on token counts and list prices.");
    assert.equal(r.baseline, r.flagshipCost);
    assert.equal(r.difference, r.saved);
    assert.ok(r.priceAsOf, "the run stores the price-table date");

    t = (await s.api("/receipt/totals")).json;
    assert.equal(t.runs, 1);
    assert.equal(t.label, "Estimated, based on token counts and list prices.");
    assert.ok(t.month.actual > 0 && t.month.flagship >= t.month.actual);
    assert.ok(Math.abs(t.month.saved - (t.month.flagship - t.month.actual)) < 1e-3);
    assert.equal(typeof t.day.saved, "number");
    assert.ok(t.day.saved <= t.month.saved + 1e-9 && t.month.saved <= t.allTime.saved + 1e-9);
    assert.ok(Array.isArray(t.byProvider) && t.byProvider.length >= 1, "per provider");
    assert.ok(Array.isArray(t.byProject) && t.byProject.length >= 1, "per project");
    const recent = (await s.api("/receipt/recent")).json;
    assert.equal(recent[0].missionId, m.id);
    assert.equal(recent[0].flagshipCost, r.flagshipCost);

    const ref = (await s.api("/receipt/reference")).json;
    assert.equal(ref.label, r.label);
    assert.equal(ref.current.auto, true, "demo mode with no chosen model uses the automatic flagship");
    assert.ok(ref.current.model, "a reference model is picked with no real keys");
    assert.equal((await s.api("/receipt/reference", { method: "POST", body: { model: "not-a-model" } })).status, 400);

    // A later price change, and a different reference model, leave this run's stored totals alone.
    assert.equal((await s.api("/pricing", { method: "POST", body: { model: r.flagship.model, in: 80, out: 80 } })).status, 200);
    const priced = (await s.api(`/receipt/${m.id}`)).json;
    assert.equal(priced.flagshipCost, r.flagshipCost);
    assert.equal(priced.saved, r.saved);
    assert.equal(priced.priceAsOf, r.priceAsOf);
    const afterPrice = (await s.api("/receipt/totals")).json;
    assert.equal(afterPrice.allTime.saved, t.allTime.saved);

    assert.equal((await s.api("/receipt/reference", { method: "POST", body: { model: "claude-haiku-5-5" } })).status, 200);
    const switched = (await s.api(`/receipt/${m.id}`)).json;
    assert.equal(switched.flagshipCost, r.flagshipCost);
    assert.equal(switched.priceAsOf, r.priceAsOf);
    assert.equal((await s.api("/receipt/reference")).json.current.model, "claude-haiku-5-5");
    assert.equal((await s.api("/receipt/reference")).json.current.auto, false);
  } finally { await s.stop(); }
});

test("receipt UI: PNG export, Credits tab panel, top bar, no em-dashes", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web/features/receipt.js"), "utf8");
  assert.match(ui, /toDataURL\("image\/png"\)/, "exports a PNG");
  assert.match(ui, /credits:\s*\{/, "registers a Credits tab panel");
  assert.match(ui, /Money saved/);
  assert.match(ui, /Estimated, based on token counts and list prices\./);
  assert.match(ui, /cc-money-saved/);
  assert.match(ui, /\.topbar \.top-right|\.top-right/);
  assert.match(ui, /createElement\("style"\)/);
  assert.match(ui, /By project/);
  assert.match(ui, /By provider/);
  assert.match(ui, /save summary as image/);
  assert.match(ui, /manual/);
  assert.match(ui, /free/);
  const app = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");
  assert.match(app, /renderExtras\("credits", "#credits-extras"\)/, "the Credits tab mounts feature panels");
  for (const f of ["web/app.js", "web/index.html", "web/nav.js", "web/styles.css"]) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("cc-money-saved"), `${f} is not edited to mount Money saved`);
  }
  for (const f of ["server/plugins/receipt.js", "server/receipt-math.js", "web/features/receipt.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});

test("you saved counter: this month, all time, estimate label, and tooltip", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web/features/receipt.js"), "utf8");
  assert.match(ui, /You saved/);
  assert.match(ui, /this month/);
  assert.match(ui, /All time/);
  assert.match(ui, /Estimate/);
  assert.match(ui, /data-cc-ms="month"/);
  assert.match(ui, /data-cc-ms="all"/);
  assert.match(ui, /t\.month\?\.saved/);
  assert.match(ui, /t\.allTime\?\.saved/);
  assert.match(ui, /most expensive flagship/);
  assert.match(ui, /free or local/);
  assert.match(ui, /prompt-cache/);
  assert.match(ui, /cheaper seller/);
  assert.match(ui, /billed as a batch/);
  assert.match(ui, /pays the live price/);
  assert.match(ui, /cc-ms-tip/);
  assert.match(ui, /\.title = SAVED_TIP/);
  assert.ok(!ui.includes("—"), "the counter copy has no em-dash");
  assert.ok(!ui.includes("–"), "the counter copy has no en-dash");
});

test("money saved: fixed tokens, reference model, frozen prices, projects, manual and free", async () => {
  const DIR = tmpDir("cc-receipt-unit-");
  const savedEnv = {};
  process.env.CC_DATA_DIR = DIR;
  const store = await import("../server/store.js");
  store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
  const registry = await import("../server/registry.js");
  for (const p of Object.values(registry.PROVIDERS)) {
    if (!p.keyEnv || savedEnv[p.keyEnv]) continue;
    savedEnv[p.keyEnv] = process.env[p.keyEnv];
    delete process.env[p.keyEnv];
  }
  const ledger = await import("../server/ledger.js");
  const receipt = await import("../server/plugins/receipt.js");
  const c = store.ctx();
  c.vaultLoaded = true;
  const key = "unit-test-not-a-real-key";
  const keys = (map) => { c.secrets = map; };
  const reset = () => {
    c.ledger.length = 0;
    store.putDoc("pricing", {});
    store.putDoc("receipt.settings", { model: null });
    store.putDoc("receipt.frozen", { lines: {} });
  };
  const call = ({ provider, model, input, output, cost, missionId, manual, free }) => ledger.recordCall({
    provider, model, missionId,
    usage: { input, output, cost, manual: !!manual, free: !!free },
  });
  try {
    reset();
    keys({ google: { key } });
    assert.equal(receipt.referenceModel().id, "gemini-4-argon", "default is the most expensive flagship with a key");
    assert.equal(receipt.referenceModel().auto, true);
    keys({ google: { key }, openai: { key } });
    assert.equal(receipt.referenceModel().id, "gpt-6-astra", "openai's flagship costs more than gemini's");
    keys({});
    assert.equal(receipt.referenceModel().id, "gpt-6-astra", "with no keys, the most expensive flagship still prices the receipt");

    keys({ openai: { key } });
    reset();
    // 1,000,000 input tokens. Haiku list price is $0.10. GPT-6 Astra is $10. Saved $9.90.
    const first = call({ provider: "anthropic", model: "claude-haiku-5-5", input: 1_000_000, output: 0, cost: 0.1, missionId: "run-1" });
    assert.equal(first.savings.reference, "gpt-6-astra");
    assert.equal(first.savings.actual, 0.1);
    assert.equal(first.savings.baseline, 10);
    assert.equal(first.savings.saved, 9.9);
    assert.equal(first.savings.difference, 9.9);
    assert.equal(first.savings.priceAsOf, receipt.BUILTIN_PRICE_DATE);
    assert.deepEqual(first.savings.rates, { in: 10, out: 50 });

    receipt.setReferenceModel("claude-opus-5-5");
    const second = call({ provider: "anthropic", model: "claude-haiku-5-5", input: 1_000_000, output: 0, cost: 0.1, missionId: "run-2" });
    assert.equal(second.savings.reference, "claude-opus-5-5");
    assert.equal(second.savings.baseline, 4, "opus is $4 per 1M input");
    assert.equal(second.savings.saved, 3.9);
    assert.equal(first.savings.baseline, 10, "the earlier run keeps the reference it was stored with");
    assert.equal(receipt.receiptFor("run-1").flagshipCost, 10);
    assert.equal(receipt.receiptFor("run-1").difference, 9.9);

    registry.setPricing("gpt-6-astra", { in: 30, out: 30 });
    receipt.setReferenceModel("auto");
    assert.equal(first.savings.baseline, 10);
    assert.equal(first.savings.priceAsOf, receipt.BUILTIN_PRICE_DATE);
    const third = call({ provider: "anthropic", model: "claude-haiku-5-5", input: 1_000_000, output: 0, cost: 0.1, missionId: "run-3" });
    assert.equal(third.savings.reference, "gpt-6-astra");
    assert.equal(third.savings.baseline, 30, "new runs use the new list price");
    assert.equal(third.savings.saved, 29.9);
    assert.notEqual(third.savings.priceAsOf, first.savings.priceAsOf);
    assert.equal(third.savings.priceAsOf, new Date().toISOString().slice(0, 10));
    let t = await receipt.totals();
    assert.equal(t.allTime.saved, 43.7);
    assert.equal(t.allTime.actual, 0.3);
    assert.equal(t.allTime.baseline, 44);
    assert.equal(receipt.receiptFor("run-1").flagshipCost, 10, "a later price change leaves the old total unchanged");

    reset();
    keys({ openai: { key }, anthropic: { key } });
    receipt.setReferenceModel("gpt-6-astra");
    c.store.saveMission({ id: "run-a", projectId: "bakery", kind: "single", prompt: "a", status: "done", startedAt: Date.now(), cost: 0, tasks: [] });
    c.store.saveMission({ id: "run-b", projectId: "studio", kind: "single", prompt: "b", status: "done", startedAt: Date.now(), cost: 0, tasks: [] });
    const { saveProject } = await import("../server/projects.js");
    saveProject({ id: "bakery", name: "Bakery", categories: [] });
    saveProject({ id: "studio", name: "Studio", categories: [] });
    call({ provider: "anthropic", model: "claude-haiku-5-5", input: 1_000_000, output: 0, cost: 0.1, missionId: "run-a" });
    call({ provider: "openai", model: "gpt-6-luna", input: 0, output: 1_000_000, cost: 0.5, missionId: "run-b" });
    t = await receipt.totals();
    const anthropic = t.byProvider.find((p) => p.provider === "anthropic");
    const openai = t.byProvider.find((p) => p.provider === "openai");
    assert.equal(anthropic.actual, 0.1);
    assert.equal(anthropic.saved, 9.9);
    assert.equal(openai.actual, 0.5);
    assert.equal(openai.saved, 49.5);
    assert.equal(t.byProject.find((p) => p.projectId === "bakery").saved, 9.9);
    assert.equal(t.byProject.find((p) => p.name === "Studio").saved, 49.5);
    assert.equal(t.allTime.saved, 59.4);
    assert.equal(t.allTime.actual, 0.6);

    const dayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const old = c.ledger.find((e) => e.missionId === "run-a");
    old.ts = monthStart - 40 * 86400000;
    t = await receipt.totals();
    assert.equal(t.day.saved, 49.5, "today is only the studio run");
    assert.ok(old.ts < monthStart && old.ts < dayStart);
    assert.equal(t.month.saved, 49.5, "last month is outside this month");
    assert.equal(t.allTime.saved, 59.4, "all time still has both runs");

    reset();
    keys({ openai: { key } });
    const manual = call({ provider: "openai", model: "gpt-6-luna", input: 5_000_000, output: 5_000_000, cost: 9, missionId: "run-m", manual: true });
    assert.equal(manual.manual, true);
    assert.equal(manual.cost, 0);
    assert.equal(manual.savings.actual, 0);
    assert.equal(manual.savings.baseline, 0);
    assert.equal(manual.savings.saved, 0);
    assert.equal(manual.savings.manual, true);
    const free = call({ provider: "google", model: "gemini-3.5-flash-lite", input: 1_000_000, output: 0, cost: 4, missionId: "run-f", free: true });
    assert.equal(free.free, true);
    assert.equal(free.cost, 0);
    assert.equal(free.savings.free, true);
    assert.equal(free.savings.actual, 0);
    assert.equal(free.savings.baseline, 10, "free tokens are still priced at the reference model");
    assert.equal(free.savings.saved, 10);
    t = await receipt.totals();
    assert.equal(t.manual.calls, 1);
    assert.equal(t.manual.actual, 0);
    assert.equal(t.free.calls, 1);
    assert.equal(t.free.actual, 0);
    assert.equal(t.free.saved, 10);
    assert.equal(t.allTime.actual, 0, "manual and free rows add no spend");
    assert.equal(t.allTime.saved, 10, "only the free row's baseline counts as saved");
    const manualReceipt = receipt.receiptFor("run-m");
    assert.equal(manualReceipt.actual, 0);
    assert.equal(manualReceipt.manual, 1);
    assert.equal(receipt.receiptFor("run-f").free, 1);

    reset();
    c.ledger.push({ ts: Date.now(), kind: "call", provider: "anthropic", model: "claude-haiku-5-5", missionId: "legacy", inTok: 1_000_000, outTok: 0, cost: 0.1, free: false });
    const frozen = (await receipt.totals()).allTime.saved;
    assert.equal(frozen, 9.9);
    registry.setPricing("gpt-6-astra", { in: 99, out: 99 });
    assert.equal((await receipt.totals()).allTime.saved, frozen, "a line frozen on first read does not move when prices change");
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("you saved counter: month and all time follow free, local, cache, batch, and a cheaper seller", async () => {
  const DIR = tmpDir("cc-saved-counter-");
  process.env.CC_DATA_DIR = DIR;
  const store = await import("../server/store.js");
  store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
  const ledger = await import("../server/ledger.js");
  const receipt = await import("../server/plugins/receipt.js");
  const c = store.ctx();
  c.vaultLoaded = true;
  c.secrets = { openai: { key: "unit-test-not-a-real-key" } };
  c.ledger.length = 0;
  store.putDoc("pricing", {});
  store.putDoc("receipt.settings", { model: "gpt-6-astra" });
  store.putDoc("receipt.frozen", { lines: {} });
  const call = (usage, missionId) => ledger.recordCall({
    provider: usage.provider, model: usage.model, missionId, usage,
  });
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

  const free = call({ provider: "google", model: "gemini-3.5-flash-lite", input: 1_000_000, output: 0, free: true }, "free-run");
  assert.equal(free.savings.actual, 0);
  assert.equal(free.savings.baseline, 10);
  assert.equal(free.savings.saved, 10, "a free run saves the reference list price");

  const local = call({ provider: "ollama", model: "llama-local", input: 1_000_000, output: 0, cost: 0 }, "local-run");
  assert.equal(local.cost, 0);
  assert.equal(local.savings.free, false);
  assert.equal(local.savings.actual, 0);
  assert.equal(local.savings.saved, 10, "a local $0 run saves the reference list price");

  const cached = call({
    provider: "anthropic", model: "claude-haiku-5-5", input: 1_000_000, output: 0,
    cacheRead: 1_000_000, cacheRate: "anthropic",
  }, "cache-run");
  assert.ok(Math.abs(cached.cost - 0.01) < 1e-6, "a reported prompt-cache read is priced at the cache rate");
  assert.equal(cached.savings.baseline, 10);
  assert.ok(Math.abs(cached.savings.saved - 9.99) < 1e-6);

  const live = call({ provider: "anthropic", model: "claude-haiku-5-5", input: 1_000_000, output: 0, cost: 0.1 }, "live-run");
  const batch = call({ provider: "anthropic", model: "claude-haiku-5-5", input: 1_000_000, output: 0, cost: 0.05 }, "batch-run");
  assert.ok(batch.savings.saved > live.savings.saved, "a batch bill lower than the live price saves more");
  assert.equal(batch.savings.saved, 9.95);
  assert.equal(live.savings.saved, 9.9);

  const pricey = call({ provider: "anthropic", model: "claude-opus-5-5", input: 1_000_000, output: 0, cost: 4 }, "pricey-seller");
  const cheap = call({ provider: "openrouter", model: "claude-haiku-5-5", input: 1_000_000, output: 0, cost: 0.1 }, "cheap-seller");
  assert.ok(cheap.savings.saved > pricey.savings.saved, "a cheaper seller for the same tokens saves more against the reference model");
  assert.equal(cheap.savings.saved, 9.9);
  assert.equal(pricey.savings.saved, 6);

  let t = await receipt.totals();
  assert.equal(t.label, "Estimated, based on token counts and list prices.");
  assert.equal(t.month.saved, t.allTime.saved);
  // 10 free + 10 local + 9.99 cache + 9.9 live + 9.95 batch + 6 pricey seller + 9.9 cheap seller.
  assert.equal(t.month.saved, 65.74, "this month adds free, local, cache, batch, live, and both sellers");

  const old = c.ledger.find((e) => e.missionId === "live-run");
  old.ts = monthStart - 40 * 86400000;
  t = await receipt.totals();
  assert.equal(t.month.saved, 55.84, "a run from last month is outside this month");
  assert.equal(t.allTime.saved, 65.74, "all time still includes that run");
  assert.ok(t.month.saved < t.allTime.saved);
});
