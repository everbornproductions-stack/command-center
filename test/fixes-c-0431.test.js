// 0.4.31 fixes, group C (meldmind-panel-0428/FIXES-0430.md items 5, 8, 9, 10, 11a, 11d, 11e).
// 5: the practice AIs answer a spreadsheet or list request with a table, so Spreadsheet and List or data save a real
//    .xlsx and .csv in demo. 8: the Expert Deliverable is at least 420 px wide at 1366 x 800. 9: the two light lines
//    read at 4.5 : 1 or better. 10: a page whose module never arrives says so after 8 seconds, with Try again.
// 11a: the Media button price has two decimals. 11d: Expert at 390 keeps the task box clear of the Talk bar.
// 11e: a practice answer heading drops a folder path and keeps the file name.
// Real server in demo mode (practice AIs, no key, nothing sent) and headless Chrome (skips when none is installed).
// Windows rules: one server and one browser at a time, real waits (polls and waitForFunction), everything closed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, chatRunId, runSettled, waitBudget, ROOT } from "./helpers.js";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { paintedContrast } from "./paint-helpers.js";
import { kindOf, requestOf, practiceAnswer, practiceVerdict, practiceDisagreement, answerTitle, columnsOf, tableFor, PRACTICE_LABEL } from "../server/demo-answers.js";
import { tablesFromAnswer } from "../server/office-files.js";
import { bodyForFile } from "../server/code-files.js";
import { buildPrompt } from "../web/mac/data/flow.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(90000);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const SHEET = buildPrompt("spreadsheet", { id: "budget", style: "budget" }, "monthly budget for my house, rent, food, gas");
const LIST = buildPrompt("data", { id: "products", style: "products" }, "products in my shop with name, price and stock");
const MODELS = ["nova-lite", "atlas-pro", "sage-mini"];

// ---------- item 5: the practice answers for a spreadsheet or a list are tables ----------

test("item 5: a spreadsheet or CSV request gets a table from every practice AI; scripts and idea lists keep their kind", () => {
  assert.match(SHEET, /Save it as monthly-budget-house-rent\.xlsx$/);
  assert.match(LIST, /Save it as products-shop-name-price\.csv$/);
  assert.equal(kindOf(requestOf(SHEET)), "table");
  assert.equal(kindOf(requestOf(LIST)), "table");
  assert.equal(kindOf("Write a python script to read a csv"), "code");
  assert.equal(kindOf("Write a python script that reads sales.csv. Save it as totals.py"), "code");
  assert.equal(kindOf("Give me 5 content ideas for my gym"), "list");
  assert.deepEqual(columnsOf(LIST), ["Name", "Price", "Stock"]);

  const texts = MODELS.map((m) => practiceAnswer(`TASK: ${SHEET}`, m));
  assert.equal(new Set(texts).size, 3, "the three practice AIs still answer differently");
  for (const t of texts) {
    const sheets = tablesFromAnswer(t);
    assert.equal(sheets.length, 1, t);
    assert.deepEqual(sheets[0].rows[0], ["Item", "Monthly amount"]);
    assert.deepEqual(sheets[0].rows.slice(1, 4).map((r) => r[0]), ["Rent", "Food", "Gas"], "the rows come from the request");
    assert.deepEqual(sheets[0].rows.at(-1), ["**Total**", "=SUM(B2:B4)"], "the total is a formula");
    assert.match(t, new RegExp(PRACTICE_LABEL));
    assert.doesNotMatch(t, /[\u2013\u2014]/);
    assert.ok(t.length < 1400, `short: ${t.length}`);
  }
  for (const m of MODELS) {
    const csv = bodyForFile("products-shop-name-price.csv", [{ text: practiceAnswer(`TASK: ${LIST}`, m), from: "answer" }]);
    assert.ok(csv, m);
    const lines = csv.body.trim().split("\n");
    assert.equal(lines[0], "Name,Price,Stock");
    assert.equal(lines.length, 6, "a header and five products");
    assert.match(lines[1], /^[A-Z][a-z ]+,\d+\.\d\d,\d+$/);
  }
  // a mission's assembler (GOAL: ...) and a council chair answer with the table too
  assert.equal(tablesFromAnswer(practiceAnswer(`GOAL:\n${SHEET}\n\n## Draft\nx`, "nova-ultra")).length, 1);
  const verdict = practiceVerdict(`QUESTION:\n${SHEET}\n\nANSWERS:\n### Answer A (Nova (demo))\nx`, "nova-ultra");
  assert.equal(tablesFromAnswer(verdict).length, 1);
  assert.match(verdict, /\*\*Where the council disagreed\*\*\n- /);
  assert.match(practiceDisagreement(`QUESTION:\n${SHEET}\n`), /table/);
  // a CSV budget gets the number, not a formula; an invoice multiplies each line
  assert.match(tableFor("Make a CSV list of my monthly budget, rent, food. Save it as b.csv").table, /\| Total \| 1650\.00 \|/);
  assert.match(tableFor("Make an Excel spreadsheet for an invoice. Save it as i.xlsx").table, /=B2\*C2[\s\S]*=SUM\(D2:D4\)/);
});

async function finished(s, id) {
  const t0 = Date.now(), done = runSettled(id);
  while (Date.now() - t0 < RUN) {
    try { if (done((await s.api("/state")).json)) return (await s.api(`/missions/${id}`)).json; } catch { /* a reset socket on a busy PC: poll again */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`chat ${id} did not finish:\n${s.log.slice(-2000)}`);
}

test("item 5 (server): demo Spreadsheet and List or data save a real .xlsx and .csv", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const sheet = await finished(s, await chatRunId(s.api, { prompt: SHEET }));
    assert.equal(sheet.status, "done", sheet.error);
    assert.equal(sheet.savedFile?.ok, true, JSON.stringify(sheet.savedFile));
    assert.equal(sheet.savedFile.name, "monthly-budget-house-rent.xlsx");
    const head = fs.readFileSync(sheet.savedFile.path).subarray(0, 2).toString("latin1");
    assert.equal(head, "PK", "a real Excel file (zip) is on the disk");
    assert.match(sheet.deliverable, /Saved monthly-budget-house-rent\.xlsx in /);
    assert.doesNotMatch(sheet.deliverable, /Not saved/);

    const list = await finished(s, await chatRunId(s.api, { prompt: LIST }));
    assert.equal(list.status, "done", list.error);
    assert.equal(list.savedFile?.ok, true, JSON.stringify(list.savedFile));
    assert.equal(list.savedFile.name, "products-shop-name-price.csv");
    const csv = fs.readFileSync(list.savedFile.path, "utf8");
    assert.match(csv, /^Name,Price,Stock\n/);
    assert.equal(csv.trim().split("\n").length, 6);
    assert.match(list.deliverable, /Saved products-shop-name-price\.csv in /);
    assert.doesNotMatch(list.deliverable, /Not saved/);
  } finally { await s.stop(); }
});

// ---------- item 11e: the heading drops a folder path and keeps the file name ----------

test("item 11e: a practice heading never stops inside a folder path and keeps the file name", () => {
  assert.equal(answerTitle("Write a dinner menu for my cafe with prices and save it as menu.md in C:\\Users\\chris\\Desktop\\Cafe Files\\menus"), "Write a dinner menu for my cafe with prices and save it as menu.md");
  const long = answerTitle("Write a dinner menu for my little neighborhood cafe with six dishes and prices, then save it as menu.md in ~/Documents/cafe");
  assert.ok(long.endsWith("save it as menu.md"), long);
  assert.ok(long.length <= 93, long);
  assert.doesNotMatch(long, /Documents|~\//);
  assert.equal(answerTitle("Save the notes as plan.md into D:/work/notes/2026"), "Save the notes as plan.md");
  assert.equal(practiceAnswer("TASK: Write a short menu and save it as menu.md in C:\\Users\\me\\Desktop\\cafe", "sage-mini").split("\n")[0], "## Write a short menu and save it as menu.md");
  // no path: the 0.4.25 rules stand
  assert.equal(answerTitle("Rename notes.txt to plan.md and keep a copy of the old one in the archive folder for later reading please, thanks a lot."), "Rename notes.txt to plan.md and keep a copy of the old one in the archive folder for later...");
  assert.equal(answerTitle("Compare plans and/or prices for my shop"), "Compare plans and/or prices for my shop");
});

// ---------- item 11a: Media button price, two decimals ----------

test("item 11a: the Media Generate button shows the price with two decimals, like the price line", () => {
  const src = read("web", "features", "media.js");
  assert.match(src, /#md-go"\)\.textContent = [^;]*`Generate \(about \$\{money\(r\.usd, 2\)\}\)`/);
  assert.doesNotMatch(src, /Generate \(about \$\{money\(r\.usd, 3\)\}\)/);
});

// ---------- browser tests ----------

const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer,.toasts";
async function boot({ theme = "light", width = 1366, height = 800, mode, demo = true } = {}) {
  const t = await bootPage({ mac: "default", hidePopups: false, theme, width, height, mode });
  if (!t) return null;
  try {
    if (demo) {
      assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
      await t.page.reload({ waitUntil: "domcontentloaded" });
    }
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length && window.CC.S.settingsLoaded, null, { timeout: WAIT });
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    return t;
  } catch (e) { await t.close(); throw e; }
}
async function toExpert(t) {
  if (await t.page.evaluate(() => document.body.dataset.ui) !== "expert") await t.page.click("#mac-expert");
  await t.page.waitForFunction(() => document.body.dataset.ui === "expert" && !document.getElementById("mac-side").hidden, null, { timeout: WAIT });
}
// the page fade (0.3 s) and any other running animation have finished
const settled = (t) => t.page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming?.().iterations === Infinity), null, { timeout: WAIT });

test("item 8: Expert at 1366 x 800, the Deliverable is at least 420 px wide once an answer shows", { skip }, async () => {
  const t = await boot({ width: 1366, height: 800 });
  try {
    await toExpert(t);
    await t.page.evaluate(() => window.CC.go("command"));
    await t.page.waitForSelector("#orders", { timeout: WAIT });
    // 0.4.38 (Chris: Expert Command as a chat): one chat column, no side columns; the answer card (#ex-answer) took the
    // place of #deliv-panel and keeps the width and the one-line "Written by" head this test guards
    assert.equal(await t.page.evaluate(() => !!document.querySelector("#view > .ex-chat") && !document.querySelector("#view > .cmd")), true, "the Command chat page");
    await t.page.fill("#orders", "Plan a bake sale for Saturday with a full list of steps");
    await t.page.click("#go");
    await t.page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !document.getElementById("ex-answer").hidden, null, { timeout: RUN });
    await settled(t);
    const card = await t.page.evaluate(() => {
      const p = document.querySelector("#ex-answer .sc-card"), head = document.getElementById("out-head");
      const lh = parseFloat(getComputedStyle(head).lineHeight) || 18;
      return { ui: document.body.dataset.ui, w: Math.round(p.getBoundingClientRect().width), headLines: Math.round(head.getBoundingClientRect().height / lh), headText: head.textContent.trim() };
    });
    assert.equal(card.ui, "expert");
    assert.ok(card.w >= 420, `the answer card is ${card.w} px wide`);
    // 0.5.0 (chat like the Claude app): the small label reads "Meldmind · <AI> · <model>"
    assert.match(card.headText, /\(demo\) · \S+/);
    assert.ok(card.headLines <= 1, `"${card.headText}" takes ${card.headLines} lines`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("item 9: the any-key line in Settings and the balance line in Credits read at 4.5 : 1 in light (Expert 1366 and 390, Simple 390)", { skip }, async () => {
  for (const [mode, width] of [["expert", 1366], ["expert", 390], ["simple", 390]]) {
    const t = await boot({ width, height: width < 500 ? 844 : 800, mode });
    try {
      if (mode === "expert") await toExpert(t);
      assert.equal(await t.page.evaluate(() => document.body.dataset.ui), mode);
      await t.page.evaluate(() => { window.CC.S.settingsMore = true; window.CC.go("settings"); });
      await t.page.waitForFunction(() => !!document.getElementById("anykey"), null, { timeout: WAIT });
      await t.page.evaluate(() => { const l = document.getElementById("anykey").closest(".route").querySelector(".small"); l.id = "t-anykey"; l.scrollIntoView({ block: "center" }); });
      await settled(t);
      const key = await paintedContrast(t.page, "#t-anykey", { max: 1 });
      assert.equal(key.length, 1, `${mode} ${width}: the any-key line was measured`);
      assert.ok(key[0].ratio >= 4.5, `${mode} ${width} Settings: ${key[0].ratio} "${key[0].text}" fg ${key[0].fg} on ${key[0].bg}`);
      await t.page.evaluate(() => window.CC.go("credits"));
      await t.page.waitForFunction(() => [...document.querySelectorAll("#view .small")].some((e) => /does not tell Meldmind its balance/.test(e.textContent)), null, { timeout: WAIT });
      await t.page.evaluate(() => { const l = [...document.querySelectorAll("#view .small")].find((e) => /does not tell Meldmind its balance/.test(e.textContent)); l.id = "t-balance"; l.scrollIntoView({ block: "center" }); });
      await settled(t);
      const bal = await paintedContrast(t.page, "#t-balance", { max: 1 });
      assert.equal(bal.length, 1, `${mode} ${width}: the balance line was measured`);
      assert.ok(bal[0].ratio >= 4.5, `${mode} ${width} Credits: ${bal[0].ratio} "${bal[0].text}" fg ${bal[0].fg} on ${bal[0].bg}`);
    } finally { await t.close(); }
  }
});

test("item 10: a page whose module never arrives says so after 8 seconds, and Try again opens it", { skip }, async () => {
  const t = await boot({ width: 1366, height: 800, demo: false });
  try {
    // the module for History never arrives
    await t.page.evaluate(() => {
      const CC = window.CC;
      window.__real = { ready: CC.viewReady, ensure: CC.ensureView };
      CC.viewReady = (v, o) => (v === "history" ? false : window.__real.ready(v, o));
      CC.ensureView = (v, o) => (v === "history" ? new Promise(() => {}) : window.__real.ensure(v, o));
      CC.go("history");
    });
    await t.page.waitForSelector('#view [data-page-wait="loading"]', { timeout: WAIT });
    assert.equal((await t.page.textContent('#view [data-page-wait="loading"]')).trim(), "Loading...");
    const t0 = Date.now();
    await t.page.waitForSelector("#view #page-retry", { timeout: waitBudget(20000) });
    assert.ok(Date.now() - t0 >= 6000, "the page waits about 8 seconds before giving up");
    assert.match(await t.page.textContent('#view [data-page-wait="failed"]'), /This page did not load\.\s*Try again/);
    assert.equal(await t.page.evaluate(() => document.querySelector('#view [data-page-wait="failed"]').getAttribute("role")), "alert");

    // a download that fails at once (the import resolves but the page is still missing) says so at once, no loop
    await t.page.evaluate(() => { window.CC.ensureView = (v, o) => (v === "history" ? Promise.resolve() : window.__real.ensure(v, o)); window.CC.go("command"); });
    await t.page.waitForFunction(() => !document.querySelector("#view [data-page-wait]"), null, { timeout: WAIT });
    const t1 = Date.now();
    await t.page.evaluate(() => window.CC.go("history"));
    await t.page.waitForSelector("#view #page-retry", { timeout: WAIT });
    assert.ok(Date.now() - t1 < 5000, "a failed download is reported without the 8 second wait");

    // the module arrives now: Try again opens the page
    await t.page.evaluate(() => { window.CC.viewReady = window.__real.ready; window.CC.ensureView = window.__real.ensure; });
    await t.page.click("#page-retry");
    await t.page.waitForFunction(() => window.CC.S.renderedView === "history" && !document.querySelector("#view [data-page-wait]"), null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("item 11d: Expert at 390, the task box is clear of the Talk bar at load and #view leaves room for it", { skip }, async () => {
  const t = await boot({ width: 390, height: 844, mode: "expert", demo: false });
  try {
    await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: WAIT });
    await t.page.evaluate(() => window.CC.go("command"));
    await t.page.waitForSelector("#orders", { timeout: WAIT });
    await settled(t);
    const r = await t.page.evaluate(() => {
      const v = document.getElementById("view"), o = document.getElementById("orders").getBoundingClientRect(), bar = document.getElementById("vt-bar");
      const b = bar && !bar.hidden && bar.getBoundingClientRect().height > 0 ? bar.getBoundingClientRect() : null; // 0.5.0: the chat page hides the Talk bar row
      const hit = document.elementFromPoint(o.left + 20, o.bottom - 4);
      // 0.4.38 (Chris: Expert Command as a chat): the chat page ends above the Talk bar (#view stops where it starts), so
      // it needs no bottom padding for it
      const viewClear = !b || Math.round(v.getBoundingClientRect().bottom) <= Math.round(b.top) + 1;
      return { pad: parseFloat(getComputedStyle(v).paddingBottom), viewClear, barH: b ? Math.round(b.height) : 0, overlap: b ? Math.max(0, Math.round(o.bottom - b.top)) : 0, bottomOnTop: !!hit && (hit.id === "orders" || hit.closest?.("#orders") != null) };
    });
    assert.ok(r.pad >= r.barH || r.viewClear, `#view bottom padding ${r.pad} px covers the Talk bar (${r.barH} px), or #view ends above it`);
    assert.equal(r.overlap, 0, "the task box does not run under the Talk bar");
    assert.equal(r.bottomOnTop, true, "the bottom of the task box is on top");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
