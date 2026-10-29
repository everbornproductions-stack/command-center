// 0.4.26: the Expert inside gets the Chaos Engine paper look (Mac part "inside": web/mac/css/inside.css and
// web/mac/parts/inside.js; brief design-chaos-to-meldmind/BRIEF.md). Contrast is measured against the painted
// pixels; the frame (title bar, sidebar, dock, Talk bar, chat dock) and Simple mode are checked unchanged by
// comparing computed styles with the inside stylesheet on and off. Real server in demo mode and headless Chrome;
// skips only when no Chrome is installed. One browser at a time, and every test closes its browser and server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { paintedContrast } from "./paint-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,.toasts,#cc-look-offer";
const SCOPE = 'body[data-style="mac"][data-ui="expert"]';

// Boot as a new user does (Mac look on by default), wait for every Mac part.
async function bootNew(opts) {
  const t = await bootPage({ mac: "default", hidePopups: false, ...opts });
  if (!t) return null;
  try {
    await t.page.waitForFunction(() => window.CC.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    await t.page.waitForTimeout(1500);
    return t;
  } catch (e) { await t.close(); throw e; }
}
async function toExpert(t) {
  if (await t.page.evaluate(() => document.body.dataset.ui) !== "expert") {
    await t.page.click("#mac-expert");
    await t.page.waitForFunction(() => document.body.dataset.ui === "expert" && !document.getElementById("mac-side").hidden, null, { timeout: WAIT });
  }
  await t.page.waitForTimeout(800);
}
async function macTheme(t, theme) {
  if (await t.page.evaluate(() => document.body.dataset.theme) !== theme) await t.page.click("#mac-theme");
  await t.page.waitForFunction((th) => document.body.dataset.theme === th, theme, { timeout: WAIT });
  await t.page.waitForTimeout(400);
}
async function go(t, view) {
  await t.page.evaluate((v) => window.CC.go(v), view);
  await t.page.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view").children.length > 0, view, { timeout: WAIT });
  await t.page.waitForTimeout(900); // past the 0.3 s fade
}
const low = (list, min = 4.5) => list.filter((x) => x.ratio < min).map((x) => `${x.ratio} "${x.text}" fg ${x.fg} on ${x.bg}`);

// Computed styles of every element matching each selector, with the inside stylesheet on and then off.
async function stylesOnOff(page, selectors, props) {
  return page.evaluate(({ selectors, props }) => {
    const snap = () => {
      const out = {};
      for (const sel of selectors) {
        [...document.querySelectorAll(sel)].slice(0, 400).forEach((el, i) => {
          const cs = getComputedStyle(el);
          out[`${sel}#${i}`] = props.map((p) => `${p}=${cs.getPropertyValue(p)}`).join(" ");
        });
      }
      return out;
    };
    const link = document.querySelector('link[data-mac-css="inside"]');
    const on = snap();
    link.sheet.disabled = true;
    const off = snap();
    link.sheet.disabled = false;
    return { on, off, count: Object.keys(on).length };
  }, { selectors, props });
}
const diff = ({ on, off }) => Object.keys({ ...on, ...off }).filter((k) => on[k] !== off[k]).slice(0, 8).map((k) => `${k}\n  on:  ${on[k]}\n  off: ${off[k]}`);
const FRAME_PROPS = ["background-color", "background-image", "color", "border-top-color", "border-top-width", "border-radius", "font-size", "font-family", "font-weight", "padding-top", "padding-left", "height", "width", "backdrop-filter", "box-shadow", "opacity"];

// ---------- source ----------

test("source: the inside part is registered after panel, every rule is scoped to Mac + Expert, nothing names the frame", () => {
  const parts = read("web", "mac", "parts.js");
  const list = [...parts.matchAll(/^\s*"(\w+)",/gm)].map((m) => m[1]);
  assert.equal(list.at(-1), "inside", "inside is the last part");
  assert.equal(list.indexOf("inside"), list.indexOf("panel") + 1, "inside comes right after panel");

  const css = read("web", "mac", "css", "inside.css");
  const js = read("web", "mac", "parts", "inside.js");
  for (const [name, src] of [["inside.css", css], ["inside.js", js]]) assert.equal(/[–—]/.test(src), false, `${name} has no dashes`);
  // Every selector of every style rule (keyframes aside) starts with the Mac + Expert scope.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
  const preludes = [...bare.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].replace(/@media[^{]*\{/g, "").trim()).filter(Boolean);
  assert.ok(preludes.length > 60, `parsed ${preludes.length} rules`);
  const unscoped = [];
  for (const p of preludes) {
    for (const sel of p.split(/,(?![^(]*\))/).map((s) => s.trim())) {
      if (!sel.startsWith(SCOPE) && !sel.startsWith('body[data-style="mac"][data-ui="expert"]') && !sel.startsWith('body.light-mode[data-style="mac"][data-ui="expert"]')) unscoped.push(sel);
    }
  }
  assert.deepEqual(unscoped, [], "unscoped selectors");
  // The frame the brief keeps as it is: no rule names it.
  for (const name of ["#mac-titlebar", "#mac-side", "#mac-dock", "#mac-panel", "#mac-launchpad", ".cc-dock", "#cc-dock", "#vt-bar", "mx-side"]) {
    assert.equal(bare.includes(name), false, `inside.css does not name ${name}`);
  }
  // The theme comes from the Mac button (body[data-theme]) only, never the classic html[data-theme].
  assert.equal(/html\[data-theme/.test(bare), false, "no html[data-theme] in inside.css");
  // rem sizes for the type scale, so the text size setting still scales.
  assert.match(css, /--cx-fs-h1: 1\.5rem/);
  assert.match(css, /--cx-fs-body: \.875rem/);
});

// ---------- paper, theme and contrast ----------

const TEXT = [
  "#view .cx-head .cx-title", "#view .cx-head .cx-sub", "#view .panel > h3", "#view .panel > h3 .right", "#view .dim", "#view .muted", "#view .hint",
  "#view .btn.primary", "#view #go", "#view .btn:not(.primary)", "#view .chip", "#view .seg button", "#view label.lbl",
  "#view .kpi .k .v", "#view .kpi .k .l", "#view .kpi .k .s",
  "#app .feed .feed-head > span", "#app .feed .ev .who", "#app .feed .ev .txt", "#app .feed .ev .t",
  "#app .strip .tile .name", "#app .strip .tile .sub", "#app .strip .tile .badge",
  "#app .cx-notes .btn", "#app .cx-notes .pb-lbl-tools",
  "#mac-notices .dock-card b", "#mac-notices .dock-card .btn.primary",
].join(", ");

test("contrast: the Expert inside text is at least 4.5:1 on the painted pixels in dark and light (Command, Credits, Projects, Settings and four more)", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const t = await bootNew({ theme, width: 1440, height: 900 });
    try {
      await toExpert(t);
      await macTheme(t, theme);
      const seen = new Set();
      for (const v of ["command", "credits", "projects", "settings", "subscriptions", "liveview", "history", "agents"]) {
        await go(t, v);
        const list = await paintedContrast(t.page, TEXT, { max: 60 });
        assert.ok(list.length >= 6, `${theme} ${v}: measured ${list.length}`);
        list.forEach((x) => seen.add(x.text));
        assert.deepEqual(low(list), [], `${theme} ${v}`);
      }
      // The ones the brief names were really measured.
      for (const want of ["Command", "Credits", "Send orders", "API spend", "$0.00"]) {
        assert.ok([...seen].some((s) => s.startsWith(want)), `${theme}: measured "${want}"`);
      }
    } finally { await t.close(); }
  }
});

test("paper: the inside is opaque with no blur, and its theme follows the Mac button (body[data-theme]), not the classic theme", { skip }, async () => {
  // Classic theme light under a dark Mac window, then classic dark under a light Mac window.
  for (const [classic, mac, card, canvas] of [["light", "dark", "rgb(17, 24, 39)", "rgb(11, 15, 23)"], ["dark", "light", "rgb(255, 255, 255)", "rgb(249, 250, 251)"]]) {
    const t = await bootNew({ theme: classic, width: 1440, height: 900 });
    try {
      await toExpert(t);
      await macTheme(t, mac);
      await go(t, "credits");
      const got = await t.page.evaluate(() => {
        const cs = (sel, pseudo) => { const e = document.querySelector(sel); return e ? getComputedStyle(e, pseudo) : null; };
        return {
          html: document.documentElement.dataset.theme, body: document.body.dataset.theme,
          app: cs("#app").backgroundColor, appBlur: cs("#app", "::before").backdropFilter,
          panel: cs("#view .panel").backgroundColor, panelBlur: cs("#view .panel").backdropFilter,
          kpi: cs("#view .kpi .k").backgroundColor, kpiFont: cs("#view .kpi .k .v").fontFamily.split(",")[0].replace(/"/g, ""),
          kpiSize: cs("#view .kpi .k .v").fontSize, kpiWeight: cs("#view .kpi .k .v").fontWeight,
          feedBlur: cs("#app .feed").backdropFilter, stripBlur: cs("#app .strip").backdropFilter,
          icon: cs("#view .kpi .k", "::before").width,
        };
      });
      assert.equal(got.html, classic);
      assert.equal(got.body, mac);
      assert.equal(got.app, canvas, "opaque canvas in the Mac theme");
      assert.equal(got.panel, card, "cards follow the Mac theme");
      assert.equal(got.kpi, card);
      for (const k of ["appBlur", "panelBlur", "feedBlur", "stripBlur"]) assert.equal(got[k], "none", k);
      assert.deepEqual([got.kpiFont, got.kpiSize, got.kpiWeight, got.icon], ["Inter", "24px", "700", "40px"], "KPI value Inter 24/700 with a 40px icon square");
    } finally { await t.close(); }
  }
});

// ---------- the frame and Simple stay as they were ----------

test("frame: the title bar, sidebar, dock, Talk bar and chat dock compute the same with the inside part on and off", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const t = await bootNew({ theme, width: 1440, height: 900 });
    try {
      await toExpert(t);
      await macTheme(t, theme);
      for (const v of ["command", "chat"]) {
        await go(t, v);
        const sels = ["#mac-titlebar", "#mac-titlebar *", "#mac-side", "#mac-side .si", "#mac-side .grp", "#mac-dock", "#mac-dock *", "#vt-bar", "#vt-bar *", ".cc-dock", ".cc-dock *"];
        const r = await stylesOnOff(t.page, sels, FRAME_PROPS);
        assert.ok(r.count > 40, `${theme} ${v}: compared ${r.count} elements`);
        assert.deepEqual(diff(r), [], `${theme} ${v}: frame changed`);
      }
      assert.ok(await t.page.$("#view .cc-dock, #view #vt-bar") === null, "the Talk bar and chat dock stay outside #view");
    } finally { await t.close(); }
  }
});

test("Simple: nothing changes (computed styles the same with the inside part on and off), and no header, notice row or letter squares", { skip }, async () => {
  const t = await bootNew({ theme: "light", width: 1440, height: 900 });
  try {
    await t.page.waitForSelector("#mac-flow .mf-path", { timeout: WAIT });
    assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "simple");
    const sels = ["#mac-root *", "#app", "#app *"];
    const r = await stylesOnOff(t.page, sels, FRAME_PROPS);
    assert.ok(r.count > 100, `compared ${r.count} elements`);
    assert.deepEqual(diff(r), [], "Simple changed");
    // Expert and back: the header, notice row and letter squares go away again, and the bars are back where they were.
    await toExpert(t);
    await go(t, "command");
    assert.ok(await t.page.$("#view > .cx-head"), "Expert has the header");
    await t.page.click("#mac-simple");
    await t.page.waitForFunction(() => document.body.dataset.ui === "simple", null, { timeout: WAIT });
    await t.page.waitForTimeout(800);
    const left = await t.page.evaluate(() => ({
      head: document.querySelectorAll(".cx-head").length, notes: document.querySelectorAll(".cx-notes").length, av: document.querySelectorAll(".cx-av").length,
      barsHome: ["fpbar", "mmbar", "projbar"].map((id) => document.getElementById(id)).filter(Boolean).every((b) => b.parentElement.classList.contains("view-col")),
    }));
    assert.deepEqual(left, { head: 0, notes: 0, av: 0, barsHome: true });
    const again = await stylesOnOff(t.page, sels, FRAME_PROPS);
    assert.deepEqual(diff(again), [], "Simple changed after a trip to Expert");
  } finally { await t.close(); }
});

test("classic look (?mac=0): the inside part is not loaded and adds nothing", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 800, mode: "expert" });
  try {
    await t.page.waitForTimeout(1200);
    const got = await t.page.evaluate(() => ({ style: document.body.dataset.style || "", css: !!document.querySelector('link[data-mac-css="inside"]'), head: !!document.querySelector(".cx-head"), notes: !!document.querySelector(".cx-notes") }));
    assert.deepEqual(got, { style: "", css: false, head: false, notes: false });
  } finally { await t.close(); }
});

// ---------- page header ----------

test("header: Command, Projects, Credits and Settings get a page header that survives a redraw and never takes focus", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1440, height: 900 });
  try {
    await toExpert(t);
    const WANT = { command: "Command", projects: "Projects", credits: "Credits", settings: "Settings" };
    for (const [v, title] of Object.entries(WANT)) {
      await go(t, v);
      const first = () => t.page.evaluate(() => { const f = document.getElementById("view").firstElementChild; return f?.classList.contains("cx-head") ? f.querySelector(".cx-title")?.textContent : null; });
      assert.equal(await first(), title, `${v}: header first in #view`);
      // A redraw replaces #view; the header comes back on top, once.
      await t.page.evaluate(() => window.CC.render());
      await t.page.waitForTimeout(400);
      assert.equal(await first(), title, `${v}: header back after a redraw`);
      assert.equal(await t.page.evaluate(() => document.querySelectorAll("#view .cx-head").length), 1, `${v}: one header`);
    }
    // Projects: the page's own "+ New project" button sits in the header and still has its id.
    await go(t, "projects");
    assert.equal(await t.page.evaluate(() => !!document.querySelector("#view > .cx-head .cx-act #newp")), true, "New project in the header");
    // Command: the header buttons press the page's own buttons; focus stays where the person put it.
    await go(t, "command");
    await t.page.focus("#orders");
    await t.page.evaluate(() => { const d = document.createElement("div"); document.getElementById("view").appendChild(d); d.remove(); });
    await t.page.waitForTimeout(400);
    assert.equal(await t.page.evaluate(() => document.activeElement?.id), "orders", "focus stays in the orders box");
    const proxies = await t.page.evaluate(() => [...document.querySelectorAll("#view > .cx-head [data-cx-for]")].map((b) => [b.dataset.cxFor, b.textContent.trim(), b.hidden]));
    assert.deepEqual(proxies, [["preview", "Preview route", false], ["go", "Send orders", false]]);
    // The Finish, Momentum and Project tools bars sit in one notice row above the page.
    const notes = await t.page.evaluate(() => { const box = document.querySelector("#app .view-col > .cx-notes"); return box ? [...box.children].map((c) => c.id) : null; });
    if (notes) assert.ok(notes.every((id) => ["fpbar", "mmbar", "projbar"].includes(id)) && notes.length >= 1, `notice row holds ${notes}`);
    // The Mac look off and on again (stopMac): nothing of the part is left behind.
    const gone = await t.page.evaluate(async () => {
      const mod = await import("/mac/index.js");
      mod.stopMac(window.CC);
      const left = { head: document.querySelectorAll(".cx-head").length, notes: document.querySelectorAll(".cx-notes").length, newpHome: !!document.querySelector(".projects-grid #newp") || !document.getElementById("newp") };
      return left;
    });
    assert.deepEqual(gone, { head: 0, notes: 0, newpHome: true });
  } finally { await t.close(); }
});
