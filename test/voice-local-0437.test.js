// 0.4.37 (Chris: voice too computer): the free natural voice on this PC (Kokoro through kokoro-js), its one-click
// download, the better browser fallback and the improved paid voices. The engine is faked (CC_VOICE_LOCAL_FAKE=1) and
// the download comes from a local server, so no test ever downloads the real model. No real keys; paid calls are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { ROOT, startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cc-voice-local-"));
process.env.CC_VOICE_LOCAL_FAKE = "1";
const VL = await import("../server/voice-local.js");
const { synthesize, talkStatus, PAID_VOICES, OPENAI_TTS_INSTRUCTIONS } = await import("../server/voice-speak.js");
const { pickBrowserVoice, coerceTalk, normalizeTalk, TALK_DEFAULTS } = await import("../web/features/voice-actions.js");
const { SENDERS, privacyView } = await import("../server/privacy.js");

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASHES = /[–—]/;
const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(400, 1)]);
const keys = { elevenlabs: { key: "el_fake_key" }, openai: { key: "sk-fake-key" } };

// A local stand-in for the model host: serves the fake files, can drop the connection half way once, or answer 500.
function modelServer({ dropOnce = false, fail = false } = {}) {
  const files = Object.fromEntries(VL.modelFiles().map((f) => [f.path, Buffer.alloc(f.size, f.path.length)]));
  const seen = [];
  let dropped = false;
  const srv = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.replace(/^\/m\//, ""));
    seen.push({ name, range: req.headers.range || "" });
    if (fail) { res.writeHead(500); return res.end(); }
    const body = files[name];
    if (!body) { res.writeHead(404); return res.end(); }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || "");
    const from = m ? Number(m[1]) : 0;
    const part = body.subarray(from);
    res.writeHead(m ? 206 : 200, { "content-length": part.length, "content-type": "application/octet-stream" });
    if (dropOnce && !dropped && part.length > 50000) {
      dropped = true;
      res.write(part.subarray(0, 50000));
      setTimeout(() => res.destroy(), 50);
      return;
    }
    res.end(part);
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}/m`, close: () => new Promise((c) => srv.close(c)) })));
}

test("synthesize: the natural voice first when it is set up, the browser voice when not, paid only with paid voice on", async () => {
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push({ url: String(url), body: JSON.parse(o.body || "{}") }); return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(400, 2) }; };
  const spoke = [];
  const local = { ready: () => true, speak: async (t, o) => { spoke.push({ t, ...o }); return wav; } };
  const notReady = { ready: () => false, speak: async () => { throw new Error("should not run"); } };
  const deps = (has, extra = {}) => ({ hasSecret: (id) => has.includes(id), getSecret: (id) => keys[id], fetchImpl, ...extra });

  // set up, paid off (the default): the natural voice speaks, with the picked voice and speed, and nothing is sent anywhere
  let out = await synthesize("Hello there.", deps(["openai", "elevenlabs"], { local, prefs: { voice: "am_michael", speed: 1.1 } }));
  assert.equal(out.engine, "local"); assert.equal(out.mime, "audio/wav"); assert.ok(out.audio.length > 100);
  assert.deepEqual(spoke.at(-1), { t: "Hello there.", voice: "am_michael", speed: 1.1 });
  assert.equal(calls.length, 0, "a saved paid key is not consent to spend it");

  // not set up: the browser voice, as before
  out = await synthesize("Hello there.", deps([], { local: notReady }));
  assert.equal(out.engine, "browser"); assert.equal(out.text, "Hello there.");

  // paid on: the paid voice first (ElevenLabs, then OpenAI, as before)
  out = await synthesize("Hello there.", deps(["openai", "elevenlabs"], { local, allowPaid: true }));
  assert.equal(out.engine, "elevenlabs");
  out = await synthesize("Hello there.", deps(["openai"], { local, allowPaid: true }));
  assert.equal(out.engine, "openai");
  const oa = calls.at(-1);
  assert.match(oa.url, /audio\/speech$/);
  assert.equal(oa.body.model, "gpt-4o-mini-tts");
  assert.equal(oa.body.voice, "marin", "a warmer default than alloy");
  assert.equal(oa.body.instructions, OPENAI_TTS_INSTRUCTIONS);
  assert.match(oa.body.instructions, /warm, calm, friendly and natural/);

  // the picked paid voice goes first and is the one asked for
  out = await synthesize("Hello there.", deps(["openai", "elevenlabs"], { local, allowPaid: true, prefs: { paidVoice: "openai:cedar" } }));
  assert.equal(out.engine, "openai"); assert.equal(calls.at(-1).body.voice, "cedar");
  out = await synthesize("Hello there.", deps(["openai", "elevenlabs"], { local, allowPaid: true, prefs: { paidVoice: "elevenlabs:JBFqnCBsd6RMkjVDRZzb", speed: 1.1 } }));
  assert.equal(out.engine, "elevenlabs"); assert.match(calls.at(-1).url, /text-to-speech\/JBFqnCBsd6RMkjVDRZzb/);
  assert.deepEqual(calls.at(-1).body.voice_settings, { speed: 1.1 });
  assert.ok(PAID_VOICES.filter((v) => v.provider === "openai").length >= 2 && PAID_VOICES.filter((v) => v.provider === "elevenlabs").length >= 2);

  // a paid voice that fails falls back to the natural voice, then the browser voice
  const failing = async () => ({ ok: false, status: 500 });
  out = await synthesize("Hello.", { hasSecret: () => true, getSecret: (id) => keys[id], fetchImpl: failing, allowPaid: true, local });
  assert.equal(out.engine, "local");
  out = await synthesize("Hello.", { hasSecret: () => true, getSecret: (id) => keys[id], fetchImpl: failing, allowPaid: true, local: notReady });
  assert.equal(out.engine, "browser");
  // a natural voice that breaks gives the browser voice, never an error
  out = await synthesize("Hello.", { local: { ready: () => true, speak: async () => { throw new Error("onnx broke"); } } });
  assert.equal(out.engine, "browser");

  // the status line names the speaker
  assert.equal(talkStatus(() => false, {}, { localReady: true }).speaker, "local");
  assert.equal(talkStatus(() => false, {}, { localReady: false }).speaker, "browser");
  assert.equal(talkStatus((id) => id === "openai", {}, { localReady: true }).speaker, "local", "paid off: the free voice");
  assert.equal(talkStatus((id) => id === "openai", {}, { localReady: true, allowPaid: true }).speaker, "openai");
});

test("talk settings: natural voice, speed and paid voice are saved and checked", () => {
  assert.equal(TALK_DEFAULTS.voice, "af_heart");
  assert.equal(TALK_DEFAULTS.speed, 1);
  assert.equal(TALK_DEFAULTS.paidVoice, "");
  assert.deepEqual(coerceTalk(null), TALK_DEFAULTS);
  let s = normalizeTalk({ voice: "bm_george", speed: 1.23, paidVoice: "openai:marin" }, TALK_DEFAULTS);
  assert.equal(s.voice, "bm_george"); assert.equal(s.speed, 1.25); assert.equal(s.paidVoice, "openai:marin");
  assert.equal(normalizeTalk({ speed: 9 }, s).speed, 1.4);
  assert.equal(normalizeTalk({ paidVoice: "" }, s).paidVoice, "");
  assert.throws(() => normalizeTalk({ voice: "../../x" }, s), /not on the list/);
  assert.throws(() => normalizeTalk({ speed: "fast" }, s), /number/);
  assert.throws(() => normalizeTalk({ paidVoice: "acme:x" }, s), /not on the list/);
  assert.equal(coerceTalk({ voice: 5, speed: "x", paidVoice: "nope" }).voice, "af_heart");
  // at least two female and two male natural voices, with friendly names, and the default is one of them
  const f = VL.LOCAL_VOICES.filter((v) => v.gender === "female");
  const m = VL.LOCAL_VOICES.filter((v) => v.gender === "male");
  assert.ok(f.length >= 2 && m.length >= 2);
  assert.ok(VL.LOCAL_VOICES.every((v) => /^[A-Z][a-z]+$/.test(v.name) && !DASHES.test(v.note)));
  assert.ok(VL.localVoiceOk(VL.DEFAULT_LOCAL_VOICE));
  // the installer keeps exactly the offered voice files
  const yml = read("electron-builder.yml");
  for (const v of VL.LOCAL_VOICES) assert.ok(yml.includes(v.id), `${v.id} kept in the installer`);
});

test("browser fallback picks the least robotic voice: Natural or Online first, David and Zira last", () => {
  const v = (name, lang = "en-US", extra = {}) => ({ name, lang, ...extra });
  const chris = [v("Microsoft David - English (United States)", "en-US", { default: true }), v("Microsoft Zira - English (United States)"), v("Microsoft Mark - English (United States)")];
  assert.equal(pickBrowserVoice(chris).name, "Microsoft Mark - English (United States)", "anything but David or Zira when something else exists");
  assert.equal(pickBrowserVoice([...chris, v("Microsoft Aria Online (Natural) - English (United States)")]).name, "Microsoft Aria Online (Natural) - English (United States)");
  assert.equal(pickBrowserVoice([...chris, v("Google US English")]).name, "Google US English");
  assert.equal(pickBrowserVoice([v("Microsoft Hortense - French", "fr-FR"), v("Microsoft Zira - English (United States)")]).name, "Microsoft Zira - English (United States)", "English over another language");
  assert.equal(pickBrowserVoice([v("Microsoft David - English (United States)")]).name, "Microsoft David - English (United States)", "David only when it is all there is");
  assert.equal(pickBrowserVoice([]), null);
  assert.equal(pickBrowserVoice(null), null);
  // the page uses it, with the speed from Settings
  const page = read("web", "features", "voice-talk.js");
  assert.match(page, /pickBrowserVoice\(/);
  assert.match(page, /u\.voice = v/);
  assert.match(page, /u\.rate = cfg\.speed/);
});

test("download: progress in plain words, resume after a dropped connection, a failed download says what to do", async () => {
  const root = tmpDir("cc-voice-dl-");
  VL._resetDownload();
  assert.equal(VL.isReady(root), false);
  let st = VL.downloadStatus(root);
  assert.equal(st.state, "idle");
  assert.match(st.line, /^Get the natural voice, about \d+ MB, free, runs on this PC\.$/);
  assert.equal(DASHES.test(st.line), false);

  // a connection that drops half way: the next try asks for the rest with a Range request and finishes
  const ms = await modelServer({ dropOnce: true });
  process.env.CC_VOICE_MODEL_URL = ms.url;
  try {
    const pcts = [];
    const p = VL.startDownload({ root, waits: [100, 100] });
    assert.equal(VL.startDownload({ root }), p, "a second click joins the running download");
    const iv = setInterval(() => { const s = VL.downloadStatus(root); if (s.state === "downloading") { pcts.push(s.pct); assert.match(s.line, /^Getting the natural voice: \d+% of about \d+ MB\.$/); } }, 2);
    st = await p;
    clearInterval(iv);
    assert.equal(st.state, "ready", st.line);
    assert.equal(st.ready, true); assert.equal(st.pct, 100);
    assert.equal(VL.isReady(root), true);
    const big = ms.seen.filter((s) => s.name === "onnx/model_quantized.onnx");
    assert.ok(big.length >= 2, "the dropped file was asked for again");
    assert.match(big.at(-1).range, /^bytes=\d+-$/, "and only the rest of it");
    assert.ok(VL.modelFiles().every((f) => fs.statSync(path.join(root, ...VL.MODEL_REPO.split("/"), ...f.path.split("/"))).size === f.size));
    assert.ok(!fs.readdirSync(path.join(root, ...VL.MODEL_REPO.split("/"), "onnx")).some((f) => f.endsWith(".part")), "no half files left");
  } finally { await ms.close(); }

  // a server that keeps failing: a plain line and Try again keeps what came in
  const root2 = tmpDir("cc-voice-dl-");
  VL._resetDownload();
  const bad = await modelServer({ fail: true });
  process.env.CC_VOICE_MODEL_URL = bad.url;
  try {
    st = await VL.startDownload({ root: root2, waits: [20, 20] });
    assert.equal(st.state, "failed");
    assert.equal(st.line, "The download stopped (no connection). Press Try again to pick up where it left off.");
    assert.equal(DASHES.test(st.line), false);
    assert.equal(VL.isReady(root2), false);
    assert.equal(bad.seen.length, 3, "two quiet retries, then it stops and says so");
  } finally { await bad.close(); }

  // nothing listening at all
  VL._resetDownload();
  process.env.CC_VOICE_MODEL_URL = "http://127.0.0.1:9/m";
  st = await VL.startDownload({ root: tmpDir("cc-voice-dl-"), waits: [] });
  assert.equal(st.state, "failed"); assert.match(st.line, /Try again/);
  delete process.env.CC_VOICE_MODEL_URL;
  VL._resetDownload();
});

test("the real model download is pinned, checked, and sized before the click", () => {
  const src = read("server", "voice-local.js");
  assert.match(src, /MODEL_REVISION = "[0-9a-f]{40}"/, "a fixed revision, so the files never change under us");
  assert.match(src, /sha256: "[0-9a-f]{64}"/, "the big file is checked");
  assert.match(src, /allowRemoteModels = false/, "speaking never fetches anything");
  assert.match(src, /huggingface\.co/);
  assert.equal(VL.modelMb(), Math.max(1, Math.round(VL.modelBytes() / 1048576)));
  // the size shown before the click matches the real files, and the privacy list says the same size
  const real = src.slice(src.indexOf("REAL_FILES"), src.indexOf("FAKE_FILES"));
  const mb = Math.round([...real.matchAll(/size: (\d+)/g)].reduce((a, m) => a + Number(m[1]), 0) / 1048576);
  assert.ok(mb > 50 && mb < 200, `${mb} MB`);
  assert.match(SENDERS.find((s) => s.id === "voice-download").what, new RegExp(`about ${mb} MB`));
});

test("privacy: Settings > Privacy names the natural voice download, once, on a click", () => {
  const row = SENDERS.find((s) => s.id === "voice-download");
  assert.ok(row, "listed");
  assert.equal(row.state, "when-used");
  assert.match(row.to, /Hugging Face/);
  assert.match(row.when, /Only when you click Get the natural voice/);
  assert.match(row.when, /nothing leaves it to speak/);
  for (const k of ["name", "what", "to", "when", "off"]) assert.equal(DASHES.test(row[k]), false, k);
  assert.ok(privacyView({}).items.some((i) => i.id === "voice-download"));
});

test("Stop drops the sentences still waiting for the natural voice", async () => {
  process.env.CC_VOICE_LOCAL_FAKE_MS = "150";
  try {
    const a = VL.speakLocal("First sentence.");
    const b = VL.speakLocal("Second sentence.");
    const c = VL.speakLocal("Third sentence.");
    await new Promise((r) => setTimeout(r, 30));
    VL.stopLocal();
    assert.equal(await a, null, "the one being made is thrown away");
    assert.equal(await b, null);
    assert.equal(await c, null);
    const d = await VL.speakLocal("After stop.");
    assert.ok(Buffer.isBuffer(d) && d.subarray(0, 4).toString() === "RIFF", "new speech after a stop works");
    // through synthesize, a dropped sentence says stopped (the page skips it) instead of falling back to another voice
    const local = { ready: () => true, speak: (t, o) => VL.speakLocal(t, o) };
    const p = synthesize("Hello.", { local });
    await new Promise((r) => setTimeout(r, 20));
    VL.stopLocal();
    assert.equal((await p).engine, "stopped");
  } finally { delete process.env.CC_VOICE_LOCAL_FAKE_MS; }
  const page = read("web", "features", "voice-talk.js");
  assert.match(page, /api\("\/voice\/stop"/, "the page Stop reaches the server");
  assert.match(page, /engine === "stopped"/);
});

test("routes: not set up speaks with the browser voice, the click downloads with progress, then the natural voice speaks", async () => {
  const ms = await modelServer();
  const paidSeen = [];
  const paid = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    paidSeen.push({ url: req.url, body: Buffer.concat(chunks).toString() });
    if (req.url.includes("/audio/speech")) { res.writeHead(200, { "content-type": "audio/mpeg" }); return res.end(Buffer.alloc(500, 2)); }
    if (req.url.includes("/models")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "m" }] })); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => paid.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${paid.address().port}`;
  const env = { CC_VOICE_LOCAL_FAKE: "1", CC_VOICE_MODEL_URL: ms.url, CC_STATUS_PAGES: "off", CC_WHISPER_BIN: "off", CC_BASE_URL_OPENAI: `${origin}/oa/v1`, CC_BASE_URL_ELEVENLABS: `${origin}/el`, OPENAI_API_KEY: "", ELEVENLABS_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "" };
  const s = await startServer({ env });
  try {
    let r = await s.api("/voice/local");
    assert.equal(r.status, 200);
    assert.equal(r.json.status.ready, false); assert.equal(r.json.status.state, "idle");
    assert.match(r.json.status.line, /^Get the natural voice, about \d+ MB, free, runs on this PC\.$/);
    assert.ok(r.json.voices.length >= 4); assert.equal(r.json.paidOn, false);
    assert.equal(ms.seen.length, 0, "nothing downloads before the click");
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello." } });
    assert.equal(r.json.engine, "browser");
    assert.equal((await s.api("/voice/talk")).json.status.speaker, "browser");

    // the click
    r = await s.api("/voice/local/download", { method: "POST", body: {} });
    assert.equal(r.status, 202);
    const until = Date.now() + 30000;
    let st = r.json.status;
    while (st.state !== "ready" && Date.now() < until) { await new Promise((w) => setTimeout(w, 150)); st = (await s.api("/voice/local")).json.status; }
    assert.equal(st.state, "ready", st.line);
    assert.equal(fs.existsSync(path.join(s.dir, "addons", "natural-voice", "ready.json")), true, "kept in the app data folder");

    // now the natural voice speaks, sentence by sentence, as WAV
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello there." } });
    assert.equal(r.json.engine, "local"); assert.equal(r.json.mime, "audio/wav");
    assert.equal(Buffer.from(r.json.audio, "base64").subarray(0, 4).toString(), "RIFF");
    assert.equal((await s.api("/voice/talk")).json.status.speaker, "local");
    r = await s.api("/voice/local/sample", { method: "POST", body: { voice: "bm_george", speed: 1.1 } });
    assert.equal(r.json.engine, "local");
    assert.equal((await s.api("/voice/stop", { method: "POST", body: {} })).json.ok, true);

    // voice picker and speed are saved; junk is refused
    r = await s.api("/voice/talk", { method: "POST", body: { voice: "am_michael", speed: 1.2 } });
    assert.equal(r.status, 200); assert.equal(r.json.settings.voice, "am_michael"); assert.equal(r.json.settings.speed, 1.2);
    assert.equal((await s.api("/voice/talk", { method: "POST", body: { voice: "zz_nobody" } })).status, 400);
    assert.equal((await s.api("/voice/talk", { method: "POST", body: { paidVoice: "openai:nobody" } })).status, 400);

    // an OpenAI key saved but paid voice off: still the free natural voice, nothing sent
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key: "sk-proj-voicelocal0000001" } })).status, 200);
    const before = paidSeen.filter((x) => x.url.includes("/audio/speech")).length;
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello." } });
    assert.equal(r.json.engine, "local");
    assert.equal(paidSeen.filter((x) => x.url.includes("/audio/speech")).length, before, "a saved paid key is not consent to spend it");

    // paid voice on and a paid voice picked: OpenAI with that voice and the warm instructions
    await s.api("/voice/speech-paid", { method: "POST", body: { paidSpeech: true } });
    assert.equal((await s.api("/voice/talk", { method: "POST", body: { paidVoice: "openai:coral" } })).status, 200);
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello." } });
    assert.equal(r.json.engine, "openai");
    const body = JSON.parse(paidSeen.filter((x) => x.url.includes("/audio/speech")).at(-1).body);
    assert.equal(body.voice, "coral"); assert.equal(body.model, "gpt-4o-mini-tts"); assert.match(body.instructions, /warm/);
    assert.equal((await s.api("/voice/local")).json.paidOn, true);
    assert.equal(s.log.includes("sk-proj-voicelocal0000001"), false);

    // the privacy page lists the download
    r = await s.api("/privacy");
    assert.ok(r.json.items.some((i) => i.id === "voice-download"));
  } finally {
    await s.stop();
    await ms.close();
    await new Promise((c) => paid.close(c));
  }
});

test("Settings > Voice in the page: the offer line, the click, progress, then the picker, speed and Play sample", async (t) => {
  const { bootPage, findBrowser } = await import("./pw-helpers.js");
  if (!findBrowser()) { t.skip("no Chrome installed"); return; }
  const ms = await modelServer();
  const b = await bootPage({ mode: "expert", width: 1280, height: 900, env: { CC_VOICE_LOCAL_FAKE: "1", CC_VOICE_LOCAL_FAKE_MS: "50", CC_VOICE_MODEL_URL: ms.url, CC_WHISPER_BIN: "off" } });
  try {
    const { page } = b;
    await page.evaluate(() => window.CC.openSettings());
    await page.waitForSelector("#vt-voice #vtv-get", { timeout: 30000 });
    const before = await page.evaluate(() => ({ line: document.getElementById("vtv-line").textContent, btn: document.getElementById("vtv-get").textContent, off: document.getElementById("vtv-voice").disabled }));
    assert.match(before.line, /^Get the natural voice, about \d+ MB, free, runs on this PC\.$/);
    assert.match(before.btn, /^Get the natural voice \(about \d+ MB\)$/);
    assert.equal(before.off, true, "the picker waits for the voice");
    assert.equal(ms.seen.length, 0, "nothing downloads before the click");
    await page.click("#vtv-get");
    await page.waitForFunction(() => { const s = document.getElementById("vtv-voice"); return s && !s.disabled; }, null, { timeout: 30000 });
    assert.ok(ms.seen.length >= 2);
    const opts = await page.evaluate(() => [...document.querySelectorAll("#vtv-voice option")].map((o) => o.textContent));
    assert.ok(opts.some((o) => /^Heart \(female, warm/.test(o)) && opts.some((o) => /\(male,/.test(o)));
    assert.equal(opts.some((o) => /[–—]/.test(o)), false);
    await page.selectOption("#vtv-voice", "bm_george");
    await page.waitForFunction(async () => (await window.CC.api("/voice/talk")).settings.voice === "bm_george", null, { timeout: 20000 });
    await page.evaluate(() => { const r = document.getElementById("vtv-speed"); r.value = "1.2"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
    await page.waitForFunction(async () => (await window.CC.api("/voice/talk")).settings.speed === 1.2, null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.getElementById("vtv-paid")), null, "no paid voices while paid voice is off");
    // Play sample asks the server for the natural voice and plays it
    const sample = page.waitForResponse((r) => r.url().includes("/api/voice/local/sample"), { timeout: 20000 });
    await page.click("#vtv-sample");
    const body = await (await sample).json();
    assert.equal(body.engine, "local"); assert.equal(body.mime, "audio/wav");
    await page.click("#vtv-stop");
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
    await ms.close();
  }
});
