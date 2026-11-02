// 0.4.39 (Chris, 2026-11-02, after 0.4.37: "clicking Just chat everything is completely unreadable", "the menu you can't
// see anything", "we need consistency throughout", "make sure changes don't affect text readability", "everywhere"):
// a readability sweep of the whole app, and a source check so the light-surface-under-light-text bug cannot come back.
//
// Browser part: the Mac look (as a new user boots), demo mode (practice AIs, nothing sent), CC_DEV_OWNER=1 so the Pro
// pages draw. For Simple and Expert, light and dark, at 1366 x 800 and 390 x 844, it visits every page the nav can reach
// (the same view list test/mac-expert-0423.test.js reads), Chat empty and Chat with a finished practice answer and a
// follow-up, the Simple home and its 3 steps, the Team page and an agent desk with a task waiting for review, Settings with
// More options, History, the History drawer, the readers box, What's new and the Get free AIs card. A Free install (no
// owner flag) adds the Upgrade box, the Pro box and the locked Pro pages, and two runs with a background colour on the
// other side of the theme (Light with pine, Dark with paper, no picture) check that case. At 1366 a long page is read a
// second screen down, at 390 the first screen (Settings with More options six and three, the chat and desk three). Every
// text node and every typing field's value or placeholder on screen is measured against the pixels painted behind it
// (test/readability-helpers.js) and has to reach 4.5 : 1, or 3 : 1 for large text. Failures print as:
// page | mode theme size | text | ratio (fg on bg) | element.
//
// Source part: every rule under a theme selector paints that theme's surfaces with readable text, no rule styles html
// and body in different themes, only the Mac shell sets body[data-theme] and it follows html[data-theme], and new
// styles take their text colours from the shared theme variables.
//
// @helper-process: bootPage starts the app server and a browser, so npm test runs this file on its own on Windows.
// Windows rules: one server and one browser at a time, real waits, everything closed. Set READ_SHOTS to a folder to keep
// a screenshot of the worst failure per page, READ_OUT to a file for the full JSON list, READ_ONLY=simple-light (etc.)
// to run one combination while fixing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { measureScreen, failing, scrollMain } from "./readability-helpers.js";
import { ratio } from "./paint-helpers.js";
import { LABELS } from "../web/nav.js";
import { FEATURES } from "../web/perf/registry.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(120000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const SHOTS = process.env.READ_SHOTS || "";
const OUT = process.env.READ_OUT || "";
const ONLY = process.env.READ_ONLY || "";
const SIZES = [[1366, 800], [390, 844]];
// The startup and offer pop-ups and toasts come and go on their own (What's new is opened on purpose below). The Expert
// page fade (a 0.3 s fade-in of anything #view draws in its first 450 ms) is motion, not a state anyone reads: a part
// that arrives late would otherwise be caught at 10% opacity.
const POPUPS = "#cc-startup,#cc-look-offer,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,.toasts,#toasts{display:none!important} html:not([data-read-news]) #cc-whats-new{display:none!important} #view[data-cx-enter] > *{animation:none!important}";

// The real page list, read the way test/mac-expert-0423.test.js realViews() reads it.
function realViews() {
  const out = new Set(Object.keys(LABELS));
  for (const f of FEATURES) for (const v of f.views || []) out.add(v);
  for (const f of fs.readdirSync(path.join(ROOT, "web", "features"))) {
    const src = read("web", "features", f);
    for (const chunk of src.split(/register\(\{/).slice(1)) {
      const id = chunk.slice(0, 300).match(/^\s*id:\s*"([^"]+)"/)?.[1];
      if (id && /\btab:\s*\{/.test(chunk.slice(0, 400))) out.add(id);
    }
  }
  const order = read("web", "app.js").match(/const NAV_ORDER = \[([^\]]+)\]/)?.[1] || "";
  for (const m of order.matchAll(/"([^"]+)"/g)) out.add(m[1]);
  for (const m of read("web", "index.html").matchAll(/data-view="([^"]+)"/g)) out.add(m[1]);
  return [...out];
}

// Things that are not text to read, or are decorative. Each entry: page (regexp on the page name, or ""), a regexp on
// the text or the element path, and why. Keep it short. Empty in 0.4.39: every failure found was fixed in the CSS.
const ALLOW = [
];
const allowed = (page, x) => ALLOW.some((a) => (!a.page || a.page.test(page)) && (a.text.test(x.text) || a.text.test(x.sel)));

// ---------- boot and visit ----------

async function boot({ mode, theme, owner = true, width = 1366, height = 800, look = { wallpaper: "image:stage" } }) {
  const env = { CC_STATUS_PAGES: "off" };
  if (owner) env.CC_DEV_OWNER = "1";
  const t = await bootPage({ mac: "default", hidePopups: false, mode, width, height, env });
  if (!t) return null;
  try {
    await t.api("/themes", { body: { mode: theme, ...look } });
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.addInitScript(() => {
      window.open = () => null; // no page, pay link or sign-in ever opens from this test
      window.__readScrollAt = 0; // the last scroll anywhere, so a page that scrolls itself is read after it stops
      addEventListener("scroll", () => { window.__readScrollAt = performance.now(); }, { capture: true, passive: true });
      window.__readMutAt = 0; // the last change to the page, so a page still drawing is read after it is done
      new MutationObserver(() => { window.__readMutAt = performance.now(); }).observe(document, { childList: true, subtree: true, characterData: true });
      try { localStorage.setItem("cc.mac", "1"); } catch {}
    });
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length && window.CC.S.settingsLoaded, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: POPUPS });
    await t.page.waitForFunction((th) => document.documentElement.dataset.theme === th && document.body.dataset.theme === th, theme, { timeout: WAIT });
    const ui = await t.page.evaluate(() => document.body.dataset.ui);
    if (ui !== mode) {
      await t.page.click("#mac-expert");
      await t.page.waitForFunction((m) => document.body.dataset.ui === m, mode, { timeout: WAIT });
    }
    return t;
  } catch (e) { await t.close(); throw e; }
}

// The page has drawn: finite animations (the page fade, a card sliding in) are run to their end, nothing has scrolled for
// 250 ms and nothing in the page has been added or changed for 160 ms (at most 3 s: the Live feed keeps adding lines).
async function settle(page) {
  await page.waitForFunction(() => {
    for (const a of document.getAnimations()) { try { if (a.effect?.getComputedTiming?.().endTime !== Infinity) a.finish(); } catch { /* not finishable */ } }
    const now = performance.now();
    return now - (window.__readScrollAt || 0) > 250 && now - (window.__readMutAt || 0) > 160;
  }, null, { timeout: 3000, polling: 50 }).catch(() => {});
}

function makeSweep(ctx) {
  const found = [];
  let measured = 0, placeholders = 0, tSettle = 0, tMeasure = 0, screensRead = 0;
  async function measure(page, name, { screens = 2 } = {}) {
    // the pointer rests at the top middle of the title bar, so a hover style is not read as the normal one
    const vw = page.viewportSize();
    await page.mouse.move(Math.round(vw.width / 2), 2);
    const t1 = Date.now();
    await settle(page);
    tSettle += Date.now() - t1;
    for (let s = 0; s < screens; s++) {
      if (s > 0 && !(await scrollMain(page, s))) break;
      if (s > 0) await page.waitForTimeout(120);
      const t2 = Date.now();
      const list = await measureScreen(page);
      tMeasure += Date.now() - t2; screensRead++;
      measured += list.length;
      placeholders += list.filter((x) => x.kind === "placeholder").length;
      const bad = failing(list).filter((x) => !allowed(name, x));
      for (const x of bad) found.push({ page: name + (s ? ` (scrolled ${s})` : ""), ...ctx(), ...x });
      if (bad.length && SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const c = ctx();
        await page.screenshot({ path: path.join(SHOTS, `read-${c.mode}-${c.theme}-${c.size}-${name.replace(/[^a-z0-9]+/gi, "_")}-${s}.png`) }).catch(() => {});
      }
    }
    if (screens > 1) await scrollMain(page, 0);
  }
  return { found, measure, count: () => measured, placeholders: () => placeholders, times: () => `${screensRead} screens, settle ${Math.round(tSettle / 1000)} s, measure ${Math.round(tMeasure / 1000)} s` };
}

async function goView(page, v) {
  await page.evaluate((v) => { document.getElementById("mac-history-drawer")?.classList.remove("open"); window.CC.go(v); }, v);
  await page.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view")?.children.length > 0, v, { timeout: WAIT });
}

async function send(page, text) {
  const before = await page.evaluate(() => ({ id: window.CC.S.live?.id || "", n: document.querySelectorAll("#sc-turns .sc-reply").length }));
  await page.fill("#orders", text);
  await page.click("#go");
  await page.waitForFunction((b) => (window.CC.S.live?.id && window.CC.S.live.id !== b.id) || document.querySelectorAll("#sc-turns .sc-reply").length > b.n, before, { timeout: RUN });
  await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !window.CC.S.live?.replying, null, { timeout: RUN });
}

async function openChat(page, mode) {
  await goView(page, "command");
  if (mode === "simple") {
    await page.evaluate(() => window.CC.mac.bus.emit("chat"));
    await page.waitForFunction(() => !!document.querySelector("#view .sc-chat #orders") && document.body.dataset.macFlow === "off", null, { timeout: WAIT });
  } else {
    await page.waitForFunction(() => !!document.querySelector("#view .ex-chat #orders"), null, { timeout: WAIT });
  }
}

// 0.5.0 (chat like the Claude app): the Expert run modes live in the chat box's mode menu; open it, then pick
async function pickRun(page, m) {
  if (await page.evaluate(() => document.getElementById("cb-menu")?.hidden !== false)) await page.click("#sc-team");
  await page.click(`#run-mode [data-m='${m}']`);
}

// Team: two tasks for the social media writer, one left waiting for review.
async function seedTeam(api) {
  const a = await api("/team/assign", { body: { agentId: "emp-social-content", text: "Write 5 posts for Valentine's week for my bakery" } });
  await api("/team/assign", { body: { agentId: "emp-social-content", text: "Spring menu launch teaser", startAt: Date.now() + 20 * 3600000 } });
  await api("/team/agents/emp-social-content/duties", { body: { text: "Draft next week's 5 posts", every: "week", day: 1, time: "08:00" } });
  return a.json?.task?.id;
}

async function sweepCombo(mode, theme) {
  const t = await boot({ mode, theme });
  let size = "1366x800";
  const sw = makeSweep(() => ({ mode, theme, size }));
  const { page, api } = t;
  const t0 = Date.now();
  try {
    const taskId = await seedTeam(api);
    const views = realViews();
    for (const [w, h] of SIZES) {
      size = `${w}x${h}`;
      await page.setViewportSize({ width: w, height: h });
      const screens = w > 800 ? 2 : 1;
      for (const v of views) {
        if (v === "agents") continue; // measured below with a desk open
        await goView(page, v);
        await sw.measure(page, v, { screens });
      }
      // Settings with More options open (Simple shows the short Settings first)
      await page.evaluate(() => { window.CC.S.settingsMore = true; window.CC.go("settings"); });
      await sw.measure(page, "settings, More options", { screens: w > 800 ? 6 : 3 });
      await page.evaluate(() => { window.CC.S.settingsMore = false; });

      // Simple home: Make something and its steps
      if (mode === "simple") {
        await goView(page, "command");
        await page.evaluate(() => window.CC.mac.bus.emit("flow", { step: "home" }));
        await page.waitForFunction(() => document.body.dataset.macFlow === "on", null, { timeout: WAIT });
        await sw.measure(page, "home: Make something", { screens: 1 });
        await page.evaluate(() => window.CC.mac.flow.start("document"));
        await page.waitForSelector("#mac-flow #mf-next", { timeout: WAIT });
        await sw.measure(page, "home: step 1 Pick a style", { screens: 1 });
        await page.click("#mac-flow #mf-next");
        await page.waitForSelector("#mac-flow #mf-text", { timeout: WAIT });
        await sw.measure(page, "home: step 2 Tell us about it", { screens: 1 });
        if (w > 800) {
          await page.fill("#mac-flow #mf-text", "A one page price list for my bakery");
          await page.click("#mac-flow #mf-make");
          await page.waitForFunction(() => ["done", "incomplete"].includes(window.CC.mac.flow.state.step), null, { timeout: RUN });
        }
        if (await page.evaluate(() => ["done", "incomplete"].includes(window.CC.mac.flow.state.step))) await sw.measure(page, "home: step 3 Done", { screens: 2 });
        await page.evaluate(() => window.CC.mac.bus.emit("flow", { step: "home" }));
      }

      // Chat: empty, then a practice answer and a follow-up (made once, measured at both sizes), then Make changes
      if (w > 800) {
        await openChat(page, mode);
        await page.evaluate(() => { window.CC.layout?.newChat?.(); });
        await openChat(page, mode);
        await sw.measure(page, "chat (empty)", { screens: 1 });
        await send(page, "Write a short thank-you note for a customer who bought a cake");
        await send(page, "Make it warmer and shorter");
      } else {
        await openChat(page, mode);
      }
      await sw.measure(page, "chat (answer and follow-up)", { screens: 3 });
      const change = await page.$("#view .sc-acts [data-sc-act='change']");
      if (change) {
        await change.click();
        await page.waitForFunction(() => !document.getElementById("sc-changes")?.hidden, null, { timeout: WAIT }).catch(() => {});
        await sw.measure(page, "chat, Make changes open", { screens: 2 });
        await page.click("#view .sc-acts [data-sc-act='change']").catch(() => {});
      }
      // The readers box (Council, Expert run modes; Simple uses More options: how to run it)
      if (mode === "expert") {
        await pickRun(page, "council");
        await page.fill("#orders", "Should I open a second bakery or grow the first one?");
        await page.click("#go");
        await page.waitForSelector("#cc-readers-go", { timeout: WAIT });
        await sw.measure(page, "readers box", { screens: 1 });
        await page.click("#cc-readers-cancel");
        await page.waitForFunction(() => !document.getElementById("cc-readers"), null, { timeout: WAIT });
        await pickRun(page, "auto").catch(() => {});
        await page.fill("#orders", "");
      }

      // Team and an agent desk with a task waiting for review
      await goView(page, "agents");
      await page.waitForSelector("#tm-page [data-agent]", { timeout: WAIT });
      await sw.measure(page, "team", { screens: w > 800 ? 2 : 3 });
      if (taskId) await page.waitForFunction(async (id) => { const r = await window.CC.api("/team/tasks"); return (r.items || []).some((x) => x.id === id && ["review", "done"].includes(x.status)); }, taskId, { timeout: RUN, polling: 500 }).catch(() => {});
      await page.click('[data-agent="emp-social-content"]');
      await page.waitForFunction(() => document.getElementById("tm-desk-name")?.textContent === "Social media writer", null, { timeout: WAIT });
      await sw.measure(page, "team: agent desk", { screens: 3 });
      const review = await page.$("#tm-assigned [data-task-review]");
      if (review) {
        await review.click();
        await page.waitForSelector(".tm-dlg #tr-result", { timeout: WAIT });
        await sw.measure(page, "team: review box", { screens: 1 });
        await page.keyboard.press("Escape");
        await page.evaluate(() => document.querySelector(".tm-dlg")?.remove());
      }

      // History drawer
      await goView(page, "command");
      await page.evaluate(() => window.CC.mac.bus.emit("open", { panel: "history", open: true }));
      await page.waitForFunction(() => { const d = document.getElementById("mac-history-drawer"); return d && d.classList.contains("open") && !d.getAnimations().length; }, null, { timeout: WAIT });
      await sw.measure(page, "history drawer", { screens: 1 });
      await page.evaluate(() => window.CC.mac.bus.emit("open", { panel: "history", open: false }));
      await page.evaluate(() => document.getElementById("mac-history-drawer")?.classList.remove("open"));

      // Get free AIs card
      await page.evaluate(() => window.CC.freeAis?.open?.());
      await page.waitForFunction(() => !!document.querySelector("#cc-free-ais .card, #cc-free-ais"), null, { timeout: WAIT });
      await sw.measure(page, "Get free AIs card", { screens: 1 });
      await page.evaluate(() => window.CC.freeAis?.close?.());

      // What's new
      await page.evaluate(() => { document.documentElement.dataset.readNews = "1"; window.CC.tour?.openNews?.(); });
      await page.waitForSelector("#cc-whats-new .card", { timeout: WAIT });
      await sw.measure(page, "What's new", { screens: 1 });
      await page.evaluate(() => { document.getElementById("cc-whats-new")?.remove(); delete document.documentElement.dataset.readNews; });
    }
    assert.deepEqual(t.errors, [], "no page errors");
  } finally { await t.close(); }
  return { found: sw.found, measured: sw.count(), placeholders: sw.placeholders(), times: sw.times(), secs: Math.round((Date.now() - t0) / 1000) };
}

// Free install: the Upgrade box, the Pro box and the locked Pro pages.
async function sweepFree(theme) {
  const t = await boot({ mode: "expert", theme, owner: false });
  let size = "1366x800";
  const sw = makeSweep(() => ({ mode: "free", theme, size }));
  const { page } = t;
  const t0 = Date.now();
  try {
    for (const [w, h] of SIZES) {
      size = `${w}x${h}`;
      await page.setViewportSize({ width: w, height: h });
      for (const v of ["pipelines", "schedules", "history", "subscriptions", "workspaces"]) {
        await goView(page, v);
        await sw.measure(page, `${v} (locked)`, { screens: 1 });
      }
      await page.evaluate(() => window.CC.openUpgrade());
      await page.waitForSelector("#cc-upgrade .card", { state: "visible", timeout: WAIT });
      await page.click("#cc-upgrade-all").catch(() => {});
      await sw.measure(page, "Upgrade box", { screens: 3 });
      await page.evaluate(() => document.getElementById("cc-upgrade")?.remove());
      await openChat(page, "expert");
      await pickRun(page, "mission");
      await page.fill("#orders", "Plan my bakery's spring launch");
      await page.click("#go");
      await page.waitForSelector("#cc-upgrade .card", { state: "visible", timeout: WAIT });
      await sw.measure(page, "Pro box (Mission on Free)", { screens: 2 });
      await page.evaluate(() => document.getElementById("cc-upgrade")?.remove());
      await pickRun(page, "auto").catch(() => {});
    }
    assert.deepEqual(t.errors, [], "no page errors");
  } finally { await t.close(); }
  return { found: sw.found, measured: sw.count(), placeholders: sw.placeholders(), times: sw.times(), secs: Math.round((Date.now() - t0) / 1000) };
}

// A background colour on the other side of the theme, no picture: Light with the dark pine colour (the default colour
// once the picture is turned off) and Dark with paper. In 0.4.38 Light + pine gave light text on every light surface.
async function sweepClash(theme) {
  const mode = theme === "light" ? "simple" : "expert";
  const t = await boot({ mode, theme, look: { wallpaper: null, background: theme === "light" ? "pine" : "paper" } });
  const sw = makeSweep(() => ({ mode: `${mode}, ${theme === "light" ? "pine" : "paper"} colour`, theme, size: "1366x800" }));
  const { page } = t;
  const t0 = Date.now();
  try {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bg), "custom", "the background colour is on");
    for (const v of ["command", "projects", "credits", "settings", "history", "agents", "mindmedia"]) {
      await goView(page, v);
      await sw.measure(page, v, { screens: 1 });
    }
    await openChat(page, mode);
    await sw.measure(page, "chat (empty)", { screens: 1 });
    assert.deepEqual(t.errors, [], "no page errors");
  } finally { await t.close(); }
  return { found: sw.found, measured: sw.count(), placeholders: sw.placeholders(), times: sw.times(), secs: Math.round((Date.now() - t0) / 1000) };
}

const report = (list) => list.map((x) => `${x.page} | ${x.mode} ${x.theme} ${x.size} | "${x.text}" | ${x.ratio} : 1, needs ${x.need} (${x.fg} on ${x.bg}${x.flat ? "" : ", picture"}) | ${x.sel}`).join("\n");
const ALL = [];
function record(label, r) {
  ALL.push(...r.found);
  console.log(`${label}: measured ${r.measured} text items (${r.placeholders} placeholders) in ${r.secs} s (${r.times}), ${r.found.length} under the line`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(ALL, null, 1));
}

for (const mode of ["simple", "expert"]) {
  for (const theme of ["light", "dark"]) {
    const name = `${mode}-${theme}`;
    test(`browser: every text on every page reads in ${mode}, ${theme} (1366 x 800 and 390 x 844)`, { skip: skip || (ONLY && !ONLY.split(",").includes(name) ? "READ_ONLY" : false), timeout: 600000 }, async () => {
      const r = await sweepCombo(mode, theme);
      record(name, r);
      assert.ok(r.measured > 2000, `measured ${r.measured}`);
      assert.ok(r.placeholders > 40, `placeholder text measured too (${r.placeholders})`);
      assert.equal(r.found.length, 0, `${r.found.length} text items under 4.5 : 1 (3 : 1 large):\n${report(r.found)}`);
    });
  }
}
for (const theme of ["light", "dark"]) {
  const name = `free-${theme}`;
  test(`browser: the Upgrade box, the Pro box and the locked pages read on Free, ${theme}`, { skip: skip || (ONLY && !ONLY.split(",").includes(name) ? "READ_ONLY" : false), timeout: 300000 }, async () => {
    const r = await sweepFree(theme);
    record(name, r);
    assert.equal(r.found.length, 0, `${r.found.length} text items under the line:\n${report(r.found)}`);
  });
}
for (const theme of ["light", "dark"]) {
  const name = `clash-${theme}`;
  test(`browser: a background colour on the other side of the theme still reads (${theme === "light" ? "Light with pine" : "Dark with paper"}, no picture)`, { skip: skip || (ONLY && !ONLY.split(",").includes(name) ? "READ_ONLY" : false), timeout: 300000 }, async () => {
    const r = await sweepClash(theme);
    record(name, r);
    assert.equal(r.found.length, 0, `${r.found.length} text items under the line:\n${report(r.found)}`);
  });
}

// ---------- source checks: the mismatch class of bug cannot come back ----------

const WEB = path.join(ROOT, "web");
function webFiles() {
  const out = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (!["backgrounds", "icons"].includes(f.name)) walk(p); } else if (/\.(css|js)$/.test(f.name)) out.push(p);
    }
  };
  walk(WEB);
  return out.map((p) => ({ file: path.relative(ROOT, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n") }));
}
// Flat CSS rules from a stylesheet or from the style text inside a JS file (only rules without nested braces).
function cssRules(text) {
  const s = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
function colorOf(v) {
  v = String(v || "").trim().replace(/\s*!important$/, "");
  if (NAMED[v]) return NAMED[v];
  let m = v.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1);
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return null;
}
const decl = (body, prop) => { const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i")); return m ? m[1].trim() : null; };
const themeOf = (sel) => { const m = sel.replace(/:not\([^)]*\)/g, "").match(/\[data-theme="?(light|dark)"?\]/); return m ? m[1] : null; };
// the theme's own surfaces, to check a text colour set without a background in the same rule
const SURFACES = { light: [[255, 255, 255], [238, 242, 247]], dark: [[17, 24, 39], [27, 28, 34], [11, 15, 23]] };

// Every rule under a theme selector (html[data-theme], body[data-theme], :root[data-theme]): a solid background it
// paints is on that theme's side (light surfaces under light, dark under dark), and the text colour it sets reads at
// 4.5 : 1 on its own background or, without one, on the theme's surfaces. This is the 0.4.37 bug as a rule: a light
// surface under body[data-theme] while html[data-theme] (and so the text) was dark.
function themeRuleProblems() {
  const out = [];
  for (const { file, text } of webFiles()) {
    for (const r of cssRules(text)) {
      if (!r.sel.includes("data-theme")) continue;
      for (const item of r.sel.split(",").map((x) => x.trim())) {
        const theme = themeOf(item);
        if (!theme) continue;
        // html and body naming different themes is the state 0.4.38 removed: a rule for it is a rule for the bug
        const bare = item.replace(/:not\([^)]*\)/g, "");
        if (/\[data-theme="?light"?\]/.test(bare) && /\[data-theme="?dark"?\]/.test(bare)) { out.push(`${file}: ${item} styles html and body in different themes`); continue; }
        if (/::?(placeholder|selection|-webkit-scrollbar)/.test(item)) continue;
        const bgRaw = decl(r.body, "background-color") || decl(r.body, "background");
        const bg = bgRaw && colorOf(bgRaw);
        const fgRaw = decl(r.body, "color");
        const fg = fgRaw && colorOf(fgRaw);
        if (bg && bg[3] >= 0.6 && !fg) {
          const L = lumOf(bg);
          if ((theme === "light" && L < 0.3) || (theme === "dark" && L > 0.3)) out.push(`${file}: ${item} paints a ${L < 0.3 ? "dark" : "light"} background ${bgRaw} under the ${theme} theme`);
        }
        // a background set in the same rule from a variable or color-mix() is the rule's own pairing: the sweep measures it
        if (fg && fg[3] >= 0.6 && !(bgRaw && !bg)) {
          const behind = bg && bg[3] >= 0.6 ? [bg] : SURFACES[theme];
          const worst = Math.min(...behind.map((b) => ratio(fg, b)));
          if (worst < 4.5) out.push(`${file}: ${item} sets text ${fgRaw} at ${worst.toFixed(2)} : 1 ${bg ? `on ${bgRaw}` : `on the ${theme} theme's surfaces`}`);
        }
      }
    }
  }
  return out;
}
const lumOf = ([r, g, b]) => { const f = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };

test("source: rules under a theme selector paint that theme's surfaces and readable text", () => {
  assert.deepEqual(themeRuleProblems(), []);
});

test("source: one theme source; only the Mac shell sets body[data-theme], and it follows html[data-theme]", () => {
  const writers = webFiles().filter((f) => /body\.dataset\.theme\s*=|body\.setAttribute\(\s*["']data-theme/.test(f.text)).map((f) => f.file);
  assert.deepEqual(writers, ["web/mac/parts/shell.js"]);
  const shell = read("web", "mac", "parts", "shell.js");
  assert.match(shell, /const storedTheme = \(\) => \{ const c = classicTheme\(\); if \(c\) return c;/, "the saved theme (html[data-theme]) wins");
  assert.match(shell, /attributeFilter: \["data-theme"\]/, "the Mac look follows a later theme change");
  assert.match(shell, /CC\.themes\?\.set\?\.\(\{ mode: theme \}\)/, "the Mac button changes the saved theme too");
});

// New styles take their text colours from the shared theme variables (--text, --muted, --dim, --accent-2, --green,
// --mac-tx, --mac-dim, --mac-acc-text, --cx-*, ...), which exist in both themes. A colour written straight into a
// `color:` declaration is right in one theme only, which is how text went unreadable in the other. The counts below
// are what 0.4.39 has (mostly text on a fixed colour, such as white on a dark map or a coloured button); a file may
// go down, never up, and any other file has none. Defining a variable with a literal (--x: #fff) is fine.
const TEXT_COLOUR_LITERALS = {
  "web/app.js": 2, "web/canvas.css": 1, "web/features/liveview.js": 2, "web/features/phoneweb.js": 1, "web/features/receipt.js": 2,
  "web/features/themes.js": 17, "web/features/voice-talk.js": 1, "web/look.css": 3, "web/mac/css/dock.css": 8, "web/mac/css/expert.css": 14,
  "web/mac/css/flow.css": 6, "web/mac/css/history.css": 2, "web/mac/css/inside-dock.css": 2, "web/mac/css/runbar.css": 3, "web/mac/css/shell.css": 1,
  "web/styles.css": 18, "web/takeover-panel.js": 1,
};
test("source: no new hard-coded text colours; new feature styles use the shared theme variables", () => {
  const over = [];
  for (const { file, text } of webFiles()) {
    const n = (text.match(/(?:^|[;{\s"'`])color\s*:\s*(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/g) || []).length;
    if (n > (TEXT_COLOUR_LITERALS[file] || 0)) over.push(`${file}: ${n} hard-coded text colours (allowed ${TEXT_COLOUR_LITERALS[file] || 0}); use a theme variable`);
  }
  assert.deepEqual(over, []);
  // the 0.4.39 Team page is new: every colour it uses is a variable
  for (const f of ["web/team.css", "web/features/team.js"]) {
    const src = read(...f.split("/"));
    assert.doesNotMatch(src.replace(/--[\w-]+\s*:[^;]+;/g, ""), /(?:^|[;{\s"'`])color\s*:\s*(?:#|rgba?\()/, `${f} text colours come from variables`);
  }
});
