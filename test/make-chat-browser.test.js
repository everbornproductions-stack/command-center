// 0.4.21 "type it, get the finished thing", in a real browser (demo mode, practice makers only, no real key).
//  - "a woman on a beach" in Simple chat shows a finished <img> inside the answer panel, with a hub item named
//    from the prompt, and "Change it" adds a second image under the first (linked as a version)
//  - "a 5 second video of waves" runs as a demo job and shows its result inline
//  - with no maker and no practice mode: a plain message with ONE next button, nothing made
//  - an ordinary question still goes to the chat AI
// Skips only when no Chrome is installed. Windows rules: real waits (polls with a deadline), everything closed.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(20000);

async function send(page, text) {
  await page.fill("#orders", text);
  await page.click("#go");
}

test("Simple chat: 'a woman on a beach' shows a finished image in the answer panel; Change it adds a second", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 900 });
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite{display:none!important}" });
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
    await goChat(t.page);
    await t.page.waitForFunction(() => window.CC.makeChat && window.CC.makeChat.handle, null, { timeout: WAIT });
    await send(t.page, "a woman on a beach");
    await t.page.waitForSelector("#simple-answer #mk-root .mk-tile[data-state=done] img.mk-img", { timeout: WAIT });
    const first = await t.page.evaluate(() => {
      const img = document.querySelector("#simple-answer .mk-img");
      return { w: img.naturalWidth, shown: !document.querySelector("#simple-answer").hidden, tiles: document.querySelectorAll(".mk-tile").length, hasChange: !!document.querySelector(".mk-change-input"), dl: !!document.querySelector(".mk-dl"), again: !!document.querySelector(".mk-again"), how: document.querySelector(".mk-how")?.textContent || "" };
    });
    assert.ok(first.shown && first.w > 0, JSON.stringify(first));
    assert.equal(first.tiles, 1);
    assert.ok(first.hasChange && first.dl && first.again);
    assert.match(first.how, /Prompt used/);
    // saved to the hub with a name made from the prompt
    const hub = (await t.api("/mindmedia?project=all")).json;
    const items = hub.items || hub.flatItems || [];
    assert.ok(items.some((i) => i.name === "A woman on a beach"), "hub item named from the prompt: " + items.map((i) => i.name).join("|"));
    // Change it: a second image under the first
    await t.page.fill(".mk-tile[data-state=done] .mk-change-input", "make it sunset");
    await t.page.click(".mk-tile[data-state=done] .mk-change-go");
    await t.page.waitForFunction(() => document.querySelectorAll(".mk-tile[data-state=done] img.mk-img").length === 2, null, { timeout: WAIT });
    const second = await t.page.evaluate(() => ({ tiles: document.querySelectorAll(".mk-tile").length, srcs: [...document.querySelectorAll(".mk-img")].map((i) => i.src), prompts: [...document.querySelectorAll(".mk-how p")].map((p) => p.textContent).join(" ") }));
    assert.equal(second.tiles, 2);
    assert.notEqual(second.srcs[0], second.srcs[1]);
    assert.match(second.prompts, /sunset/i);
    // a typed follow-up works too, and the new result lands under the old ones
    await send(t.page, "another one");
    await t.page.waitForFunction(() => document.querySelectorAll(".mk-tile[data-state=done] img.mk-img").length === 3, null, { timeout: WAIT });
    const all = (await t.api("/mindmedia?project=all")).json;
    const list = all.items || all.flatItems || [];
    const roots = list.filter((i) => i.parentId);
    assert.ok(roots.length >= 2, "versions are linked in the hub");
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("Simple chat: a 5 second video request runs a demo job and shows its result inline", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 900, env: { CC_MEDIA_POLL_MS: "50" } });
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite{display:none!important}" });
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
    await goChat(t.page);
    await t.page.waitForFunction(() => window.CC.makeChat && window.CC.makeChat.handle, null, { timeout: WAIT });
    await send(t.page, "a 5 second video of waves");
    await t.page.waitForSelector("#simple-answer .mk-tile[data-kind=video]", { timeout: WAIT });
    await t.page.waitForSelector("#simple-answer .mk-tile[data-kind=video][data-state=done] .mk-media img, #simple-answer .mk-tile[data-kind=video][data-state=done] .mk-media video", { timeout: WAIT });
    const r = await t.page.evaluate(() => ({ note: document.querySelector(".mk-tile[data-kind=video] .mk-note")?.textContent || "", dl: !!document.querySelector(".mk-dl") }));
    assert.match(r.note, /Practice video/);
    assert.ok(r.dl);
  } finally { await t.close(); }
});

test("Simple chat: no maker and no practice mode gives a plain message with one next button", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 900 });
  try {
    await goChat(t.page);
    await t.page.waitForFunction(() => window.CC.makeChat && window.CC.makeChat.handle, null, { timeout: WAIT });
    await send(t.page, "a woman on a beach");
    await t.page.waitForSelector("#simple-answer .mk-tile[data-state=error] .mk-fail", { timeout: WAIT });
    const r = await t.page.evaluate(() => ({ msg: document.querySelector(".mk-fail").textContent, buttons: [...document.querySelectorAll(".mk-tile[data-state=error] .mk-row button")].map((b) => b.textContent), imgs: document.querySelectorAll(".mk-img").length }));
    assert.match(r.msg, /picture maker|Add your fal\.ai key/i);
    assert.equal(r.buttons.length, 1, "one next button");
    assert.equal(r.imgs, 0);
    assert.equal((await t.api("/images")).json.items.length, 0, "nothing was made");
    assert.ok(!/[–—]/.test(r.msg));
  } finally { await t.close(); }
});

test("Simple chat: an ordinary question is not taken over by the maker", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 900 });
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite{display:none!important}" });
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
    await goChat(t.page);
    await t.page.waitForFunction(() => window.CC.makeChat && window.CC.makeChat.handle, null, { timeout: WAIT });
    await send(t.page, "what is a good name for a bakery?");
    await t.page.waitForFunction(() => (window.CC.S.live?.id || ""), null, { timeout: WAIT });
    assert.equal(await t.page.locator(".mk-tile").count(), 0);
  } finally { await t.close(); }
});
