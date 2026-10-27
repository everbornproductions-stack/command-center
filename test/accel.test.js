// Faster classifier path: provider choice, lazy loading, and the CPU fallback. No model is downloaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { flagView } from "../server/flags.js";
import { chooseAccel, sessionOptions, classifyAccel, accelStatus, getSession, detectNvidia, resetAccelCache } from "../server/perf/accel.js";
import { classify } from "../server/finish-router.js";
import { eagerSpecifiers } from "../server/perf/eager.js";
import { ADDONS } from "../web/perf/registry.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cc-accel-"));

test("the flag is off by default and the add-ons are listed", () => {
  assert.equal(flagView().onnx, false);
  assert.ok(ADDONS.find((a) => a.id === "onnx-classifier"));
  assert.ok(ADDONS.find((a) => a.id === "tensorrt"));
});

test("provider choice: CPU by default, Low Power forces CPU, High needs card and add-on", () => {
  assert.deepEqual(chooseAccel({}).providers, ["cpu"]);
  const all = { flag: true, onnxInstalled: true, trtInstalled: true, nvidia: true, wantHigh: true };
  assert.deepEqual(chooseAccel(all).providers, ["tensorrt", "cuda", "cpu"]);
  assert.equal(chooseAccel({ ...all, lowPower: true }).mode, "low");
  assert.deepEqual(chooseAccel({ ...all, lowPower: true }).providers, ["cpu"]);
  assert.deepEqual(chooseAccel({ ...all, nvidia: false }).providers, ["cpu"]);
  assert.deepEqual(chooseAccel({ ...all, trtInstalled: false }).providers, ["cpu"]);
  assert.equal(chooseAccel({ flag: true }).local, false);
  assert.ok(!/\u2014/.test(JSON.stringify(chooseAccel(all))));
});

test("session options tune the graph and cache it", () => {
  const o = sessionOptions(chooseAccel({ flag: true, onnxInstalled: true }), "D");
  assert.equal(o.graphOptimizationLevel, "all");
  assert.deepEqual(o.executionProviders, ["CPUExecutionProvider"]);
  assert.match(o.optimizedModelFilePath, /optimized\.onnx$/);
  assert.equal(o.trtOptions, undefined);
});

test("with the flag off or no add-on, the rules answer and nothing loads", async () => {
  const dir = tmp();
  try {
    let loads = 0;
    const input = { text: "hello there" };
    const r = await classifyAccel(input, { dataDir: dir, rules: classify, scorer: async () => ({ category: "photo", confidence: 0.99 }), loader: async () => { loads++; return {}; } });
    assert.equal(r.accel, "rules");
    assert.equal(loads, 0);
    process.env.CC_FLAG_ONNX = "1";
    const st = await accelStatus(dir);
    assert.equal(st.local, false);
    const r2 = await classifyAccel(input, { dataDir: dir, rules: classify, scorer: async () => ({ category: "photo", confidence: 0.99 }), loader: async () => { loads++; return {}; } });
    assert.equal(r2.accel, "rules");
    assert.equal(loads, 0);
  } finally { delete process.env.CC_FLAG_ONNX; resetAccelCache(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an installed model scores a weak answer, and a failing loader falls back to the rules", async () => {
  const dir = tmp();
  try {
    process.env.CC_FLAG_ONNX = "1";
    const mdir = path.join(dir, "addons", "onnx-classifier");
    fs.mkdirSync(mdir, { recursive: true });
    fs.writeFileSync(path.join(mdir, "model.onnx"), "x");
    fs.writeFileSync(path.join(dir, "addons", "index.json"), JSON.stringify({ "onnx-classifier": { installed: true, approved: true } }));
    const input = { text: "zzz qqq" };
    const fake = { InferenceSession: { create: async (file, opts) => ({ file, opts }) } };
    const good = await classifyAccel(input, { dataDir: dir, rules: classify, scorer: async () => ({ category: "photo", confidence: 0.9 }), loader: async () => fake });
    assert.equal(good.category, "photo");
    assert.equal(good.accel, "standard");
    assert.equal(good.decision, "direct");
    resetAccelCache();
    const bad = await classifyAccel(input, { dataDir: dir, rules: classify, scorer: async () => ({ category: "photo", confidence: 0.9 }), loader: async () => { throw new Error("no runtime"); } });
    assert.equal(bad.accel, "rules");
    assert.equal(bad.category, classify(input).category);
    resetAccelCache();
    assert.equal(await getSession(dir, chooseAccel({ flag: true, onnxInstalled: true }), { loader: async () => { throw new Error("x"); } }), null);
  } finally { delete process.env.CC_FLAG_ONNX; resetAccelCache(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the card check reads nvidia-smi once, and a missing tool means no card", async () => {
  resetAccelCache();
  let calls = 0;
  const run = (cmd, args, opts, cb) => { calls++; cb(new Error("not found"), ""); };
  assert.equal(await detectNvidia(run), false);
  await detectNvidia(run);
  assert.equal(calls, 1);
  resetAccelCache();
  assert.equal(await detectNvidia((c, a, o, cb) => cb(null, "GPU 0: NVIDIA RTX")), true);
  resetAccelCache();
});

test("startup files never import accel or onnx", () => {
  for (const f of ["server/index.js", "electron/main.js"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    assert.ok(!eagerSpecifiers(src).some((s) => /accel|onnxruntime/.test(s)), f);
    assert.ok(!/perf\/accel/.test(src), f);
  }
});