// Talk-back voice and voice navigation (0.4.21). Typed transcripts only: no microphone, no network,
// no real keys. Publish uses MindMedia only. Server calls go to loopback mocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { ROOT, startServer } from "./helpers.js";
import {
  ACTIONS, SCREENS, NO_MATCH, CONFIRM_MS, TALK_DEFAULTS, NO_KEY_LINE, MIC_NO_KEY_LINE, parseCommand, createController, helpFor, coerceTalk, normalizeTalk,
  comboOf, stripWake, sentences, isStop, isYes, isNo, findProject, actionList,
} from "../web/features/voice-actions.js";
import { handleOpenAIEvent, handleElevenEvent, toolOutput } from "../web/features/voice-realtime.js";
import { talkStatus, synthesize, mintRealtime, realtimeTools, interpretWithModel } from "../server/voice-speak.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// ---- a fake host: records what the app was asked to do ----
function fakeHost(over = {}) {
  const log = [];
  const projects = [{ id: "p1", name: "Growtiv8" }, { id: "p2", name: "Beach Ads" }];
  const h = {
    log, spoken: [], currentView: "command",
    view() { return h.currentView; },
    async speak(t) { h.spoken.push(t); },
    async stopSpeech() { log.push("stopSpeech"); },
    async openScreen(s) { log.push(`open:${s.id}`); h.currentView = s.id; },
    async back() { log.push("back"); },
    async projects() { return projects; },
    async newProject(n) { log.push(`new:${n}`); return { id: "x" }; },
    async switchProject(p) { log.push(`switch:${p.name}`); },
    async deleteProject(p) { log.push(`delete:${p.name}`); return true; },
    async setMode(m) { log.push(`mode:${m}`); return true; },
    async getText() { return "typed text"; },
    async run(t) { log.push(`run:${t}`); return true; },
    async stop() { log.push("stop"); return true; },
    async status() { return { running: true, label: "A job is running", cost: "$0.04" }; },
    lastResult: async () => ({ id: "m1", title: "Beach ad", text: "Here is the ad. It is bright. It is warm." }),
    async publish(r) { log.push(`publish:${r.title}`); return true; },
    async remember(t) { log.push(`remember:${t}`); return true; },
    async forget(t) { log.push(`forget:${t}`); return true; },
    async steer(a) { log.push(`steer:${a.ai}:${a.step}`); return true; },
    async showHelp(l) { log.push(`help:${l.length}`); },
    async numbers(on) { log.push(`numbers:${on}`); return on ? 5 : 0; },
    async clickNumber(n) { log.push(`click:${n}`); return n <= 5; },
    ...over,
  };
  return h;
}
const fakeTimers = () => {
  const q = [];
  return { q, setTimeout: (f, ms) => { const t = { f, ms }; q.push(t); return t; }, clearTimeout: (t) => { const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); } };
};

test("parser: every phrase maps to its action", () => {
  const cases = [
    ["Stop", "stop"], ["cancel that", "stop"], ["never mind", "stop"],
    ["open MindMedia", "open_screen", { screen: "mindmedia" }],
    ["take me to the memory section, please", "open_screen", { screen: "memories" }],
    ["go to settings", "open_screen", { screen: "settings" }],
    ["show projects", "open_screen", { screen: "projects" }],
    ["back", "back"],
    ["start a new project called Beach Ads", "new_project", { name: "Beach Ads" }],
    ["switch to Growtiv8", "switch_project", { name: "Growtiv8" }],
    ["use council", "set_mode", { mode: "council" }], ["go back to auto", "set_mode", { mode: "auto" }], ["pick mission mode", "set_mode", { mode: "mission" }],
    ["make an image of a woman on a beach", "run"], ["run it", "run", { request: "" }], ["send it", "run"],
    ["what's running?", "status"], ["how much has this cost", "status"],
    ["read it to me", "read_result"], ["read the last result", "read_result"],
    ["remember that my brand color is teal", "remember", { text: "my brand color is teal" }],
    ["forget my old address", "forget", { text: "old address" }],
    ["what can I say", "help"], ["Hey Meld, what can I say?", "help"],
    ["publish this to MindMedia", "publish_mindmedia"], ["publish it", "publish_mindmedia"],
    ["delete project Beach Ads", "delete_project", { name: "Beach Ads" }],
    ["show numbers", "numbers", { on: true }], ["hide numbers", "numbers", { on: false }], ["click 3", "click_number", { n: 3 }],
    ["ask Claude to redo part 2", "steer", { ai: "claude", step: 2 }], ["retry step 3 with Gemini", "steer", { ai: "gemini", step: 3 }],
  ];
  for (const [text, action, args] of cases) {
    const c = parseCommand(text);
    assert.equal(c.action, action, text);
    for (const [k, v] of Object.entries(args || {})) assert.deepEqual(c.args[k], v, `${text} -> ${k}`);
  }
  assert.equal(parseCommand("banana").action, "unknown");
  assert.equal(parseCommand("").action, "unknown");
  assert.ok(isStop("Stop!") && isYes("Yeah") && isNo("nope") && !isYes("maybe"));
  assert.equal(findProject("growt", [{ name: "Growtiv8" }]).name, "Growtiv8");
});

test("registry: every action has a button label, a risk and works through the controller", async () => {
  const list = actionList();
  assert.ok(list.length >= 18);
  for (const a of list) { assert.ok(a.label && !/—/.test(a.label), a.id); assert.ok(["safe", "confirm"].includes(a.risk), a.id); }
  for (const id of ["open_screen", "new_project", "switch_project", "set_mode", "run", "stop", "status", "read_result", "remember", "forget", "help", "publish_mindmedia"]) assert.ok(ACTIONS[id], id);
  const risky = list.filter((a) => a.risk === "confirm").map((a) => a.id).sort();
  assert.deepEqual(risky, ["delete_project", "forget", "publish_mindmedia", "send_out", "spend"]);
  assert.ok(SCREENS.some((s) => s.id === "mindmedia") && SCREENS.some((s) => s.id === "memories"));
});

test("safe actions by typed transcript: each one runs, shows Heard / Doing / Done, and speaks", async () => {
  const h = fakeHost();
  const c = createController(h);
  const seen = [];
  c.subscribe((s) => seen.push(s.phase));
  let r = await c.hear("open MindMedia");
  assert.equal(r.ok, true);
  assert.deepEqual(h.log, ["open:mindmedia"]);
  assert.equal(c.strip.heard, "open MindMedia");
  assert.equal(c.strip.phase, "done");
  assert.match(c.strip.done, /MindMedia/);
  assert.deepEqual([...new Set(seen)], ["heard", "doing", "done"]);
  assert.match(h.spoken.at(-1), /Now in MindMedia/);

  await c.hear("start a new project called Beach Ads");
  await c.hear("switch to growtiv8");
  await c.hear("use council");
  await c.hear("make an image of a woman on a beach");
  await c.hear("run it");
  await c.hear("what's running");
  await c.hear("remember that my brand color is teal");
  await c.hear("show numbers");
  await c.hear("click 3");
  await c.hear("ask Claude to redo part 2");
  await c.hear("back");
  assert.deepEqual(h.log.slice(1), ["new:Beach Ads", "switch:Growtiv8", "mode:council", "run:make an image of a woman on a beach", "run:typed text", "remember:my brand color is teal", "numbers:true", "click:3", "steer:claude:2", "back"]);
  assert.match(h.spoken.join("|"), /Cost so far \$0.04/);
  assert.match(h.spoken.join("|"), /Remembered: my brand color is teal/);

  await c.hear("read it to me");
  assert.match(h.spoken.at(-1), /Here is the ad\. It is bright/);
  await c.hear("what can I say");
  assert.ok(h.log.some((l) => /^help:\d+$/.test(l)));
  // plain words only
  for (const t of h.spoken) assert.doesNotMatch(t, /—/);
});

test("risky actions need a spoken yes: publish, forget, delete, send, spend", async () => {
  for (const [phrase, action, effect] of [
    ["publish this to MindMedia", "publish_mindmedia", "publish:Beach ad"],
    ["forget my old address", "forget", "forget:old address"],
    ["delete project Beach Ads", "delete_project", "delete:Beach Ads"],
  ]) {
    const h = fakeHost();
    const c = createController(h);
    let r = await c.hear(phrase);
    assert.equal(r.waiting, true, phrase);
    assert.equal(c.pending.action, action);
    assert.equal(c.strip.phase, "waiting");
    assert.match(c.strip.waiting, /Say yes or no/);
    assert.equal(h.log.includes(effect), false, "nothing ran before the yes");
    r = await c.hear("yes");
    assert.ok(h.log.includes(effect), phrase);
    assert.equal(c.pending, null);
    // a "no" cancels
    const h2 = fakeHost(); const c2 = createController(h2);
    await c2.hear(phrase);
    await c2.hear("no");
    assert.equal(h2.log.includes(effect), false);
    assert.equal(c2.pending, null);
    assert.match(c2.strip.done, /Cancelled/);
    // anything else cancels the question and is treated as a new command
    const h3 = fakeHost(); const c3 = createController(h3);
    await c3.hear(phrase);
    await c3.hear("open settings");
    assert.equal(h3.log.includes(effect), false);
    assert.deepEqual(h3.log, ["open:settings"]);
  }
  // send and spend: a yes only OPENS the screen, the on-screen button still asks
  const h = fakeHost(); const c = createController(h);
  await c.hear("send the report to Dana");
  assert.equal(c.pending.action, "send_out");
  await c.hear("yes");
  assert.deepEqual(h.log, ["open:publish"]);
  const h2 = fakeHost(); const c2 = createController(h2);
  await c2.hear("buy more credits");
  assert.equal(c2.pending.action, "spend");
  await c2.hear("yes");
  assert.deepEqual(h2.log, ["open:settings"]);
});

test("silence cancels a waiting question after 8 seconds", async () => {
  assert.equal(CONFIRM_MS, 8000);
  const t = fakeTimers();
  const h = fakeHost();
  const c = createController(h, { setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  await c.hear("publish this to MindMedia");
  assert.equal(t.q.length, 1);
  assert.equal(t.q[0].ms, 8000);
  assert.ok(c.pending);
  t.q[0].f(); // eight seconds pass with no answer
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(c.pending, null);
  assert.equal(h.log.includes("publish:Beach ad"), false);
  assert.match(c.strip.done, /No answer/);
  // a late "yes" does nothing, because it is no longer a command
  const r = await c.hear("yes");
  assert.equal(h.log.includes("publish:Beach ad"), false);
  assert.equal(r.unknown, true);
});

test("a button runs the same registry action, and a risky one still asks", async () => {
  const h = fakeHost(); const c = createController(h);
  await c.runAction("open_screen", { screen: "mindmedia" });
  assert.deepEqual(h.log, ["open:mindmedia"]);
  const r = await c.runAction("publish_mindmedia");
  assert.equal(r.waiting, true);
  assert.equal(h.log.includes("publish:Beach ad"), false);
  await c.confirm();
  assert.ok(h.log.includes("publish:Beach ad"));
  assert.equal((await c.runAction("nope")).ok, false);
});

test("stop is instant and local: it quiets the voice, cancels a question and stops a running job", async () => {
  const h = fakeHost(); const c = createController(h);
  await c.hear("stop");
  assert.deepEqual(h.log, ["stopSpeech", "stop"]);
  // while a question waits, stop cancels it and does not stop the job
  const h2 = fakeHost(); const c2 = createController(h2);
  await c2.hear("publish this to MindMedia");
  await c2.hear("stop");
  assert.equal(c2.pending, null);
  assert.deepEqual(h2.log, ["stopSpeech"]);
  assert.match(c2.strip.done, /Cancelled/);
  // stop never needs a model or the network
  let modelCalls = 0;
  const c3 = createController(fakeHost(), { interpret: async () => { modelCalls += 1; return null; } });
  await c3.hear("Stop");
  assert.equal(modelCalls, 0);
});

test("unclear phrases: a cheap model if one is connected, else the plain line", async () => {
  const h = fakeHost();
  const none = createController(h);
  const r = await none.hear("banana split sundae");
  assert.equal(r.unknown, true);
  assert.equal(h.spoken.at(-1), NO_MATCH);
  assert.match(NO_MATCH, /^I did not catch that\. Try:/);
  assert.equal(none.strip.done, NO_MATCH);
  assert.equal(h.log.length, 0);
  // with a model
  const h2 = fakeHost();
  const asked = [];
  const c = createController(h2, { interpret: async (t) => { asked.push(t); return { action: "open_screen", args: { screen: "history" } }; } });
  await c.hear("banana split sundae");
  assert.deepEqual(asked, ["banana split sundae"]);
  assert.deepEqual(h2.log, ["open:history"]);
  // the model cannot invent an action, and a local match never calls it
  const c2 = createController(fakeHost(), { interpret: async () => ({ action: "format_disk", args: {} }) });
  assert.equal((await c2.hear("banana")).unknown, true);
  // a model that suggests a risky action still asks
  const h3 = fakeHost();
  const c3 = createController(h3, { interpret: async () => ({ action: "publish_mindmedia", args: {} }) });
  const r3 = await c3.hear("put it out in the world");
  assert.equal(r3.waiting, true);
  assert.equal(h3.log.length, 0);
});

test("remember refuses secrets; forget finds nothing; failures are spoken plainly", async () => {
  const h = fakeHost({ remember: async () => ({ refused: true }), forget: async () => ({ deleted: 0 }) });
  const c = createController(h);
  await c.hear("remember that my password is hunter22");
  assert.match(h.spoken.at(-1), /will not remember passwords/);
  await c.hear("forget the llama farm"); await c.hear("yes");
  assert.match(h.spoken.at(-1), /found nothing/);
  const bad = fakeHost({ openScreen: async () => { throw new Error("boom"); } });
  const c2 = createController(bad);
  const r = await c2.hear("open settings");
  assert.equal(r.ok, false);
  assert.match(bad.spoken.at(-1), /did not work/);
});

test("What can I say: phrases for each screen, and the voice phrase opens it", () => {
  for (const v of ["command", "mindmedia", "projects", "settings", "memories", "unknown-screen"]) {
    const list = helpFor(v);
    assert.ok(list.length >= 8, v);
    assert.ok(list.includes("Stop") && list.includes("What can I say?"), v);
    for (const p of list) assert.doesNotMatch(p, /—/);
  }
  assert.ok(helpFor("mindmedia").includes("Publish this to MindMedia"));
  assert.ok(helpFor("command").some((p) => /image/.test(p)));
  assert.notDeepEqual(helpFor("command"), helpFor("projects"));
  assert.equal(parseCommand("what can I say").action, "help");
});

test("talk settings: wake word off by default, Ctrl+Space, hands-free persists, junk is refused", () => {
  assert.deepEqual(coerceTalk(null), TALK_DEFAULTS);
  assert.equal(TALK_DEFAULTS.wakeWord, false);
  assert.equal(TALK_DEFAULTS.hotkey, "Ctrl+Space");
  assert.equal(TALK_DEFAULTS.handsFree, false);
  assert.equal(TALK_DEFAULTS.talk, false);
  assert.equal(TALK_DEFAULTS.speak, true);
  let s = normalizeTalk({ handsFree: true }, TALK_DEFAULTS);
  assert.equal(s.handsFree, true);
  s = normalizeTalk({ hotkey: "Ctrl+Shift+M" }, s);
  assert.equal(s.handsFree, true, "a partial update keeps the rest");
  assert.equal(s.hotkey, "Ctrl+Shift+M");
  assert.throws(() => normalizeTalk({ hotkey: "banana" }, s), /shortcut/);
  assert.throws(() => normalizeTalk({ handsFree: "yes" }, s), /on or off/);
  assert.throws(() => normalizeTalk(null), /object/);
  assert.equal(coerceTalk({ wakeWord: "yes" }).wakeWord, false, "only a real true turns it on");
  assert.equal(comboOf({ key: " ", ctrlKey: true }), "Ctrl+Space");
  assert.equal(comboOf({ key: "m", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+M");
  assert.equal(comboOf({ key: "Control", ctrlKey: true }), null);
});

test("wake word: 'Hey Meld' is stripped, other talk is not for Meld", () => {
  assert.equal(stripWake("Hey Meld open settings"), "open settings");
  assert.equal(stripWake("hey, meld. stop"), "stop");
  assert.equal(stripWake("Hey Meld"), "");
  assert.equal(stripWake("open settings"), null);
  assert.equal(stripWake("they melded"), null);
});

test("sentences: split for speaking, code left out", () => {
  const s = sentences("Hello there. Your image is ready! Want me to read the details or publish it? ```const a=1``` Bye now.");
  assert.ok(s.length >= 3);
  assert.ok(s.every((x) => x.length <= 400));
  assert.ok(!s.join(" ").includes("const a"));
  assert.deepEqual(sentences(""), []);
});

test("instant voice events: tool calls go through the controller; stop and barge-in are local", async () => {
  const h = fakeHost(); const c = createController(h);
  const sent = []; const states = [];
  const ctx = { controller: c, send: (o) => sent.push(o), onState: (s) => states.push(s), onHeard: () => {} };
  assert.equal(await handleOpenAIEvent({ type: "input_audio_buffer.speech_started" }, ctx), "barge-in");
  assert.ok(sent.some((o) => o.type === "output_audio_buffer.clear"));
  await handleOpenAIEvent({ type: "response.function_call_arguments.done", name: "open_screen", call_id: "c1", arguments: JSON.stringify({ screen: "mindmedia" }) }, ctx);
  assert.deepEqual(h.log, ["open:mindmedia"]);
  const out = sent.find((o) => o.type === "conversation.item.create");
  assert.equal(out.item.call_id, "c1");
  assert.match(out.item.output, /MindMedia/);
  assert.ok(sent.some((o) => o.type === "response.create"));
  // a risky tool waits for the person's yes and tells the model so
  sent.length = 0;
  await handleOpenAIEvent({ type: "response.output_item.done", item: { type: "function_call", name: "publish_mindmedia", call_id: "c2", arguments: "{}" } }, ctx);
  assert.equal(h.log.includes("publish:Beach ad"), false);
  assert.match(sent.find((o) => o.type === "conversation.item.create").item.output, /Waiting for the user to say yes/);
  assert.ok(c.pending);
  // "stop" heard by the model is handled locally at once
  sent.length = 0;
  await handleOpenAIEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "stop" }, ctx);
  assert.ok(sent.some((o) => o.type === "response.cancel"));
  assert.equal(c.pending, null);
  // ElevenLabs agent client tools
  const es = []; 
  await handleElevenEvent({ type: "client_tool_call", client_tool_call: { tool_name: "set_mode", tool_call_id: "t1", parameters: { mode: "council" } } }, { controller: c, send: (o) => es.push(o) });
  assert.ok(h.log.includes("mode:council"));
  assert.equal(es[0].type, "client_tool_result");
  assert.equal(es[0].is_error, false);
  assert.equal(await handleElevenEvent({ type: "ping", ping_event: { event_id: 4 } }, { send: (o) => es.push(o) }), "pong");
  assert.equal(await handleElevenEvent({ type: "interruption" }, { clearAudio: () => es.push("cleared") }), "barge-in");
  assert.ok(es.includes("cleared"));
  assert.match(toolOutput({ ok: false, say: "nope" }), /did not work/);
});

test("server helpers: talk status, no-key line, speech order, instant tokens, model fallback (mocked network)", async () => {
  assert.equal(talkStatus(() => false).needsKey, true);
  assert.equal(talkStatus(() => false).line, NO_KEY_LINE);
  // 0.4.25: free keys named first, never OpenAI first
  assert.match(NO_KEY_LINE, /^Add a free Groq or Gemini key to talk\.$/);
  // 0.4.25: a saved paid key is not consent. Paid off (the default): built-in voice, no Instant voice, no listening through OpenAI.
  const t0 = talkStatus((id) => id === "openai");
  assert.equal(t0.speaker, "browser"); assert.equal(t0.realtime, ""); assert.equal(t0.listen, ""); assert.equal(t0.needsKey, true); assert.equal(t0.line, NO_KEY_LINE);
  assert.equal(talkStatus((id) => id === "elevenlabs", { elevenAgentId: "agent_1" }).speaker, "browser", "ElevenLabs voice is paid too");
  assert.equal(talkStatus((id) => id === "elevenlabs", { elevenAgentId: "agent_1" }).realtime, "");
  const paid = { allowPaid: true };
  const t1 = talkStatus((id) => id === "openai", {}, paid);
  assert.equal(t1.needsKey, false); assert.equal(t1.speaker, "openai"); assert.equal(t1.realtime, "openai"); assert.equal(t1.listen, "openai", "opted in: OpenAI may listen as the last tier");
  const t2 = talkStatus((id) => id === "elevenlabs", { elevenAgentId: "agent_1" }, paid);
  assert.equal(t2.speaker, "elevenlabs"); assert.equal(t2.realtime, "elevenlabs");
  assert.equal(talkStatus((id) => id === "elevenlabs", {}, paid).realtime, "", "an agent id is needed");
  assert.equal(talkStatus((id) => id === "groq").speaker, "browser");
  assert.equal(talkStatus((id) => id === "groq").needsKey, false, "a free key is enough to talk");
  // speech: ElevenLabs first, then OpenAI, then the built-in voice
  const calls = [];
  const audio = Buffer.alloc(400, 1);
  const fetchImpl = async (url, o) => { calls.push({ url: String(url), headers: o?.headers }); if (String(url).includes("fail")) return { ok: false, status: 500 }; return { ok: true, status: 200, arrayBuffer: async () => audio, json: async () => ({ value: "ek_test_secret", expires_at: 5, signed_url: "wss://x/y" }) }; };
  const keys = { elevenlabs: { key: "el_k" }, openai: { key: "sk-k" } };
  const deps = (has) => ({ hasSecret: (id) => has.includes(id), getSecret: (id) => keys[id], fetchImpl, allowPaid: true });
  // paid voice off (the default): the free built-in voice, and nothing is sent to ElevenLabs or OpenAI
  const before = calls.length;
  let out = await synthesize("Hello there.", { ...deps(["elevenlabs", "openai"]), allowPaid: false });
  assert.equal(out.engine, "browser"); assert.equal(calls.length, before, "no paid call without the switch");
  let quiet = await mintRealtime({ ...deps(["openai"]), allowPaid: false });
  assert.equal(quiet.engine, "none"); assert.match(quiet.line, /Use my OpenAI credits for voice/); assert.equal(calls.length, before);
  quiet = await mintRealtime({ hasSecret: () => false, fetchImpl });
  assert.equal(quiet.engine, "none"); assert.equal(quiet.line, NO_KEY_LINE);
  out = await synthesize("Hello there.", deps(["elevenlabs", "openai"]));
  assert.equal(out.engine, "elevenlabs"); assert.equal(out.mime, "audio/mpeg");
  assert.match(calls.at(-1).url, /text-to-speech/);
  out = await synthesize("Hello there.", deps(["openai"]));
  assert.equal(out.engine, "openai"); assert.match(calls.at(-1).url, /audio\/speech/);
  assert.equal(calls.at(-1).headers.authorization, "Bearer sk-k");
  out = await synthesize("Hello there.", deps([]));
  assert.equal(out.engine, "browser"); assert.equal(out.text, "Hello there.");
  const failing = async () => ({ ok: false, status: 500 });
  out = await synthesize("Hello.", { hasSecret: () => true, getSecret: (id) => keys[id], fetchImpl: failing, allowPaid: true });
  assert.equal(out.engine, "browser", "a failing provider falls through to the built-in voice");
  await assert.rejects(() => synthesize("  ", deps([])), /Nothing to say/);
  // instant token: minted by the server, key never in the reply
  const tools = realtimeTools(actionList());
  assert.ok(tools.find((x) => x.name === "open_screen"));
  assert.ok(tools.every((x) => x.type === "function" && x.parameters.type === "object"));
  let mint = await mintRealtime({ ...deps(["openai"]), tools });
  assert.equal(mint.engine, "openai"); assert.equal(mint.secret, "ek_test_secret");
  assert.equal(JSON.stringify(mint).includes("sk-k"), false);
  assert.match(calls.at(-1).url, /realtime\/client_secrets/);
  mint = await mintRealtime({ ...deps(["elevenlabs"]), saved: { elevenAgentId: "agent_1" }, tools });
  assert.equal(mint.engine, "elevenlabs"); assert.equal(mint.signedUrl, "wss://x/y");
  assert.equal(JSON.stringify(mint).includes("el_k"), false);
  mint = await mintRealtime({ ...deps([]), tools });
  assert.equal(mint.engine, "none"); assert.equal(mint.line, NO_KEY_LINE);
  // loose phrase to an action by a cheap model, whitelisted
  const acts = actionList();
  const ask = (txt) => interpretWithModel("take me to old chats", { view: "command", actions: acts }, { complete: async () => txt });
  assert.deepEqual(await ask('{"action":"open_screen","args":{"screen":"history","x":{"bad":1}}}'), { action: "open_screen", args: { screen: "history" } });
  assert.deepEqual(await ask('{"action":"rm_rf","args":{}}'), { action: "none" });
  assert.deepEqual(await ask("not json"), { action: "none" });
  await assert.rejects(() => interpretWithModel("x", { actions: acts }, {}), /No connected AI/);
});

test("talk routes: settings persist, no-key line, spoken reply order, instant token (loopback mocks, fake keys)", async () => {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    seen.push({ url: req.url, auth: req.headers.authorization || "", xi: req.headers["xi-api-key"] || "" });
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url.includes("/audio/speech")) { res.writeHead(200, { "content-type": "audio/mpeg" }); return res.end(Buffer.alloc(500, 2)); }
    if (req.url.includes("/text-to-speech/")) { res.writeHead(200, { "content-type": "audio/mpeg" }); return res.end(Buffer.alloc(500, 3)); }
    if (req.url.includes("/realtime/client_secrets")) return send(200, { value: "ek_fake_mint_1", expires_at: 99 });
    if (req.url.includes("/models") || req.url.includes("/user/subscription")) return send(200, { data: [{ id: "m" }], character_count: 1, character_limit: 100 });
    send(404, { error: "no route" });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const blank = { CC_STATUS_PAGES: "off", CC_WHISPER_BIN: "off", CC_BASE_URL_OPENAI: `${origin}/oa/v1`, CC_BASE_URL_ELEVENLABS: `${origin}/el`, OPENAI_API_KEY: "", GROQ_API_KEY: "", ELEVENLABS_API_KEY: "", GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "" };
  const s = await startServer({ env: blank });
  try {
    let r = await s.api("/voice/talk");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.settings, TALK_DEFAULTS);
    assert.equal(r.json.status.needsKey, true);
    assert.equal(r.json.status.line, NO_KEY_LINE);
    assert.ok(r.json.actions.some((a) => a.id === "publish_mindmedia"));
    // no key: speaking falls back to the built-in voice, instant voice says add a key, nothing leaves the PC
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello." } });
    assert.equal(r.json.engine, "browser");
    r = await s.api("/voice/realtime", { method: "POST", body: {} });
    assert.equal(r.json.engine, "none"); assert.equal(r.json.line, NO_KEY_LINE);
    assert.equal(seen.length, 0);
    // settings persist across requests
    r = await s.api("/voice/talk", { method: "POST", body: { handsFree: true, hotkey: "Ctrl+Shift+M" } });
    assert.equal(r.json.settings.handsFree, true);
    r = await s.api("/voice/talk");
    assert.equal(r.json.settings.handsFree, true); assert.equal(r.json.settings.hotkey, "Ctrl+Shift+M"); assert.equal(r.json.settings.wakeWord, false);
    r = await s.api("/voice/talk", { method: "POST", body: { hotkey: "banana" } });
    assert.equal(r.status, 400);
    // the older tap/hold settings are untouched
    assert.equal((await s.api("/voice")).json.mode, "tap");
    // 0.4.25: the Mic asks first; no key means one short line
    r = await s.api("/voice/ready");
    assert.equal(r.status, 200); assert.equal(r.json.ready, false); assert.equal(r.json.line, MIC_NO_KEY_LINE);
    // OpenAI key saved but paid voice off (the default): built-in voice, no Instant voice, nothing sent anywhere
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key: "sk-proj-talktest00000001" } })).status, 200);
    const sent = seen.filter((x) => /audio\/speech|text-to-speech|realtime/.test(x.url)).length;
    r = await s.api("/voice/talk");
    assert.equal(r.json.status.speaker, "browser"); assert.equal(r.json.status.realtime, "");
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello." } });
    assert.equal(r.json.engine, "browser");
    r = await s.api("/voice/realtime", { method: "POST", body: {} });
    assert.equal(r.json.engine, "none");
    assert.equal(seen.filter((x) => /audio\/speech|text-to-speech|realtime/.test(x.url)).length, sent, "a saved paid key is not consent to spend it");
    assert.equal((await s.api("/voice/ready")).json.ready, false, "OpenAI alone does not make the Mic ready while paid voice is off");
    // paid voice turned on: spoken reply and instant token come from the mocks
    assert.equal((await s.api("/voice/speech-paid", { method: "POST", body: { paidSpeech: true } })).json.paidSpeech, true);
    assert.equal((await s.api("/voice/ready")).json.ready, true);
    r = await s.api("/voice/talk");
    assert.equal(r.json.status.needsKey, false); assert.equal(r.json.status.speaker, "openai"); assert.equal(r.json.status.realtime, "openai");
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello." } });
    assert.equal(r.json.engine, "openai"); assert.ok(r.json.audio.length > 100);
    r = await s.api("/voice/realtime", { method: "POST", body: {} });
    assert.equal(r.json.engine, "openai"); assert.equal(r.json.secret, "ek_fake_mint_1");
    assert.equal(r.text.includes("sk-proj-talktest00000001"), false);
    assert.equal(s.log.includes("sk-proj-talktest00000001"), false);
    // ElevenLabs wins the voice when it also has a key
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "elevenlabs", key: "el_talktest0000000000001" } })).status, 200);
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello." } });
    assert.equal(r.json.engine, "elevenlabs");
    // speaking off: text only
    await s.api("/voice/talk", { method: "POST", body: { speak: false } });
    r = await s.api("/voice/speak", { method: "POST", body: { text: "Hello." } });
    assert.equal(r.json.engine, "text");
    // instant voice off: the normal path
    await s.api("/voice/talk", { method: "POST", body: { instant: false } });
    r = await s.api("/voice/realtime", { method: "POST", body: {} });
    assert.equal(r.json.engine, "none");
  } finally {
    await s.stop();
    await new Promise((r) => srv.close(r));
  }
});

test("wiring: the module is loaded at start, the bar has Talk, state words and Hands-free, Esc and the hotkey are bound", () => {
  const reg = read("web", "perf", "registry.js");
  assert.match(reg, /id: "voice-talk", shell: true/);
  const ui = read("web", "features", "voice-talk.js");
  for (const w of ["Listening", "Thinking", "Speaking", "Waiting for yes", "Hands-free", "Heard:", "Doing:", "Done:", "What can I say"]) assert.ok(ui.includes(w), w);
  assert.match(ui, /e\.key === "Escape"/);
  assert.match(ui, /comboOf\(e\) !== cfg\.hotkey/);
  assert.match(ui, /data-voice-action/);
  assert.match(ui, /\/voice\/realtime/);
  assert.doesNotMatch(ui, /—/);
  assert.doesNotMatch(read("web", "features", "voice-actions.js"), /—/);
});

test("voice 'publish it' only saves to MindMedia as Review and never says it published (0.4.22 C8)", async () => {
  const h = fakeHost(); const c = createController(h);
  await c.hear("publish it");
  await c.confirm();
  const said = h.spoken.join(" | ");
  assert.match(said, /Saved to MindMedia/);
  assert.equal(/published/i.test(said), false, said);
  assert.equal(/\bpublish\b/i.test(h.spoken.filter((s) => /\?$/.test(s)).join(" ")), false, said);
  // the real host saves with status Review, never Published
  const src = fs.readFileSync(path.join(ROOT, "web", "features", "voice-talk.js"), "utf8");
  const call = src.match(/saveToMindMedia\(\{[^}]*source: "voice"[^}]*\}/)?.[0] || "";
  assert.match(call, /status: "Review"/);
  assert.equal(call.includes("Published"), false);
});
