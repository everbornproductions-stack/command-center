// 0.4.36 (Chris: "you should be able to make the live feed area minimize to the side if you don't want to look at the
// feed the entire time"): Hide tucks the feed into a thin tab that counts new events; the tab brings it back; remembered.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";

test("the live feed tucks to the side, counts new events, comes back, and stays tucked after a reload", { skip }, async () => {
  const t = await bootMac({ width: 1440, height: 900, mode: "expert" });
  try {
    await t.page.evaluate(() => { try { localStorage.removeItem("cc.feed.min"); } catch {} document.getElementById("mac-expert")?.click(); });
    await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: 25000 });
    await t.page.evaluate(() => window.CC.go("command"));
    await t.page.waitForFunction(() => document.getElementById("feed")?.getBoundingClientRect().width > 200, null, { timeout: 20000 });
    const before = await t.page.evaluate(() => Math.round(document.getElementById("feed").getBoundingClientRect().width));
    await t.page.evaluate(() => document.getElementById("feed-min").click());
    await t.page.waitForFunction(() => document.body.classList.contains("feed-min"), null, { timeout: 5000 });
    const tucked = await t.page.evaluate(() => ({ w: Math.round(document.getElementById("feed").getBoundingClientRect().width), tab: !document.getElementById("feed-tab").hidden, list: getComputedStyle(document.getElementById("feed-list")).display }));
    assert.ok(tucked.w <= 60 && tucked.w < before, `tucked from ${before} to ${tucked.w}`);
    assert.equal(tucked.tab, true); assert.equal(tucked.list, "none");
    await t.page.evaluate(() => { const l = document.getElementById("feed-list"); for (let i = 0; i < 3; i++) l.appendChild(document.createElement("div")); });
    await t.page.waitForFunction(() => document.getElementById("feed-new").textContent === "3" && !document.getElementById("feed-new").hidden, null, { timeout: 5000 });
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC && document.body.classList.contains("feed-min"), null, { timeout: 25000 });
    await t.page.evaluate(() => document.getElementById("feed-tab").click());
    await t.page.waitForFunction(() => !document.body.classList.contains("feed-min") && document.getElementById("feed").getBoundingClientRect().width > 200, null, { timeout: 10000 });
  } finally { await t.close(); }
});
