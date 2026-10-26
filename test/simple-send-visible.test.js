// N1: in Simple chat the Send button must be inside the viewport and be the element at its own center,
// at laptop, desktop, phone and ultra-wide sizes. Real browser; skips only when no Chrome is installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";

const css = fs.readFileSync(path.join(import.meta.dirname, "..", "web", "styles.css"), "utf8").replace(/\r\n/g, "\n");

test("source: the Simple chat orders column has no height clip", () => {
  for (const line of css.split("\n")) {
    if (/\.cmd\.simple-chat\s+\.orders\b/.test(line)) assert.doesNotMatch(line, /max-height:\s*16rem/, line);
  }
  assert.match(css, /\.cmd\.simple-chat \.orders[^{]*\{[^}]*overflow:\s*visible/);
});

const SIZES = [[1366, 768], [1920, 1080], [390, 844], [3440, 1440]];
for (const [w, h] of SIZES) {
  test(`Simple chat: Send, Mic, Show AIs are reachable at ${w}x${h}`, { skip: findBrowser() ? false : "no Chrome installed" }, async () => {
    const t = await bootPage({ width: w, height: h, mode: "simple" });
    try {
      await goChat(t.page);
      await t.page.waitForFunction(() => window.CC.layout, null, { timeout: 15000 });
      await t.page.waitForSelector("#sc-team", { timeout: 10000 });
      const measure = (pairs) => t.page.evaluate((list) => {
        const out = {};
        for (const [k, sel] of list) {
          const b = document.querySelector(sel);
          if (!b) { out[k] = null; continue; }
          b.scrollIntoView({ block: "nearest" });
          const q = b.getBoundingClientRect();
          const el = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
          out[k] = { x: q.x, y: q.y, w: q.width, h: q.height, hit: el === b || b.contains(el), inView: q.top >= 0 && q.bottom <= innerHeight && q.left >= 0 && q.right <= innerWidth };
        }
        const box = document.querySelector("#orders").getBoundingClientRect();
        out.box = { w: box.width, h: box.height };
        return out;
      }, pairs);
      // Send and Mic are on the box itself.
      const r = await measure([["send", "#go"], ["mic", "#vo-mic"]]);
      // 0.4.21 (area H): "Show my AIs" is grouped behind the Auto team control, so open that first.
      await t.page.click("#sc-team");
      Object.assign(r, await measure([["ais", "#cc-show-ais"]]));
      for (const k of ["send", "mic", "ais"]) {
        assert.ok(r[k], `${k} exists`);
        assert.ok(r[k].inView, `${k} is inside the viewport at ${w}x${h}: ${JSON.stringify(r[k])}`);
        assert.ok(r[k].hit, `${k} is the element at its center at ${w}x${h}`);
      }
      if (w >= 3000) assert.ok(r.box.w >= 600, `ultra-wide chat box is wide enough, got ${r.box.w}`);
    } finally { await t.close(); }
  });
}
