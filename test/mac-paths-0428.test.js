// 0.4.28: five more choices in Simple's "Pick what to make" step (Spreadsheet, Document, Slides, App or script,
// List or data). Pure logic first, then real headless Chrome on the real server: the cards render and are reachable
// by keyboard, each path builds a goal that names the right file, the run goes as a Mission (only a Mission saves a
// named file), the Done step shows the saved file, the phone width has no sideways scroll, and card text is at
// least 4.5:1 on the painted pixels in dark and light. Windows rules: one browser at a time, real waits, every test
// closes its browser and server. Set CC_SHOTS to a folder to keep screenshots of the Pick step.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as F from "../web/mac/data/flow.js";
import { PATHS as CARD_PATHS, stylesFor as cardStyles } from "../web/mac/data/cards.js";
import { makeIntent } from "../web/make-intent.js";
import { wantedFile } from "../server/named-file.js";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { paintedContrast } from "./paint-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,.toasts,#update-bar,#upd-fail,#cc-look-offer,#cc-expert-card";
const SHOTS = process.env.CC_SHOTS || "";
const NEW = ["spreadsheet", "document", "slides", "script", "data"];
const LABELS = { spreadsheet: "Spreadsheet", document: "Document", slides: "Slides", script: "App or script", data: "List or data" };
const BLURBS = { spreadsheet: "A sheet with totals that add up.", document: "A letter, plan or guide in Word.", slides: "A short deck to present.", script: "A small tool that runs on your PC.", data: "A clean list you can open anywhere." };
const low = (list, min = 4.5) => list.filter((x) => x.ratio < min).map((x) => `${x.ratio} "${x.text}" fg ${x.fg} on ${x.bg}`);

// ---------- pure ----------

test("paths: the five new ones follow the first five, with label, blurb, hint, example and finish words", () => {
  assert.deepEqual(F.PATHS, ["website", "image", "video", "campaign", "mod", ...NEW]);
  assert.deepEqual(F.FILE_PATHS, NEW);
  for (const p of NEW) {
    assert.equal(F.PATH_LABEL[p], LABELS[p]);
    assert.equal(F.pathBlurb(p), BLURBS[p]);
    assert.ok(F.TELL_HINT[p] && F.tellPlaceholder(p).startsWith("For example: "), p);
    assert.ok(F.savesFile(p) && F.skipsProjectStart(p), p);
    assert.equal(F.runMode(p, true), "mission", `${p} runs as a Mission so the file is saved`);
    assert.equal(F.runMode(p, false), "single", `${p} on Free (no Missions) goes as one answer that still names the file`);
    assert.equal(F.stylesFor(p, null).length, 3);
    // the cards part has the full list, at least six, one popular
    const cards = CARD_PATHS[p];
    assert.ok(cards && cards.styles.length >= 6 && cards.styles.filter((s) => s.popular).length === 1, p);
  }
  for (const p of ["website", "image", "video", "campaign", "mod"]) { assert.equal(F.savesFile(p), false); assert.equal(F.runMode(p), ""); }
  // the cards part's styles keep their kind of file
  assert.deepEqual(cardStyles("script").map((s) => F.extFor("script", s)), ["py", "html", "ps1", "gs", "js", "sql"]);
  assert.deepEqual(cardStyles("data").map((s) => F.extFor("data", s)), ["csv", "csv", "csv", "csv", "csv", "json"]);
  // no em or en dashes anywhere a person reads
  const words = JSON.stringify([F.PATH_LABEL, F.PATH_BLURB, F.TELL_HINT, F.TELL_PLACEHOLDER, F.FINISH_LABEL, F.SAY_IT_HINT, F.NO_FILE_FINISH, F.FALLBACK_STYLES, F.EXTRA_IDEAS, CARD_PATHS]);
  // 0.4.28 (later): a single chat answer that names a file saves it on every plan, so there is no "needs Pro" line any more
  assert.equal(F.FREE_FILE_NOTE, undefined);
  assert.doesNotMatch(read("web", "mac", "parts", "flow.js") + read("web", "mac", "data", "flow.js"), /needs Pro|mf-free-file/);
  assert.deepEqual(F.EXTRA_IDEAS, [{ chip: "spreadsheet", text: "A budget spreadsheet for my family" }]);
  assert.equal(/[\u2013\u2014]/.test(words), false);
  for (const f of [["web", "mac", "data", "flow.js"], ["web", "mac", "data", "cards.js"], ["web", "mac", "parts", "flow.js"], ["web", "mac", "css", "flow.css"]]) assert.equal(/[\u2013\u2014]/.test(read(...f)), false, f.join("/"));
});

test("file names: short, safe, lowercase, dashes, from the words", () => {
  assert.equal(F.fileName("Monthly budget for my house, rent and food."), "monthly-budget-house-rent");
  assert.equal(F.fileName("Café résumé for José's shop!!"), "cafe-resume-joses-shop");
  assert.equal(F.fileName("   ", "budget"), "budget");
  assert.equal(F.fileName("", ""), "my-file");
  assert.equal(F.fileName("con"), "con-file", "a name Windows will not take");
  assert.equal(F.fileName("node"), "node-file", "never node.js, which reads as a product");
  const long = F.fileName("supercalifragilisticexpialidocious extraordinarily long words everywhere");
  assert.ok(long.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(long), long);
  assert.ok(F.fileName("x".repeat(90)).length <= 40);
  for (const s of ["<script>alert(1)</script>", "../../etc/passwd", "C:\\Windows\\system32", "a/b\\c:d*e?f\"g<h>i|j"]) assert.match(F.fileName(s), /^[a-z0-9]+(-[a-z0-9]+)*$/, s);
});

test("goals: each file path names its file, and the server reads the same name back", () => {
  const text = "Monthly budget for my house, rent and food.";
  const cases = [
    ["spreadsheet", F.popularStyle("spreadsheet", null), "monthly-budget-house-rent.xlsx", /^Make an Excel spreadsheet for monthly budget .*Kind: budget\. Use working formulas for every total/],
    ["document", { id: "resume", style: "resume" }, "monthly-budget-house-rent.docx", /^Write a Word document for monthly budget .*Kind: resume\./],
    ["slides", { id: "training", style: "training" }, "monthly-budget-house-rent.pptx", /^Make a PowerPoint deck about .*Kind: training\. Keep it short/],
    ["script", { id: "python", style: "python script", ext: "py" }, "monthly-budget-house-rent.py", /^Write a small Python script that does this: /],
    ["script", { id: "calculator", style: "web calculator", ext: "html" }, "monthly-budget-house-rent.html", /^Make a small web calculator as one HTML file/],
    ["script", { id: "powershell", ext: "ps1" }, "monthly-budget-house-rent.ps1", /PowerShell script for Windows/],
    ["script", { id: "sheets", ext: "gs" }, "monthly-budget-house-rent.gs", /Google Sheets script/],
    ["script", { id: "x", ext: "exe" }, "monthly-budget-house-rent.py", /Python script/],
    ["data", { id: "contacts", style: "contacts" }, "monthly-budget-house-rent.csv", /^Make a CSV list of .*Header row first/],
    ["data", { id: "json", style: "data for an app", ext: "json" }, "monthly-budget-house-rent.json", /^Make a JSON data file of /],
  ];
  for (const [p, st, file, re] of cases) {
    const goal = F.buildPrompt(p, st, text);
    assert.match(goal, re, goal);
    assert.ok(goal.endsWith(`Save it as ${file}`), goal);
    assert.equal(wantedFile(goal), file, `server/named-file.js reads ${file} from: ${goal}`);
    assert.equal(makeIntent(goal), null, `not read as a picture or video: ${goal}`);
    assert.equal(/[\u2013\u2014]/.test(goal), false);
    assert.doesNotMatch(goal, /Node\.js/, "never Node.js (LESSONS 2026-10-27)");
  }
  // the style picked on step 1 keeps its kind of file through pickStyle
  let s = F.start(F.initial(), "script");
  s = F.pickStyle(s, F.stylesFor("script", cardStyles("script"))[1]);
  assert.equal(s.style.ext, "html");
  s = F.setText(s, "split a dinner bill with tip");
  assert.match(F.buildPrompt(s.path, s.style, s.text), /Save it as split-dinner-bill-tip\.html$/);
});

test("words: say it with a word like spreadsheet, slides or script", () => {
  const g = (t) => F.pathFromWords(t, makeIntent(t)?.kind || "");
  assert.equal(g("make me a budget spreadsheet"), "spreadsheet");
  for (const [t, p] of [
    ["an excel sheet for my hours", "spreadsheet"], ["a budget for March", "spreadsheet"], ["a sheet for my bills", "spreadsheet"],
    ["a word doc for my staff", "document"], ["a document about our rules", "document"], ["a letter to my landlord", "document"], ["my resume", "document"], ["a video script for my bakery", "document"],
    ["slides for Monday", "slides"], ["a powerpoint for my team", "slides"], ["a deck about sales", "slides"], ["a presentation on safety", "slides"],
    ["a python script to rename files", "script"], ["a program that adds numbers", "script"], ["an app that tracks my water", "script"],
    ["export my customers as csv", "data"], ["a list of my contacts", "data"],
    ["a picture of a cat", "image"], ["a website for my bakery", "website"], ["a week of posts", "campaign"], ["a minecraft mod", "mod"],
  ]) assert.equal(g(t), p, t);
  assert.equal(g("hello there"), "");
  assert.match(F.SAY_IT_HINT, /picture, video, website, spreadsheet, slides, or script/);
});

test("saved file: name, place, copy, and the reason when it was not saved", () => {
  assert.equal(F.savedFileInfo(null), null);
  assert.equal(F.savedFileInfo({ savedFile: null }), null);
  assert.deepEqual(F.savedFileInfo({ savedFile: { ok: true, name: "budget.xlsx", path: "C:\\x\\budget.xlsx" } }), { ok: true, name: "budget.xlsx", path: "C:\\x\\budget.xlsx", copy: "", line: "Saved as budget.xlsx" });
  assert.equal(F.savedFileInfo({ savedFile: { ok: true, name: "a.csv", path: "/p/a.csv", copiedTo: "D:\\Out\\a.csv" } }).copy, "D:\\Out\\a.csv");
  assert.equal(F.savedFileInfo({ savedFile: { ok: true, name: "a.csv", path: "/p/a.csv" }, askedFolder: { folder: "D:\\Out" } }).copy, "D:\\Out");
  assert.deepEqual(F.savedFileInfo({ savedFile: { ok: false, name: "b.xlsx", error: "Not saved: there was no table to put in the spreadsheet." } }), { ok: false, name: "b.xlsx", line: "Not saved: there was no table to put in the spreadsheet." });
});

// ---------- real browser ----------

async function bootNew(opts) {
  const t = await bootPage({ mac: "default", hidePopups: false, ...opts });
  if (!t) return null;
  try {
    await t.page.waitForFunction(() => window.CC.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    await t.page.waitForSelector("#mac-flow .mf[data-step=home] .mf-path", { timeout: WAIT });
    await t.page.waitForTimeout(1200);
    return t;
  } catch (e) { await t.close(); throw e; }
}
async function shot(t, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await t.page.screenshot({ path: path.join(SHOTS, name) });
}
const step = (page) => page.evaluate(() => window.CC.mac.flow.state.step);

test("browser: the ten cards render with label and blurb, the keys reach every one, card text is 4.5:1 (dark and light)", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const t = await bootNew({ theme, width: 1366, height: 800 });
    try {
      assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "simple");
      const cards = await t.page.evaluate(() => [...document.querySelectorAll("#mac-flow .mf-path")].map((b) => ({ path: b.dataset.path, label: b.querySelector("b")?.textContent, blurb: b.querySelector("small")?.textContent, aria: b.getAttribute("aria-label"), tag: b.tagName, art: getComputedStyle(b.querySelector(".mf-art")).backgroundImage !== "none" })));
      assert.equal(cards.length, 10);
      for (const p of NEW) {
        const c = cards.find((x) => x.path === p);
        assert.ok(c, `${p} card`);
        assert.equal(c.label, LABELS[p]);
        assert.equal(c.blurb, BLURBS[p]);
        assert.equal(c.aria, `${LABELS[p]}. ${BLURBS[p]}`);
        assert.equal(c.tag, "BUTTON");
        assert.ok(c.art, `${p} has a picture`);
      }
      await shot(t, `pick-${theme}-1366.png`);
      // Keyboard: Tab from the first card goes to the second; the arrow keys walk all ten and bring each into view.
      await t.page.focus('#mac-flow .mf-path[data-path="website"]');
      await t.page.keyboard.press("Tab");
      assert.equal(await t.page.evaluate(() => document.activeElement?.dataset.path), "image", "Tab reaches the next card");
      await t.page.focus('#mac-flow .mf-path[data-path="website"]');
      const seen = [];
      for (let i = 0; i < 9; i++) {
        await t.page.keyboard.press("ArrowRight");
        await t.page.waitForTimeout(450);
        seen.push(await t.page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const row = document.getElementById("mf-paths").getBoundingClientRect(); return { path: a.dataset.path, inView: r.left >= row.left - 1 && r.right <= row.right + 1 }; }));
      }
      assert.deepEqual(seen.map((x) => x.path), ["image", "video", "campaign", "mod", ...NEW]);
      assert.deepEqual(seen.filter((x) => !x.inView), [], "each card is scrolled into view");
      await t.page.keyboard.press("Home");
      await t.page.waitForTimeout(450);
      assert.equal(await t.page.evaluate(() => document.activeElement?.dataset.path), "website");
      await t.page.keyboard.press("End");
      await t.page.waitForTimeout(450);
      assert.equal(await t.page.evaluate(() => document.activeElement?.dataset.path), "data");
      // The page buttons scroll the row for a mouse; Enter on a focused card opens it.
      await t.page.waitForFunction(() => document.getElementById("mf-more-paths").disabled, null, { timeout: WAIT }).catch(() => {});
      const ends = await t.page.evaluate(() => ({ prev: document.getElementById("mf-prev").disabled, next: document.getElementById("mf-more-paths").disabled }));
      assert.deepEqual(ends, { prev: false, next: true }, "at the end: back works, more is done");
      await t.page.evaluate(() => document.activeElement?.blur());
      await shot(t, `pick-${theme}-1366-new-cards.png`);
      // Card text contrast on the painted pixels, every card scrolled into view first.
      for (const p of ["website", ...NEW]) {
        await t.page.evaluate((p) => document.querySelector(`#mac-flow .mf-path[data-path="${p}"]`).scrollIntoView({ inline: "center", block: "nearest" }), p);
        await t.page.waitForTimeout(500);
        const got = await paintedContrast(t.page, `#mac-flow .mf-path[data-path="${p}"] b, #mac-flow .mf-path[data-path="${p}"] small`, { max: 2 });
        assert.equal(got.length, 2, `${theme} ${p}: measured label and blurb`);
        assert.deepEqual(low(got), [], `${theme} ${p}`);
      }
      // The page arrows: at the end the back arrow is on; it pages back to the start.
      for (let i = 0; i < 6 && !(await t.page.evaluate(() => document.getElementById("mf-prev").disabled)); i++) {
        await t.page.click("#mf-prev");
        await t.page.waitForTimeout(800);
      }
      await t.page.waitForFunction(() => document.getElementById("mf-paths").scrollLeft <= 2, null, { timeout: WAIT });
      assert.deepEqual(low(await paintedContrast(t.page, "#mac-flow .mf-sub, #mac-flow .mf-scroll:not([disabled])", { max: 4 })), [], `${theme} hint and arrows`);
      await t.page.focus('#mac-flow .mf-path[data-path="spreadsheet"]');
      await t.page.keyboard.press("Enter");
      await t.page.waitForFunction(() => window.CC.mac.flow.state.step === "style" && window.CC.mac.flow.state.path === "spreadsheet", null, { timeout: WAIT });
      assert.deepEqual(t.errors, [], "no page errors");
    } finally { await t.close(); }
  }
});

test("browser: Simple at 390 wide shows the cards without sideways scroll; the row swipes to the last card", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 390, height: 844 });
  try {
    const g = await t.page.evaluate(() => {
      const row = document.getElementById("mf-paths");
      const first = row.querySelector(".mf-path").getBoundingClientRect();
      const flow = document.getElementById("mac-flow");
      return { doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, flow: flow.scrollWidth - flow.clientWidth, rowScrolls: row.scrollWidth > row.clientWidth, first: { l: first.left, r: first.right, h: first.height }, touch: getComputedStyle(row).touchAction, overflowX: getComputedStyle(row).overflowX, sub: document.querySelector("#mac-flow .mf-subrow").getBoundingClientRect().right };
    });
    assert.ok(g.doc <= 390 && g.body <= 390, `the page does not scroll sideways ${JSON.stringify(g)}`);
    assert.ok(g.flow <= 1, `the Simple screen does not scroll sideways ${JSON.stringify(g)}`);
    assert.ok(g.first.l >= 0 && g.first.r <= 390 && g.first.h >= 150, `the first card is whole on screen ${JSON.stringify(g.first)}`);
    assert.ok(g.sub <= 390, "the hint and the arrows fit");
    assert.equal(g.rowScrolls, true, "the cards row scrolls on its own");
    assert.equal(g.overflowX, "auto");
    assert.match(g.touch, /pan-x/, "a finger can swipe the row");
    await shot(t, "pick-dark-390.png");
    // a swipe: scroll the row to the end; the last card is whole on screen and can be tapped
    await t.page.evaluate(() => { const r = document.getElementById("mf-paths"); r.scrollLeft = r.scrollWidth; });
    await t.page.waitForTimeout(600);
    const last = await t.page.evaluate(() => { const b = document.querySelector('#mac-flow .mf-path[data-path="data"]').getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { l: b.left, r: b.right, top: !!hit?.closest('.mf-path[data-path="data"]') }; });
    assert.ok(last.l >= 0 && last.r <= 390 && last.top, `the last card can be tapped ${JSON.stringify(last)}`);
    await shot(t, "pick-dark-390-end.png");
    await t.page.click('#mac-flow .mf-path[data-path="data"]');
    await t.page.waitForFunction(() => window.CC.mac.flow.state.step === "style", null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser: light theme at 390 keeps the card text readable", { skip }, async () => {
  const t = await bootNew({ theme: "light", width: 390, height: 844 });
  try {
    await shot(t, "pick-light-390.png");
    await t.page.evaluate(() => { const r = document.getElementById("mf-paths"); r.scrollLeft = r.querySelector('[data-path="spreadsheet"]').offsetLeft - r.offsetLeft; });
    await t.page.waitForTimeout(600);
    await shot(t, "pick-light-390-new-cards.png");
    const more = await paintedContrast(t.page, "#mac-flow .mf-path b, #mac-flow .mf-path small", { max: 6 });
    assert.ok(more.some((x) => /Spreadsheet|Document|Slides/.test(x.text)), "a new card was measured");
    assert.deepEqual(low(more), []);
    const got = await paintedContrast(t.page, "#mac-flow .mf-path b, #mac-flow .mf-path small", { max: 6 });
    assert.ok(got.length >= 2, "measured the cards on screen");
    assert.deepEqual(low(got), []);
  } finally { await t.close(); }
});

// Goes through the steps on screen, then reads the goal the flow would send for what was picked.
async function goalFor(t, pathId, styleName, text) {
  await t.page.evaluate(() => window.CC.mac.flow.reset());
  await t.page.waitForSelector("#mac-flow .mf[data-step=home] .mf-path", { timeout: WAIT });
  await t.page.evaluate((p) => document.querySelector(`#mac-flow .mf-path[data-path="${p}"]`).scrollIntoView({ inline: "center" }), pathId);
  await t.page.click(`#mac-flow .mf-path[data-path="${pathId}"]`);
  await t.page.waitForSelector("#mac-flow .mf[data-step=style]", { timeout: WAIT });
  await t.page.waitForSelector("#mf-cardhost .card, #mf-cardhost [data-style-id]", { timeout: WAIT });
  if (styleName) {
    const card = t.page.locator(`#mf-cardhost .card[aria-label="${styleName}"], #mf-cardhost [data-style-id]:has(b:text-is("${styleName}"))`).first();
    await card.click();
    await t.page.waitForTimeout(300);
  }
  await t.page.click("#mf-next");
  await t.page.waitForSelector("#mac-flow .mf[data-step=tell]", { timeout: WAIT });
  const ph = await t.page.getAttribute("#mf-text", "placeholder");
  await t.page.fill("#mf-text", text);
  await t.page.waitForFunction(() => !document.querySelector("#mf-make").disabled, null, { timeout: WAIT });
  const goal = await t.page.evaluate(async () => { const F = await import("/mac/data/flow.js"); const s = window.CC.mac.flow.state; return F.buildPrompt(s.path, s.style, s.text); });
  const free = await t.page.evaluate(() => document.getElementById("mf-free-file")?.textContent || "");
  return { goal, ph, free, sub: await t.page.textContent("#mac-flow .mf-sub") };
}

test("browser: each new path, with a style picked on screen, builds a goal that names the right file", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 800 });
  try {
    const rows = [
      ["spreadsheet", "Invoice", "lawn care for the Smith family", /Kind: invoice\..*Save it as lawn-care-smith-family\.xlsx$/],
      ["document", "Resume", "a store manager job", /^Write a Word document for .*Kind: resume\..*Save it as store-manager-job\.docx$/],
      ["slides", "Training", "how to greet customers", /^Make a PowerPoint deck about .*Kind: training\..*Save it as greet-customers\.pptx$/],
      ["script", "Web calculator", "split a dinner bill with tip", /^Make a small web calculator as one HTML file.*Save it as split-dinner-bill-tip\.html$/],
      ["script", "Google Sheets script", "email me when a row is added", /Google Sheets script.*Save it as email-when-row-added\.gs$/],
      ["script", "PowerShell", "clean out my Downloads folder", /PowerShell script for Windows.*Save it as clean-out-downloads-folder\.ps1$/],
      ["data", "Leads", "people from the home show", /^Make a CSV list of .*Kind: leads\..*Save it as people-home-show\.csv$/],
    ];
    for (const [p, style, text, re] of rows) {
      const r = await goalFor(t, p, style, text);
      assert.match(r.goal, re, `${p} / ${style}: ${r.goal}`);
      assert.equal(wantedFile(r.goal), r.goal.split("Save it as ").pop(), "the server saves that name");
      assert.equal(r.ph, F.tellPlaceholder(p));
      assert.equal(r.sub, F.TELL_HINT[p]);
      // this test server runs on Free (no Missions): no "needs Pro" line, the single answer saves the named file
      assert.equal(r.free, "");
    }
    // the word box on Home picks the path
    await t.page.evaluate(() => window.CC.mac.flow.reset());
    await t.page.waitForSelector("#mac-flow .mf[data-step=home] #mf-ask", { timeout: WAIT });
    await t.page.fill("#mf-ask", "make me a budget spreadsheet");
    await t.page.click("#mf-next");
    await t.page.waitForFunction(() => window.CC.mac.flow.state.step === "style" && window.CC.mac.flow.state.path === "spreadsheet", null, { timeout: WAIT });
    await t.page.evaluate(() => window.CC.mac.flow.reset());
    await t.page.waitForSelector("#mac-flow .mf[data-step=home] #mf-ask", { timeout: WAIT });
    await t.page.fill("#mf-ask", "hello there");
    await t.page.click("#mf-next");
    await t.page.waitForSelector("#mac-flow .mf-note", { timeout: WAIT });
    assert.equal(await t.page.textContent("#mac-flow .mf-note"), F.SAY_IT_HINT);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser: List path end to end with practice AIs: sent as a Mission naming the .csv, Done shows the saved file and Open file", { skip }, async () => {
  // Missions are a Pro feature; the developer override (unpackaged run only) gives this test server the full plan.
  const t = await bootNew({ theme: "dark", width: 1366, height: 860, env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    await t.page.waitForFunction(() => window.CC?.mac?.flow && window.CC.featuresReady === true && document.getElementById("orders"), null, { timeout: WAIT });
    await t.page.waitForSelector("#mac-flow .mf[data-step=home] .mf-path", { timeout: WAIT });
    const before = await t.page.evaluate(() => window.CC.S.simpleRunMode || "");
    const g = await goalFor(t, "data", "Products", "items in my bakery");
    assert.equal(g.free, "", "no Free note when Missions are on the plan");
    // the cost line works like the other paths
    await t.page.waitForFunction(() => /^(Free|About \$)/.test(document.querySelector("#mac-flow .mf-cost")?.textContent || ""), null, { timeout: WAIT });
    const sent = t.page.waitForRequest((r) => r.method() === "POST" && /\/api\/(mission|chat|council)$/.test(new URL(r.url()).pathname), { timeout: WAIT });
    await t.page.click("#mf-make");
    const req = await sent;
    assert.match(new URL(req.url()).pathname, /\/api\/mission$/, "a file path runs as a Mission");
    assert.match(JSON.parse(req.postData()).goal, /^Make a CSV list of items in my bakery\. Kind: products\..*Save it as items-bakery\.csv$/);
    await t.page.waitForFunction((b) => (window.CC.S.simpleRunMode || "") === b, before, { timeout: WAIT });
    // Done (practice AIs answer quickly); the file box says what was saved
    await t.page.waitForFunction(() => ["done", "incomplete"].includes(window.CC.mac.flow.state.step), null, { timeout: waitBudget(120000) });
    await t.page.waitForFunction(() => !document.getElementById("mf-saved")?.hidden, null, { timeout: WAIT });
    const box = await t.page.evaluate(() => ({ text: document.getElementById("mf-saved").textContent, open: !!document.getElementById("mf-open"), fin: document.getElementById("mf-finish")?.textContent || "", saved: window.CC.S.live?.mission?.savedFile || null }));
    assert.ok(box.saved, "the run reports a saved file");
    if (box.saved.ok) {
      assert.match(box.text, /Saved as items-bakery(-\d+)?\.csv/);
      assert.equal(box.open, true, "Open file is there");
      assert.equal(box.fin, "Open list");
      // Open file uses the result card's route; dryRun so no window opens during the test
      await t.page.route("**/api/dogfood/file/open", (route) => route.continue({ postData: JSON.stringify({ ...JSON.parse(route.request().postData() || "{}"), dryRun: true }) }));
      const opened = t.page.waitForResponse((r) => /\/api\/dogfood\/file\/open$/.test(new URL(r.url()).pathname), { timeout: WAIT });
      await t.page.click("#mf-open");
      const res = await opened;
      assert.equal(res.status(), 200);
      assert.match((await res.json()).path, /items-bakery(-\d+)?\.csv$/);
    } else {
      // the practice AI wrote no rows, so the run says plainly that nothing was saved and offers copy or download
      assert.match(box.text, /^Not saved: /);
      assert.equal(box.open, false);
      assert.equal(box.fin, F.NO_FILE_FINISH);
      if (SHOTS) await shot(t, "done-list-not-saved-dark.png");
      // A run that did save (as a real AI's answer would): the box follows the run's savedFile on its own, and
      // Open file asks the existing route for this run. The reply is stubbed so no window opens during the test.
      await t.page.evaluate(() => { const m = window.CC.S.live.mission; m.savedFile = { ok: true, name: "items-bakery.csv", requested: "items-bakery.csv", path: "C:/Meldmind/items-bakery.csv", ext: "csv" }; m.askedFolder = { folder: "D:/Shop", files: [] }; });
      await t.page.waitForSelector("#mf-open", { timeout: WAIT });
      const ok = await t.page.evaluate(() => ({ text: document.getElementById("mf-saved").textContent, fin: document.getElementById("mf-finish").textContent, bad: document.getElementById("mf-saved").classList.contains("bad") }));
      assert.match(ok.text, /^Saved as items-bakery\.csv/);
      assert.ok(ok.text.includes("C:/Meldmind/items-bakery.csv") && ok.text.includes("A copy is in D:/Shop"), ok.text);
      assert.equal(ok.bad, false);
      assert.equal(ok.fin, "Open list");
      const runId = await t.page.evaluate(() => window.CC.S.live.mission.id || window.CC.S.live.id);
      await t.page.route("**/api/dogfood/file/open", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, dryRun: true }) }));
      const asked = t.page.waitForRequest((r) => /\/api\/dogfood\/file\/open$/.test(new URL(r.url()).pathname), { timeout: WAIT });
      await t.page.click("#mf-open");
      assert.deepEqual(JSON.parse((await asked).postData()), { mission: runId });
      assert.deepEqual(low(await paintedContrast(t.page, "#mf-saved b, #mf-saved .mf-file-path, #mf-open", { max: 4 })), [], "file box text");
    }
    if (SHOTS) await shot(t, "done-list-dark.png");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser: on Free a file path goes as one answer (Single) whose goal names the file; Quick picks has a spreadsheet", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 860 });
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    await t.page.waitForFunction(() => window.CC?.mac?.flow && window.CC.featuresReady === true && document.getElementById("orders"), null, { timeout: WAIT });
    await t.page.waitForSelector("#mac-flow .mf[data-step=home] .mf-path", { timeout: WAIT });
    assert.equal(await t.page.evaluate(() => window.CC.S.license?.limits?.missions === true), false, "this server is on Free");
    // Quick picks: the spreadsheet example sits with the others and opens the Spreadsheet path with its words
    await t.page.waitForSelector('#mac-flow .mf-chip[data-idea="spreadsheet"]', { timeout: WAIT });
    const chips = await t.page.evaluate(() => [...document.querySelectorAll("#mac-flow .mf-chip")].map((c) => c.textContent));
    assert.ok(chips.includes("A budget spreadsheet for my family") && chips.length >= 5, chips.join(" | "));
    await t.page.click('#mac-flow .mf-chip[data-idea="spreadsheet"]');
    await t.page.waitForFunction(() => window.CC.mac.flow.state.path === "spreadsheet" && window.CC.mac.flow.state.step === "tell", null, { timeout: WAIT });
    assert.equal(await t.page.inputValue("#mf-text"), "A budget spreadsheet for my family");
    assert.equal(await t.page.evaluate(() => document.getElementById("mf-free-file")), null, "no needs Pro line");
    if (SHOTS) await shot(t, "tell-spreadsheet-free-dark.png");
    const before = await t.page.evaluate(() => window.CC.S.simpleRunMode || "");
    await t.page.waitForFunction(() => !document.querySelector("#mf-make").disabled, null, { timeout: WAIT });
    const sent = t.page.waitForRequest((r) => r.method() === "POST" && /\/api\/(mission|chat|council)$/.test(new URL(r.url()).pathname), { timeout: WAIT });
    await t.page.click("#mf-make");
    const req = await sent;
    assert.match(new URL(req.url()).pathname, /\/api\/chat$/, "on Free a file path is one answer, not a Mission");
    const body = JSON.parse(req.postData());
    assert.match(body.prompt, /^Make an Excel spreadsheet for .*Save it as [a-z0-9-]+\.xlsx$/, body.prompt);
    assert.equal(wantedFile(body.prompt), body.prompt.split("Save it as ").pop(), "the server reads the file name from the single answer");
    await t.page.waitForFunction((b) => (window.CC.S.simpleRunMode || "") === b, before, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
