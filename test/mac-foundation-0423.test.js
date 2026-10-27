// 0.4.23 foundation: the Mac layer is off by default and loads every part when switched on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("source: parts list, one file and one css per part, registry row, no dashes", async () => {
  const { PARTS } = await import("../web/mac/parts.js");
  assert.deepEqual(PARTS, ["shell", "dock", "cards", "flow", "history", "expert", "runbar", "liveops", "panel"]);
  for (const p of PARTS) {
    assert.ok(fs.existsSync(path.join(ROOT, "web", "mac", "parts", `${p}.js`)), p);
    assert.ok(fs.existsSync(path.join(ROOT, "web", "mac", "css", `${p}.css`)), p);
    assert.equal(/[\u2013\u2014]/.test(read("web", "mac", "parts", `${p}.js`) + read("web", "mac", "css", `${p}.css`)), false);
  }
  assert.match(read("web", "perf", "registry.js"), /\{ id: "mac", shell: true \}/);
});

test("off by default: no Mac layer, body has no data-style", { skip }, async () => {
  const t = await bootPage({ mode: "simple" });
  try {
    await t.page.waitForTimeout(1500);
    const r = await t.page.evaluate(() => ({ style: document.body.dataset.style || "", mac: !!window.CC.mac, root: !!document.getElementById("mac-root") }));
    assert.deepEqual(r, { style: "", mac: false, root: false });
  } finally { await t.close(); }
});

test("on with cc.mac=1: every part mounts and the page has no errors", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  try {
    const r = await t.page.evaluate(() => ({ style: document.body.dataset.style, parts: Object.keys(window.CC.mac.parts), css: document.querySelectorAll("link[data-mac-css]").length }));
    assert.equal(r.style, "mac");
    assert.equal(r.parts.length, 9);
    assert.equal(r.css, 9);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
