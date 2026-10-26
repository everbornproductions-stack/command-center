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

test("0.4.21: the floating News panel is gone; the file only clears an old one, and the registry still lists it", () => {
  const ui = read("web", "features", "news-rail.js");
  assert.equal(/createElement|innerHTML/.test(ui), false, "nothing is drawn");
  assert.match(ui, /getElementById\("cc-rail"\)\?\.remove\(\)/);
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

test("0.4.21: rows can open in-app objects (What's new, Help article, template) and can be pinned", async () => {
  const { appRows, isAppUrl, APP_TARGET } = await import("../web/news-rail.js");
  const rows = appRows({ issue: { sections: { meldmind: [
    { id: "a", title: "Try the email template", open: "template:email-reply" },
    { id: "b", title: "Bad one", open: "javascript:alert(1)" },
    { id: "c", title: "Plain external", sourceUrl: "https://x.example" },
  ] } } });
  assert.equal(rows[0].open, "whatsnew");
  assert.ok(rows.some((r) => r.open === "template:email-reply"));
  assert.equal(rows.some((r) => /javascript/.test(r.open)), false);
  assert.ok(rows.every((r) => isAppUrl(r.url)));
  assert.equal(APP_TARGET.test("view:help"), true);
  const pins = togglePin([], { title: "What's new", url: "app:whatsnew" });
  assert.equal(pins.length, 1);
  assert.equal(togglePin([], { title: "x", url: "app:evil()" }).length, 0);
  assert.match(read("web", "features", "prompts.js"), /openTemplateId/);
});
