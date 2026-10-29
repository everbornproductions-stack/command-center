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
import { paintedContrast, ratio } from "./paint-helpers.js";

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
// sheets: which Mac part sheets to switch off ("inside" = inside.css, "inside-dock" = the light dock and search colours).
async function stylesOnOff(page, selectors, props, sheets = ["inside"]) {
  return page.evaluate(({ selectors, props, sheets }) => {
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
    const links = sheets.map((n) => document.querySelector(`link[data-mac-css="${n}"]`));
    if (links.some((l) => !l || !l.sheet)) return { on: {}, off: { missing: sheets.join(",") }, count: 0 };
    const on = snap();
    links.forEach((l) => { l.sheet.disabled = true; });
    const off = snap();
    links.forEach((l) => { l.sheet.disabled = false; });
    return { on, off, count: Object.keys(on).length };
  }, { selectors, props, sheets });
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

// inside.css alone never reaches the frame. The light colours of the Talk bar, chat dock and sidebar search come from
// the second sheet (inside-dock.css) and are checked in the "light dock" tests below.
test("frame: the title bar, sidebar, dock, Talk bar and chat dock compute the same with inside.css on and off", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const t = await bootNew({ theme, width: 1440, height: 900 });
    try {
      await toExpert(t);
      await macTheme(t, theme);
      for (const v of ["command", "chat"]) {
        await go(t, v);
        const sels = ["#mac-titlebar", "#mac-titlebar *", "#mac-side", "#mac-side .si", "#mac-side .grp", "#mac-dock", "#mac-dock *", "#vt-bar", "#vt-bar *", ".cc-dock", ".cc-dock *"];
        // The second sheet reads inside.css's tokens, so it is held off for both snapshots: this compares inside.css alone.
        const dockSheet = (off) => t.page.evaluate((o) => { const l = document.querySelector('link[data-mac-css="inside-dock"]'); if (l?.sheet) l.sheet.disabled = o; }, off);
        await dockSheet(true);
        const r = await stylesOnOff(t.page, sels, FRAME_PROPS).finally(() => dockSheet(false));
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
    const BOTH = ["inside", "inside-dock"];
    const r = await stylesOnOff(t.page, sels, FRAME_PROPS, BOTH);
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
    const again = await stylesOnOff(t.page, sels, FRAME_PROPS, BOTH);
    assert.deepEqual(diff(again), [], "Simple changed after a trip to Expert");
  } finally { await t.close(); }
});

test("classic look (?mac=0): the inside part is not loaded and adds nothing", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 800, mode: "expert" });
  try {
    await t.page.waitForTimeout(1200);
    const got = await t.page.evaluate(() => ({ style: document.body.dataset.style || "", css: !!document.querySelector('link[data-mac-css="inside"]'), dockCss: !!document.querySelector('link[data-mac-css="inside-dock"]'), head: !!document.querySelector(".cx-head"), notes: !!document.querySelector(".cx-notes") }));
    assert.deepEqual(got, { style: "", css: false, dockCss: false, head: false, notes: false });
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
      const left = { head: document.querySelectorAll(".cx-head").length, notes: document.querySelectorAll(".cx-notes").length, newpHome: !!document.querySelector(".projects-grid #newp") || !document.getElementById("newp"), sheets: document.querySelectorAll('link[data-mac-css^="inside"]').length };
      return left;
    });
    assert.deepEqual(gone, { head: 0, notes: 0, newpHome: true, sheets: 0 });
  } finally { await t.close(); }
});

// ---------- 0.4.26 polish: light Talk bar, chat dock, sidebar search, strip labels, notice row ----------

const DOCK_SCOPE = 'body[data-style="mac"][data-ui="expert"][data-theme="light"]';
// Colour-only properties: nothing here can move or resize anything.
const COLOUR_PROPS = new Set(["color", "background", "background-color", "border-color", "border-top-color", "box-shadow", "filter", "caret-color", "color-scheme", "opacity", "outline", "outline-offset"]);

test("source: inside-dock.css is light only, scoped to Mac + Expert, colour only, and loaded and removed by the inside part", () => {
  const css = read("web", "mac", "css", "inside-dock.css");
  const js = read("web", "mac", "parts", "inside.js");
  assert.equal(/[–—]/.test(css), false, "no dashes");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(rules.length > 15, `parsed ${rules.length} rules`);
  const unscoped = [], layout = [];
  for (const [, prelude, body] of rules) {
    for (const sel of prelude.split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean)) if (!sel.startsWith(DOCK_SCOPE)) unscoped.push(sel);
    for (const decl of body.split(";").map((d) => d.trim()).filter(Boolean)) {
      const prop = decl.slice(0, decl.indexOf(":")).trim();
      if (!prop.startsWith("--") && !COLOUR_PROPS.has(prop)) layout.push(decl);
    }
  }
  assert.deepEqual(unscoped, [], "every selector is light + Mac + Expert");
  assert.deepEqual(layout, [], "colour-only declarations");
  assert.equal(/@media|@import/.test(bare), false, "no media queries or imports");
  assert.match(js, /\/mac\/css\/inside-dock\.css/);
  assert.match(js, /macCss = "inside-dock"/, "tagged so stopMac removes it");
});

// Boot in demo mode (three pretend AIs fill the status strip), Expert, Mac theme as asked.
async function bootDemo(theme) {
  const t = await bootPage({ mac: "default", hidePopups: false, theme, width: 1440, height: 900 });
  if (!t) return null;
  try {
    await t.api("/demo", { body: { on: true } });
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC && window.CC.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    await t.page.waitForTimeout(1500);
    await toExpert(t);
    await macTheme(t, theme);
    return t;
  } catch (e) { await t.close(); throw e; }
}

// Contrast of a typing field's placeholder (or typed text) against the pixels painted behind it.
async function fieldContrast(page, sel, kind) {
  const box = await page.evaluate(({ sel, kind }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "nearest" });
    if (kind === "text") el.value = "Plan the launch";
    const cs = getComputedStyle(el);
    const fg = getComputedStyle(el, kind === "placeholder" ? "::placeholder" : null).color;
    const r = el.getBoundingClientRect();
    const x = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const y = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
    el.dataset.ccField = "1";
    return { fg, x: Math.floor(x), y: Math.floor(y), w: Math.max(40, Math.min(220, Math.floor(r.right - x - 8))), h: Math.max(8, Math.min(18, Math.floor(r.bottom - y - 2))) };
  }, { sel, kind });
  if (!box) return null;
  await page.addStyleTag({ content: "[data-cc-field].cc-field-hide, [data-cc-field].cc-field-hide::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; }" });
  await page.evaluate(() => document.querySelector("[data-cc-field]").classList.add("cc-field-hide"));
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h }, animations: "disabled" });
  const bg = await page.evaluate(async ({ b64, kind }) => {
    const el = document.querySelector("[data-cc-field]");
    el.classList.remove("cc-field-hide");
    delete el.dataset.ccField;
    if (kind === "text") el.value = "";
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
    const L = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    px.sort((p, q) => L(p) - L(q));
    return px[Math.floor(px.length / 2)];
  }, { b64: png.toString("base64"), kind });
  const m = box.fg.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const fg = [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + bg[k] * (1 - a)));
  return { text: `${sel} ${kind}`, fg, bg, ratio: Math.round(ratio(fg, bg) * 100) / 100 };
}

test("light dock: chat input text and placeholder, Send, the Talk bar, the sidebar search and the strip labels are at least 4.5:1 on the painted pixels", { skip }, async () => {
  const t = await bootDemo("light");
  try {
    await go(t, "projects"); // the chat dock shows under Projects
    await t.page.waitForSelector(".cc-dock:not([hidden]) #cc-dock-input", { timeout: WAIT });
    await t.page.waitForSelector("#vt-bar .vt-state", { timeout: WAIT });
    await t.page.waitForSelector("#app .strip .tile .badge", { timeout: WAIT });
    // The dock is light now: a white card, not the old navy, and Send is solid blue with white words.
    const bg = await t.page.evaluate(() => [getComputedStyle(document.querySelector(".cc-dock")).backgroundColor, getComputedStyle(document.getElementById("vt-bar")).backgroundColor, getComputedStyle(document.getElementById("cc-dock-send")).backgroundColor, getComputedStyle(document.getElementById("cc-dock-send")).color]);
    assert.deepEqual(bg, ["rgb(255, 255, 255)", "rgb(255, 255, 255)", "rgb(10, 111, 214)", "rgb(255, 255, 255)"], "dock, Talk bar and Send colours");

    const fields = [];
    for (const [sel, kind] of [["#cc-dock-input", "placeholder"], ["#cc-dock-input", "text"], ["#mac-side .mx-srch", "placeholder"], ["#mac-side .mx-srch", "text"]]) {
      const r = await fieldContrast(t.page, sel, kind);
      assert.ok(r, `${sel} found`);
      fields.push(r);
    }
    assert.deepEqual(low(fields), [], "typing fields");

    const send = await paintedContrast(t.page, "#cc-dock-send", { max: 1 });
    assert.equal(send.length, 1, "Send measured");
    const talk = await paintedContrast(t.page, "#vt-bar .vt-state, #vt-bar .vt-strip, #vt-bar label, #vt-bar .btn, #vt-bar .vt-line", { max: 12 });
    assert.ok(talk.some((x) => x.text.startsWith("Talk")), "Talk bar measured");
    const dock = await paintedContrast(t.page, ".cc-dock .dock-ctx, .cc-dock .dock-chip, .cc-dock .btn, .cc-dock .ghost, .cc-dock .dock-toggle, .cc-dock .dock-modes button", { max: 20 });
    assert.ok(dock.some((x) => x.text === "Council"), "mode chips measured");
    const strip = await paintedContrast(t.page, "#app .strip .tile .name, #app .strip .tile .sub, #app .strip .tile .badge", { max: 20 });
    assert.ok(strip.some((x) => x.text === "Connected"), "strip labels measured");
    assert.deepEqual(low([...send, ...talk, ...dock, ...strip]), [], "dock, Talk bar and strip");
    // No monospace left on the strip tiles.
    const mono = await t.page.evaluate(() => [...document.querySelectorAll("#app .strip .tile :is(.sub, .badge)")].filter((e) => /mono/i.test(getComputedStyle(e).fontFamily)).length);
    assert.equal(mono, 0, "strip sub lines and labels use Inter");
  } finally { await t.close(); }
});

// Every box in the Talk bar and the chat dock, as numbers.
const dockBoxes = (page) => page.evaluate(() => [...document.querySelectorAll(".cc-dock, .cc-dock *, #vt-bar, #vt-bar *")].map((e) => {
  const r = e.getBoundingClientRect();
  return `${e.id || e.className || e.tagName} ${[r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10).join(",")}`;
}));
const LAYOUT_PROPS = ["display", "position", "width", "height", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-bottom", "border-top-width", "border-left-width", "border-radius", "font-size", "font-family", "font-weight", "line-height", "gap", "flex-wrap"];
const COLOUR_CHECK = ["background-color", "background-image", "color", "border-top-color", "border-left-color", "box-shadow", "opacity", "filter", "caret-color"];

test("light dock: same boxes in light and dark (colour only), and the dark Talk bar and chat dock colours are unchanged", { skip }, async () => {
  const t = await bootDemo("dark");
  try {
    await go(t, "projects");
    await t.page.waitForSelector(".cc-dock:not([hidden]) #cc-dock-input", { timeout: WAIT });
    await t.page.waitForSelector("#vt-bar .vt-state", { timeout: WAIT });
    const SELS = [".cc-dock", ".cc-dock *", "#vt-bar", "#vt-bar *"];
    // Dark: the new sheet changes nothing at all.
    const dark = await stylesOnOff(t.page, SELS, [...COLOUR_CHECK, ...LAYOUT_PROPS], ["inside-dock"]);
    assert.ok(dark.count > 25, `dark: compared ${dark.count} elements`);
    assert.deepEqual(diff(dark), [], "dark Talk bar and chat dock unchanged");
    const darkBoxes = await dockBoxes(t.page);

    await macTheme(t, "light");
    await t.page.waitForTimeout(500);
    const lightBoxes = await dockBoxes(t.page);
    assert.ok(darkBoxes.length > 25, `compared ${darkBoxes.length} boxes`);
    assert.deepEqual(lightBoxes, darkBoxes, "the dock's boxes are identical in light and dark");
    // Light: the sheet changes colours only, never a size or a place.
    const light = await stylesOnOff(t.page, SELS, LAYOUT_PROPS, ["inside-dock"]);
    assert.deepEqual(diff(light), [], "light: layout the same with the sheet on and off");
    const colours = await stylesOnOff(t.page, [".cc-dock", "#vt-bar", "#cc-dock-send"], ["background-color", "color"], ["inside-dock"]);
    assert.ok(diff(colours).length > 0, "light: the sheet does change the colours");
    // The sidebar search keeps its box; only its text colour moves.
    const search = await stylesOnOff(t.page, ["#mac-side .mx-srch"], ["background-color", ...LAYOUT_PROPS], ["inside-dock"]);
    assert.deepEqual(diff(search), [], "search box look unchanged apart from its text");
  } finally { await t.close(); }
});

test("notice row: at 1440 wide the Finish, Momentum and Project tools chips fit on one or two lines, with every control still shown", { skip }, async () => {
  for (const theme of ["light", "dark"]) {
    const t = await bootNew({ theme, width: 1440, height: 900 });
    try {
      await toExpert(t);
      await macTheme(t, theme);
      await go(t, "command");
      await t.page.waitForSelector("#app .cx-notes #projbar", { timeout: WAIT });
      await t.page.waitForTimeout(800);
      const got = await t.page.evaluate(() => {
        const box = document.querySelector("#app .cx-notes");
        const b = box.getBoundingClientRect();
        const ctrls = [...box.querySelectorAll("button, select, a")].filter((e) => !e.closest("[hidden]") && getComputedStyle(e).display !== "none" && !e.closest(".mm-why, .mm-owner, .mm-resume, .fp-card, .fp-pair"));
        const out = ctrls.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 4 || r.height < 4 || r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1; }).map((e) => e.textContent.trim());
        const tops = [...new Set(ctrls.map((e) => Math.round(e.getBoundingClientRect().top)))].sort((p, q) => p - q);
        // Controls on one line can differ by a pixel or two in top; count a new line only after a real jump.
        const lines = tops.filter((v, i) => i === 0 || v - tops[i - 1] > 8).length;
        return { lines, tops, count: ctrls.length, out, words: ctrls.map((e) => e.textContent.trim()) };
      });
      assert.ok(got.count >= 8, `${theme}: ${got.count} controls (${got.words.join(", ")})`);
      assert.deepEqual(got.out, [], `${theme}: every control inside the row and visible`);
      assert.ok(got.lines <= 2, `${theme}: ${got.lines} lines (tops ${got.tops.join(", ")})`);
      for (const want of ["Finish", "Continue this project", "Open canvas"]) assert.ok(got.words.includes(want), `${theme}: "${want}" shown`);
    } finally { await t.close(); }
  }
});
