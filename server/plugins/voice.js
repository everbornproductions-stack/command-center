// Voice orders preference. Tap to talk is the default; hold to talk is the
// old press-and-hold behaviour. Saved on the settings document (local file
// settings.json, hosted user_docs kind "settings") under `voice`, so it stays
// with the rest of the app's settings. The response is only the voice fields.
import { DEFAULT_MODE, MODES, coerceSettings, normalizeSettings } from "../../web/features/voice-mode.js";

export const id = "voice";

const view = (v) => ({ mode: v.mode, silenceStop: !!v.silenceStop, modes: MODES, defaultMode: DEFAULT_MODE });

function read(h) {
  const s = h.settings() || {};
  return coerceSettings(s.voice);
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/voice/, "") || "/";
  if (p !== "" && p !== "/") return false;
  if (req.method === "GET") return h.json(res, 200, view(read(h)));
  if (req.method === "POST") {
    let next;
    try { next = normalizeSettings(body || {}, read(h)); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code || "voice_invalid" }); }
    const cur = h.settings() || {};
    const voice = { mode: next.mode, silenceStop: !!next.silenceStop };
    h.putDoc("settings", { ...cur, voice });
    return h.json(res, 200, view(voice));
  }
  return false;
}
