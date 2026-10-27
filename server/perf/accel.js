// Optional faster classifier path (flag_onnx). Nothing here loads at startup.
// The default is the plain CPU rules in finish-router.js. The ONNX tool and the
// NVIDIA tool are add-ons that download only after an Install click. If a tool
// is missing, fails to load, or Low Power mode is on, the CPU rules answer.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { flagOn } from "../flags.js";
import { listAddons } from "./addons.js";
import { perfState } from "./power.js";
import { labelOf, THRESHOLDS } from "../finish-router.js";

export const MODES = ["standard", "high", "low"];

// Pure choice. Returns the mode, the provider order and a plain reason.
export function chooseAccel({ flag = false, lowPower = false, onnxInstalled = false, trtInstalled = false, nvidia = false, wantHigh = false } = {}) {
  const cpu = ["cpu"];
  if (!flag) return { mode: "standard", providers: cpu, local: false, reason: "The faster path is off. The built-in rules answer." };
  if (lowPower) return { mode: "low", providers: cpu, local: onnxInstalled, reason: "Low Power is on. This uses the CPU only." };
  if (!onnxInstalled) return { mode: "standard", providers: cpu, local: false, reason: "The local classifier is not installed. The built-in rules answer." };
  if (wantHigh && trtInstalled && nvidia) return { mode: "high", providers: ["tensorrt", "cuda", "cpu"], local: true, reason: "High Performance uses your NVIDIA card, with the CPU as the fallback." };
  if (wantHigh && !nvidia) return { mode: "standard", providers: cpu, local: true, reason: "High Performance needs an NVIDIA card. This uses the CPU." };
  if (wantHigh && !trtInstalled) return { mode: "standard", providers: cpu, local: true, reason: "High Performance needs its add-on. This uses the CPU." };
  return { mode: "standard", providers: cpu, local: true, reason: "This uses the CPU." };
}

// Settings for a new onnxruntime session. Graph tuning on, graph cached on disk.
export function sessionOptions(choice, dataDir) {
  const names = { tensorrt: "TensorrtExecutionProvider", cuda: "CUDAExecutionProvider", cpu: "CPUExecutionProvider" };
  const dir = path.join(dataDir, "addons", "onnx-classifier");
  return {
    executionProviders: choice.providers.map((p) => names[p]),
    graphOptimizationLevel: "all",
    optimizedModelFilePath: path.join(dir, "optimized.onnx"),
    enableCpuMemArena: choice.mode !== "low",
    intraOpNumThreads: choice.mode === "low" ? 1 : 0,
    trtOptions: choice.providers.includes("tensorrt") ? { trt_fp16_enable: true, trt_engine_cache_enable: true, trt_engine_cache_path: path.join(dir, "trt-cache") } : undefined,
  };
}

let nvidiaCache = null;
// Asks nvidia-smi once, only when called. A missing tool means no card.
export function detectNvidia(run = execFile) {
  if (nvidiaCache) return nvidiaCache;
  nvidiaCache = new Promise((resolve) => {
    try {
      run("nvidia-smi", ["-L"], { timeout: 3000, windowsHide: true }, (err, out) => resolve(!err && /GPU \d/.test(String(out || ""))));
    } catch { resolve(false); }
  });
  return nvidiaCache;
}
export function resetAccelCache() { nvidiaCache = null; sessionCache = null; }

export async function accelStatus(dataDir, { wantHigh = false, nvidia } = {}) {
  const rows = listAddons(dataDir);
  const has = (id) => !!rows.find((r) => r.id === id)?.installed;
  const flag = flagOn("onnx");
  const gpu = flag && wantHigh ? (nvidia ?? await detectNvidia()) : false;
  const choice = chooseAccel({ flag, lowPower: perfState().light, onnxInstalled: has("onnx-classifier"), trtInstalled: has("tensorrt"), nvidia: gpu, wantHigh });
  return { flag, ...choice, nvidia: gpu };
}

let sessionCache = null;
// One session, made on first use. The loader can be replaced in tests.
export async function getSession(dataDir, choice, { loader } = {}) {
  if (sessionCache) return sessionCache;
  const model = path.join(dataDir, "addons", "onnx-classifier", "model.onnx");
  if (!fs.existsSync(model)) return null;
  sessionCache = (async () => {
    try {
      const ort = loader ? await loader() : await import(["onnxruntime", "node"].join("-"));
      return await (ort.InferenceSession || ort.default.InferenceSession).create(model, sessionOptions(choice, dataDir));
    } catch {
      return null;
    }
  })();
  const s = await sessionCache;
  if (!s) sessionCache = null;
  return s;
}

// Rules first. The local scorer only runs for a weak rules answer, and any
// failure keeps the rules answer. scorer(session, input) returns { category, confidence }.
export async function classifyAccel(input, { dataDir, rules, scorer, loader, choice } = {}) {
  const base = rules(input);
  try {
    if (!flagOn("onnx") || !scorer) return { ...base, accel: "rules" };
    if (Number(base.confidence) >= 0.85) return { ...base, accel: "rules" };
    const pick = choice || (await accelStatus(dataDir));
    if (!pick.local) return { ...base, accel: "rules" };
    const session = await getSession(dataDir, pick, { loader });
    if (!session) return { ...base, accel: "rules" };
    const out = await scorer(session, input);
    if (out && out.category && out.confidence > (base.confidence || 0)) {
      const c = out.confidence;
      return { ...base, category: out.category, label: labelOf(out.category), confidence: c, decision: c >= THRESHOLDS.direct ? "direct" : c >= THRESHOLDS.confirm ? "confirm" : "general", tier: "local", accel: pick.mode };
    }
  } catch { /* fall through to the rules answer */ }
  return { ...base, accel: "rules" };
}

