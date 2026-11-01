// 0.4.31: Simple fixes from the 0.4.28 persona panel (meldmind-panel-0428/FIXES-0430.md items 1, 6 and 7).
// Real server in demo mode (practice AIs, nothing sent, no keys) and headless Chrome via bootMac; skips only when no
// Chrome is installed. Every "on screen" claim is an elementFromPoint hit test. Windows rules: one browser at a time,
// real waits (waitForFunction with generous deadlines), every test closes its browser and server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(90000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const HIDE = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer,.toasts{display:none!important}";

// Simple, Mac look, practice AIs on, every Mac part and feature loaded.
async function bootSimple({ width, height, theme = "dark", demo = true }) {
  const t = await bootMac({ width, height, mode: "simple", theme });
  if (!t) return null;
  try {
    if (demo) {
      assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
      await t.page.reload({ waitUntil: "domcontentloaded" });
    }
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: HIDE });
    await t.page.waitForFunction(() => document.body.dataset.ui === "simple" && !!document.querySelector("#mac-flow .mf-path"), null, { timeout: WAIT });
    return t;
  } catch (e) { await t.close(); throw e; }
}

// Inside the window and the top element at its centre (runs in the page).
function hitTest(sel) {
  const el = typeof sel === "string" ? document.querySelector(sel) : null;
  if (!el) return { sel, found: false };
  const r = el.getBoundingClientRect();
  const inside = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const top = !!hit && (hit === el || el.contains(hit));
  return { sel, found: true, inside, top, by: top ? "" : hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none", rect: [r.left, r.top, r.width, r.height].map(Math.round).join(",") };
}
const onScreen = (page, sel) => page.evaluate(hitTest, sel);

// The Finish button: the Next bar's Finish, else the finish pair under the answer.
const FINISH = "[data-feature='next-actions'] [data-na='finish'], [data-feature='finishpath'] [data-fp-good]";

// ---------- item 1: the folded box is one line and the answer's buttons come up above it ----------

for (const [width, height] of [[1366, 800], [1024, 768]]) {
  test(`item 1: Simple chat at ${width} x ${height}, after a long demo answer Copy, Try again and Finish are on top and the folded box is under 70 px`, { skip }, async () => {
    const t = await bootSimple({ width, height });
    try {
      await t.page.click("#mf-chat"); // Just chat instead
      await t.page.waitForSelector("#orders", { state: "visible", timeout: WAIT });
      await t.page.fill("#orders", "Plan a bake sale for Saturday with a full list of steps");
      await t.page.click("#go");
      await t.page.waitForFunction(() => !!window.CC.S.live?.id, null, { timeout: WAIT });
      await t.page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status), null, { timeout: RUN });
      await t.page.waitForSelector("#cc-copy-main", { timeout: WAIT });
      await t.page.waitForSelector("#cc-v-again", { timeout: WAIT });
      // The answer is taller than the room above the box (the case 0.4.28 left at its start).
      const tall = await t.page.evaluate(() => { const c = document.querySelector(".cmd.simple-chat"); return { card: Math.round(document.getElementById("simple-answer").getBoundingClientRect().height), room: c.clientHeight }; });
      assert.ok(tall.card > tall.room, `the answer is taller than the scroller ${JSON.stringify(tall)}`);
      // A slow PC draws the buttons and folds the box over a few seconds: wait, with a real deadline, until Copy, Try
      // again and Finish are all on top. The asserts below decide.
      await t.page.waitForFunction((sels) => sels.every((sel) => {
        const el = document.querySelector(sel);
        if (!el) return sel.includes("finish") || sel.includes("fp-good");
        const r = el.getBoundingClientRect();
        if (!(r.height > 0 && r.top >= 0 && r.bottom <= innerHeight)) return false;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (hit === el || el.contains(hit));
      }) && document.querySelector(".cmd.simple-chat")?.dataset.fold === "1", ["#cc-copy-main", "#cc-v-again", FINISH], { timeout: WAIT, polling: 250 }).catch(() => {});
      const g = await t.page.evaluate(() => {
        const c = document.querySelector(".cmd.simple-chat");
        const card = c.querySelector(".orders").getBoundingClientRect();
        const box = document.getElementById("orders").getBoundingClientRect();
        const go = document.getElementById("go").getBoundingClientRect();
        const shown = (id) => { const e = document.getElementById(id); return !!e && e.getBoundingClientRect().height > 0; };
        return { ui: document.body.dataset.ui, fold: c.dataset.fold || "", card: Math.round(card.height), boxH: Math.round(box.height), sameRow: Math.abs((go.top + go.bottom) / 2 - (box.top + box.bottom) / 2) < 12 && go.left > box.right - 2, mic: shown("vo-mic"), team: shown("sc-team"), free: shown("cc-freeonly-wrap") };
      });
      assert.equal(g.ui, "simple");
      assert.equal(g.fold, "1", "the chat box is folded after Send");
      assert.ok(g.card < 70, `the folded box card is under 70 px (${g.card}px)`);
      assert.ok(g.boxH <= 60, `the folded text box is one line (${g.boxH}px)`);
      assert.equal(g.sameRow, true, `Send sits beside the one-line box ${JSON.stringify(g)}`);
      assert.deepEqual([g.mic, g.team, g.free], [false, false, false], "Mic, the team picker and Free only fold away");
      for (const sel of ["#go", "#cc-copy-main", "#cc-v-again", FINISH]) {
        const r = await onScreen(t.page, sel);
        if (sel === FINISH && !r.found) continue; // the Finish flags are off on this build
        assert.ok(r.found && r.inside && r.top, `${width}: ${sel} is on screen and on top: ${JSON.stringify(r)}`);
      }
      // Clicking in the box opens it again with Mic and the team picker.
      await t.page.click("#orders");
      await t.page.keyboard.type("And one more");
      await t.page.waitForFunction(() => !document.querySelector(".cmd.simple-chat")?.dataset.fold, null, { timeout: WAIT });
      await t.page.waitForFunction(() => document.getElementById("vo-mic").getBoundingClientRect().height > 0, null, { timeout: WAIT });
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}

// ---------- item 6: Prompts "Use this" in Simple shows the words in the chat box ----------

test("item 6: Simple at 1366, Prompts What's new Use this opens the chat with the words in #orders and the cursor there; nothing is sent", { skip }, async () => {
  const t = await bootSimple({ width: 1366, height: 800, demo: false });
  try {
    await t.page.evaluate(() => { localStorage.removeItem("cc.prompts.whatsnew.open"); window.CC.go("prompts"); });
    await t.page.waitForSelector('#pp-whatsnew details[data-shelf="whatsnew"] [data-use]', { timeout: WAIT });
    const want = await t.page.evaluate(() => {
      const d = document.querySelector('#pp-whatsnew details[data-shelf="whatsnew"]');
      d.open = true;
      const b = d.querySelector("[data-use]");
      b.scrollIntoView({ block: "center" });
      b.dataset.testUse = "1";
      return (b.closest("div")?.querySelector("[title]")?.getAttribute("title") || "").trim();
    });
    const runsBefore = await t.page.evaluate(() => window.CC.S.live?.id || "");
    await t.page.click("[data-test-use]");
    await t.page.waitForFunction(() => {
      const o = document.getElementById("orders");
      if (!o || document.activeElement !== o || !o.value.trim()) return false;
      const r = o.getBoundingClientRect();
      if (!(r.width > 50 && r.height > 10 && r.top >= 0 && r.bottom <= innerHeight)) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === o || o.contains(hit));
    }, null, { timeout: WAIT, polling: 200 }).catch(() => {});
    const got = await t.page.evaluate(() => ({ view: window.CC.S.view, ui: document.body.dataset.ui, value: document.getElementById("orders")?.value || "", focused: document.activeElement?.id || "", paths: (() => { const p = document.getElementById("mf-paths"); return !!p && p.getBoundingClientRect().height > 0 && getComputedStyle(p).display !== "none"; })() }));
    assert.equal(got.ui, "simple");
    assert.equal(got.view, "command");
    assert.equal(got.focused, "orders", "the cursor is in the chat box");
    assert.ok(got.value.trim().length > 10, `the box holds the prompt: "${got.value.slice(0, 60)}"`);
    if (want) assert.ok(got.value.includes(want.slice(0, 40)), `the box holds this prompt's words ("${want.slice(0, 40)}")`);
    assert.equal(got.paths, false, "the 3-step picker gives way to the chat");
    const box = await onScreen(t.page, "#orders");
    assert.ok(box.inside && box.top, `#orders is visible and on top: ${JSON.stringify(box)}`);
    assert.equal(await t.page.evaluate(() => window.CC.S.live?.id || ""), runsBefore, "nothing was sent");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 7: all ten Simple choices on screen at 1366; the phone keeps the swipe row ----------

test("item 7: Simple at 1366 x 800 shows all ten choices, including the five file cards, without scrolling", { skip }, async () => {
  const t = await bootSimple({ width: 1366, height: 800, demo: false });
  try {
    const paths = await t.page.evaluate(() => [...document.querySelectorAll("#mac-flow .mf-path")].map((b) => b.dataset.path));
    assert.equal(paths.length, 10);
    for (const p of ["spreadsheet", "document", "slides", "script", "data"]) assert.ok(paths.includes(p), `${p} card exists (${paths.join(", ")})`);
    const cards = [];
    for (const p of paths) cards.push({ path: p, ...(await onScreen(t.page, `#mac-flow .mf-path[data-path="${p}"]`)) });
    const off = cards.filter((c) => !(c.inside && c.top));
    assert.deepEqual(off, [], "every card is on screen and on top");
    const arrows = await t.page.evaluate(() => [document.getElementById("mf-prev"), document.getElementById("mf-more-paths")].map((b) => !!b && !b.hidden && b.getBoundingClientRect().height > 0));
    assert.deepEqual(arrows, [false, false], "the paging arrows hide when every card fits");
    // A card still opens its path.
    await t.page.click('#mac-flow .mf-path[data-path="spreadsheet"]');
    await t.page.waitForFunction(() => window.CC.mac.flow.state.step === "style" && window.CC.mac.flow.state.path === "spreadsheet", null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("item 7: Simple at 390 keeps the swipe row and its arrows", { skip }, async () => {
  const t = await bootSimple({ width: 390, height: 844, demo: false });
  try {
    const g = await t.page.evaluate(() => { const row = document.getElementById("mf-paths"); return { scrolls: row.scrollWidth > row.clientWidth, overflowX: getComputedStyle(row).overflowX, display: getComputedStyle(row).display, more: !document.getElementById("mf-more-paths").hidden }; });
    assert.equal(g.scrolls, true, "the row scrolls on its own");
    assert.equal(g.overflowX, "auto");
    assert.equal(g.display, "flex");
    assert.equal(g.more, true, "the more arrow shows");
  } finally { await t.close(); }
});

// ---------- source checks ----------

test("source: the 0.4.31 fold, reveal, prompts and cards changes stay, with no dashes", () => {
  const css = read("web", "mac", "css", "flow.css");
  assert.match(css, /\[data-fold="1"\] \.sc-box \.simple-send-row > #vo-mic/);
  assert.match(css, /@media \(min-width: 1000px\) \{\s*body\[data-style="mac"\] #mac-flow \.mf-paths \{ display: grid;/);
  const app = read("web", "app.js");
  assert.match(app, /\[data-feature='next-actions'\] \.na-bar/);
  assert.doesNotMatch(app, /actsTop > sr\.bottom && bottom - top > sr\.height/, "a long answer no longer stays at its start");
  const prompts = read("web", "features", "prompts.js");
  assert.match(prompts, /bus\.emit\("chat", \{ open: true \}\)/);
  for (const f of [["web", "mac", "css", "flow.css"], ["web", "mac", "parts", "flow.js"], ["web", "features", "prompts.js"]]) {
    assert.equal(/[–—]/.test(read(...f)), false, `${f.join("/")} has no dashes`);
  }
});
