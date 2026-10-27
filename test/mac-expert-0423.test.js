// 0.4.23 Mac part "expert": the Expert sidebar and the All tools launchpad.
// Key check: every page and feature that exists today is reachable in Expert.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";
import { LABELS, VIEW_LOCKS, helpItems, CONNECT_LINKS, lockFor } from "../web/nav.js";
import { FEATURES } from "../web/perf/registry.js";
import { DESKTOP_ONLY } from "../web/desktop-only.js";
import { GROUPS_MAC, ORDER, VIEW_GROUP, buildRegistry, groupsOf, pages, search, coverage, lockOf } from "../web/mac/data/expert.js";

const skip = findBrowser() ? false : "no Chrome installed";
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// The real page list: LABELS, registry views, feature tabs, NAV_ORDER in app.js, and the buttons in index.html.
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

const SRC = { helpItems: helpItems(""), connectLinks: CONNECT_LINKS, desktopOnly: [] };
const build = (views = realViews()) => buildRegistry(views, LABELS, VIEW_LOCKS, SRC);

// Ids that are not pages. Empty today: every real view id has an item. Add an id here only with a reason.
const NOT_PAGES = [];

test("completeness: every real view is reachable, except the commented allow list", () => {
  const views = realViews();
  assert.ok(views.length >= 30, `found ${views.length} views`);
  for (const v of ["command", "projects", "credits", "settings", "setup", "help", "start", "pipelines", "workspaces", "ai-news", "everyday-work", "webbuilders"]) assert.ok(views.includes(v), v);
  const items = build(views);
  const missing = coverage(views, items).filter((v) => !NOT_PAGES.includes(v));
  assert.deepEqual(missing, []);
});

test("completeness: every LABELS key and every plan lock has an item that opens it", () => {
  const items = build();
  for (const v of [...Object.keys(LABELS), ...Object.keys(VIEW_LOCKS)]) assert.ok(items.some((i) => i.open.view === v), v);
});

test("completeness: every help action and every Settings connection link has an item", () => {
  const items = build();
  for (const h of helpItems("")) {
    if (h.action) assert.ok(items.some((i) => i.open.action === h.action), h.action);
    else assert.ok(items.some((i) => i.open.view === h.view && (i.open.focus || "") === (h.focus || "")), h.label);
  }
  for (const l of CONNECT_LINKS) assert.ok(items.some((i) => i.open.view === l.view && i.open.focus === l.focus), l.id);
  assert.ok(items.some((i) => i.open.focus === "[data-feature='zapier']"));
  for (const run of ["mission", "council", "research", "opinion"]) assert.ok(items.some((i) => i.open.view === "command" && i.open.runMode === run), run);
  for (const p of ["live", "history", "settings"]) assert.ok(items.some((i) => i.open.panel === p), p);
});

test("completeness: new views and unknown views still show up and are covered", () => {
  const items = build([...realViews(), "brand-new-page"]);
  const it = items.find((i) => i.id === "brand-new-page");
  assert.equal(it.group, "work");
  assert.equal(it.label, "brand-new-page");
  assert.deepEqual(coverage([...realViews(), "brand-new-page"], items), []);
  assert.deepEqual(coverage(["ghost"], build([])), ["ghost"]);
});

test("web app hides desktop only pages and the two desktop only help items", () => {
  const web = buildRegistry(realViews(), LABELS, VIEW_LOCKS, { helpItems: helpItems("web"), connectLinks: CONNECT_LINKS, desktopOnly: DESKTOP_ONLY });
  assert.deepEqual(web.filter((i) => DESKTOP_ONLY.includes(i.open.view) && !i.open.focus), []);
  assert.equal(web.some((i) => ["updates", "connect-setup"].includes(i.open.action)), false);
  assert.ok(web.some((i) => i.open.action === "tour"));
  assert.ok(coverage(realViews(), web).every((v) => DESKTOP_ONLY.includes(v)));
});

test("groups: order and membership follow FEATURE-MAP.md", () => {
  assert.deepEqual(GROUPS_MAC.map((g) => g.label), ["Work", "Create", "Agents", "Library", "My day", "People", "Business", "Settings", "Help"]);
  const items = build();
  const by = (g) => groupsOf(items).find((x) => x.id === g).items.map((i) => i.id);
  assert.deepEqual(groupsOf(items).map((g) => g.id), GROUPS_MAC.map((g) => g.id));
  assert.deepEqual(by("work").slice(0, 3), ["command", "start", "projects"]);
  for (const id of ["liveops", "liveview", "mission", "council", "research", "opinion", "compare", "refocus"]) assert.ok(by("work").includes(id), id);
  assert.deepEqual(by("agents").filter((i) => i !== "outside-agents"), ["agents", "pipelines", "schedules"]);
  assert.deepEqual(by("myday"), ["everyday-inbox", "everyday-plan", "everyday-work"]);
  assert.deepEqual(by("business"), ["workspaces", "credits", "subscriptions", "reports"]);
  assert.deepEqual(by("people"), ["community", "ai-news", "userchat", "together"]);
  for (const id of ["artifacts", "brain", "libraries", "mindmedia", "history", "memories"]) assert.ok(by("library").includes(id), id);
  for (const id of ["setup", "keys", "byo", "mcp", "extension", "highlevel", "panel-cost", "panel-safety", "panel-voice", "panel-account"]) assert.ok(by("settings").includes(id), id);
  assert.deepEqual(by("help").slice(0, 2), ["help", "tour"]);
  for (const g of Object.keys(ORDER)) for (const id of ORDER[g]) assert.ok(items.some((i) => i.id === id && i.group === g), `${g}/${id} is in ORDER but not built`);
  for (const [v, g] of Object.entries(VIEW_GROUP)) assert.ok(GROUPS_MAC.some((x) => x.id === g), v);
});

test("items: label, icon, gradient, plain words, open target and no duplicate ids", () => {
  const items = build();
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const i of items) {
    assert.ok(i.label && i.icon && /^g[1-8]$/.test(i.gradient) && i.plain, i.id);
    assert.equal(Object.keys(i.open).filter((k) => ["view", "action", "panel"].includes(k)).length, 1, i.id);
    assert.equal(/[–—]/.test(`${i.label} ${i.plain}`), false, i.id);
    assert.ok(["", "Pro", "Extreme"].includes(i.lock), i.id);
  }
  assert.equal(items.find((i) => i.id === "command").label, "Chat");
  assert.equal(items.find((i) => i.id === "pipelines").label, "Pipelines");
});

test("locks: Pro and Extreme tags follow nav.js VIEW_LOCKS and lockFor", () => {
  const items = build();
  for (const [v, l] of Object.entries(VIEW_LOCKS)) {
    const it = items.find((i) => i.id === v);
    assert.equal(it.lock, l.plan, v);
    assert.equal(it.lockCap, l.cap, v);
    for (const limits of [undefined, {}, { [l.cap]: 0 }, { [l.cap]: null }, { [l.cap]: true }, { [l.cap]: 5 }]) assert.equal(lockOf(it, limits), lockFor(v, limits), `${v} ${JSON.stringify(limits)}`);
  }
  assert.equal(items.find((i) => i.id === "pipelines").lock, "Pro");
  assert.equal(items.find((i) => i.id === "workspaces").lock, "Extreme");
  assert.equal(items.find((i) => i.id === "projects").lock, "");
  assert.equal(lockOf(items.find((i) => i.id === "projects"), {}), "");
});

test("pages: 21 per page by default, nothing lost, nothing repeated", () => {
  const items = build();
  const pg = pages(items);
  assert.ok(pg.length >= 2);
  assert.ok(pg.slice(0, -1).every((p) => p.length === 21));
  assert.ok(pg.at(-1).length >= 1 && pg.at(-1).length <= 21);
  assert.deepEqual(pg.flat().map((i) => i.id), items.map((i) => i.id));
  assert.deepEqual(pages(items, 10).map((p) => p.length).slice(0, 2), [10, 10]);
  assert.deepEqual(pages([]), []);
  assert.equal(pages(items, 0)[0].length, 21);
});

test("search: finds by name, plain words and keywords; every word must match", () => {
  const items = build();
  assert.deepEqual(search(items, "Pipelines").map((i) => i.id), ["pipelines"]);
  assert.ok(search(items, "pipelin").some((i) => i.id === "pipelines"));
  assert.ok(search(items, "  PIPELINES ").some((i) => i.id === "pipelines"));
  assert.equal(search(items, "").length, items.length);
  assert.equal(search(items, "   ").length, items.length);
  assert.deepEqual(search(items, "qqqzzz"), []);
  assert.ok(search(items, "grok").some((i) => i.id === "outside-agents"));
  assert.ok(search(items, "second opinion").some((i) => i.id === "opinion"));
  assert.ok(search(items, "update").some((i) => i.open.action === "updates"));
  assert.equal(search(items, "pipelines banana").length, 0);
  assert.ok(search(items, "memory").length >= 2);
});

test("source: no dashes, only touches its own files, every selector is behind the Mac switch", () => {
  for (const f of ["web/mac/parts/expert.js", "web/mac/css/expert.css", "web/mac/data/expert.js"]) assert.equal(/[–—]/.test(read(...f.split("/"))), false, f);
  const css = read("web", "mac", "css", "expert.css").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
  for (const rule of css.split("}")) {
    const sel = rule.split("{")[0].trim();
    if (!sel) continue;
    for (const s of sel.split(",")) assert.ok(s.trim().startsWith('body[data-style="mac"]'), s);
  }
});

// ---------- real browser ----------
async function until(page, fn, arg, what) {
  await page.waitForFunction(fn, arg, { timeout: 25000 }).catch((e) => { throw new Error(`${what}: ${e.message}`); });
}

// The project may keep its own mode, so switch the way a person does: the existing Expert button.
async function goExpert(page) {
  await until(page, () => !!document.getElementById("mode-expert"), null, "mode button");
  await page.evaluate(() => document.getElementById("mode-expert").click());
  await until(page, () => window.CC.uiMode() === "expert", null, "expert mode");
}

test("browser: Expert sidebar lists every group, search, selection, collapse and remembered groups", { skip }, async () => {
  const t = await bootMac({ mode: "expert" });
  try {
    const { page } = t;
    await goExpert(page);
    await until(page, () => document.querySelectorAll("#mac-side .grp").length >= 9, null, "groups");
    const groups = await page.$$eval("#mac-side .grp .mx-gn", (n) => n.map((x) => x.textContent));
    assert.deepEqual(groups, ["Work", "Create", "Agents", "Library", "My day", "People", "Business", "Settings", "Help"]);
    // Work is open by default, others closed until clicked
    assert.equal(await page.$eval('#mac-side .grp[data-group="work"]', (b) => b.getAttribute("aria-expanded")), "true");
    assert.equal(await page.$eval('#mac-side .grp[data-group="agents"]', (b) => b.getAttribute("aria-expanded")), "false");
    await page.click('#mac-side .grp[data-group="agents"]');
    await until(page, () => !!document.querySelector('#mac-side .si[data-id="pipelines"]'), null, "agents open");
    const tag = await page.$eval('#mac-side .si[data-id="pipelines"] .lk', (n) => n.textContent).catch(() => "");
    const needs = await page.evaluate(() => {
      const l = window.CC.S.license?.limits;
      return !l || !(l.missions === null || l.missions === true || l.missions > 0);
    });
    assert.equal(tag, needs ? "Pro" : "");
    // remembered in localStorage and after a reload
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cc.mac.groups")).agents), true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await until(page, () => !!document.querySelector('#mac-side .si[data-id="pipelines"]'), null, "agents still open after reload");
    // search
    await page.fill("#mac-side .mx-srch", "Pipelines");
    await until(page, () => document.querySelectorAll("#mac-side .si").length === 1 && document.querySelector("#mac-side .si").dataset.id === "pipelines", null, "search result");
    // click opens the page and the item turns selected
    await page.click('#mac-side .si[data-id="pipelines"]');
    await until(page, () => window.CC.S.view === "pipelines", null, "view set");
    await until(page, () => document.querySelector('#mac-side .si[data-id="pipelines"]')?.getAttribute("aria-current") === "page", null, "selected state");
    // the selected state follows CC.S.view when something else changes it
    await page.fill("#mac-side .mx-srch", "");
    await page.evaluate(() => window.CC.go("credits"));
    await until(page, () => !!document.querySelector('#mac-side .si.on[data-id="credits"]'), null, "follows CC.S.view");
    // Escape clears the search box, then no match message
    await page.fill("#mac-side .mx-srch", "qqqzzz");
    await until(page, () => !!document.querySelector("#mac-side .mx-none"), null, "no match text");
    await page.fill("#mac-side .mx-srch", "");
    // collapse and reopen
    await page.click("#mac-side .mx-collapse");
    await until(page, () => document.getElementById("mac-side").classList.contains("mx-collapsed"), null, "collapsed");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cc.mac.side"))), "closed");
    await page.click("#mac-side .mx-reopen");
    await until(page, () => !document.getElementById("mac-side").classList.contains("mx-collapsed"), null, "reopened");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser: sidebar items open runs modes, settings spots, help actions and panels", { skip }, async () => {
  const t = await bootMac({ mode: "expert" });
  try {
    const { page } = t;
    await goExpert(page);
    await until(page, () => document.querySelectorAll("#mac-side .grp").length >= 9, null, "groups");
    await page.evaluate(() => { window.__opens = []; window.CC.mac.bus.on("open", (e) => window.__opens.push(e)); window.CC.tour = { ...(window.CC.tour || {}), start() { window.__tour = (window.__tour || 0) + 1; } }; });
    await page.fill("#mac-side .mx-srch", "Councils");
    await page.click('#mac-side .si[data-id="council"]');
    await until(page, () => window.CC.S.view === "command" && window.CC.S.cmdShortcut === "council" && window.CC.S.cmdMode === "council", null, "council mode");
    await page.fill("#mac-side .mx-srch", "Live Ops");
    await page.click('#mac-side .si[data-id="liveops"]');
    await page.fill("#mac-side .mx-srch", "Cost and speed");
    await page.click('#mac-side .si[data-id="panel-cost"]');
    await until(page, () => window.__opens.some((e) => e.panel === "live") && window.__opens.some((e) => e.panel === "settings" && e.section === "Cost and speed"), null, "panel events");
    await page.fill("#mac-side .mx-srch", "tour");
    await page.click('#mac-side .si[data-id="tour"]');
    await until(page, () => window.__tour === 1, null, "tour action");
    await page.fill("#mac-side .mx-srch", "Keys and providers");
    await page.click('#mac-side .si[data-id="keys"]');
    await until(page, () => window.CC.S.view === "settings", null, "settings opened at keys");
    await page.fill("#mac-side .mx-srch", "Search help");
    await page.click('#mac-side .si[data-id="help"]');
    await until(page, () => window.CC.S.view === "help", null, "help");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser: launchpad opens from the bus, pages, dots, arrow keys, search, Escape, and every item has a working target", { skip }, async () => {
  const t = await bootMac({ mode: "expert" });
  try {
    const { page } = t;
    await goExpert(page);
    await until(page, () => document.querySelectorAll("#mac-side .grp").length >= 9, null, "ready");
    assert.equal(await page.evaluate(() => document.getElementById("mac-launchpad").classList.contains("on")), false);
    await page.evaluate(() => window.CC.mac.bus.emit("open", { panel: "launchpad" }));
    await until(page, () => document.getElementById("mac-launchpad").classList.contains("on"), null, "launchpad on");
    const info = await page.evaluate(() => ({ pages: document.querySelectorAll("#mac-launchpad .mx-lpg").length, dots: document.querySelectorAll("#mac-launchpad .mx-dots i").length, apps: document.querySelectorAll("#mac-launchpad .app").length, first: document.querySelectorAll("#mac-launchpad .mx-lpg")[0].querySelectorAll(".app").length }));
    assert.ok(info.pages >= 2);
    assert.equal(info.dots, info.pages);
    assert.equal(info.first, 21);
    // every item is there and has a working target
    const ids = await page.$$eval("#mac-launchpad .app", (n) => n.map((x) => x.dataset.id));
    const known = await page.evaluate(() => [...new Set(window.CC.features.filter((f) => f.tab).map((f) => f.id))]);
    assert.equal(new Set(ids).size, ids.length);
    for (const must of ["command", "pipelines", "workspaces", "credits", "settings", "liveops", "tour", "about", "panel-voice", "history", "recent-chats"]) assert.ok(ids.includes(must), must);
    assert.ok(known.length >= 0);
    // dots move the pages
    await page.click('#mac-launchpad .mx-dots i[data-p="1"]');
    await until(page, () => document.querySelector('#mac-launchpad .mx-dots i[data-p="1"]').classList.contains("on") && document.querySelector("#mac-launchpad .mx-lpt").style.transform === "translateX(-100%)", null, "page 2");
    // arrow keys
    await page.keyboard.press("PageUp");
    await until(page, () => document.querySelector('#mac-launchpad .mx-dots i[data-p="0"]').classList.contains("on"), null, "page back by key");
    await page.keyboard.press("PageDown");
    await until(page, () => document.querySelector('#mac-launchpad .mx-dots i[data-p="1"]').classList.contains("on"), null, "page forward by key");
    // search filters across pages, and shows one page
    await page.fill("#mac-launchpad .mx-lpq", "Pipelines");
    await until(page, () => document.querySelectorAll("#mac-launchpad .app").length === 1 && document.querySelectorAll("#mac-launchpad .mx-lpg").length === 1, null, "filtered");
    // Escape closes
    await page.keyboard.press("Escape");
    await until(page, () => !document.getElementById("mac-launchpad").classList.contains("on"), null, "escape closes");
    // click: a page
    await page.evaluate(() => window.CC.mac.bus.emit("open", { panel: "launchpad" }));
    await until(page, () => document.getElementById("mac-launchpad").classList.contains("on"), null, "reopen");
    await page.fill("#mac-launchpad .mx-lpq", "Pipelines");
    await page.click('#mac-launchpad .app[data-id="pipelines"]');
    await until(page, () => window.CC.S.view === "pipelines" && !document.getElementById("mac-launchpad").classList.contains("on"), null, "opened pipelines and closed");
    // click: every item in turn does something real (a view, an action or a panel event)
    await page.evaluate(() => {
      window.__opens = []; window.__acts = [];
      window.CC.mac.bus.on("open", (e) => { if (e.panel !== "launchpad") window.__opens.push(e); });
      window.CC.tour = { start() { window.__acts.push("tour"); }, openNews() { window.__acts.push("news"); } };
      window.CC.connectSetup = { open() { window.__acts.push("connect-setup"); }, render() {} };
      document.addEventListener("click", (e) => { const a = e.target.closest?.("[data-action]"); if (a) window.__acts.push(a.dataset.action); }, true);
    });
    const registry = await page.evaluate(async () => {
      const m = await import("/mac/parts/expert.js");
      const nav = await import("/nav.js");
      const d = await import("/mac/data/expert.js");
      return d.buildRegistry(m.installedViews(window.CC), nav.LABELS, nav.VIEW_LOCKS, { helpItems: nav.helpItems(""), connectLinks: nav.CONNECT_LINKS, desktopOnly: [] }).map((i) => ({ id: i.id, open: i.open }));
    });
    assert.deepEqual(registry.map((r) => r.id).sort(), [...ids].sort());
    for (const r of registry) {
      await page.evaluate(() => { window.__opens.length = 0; window.__acts.length = 0; window.CC.S.view = "command"; window.CC.S.cmdShortcut = ""; window.CC.go("command"); window.CC.mac.bus.emit("open", { panel: "launchpad" }); });
      await until(page, () => document.getElementById("mac-launchpad").classList.contains("on"), null, `open for ${r.id}`);
      await page.fill("#mac-launchpad .mx-lpq", "");
      await page.evaluate((id) => { for (const g of document.querySelectorAll("#mac-launchpad .mx-lpg")) g.style.transform = "none"; document.querySelector(`#mac-launchpad .app[data-id="${id}"]`).click(); }, r.id);
      if (r.open.view) await until(page, (v) => window.CC.S.view === v, r.open.view, `view ${r.id}`);
      else if (r.open.panel) await until(page, (p) => window.__opens.some((e) => e.panel === p), r.open.panel, `panel ${r.id}`);
      else await until(page, (a) => window.__acts.includes(a), r.open.action, `action ${r.id}`);
      await until(page, () => !document.getElementById("mac-launchpad").classList.contains("on"), null, `closed after ${r.id}`);
    }
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser: Simple shows no sidebar groups and no launchpad; switching back to Expert brings them back", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  try {
    const { page } = t;
    await until(page, () => window.CC.uiMode() === "simple" && !!document.getElementById("mac-side"), null, "simple with a slot");
    assert.equal(await page.evaluate(() => document.querySelectorAll("#mac-side .grp, #mac-side .si").length), 0);
    assert.equal(await page.evaluate(() => document.getElementById("mac-side").hidden), true);
    // the launchpad ignores the bus in Simple
    await page.evaluate(() => window.CC.mac.bus.emit("open", { panel: "launchpad" }));
    assert.equal(await page.evaluate(() => document.getElementById("mac-launchpad").classList.contains("on")), false);
    // switching with the existing button
    await page.evaluate(() => document.getElementById("mode-expert")?.click());
    await until(page, () => window.CC.uiMode() === "expert" && document.querySelectorAll("#mac-side .grp").length >= 9, null, "expert groups");
    await page.evaluate(() => document.getElementById("mode-simple")?.click());
    await until(page, () => window.CC.uiMode() === "simple" && document.querySelectorAll("#mac-side .grp").length === 0, null, "groups gone again");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
