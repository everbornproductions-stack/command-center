// 0.4.21 area H: the Simple window uses the whole screen (docs/layout-0421.md, design-ref/LAYOUT-STUDY.md section 3).
// One test group per required point. Real browser (practice AIs only, no real key); skips only when no Chrome is installed.
// Windows rules: real waits with deadlines, the browser and the server are always closed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(20000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const SITE = "<!doctype html><html><head><title>Bakery</title></head><body><h1>Fresh bread daily</h1><p>Menu, hours and contact.</p></body></html>";

async function demo(t) {
  assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
  await t.page.reload({ waitUntil: "domcontentloaded" });
  await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,.cc-tour-invite{display:none!important}" });
  await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
  await goChat(t.page);
  await t.page.waitForFunction(() => window.CC.makeChat && window.CC.makeChat.handle && window.CC.layout, null, { timeout: WAIT });
  await t.page.waitForTimeout(800);
}
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const q = e.getBoundingClientRect(); const cs = getComputedStyle(e); return q.width > 0 && q.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; }, sel);
async function send(page, text) { await page.fill("#orders", text); await page.click("#go"); }
async function newestImage(page) { await page.waitForSelector("#simple-answer .mk-tile[data-state=done] img.mk-img", { timeout: WAIT }); }

test("source: files exist, no dashes in user text, registry and html know the layout", () => {
  const js = read("web", "features", "layout.js");
  const css = read("web", "layout.css");
  assert.match(read("web", "index.html"), /href="\/layout\.css"/);
  assert.match(read("web", "perf", "registry.js"), /\{ id: "layout", shell: true \}/);
  assert.equal(/[–—]/.test(js + css), false, "no em or en dashes");
  assert.match(js, /What do you want to make\?|CHIPS/);
  assert.match(read("web", "app.js"), /What do you want to make\?/);
  assert.match(css, /@media \(max-width: 760px\)/, "phones keep their own rules");
  for (const id of ["cc-side", "side-new", "side-projects", "side-mindmedia", "side-recent", "side-profile", "side-menu", "sc-live", "sc-team", "sc-chips"]) assert.ok((js + read("web", "app.js")).includes(id), id);
});

// ---------- 1. the first screen ----------
test("1. first screen: greeting, one big box, four chips, Auto team line, filled width, none of the clutter", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await goChat(t.page);
    await t.page.waitForSelector("#sc-hello", { timeout: WAIT });
    await t.page.waitForTimeout(1500);
    const r = await t.page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const box = q("#orders").getBoundingClientRect();
      const view = q("#view").getBoundingClientRect();
      const cards = [...document.querySelectorAll("#view .sc-box, #view .sc-chips, #view #sc-ideas, #view #sc-media, #view #sc-projects, #view #simple-day")].filter((e) => e.getBoundingClientRect().height > 0);
      const top = Math.min(q("#sc-hello").getBoundingClientRect().top, ...cards.map((e) => e.getBoundingClientRect().top));
      const bottom = Math.max(...cards.map((e) => e.getBoundingClientRect().bottom));
      const left = Math.min(...cards.map((e) => e.getBoundingClientRect().left));
      const right = Math.max(...cards.map((e) => e.getBoundingClientRect().right));
      return {
        hello: q("#sc-hello").textContent.trim(), boxH: box.height, boxW: box.width,
        chips: [...document.querySelectorAll("#sc-chips [data-sc-chip]")].map((b) => b.textContent.trim()),
        team: q("#sc-team")?.textContent.trim() || "",
        ideas: document.querySelectorAll(".sc-idea").length,
        spanY: (bottom - top) / view.height, spanX: (right - left) / view.width,
        text: q("#view").innerText,
        gone: ["#ops-panel", "#graph", "#cc-tour", "#cc-live-over", "#run-mode"].map((s) => [s, !!q(s) && q(s).getBoundingClientRect().height > 0]),
      };
    });
    assert.equal(r.hello, "What do you want to make?");
    assert.ok(r.boxH >= 90 && r.boxW >= 600, `one big prompt box: ${r.boxW}x${r.boxH}`);
    assert.deepEqual(r.chips, ["Image", "Video", "Website", "Campaign"]);
    assert.match(r.team, /^Auto team/);
    assert.ok(r.ideas >= 3 && r.ideas <= 4, `${r.ideas} example ideas`);
    assert.ok(r.spanY >= 0.6, `the first screen is filled top to bottom (${r.spanY.toFixed(2)})`);
    assert.ok(r.spanX >= 0.8, `and uses the width (${r.spanX.toFixed(2)})`);
    assert.doesNotMatch(r.text, /Council|Mission|Second opinion|Live Ops/i, "no mode choice or Live Ops on the first screen");
    for (const [sel, on] of r.gone) assert.equal(on, false, `${sel} is not on the first screen`);
    // the clutter is grouped, not removed: Project tools row, the hints, Prompts and the starters are behind the Auto team control
    const hidden = ["#projbar", "#send-hint", "#mask-line", ".pd-btn", "#cc-starters", "#proj"];
    for (const s of hidden) assert.equal(await vis(t.page, s), false, `${s} starts hidden`);
    await t.page.click("#sc-team");
    for (const s of ["#send-hint", "#cc-starters", "#proj"]) assert.equal(await vis(t.page, s), true, `${s} is behind Auto team`);
    await t.page.click("#sc-team");
    assert.equal(await vis(t.page, "#send-hint"), false);
    // each chip fills a starter request and puts the cursor in the box; nothing is sent
    const want = { image: /^Make an image of /, video: /^Make a 5 second video of /, website: /^Build a website for /, campaign: /^Plan a marketing campaign for / };
    for (const k of Object.keys(want)) {
      await t.page.click(`[data-sc-chip="${k}"]`);
      const v = await t.page.evaluate(() => ({ v: document.querySelector("#orders").value, focus: document.activeElement?.id, run: document.querySelector(".cmd.simple-chat").dataset.state }));
      assert.match(v.v, want[k]);
      assert.equal(v.focus, "orders");
      assert.equal(v.run, "empty", "a chip never sends");
    }
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("1b. the Auto team line carries a real estimate when an AI is connected", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await demo(t);
    await t.page.waitForFunction(() => /^Auto team, about \$\d+\.\d\d|^Auto team, about \$0\.01 or less/.test(document.querySelector("#sc-team")?.textContent.trim() || ""), null, { timeout: WAIT });
  } finally { await t.close(); }
});

// ---------- 2 + 3 + 5. the box docks at the bottom, the result is inline, wide windows open the panel ----------
test("2/3/5. 'a woman on a beach': the box drops to the bottom, the image is in the chat and in MindMedia, the panel opens at 1920", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1920, height: 1080 });
  try {
    await demo(t);
    const before = await t.page.evaluate(() => { const b = document.querySelector("#orders").getBoundingClientRect(); const v = document.querySelector("#view").getBoundingClientRect(); return { gap: v.bottom - b.bottom, state: document.querySelector(".cmd.simple-chat").dataset.state, panel: document.body.classList.contains("mm-panel-open") }; });
    assert.equal(before.state, "empty");
    assert.equal(before.panel, false, "nothing to show, so no panel yet");
    assert.ok(before.gap > 120, `the box is not docked on the empty first screen (gap ${before.gap})`);
    await send(t.page, "a woman on a beach");
    await newestImage(t.page);
    await t.page.waitForTimeout(1200);
    const r = await t.page.evaluate(() => {
      const img = document.querySelector("#simple-answer .mk-img");
      const q = img.getBoundingClientRect(); const box = document.querySelector("#orders").getBoundingClientRect(); const v = document.querySelector("#view").getBoundingClientRect();
      const cv = document.querySelector("#cc-canvas");
      const pimg = cv && cv.querySelector(".cv-view img");
      const col = document.querySelector(".view-col").getBoundingClientRect(); const side = document.querySelector("#cc-side").getBoundingClientRect();
      const card = document.querySelector(".sc-box").getBoundingClientRect();
      return {
        boxGap: v.bottom - card.bottom, w: img.naturalWidth, inCol: q.left >= col.left - 1 && q.right <= col.right + 1, above: q.top < box.top, gap: v.bottom - box.bottom,
        hello: getComputedStyle(document.querySelector("#sc-hello")).display, state: document.querySelector(".cmd.simple-chat").dataset.state,
        panel: !!cv && !cv.hidden && cv.classList.contains("docked"), pw: pimg ? pimg.naturalWidth : 0, pr: cv ? cv.getBoundingClientRect() : null,
        chatShare: col.width / (innerWidth - side.width), maxH: getComputedStyle(img).maxHeight, vh: innerHeight, sx: document.documentElement.scrollWidth, iw: innerWidth,
      };
    });
    assert.ok(r.w > 0 && r.inCol && r.above, `the finished image is in the chat column above the box: ${JSON.stringify(r)}`);
    assert.equal(r.state, "run");
    assert.equal(r.hello, "none", "the greeting leaves after the first Send");
    assert.ok(r.boxGap < 40, `the box card is docked at the bottom of the chat column (gap ${r.boxGap})`);
    assert.ok(Math.abs(parseFloat(r.maxH) - r.vh * 0.7) < 2, `result tiles may grow to 70vh (${r.maxH})`);
    assert.equal(r.panel, true, "at 1920 the Build panel is open by default when there is a result");
    assert.ok(r.pw > 0, "the panel shows the finished image too");
    assert.ok(r.chatShare >= 0.33 && r.chatShare <= 0.45, `chat is about 35 to 40 percent (${r.chatShare.toFixed(2)})`);
    assert.ok(r.pr.width >= 700, `the panel gets the rest (${r.pr.width}px)`);
    assert.ok(r.sx <= r.iw, "no sideways scroll");
    // MindMedia has it: in the data and on the screen
    const hub = (await t.api("/mindmedia?project=all")).json;
    assert.ok((hub.items || hub.flatItems || []).some((i) => i.name === "A woman on a beach"), "a MindMedia item named from the prompt");
    await t.page.click("#side-mindmedia");
    await t.page.waitForFunction(() => /A woman on a beach/.test(document.querySelector("#view")?.innerText || ""), null, { timeout: WAIT });
    // the box is docked on every screen: the chat dock sits at the bottom of the column on MindMedia
    await t.page.waitForSelector("#cc-dock", { state: "attached", timeout: WAIT });
    const d = await t.page.evaluate(() => { const dk = document.querySelector("#cc-dock"); const c = document.querySelector(".view-col").getBoundingClientRect(); if (!dk) return null; const q = dk.getBoundingClientRect(); return { shown: q.height > 0, gap: c.bottom - q.bottom }; });
    assert.ok(d && d.shown && d.gap < 6, `the dock is at the bottom on MindMedia: ${JSON.stringify(d)}`);
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("5b. at 1280 a small result stays inline, and chat plus the panel still fit with no sideways scroll", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await demo(t);
    await send(t.page, "a woman on a beach");
    await newestImage(t.page);
    await t.page.waitForTimeout(1200);
    assert.equal(await t.page.evaluate(() => document.body.classList.contains("mm-panel-open")), false, "small things stay inline below 1500px");
    await t.page.evaluate(() => window.CC.layout.openInPanel());
    await t.page.waitForFunction(() => document.body.classList.contains("mm-panel-open"), null, { timeout: WAIT });
    await t.page.waitForTimeout(600);
    const r = await t.page.evaluate(() => ({ chat: document.querySelector(".view-col").getBoundingClientRect().width, panel: document.querySelector("#cc-canvas").getBoundingClientRect().width, sx: document.documentElement.scrollWidth, iw: innerWidth, send: (() => { const b = document.querySelector("#go").getBoundingClientRect(); return b.right <= innerWidth && b.left >= 0; })() }));
    assert.ok(r.chat >= 400 && r.panel >= 450, JSON.stringify(r));
    assert.ok(r.sx <= r.iw && r.send, "fits without sideways scroll, Send still reachable");
  } finally { await t.close(); }
});

// ---------- 4. the sidebar ----------
test("4. slim left sidebar: New, Projects, MindMedia, Recent chats, profile menu; icons only when narrow or collapsed; the old nav stays in the page", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await goChat(t.page);
    await t.page.waitForSelector("#cc-side", { timeout: WAIT });
    const open = await t.page.evaluate(() => { const s = document.querySelector("#cc-side").getBoundingClientRect(); const texts = [...document.querySelectorAll("#cc-side .side-nav .side-item span")].map((b) => b.textContent.trim()); return { w: s.width, texts, recent: !!document.querySelector("#side-recent"), tabsHidden: getComputedStyle(document.querySelector("#tabs")).display === "none", tabButtons: document.querySelectorAll("#tabs button[data-view]").length, rail: (() => { const r = document.querySelector("#cc-rail"); return !r || r.getBoundingClientRect().width === 0; })() }; });
    assert.ok(open.w >= 200, `expanded at 1280 (${open.w})`);
    assert.deepEqual(open.texts.slice(0, 3), ["New", "Projects", "MindMedia"]);
    assert.ok(open.recent);
    assert.equal(open.tabsHidden, true, "the top menu is tucked away in Simple");
    assert.ok(open.tabButtons >= 5, "but its buttons are still in the page (restyled, not deleted)");
    assert.equal(open.rail, true, "AI News does not float over the page in Simple");
    // collapse to icons and back
    await t.page.click("#side-collapse");
    await t.page.waitForFunction(() => document.querySelector("#cc-side").getBoundingClientRect().width <= 80, null, { timeout: WAIT });
    assert.equal(await vis(t.page, "#cc-side .side-item span"), false, "icons only when collapsed");
    await t.page.click("#side-collapse");
    await t.page.waitForFunction(() => document.querySelector("#cc-side").getBoundingClientRect().width >= 200, null, { timeout: WAIT });
    // the places work
    await t.page.click("#side-projects");
    await t.page.waitForFunction(() => window.CC.S.view === "projects", null, { timeout: WAIT });
    await t.page.click("#side-mindmedia");
    await t.page.waitForFunction(() => window.CC.S.view === "mindmedia", null, { timeout: WAIT });
    await t.page.click("#side-new");
    await t.page.waitForFunction(() => window.CC.S.view === "command", null, { timeout: WAIT });
    // the profile menu holds the rest
    await t.page.click("#side-profile");
    await t.page.waitForSelector("#side-menu:not([hidden])", { timeout: WAIT });
    const menu = await t.page.evaluate(() => document.querySelector("#side-menu").innerText);
    for (const w of ["Settings", "Keys and connections", "Look and theme", "Expert mode", "Community", "Help"]) assert.ok(menu.includes(w), `${w} is in the profile menu`);
    assert.equal(menu.includes("AI News"), false, "AI News has its own sidebar item, not a profile menu entry");
    await t.page.click('#side-menu [data-menu-act="settings"]');
    await t.page.waitForFunction(() => window.CC.S.view === "settings", null, { timeout: WAIT });
    // Create lists the create pages, and a click goes through the hidden menu's own button
    await t.page.click("#side-create");
    await t.page.click('#side-create-list button:has-text("Images")');
    await t.page.waitForFunction(() => window.CC.S.view === "images", null, { timeout: WAIT });
    // Expert keeps its top menu and has no sidebar
    await t.page.click("#mode-expert");
    await t.page.waitForFunction(() => document.body.dataset.ui === "expert", null, { timeout: WAIT });
    assert.equal(await vis(t.page, "#cc-side"), false);
    assert.equal(await vis(t.page, "#tabs"), true);
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("4b. under 1100px the sidebar is icons only", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1000, height: 760 });
  try {
    await goChat(t.page);
    await t.page.waitForSelector("#cc-side", { timeout: WAIT });
    const r = await t.page.evaluate(() => ({ w: document.querySelector("#cc-side").getBoundingClientRect().width, label: (() => { const s = document.querySelector("#cc-side .side-item span"); return s && s.getBoundingClientRect().width > 0; })(), sx: document.documentElement.scrollWidth, iw: innerWidth }));
    assert.ok(r.w <= 80 && !r.label, JSON.stringify(r));
    assert.ok(r.sx <= r.iw);
  } finally { await t.close(); }
});

test("4c. phones: the sidebar becomes the bottom tab bar and nothing scrolls sideways", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 390, height: 844 });
  try {
    await goChat(t.page);
    await t.page.waitForSelector("#orders", { timeout: WAIT });
    await t.page.waitForTimeout(800);
    assert.equal(await vis(t.page, "#cc-side"), false);
    assert.equal(await vis(t.page, "#mobile-nav"), true);
    const over = await t.page.evaluate(() => ({ sx: document.documentElement.scrollWidth, iw: innerWidth, wide: [...document.querySelectorAll("body *")].filter((e) => { const q = e.getBoundingClientRect(); return q.width && q.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed" && !e.closest("#mobile-more,#cc-startup"); }).slice(0, 3).map((e) => e.tagName + "#" + e.id + "." + e.className) }));
    assert.ok(over.sx <= over.iw, JSON.stringify(over));
    assert.equal(await vis(t.page, "#go"), true);
  } finally { await t.close(); }
});

test("4d. the first-run welcome screen has no sidebar; it comes back after setup", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await goChat(t.page);
    await t.page.waitForFunction(() => window.CC.layout && window.CC.restartFullSetup, null, { timeout: WAIT });
    assert.equal(await vis(t.page, "#cc-side"), true);
    await t.page.evaluate(() => window.CC.restartFullSetup());
    await t.page.waitForFunction(() => window.CC.S.view === "setup" && window.CC.S.setup?.phase === "welcome", null, { timeout: WAIT });
    await t.page.waitForFunction(() => { const s = document.querySelector("#cc-side"); return !s || getComputedStyle(s).display === "none"; }, null, { timeout: WAIT });
    await t.page.evaluate(() => window.CC.go("command"));
    await t.page.waitForFunction(() => { const s = document.querySelector("#cc-side"); return s && getComputedStyle(s).display !== "none"; }, null, { timeout: WAIT });
  } finally { await t.close(); }
});

// ---------- 6. Live Ops is one line ----------
test("6. Live Ops: one status line with See live; the full map is an overlay (Simple and Expert)", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await demo(t);
    await t.page.evaluate(() => {
      const S = window.CC.S;
      S.live = { id: "m-test1", kind: "mission", status: "running", agents: {}, tasks: { a: { id: "a", title: "Plan", status: "done" }, b: { id: "b", title: "Write", status: "running" }, c: { id: "c", title: "Check", status: "queued" }, d: { id: "d", title: "Polish", status: "queued" }, e: { id: "e", title: "Ship", status: "queued" } }, mission: null, council: null, deliverable: "", primary: null };
      S.activeByProvider = { "demo-nova": 1, "demo-atlas": 1, "demo-sage": 1 };
      window.CC.render();
    });
    await t.page.waitForFunction(() => { const e = document.querySelector("#sc-live"); return e && !e.hidden && /\d AIs? working, step \d of 5/.test(e.textContent); }, null, { timeout: WAIT });
    assert.equal(await vis(t.page, "#graph"), false, "no map on screen by default");
    assert.equal(await vis(t.page, "#sc-live-open"), true);
    assert.match(await t.page.textContent("#sc-live-open"), /See live/);
    await t.page.click("#sc-live-open");
    await t.page.waitForSelector("#cc-live-over #lo-graph svg", { timeout: WAIT });
    assert.match(await t.page.textContent("#lo-steps"), /Write/);
    await t.page.keyboard.press("Escape");
    await t.page.waitForFunction(() => !document.querySelector("#cc-live-over"), null, { timeout: WAIT });
  } finally { await t.close(); }
  const e = await bootPage({ mode: "simple", width: 1500, height: 900 });
  try {
    await goChat(e.page);
    await e.page.waitForFunction(() => window.CC.layout && window.CC.dock, null, { timeout: WAIT });
    await e.page.click("#mode-expert");
    await e.page.waitForFunction(() => document.body.dataset.ui === "expert" && document.querySelector("#run-mode"), null, { timeout: WAIT });
    await e.page.evaluate(() => {
      const S = window.CC.S;
      S.live = { id: "m-test2", kind: "mission", status: "running", agents: {}, tasks: { a: { id: "a", title: "Plan", status: "running" }, b: { id: "b", title: "Write", status: "queued" } }, mission: null, council: null, deliverable: "", primary: null };
      window.CC.render();
    });
    await e.page.waitForSelector("#cc-ops-slim", { timeout: WAIT });
    assert.match(await e.page.textContent("#cc-ops-expand"), /See live/);
    assert.equal(await vis(e.page, "#graph"), false, "the slim line is the default in Expert too");
    await e.page.click("#cc-ops-expand");
    await e.page.waitForSelector("#cc-live-over #lo-graph svg", { timeout: WAIT });
    await e.page.keyboard.press("Escape");
  } finally { await e.close(); }
});

// ---------- 7. AI icons light up while working ----------
test("7. the AI icons light up while an AI works and go dark when it is done", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await demo(t);
    const id = await t.page.evaluate(() => document.querySelector("#cc-composer-ais .composer-ai[data-p]")?.dataset.p || "");
    assert.ok(id, "a connected AI is on the bar");
    await t.page.evaluate((pid) => { const S = window.CC.S; S.live = { id: "r-1", kind: "single", status: "running", agents: {}, tasks: {}, mission: null, council: null, deliverable: "", primary: null }; S.activeByProvider = { [pid]: 1 }; window.CC.render(); }, id);
    await t.page.waitForSelector(`#cc-composer-ais .composer-ai.working[data-p="${id}"]`, { timeout: WAIT });
    assert.equal(await vis(t.page, `#cc-composer-ais .composer-ai[data-p="${id}"]`), true, "the lit icon is on screen while working");
    await t.page.evaluate(() => { const S = window.CC.S; S.live.status = "done"; S.activeByProvider = {}; window.CC.render(); });
    await t.page.waitForFunction(() => !document.querySelector("#cc-composer-ais .composer-ai.working"), null, { timeout: WAIT });
    assert.equal(await t.page.evaluate((pid) => document.querySelector(`#cc-composer-ais .composer-ai[data-p="${pid}"]`)?.dataset.working, id), "0", "dark again when done");
  } finally { await t.close(); }
});

test("7b. pure: an AI that is working always has an icon, and only while it works", async () => {
  const { withWorking, withWorkingProviders, composerAis } = await import("../web/composer-ais.js");
  const providers = [{ id: "claude", name: "Claude", kind: "text", keyed: true }, { id: "demo-nova", name: "Nova", kind: "text", demo: true }, { id: "pixel", name: "Pixel", kind: "image" }];
  const chips = composerAis(providers);
  assert.deepEqual(chips.map((c) => c.id), ["claude"], "a practice AI next to a real one is not on the bar");
  assert.deepEqual(withWorking(chips, providers, []).map((c) => c.id), ["claude"], "nothing working, nothing added");
  assert.deepEqual(withWorking(chips, providers, ["demo-nova"]).map((c) => c.id), ["claude", "demo-nova"], "it appears while it works");
  assert.deepEqual(withWorking(chips, providers, ["claude"]).map((c) => c.id), ["claude"], "no duplicate");
  assert.deepEqual(withWorking(chips, providers, ["nobody"]).map((c) => c.id), ["claude"], "an unknown id is ignored");
  assert.deepEqual(withWorkingProviders([providers[0]], providers, ["pixel"]).map((p) => p.id), ["claude", "pixel"]);
  const app = read("web", "app.js");
  assert.match(app, /withWorking\(composerAis\(S\.providers\), S\.providers, activeIds\(\)\)/);
  assert.match(app, /class="composer-ai\$\{c\.demo \? " demo" : ""\}\$\{working \? " working" : ""\}"/);
});

// ---------- 8. big builds open the Build panel ----------
test("8. a web page build opens the Build panel by itself with version arrows, Preview, Download and one Publish", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await demo(t);
    // two saved versions of one page, so the arrows have somewhere to go
    const a = (await t.api("/mindmedia/save", { body: { text: SITE, name: "Bakery site", projectId: "my-project", source: "test" } })).json;
    const b = (await t.api("/mindmedia/save", { body: { text: SITE.replace("Fresh bread daily", "Fresh bread and cakes"), name: "Bakery site v2", projectId: "my-project", source: "test" } })).json;
    assert.ok(a && b);
    assert.equal(await t.page.evaluate(() => document.body.classList.contains("mm-panel-open")), false);
    await t.page.evaluate((html) => {
      const S = window.CC.S;
      S.live = { id: "r-site", kind: "single", status: "done", agents: { x: { provider: "demo-nova", model: "m", text: html, done: true, role: "answer" } }, tasks: {}, mission: null, council: null, deliverable: html, primary: "x" };
      window.CC.render();
    }, SITE);
    await t.page.waitForFunction(() => document.body.classList.contains("mm-panel-open") && document.querySelector("#cc-canvas.docked:not([hidden])"), null, { timeout: WAIT });
    await t.page.waitForSelector("#cc-canvas.docked #cv-view iframe", { timeout: WAIT });
    assert.match(await t.page.getAttribute("#cc-canvas.docked #cv-view iframe", "srcdoc"), /Fresh bread daily/);
    for (const id of ["#cv-prev", "#cv-next", "#cv-preview", "#cv-download", "#cv-publish"]) assert.equal(await vis(t.page, id), true, `${id} is in the Build panel`);
    const publishes = await t.page.evaluate(() => [...document.querySelectorAll("#cc-canvas .cv-top button")].filter((b) => b.getBoundingClientRect().width > 0 && /^Publish/.test(b.textContent.trim())).length);
    assert.equal(publishes, 1, "one Publish button");
    // the arrows step through saved versions
    await t.page.evaluate(() => window.CC.canvas.show(window.CC.canvas.versions().list.at(-1) ? `${window.CC.canvas.versions().list.at(-1).projectId}|${window.CC.canvas.versions().list.at(-1).id}` : ""));
    await t.page.waitForFunction(() => /v\d of \d/.test(document.querySelector("#cv-ver")?.textContent || ""), null, { timeout: WAIT });
    const v1 = await t.page.textContent("#cv-ver");
    await t.page.click("#cv-prev");
    await t.page.waitForFunction((x) => document.querySelector("#cv-ver")?.textContent !== x, v1, { timeout: WAIT });
    // Download hands over a file
    const dl = t.page.waitForEvent("download", { timeout: WAIT });
    await t.page.click("#cv-download");
    assert.match((await dl).suggestedFilename(), /\.html$/);
    // the chat column is still there beside it, with the box at the bottom
    assert.equal(await vis(t.page, "#orders"), true);
    // closing it leaves the chat alone
    await t.page.click("#cv-close");
    await t.page.waitForFunction(() => !document.body.classList.contains("mm-panel-open"), null, { timeout: WAIT });
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("8b. Start a project hands its build to the Build panel as it is made", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    await demo(t);
    await t.page.evaluate(() => window.CC.go("start"));
    await t.page.waitForFunction(() => window.CC.layout && window.CC.canvas, null, { timeout: WAIT });
    await t.page.evaluate((html) => window.CC.layout.buildFeed({ name: "Bakery site", text: html, working: true }), SITE);
    await t.page.waitForSelector("#cc-canvas.docked #cv-view iframe", { timeout: WAIT });
    assert.equal(await t.page.evaluate(() => document.body.classList.contains("mm-panel-open")), true);
    // leaving the page closes the panel again
    await t.page.evaluate(() => window.CC.go("settings"));
    await t.page.waitForFunction(() => !document.body.classList.contains("mm-panel-open"), null, { timeout: WAIT });
  } finally { await t.close(); }
});

// ---------- 5c. AI News has one home: its own item in the sidebar ----------
test("5c. AI News is its own sidebar item, not in the profile menu, and opens its page", { skip }, async () => {
  const t = await bootPage({ mode: "simple", width: 1500, height: 900 });
  try {
    await goChat(t.page);
    await t.page.waitForSelector("#cc-side", { timeout: WAIT });
    await t.page.waitForTimeout(1200);
    assert.equal(await vis(t.page, "#cc-rail"), false, "no floating News card");
    assert.equal(await vis(t.page, "#side-news"), true, "AI News sits in the sidebar");
    await t.page.click("#side-profile");
    assert.equal(await t.page.locator('#side-menu [data-menu-act="news"]').count(), 0, "not repeated in the profile menu");
    await t.page.keyboard.press("Escape");
    await t.page.click("#side-news");
    await t.page.waitForFunction(() => window.CC.S.view === "ai-news", null, { timeout: WAIT });
    await t.page.waitForSelector('#view [data-ai-news="1"]', { timeout: WAIT });
  } finally { await t.close(); }
});

