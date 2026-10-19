// Grouped top navigation. Pure checks: every known view is reachable once, menus, and keys.
// Alt, Ctrl, and Meta are ignored so Alt+Space keeps working.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { menuModel, navKey, groupFor, CONNECT_LINKS, GROUP_ORDER } from "../web/nav.js";

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
  assert.ok(help.some((i) => i.action === "tour"));
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
