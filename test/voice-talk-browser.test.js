// Talk bar in a real browser (demo mode, no microphone, no keys). Transcripts are typed in through CC.voice.hear.
// Covers: the bar and Talk toggle, state words, Heard / Doing / Done strip, open screen, spoken yes for publish
// (MindMedia only), "what can I say" card, number overlay, hotkey, hands-free persistence, no-key line, Esc.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(20000);

test("Talk bar: toggle, strip, navigation, publish needs yes, help card, numbers, hotkey, hands-free, no-key line", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 900 });
  try {
    const { page } = t;
    await page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite{display:none!important}" });
    await goChat(page);
    await page.waitForFunction(() => window.CC.voice && document.getElementById("vt-bar"), null, { timeout: WAIT });
    // fake microphone: an empty stream, so nothing real is opened
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => new MediaStream();
      window.__spoken = [];
      window.CC.voice.controller; // make sure it exists
    });
    // the bar: Talk toggle, state word, hands-free, stop, help
    const bar = await page.evaluate(() => ({ talk: !!document.getElementById("vt-talk"), hands: !!document.getElementById("vt-hands"), stop: !!document.getElementById("vt-stop"), help: !!document.getElementById("vt-help-btn"), state: document.getElementById("vt-state-text").textContent, key: window.CC.voice.hotkey, wake: window.CC.voice.settings.wakeWord }));
    assert.deepEqual({ ...bar }, { talk: true, hands: true, stop: true, help: true, state: "Talk is off", key: "Ctrl+Space", wake: false });
    // no keys saved: one plain line with a link to the keys screen
    await page.waitForFunction(() => !document.getElementById("vt-line").hidden, null, { timeout: WAIT });
    const line = await page.evaluate(() => document.getElementById("vt-line").textContent);
    assert.match(line, /Add a key to talk \(OpenAI, Groq, ElevenLabs or Gemini\)\./);
    assert.ok(await page.evaluate(() => !!document.getElementById("vt-keys")));
    // the bar sits above the chat dock, not over it
    const placed = await page.evaluate(() => { const b = document.getElementById("vt-bar"), d = document.getElementById("cc-dock"); return d ? b.nextElementSibling === d : b.parentElement.classList.contains("view-col"); });
    assert.ok(placed);

    // typed transcript: open a screen by voice, strip shows Heard / Doing / Done
    await page.evaluate(() => window.CC.voice.hear("open MindMedia"));
    await page.waitForFunction(() => window.CC.S.view === "mindmedia", null, { timeout: WAIT });
    const strip = await page.evaluate(() => document.getElementById("vt-strip").textContent);
    assert.match(strip, /Heard: open MindMedia/);
    assert.match(strip, /Done: Now in MindMedia/);
    await page.evaluate(() => window.CC.voice.hear("go to settings"));
    await page.waitForFunction(() => window.CC.S.view === "settings", null, { timeout: WAIT });

    // pick a mode and a new project by voice
    await page.evaluate(() => window.CC.voice.hear("start a new project called Voice Test Ads"));
    await page.waitForFunction(() => (window.CC.S.projects || []).some((p) => p.name === "Voice Test Ads"), null, { timeout: WAIT });

    // publish needs a spoken yes; MindMedia only
    await page.evaluate(() => { window.CC.S.live = { id: "r-voice", status: "done", deliverable: "A short finished caption for the beach ad. It is warm and bright." }; });
    await page.evaluate(() => window.CC.voice.hear("publish this to MindMedia"));
    assert.equal(await page.evaluate(() => document.getElementById("vt-bar").dataset.state), "waiting");
    assert.equal(await page.evaluate(() => !document.getElementById("vt-yes").hidden), true);
    let hub = (await t.api("/mindmedia?project=all")).json;
    let items = hub.items || hub.flatItems || [];
    assert.equal(items.some((i) => /short finished caption/.test(JSON.stringify(i))), false, "nothing is published before the yes");
    await page.evaluate(() => window.CC.voice.hear("yes"));
    await page.waitForFunction(() => /Published to MindMedia/.test(document.getElementById("vt-strip").textContent), null, { timeout: WAIT });
    hub = (await t.api("/mindmedia?project=all")).json;
    items = hub.items || hub.flatItems || [];
    const saved = items.find((i) => /Published/.test(i.status || "") && /beach ad|caption/i.test(JSON.stringify(i)));
    assert.ok(saved, "the item is in MindMedia as Published: " + JSON.stringify(items).slice(0, 300));
    // silence cancels
    await page.evaluate(() => window.CC.voice.hear("publish this to MindMedia"));
    await page.evaluate(() => window.CC.voice.controller.expire());
    assert.equal(await page.evaluate(() => window.CC.voice.controller.pending), null);
    assert.match(await page.evaluate(() => document.getElementById("vt-strip").textContent), /No answer/);

    // What can I say card, by voice and by the ? button; every line plain
    await page.evaluate(() => window.CC.voice.hear("what can I say"));
    await page.waitForSelector("#vt-help li", { timeout: WAIT });
    assert.ok((await page.$$eval("#vt-help li", (n) => n.length)) >= 8);
    await page.click("#vt-help-x");
    assert.equal(await page.$("#vt-help"), null);
    await page.click("#vt-help-btn");
    await page.waitForSelector("#vt-help", { timeout: WAIT });
    await page.click("#vt-help-x");

    // number overlay: show numbers, then say a number to click that control
    await goChat(page);
    const count = await page.evaluate(() => window.CC.voice.hear("show numbers").then(() => document.querySelectorAll(".vt-num").length));
    assert.ok(count >= 3, "numbers drawn: " + count);
    await page.evaluate(() => window.CC.voice.hear("hide numbers"));
    assert.equal(await page.$$eval(".vt-num", (n) => n.length), 0);

    // Talk toggle turns the session on and off, persists the choice
    await page.click("#vt-talk");
    await page.waitForFunction(() => window.CC.voice.isTalking(), null, { timeout: WAIT });
    assert.equal(await page.getAttribute("#vt-talk", "aria-pressed"), "true");
    assert.notEqual(await page.evaluate(() => document.getElementById("vt-state-text").textContent), "Talk is off");
    // hands-free persists on the server
    await page.check("#vt-hands");
    await page.waitForFunction(async () => (await window.CC.api("/voice/talk")).settings.handsFree === true, null, { timeout: WAIT });
    // hotkey: Ctrl+Space starts push-to-talk, release ends it; Esc stops speech
    await page.keyboard.down("Control"); await page.keyboard.down("Space");
    await page.waitForFunction(() => window.CC.voice.ptt === true, null, { timeout: WAIT });
    await page.keyboard.up("Space"); await page.keyboard.up("Control");
    await page.waitForFunction(() => window.CC.voice.ptt === false, null, { timeout: WAIT });
    await page.keyboard.press("Escape");
    await page.click("#vt-talk");
    await page.waitForFunction(() => !window.CC.voice.isTalking(), null, { timeout: WAIT });
    assert.equal(await page.evaluate(() => document.getElementById("vt-state-text").textContent), "Talk is off");
    // reload: hands-free is still on
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.CC.voice && window.CC.voice.settings.handsFree === true, null, { timeout: WAIT });
    assert.equal(await page.evaluate(() => window.CC.voice.settings.wakeWord), false);
    assert.deepEqual(t.errors.filter((e) => !/Failed to load resource|favicon/i.test(e)), []);
  } finally {
    await t.close();
  }
});

test("Talk bar: the Settings panel lists the shortcut, wake word (off) and the What can I say button", { skip }, async () => {
  const t = await bootPage({ mode: "expert", width: 1280, height: 900 });
  try {
    const { page } = t;
    await page.evaluate(() => window.CC.openSettings());
    await page.waitForSelector("#vt-settings", { timeout: WAIT });
    const s = await page.evaluate(() => ({ wake: document.getElementById("vts-wake").checked, key: document.getElementById("vts-key").value, speak: document.getElementById("vts-speak").checked }));
    assert.deepEqual({ ...s }, { wake: false, key: "Ctrl+Space", speak: true });
    await page.check("#vts-wake");
    await page.waitForFunction(async () => (await window.CC.api("/voice/talk")).settings.wakeWord === true, null, { timeout: WAIT });
  } finally {
    await t.close();
  }
});
