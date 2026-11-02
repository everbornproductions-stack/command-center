// 0.4.38: fixes from the 0.4.37 persona panel (meldmind-panel-0437/FIXES-0439.md items 2, 4, 5 and 6), on the Simple
// Chat page and the new Expert chat (they share the chat code in web/app.js):
//  2. Every question goes on in the same chat (kept: that is how Claude and ChatGPT work), so starting fresh is a clear
//     New chat button at the top of the Simple and the Expert sidebar (the small link above the chat stays). A new chat
//     is an empty page, and the next question is a new run, so a new History row.
//  4. No toast covers an answer's buttons or the chat box (Save as file used to land on Try again).
//  5. At 390 x 844, after a follow-up, the newest reply's buttons sit above the chat box.
//  6. Make changes on the first answer starts short (11 controls or fewer, none covered); All options shows the rest.
//     (0.4.39: "Give to an agent" joined the short list, since Chris wants agents within reach: 10 became 11)
// Real server in demo mode (practice AIs, no keys, nothing sent) and headless Chrome via bootMac; skips only when no
// Chrome is installed. Windows rules: one server and one browser at a time, real waits, every test closes what it opens.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(180000);
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer{display:none!important}";
const CHAT = "#view :is(.sc-chat, .ex-chat)";

async function boot({ width, height, mode }) {
  const t = await bootMac({ width, height, mode, theme: "light", env: mode === "expert" ? { CC_DEV_OWNER: "1" } : {} });
  if (!t) return null;
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: POPUPS });
    await t.page.evaluate(() => { window.CC.go("command"); window.CC.mac.bus.emit("chat"); });
    await t.page.waitForFunction((m) => document.body.dataset.ui === m && !!document.querySelector(m === "expert" ? "#view .ex-chat #orders" : "#view .sc-chat #orders"), mode, { timeout: WAIT });
    // 0.5.0 (chat like the Claude app): the run modes are in the box's mode menu
    if (mode === "expert") { await t.page.click("#sc-team"); await t.page.click('#run-mode button[data-m="single"]'); }
    return t;
  } catch (e) { await t.close(); throw e; }
}
async function send(page, text) {
  const before = await page.evaluate(() => ({ id: window.CC.S.live?.id || "", n: document.querySelectorAll("#sc-turns .sc-reply").length }));
  await page.fill("#orders", text);
  await page.click("#go");
  await page.waitForFunction((b) => (window.CC.S.live?.id && window.CC.S.live.id !== b.id) || document.querySelectorAll("#sc-turns .sc-reply").length > b.n, before, { timeout: RUN });
  await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !window.CC.S.live?.replying, null, { timeout: RUN });
  await page.waitForFunction((c) => [...document.querySelectorAll(`${c} .sc-acts`)].every((a) => a.getBoundingClientRect().height > 0), CHAT, { timeout: WAIT });
}
const firstActs = (mode) => (mode === "expert" ? "#ex-answer > .sc-acts" : "#simple-answer > .sc-acts");
// Every shown control in the first answer's Make changes, and the ones another element sits on at their centre.
const foldControls = (page) => page.evaluate(() => {
  const f = document.getElementById("sc-changes");
  // the inside of a closed <details> keeps a box but is not drawn (checkVisibility says so): it is not counted
  const shown = [...f.querySelectorAll("button, select, a[href], input, textarea, summary")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : true); });
  const covered = [];
  for (const e of shown) {
    e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === e || e.contains(hit))) covered.push(`${(e.textContent || e.id).trim().slice(0, 24)} under ${hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none"}`);
  }
  return { n: shown.length, words: shown.map((e) => (e.textContent || e.getAttribute("aria-label") || e.id).trim().slice(0, 24)), covered };
});
// No shown toast on an answer's buttons or the chat box.
const toastOver = (page) => page.evaluate(() => {
  const vis = (r) => r.width > 0 && r.height > 0;
  const toasts = [...document.querySelectorAll("#toasts .toast")].map((e) => e.getBoundingClientRect()).filter(vis);
  const guard = [...document.querySelectorAll("#view :is(.sc-acts button, .sc-box, .ex-box)")].map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => vis(r));
  const out = [];
  for (const s of toasts) for (const [e, r] of guard) if (s.left < r.right && r.left < s.right && s.top < r.bottom && r.top < s.bottom) out.push((e.textContent || e.className).trim().slice(0, 20));
  return { count: toasts.length, out };
});

for (const mode of ["simple", "expert"]) {
  test(`${mode} 1366 x 800: New chat at the top of the sidebar, a short Make changes, and the Save as file toast off the buttons`, { skip, timeout: RUN * 3 }, async () => {
    const t = await boot({ width: 1366, height: 800, mode });
    if (!t) return;
    try {
      const { page } = t;
      const NEW = mode === "expert" ? "#mac-side #mx-new-chat" : "#cc-side #side-new";
      // ---- item 2: the New chat button is at the top of the sidebar, on screen and on top ----
      const nb = await page.evaluate((sel) => {
        const b = document.querySelector(sel);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const items = [...document.querySelectorAll(sel.startsWith("#mac") ? "#mac-side .si" : "#cc-side .side-nav .side-item")].filter((e) => e.getBoundingClientRect().height > 0);
        return { words: b.textContent.trim(), top: !!hit && b.contains(hit), inside: r.top >= 0 && r.bottom <= innerHeight, aboveItems: items.every((e) => e.getBoundingClientRect().top >= r.bottom - 1) };
      }, NEW);
      assert.ok(nb, "the New chat button is there");
      assert.match(nb.words, /New chat$/);
      assert.ok(nb.top && nb.inside && nb.aboveItems, JSON.stringify(nb));
      await send(page, "Write a two line thank you note for a customer.");
      const first = await page.evaluate(() => window.CC.S.live.id);
      assert.equal(await page.evaluate(() => !!document.getElementById("sc-new")), true, "the small New chat link stays");

      // ---- item 6: Make changes starts short (10 or fewer controls, none covered); All options shows the rest ----
      await page.click(`${firstActs(mode)} [data-sc-act='change']`);
      await page.waitForFunction(() => !document.getElementById("sc-changes").hidden && !!document.querySelector("#sc-changes #cc-check"), null, { timeout: WAIT });
      await page.waitForFunction(() => !!document.querySelector("#sc-changes [data-feature='finishpath'] [data-fp-good]"), null, { timeout: WAIT }).catch(() => {});
      // Change this part comes from the versions feature, which draws a moment later on the CI runner
      await page.waitForFunction(() => !!document.querySelector("#sc-changes #cc-v-change"), null, { timeout: WAIT }).catch(() => {});
      const short = await foldControls(page);
      assert.ok(short.n <= 11, `${short.n} controls: ${short.words.join(", ")}`);
      assert.deepEqual(short.covered, [], "nothing covered");
      for (const w of ["Make it shorter", "Double-check", "Change this part", "All options"]) assert.ok(short.words.some((x) => x.startsWith(w)), `${w} in ${short.words.join(", ")}`);
      assert.match(await page.evaluate(() => document.getElementById("sc-changes").innerText), /Change the answer[\s\S]*Check, save or finish/);
      await page.click("#sc-changes [data-sc-all]");
      await page.waitForFunction(() => document.getElementById("sc-changes").classList.contains("sc-all"), null, { timeout: WAIT });
      const all = await foldControls(page);
      assert.ok(all.n > short.n, `All options shows more (${all.n})`);
      assert.ok(all.words.some((x) => /^More actions/.test(x)), "More actions is there");
      assert.ok(all.words.some((x) => /^Fewer options/.test(x)));
      assert.deepEqual(all.covered, [], "nothing covered with All options open either");
      await page.click("#sc-changes [data-sc-all]");

      // ---- item 4: Save as file's toast stays off the answer's buttons and the box; Try again works right away ----
      await page.click(`${firstActs(mode)} [data-sc-act='save']`);
      await page.waitForFunction(() => [...document.querySelectorAll("#toasts .toast")].some((x) => /^Saved /.test(x.textContent) && x.getBoundingClientRect().height > 0), null, { timeout: WAIT });
      await page.waitForTimeout(300);
      const over = await toastOver(page);
      assert.ok(over.count >= 1);
      assert.deepEqual(over.out, [], "no toast on the answer buttons or the chat box");
      await page.click(`${firstActs(mode)} [data-sc-act='again']`);
      await page.waitForFunction((id) => !!window.CC.S.live?.id && window.CC.S.live.id !== id, first, { timeout: RUN });
      await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status), null, { timeout: RUN });
      const again = await page.evaluate(() => window.CC.S.live.id);
      assert.notEqual(again, first, "Try again started a new run");

      // ---- item 2: New chat gives an empty page; the next question is a new run and a new History row ----
      await page.click(NEW);
      await page.waitForFunction((c) => !window.CC.S.live?.id && document.querySelector(c)?.dataset.state === "empty", CHAT, { timeout: WAIT });
      await send(page, "Plan a game night for Friday.");
      const third = await page.evaluate(() => window.CC.S.live.id);
      assert.ok(third && third !== again && third !== first, "a new chat");
      const turns = await page.evaluate(() => document.querySelectorAll("#sc-turns .sc-reply").length);
      assert.equal(turns, 0, "the new chat starts without the old replies");
      const rows = (await t.api("/missions")).json;
      const ids = (Array.isArray(rows) ? rows : rows?.missions || []).map((m) => m.id);
      for (const id of [again, third]) assert.ok(ids.includes(id), `${id} is a History row`);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}

for (const mode of ["simple", "expert"]) {
  test(`${mode} 390 x 844: after a follow-up the newest reply's buttons sit above the chat box`, { skip, timeout: RUN * 2 }, async () => {
    const t = await boot({ width: 390, height: 844, mode });
    if (!t) return;
    try {
      const { page } = t;
      await send(page, "Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4.");
      await send(page, "Make it shorter and take out the families line.");
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => {
        const acts = [...document.querySelectorAll("#sc-turns .sc-reply > .sc-acts")].pop().getBoundingClientRect();
        const box = document.querySelector("#view :is(.sc-chat, .ex-chat) > .orders").getBoundingClientRect();
        const btn = [...document.querySelectorAll("#sc-turns .sc-reply > .sc-acts button")].pop();
        const b = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { top: Math.round(acts.top), bottom: Math.round(acts.bottom), boxTop: Math.round(box.top), onTop: !!hit && btn.contains(hit) };
      });
      assert.ok(r.top > 40 && r.bottom <= r.boxTop + 1 && r.onTop, JSON.stringify(r));
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}
