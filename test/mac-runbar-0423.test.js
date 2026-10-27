// 0.4.23 runbar tests: pure logic and browser behavior in Expert vs Simple.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";
import { RUN_MODES, PRIORITIES, costLine } from "../web/mac/data/runbar.js";

const skip = findBrowser() ? false : "no Chrome installed";
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("runbar data: RUN_MODES, PRIORITIES, costLine", () => {
  assert.ok(Array.isArray(RUN_MODES) && RUN_MODES.length >= 5);
  assert.deepEqual(PRIORITIES.map((p) => p.id), ["max", "quality", "balanced", "savings", "speed"]);
  assert.equal(costLine(0), "Free");
  assert.equal(costLine("free"), "Free");
  assert.equal(costLine(0.005), "Less than 1 cent");
  assert.equal(costLine(0.0099), "Less than 1 cent");
  assert.equal(costLine(0.03), "About 3 cents");
  assert.equal(costLine(1.5), "About $1.50");
  assert.equal(costLine("Custom"), "Custom");
});

test("source check: runbar part files exist, no em/en dashes, no observer, no direct CC.S writes", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "web/mac/data/runbar.js")));
  assert.ok(fs.existsSync(path.join(ROOT, "web/mac/parts/runbar.js")));
  assert.ok(fs.existsSync(path.join(ROOT, "web/mac/css/runbar.css")));
  const data = read("web", "mac", "data", "runbar.js");
  const part = read("web", "mac", "parts", "runbar.js");
  const css = read("web", "mac", "css", "runbar.css");
  assert.equal(/[\u2013\u2014]/.test(data + part + css), false);
  // The old bar observed document.body and repainted in a loop.
  assert.equal(/MutationObserver/.test(part), false);
  // The bar only clicks the real controls, it never writes state.
  assert.equal(/CC\.S\.[A-Za-z_$]+\s*=[^=]/.test(part), false);
});

test("browser: runbar exists in Expert command view, clicking Council updates state, absent in Simple", { skip }, async () => {
  const t = await bootMac({ mode: "expert" });
  try {
    // The saved mode can be overridden by the sample project, so switch with the real
    // button until the page is in Expert.
    await t.page.waitForFunction(() => {
      if (window.CC.S.uiMode === "expert") return true;
      document.querySelector("#mode-expert")?.click();
      return false;
    }, null, { timeout: 20000, polling: 700 });

    // 1. Command view in Expert shows the bar above #orders.
    await t.page.evaluate(() => window.CC.go("command"));
    await t.page.waitForFunction(() => {
      const bar = document.getElementById("mac-runbar");
      const orders = document.getElementById("orders");
      return !!orders && !!bar && bar.style.display !== "none" && bar.getBoundingClientRect().height > 0;
    }, null, { timeout: 20000 });

    // 2. Clicking Council in the bar clicks #run-mode, which sets CC.S.cmdMode.
    await t.page.click('#mac-runbar button[data-m="council"]');
    await t.page.waitForFunction(() => window.CC.S.cmdMode === "council", null, { timeout: 20000 });

    // 3. Choosing a priority clicks #cost-mode, which sets CC.S.costMode and marks the button.
    await t.page.selectOption("#mac-rb-priority", "max");
    await t.page.waitForFunction(() => window.CC.S.costMode === "max", null, { timeout: 20000 });
    const maxOn = await t.page.evaluate(() => document.querySelector('#cost-mode button[data-m="max"]')?.classList.contains("on") === true);
    assert.equal(maxOn, true);

    // 4. Simple mode hides the bar.
    // The Mac shell hides the old top bar, so use its Simple/Expert switch (it clicks #mode-simple).
    await t.page.click(await t.page.$("#mac-simple") ? "#mac-simple" : "#mode-simple");
    await t.page.waitForFunction(() => {
      const bar = document.getElementById("mac-runbar");
      return !bar || bar.style.display === "none" || bar.getBoundingClientRect().height === 0;
    }, null, { timeout: 20000 });

    assert.deepEqual(t.errors, []);
  } finally {
    await t.close();
  }
});
