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
