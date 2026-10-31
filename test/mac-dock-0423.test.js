// 0.4.23 dock tests: data unit tests and browser tests.
import test from "node:test";
import assert from "node:assert/strict";
import { itemsFor, magnifyScale, DOCK_ITEMS } from "../web/mac/data/dock.js";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";

test("dock data: magnifyScale curve values", () => {
  assert.equal(magnifyScale(0), 88);
  assert.equal(magnifyScale(150), 54);
  assert.equal(magnifyScale(200), 54);
  assert.equal(magnifyScale(-50), 54 + 34 * (1 - 50/150));
});

test("dock data: itemsFor simple vs expert and valid actions", () => {
  const simple = itemsFor("simple");
  const simpleApps = simple.filter((i) => i.type !== "sep");
  assert.equal(simpleApps.length, 9);

  const expert = itemsFor("expert");
  const expertApps = expert.filter((i) => i.type !== "sep");
  assert.equal(expertApps.length, 11);

  for (const item of DOCK_ITEMS) {
    if (item.type === "sep") continue;
    assert.ok(item.id);
    assert.ok(item.label);
    assert.ok(item.icon);
    assert.ok(item.gradient);
    assert.ok(["path", "view", "open", "chat"].includes(item.action.type));
  }
});

test("dock browser: renders 9 items in simple, expert adds 2, clicking projects, history event, arrow keys", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  try {
    // 1. Renders 9 items in simple mode
    const countSimple = await t.page.evaluate(() => {
      return document.querySelectorAll("#mac-dock .di:not(.ex)").length;
    });
    assert.equal(countSimple, 9);

    // 2. Expert adds 2 items (switch to expert)
    await t.page.evaluate(() => {
      window.CC.S.uiMode = "expert"; // what the real toggle sets; a state tick re-renders the dock from it
      window.CC.mac.bus.emit("mode", "expert");
    });
    await t.page.waitForFunction(() => document.querySelectorAll("#mac-dock .di").length === 11, null, { timeout: 5000 });
    const countExpert = await t.page.evaluate(() => {
      return document.querySelectorAll("#mac-dock .di").length;
    });
    assert.equal(countExpert, 11);

    // Switch back to simple for remaining tests
    await t.page.evaluate(() => {
      window.CC.S.uiMode = "simple";
      window.CC.mac.bus.emit("mode", "simple");
    });

    // 3. Clicking Projects makes CC.S.view "projects"
    await t.page.evaluate(() => {
      const btn = document.querySelector('#mac-dock .di[data-action-target="projects"]');
      btn?.click();
    });
    await t.page.waitForFunction(() => window.CC.S.view === "projects", null, { timeout: 5000 });
    const viewAfterProjects = await t.page.evaluate(() => window.CC.S.view);
    assert.equal(viewAfterProjects, "projects");

    // 4. Clicking History emits open event on CC.mac.bus
    const histEmitted = await t.page.evaluate(async () => {
      return new Promise((resolve) => {
        const off = window.CC.mac.bus.on("open", (data) => {
          off();
          resolve(data);
        });
        const btn = document.querySelector('#mac-dock .di[data-action-target="history"]');
        btn?.click();
      });
    });
    assert.deepEqual(histEmitted, { panel: "history" });

    // 5. Arrow keys move focus
    const focusMoved = await t.page.evaluate(() => {
      const buttons = document.querySelectorAll("#mac-dock .di");
      buttons[0].focus();
      const activeBefore = document.activeElement;
      buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      const activeAfter = document.activeElement;
      return { before: activeBefore === buttons[0], after: activeAfter === buttons[1] };
    });
    assert.equal(focusMoved.before, true);
    assert.equal(focusMoved.after, true);

  } finally {
    await t.close();
  }
});
