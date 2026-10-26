// Talk-back voice, server side (0.4.21): spoken replies, instant two-way voice tokens, and a cheap model for
// phrases the local parser did not catch. Keys come from the vault through the caller and are never logged
// or returned. Every network call goes through fetchImpl so tests stub it.
import { pickSpeechTarget } from "./speech.js";
import { PROVIDERS } from "./registry.js";
import { NO_KEY_LINE, sentences } from "../web/features/voice-actions.js";

export { NO_KEY_LINE, sentences };

const ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM";
const MAX_SPEAK = 1800;

function devRoot(id, fallback) {
  if (process.env.CC_PACKAGED === "1") return fallback;
  return String(process.env[`CC_BASE_URL_${id.toUpperCase()}`] || fallback).replace(/\/$/, "");
}
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

// What this PC can do right now, from which keys are saved. No key value is returned.
export function talkStatus(has, saved = {}) {
  const listen = pickSpeechTarget(has);
  const speaker = has("elevenlabs") ? "elevenlabs" : has("openai") ? "openai" : "browser";
  const realtime = has("openai") ? "openai" : (has("elevenlabs") && saved.elevenAgentId) ? "elevenlabs" : "";
  const anyKey = !!listen || has("elevenlabs") || has("openai");
  return {
    listen: listen ? listen.id : "",
    speaker,
    realtime,
    needsKey: !anyKey,
    line: anyKey ? "" : NO_KEY_LINE,
    keysLink: "settings:keys",
  };
}

async function elevenSpeak(text, key, fetchImpl) {
  const root = devRoot("elevenlabs", "https://api.elevenlabs.io");
  const res = await fetchImpl(`${root}/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
  });
  if (!res.ok) throw fail(502, `ElevenLabs could not speak (${res.status}).`, "voice_speak");
  return Buffer.from(await res.arrayBuffer());
}

async function openaiSpeak(text, key, fetchImpl) {
  const root = String(PROVIDERS.openai?.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetchImpl(`${root}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "mp3" }),
  });
  if (!res.ok) throw fail(502, `OpenAI could not speak (${res.status}).`, "voice_speak");
  return Buffer.from(await res.arrayBuffer());
}

// ElevenLabs if there is a key, else OpenAI, else tell the page to use the built-in Windows or browser voice.
// A provider that fails moves on to the next; the last step is always the built-in voice, then text only.
export async function synthesize(text, { hasSecret, getSecret, fetchImpl = fetch } = {}) {
  const t = String(text || "").replace(/\u0000/g, "").trim().slice(0, MAX_SPEAK);
  if (!t) throw fail(400, "Nothing to say.", "voice_speak_empty");
  const has = typeof hasSecret === "function" ? hasSecret : () => false;
  const tries = [["elevenlabs", elevenSpeak], ["openai", openaiSpeak]];
  const errors = [];
  for (const [id, fn] of tries) {
    if (!has(id)) continue;
    const key = getSecret?.(id)?.key;
    if (!key) continue;
    try {
      const buf = await fn(t, key, fetchImpl);
      if (buf.length > 200) return { engine: id, mime: "audio/mpeg", audio: buf.toString("base64") };
      errors.push(`${id}: empty audio`);
    } catch (e) { errors.push(String(e.message || e)); }
  }
  return { engine: "browser", text: t, errors };
}

const tool = (name, description, properties = {}, required = []) => ({ type: "function", name, description, parameters: { type: "object", properties, required } });

// The same actions the buttons use, as function tools for the instant voice engines.
export function realtimeTools(actions) {
  const text = { type: "string" };
  const arg = { open_screen: { screen: text }, new_project: { name: text }, switch_project: { name: text }, set_mode: { mode: { type: "string", enum: ["auto", "single", "council", "mission"] } }, run: { request: text }, remember: { text }, forget: { text }, steer: { ai: text, step: { type: "number" } }, click_number: { n: { type: "number" } }, numbers: { on: { type: "boolean" } }, delete_project: { name: text } };
  return actions.map((a) => tool(a.id, `${a.label}. ${a.risk === "confirm" ? "Needs the user to say yes first; the app asks them." : ""}`.trim(), arg[a.id] || {}));
}

export const REALTIME_INSTRUCTIONS = "You are Meld, the voice of Meldmind. Speak briefly and plainly. To move around or do anything, call a tool; never claim you did something unless the tool result says so. If a tool result says it is waiting for the user's yes, tell them what you asked and wait. Never read out passwords, keys or account numbers.";

// Mint a short-lived browser token. The real key stays on this PC.
export async function mintRealtime({ hasSecret, getSecret, fetchImpl = fetch, saved = {}, tools = [] } = {}) {
  const has = typeof hasSecret === "function" ? hasSecret : () => false;
  if (has("openai")) {
    const key = getSecret?.("openai")?.key;
    if (key) {
      const root = String(PROVIDERS.openai?.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
      const res = await fetchImpl(`${root}/realtime/client_secrets`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session: { type: "realtime", model: "gpt-realtime", instructions: REALTIME_INSTRUCTIONS, audio: { output: { voice: "marin" } }, tools } }),
      });
      const j = await res.json().catch(() => null);
      const secret = j?.value || j?.client_secret?.value;
      if (res.ok && secret) return { engine: "openai", secret, model: "gpt-realtime", url: `${root}/realtime/calls`, expiresAt: j.expires_at || null, tools };
    }
  }
  if (has("elevenlabs") && saved.elevenAgentId) {
    const key = getSecret?.("elevenlabs")?.key;
    if (key) {
      const root = devRoot("elevenlabs", "https://api.elevenlabs.io");
      const res = await fetchImpl(`${root}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(saved.elevenAgentId)}`, { headers: { "xi-api-key": key } });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.signed_url) return { engine: "elevenlabs", signedUrl: j.signed_url, tools };
    }
  }
  return { engine: "none", line: NO_KEY_LINE };
}

const JSON_PROMPT = (view, actions) => [
  "You turn one spoken sentence into ONE Meldmind action. Reply with JSON only: {\"action\":\"<id>\",\"args\":{...}} or {\"action\":\"none\"}.",
  `The person is on the "${view || "command"}" screen. Actions:`,
  ...actions.map((a) => `- ${a.id}: ${a.label}${a.examples?.length ? ` (e.g. ${a.examples[0]})` : ""}`),
  "Args: open_screen {screen}, new_project {name}, switch_project {name}, set_mode {mode: auto|single|council|mission}, run {request}, remember {text}, forget {text}, steer {ai, step}.",
  "Use run with the whole sentence when it is a request to make or answer something. Use none when unsure. Never invent screens.",
].join("\n");

// A cheap connected text model for phrases the local parser missed. complete = async ({system, user}) -> text.
export async function interpretWithModel(text, { view, actions } = {}, { complete } = {}) {
  if (typeof complete !== "function") throw fail(409, "No connected AI to help with that.", "voice_no_model");
  const heard = String(text || "").replace(/\u0000/g, "").trim().slice(0, 400);
  if (!heard) return { action: "none" };
  const out = await complete({ system: JSON_PROMPT(view, actions || []), user: heard });
  let j = null;
  try { j = JSON.parse(String(out || "").match(/\{[\s\S]*\}/)?.[0] || ""); } catch { /* not JSON */ }
  if (!j || typeof j.action !== "string") return { action: "none" };
  const ok = (actions || []).some((a) => a.id === j.action);
  if (!ok) return { action: "none" };
  const args = {};
  for (const [k, v] of Object.entries(j.args && typeof j.args === "object" ? j.args : {})) {
    if (typeof v === "string") args[k] = v.slice(0, 400); else if (typeof v === "number" || typeof v === "boolean") args[k] = v;
  }
  return { action: j.action, args };
}
