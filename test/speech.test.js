// Tap to talk on the desktop app posts audio to /api/voice/transcribe. The server sends it
// to the first speech provider that already has a key. Mocks only. Keys are fake and never printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "./helpers.js";
import { decodeAudio, pickSpeechTarget, SPEECH_CHAIN, NO_SPEECH_KEY } from "../server/speech.js";

const KEYS = {
  openai: "sk-proj-speechtest00000001",
  groq: "gsk_speechtest0000000001",
  elevenlabs: "el_speechtest000000000001",
  google: "AQ.speechtest000000000001",
  xai: "xai-speechtest00000000001",
};

test("speech provider order and audio decoding", () => {
  assert.deepEqual(SPEECH_CHAIN.map((c) => c.id), ["openai", "groq", "elevenlabs", "google"]);
  assert.equal(SPEECH_CHAIN[0].model, "gpt-4o-mini-transcribe");
  assert.equal(SPEECH_CHAIN[0].fallbackModel, "whisper-1");
  assert.equal(SPEECH_CHAIN[1].model, "whisper-large-v3-turbo");
  assert.equal(SPEECH_CHAIN[2].model, "scribe_v1");
  const has = (id) => id === "groq" || id === "google";
  assert.equal(pickSpeechTarget(has).id, "groq");
  assert.equal(pickSpeechTarget(() => false), null);
  assert.equal(pickSpeechTarget((id) => id === "xai"), null);
  const audio = decodeAudio({ mime: "audio/webm;codecs=opus", audio: Buffer.from("clip").toString("base64") });
  assert.equal(audio.mime, "audio/webm");
  assert.ok(audio.buf.length > 0);
  assert.equal(decodeAudio({ mime: "text/plain", audio: Buffer.from("x").toString("base64") }), null);
  assert.equal(decodeAudio({ mime: "audio/webm", audio: "" }), null);
  assert.match(NO_SPEECH_KEY, /OpenAI, Groq, ElevenLabs, or Google Gemini/);
  assert.doesNotMatch(NO_SPEECH_KEY, /\u2014/);
});

test("transcribe route picks OpenAI, then Groq, ElevenLabs, Gemini, and refuses when none of those keys exist", async () => {
  const seen = [];
  let missMini = false;
  const srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const text = raw.toString("latin1");
    seen.push({ url: req.url, authorization: req.headers.authorization || "", xi: req.headers["xi-api-key"] || "", goog: req.headers["x-goog-api-key"] || "", text });
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const url = String(req.url);
    if (url.includes("generateContent")) return send(200, { candidates: [{ content: { parts: [{ text: "from gemini" }] } }] });
    if (url.includes("/models")) return send(200, { data: [{ id: "mock-model" }], models: [{ name: "models/gemini-3.8-flash" }] });
    if (url.includes("/user/subscription")) return send(200, { character_count: 1, character_limit: 1000 });
    if (url.includes("/audio/transcriptions")) {
      if (url.startsWith("/oa/") && missMini && text.includes("gpt-4o-mini-transcribe")) return send(404, { error: { message: "The model does not exist" } });
      if (url.startsWith("/oa/") && text.includes("whisper-1")) return send(200, { text: "from whisper" });
      if (url.startsWith("/oa/")) return send(200, { text: "from mini" });
      if (url.startsWith("/gq/")) return send(200, { text: "from groq" });
    }
    if (url.includes("/speech-to-text")) return send(200, { text: "from scribe" });
    send(404, { error: "no route" });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const clip = { mime: "audio/webm", audio: Buffer.from("not-a-real-recording").toString("base64") };
  const blank = {
    CC_STATUS_PAGES: "off",
    CC_BASE_URL_OPENAI: `${origin}/oa/v1`,
    CC_BASE_URL_GROQ: `${origin}/gq/v1`,
    CC_BASE_URL_ELEVENLABS: `${origin}/el`,
    CC_BASE_URL_GOOGLE: `${origin}/gem/v1beta`,
    CC_BASE_URL_XAI: `${origin}/xai/v1`,
    OPENAI_API_KEY: "", GROQ_API_KEY: "", ELEVENLABS_API_KEY: "", GEMINI_API_KEY: "", XAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
  };
  let s;
  try {
  s = await startServer({ env: blank });
  const leaks = (extra = "") => {
    const blob = s.log + extra;
    for (const k of Object.values(KEYS)) assert.equal(blob.includes(k), false);
  };
    const none = await s.api("/voice/transcribe", { method: "POST", body: clip });
    assert.equal(none.status, 409);
    assert.equal(none.json.code, "voice_no_speech_key");
    assert.match(none.json.error, /OpenAI, Groq, ElevenLabs, or Google Gemini/);
    assert.equal(seen.some((h) => h.url.includes("audio") || h.url.includes("speech-to-text") || h.url.includes("generateContent")), false);

    const bad = await s.api("/voice/transcribe", { method: "POST", body: { mime: "audio/webm", audio: "" } });
    assert.equal(bad.status, 400);

    let saved = await s.api("/keys", { method: "POST", body: { provider: "groq", key: KEYS.groq } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    let r = await s.api("/voice/transcribe", { method: "POST", body: clip });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.text, "from groq");
    assert.equal(r.json.provider, "groq");
    assert.equal(r.json.model, "whisper-large-v3-turbo");
    const groqHit = seen.filter((h) => h.url.includes("/audio/transcriptions") && h.url.startsWith("/gq/")).at(-1);
    assert.equal(groqHit.authorization, `Bearer ${KEYS.groq}`);
    assert.equal(groqHit.text.includes("whisper-large-v3-turbo"), true);
    leaks(r.text);

    saved = await s.api("/keys", { method: "POST", body: { provider: "openai", key: KEYS.openai } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const before = seen.filter((h) => h.url.includes("/audio/transcriptions")).length;
    r = await s.api("/voice/transcribe", { method: "POST", body: clip });
    assert.equal(r.json.text, "from mini");
    assert.equal(r.json.provider, "openai");
    assert.equal(r.json.model, "gpt-4o-mini-transcribe");
    const oa = seen.filter((h) => h.url.startsWith("/oa/") && h.url.includes("transcriptions")).at(-1);
    assert.equal(oa.authorization, `Bearer ${KEYS.openai}`);
    assert.equal(seen.filter((h) => h.url.includes("/audio/transcriptions")).length, before + 1, "Groq is not called when OpenAI has a key");
    leaks(r.text);

    missMini = true;
    r = await s.api("/voice/transcribe", { method: "POST", body: clip });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.text, "from whisper");
    assert.equal(r.json.model, "whisper-1");
    leaks(r.text);
    missMini = false;

    await s.api("/keys/openai", { method: "DELETE" });
    await s.api("/keys/groq", { method: "DELETE" });
    saved = await s.api("/keys", { method: "POST", body: { provider: "elevenlabs", key: KEYS.elevenlabs } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    r = await s.api("/voice/transcribe", { method: "POST", body: clip });
    assert.equal(r.json.text, "from scribe");
    assert.equal(r.json.provider, "elevenlabs");
    assert.equal(r.json.model, "scribe_v1");
    const el = seen.filter((h) => h.url.includes("/speech-to-text")).at(-1);
    assert.equal(el.xi, KEYS.elevenlabs);
    assert.equal(el.text.includes("scribe_v1"), true);
    leaks(r.text);

    await s.api("/keys/elevenlabs", { method: "DELETE" });
    saved = await s.api("/keys", { method: "POST", body: { provider: "google", key: KEYS.google } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    r = await s.api("/voice/transcribe", { method: "POST", body: clip });
    assert.equal(r.json.text, "from gemini");
    assert.equal(r.json.provider, "google");
    assert.equal(r.json.model, "gemini-3.8-flash");
    const gem = seen.filter((h) => h.url.includes("generateContent")).at(-1);
    assert.equal(gem.goog, KEYS.google);
    assert.equal(gem.url.includes(KEYS.google), false, "the Gemini key stays in the header");
    leaks(r.text);

    await s.api("/keys/google", { method: "DELETE" });
    saved = await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEYS.xai } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    r = await s.api("/voice/transcribe", { method: "POST", body: clip });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /Add an OpenAI, Groq, ElevenLabs, or Google Gemini key/);
    leaks(JSON.stringify(r.json));
  } finally { if (s) await s.stop(); await new Promise((r) => srv.close(r)); }
});
