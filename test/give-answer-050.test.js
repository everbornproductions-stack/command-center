// 0.5.0 (0.4.39 panel, FIXES-0441 item 1): "Give to an agent" under the first answer handed the agent an empty answer.
// The first answer's Make changes button carried data-turn="", Number("") is 0, and turns[0] is not the answer. Every Give
// to an agent path now hands over the answer it sits under: the first answer's Make changes button and its icon, and a
// follow-up reply's Make changes button and its icon, in Simple and in Expert.
// Real server in demo mode (practice AIs, no keys, nothing sent), headless Chrome through bootMac (the Mac look, as a new
// user boots). Nothing is assigned: each dialog is read and cancelled. Skips only when no Chrome is installed.
// @helper-process: bootMac starts the app server and a browser. Windows rules: one server and one browser at a time,
// real waits, every test closes what it opens.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(180000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer,#cc-whats-new{display:none!important}";

test("source: every Give to an agent under an answer goes through scGive, and no turn means the first answer", () => {
  const app = read("web", "app.js");
  assert.match(app, /function scGive\(turn\)/);
  assert.match(app, /if \(give\) return void scGive\(give\.dataset\.turn\);/, "the Make changes button");
  assert.match(app, /if \(which === "give"\) return void scGive\(""\);/, "the first answer's icon");
  assert.match(app, /if \(which === "give"\) return void scGive\(i\);/, "a reply's icon");
  // the old path read turns[Number("")], which is turns[0]
  assert.doesNotMatch(app, /Number\(give\.dataset\.turn\)/);
  const fn = app.slice(app.indexOf("function scGive(turn)"), app.indexOf("function scGive(turn)") + 900);
  assert.match(fn, /String\(turn\)\.trim\(\) === ""/, "an empty turn is the first answer");
  assert.match(fn, /answer: scFirstAnswer\(l\)/);
  // every caller of the team dialog from the chat passes an answer
  const calls = [...app.matchAll(/giveAnswer\?\.\(\{([^}]*)\}\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 2, `giveAnswer calls found (${calls.length})`);
  for (const c of calls) assert.match(c, /answer: \S/, `every call passes an answer: ${c}`);
});

async function boot(mode) {
  const t = await bootMac({ width: 1366, height: 800, mode, theme: "light", env: { CC_DEV_OWNER: "1" } });
  if (!t) return null;
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true && !!window.CC.team?.giveAnswer, null, { timeout: WAIT });
    await t.page.addStyleTag({ content: POPUPS });
    if ((await t.page.evaluate(() => document.body.dataset.ui)) !== mode) {
      await t.page.click(mode === "expert" ? "#mac-expert" : "#mac-simple");
      await t.page.waitForFunction((m) => document.body.dataset.ui === m, mode, { timeout: WAIT });
    }
    await t.page.evaluate(() => { window.CC.go("command"); window.CC.mac.bus.emit("chat"); });
    await t.page.waitForFunction(() => !!document.querySelector("#view .chat2 #cb #orders") && document.body.dataset.macFlow !== "on", null, { timeout: WAIT });
    return t;
  } catch (e) { await t.close(); throw e; }
}
// Type and press Send like a person. The second one goes on in the same chat.
async function send(page, text) {
  const before = await page.evaluate(() => ({ id: window.CC.S.live?.id || "", n: document.querySelectorAll("#sc-turns .sc-reply").length }));
  await page.fill("#orders", text);
  await page.click("#go");
  await page.waitForFunction((b) => (window.CC.S.live?.id && window.CC.S.live.id !== b.id) || document.querySelectorAll("#sc-turns .sc-reply").length > b.n, before, { timeout: RUN });
  await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !window.CC.S.live?.replying && [...document.querySelectorAll("#view .chat2 .sc-acts")].every((a) => a.getBoundingClientRect().height > 0), null, { timeout: RUN });
}
// Click a Give button, read the dialog's "What to do" text, then Cancel (nothing is assigned).
async function giveText(page, selector) {
  await page.click(selector);
  await page.waitForSelector(".tm-dlg #tg-text", { timeout: WAIT });
  const text = await page.inputValue("#tg-text");
  await page.click(".tm-dlg [data-close]");
  await page.waitForFunction(() => !document.querySelector(".tm-dlg"), null, { timeout: WAIT });
  const m = text.match(/The answer to work from:\n([\s\S]*?)\n\nTake it from here/);
  return { text, answer: m ? m[1].trim() : "" };
}
// Open an answer's Make changes fold (the first answer has no data-turn on its row; a reply's row has its index).
async function openFold(page, row) {
  const btn = `#view ${row} [data-sc-act='change']`;
  if ((await page.getAttribute(btn, "aria-expanded")) !== "true") await page.click(btn);
  await page.waitForFunction((b) => document.querySelector(b)?.getAttribute("aria-expanded") === "true", btn, { timeout: WAIT });
}
// Words that show the answer is the one handed over: the first few longer words of a text, markdown signs removed.
const words = (s) => (String(s).replace(/[*_#`>\[\]()]/g, " ").match(/[A-Za-z][A-Za-z']{4,}/g) || []).slice(0, 4);

for (const mode of ["simple", "expert"]) {
  test(`browser ${mode}: Give to an agent hands over the answer it sits under (first answer and a reply, the Make changes button and the icon)`, { skip, timeout: RUN * 3 }, async () => {
    const t = await boot(mode);
    const { page } = t;
    try {
      await send(page, "Write a short thank-you note for a customer who bought a cake");
      const first = await page.evaluate(() => String(window.CC.S.live?.deliverable || "").trim());
      assert.ok(first.length > 20, `the first answer has text (${first.length})`);

      // the first answer: Make changes > Give to an agent (data-turn=""), the button the panel found empty
      await openFold(page, ".sc-acts:not([data-turn])");
      const foldSel = "#view #sc-changes [data-sc-give][data-turn='']";
      assert.ok(await page.$(foldSel), "the first answer's Make changes has Give to an agent");
      const a = await giveText(page, foldSel);
      assert.ok(a.answer.length > 20, `the dialog carries the first answer, not an empty one:\n${a.text}`);
      assert.equal(a.answer, first, "the first answer's own text");
      assert.match(a.text, /^The request:\nWrite a short thank-you note/);

      // the first answer's icon button
      const b = await giveText(page, "#view .sc-acts:not([data-turn]) [data-sc-act='give']");
      assert.equal(b.answer, first, "the icon hands over the same answer");

      // a follow-up reply: its Make changes button and its icon carry the reply, not the first answer
      await send(page, "Make it warmer and shorter");
      const turn = await page.evaluate(() => { const r = [...document.querySelectorAll("#sc-turns .sc-reply[data-turn]")].pop(); return r ? { i: r.dataset.turn, body: r.querySelector(".sc-card")?.innerText.replace(/^Meldmind.*\n/, "") || "" } : null; });
      assert.ok(turn, "the reply is on screen");
      await openFold(page, `.sc-reply[data-turn='${turn.i}'] .sc-acts`);
      const c = await giveText(page, `#view .sc-reply[data-turn='${turn.i}'] [data-sc-give]`);
      assert.ok(c.answer.length > 10, `the dialog carries the reply:\n${c.text}`);
      for (const w of words(turn.body)) assert.ok(c.answer.includes(w), `the reply's word "${w}" is in the hand-off:\n${c.answer}`);
      assert.match(c.text, /^The request:\nMake it warmer and shorter/, "the reply's own request");
      const d = await giveText(page, `#view .sc-reply[data-turn='${turn.i}'] .sc-acts [data-sc-act='give']`);
      assert.equal(d.answer, c.answer, "the reply's icon hands over the same reply");

      // and the first answer's fold still hands over the first answer once a reply exists
      await openFold(page, ".sc-acts:not([data-turn])");
      const e = await giveText(page, foldSel);
      assert.equal(e.answer, first);

      const tasks = (await t.api("/team/tasks")).json?.items || [];
      assert.equal(tasks.length, 0, "Cancel assigns nothing");
      assert.deepEqual(t.errors.filter((x) => !/ResizeObserver/.test(x)), []);
    } finally { await t.close(); }
  });
}
