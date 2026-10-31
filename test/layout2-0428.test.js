// 0.4.28: layout fixes from the 0.4.27 persona panel (meldmind-panel-0427/FIXES-0428.md items 1, 3 to 11).
// Real server in demo mode (practice AIs, nothing sent, no keys) and headless Chrome; skips only when no Chrome is
// installed. Every "on screen" claim is an elementFromPoint hit test, every scroll claim uses the mouse wheel, and
// every mode switch reads body[data-ui] back (LESSONS 2026-10-30). Windows rules: one browser at a time, real waits,
// every test closes its browser and server. Set CC_SHOTS to a folder to keep screenshots.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { paintedContrast } from "./paint-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(90000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite";
const SHOTS = process.env.CC_SHOTS || "";
const low = (list, min = 4.5) => list.filter((x) => x.ratio < min).map((x) => `${x.ratio} "${x.text}" fg ${x.fg} on ${x.bg}`);

async function shot(t, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await t.page.screenshot({ path: path.join(SHOTS, name) });
}
// Boot as a new user does (Mac look on by default), with the practice AIs on when asked, and wait for every Mac part.
async function bootNew({ demo = true, hideToasts = true, ...opts } = {}) {
  const t = await bootPage({ mac: "default", hidePopups: false, ...opts });
  if (!t) return null;
  try {
    if (demo) {
      assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
      await t.page.reload({ waitUntil: "domcontentloaded" });
    }
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: `${POPUPS}${hideToasts ? ",.toasts" : ""}{display:none!important}` });
    await t.page.waitForTimeout(1500);
    return t;
  } catch (e) { await t.close(); throw e; }
}
// The Mac switch, then proof that the page really is in Expert (the confirm dialog is accepted by bootPage).
async function toExpert(t) {
  if (await t.page.evaluate(() => document.body.dataset.ui) !== "expert") await t.page.click("#mac-expert");
  await t.page.waitForFunction(() => document.body.dataset.ui === "expert" && !document.getElementById("mac-side").hidden, null, { timeout: WAIT });
  await t.page.waitForTimeout(800);
  assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "expert", "body[data-ui] is expert after the switch");
}
async function go(t, view) {
  await t.page.evaluate((v) => window.CC.go(v), view);
  await t.page.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view").children.length > 0, view, { timeout: WAIT });
  await t.page.waitForTimeout(1200);
}
// Is the element inside the window and the top element at its centre?
const onScreen = (page, sel) => page.evaluate((sel) => {
  const el = typeof sel === "string" ? document.querySelector(sel) : null;
  if (!el) return { sel, found: false };
  const r = el.getBoundingClientRect();
  const inside = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const top = !!hit && (hit === el || el.contains(hit));
  return { sel, found: true, inside, top, by: top ? "" : hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none", rect: [r.left, r.top, r.width, r.height].map(Math.round).join(",") };
}, sel);
// Type a task and press Send, then wait for the practice AI's answer to finish.
async function sendAndWait(t, text) {
  await t.page.waitForSelector("#orders", { timeout: WAIT });
  await t.page.fill("#orders", text);
  await t.page.click("#go");
  await t.page.waitForFunction(() => !!window.CC.S.live?.id, null, { timeout: WAIT });
  await t.page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status), null, { timeout: RUN });
  await t.page.waitForTimeout(2000);
}

// ---------- item 1: Expert Command scrolls on wide windows ----------

for (const [width, height] of [[1366, 800], [1440, 900]]) {
  test(`item 1: Expert Command at ${width} x ${height} scrolls with the wheel to the last line of a long answer`, { skip }, async () => {
    const t = await bootNew({ theme: "dark", width, height });
    try {
      await toExpert(t);
      await go(t, "command");
      await sendAndWait(t, "Plan a bake sale for Saturday with a full list of steps");
      const before = await t.page.evaluate(() => {
        const v = document.getElementById("view"), md = document.getElementById("out-md");
        const last = [...md.children].filter((e) => e.textContent.trim()).pop();
        if (last) last.dataset.testLast = "1";
        return { ui: document.body.dataset.ui, overflow: getComputedStyle(v).overflowY, room: v.clientHeight, content: v.scrollHeight, lastText: last?.textContent.trim() || "" };
      });
      assert.equal(before.ui, "expert");
      assert.ok(before.content > before.room + 200, `the answer is longer than the page (${before.content} in ${before.room})`);
      assert.ok(before.lastText.length > 0, "the answer has a last line");
      assert.match(before.overflow, /auto|scroll/, "#view scrolls");
      // Wheel over the answer, as a person would, until its last line is on screen (at most 30 turns).
      const panel = await t.page.evaluate(() => { const r = document.getElementById("deliv-panel").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(Math.min(Math.max(r.top + 60, 120), innerHeight - 200)) }; });
      let last = null;
      for (let i = 0; i < 30; i++) {
        await t.page.mouse.move(panel.x, panel.y);
        await t.page.mouse.wheel(0, 300);
        await t.page.waitForTimeout(150);
        last = await onScreen(t.page, "[data-test-last]");
        if (last.inside && last.top) break;
      }
      assert.ok(last?.inside && last?.top, `the last line of the answer can be reached with the wheel: ${JSON.stringify(last)}`);
      assert.ok(await t.page.evaluate(() => document.getElementById("view").scrollTop) > 0, "the page moved");
      await shot(t, `expert-${width}x${height}-answer-end.png`);
      // Wheel on to the very bottom: Get free AIs (end of the order column) comes on screen and takes clicks.
      for (let i = 0; i < 30; i++) {
        await t.page.mouse.move(panel.x, panel.y);
        await t.page.mouse.wheel(0, 600);
        await t.page.waitForTimeout(100);
        if (await t.page.evaluate(() => { const v = document.getElementById("view"); return v.scrollTop + v.clientHeight >= v.scrollHeight - 2; })) break;
      }
      await t.page.waitForTimeout(400);
      await t.page.evaluate(() => document.getElementById("cc-get-free-expert")?.scrollIntoView({ block: "nearest" }));
      await t.page.waitForTimeout(300);
      const free = await onScreen(t.page, "#cc-get-free-expert");
      if (free.found) assert.ok(free.inside && free.top, `Get free AIs: ${JSON.stringify(free)}`);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}

// ---------- item 3: Simple chat keeps Send and the answer's buttons clear ----------

test("item 3a: Simple chat at 1366 x 800, after Send the chat box folds and the answer's Copy and Try again buttons are on top", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 800 });
  try {
    assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "simple");
    await t.page.click("#mf-chat"); // Just chat instead
    await sendAndWait(t, "Write a week of Instagram posts for my bakery");
    await t.page.waitForSelector("#cc-copy-main", { timeout: WAIT });
    await t.page.waitForSelector("#cc-v-again", { timeout: WAIT });
    await t.page.waitForTimeout(1500);
    // A slow runner folds the box and moves the answer up over a few seconds (CI 0.4.28 caught Copy under the box's Mic
    // at 1500 ms). Wait, with a real deadline, for the fold and for Copy to be the top element; the asserts below still decide.
    await t.page.waitForFunction(() => {
      const c = document.querySelector(".cmd.simple-chat"), el = document.getElementById("cc-copy-main");
      if (c?.dataset.fold !== "1" || !el) return false;
      const r = el.getBoundingClientRect();
      if (!(r.height > 0 && r.top >= 0 && r.bottom <= innerHeight)) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    }, null, { timeout: WAIT, polling: 250 }).catch(() => {});
    assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "simple");
    const fold = await t.page.evaluate(() => ({ fold: document.querySelector(".cmd.simple-chat")?.dataset.fold || "", box: Math.round(document.getElementById("orders").getBoundingClientRect().height) }));
    assert.equal(fold.fold, "1", "the chat box is folded after Send");
    assert.ok(fold.box <= 60, `the folded box is short (${fold.box}px)`);
    await shot(t, "simple-1366-answer-buttons.png");
    for (const sel of ["#cc-copy-main", "#cc-check", "#cc-v-again"]) {
      const r = await onScreen(t.page, sel);
      if (sel === "#cc-check" && !r.found) continue;
      assert.ok(r.found && r.inside && r.top, `${sel} is on top: ${JSON.stringify(r)}`);
    }
    // Clicking in the box opens it again for the next message.
    await t.page.click("#orders");
    await t.page.keyboard.type("And one more");
    await t.page.waitForFunction(() => !document.querySelector(".cmd.simple-chat")?.dataset.fold, null, { timeout: WAIT });
    assert.ok(await t.page.evaluate(() => document.getElementById("orders").getBoundingClientRect().height) > 50, "the box opens when the person types");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("item 3b: Simple chat at 390 x 844 shows Send on top without scrolling; the Talk bar is one row with no Stop", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const t = await bootNew({ theme, width: 390, height: 844 });
    try {
      assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "simple");
      await t.page.click("#mf-chat");
      await t.page.waitForSelector("#go", { timeout: WAIT });
      await t.page.waitForTimeout(1500);
      const scrolled = await t.page.evaluate(() => [document.getElementById("view").scrollTop, document.querySelector(".view-col").scrollTop]);
      assert.deepEqual(scrolled, [0, 0], "nothing was scrolled");
      for (const sel of ["#go", "#vo-mic", "#orders"]) {
        const r = await onScreen(t.page, sel);
        assert.ok(r.inside && r.top, `${theme} ${sel}: ${JSON.stringify(r)}`);
      }
      const bar = await t.page.evaluate(() => { const v = document.getElementById("vt-bar"); const s = document.getElementById("vt-stop"); return { talk: v.dataset.talk, h: Math.round(v.getBoundingClientRect().height), stop: !!s && s.getBoundingClientRect().height > 0, nav: Math.round(document.getElementById("mobile-nav").getBoundingClientRect().top), go: Math.round(document.getElementById("go").getBoundingClientRect().bottom) }; });
      assert.equal(bar.talk, "off");
      assert.ok(bar.h <= 48, `the Talk bar is one row (${bar.h}px)`);
      assert.equal(bar.stop, false, "Stop hides while Talk is off");
      assert.ok(bar.go <= bar.nav, `Send is above the bottom tabs (${bar.go} vs ${bar.nav})`);
      await shot(t, `simple-390-${theme}-chat.png`);
      // Send works from there.
      await t.page.fill("#orders", "One friendly line for my bakery");
      await t.page.click("#go");
      await t.page.waitForFunction(() => !!window.CC.S.live?.id, null, { timeout: WAIT });
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }
});

// ---------- item 4: the answer comes into view at 1024 x 768 ----------

test("item 4: Expert at 1024 x 768, after Send the answer card is brought into view", { skip }, async () => {
  const t = await bootNew({ theme: "light", width: 1024, height: 768 });
  try {
    await toExpert(t);
    await go(t, "command");
    assert.equal(await t.page.evaluate(() => document.getElementById("view").scrollTop), 0, "nothing moves before Send");
    await sendAndWait(t, "Plan a bake sale for Saturday with a full list of steps");
    const card = await t.page.evaluate(() => {
      const p = document.getElementById("deliv-panel"); const r = p.getBoundingClientRect(); const h = p.querySelector("h3").getBoundingClientRect();
      const hit = document.elementFromPoint(h.left + 40, h.top + h.height / 2);
      return { hidden: p.hidden, top: Math.round(r.top), headOnTop: !!hit && p.contains(hit), inner: innerHeight, ui: document.body.dataset.ui };
    });
    assert.equal(card.ui, "expert");
    assert.equal(card.hidden, false);
    assert.ok(card.top >= 0 && card.top < card.inner - 120, `the answer card is on screen (top ${card.top} of ${card.inner})`);
    assert.equal(card.headOnTop, true, "its heading is on top");
    await shot(t, "expert-1024x768-after-send.png");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 5: "Keep Expert here" survives a reload ----------

test("item 5: Keep Expert here is remembered for the project after a reload", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 800, mode: "simple", demo: false });
  try {
    const made = await t.api("/projects", { body: { name: "Bakery posts" } });
    const id = made.json?.id || made.json?.project?.id;
    assert.ok(id, made.text);
    assert.equal((await t.api("/projects", { body: { id, uiMode: "expert" } })).status, 200);
    await t.api("/settings", { body: { uiMode: "simple", uiModeChosen: true } });
    await t.page.evaluate((pid) => localStorage.setItem("cc.project", pid), id);
    const reload = async () => {
      await t.page.reload({ waitUntil: "domcontentloaded" });
      await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length && window.CC.S.settingsLoaded, null, { timeout: WAIT });
      await t.page.addStyleTag({ content: `${POPUPS},.toasts{display:none!important}` });
    };
    await reload();
    await t.page.waitForSelector("#cc-project-mode-note #cc-mode-keep", { timeout: WAIT });
    assert.equal(await t.page.textContent("#cc-mode-keep"), "Keep Expert here");
    await t.page.evaluate(() => document.getElementById("cc-mode-keep").click());
    await t.page.waitForFunction(() => !document.getElementById("cc-project-mode-note"), null, { timeout: WAIT });
    assert.equal(await t.page.evaluate((pid) => localStorage.getItem(`cc.keepModeNote:${pid}`), id), "expert");
    for (let i = 0; i < 2; i++) {
      await reload();
      await t.page.waitForTimeout(4000); // the Command view and its extras draw after load; the note must stay away
      const got = await t.page.evaluate(() => ({ note: !!document.getElementById("cc-project-mode-note"), project: window.CC.S.project, ui: document.body.dataset.ui }));
      assert.equal(got.project, id, "the remembered project is still active");
      assert.equal(got.ui, "expert", "the window still follows the project's own mode");
      assert.equal(got.note, false, `reload ${i + 1}: the note stays away`);
    }
    // A project with a different own mode is still told (the choice is per project and per mode).
    assert.equal((await t.api("/projects", { body: { id, uiMode: "simple" } })).status, 200);
    await t.api("/settings", { body: { uiMode: "expert", uiModeChosen: true, expertConfirmed: true } });
    await reload();
    await t.page.waitForSelector("#cc-project-mode-note", { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 6: Expert at 390 ----------

test("item 6: Expert at 390, Settings and Credits have nothing wider than the window; five bottom tabs; the dock folds on Projects", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const t = await bootNew({ theme, width: 390, height: 844 });
    try {
      await toExpert(t);
      for (const v of ["settings", "credits"]) {
        await go(t, v);
        await t.page.waitForTimeout(1500);
        const wide = await t.page.evaluate(() => {
          const W = innerWidth;
          const scrollsSideways = (el) => { for (let a = el.parentElement; a && a.id !== "view"; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth) return true; } return false; };
          return [...document.querySelectorAll("#view *")].filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && (r.right > W + 1 || r.width > W) && !scrollsSideways(e);
          }).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${String(e.className).split(" ")[0]} right ${Math.round(e.getBoundingClientRect().right)} "${e.textContent.trim().slice(0, 30)}"`);
        });
        assert.deepEqual(wide, [], `${theme} ${v}: nothing wider than the window`);
        await shot(t, `expert-390-${theme}-${v}.png`);
      }
      // Five tabs (Command, Projects, Credits, More, Settings), each label inside its tab, nothing off screen.
      const tabs = await t.page.evaluate(() => [...document.querySelectorAll("#mobile-nav button")].filter((b) => !b.hidden && b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.replace(/^\W+/, "").trim(), l: r.left, r: r.right, fit: b.scrollWidth <= b.clientWidth + 1 }; }));
      assert.deepEqual(tabs.map((x) => x.text), ["Command", "Projects", "Credits", "More", "Settings"]);
      assert.deepEqual(tabs.filter((x) => x.r > 390 || x.l < 0 || !x.fit).map((x) => x.text), [], "every tab is on screen with its label");
      // More holds Subscriptions, Live feed and Help, and Help opens the Help page.
      await t.page.click("#mobile-nav [data-more]");
      await t.page.waitForSelector("#mobile-more.open", { timeout: WAIT });
      const extra = await t.page.evaluate(() => [...document.querySelectorAll('#mobile-more [data-mgroup="pages"] button')].map((b) => b.textContent.replace(/^\W+/, "").trim()));
      assert.deepEqual(extra, ["Subscriptions", "Live feed", "Help"]);
      await t.page.click('#mobile-more [data-proxy="[data-view=\\"help\\"]"]');
      await t.page.waitForFunction(() => window.CC.S.view === "help", null, { timeout: WAIT });
      // The chat dock on Projects is just its box until tapped.
      await go(t, "projects");
      const dock = await t.page.evaluate(() => { const d = document.querySelector(".cc-dock"); return d ? Math.round(d.getBoundingClientRect().height) : 0; });
      assert.ok(dock <= 100, `${theme}: the dock is folded on Projects (${dock}px)`);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }
});

// ---------- item 7: Live ops word, toasts above the Talk bar, the Pro box at 390 ----------

test("item 7: the Live ops status word is whole at 1366 and toasts sit above the Talk bar", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 800, hideToasts: false });
  try {
    await toExpert(t);
    await go(t, "command");
    const ops = await t.page.evaluate(() => { const r = document.querySelector("#ops-panel.idle #ops-head"); if (!r) return null; return { text: r.textContent.trim(), cut: r.scrollWidth > r.clientWidth + 1, w: Math.round(r.getBoundingClientRect().width) }; });
    if (ops && ops.text) assert.equal(ops.cut, false, `Live ops status is not cut: ${JSON.stringify(ops)}`);
    await t.page.evaluate(() => window.CC.toast("Answer done · Free"));
    await t.page.waitForSelector("#toasts > *", { timeout: WAIT });
    const g = await t.page.evaluate(() => { const toast = document.querySelector("#toasts > *").getBoundingClientRect(); const bar = document.getElementById("vt-bar").getBoundingClientRect(); return { toastBottom: Math.round(toast.bottom), barTop: Math.round(bar.top), barH: bar.height }; });
    if (g.barH > 0) assert.ok(g.toastBottom <= g.barTop, `the toast is above the Talk bar ${JSON.stringify(g)}`);
    await shot(t, "expert-1366-toast.png");
  } finally { await t.close(); }
});

test("item 7: at 390 the That is a Pro feature box fits the screen with a Close button at the top", { skip }, async () => {
  const t = await bootNew({ theme: "light", width: 390, height: 844, demo: false });
  try {
    // Fill the free project allowance through the API, then ask for one more on screen.
    for (let k = 0; k < 8; k++) { const r = await t.api("/projects", { body: { name: `Room ${k}` } }); if (r.status === 402) break; }
    await go(t, "projects");
    await t.page.click("#view button:has-text('New project')");
    await t.page.waitForTimeout(800);
    await t.page.keyboard.type("One too many");
    await t.page.keyboard.press("Enter");
    await t.page.waitForSelector("#cc-upgrade .card", { timeout: WAIT });
    await t.page.waitForTimeout(600);
    const box = await t.page.evaluate(() => { const c = document.querySelector("#cc-upgrade .card").getBoundingClientRect(); return { top: Math.round(c.top), bottom: Math.round(c.bottom), h: Math.round(c.height) }; });
    assert.ok(box.top >= 0 && box.bottom <= 844, `the box fits the screen ${JSON.stringify(box)}`);
    assert.ok(box.h > 300, `the box is not cut to the Mac card size (${box.h}px)`);
    const close = await onScreen(t.page, "#cc-upgrade-x");
    assert.ok(close.inside && close.top, `Close is at the top and on top: ${JSON.stringify(close)}`);
    await shot(t, "pro-box-390-light.png");
    // Scrolled to the end of the box, Close is still there.
    await t.page.evaluate(() => { const c = document.querySelector("#cc-upgrade .card"); c.scrollTop = c.scrollHeight; });
    await t.page.waitForTimeout(300);
    const after = await onScreen(t.page, "#cc-upgrade-x");
    assert.ok(after.inside && after.top, `Close stays in view: ${JSON.stringify(after)}`);
    await t.page.click("#cc-upgrade-x");
    await t.page.waitForFunction(() => !document.getElementById("cc-upgrade"), null, { timeout: WAIT });
    // Item 11 (the blank-page sweep): after the 402 every other page still draws.
    for (const v of ["command", "history", "settings", "help", "credits"]) {
      await go(t, v);
      const text = await t.page.evaluate(() => document.getElementById("view").innerText.trim());
      assert.ok(text.length > 40 && !/^Loading/.test(text), `${v} drew its page: "${text.slice(0, 40)}"`);
    }
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- items 8, 9, 10 ----------

test("item 8: the media price line says the price once", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 860 });
  try {
    await toExpert(t);
    await go(t, "media");
    await t.page.waitForSelector("#md-prompt", { timeout: WAIT });
    await t.page.fill("#md-prompt", "Waves rolling in at sunset");
    await t.page.click("#md-est");
    await t.page.waitForFunction(() => /\$/.test(document.getElementById("md-est-out")?.textContent || ""), null, { timeout: WAIT });
    const line = await t.page.evaluate(() => document.getElementById("md-est-out").textContent.replace(/\s+/g, " ").trim());
    assert.equal((line.match(/\$\d/g) || []).length, 1, `one price: "${line}"`);
    assert.doesNotMatch(line, /≈/);
    assert.match(line, /about \$\d+\.\d\d with your own key/);
  } finally { await t.close(); }
  assert.doesNotMatch(read("web", "features", "media.js"), /md-est-out"\)\.innerHTML = `≈/);
});

test("item 9: the two light-theme lines are on a solid card and readable (Settings at 1366, Credits at 390)", { skip }, async () => {
  for (const [width, height, view, needle] of [[1366, 800, "settings", "Paste any API key"], [390, 844, "credits", "does not tell Meldmind its balance"]]) {
    const t = await bootNew({ theme: "light", width, height });
    try {
      await toExpert(t);
      await go(t, view);
      await t.page.waitForTimeout(1500);
      const found = await t.page.evaluate((needle) => {
        const el = [...document.querySelectorAll("#view *")].find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(needle)));
        if (!el) return false;
        el.scrollIntoView({ block: "center" });
        el.dataset.testLine = "1";
        return true;
      }, needle);
      if (!found) continue; // Credits shows this line only when an AI gives no balance
      await t.page.waitForTimeout(500);
      const got = await paintedContrast(t.page, "[data-test-line]", { max: 1 });
      assert.equal(got.length, 1, `${view}: measured`);
      assert.deepEqual(low(got), [], `${view} at ${width}`);
    } finally { await t.close(); }
  }
});

test("item 10: no text under 12 px on Command, Credits, Live view and Subscriptions in Expert (sidebar and feed included)", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 800 });
  try {
    await toExpert(t);
    for (const v of ["command", "credits", "liveview", "subscriptions"]) {
      await go(t, v);
      const small = await t.page.evaluate(() => [...document.querySelectorAll("#app *, #mac-side *")].filter((e) => !e.closest("svg") && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== "hidden" && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} ${getComputedStyle(e).fontSize} "${e.textContent.trim().slice(0, 20)}"`));
      assert.deepEqual(small.slice(0, 8), [], `${v}: text under 12 px`);
    }
  } finally { await t.close(); }
});

// ---------- source checks ----------

test("source: the fixes stay in place and add no dashes", () => {
  assert.match(read("web", "mac", "css", "inside.css"), /#app #view:has\(> \.cmd\) \{\s*overflow-x: hidden;\s*overflow-y: auto;/);
  assert.match(read("web", "mac", "css", "flow.css"), /\[data-fold="1"\] \.sc-box #orders/);
  assert.match(read("web", "app.js"), /foldSimpleBox\(true\);/);
  assert.match(read("web", "app.js"), /cc\.keepModeNote:/);
  for (const f of [["web", "mac", "css", "shell.css"], ["web", "mac", "css", "inside.css"], ["web", "mac", "css", "flow.css"], ["web", "mac", "parts", "flow.js"], ["web", "mac", "data", "flow.js"]]) {
    assert.equal(/[–—]/.test(read(...f)), false, `${f.join("/")} has no dashes`);
  }
});
