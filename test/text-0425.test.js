// 0.4.25 wording and server fixes from the 0.4.24 panel and audit (docs/plan-0.4.25.md item 7, audit A5, A7, A8).
// Pure unit tests plus source checks: no server, no network, fake keys only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { stripPrivateRules, cleanPlan, isPrivateRuleStep, phraseMatchers } from "../server/private-rules.js";
import { ownerPhrases, ownerRuleOpts } from "../server/private-rules-owner.js";
import { transcribeAudio, soundsSilent, NOTHING_HEARD, ALL_BUSY } from "../server/speech.js";
import { talkStatus, synthesize, mintRealtime, PAID_VOICE_OFF } from "../server/voice-speak.js";
import { NO_KEY_LINE, MIC_NO_KEY_LINE } from "../web/features/voice-actions.js";
import { imageKeyLine, mediaKeyLine, IMAGE_NO_KEY_LINE, MEDIA_NO_KEY_LINE } from "../web/features/key-hints.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = /\u2014/;

// ---------- item 7: voice wording and paid voice ----------
test("voice hints name the free keys, never OpenAI first", () => {
  assert.equal(NO_KEY_LINE, "Add a free Groq or Gemini key to talk.");
  assert.equal(MIC_NO_KEY_LINE, "Add a free Groq or Gemini key in Settings to talk.");
  for (const s of [NO_KEY_LINE, MIC_NO_KEY_LINE, PAID_VOICE_OFF, NOTHING_HEARD]) assert.doesNotMatch(s, EM);
  assert.doesNotMatch(NO_KEY_LINE, /OpenAI|ElevenLabs/);
});

test("spoken replies and Instant voice never spend a saved paid key unless paid voice is on", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return { ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(400, 1), json: async () => ({ value: "ek_x" }) }; };
  const keys = { openai: { key: "sk-proj-fake0425" }, elevenlabs: { key: "el_fake0425" } };
  const deps = { hasSecret: (id) => id in keys, getSecret: (id) => keys[id], fetchImpl };
  // default: off
  const st = talkStatus(deps.hasSecret, { elevenAgentId: "agent_1" });
  assert.equal(st.speaker, "browser");
  assert.equal(st.realtime, "");
  assert.equal((await synthesize("Hi.", deps)).engine, "browser");
  const mint = await mintRealtime({ ...deps, saved: { elevenAgentId: "agent_1" } });
  assert.equal(mint.engine, "none");
  assert.equal(mint.line, PAID_VOICE_OFF);
  assert.deepEqual(calls, [], "nothing was sent to a paid service");
  // turned on: the paid voices work as before
  const on = talkStatus(deps.hasSecret, { elevenAgentId: "agent_1" }, { allowPaid: true });
  assert.equal(on.speaker, "elevenlabs");
  assert.equal(on.realtime, "openai");
  assert.equal((await synthesize("Hi.", { ...deps, allowPaid: true })).engine, "elevenlabs");
  assert.equal((await mintRealtime({ ...deps, allowPaid: true })).engine, "openai");
});

test("wiring: the voice routes pass the paid switch, the settings say what it covers", () => {
  const plug = read("server", "plugins", "voice.js");
  assert.equal((plug.match(/allowPaid: paidSpeech\(h\)/g) || []).length >= 6, true, "transcribe, dictate, talk x2, speak, realtime");
  assert.match(plug, /p === "\/ready"/);
  const ui = read("web", "features", "voice.js");
  assert.match(ui, /spoken answers/);
  assert.match(ui, /Instant voice/);
  const talk = read("web", "features", "voice-talk.js");
  assert.match(talk, /only when paid voice is on/);
  assert.match(talk, /voice_silent/);
  for (const f of [ui, talk, plug]) assert.doesNotMatch(f, EM);
});

// ---------- A5: silent buttons ----------
test("Images: no image key gives one short line, a ready provider gives none", () => {
  const list = [
    { id: "openai", ops: ["generate", "edit"], keyed: false, ready: false },
    { id: "fal", ops: ["generate"], keyed: false },
  ];
  assert.equal(imageKeyLine(list, "generate"), IMAGE_NO_KEY_LINE);
  assert.equal(IMAGE_NO_KEY_LINE, "Add a free Google Gemini key in Settings to make pictures."); // 0.4.27: names the free plan
  assert.equal(imageKeyLine([...list, { id: "rep", ops: ["generate"], keyed: true }], "generate"), "");
  assert.equal(imageKeyLine([...list, { id: "rep", ops: ["generate"], keyed: true }], "generate", "openai"), IMAGE_NO_KEY_LINE, "the chosen one has no key");
  assert.equal(imageKeyLine([{ id: "m", ops: ["generate"], keyed: false, ready: true }], "generate", "m"), "", "an MCP connection counts");
  assert.equal(imageKeyLine([], "generate"), IMAGE_NO_KEY_LINE);
});

test("Media: the chosen service with no key or MCP gives one short line", () => {
  const list = [{ id: "kling", kinds: ["video"], keyed: false, connected: false }, { id: "el", kinds: ["voice"], keyed: true }];
  assert.equal(mediaKeyLine(list, "video", "kling"), MEDIA_NO_KEY_LINE);
  assert.equal(mediaKeyLine(list, "voice", "el"), "");
  assert.equal(mediaKeyLine([{ id: "k", kinds: ["video"], keyed: false, connected: true }], "video"), "");
  assert.doesNotMatch(MEDIA_NO_KEY_LINE, EM);
});

test("source: Generate and the Mic are never silent", () => {
  const img = read("web", "features", "images.js");
  const med = read("web", "features", "media.js");
  const voice = read("web", "features", "voice.js");
  assert.doesNotMatch(img, /id="im-go"[^>]*disabled/, "Images Generate starts pressable");
  assert.doesNotMatch(img, /id="imc-go"[^>]*disabled/);
  assert.doesNotMatch(med, /id="md-go"[^>]*disabled/, "Media Generate starts pressable");
  assert.match(img, /id="im-need"/);
  assert.match(img, /imageKeyLine/);
  assert.match(med, /id="md-need"/);
  assert.match(med, /mediaKeyLine/);
  assert.match(voice, /\/voice\/ready/);
  assert.match(voice, /MIC_NO_KEY_LINE/);
  assert.match(voice, /MIC_BLOCKED_LINE/);
  for (const f of [img, med, voice, read("web", "features", "key-hints.js")]) assert.doesNotMatch(f, EM);
});

// ---------- A7: owner-specific text out of product code ----------
test("private rules: no owner folder names in the shared code; owner phrases apply on the owner licence only", () => {
  const src = read("server", "private-rules.js");
  assert.doesNotMatch(src, /Everborn/i);
  assert.doesNotMatch(src, /My Drive/i);
  const text = "Write the notes.\nSave media to G:\\My Drive\\Everborn Cloud\\notes.";
  assert.equal(stripPrivateRules(text, "notes"), text, "general rules alone leave a folder name alone");
  const settings = { privateRulePhrases: ["Everborn Cloud", "G:\\My Drive", 42, "  ", "ab"] };
  assert.deepEqual(ownerPhrases({ tier: "owner", settings }), ["Everborn Cloud", "G:\\My Drive", "  ", "ab"]);
  assert.equal(phraseMatchers(ownerPhrases({ tier: "owner", settings })).length, 2, "blanks and very short phrases are dropped");
  for (const tier of ["free", "pro", "studio", "extreme"]) assert.deepEqual(ownerPhrases({ tier, settings }), [], tier);
  assert.deepEqual(ownerPhrases({ tier: "owner", settings: {} }), []);
  assert.equal(stripPrivateRules(text, "notes", ownerRuleOpts({ tier: "owner", settings })), "Write the notes.");
  assert.equal(stripPrivateRules(text, "notes", ownerRuleOpts({ tier: "pro", settings })), text, "a customer's plan is not touched by the owner's list");
  // phrases are plain words, not patterns
  assert.equal(stripPrivateRules("Use a.b here.", "x", { phrases: ["a.b"] }), "");
  assert.equal(stripPrivateRules("Use axb here.", "x", { phrases: ["a.b"] }), "Use axb here.");
  // plan steps
  const plan = { title: "t", tasks: [
    { id: "t1", title: "Write ideas", instructions: "Write 3 ideas.", deps: [] },
    { id: "t2", title: "Copy files into Everborn Cloud", instructions: "copy", deps: ["t1"] },
  ] };
  assert.equal(cleanPlan(plan, "write ideas").dropped, 0);
  assert.equal(cleanPlan(plan, "write ideas", { phrases: ["Everborn Cloud"] }).dropped, 1);
  assert.equal(isPrivateRuleStep(plan.tasks[1], "write ideas", { phrases: ["everborn cloud"] }), true, "case does not matter");
  assert.equal(cleanPlan(plan, "copy to my drive", { phrases: ["Everborn Cloud"] }).dropped, 0, "the user asked for it");
  // mission uses the owner options for plans and answers
  const mission = read("server", "mission.js");
  assert.match(mission, /cleanPlan\(plan, goal, ownerRuleOpts\(\)\)/);
  assert.match(mission, /stripPrivateRules\(mission\.deliverable \|\| "", goal, ruleOpts\)/);
});

test("owner phrases: with no licence and no settings the default is empty, never a throw", () => {
  assert.deepEqual(ownerPhrases(), []);
  assert.deepEqual(ownerRuleOpts().matchers, []);
});

// ---------- A8: a silent recording ----------
test("speech: a silent recording says we did not hear anything, a real outage still says busy", async () => {
  const audio = { mime: "audio/webm", buf: Buffer.from("quiet") };
  const keys = { groq: { key: "gsk_fake0425" }, google: { key: "AQ.fake0425" } };
  const deps = (fetchImpl) => ({ hasSecret: (id) => id in keys, getSecret: (id) => keys[id], fetchImpl });
  const reply = (status, j) => ({ ok: status < 400, status, text: async () => JSON.stringify(j) });
  // every service answers with no words
  const empty = async (url) => (String(url).includes("generateContent") ? reply(200, { candidates: [{ content: { parts: [{ text: "" }] } }] }) : reply(200, { text: "" }));
  await assert.rejects(() => transcribeAudio(audio, deps(empty)), (e) => e.status === 422 && e.code === "voice_silent" && e.message === NOTHING_HEARD);
  // one says "too short", the other is busy: the quiet is the likely cause
  const short = async (url) => (String(url).includes("generateContent") ? reply(429, { error: { message: "quota" } }) : reply(400, { error: { message: "Audio file is too short." } }));
  await assert.rejects(() => transcribeAudio(audio, deps(short)), (e) => e.code === "voice_silent");
  // everything down: busy, as before
  const down = async () => reply(503, { error: { message: "unavailable" } });
  await assert.rejects(() => transcribeAudio(audio, deps(down)), (e) => e.status === 502 && e.message === ALL_BUSY);
  // words still win
  const words = async (url) => (String(url).includes("generateContent") ? reply(200, { candidates: [{ content: { parts: [{ text: "hello" }] } }] }) : reply(200, { text: "" }));
  assert.equal((await transcribeAudio(audio, deps(words))).text, "hello");
  assert.equal(soundsSilent(400, "No speech detected"), true);
  assert.equal(soundsSilent(429, "too short"), false, "a rate limit is never read as silence");
  assert.equal(soundsSilent(400, "Invalid API key"), false);
});
