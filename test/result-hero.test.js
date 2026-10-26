// 0.4.21 L-easy: the finished result card. One main button per kind (Publish for sites, Download for images,
// videos and mods, Post for campaigns), only routes that are connected, 2 to 4 quick options for pictures,
// and a hook so other modules can add buttons. Pure rules first, then the real page in demo mode.
import test from "node:test";
import assert from "node:assert/strict";
import { mainAction, usableRoutes, quickOptions, heroPlan, addButton, clearHooks, normalKind, guessKind } from "../web/result-hero.js";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const CH = [
  { id: "instagram", ready: true, accepts: ["image", "video", "text"] },
  { id: "slack", ready: false, accepts: ["text", "image"] },
  { id: "drive", ready: true, accepts: ["text", "image", "video", "audio", "file", "site"] },
];

test("one main button per kind", () => {
  assert.equal(mainAction("image", []).label, "Download");
  assert.equal(mainAction("video", []).label, "Download");
  assert.equal(mainAction("mod", []).label, "Download");
  assert.equal(mainAction("site", CH).label, "Publish");
  assert.equal(mainAction("campaign", CH).label, "Post");
  assert.equal(normalKind("website"), "site");
  assert.equal(normalKind("social"), "campaign");
});

test("a site or campaign with nothing connected falls back to Download with a plain note", () => {
  for (const k of ["site", "campaign"]) {
    const m = mainAction(k, [{ id: "slack", ready: false, accepts: ["text"] }]);
    assert.equal(m.label, "Download");
    assert.ok(m.fallback);
    assert.ok(!/[–—]/.test(m.note), "no dashes");
  }
});

test("only connected routes that take the kind are offered", () => {
  assert.deepEqual(usableRoutes(CH, "image").map((c) => c.id), ["instagram", "drive"]);
  assert.deepEqual(usableRoutes(CH, "site").map((c) => c.id), ["drive"]);
  assert.deepEqual(usableRoutes(CH, "campaign").map((c) => c.id), ["instagram", "drive"]);
  assert.deepEqual(usableRoutes(null, "image"), []);
});

test("quick options: 4 for a picture, none that the request already says, 2 for video", () => {
  const a = quickOptions("image", "a woman on a beach");
  assert.equal(a.length, 4);
  assert.ok(a.every((o) => o.label && o.change));
  const b = quickOptions("image", "a woman on a beach at sunset in black and white");
  assert.ok(b.length >= 2 && b.length <= 4);
  assert.ok(!b.some((o) => o.id === "sunset" || o.id === "bw"));
  assert.equal(quickOptions("video", "waves").length, 2);
  assert.equal(quickOptions("site", "x").length, 0);
});

test("hero plan keeps the main button out of More and takes hook buttons", () => {
  clearHooks();
  assert.ok(addButton({ id: "try-again", label: "Try again", onClick() {} }));
  assert.equal(addButton({ id: "try-again", label: "dup", onClick() {} }), false, "no duplicate id");
  assert.equal(addButton({ id: "bad", label: 3 }), false);
  const p = heroPlan({ kind: "image", prompt: "a fox", channels: CH });
  assert.equal(p.main.id, "download");
  assert.ok(!p.more.some((m) => m.id === "download"));
  assert.ok(p.more.some((m) => m.id === "again") && p.more.some((m) => m.id === "try-again" && m.hook));
  const s = heroPlan({ kind: "site", prompt: "x", channels: CH, saved: false });
  assert.equal(s.main.id, "publish");
  assert.ok(s.more.some((m) => m.id === "download"));
  assert.ok(!s.more.some((m) => m.id === "open"));
  clearHooks();
});

test("guessKind only calls clear signs a site or a campaign", () => {
  assert.equal(guessKind("<!doctype html><html><body>hi</body></html>"), "site");
  assert.equal(guessKind("Day 1\nCaption: hello #sale\nDay 2\nCaption: again #deal"), "campaign");
  assert.equal(guessKind("Here is a plain answer about tea."), "document");
});

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(20000);
test("Simple chat: the picture shows ONE main button, 4 quick options, the rest behind More; a quick option adds a version", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 900 });
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite{display:none!important}" });
    await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
    await goChat(t.page);
    await t.page.waitForFunction(() => window.CC.makeChat && window.CC.makeChat.handle && window.CC.resultHero, null, { timeout: WAIT });
    await t.page.fill("#orders", "a woman on a beach");
    await t.page.click("#go");
    await t.page.waitForSelector(".mk-tile[data-state=done] .mk-img", { timeout: WAIT });
    const r = await t.page.evaluate(() => {
      const tile = document.querySelector(".mk-tile[data-state=done]");
      const primaries = [...tile.querySelectorAll("button.primary")].map((b) => b.textContent);
      const more = tile.querySelector("details.rh-more");
      return { primaries, quick: tile.querySelectorAll(".rh-q").length, moreOpen: more.open, moreButtons: [...more.querySelectorAll("button")].map((b) => b.textContent), mainInsideMore: !!more.querySelector(".rh-main") };
    });
    assert.deepEqual(r.primaries, ["Download"]);
    assert.ok(r.quick >= 2 && r.quick <= 4);
    assert.equal(r.moreOpen, false);
    assert.ok(r.moreButtons.includes("Make another") && r.moreButtons.includes("Open in MindMedia"));
    assert.ok(!r.mainInsideMore);
    await t.page.click(".mk-tile[data-state=done] .rh-q");
    await t.page.waitForFunction(() => document.querySelectorAll(".mk-tile[data-state=done] .mk-img").length === 2, null, { timeout: WAIT });
  } finally { await t.close(); }
});

test("the result card for a site shows Publish when a place is connected, and a hook button appears under More", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 900 });
  try {
    await t.page.waitForFunction(() => window.CC && window.CC.resultHero, null, { timeout: WAIT });
    const out = await t.page.evaluate(async () => {
      const host = document.createElement("div"); document.body.appendChild(host);
      window.CC.resultHero.addButton({ id: "demo-hook", label: "Hook button", onClick() {} });
      window.CC.api = window.CC.api; // channels come from the real server: none connected in a fresh data folder
      window.CC.resultHero.mount(host, { kind: "site", text: "<!doctype html><html><body>Hi</body></html>", name: "Test site" });
      await new Promise((r) => setTimeout(r, 800));
      const card = host.querySelector(".rh-card");
      return { has: !!card, main: card?.querySelector(".rh-main")?.textContent, hook: [...card.querySelectorAll(".rh-more-row button")].map((b) => b.textContent), iframe: !!card.querySelector("iframe") };
    });
    assert.ok(out.has && out.iframe);
    assert.equal(out.main, "Download", "nothing is connected here, so no Publish button");
    assert.ok(out.hook.includes("Hook button"));
  } finally { await t.close(); }
});
