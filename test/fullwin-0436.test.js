// 0.4.36: "Fill the window" (Chris, 2026-11-01: "like we have a window in a window basically? does it need to be like
// that?"). The Mac look now takes the whole app window by default, the dock is a slim bar on the bottom edge that hides
// after 2 s away and comes back at the bottom 8 px or on keyboard focus, and Settings > Look > Window style > Framed
// brings the 0.4.23 frame back. Real server and headless Chrome via bootMac; skips only when no Chrome is installed.
// Windows rules: one browser at a time, real waits with deadlines, every test closes its browser and server.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { windowStyle } from "../web/mac/data/shell.js";
import { autoHideOk, magnifyFor, DOCK_HIDE_MS, DOCK_EDGE_PX } from "../web/mac/data/dock.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(120000);
const HIDE = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer,.toasts{display:none!important}";

async function boot(width, height, opts = {}) {
  const t = await bootMac({ width, height, mode: "simple", theme: "light", ...opts });
  if (!t) return null;
  try {
    await t.page.addStyleTag({ content: HIDE });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.waitForFunction(() => !!document.body.dataset.macwin && typeof window.CC.mac.setWindowStyle === "function", null, { timeout: WAIT });
    return t;
  } catch (e) { await t.close(); throw e; }
}
const rect = (page, sel) => page.evaluate((sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), shown: r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none" };
}, sel);
const away = (page, on) => page.waitForFunction((on) => document.body.classList.contains("mac-dock-away") === on, on, { timeout: WAIT });

test("window style and dock data: fill is the default, framed is kept, no auto-hide on Framed, phones or touch", () => {
  assert.equal(windowStyle(undefined, null), "fill");
  assert.equal(windowStyle("framed", "fill"), "framed");
  assert.equal(windowStyle(undefined, "framed"), "framed");
  assert.equal(windowStyle("bogus", "bogus"), "fill");
  assert.equal(autoHideOk({ style: "fill", width: 1366 }), true);
  assert.equal(autoHideOk({ style: "framed", width: 1366 }), false);
  assert.equal(autoHideOk({ style: "fill", width: 390 }), false);
  assert.equal(autoHideOk({ style: "fill", width: 1366, touch: true }), false);
  assert.equal(DOCK_HIDE_MS, 2000);
  assert.equal(DOCK_EDGE_PX, 8);
  assert.equal(magnifyFor(500, 54), 54);
  assert.equal(magnifyFor(500, 42), 42);
  assert.ok(magnifyFor(0, 42) > 60 && magnifyFor(0, 42) < 70);
});

test("1366 x 800: the window fills the app window, the dock hides and comes back at the edge and on Tab", { skip, timeout: RUN }, async () => {
  const t = await boot(1366, 800);
  if (!t) return;
  try {
    const { page } = t;
    assert.equal(await page.evaluate(() => document.body.dataset.macwin), "fill", "new installs get Fill the window");
    assert.equal(await page.evaluate(() => localStorage.getItem("cc.mac.window")), "fill");
    const bar = await rect(page, "#mac-titlebar");
    assert.deepEqual([bar.l, bar.t, bar.w], [0, 0, 1366], `title bar ${JSON.stringify(bar)}`);
    assert.equal((await rect(page, ".mac-tl")).shown, false, "no pretend traffic lights");
    assert.ok(await page.evaluate(() => !!document.getElementById("mac-simple") && !!document.getElementById("mac-theme") && !!document.getElementById("mac-help")));
    // the Simple flow is the main work area on the home screen
    await page.waitForFunction(() => { const e = document.querySelector("#mac-flow"); return e && e.children.length > 0 && e.getBoundingClientRect().width > 0; }, null, { timeout: WAIT });
    const flow = await rect(page, "#mac-flow");
    assert.ok(flow.w >= 1300, `flow is ${flow.w} px wide`);
    assert.ok(flow.t <= 60, `flow starts ${flow.t} px from the top`);
    const app = await rect(page, "#app");
    assert.ok(app.w >= 1300 && app.t <= 60, `#app ${JSON.stringify(app)}`);
    const radius = await page.evaluate(() => getComputedStyle(document.getElementById("app")).borderBottomLeftRadius);
    assert.equal(radius, "0px");

    // the pointer away from the dock: it hides and the window body takes its band back
    await page.mouse.move(683, 300);
    await away(page, true);
    await page.waitForFunction(() => document.getElementById("mac-dock").getBoundingClientRect().top >= innerHeight - 1, null, { timeout: WAIT });
    // 0.4.37: the window takes the band back once the dock has finished sliding away (.28 s later), not at once
    await page.waitForFunction(() => Math.round(document.getElementById("app").getBoundingClientRect().bottom) === innerHeight, null, { timeout: WAIT });
    assert.equal((await rect(page, "#app")).b, 800);
    // the bottom edge: it comes back and the window body ends above it
    await page.mouse.move(683, 797);
    await away(page, false);
    await page.waitForFunction(() => Math.round(document.getElementById("mac-dock").getBoundingClientRect().bottom) <= innerHeight, null, { timeout: WAIT });
    const dock = await rect(page, "#mac-dock");
    assert.ok(dock.h <= 64 && dock.h >= 48, `dock is ${dock.h} px tall`);
    assert.ok((await rect(page, "#app")).b <= dock.t + 1, "nothing sits under the visible dock");
    assert.ok((await rect(page, "#mac-flow")).b <= dock.t + 1, "the Simple flow ends above the dock");
    const first = await page.evaluate(() => document.querySelector("#mac-dock .di")?.dataset.p);
    assert.equal(first, "Chat", "Chat stays first");
    // it stays while the pointer is on it
    await page.mouse.move(683, dock.t + 20);
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(() => document.body.classList.contains("mac-dock-away")), false);
    // away again, then a Tab moves focus into it and it shows (and stays while focus is inside)
    await page.mouse.move(683, 300);
    await away(page, true);
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.id = "fw-before"; b.textContent = "before";
      document.getElementById("mac-dock").before(b);
      b.focus();
    });
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.getElementById("mac-dock").contains(document.activeElement)), true, "Tab reaches the dock");
    await away(page, false);
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(() => document.body.classList.contains("mac-dock-away")), false, "keeps showing while it has focus");
    const focused = await rect(page, "#mac-dock .di:focus");
    assert.ok(focused && focused.b <= 800 && focused.t >= 700, `focused icon on screen ${JSON.stringify(focused)}`);
    await page.evaluate(() => document.getElementById("fw-before").focus());
    await away(page, true);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("1366 x 800: Window style Framed brings the old frame back and is remembered", { skip, timeout: RUN }, async () => {
  const t = await boot(1366, 800);
  if (!t) return;
  try {
    const { page } = t;
    const fill = await rect(page, "#app");
    // Settings > Look has the choice
    await page.evaluate(() => window.CC.openSettings("[data-feature='look']"));
    const hasRow = await page.waitForSelector("#look-window button[data-macwin='framed']", { timeout: WAIT }).then(() => true, () => false);
    if (hasRow) await page.click("#look-window button[data-macwin='framed']");
    else await page.evaluate(() => window.CC.mac.setWindowStyle("framed"));
    await page.waitForFunction(() => document.body.dataset.macwin === "framed", null, { timeout: WAIT });
    const bar = await rect(page, "#mac-titlebar");
    assert.deepEqual([bar.l, bar.t], [40, 22], `framed title bar ${JSON.stringify(bar)}`);
    assert.equal((await rect(page, ".mac-tl")).shown, true);
    const app = await rect(page, "#app");
    assert.equal(app.l, 40);
    assert.ok(app.b <= 800 - 100, `framed window leaves the dock band ${JSON.stringify(app)}`);
    assert.ok(fill.w - app.w >= 70, `fill ${fill.w} vs framed ${app.w}`);
    // the dock never hides in Framed
    await page.mouse.move(683, 300);
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(() => document.body.classList.contains("mac-dock-away")), false);
    assert.equal(await page.evaluate(() => localStorage.getItem("cc.mac.window")), "framed");
    await page.waitForFunction(() => window.CC.S.settings.macWindow === "framed", null, { timeout: WAIT });
    const saved = await t.api("/state");
    assert.equal(saved.json?.settings?.macWindow, "framed", "saved in the settings doc");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.CC?.mac && document.body.dataset.macwin, null, { timeout: WAIT });
    assert.equal(await page.evaluate(() => document.body.dataset.macwin), "framed", "kept after a restart");
    assert.ok(hasRow, "Settings > Look shows Window style");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("390 x 844: no sideways page scroll, the dock swipes sideways and does not hide", { skip, timeout: RUN }, async () => {
  const t = await boot(390, 844);
  if (!t) return;
  try {
    const { page } = t;
    assert.equal(await page.evaluate(() => document.body.dataset.macwin), "fill");
    await page.mouse.move(195, 300);
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(() => document.body.classList.contains("mac-dock-away")), false, "no auto-hide on a phone");
    const m = await page.evaluate(() => {
      const d = document.getElementById("mac-dock");
      const r = d.getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, vw: innerWidth, dsw: d.scrollWidth, dcw: d.clientWidth, ox: getComputedStyle(d).overflowX, b: Math.round(r.bottom), l: Math.round(r.left), first: d.querySelector(".di")?.dataset.p, firstL: Math.round(d.querySelector(".di").getBoundingClientRect().left) };
    });
    assert.ok(m.sw <= m.vw, `page scrolls sideways: ${m.sw} > ${m.vw}`);
    assert.equal(m.ox, "auto");
    assert.ok(m.dsw > m.dcw, `dock scrolls: ${m.dsw} vs ${m.dcw}`);
    assert.ok(m.b <= 844, `dock bottom ${m.b}`);
    assert.equal(m.first, "Chat");
    assert.ok(m.firstL >= 0, "Chat can be tapped");
    const app = await rect(page, "#app");
    const dock = await rect(page, "#mac-dock");
    assert.ok(app.b <= dock.t + 1, `window body ${app.b} ends above the dock ${dock.t}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
