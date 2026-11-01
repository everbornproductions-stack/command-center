// 0.4.29 (Chris: "there is a javascript error going on?"): a program error in the window is shown as a plain sentence,
// never raw, and the raw text goes to console.error so the desktop app writes it to its log.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";

test("the desktop app writes window errors to its log, at most once a minute each", () => {
  const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.match(main, /webContents\.on\("console-message"/);
  assert.match(main, /log\("window error:"/);
  assert.match(main, /< 60000\) return;/);
});

test("a raw program error shows a plain toast and is logged; a plain message passes through", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple" });
  try {
    const logged = [];
    t.page.on("console", (m) => { if (m.type() === "error" && /\[ui-error\]/.test(m.text())) logged.push(m.text()); });
    await t.page.evaluate(() => {
      document.querySelectorAll("#toasts > *").forEach((n) => n.remove());
      setTimeout(() => { const o = undefined; return o.thing; }, 0); // an uncaught TypeError from our own page
    });
    await t.page.waitForFunction(() => /Something on this screen did not work/.test(document.getElementById("toasts").textContent), null, { timeout: 10000 });
    const txt = await t.page.evaluate(() => document.getElementById("toasts").textContent);
    assert.doesNotMatch(txt, /Cannot read|TypeError|undefined/);
    assert.ok(logged.some((l) => /Cannot read properties of undefined/.test(l)), JSON.stringify(logged));
    await t.page.evaluate(() => { Promise.reject(new Error("The folder is full.")); });
    await t.page.waitForFunction(() => /The folder is full\./.test(document.getElementById("toasts").textContent), null, { timeout: 10000 });
  } finally { await t.close(); }
});
