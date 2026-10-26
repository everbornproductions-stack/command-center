// N10: at 390 px no screen scrolls sideways, the header stays inside the screen, and the asset tray / look offer sit above the tab bar.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPage, findBrowser } from "./pw-helpers.js";

const SCREENS = ["command", "projects", "settings", "help"];
test("phone 390 px: no horizontal scroll on chat, projects, settings, help", { skip: findBrowser() ? false : "no Chrome installed" }, async () => {
  const t = await bootPage({ width: 390, height: 844, mode: "simple" });
  try {
    for (const v of SCREENS) {
      await t.page.evaluate((x) => window.CC.go(x), v);
      await t.page.waitForFunction((x) => window.CC.S.view === x, v, { timeout: 10000 }).catch(() => {});
      await t.page.waitForTimeout(300);
      const r = await t.page.evaluate(() => {
        const de = document.documentElement;
        const over = [...document.querySelectorAll("body *")].filter((e) => { const q = e.getBoundingClientRect(); return q.width && q.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed" && !e.closest("[hidden],.tabs,#tabs"); }).slice(0, 5).map((e) => (e.id || e.className || e.tagName).toString().slice(0, 40) + ":" + Math.round(e.getBoundingClientRect().right));
        return { sw: de.scrollWidth, cw: de.clientWidth, bsw: document.body.scrollWidth, over };
      });
      assert.ok(r.sw <= r.cw && r.bsw <= r.cw, `${v}: scrollWidth ${r.sw}/${r.bsw} > ${r.cw}; ${JSON.stringify(r.over)}`);
    }
  } finally { await t.close(); }
});

test("phone 390 px: header pills end inside the screen", { skip: findBrowser() ? false : "no Chrome installed" }, async () => {
  const t = await bootPage({ width: 390, height: 844, mode: "simple" });
  try {
    // The header squeezes itself in a later frame (fonts load slower on Windows), so wait for it to settle.
    const ends = () => ["#conn-pill", ".top-right"].map((q) => { const e = document.querySelector(q); return !e || getComputedStyle(e).display === "none" ? 0 : Math.round(e.getBoundingClientRect().right); });
    await t.page.waitForFunction((src) => new Function(`return (${src})()`)().every((x) => x <= 390), ends.toString(), { timeout: 8000 }).catch(() => {});
    const r = await t.page.evaluate(() => ["#conn-pill", ".top-right"].map((s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === "none") return null; return Math.round(e.getBoundingClientRect().right); }));
    for (const x of r) if (x != null) assert.ok(x <= 390, `header piece ends at ${x}`);
  } finally { await t.close(); }
});

import fs from "node:fs";
import path from "node:path";
test("source: asset tray and look offer clear the bottom tab bar on phones with 44 px targets", () => {
  const pm = fs.readFileSync(path.join(import.meta.dirname, "..", "web", "features", "projectmedia.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(pm, /@media \(max-width:760px\) \{ #cc-asset-tray \{[^}]*bottom:calc\(56px[^}]*\}[^}]*min-height:44px/);
  const lk = fs.readFileSync(path.join(import.meta.dirname, "..", "web", "look.css"), "utf8").replace(/\r\n/g, "\n");
  assert.match(lk, /@media \(max-width: 760px\) \{ #cc-look-offer \{[^}]*bottom: calc\(56px[^}]*\}[^}]*min-height: 44px/);
});
