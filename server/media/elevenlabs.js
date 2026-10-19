// ElevenLabs text-to-speech. xi-api-key header. Returns audio bytes (mp3) directly.
export const id = "elevenlabs";
export const name = "ElevenLabs";
export const kinds = ["voice"];
export const price = { eleven_multilingual_v2: 0.08, eleven_flash_v2_5: 0.04, eleven_v3: 0.08, default: 0.08 }; // USD per 1,000 characters (API tier)
export const defaults = { model: "eleven_multilingual_v2", voiceId: "21m00Tcm4TlvDq8ikWAM" }; // "Rachel" default voice

export function estimate(params) {
  const chars = (params.text || params.prompt || "").length;
  const rate = price[params.model] || price.default;
  return { characters: chars, usd: +((chars / 1000) * rate).toFixed(4), credits: chars, note: `${chars} characters × $${rate}/1k (plan characters: ${chars})` };
}

export async function start(secret, params) {
  const text = params.text || params.prompt;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId || defaults.voiceId)}?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": secret.key, "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ text, model_id: params.model || defaults.model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { done: true, bytes: buf, ext: "mp3", mime: "audio/mpeg" };
}

export async function poll() { return { done: true }; }

export async function voices(secret) {
  const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": secret.key } });
  const j = await r.json().catch(() => ({}));
  return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
}
