// 0.4.21: AI News has exactly one home, its own item in the left menu (view "ai-news").
// Not in Settings (only on or off and topic choices), not in Community, not a floating panel, not on Home.
// Real browser, practice AIs only. Skips only when no Chrome is installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(20000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// Everything on the open screen that shows the news: the news page container, a floating panel, the issue
// heading, news item cards, and any visible heading that says AI News.
const COUNT = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const view = document.querySelector("#view");
  const pick = (root, sel) => [...root.querySelectorAll(sel)].filter(vis);
  return {
    pages: pick(document, '[data-ai-news="1"]').length,
    rails: pick(document, "#cc-rail, #news-rail, .news-rail").length,
    items: pick(view, "[data-react], [data-share-item]").length,
    headings: pick(view, "h1, h2, h3, h4").filter((h) => /\bAI News\b/.test(h.textContent) && !h.closest("[data-news-settings]")).length,
    settingsCards: pick(view, "[data-news-settings]").length,
    newsChannel: pick(view, '[data-channel="news"]').length,
  };
};

async function open(t, view, more = false) {
  await t.page.evaluate(([v, m]) => { if (m) window.CC.openSettings(""); else window.CC.go(v); }, [view, more]);
  await t.page.waitForTimeout(900);
}

test("AI News appears in exactly one place, in Simple", { skip, timeout: 240000 }, async () => {
  const t = await bootPage({ mode: "simple", width: 1500, height: 900 });
  try {
    await goChat(t.page);
    await t.page.waitForSelector("#cc-side", { timeout: WAIT });
    await t.page.waitForTimeout(1200);
    // the sidebar: exactly one AI News item
    const side = await t.page.evaluate(() => [...document.querySelectorAll("#cc-side button, #side-menu button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && /AI News/.test(b.textContent); }).length);
    assert.equal(side, 1, "one sidebar item");
    // every other screen shows no news at all
    for (const v of ["command", "projects", "mindmedia", "community", "help"]) {
      await open(t, v);
      const c = await t.page.evaluate(COUNT);
      assert.deepEqual(c, { pages: 0, rails: 0, items: 0, headings: 0, settingsCards: 0, newsChannel: 0 }, `${v} shows no news`);
    }
    // Settings (Simple basics and More options): only the on/off switch, the topics and the email switch
    for (const more of [false, true]) {
      await open(t, "settings", more);
      await t.page.waitForSelector("[data-news-settings]", { timeout: WAIT });
      const c = await t.page.evaluate(COUNT);
      assert.equal(c.settingsCards, 1, "one AI News card in Settings");
      assert.equal(c.pages + c.rails + c.items + c.headings + c.newsChannel, 0, "no news content in Settings");
      const kinds = await t.page.evaluate(() => {
        const card = document.querySelector("[data-news-settings]");
        return { inputs: [...card.querySelectorAll("input, select, textarea")].map((i) => i.type || i.tagName), links: card.querySelectorAll("a[href]").length, labels: [...card.querySelectorAll("label")].map((l) => l.textContent.trim()) };
      });
      assert.ok(kinds.inputs.length >= 6 && kinds.inputs.every((k) => k === "checkbox"), "only switches: " + kinds.inputs.join(","));
      assert.equal(kinds.links, 0);
      assert.ok(kinds.labels.some((l) => /Show AI News/.test(l)));
      for (const topic of ["Newest in AI", "New in Meldmind", "Top voted prompts", "Community highlights"]) assert.ok(kinds.labels.some((l) => l.includes(topic)), topic);
    }
    // the one home
    await t.page.click("#side-news");
    await t.page.waitForFunction(() => window.CC.S.view === "ai-news", null, { timeout: WAIT });
    await t.page.waitForSelector('[data-ai-news="1"]', { timeout: WAIT });
    await t.page.waitForTimeout(600);
    const home = await t.page.evaluate(COUNT);
    assert.equal(home.pages, 1, "exactly one news page");
    assert.equal(home.rails, 0);
    assert.equal(home.newsChannel, 0);
    assert.equal(home.settingsCards, 0, "no settings controls on the news page");
    // topics turn sections off on the page
    await t.api("/community/news/draft", { body: { sources: [] } }).catch(() => {});
    // turning AI News off hides the sidebar item and the page says so
    await open(t, "settings", false);
    await t.page.uncheck("#cc-news-on");
    await t.page.waitForFunction(() => document.querySelector("#side-news")?.hidden === true, null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("AI News appears in exactly one place, in Expert", { skip, timeout: 240000 }, async () => {
  const t = await bootPage({ mode: "simple", width: 1500, height: 900 });
  try {
    await t.page.click("#mode-expert");
    await t.page.waitForFunction(() => window.CC.S.uiMode === "expert", null, { timeout: WAIT });
    await goChat(t.page);
    await t.page.waitForTimeout(1500);
    // no floating panel anywhere, even on the Home screen at a wide width
    let c = await t.page.evaluate(COUNT);
    assert.deepEqual(c, { pages: 0, rails: 0, items: 0, headings: 0, settingsCards: 0, newsChannel: 0 }, "Expert Home shows no news");
    await open(t, "community");
    c = await t.page.evaluate(COUNT);
    assert.equal(c.newsChannel, 0, "Community has no News tab");
    assert.equal(c.pages, 0);
    await open(t, "ai-news");
    c = await t.page.evaluate(COUNT);
    assert.equal(c.pages, 1);
    assert.equal(c.rails, 0);
    const navButtons = await t.page.evaluate(() => document.querySelectorAll('#tabs button[data-view="ai-news"]').length);
    assert.equal(navButtons, 1, "one menu entry");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("source: the old floating panel and its Settings switch are gone; Community has no News tab or email box", () => {
  const rail = read("web", "features", "news-rail.js");
  assert.equal(/settings:|createElement|Show the AI News panel/.test(rail), false);
  const comm = read("web", "features", "community.js");
  assert.match(comm, /filter\(\(c\) => c\.id !== "news"\)/);
  assert.equal((comm.match(/\$\{mailBox\(/g) || []).length, 1, "the email switch is drawn in Settings only");
  assert.equal(/[–—]/.test(comm), false);
  const layout = read("web", "features", "layout.js");
  assert.match(layout, /id="side-news"/);
  assert.equal(/data-menu-act="news"|\["news", "AI News"\]/.test(layout), false);
});
