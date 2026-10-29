// Talk back (0.4.21): a Talk toggle, a slim Heard / Doing / Done strip, spoken replies, push-to-talk
// (default Ctrl+Space), Hands-free (always listening, visible mic dot), "Hey Meld" (off by default),
// instant two-way voice when a key exists, a "What can I say?" card and a number overlay.
// The commands live in voice-actions.js (one registry shared with buttons). This file is the browser glue.
// Anything marked data-voice-action="open_screen" data-voice-args='{"screen":"mindmedia"}' runs that registry action.
import { ACTIONS, createController, helpFor, comboOf, stripWake, sentences, coerceTalk, isStop, HANDS_FREE_AUTO_OFF_MS, NO_KEY_LINE, TALK_DEFAULTS } from "./voice-actions.js";
import { connectInstant } from "./voice-realtime.js";

const { $, toast, api, esc } = window.CC;
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

const css = `
#vt-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 14px; font-size: .8125rem; border-top: 1px solid var(--line); background: var(--card-bg, #0b111b); }
#vt-bar.vt-float { position: fixed; left: 12px; bottom: 12px; z-index: 60; border: 1px solid var(--line); border-radius: 12px; max-width: calc(100vw - 24px); }
#vt-bar .vt-state { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
#vt-bar .vt-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted, #888); }
#vt-bar[data-state="listening"] .vt-dot { background: var(--red, #f87171); box-shadow: 0 0 8px var(--red, #f87171); animation: vt-pulse 1.1s ease-in-out infinite; }
#vt-bar[data-state="ready"] .vt-dot { background: transparent; border: 2px solid var(--green, #4ade80); }
#vt-bar[data-state="thinking"] .vt-dot { background: var(--amber, #fbbf24); }
#vt-bar[data-state="speaking"] .vt-dot { background: var(--accent, #22d3ee); box-shadow: 0 0 8px var(--accent, #22d3ee); }
#vt-bar[data-state="waiting"] .vt-dot { background: var(--amber, #fbbf24); animation: vt-pulse .7s ease-in-out infinite; }
@keyframes vt-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { #vt-bar .vt-dot { animation: none !important; } }
#vt-bar .vt-strip { flex: 1 1 220px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
#vt-bar .vt-strip b { color: var(--text); font-weight: 600; }
#vt-bar .vt-line { flex: 1 0 100%; color: var(--amber, #fbbf24); }
#vt-bar .vt-line[hidden], #vt-bar [hidden] { display: none !important; }
#vt-bar label { display: inline-flex; gap: 4px; align-items: center; }
@media (max-width: 760px) { #vt-bar.vt-float { bottom: 70px; left: 8px; right: 8px; } }
#vt-help { position: fixed; right: 16px; bottom: 64px; z-index: 70; width: min(420px, calc(100vw - 32px)); max-height: 60vh; overflow: auto; background: var(--card-bg, #0b111b); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
#vt-help h3 { margin: 0 0 6px; font-size: .95rem; }
#vt-help ul { margin: 0; padding-left: 18px; }
#vt-help li { margin: 3px 0; }
.vt-num { position: fixed; z-index: 90; background: #fbbf24; color: #111; font: 700 11px/1 system-ui; padding: 2px 5px; border-radius: 8px; pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
`;
if (!document.getElementById("cc-voice-talk-style")) {
  const st = document.createElement("style");
  st.id = "cc-voice-talk-style";
  st.textContent = css;
  document.head.appendChild(st);
}

let cfg = coerceTalk(null);
let status = { listen: "", speaker: "browser", realtime: "", needsKey: false, line: "" };
let talkOn = false;
let micState = "off"; // off | ready | listening
let speaking = false;
let transcribing = false;
let pttHeld = false;
let handle = null; // instant voice connection
let stream = null;
let actx = null;
let vadTimer = null;
let rec = null;
let recStart = 0;
let recChunks = [];
let recStopResolve = null;
let sr = null;
let lastHeardAt = 0;
let lastWakeAt = 0;
let lastActivity = 0;
let speakGen = 0;
let audioEl = null;
let voicedFrames = 0;
let quietFrames = 0;
let noiseFloor = 0.01;
let watching = null;
let numberBadges = [];
let numberTargets = [];
let loaded = false;

const BUSY = new Set(["running", "planning", "assembling"]);
const S = () => window.CC.S;

// ---------------------------------------------------------------- speaking
function stopSpeech() {
  speakGen += 1;
  try { audioEl?.pause(); } catch { /* nothing playing */ }
  audioEl = null;
  try { window.speechSynthesis?.cancel(); } catch { /* no built-in voice */ }
  if (speaking) { speaking = false; paint(); }
}

function playBlob(b64, mime, gen) {
  return new Promise((resolve) => {
    if (gen !== speakGen) return resolve();
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || "audio/mpeg" }));
    const a = new Audio(url);
    audioEl = a;
    const done = () => { URL.revokeObjectURL(url); if (audioEl === a) audioEl = null; resolve(); };
    a.onended = done; a.onerror = done; a.onpause = done;
    a.play().catch(done);
  });
}

function browserSay(text, gen) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth || gen !== speakGen) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.onend = resolve; u.onerror = resolve;
    synth.speak(u);
  });
}

async function fetchSpeech(text) {
  try { return await api("/voice/speak", { method: "POST", body: { text } }); } catch { return { engine: "browser", text }; }
}

// Sentence by sentence: the next sentence is fetched while this one plays, and a stop lands between sentences.
async function speak(text, { long } = {}) {
  if (!cfg.speak || !text) return;
  const list = sentences(text).slice(0, long ? 14 : 4);
  if (!list.length) return;
  const gen = ++speakGen;
  speaking = true; paint();
  let next = fetchSpeech(list[0]);
  for (let i = 0; i < list.length; i++) {
    if (gen !== speakGen) return;
    const cur = await next;
    next = i + 1 < list.length ? fetchSpeech(list[i + 1]) : null;
    if (gen !== speakGen) return;
    if (cur?.engine === "text") break; // speech is switched off: the strip shows the words
    if (cur?.audio) await playBlob(cur.audio, cur.mime, gen);
    else await browserSay(cur?.text || list[i], gen);
  }
  if (gen === speakGen) { speaking = false; paint(); }
}

// ---------------------------------------------------------------- the host: what the actions do in the app
const text$ = () => String($("#orders")?.value || $("#cc-dock-input")?.value || "");

function currentResult() {
  const s = S();
  const live = s.live;
  if (live?.deliverable && String(live.deliverable).trim()) return Promise.resolve({ id: live.id, text: String(live.deliverable), title: String(s.lastOrders || live.title || "your result").slice(0, 60) });
  const last = (s.missions || [])[0];
  if (!last?.id) return Promise.resolve(null);
  return api(`/missions/${encodeURIComponent(last.id)}`).then((m) => (m?.deliverable ? { id: m.id, text: String(m.deliverable), title: String(m.goal || m.prompt || "your result").slice(0, 60) } : null)).catch(() => null);
}

async function memoryCall(path, body) {
  try { return await api(path, { method: "POST", body }); }
  catch (e) {
    if (/not found|404|unknown route|no such/i.test(String(e?.message))) { toast("Memories are not available in this version yet."); return false; }
    throw e;
  }
}

const SECRET_LIKE = /\b(password|passcode|api key|secret|token|ssn|social security|card number|account number|routing number)\b|\bsk-[a-z0-9]{8,}|\b\d{9,}\b/i;

const host = {
  view: () => S().view,
  speak: (t, o) => speak(t, o),
  stopSpeech: () => stopSpeech(),
  getText: () => text$(),
  async openScreen(s) { if (s.settings) window.CC.openSettings(s.settings); else window.CC.go(s.id); },
  async back() { window.CC.navBack?.(); },
  async projects() { return S().projects || []; },
  async newProject(name) {
    const made = await api("/projects", { method: "POST", body: { name, color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } });
    await window.CC.refresh?.();
    if (made?.id) { window.CC.setWorkingProject(made.id); toast(`${name} is now your active project.`); }
    return made?.id ? made : false;
  },
  async switchProject(p) { window.CC.setWorkingProject(p.id); window.CC.syncProjectBar?.(); toast(`Active project: ${p.name}.`); },
  async deleteProject(p) {
    await api(`/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    await window.CC.refresh?.();
    return true;
  },
  async setMode(mode) {
    const b = document.querySelector(`#run-mode [data-m="${mode}"], .dock-modes [data-m="${mode}"], [data-mode-pick="${mode}"]`);
    if (b) { b.click(); return true; }
    S().cmdMode = mode; S().cmdModeExplicit = true;
    return true;
  },
  async run(text) {
    if (S().view !== "command") { window.CC.go("command"); await new Promise((r) => setTimeout(r, 120)); }
    const box = $("#orders") || $("#cc-dock-input");
    if (!box) return false;
    box.value = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    ($("#go") || $("#cc-dock-send"))?.click();
    watchRun();
    return true;
  },
  async stop() {
    const s = S();
    const id = s.live?.id || s.stopId;
    const running = !!(s.awaitingRun || (id && BUSY.has(s.live?.status)));
    if (!running || !id) return false;
    try { await api(`/mission/${encodeURIComponent(id)}/abort`, { method: "POST" }); } catch { return false; }
    watching = null;
    return true;
  },
  async status() {
    const s = S();
    const running = !!(s.awaitingRun || (s.live?.id && BUSY.has(s.live?.status)));
    const cost = s.live?.cost ?? s.live?.mission?.cost ?? s.live?.mission?.spent;
    return { running, label: running ? "A job is running" : "", cost: typeof cost === "number" && cost > 0 ? (window.CC.money ? window.CC.money(cost) : `$${cost.toFixed(2)}`) : "" };
  },
  lastResult: () => currentResult(),
  async publish(r) {
    if (!window.CC.saveToMindMedia) return false;
    const out = await window.CC.saveToMindMedia({ kind: "text", text: r.text, name: r.title, status: "Review", source: "voice", quiet: false });
    return !!out?.ok;
  },
  async remember(text) {
    if (SECRET_LIKE.test(text)) return { refused: true };
    const r = await memoryCall("/memories/remember", { text, scope: "global", source: "voice" });
    return r === false ? false : r || true;
  },
  async forget(text) {
    const r = await memoryCall("/memories/forget", { text, source: "voice" });
    return r === false ? false : r || true;
  },
  async steer({ ai, step, verb }) {
    const where = step ? `part ${step}` : "the last part";
    const req = `Please ${verb || "redo"} ${where} of the last result, using ${ai || "a different AI"} if you can.`;
    return host.run(req);
  },
  async showHelp(list) { openHelp(list); },
  async numbers(on) { return on ? showNumbers() : (hideNumbers(), 0); },
  async clickNumber(n) { return clickNumber(n); },
  spendCheck: async () => null,
};

let controller = null;
function ctl() {
  if (!controller) {
    controller = createController(host, {
      interpret: async (heard, ctx) => {
        try { return await api("/voice/interpret", { method: "POST", body: { text: heard, view: ctx.view } }); } catch { return null; }
      },
    });
    controller.subscribe(() => paint());
  }
  return controller;
}

// A finished run is spoken (the first sentences) and left on screen. "Read it to me" reads the rest.
function watchRun() {
  const token = Symbol("watch");
  watching = token;
  const started = Date.now();
  const tick = async () => {
    if (watching !== token) return;
    const s = S();
    const busy = !!(s.awaitingRun || (s.live?.id && BUSY.has(s.live?.status)));
    if (!busy && Date.now() - started > 1500 && s.live?.status) {
      watching = null;
      const st = s.live.status;
      if (st === "aborted") return;
      const r = await currentResult();
      if (st === "failed" || !r) { void ctl().notify("That did not finish. Open the run for the reason."); return; }
      const first = sentences(r.text).slice(0, 2).join(" ").slice(0, 300);
      void ctl().notify(`Your result is ready. ${first} Say read it to me for the rest, or publish it to MindMedia.`);
      return;
    }
    if (Date.now() - started > 15 * 60 * 1000) { watching = null; return; }
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 1500);
}

// ---------------------------------------------------------------- listening
function levelNow(an, buf) {
  an.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
  return Math.sqrt(sum / buf.length);
}

async function openMic() {
  if (stream && stream.getTracks().some((t) => t.readyState === "live")) return true;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { toast("The microphone is blocked. Allow it in your browser or Windows privacy settings.", true); return false; }
  return true;
}

function closeMic() {
  clearInterval(vadTimer); vadTimer = null;
  try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
  stream = null;
  try { actx?.close(); } catch {}
  actx = null;
  rec = null;
}

function startUtterance() {
  if (rec || !stream || typeof MediaRecorder === "undefined") return;
  try {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const mime = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch { rec = null; return; }
  recChunks = [];
  recStart = Date.now();
  rec.ondataavailable = (e) => { if (e.data?.size) recChunks.push(e.data); };
  const r = rec;
  r.onstop = () => { const blob = new Blob(recChunks, { type: r.mimeType || "audio/webm" }); const ms = Date.now() - recStart; rec = null; recStopResolve?.(); void transcribeBlob(blob, ms); };
  try { r.start(); } catch { rec = null; return; }
  micState = "listening"; paint();
}

function endUtterance() {
  if (!rec) return;
  try { if (rec.state !== "inactive") rec.stop(); } catch { rec = null; }
}

async function transcribeBlob(blob, ms) {
  micState = talkOn ? "ready" : "off";
  if (ms < 350 || blob.size < 600) { paint(); return; }
  transcribing = true; paint();
  try {
    const buf = await blob.arrayBuffer();
    let bin = ""; const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    const r = await api("/voice/transcribe", { method: "POST", body: { mime: blob.type || "audio/webm", audio: btoa(bin) } });
    transcribing = false; paint();
    const t = String(r?.text || "").trim();
    if (t) await onTranscript(t, { ptt: pttHeld });
  } catch (e) {
    transcribing = false; paint();
    // 0.4.25: a quiet clip in hands-free is normal (a cough, a door). Say so only when the person held the key to talk.
    if (e?.code === "voice_silent" && cfg.handsFree && !pttHeld) return;
    toast(e.message || "Could not hear that.", true);
  }
}

function startVad() {
  if (vadTimer || !stream) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaStreamSource(stream);
    const an = actx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    voicedFrames = 0; quietFrames = 0;
    vadTimer = setInterval(() => {
      if (!talkOn) return;
      if (pttHeld) return; // the key decides while it is held
      const lvl = levelNow(an, buf);
      const thr = Math.max(speaking ? 0.07 : 0.025, noiseFloor * 3);
      if (lvl < thr) noiseFloor = noiseFloor * 0.95 + lvl * 0.05;
      const voiced = lvl > thr;
      if (voiced) { voicedFrames += 1; quietFrames = 0; lastActivity = Date.now(); } else { quietFrames += 1; if (quietFrames > 3) voicedFrames = 0; }
      // Talking over it: speech while it is speaking stops the voice at once.
      if (speaking && voicedFrames >= 5) stopSpeech();
      if (cfg.handsFree && !rec && voicedFrames >= 2 && !transcribing) startUtterance();
      if (rec && quietFrames >= 17 && !pttHeld) endUtterance(); // about 0.85 s of quiet
      if (rec && Date.now() - recStart > 30000) endUtterance();
      if (cfg.handsFree && Date.now() - lastActivity > HANDS_FREE_AUTO_OFF_MS) { void setCfg({ handsFree: false }); toast("Hands-free turned itself off after 10 quiet minutes."); }
    }, 50);
  } catch { /* no audio analysis: push-to-talk still works */ }
}

// Web Speech (Chrome, Edge) when no speech-to-text key is saved.
function startSR() {
  const Ctor = SR();
  if (!Ctor || sr) return false;
  const r = new Ctor();
  r.lang = "en-US"; r.continuous = true; r.interimResults = true;
  r.onspeechstart = () => { if (speaking) stopSpeech(); micState = "listening"; paint(); };
  r.onresult = (e) => {
    if (speaking) stopSpeech();
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) void onTranscript(e.results[i][0].transcript, { ptt: pttHeld });
  };
  r.onend = () => { sr = null; micState = talkOn ? "ready" : "off"; paint(); if (talkOn && (cfg.handsFree || pttHeld)) setTimeout(startSR, 200); };
  r.onerror = () => {};
  sr = r;
  try { r.start(); micState = "listening"; return true; } catch { sr = null; return false; }
}

// A phrase heard. The wake word (when on) gates always-listening phrases; push-to-talk never needs it.
async function onTranscript(raw, { ptt = false } = {}) {
  let t = String(raw || "").trim();
  if (!t) return;
  lastActivity = Date.now();
  if (cfg.wakeWord && !ptt && !controller?.pending) {
    const after = stripWake(t);
    const inWindow = Date.now() - lastWakeAt < 12000;
    if (after === null && !inWindow) return; // not for Meld
    if (after === "") { lastWakeAt = Date.now(); void ctl().notify("Yes?"); return; }
    if (after !== null) { t = after; }
    lastWakeAt = Date.now();
  }
  lastHeardAt = Date.now();
  await ctl().hear(t);
}

// ---------------------------------------------------------------- Talk on / off
async function setCfg(patch) {
  try {
    const r = await api("/voice/talk", { method: "POST", body: patch });
    cfg = coerceTalk(r.settings); status = r.status || status;
  } catch (e) { toast(e.message, true); }
  if (!cfg.handsFree && !pttHeld) { endUtterance(); }
  if (talkOn) void ensureListening();
  paint();
}

async function ensureListening() {
  if (handle) return;
  if (cfg.handsFree || pttHeld) {
    if (status.listen === "" && SR()) { startSR(); return; }
    startVad();
  }
}

async function talkStart() {
  if (talkOn) return;
  talkOn = true; lastActivity = Date.now();
  micState = "ready";
  paint();
  if (status.needsKey && !SR()) { paint(); return; }
  // Instant two-way voice when paid voice is on and a key for it exists; otherwise the normal listen / think / speak path.
  if (cfg.instant && status.realtime) {
    try {
      const session = await api("/voice/realtime", { method: "POST", body: {} });
      if (session?.engine && session.engine !== "none") {
        handle = await connectInstant(session, {
          controller: ctl(),
          onState: (s) => { instantState = s; paint(); },
          onHeard: (h) => ctl().noteHeard?.(h),
          onReply: () => {},
        });
        if (handle) { micState = "listening"; paint(); return; }
      }
    } catch (e) { toast(`${e.message || "Instant voice could not start."} Using the normal voice instead.`); handle = null; }
  }
  if (!await openMic()) { talkOn = false; micState = "off"; paint(); return; }
  if (status.listen === "" && SR() && cfg.handsFree) startSR(); else startVad();
  paint();
}

let instantState = "";

function talkStop() {
  talkOn = false; pttHeld = false;
  stopSpeech();
  try { handle?.close(); } catch {} handle = null; instantState = "";
  try { sr?.abort(); } catch {} sr = null;
  endUtterance();
  closeMic();
  controller?.cancelAll();
  micState = "off";
  paint();
}

async function toggleTalk() {
  if (talkOn) { talkStop(); await setCfg({ talk: false }); } else { await setCfg({ talk: true }); await talkStart(); }
}

// ---------------------------------------------------------------- push to talk
function onKeyDown(e) {
  if (e.key === "Escape") { if (speaking || handle) { stopSpeech(); handle?.cancel?.(); } return; }
  if (comboOf(e) !== cfg.hotkey) return;
  e.preventDefault();
  if (e.repeat || pttHeld) return;
  void pttDown();
}
function onKeyUp(e) {
  if (!pttHeld) return;
  const k = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (cfg.hotkey.split("+").pop() !== k && !["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
  void pttUp();
}
let pttAt = 0;
async function pttDown() {
  pttHeld = true; pttAt = Date.now();
  stopSpeech();
  if (!talkOn) { await setCfg({ talk: true }); await talkStart(); }
  if (handle) return; // instant voice listens by itself
  if (status.listen === "" && SR()) { startSR(); return; }
  if (!stream && !(await openMic())) { pttHeld = false; return; }
  startVad();
  startUtterance();
}
async function pttUp() {
  const held = Date.now() - pttAt;
  pttHeld = false;
  if (sr) { try { sr.stop(); } catch {} return; }
  // A quick tap keeps listening until a pause; a hold stops when released.
  if (held > 350) endUtterance();
  else quietFrames = 0;
}

// ---------------------------------------------------------------- numbers overlay
const CLICKABLE = 'button, a[href], [role="button"], input:not([type="hidden"]), select, textarea, summary, [data-view]';
function showNumbers() {
  hideNumbers();
  const vw = window.innerWidth, vh = window.innerHeight;
  const all = [...document.querySelectorAll(CLICKABLE)].filter((el) => {
    if (el.closest("#vt-bar, #vt-help")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && !el.disabled;
  }).slice(0, 99);
  numberTargets = all;
  numberBadges = all.map((el, i) => {
    const r = el.getBoundingClientRect();
    const b = document.createElement("div");
    b.className = "vt-num"; b.textContent = String(i + 1);
    b.style.left = `${Math.max(0, r.left)}px`; b.style.top = `${Math.max(0, r.top)}px`;
    document.body.appendChild(b);
    return b;
  });
  return all.length;
}
function hideNumbers() { numberBadges.forEach((b) => b.remove()); numberBadges = []; numberTargets = []; }
function clickNumber(n) {
  const el = numberTargets[n - 1];
  if (!el) return false;
  hideNumbers(); // overlays vanish after an action, like Windows Voice Access
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.focus(); else el.click();
  return true;
}

// ---------------------------------------------------------------- "What can I say?"
function openHelp(list) {
  closeHelp();
  const v = S().view;
  const items = list || helpFor(v);
  const card = document.createElement("div");
  card.id = "vt-help";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "What can I say");
  card.innerHTML = `<h3>What can I say? <button type="button" class="btn sm" id="vt-help-x" style="float:right">Close</button></h3>
    <div class="dim small" style="margin-bottom:6px">Hold ${esc(cfg.hotkey)} and say any of these. Everything here is also a button.</div>
    <ul>${items.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
  document.body.appendChild(card);
  card.querySelector("#vt-help-x").addEventListener("click", closeHelp);
}
function closeHelp() { document.getElementById("vt-help")?.remove(); }

// ---------------------------------------------------------------- the bar
function stateName() {
  if (controller?.pending) return "waiting"; // a typed or spoken question can wait even with Talk off
  if (!talkOn) return "off";
  if (speaking || instantState === "speaking") return "speaking";
  if (transcribing || instantState === "thinking" || ["heard", "doing"].includes(controller?.strip.phase)) return "thinking";
  if (micState === "listening" || instantState === "listening") return "listening";
  return "ready";
}
const STATE_LABEL = { off: "Talk is off", ready: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking", waiting: "Waiting for yes" };

function barHtml() {
  return `<button type="button" class="btn sm" id="vt-talk" aria-pressed="false" title="Talk to Meldmind. It answers out loud.">Talk</button>
    <span class="vt-state" id="vt-state" aria-live="polite"><i class="vt-dot" aria-hidden="true"></i><span id="vt-state-text">Talk is off</span></span>
    <span class="vt-strip" id="vt-strip" aria-live="polite"></span>
    <label class="small" title="Keeps the microphone open until you stop talking. Turns itself off after 10 quiet minutes."><input type="checkbox" id="vt-hands"> Hands-free</label>
    <button type="button" class="btn sm" id="vt-yes" hidden>Yes</button>
    <button type="button" class="btn sm" id="vt-no" hidden>No</button>
    <button type="button" class="btn sm" id="vt-stop" title="Stop talking and stop the current job">Stop</button>
    <button type="button" class="btn sm" id="vt-help-btn" title="What can I say?">What can I say?</button>
    <div class="vt-line small" id="vt-line" hidden></div>`;
}

function ensureBar() {
  let bar = document.getElementById("vt-bar");
  const dock = document.getElementById("cc-dock");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "vt-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Talk to Meldmind");
    bar.innerHTML = barHtml();
    wireBar(bar);
  }
  const col = dock?.parentElement || document.querySelector(".view-col");
  if (col) {
    // Slim bar in the page column: above the chat dock when there is one, else under the page. It never covers the AI bar.
    if (dock && dock.parentElement === col) { if (bar.nextSibling !== dock || bar.parentElement !== col) col.insertBefore(bar, dock); }
    else if (bar.parentElement !== col || bar.nextSibling) col.appendChild(bar);
    bar.classList.remove("vt-float");
  } else {
    if (bar.parentElement !== document.body) document.body.appendChild(bar);
    bar.classList.add("vt-float");
  }
  return bar;
}

function wireBar(bar) {
  bar.querySelector("#vt-talk").addEventListener("click", () => { void toggleTalk(); });
  bar.querySelector("#vt-hands").addEventListener("change", (e) => {
    const on = e.target.checked;
    void (async () => { await setCfg({ handsFree: on }); if (on && !talkOn) await toggleTalk(); if (on) lastActivity = Date.now(); })();
  });
  bar.querySelector("#vt-stop").addEventListener("click", () => { void ctl().runAction("stop"); handle?.cancel?.(); });
  bar.querySelector("#vt-help-btn").addEventListener("click", () => { if (document.getElementById("vt-help")) closeHelp(); else openHelp(); });
  bar.querySelector("#vt-yes").addEventListener("click", () => { void ctl().confirm(); });
  bar.querySelector("#vt-no").addEventListener("click", () => { void ctl().decline(); });
}

function paint() {
  const bar = ensureBar();
  const s = stateName();
  bar.dataset.state = s;
  bar.dataset.talk = talkOn ? "on" : "off";
  const t = bar.querySelector("#vt-talk");
  t.setAttribute("aria-pressed", talkOn ? "true" : "false");
  t.classList.toggle("primary", talkOn);
  t.textContent = talkOn ? "Talking" : "Talk";
  bar.querySelector("#vt-state-text").textContent = STATE_LABEL[s];
  const hands = bar.querySelector("#vt-hands");
  if (hands) hands.checked = !!cfg.handsFree;
  const strip = controller?.strip;
  const el = bar.querySelector("#vt-strip");
  if (strip && (strip.heard || strip.done || strip.waiting)) {
    el.innerHTML = [strip.heard ? `<b>Heard:</b> ${esc(strip.heard)}` : "", strip.doing ? `<b>Doing:</b> ${esc(strip.doing)}` : "", strip.waiting ? `<b>Asking:</b> ${esc(strip.waiting)}` : "", strip.done ? `<b>Done:</b> ${esc(strip.done)}` : ""].filter(Boolean).join(" &rarr; ");
  } else {
    el.textContent = talkOn ? (cfg.handsFree ? "Just talk. Say stop any time." : `Hold ${cfg.hotkey} to talk, or press Talk.`) : `Hold ${cfg.hotkey} to talk to Meldmind.`;
  }
  const waiting = s === "waiting";
  bar.querySelector("#vt-yes").hidden = !waiting;
  bar.querySelector("#vt-no").hidden = !waiting;
  const line = bar.querySelector("#vt-line");
  if (status.needsKey) {
    line.hidden = false;
    line.innerHTML = `${esc(status.line || NO_KEY_LINE)} <a href="#" id="vt-keys">Open the keys screen</a>`;
    line.querySelector("#vt-keys").addEventListener("click", (e) => { e.preventDefault(); window.CC.openSettings("keys"); });
  } else if (!line.hidden) { line.hidden = true; line.textContent = ""; }
}

// A button anywhere: <button data-voice-action="open_screen" data-voice-args='{"screen":"mindmedia"}'>
function onClickDelegate(e) {
  const b = e.target.closest?.("[data-voice-action]");
  if (!b) return;
  let args = {};
  try { args = JSON.parse(b.dataset.voiceArgs || "{}"); } catch { /* no args */ }
  e.preventDefault();
  void ctl().runAction(b.dataset.voiceAction, args);
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const r = await api("/voice/talk");
    cfg = coerceTalk(r.settings); status = r.status || status;
  } catch { /* the bar still works with defaults */ }
  ctl();
  paint();
  setInterval(() => { try { ensureBar(); } catch {} }, 1500);
  // The dock can be built after this bar. Keep the bar above it the moment the page column changes.
  let pending = false;
  const again = () => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; try { ensureBar(); } catch {} }); };
  const watch = () => { const col = document.querySelector(".view-col"); if (col) new MutationObserver(again).observe(col, { childList: true }); };
  watch();
  new MutationObserver(() => { if (!document.getElementById("vt-bar")?.isConnected) again(); }).observe(document.body, { childList: true });
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("click", onClickDelegate);
  // Talk stays on across restarts only when the person left it on and the browser already holds mic permission.
}

// Exposed so other screens and tests use the same registry as the buttons and the voice.
window.CC.voice = {
  hear: (t) => ctl().hear(t),
  runAction: (id, args) => ctl().runAction(id, args),
  get controller() { return ctl(); },
  get settings() { return cfg; },
  get status() { return status; },
  get state() { return stateName(); },
  get ptt() { return pttHeld; },
  get hotkey() { return cfg.hotkey; },
  setSettings: (p) => setCfg(p),
  talk: () => toggleTalk(),
  isTalking: () => talkOn,
  stopSpeech,
  speak,
  openHelp,
  showNumbers, hideNumbers, clickNumber,
  actions: ACTIONS,
  defaults: TALK_DEFAULTS,
  isStop,
  pttDown, pttUp,
};

function renderSettings(el) {
  const row = (id, label, on, tip) => `<label class="row small" style="gap:6px;margin-top:8px" title="${esc(tip)}"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${esc(label)}</label>`;
  el.innerHTML = `<div class="panel" id="vt-settings"><h3>Talk to Meldmind</h3>
    <div class="dim small">Press Talk, or hold the shortcut, and say what you want. Meldmind answers out loud, one sentence at a time. Say "stop" or press Esc to quiet it. ${esc(status.needsKey ? status.line || NO_KEY_LINE : "")}</div>
    ${row("vts-speak", "Speak the answers out loud", cfg.speak, "Off: answers only appear as text")}
    ${row("vts-hands", "Hands-free (keeps the microphone open, turns off after 10 quiet minutes)", cfg.handsFree, "A red dot shows when it is listening")}
    ${row("vts-wake", 'Wake word: say "Hey Meld" first (off by default)', cfg.wakeWord, "Only used in hands-free. The shortcut always works.")}
    ${row("vts-instant", "Instant two-way voice (uses paid keys, only when paid voice is on)", cfg.instant, "Uses OpenAI Realtime or an ElevenLabs Agent. Turn on Use my OpenAI credits for voice under Voice orders first.")}
    <div class="row small" style="gap:8px;margin-top:10px;align-items:center"><span>Talk shortcut</span><input type="text" id="vts-key" value="${esc(cfg.hotkey)}" style="width:150px;font-family:var(--mono)" title="Click, then press the keys"><button class="btn sm" type="button" id="vts-key-default">Use Ctrl+Space</button></div>
    <div class="row small" style="gap:8px;margin-top:10px;align-items:center"><span>ElevenLabs agent id (optional)</span><input type="text" id="vts-agent" value="${esc(cfg.elevenAgentId)}" style="width:220px" placeholder="agent_..."></div>
    <div class="row small" style="gap:8px;margin-top:10px"><button class="btn sm" type="button" id="vts-help">What can I say?</button></div></div>`;
  const on = (id, key) => el.querySelector(id).addEventListener("change", (e) => { void setCfg({ [key]: e.target.checked }); });
  on("#vts-speak", "speak"); on("#vts-hands", "handsFree"); on("#vts-wake", "wakeWord"); on("#vts-instant", "instant");
  const box = el.querySelector("#vts-key");
  box.addEventListener("keydown", (e) => { if (e.key === "Tab") return; e.preventDefault(); const c = comboOf(e); if (c) { box.value = c; void setCfg({ hotkey: c }); } });
  el.querySelector("#vts-key-default").addEventListener("click", () => { box.value = "Ctrl+Space"; void setCfg({ hotkey: "Ctrl+Space" }); });
  el.querySelector("#vts-agent").addEventListener("change", (e) => { void setCfg({ elevenAgentId: e.target.value.trim() }); });
  el.querySelector("#vts-help").addEventListener("click", () => openHelp());
}

CC.register({
  id: "voice-talk",
  settings: { order: 17, render: renderSettings },
  onState() { if (!loaded) void load(); },
});
void load();
