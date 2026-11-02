// 0.5.0 (Chris, 2026-11-02, after 0.4.38: "It's a chat now but doesn't look right. If we are going more this route, why
// not make it look more like you here [the Claude app]? It looks weird to have a small chat box and then weird wasted
// space everywhere, and the marching orders scroll up and down like it is."). Simple Chat and Expert Command are one
// chat: a new chat is a greeting with the box in the middle of the page and the make chips under it; in a conversation
// the column fills the page, only the conversation scrolls, and the box is pinned at the bottom. Your messages are
// bubbles, answers are plain text with small icon buttons and Make changes under them. Approved mockup:
// meldmind-dogfood/mockups/chat-v2-050.html.
// Real server in demo mode (practice AIs, no keys, nothing sent), headless Chrome through bootMac (the Mac look, as a new
// user boots), CC_DEV_OWNER=1 so Mission (Pro) runs. Skips only when no Chrome is installed.
// @helper-process: bootMac starts the app server and a browser. Windows rules: one server and one browser at a time,
// real waits, every test closes what it opens. Screenshots: meldmind-dogfood/chat-v2-050-built-*.png (CC_SHOTS to move).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { ANSWER_BUTTONS, CHAT_MODES, MAKE_CHIPS, CHAT_NOTE, chatGreeting } from "../web/simple-ui.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(180000);
const ROOT = path.join(import.meta.dirname, "..");
const SHOTS = process.env.CC_SHOTS || path.resolve(ROOT, "..", "meldmind-dogfood");
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer{display:none!important}";
const ICONS = ["Copy", "Try again", "Save as file", "Give to an agent"];
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `chat-v2-050-built-${name}.png`) });
}
// Mac look, practice AIs on, owner flag (Mission is Pro), on the chat page of the mode asked for.
async function boot({ mode, theme = "light", width = 1366, height = 800 }) {
  const t = await bootMac({ width, height, mode, theme, env: { CC_DEV_OWNER: "1" } });
  if (!t) return null;
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.addInitScript(() => {
      // every toast that shows, so a test can say none of them was a "done" toast
      window.__toasts = [];
      addEventListener("DOMContentLoaded", () => {
        const box = document.getElementById("toasts");
        if (box) new MutationObserver(() => { for (const n of box.querySelectorAll(".toast")) { const t = n.textContent.trim(); if (t && !window.__toasts.includes(t)) window.__toasts.push(t); } }).observe(box, { childList: true, subtree: true });
      });
    });
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: POPUPS });
    if ((await t.page.evaluate(() => document.body.dataset.ui)) !== mode) {
      await t.page.click(mode === "expert" ? "#mac-expert" : "#mac-simple");
      await t.page.waitForFunction((m) => document.body.dataset.ui === m, mode, { timeout: WAIT });
    }
    await openChat(t.page);
    return t;
  } catch (e) { await t.close(); throw e; }
}
async function openChat(page) {
  await page.evaluate(() => { window.CC.go("command"); window.CC.mac.bus.emit("chat"); });
  await page.waitForFunction(() => !!document.querySelector("#view .chat2 #cb #orders") && document.body.dataset.macFlow !== "on", null, { timeout: WAIT });
}
// Type and press Send like a person. The second one goes on in the same chat.
async function send(page, text) {
  const before = await page.evaluate(() => ({ id: window.CC.S.live?.id || "", n: document.querySelectorAll("#sc-turns .sc-reply").length }));
  await page.fill("#orders", text);
  await page.click("#go");
  await page.waitForFunction((b) => (window.CC.S.live?.id && window.CC.S.live.id !== b.id) || document.querySelectorAll("#sc-turns .sc-reply").length > b.n, before, { timeout: RUN });
  await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !window.CC.S.live?.replying && [...document.querySelectorAll("#view .chat2 .sc-acts")].every((a) => a.getBoundingClientRect().height > 0), null, { timeout: RUN });
}
// Where the box sits and what is over it.
async function boxState(page) {
  return page.evaluate(() => {
    const box = document.querySelector("#view .chat2 #cb-box");
    const r = box.getBoundingClientRect();
    const view = document.getElementById("view").getBoundingClientRect();
    const pts = [[r.left + 14, r.top + 14], [r.right - 14, r.top + 14], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 14, r.bottom - 12], [r.right - 14, r.bottom - 12]];
    const covered = pts.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return !hit || !box.contains(hit); }).map(([x, y]) => { const hit = document.elementFromPoint(x, y); return `${Math.round(x)},${Math.round(y)}: ${hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none"}`; });
    const shown = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).display !== "none" ? b : null; };
    const dock = shown(document.getElementById("mac-dock"));
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const toasts = [...document.querySelectorAll("#toasts .toast")].map(shown).filter(Boolean);
    const scroller = document.getElementById("sc-scroll");
    return {
      mid: (r.top + r.height / 2 - view.top) / view.height,
      inside: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      bottomGap: Math.round(view.bottom - r.bottom),
      covered,
      dockClear: !dock || dock.top >= innerHeight - 1 || r.bottom <= dock.top + 1,
      toastOver: toasts.filter((t) => overlaps(t, r)).length,
      talkRow: !!shown(document.getElementById("vt-bar")),
      wide: document.documentElement.scrollWidth <= innerWidth + 1,
      boxScrolls: box.scrollHeight > box.clientHeight + 1,
      pageScrolls: document.getElementById("view").scrollHeight > document.getElementById("view").clientHeight + 1,
      threadScrolls: scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY),
    };
  });
}
async function emptyPage(page) {
  return page.evaluate(() => ({
    hello: document.querySelector("#view .chat2 .cb-hello")?.textContent,
    helloShown: document.querySelector("#view .chat2 .cb-hello")?.getBoundingClientRect().height > 0,
    chips: [...document.querySelectorAll("#cb-make [data-cb-make]")].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.replace(/^\W+/u, "").trim()),
    chipsUnder: document.getElementById("cb-make").getBoundingClientRect().top >= document.getElementById("cb-box").getBoundingClientRect().bottom - 1,
    helloOver: document.querySelector("#view .chat2 .cb-hello").getBoundingClientRect().bottom <= document.getElementById("cb-box").getBoundingClientRect().top + 1,
    row: [...document.querySelectorAll("#cb-row > :not(.cb-pop-wrap), #cb-row > .cb-pop-wrap > button")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.id || e.className),
    rowLines: (() => { const mids = [...document.querySelectorAll("#cb-row > :not(.cb-pop-wrap), #cb-row > .cb-pop-wrap > button")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }); return Math.max(...mids) - Math.min(...mids) < 8 ? 1 : 2; })(),
  }));
}
// The conversation: bubbles on the right and plain answers in order, the icon row and Make changes under each answer.
async function threadState(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll("#sc-thread .sc-me:not([hidden]), #sc-thread .sc-ai:not([hidden])")];
    const col = document.querySelector("#view .chat2 .sc-col").getBoundingClientRect();
    const sc = document.getElementById("sc-scroll");
    return {
      kinds: items.map((e) => (e.classList.contains("sc-me") ? "me" : "ai")),
      tops: items.map((e) => e.getBoundingClientRect().top + sc.scrollTop),
      bubblesRight: items.filter((e) => e.classList.contains("sc-me")).every((e) => { const r = e.getBoundingClientRect(); return Math.abs(r.right - col.right) < 3 && r.width < col.width * 0.9 && parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 12; }),
      plain: items.filter((e) => e.classList.contains("sc-ai")).map((e) => { const c = getComputedStyle(e.querySelector(".sc-card")); return c.borderTopWidth === "0px" && /rgba\(0, 0, 0, 0\)|transparent/.test(c.backgroundColor); }),
      // the dot between the parts is drawn by the style (".sc-who span::before")
      labels: items.filter((e) => e.classList.contains("sc-ai")).map((e) => [...e.querySelector(".sc-who").children].map((c) => c.textContent.trim()).filter(Boolean).join(" · ")),
      acts: [...document.querySelectorAll("#sc-thread .sc-acts")].map((a) => ({ icons: [...a.querySelectorAll(".cb-ic")].map((b) => `${b.getAttribute("aria-label")}|${b.title}`), change: a.querySelector("[data-sc-act='change']")?.textContent.trim() || "" })),
      colW: Math.round(col.width),
    };
  });
}

test("unit: the greeting, the make chips, every mode, the icon buttons and the note have plain words", () => {
  assert.equal(chatGreeting(""), "What can I help with?");
  assert.equal(chatGreeting("Chris Magee"), "What can I help with, Chris?");
  assert.deepEqual(MAKE_CHIPS.map((c) => c.label), ["Website", "Image", "Video", "Campaign", "Spreadsheet", "Document", "More"]);
  assert.deepEqual(CHAT_MODES.map((m) => m.label), ["Auto team", "Single", "Council", "Mission", "Research", "Second opinion"]);
  assert.deepEqual(ANSWER_BUTTONS.map((b) => b.label), [...ICONS, "Make changes"]);
  assert.equal(CHAT_NOTE, "Meldmind picks the best AI. Free AIs go first. Ctrl+Enter sends.");
  const em = new RegExp(String.fromCharCode(0x2014));
  for (const f of ["web/simple-ui.js", "web/chat.css", "web/expert-chat.css", "web/app.js", "web/features/layout.js", "web/mac/parts/expert.js", "web/momentum-ui.js", "web/features/voice-talk.js"]) {
    assert.doesNotMatch(read(...f.split("/")), em, `${f} has no em-dash`);
    assert.doesNotMatch(read(...f.split("/")), /\x08/, `${f} has no backspace byte`);
  }
  // both pages draw the same box and answer block
  const app = read("web", "app.js");
  assert.equal((app.match(/\$\{chatBoxHtml\((true|false)\)\}/g) || []).length, 2);
  assert.equal((app.match(/\$\{chatAnswerHtml\((true|false), mainOpen, mainAll\)\}/g) || []).length, 2);
});

for (const mode of ["simple", "expert"]) {
  for (const theme of ["light", "dark"]) {
    test(`browser ${mode} ${theme} at 1366 x 800 and 390 x 844: the greeting and box mid page, then a pinned box under a scrolling conversation`, { skip, timeout: RUN * 3 }, async () => {
      const t = await boot({ mode, theme });
      if (!t) return;
      try {
        const { page } = t;
        // ---- a new chat: the greeting, the box in the middle third, the make chips under it, one row in the box ----
        for (const [w, h] of [[1366, 800], [390, 844]]) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForFunction((w) => innerWidth === w, w, { timeout: WAIT });
          await page.waitForTimeout(300);
          const e = await emptyPage(page);
          assert.equal(e.hello, "What can I help with?");
          assert.ok(e.helloShown && e.helloOver && e.chipsUnder, JSON.stringify(e));
          assert.deepEqual(e.chips, ["Website", "Image", "Video", "Campaign", "Spreadsheet", "Document", "More"].slice(0, e.chips.length), `${w}: chips ${e.chips}`);
          assert.ok(e.chips.length >= (w > 800 ? 7 : 3), `${w}: chips ${e.chips}`);
          for (const id of ["cb-add", "sc-team", "cc-freeonly-wrap", "cb-more", "vo-mic", "go"]) assert.ok(e.row.includes(id), `${w}: ${id} in the box row: ${e.row}`);
          assert.equal(e.rowLines, 1, `${w}: one bottom row in the box`);
          const b = await boxState(page);
          assert.ok(b.mid > 1 / 3 && b.mid < 2 / 3, `${w}: box centre at ${b.mid.toFixed(2)} of the page height`);
          assert.ok(b.inside && !b.covered.length && b.dockClear && b.wide && !b.talkRow, `${w}: ${JSON.stringify(b)}`);
          if (theme === "light" && mode === "simple" && w > 800) await shot(page, "simple-empty");
          if (theme === "light" && mode === "simple" && w < 800) await shot(page, "390-simple-empty");
        }
        // ---- a demo answer and a follow-up in the same chat ----
        await page.setViewportSize({ width: 1366, height: 800 });
        await page.waitForFunction(() => innerWidth === 1366, null, { timeout: WAIT });
        if (mode === "expert") { await page.click("#sc-team"); await page.click("#run-mode [data-m='single']"); }
        await send(page, "Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4.");
        const first = await page.evaluate(() => window.CC.S.live.id);
        await send(page, "Make it shorter and take out the families line.");
        for (const [w, h] of [[1366, 800], [390, 844]]) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForFunction((w) => innerWidth === w, w, { timeout: WAIT });
          await page.waitForTimeout(400);
          const th = await threadState(page);
          assert.equal(await page.evaluate(() => window.CC.S.live.id), first, "the follow-up stayed in the same chat");
          assert.deepEqual(th.kinds, ["me", "ai", "me", "ai"]);
          for (let i = 1; i < th.tops.length; i++) assert.ok(th.tops[i] > th.tops[i - 1], `in order ${JSON.stringify(th.tops)}`);
          assert.ok(th.bubblesRight, "your messages are rounded bubbles on the right");
          assert.deepEqual(th.plain, [true, true], "answers are plain text, no card border");
          for (const l of th.labels) assert.match(l, /^Meldmind · \S/, `label "${l}"`);
          assert.deepEqual(th.acts.map((a) => a.icons), [ICONS.map((x) => `${x}|${x}`), ICONS.map((x) => `${x}|${x}`)], "the icon row has labels and tooltips");
          for (const a of th.acts) assert.match(a.change, /^Make changes/);
          if (w > 800) assert.ok(th.colW <= 780 && th.colW >= 640, `column ${th.colW}`);
          // the box is pinned at the bottom; only the conversation scrolls
          const b = await boxState(page);
          assert.ok(b.inside && b.bottomGap < 60 && !b.covered.length && b.dockClear && !b.toastOver && !b.talkRow && b.wide, `${w}: ${JSON.stringify(b)}`);
          assert.ok(b.threadScrolls && !b.pageScrolls && !b.boxScrolls, `${w}: only the conversation scrolls ${JSON.stringify(b)}`);
          // a long message: the text area grows to about 8 lines, then scrolls inside itself; the box never does
          await page.fill("#orders", Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a long message for the box`).join("\n"));
          await page.waitForTimeout(150);
          const grow = await page.evaluate(() => { const box = document.getElementById("cb-box"), ta = document.getElementById("orders"); const lh = parseFloat(getComputedStyle(ta).lineHeight); return { box: [box.scrollHeight, box.clientHeight], lines: ta.clientHeight / lh, inner: ta.scrollHeight > ta.clientHeight, view: document.getElementById("view").scrollHeight - document.getElementById("view").clientHeight }; });
          assert.equal(grow.box[0], grow.box[1], `${w}: the box's own scrollHeight equals its clientHeight ${JSON.stringify(grow)}`);
          assert.ok(grow.lines >= 7 && grow.lines <= 9, `${w}: about 8 lines (${grow.lines.toFixed(1)})`);
          assert.ok(grow.inner && grow.view <= 1, `${w}: ${JSON.stringify(grow)}`);
          const b2 = await boxState(page);
          assert.ok(b2.inside && !b2.covered.length && b2.dockClear, `${w} with a long message: ${JSON.stringify(b2)}`);
          await page.fill("#orders", "");
          if (theme === "light" && mode === "simple" && w > 800) await shot(page, "simple-in-use");
          if (theme === "light" && mode === "expert" && w < 800) await shot(page, "390-expert-in-use");
          if (theme === "dark" && w > 800) await shot(page, `dark-${mode}-in-use`);
          if (theme === "light" && mode === "expert" && w > 800) await shot(page, "light-expert-in-use");
        }
        // no "done" toast covered the answer on the chat page
        const toasts = await page.evaluate(() => window.__toasts);
        assert.deepEqual(toasts.filter((x) => /done|ready/i.test(x)), [], `toasts: ${toasts}`);
        assert.deepEqual(t.errors, []);
      } finally { await t.close(); }
    });
  }
}

test("browser Expert 1366 x 800: the mode menu (with Priority and When), Free only, Send becomes Stop on a Mission, the working line and its steps", { skip, timeout: RUN * 3 }, async () => {
  const t = await boot({ mode: "expert" });
  if (!t) return;
  try {
    const { page } = t;
    // the mode menu holds every mode, Priority and When; a pick switches the mode and closes it
    await page.click("#sc-team");
    await page.waitForSelector("#cb-menu:not([hidden])", { timeout: WAIT });
    const menu = await page.evaluate(() => ({ modes: [...document.querySelectorAll("#cb-menu #run-mode button")].map((b) => b.textContent.replace(/\s+/g, " ").trim()), priority: !!document.querySelector("#cb-menu #cost-mode"), when: !!document.querySelector("#cb-menu #when-mode"), expanded: document.getElementById("sc-team").getAttribute("aria-expanded") }));
    assert.deepEqual(menu.modes, ["Auto team", "Single", "Council", "Mission", "Research", "Second opinion"]);
    assert.ok(menu.priority && menu.when && menu.expanded === "true", JSON.stringify(menu));
    await page.selectOption("#cost-mode", "quality");
    assert.equal(await page.evaluate(() => window.CC.S.costMode), "quality");
    await page.selectOption("#cost-mode", "balanced");
    await page.click("#run-mode [data-m='council']");
    await page.waitForFunction(() => window.CC.S.cmdMode === "council" && document.getElementById("cb-menu").hidden, null, { timeout: WAIT });
    assert.match(await page.textContent("#sc-team"), /Council mode/);
    assert.equal(await page.getAttribute("#run-mode [data-m='council']", "aria-pressed"), "true");
    // Esc closes the menu
    await page.click("#sc-team");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.getElementById("cb-menu").hidden), true);
    // Free only toggles (the same setting as Settings)
    const was = await page.evaluate(() => !!window.CC.S.freeOnly?.on);
    await page.click("#cc-freeonly-wrap");
    await page.waitForFunction((w) => !!window.CC.S.freeOnly?.on !== w && document.getElementById("cc-freeonly").checked !== w, was, { timeout: WAIT });
    await page.click("#cc-freeonly-wrap");
    await page.waitForFunction((w) => !!window.CC.S.freeOnly?.on === w, was, { timeout: WAIT });
    // More options ("...") holds Preview route, Prompts, the project and the SSN line
    await page.click("#cb-more");
    await page.waitForSelector("#cb-more-pop:not([hidden])", { timeout: WAIT });
    for (const sel of ["#preview", "#proj", "#mask-line", "#cb-talk", "#cb-hands"]) assert.ok(await page.isVisible(`#cb-more-pop ${sel}`), `${sel} is under More options`);
    await page.keyboard.press("Escape");
    // panel 0438 item 2: the route preview closes (its x, a change in the box, or Send)
    await page.fill("#orders", "Write a short welcome email for new bakery customers");
    await page.click("#cb-more");
    await page.click("#cb-more-pop #preview");
    await page.waitForFunction(() => { const r = document.getElementById("route"); return r.style.display !== "none" && /Best fit|Classifying|none available/.test(r.textContent); }, null, { timeout: WAIT });
    await page.click("#route [data-route-close]");
    assert.equal(await page.evaluate(() => document.getElementById("route").style.display), "none");
    await page.click("#cb-more");
    await page.click("#cb-more-pop #preview");
    await page.waitForFunction(() => document.getElementById("route").style.display !== "none", null, { timeout: WAIT });
    await page.type("#orders", " today");
    assert.equal(await page.evaluate(() => document.getElementById("route").style.display), "none", "typing closes it");
    await page.fill("#orders", "");
    // a Mission: Send becomes Stop, one working line that opens to the steps with Pause, Stop and Open live view
    await page.click("#sc-team");
    await page.click("#run-mode [data-m='mission']");
    await page.fill("#orders", "Plan the Instagram week for our new product launch: 5 post ideas, captions, and the best times to post.");
    await page.click("#go");
    await page.waitForSelector("#cc-readers-go", { timeout: RUN });
    await page.click("#cc-readers-go");
    await page.waitForFunction(() => window.CC.S.live?.kind === "mission" && Object.keys(window.CC.S.live.tasks || {}).length > 1 && ["planning", "running", "assembling"].includes(window.CC.S.live.status), null, { timeout: RUN });
    await page.waitForFunction(() => document.getElementById("go").hidden && document.getElementById("stop-chat").style.display !== "none", null, { timeout: WAIT });
    const mid = await page.evaluate(() => ({
      stop: document.getElementById("stop-chat").getAttribute("aria-label"),
      line: document.getElementById("cb-work-text").textContent,
      steps: document.getElementById("ex-answer").dataset.steps,
      acts: getComputedStyle(document.querySelector("#ex-answer > .sc-acts")).display,
    }));
    assert.equal(mid.stop, "Stop");
    assert.match(mid.line, /^Mission · \d+ AIs · step \d+ of \d+ · \$[\d.]+ so far$/);
    assert.equal(mid.steps, "fold", "the steps wait behind the line");
    assert.equal(mid.acts, "none", "the answer buttons wait until it is done");
    await page.click("#ex-steps-btn");
    await page.waitForFunction(() => document.getElementById("ex-answer").dataset.steps === "open" && document.querySelector("#ex-answer #tasks .task")?.getBoundingClientRect().height > 0, null, { timeout: WAIT });
    assert.ok(await page.isVisible("#ex-answer #ops-panel #ex-live"), "Open live view is inside the steps");
    assert.ok(await page.isVisible("#ops-pause") || await page.isVisible("#abort"), "Pause or Stop is inside the steps");
    await shot(page, "expert-mid-mission");
    await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status), null, { timeout: RUN });
    await page.waitForFunction(() => !document.getElementById("go").hidden && !document.getElementById("go").disabled && document.querySelector("#ex-answer > .sc-acts")?.getBoundingClientRect().height > 0, null, { timeout: WAIT });
    assert.match(await page.textContent("#cb-work-text"), /^Mission · .*\d+ steps/);
    const b = await boxState(page);
    assert.ok(b.inside && !b.covered.length && b.dockClear && !b.toastOver, JSON.stringify(b));
    const toasts = await page.evaluate(() => window.__toasts);
    assert.deepEqual(toasts.filter((x) => /done|ready/i.test(x)), [], `toasts: ${toasts}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser Simple 1366 x 800: the mode menu, the mic and Ctrl+Space, no Talk bar row, History by day, a Team task finishes with no done toast", { skip, timeout: RUN * 3 }, async () => {
  const t = await boot({ mode: "simple" });
  if (!t) return;
  try {
    const { page, api } = t;
    // the mode menu switches the Simple run mode
    await page.click("#sc-team");
    const modes = await page.$$eval("#simple-run-mode button", (b) => b.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
    assert.deepEqual(modes.map((m) => m.replace(/ Pro$/, "")), ["Auto team", "Single", "Council", "Mission", "Research", "Second opinion"]);
    await page.click("#simple-run-mode [data-m='single']");
    await page.waitForFunction(() => window.CC.S.simpleRunMode === "single" && document.getElementById("cb-menu").hidden, null, { timeout: WAIT });
    assert.match(await page.textContent("#sc-team"), /Single mode/);
    // the mic is in the box; the Talk bar row is gone from the chat page and Ctrl+Space still talks
    assert.equal(await page.getAttribute("#vo-mic", "aria-label"), "Talk instead of typing");
    assert.equal(await page.evaluate(() => { const b = document.getElementById("vt-bar"); return !!b && b.getBoundingClientRect().height > 0 && getComputedStyle(b).display !== "none"; }), false, "no Talk bar row on the chat page");
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => new MediaStream(); });
    await page.click("#orders");
    await page.keyboard.down("Control"); await page.keyboard.down("Space");
    await page.waitForFunction(() => window.CC.voice?.ptt === true && window.CC.voice.isTalking(), null, { timeout: WAIT });
    await page.keyboard.up("Space"); await page.keyboard.up("Control");
    await page.waitForFunction(() => window.CC.voice.ptt === false, null, { timeout: WAIT });
    // Talk out loud in More options follows the same switch
    await page.click("#cb-more");
    await page.waitForFunction(() => document.getElementById("cb-talk")?.getAttribute("aria-pressed") === "true", null, { timeout: WAIT });
    await page.click("#cb-talk");
    await page.waitForFunction(() => !window.CC.voice.isTalking(), null, { timeout: WAIT });
    await page.keyboard.press("Escape");
    // History in the sidebar, grouped by day
    await send(page, "Write a short thank-you note for a customer who bought a cake");
    await page.waitForFunction(() => [...document.querySelectorAll("#side-recent .side-day")].some((d) => d.textContent === "Today") && document.querySelector("#side-recent .side-chat"), null, { timeout: WAIT });
    const days = await page.$$eval("#side-recent .side-day", (d) => d.map((x) => x.textContent));
    assert.ok(days.every((d) => ["Pinned", "Today", "Yesterday", "Earlier"].includes(d)), JSON.stringify(days));
    assert.deepEqual(await page.$$eval("#cc-side .side-nav .side-item", (b) => b.map((x) => x.textContent.trim().replace(/^\W+/u, ""))), ["Chat", "Make something", "Team", "Projects", "MindMedia"]);
    // panel 0438 item 4: Make changes > All options lists each action once
    await page.click("#simple-answer > .sc-acts [data-sc-act='change']");
    await page.waitForFunction(() => !document.getElementById("sc-changes").hidden && !!document.querySelector("#sc-changes #cc-check"), null, { timeout: WAIT });
    await page.click("#sc-changes [data-sc-all]");
    await page.waitForFunction(() => document.getElementById("sc-changes").classList.contains("sc-all"), null, { timeout: WAIT });
    await page.waitForTimeout(600);
    const all = await page.evaluate(() => [...document.querySelectorAll("#sc-changes button, #sc-changes summary")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : true); }).map((e) => (e.textContent || e.getAttribute("aria-label") || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean));
    const repeats = all.filter((x, i) => all.indexOf(x) !== i);
    assert.deepEqual(repeats, [], `All options shows each action once (${all.length} controls): ${all.join(" | ")}`);
    console.log(`All options: ${all.length} controls`);
    await page.click("#sc-changes [data-sc-all]");
    await page.click("#simple-answer > .sc-acts [data-sc-act='change']");
    // panel 0438 item 3: a new subject starts a new chat (a new History row); a reply that points back stays in it
    const before = await page.evaluate(() => window.CC.S.live.id);
    await send(page, "Plan a game night for Friday with board games and snacks");
    const fresh = await page.evaluate(() => window.CC.S.live.id);
    assert.notEqual(fresh, before, "a new subject is a new chat");
    await send(page, "Make it shorter");
    assert.equal(await page.evaluate(() => window.CC.S.live.id), fresh, "a reply that points back stays in the chat");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#sc-turns .sc-reply").length), 1);
    // a task given to a Team agent: no "done" toast when it finishes (the desk shows it), and the chat stays as it was
    const chatId = await page.evaluate(() => window.CC.S.live.id);
    await page.evaluate(() => { window.__toasts.length = 0; });
    const a = await api("/team/assign", { body: { agentId: "emp-social-content", text: "Write 3 posts for Valentine's week for my bakery" } });
    const id = a.json?.task?.id;
    assert.ok(id, JSON.stringify(a.json));
    await page.waitForFunction(async (id) => { const r = await window.CC.api(`/team/tasks/${id}`); return ["review", "done", "failed"].includes(r.task?.status); }, id, { timeout: RUN, polling: 500 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ toasts: window.__toasts, live: window.CC.S.live.id }));
    assert.deepEqual(after.toasts.filter((x) => /done|ready/i.test(x)), [], `toasts: ${after.toasts}`);
    assert.equal(after.live, chatId, "the Team task did not take over the chat");
    const b = await boxState(page);
    assert.ok(b.inside && !b.covered.length && b.dockClear && !b.toastOver, JSON.stringify(b));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
