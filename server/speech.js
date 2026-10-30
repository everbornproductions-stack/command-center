// Speech-to-text for tap to talk on the desktop app. Web Speech has no Google key inside
// Electron, so the recording is sent here and forwarded to a provider the person already
// has a key for. Free first: Groq, Gemini, ElevenLabs Scribe (free allowance). OpenAI is paid, so it
// is only tried last, and only when the person turned on "Use my OpenAI credits for voice".
// Any failure (429, no credits, bad key, outage) moves on to the next tier. Keys are never logged.
import { PROVIDERS, geminiBase } from "./registry.js";
import { providerMessage } from "./health.js";

export const NO_SPEECH_KEY = "Voice typing is free, but it needs a free key. Add a Groq or Google Gemini key in Settings (both have a free plan). OpenAI and ElevenLabs keys work too.";
export const PAID_OFF_NOTE = "Your OpenAI key is saved but not used for voice, because it costs credits. Add a free Groq or Google Gemini key in Settings, or turn on \"Use my OpenAI credits for voice\".";
export const ALL_BUSY = "Voice typing could not reach a free service right now. Wait a minute and try again.";
// 0.4.25 (audit A8): a quiet recording is not the service's fault. Every service answered with no words,
// or said the audio was empty or too short, so say that instead of "could not reach a free service".
export const NOTHING_HEARD = "We did not hear anything. Try again a little closer to the mic.";
// 0.4.27 (panel item 9): a recording the service could not open is not a quiet one. "Could not process file, is it a
// valid media file?" used to be told "try again closer to the mic"; it gets its own line now.
export const UNREADABLE = "That recording could not be read. Try again.";
// A provider reply that means "there was no speech in that audio", not "we are down".
const SILENT_REPLY = /\b(too short|no speech|no audio|empty (audio|file|recording)|silen(t|ce)|audio (is |was )?empty|duration)\b/i;
// A provider reply that means "this file is not audio I can open".
const UNREADABLE_REPLY = /\b(could not (process|decode|read)( the)? (audio|file|media)|invalid (audio|media|file)( file| format)?|(not a |in)valid (audio|media) file|valid media file|unsupported (audio|file|media)? ?(format|type))\b/i;
export function soundsSilent(status, detail = "") {
  return (status === 400 || status === 422) && SILENT_REPLY.test(String(detail || "")) && !UNREADABLE_REPLY.test(String(detail || ""));
}
export function soundsUnreadable(status, detail = "") {
  return (status === 400 || status === 415 || status === 422) && UNREADABLE_REPLY.test(String(detail || ""));
}

export const SPEECH_CHAIN = [
  { id: "groq", kind: "openai", model: "whisper-large-v3-turbo" },
  { id: "google", kind: "gemini", model: "gemini-3.8-flash" },
  { id: "elevenlabs", kind: "eleven", model: "scribe_v1" },
  { id: "openai", kind: "openai", model: "gpt-4o-mini-transcribe", fallbackModel: "whisper-1", paid: true },
];

// Every tier this person can use, in order. Paid tiers only when they opted in.
export function speechTargets(has, allowPaid = false) {
  return SPEECH_CHAIN.filter((c) => has(c.id) && (allowPaid || !c.paid));
}

export function pickSpeechTarget(has, allowPaid = false) {
  return speechTargets(has, allowPaid)[0] || null;
}

const ALLOWED_MIME = /^(audio\/[a-z0-9.+-]+|video\/webm)$/i;

export function decodeAudio(body) {
  const mime = String(body?.mime || "audio/webm").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.test(mime)) return null;
  const raw = String(body?.audio || "");
  if (!raw || raw.length > 6_000_000) return null;
  let buf;
  try { buf = Buffer.from(raw, "base64"); } catch { return null; }
  if (!buf.length || buf.length > 4_500_000) return null;
  return { mime, buf };
}

function devRoot(id, fallback) {
  if (process.env.CC_PACKAGED === "1") return fallback;
  return String(process.env[`CC_BASE_URL_${id.toUpperCase()}`] || fallback).replace(/\/$/, "");
}

function fail(status, message, code, extra = {}) {
  return Object.assign(new Error(message), { status, code }, extra);
}

function multipart(fields, file) {
  const boundary = `----meldmind${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const chunks = [];
  const push = (s) => chunks.push(Buffer.from(s));
  for (const [k, v] of Object.entries(fields)) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  }
  push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`);
  chunks.push(file.buf);
  push(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

async function readReply(res) {
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain text */ }
  return { json, text };
}

function extOf(mime) {
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

async function openaiTranscribe(target, audio, key, fetchImpl) {
  const provider = PROVIDERS[target.id];
  const root = String(provider?.baseUrl || "").replace(/\/$/, "");
  const file = { name: `speech.${extOf(audio.mime)}`, mime: audio.mime, buf: audio.buf };
  const once = async (model) => {
    const form = multipart({ model }, file);
    const res = await fetchImpl(`${root}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": form.type },
      body: form.body,
    });
    const reply = await readReply(res);
    return { res, reply, model };
  };
  let hit = await once(target.model);
  const detail = providerMessage(hit.reply.json, hit.reply.text);
  const missing = !hit.res.ok && target.fallbackModel && (hit.res.status === 404 || /model/.test(detail.toLowerCase()));
  if (missing) hit = await once(target.fallbackModel);
  if (!hit.res.ok) {
    const why = providerMessage(hit.reply.json, hit.reply.text) || `HTTP ${hit.res.status}`;
    throw fail(502, `${provider?.name || target.id} could not transcribe (${hit.res.status}). ${why}`.trim(), "voice_transcribe", { silent: soundsSilent(hit.res.status, why), unreadable: soundsUnreadable(hit.res.status, why) });
  }
  const text = String(hit.reply.json?.text || "").trim();
  return { text, provider: target.id, model: hit.model };
}

async function elevenTranscribe(target, audio, key, fetchImpl) {
  const root = devRoot("elevenlabs", "https://api.elevenlabs.io");
  const form = multipart({ model_id: target.model }, { name: `speech.${extOf(audio.mime)}`, mime: audio.mime, buf: audio.buf });
  const res = await fetchImpl(`${root}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": form.type },
    body: form.body,
  });
  const reply = await readReply(res);
  if (!res.ok) {
    const why = providerMessage(reply.json, reply.text) || `HTTP ${res.status}`;
    throw fail(502, `ElevenLabs could not transcribe (${res.status}). ${why}`.trim(), "voice_transcribe", { silent: soundsSilent(res.status, why), unreadable: soundsUnreadable(res.status, why) });
  }
  const text = String(reply.json?.text || reply.json?.transcripts?.[0]?.text || "").trim();
  return { text, provider: "elevenlabs", model: target.model };
}

async function geminiTranscribe(target, audio, key, fetchImpl) {
  const provider = PROVIDERS.google;
  const root = geminiBase(provider);
  const url = `${root}/models/${encodeURIComponent(target.model)}:generateContent`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      store: false,
      contents: [{ parts: [
        { inlineData: { mimeType: audio.mime, data: audio.buf.toString("base64") } },
        { text: "Transcribe this audio. Return only the words spoken." },
      ] }],
    }),
  });
  const reply = await readReply(res);
  if (!res.ok) {
    const why = providerMessage(reply.json, reply.text) || `HTTP ${res.status}`;
    throw fail(502, `Google Gemini could not transcribe (${res.status}). ${why}`.trim(), "voice_transcribe", { silent: soundsSilent(res.status, why), unreadable: soundsUnreadable(res.status, why) });
  }
  const parts = reply.json?.candidates?.[0]?.content?.parts || [];
  const text = String(parts.map((p) => p.text || "").join("") || reply.json?.text || "").trim();
  return { text, provider: "google", model: target.model };
}

async function runTarget(target, audio, key, fetchImpl) {
  if (target.kind === "eleven") return elevenTranscribe(target, audio, key, fetchImpl);
  if (target.kind === "gemini") return geminiTranscribe(target, audio, key, fetchImpl);
  return openaiTranscribe(target, audio, key, fetchImpl);
}

export async function transcribeAudio(audio, { hasSecret, getSecret, fetchImpl = fetch, allowPaid = false } = {}) {
  if (!audio?.buf?.length) throw fail(400, "No audio in that recording.", "voice_audio");
  const has = typeof hasSecret === "function" ? hasSecret : () => false;
  const targets = speechTargets(has, allowPaid);
  if (!targets.length) {
    const paidOnly = !allowPaid && SPEECH_CHAIN.some((c) => c.paid && has(c.id));
    throw fail(409, paidOnly ? PAID_OFF_NOTE : NO_SPEECH_KEY, "voice_no_speech_key");
  }
  let tried = 0;
  let quiet = 0; // services that answered with no words, or said the audio was empty
  let unreadable = 0; // services that could not open the recording at all
  for (const target of targets) {
    const key = (typeof getSecret === "function" ? getSecret(target.id) : null)?.key;
    if (!key) continue;
    tried += 1;
    try {
      const out = await runTarget(target, audio, key, fetchImpl);
      if (out.text) return out;
      quiet += 1;
    } catch (e) { if (e?.silent) quiet += 1; else if (e?.unreadable) unreadable += 1; /* quota, no credits, bad key or outage: try the next tier */ }
  }
  if (!tried) throw fail(409, NO_SPEECH_KEY, "voice_no_speech_key");
  if (quiet) throw fail(422, NOTHING_HEARD, "voice_silent");
  if (unreadable) throw fail(422, UNREADABLE, "voice_unreadable");
  throw fail(502, ALL_BUSY, "voice_transcribe");
}
