// The AI News side panel: left or right, minimizable, with links. Pure helpers plus a look at the page code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { readRail, saveRail, railLinks, MAX_LINKS, RAIL_KEY } from "../web/news-rail.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test("the panel starts minimized on the right, and the side and size are remembered", () => {
  const st = mem();
  assert.deepEqual(readRail(st), { side: "right", min: true, hidden: false });
  saveRail(st, { side: "left", min: false, hidden: false });
  assert.deepEqual(readRail(st), { side: "left", min: false, hidden: false });
  st.setItem(RAIL_KEY, "not json");
  assert.deepEqual(readRail(st), { side: "right", min: true, hidden: false });
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
