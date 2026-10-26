// The AI News side panel: left or right, minimizable, with links. Pure helpers plus a look at the page code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { readRail, saveRail, railLinks, railMode, togglePin, MAX_LINKS, MAX_PINS, RAIL_KEY } from "../web/news-rail.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test("the panel starts open on wide windows and minimized on narrow ones, and the side and size are remembered", () => {
  const st = mem();
  assert.deepEqual(readRail(st), { side: "right", min: true, hidden: false, pins: [] });
  assert.equal(readRail(st, 1366).min, false, "wide window: open by default");
  assert.equal(readRail(st, 1099).min, true);
  assert.equal(readRail(st, 390).min, true);
  saveRail(st, { side: "left", min: false, hidden: false });
  assert.deepEqual(readRail(st), { side: "left", min: false, hidden: false, pins: [] });
  saveRail(st, { side: "left", min: true, hidden: false });
  assert.equal(readRail(st, 1920).min, true, "a choice to minimize is kept even on a wide window");
  st.setItem(RAIL_KEY, "not json");
  assert.deepEqual(readRail(st), { side: "right", min: true, hidden: false, pins: [] });
  st.setItem(RAIL_KEY, JSON.stringify({ side: "up", min: "x" }));
  assert.equal(readRail(st).side, "right");
});

test("only safe https links are listed, at most eight", () => {
  const item = (n, url) => ({ id: `i${n}`, title: `Item ${n}`, sourceUrl: url, sourceName: "Src" });
  const news = { issue: { sections: {
    ai: [item(1, "https://a.example/1"), item(2, "http://insecure.example"), item(3, "javascript:alert(1)"), { id: "x", sourceUrl: "https://a.example/x" }],
    meldmind: Array.from({ length: 12 }, (_, i) => item(10 + i, `https://m.example/${i}`)),
  } } };
  const links = railLinks(news);
  assert.equal(links.length, MAX_LINKS);
  assert.equal(links[0].url, "https://a.example/1");
  assert.ok(links.every((l) => l.url.startsWith("https://")));
  assert.deepEqual(railLinks(null), []);
  assert.deepEqual(railLinks({ issue: null }), []);
});

test("the page code has both sides, minimize, hide with a Settings switch, and no dashes", () => {
  const ui = read("web", "features", "news-rail.js");
  for (const needle of ["data-side", "Minimize", "Move ", "Open AI News", "Show the AI News panel", 'rel="noopener"']) assert.ok(ui.includes(needle), needle);
  assert.match(read("web", "perf", "registry.js"), /"news-rail"/);
  assert.equal(/[–—]/.test(ui + read("web", "news-rail.js")), false);
});

test("window width picks dock, float or phone", () => {
  assert.equal(railMode(1366), "dock");
  assert.equal(railMode(1100), "dock");
  assert.equal(railMode(1099), "float");
  assert.equal(railMode(761), "float");
  assert.equal(railMode(759), "phone");
  assert.equal(railMode(390), "phone");
});

test("pinned links are https only, limited, toggled and remembered", () => {
  let pins = [];
  pins = togglePin(pins, { title: "A", url: "https://a.example" });
  pins = togglePin(pins, { title: "Bad", url: "javascript:alert(1)" });
  assert.equal(pins.length, 1);
  pins = togglePin(pins, { title: "A", url: "https://a.example" });
  assert.equal(pins.length, 0, "a second click unpins");
  for (let i = 0; i < 9; i++) pins = togglePin(pins, { title: `P${i}`, url: `https://p.example/${i}` });
  assert.equal(pins.length, MAX_PINS);
  assert.equal(pins[0].title, "P8");
  const st = mem();
  saveRail(st, { side: "right", min: false, hidden: false, pins });
  assert.equal(readRail(st, 1366).pins.length, MAX_PINS);
});

test("the docked panel reserves a gutter, refreshes, shows what shipped, and opens News on a phone", () => {
  const ui = read("web", "features", "news-rail.js");
  for (const needle of ["rail-dock-right", "rail-dock-left", "padding-right: 288px", 'data-rail="refresh"', "What Meldmind shipped", "WEEKLY_CHECK_MS", "openCommunity", "data-pin"]) assert.ok(ui.includes(needle), needle);
}
);
