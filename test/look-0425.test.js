// 0.4.25 look fixes from the 0.4.24 persona panel and audit (docs/plan-0.4.25.md items 1, 2, 3, 8, 10 and audit A1 to A3).
// Contrast is measured against the painted pixels (the text is hidden and its box is screenshotted), and every
// notice and bar is hit tested with elementFromPoint. Real server in demo mode and headless Chrome; skips only
// when no Chrome is installed. One browser at a time, and every test closes its browser and server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { paintedContrast, hitTest } from "./paint-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
// A failed update check every time: the update feed points at a closed local port, nothing leaves the PC.
const DEAD_FEED = { CC_UPDATE_FEED: "http://127.0.0.1:9/latest.json" };
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,.toasts";

// Boot exactly as a new user does (Mac look on by default), then wait for every Mac part.
async function bootNew(opts) {
  const t = await bootPage({ mac: "default", hidePopups: false, ...opts });
  if (!t) return null;
  try {
    await t.page.waitForFunction(() => window.CC.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.addStyleTag({ content: `${POPUPS}${opts.hideNotices ? ",#update-bar,#upd-fail,#cc-look-offer,#cc-expert-card" : ""}{display:none!important}` });
    await t.page.waitForTimeout(1500);
    return t;
  } catch (e) { await t.close(); throw e; }
}
async function toExpert(t) {
  if (await t.page.evaluate(() => document.body.dataset.ui) === "expert") return;
  await t.page.click("#mac-expert");
  await t.page.waitForFunction(() => document.body.dataset.ui === "expert" && !document.getElementById("mac-side").hidden, null, { timeout: WAIT });
  await t.page.waitForTimeout(800);
}
const low = (list, min = 4.5) => list.filter((x) => x.ratio < min).map((x) => `${x.ratio} "${x.text}" fg ${x.fg} on ${x.bg}`);
const covered = (hits) => hits.filter((h) => !h.ok).map((h) => `${h.text || h.sel} under ${h.top}`);

// ---------- source ----------

test("source: no dashes in the touched files; notices strip and the window body offset are in the shell", () => {
  for (const f of [["web", "mac", "css", "shell.css"], ["web", "mac", "parts", "shell.js"], ["web", "mac", "css", "flow.css"], ["web", "mac", "parts", "flow.js"], ["web", "mac", "css", "expert.css"], ["web", "look.css"], ["web", "features", "look.js"]]) {
    assert.equal(/[–—]/.test(read(...f)), false, f.join("/"));
  }
  const css = read("web", "mac", "css", "shell.css");
  assert.match(css, /#mac-notices \{/);
  // The window body (#app, #mac-main, sidebar, panel) starts below the notices.
  assert.ok((css.match(/var\(--mac-title-h\) \+ var\(--mac-note-h, 0px\)/g) || []).length >= 4);
  assert.match(read("web", "mac", "parts", "shell.js"), /getElementById\("notices"\)/);
  // "Use the 3 steps" is no longer pinned to the bottom-left corner.
  assert.doesNotMatch(read("web", "mac", "css", "flow.css"), /\.mf-return \{[^}]*position: fixed/);
  // The graphics offer can be closed without choosing.
  assert.match(read("web", "features", "look.js"), /aria-label", "Hide this"/);
});

// ---------- item 1: light sidebar headings ----------

test("item 1: Expert sidebar group headings are at least 4.5:1 in light and in dark", { skip }, async () => {
  for (const theme of ["light", "dark"]) {
    const t = await bootNew({ theme, width: 1366, height: 800, hideNotices: true });
    try {
      await toExpert(t);
      const heads = await paintedContrast(t.page, "#mac-side .grp", { max: 12 });
      assert.ok(heads.length >= 5, `${theme}: measured ${heads.length} headings`);
      assert.deepEqual(low(heads), [], `${theme} headings`);
      // White on the blue "on" row (Chat).
      const on = await paintedContrast(t.page, "#mac-side .si.on .mx-nm", { max: 2 });
      assert.deepEqual(low(on), [], `${theme} selected row`);
    } finally { await t.close(); }
  }
});

// ---------- item 2: Simple screen helper text ----------

const SIMPLE_TEXT = "#mac-flow .mf-sub, #mac-flow .mf-path small, #mac-flow .mf-steps li, #mac-flow .mf-chips-h, #mac-flow .mf-cost, #mac-flow .mf-crumb, #mac-flow .mf-link, #mac-flow .mf-back, #mac-flow .mf-go, #mac-toggle button, #mac-ready-txt, #mac-crumb, #mac-flow .card .d";

test("item 2: Simple screen helper text, step chips, the switch and white on blue are at least 4.5:1 (dark and light)", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const t = await bootNew({ theme, width: 1366, height: 800, hideNotices: true });
    try {
      await t.page.waitForSelector("#mac-flow .mf-path", { timeout: WAIT });
      const home = await paintedContrast(t.page, SIMPLE_TEXT, { max: 40 });
      assert.ok(home.some((x) => /A page for your business/.test(x.text)), `${theme}: card text measured`);
      assert.ok(home.some((x) => /^Next$/.test(x.text)), `${theme}: Next measured`);
      assert.ok(home.some((x) => /^Expert$/.test(x.text)), `${theme}: Expert switch measured`);
      assert.deepEqual(low(home), [], `${theme} home`);
      await t.page.click("#mac-flow .mf-path");
      await t.page.waitForFunction(() => window.CC.mac.flow.state.step === "style", null, { timeout: WAIT });
      await t.page.waitForTimeout(600);
      assert.deepEqual(low(await paintedContrast(t.page, SIMPLE_TEXT, { max: 40 })), [], `${theme} style step`);
    } finally { await t.close(); }
  }
});

// ---------- item 3, item 10, audit A1: notices in the Mac window ----------

test("item 3 + A1 + item 10: update and graphics notices sit inside the Mac window under the header and take clicks", { skip }, async () => {
  for (const [theme, width, height] of [["dark", 1366, 800], ["light", 1024, 768]]) {
    const t = await bootNew({ theme, width, height, env: DEAD_FEED });
    try {
      await t.api("/update/check", { method: "POST", body: {} });
      await t.page.waitForFunction(() => /Couldn't check for updates/.test(document.getElementById("notices")?.textContent || ""), null, { timeout: WAIT });
      // The graphics offer only shows on slow graphics; when the app did not show one, add a docked one the same shape.
      await t.page.evaluate(() => {
        if (document.getElementById("cc-look-offer")) return;
        const bar = document.createElement("div"); bar.id = "cc-look-offer"; bar.className = "docked"; bar.dataset.testOffer = "1";
        bar.innerHTML = '<span>Your graphics look a little slow for the new look. Use the classic look?</span><button class="btn sm">Yes</button><button class="btn sm">No</button><button class="ghost small cc-look-x" aria-label="Hide this">x</button>';
        document.getElementById("notices").appendChild(bar);
      });
      await t.page.waitForTimeout(800);
      const g = await t.page.evaluate(() => {
        const r = (el) => el.getBoundingClientRect();
        const strip = document.getElementById("mac-notices"), head = document.getElementById("mac-titlebar");
        return { inStrip: strip?.contains(document.getElementById("notices")), stripTop: r(strip).top, stripBottom: r(strip).bottom, headBottom: r(head).bottom, appTop: r(document.getElementById("app")).top, mainTop: r(document.getElementById("mac-main")).top, offerH: r(document.getElementById("cc-look-offer")).height };
      });
      assert.ok(g.inStrip, "the notice row is in the Mac window");
      assert.ok(g.stripTop >= g.headBottom - 1, `notices start under the header ${JSON.stringify(g)}`);
      assert.ok(g.appTop >= g.stripBottom - 1 && g.mainTop >= g.stripBottom - 1, `the page starts below the notices ${JSON.stringify(g)}`);
      // 0.4.27 (panel item 4): one notice shows at a time; the other waits behind "1 of 2" and a Next button.
      // (Until 0.4.26 both bars showed at once and this test counted five buttons on screen.)
      const hits = await hitTest(t.page, ["#mac-notices button", "#mac-notices a"]);
      assert.ok(hits.length >= 3, `found ${hits.length} notice buttons (the update notice's two and Next)`);
      assert.deepEqual(covered(hits), [], `${theme} ${width}: notice buttons`);
      assert.match(await t.page.evaluate(() => document.querySelector("#mac-notices .mac-note-count")?.textContent || ""), /^[12] of 2$/);
      // The update notice text is readable on the strip.
      assert.deepEqual(low(await paintedContrast(t.page, "#mac-notices b, #mac-notices #cc-look-offer > span", { max: 6 })), [], "notice text");
      // Hide closes the update notice, the graphics offer comes up in its place (one line, every button on top),
      // and closing that too moves the window body back up.
      await t.page.click("#mac-notices #upd-hide, #mac-notices #upd-fail button.ghost");
      await t.page.waitForFunction(() => getComputedStyle(document.getElementById("cc-look-offer")).visibility !== "hidden" && document.getElementById("cc-look-offer").getBoundingClientRect().height > 10, null, { timeout: WAIT });
      const offerH = await t.page.evaluate(() => document.getElementById("cc-look-offer").getBoundingClientRect().height);
      assert.ok(offerH <= 44, `the graphics offer is one line (${offerH}px)`);
      assert.deepEqual(covered(await hitTest(t.page, ["#mac-notices #cc-look-offer button"])), [], `${theme} ${width}: offer buttons`);
      assert.deepEqual(low(await paintedContrast(t.page, "#mac-notices #cc-look-offer > span", { max: 2 })), [], "offer text");
      await t.page.click("#mac-notices #cc-look-offer .cc-look-x");
      await t.page.waitForFunction(() => document.getElementById("app").getBoundingClientRect().top < 80, null, { timeout: WAIT });
    } finally { await t.close(); }
  }
});

test("item 3: the classic look (?mac=0) keeps the notice row above the page, visible and clickable", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 800, env: DEAD_FEED });
  try {
    await t.api("/update/check", { method: "POST", body: {} });
    await t.page.waitForFunction(() => /Couldn't check for updates/.test(document.getElementById("notices")?.textContent || ""), null, { timeout: WAIT });
    const where = await t.page.evaluate(() => ({ mac: document.body.dataset.style || "", parent: document.getElementById("notices").parentElement.className, strip: !!document.getElementById("mac-notices") }));
    assert.deepEqual(where, { mac: "", parent: "view-col", strip: false });
    assert.deepEqual(covered(await hitTest(t.page, ["#notices button", "#notices a"])), []);
  } finally { await t.close(); }
});

// ---------- item 8: "Use the 3 steps" ----------

test("item 8: \"Use the 3 steps\" has its own place in the title bar, clear of \"Settings and more\"", { skip }, async () => {
  for (const [width, height] of [[1366, 800], [390, 844]]) {
    const t = await bootNew({ theme: "dark", width, height });
    try {
      await t.page.click("#mf-chat");
      await t.page.waitForFunction(() => document.body.dataset.macFlow === "off" && !document.getElementById("mf-return").hidden, null, { timeout: WAIT });
      const g = await t.page.evaluate(() => {
        const ret = document.getElementById("mf-return"), r = ret.getBoundingClientRect();
        const side = document.getElementById("side-profile"), s = side?.getBoundingClientRect();
        const overlap = !!s && s.width > 0 && !(r.right <= s.left || r.left >= s.right || r.bottom <= s.top || r.top >= s.bottom);
        const tb = document.getElementById("mac-titlebar");
        return { inBar: tb.contains(ret), overlap, name: ret.getAttribute("aria-label") || ret.textContent, fits: tb.scrollWidth <= tb.clientWidth + 2 };
      });
      assert.deepEqual(g, { inBar: true, overlap: false, name: "Use the 3 steps", fits: true }, `${width}px`);
      assert.deepEqual(covered(await hitTest(t.page, ["#mac-titlebar button", "#side-profile"])), [], `${width}px title bar and sidebar footer`);
      assert.deepEqual(low(await paintedContrast(t.page, "#mf-return", { max: 1 })), [], "chip text");
      await t.page.click("#mf-return");
      await t.page.waitForFunction(() => document.body.dataset.macFlow === "on" && document.getElementById("mf-return").hidden, null, { timeout: WAIT });
    } finally { await t.close(); }
  }
});

// ---------- audit A2 / A3: bottom bars never cover controls ----------

test("A2 + A3: with notices showing, the Talk bar, chat dock and AI strip never cover a control (1024 x 768 Expert, 390 Simple)", { skip }, async () => {
  for (const [mode, theme, width, height] of [["expert", "dark", 1024, 768], ["simple", "light", 390, 844]]) {
    const t = await bootNew({ theme, width, height, env: DEAD_FEED });
    try {
      await t.api("/update/check", { method: "POST", body: {} });
      await t.page.waitForFunction(() => /Couldn't check for updates/.test(document.getElementById("notices")?.textContent || ""), null, { timeout: WAIT });
      if (mode === "expert") await toExpert(t);
      const bad = {};
      for (const v of ["command", "start", "projects", "images", "media", "settings"]) {
        await t.page.evaluate((v) => window.CC.go(v), v);
        await t.page.waitForTimeout(1000);
        const c = covered(await hitTest(t.page, ["button", "a[href]", "textarea", "input", "select"]));
        if (c.length) bad[v] = c.slice(0, 8);
      }
      assert.deepEqual(bad, {}, `${mode} ${theme} ${width}`);
    } finally { await t.close(); }
  }
});
