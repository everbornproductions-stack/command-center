// Voice-order mode logic. Pure: no DOM, no speech engine, no network.
// The button used to call stop on mouseleave, so a hold ended as soon as the
// pointer slid off it. These rules are the ones the button must follow.
//
// tap (default): one press starts, the next press stops. Optional silence stop.
// hold: recording stays on for the whole press. Leaving the button, losing
// pointer capture, blur, silence and the recognizer ending by itself do not stop it.

export const MODES = ["tap", "hold"];
// These Web Speech errors must stop the session. Restarting them loops forever
// (Electron reports "network" because it has no Google speech key).
export const SPEECH_STOP = ["network", "audio-capture", "language-not-supported"];

export function speechFailure(code) {
  if (code === "network") return { effect: "server", toast: "Speech recognition could not reach its service. Recording on this computer instead.", error: false };
  if (code === "audio-capture") return { effect: "stop", toast: "Could not capture audio from the microphone.", error: true };
  if (code === "language-not-supported") return { effect: "stop", toast: "This browser does not support speech recognition for that language.", error: true };
  return null;
}

// Desktop (and a browser whose speech service failed with "network") records locally.
export function captureMode({ desktop = false, server = false } = {}) {
  return desktop || server ? "server" : "web";
}

export function heardNote(text) {
  return String(text || "").trim() ? "captured" : "No speech heard";
}
export const DEFAULT_MODE = "tap";
export const DEFAULTS = { mode: DEFAULT_MODE, silenceStop: false, autoSend: false };

// Events that must not end a hold on their own.
export const EARLY_END = ["pointerleave", "pointerout", "mouseleave", "pointercancel", "lostpointercapture", "blur", "focus", "silence"];

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "voice_invalid" });

export function coerceSettings(input) {
  const mode = MODES.includes(input?.mode) ? input.mode : DEFAULT_MODE;
  return { mode, silenceStop: input?.silenceStop === true, autoSend: input?.autoSend === true };
}

// Merge a partial update. Throws on junk so the route can answer 400.
export function normalizeSettings(input, prev = DEFAULTS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("body must be an object");
  const base = coerceSettings(prev);
  const out = { mode: base.mode, silenceStop: base.silenceStop, autoSend: base.autoSend };
  if (Object.prototype.hasOwnProperty.call(input, "mode")) {
    if (!MODES.includes(input.mode)) throw bad("mode must be tap or hold");
    out.mode = input.mode;
  }
  if (Object.prototype.hasOwnProperty.call(input, "silenceStop")) out.silenceStop = input.silenceStop === true;
  // auto-send: a recording that ends with words captured sends the orders without a second click
  if (Object.prototype.hasOwnProperty.call(input, "autoSend")) out.autoSend = input.autoSend === true;
  return out;
}

export function createSession(settings) {
  const s = coerceSettings(settings);
  return {
    mode: s.mode,
    silenceStop: s.silenceStop,
    autoSend: s.autoSend,
    recording: false,
    held: false,
    source: null,
    pointerId: null,
    captureLost: false,
    armed: false,
    startedAt: null,
  };
}

// Auto-send fires only when it is on, words were captured, and the mic was not blocked or cut off.
export function shouldAutoSend(session, text, blocked = false) {
  return !!session?.autoSend && !blocked && String(text || "").trim().length > 0;
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const m = Math.floor(total / 60);
  return m + ":" + String(total % 60).padStart(2, "0");
}

export function buttonLabel(session) {
  if (session?.mode === "hold") return session.recording ? "Release to stop" : "Hold to talk";
  return session?.recording ? "Tap to stop" : "Tap to talk";
}

export function buttonTitle(session) {
  if (session?.mode === "hold") return "Hold to talk. Recording stays on until you release.";
  return session?.recording ? "Tap to stop recording." : "Tap to start. Tap again to stop.";
}

export function hint(session) {
  if (session?.mode === "hold") return "Hold the button. Recording continues until you release.";
  if (session?.silenceStop) return "Tap to start, tap again to stop. A pause also stops.";
  return "Tap to start, tap again to stop.";
}

function release(s) {
  const was = s.recording;
  s.recording = false;
  s.held = false;
  s.source = null;
  s.pointerId = null;
  s.captureLost = false;
  s.armed = false;
  s.startedAt = null;
  return { session: s, effect: was ? "stop" : "none" };
}

function begin(s, now, source, pointerId) {
  s.held = source !== "tap";
  s.source = source === "tap" ? null : source;
  s.pointerId = pointerId ?? null;
  s.captureLost = false;
  s.armed = false;
  if (!s.recording) {
    s.recording = true;
    s.startedAt = now;
    return { session: s, effect: "start" };
  }
  return { session: s, effect: "none" };
}

function toggle(s, now) {
  if (s.recording) return release(s);
  s.recording = true;
  s.held = false;
  s.source = null;
  s.pointerId = null;
  s.captureLost = false;
  s.armed = false;
  s.startedAt = now;
  return { session: s, effect: "start" };
}

// Returns { session, effect } where effect is "start", "stop", "restart" or "none".
// The returned session is the one to keep; the previous object is left unchanged.
export function reduce(session, event, now = 0) {
  const s = { ...session };
  const ev = event || {};
  const none = () => ({ session: s, effect: "none" });

  switch (ev.type) {
    case "settings": {
      try {
        const next = normalizeSettings(ev.settings || {}, { mode: s.mode, silenceStop: s.silenceStop, autoSend: s.autoSend });
        s.mode = next.mode;
        s.silenceStop = next.silenceStop;
        s.autoSend = next.autoSend;
      } catch { /* keep the current choice when a payload is junk */ }
      return none();
    }

    case "pointerdown": {
      if (ev.button != null && ev.button !== 0) return none();
      if (s.mode === "hold") {
        // A second down on a capture we still own is the same press (ignore it).
        // If capture was lost, this press re-attaches the hold without cutting it off.
        if (s.held && s.source === "pointer" && !s.captureLost) return none();
        return begin(s, now, "pointer", ev.pointerId);
      }
      s.armed = true;
      s.pointerId = ev.pointerId ?? null;
      return none();
    }

    case "pointerup": {
      if (s.held && s.source === "pointer") {
        if (s.pointerId != null && ev.pointerId != null && ev.pointerId !== s.pointerId && !s.captureLost) return none();
        return release(s);
      }
      if (s.armed) {
        if (s.pointerId != null && ev.pointerId != null && ev.pointerId !== s.pointerId) return none();
        s.armed = false;
        s.pointerId = null;
        return toggle(s, now);
      }
      return none();
    }

    case "pointerleave":
    case "pointerout":
    case "mouseleave":
      return none();

    case "pointercancel": {
      // The browser took the pointer. A hold keeps going (the finger may still
      // be down). An unfinished tap is dropped so a later pointerup cannot start
      // or stop a take the person did not finish.
      if (s.held && s.source === "pointer") s.captureLost = true;
      else s.armed = false;
      return none();
    }

    case "lostpointercapture": {
      // A re-render can drop the button that owned the pointer. That is not a
      // release. pointerup may still follow, so a tap stays armed.
      if (s.held && s.source === "pointer") s.captureLost = true;
      return none();
    }

    case "pointermove":
      // A move is never a release. After pointercancel some browsers report
      // buttons 0 even while the finger is still down, which used to cut the hold.
      return none();

    case "blur":
    case "focus":
      return none();

    case "keydown": {
      if (ev.repeat) return none();
      if (ev.key !== " " && ev.key !== "Enter") return none();
      if (s.mode === "hold") {
        if (s.held) return none();
        return begin(s, now, "key", null);
      }
      return toggle(s, now);
    }

    case "keyup": {
      if (s.source !== "key" || !s.held) return none();
      if (ev.key && ev.key !== " " && ev.key !== "Enter") return none();
      return release(s);
    }

    case "silence": {
      if (s.held || s.mode !== "tap" || !s.silenceStop || !s.recording) return none();
      return release(s);
    }

    case "recognizerend": {
      // Chrome ends the recognizer on a pause or its own timeout even while the
      // button is still held. Keep going unless tap mode asked to stop on silence.
      if (!s.recording) return none();
      if (!s.held && s.mode === "tap" && s.silenceStop && ev.cause === "silence") return release(s);
      return { session: s, effect: "restart" };
    }

    case "error": {
      const code = String(ev.code || "");
      if (code === "aborted") return none();
      if (code === "not-allowed" || code === "service-not-allowed" || SPEECH_STOP.includes(code)) return release(s);
      if (s.recording) return { session: s, effect: "restart" };
      return none();
    }

    case "stop":
      return release(s);

    default:
      return none();
  }
}
