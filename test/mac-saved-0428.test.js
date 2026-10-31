// 0.4.28 (Chris): "what happened to the little money saved on tokens that used to be up top?" The Mac look hides the
// classic top bar, so "You saved" is shown again in the Mac title bar, next to the ready pill, and opens Credits.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";

for (const theme of ["dark", "light"]) {
  test(`the Mac title bar shows money saved this month (${theme}) and a click opens Credits`, { skip }, async () => {
    const t = await bootMac({ width: 1366, height: 800, mode: "simple" });
    try {
      await t.page.evaluate((th) => { document.body.dataset.theme = th; }, theme);
      await t.page.waitForSelector("#mac-titlebar #cc-money-saved-mac", { state: "visible", timeout: 30000 });
      const info = await t.page.evaluate(() => {
        const b = document.getElementById("cc-money-saved-mac");
        const r = b.getBoundingClientRect();
        const ready = document.getElementById("mac-ready");
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { text: b.textContent, label: b.getAttribute("aria-label"), title: b.title, w: r.width, h: r.height,
          beforeReady: !!ready && (b.compareDocumentPosition(ready) & Node.DOCUMENT_POSITION_FOLLOWING) > 0, onTop: b.contains(top) };
      });
      assert.match(info.text, /Saved \$\d+\.\d{2}/);
      assert.match(info.label, /You saved \$\d+\.\d{2} this month\. All time \$\d+\.\d{2}\. Estimate\./);
      assert.match(info.title, /^All time \$/);
      assert.ok(info.w > 40 && info.h >= 20, JSON.stringify(info));
      assert.ok(info.beforeReady, "sits just before the ready pill");
      assert.ok(info.onTop, "not covered by anything");
      await t.page.click("#cc-money-saved-mac");
      await t.page.waitForFunction(() => window.CC.S.view === "credits", null, { timeout: 15000 });
    } finally { await t.close(); }
  });
}
