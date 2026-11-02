// 0.4.35: screen fixes from the 0.4.31 persona panel (meldmind-panel-0431/FIXES-0433.md items 2, 3, 5, 6, 8, 9, 11, 12,
// 14 and 15 a to d). Real server in demo mode (practice AIs, no keys, nothing sent) and headless Chrome via bootMac;
// skips only when no Chrome is installed. "On screen" is an elementFromPoint hit test after #cc-startup has gone.
// Windows rules: one browser at a time, real waits (waitForFunction with generous deadlines, the PC may be busy), every
// test closes its browser and server. Harness lessons (item 17): press "Just chat instead" before filling #orders in
// Simple; Council and Mission open "Who will read this", whose Send is #cc-readers-go.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(45000);
const RUN = waitBudget(120000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const HIDE = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer{display:none!important}";

async function boot({ width, height, mode = "simple", theme = "light", demo = true }) {
  const t = await bootMac({ width, height, mode, theme });
  if (!t) return null;
  try {
    if (demo) {
      assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
      await t.page.reload({ waitUntil: "domcontentloaded", timeout: WAIT });
    }
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: HIDE });
    // item 17a: no hit test until the start screen has left
    await t.page.waitForFunction(() => { const s = document.getElementById("cc-startup"); return !s || s.getBoundingClientRect().height === 0; }, null, { timeout: WAIT });
    await t.page.waitForFunction((m) => document.body.dataset.ui === m, mode, { timeout: WAIT });
    return t;
  } catch (e) { await t.close(); throw e; }
}

function hitTest(sel) {
  const el = document.querySelector(sel);
  if (!el) return { sel, found: false };
  const r = el.getBoundingClientRect();
  const inside = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const top = !!hit && (hit === el || el.contains(hit));
  return { sel, found: true, inside, top, by: top ? "" : hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none", rect: [r.left, r.top, r.width, r.height].map(Math.round).join(",") };
}
const onScreen = (page, sel) => page.evaluate(hitTest, sel);
const waitOnScreen = (page, sel) => page.waitForFunction((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (!(r.height > 0 && r.top >= 0 && r.bottom <= innerHeight)) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, sel, { timeout: WAIT, polling: 250 }).catch(() => {});

async function simpleAnswer(t, text = "Plan a bake sale for Saturday with a full list of steps") {
  const p = t.page;
  await p.waitForSelector("#mf-chat", { timeout: WAIT });
  await p.click("#mf-chat"); // item 17b: Just chat instead
  await p.waitForSelector("#orders", { state: "visible", timeout: WAIT });
  await p.fill("#orders", text);
  await p.click("#go");
  await p.waitForFunction(() => !!window.CC.S.live?.id, null, { timeout: WAIT });
  await p.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status), null, { timeout: RUN });
  // 0.4.37 (Simple chat layout): Copy is the first of the four buttons under the answer (the old row is behind Make changes)
  await p.waitForSelector("#simple-answer > .sc-acts [data-sc-act='copy']", { timeout: WAIT });
}

// ---------- item 2: Mission "Who will read this" ----------

test("item 2: at 1366 x 768 the Council readers box holds its Send; on Free, Mission goes straight to the Pro box and its button says Pro", { skip }, async () => {
  const t = await boot({ width: 1366, height: 768, mode: "expert" });
  try {
    const p = t.page;
    await p.evaluate(() => window.CC.go("command"));
    await p.waitForSelector("#run-mode [data-m='mission']", { timeout: WAIT });
    // (c) the Mission button says Pro on Free; its tip ends with Part of Pro. 0.4.38 (Chris: Expert Command as a chat):
    // the run bar folded into the chat box, so the box's pill is the one Mission button
    const marks = await p.evaluate(() => ["#run-mode"].map((s) => !!document.querySelector(`${s} [data-m='mission'] .cc-pro-mark`)));
    assert.deepEqual(marks, [true], "the Mission pill carries the Pro mark");
    const { TIPS } = await import("../web/tips.js");
    assert.match(TIPS["mode:mission"], /Part of Pro\.$/);
    // (a) Council (allowed on Free): the box sizes to its content and Send is inside the card, on screen
    await p.click("#run-mode [data-m='council']");
    await p.fill("#orders", "Should I open a second bakery or grow the first one?");
    await p.click("#go");
    await p.waitForSelector("#cc-readers-go", { timeout: WAIT });
    await waitOnScreen(p, "#cc-readers-go");
    const box = await p.evaluate(() => {
      const card = document.querySelector("#cc-readers .card").getBoundingClientRect();
      const go = document.getElementById("cc-readers-go").getBoundingClientRect();
      return { inside: go.top >= card.top && go.bottom <= card.bottom && go.left >= card.left && go.right <= card.right, cardW: Math.round(card.width), cardH: Math.round(card.height), fitsWindow: card.bottom <= innerHeight && card.top >= 0 };
    });
    assert.equal(box.inside, true, `Send is inside the card ${JSON.stringify(box)}`);
    assert.ok(box.cardW > 400, `the card is not squeezed to 240 px (${box.cardW})`);
    assert.equal(box.fitsWindow, true, "the card fits the window");
    const go = await onScreen(p, "#cc-readers-go");
    assert.ok(go.inside && go.top, `#cc-readers-go is on screen and on top ${JSON.stringify(go)}`);
    await p.click("#cc-readers-cancel");
    await p.waitForFunction(() => !document.getElementById("cc-readers"), null, { timeout: WAIT });
    // (b) Mission on Free: Send opens the Pro box, never the readers box
    await p.click("#run-mode [data-m='mission']");
    await p.click("#go");
    await p.waitForSelector("#cc-upgrade", { timeout: WAIT });
    assert.equal(await p.evaluate(() => !!document.getElementById("cc-readers")), false, "no readers box on Free");
    assert.match(await p.textContent("#cc-upgrade"), /Mission mode is part of Pro/);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 3: toasts off the Next bar and off page buttons ----------

const OVERLAPS = ([tsel, bsel]) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : true); };
  const toasts = [...document.querySelectorAll(tsel)].filter(vis).map((e) => e.getBoundingClientRect());
  const out = [];
  for (const b of [...document.querySelectorAll(bsel)].filter(vis)) {
    const r = b.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    for (const s of toasts) if (s.left < r.right && r.left < s.right && s.top < r.bottom && r.top < s.bottom) out.push(b.textContent.trim().slice(0, 30));
  }
  return { count: toasts.length, out };
};

test("item 3: Simple at 1366 x 800, after Send the toast does not cover the Next bar or the answer's buttons", { skip }, async () => {
  const t = await boot({ width: 1366, height: 800 });
  try {
    const p = t.page;
    await simpleAnswer(t);
    await p.evaluate(() => window.CC.toast("Answer done · Free"));
    await p.waitForFunction(() => [...document.querySelectorAll("#toasts .toast")].some((e) => e.getBoundingClientRect().height > 0), null, { timeout: WAIT });
    const r = await p.evaluate(OVERLAPS, ["#toasts .toast", "#mmbar button, #fpbar button, #projbar button, [data-feature='next-actions'] button, [data-feature='finishpath'] button, .sc-acts button, #view .sc-box"]);
    assert.ok(r.count >= 1, "a toast shows");
    assert.deepEqual(r.out, [], "no toast covers a Next bar or answer button");
    // 0.4.37 (Simple chat layout): no bars stack over the Chat page, so the toast keeps its place under the title bar
    const top = await p.evaluate(() => document.querySelector("#toasts .toast").getBoundingClientRect().top);
    assert.ok(top < 160, `toast near the top (${top})`);
  } finally { await t.close(); }
});

test("item 3: Expert at 1024 x 768 (no Live feed column), an error toast does not cover the page's buttons", { skip }, async () => {
  const t = await boot({ width: 1024, height: 768, mode: "expert" });
  try {
    const p = t.page;
    for (const view of ["artifacts", "everyday-inbox"]) {
      await p.evaluate((v) => window.CC.go(v), view);
      await p.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view").children.length > 0, view, { timeout: WAIT });
      await p.waitForFunction(() => document.querySelectorAll("#view button").length > 0, null, { timeout: WAIT }).catch(() => {});
      await p.evaluate(() => { document.querySelectorAll("#toasts .toast").forEach((e) => e.remove()); window.CC.toast("Request failed (HTTP 402) for this test", true); });
      await p.waitForFunction(() => [...document.querySelectorAll("#toasts .toast")].some((e) => e.getBoundingClientRect().height > 0), null, { timeout: WAIT });
      const r = await p.evaluate(OVERLAPS, ["#toasts .toast", "#view button, #view a[href], #view select, #view input"]);
      assert.deepEqual(r.out, [], `${view}: no toast covers a page control`);
      // bottom right above the dock (moved up past a box in that corner), or below the title bar if that is covered too
      // the place is written when placeToasts runs, which on the CI runner came a moment after the toast showed
      await p.waitForFunction(() => ["bottom", "top"].includes(document.body.dataset.toastAt), null, { timeout: WAIT, polling: 100 }).catch(() => {});
      const at = await p.evaluate(() => document.body.dataset.toastAt);
      assert.ok(["bottom", "top"].includes(at), `${view}: toast place is ${at}`);
    }
    // a box in the bottom right corner (as on the CI runner's Everyday inbox): the toast moves up, just above it.
    // One step in the page, so a redraw of the view cannot drop the box between showing the toast and measuring it.
    const corner = await p.evaluate(async () => {
      document.querySelectorAll("#toasts .toast").forEach((e) => e.remove());
      // where a toast goes before any nudge: just above the chat dock and the Talk bar (app.js placeToasts bottomAbove)
      const tops = [".cc-dock", "#vt-bar"].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter((r) => r && r.height && r.top > innerHeight * 0.45).map((r) => r.top);
      const at = tops.length ? Math.round(innerHeight - Math.min(...tops) + 8) : 120;
      const b = document.createElement("input"); b.id = "t-corner";
      b.style.cssText = `position:fixed;right:16px;bottom:${at + 4}px;width:360px;height:40px;z-index:1`;
      document.getElementById("view").appendChild(b);
      window.CC.toast("Request failed (HTTP 402) for this test", true);
      // placeToasts runs from a MutationObserver (a microtask after the toast is added); measure right after it, before
      // the page has a chance to redraw and drop the box
      await Promise.resolve(); await Promise.resolve();
      const t = document.querySelector("#toasts .toast")?.getBoundingClientRect();
      const c = b.getBoundingClientRect();
      b.remove();
      return t ? { above: t.bottom <= c.top, overlap: t.left < c.right && c.left < t.right && t.top < c.bottom && c.top < t.bottom, at: document.body.dataset.toastAt, t: [Math.round(t.left), Math.round(t.top), Math.round(t.right), Math.round(t.bottom)], c: [Math.round(c.left), Math.round(c.top), Math.round(c.right), Math.round(c.bottom)], base: at, v: getComputedStyle(document.body).getPropertyValue("--cc-toast-bottom") } : null;
    });
    assert.ok(corner, "a toast shows");
    assert.equal(corner.overlap, false, "the toast moved off the corner box");
    assert.equal(corner.above, true, `just above the box ${JSON.stringify(corner)}`);
  } finally { await t.close(); }
});

// ---------- item 5: hover tips show on the first hover; path cards have tips ----------

test("item 5: Expert Command, the first hover on Council shows its tip; a Simple path card has a tip", { skip }, async () => {
  const t = await boot({ width: 1366, height: 800, mode: "expert" });
  try {
    const p = t.page;
    await p.evaluate(() => window.CC.go("command"));
    // 0.4.38 (Chris: Expert Command as a chat): the run modes are pills on the chat box (the run bar folded into it)
    await p.waitForSelector("#run-mode [data-m='council']", { timeout: WAIT });
    await waitOnScreen(p, "#run-mode [data-m='council']");
    // a scroll in a box that does not hold the button (the page settling) no longer cancels the waiting tip
    await p.hover("#run-mode [data-m='council']");
    await p.evaluate(() => { const f = document.getElementById("feed") || document.body; f.dispatchEvent(new Event("scroll")); });
    await p.waitForFunction(() => document.getElementById("cc-tip")?.classList.contains("on"), null, { timeout: waitBudget(1500) });
    assert.match(await p.textContent("#cc-tip"), /^Council:/);
    // the chat box's Priority list shows the chosen priority's tip on keyboard focus
    await p.mouse.move(5, 5);
    await p.focus("#cost-mode");
    await p.keyboard.press("Shift+Tab");
    await p.keyboard.press("Tab");
    await p.waitForFunction(() => document.getElementById("cc-tip")?.classList.contains("on"), null, { timeout: waitBudget(1500) }).catch(() => {});
    const prio = await p.evaluate(() => ({ on: document.getElementById("cc-tip").classList.contains("on"), text: document.getElementById("cc-tip").textContent }));
    assert.equal(prio.on, true, "Priority has a tip on keyboard focus");
    assert.match(prio.text, /^(Max quality|Quality|Balanced|Max savings|Speed):/);
  } finally { await t.close(); }
  const s = await boot({ width: 1366, height: 800, demo: false });
  try {
    const p = s.page;
    await p.waitForSelector('#mac-flow .mf-path[data-path="spreadsheet"]', { timeout: WAIT });
    await waitOnScreen(p, '#mac-flow .mf-path[data-path="spreadsheet"]');
    await p.hover('#mac-flow .mf-path[data-path="spreadsheet"]');
    await p.waitForFunction(() => document.getElementById("cc-tip")?.classList.contains("on"), null, { timeout: waitBudget(1500) });
    assert.match(await p.textContent("#cc-tip"), /spreadsheet file/);
  } finally { await s.close(); }
});

// ---------- item 6: phone, the answer's buttons come up after Send ----------

test("item 6: Simple at 390 x 844 after a demo answer, Copy is on screen and on top; one swipe row; no Asset Tray pill", { skip }, async () => {
  const t = await boot({ width: 390, height: 844 });
  try {
    const p = t.page;
    await simpleAnswer(t);
    // 0.4.37 (Simple chat layout): Copy is the first of the four buttons under the answer
    const COPY = "#simple-answer > .sc-acts [data-sc-act='copy']";
    await waitOnScreen(p, COPY);
    const copy = await onScreen(p, COPY);
    assert.ok(copy.inside && copy.top, `Copy is on screen and on top ${JSON.stringify(copy)}`);
    const g = await p.evaluate(() => {
      const row = document.querySelector(".sx-swipe");
      const tray = document.getElementById("cc-asset-tray");
      const mm = document.getElementById("mmbar");
      return { rowShown: !!row && row.getBoundingClientRect().height > 0, mmInFold: !mm || !!mm.closest("#sc-changes"), tray: !!tray && tray.getBoundingClientRect().height > 0 };
    });
    // 0.4.37: the 0.4.35 swipe row (Next bar and Project tools) no longer stacks over the chat; the Next bar is behind Make changes
    assert.equal(g.rowShown, false, "no bar row above the Chat page");
    assert.equal(g.mmInFold, true, "the Next bar waits behind Make changes");
    assert.equal(g.tray, false, "the Asset Tray pill is hidden while the bottom tabs show");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 8: Large text reaches the Simple home; "Or just say it" above the dock ----------

for (const [width, height] of [[1366, 768], [1024, 768]]) {
  test(`item 8: Simple home at ${width} x ${height}, "Or just say it" is on screen, also with Large text, and Large enlarges the cards`, { skip }, async () => {
    const t = await boot({ width, height, demo: false });
    try {
      const p = t.page;
      await p.waitForSelector("#mac-flow #mf-ask", { timeout: WAIT });
      await waitOnScreen(p, "#mf-ask");
      const plain = await onScreen(p, "#mf-ask");
      assert.ok(plain.inside && plain.top, `#mf-ask on top at default size ${JSON.stringify(plain)}`);
      await p.evaluate(() => { document.documentElement.dataset.text = "large"; });
      await p.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector("#mac-flow .mf-path b")).fontSize) >= 20, null, { timeout: WAIT });
      const sizes = await p.evaluate(() => ({ b: parseFloat(getComputedStyle(document.querySelector("#mac-flow .mf-path b")).fontSize), small: parseFloat(getComputedStyle(document.querySelector("#mac-flow .mf-path small")).fontSize), title: parseFloat(getComputedStyle(document.querySelector("#mac-flow .mf-title")).fontSize) }));
      assert.ok(sizes.b >= 20, `card title at least 20 px (${sizes.b})`);
      assert.ok(sizes.small >= 16, `card blurb grows too (${sizes.small})`);
      await waitOnScreen(p, "#mf-ask");
      const large = await onScreen(p, "#mf-ask");
      assert.ok(large.inside && large.top, `#mf-ask on top with Large text ${JSON.stringify(large)}`);
    } finally { await t.close(); }
  });
}

// ---------- item 9: reading width ----------

test("item 9: Expert at 3440 x 1440, no paragraph in #view runs past 80 characters a line; a Simple answer at 1440 neither", { skip }, async () => {
  const measure = () => [...document.querySelectorAll("#view p, #view li, #simple-answer p, #simple-answer li")].filter((e) => e.getBoundingClientRect().width > 0 && e.textContent.trim().length > 60).map((e) => {
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(20);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
    e.appendChild(probe);
    const ch = probe.getBoundingClientRect().width / 20;
    probe.remove();
    return { chars: Math.round(e.getBoundingClientRect().width / ch), text: e.textContent.trim().slice(0, 40) };
  }).filter((x) => x.chars > 80);
  const t = await boot({ width: 3440, height: 1440, mode: "expert" });
  try {
    const p = t.page;
    for (const view of ["credits", "projects", "command"]) {
      await p.evaluate((v) => window.CC.go(v), view);
      await p.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view").children.length > 0, view, { timeout: WAIT });
      await p.waitForFunction(() => document.querySelectorAll("#view p").length > 0, null, { timeout: WAIT }).catch(() => {});
      assert.deepEqual(await p.evaluate(measure), [], `${view}: every paragraph keeps a reading width`);
    }
  } finally { await t.close(); }
  const s = await boot({ width: 1440, height: 900 });
  try {
    await simpleAnswer(s);
    assert.deepEqual(await s.page.evaluate(measure), [], "the Simple answer keeps a reading width");
  } finally { await s.close(); }
});

// ---------- item 11: one button per action ----------

test("item 11: under a Simple answer no two visible buttons share a label with the Next bar; Expert replies from the chat box", { skip }, async () => {
  const t = await boot({ width: 1366, height: 800 });
  try {
    const p = t.page;
    await simpleAnswer(t);
    await p.waitForSelector("[data-feature='finishpath'] [data-fp-good], [data-feature='next-actions'] .na-bar", { timeout: WAIT }).catch(() => {});
    await p.waitForFunction(() => !!document.getElementById("mmbar"), null, { timeout: WAIT }).catch(() => {});
    const dupes = await p.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : true); };
      const seen = new Map(), out = [];
      for (const b of document.querySelectorAll("#simple-answer button, #mmbar button")) {
        if (!vis(b)) continue;
        const label = b.textContent.replace(/\s+/g, " ").trim().toLowerCase();
        if (!label) continue;
        if (seen.has(label)) out.push(label); else seen.set(label, true);
      }
      const finishes = [...document.querySelectorAll("#simple-answer button, #mmbar button")].filter(vis).filter((b) => /finish/i.test(b.textContent)).length;
      return { out, finishes };
    });
    assert.deepEqual(dupes.out, [], "each action shows once");
    assert.ok(dupes.finishes <= 1, `one Finish button (${dupes.finishes})`);
  } finally { await t.close(); }
  const e = await boot({ width: 1366, height: 800, mode: "expert" });
  try {
    const p = e.page;
    await p.evaluate(() => window.CC.go("command"));
    await p.waitForSelector("#run-mode [data-m='single']", { timeout: WAIT });
    await p.click("#run-mode [data-m='single']");
    await p.fill("#orders", "Write a two line thank you note for a customer");
    await p.click("#go");
    await p.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status), null, { timeout: RUN });
    // 0.4.38 (Chris: Expert Command as a chat): the marching orders box is the one place to reply (the follow-up goes
    // on in the same chat), so a one-AI answer has no second reply box under it, only its four buttons
    await p.waitForFunction(() => document.querySelector("#ex-answer > .sc-acts")?.getBoundingClientRect().height > 0, null, { timeout: WAIT });
    const boxes = await p.evaluate(() => [...document.querySelectorAll("form.reply-box")].filter((f) => f.getBoundingClientRect().height > 0).map((f) => f.querySelector("label")?.textContent.trim()));
    assert.deepEqual(boxes, [], "no second reply box for a one-AI answer");
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#ex-answer > .sc-acts button")].map((b) => b.textContent.trim())), ["Copy", "Try again", "Make changes", "Save as file"]);
  } finally { await e.close(); }
});

// ---------- item 12: Use this with a long prompt keeps Send in view ----------

test("item 12: Simple at 1366 x 800, Use this with the longest listed prompt leaves Send on screen and the box about 6 lines", { skip }, async () => {
  const t = await boot({ width: 1366, height: 800, demo: false });
  try {
    const p = t.page;
    await p.evaluate(() => { localStorage.removeItem("cc.prompts.whatsnew.open"); window.CC.go("prompts"); });
    await p.waitForSelector("[data-use]", { timeout: WAIT });
    await p.evaluate(() => {
      document.querySelectorAll("details").forEach((d) => { if (d.querySelector("[data-use]")) d.open = true; });
      const all = [...document.querySelectorAll("[data-use]")];
      const len = (b) => (b.closest("div")?.querySelector("[title]")?.getAttribute("title") || "").length;
      const best = all.reduce((a, b) => (len(b) > len(a) ? b : a), all[0]);
      best.scrollIntoView({ block: "center" });
      best.dataset.testUse = "1";
    });
    await p.click("[data-test-use]");
    await p.waitForFunction(() => document.activeElement?.id === "orders" && document.getElementById("orders").value.length > 0, null, { timeout: WAIT });
    await waitOnScreen(p, "#go");
    const g = await p.evaluate(() => { const o = document.getElementById("orders"); const lh = parseFloat(getComputedStyle(o).lineHeight) || 24; return { len: o.value.length, h: o.getBoundingClientRect().height, lh }; });
    const go = await onScreen(p, "#go");
    assert.ok(go.inside && go.top, `#go is on screen and on top after Use this (${g.len} characters) ${JSON.stringify(go)}`);
    assert.ok(g.h <= g.lh * 6 + 40, `the box is capped at about 6 lines (${Math.round(g.h)} px)`);
  } finally { await t.close(); }
});

// ---------- item 14: History lists chats first; the dock starts collapsed at 800 tall ----------

test("item 14: Expert History at 1366 x 800 shows your chats above Import and Sync, and the chat dock starts collapsed there", { skip }, async () => {
  const t = await boot({ width: 1366, height: 800, mode: "expert" });
  try {
    const p = t.page;
    const sent = await t.api("/chat", { body: { prompt: "Name three bread rolls for a bakery menu" } });
    assert.ok(sent.status < 300, sent.text);
    // Just after a run finishes, its file is written again and the list can drop it for a few seconds: wait until the
    // chat has been listed, done, on four asks in a row (a real wait with a deadline, not a sleep).
    const until = Date.now() + RUN;
    for (let streak = 0; streak < 4;) {
      assert.ok(Date.now() < until, "the chat shows in the chat list");
      const list = (await t.api("/desk/chats")).json?.chats || [];
      streak = list.length > 0 && list.every((c) => c.status !== "running") ? streak + 1 : 0;
      await new Promise((r) => setTimeout(r, 500));
    }
    await p.evaluate(() => window.CC.go("history"));
    await p.waitForSelector("#hi-chats .hi-chat", { timeout: WAIT });
    const order = await p.evaluate(() => {
      const panels = [...document.querySelectorAll("#view .panel")].filter((e) => e.parentElement.closest(".panel") === null);
      return panels.map((e) => e.id || e.querySelector("h3")?.textContent.trim().split(" ").slice(0, 3).join(" "));
    });
    assert.equal(order[0], "hi-chats", `the chat list is first (${order.join(" | ")})`);
    assert.ok(order.findIndex((x) => /^Import/.test(x)) > 0, "Import comes after the chats");
    const chat = await onScreen(p, "#hi-chats .hi-chat");
    assert.ok(chat.inside && chat.top, `a past chat is on screen without scrolling ${JSON.stringify(chat)}`);
    await p.waitForFunction(() => document.querySelector(".cc-dock")?.dataset.collapsed === "1", null, { timeout: WAIT });
    // Command keeps the open dock at this height
    await p.evaluate(() => window.CC.go("command"));
    await p.waitForFunction(() => window.CC.S.view === "command", null, { timeout: WAIT });
    const cmd = await p.evaluate(() => { const d = document.querySelector(".cc-dock"); return !d || d.hidden || d.dataset.collapsed === "0"; });
    assert.equal(cmd, true, "Command does not collapse the dock by itself");
    // a click on a past chat opens it
    await p.evaluate(() => window.CC.go("history"));
    await p.waitForSelector("#hi-chats .hi-chat", { timeout: WAIT });
    await p.click("#hi-chats .hi-chat");
    await p.waitForFunction(() => window.CC.S.view === "command" && !!window.CC.S.live?.id, null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 15: small things ----------

test("item 15a and 15d: Images prices show two decimals; the light New image button reads at 4.5 : 1 or better", { skip }, async () => {
  const contrast = () => {
    const b = document.querySelector('#im-op button[data-op="generate"]');
    const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, bl]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
    let bg = getComputedStyle(b).backgroundColor, e = b;
    while (e && (rgb(bg)[3] === 0 || bg === "transparent")) { e = e.parentElement; bg = e ? getComputedStyle(e).backgroundColor : "rgb(255,255,255)"; }
    const a = lum(rgb(getComputedStyle(b).color)), c = lum(rgb(bg));
    return Math.round(((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)) * 100) / 100;
  };
  for (const mode of ["expert", "simple"]) {
    const t = await boot({ width: 1366, height: 800, mode });
    try {
      const p = t.page;
      await p.evaluate(() => window.CC.go("images"));
      await p.waitForSelector('#im-op button[data-op="generate"]', { timeout: WAIT });
      await p.click("#im-est");
      await p.waitForFunction(() => /\$\d/.test(document.getElementById("im-est-out")?.textContent || ""), null, { timeout: WAIT });
      const words = await p.evaluate(() => ({ est: document.getElementById("im-est-out").textContent, go: document.getElementById("im-go").textContent }));
      assert.doesNotMatch(words.est, /\$\d+\.\d{3}/, `the estimate has two decimals: ${words.est}`);
      assert.doesNotMatch(words.go, /\$\d+\.\d{3}/, `the Generate label has two decimals: ${words.go}`);
      const ratio = await p.evaluate(contrast);
      assert.ok(ratio >= 4.5, `${mode}: New image is ${ratio} : 1`);
    } finally { await t.close(); }
  }
});

test("item 15b: Expert at 390 x 844, Send orders is clear of the Talk bar once Command settles", { skip }, async () => {
  const t = await boot({ width: 390, height: 844, mode: "expert" });
  try {
    const p = t.page;
    await p.evaluate(() => window.CC.go("command"));
    await p.waitForSelector("#go", { timeout: WAIT });
    const clear = () => { const g = document.getElementById("go").getBoundingClientRect(); const v = document.getElementById("vt-bar")?.getBoundingClientRect(); return g.height > 0 && g.top >= 0 && (!v || !v.height || g.bottom <= v.top); };
    await p.waitForFunction(clear, null, { timeout: WAIT, polling: 250 }).catch(() => {});
    const g = await p.evaluate(() => ({ go: document.getElementById("go").getBoundingClientRect().bottom, talk: document.getElementById("vt-bar")?.getBoundingClientRect().top }));
    assert.equal(await p.evaluate(clear), true, `Send orders ends above the Talk bar ${JSON.stringify(g)}`);
    const go = await onScreen(p, "#go");
    assert.ok(go.inside && go.top, `Send orders is on top ${JSON.stringify(go)}`);
  } finally { await t.close(); }
});

test("item 15c: Game mod in demo makes no file, so Done offers Copy instead of Download mod", { skip }, async () => {
  const t = await boot({ width: 1366, height: 800 });
  try {
    const p = t.page;
    await p.waitForSelector('#mac-flow .mf-path[data-path="mod"]', { timeout: WAIT });
    await p.click('#mac-flow .mf-path[data-path="mod"]');
    await p.waitForFunction(() => window.CC.mac.flow.state.step === "style", null, { timeout: WAIT });
    await p.click("#mf-next");
    await p.waitForSelector("#mf-text", { timeout: WAIT });
    await p.fill("#mf-text", "Make zombies drop extra apples in Minecraft");
    await p.click("#mf-make");
    await p.waitForFunction(() => ["done", "incomplete"].includes(window.CC.mac.flow.state.step), null, { timeout: RUN });
    await p.waitForFunction(() => document.getElementById("mf-finish")?.textContent === "Copy", null, { timeout: WAIT }).catch(() => {});
    const fin = await p.evaluate(() => ({ step: window.CC.mac.flow.state.step, text: document.getElementById("mf-finish")?.textContent || "" }));
    assert.equal(fin.step, "done");
    assert.equal(fin.text, "Copy", "nothing to download, so the button copies");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- source checks ----------

test("source: the 0.4.35 fixes stay in place, with no dashes in what they say", () => {
  const desk = read("web", "features", "desk.js");
  assert.match(desk, /#cc-readers \.card \{ position: relative; display: block; flex: 0 1 520px;[^}]*max-height: calc\(100vh - 32px\); overflow: auto;/);
  assert.match(desk, /body: \{ mode, prompt, check: true \}/);
  assert.match(read("server", "plugins", "desk.js"), /body\?\.check === true && typeof h\.guard === "function"/);
  const tips = read("web", "tips.js");
  assert.doesNotMatch(tips, /win\.addEventListener\("scroll", hide, true\)/, "a scroll elsewhere no longer hides every tip");
  assert.match(read("web", "momentum-ui.js"), /ANSWER_ROW_IDS = \["variations", "refine", "finish", "add-project"\]/);
  assert.match(read("web", "mac", "css", "inside.css"), /#view :is\(p, li\) \{\s*max-width: 75ch;/);
  assert.match(read("web", "mac", "css", "flow.css"), /body\[data-style="mac"\]:is\(\[data-text="large"\] \*\) #mac-flow \{ --mf-scale: 1\.25; \}/);
  const images = read("web", "features", "images.js");
  assert.doesNotMatch(images, /money\(e\.usd, 3\)|money\(st\.est\.usd, 3\)/);
  for (const f of [["web", "tips.js"], ["web", "features", "history.js"], ["web", "mac", "parts", "flow.js"], ["web", "mac", "parts", "inside.js"], ["web", "momentum-ui.js"], ["web", "mac", "css", "shell.css"], ["web", "mac", "css", "flow.css"]]) {
    assert.equal(/[–—]/.test(read(...f)), false, `${f.join("/")} has no dashes`);
  }
});
