// 0.4.28 (Chris: "the chat button does nothing? the one on the bottom of the screen with the scrolling buttons"):
// the dock's Chat button opens chat and puts the cursor in the box, in Simple and in Expert.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";

test("Simple: the dock's Chat button opens chat with the cursor in the box", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple" });
  try {
    await t.page.waitForSelector('#mac-dock .di[data-p="Chat"]', { state: "visible", timeout: 30000 });
    await t.page.click('#mac-dock .di[data-p="Chat"]');
    await t.page.waitForFunction(() => document.activeElement && document.activeElement.id === "orders", null, { timeout: 15000 });
    const info = await t.page.evaluate(() => {
      const o = document.getElementById("orders");
      const r = o.getBoundingClientRect();
      return { view: window.CC.S.view, visible: r.width > 50 && r.height > 10 && r.top >= 0 && r.bottom <= innerHeight + 1, pickShown: !!document.querySelector("#mf-paths:not([hidden])") && getComputedStyle(document.getElementById("mf-paths")).display !== "none" && document.getElementById("mf-paths").getBoundingClientRect().height > 0 };
    });
    assert.equal(info.view, "command");
    assert.ok(info.visible, JSON.stringify(info));
    assert.equal(info.pickShown, false, "the 3-step picker gives way to the chat");
  } finally { await t.close(); }
});

test("Expert: the dock's Chat button goes to Command with the cursor in the box", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "expert" });
  try {
    await t.page.evaluate(() => { document.getElementById("mac-expert")?.click(); });
    await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: 25000 });
    await t.page.evaluate(() => window.CC.go("credits"));
    await t.page.waitForFunction(() => window.CC.S.view === "credits", null, { timeout: 15000 });
    await t.page.click('#mac-dock .di[data-p="Chat"]');
    await t.page.waitForFunction(() => window.CC.S.view === "command" && document.activeElement && document.activeElement.id === "orders", null, { timeout: 15000 });
  } finally { await t.close(); }
});
