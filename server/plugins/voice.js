// Voice orders preference. Tap to talk is the default; hold to talk is the
// old press-and-hold behaviour. Saved on the settings document (local file
// settings.json, hosted user_docs kind "settings") under `voice`, so it stays
// with the rest of the app's settings. The response is only the voice fields.
import { DEFAULT_MODE, MODES, coerceSettings, normalizeSettings } from "../../web/features/voice-mode.js";
import { decodeAudio, transcribeAudio } from "../speech.js";
import { transcribeWithFallback } from "../dictate.js";
import { coerceTalk, normalizeTalk, actionList } from "../../web/features/voice-actions.js";
import { talkStatus, synthesize, mintRealtime, realtimeTools, interpretWithModel } from "../voice-speak.js";
import { cheapest } from "../router.js";
import { completeFallback } from "../fallback.js";
import { recordCall } from "../ledger.js";

export const id = "voice";

const view = (v) => ({ mode: v.mode, silenceStop: !!v.silenceStop, autoSend: !!v.autoSend, modes: MODES, defaultMode: DEFAULT_MODE });

function read(h) {
  const s = h.settings() || {};
  return coerceSettings(s.voice);
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/voice/, "") || "/";
  if (req.method === "POST" && p === "/transcribe") {
    const audio = decodeAudio(body);
    if (!audio) return h.json(res, 400, { error: "No audio in that recording.", code: "voice_audio" });
    const out = await transcribeAudio(audio, {
      hasSecret: (id) => h.hasSecret(id, h.PROVIDERS[id]?.keyEnv),
      getSecret: (id) => h.getSecret(id, h.PROVIDERS[id]?.keyEnv),
    });
    return h.json(res, 200, { text: out.text, provider: out.provider, model: out.model });
  }
  if (req.method === "POST" && p === "/dictate") {
    const audio = decodeAudio(body);
    if (!audio) return h.json(res, 400, { error: "No audio in that recording.", code: "voice_audio" });
    const out = await transcribeWithFallback(audio, {
      hasSecret: (id) => h.hasSecret(id, h.PROVIDERS[id]?.keyEnv),
      getSecret: (id) => h.getSecret(id, h.PROVIDERS[id]?.keyEnv),
    });
    return h.json(res, 200, { text: out.text, provider: out.provider, model: out.model });
  }
  const secrets = () => ({
    hasSecret: (id) => h.hasSecret(id, h.PROVIDERS[id]?.keyEnv),
    getSecret: (id) => h.getSecret(id, h.PROVIDERS[id]?.keyEnv),
  });
  const talkSaved = () => coerceTalk((h.settings() || {}).voiceTalk);
  // Talk-back (0.4.21): settings, what this PC can do, spoken replies, instant voice tokens, a cheap model for loose phrases.
  if (p === "/talk" && req.method === "GET") {
    const saved = talkSaved();
    return h.json(res, 200, { settings: saved, status: talkStatus(secrets().hasSecret, saved), actions: actionList() });
  }
  if (p === "/talk" && req.method === "POST") {
    let next;
    try { next = normalizeTalk(body || {}, talkSaved()); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code || "voice_invalid" }); }
    const cur = h.settings() || {};
    h.putDoc("settings", { ...cur, voiceTalk: next });
    return h.json(res, 200, { settings: next, status: talkStatus(secrets().hasSecret, next) });
  }
  if (p === "/speak" && req.method === "POST") {
    const text = String(body?.text || "").trim();
    if (!text) return h.json(res, 400, { error: "Nothing to say.", code: "voice_speak_empty" });
    if (!talkSaved().speak) return h.json(res, 200, { engine: "text", text });
    const out = await synthesize(text, { ...secrets(), fetchImpl: fetch });
    return h.json(res, 200, out.engine === "browser" ? { engine: "browser", text: out.text } : out);
  }
  if (p === "/realtime" && req.method === "POST") {
    const saved = talkSaved();
    if (!saved.instant) return h.json(res, 200, { engine: "none", line: "Instant voice is off." });
    const out = await mintRealtime({ ...secrets(), saved, fetchImpl: fetch, tools: realtimeTools(actionList()) });
    return h.json(res, 200, out);
  }
  if (p === "/interpret" && req.method === "POST") {
    const picked = cheapest(60);
    if (!picked) return h.json(res, 409, { error: "No connected AI to help with that.", code: "voice_no_model" });
    const complete = (async ({ system, user }) => {
      const t0 = Date.now();
      const a = await completeFallback({ provider: picked.provider, model: picked.model, maxTokens: 200, system, messages: [{ role: "user", content: user }] }, { role: "voice-intent", small: true, cls: { capability: "fast", difficulty: 1 }, mode: "economy", tools: false });
      try { recordCall({ provider: a.provider, model: a.model, usage: a.usage || { input: 0, output: 0 }, role: "voice-intent", ms: Date.now() - t0 }); } catch { /* ledger is best effort */ }
      return a.text;
    });
    try { return h.json(res, 200, await interpretWithModel(body?.text, { view: String(body?.view || ""), actions: actionList() }, { complete })); }
    catch (e) { return h.json(res, e.status || 502, { error: e.message, code: e.code || "voice_interpret" }); }
  }
  if (p !== "" && p !== "/") return false;
  if (req.method === "GET") return h.json(res, 200, view(read(h)));
  if (req.method === "POST") {
    let next;
    try { next = normalizeSettings(body || {}, read(h)); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code || "voice_invalid" }); }
    const cur = h.settings() || {};
    const voice = { mode: next.mode, silenceStop: !!next.silenceStop, autoSend: !!next.autoSend };
    h.putDoc("settings", { ...cur, voice });
    return h.json(res, 200, view(voice));
  }
  return false;
}
