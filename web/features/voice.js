// Voice orders: a mic button next to "Send orders".
// Tap to talk (default): tap once to start, tap again to stop. Optional stop on silence.
// Hold to talk: recording stays on for the whole press. Pointer leave, pointer
// cancel, lost capture, blur and the recognizer ending on its own do not stop a hold.
// The choice is saved with the app settings (GET/POST /api/voice).
import { buttonLabel, buttonTitle, captureMode, createSession, formatElapsed, heardNote, hint, reduce, shouldAutoSend, speechFailure } from "./voice-mode.js";

const { $, toast, api } = window.CC;
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;

const css = `
#vo-mic { touch-action: none; user-select: none; -webkit-user-select: none; }
#vo-mic.vo-live { box-shadow: 0 0 0 3px rgba(248,113,113,.45); }
.vo-live-ind { display: inline-flex; align-items: center; gap: 6px; color: var(--red); font-weight: 600; font-variant-numeric: tabular-nums; }
.vo-live-ind[hidden] { display: none !important; }
.vo-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); box-shadow: 0 0 8px var(--red); animation: vo-pulse 1s ease-in-out infinite; }
@keyframes vo-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
`;
if (!document.getElementById("cc-voice-style")) {
  const style = document.createElement("style");
  style.id = "cc-voice-style";
  style.textContent = css;
  document.head.appendChild(style);
}

const LS = "cc.voice";
function readCache() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; } }
function cache(v) { try { localStorage.setItem(LS, JSON.stringify({ mode: v.mode, silenceStop: !!v.silenceStop, autoSend: !!v.autoSend })); } catch {} }

let session = createSession(readCache());
let note = "";
let recognition = null;
let finalText = "";
let baseText = "";
let generation = 0;
let restartTimer = null;
let tickTimer = null;
let micStream = null;
let micPromise = null;
let recorder = null;
let serverCapture = false;
let startFails = 0;
let rev = 0;
let synced = false;
let globals = false;

function paint() {
  const btn = document.getElementById("vo-mic");
  if (btn) {
    const on = session.recording;
    btn.classList.toggle("primary", on);
    btn.classList.toggle("vo-live", on);
    btn.textContent = btn.hasAttribute("data-simple-mic") ? (on ? "Stop" : "Mic") : buttonLabel(session);
    btn.title = buttonTitle(session);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const live = document.getElementById("vo-live");
  if (live) {
    live.hidden = !session.recording;
    const t = document.getElementById("vo-timer");
    if (t) t.textContent = session.recording && session.startedAt ? formatElapsed(Date.now() - session.startedAt) : "0:00";
  }
  const status = document.getElementById("vo-status");
  if (status) status.textContent = session.recording ? "" : note;
  const hintEl = document.getElementById("vo-hint");
  if (hintEl) hintEl.textContent = hint(session);
  const silence = document.getElementById("vo-silence");
  const silenceLabel = document.getElementById("vo-silence-label");
  if (silence) silence.checked = !!session.silenceStop;
  if (silenceLabel) silenceLabel.hidden = session.mode !== "tap";
  const seg = document.getElementById("vo-mode");
  if (seg) seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === session.mode));
  const setSilence = document.getElementById("vo-silence-set");
  if (setSilence) setSilence.checked = !!session.silenceStop;
  for (const id of ["vo-auto", "vo-auto-set"]) { const box = document.getElementById(id); if (box) box.checked = !!session.autoSend; }
}

function apply(event) {
  const { session: next, effect } = reduce(session, event, Date.now());
  session = next;
  if (event?.type === "error" && (event.code === "not-allowed" || event.code === "service-not-allowed")) note = "microphone blocked";
  if (effect === "start") { note = ""; void begin(); }
  else if (effect === "stop") finish();
  else if (effect === "restart") scheduleRestart();
  paint();
  return effect;
}

function startClock() { if (!tickTimer) tickTimer = setInterval(paint, 250); }
function stopClock() { clearInterval(tickTimer); tickTimer = null; }

function closeMic() {
  const stream = micStream;
  micStream = null;
  try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
}

function ensureMic() {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.resolve(true);
  if (micStream && micStream.getTracks().some((t) => t.readyState === "live")) return Promise.resolve(true);
  if (!micPromise) {
    micPromise = navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      micStream = stream;
      return true;
    }).catch(() => false).finally(() => { micPromise = null; });
  }
  return micPromise;
}

function wantServer() {
  return captureMode({ desktop: !!window.ccDesktop?.desktop, server: serverCapture }) === "server";
}

function blobToB64(blob) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
    return btoa(bin);
  });
}

function startRecorder() {
  if (recorder || !micStream || typeof MediaRecorder === "undefined") return false;
  let rec;
  try {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const mime = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
    rec = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
  } catch {
    return false;
  }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
  });
  try { rec.start(); } catch { return false; }
  recorder = {
    stop() {
      try { if (rec.state !== "inactive") rec.stop(); } catch { /* already stopped */ }
      return stopped;
    },
  };
  return true;
}

function writeTranscript(interim) {
  const box = $("#orders");
  if (!box) return;
  box.value = (baseText ? baseText + " " : "") + finalText + (interim || "");
  box.dispatchEvent(new Event("input"));
}

function scheduleRestart() {
  if (restartTimer || !session.recording) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (!session.recording || recognition) return;
    void begin({ keep: true });
  }, 60);
}

async function begin({ keep = false } = {}) {
  const myGen = ++generation;
  if (!keep) {
    finalText = "";
    baseText = ($("#orders")?.value || "").trim();
  }
  startClock();
  const ok = await ensureMic();
  if (myGen !== generation || !session.recording) { if (!session.recording) closeMic(); return; }
  if (!ok) { apply({ type: "error", code: "not-allowed" }); return; }
  if (wantServer()) {
    if (!startRecorder()) {
      note = "Could not capture audio from the microphone.";
      toast(note, true);
      apply({ type: "error", code: "audio-capture" });
    }
    return;
  }
  const Ctor = SR();
  if (!Ctor || recognition) return;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  rec.onresult = (e) => {
    startFails = 0;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t + " ";
      else interim += t;
    }
    writeTranscript(interim);
  };
  rec.onspeechstart = () => { rec._ccSilence = false; };
  rec.onspeechend = () => { rec._ccSilence = true; };
  rec.onerror = (e) => {
    const code = e.error || "";
    if (code === "aborted") return;
    const fail = speechFailure(code);
    if (fail) {
      toast(fail.toast, !!fail.error);
      if (fail.effect === "server") {
        serverCapture = true;
        if (recognition === rec) recognition = null;
        try { rec.abort(); } catch { /* already ended */ }
        if (session.recording && !startRecorder()) {
          note = "Could not capture audio from the microphone.";
          toast(note, true);
          apply({ type: "error", code: "audio-capture" });
        }
        return;
      }
      apply({ type: "error", code });
      return;
    }
    if (code === "not-allowed" || code === "service-not-allowed") apply({ type: "error", code });
  };
  rec.onend = () => {
    if (recognition === rec) recognition = null;
    if (serverCapture || recorder) return;
    if (!session.recording) return;
    apply({ type: "recognizerend", cause: rec._ccSilence ? "silence" : "end" });
  };
  recognition = rec;
  try { rec.start(); startFails = 0; }
  catch {
    if (recognition === rec) recognition = null;
    startFails += 1;
    if (startFails > 6) { note = "speech service stopped"; apply({ type: "stop" }); return; }
    scheduleRestart();
  }
}

function finish() {
  const rec = recognition;
  recognition = null;
  const cap = recorder;
  recorder = null;
  generation += 1;
  const myGen = generation;
  clearTimeout(restartTimer);
  restartTimer = null;
  try { rec?.abort(); } catch {}
  stopClock();
  if (cap) {
    note = "Transcribing...";
    paint();
    void finishServer(cap, myGen);
    return;
  }
  closeMic();
  const text = finalText.trim();
  const sticky = note === "microphone blocked" || note === "speech service stopped";
  if (!sticky) note = heardNote(text);
  finalText = "";
  if (shouldAutoSend(session, text, sticky)) $("#go")?.click();
  paint();
}

async function finishServer(cap, myGen) {
  let text = "";
  try {
    const blob = await cap.stop();
    if (myGen !== generation) { closeMic(); return; }
    if (!blob || blob.size < 80) note = "No speech heard";
    else {
      const audio = await blobToB64(blob);
      const r = await api("/voice/transcribe", { method: "POST", body: { mime: blob.type || "audio/webm", audio } });
      if (myGen !== generation) { closeMic(); return; }
      text = String(r.text || "").trim();
      if (text) {
        finalText = text;
        writeTranscript("");
        note = "captured";
      } else note = "No speech heard";
    }
  } catch (e) {
    if (myGen !== generation) { closeMic(); return; }
    note = e.message || "Transcription failed";
    toast(note, true);
  }
  closeMic();
  const sticky = note !== "captured";
  finalText = "";
  if (shouldAutoSend(session, text, sticky)) $("#go")?.click();
  paint();
}

function bindGlobal() {
  if (globals) return;
  globals = true;
  window.addEventListener("pointerup", (e) => apply({ type: "pointerup", pointerId: e.pointerId, button: e.button }));
  window.addEventListener("pointercancel", (e) => apply({ type: "pointercancel", pointerId: e.pointerId, buttons: e.buttons }));
  window.addEventListener("keyup", (e) => {
    if (session.source === "key" && session.held) apply({ type: "keyup", key: e.key });
  });
  // Blur (a permission prompt, a re-render, the window losing focus) is not a release.
  window.addEventListener("blur", () => apply({ type: "blur" }));
}

function wireButton(btn) {
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch {}
    try { btn.focus({ preventScroll: true }); } catch {}
    apply({ type: "pointerdown", button: e.button, pointerId: e.pointerId });
  });
  // Leave and lost capture are reported and then ignored for a hold.
  btn.addEventListener("pointerleave", (e) => apply({ type: "pointerleave", pointerId: e.pointerId }));
  btn.addEventListener("lostpointercapture", (e) => apply({ type: "lostpointercapture", pointerId: e.pointerId }));
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => e.preventDefault());
  btn.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    apply({ type: "keydown", key: e.key, repeat: e.repeat });
  });
  btn.addEventListener("keyup", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    apply({ type: "keyup", key: e.key });
  });
}

async function savePrefs(patch) {
  const n = ++rev;
  try {
    const r = await api("/voice", { method: "POST", body: patch });
    if (n !== rev) return r;
    cache(r);
    if (window.CC.S?.settings) window.CC.S.settings.voice = { mode: r.mode, silenceStop: !!r.silenceStop, autoSend: !!r.autoSend };
    apply({ type: "settings", settings: r });
    return r;
  } catch (e) { toast(e.message, true); throw e; }
}

function syncFromServer() {
  if (synced) return;
  synced = true;
  const n = ++rev;
  api("/voice").then((r) => {
    if (n !== rev) return;
    cache(r);
    apply({ type: "settings", settings: r });
  }).catch(() => { synced = false; });
}

function renderCommand(el) {
  bindGlobal();
  const simpleBtn = document.querySelector("#vo-mic[data-simple-mic]");
  if (window.CC.uiMode?.() === "simple" && simpleBtn) {
    if (simpleBtn.dataset.wired !== "1") { simpleBtn.dataset.wired = "1"; wireButton(simpleBtn); }
    el.innerHTML = "";
    paint();
    syncFromServer();
    return;
  }
  if (!SR() && !window.ccDesktop?.desktop && typeof MediaRecorder === "undefined") {
    el.innerHTML = `<div class="dim small" style="margin-top:6px">Voice orders need Chrome, Edge or the desktop app (no speech recognition in this browser). Wispr Flow dictation works in the box above.</div>`;
    return;
  }
  el.innerHTML = `<div class="row small" style="margin-top:8px;gap:8px;flex-wrap:wrap;align-items:center">
    <button class="btn sm" type="button" id="vo-mic" aria-pressed="false">Tap to talk</button>
    <label class="row small" style="gap:4px"><input type="checkbox" id="vo-auto"> auto-send</label>
    <label class="row small" id="vo-silence-label" style="gap:4px"><input type="checkbox" id="vo-silence"> stop on silence</label>
    <span class="vo-live-ind" id="vo-live" hidden><i class="vo-dot" aria-hidden="true"></i><span>Recording</span><span id="vo-timer" class="mono">0:00</span></span>
    <span class="dim" id="vo-status" aria-live="polite"></span>
  </div>
  <div class="dim small" id="vo-hint" style="margin-top:4px"></div>`;
  wireButton(el.querySelector("#vo-mic"));
  el.querySelector("#vo-auto").addEventListener("change", (e) => { savePrefs({ autoSend: e.target.checked }).catch(() => { e.target.checked = !!session.autoSend; }); });
  el.querySelector("#vo-silence").addEventListener("change", (e) => { savePrefs({ silenceStop: e.target.checked }).catch(() => { e.target.checked = !!session.silenceStop; }); });
  paint();
  syncFromServer();
}

function renderSettings(el) {
  bindGlobal();
  el.innerHTML = `<div class="panel" id="vo-settings">
    <h3>Voice orders</h3>
    <div class="dim small">Tap to talk starts on a tap and stops on the next tap. Hold to talk keeps recording for the whole time the button is held.</div>
    <div class="seg" id="vo-mode" style="margin-top:10px">
      <button type="button" data-mode="tap">Tap to talk</button>
      <button type="button" data-mode="hold">Hold to talk</button>
    </div>
    <label class="row small" style="gap:6px;margin-top:10px"><input type="checkbox" id="vo-silence-set"> Stop on silence</label>
    <div class="dim small" style="margin-top:6px">Stop on silence applies to tap to talk only. A hold is never cut off by a pause, a timeout, or the pointer sliding off the button.</div>
    <label class="row small" style="gap:6px;margin-top:10px"><input type="checkbox" id="vo-auto-set"> Auto-send</label>
    <div class="dim small" style="margin-top:6px">When recording stops and words were heard, the orders go out without a second click. Off: the words wait in the box for you to check and send.</div>
  </div>`;
  el.querySelectorAll("#vo-mode button").forEach((b) => b.addEventListener("click", () => { savePrefs({ mode: b.dataset.mode }).catch(() => paint()); }));
  el.querySelector("#vo-silence-set").addEventListener("change", (e) => { savePrefs({ silenceStop: e.target.checked }).catch(() => { e.target.checked = !!session.silenceStop; }); });
  el.querySelector("#vo-auto-set").addEventListener("change", (e) => { savePrefs({ autoSend: e.target.checked }).catch(() => { e.target.checked = !!session.autoSend; }); });
  paint();
  syncFromServer();
}

CC.register({
  id: "voice",
  command: { order: 1, render: renderCommand },
  settings: { order: 18, render: renderSettings },
  onState(state) {
    const v = state?.settings?.voice;
    if (!v) return;
    cache(v);
    const { session: next } = reduce(session, { type: "settings", settings: v }, Date.now());
    session = next;
    paint();
  },
});
