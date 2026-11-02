// 0.4.38 (Chris, 2026-11-02: "In the Command, the marching orders should be more prominent? It doesn't really read as
// a chat like Claude, GPT and Grok."): Expert Command is one conversation column. Each order is a bubble on the right
// with a tag line of how it ran, each answer a card under it (a Mission's steps, the AI on each and the cost so far
// show inside the card while it works), and the marching orders box is the chat box pinned at the bottom with the run
// modes as pills on top. The Deliverable and Live ops boxes are gone from the page; the run bar folded into the box.
// Approved mockup: meldmind-dogfood/mockups/expert-chat-0438.html.
// Real server in demo mode (practice AIs, no keys, nothing sent) with CC_DEV_OWNER=1 so Mission runs, and headless
// Chrome via bootMac; skips only when no Chrome is installed. Windows rules: one server and one browser at a time, real
// waits, every test closes what it opens. Screenshots go to CC_SHOTS when set (the 0.4.38 build kept them in
// meldmind-dogfood/expert-chat-0438-*.png).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { ANSWER_BUTTONS } from "../web/simple-ui.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(180000);
const ROOT = path.join(import.meta.dirname, "..");
const SHOTS = process.env.CC_SHOTS || "";
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer{display:none!important}";
// 0.5.0 (chat like the Claude app): icon buttons (named for screen readers) then Make changes
const LABELS = ["Copy", "Try again", "Save as file", "Give to an agent", "Make changes"];
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
}
// Mac look, Expert, practice AIs on, owner license (Mission is part of Pro), on the Command page.
async function boot({ width, height, theme = "light" }) {
  const t = await bootMac({ width, height, mode: "expert", theme, env: { CC_DEV_OWNER: "1" } });
  if (!t) return null;
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: POPUPS });
    await t.page.evaluate(() => window.CC.go("command"));
    await t.page.waitForFunction(() => document.body.dataset.ui === "expert" && !!document.querySelector("#view .ex-chat .ex-box #orders"), null, { timeout: WAIT });
    return t;
  } catch (e) { await t.close(); throw e; }
}
// Type and press Send like a person (a real click). A second one in the same mode goes on in the same chat.
async function send(page, text) {
  const before = await page.evaluate(() => ({ id: window.CC.S.live?.id || "", n: document.querySelectorAll("#sc-turns .sc-reply").length }));
  await page.fill("#orders", text);
  await page.click("#go");
  await page.waitForFunction((b) => (window.CC.S.live?.id && window.CC.S.live.id !== b.id) || document.querySelectorAll("#sc-turns .sc-reply").length > b.n, before, { timeout: RUN });
  await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status) && !window.CC.S.live?.replying, null, { timeout: RUN });
  await page.waitForFunction(() => [...document.querySelectorAll("#view .ex-chat .sc-acts")].every((a) => a.getBoundingClientRect().height > 0), null, { timeout: WAIT });
}
// 0.5.0: the run modes live in the box's mode menu ("Auto team"); open it, then pick
async function openMenu(page) { if (await page.evaluate(() => document.getElementById("cb-menu")?.hidden !== false)) await page.click("#sc-team"); }
async function pickMode(page, m) {
  await openMenu(page);
  await page.click(`#run-mode button[data-m="${m}"]`);
  await page.waitForFunction((m) => window.CC.S.cmdMode === m, m, { timeout: WAIT });
}
// The chat box: on screen, at the bottom, nothing over it, above the Talk bar and the dock; Send whole and on top.
async function boxClear(page) {
  return page.evaluate(() => {
    const box = document.querySelector("#view .ex-chat .ex-box");
    const r = box.getBoundingClientRect();
    const go = document.getElementById("go").getBoundingClientRect();
    const pts = [[r.left + 12, r.top + 12], [r.right - 12, r.top + 12], [r.left + r.width / 2, r.top + r.height / 2], [r.left + 12, r.bottom - 10], [r.right - 12, r.bottom - 10], [go.left + go.width / 2, go.top + go.height / 2]];
    const covered = pts.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return !hit || !box.contains(hit); }).map(([x, y]) => { const hit = document.elementFromPoint(x, y); return `${Math.round(x)},${Math.round(y)}: ${hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none"}`; });
    const shown = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).display !== "none" ? b : null; };
    const talk = shown(document.getElementById("vt-bar"));
    const dock = shown(document.getElementById("mac-dock"));
    return {
      inside: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      goInside: go.top >= 0 && go.bottom <= innerHeight && go.left >= 0 && go.right <= innerWidth,
      lowHalf: r.top > innerHeight * 0.4,
      // 0.5.0: a new chat has the box mid page (its centre in the middle third)
      mid: (r.top + r.height / 2) > innerHeight / 3 && (r.top + r.height / 2) < innerHeight * 2 / 3,
      covered,
      aboveTalk: !talk || r.bottom <= talk.top + 1,
      aboveDock: !dock || dock.top >= innerHeight - 1 || r.bottom <= dock.top + 1,
      wide: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  });
}
const clear = (b, empty = false) => b.inside && b.goInside && (empty ? b.mid : b.lowHalf) && !b.covered.length && b.aboveTalk && b.aboveDock && b.wide;
// The old form is gone: no Deliverable or Live ops boxes, no page header, no run bar row over the box.
async function oldGone(page) {
  return page.evaluate(() => ({
    deliv: !!document.getElementById("deliv-panel"),
    wait: !!document.getElementById("deliv-wait"),
    side: !!document.querySelector("#view .cmd-side, #view .cmd, #view .orders-panel"),
    opsOutside: !!document.getElementById("ops-panel") && !document.getElementById("ops-panel").closest("#ex-answer .sc-card"),
    head: !!document.querySelector("#view > .cx-head"),
    runbar: !!document.getElementById("mac-rb-modes") || !!document.getElementById("mac-runbar"),
    notes: [...document.querySelectorAll(".view-col > .cx-notes, .view-col > #fpbar, .view-col > #mmbar")].filter((e) => e.getBoundingClientRect().height > 0).length,
  }));
}
const GONE = { deliv: false, wait: false, side: false, opsOutside: false, head: false, runbar: false, notes: 0 };
// The thread in one column, in order.
async function threadOrder(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll("#sc-thread .sc-me:not([hidden]), #sc-thread .sc-ai:not([hidden])")];
    const col = document.querySelector("#view .ex-chat .sc-col").getBoundingClientRect();
    return {
      kinds: items.map((e) => (e.classList.contains("sc-me") ? "me" : "ai")),
      texts: items.map((e) => e.innerText.slice(0, 80)),
      tops: items.map((e) => e.getBoundingClientRect().top + document.getElementById("sc-scroll").scrollTop),
      inCol: items.every((e) => { const r = e.getBoundingClientRect(); return r.left >= col.left - 1 && r.right <= col.right + 1; }),
      colW: col.width,
      acts: [...document.querySelectorAll("#sc-thread .sc-acts")].map((a) => [...a.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.textContent.replace(/\s*\u25be$/, "").trim())),
      cards: [...document.querySelectorAll("#sc-thread .sc-ai:not([hidden]) .sc-card")].length,
      runId: window.CC.S.live?.id,
    };
  });
}

test("source: the chat page is wired in, the run bar folds into the box, and no dashes in what it says", () => {
  assert.deepEqual(ANSWER_BUTTONS.map((b) => b.label), LABELS);
  assert.match(read("web", "index.html"), /<link rel="stylesheet" href="\/expert-chat.css" \/>/);
  const app = read("web", "app.js");
  assert.match(app, /<div class="ex-chat chat2" id="ex-chat"/);
  assert.match(app, /class="cb-modes ex-pills" id="run-mode" role="group" aria-label="How to run it"/);
  assert.match(app, /<textarea id="orders"[^>]*aria-label="\$\{expert \? "Marching orders"/);
  assert.doesNotMatch(app, /id="deliv-panel"|class="cmd-side"|orders-panel/, "the old boxes are not drawn");
  assert.match(read("web", "mac", "parts", "runbar.js"), /orders\?\.closest\("\.ex-box"\)\) return null/);
  assert.doesNotMatch(read("web", "mac", "parts", "inside.js"), /command: \{ title: "Command"/);
  const em = new RegExp(String.fromCharCode(0x2014));
  for (const f of ["web/expert-chat.css", "web/app.js", "web/features/voice.js", "web/features/orders-input.js", "web/features/dock.js", "web/mac/parts/runbar.js", "web/mac/parts/inside.js"]) assert.doesNotMatch(read(f), em, `${f} has no em-dash`);
  for (const f of ["web/expert-chat.css", "web/app.js"]) assert.doesNotMatch(read(f), /\x08/, `${f} has no backspace byte`);
});

test("browser 1366 x 800: pinned box, pills in step, Single and a follow-up as a thread, a Mission's steps in its card, the answer buttons, Live feed Hide, Simple unchanged", { skip, timeout: RUN * 4 }, async () => {
  const t = await boot({ width: 1366, height: 800 });
  if (!t) return;
  try {
    const { page } = t;
    // ---- the empty page: the heading, the box at the bottom, nothing of the old form ----
    assert.deepEqual(await oldGone(page), GONE);
    // 0.5.0 (chat like the Claude app): a greeting; the run modes, Priority and When are in the box's mode menu,
    // Preview route and the SSN line under its "..." (More options)
    const empty = await page.evaluate(() => ({
      hello: document.querySelector("#view .ex-chat .cb-hello")?.textContent,
      pills: [...document.querySelectorAll("#view .ex-box #cb-menu #run-mode button")].map((b) => b.textContent.replace(/\s+/g, " ").trim()),
      menu: ["cost-mode", "when-mode"].every((id) => !!document.querySelector(`#cb-menu #${id}`)),
      row: [...document.querySelectorAll("#cb-row > :not(.cb-pop-wrap), #cb-row > .cb-pop-wrap > button")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.id || e.className),
      mask: !!document.querySelector("#view .ex-chat #cb-more-pop #mask-line")?.textContent.trim(),
      preview: !!document.querySelector("#cb-more-pop #preview"),
      more: !!document.getElementById("cb-more"),
    }));
    assert.equal(empty.hello, "What can I help with?");
    assert.deepEqual(empty.pills, ["Auto team", "Single", "Council", "Mission", "Research", "Second opinion"]);
    assert.ok(empty.menu, "Priority and When are in the mode menu");
    for (const id of ["cb-add", "sc-team", "cc-freeonly-wrap", "cb-more", "vo-mic", "go"]) assert.ok(empty.row.includes(id), `${id} is in the bottom row: ${empty.row}`);
    assert.ok(empty.mask && empty.preview && empty.more, "the SSN line and Preview route are under More options");
    const b0 = await boxClear(page);
    assert.ok(clear(b0, true), JSON.stringify(b0));
    await page.mouse.move(640, 300);
    await page.waitForFunction(() => !document.getElementById("view").hasAttribute("data-cx-enter"), null, { timeout: WAIT });
    await page.waitForTimeout(900);
    await shot(page, "expert-chat-0438-1366-empty.png");

    // ---- the pills switch the mode, the sidebar Chat row stays lit, the heading follows, no run bar ----
    await pickMode(page, "council");
    const pc = await page.evaluate(() => ({
      on: [...document.querySelectorAll("#run-mode button.on")].map((b) => b.dataset.m),
      pressed: document.querySelector('#run-mode button[data-m="council"]').getAttribute("aria-pressed"),
      hello: document.getElementById("cmd-mode-banner").textContent,
      side: document.querySelector("#mac-side .si.on, #mac-side .mx-pl.on")?.textContent.trim(),
      runbar: !!document.getElementById("mac-rb-modes"),
    }));
    assert.deepEqual(pc.on, ["council"]);
    assert.equal(pc.pressed, "true");
    assert.match(pc.hello, /Council/);
    assert.match(pc.side || "", /Chat$/);
    assert.equal(pc.runbar, false, "the run bar folded into the pills");
    // the sidebar search's "Councils" path still clicks the real pill (0.4.36 panel item 5)
    await pickMode(page, "auto");
    await page.evaluate(() => { const b = document.querySelector('#run-mode button[data-m="mission"]'); b.click(); });
    await openMenu(page);
    await page.waitForFunction(() => window.CC.S.cmdMode === "mission" && document.querySelector('#run-mode button[data-m="mission"]').classList.contains("on"), null, { timeout: WAIT });
    // Priority and When are the bottom row's selects
    await page.selectOption("#cost-mode", "quality");
    await page.selectOption("#when-mode", "now");
    assert.equal(await page.evaluate(() => window.CC.S.costMode), "quality");
    await page.selectOption("#cost-mode", "balanced");
    await page.keyboard.press("Escape");

    // ---- Single, then a follow-up in the same chat: two bubbles, two cards, in order ----
    await pickMode(page, "single");
    await send(page, "Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4.");
    const first = await page.evaluate(() => window.CC.S.live.id);
    assert.equal(await page.inputValue("#orders"), "", "the box empties once the order is on its way");
    await send(page, "Make it shorter and take out the families line.");
    const th = await threadOrder(page);
    assert.equal(th.runId, first, "the follow-up stayed in the same chat");
    assert.deepEqual(th.kinds, ["me", "ai", "me", "ai"]);
    assert.equal(th.cards, 2);
    assert.match(th.texts[0], /^Single · Balanced/, "the order's tag line says how it ran");
    assert.match(th.texts[0], /open house flyer/);
    assert.match(th.texts[2], /follow-up[\s\S]*shorter/);
    for (let i = 1; i < th.tops.length; i++) assert.ok(th.tops[i] > th.tops[i - 1], `in order ${JSON.stringify(th.tops)}`);
    assert.ok(th.inCol, "every message is inside the one column");
    assert.ok(th.colW <= 840 && th.colW >= 640, `column is ${th.colW} px`);
    assert.deepEqual(th.acts, [LABELS, LABELS], "each answer has Copy, Try again, Make changes, Save as file");
    assert.deepEqual(await oldGone(page), GONE);
    const b1 = await boxClear(page);
    assert.ok(clear(b1), JSON.stringify(b1));

    // ---- Make changes: the Expert extras (Double-check, next actions, Finish, versions) behind it; the answer check slot in the card ----
    await page.click("#ex-answer > .sc-acts [data-sc-act='change']");
    await page.waitForFunction(() => !document.getElementById("sc-changes").hidden, null, { timeout: WAIT });
    await page.waitForFunction(() => !!document.querySelector("#sc-changes #cc-check"), null, { timeout: WAIT });
    const ch = await page.evaluate(() => {
      const f = document.getElementById("sc-changes");
      return { check: !!f.querySelector("#cc-check"), finish: !!f.querySelector("[data-feature='finishpath']"), next: !!f.querySelector("[data-feature='next-actions']"), more: !!f.querySelector("details.answer-more"), slot: !!document.querySelector("#ex-answer .sc-card #sc-check") };
    });
    assert.ok(ch.check && ch.finish && ch.next && ch.more && ch.slot, JSON.stringify(ch));
    await page.waitForTimeout(600);
    await shot(page, "expert-chat-0438-1366-make-changes.png");
    await page.click("#ex-answer > .sc-acts [data-sc-act='change']");

    // ---- a Mission: the steps with a status dot, the AI on each and the cost so far inside its card, then the answer ----
    await pickMode(page, "mission");
    await page.fill("#orders", "Plan the Instagram week for our new product launch: 5 post ideas, captions, and the best times to post.");
    await page.click("#go");
    await page.waitForSelector("#cc-readers-go", { timeout: RUN });
    await page.click("#cc-readers-go");
    await page.waitForFunction(() => window.CC.S.live?.kind === "mission" && document.querySelectorAll("#ex-answer .sc-card #ops-panel #tasks .task").length > 1 && ["planning", "running", "assembling"].includes(window.CC.S.live.status), null, { timeout: RUN });
    // 0.5.0: the steps wait behind the working line; it opens them
    assert.equal(await page.evaluate(() => document.getElementById("ex-answer").dataset.steps), "fold");
    await page.click("#ex-steps-btn");
    await page.waitForFunction(() => document.getElementById("ex-answer").dataset.steps === "open", null, { timeout: WAIT });
    const mid = await page.evaluate(() => {
      const card = document.querySelector("#ex-answer .sc-card");
      const rows = [...card.querySelectorAll("#tasks .task")];
      return {
        steps: document.getElementById("ex-answer").dataset.steps,
        line: document.getElementById("cb-work-text").textContent,
        shown: rows.every((r) => r.getBoundingClientRect().height > 0),
        dots: rows.every((r) => !!r.querySelector(".st") && r.querySelector(".st").getBoundingClientRect().width > 0),
        who: rows.every((r) => /\S/.test(r.querySelector(".who")?.textContent || "")),
        live: !document.getElementById("ex-live").hidden,
        tag: document.getElementById("sc-q").innerText,
        acts: getComputedStyle(document.querySelector("#ex-answer > .sc-acts")).display,
        slim: !!document.getElementById("cc-ops-slim"),
      };
    });
    // 0.5.0: one compact working line ("Mission · 3 AIs · step 2 of 3 · $0.002 so far") that opens to the steps
    assert.match(mid.line, /^Mission · .*\$[\d.]+ so far$/);
    assert.equal(mid.steps, "open", "the steps opened from the working line");
    assert.ok(mid.shown && mid.dots && mid.who, JSON.stringify(mid));
    assert.ok(mid.live, "Open live view is in the card");
    assert.match(mid.tag, /^Mission · Balanced/);
    assert.equal(mid.acts, "none", "the answer buttons wait until it is done");
    assert.equal(mid.slim, false, "no slim Live ops line over the steps");
    await shot(page, "expert-chat-0438-1366-mid-mission.png");
    await page.waitForFunction(() => ["done", "done-with-errors"].includes(window.CC.S.live?.status), null, { timeout: RUN });
    await page.waitForFunction(() => document.querySelector("#ex-answer > .sc-acts")?.getBoundingClientRect().height > 0 && /\S/.test(document.getElementById("out-md").innerText), null, { timeout: WAIT });
    const done = await page.evaluate(() => ({
      steps: document.getElementById("ex-answer").dataset.steps,
      btn: document.getElementById("ex-steps-btn").getAttribute("aria-expanded"),
      acts: [...document.querySelectorAll("#ex-answer > .sc-acts button")].map((b) => b.getAttribute("aria-label") || b.textContent.replace(/\s*▾$/, "").trim()),
      text: document.getElementById("out-md").innerText.length,
    }));
    // 0.5.0: the steps the person opened stay open; the working line folds them again
    assert.equal(done.steps, "open");
    assert.equal(done.btn, "true");
    await page.click("#ex-steps-btn");
    await page.waitForFunction(() => document.getElementById("ex-answer").dataset.steps === "fold", null, { timeout: WAIT });
    assert.deepEqual(done.acts, LABELS);
    assert.ok(done.text > 40);
    assert.deepEqual(await oldGone(page), GONE);
    const b2 = await boxClear(page);
    assert.ok(clear(b2), JSON.stringify(b2));
    await page.waitForFunction(() => !document.getElementById("go").disabled, null, { timeout: WAIT });
    await page.waitForTimeout(600);
    await shot(page, "expert-chat-0438-1366-finished.png");
    // the steps open again from the card
    await page.click("#ex-steps-btn");
    await page.waitForFunction(() => document.getElementById("ex-answer").dataset.steps === "open" && document.querySelector("#ex-answer #tasks .task")?.getBoundingClientRect().height > 0, null, { timeout: WAIT });

    // ---- the Live feed column keeps its Hide ----
    await page.evaluate(() => { try { localStorage.removeItem("cc.feed.min"); } catch {} document.getElementById("feed-min").click(); });
    await page.waitForFunction(() => document.body.classList.contains("feed-min") && document.getElementById("feed").getBoundingClientRect().width <= 60, null, { timeout: WAIT });
    await page.evaluate(() => document.getElementById("feed-tab").click());
    await page.waitForFunction(() => !document.body.classList.contains("feed-min") && document.getElementById("feed").getBoundingClientRect().width > 200, null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);

    // ---- Simple Chat is unchanged ----
    await page.click("#mac-simple");
    await page.waitForFunction(() => document.body.dataset.ui === "simple", null, { timeout: WAIT });
    await page.evaluate(() => { window.CC.go("command"); window.CC.mac.bus.emit("chat"); });
    await page.waitForFunction(() => !!document.querySelector("#view .sc-chat #orders"), null, { timeout: WAIT });
    const simple = await page.evaluate(() => ({ chat: !!document.querySelector("#view .sc-chat"), ex: !!document.querySelector("#view .ex-chat"), pills: !!document.querySelector("#view .ex-pills"), box: !!document.querySelector("#view .sc-chat .sc-box #orders"), send: document.getElementById("go")?.getAttribute("aria-label") })); // 0.5.0: Send is a round icon button
    assert.deepEqual(simple, { chat: true, ex: false, pills: false, box: true, send: "Send" });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser 390 x 844: the box and Send above the Talk bar, the pills switch the mode, a Single answer and a follow-up in one column", { skip, timeout: RUN * 2 }, async () => {
  const t = await boot({ width: 390, height: 844 });
  if (!t) return;
  try {
    const { page } = t;
    assert.deepEqual(await oldGone(page), GONE);
    const b0 = await boxClear(page);
    assert.ok(clear(b0, true), JSON.stringify(b0)); // 0.5.0: a new chat has the box mid page
    await pickMode(page, "council");
    await pickMode(page, "single");
    await send(page, "Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4.");
    await send(page, "Make it shorter and take out the families line.");
    const th = await threadOrder(page);
    assert.deepEqual(th.kinds, ["me", "ai", "me", "ai"]);
    assert.ok(th.inCol);
    assert.deepEqual(th.acts, [LABELS, LABELS]);
    const b1 = await boxClear(page);
    assert.ok(clear(b1), JSON.stringify(b1));
    await shot(page, "expert-chat-0438-390-in-use.png");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser 1366 x 800 dark: the in-use page reads right in the dark theme", { skip, timeout: RUN * 2 }, async () => {
  const t = await boot({ width: 1366, height: 800, theme: "dark" });
  if (!t) return;
  try {
    const { page } = t;
    await pickMode(page, "single");
    await send(page, "Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4.");
    const c = await page.evaluate(() => {
      const lum = (s) => { const m = s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
      return {
        card: lum(getComputedStyle(document.querySelector("#ex-answer .sc-card")).backgroundColor),
        text: lum(getComputedStyle(document.querySelector("#ex-answer #out-md")).color),
        box: lum(getComputedStyle(document.querySelector("#view .ex-box")).backgroundColor),
        typed: lum(getComputedStyle(document.getElementById("orders")).color),
      };
    });
    assert.ok(c.card < 0.2 && c.text > 0.75 && c.box < 0.2 && c.typed > 0.75, JSON.stringify(c));
    const b = await boxClear(page);
    assert.ok(clear(b), JSON.stringify(b));
    await shot(page, "expert-chat-0438-dark.png");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("browser 1024 x 768, 1440 x 900 and Large text: the box and Send stay on screen, clear of the Talk bar and the dock", { skip, timeout: RUN * 2 }, async () => {
  const t = await boot({ width: 1024, height: 768 });
  if (!t) return;
  try {
    const { page } = t;
    const feed = await page.evaluate(() => { const f = document.getElementById("feed"); const r = f?.getBoundingClientRect(); return !!r && r.width > 120 && getComputedStyle(f).display !== "none"; });
    assert.equal(feed, false, "no Live feed column at 1024");
    const b0 = await boxClear(page);
    assert.ok(clear(b0, true), `1024: ${JSON.stringify(b0)}`); // 0.5.0: a new chat has the box mid page
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => innerWidth === 1440, null, { timeout: WAIT });
    const b1 = await boxClear(page);
    assert.ok(clear(b1, true), `1440: ${JSON.stringify(b1)}`);
    await page.evaluate(() => { document.documentElement.dataset.text = "large"; });
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.waitForFunction(() => innerWidth === 1366 && getComputedStyle(document.documentElement).fontSize === "20px", null, { timeout: WAIT });
    const b2 = await boxClear(page);
    assert.ok(clear(b2, true), `Large text 1366: ${JSON.stringify(b2)}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
