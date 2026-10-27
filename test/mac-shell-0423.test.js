// 0.4.23 shell: the Mac window frame, the title bar, the theme and the seven slots.
// Pure helpers get unit tests, the frame gets a real browser with real waits.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";
import { readyLine, crumbFor, modeBanner } from "../web/mac/data/shell.js";

const skip = findBrowser() ? false : "no Chrome installed";
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const SLOTS = ["mac-titlebar", "mac-side", "mac-main", "mac-flow", "mac-dock", "mac-launchpad", "mac-panel"];

const ai = (over = {}) => ({ id: "a", name: "Alpha", kind: "text", keyed: true, status: { status: "green" }, ...over });

test("unit: crumbFor takes the page label and falls back to Home", () => {
  const labels = { projects: "Projects", command: "Command" };
  assert.equal(crumbFor("projects", labels), "Projects");
  assert.equal(crumbFor("command", labels), "Command");
  assert.equal(crumbFor("nothing-here", labels), "Home");
  assert.equal(crumbFor("", labels), "Home");
  assert.equal(crumbFor(undefined, null), "Home");
});

test("unit: modeBanner says what each side of the switch gives you", () => {
  assert.equal(modeBanner("expert"), "Expert: every tool, Live Ops and settings");
  assert.equal(modeBanner("simple"), "Simple: pick, describe, done");
  assert.equal(modeBanner(undefined), "Simple: pick, describe, done");
  assert.equal(/[\u2013\u2014]/.test(modeBanner("expert") + modeBanner("simple")), false);
});

test("unit: readyLine counts the AIs you can use and the ones out of credits", () => {
  assert.equal(readyLine([]), "No AIs yet");
  assert.equal(readyLine(undefined), "No AIs yet");
  assert.equal(readyLine([ai(), ai({ id: "b" }), ai({ id: "c" })]), "3 ready");
  assert.equal(readyLine([ai(), ai({ id: "b", status: { status: "red", detail: "out of credits" } })]), "1 ready, 1 out of credits");
  assert.equal(readyLine([ai({ status: { status: "red", detail: "out of credits" } })]), "0 ready, 1 out of credits");
  // A saved key with no status light still counts as ready.
  assert.equal(readyLine([ai({ status: undefined })]), "1 ready");
  // Nothing connected, and media makers do not belong in the pill.
  assert.equal(readyLine([ai({ keyed: false, status: { status: "grey" } })]), "No AIs yet");
  assert.equal(readyLine([ai({ kind: "video" })]), "No AIs yet");
  assert.equal(/[\u2013\u2014]/.test(readyLine([ai()])), false);
});

test("source: shell.css is scoped to body[data-style=mac], carries the tokens, has no dashes", () => {
  const css = read("web", "mac", "css", "shell.css");
  const js = read("web", "mac", "parts", "shell.js");
  assert.equal(/[\u2013\u2014]/.test(css + js), false);
  for (const t of ["--mac-glass", "--mac-glass2", "--mac-line", "--mac-acc", "--mac-tx", "--mac-dim", "--mac-ok", "--mac-bad"]) {
    assert.ok(css.includes(t + ":"), t);
  }
  assert.ok(css.includes('[data-theme="dark"]'), "dark tokens");
  assert.ok(css.includes(".mac-noblur"), "solid fallback class");
  // Every rule opens with the Mac scope; @media lines only open a block.
  const openings = css.split("\n").map((l) => l.trim()).filter((l) => l.endsWith("{") && !l.startsWith("@media"));
  const unscoped = openings.filter((l) => !l.includes('body[data-style="mac"]'));
  assert.deepEqual(unscoped, [], "every selector is scoped");
});

test("with ?mac=0 nothing of the shell exists and the old buttons are untouched", { skip }, async () => {
  const t = await bootPage({ mode: "simple" });
  try {
    // The stored setting says on, the address says off, and the address wins.
    await t.page.evaluate(() => localStorage.setItem("cc.mac", "1"));
    await t.page.goto(`${t.base}/?mac=0&nosplash`);
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 20000 });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: 25000 });
    const r = await t.page.evaluate(() => ({
      style: document.body.dataset.style || "",
      root: !!document.getElementById("mac-root"),
      slots: ["mac-titlebar", "mac-side", "mac-main", "mac-flow", "mac-dock", "mac-launchpad", "mac-panel"].filter((id) => document.getElementById(id)).length,
      mode: !!document.getElementById("mode-expert"),
      topbar: getComputedStyle(document.querySelector(".topbar")).display,
    }));
    assert.deepEqual(r, { style: "", root: false, slots: 0, mode: true, topbar: "flex" });
  } finally { await t.close(); }
});

test("Mac on: #mac-root holds all seven slots, the old top bar is hidden but still there", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  try {
    const r = await t.page.evaluate((slots) => {
      const win = document.getElementById("app").getBoundingClientRect();
      const view = document.getElementById("view").getBoundingClientRect();
      const rows = getComputedStyle(document.getElementById("app")).gridTemplateRows.split(" ");
      return {
        slots: slots.every((id) => !!document.getElementById(id)),
        flowInMain: document.getElementById("mac-flow")?.parentElement?.id || "",
        modeButton: !!document.getElementById("mode-expert"),
        topbar: getComputedStyle(document.querySelector(".topbar")).display,
        title: document.querySelector(".mac-title b")?.textContent || "",
        crumb: document.getElementById("mac-crumb")?.textContent || "",
        inset: { left: Math.round(win.left), top: Math.round(win.top), gap: Math.round(innerHeight - win.bottom) },
        topRow: rows[0],
        viewInWin: view.top >= win.top - 1 && view.bottom <= win.bottom + 1 && view.height > 200,
        viewKids: document.getElementById("view").children.length,
      };
    }, SLOTS);
    assert.equal(r.slots, true, "all seven slots");
    assert.equal(r.flowInMain, "mac-main", "the flow overlays the window body");
    assert.equal(r.modeButton, true, "the old mode button is kept");
    assert.equal(r.topbar, "none", "the old top bar is hidden in Mac style only");
    assert.equal(r.title, "Meldmind");
    assert.ok(r.crumb.length > 0, "the crumb shows a page");
    assert.ok(r.inset.left >= 30 && r.inset.top >= 60 && r.inset.gap >= 90, `window is reframed: ${JSON.stringify(r.inset)}`);
    assert.ok(r.topRow === "0px" && r.viewInWin, `the old top bar row collapsed: ${JSON.stringify({ topRow: r.topRow, viewInWin: r.viewInWin })}`);
    assert.ok(r.viewKids > 0, "the page content was kept, not rebuilt");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("the switch moves the real mode, the theme flips, the crumb and Help follow the page", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  try {
    await t.page.evaluate(() => window.CC.go("projects"));
    await t.page.waitForFunction(() => document.getElementById("mac-crumb")?.textContent === "Projects", null, { timeout: 20000 });

    const pill = await t.page.evaluate(async () => {
      const m = await import("/mac/data/shell.js");
      return { shown: document.getElementById("mac-ready-txt").textContent, want: m.readyLine(window.CC.S.providers) };
    });
    assert.equal(pill.shown, pill.want, "the ready pill reads the real providers");

    const before = await t.page.evaluate(() => document.body.dataset.theme);
    await t.page.click("#mac-theme");
    await t.page.waitForFunction((was) => document.body.dataset.theme !== was, before, { timeout: 15000 });
    const saved = await t.page.evaluate(() => ({ theme: document.body.dataset.theme, key: localStorage.getItem("cc.mac.theme") }));
    assert.equal(saved.key, saved.theme, "the choice is remembered");

    await t.page.click("#mac-help");
    await t.page.waitForFunction(() => window.CC.S.view === "help", null, { timeout: 15000 });

    await t.page.click("#mac-expert");
    await t.page.waitForFunction(() => window.CC.uiMode() === "expert", null, { timeout: 25000 });
    const ex = await t.page.evaluate(() => ({
      pressed: document.getElementById("mac-expert").getAttribute("aria-pressed"),
      mode: document.getElementById("mac-toggle").dataset.mode,
      oldPressed: document.getElementById("mode-expert").getAttribute("aria-pressed"),
      flash: document.getElementById("mac-flash").textContent,
      live: document.body.dataset.ui,
    }));
    assert.deepEqual(ex, { pressed: "true", mode: "expert", oldPressed: "true", flash: "Expert: every tool, Live Ops and settings", live: "expert" });

    await t.page.click("#mac-simple");
    await t.page.waitForFunction(() => window.CC.uiMode() === "simple", null, { timeout: 25000 });
    const back = await t.page.evaluate(() => ({ pressed: document.getElementById("mac-simple").getAttribute("aria-pressed"), mode: document.getElementById("mac-toggle").dataset.mode }));
    assert.deepEqual(back, { pressed: "true", mode: "simple" });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("the sidebar button opens the side, talks on the bus, and Escape closes it", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  try {
    await t.page.evaluate(() => { window.__macOpen = []; window.CC.mac.bus.on("open", (d) => window.__macOpen.push(d)); });

    // In Simple it opens History.
    await t.page.click("#mac-sidebtn");
    await t.page.waitForFunction(() => document.body.classList.contains("mac-sideopen"), null, { timeout: 15000 });
    await t.page.waitForFunction(() => (window.__macOpen || []).length > 0, null, { timeout: 15000 });
    const simpleOpen = await t.page.evaluate(() => window.__macOpen[0]);
    assert.equal(simpleOpen.panel, "history");
    assert.equal(simpleOpen.open, true);

    await t.page.keyboard.press("Escape");
    await t.page.waitForFunction(() => !document.body.classList.contains("mac-sideopen"), null, { timeout: 15000 });

    // In Expert it opens the sidebar.
    await t.page.click("#mac-expert");
    await t.page.waitForFunction(() => window.CC.uiMode() === "expert", null, { timeout: 25000 });
    await t.page.click("#mac-sidebtn");
    await t.page.waitForFunction(() => (window.__macOpen || []).some((e) => e.panel === "sidebar"), null, { timeout: 15000 });
    const expertState = await t.page.evaluate(() => ({ open: document.body.classList.contains("mac-sideopen"), label: document.getElementById("mac-sidebtn").getAttribute("aria-label") }));
    assert.equal(expertState.open, true);
    assert.equal(expertState.label, "Show or hide the sidebar");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
