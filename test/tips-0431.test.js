// 0.4.31 (Chris: "if you hover over an item.. it should have a small pop up on what it does? like single? council
// mission?"): hover or Tab to a control and a small box says what it does, in light and dark.
import test from "node:test";
import assert from "node:assert/strict";
import { tipFor, TIPS, SHOW_MS } from "../web/tips.js";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const EM = String.fromCharCode(0x2014);

test("tipFor: run modes get plain sentences, pages get their purpose, icon buttons their name", () => {
  assert.match(tipFor({ m: "single", groupId: "run-mode", title: "Best single AI for the job" }), /^Single: one AI answers\./);
  assert.match(tipFor({ m: "council", groupId: "mac-rb-modes" }), /^Council: several AIs answer/);
  assert.match(tipFor({ m: "mission", groupId: "simple-run-mode" }), /^Mission: Meldmind plans the job/);
  assert.match(tipFor({ m: "savings", groupId: "cost-mode" }), /^Max savings:/);
  assert.equal(tipFor({ title: "Opens Credits" }), "Opens Credits", "a control's own words win outside the known groups");
  assert.match(tipFor({ view: "credits", text: "Credits" }), /^Credits: what each AI has left/);
  assert.equal(tipFor({ label: "Close", text: "×" }), "Close", "an icon-only button says its name");
  assert.equal(tipFor({ label: "Send", text: "Send" }), "", "a button that already says it in words gets no echo");
  for (const [k, v] of Object.entries(TIPS)) assert.ok(!v.includes(EM), `no em-dash in ${k}`);
});

async function hoverTip(page, sel, repick = null) {
  // a bar can redraw just after a page opens; move away and hover again until the tip shows (up to 4 tries)
  let ok = false;
  for (let i = 0; i < 4 && !ok; i++) {
    if (i && repick) sel = (await repick()) || sel; // a redrawn bar has a new button: tag it again
    await page.mouse.move(5, 790);
    await page.hover(sel);
    // the tip must belong to this button (a slow runner can redraw the bar between the hover and the show)
    ok = await page.waitForFunction((s) => { const b = document.getElementById("cc-tip"); const el = document.querySelector(s); return b && !b.hidden && b.classList.contains("on") && b.textContent.length > 3 && el?.getAttribute("aria-describedby") === "cc-tip"; }, sel, { timeout: 4000 }).then(() => true, () => false);
  }
  assert.ok(ok, `a tip shows when hovering ${sel}`);
  return page.evaluate((s) => {
    const b = document.getElementById("cc-tip"); const r = b.getBoundingClientRect(); const el = document.querySelector(s);
    const cs = getComputedStyle(b);
    return { text: b.textContent, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, title: el.getAttribute("title"), described: el.getAttribute("aria-describedby"), color: cs.color, bg: cs.backgroundColor };
  }, sel);
}
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const theme of ["dark", "light"]) {
  test(`hovering Single, Council and Mission shows what each does (${theme}); it goes away, and Tab shows it too`, { skip }, async () => {
    const t = await bootMac({ width: 1366, height: 800, mode: "expert" });
    try {
      await t.page.evaluate((th) => { document.body.dataset.theme = th; document.documentElement.dataset.theme = th; }, theme);
      await t.page.evaluate(() => { document.getElementById("mac-expert")?.click(); });
      await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: 25000 });
      await t.page.evaluate(() => window.CC.go("command"));
      const pick = async (m) => t.page.evaluate((mm) => {
        const el = [...document.querySelectorAll(`[data-m="${mm}"]`)].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && b.closest("[role=group]"); });
        if (!el) return null; el.dataset.testTip = mm; return `[data-test-tip="${mm}"]`;
      }, m);
      await t.page.waitForFunction(() => [...document.querySelectorAll('[data-m="single"]')].some((b) => b.getBoundingClientRect().width > 0), null, { timeout: 20000 });
      for (const [m, re] of [["single", /^Single: one AI answers/], ["council", /^Council:/], ["mission", /^Mission:/]]) {
        const sel = await pick(m);
        assert.ok(sel, `a visible ${m} button`);
        const info = await hoverTip(t.page, sel, () => pick(m));
        assert.match(info.text, re);
        assert.ok(info.inView, "the tip is fully on screen");
        assert.equal(info.title, null, "the slow browser tooltip does not show as well");
        assert.equal(info.described, "cc-tip");
        assert.ok(ratio(info.color, info.bg) >= 4.5, `readable: ${info.color} on ${info.bg}`);
        await t.page.mouse.move(5, 790);
        await t.page.waitForFunction(() => document.getElementById("cc-tip").hidden, null, { timeout: 5000 });
      }
      // a sidebar page says what it is for
      const nav = await t.page.evaluate(() => { const b = [...document.querySelectorAll('button[data-view="credits"]:not([data-focus])')].find((x) => x.getBoundingClientRect().width > 0); if (!b) return null; b.dataset.testTip = "credits"; return '[data-test-tip="credits"]'; });
      if (nav) assert.match((await hoverTip(t.page, nav)).text, /^Credits:/);
      // keyboard: focus-visible shows it at once
      await t.page.mouse.move(5, 790);
      await t.page.evaluate(() => document.activeElement?.blur());
      const sel = await pick("council");
      await t.page.focus(sel); // programmatic focus after a key press counts as keyboard focus
      await t.page.keyboard.press("Shift"); await t.page.focus(sel);
      const shown = await t.page.waitForFunction(() => { const b = document.getElementById("cc-tip"); return b && !b.hidden && /^Council:/.test(b.textContent); }, null, { timeout: 5000 }).then(() => true, () => false);
      assert.ok(shown, "Tab to a button shows its tip");
      await t.page.keyboard.press("Escape");
      await t.page.waitForFunction(() => document.getElementById("cc-tip").hidden, null, { timeout: 5000 });
      assert.ok(SHOW_MS <= 500, "the hover delay is short");
    } finally { await t.close(); }
  });
}
