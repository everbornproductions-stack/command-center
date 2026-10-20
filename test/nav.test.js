// Grouped top navigation. Pure checks: every known view is reachable once, menus, and keys.
// Alt, Ctrl, and Meta are ignored so Alt+Space keeps working.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { menuModel, navKey, groupFor, groupIdFor, CONNECT_LINKS, GROUP_ORDER, SPLIT_ORDER, navLayout, NAV_NORMAL, NAV_WIDE } from "../web/nav.js";

const VIEWS = ["command", "projects", "compare", "pipelines", "agents", "liveview", "schedules", "libraries", "artifacts", "history", "brain", "prompts", "images", "media", "publish", "subscriptions", "credits", "workspaces", "reports", "settings", "setup"];

test("every known view is in exactly one menu", () => {
  const model = menuModel(VIEWS);
  assert.deepEqual(model.map((g) => g.id), GROUP_ORDER);
  const homes = model.flatMap((g) => g.items.filter((i) => i.home).map((i) => i.view));
  assert.equal(homes.length, VIEWS.length);
  assert.equal(new Set(homes).size, VIEWS.length);
  for (const view of VIEWS) assert.ok(homes.includes(view), view);
  assert.equal(groupFor("prompts"), "create");
  assert.equal(groupFor("liveview"), "work");
  assert.equal(groupFor("subscriptions"), "business");
  assert.equal(groupFor("settings"), "help");
  const create = model.find((g) => g.id === "create").items.map((i) => i.view);
  assert.ok(create.includes("prompts"));
  assert.ok(model.find((g) => g.id === "work").items.some((i) => i.view === "liveview" && i.label === "Live"));
});

test("Connect links scroll the Settings page and Help can start the tour", () => {
  const model = menuModel(VIEWS);
  const connect = model.find((g) => g.id === "connect").items;
  assert.deepEqual(connect.map((i) => i.id), CONNECT_LINKS.map((l) => l.id));
  assert.ok(connect.every((i) => i.view === "settings" && i.focus));
  assert.ok(connect.some((i) => i.focus === "#settings-keys"));
  const help = model.find((g) => g.id === "help").items;
  assert.ok(help.some((i) => i.action === "tour" && i.label === "Take the tour again"));
  assert.ok(help.some((i) => i.action === "updates" && i.label === "Check for updates"));
  const navSrc = fs.readFileSync(new URL("../web/nav.js", import.meta.url), "utf8");
  assert.match(navSrc, /globalThis\.CSS\.escape\(view\)/, "the stylesheet string must not shadow CSS.escape");
  assert.ok(help.some((i) => i.view === "setup"));
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

test("breakpoint: narrow stays at five menus, normal splits to eight, wide is inline", () => {
  assert.equal(NAV_NORMAL, 1280);
  assert.equal(NAV_WIDE, 1600);
  assert.equal(navLayout(0), "narrow");
  assert.equal(navLayout(900), "narrow");
  assert.equal(navLayout(1279), "narrow");
  assert.equal(navLayout(1280), "normal");
  assert.equal(navLayout(1440), "normal");
  assert.equal(navLayout(1599), "normal");
  assert.equal(navLayout(1600), "wide");
  assert.equal(navLayout(2560), "wide");
  assert.equal(navLayout(Number.NaN), "narrow");

  const views = [...VIEWS, "help"];
  const narrow = menuModel(views, "narrow");
  const normal = menuModel(views, "normal");
  const wide = menuModel(views, "wide");
  assert.deepEqual(narrow.map((g) => g.id), GROUP_ORDER);
  assert.deepEqual(normal.map((g) => g.id), SPLIT_ORDER);
  assert.equal(normal.length, 8);
  assert.deepEqual(wide.map((g) => g.id), normal.map((g) => g.id));

  for (const model of [narrow, normal, wide]) {
    const homes = model.flatMap((g) => g.items.filter((i) => i.home).map((i) => i.view));
    assert.equal(new Set(homes).size, homes.length);
    for (const view of views) assert.ok(homes.includes(view), view);
    const labels = model.flatMap((g) => g.items.map((i) => i.label));
    assert.ok(labels.includes("Check for updates"));
    assert.ok(labels.includes("Take the tour again"));
    assert.ok(labels.includes("Start a project"));
    assert.ok(model.some((g) => g.items.some((i) => i.view === "liveview" && i.label === "Live")));
  }
  assert.equal(narrow.find((g) => g.id === "help").items.filter((i) => i.view === "start").length, 1);

  const help = normal.find((g) => g.id === "guides");
  assert.equal(help.label, "Help");
  assert.deepEqual(
    help.items.map((i) => i.label),
    ["Help", "Replay the tour", "Watch example projects"],
  );
  assert.equal(groupIdFor("liveview", "normal"), "work");
  assert.equal(groupIdFor("liveview", "wide"), "work");
  assert.equal(groupIdFor("agents", "normal"), "agents");
  assert.equal(groupIdFor("settings", "narrow"), "help");
  assert.equal(groupFor("liveview"), "work");

  const navSrc = fs.readFileSync(new URL("../web/nav.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(navSrc, /addEventListener\?\.\("resize", apply\)/);
  assert.match(navSrc, /matchMedia/);
  assert.match(navSrc, /min-device-width/);
  assert.match(app, /watchNavLayout/);
  assert.doesNotMatch(navSrc, /\u2014/);
});

test("the app wires the menus and does not drop the setup tab id", () => {
  const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  const features = fs.readFileSync(new URL("../web/features/index.js", import.meta.url), "utf8");
  assert.match(app, /installNav/);
  assert.match(app, /id="settings-keys"/);
  assert.match(html, /id="tab-setup"/);
  assert.match(features, /"prompts"/);
  assert.doesNotMatch(app, /\u2014/);
});
