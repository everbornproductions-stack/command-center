// Responsive nav, priority-plus. On a wider bar the most used pages leave their
// menu and sit on the bar as direct buttons, in a fixed order, as many as fit.
// Checked at 1024, 1440, and 1920.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SIMPLE_PROMOTE, EXPERT_PROMOTE, PROMOTE_GAP, NAV_LAYOUT_WAIT_MS, NAV_CSS,
  promoteFor, promotedItems, promotable, currentNavPromote, simpleModel, menuModel,
  navLayout, navAvailable, NAV_TRIM_AT, menusWidth, rowLabels, watchNavLayout, resetNavMeasure, measureMenuSlot,
} from "../web/nav.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = ["command", "projects", "compare", "pipelines", "agents", "liveview", "schedules", "libraries", "artifacts", "history",
  "everyday-inbox", "everyday-plan", "prompts", "marketplace", "images", "media", "publish", "remix", "builders", "webbuilders",
  "subscriptions", "credits", "workspaces", "together", "userchat", "reports", "community", "help", "settings", "setup"];

const layoutAt = (mode, width) => (mode === "simple" ? "narrow" : navLayout(width));
const upAt = (mode, width) => {
  const layout = layoutAt(mode, width);
  return promotedItems(mode, VIEWS, "", promoteFor(mode, VIEWS, navAvailable(width), layout)).map((p) => p.id);
};

test("the promotion order matches the plan", () => {
  assert.deepEqual(SIMPLE_PROMOTE.map((p) => p.label), ["Pro prompts", "Builders", "Community", "Connections"]);
  assert.deepEqual(EXPERT_PROMOTE.map((p) => p.label), ["Command", "Start a project", "Projects", "Pro prompts", "Builders", "Community", "Missions", "Councils", "Research", "Remix"]);
  const simple = simpleModel(VIEWS, "", SIMPLE_PROMOTE.map((p) => p.id)).map((g) => g.label);
  assert.deepEqual(simple.slice(0, 8), ["Chat", "Start a project", "Projects", "My day", "Pro prompts", "Builders", "Community", "Connections"]);
});

test("1024 keeps the compact row, 1440 promotes a few, 1920 promotes more", () => {
  assert.deepEqual(upAt("simple", 1024), []);
  assert.deepEqual(upAt("expert", 1024), []);
  assert.deepEqual(upAt("simple", 1440), ["prompts", "builders"]);
  assert.deepEqual(upAt("expert", 1440), ["command"]);
  assert.deepEqual(upAt("simple", 1920), ["prompts", "builders", "community", "connections"]);
  assert.deepEqual(upAt("expert", 1920), ["command", "start", "projects", "prompts", "builders"]);
  assert.equal(upAt("expert", 2560).length, EXPERT_PROMOTE.length);
});

test("a wider bar never promotes fewer, and the row is always the top of the order", () => {
  for (const mode of ["simple", "expert"]) {
    const order = promotable(mode, VIEWS).map((p) => p.id);
    let prev = 0;
    for (let w = 900; w <= 3000; w += 20) {
      const raw = promoteFor(mode, VIEWS, navAvailable(w), layoutAt(mode, w));
      assert.deepEqual(raw, order.slice(0, raw.length), `${mode} ${w}`);
      // Past NAV_TRIM_AT the product line and the clock come back and take their space.
      if (layoutAt(mode, w) === layoutAt(mode, w - 20) && (w <= NAV_TRIM_AT || w - 20 > NAV_TRIM_AT)) assert.ok(raw.length >= prev, `${mode} ${w}`);
      prev = raw.length;
    }
  }
});

test("a promoted row fits on one line at 1024, 1440, and 1920", () => {
  for (const width of [1024, 1440, 1920]) {
    for (const mode of ["simple", "expert"]) {
      const layout = layoutAt(mode, width);
      const up = promotedItems(mode, VIEWS, "", promoteFor(mode, VIEWS, navAvailable(width), layout));
      if (!up.length) continue;
      const base = mode === "simple" ? ["Chat", "Start a project", "Projects", "☀ My day", "Create", "More", "Help", "Settings"] : rowLabels(layout);
      assert.ok(menusWidth([...base, ...up.map((p) => p.label)], PROMOTE_GAP) <= navAvailable(width), `${mode} ${width}`);
    }
  }
  assert.match(NAV_CSS, /\.tabs\.nav-ready\.nav-promoted \{ justify-content: flex-start; gap: \$\{PROMOTE_GAP\}px; \}|\.tabs\.nav-ready\.nav-promoted \{ justify-content: flex-start; gap: 8px; \}/);
  assert.match(NAV_CSS, /flex-wrap: nowrap/);
  assert.equal(PROMOTE_GAP, 8);
});

test("Simple: promoted pages leave Create and More, and Connections becomes its own menu", () => {
  const model = simpleModel(VIEWS, "", upAt("simple", 1920));
  const create = model.find((g) => g.id === "create").items.map((i) => i.view);
  const more = model.find((g) => g.id === "more").items;
  assert.equal(create.includes("prompts"), false);
  assert.equal(create.includes("builders"), false);
  assert.ok(create.includes("images"));
  assert.equal(more.some((i) => i.view === "community"), false);
  assert.equal(more.some((i) => i.section === "Connections"), false);
  const conn = model.find((g) => g.id === "connections");
  assert.deepEqual(conn.items.map((i) => i.label), ["Zapier and Make", "Keys and providers", "Your apps", "Browser extension", "HighLevel"]);
  assert.ok(conn.items.every((i) => i.view === "settings" && i.focus && !i.section));
  const homes = model.flatMap((g) => g.items.filter((i) => i.home && !i.focus).map((i) => i.view));
  assert.equal(homes.length, new Set(homes).size, "each page is listed once");
  for (const view of ["prompts", "builders", "community"]) assert.ok(homes.includes(view), view);
  // At 1024 nothing moves.
  const narrow = simpleModel(VIEWS, "", upAt("simple", 1024));
  assert.deepEqual(narrow.map((g) => g.label), simpleModel(VIEWS).map((g) => g.label));
});

test("Expert: promoted pages leave Work, Create, and Business, and come first on the bar", () => {
  const all = EXPERT_PROMOTE.map((p) => p.id);
  const model = menuModel(VIEWS, "normal", { promote: all });
  assert.deepEqual(model.filter((g) => g.direct).map((g) => g.label), EXPERT_PROMOTE.map((p) => p.label));
  assert.ok(model.slice(0, all.length).every((g) => g.direct && g.promoted));
  const menuViews = (id) => model.find((g) => g.id === id).items.map((i) => i.view);
  for (const view of ["command", "start", "projects"]) assert.equal(menuViews("work").includes(view), false, view);
  for (const view of ["prompts", "builders", "remix"]) assert.equal(menuViews("create").includes(view), false, view);
  assert.equal(menuViews("business").includes("community"), false);
  assert.ok(menuViews("work").includes("liveview"), "Live stays in Work");
  const homes = model.flatMap((g) => g.items.filter((i) => i.home && !i.focus && !i.runMode).map((i) => i.view));
  assert.equal(homes.length, new Set(homes).size, "each page is listed once");
  const short = (id) => model.find((g) => g.id === `up-${id}`).items[0];
  assert.equal(short("missions").runMode, "mission");
  assert.equal(short("councils").runMode, "council");
  assert.equal(short("research").focus, "#cc-search-cmd");
  assert.equal(short("missions").home, false, "a Command shortcut does not take Command out of Work");
  // Without promotion the menus are unchanged.
  assert.deepEqual(menuModel(VIEWS, "normal").map((g) => g.id), ["work", "agents", "library", "create", "business", "connect", "settings", "guides"]);
});

test("Start a project is promoted only together with Projects", () => {
  assert.deepEqual(promotedItems("expert", VIEWS, "", ["command", "start"]).map((p) => p.id), ["command"]);
  assert.deepEqual(promotedItems("expert", VIEWS, "", ["command", "start", "projects"]).map((p) => p.id), ["command", "start", "projects"]);
  const model = menuModel(VIEWS, "normal", { promote: ["command", "start"] });
  const work = model.find((g) => g.id === "work").items.map((i) => i.view);
  assert.equal(work.indexOf("start") + 1, work.indexOf("projects"));
});

test("the web app does not promote desktop-only pages and skips pages it does not have", () => {
  const few = ["command", "projects", "settings", "help"];
  assert.deepEqual(promotable("simple", few).map((p) => p.id), ["connections"]);
  assert.deepEqual(promotable("expert", few).map((p) => p.id), ["command", "start", "projects", "missions", "councils", "research"]);
});

test("the bar re-measures on resize through a debounced ResizeObserver", async () => {
  resetNavMeasure();
  const right = { children: [{ getBoundingClientRect: () => ({ width: 300 }) }, { getBoundingClientRect: () => ({ width: 200 }) }] };
  const bar = {
    clientWidth: 1920,
    querySelector(sel) {
      if (sel === ".brand") return { getBoundingClientRect: () => ({ width: 160 }) };
      if (sel === ".top-right") return right;
      return null;
    },
  };
  class RO {
    constructor(cb) { this.cb = cb; RO.last = this; }
    observe() {}
    disconnect() {}
  }
  const win = {
    innerWidth: 1920,
    screen: { width: 1920, height: 1080 },
    document: { querySelector: (sel) => (sel === ".topbar" ? bar : null) },
    ResizeObserver: RO,
    addEventListener() {},
    removeEventListener() {},
    matchMedia() { return { addEventListener() {}, removeEventListener() {} }; },
  };
  let calls = 0;
  const stop = watchNavLayout(() => { calls++; }, win);
  try {
    assert.equal(calls, 1, "first read is immediate");
    const wide = currentNavPromote("simple", VIEWS, "narrow", "", win);
    assert.equal(wide.length, SIMPLE_PROMOTE.length, `slot ${measureMenuSlot(bar)}`);
    bar.clientWidth = 1024;
    for (let i = 0; i < 10; i++) RO.last.cb();
    assert.equal(calls, 1, "a drag does not rebuild on every frame");
    await wait(NAV_LAYOUT_WAIT_MS + 200);
    assert.equal(calls, 2, "one rebuild after the drag settles");
    assert.deepEqual(currentNavPromote("simple", VIEWS, "narrow", "", win), []);
  } finally {
    stop();
    resetNavMeasure();
  }
});

test("app.js fits the real bar and Missions and Councils pick the run mode", () => {
  const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const fit = app.slice(app.indexOf("function fitPromoted"), app.indexOf("function ensureFeatureTabs"));
  assert.match(fit, /rowOverflows\(root\)/);
  assert.match(fit, /promote\.slice\(0, -1\)/, "an overflowing item goes back, last one first");
  assert.match(fit, /order\.slice\(0, promote\.length \+ 1\)/, "the next one comes up while there is room");
  assert.match(app, /if \(b\.dataset\.runMode\) S\.cmdMode = b\.dataset\.runMode;/);
  assert.match(app, /currentNavPromote\(mode, knownViews\(\)/, "a width change that changes the row rebuilds it");
  const nav = fs.readFileSync(new URL("../web/nav.js", import.meta.url), "utf8");
  assert.equal(nav.includes("\u2014"), false, "no em-dashes");
});
