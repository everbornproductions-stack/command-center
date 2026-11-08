// 0.5.2 (Chris, 2026-11-03: "projects are all messed up. when clicking continue a project it just goes to a chat box and
// has no idea what i am talking about"). Continue this project opens the project's last chat with its conversation, and
// the next message stays in that chat (even one the new-subject guess would split off). Also the 0.5.0 panel item 1 CSS:
// the answer's icon row is styled when the Done page of Make something borrows it (#mf-result).
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
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer{display:none!important}";

async function boot(mode) {
  const t = await bootMac({ width: 1366, height: 800, mode, theme: "light", env: { CC_DEV_OWNER: "1" } });
  if (!t) return null;
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: POPUPS });
    if ((await t.page.evaluate(() => document.body.dataset.ui)) !== mode) {
      await t.page.click(mode === "expert" ? "#mac-expert" : "#mac-simple");
      await t.page.waitForFunction((m) => document.body.dataset.ui === m, mode, { timeout: WAIT });
    }
    return t;
  } catch (e) { await t.close(); throw e; }
}
async function openChat(page) {
  await page.evaluate(() => { window.CC.go("command"); window.CC.mac.bus.emit("chat"); });
  await page.waitForFunction(() => !!document.querySelector("#view .chat2 #cb #orders") && document.body.dataset.macFlow !== "on", null, { timeout: WAIT });
}
async function send(page, text) {
  const before = await page.evaluate(() => ({ id: window.CC.S.live?.id || "", n: document.querySelectorAll("#sc-turns .sc-reply").length }));
  await page.fill("#orders", text);
  await page.click("#go");
  await page.waitForFunction((b) => (window.CC.S.live?.id && window.CC.S.live.id !== b.id) || document.querySelectorAll("#sc-turns .sc-reply").length > b.n, before, { timeout: RUN });
  await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !window.CC.S.live?.replying, null, { timeout: RUN });
}

test("unit 0.5.2: Continue opens the last chat, not an empty box with the last words", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const fn = app.slice(app.indexOf("async function continueProject"), app.indexOf("function lastChatFor"));
  assert.match(fn, /openRun\(chat\.id\)/);
  assert.match(fn, /openWalk\(walk\.id\)/);
  assert.match(fn, /S\.scKeep = chat\.id/);
  assert.doesNotMatch(fn, /S\.lastOrders = String\(words\)/);
  const css = fs.readFileSync(path.join(ROOT, "web", "chat.css"), "utf8");
  assert.match(css, /:is\(#app #view \.chat2, #mf-result\) \.sc-acts \.cb-ic \{/);
  assert.match(css, /:is\(#app #view \.chat2, #mf-result\) #ops-panel \{ display: none;/);
});

for (const mode of ["simple", "expert"]) {
  test(`browser ${mode} 1366 x 800: Continue this project reopens its chat and the next message stays in it`, { skip, timeout: RUN * 3 }, async () => {
    const t = await boot(mode);
    if (!t) return;
    const { page } = t;
    try {
      const made = await t.api("/projects", { body: { name: "Cake shop" } });
      const pid = made.json?.project?.id || made.json?.id;
      assert.ok(pid, `project made: ${JSON.stringify(made.json).slice(0, 200)}`);
      await page.evaluate(async (id) => { await window.CC.refresh(); window.CC.setWorkingProject(id); }, pid);
      await openChat(page);
      await send(page, "Write a thank-you note for a customer who bought a birthday cake");
      const first = await page.evaluate(() => window.CC.S.live.id);
      // leave it: a new chat, then another page
      await page.evaluate(() => { if (window.CC.layout?.newChat) window.CC.layout.newChat(); });
      await page.waitForFunction((id) => window.CC.S.live?.id !== id, first, { timeout: WAIT });
      await page.evaluate(() => window.CC.go("projects"));
      // Continue
      await page.evaluate(async (id) => { await window.CC.refresh(); await window.CC.continueProject(id); }, pid);
      await page.waitForFunction((id) => window.CC.S.live?.id === id && window.CC.S.view === "command" && !!document.querySelector("#view .chat2 #orders"), first, { timeout: WAIT });
      const seen = await page.evaluate(() => ({ box: document.getElementById("orders")?.value || "", text: document.querySelector("#view .chat2")?.textContent || "", toasts: [...document.querySelectorAll("#toasts .toast")].map((n) => n.textContent.trim()) }));
      assert.equal(seen.box, "", "the box is empty, not refilled with the last request");
      assert.match(seen.text, /thank-you note|birthday cake/i, "the earlier conversation shows");
      assert.ok(seen.toasts.some((x) => /Back in Cake shop/.test(x)), `toasts: ${seen.toasts.join(" | ")}`);
      // a message that would read as a new subject still goes on in the reopened chat
      const n = await page.evaluate(() => document.querySelectorAll("#sc-turns .sc-reply").length);
      await send(page, "Plan a game night for my family this Friday");
      const after = await page.evaluate(() => ({ id: window.CC.S.live.id, n: document.querySelectorAll("#sc-turns .sc-reply").length }));
      assert.equal(after.id, first, "stayed in the project's chat");
      assert.ok(after.n > n, `a reply was added in the same chat (${n} -> ${after.n})`);
    } finally { await t.close(); }
  });
}
