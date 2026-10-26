// F8/I16: nothing marked [hidden] may be visible on the main screens. Real browser; skips when no Chrome is installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";

const read = (...p) => fs.readFileSync(path.join(import.meta.dirname, "..", ...p), "utf8").replace(/\r\n/g, "\n");

test("source: .pill[hidden] is hidden even though .pill sets display", () => {
  assert.match(read("web", "styles.css"), /\.pill\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});

test("no [hidden] element is visible on the main screens", { skip: findBrowser() ? false : "no Chrome installed" }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "expert" });
  try {
    for (const view of ["command", "settings", "projects", "mindmedia"]) {
      await t.page.evaluate((v) => window.CC.go(v), view);
      await t.page.waitForTimeout(600);
      const bad = await t.page.evaluate(() => [...document.querySelectorAll("[hidden]")].filter((e) => {
        const cs = getComputedStyle(e);
        return cs.display !== "none" && cs.visibility !== "hidden" && e.getClientRects().length > 0;
      }).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${String(e.className).split(" ")[0]}`));
      assert.deepEqual(bad, [], `${view}: visible [hidden] elements`);
    }
  } finally { await t.close(); }
});
