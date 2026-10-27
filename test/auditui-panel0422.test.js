// 0.4.22 audit page fixes: sidebar aria-current (S14), Finish drawer focus return (S20).
import test from "node:test";
import assert from "node:assert/strict";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(20000);

test("S14. the sidebar item for the open page carries aria-current=page and the others do not", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await goChat(t.page);
    const cur = () => t.page.evaluate(() => [...document.querySelectorAll("#cc-side [data-side][aria-current]")].map((e) => e.dataset.side + "=" + e.getAttribute("aria-current")));
    await t.page.waitForFunction(() => document.querySelector("#side-new")?.getAttribute("aria-current") === "page", null, { timeout: WAIT });
    assert.deepEqual(await cur(), ["new=page"]);
    await t.page.evaluate(() => window.CC.go("projects"));
    await t.page.waitForFunction(() => document.querySelector("#side-projects")?.getAttribute("aria-current") === "page", null, { timeout: WAIT });
    assert.deepEqual(await cur(), ["projects=page"]);
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("S20. closing the Finish drawer puts focus back on the button that opened it", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple" });
  try {
    await t.page.waitForFunction(() => typeof window.CC.saveToMindMedia === "function", null, { timeout: WAIT });
    await t.page.evaluate(async () => {
      await import("/features/finish-drawer.js");
      const b = document.createElement("button");
      b.id = "fd-opener"; b.type = "button"; b.textContent = "Finish";
      b.addEventListener("click", () => window.CC.openFinishDrawer({ kind: "text", text: "Spring sale.", name: "Spring sale" }));
      document.body.appendChild(b);
    });
    for (const how of ["close button", "Escape", "backdrop"]) {
      await t.page.click("#fd-opener");
      await t.page.waitForSelector(".fd");
      if (how === "close button") await t.page.click(".fd [data-x]");
      else if (how === "Escape") await t.page.keyboard.press("Escape");
      else await t.page.mouse.click(5, 5);
      await t.page.waitForFunction(() => !document.querySelector(".fd"), null, { timeout: WAIT });
      assert.equal(await t.page.evaluate(() => document.activeElement?.id), "fd-opener", how);
    }
    // an opener that never takes focus on click (as in some desktop webviews)
    await t.page.evaluate(() => { const o = document.querySelector("#fd-opener"); o.addEventListener("mousedown", (e) => e.preventDefault()); document.activeElement?.blur?.(); });
    await t.page.click("#fd-opener");
    await t.page.waitForSelector(".fd");
    await t.page.click(".fd [data-x]");
    await t.page.waitForFunction(() => !document.querySelector(".fd"), null, { timeout: WAIT });
    assert.equal(await t.page.evaluate(() => document.activeElement?.id), "fd-opener", "unfocused opener");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
