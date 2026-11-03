// 0.4.37 (Chris: voice too computer): the free natural voice. Kokoro-82M (Apache-2.0) through kokoro-js runs here in
// the local engine, not the page. The model is not in the installer: it downloads once, on a click, into the app data
// folder (DATA_DIR/addons/natural-voice), with progress, resume and a plain line on a network error. After that nothing leaves
// this PC to speak. Tests set CC_VOICE_LOCAL_FAKE=1 (a tiny fake engine and a tiny fake file list) and point
// CC_VOICE_MODEL_URL at a local server, so a test never downloads the real model.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { DATA_DIR } from "./paths.js";

// A plain GET that follows redirects (Hugging Face sends the big file from its download servers). node:http with no
// keep-alive, not fetch: a fetch body read with back pressure crashed undici on Windows when the socket closed, and a
// reused loopback socket can hang there. body is a Node stream.
export function nodeGet(url, { headers = {}, signal } = {}, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error("bad address")); }
    const lib = u.protocol === "https:" ? https : u.protocol === "http:" ? http : null;
    if (!lib) return reject(new Error("bad address"));
    const req = lib.get(u, { headers: { "user-agent": "Meldmind", ...headers }, agent: false, signal }, (res) => {
      const to = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && to && hops < 6) {
        res.resume();
        resolve(nodeGet(new URL(to, u).href, { headers, signal }, hops + 1));
        return;
      }
      resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, body: res });
    });
    req.on("error", reject);
  });
}

export const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
// Pinned so the files never change under us; the big file is checked against its published sha256.
export const MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const REAL_FILES = [
  { path: "config.json", size: 44 },
  { path: "tokenizer.json", size: 3497 },
  { path: "tokenizer_config.json", size: 113 },
  { path: "onnx/model_quantized.onnx", size: 92361116, sha256: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478" },
];
const FAKE_FILES = [
  { path: "config.json", size: 64 },
  { path: "onnx/model_quantized.onnx", size: 200000 },
];
const fake = () => process.env.CC_VOICE_LOCAL_FAKE === "1";
export const modelFiles = () => (fake() ? FAKE_FILES : REAL_FILES);
export const modelBytes = () => modelFiles().reduce((a, f) => a + f.size, 0);
export const modelMb = () => Math.max(1, Math.round(modelBytes() / 1048576));

// The voices offered. Ids are Kokoro's; names are what the person sees. The packaged app ships only these voice files.
export const LOCAL_VOICES = Object.freeze([
  { id: "af_heart", name: "Heart", gender: "female", note: "warm, American" },
  { id: "af_bella", name: "Bella", gender: "female", note: "bright, American" },
  { id: "bf_emma", name: "Emma", gender: "female", note: "calm, British" },
  { id: "am_michael", name: "Michael", gender: "male", note: "steady, American" },
  { id: "am_fenrir", name: "Fenrir", gender: "male", note: "deep, American" },
  { id: "bm_george", name: "George", gender: "male", note: "warm, British" },
]);
export const DEFAULT_LOCAL_VOICE = "af_heart";
export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.4;
export const localVoiceOk = (id) => LOCAL_VOICES.some((v) => v.id === id);

// Kept with the other optional heavy tools (server/perf/addons.js): DATA_DIR/addons/<id>, outside the installer and the repo.
export function modelRoot() {
  return process.env.CC_VOICE_MODEL_DIR || path.join(DATA_DIR, "addons", "natural-voice");
}
const fileOf = (root, f) => path.join(root, ...MODEL_REPO.split("/"), ...f.path.split("/"));
const readyFile = (root) => path.join(root, "ready.json");

function downloadBase() {
  const dev = process.env.CC_PACKAGED === "1" ? "" : process.env.CC_VOICE_MODEL_URL;
  return String(dev || `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}`).replace(/\/$/, "");
}

// Set up = every file is in place at its size and the download finished (ready.json is written last).
export function isReady(root = modelRoot()) {
  try {
    const mark = JSON.parse(fs.readFileSync(readyFile(root), "utf8"));
    if (mark?.revision !== (fake() ? "fake" : MODEL_REVISION)) return false;
    return modelFiles().every((f) => { try { return fs.statSync(fileOf(root, f)).size === f.size; } catch { return false; } });
  } catch { return false; }
}

// ---------------------------------------------------------------- download
export const LINES = Object.freeze({
  offer: (mb) => `Get the natural voice, about ${mb} MB, free, runs on this PC.`,
  network: "The download stopped (no connection). Press Try again to pick up where it left off.",
  damaged: "The download came in damaged. Press Try again to get it again.",
  disk: "There is not enough room on this PC for the voice. Free some space, then press Try again.",
  ready: "The natural voice is ready. It runs on this PC.",
});

let dl = { state: "idle", got: 0, total: 0, line: "", file: "" };
let running = null;

export function downloadStatus(root = modelRoot()) {
  const ready = isReady(root);
  const total = modelBytes();
  if (ready && dl.state !== "downloading") return { state: "ready", ready: true, got: total, total, pct: 100, mb: modelMb(), line: LINES.ready };
  const got = dl.state === "downloading" || dl.state === "failed" ? dl.got : 0;
  return { state: dl.state === "ready" ? "idle" : dl.state, ready: false, got, total, pct: total ? Math.min(99, Math.floor((got / total) * 100)) : 0, mb: modelMb(), line: dl.state === "failed" ? dl.line : dl.state === "downloading" ? `Getting the natural voice: ${Math.floor((got / total) * 100) || 0}% of about ${modelMb()} MB.` : LINES.offer(modelMb()) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };

async function sha256File(p) {
  const h = crypto.createHash("sha256");
  for await (const c of fs.createReadStream(p)) h.update(c);
  return h.digest("hex");
}

// One file, resuming from file.part with a Range request. A stalled connection gives up after idleMs.
async function fetchOne(f, root, { getImpl, base, idleMs, onBytes }) {
  const dest = fileOf(root, f);
  if (sizeOf(dest) === f.size) { onBytes(f.size); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let have = sizeOf(part);
  if (have > f.size) { fs.rmSync(part, { force: true }); have = 0; }
  if (have < f.size) {
    const ac = new AbortController();
    let timer = setTimeout(() => ac.abort(), idleMs);
    const poke = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(), idleMs); };
    let out = null;
    try {
      const res = await getImpl(`${base}/${f.path}`, { headers: have ? { range: `bytes=${have}-` } : {}, signal: ac.signal });
      if (!res.ok) { try { res.body?.resume?.(); } catch { /* nothing to drain */ } throw Object.assign(new Error(`status ${res.status}`), { code: "net" }); }
      const append = have > 0 && res.status === 206;
      if (!append) have = 0;
      onBytes(have);
      out = fs.createWriteStream(part, { flags: append ? "a" : "w" });
      let diskErr = null;
      out.on("error", (e) => { diskErr = e; });
      for await (const chunk of res.body) {
        poke();
        if (diskErr) throw diskErr;
        const buf = Buffer.from(chunk);
        have += buf.length;
        if (have > f.size) throw Object.assign(new Error("too big"), { code: "damaged" });
        if (!out.write(buf)) await new Promise((r) => { out.once("drain", r); out.once("error", r); });
        onBytes(have);
      }
      await new Promise((resolve, reject) => { out.end((e) => (e || diskErr ? reject(e || diskErr) : resolve())); });
      out = null;
    } catch (e) {
      if (out) await new Promise((r) => out.end(r));
      if (e?.code === "ENOSPC") e.code = "disk";
      if (!["damaged", "disk"].includes(e?.code)) e.code = "net";
      throw e;
    } finally { clearTimeout(timer); }
  }
  if (sizeOf(part) !== f.size) throw Object.assign(new Error("short"), { code: "net" });
  if (f.sha256 && (await sha256File(part)) !== f.sha256) { fs.rmSync(part, { force: true }); throw Object.assign(new Error("hash"), { code: "damaged" }); }
  fs.renameSync(part, dest);
}

// Starts the download (once; a second click while it runs joins it). Each file retries twice by itself, resuming.
export function startDownload({ getImpl = nodeGet, root = modelRoot(), idleMs = 30000, waits = [1000, 3000] } = {}) {
  if (running) return running;
  if (isReady(root)) { dl = { state: "ready", got: modelBytes(), total: modelBytes(), line: LINES.ready, file: "" }; return Promise.resolve(downloadStatus(root)); }
  const files = modelFiles();
  const total = modelBytes();
  const base = downloadBase();
  dl = { state: "downloading", got: 0, total, line: "", file: "" };
  running = (async () => {
    let done = 0;
    try {
      for (const f of files) {
        dl.file = f.path;
        for (let attempt = 0; ; attempt++) {
          try {
            await fetchOne(f, root, { getImpl, base, idleMs, onBytes: (n) => { dl.got = done + n; } });
            break;
          } catch (e) {
            if (e.code !== "net" || attempt >= waits.length) throw e;
            await sleep(waits[attempt]);
          }
        }
        done += f.size;
        dl.got = done;
      }
      fs.writeFileSync(readyFile(root), JSON.stringify({ revision: fake() ? "fake" : MODEL_REVISION, repo: MODEL_REPO, at: new Date().toISOString() }));
      dl = { state: "ready", got: total, total, line: LINES.ready, file: "" };
    } catch (e) {
      dl = { ...dl, state: "failed", line: e.code === "damaged" ? LINES.damaged : e.code === "disk" ? LINES.disk : LINES.network };
    } finally { running = null; }
    return downloadStatus(root);
  })();
  return running;
}

// Tests only: forget the in-memory download state.
export function _resetDownload() { dl = { state: "idle", got: 0, total: 0, line: "", file: "" }; running = null; }

// ---------------------------------------------------------------- speaking
// 16-bit mono WAV from float samples (24 kHz from Kokoro). Small enough to send one sentence at a time.
export function wav16(samples, rate = 24000) {
  const n = samples.length;
  // Kokoro can peak a little over 1 on a deep voice; scale the sentence down instead of clipping it.
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(samples[i] || 0); if (a > peak) peak = a; }
  const gain = peak > 0.98 ? 0.95 / peak : 1;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, (samples[i] || 0) * gain)); buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2); }
  return buf;
}

// The fake engine: a short soft tone, sized by the text, with a delay tests can set (CC_VOICE_LOCAL_FAKE_MS).
const fakeEngine = {
  async speak(text) {
    const ms = Number(process.env.CC_VOICE_LOCAL_FAKE_MS || 0);
    if (ms) await sleep(ms);
    const n = Math.min(24000, 2400 + String(text).length * 200);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 24000);
    return wav16(s);
  },
};

let engine = null;
async function loadEngine(root) {
  if (fake()) return fakeEngine;
  const { KokoroTTS } = await import("kokoro-js");
  const { env } = await import("@huggingface/transformers");
  env.allowRemoteModels = false; // never fetch at speak time: only the files downloaded on the click are used
  env.allowLocalModels = true;
  env.localModelPath = root + path.sep;
  env.useFSCache = false;
  env.cacheDir = root;
  const tts = await KokoroTTS.from_pretrained(MODEL_REPO, { dtype: "q8", device: "cpu" });
  return {
    async speak(text, { voice, speed }) {
      const out = await tts.generate(text, { voice, speed });
      return wav16(out.audio, out.sampling_rate || 24000);
    },
  };
}

// Loads the model once and keeps it in memory. A failed load is forgotten so the next try loads again.
export function getEngine(root = modelRoot()) {
  if (!engine) engine = loadEngine(root).catch((e) => { engine = null; throw e; });
  return engine;
}
export function warm() {
  if (!isReady()) return false;
  getEngine().catch(() => {});
  return true;
}

// One sentence at a time, in order, so the first sentence is not slowed by the next one. Stop drops what is queued.
let queue = Promise.resolve();
let epoch = 0;
export function stopLocal() { epoch += 1; }

export function speakLocal(text, { voice = DEFAULT_LOCAL_VOICE, speed = 1 } = {}) {
  const mine = epoch;
  const v = localVoiceOk(voice) ? voice : DEFAULT_LOCAL_VOICE;
  const sp = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(speed) || 1));
  const job = queue.then(async () => {
    if (mine !== epoch) return null; // stopped before its turn
    const eng = await getEngine();
    if (mine !== epoch) return null;
    const audio = await eng.speak(String(text), { voice: v, speed: sp });
    return mine === epoch ? audio : null;
  });
  queue = job.catch(() => {});
  return job;
}

// What synthesize() in voice-speak.js uses. Tests pass their own.
export const localVoice = {
  ready: () => isReady(),
  speak: (text, opts) => speakLocal(text, opts),
  stop: () => stopLocal(),
};
