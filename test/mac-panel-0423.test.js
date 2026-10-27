// 0.4.23 panel: every row opens a real setting, and the drawer works in Simple and Expert.
// Pure data gets plain unit tests, the drawer gets a real browser with real waits.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LABELS } from "../web/nav.js";
import { SECTIONS, SIMPLE_BASICS, allRows, rowById, openKind, sectionsForMode, filterSections } from "../web/mac/data/panel.js";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const ROOT = path.join(import.meta.dirname, "..");
const DASH = /[\u2013\u2014]/;
const KINDS = ["view", "settings", "feature", "link", "mode"];

function webSources() {
  const out = [];
  const take = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) take(p);
      else if (/\.(js|html)$/.test(f.name)) out.push([path.relative(ROOT, p), fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n")]);
    }
  };
  take(path.join(ROOT, "web", "features"));
  for (const name of fs.readdirSync(path.join(ROOT, "web"))) {
    if (/\.(js|html)$/.test(name)) out.push([`web/${name}`, fs.readFileSync(path.join(ROOT, "web", name), "utf8").replace(/\r\n/g, "\n")]);
  }
  return out;
}

test("data: every section is non empty and every row has id, title, a plain line and one opener", () => {
  assert.ok(SECTIONS.length >= 9, "the FEATURE-MAP sections are all here");
  const rowIds = [], sectionIds = [];
  for (const s of SECTIONS) {
    assert.ok(s.id && s.title, "section needs an id and a title");
    assert.ok(Array.isArray(s.rows) && s.rows.length > 0, `empty section: ${s.title}`);
    assert.equal(DASH.test(s.title), false, s.title);
    sectionIds.push(s.id);
    for (const r of s.rows) {
      assert.ok(r.id && r.title && r.line, JSON.stringify(r));
      assert.equal(DASH.test(r.title + r.line), false, r.id);
      assert.equal(KINDS.includes(openKind(r)), true, `${r.id} needs one of ${KINDS.join(", ")}`);
      const extra = Object.keys(r.open).filter((k) => k !== openKind(r) && k !== "focus");
      assert.deepEqual(extra, [], `${r.id} opens exactly one thing`);
      assert.equal(r.line.includes("\n"), false, `${r.id} line is one plain line`);
      assert.ok(r.line.length <= 90, `${r.id} line stays short`);
      rowIds.push(r.id);
    }
  }
  assert.equal(new Set(rowIds).size, rowIds.length, "no duplicate row ids");
  assert.equal(new Set(sectionIds).size, sectionIds.length, "no duplicate section ids");
  for (const b of SIMPLE_BASICS) assert.ok(rowById(b.id), `basics row ${b.id}`);
});

test("data: every view row opens a page that nav.js has a label for", () => {
  const views = allRows().filter((r) => openKind(r) === "view");
  assert.ok(views.length > 0, "some rows are pages");
  const bad = views.filter((r) => !Object.prototype.hasOwnProperty.call(LABELS, r.open.view)).map((r) => `${r.id}:${r.open.view}`);
  assert.deepEqual(bad, []);
});

test("data: every row points at code that exists in web/", () => {
  const src = webSources();
  const has = (needle) => src.some(([, body]) => body.includes(needle));
  for (const r of allRows()) {
    const kind = openKind(r);
    if (kind === "feature") {
      const id = r.open.feature;
      const widget = src.find(([, body]) => new RegExp(`id:\\s*"${id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}"`).test(body) && /settings:\s*\{/.test(body));
      assert.ok(widget, `${r.id} -> settings widget ${id}`);
    } else if (kind === "settings") {
      assert.match(r.open.settings, /^(#|\[)/, r.id);
      if (r.open.settings.startsWith("#")) assert.ok(has(`id="${r.open.settings.slice(1)}"`), `${r.id} -> ${r.open.settings}`);
      else assert.ok(has(`data-feature='${r.open.settings.match(/data-feature='([^']+)'/)?.[1]}'`) || has(`data-feature="${r.open.settings.match(/data-feature='([^']+)'/)?.[1]}"`), r.id);
    } else if (kind === "link") {
      assert.ok(r.open.link.startsWith("#") && has(`id="${r.open.link.slice(1)}"`), `${r.id} -> ${r.open.link}`);
    } else if (kind === "mode") {
      assert.ok(r.open.mode === "toggle" || ["simple", "expert"].includes(r.open.mode), r.id);
      assert.ok(has('id="mode-simple"') && has('id="mode-expert"'), "the real Simple/Expert buttons exist");
    }
  }
});

test("data: Settings basics is a short list, Expert shows more rows", () => {
  const simple = sectionsForMode("simple");
  assert.equal(simple.length, 1);
  assert.equal(simple[0].id, "basics");
  assert.equal(simple[0].title, "Settings basics");
  assert.deepEqual(simple[0].rows.map((r) => r.id), SIMPLE_BASICS.map((b) => b.id));
  assert.equal(simple[0].rows[0].title, "Keys and connections");
  const expert = sectionsForMode("expert");
  assert.equal(expert.length, SECTIONS.length);
  const expertRows = expert.reduce((n, s) => n + s.rows.length, 0);
  assert.ok(expertRows > simple[0].rows.length, `${expertRows} expert rows over ${simple[0].rows.length} simple rows`);
  assert.equal(expertRows, allRows().length);
});

test("data: search keeps matching rows and drops empty sections", () => {
  const all = sectionsForMode("expert");
  assert.equal(filterSections(all, "").length, all.length);
  assert.equal(filterSections(all, null).length, all.length);
  const voice = filterSections(all, "voice orders");
  assert.deepEqual(voice.map((s) => s.id), ["voice"]);
  assert.deepEqual(voice[0].rows.map((r) => r.id), ["voice-orders"]);
  const byTitle = filterSections(all, "COST AND SPEED");
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0].rows.length, 4);
  assert.deepEqual(filterSections(all, "no such words at all"), []);
});

test("panel: opens from the bus, rows resolve, Escape closes", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  if (!t) return;
  const { page } = t;
  // The AI News card opens its own full screen sheet over the window. It is not what
  // this test looks at, so it stays out of the way the same way other popups do.
  await page.addStyleTag({ content: "#ea-news-overlay{display:none!important}" });
  const openPanel = () => page.evaluate(() => window.CC.mac.bus.emit("open", { panel: "settings" }));
  const waitOpen = () => page.waitForFunction(() => {
    const p = document.getElementById("mac-panel");
    return !!p && p.classList.contains("on") && p.getAttribute("aria-hidden") === "false";
  }, null, { timeout: 25000 });
  const waitClosed = () => page.waitForFunction(() => {
    const p = document.getElementById("mac-panel");
    return !!p && !p.classList.contains("on") && p.getAttribute("aria-hidden") === "true";
  }, null, { timeout: 25000 });
  const rowCount = () => page.evaluate(() => document.querySelectorAll("#mac-panel .mp-row").length);
  try {
    // The window starts in Simple (the seeded project is Simple): only Settings basics.
    await openPanel();
    await waitOpen();
    const simpleCount = await rowCount();
    assert.equal(simpleCount, SIMPLE_BASICS.length);
    assert.equal(await page.evaluate(() => document.querySelector("#mac-panel .mp-title")?.textContent || ""), "Settings basics");
    assert.equal(await page.evaluate(() => document.querySelector('#mac-panel [data-row="keys"] .mp-row-t')?.textContent || ""), "Keys and connections");

    // A basics row opens the real settings page and the drawer gets out of the way.
    await page.click('#mac-panel [data-row="keys"]');
    await page.waitForFunction(() => window.CC.S.view === "settings" && !!document.getElementById("settings-keys"), null, { timeout: 25000 });
    await waitClosed();

    // Switch to Expert with the real top bar button, the way a person does it.
    await page.evaluate(() => document.getElementById("mode-expert")?.click());
    await page.waitForFunction(() => window.CC.uiMode() === "expert", null, { timeout: 25000 });

    // Expert: every row of every section is on screen.
    await openPanel();
    await waitOpen();
    const expected = allRows().length;
    assert.equal(await rowCount(), expected);
    assert.ok(expected > simpleCount, `${expected} expert rows over ${simpleCount} simple rows`);
    assert.equal(await page.evaluate(() => document.querySelector("#mac-panel .mp-sec-t")?.textContent || ""), "Connections");

    // A row opens the real settings widget.
    await page.click('#mac-panel [data-row="tools-mcp"]');
    await page.waitForFunction(() => window.CC.S.view === "settings" && !!document.querySelector("[data-feature='mcp']"), null, { timeout: 25000 });
    await waitClosed();

    // Find my AIs is a page, opened the same way.
    await openPanel();
    await waitOpen();
    await page.click('#mac-panel [data-row="find-my-ais"]');
    await page.waitForFunction(() => window.CC.S.view === "setup", null, { timeout: 25000 });
    await waitClosed();

    // The search box narrows the list to one row.
    await openPanel();
    await waitOpen();
    await page.fill("#mac-panel [data-mp-find]", "license key");
    await page.waitForFunction(() => document.querySelectorAll("#mac-panel .mp-row").length === 1, null, { timeout: 25000 });
    assert.equal(await page.evaluate(() => document.querySelector("#mac-panel .mp-row")?.dataset.row || ""), "license-key");
    await page.fill("#mac-panel [data-mp-find]", "");
    await page.waitForFunction((n) => document.querySelectorAll("#mac-panel .mp-row").length === n, expected, { timeout: 25000 });

    // Escape closes the drawer.
    await page.keyboard.press("Escape");
    await waitClosed();

    assert.deepEqual(t.errors, []);
  } finally {
    await t.close();
  }
});
