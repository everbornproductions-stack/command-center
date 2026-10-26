// Speech-to-text for tap to talk on the desktop app. Web Speech has no Google key inside
// Electron, so the recording is sent here and forwarded to a provider the person already
// has a key for. Order: OpenAI, Groq, ElevenLabs Scribe, Gemini. Keys are never logged.
import { PROVIDERS, geminiBase } from "./registry.js";
import { providerMessage } from "./health.js";

export const NO_SPEECH_KEY = "No speech-to-text key is saved. Add an OpenAI, Groq, ElevenLabs, or Google Gemini key in Settings.";

export const SPEECH_CHAIN = [
  { id: "openai", kind: "openai", model: "gpt-4o-mini-transcribe", fallbackModel: "whisper-1" },
  { id: "groq", kind: "openai", model: "whisper-large-v3-turbo" },
  { id: "elevenlabs", kind: "eleven", model: "scribe_v1" },
  { id: "google", kind: "gemini", model: "gemini-3.8-flash" },
];

export function pickSpeechTarget(has) {
  for (const c of SPEECH_CHAIN) if (has(c.id)) return c;
  return null;
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

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
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
    throw fail(502, `${provider?.name || target.id} could not transcribe (${hit.res.status}). ${why}`.trim(), "voice_transcribe");
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
    throw fail(502, `ElevenLabs could not transcribe (${res.status}). ${why}`.trim(), "voice_transcribe");
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
    throw fail(502, `Google Gemini could not transcribe (${res.status}). ${why}`.trim(), "voice_transcribe");
  }
  const parts = reply.json?.candidates?.[0]?.content?.parts || [];
  const text = String(parts.map((p) => p.text || "").join("") || reply.json?.text || "").trim();
  return { text, provider: "google", model: target.model };
}

export async function transcribeAudio(audio, { hasSecret, getSecret, fetchImpl = fetch } = {}) {
  if (!audio?.buf?.length) throw fail(400, "No audio in that recording.", "voice_audio");
  const has = typeof hasSecret === "function" ? hasSecret : () => false;
  const target = pickSpeechTarget(has);
  if (!target) throw fail(409, NO_SPEECH_KEY, "voice_no_speech_key");
  const secret = typeof getSecret === "function" ? getSecret(target.id) : null;
  const key = secret?.key;
  if (!key) throw fail(409, NO_SPEECH_KEY, "voice_no_speech_key");
  if (target.kind === "eleven") return elevenTranscribe(target, audio, key, fetchImpl);
  if (target.kind === "gemini") return geminiTranscribe(target, audio, key, fetchImpl);
  return openaiTranscribe(target, audio, key, fetchImpl);
}
