// Grouped top navigation. Pure checks: every known view is reachable once, menus, and keys.
// Alt, Ctrl, and Meta are ignored so Alt+Space keeps working.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { menuModel, navKey, groupFor, groupIdFor, CONNECT_LINKS, GROUP_ORDER, SPLIT_ORDER, navLayout, navSingleRow, eightMenuMin, eightNeed, NAV_LAYOUT_WAIT_MS, watchNavLayout, resetNavMeasure, isSettingsItem, menuLabeledSettings, rowOverflows, measureMenuSlot, layoutForSlot } from "../web/nav.js";

const require = createRequire(import.meta.url);
const { createNavDisplayWatch } = require("../electron/nav-display.cjs");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWS = ["command", "projects", "compare", "pipelines", "agents", "liveview", "schedules", "libraries", "artifacts", "history", "refocus", "brain", "prompts", "images", "media", "publish", "subscriptions", "credits", "workspaces", "reports", "settings", "setup"];

test("every known view is in exactly one menu", () => {
  const model = menuModel(VIEWS);
  assert.deepEqual(model.map((g) => g.id), GROUP_ORDER);
  const homes = model.flatMap((g) => g.items.filter((i) => i.home).map((i) => i.view));
  // The Help menu always carries Search help, so help is a home even when not listed.
  assert.equal(homes.length, VIEWS.length + 1);
  assert.equal(new Set(homes).size, VIEWS.length + 1);
  for (const view of [...VIEWS, "help"]) assert.ok(homes.includes(view), view);
  assert.equal(groupFor("prompts"), "create");
  assert.equal(groupFor("liveview"), "work");
  assert.equal(groupFor("refocus"), "work");
  assert.equal(groupFor("subscriptions"), "business");
  assert.equal(groupFor("settings"), "help");
  const create = model.find((g) => g.id === "create").items.map((i) => i.view);
  assert.ok(create.includes("prompts"));
  assert.ok(model.find((g) => g.id === "work").items.some((i) => i.view === "liveview" && i.label === "Live"));
  assert.ok(model.find((g) => g.id === "work").items.some((i) => i.view === "refocus" && i.label === "Refocus"));
});

test("Connect links scroll the Settings page and Help can start the tour", () => {
  const model = menuModel(VIEWS);
  const connect = model.find((g) => g.id === "connect").items;
  assert.deepEqual(connect.map((i) => i.id), CONNECT_LINKS.map((l) => l.id));
  assert.ok(connect.every((i) => i.view === "settings" && i.focus));
  assert.ok(connect.some((i) => i.focus === "#settings-keys"));
  const help = model.find((g) => g.id === "guides").items;
  assert.ok(help.some((i) => i.action === "tour" && i.label === "Take the tour"));
  assert.ok(help.some((i) => i.action === "updates" && i.label === "Check for updates"));
  const navSrc = fs.readFileSync(new URL("../web/nav.js", import.meta.url), "utf8");
  assert.match(navSrc, /globalThis\.CSS\.escape\(view\)/, "the stylesheet string must not shadow CSS.escape");
  assert.ok(model.find((g) => g.id === "help").items.some((i) => i.view === "setup"));
});

test("keyboard: Space opens, Escape closes, Alt+Space is ignored", () => {
  const closed = { open: false, index: 0, count: 4 };
  assert.equal(navKey(closed, " ").action, "open");
  assert.equal(navKey(closed, "Enter").action, "open");
  assert.equal(navKey({ open: true, index: 1, count: 4 }, "Escape").action, "close");
  assert.equal(navKey({ open: true, index: 1, count: 4 }, " ").action, "activate");
  assert.equal(navKey({ open: true, index: 0, count: 4 }, " ", { altKey: true }).action, "ignore");
  assert.equal(navKey(closed, " ", { ctrlKey: true }).action, "ignore");
  assert.equal(navKey(closed, "ArrowDown", { metaKey: true }).action, "ignore");
});

test("breakpoint: narrow stays at the compact menus, a wider window splits to eight dropdowns", () => {
  assert.equal(navLayout(0), "narrow");
  assert.equal(navLayout(900), "narrow");
  assert.equal(navLayout(1024), "narrow");
  assert.equal(navLayout(eightMenuMin() - 1), "narrow");
  assert.equal(navLayout(eightMenuMin()), "normal");
  assert.equal(navLayout(1366), "normal");
  assert.equal(navLayout(1920), "normal");
  assert.equal(navLayout(2560), "normal");
  assert.equal(navLayout(3440), "normal");
  assert.equal(navLayout(Number.NaN), "narrow");
  assert.equal(navLayout(2560, { width: 2560, height: 1080 }), "normal");

  const views = [...VIEWS, "help"];
  const narrow = menuModel(views, "narrow");
  const normal = menuModel(views, "normal");
  assert.deepEqual(narrow.map((g) => g.id), GROUP_ORDER);
  assert.deepEqual(normal.map((g) => g.id), SPLIT_ORDER);
  assert.equal(normal.length, 8);
  assert.ok(narrow.length <= 6);

  for (const model of [narrow, normal]) {
    const homes = model.flatMap((g) => g.items.filter((i) => i.home).map((i) => i.view));
    assert.equal(new Set(homes).size, homes.length);
    for (const view of views) assert.ok(homes.includes(view), view);
    const labels = model.flatMap((g) => g.items.map((i) => i.label));
    assert.ok(labels.includes("Check for updates"));
    assert.ok(labels.includes("Take the tour"));
    assert.ok(labels.includes("Start a project"));
    assert.ok(model.some((g) => g.items.some((i) => i.view === "liveview" && i.label === "Live")));
  }
  assert.equal(narrow.find((g) => g.id === "work").items.filter((i) => i.view === "start").length, 1);
  assert.equal(narrow.find((g) => g.id === "guides").items.filter((i) => i.view === "start").length, 0);

  const help = normal.find((g) => g.id === "guides");
  assert.equal(help.label, "Help");
  assert.deepEqual(
    help.items.map((i) => i.label),
    ["Search help", "Take the tour", "Run setup again", "Check for updates", "What's new", "Try demo mode", "User guide", "Contact and feedback", "About Meldmind"],
  );
  assert.equal(groupIdFor("liveview", "normal"), "work");
  assert.equal(groupIdFor("agents", "normal"), "agents");
  assert.equal(groupIdFor("settings", "narrow"), "help");
  assert.equal(groupIdFor("help", "narrow"), "guides");
  assert.equal(groupFor("liveview"), "work");

  const navSrc = fs.readFileSync(new URL("../web/nav.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const preload = fs.readFileSync(new URL("../electron/desk-preload.cjs", import.meta.url), "utf8");
  assert.match(navSrc, /addEventListener\?\.\("resize", onCss\)/);
  assert.match(navSrc, /matchMedia/);
  assert.match(navSrc, /min-device-width/);
  assert.match(navSrc, /max-width/);
  assert.match(navSrc, /flex-wrap: nowrap/);
  assert.doesNotMatch(navSrc, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(navSrc, /nav-wide/);
  assert.match(navSrc, /onNavDisplay/);
  assert.match(app, /watchNavLayout/);
  assert.match(app, /currentNavLayout/);
  assert.match(main, /display-metrics-changed|createNavDisplayWatch/);
  assert.match(main, /nav:display/);
  assert.match(main, /loadURL\(`http:\/\/127\.0\.0\.1:\$\{PORT\}\/`\)/);
  assert.doesNotMatch(main, /demo \$\{process\.env\.CC_DEMO_PORT\}/);
  assert.match(preload, /nav:display/);
  assert.doesNotMatch(navSrc, /\u2014/);
});

test("the app wires the menus and does not drop the setup tab id", () => {
  const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  const features = fs.readFileSync(new URL("../web/perf/registry.js", import.meta.url), "utf8");
  assert.match(app, /installNav/);
  assert.match(app, /id="settings-keys"/);
  assert.match(html, /id="tab-setup"/);
  assert.match(features, /"prompts"/);
  assert.doesNotMatch(app, /\u2014/);
});

test("the nav is one row of dropdowns at 1024, 1366, 1920 and 2560", () => {
  const views = [...VIEWS, "help"];
  const css = fs.readFileSync(new URL("../web/styles.css", import.meta.url), "utf8");
  const topbar = css.slice(css.indexOf(".topbar {"), css.indexOf(".brand {"));
  assert.match(topbar, /flex-wrap:\s*nowrap/);
  const tabs = css.slice(css.indexOf(".tabs {"), css.indexOf(".tabs button"));
  assert.match(tabs, /flex-wrap:\s*nowrap/);
  for (const width of [1024, 1366, 1920, 2560]) {
    const layout = navLayout(width);
    assert.notEqual(layout, "wide", `${width} has no full-tab row`);
    assert.equal(navSingleRow(width), true, `${width} stays on one row`);
    const model = menuModel(views, layout);
    assert.ok(model.length >= 5 && model.length <= 8, `${width} has ${model.length} dropdowns`);
    assert.ok(model.every((g) => g.label && g.items.length > 0), width);
  }
  assert.equal(menuModel(views, navLayout(1024)).length, GROUP_ORDER.length);
  assert.equal(menuModel(views, navLayout(1366)).length, 8);
  assert.equal(menuModel(views, navLayout(1920)).length, 8);
  assert.equal(menuModel(views, navLayout(2560)).length, 8);
  const overflow = { scrollWidth: 900, clientWidth: 400, parentElement: { scrollWidth: 900, clientWidth: 400 } };
  assert.equal(rowOverflows(overflow), true);
  assert.equal(rowOverflows(null), false);
});

test("Settings holds only settings items, and Start a project is in Work", () => {
  const views = ["command", "projects", "settings", "setup", "help", "start", "liveview"];
  for (const layout of ["narrow", "normal"]) {
    const model = menuModel(views, layout);
    const settings = menuLabeledSettings(model);
    assert.ok(settings, layout);
    assert.ok(settings.items.length > 0, layout);
    for (const item of settings.items) {
      assert.equal(isSettingsItem(item), true, `${layout}: ${item.label}`);
      assert.notEqual(item.view, "start");
      assert.notEqual(item.label, "Start a project");
    }
    const work = model.find((g) => g.id === "work");
    assert.equal(work.items.filter((i) => i.view === "start").length, 1, layout);
    const order = work.items.map((i) => i.view);
    assert.equal(order.indexOf("start"), order.indexOf("projects") - 1, `${layout}: Start a project comes right before Projects`);
  }
  assert.equal(groupFor("start"), "work");
  assert.equal(groupIdFor("start", "narrow"), "work");
  assert.equal(groupIdFor("start", "normal"), "work");
});

test("Start a project comes right before Projects in Simple and Expert", () => {
  for (const layout of ["narrow", "normal"]) {
    for (const views of [["command", "projects", "settings"], ["command", "projects", "settings", "start"], ["start", "command", "projects"]]) {
      const order = menuModel(views, layout).find((g) => g.id === "work").items.map((i) => i.label);
      assert.equal(order.indexOf("Start a project") + 1, order.indexOf("Projects"), `${layout}: ${order.join(", ")}`);
    }
  }
  const src = fs.readFileSync(new URL("../web/nav.js", import.meta.url), "utf8");
  const simple = src.slice(src.indexOf("function mountSimple"), src.indexOf("export function installNav"));
  assert.ok(simple.indexOf('"start", "Start a project"') < simple.indexOf('"projects", "Projects"'), "Simple mounts Start a project before Projects");
  assert.match(src, /projects\.insertAdjacentElement\("beforebegin", btn\)/);
});

test("layout follows the window from wide to normal to small and back", async () => {
  resetNavMeasure();
  const seen = [];
  const listeners = {};
  const win = {
    innerWidth: 2560,
    devicePixelRatio: 1,
    screen: { width: 2560, height: 1440 },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    matchMedia() { return { addEventListener() {}, removeEventListener() {} }; },
    visualViewport: { addEventListener() {}, removeEventListener() {} },
    dispatch(type) { for (const fn of listeners[type] || []) fn(); },
  };
  let desktopFn = null;
  win.ccDesktop = { onNavDisplay(fn) { desktopFn = fn; return () => { desktopFn = null; }; } };
  const stop = watchNavLayout((layout) => seen.push(layout), win);
  try {
    assert.equal(seen.at(-1), "normal");
    const step = async (width, screen, layout) => {
      win.innerWidth = width;
      win.screen = screen;
      win.dispatch("resize");
      await wait(NAV_LAYOUT_WAIT_MS + 300);
      assert.equal(seen.at(-1), layout, `width ${width}`);
      assert.equal(navSingleRow(width), true, `${width} is one row`);
    };
    await step(1920, { width: 1920, height: 1080 }, "normal");
    await step(1024, { width: 1024, height: 768 }, "narrow");
    await step(1366, { width: 1366, height: 768 }, "normal");
    await step(2560, { width: 2560, height: 1440 }, "normal");
    // A desktop content-bounds report can be smaller than the layout viewport
    // (DPI scaling, another monitor). It must not pull a wide window back to compact.
    win.innerWidth = 2560;
    desktopFn({ width: 1024, screenWidth: 1024, screenHeight: 768 });
    await wait(NAV_LAYOUT_WAIT_MS + 300);
    assert.equal(seen.at(-1), "normal", "a smaller desktop report does not override a wide window");
    win.innerWidth = 2560;
    win.screen = { width: 2560, height: 1440 };
    win.dispatch("resize");
    await wait(NAV_LAYOUT_WAIT_MS + 300);
    assert.equal(seen.at(-1), "normal");
  } finally {
    stop();
    resetNavMeasure();
  }
});

test("ultra-wide bar uses its free space, and a small desktop report cannot collapse it", async () => {
  resetNavMeasure();
  const seen = [];
  const listeners = {};
  const right = {
    getBoundingClientRect: () => ({ width: 1700 }),
    children: [
      { getBoundingClientRect: () => ({ width: 72 }) },
      { getBoundingClientRect: () => ({ width: 88 }) },
    ],
  };
  const bar = {
    clientWidth: 2400,
    querySelector(sel) {
      if (sel === ".brand") return { getBoundingClientRect: () => ({ width: 160 }) };
      if (sel === ".top-right") return right;
      return null;
    },
  };
  class RO {
    constructor(cb) { this.cb = cb; RO.last = this; }
    observe(el) { this.el = el; this.cb(); }
    disconnect() { this.disconnected = true; }
  }
  const win = {
    innerWidth: 900,
    devicePixelRatio: 1.5,
    screen: { width: 900, height: 768 },
    document: { querySelector: (sel) => (sel === ".topbar" ? bar : null) },
    ResizeObserver: RO,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    matchMedia() { return { addEventListener() {}, removeEventListener() {} }; },
    visualViewport: { addEventListener() {}, removeEventListener() {} },
  };
  let desktopFn = null;
  win.ccDesktop = { onNavDisplay(fn) { desktopFn = fn; return () => { desktopFn = null; }; } };
  const slot = measureMenuSlot(bar);
  assert.ok(slot > 1500, `slot ${slot} uses the bar, not the stretched right cluster`);
  assert.equal(layoutForSlot(slot), "normal");
  const stop = watchNavLayout((layout) => seen.push(layout), win);
  try {
    assert.equal(seen.at(-1), "normal", "wide bar opens the eight menus even when innerWidth is stale");
    assert.equal(RO.last.el, bar);
    desktopFn({ width: 900, screenWidth: 3440, screenHeight: 1440, scaleFactor: 1.5 });
    await wait(NAV_LAYOUT_WAIT_MS + 300);
    assert.equal(seen.at(-1), "normal", "DPI content bounds do not collapse a wide bar");
    bar.clientWidth = 860;
    RO.last.cb();
    await wait(NAV_LAYOUT_WAIT_MS + 300);
    assert.equal(seen.at(-1), "narrow", "a bar that cannot fit eight menus goes back to the compact row");
    assert.equal(layoutForSlot(measureMenuSlot(bar)), "narrow");
    bar.clientWidth = 2400;
    RO.last.cb();
    await wait(NAV_LAYOUT_WAIT_MS + 300);
    assert.equal(seen.at(-1), "normal");
  } finally {
    stop();
    assert.equal(RO.last.disconnected, true);
    resetNavMeasure();
  }
  const navSrc = fs.readFileSync(new URL("../web/nav.js", import.meta.url), "utf8");
  assert.match(navSrc, /ResizeObserver/);
  assert.match(navSrc, /measureMenuSlot/);
  assert.doesNotMatch(navSrc, /min-width:\s*max-content/);
  assert.match(navSrc, /flex-wrap:\s*nowrap/);
  assert.match(navSrc, /justify-content:\s*space-between/);
});

test("a late button in the right cluster is measured and the row stays compact when eight menus no longer fit", async () => {
  resetNavMeasure();
  const seen = [];
  const kids = [
    { getBoundingClientRect: () => ({ width: 72 }) },
    { getBoundingClientRect: () => ({ width: 88 }) },
  ];
  const right = { getBoundingClientRect: () => ({ width: 180 }), children: kids, scrollWidth: 180 };
  const bar = {
    clientWidth: 0,
    querySelector(sel) {
      if (sel === ".brand") return { getBoundingClientRect: () => ({ width: 160 }) };
      if (sel === ".top-right") return right;
      return null;
    },
  };
  const before = measureMenuSlot({ ...bar, clientWidth: 100000 });
  // Pad, brand, and the right cluster are the fixed part. Size the bar so eight menus just fit.
  const fixed = 100000 - before;
  bar.clientWidth = fixed + eightNeed() + 20;
  assert.equal(layoutForSlot(measureMenuSlot(bar)), "normal");
  class RO {
    constructor(cb) { this.cb = cb; RO.last = this; }
    observe() {}
    disconnect() {}
  }
  const win = {
    innerWidth: bar.clientWidth,
    devicePixelRatio: 1,
    screen: { width: bar.clientWidth, height: 900 },
    document: { querySelector: (sel) => (sel === ".topbar" ? bar : null) },
    ResizeObserver: RO,
    addEventListener() {},
    removeEventListener() {},
    matchMedia() { return { addEventListener() {}, removeEventListener() {} }; },
    visualViewport: { addEventListener() {}, removeEventListener() {} },
  };
  const stop = watchNavLayout((layout) => seen.push(layout), win);
  try {
    assert.equal(seen.at(-1), "normal");
    kids.push({ getBoundingClientRect: () => ({ width: 220 }) });
    right.scrollWidth = 400;
    RO.last.cb();
    await wait(NAV_LAYOUT_WAIT_MS + 300);
    assert.equal(layoutForSlot(measureMenuSlot(bar)), "narrow");
    assert.equal(seen.at(-1), "narrow");
  } finally {
    stop();
    resetNavMeasure();
  }
});

test("desktop display watch reports resize, move, and display changes, then stops", async () => {
  const sends = [];
  const winBus = new EventEmitter();
  const screenBus = new EventEmitter();
  const win = {
    bounds: { x: 0, y: 0, width: 3440, height: 1440 },
    content: { width: 3440, height: 1400 },
    isDestroyed() { return false; },
    getBounds() { return this.bounds; },
    getContentBounds() { return this.content; },
    webContents: { getZoomFactor() { return 1; } },
    on(ev, fn) { winBus.on(ev, fn); },
    removeListener(ev, fn) { winBus.removeListener(ev, fn); },
  };
  const screen = {
    display: { bounds: { width: 3440, height: 1440 }, scaleFactor: 1 },
    getDisplayMatching() { return this.display; },
    on(ev, fn) { screenBus.on(ev, fn); },
    removeListener(ev, fn) { screenBus.removeListener(ev, fn); },
  };
  const stop = createNavDisplayWatch({ screen, win, send: (p) => sends.push(p) });
  try {
    winBus.emit("resize");
    await wait(400);
    assert.equal(sends.at(-1).width, 3440);
    assert.equal(sends.at(-1).screenWidth, 3440);
    win.content = { width: 1920, height: 1080 };
    win.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
    screen.display = { bounds: { width: 1920, height: 1080 }, scaleFactor: 1 };
    winBus.emit("moved");
    screenBus.emit("display-metrics-changed");
    await wait(400);
    assert.equal(sends.at(-1).width, 1920);
    assert.equal(sends.at(-1).screenHeight, 1080);
    win.content = { width: 1100, height: 700 };
    winBus.emit("resize");
    await wait(400);
    assert.equal(sends.at(-1).width, 1100);
    win.content = { width: 3440, height: 1400 };
    screen.display = { bounds: { width: 3440, height: 1440 }, scaleFactor: 1.25 };
    screenBus.emit("display-metrics-changed");
    await wait(400);
    assert.equal(sends.at(-1).width, 3440);
    assert.equal(sends.at(-1).scaleFactor, 1.25);
    const n = sends.length;
    stop();
    winBus.emit("resize");
    screenBus.emit("display-metrics-changed");
    await wait(400);
    assert.equal(sends.length, n, "a stopped watch does not send");
  } finally {
    stop();
  }
});
