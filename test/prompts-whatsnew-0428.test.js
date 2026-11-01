// 0.4.28: "What's new" is a collapsible category on the Prompts page. It holds this ISO week's pack only,
// rolls over to the next pack, falls back to the newest pack with its week named, and every weekly prompt
// is also filed into its normal category (once) and stays there. tools/new-week-pack.mjs makes the packs.
// Temp data dir only. No real key, no live Supabase, data/ is not read, nothing is sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { bootPage } from "./pw-helpers.js";
import { PACK_CATEGORIES, PACK_DIR, readPackDir } from "../server/prompts/packs.js";
import { PACK_SHELF, fileIntoShelves, inferCategory, isoWeekOf, pickWhatsNew, releasedRows, shelfForPack } from "../server/prompts/whatsnew.js";
import { SHELVES, shelfFor } from "../web/features/prompt-board.js";
import { TEMPLATES } from "../server/prompts/catalog.js";
import { buildWeekPack, nextWeek, parseInput, run } from "../tools/new-week-pack.mjs";

const EM = /—|–/;
const W44 = Date.UTC(2026, 9, 28, 12); // Wednesday, 2026-W44
const W45 = Date.UTC(2026, 10, 4, 12); // Wednesday, 2026-W45
const W47 = Date.UTC(2026, 10, 18, 12); // Wednesday, 2026-W47 (no pack)
const ROWS = readPackDir();
const packIds = (file) => JSON.parse(fs.readFileSync(path.join(PACK_DIR, file), "utf8")).map((r) => r.id);
const W44_IDS = packIds("week-2026-w44.json");
const W45_IDS = packIds("week-2026-w45.json");
const templatesOnShelves = () => TEMPLATES.map((t) => ({ id: t.id, name: t.name, shelf: shelfFor(t) }));

test("ISO weeks: dates map to the right week, across the year end", () => {
  assert.equal(isoWeekOf(W44), "2026-W44");
  assert.equal(isoWeekOf(W45), "2026-W45");
  assert.equal(isoWeekOf(Date.UTC(2026, 10, 1, 23)), "2026-W44"); // Sunday
  assert.equal(isoWeekOf(Date.UTC(2026, 10, 2, 0)), "2026-W45"); // Monday
  assert.equal(isoWeekOf(Date.UTC(2027, 0, 1)), "2026-W53");
  assert.equal(nextWeek("2026-W44"), "2026-W45");
  assert.equal(nextWeek("2026-W53"), "2027-W01");
});

test("What's new holds exactly this week's pack", () => {
  const news = pickWhatsNew(ROWS, W44);
  assert.equal(news.week, "2026-W44");
  assert.equal(news.current, true);
  assert.equal(news.title, "What's new");
  assert.ok(news.rows.length >= W44_IDS.length);
  assert.ok(news.rows.every((r) => r.added_week === "2026-W44"));
  for (const id of W44_IDS) assert.ok(news.rows.some((r) => r.id === id), id);
  assert.ok(!news.rows.some((r) => W45_IDS.includes(r.id)), "next week's pack waits for its week");
  assert.match(news.label, /week 44 of 2026/);
  assert.doesNotMatch(news.label, EM);
});

test("next week, What's new is replaced by the newer pack", () => {
  const news = pickWhatsNew(ROWS, W45);
  assert.equal(news.week, "2026-W45");
  assert.equal(news.current, true);
  assert.deepEqual(news.rows.map((r) => r.id).sort(), [...W45_IDS].sort());
  assert.ok(!news.rows.some((r) => W44_IDS.includes(r.id)));
});

test("a week with no pack shows the newest pack and names its week, never empty", () => {
  const news = pickWhatsNew(ROWS, W47);
  assert.equal(news.week, "2026-W45");
  assert.equal(news.thisWeek, "2026-W47");
  assert.equal(news.current, false);
  assert.ok(news.rows.length > 0);
  assert.match(news.label, /newest pack, from week 45 of 2026/);
  const synthetic = [{ id: "a", title: "A", added_week: "2026-W40" }, { id: "b", title: "B", added_week: "2026-W41" }, { id: "c", title: "C", added_week: "2026-W50" }];
  const fallback = pickWhatsNew(synthetic, W44);
  assert.equal(fallback.week, "2026-W41");
  assert.deepEqual(fallback.rows.map((r) => r.id), ["b"]);
  assert.deepEqual(releasedRows(synthetic, W44).map((r) => r.id), ["a", "b"]);
});

test("every pack category maps to a category the Prompts page shows", () => {
  const shelfIds = new Set(SHELVES.map((s) => s.id));
  for (const cat of PACK_CATEGORIES) assert.ok(shelfIds.has(PACK_SHELF[cat]), cat);
  assert.equal(inferCategory({ title: "Shot list", prompt: "Plan a reel about [topic]" }), "video");
  assert.equal(inferCategory({ title: "Budget", prompt: "Make a spreadsheet of [expenses]" }), "finance and accounting");
  assert.equal(inferCategory({ category: "Video", title: "x" }), "video");
  assert.equal(shelfForPack({ title: "Logo", prompt: "Five logo ideas for [business]" }), "creative");
});

test("each weekly prompt is filed in its category once, and stays after its week ends", () => {
  const existing = templatesOnShelves();
  const atW45 = fileIntoShelves(ROWS, existing, W45);
  const ids = atW45.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate rows");
  for (const id of [...W44_IDS, ...W45_IDS]) {
    const row = atW45.find((r) => r.id === id);
    assert.ok(row, id);
    assert.equal(row.shelf, PACK_SHELF[row.category]);
  }
  // A later week: both packs are still in their categories.
  const atW47 = fileIntoShelves(ROWS, existing, W47);
  for (const id of [...W44_IDS, ...W45_IDS]) assert.ok(atW47.some((r) => r.id === id), `${id} stays`);
  // Before its week: not filed yet.
  const atW44 = fileIntoShelves(ROWS, existing, W44);
  for (const id of W45_IDS) assert.ok(!atW44.some((r) => r.id === id), `${id} waits`);
  // A prompt already in that category is not filed again; the same title in another category is.
  const tpl = existing[0];
  const dupes = [
    { id: "x1", title: tpl.name, category: Object.keys(PACK_SHELF).find((c) => PACK_SHELF[c] === tpl.shelf), prompt: "p [a]", added_week: "2026-W44" },
    { id: "x2", title: tpl.name, category: Object.keys(PACK_SHELF).find((c) => PACK_SHELF[c] !== tpl.shelf), prompt: "p [a]", added_week: "2026-W44" },
    { id: tpl.id, title: "Totally different words here", category: Object.keys(PACK_SHELF).find((c) => PACK_SHELF[c] === tpl.shelf), prompt: "p [a]", added_week: "2026-W44" },
  ];
  assert.deepEqual(fileIntoShelves(dupes, existing, W44).map((r) => r.id), ["x2"]);
});

test("week 44 and 45 packs: 10 to 15 plain prompts across categories, no long dashes, no promises", () => {
  for (const file of ["week-2026-w44.json", "week-2026-w45.json"]) {
    const src = fs.readFileSync(path.join(PACK_DIR, file), "utf8");
    assert.doesNotMatch(src, EM, file);
    const rows = JSON.parse(src);
    assert.ok(rows.length >= 10 && rows.length <= 15, file);
    assert.ok(new Set(rows.map((r) => r.category)).size >= 6, file);
    for (const cat of ["images and design", "video", "marketing and ads", "finance and accounting", "coding"]) assert.ok(rows.some((r) => r.category === cat), `${file} ${cat}`);
    const week = rows[0].added_week;
    const again = buildWeekPack(rows.map((r) => ({ title: r.title, text: r.prompt, category: r.category, note: r.popularity_note, source_name: r.source_name, source_url: r.source_url })), week);
    assert.deepEqual(again.errors, [], file);
    assert.ok(rows.every((r) => ROWS.some((x) => x.id === r.id)), `${file} loads`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "docs", "PROMPT-PACKS.md"), "utf8"), EM);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "server", "prompts", "whatsnew.js"), "utf8"), EM);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "web", "features", "prompts.js"), "utf8"), EM);
});

test("the pack tool validates its input", () => {
  const good = { title: "Plain summary", text: "Summarize [notes] in three lines.", category: "research and summaries" };
  assert.deepEqual(buildWeekPack([good], "2026-W46").errors, []);
  const built = buildWeekPack([good, { title: "Reel plan", text: "Plan a reel about [topic] for [audience]." }], "2026-W46");
  assert.equal(built.rows[0].id, "week-2026-w46-plain-summary");
  assert.equal(built.rows[0].added_week, "2026-W46");
  assert.equal(built.rows[1].category, "video", "a missing category is worked out");
  const errs = (items, week = "2026-W46") => buildWeekPack(items, week).errors.join(" | ");
  assert.match(errs([good], "2026-46"), /2026-W46/);
  assert.match(errs([]), /at least one/);
  assert.match(errs([{ ...good, category: "spaceships" }]), /not a category/);
  assert.match(errs([{ ...good, text: "Summarize the notes in three lines." }]), /square brackets/);
  assert.match(errs([{ ...good, text: "Summarize [notes] — three lines." }]), /long dash/);
  assert.match(errs([{ ...good, text: "Write an ad for [offer] that is guaranteed to sell." }]), /promises a result/);
  assert.match(errs([good, { ...good, text: "Summarize [notes] in two lines." }]), /repeats/);
  assert.match(errs([{ ...good, source_url: "http://example.com" }]), /https/);
  assert.match(errs(Array.from({ length: 31 }, (_, i) => ({ ...good, title: `Prompt number ${i} here` }))), /at most 30/);
  assert.deepEqual(parseInput("# c\nTitle one | video | Plan [a] clip\nTitle two | | Write [b]\n", "x.txt"), [
    { title: "Title one", category: "video", text: "Plan [a] clip" },
    { title: "Title two", category: "", text: "Write [b]" },
  ]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-weekpack-"));
  try {
    fs.writeFileSync(path.join(dir, "week-2026-w46.json"), "[]");
    const input = path.join(dir, "in.txt");
    fs.writeFileSync(input, "Plain summary | research and summaries | Summarize [notes] in three lines.\n");
    const logs = [];
    const quiet = { dir, log: (m) => logs.push(m), fail: (m) => logs.push(m) };
    assert.equal(run(["--next", "--in", input, "--check"], quiet), 0);
    assert.ok(!fs.existsSync(path.join(dir, "week-2026-w47.json")), "--check writes nothing");
    assert.equal(run(["--next", "--in", input], quiet), 0);
    const written = JSON.parse(fs.readFileSync(path.join(dir, "week-2026-w47.json"), "utf8"));
    assert.equal(written[0].added_week, "2026-W47");
    assert.equal(run(["--week", "2026-W47", "--in", input], quiet), 1, "an existing pack needs --force");
    assert.equal(run(["--week", "2026-W47", "--in", input, "--force"], quiet), 0);
    fs.writeFileSync(input, "Bad one | spaceships | no blank here at all\n");
    assert.equal(run(["--week", "2026-W48", "--in", input], quiet), 1);
    assert.ok(!fs.existsSync(path.join(dir, "week-2026-w48.json")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /prompts sends What's new and the filed rows, and hides packs for later weeks", async () => {
  const s = await startServer();
  try {
    const r = await s.api("/prompts");
    assert.equal(r.status, 200);
    const now = Date.now();
    const thisWeek = isoWeekOf(now);
    const later = (w) => w && w > thisWeek;
    const { whatsNew, filed, weekly } = r.json;
    assert.equal(whatsNew.title, "What's new");
    assert.ok(whatsNew.week && whatsNew.rows.length > 0);
    assert.ok(whatsNew.rows.every((row) => row.added_week === whatsNew.week));
    assert.ok(!weekly.some((row) => later(row.added_week)));
    assert.ok(!filed.some((row) => later(row.added_week)));
    for (const row of whatsNew.rows) {
      const inShelf = filed.find((f) => f.id === row.id) || r.json.templates.find((t) => t.shelf === PACK_SHELF[row.category]);
      assert.ok(inShelf, `${row.id} is also in a category`);
    }
    assert.equal(new Set(filed.map((f) => f.id)).size, filed.length);
  } finally {
    await s.stop();
  }
});

test("browser: the Prompts page shows What's new first as a category that opens and closes", async (t) => {
  const b = await bootPage({ mode: "simple" });
  if (!b) { t.skip("no Chrome or Edge on this machine"); return; }
  try {
    const { page } = b;
    await page.waitForFunction(() => window.CC && window.CC.featuresReady === true, null, { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => { localStorage.removeItem("cc.prompts.whatsnew.open"); window.CC.go("prompts"); });
    await page.waitForSelector('#pp-whatsnew details[data-shelf="whatsnew"]', { timeout: 20000 });
    await page.waitForSelector('#pp-list details[data-shelf]', { timeout: 20000 });
    const first = await page.evaluate(() => {
      const all = [...document.querySelectorAll("details[data-shelf]")].filter((d) => d.offsetParent !== null);
      const news = document.querySelector('details[data-shelf="whatsnew"]');
      const other = document.querySelector('#pp-list details[data-shelf]');
      return {
        first: all[0]?.dataset.shelf,
        title: news.querySelector("summary b").textContent,
        open: news.open,
        sameLook: news.className === other.className && !!other.querySelector("summary b"),
        rows: news.querySelectorAll("[data-use]").length,
        label: news.textContent,
      };
    });
    assert.equal(first.first, "whatsnew");
    assert.equal(first.title, "What's new");
    assert.equal(first.open, true, "open the first time a new week arrives");
    assert.equal(first.sameLook, true);
    assert.ok(first.rows > 0);
    assert.doesNotMatch(first.label, EM);
    // Collapse, then expand, then collapse and come back: it remembers.
    await page.click('details[data-shelf="whatsnew"] > summary');
    await page.waitForFunction(() => document.querySelector('details[data-shelf="whatsnew"]').open === false, null, { timeout: 5000 });
    await page.click('details[data-shelf="whatsnew"] > summary');
    await page.waitForFunction(() => document.querySelector('details[data-shelf="whatsnew"]').open === true, null, { timeout: 5000 });
    await page.click('details[data-shelf="whatsnew"] > summary');
    await page.waitForFunction(() => document.querySelector('details[data-shelf="whatsnew"]').open === false, null, { timeout: 5000 });
    await page.evaluate(() => window.CC.go("command"));
    await page.evaluate(() => window.CC.go("prompts"));
    await page.waitForSelector('#pp-whatsnew details[data-shelf="whatsnew"]', { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.querySelector('details[data-shelf="whatsnew"]').open), false, "closed state is remembered");
    // A weekly prompt is also in its normal category.
    const filedInShelf = await page.evaluate(() => {
      const id = document.querySelector('details[data-shelf="whatsnew"] [data-use]').dataset.use;
      return !!document.querySelector(`#pp-list details[data-shelf] [data-open="${CSS.escape(id)}"]`);
    });
    assert.equal(filedInShelf, true);
    assert.deepEqual(b.errors, []);
  } finally {
    await b.close();
  }
});
