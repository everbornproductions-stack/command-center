// Menu, page, and link audit (docs/menu-audit-0.4.13.md).
// Every menu item maps to a handler, every page is reachable from the menus in
// Simple and in Expert, and each action has one name.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { menuModel, simpleModel, allMenuItems, helpItems, MENU_ACTIONS, VIEW_LOCKS, lockFor, lockNote, menuLabeledSettings, isSettingsItem } from "../web/nav.js";
import { FEATURES } from "../web/perf/registry.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const app = read("web", "app.js");
const BUILT_IN = ["command", "projects", "credits", "subscriptions", "settings", "setup"];

function navOrder() {
  const m = app.match(/const NAV_ORDER = (\[[^\]]+\]);/);
  return JSON.parse(m[1]);
}
// Every page the app can draw: app.js built-ins plus each registry view.
function renderable() {
  const out = new Set(BUILT_IN);
  for (const f of FEATURES) for (const v of f.views || []) out.add(v);
  out.add("help"); // shell tab, web/features/help.js
  return out;
}
const VIEWS = () => {
  const all = new Set([...navOrder(), ...renderable()]);
  return [...all];
};
const LAYOUTS = [
  { mode: "expert", layout: "narrow", surface: "" },
  { mode: "expert", layout: "normal", surface: "" },
  { mode: "expert", layout: "narrow", surface: "web" },
  { mode: "expert", layout: "normal", surface: "web" },
  { mode: "simple", layout: "narrow", surface: "" },
  { mode: "simple", layout: "narrow", surface: "web" },
];
const keyOf = (i) => `${i.view || ""}|${i.focus || ""}|${i.action || ""}`;

function sourceFor(view) {
  if (view === "settings" || BUILT_IN.includes(view)) return app;
  if (view === "help") return read("web", "features", "help.js");
  const f = FEATURES.find((x) => (x.views || []).includes(view));
  return f ? read("web", "features", `${f.file || f.id}.js`) : "";
}

// A Settings panel is a feature file of that name, or a file that registers that id.
function registers(feature) {
  if (fs.existsSync(path.join(ROOT, "web", "features", `${feature}.js`))) return true;
  const dir = path.join(ROOT, "web", "features");
  return fs.readdirSync(dir).filter((n) => n.endsWith(".js")).some((n) => fs.readFileSync(path.join(dir, n), "utf8").includes(`id: "${feature}"`));
}

test("every menu item maps to a handler", () => {
  const rend = renderable();
  const updates = read("web", "features", "updates.js");
  for (const opts of LAYOUTS) {
    for (const item of allMenuItems(VIEWS(), opts)) {
      const where = `${opts.mode}/${opts.layout}/${opts.surface || "desktop"}: ${item.menu} > ${item.label}`;
      assert.ok(item.view || item.action, `${where} has no target`);
      if (item.view) assert.ok(rend.has(item.view), `${where} opens a page nobody draws (${item.view})`);
      if (item.action) {
        assert.ok(MENU_ACTIONS[item.action], `${where} has an unlisted action ${item.action}`);
        const handled = app.includes(`b.dataset.action === "${item.action}"`) || (item.action === "updates" && updates.includes("[data-action='updates']"));
        assert.ok(handled, `${where}: no click handler for ${item.action}`);
      }
      if (item.focus) {
        const id = item.focus.match(/^#([\w-]+)$/)?.[1];
        const feature = item.focus.match(/data-feature='([\w-]+)'/)?.[1];
        if (id) assert.match(sourceFor(item.view), new RegExp(`id="${id}"`), `${where}: ${item.focus} is not on ${item.view}`);
        if (feature) assert.ok(registers(feature), `${where}: ${feature}`);
      }
    }
  }
});

test("every page is reachable from the menus in Simple and Expert", () => {
  for (const opts of LAYOUTS) {
    const items = allMenuItems(VIEWS(), opts);
    const reach = new Set(items.filter((i) => i.view).map((i) => i.view));
    for (const view of VIEWS()) {
      if (opts.surface === "web" && ["setup", "libraries"].includes(view)) continue;
      assert.ok(reach.has(view), `${opts.mode}/${opts.layout}/${opts.surface || "desktop"}: ${view} has no menu item`);
    }
    // A page has one home item per layout.
    const homes = items.filter((i) => i.home && i.view && !i.focus).map((i) => i.view);
    assert.equal(new Set(homes).size, homes.length, `${opts.mode}/${opts.layout}: a page is listed twice`);
  }
  assert.ok(navOrder().includes("marketplace"), "Marketplace has a menu item");
});

test("one name per action, and no duplicates in a menu", () => {
  for (const opts of LAYOUTS) {
    const items = allMenuItems(VIEWS(), opts);
    const byKey = new Map();
    const byLabel = new Map();
    for (const i of items) {
      const k = keyOf(i);
      if (byKey.has(k)) assert.fail(`${opts.mode}/${opts.layout}: ${i.label} and ${byKey.get(k)} do the same thing`);
      byKey.set(k, i.label);
      if (byLabel.has(i.label)) assert.equal(byLabel.get(i.label), k, `${i.label} opens two different things`);
      byLabel.set(i.label, k);
    }
    for (const bad of ["Replay the tour", "Take the tour again", "Watch example projects", "Help"]) {
      assert.equal(items.some((i) => i.label === bad), false, `${bad} is not a menu name`);
    }
  }
});

test("Settings holds settings only, and Help holds the help actions in order", () => {
  const want = ["Search help", "Take the tour", "Get everything connected", "Check for updates", "What's new", "Try demo mode", "User guide", "Contact and feedback", "About Meldmind"];
  for (const layout of ["narrow", "normal"]) {
    const model = menuModel(VIEWS(), layout);
    const settings = menuLabeledSettings(model);
    assert.deepEqual(settings.items.map((i) => i.label), ["Settings", "Find my AIs"]);
    for (const item of settings.items) assert.equal(isSettingsItem(item), true);
    assert.deepEqual(model.find((g) => g.label === "Help").items.map((i) => i.label), want);
  }
  const simple = simpleModel(VIEWS());
  assert.deepEqual(simple.find((g) => g.label === "Help").items.map((i) => i.label), want);
  assert.deepEqual(simple.find((g) => g.label === "Settings").items.map((i) => i.view), ["settings"]);
  assert.deepEqual(simple.map((g) => g.label), ["Chat", "Start a project", "Projects", "My day", "Create", "More", "Help", "Settings"]);
  const web = helpItems("web").map((i) => i.label);
  assert.equal(web.includes("Get everything connected") || web.includes("Check for updates"), false);
});

test("the Help page has every Help target, and Settings has no help duplicates", () => {
  const help = read("web", "features", "help.js");
  for (const id of ["help-search", "can-do", "help-contact", "help-about", "help-replay", "help-news", "help-setup", "s-upd-box"]) {
    assert.match(help, new RegExp(`id="${id}"`), id);
  }
  assert.match(help, /mailto:/);
  const basics = app.slice(app.indexOf('id="basics-help"'), app.indexOf('id="basics-more"'));
  for (const gone of ["basics-tour", "basics-upd", "basics-more-tour"]) assert.equal(basics.includes(gone), false, gone);
  // Decision 20: Settings keeps a manual Run setup again (its menu name is Find my AIs, 0.4.17).
  assert.match(app, /id="s-setup">Run setup again \(Find my AIs\)</);
});

test("Pro-locked pages carry a lock note in the menu", () => {
  const free = { missions: false, scheduler: false, historySearch: false, subscriptionsTab: false, teamSeats: 0 };
  const pro = { missions: true, scheduler: true, historySearch: true, subscriptionsTab: true, teamSeats: 0 };
  assert.equal(lockFor("schedules", free), "Pro");
  assert.equal(lockFor("subscriptions", free), "Pro");
  assert.equal(lockFor("schedules", pro), "");
  assert.equal(lockFor("workspaces", pro), "Extreme");
  assert.equal(lockFor("workspaces", { teamSeats: 5 }), "");
  assert.equal(lockFor("command", free), "");
  assert.equal(lockFor("schedules", undefined), "", "no licence yet, no note");
  assert.match(lockNote("Pro"), /Part of Pro/);
  for (const view of Object.keys(VIEW_LOCKS)) assert.ok(renderable().has(view), view);
  assert.match(app, /markLocks\(root, S\.license\?\.limits\)/);
});

test("tour steps, go() calls, and help links open pages that exist", () => {
  const rend = renderable();
  const tour = read("web", "features", "tour.js");
  for (const m of tour.matchAll(/view: "([\w-]+)"/g)) assert.ok(rend.has(m[1]), `tour step view ${m[1]}`);
  const dir = path.join(ROOT, "web", "features");
  for (const f of [...fs.readdirSync(dir).map((n) => path.join(dir, n)), path.join(ROOT, "web", "app.js")]) {
    if (!f.endsWith(".js")) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/\bgo\("([\w-]+)"\)/g)) assert.ok(rend.has(m[1]), `${path.basename(f)}: go("${m[1]}")`);
  }
});

test("docs/menu-audit-0.4.13.md lists every menu item", () => {
  const doc = read("docs", "menu-audit-0.4.13.md");
  for (const opts of LAYOUTS) for (const i of allMenuItems(VIEWS(), opts)) assert.ok(doc.includes(i.label), i.label);
  assert.match(doc, /Features with no page/);
  assert.equal(doc.includes("\u2014"), false);
});

test("Simple More ends with Connections: Zapier, Make, and the other connectors", () => {
  const more = simpleModel(VIEWS()).find((g) => g.label === "More").items;
  const at = more.findIndex((i) => i.section === "Connections");
  assert.ok(at > 0, "Connections is in More, after the pages");
  const links = more.slice(at);
  assert.ok(links.every((i) => i.section === "Connections" && i.view === "settings" && i.focus), "nothing but connectors after the heading");
  assert.deepEqual(links.map((i) => i.label), ["Zapier and Make", "Keys and providers", "Your apps", "Browser extension", "HighLevel"]);
  assert.equal(links[0].focus, "[data-feature='zapier']");
  // MCP and Integrations panels are Expert only, so Simple does not link to them.
  assert.equal(links.some((i) => /MCP|Integrations/.test(i.label)), false);
  const nav = read("web", "nav.js");
  assert.match(nav, /head\.className = "nav-section"/);
  assert.match(nav, /panel\.insertBefore\(btn, section\)/, "a page that loads later stays above Connections");
  // A connector link opens Settings past the Simple basics.
  assert.match(app, /if \(b\.dataset\.view === "settings" && S\.navFocus\) S\.settingsMore = true;/);
  // Zapier and Make are set up in Settings, not on the chat page.
  const apps = read("web", "features", "apps.js");
  assert.equal(apps.includes("cc-zapier-slot"), false);
  assert.equal(app.includes("cc-zapier-slot"), false);
  assert.match(apps, /<h3>\$\{simple \? "Zapier and Make"/);
});

test("Start a project sits right before Projects in every Simple and Expert menu", () => {
  for (const opts of LAYOUTS) {
    const items = allMenuItems(VIEWS(), opts).filter((i) => i.view === "start" || i.view === "projects");
    assert.deepEqual(items.map((i) => i.view), ["start", "projects"], `${opts.mode}/${opts.layout}`);
  }
  const simple = simpleModel(VIEWS()).map((g) => g.label);
  assert.equal(simple[0], "Chat", "Chat is the first Simple item");
  assert.equal(simple.indexOf("Start a project") + 1, simple.indexOf("Projects"));
});
