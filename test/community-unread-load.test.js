// 0.4.21 M-hub item 16 (audit U4): the unread poll starts when the page loads, with no click on
// Community. Real browser; skips only when no Chrome is installed.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPage, findBrowser } from "./pw-helpers.js";

test("the page asks for unread Community counts on load without opening Community", { skip: findBrowser() ? false : "no Chrome installed" }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple" });
  try {
    await t.page.waitForFunction(
      () => performance.getEntriesByType("resource").some((e) => /\/api\/community\/unread/.test(e.name)),
      null,
      { timeout: 15000 },
    );
    const view = await t.page.evaluate(() => window.CC.S.view);
    assert.notEqual(view, "community", "Community was never opened");
    assert.deepEqual(t.errors, [], "no page errors");
  } finally { await t.close(); }
});
