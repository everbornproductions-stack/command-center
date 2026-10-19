// Voice orders: tap to talk (default) vs hold to talk. The hold must survive the
// events that used to cut a press short. No network, no real keys, temp data dir only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import {
  EARLY_END, MODES, DEFAULT_MODE, createSession, reduce, normalizeSettings, coerceSettings, formatElapsed, buttonLabel, buttonTitle, hint,
} from "../web/features/voice-mode.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("defaults: tap to talk, labels, elapsed time", () => {
  assert.equal(DEFAULT_MODE, "tap");
  assert.deepEqual(MODES, ["tap", "hold"]);
  const s = createSession();
  assert.equal(s.mode, "tap");
  assert.equal(s.silenceStop, false);
  assert.equal(s.recording, false);
  assert.equal(createSession({ mode: "nope" }).mode, "tap");
  assert.equal(createSession({ mode: "hold", silenceStop: true }).silenceStop, true);
  assert.deepEqual(coerceSettings(null), { mode: "tap", silenceStop: false });
  assert.equal(buttonLabel(s), "Tap to talk");
  assert.equal(buttonLabel({ mode: "tap", recording: true }), "Tap to stop");
  assert.equal(buttonLabel({ mode: "hold", recording: false }), "Hold to talk");
  assert.equal(buttonLabel({ mode: "hold", recording: true }), "Release to stop");
  assert.match(buttonTitle({ mode: "hold", recording: true }), /until you release/);
  assert.match(hint({ mode: "tap", silenceStop: false }), /Tap to start/);
  assert.match(hint({ mode: "hold" }), /until you release/);
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(999), "0:00");
  assert.equal(formatElapsed(1000), "0:01");
  assert.equal(formatElapsed(61000), "1:01");
  assert.equal(formatElapsed(-5), "0:00");
  for (const s of [buttonLabel({ mode: "hold", recording: true }), buttonTitle({ mode: "tap" }), hint({ mode: "tap", silenceStop: true })]) assert.doesNotMatch(s, /\u2014/);
});

test("normalize: partial update, rejects junk", () => {
  assert.equal(normalizeSettings({}).mode, "tap");
  assert.equal(normalizeSettings({ silenceStop: true }, { mode: "hold", silenceStop: false }).mode, "hold");
  assert.equal(normalizeSettings({ silenceStop: true }, { mode: "hold" }).silenceStop, true);
  assert.equal(normalizeSettings({ mode: "hold" }, { mode: "tap", silenceStop: true }).silenceStop, true);
  assert.throws(() => normalizeSettings({ mode: "push" }), /tap or hold/);
  assert.throws(() => normalizeSettings({ mode: "HOLD" }), /tap or hold/);
  assert.throws(() => normalizeSettings(null), /object/);
  assert.throws(() => normalizeSettings([]), /object/);
});

test("tap: press starts on release, second press stops, leave does not", () => {
  const orig = createSession();
  let r = reduce(orig, { type: "pointerdown", button: 0, pointerId: 1 }, 1000);
  assert.equal(r.effect, "none");
  assert.equal(r.session.recording, false);
  assert.equal(orig.recording, false, "reduce does not mutate the previous session");
  r = reduce(r.session, { type: "pointerleave", pointerId: 1 }, 1100);
  r = reduce(r.session, { type: "pointerup", pointerId: 1 }, 1200);
  assert.equal(r.effect, "start");
  assert.equal(r.session.startedAt, 1200);
  r = reduce(r.session, { type: "pointerdown", button: 0, pointerId: 4 }, 2000);
  r = reduce(r.session, { type: "pointerup", pointerId: 4 }, 2100);
  assert.equal(r.effect, "stop");
  assert.equal(r.session.recording, false);
});

test("tap: key starts once, repeat and keyup do not flip it, second key stops", () => {
  let r = reduce(createSession(), { type: "keydown", key: " ", repeat: false }, 0);
  assert.equal(r.effect, "start");
  r = reduce(r.session, { type: "keydown", key: " ", repeat: true }, 1);
  assert.equal(r.effect, "none");
  assert.equal(r.session.recording, true);
  r = reduce(r.session, { type: "keyup", key: " " }, 2);
  assert.equal(r.session.recording, true);
  r = reduce(r.session, { type: "keydown", key: "Enter" }, 3);
  assert.equal(r.effect, "stop");
  r = reduce(createSession(), { type: "keydown", key: "a" }, 0);
  assert.equal(r.effect, "none");
});

test("tap: silence stop is optional; a recognizer timeout still restarts", () => {
  let r = reduce(createSession({ silenceStop: false }), { type: "keydown", key: " " }, 0);
  r = reduce(r.session, { type: "silence" }, 1);
  assert.equal(r.effect, "none");
  r = reduce(r.session, { type: "recognizerend", cause: "silence" }, 2);
  assert.equal(r.effect, "restart");
  assert.equal(r.session.recording, true);

  r = reduce(createSession({ silenceStop: true }), { type: "keydown", key: " " }, 0);
  r = reduce(r.session, { type: "recognizerend", cause: "end" }, 1);
  assert.equal(r.effect, "restart", "a service timeout is not a pause");
  r = reduce(r.session, { type: "recognizerend", cause: "silence" }, 2);
  assert.equal(r.effect, "stop");
  r = reduce(createSession({ silenceStop: true }), { type: "keydown", key: " " }, 0);
  r = reduce(r.session, { type: "silence" }, 1);
  assert.equal(r.effect, "stop");
});

test("tap: pointercancel drops an unfinished tap and does not ghost-toggle later", () => {
  let r = reduce(createSession(), { type: "pointerdown", button: 0, pointerId: 1 }, 0);
  r = reduce(r.session, { type: "pointercancel", pointerId: 1 }, 1);
  assert.equal(r.session.armed, false);
  r = reduce(r.session, { type: "pointerup", pointerId: 1 }, 2);
  assert.equal(r.session.recording, false);
  assert.equal(r.effect, "none");
});

test("hold: the press survives leave, cancel, lost capture, blur, silence and recognizer end", () => {
  let r = reduce(createSession({ mode: "hold", silenceStop: true }), { type: "pointerdown", button: 0, pointerId: 7 }, 50);
  assert.equal(r.effect, "start");
  assert.equal(r.session.startedAt, 50);
  // While capture is held, a move that reports the button up is not a release.
  r = reduce(r.session, { type: "pointermove", buttons: 0, pointerId: 7 }, 60);
  assert.equal(r.effect, "none");
  assert.equal(r.session.recording, true);
  const orig = r.session;
  for (const type of EARLY_END) {
    r = reduce(r.session, { type, pointerId: 7, buttons: 1 }, 100);
    assert.equal(r.session.recording, true, type);
    assert.equal(r.effect, "none", type);
  }
  assert.equal(orig.recording, true);
  r = reduce(r.session, { type: "recognizerend", cause: "silence" }, 200);
  assert.equal(r.effect, "restart");
  assert.equal(r.session.recording, true);
  assert.equal(r.session.startedAt, 50, "timer keeps the original press");
  r = reduce(r.session, { type: "error", code: "no-speech" }, 300);
  assert.equal(r.effect, "restart");
  r = reduce(r.session, { type: "blur" }, 400);
  r = reduce(r.session, { type: "focus" }, 500);
  assert.equal(r.session.recording, true);
  r = reduce(r.session, { type: "pointerup", pointerId: 7 }, 700);
  assert.equal(r.effect, "stop");
  assert.equal(r.session.recording, false);
  assert.equal(r.session.held, false);
});

test("hold: after capture is lost, a move that reports the button up does not stop", () => {
  let r = reduce(createSession({ mode: "hold" }), { type: "pointerdown", button: 0, pointerId: 1 }, 0);
  r = reduce(r.session, { type: "pointercancel", pointerId: 1 }, 1);
  assert.equal(r.session.captureLost, true);
  assert.equal(r.session.recording, true);
  r = reduce(r.session, { type: "pointermove", buttons: 1, pointerId: 1 }, 2);
  assert.equal(r.effect, "none");
  r = reduce(r.session, { type: "pointermove", buttons: 0, pointerId: 1 }, 3);
  assert.equal(r.effect, "none");
  assert.equal(r.session.recording, true, "buttons 0 after cancel is not a release");
  r = reduce(r.session, { type: "pointerup", pointerId: 1 }, 4);
  assert.equal(r.effect, "stop");
});

test("hold: lost capture from a re-render does not stop, and the matching pointerup still does", () => {
  let r = reduce(createSession({ mode: "hold" }), { type: "pointerdown", button: 0, pointerId: 2 }, 0);
  r = reduce(r.session, { type: "lostpointercapture", pointerId: 2 }, 1);
  assert.equal(r.session.recording, true);
  assert.equal(r.session.captureLost, true);
  r = reduce(r.session, { type: "pointerup", pointerId: 9 }, 2);
  assert.equal(r.effect, "stop", "once capture is lost, the release may come from another target");
});

test("hold: key repeat does not stop, keyup does, right click does not start", () => {
  let r = reduce(createSession({ mode: "hold" }), { type: "keydown", key: " ", repeat: false }, 0);
  assert.equal(r.effect, "start");
  r = reduce(r.session, { type: "keydown", key: " ", repeat: true }, 10);
  r = reduce(r.session, { type: "keydown", key: " ", repeat: true }, 20);
  assert.equal(r.session.recording, true);
  r = reduce(r.session, { type: "keyup", key: "a" }, 30);
  assert.equal(r.session.recording, true);
  r = reduce(r.session, { type: "keyup", key: " " }, 40);
  assert.equal(r.effect, "stop");
  r = reduce(createSession({ mode: "hold" }), { type: "pointerdown", button: 2, pointerId: 1 }, 0);
  assert.equal(r.session.recording, false);
});

test("switching mode or a blocked mic", () => {
  let r = reduce(createSession({ mode: "hold" }), { type: "pointerdown", button: 0, pointerId: 1 }, 0);
  r = reduce(r.session, { type: "settings", settings: { mode: "tap" } }, 1);
  assert.equal(r.session.mode, "tap");
  assert.equal(r.session.recording, true);
  assert.equal(r.effect, "none");
  r = reduce(r.session, { type: "pointerup", pointerId: 1 }, 2);
  assert.equal(r.effect, "stop");

  r = reduce(createSession({ mode: "hold" }), { type: "pointerdown", button: 0, pointerId: 1 }, 0);
  r = reduce(r.session, { type: "settings", settings: { mode: "nope" } }, 1);
  assert.equal(r.session.mode, "hold");
  r = reduce(r.session, { type: "error", code: "aborted" }, 2);
  assert.equal(r.effect, "none");
  r = reduce(r.session, { type: "error", code: "not-allowed" }, 3);
  assert.equal(r.effect, "stop");
  assert.equal(r.session.held, false);
});

test("desktop mic grant and the button no longer stops on mouseup or mouseleave", () => {
  const ui = read("web", "features", "voice.js");
  const main = read("electron", "main.cjs");
  assert.match(ui, /setPointerCapture/);
  assert.match(ui, /recognizerend/);
  assert.match(ui, /pointercancel/);
  assert.match(ui, /lostpointercapture/);
  assert.doesNotMatch(ui, /addEventListener\(\s*["']mouseleave["']/);
  assert.doesNotMatch(ui, /addEventListener\(\s*["']mouseup["']/);
  assert.doesNotMatch(ui, /addEventListener\(\s*["']touchend["']/);
  assert.match(ui, /addEventListener\("blur", \(\) => apply\(\{ type: "blur" \}\)\)/);
  assert.doesNotMatch(ui, /\u2014/);
  assert.doesNotMatch(read("web", "features", "voice-mode.js"), /\u2014/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setPermissionCheckHandler/);
  assert.match(main, /microphone/);
  assert.match(main, /allowMicrophone\(\)/);
  const ready = main.slice(main.indexOf("app.whenReady()"));
  assert.ok(ready.indexOf("allowMicrophone()") < ready.indexOf("createWindow()"));
  assert.ok(ready.indexOf("setupUpdater()") < ready.indexOf("startServer()"));
});

test("server: voice mode persists on the settings document, default tap, junk rejected", async () => {
  const marker = "test-cloud-key";
  const s = await startServer({
    seed(dir) {
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({
        budgetMonthly: 100, defaultMode: "balanced", qa: true, missionBudget: 2, name: "Command AI",
        cloud: { url: "http://127.0.0.1", anonKey: marker },
      }));
    },
  });
  try {
    assert.equal((await s.api("/voice", { noToken: true })).status, 401);
    const g = await s.api("/voice");
    assert.equal(g.status, 200);
    assert.equal(g.json.mode, "tap");
    assert.equal(g.json.silenceStop, false);
    assert.equal(g.json.defaultMode, "tap");
    assert.deepEqual(g.json.modes, ["tap", "hold"]);
    assert.equal(g.json.anonKey, undefined);
    assert.ok(!g.text.includes(marker), "the voice response does not echo settings secrets");

    const p = await s.api("/voice", { method: "POST", body: { mode: "hold" } });
    assert.equal(p.status, 200);
    assert.equal(p.json.mode, "hold");
    assert.equal(p.json.silenceStop, false);
    assert.ok(!p.text.includes(marker));

    const file = path.join(s.dir, "settings.json");
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(stored.voice.mode, "hold");
    assert.equal(stored.budgetMonthly, 100, "other settings stay put");
    assert.equal(stored.cloud.anonKey, marker);
    assert.equal(stored.defaultMode, "balanced");

    const partial = await s.api("/voice", { method: "POST", body: { silenceStop: true } });
    assert.equal(partial.json.mode, "hold");
    assert.equal(partial.json.silenceStop, true);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).voice.silenceStop, true);

    const bad = await s.api("/voice", { method: "POST", body: { mode: "push" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, "voice_invalid");
    assert.equal((await s.api("/voice")).json.mode, "hold", "a rejected save leaves the stored mode");

    const back = await s.api("/voice", { method: "POST", body: { mode: "tap", silenceStop: false } });
    assert.equal(back.json.mode, "tap");
    assert.equal((await s.api("/state")).json.settings.voice.mode, "tap");
    assert.ok((await s.api("/state")).json.plugins.includes("voice"));
    assert.equal((await s.api("/voice/other")).status, 404);
    assert.ok(!s.log.includes(marker), "the server log does not contain the settings secret");
  } finally { await s.stop(); }
});
