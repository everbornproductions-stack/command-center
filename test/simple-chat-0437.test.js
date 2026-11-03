// 0.4.37 (Chris, 2026-11-01: "Why does simple mode not look like expert mode when you click on chat? Expert mode's
// interface is a lot cleaner."): the Simple Chat page is one centred column on a flat background. The question is a
// bubble, each answer a card with exactly Copy, Try again, Make changes and Save as file under it, the follow-ups stay
// in the same chat, the answer check sits inside the card, and the chat box is pinned at the bottom above the Talk bar.
// The old Next bar and More actions wait behind Make changes. Approved mockup: meldmind-dogfood/mockups/simple-chat-0437.html.
// Real server in demo mode (practice AIs, no keys, nothing sent) and headless Chrome via bootMac; skips only when no
// Chrome is installed. Windows rules: one server and one browser at a time, real waits, every test closes what it opens.
// Screenshots go to CC_SHOTS when set (the 0.4.37 build kept them in meldmind-dogfood/simple-chat-0437-*.png).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { ANSWER_BUTTONS, CHAT_EMPTY, REPLY_CHANGES, answerFileName } from "../web/simple-ui.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(180000);
const ROOT = path.join(import.meta.dirname, "..");
const SHOTS = process.env.CC_SHOTS || "";
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer{display:none!important}";
// 0.5.0 (chat like the Claude app): icon buttons (named for screen readers) then Make changes
const LABELS = ["Copy", "Try again", "Save as file", "Give to an agent", "Make changes"];

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
}
// Mac look, Simple, practice AIs on, on the Chat page (the dock's Chat, the same as "Just chat").
async function boot({ width, height, theme = "light" }) {
  const t = await bootMac({ width, height, mode: "simple", theme });
  if (!t) return null;
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: POPUPS });
    await t.page.evaluate(() => { window.CC.go("command"); window.CC.mac.bus.emit("chat"); });
    await t.page.waitForFunction(() => !!document.querySelector("#view .sc-chat #orders") && document.body.dataset.macFlow === "off", null, { timeout: WAIT });
    return t;
  } catch (e) { await t.close(); throw e; }
}
// Type and press Send like a person (a real click). The second one goes on in the same chat.
async function send(page, text) {
  const before = await page.evaluate(() => ({ id: window.CC.S.live?.id || "", n: document.querySelectorAll("#sc-turns .sc-reply").length }));
  await page.fill("#orders", text);
  await page.click("#go");
  await page.waitForFunction((b) => (window.CC.S.live?.id && window.CC.S.live.id !== b.id) || document.querySelectorAll("#sc-turns .sc-reply").length > b.n, before, { timeout: RUN });
  await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !window.CC.S.live?.replying, null, { timeout: RUN });
  await page.waitForFunction(() => [...document.querySelectorAll("#view .sc-acts")].every((a) => a.getBoundingClientRect().height > 0), null, { timeout: WAIT });
}
const rect = (page, sel) => page.evaluate((sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden" };
}, sel);
// The chat box: on screen, at the bottom, and the top element at its corners and centre (nothing over it).
async function boxClear(page) {
  return page.evaluate(() => {
    const box = document.querySelector("#view .sc-chat .sc-box");
    const r = box.getBoundingClientRect();
    const pts = [[r.left + 12, r.top + 12], [r.right - 12, r.top + 12], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 12, r.bottom - 10], [r.right - 12, r.bottom - 10]];
    const covered = pts.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return !hit || !box.contains(hit); }).map(([x, y]) => { const hit = document.elementFromPoint(x, y); return `${Math.round(x)},${Math.round(y)}: ${hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none"}`; });
    const shown = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).display !== "none" ? b : null; };
    const talk = shown(document.getElementById("vt-bar"));
    const dock = shown(document.getElementById("mac-dock"));
    const toasts = [...document.querySelectorAll("#toasts .toast")].map(shown).filter(Boolean);
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return {
      inside: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      lowHalf: r.top > innerHeight * 0.45,
      // 0.5.0: on a new chat the box sits mid page (its centre in the middle third)
      mid: (r.top + r.height / 2) > innerHeight / 3 && (r.top + r.height / 2) < innerHeight * 2 / 3,
      covered,
      aboveTalk: !talk || r.bottom <= talk.top + 1,
      aboveDock: !dock || dock.top >= innerHeight - 1 || r.bottom <= dock.top + 1,
      toastOver: toasts.filter((t) => overlaps(t, r)).length,
    };
  });
}
// The old bars do not stack over the chat: no Next bar, Finish bar, project row or resume banner above the column.
async function nothingAbove(page) {
  return page.evaluate(() => {
    const shown = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== "none";
    const col = document.querySelector(".view-col");
    const above = [];
    for (const el of col.children) { if (el.id === "view") break; if (shown(el) && !el.matches("#notices, .notices")) above.push(el.id || el.className); }
    const mm = document.getElementById("mmbar");
    return {
      above,
      nextOutside: !!mm && shown(mm) && !mm.closest("#sc-changes"),
      resumeBanner: [...document.querySelectorAll(".mm-resume")].filter(shown).length,
    };
  });
}
// The thread in one column, in order: question 1, answer 1, question 2, answer 2.
async function threadOrder(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll("#sc-thread .sc-me:not([hidden]), #sc-thread .sc-ai:not([hidden])")];
    const col = document.querySelector(".sc-col").getBoundingClientRect();
    return {
      kinds: items.map((e) => (e.classList.contains("sc-me") ? "me" : "ai")),
      texts: items.map((e) => e.innerText.slice(0, 60)),
      tops: items.map((e) => e.getBoundingClientRect().top + document.getElementById("sc-scroll").scrollTop),
      inCol: items.every((e) => { const r = e.getBoundingClientRect(); return r.left >= col.left - 1 && r.right <= col.right + 1; }),
      colW: col.width,
      colMid: col.left + col.width / 2,
      scroll: document.getElementById("sc-scroll").getBoundingClientRect(),
      acts: [...document.querySelectorAll("#sc-thread .sc-acts")].map((a) => [...a.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.textContent.replace(/\s*▾$/, "").trim())),
      runId: window.CC.S.live?.id,
      thread: (window.CC.S.live?.mission?.thread || []).length,
    };
  });
}

test("unit: the four answer buttons, the empty page words, the quick changes and the file name", () => {
  assert.deepEqual(ANSWER_BUTTONS.map((b) => b.label), LABELS);
  assert.equal(CHAT_EMPTY.title, "Ask anything");
  assert.equal(CHAT_EMPTY.chips.length, 3);
  assert.ok(REPLY_CHANGES.length >= 3);
  assert.equal(answerFileName("Write a short open house flyer for 12 Oak St", "Open house"), "write-a-short-open-house-flyer.md");
  assert.equal(answerFileName("a backup script", "Here:\n```python\nprint(1)\n```\n"), "a-backup-script.py");
  assert.equal(answerFileName("", "<!doctype html><html><body>hi</body></html>"), "answer.html");
  for (const f of ["web/simple-ui.js", "web/chat.css", "web/app.js", "web/features/layout.js", "web/momentum-ui.js"]) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    const words = f.endsWith(".css") ? "" : text.slice(text.indexOf("CHAT_EMPTY"), text.indexOf("CHAT_EMPTY") + 2000);
    assert.doesNotMatch(words, new RegExp(String.fromCharCode(0x2014)), `${f} user words have no em-dash`);
  }
});

test("browser 1366 x 800: empty Chat page, two answers in one column, four buttons, Make changes, Save as file, Expert unchanged", { skip, timeout: RUN * 3 }, async () => {
  const t = await boot({ width: 1366, height: 800 });
  if (!t) return;
  try {
    const { page } = t;
    // ---- the empty page: a short heading, one line, three chips; none of the old make tiles or cards ----
    // 0.5.0 (chat like the Claude app): a greeting, the box mid page and the make chips as one row under it
    const empty = await page.evaluate(() => ({
      hello: document.querySelector("#view .sc-chat #sc-hello")?.textContent,
      chips: [...document.querySelectorAll("#view #cb-make [data-cb-make]")].filter((b) => b.getBoundingClientRect().height > 0).length,
      old: ["[data-sc-chip]", "#sc-ideas", "#sc-media", "#sc-projects", "#simple-home", "#hh-picks .hh-pick"].filter((s) => { const e = document.querySelector(`#view ${s}`); return e && e.getBoundingClientRect().height > 0; }),
      makeWords: /What do you want to make/.test(document.getElementById("view").innerText),
      side: [...document.querySelectorAll("#cc-side .side-nav .side-item")].map((b) => b.textContent.trim()),
      lit: document.querySelector("#cc-side .side-item.active")?.textContent.trim(),
    }));
    assert.equal(empty.hello, "What can I help with?");
    assert.equal(empty.chips, 7);
    assert.deepEqual(empty.old, [], "no old make chips, ideas, Made recently or Projects cards on the Chat page");
    assert.equal(empty.makeWords, false);
    assert.deepEqual(empty.side.map((s) => s.replace(/^\W+/u, "")), ["Chat", "Make something", "Team", "Projects", "MindMedia"]);
    assert.match(empty.lit, /Chat$/);
    // a make chip starts the existing make path (the Mac look's steps); nothing is sent
    await page.click("#view #cb-make [data-cb-make='image']");
    await page.waitForFunction(() => document.body.dataset.macFlow === "on" && window.CC.mac.flow.state.path === "image", null, { timeout: WAIT });
    assert.equal(await page.evaluate(() => window.CC.S.live?.id || ""), "");
    await page.evaluate(() => window.CC.mac.bus.emit("chat"));
    await page.waitForFunction(() => document.body.dataset.macFlow === "off" && !!document.querySelector("#view .sc-chat #orders"), null, { timeout: WAIT });
    assert.deepEqual(await nothingAbove(page), { above: [], nextOutside: false, resumeBanner: 0 });
    const box0 = await boxClear(page);
    assert.ok(box0.inside && box0.mid && !box0.covered.length && box0.aboveTalk && box0.aboveDock, JSON.stringify(box0));
    await shot(page, "simple-chat-0437-1366-empty.png");

    // ---- two answers in the same chat ----
    await send(page, "Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4.");
    const first = await page.evaluate(() => window.CC.S.live.id);
    await send(page, "Make it shorter and take out the families line.");
    const th = await threadOrder(page);
    assert.equal(th.runId, first, "the follow-up stayed in the same chat");
    assert.equal(th.thread, 2, "the run keeps the follow-up and its answer in its thread");
    assert.deepEqual(th.kinds, ["me", "ai", "me", "ai"]);
    assert.match(th.texts[0], /open house flyer/);
    assert.match(th.texts[2], /shorter/);
    for (let i = 1; i < th.tops.length; i++) assert.ok(th.tops[i] > th.tops[i - 1], `in order ${JSON.stringify(th.tops)}`);
    assert.ok(th.inCol, "every message is inside the one column");
    assert.ok(th.colW <= 800 && th.colW >= 600, `column is ${th.colW} px`);
    assert.ok(Math.abs(th.colMid - (th.scroll.left + th.scroll.width / 2)) < 30, "the column is centred");
    assert.deepEqual(th.acts, [LABELS, LABELS], "each answer has exactly Copy, Try again, Make changes, Save as file");
    assert.deepEqual(await nothingAbove(page), { above: [], nextOutside: false, resumeBanner: 0 });
    const box1 = await boxClear(page);
    assert.ok(box1.inside && box1.lowHalf && !box1.covered.length && box1.aboveTalk && box1.aboveDock && !box1.toastOver, JSON.stringify(box1));
    // the newest answer's buttons are in view above the box
    const lastActs = await page.evaluate(() => { const a = [...document.querySelectorAll("#sc-thread .sc-acts")].pop().getBoundingClientRect(); const b = document.querySelector("#view .sc-chat .sc-box").getBoundingClientRect(); return { top: a.top, bottom: a.bottom, box: b.top }; });
    assert.ok(lastActs.bottom <= lastActs.box && lastActs.top > 40, JSON.stringify(lastActs));
    // the flat background: the page behind the column is one solid colour
    const bg = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".view-col")); return { color: cs.backgroundColor, image: cs.backgroundImage }; });
    assert.equal(bg.image, "none");
    assert.doesNotMatch(bg.color, /rgba\(.*, 0(\.\d+)?\)$|color\(.* \/ 0\.\d+\)/, `solid background, got ${bg.color}`);
    await shot(page, "simple-chat-0437-1366-in-use.png");

    // ---- Make changes reveals the old next actions (nothing deleted) ----
    assert.equal(await page.evaluate(() => document.getElementById("sc-changes").hidden), true);
    await page.click("#simple-answer > .sc-acts [data-sc-act='change']");
    await page.waitForFunction(() => !document.getElementById("sc-changes").hidden, null, { timeout: WAIT });
    await page.waitForFunction(() => !!document.querySelector("#sc-changes #mmbar [data-mm]"), null, { timeout: WAIT }).catch(() => {});
    // 0.4.38 (0.4.37 panel item 6): Make changes starts short; All options shows every other action in place
    await page.click("#sc-changes [data-sc-all]");
    await page.waitForFunction(() => document.getElementById("sc-changes").classList.contains("sc-all"), null, { timeout: WAIT });
    const changes = await page.evaluate(() => {
      const f = document.getElementById("sc-changes");
      const words = f.innerText;
      return {
        expanded: document.querySelector("#simple-answer > .sc-acts [data-sc-act='change']").getAttribute("aria-expanded"),
        words,
        next: !!f.querySelector("[data-feature='next-actions'] .na-bar, [data-feature='next-actions'] button"),
        finish: !!f.querySelector("[data-feature='finishpath'] [data-fp-good]"),
        versions: !!f.querySelector("#cc-v-change"),
        check: !!f.querySelector("#cc-check"),
        more: !!f.querySelector("details.answer-more"),
        momentum: !!f.querySelector("#mmbar"),
      };
    });
    assert.equal(changes.expanded, "true");
    assert.ok(changes.next, "the next actions bar is behind Make changes");
    assert.ok(changes.finish && /Looks good, Finish/.test(changes.words) && /Edit further/.test(changes.words), "Finish and Edit further");
    assert.ok(changes.versions && /Change this part/.test(changes.words), "Change this part");
    assert.ok(changes.check && /Double-check/.test(changes.words), "Double-check");
    assert.ok(changes.more, "More actions is still there, folded");
    assert.ok(changes.momentum && /Why these\?/.test(changes.words), "the Next bar moved behind Make changes");
    // a reply's Make changes offers quick changes that go on in the same chat
    await page.click("#sc-turns .sc-reply .sc-acts [data-sc-act='change']");
    await page.waitForFunction(() => !document.querySelector("#sc-turns .sc-reply .sc-changes").hidden, null, { timeout: WAIT });
    assert.match(await page.evaluate(() => document.querySelector("#sc-turns .sc-reply .sc-changes").innerText), /Make it shorter/);

    // ---- Save as file uses the named-file saver ----
    await page.click("#simple-answer > .sc-acts [data-sc-act='save']");
    await page.waitForFunction(() => [...document.querySelectorAll("#toasts .toast")].some((x) => /^Saved write-a-short-open-house-flyer/.test(x.textContent)), null, { timeout: WAIT });
    const saved = await t.api("/chat/save-file", { body: { runId: first, text: "Hello", name: "save-check.md" } });
    assert.equal(saved.status, 200, saved.text);
    assert.ok(fs.existsSync(saved.json.path), "the file is on the disk");
    assert.equal((await t.api("/chat/save-file", { body: { text: "", name: "x.md" } })).status, 400);
    assert.deepEqual(t.errors, []);

    // ---- Expert Command keeps its own page (0.4.38: its own chat, .ex-chat, with the run modes on its box) ----
    await page.click("#mac-expert");
    await page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: WAIT });
    await page.evaluate(() => window.CC.go("command"));
    await page.waitForFunction(() => !!document.querySelector("#view .ex-chat #run-mode"), null, { timeout: WAIT });
    const ex = await page.evaluate(() => ({ run: !!document.getElementById("run-mode"), orders: !!document.querySelector("#view .ex-chat .ex-box #orders"), deliv: !!document.getElementById("deliv-panel"), chat: !!document.querySelector("#view .sc-chat"), simpleAnswer: !!document.getElementById("simple-answer") }));
    assert.deepEqual(ex, { run: true, orders: true, deliv: false, chat: false, simpleAnswer: false });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser 1366 x 800: the answer check shows inside the answer card, under the answer text", { skip, timeout: RUN }, async () => {
  const t = await boot({ width: 1366, height: 800 });
  if (!t) return;
  try {
    const { page } = t;
    // A finished answer that breaks the rules (fair housing words and a promised credit result), drawn from a fake run.
    await page.evaluate(() => {
      const text = "**Open House This Saturday, 1 to 4 PM**\n\n12 Oak St, 3 bedrooms, 2 baths.\n\n- Bright kitchen\n- Perfect for young families, close to the park\n\nWe guarantee your credit score will go up 100 points with our lender.";
      const S = window.CC.S;
      S.live = { id: "s-fake0437", kind: "single", status: "done", agents: { x: { provider: "demo-nova", model: "nova-lite", text, done: true, role: "answer" } }, tasks: {}, mission: { id: "s-fake0437", kind: "single", prompt: "Write a short open house flyer", deliverable: text, status: "done", provider: "demo-nova", model: "nova-lite", thread: [] }, council: null, deliverable: text, primary: "x" };
      window.CC.render();
    });
    await page.waitForFunction(() => !!document.querySelector("#simple-answer .cc-answer-check"), null, { timeout: WAIT });
    const r = await page.evaluate(() => {
      const chk = document.querySelector("#simple-answer .cc-answer-check");
      const card = chk.closest(".sc-card");
      const md = card?.querySelector("#out-md");
      return { inCard: !!card, afterText: !!md && !!(md.compareDocumentPosition(chk) & Node.DOCUMENT_POSITION_FOLLOWING), inFold: !!chk.closest("#sc-changes"), shown: chk.getBoundingClientRect().height > 0, words: chk.innerText };
    });
    assert.ok(r.inCard, "inside the answer card");
    assert.ok(r.afterText, "under the answer text");
    assert.equal(r.inFold, false, "not behind Make changes");
    assert.ok(r.shown);
    assert.match(r.words, /Before you send this/);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser 390 x 844: one column, the chat box above the Talk bar and clear of the dock and toasts", { skip, timeout: RUN * 2 }, async () => {
  const t = await boot({ width: 390, height: 844 });
  if (!t) return;
  try {
    const { page } = t;
    await send(page, "Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4.");
    await send(page, "Make it shorter and take out the families line.");
    const th = await threadOrder(page);
    assert.deepEqual(th.kinds, ["me", "ai", "me", "ai"]);
    assert.ok(th.inCol);
    assert.deepEqual(th.acts, [LABELS, LABELS]);
    assert.deepEqual(await nothingAbove(page), { above: [], nextOutside: false, resumeBanner: 0 });
    const box = await boxClear(page);
    assert.ok(box.inside && box.lowHalf && !box.covered.length && box.aboveTalk && box.aboveDock && !box.toastOver, JSON.stringify(box));
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    assert.ok(wide, "no sideways scroll");
    await shot(page, "simple-chat-0437-390-in-use.png");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser 1366 x 800 dark: the in-use page reads right in the dark theme", { skip, timeout: RUN * 2 }, async () => {
  const t = await boot({ width: 1366, height: 800, theme: "dark" });
  if (!t) return;
  try {
    const { page } = t;
    await send(page, "Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4.");
    await send(page, "Make it shorter and take out the families line.");
    const c = await page.evaluate(() => {
      const card = getComputedStyle(document.querySelector("#simple-answer .sc-card"));
      const text = getComputedStyle(document.querySelector("#simple-answer #out-md"));
      const lum = (s) => { const m = s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
      return { card: lum(card.backgroundColor), text: lum(text.color) };
    });
    assert.ok(c.card < 0.2 && c.text > 0.8, `dark card ${c.card}, light text ${c.text}`);
    const box = await boxClear(page);
    assert.ok(box.inside && !box.covered.length && box.aboveTalk, JSON.stringify(box));
    await shot(page, "simple-chat-0437-dark-in-use.png");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
