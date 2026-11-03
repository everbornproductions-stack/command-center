// 0.5.1 (Chris): the History drawer reads like the Expert sidebar in Simple and Expert (no 16 px buttons next to 12 px
// labels), and the Expert sidebar no longer carries History in its middle.
// @helper-process
import test from "node:test";
import assert from "node:assert/strict";
import { findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = 30000;

for (const mode of ["simple", "expert"]) {
  test(`${mode}: the History drawer uses the Expert sidebar sizes (13 px rows, 12 px chips and group names)`, { skip }, async () => {
    const t = await bootMac({ width: 1366, height: 800, mode, theme: "light" });
    try {
      const p = t.page;
      await p.waitForFunction((m) => window.CC.mac && document.body.dataset.ui === m, mode, { timeout: WAIT });
      await p.evaluate(async () => {
        await window.CC.api("/demo", { method: "POST", body: { on: true } });
        await window.CC.api("/chat", { method: "POST", body: { prompt: "Weekly sermon copy" } });
      });
      await p.click("#mac-sidebtn");
      await p.waitForFunction(() => document.getElementById("mac-history-drawer")?.classList.contains("open"), null, { timeout: WAIT });
      // the row arrives once the chat is saved
      await p.waitForFunction(() => !!document.querySelector("#mac-history-drawer .mac-hist-item"), null, { timeout: WAIT, polling: 500 }).catch(async () => {
        await p.click("#mac-sidebtn"); await p.click("#mac-sidebtn");
        await p.waitForFunction(() => !!document.querySelector("#mac-history-drawer .mac-hist-item"), null, { timeout: WAIT, polling: 500 });
      });
      const sizes = await p.evaluate(() => {
        const px = (sel) => { const e = document.querySelector(`#mac-history-drawer ${sel}`); return e ? parseFloat(getComputedStyle(e).fontSize) : null; };
        return { item: px(".mac-hist-item"), chip: px(".mac-hist-chip"), group: px(".mac-hist-group-toggle, .mac-hist-group-label"), search: px(".mac-hist-search"), sideHistory: !!document.getElementById("mx-hist") };
      });
      assert.equal(sizes.item, 13, JSON.stringify(sizes));
      assert.equal(sizes.chip, 12, JSON.stringify(sizes));
      if (sizes.group !== null) assert.equal(sizes.group, 12, JSON.stringify(sizes));
      assert.equal(sizes.search, 13, JSON.stringify(sizes));
      assert.equal(sizes.sideHistory, false, "no History block in the Expert sidebar");
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}
