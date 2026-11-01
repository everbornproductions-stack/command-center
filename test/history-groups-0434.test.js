// 0.4.34 (Chris: "the history page that pops up in simple is getting really long... organize it into general categories...
// with the latest category used moved up depending on last project worked on"; "if someone made an image they can click on
// that and it will drop down all the images they are making"): History groups by project and by kind of work.
import test from "node:test";
import assert from "node:assert/strict";
import { categoryOf, groupForDrawer, filterChips, agoWord } from "../web/mac/data/history.js";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const NOW = Date.UTC(2026, 10, 1, 18, 0);
const h = (n) => NOW - n * 3600e3;
const ROWS = [
  { id: "a", title: "Logo for Hank's Harvest", file: "hanks-harvest-logo.svg", at: h(1) },
  { id: "b", title: "Make a picture of a cupcake", at: h(5) },
  { id: "c", title: "Rent roll", file: "rent-roll.xlsx", at: h(2) },
  { id: "d", title: "Bakery menu", file: "menu.md", at: h(30), projectId: "p1" },
  { id: "e", title: "What should I post on Monday?", at: h(3) },
  { id: "f", title: "Fix the order form", file: "bakery-order.html", at: h(40), projectId: "p1" },
  { id: "g", title: "Quarterly taxes", at: h(50), projectId: "p2" },
  { id: "i", title: "Pinned note", at: h(100), pinned: true },
];
const PROJECTS = [{ id: "p1", name: "Sofia's Bakery" }, { id: "p2", name: "Taxes" }];

test("categoryOf: the file's type first, else the words in the title, else Chats", () => {
  assert.equal(categoryOf(ROWS[0]).id, "media");
  assert.equal(categoryOf(ROWS[1]).id, "media", "a picture with no file yet is still a picture");
  assert.equal(categoryOf(ROWS[2]).id, "sheets");
  assert.equal(categoryOf({ title: "deck for the board", file: "" }).id, "slides");
  assert.equal(categoryOf({ title: "make a slide deck for the board", file: "" }).id, "slides");
  assert.equal(categoryOf({ title: "write a python script" }).id, "code");
  assert.equal(categoryOf(ROWS[4]).id, "chats");
});

// 0.4.36 (panel 0434 item 10): chats default to Chats and explicit artifacts use their kind.
test("categoryOf keeps chat topics in Chats and recognizes explicit artifacts", () => {
  for (const title of [
    "How do I make a video call with my team?",
    "YouTube title ideas for budget mics",
    "Plan a game night",
    "Post about our app launch party",
  ]) assert.equal(categoryOf({ title }).id, "chats", title);
  assert.equal(categoryOf({ title: "A Node.js script that renames every photo" }).id, "code");
  assert.equal(categoryOf({ title: "make a video for our launch" }).id, "media");
  assert.equal(categoryOf({ title: "make a picture of a cupcake" }).id, "media");
  assert.equal(categoryOf({ title: "rent roll", file: "rent-roll.xlsx" }).id, "sheets");
  assert.equal(categoryOf({ title: "A website for my bakery" }).id, "web", "a quick pick that names the thing first");
  assert.equal(categoryOf({ title: "A 5 second video of waves rolling in" }).id, "media");
});

test("groups: pinned first, then the current project, then by newest; images drop down together", () => {
  let g = groupForDrawer(ROWS, { projects: PROJECTS, current: "p2" });
  assert.deepEqual(g.map((x) => x.label), ["Pinned", "Taxes", "Pictures and video", "Spreadsheets and data", "Chats", "Sofia's Bakery"]);
  assert.deepEqual(g.find((x) => x.label === "Pictures and video").items.map((r) => r.id), ["a", "b"], "every image together, newest first");
  assert.equal(g.find((x) => x.label === "Taxes").current, true);
  g = groupForDrawer(ROWS, { projects: PROJECTS, current: "" });
  assert.deepEqual(g.slice(1).map((x) => x.label), ["Pictures and video", "Spreadsheets and data", "Chats", "Sofia's Bakery", "Taxes"], "with no current project the newest group comes first");
  g = groupForDrawer(ROWS, { projects: PROJECTS, filter: "media" });
  assert.deepEqual(g.map((x) => x.label), ["Pictures and video"]);
  g = groupForDrawer(ROWS, { projects: PROJECTS, filter: "projects" });
  assert.deepEqual(g.map((x) => x.label), ["Sofia's Bakery", "Taxes"]);
});

test("chips count what they would show; agoWord is short", () => {
  const chips = filterChips(ROWS, PROJECTS);
  assert.deepEqual(chips.map((c) => `${c.id}:${c.n}`), ["all:8", "projects:3", "web:1", "docs:1", "sheets:1", "media:2", "chats:3"], "a chip counts its kind everywhere, in projects and pinned too");
  assert.equal(agoWord(h(2), NOW), "2h ago"); assert.equal(agoWord(h(50), NOW), "2d ago"); assert.equal(agoWord(NOW - 20e3, NOW), "just now");
});

test("the drawer shows groups, folds one, shows all, and a chip narrows it", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple" });
  try {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `img${i}`, title: `Picture of a cake ${i}`, file: `cake-${i}.png`, at: Date.now() - (i + 1) * 60e3 }));
    const rows = [...many, { id: "s1", title: "Rent roll", file: "rent-roll.xlsx", at: Date.now() - 3600e3 }, { id: "c1", title: "Hello there", at: Date.now() - 7200e3 }];
    await t.page.route(/\/api\/chathist(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: rows }) }));
    await t.page.evaluate(() => { try { localStorage.removeItem("cc.hist.closed"); } catch {} window.CC.mac.bus.emit("open", { panel: "history", open: true }); });
    await t.page.waitForSelector("#mac-history-drawer.open [data-toggle]", { timeout: 15000 });
    const read = () => t.page.evaluate(() => ({
      groups: [...document.querySelectorAll("#mac-history-drawer [data-toggle]")].map((b) => b.textContent.replace(/\s+/g, " ").trim()),
      items: document.querySelectorAll("#mac-history-drawer .mac-hist-item").length,
      more: document.querySelector("#mac-history-drawer [data-more]")?.textContent || "",
    }));
    let s = await read();
    assert.match(s.groups[0], /^▾ Pictures and video 8 · /);
    assert.equal(s.items, 5 + 1 + 1, "five pictures shown, plus the sheet and the chat");
    assert.equal(s.more, "Show all 8");
    await t.page.evaluate(() => document.querySelector("#mac-history-drawer [data-more]").click());
    s = await read(); assert.equal(s.items, 10);
    await t.page.evaluate(() => document.querySelector('#mac-history-drawer [data-toggle="c:media"]').click());
    s = await read(); assert.match(s.groups[0], /^▸ Pictures and video/); assert.equal(s.items, 2, "the folded group hides its items");
    const remembered = await t.page.evaluate(() => localStorage.getItem("cc.hist.closed"));
    assert.match(remembered, /c:media/);
    await t.page.evaluate(() => document.querySelector('#mac-history-drawer [data-chip="sheets"]').click());
    s = await read(); assert.deepEqual(s.groups.map((x) => x.split(" ")[1]), ["Spreadsheets"]); assert.equal(s.items, 1);
  } finally { await t.close(); }
});
