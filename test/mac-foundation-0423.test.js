// 0.4.23 foundation: the Mac layer is on by default (0.4.24), can be switched off, and loads every part when switched on.
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
  assert.deepEqual(PARTS, ["shell", "dock", "cards", "flow", "history", "expert", "runbar", "liveops", "panel", "inside"]); // 0.4.26 adds "inside" (Chaos paper for the Expert inside)
  for (const p of PARTS) {
    assert.ok(fs.existsSync(path.join(ROOT, "web", "mac", "parts", `${p}.js`)), p);
    assert.ok(fs.existsSync(path.join(ROOT, "web", "mac", "css", `${p}.css`)), p);
    assert.equal(/[\u2013\u2014]/.test(read("web", "mac", "parts", `${p}.js`) + read("web", "mac", "css", `${p}.css`)), false);
  }
  assert.match(read("web", "perf", "registry.js"), /\{ id: "mac", shell: true \}/);
});

test("on by default: no ?mac, no stored choice and no setting still mounts the Mac layer", { skip }, async () => {
  const t = await bootPage({ mode: "simple", mac: "default" });
  try {
    await t.page.waitForFunction(() => document.body.dataset.style === "mac" && window.CC.mac, null, { timeout: 30000 });
    const r = await t.page.evaluate(() => ({ style: document.body.dataset.style, ls: localStorage.getItem("cc.mac") }));
    assert.deepEqual(r, { style: "mac", ls: null });
  } finally { await t.close(); }
});

test("off when asked: ?mac=0, cc.mac=0 or uiStyle classic leave the old look", { skip }, async () => {
  const t = await bootPage({ mode: "simple", mac: "default" });
  try {
    const off = () => t.page.evaluate(() => ({ style: document.body.dataset.style || "", mac: !!window.CC.mac, root: !!document.getElementById("mac-root") }));
    const want = { style: "", mac: false, root: false };
    await t.page.goto(`${t.base}/?mac=0&nosplash`);
    await t.page.waitForFunction(() => window.CC && window.CC.S, null, { timeout: 20000 });
    await t.page.waitForTimeout(1500);
    assert.deepEqual(await off(), want);
    await t.page.evaluate(() => localStorage.setItem("cc.mac", "0"));
    await t.page.goto(`${t.base}/?nosplash`);
    await t.page.waitForFunction(() => window.CC && window.CC.S, null, { timeout: 20000 });
    await t.page.waitForTimeout(1500);
    assert.deepEqual(await off(), want);
    await t.page.evaluate(() => localStorage.removeItem("cc.mac"));
    const { macOn } = await t.page.evaluate(async () => ({ macOn: (await import("/mac/index.js")).macOn({ S: { settings: { uiStyle: "classic" } } }) }));
    assert.equal(macOn, false);
  } finally { await t.close(); }
});

test("on with cc.mac=1: every part mounts and the page has no errors", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  try {
    const r = await t.page.evaluate(() => ({ style: document.body.dataset.style, parts: Object.keys(window.CC.mac.parts), css: [...document.querySelectorAll("link[data-mac-css]")].map((l) => l.dataset.macCss) }));
    assert.equal(r.style, "mac");
    assert.equal(r.parts.length, 10);
    // One sheet per part, plus the inside part's second sheet (0.4.26: light Talk bar, chat dock and sidebar search colours).
    assert.deepEqual(r.css.sort(), [...r.parts, "inside-dock"].sort());
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
