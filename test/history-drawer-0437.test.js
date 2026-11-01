// 0.4.37 fixes from the 0.4.35 persona panel (meldmind-panel-0435/FIXES-0437.md items 2, 3, 4, 5, 8 and 10).
// 2: a click inside the History drawer (Show all, a group fold, a filter chip) leaves it open.
// 3: a row click, or Enter on a row, opens that chat (CC.openRun, as the History page does), never "no such route".
// 4: typing "post" in the drawer search keeps "post" in the box, keeps focus there and filters the list.
// 5: the Just chat bar on the Simple home reads at 4.5 : 1 or better in dark.
// 8: the welcome screen's free-AI step has no row without a button, and says "key" far fewer times.
// 10: titles get two lines, group names stay on one line, and a Simple path row shows the person's own words.
// Real server in demo mode (practice AIs, no key, nothing sent) and headless Chrome (skips when none is installed).
// Windows rules: one server and one browser at a time, real waits (polls and waitForFunction), everything closed.
// Clicks in the drawer are real mouse clicks at the painted centre (harness lesson 0435 b): a DOM click hides the bug.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { waitBudget, ROOT } from "./helpers.js";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";
import { paintedContrast } from "./paint-helpers.js";
import { titleOf, personWords } from "../web/mac/data/history.js";
import { buildPrompt } from "../web/mac/data/flow.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const RUN = waitBudget(90000);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
// Never reach GitHub for the daily free-AI list (harness lesson 0435 a).
const ENV = { CC_FREE_CATALOG_URL: "http://127.0.0.1:9/free-catalog.json" };

// ---------- source and pure parts ----------

test("source: the drawer opens chats with CC.openRun, keeps its search box, and checks the click's path", () => {
  const src = read("web", "mac", "parts", "history.js");
  assert.doesNotMatch(src, /CC\.openChat\(|\/chathist\/get\?/, "no call to the missing route");
  assert.match(src, /CC\.openRun\(chatId\)/);
  assert.match(src, /composedPath\(\)/);
  assert.doesNotMatch(src, /<button[^>]*mac-hist-item[^>]*>\s*<span[^>]*>[^<]*<\/span>\s*<button/, "no button inside a button");
  for (const f of [["web", "mac", "parts", "history.js"], ["web", "mac", "css", "history.css"], ["web", "mac", "data", "history.js"], ["web", "mac", "css", "flow.css"], ["web", "features", "free-setup.js"], ["web", "simple-ui.js"]]) {
    assert.equal(/—/.test(read(...f)), false, `no em-dash in ${f.join("/")}`);
  }
});

test("item 10d: a Simple path row shows the person's own words, other titles stay as they are", () => {
  const doc = buildPrompt("document", { id: "letter", style: "letter" }, "A one-page welcome letter for new patients");
  assert.equal(titleOf({ title: doc }), "A one-page welcome letter for new patients");
  assert.equal(titleOf({ title: "Write a Word document for a one-page welcome letter for new pat" }), "A one-page welcome letter for new pat", "a cut title keeps what it has");
  const sheet = buildPrompt("spreadsheet", { id: "budget", style: "budget" }, "monthly budget for my house");
  assert.equal(titleOf({ title: sheet }), "Monthly budget for my house");
  const script = buildPrompt("script", { id: "py", style: "py" }, "renames photos by date");
  assert.equal(titleOf({ title: script }), "Renames photos by date");
  assert.equal(personWords("Write a post about our app launch party"), "Write a post about our app launch party");
  assert.equal(titleOf({ title: "Bakery menu" }), "Bakery menu");
  assert.equal(titleOf({ title: "" }), "Untitled chat");
});

test("item 8: the setup step keeps only rows with a button (or Ready); Grok Bot and Browser helper are not in it", async () => {
  // free-setup.js reads window.CC at load; give it just enough to import the pure parts.
  globalThis.window = { CC: { api: async () => ({}), toast() {}, esc: (s) => String(s), register() {} } };
  try {
    const { showsInSetup, KEYS_SHOWN } = await import("../web/features/free-setup.js");
    assert.equal(showsInSetup({ id: "grokbot", status: "signin" }), false);
    assert.equal(showsInSetup({ id: "browser-helper", status: "signin" }), false);
    assert.equal(showsInSetup({ id: "grokbot", status: "ready" }), false, "set up under Connect, not here");
    assert.equal(showsInSetup({ id: "codex", status: "missing" }), true, "Install");
    assert.equal(showsInSetup({ id: "codex", status: "signin" }), true, "Sign in");
    assert.equal(showsInSetup({ id: "claude-code", status: "ready" }), true, "Ready chip");
    assert.equal(showsInSetup({ id: "antigravity", status: "signin" }), true, "Open Antigravity");
    assert.equal(showsInSetup({ id: "some-new-app", status: "signin" }), false, "no button, no row");
    assert.equal(showsInSetup({ id: "gemini-cli", status: "retired" }), false);
    assert.equal(KEYS_SHOWN, 3);
  } finally { delete globalThis.window; }
});

// ---------- the drawer in the browser ----------

const PROMPTS = [
  "Write a post about our bakery open day",
  "Write a post about our new rye bread",
  "Write a post about our weekend hours",
  "Write a post about our cake class",
  "Write a post about our holiday sale",
  "Write a post about our coffee beans",
  "Write a python script that prints the date",
];

async function seed(t) {
  assert.equal((await t.api("/demo", { body: { on: true } })).status, 200);
  const ids = [];
  for (const prompt of PROMPTS) {
    const r = await t.api("/chat", { body: { prompt } });
    assert.equal(r.status, 202, `chat started for "${prompt}"`);
    ids.push(r.json.runId);
    const t0 = Date.now();
    for (;;) {
      const m = (await t.api(`/missions/${r.json.runId}`)).json;
      if (m?.status && !["running", "waiting"].includes(m.status)) break;
      assert.ok(Date.now() - t0 < RUN, `"${prompt}" finished in time`);
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  return ids;
}

const drawer = (t) => t.page.evaluate(() => {
  const d = document.getElementById("mac-history-drawer");
  return {
    open: d.classList.contains("open"),
    x: Math.round(d.getBoundingClientRect().x),
    items: [...d.querySelectorAll(".mac-hist-item")].map((b) => b.querySelector(".mac-hist-item-title").textContent.trim()),
    groups: [...d.querySelectorAll("[data-toggle]")].map((b) => b.textContent.replace(/\s+/g, " ").trim()),
    chips: [...d.querySelectorAll("[data-chip]")].map((b) => `${b.dataset.chip}${b.classList.contains("on") ? "*" : ""}`),
    more: d.querySelector("[data-more]")?.textContent || "",
  };
});
// the slide (0.25 s) has finished and the drawer sits at x 0
const settledOpen = (t) => t.page.waitForFunction(() => { const d = document.getElementById("mac-history-drawer"); return d.classList.contains("open") && Math.round(d.getBoundingClientRect().x) === 0 && !d.getAnimations().length; }, null, { timeout: WAIT });
const settledShut = (t) => t.page.waitForFunction(() => { const d = document.getElementById("mac-history-drawer"); return !d.classList.contains("open") && !d.getAnimations().length; }, null, { timeout: WAIT });
async function clickAt(t, selector) {
  const box = await t.page.locator(selector).first().boundingBox();
  assert.ok(box, `${selector} is on screen`);
  await t.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function openDrawer(t) {
  // the shell's open message, the one the dock button sends (the 0.4.36 dock hides itself until the pointer comes near)
  await t.page.evaluate(() => window.CC.mac.bus.emit("open", { panel: "history", open: true }));
  await settledOpen(t);
  await t.page.waitForFunction(() => document.querySelectorAll("#mac-history-drawer .mac-hist-item").length >= 2, null, { timeout: WAIT });
}
// stays open a moment after the click (the old bug shut it at once)
async function stillOpen(t, what) {
  await t.page.waitForTimeout(400);
  const s = await drawer(t);
  assert.equal(s.open, true, `${what}: the drawer is still open`);
  assert.equal(s.x, 0, `${what}: the drawer is still at x 0`);
  return s;
}

test("items 2, 4, 10: Show all, a fold and a chip leave the drawer open; typing post keeps post and focus; Escape and x close it", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple", env: ENV });
  try {
    await seed(t);
    await t.page.evaluate(() => { try { localStorage.removeItem("cc.hist.closed"); } catch {} });
    await openDrawer(t);
    let s = await drawer(t);
    const chats = s.groups.find((g) => /^▾ Chats 6 /.test(g));
    assert.ok(chats, `a Chats group with all six posts: ${s.groups}`);
    assert.equal(s.more, "Show all 6");
    const before = s.items.length;

    // item 2: Show all
    await clickAt(t, "#mac-history-drawer [data-more]");
    s = await stillOpen(t, "Show all");
    assert.equal(s.items.length, before + 1, "the sixth post shows");
    assert.equal(s.more, "");

    // item 2: the group fold, then open again
    await clickAt(t, '#mac-history-drawer [data-toggle="c:chats"]');
    s = await stillOpen(t, "fold");
    assert.match(s.groups.find((g) => /Chats/.test(g)), /^▸ Chats/);
    assert.equal(s.items.length, before + 1 - 6, "the folded group hides its rows");
    await clickAt(t, '#mac-history-drawer [data-toggle="c:chats"]');
    s = await stillOpen(t, "unfold");
    assert.match(s.groups.find((g) => /Chats/.test(g)), /^▾ Chats/);

    // item 2: a filter chip, then All again
    await clickAt(t, '#mac-history-drawer [data-chip="code"]');
    s = await stillOpen(t, "Code chip");
    assert.ok(s.chips.includes("code*"), `${s.chips}`);
    assert.deepEqual(s.items, ["Write a python script that prints the date"]);
    await clickAt(t, '#mac-history-drawer [data-chip="all"]');
    s = await stillOpen(t, "All chip");
    assert.equal(s.items.length, before + 1);

    // item 10a and b: titles have room for two lines; every group header is one line
    const look = await t.page.evaluate(() => {
      const title = document.querySelector("#mac-history-drawer .mac-hist-item-title");
      const cs = getComputedStyle(title);
      const heads = [...document.querySelectorAll("#mac-history-drawer [data-toggle]")].map((b) => { const lh = parseFloat(getComputedStyle(b).lineHeight) || 16; return Math.round(b.querySelector(".mac-hist-group-name").getBoundingClientRect().height / lh); });
      const strays = [...document.querySelectorAll("#mac-history-drawer .mac-hist-group > .mac-hist-redo-btn")].length;
      return { wrap: cs.whiteSpace, clamp: cs.webkitLineClamp, heads, strays };
    });
    assert.equal(look.wrap, "normal");
    assert.equal(String(look.clamp), "2");
    assert.ok(look.heads.every((n) => n <= 1), `group names on one line: ${look.heads}`);
    assert.equal(look.strays, 0, "Redo sits in its row, not under it");

    // item 4: real key presses in the search box
    await clickAt(t, "#mac-history-drawer .mac-hist-search");
    await t.page.keyboard.type("post", { delay: 60 });
    await t.page.waitForFunction(() => document.querySelectorAll("#mac-history-drawer .mac-hist-item").length === 6, null, { timeout: WAIT });
    const typed = await t.page.evaluate(() => ({ value: document.querySelector("#mac-history-drawer .mac-hist-search").value, focused: document.activeElement === document.querySelector("#mac-history-drawer .mac-hist-search"), caret: document.activeElement.selectionStart }));
    assert.deepEqual(typed, { value: "post", focused: true, caret: 4 });
    s = await stillOpen(t, "search");
    assert.ok(s.items.every((x) => /post/i.test(x)), `${s.items}`);
    for (let i = 0; i < 4; i++) await t.page.keyboard.press("Backspace");
    await t.page.waitForFunction(() => document.querySelectorAll("#mac-history-drawer .mac-hist-item").length >= 7, null, { timeout: WAIT });

    // Escape closes, then the x closes
    await t.page.keyboard.press("Escape");
    await settledShut(t);
    await openDrawer(t);
    await clickAt(t, "#mac-history-drawer .mac-hist-close");
    await settledShut(t);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

async function chatShown(t, id) {
  await t.page.waitForFunction((id) => window.CC.S.live?.id === id && window.CC.S.view === "command" && window.CC.S.live.deliverable, id, { timeout: WAIT });
  const m = (await t.api(`/missions/${id}`)).json;
  // one line of the answer, without markdown marks, is on screen in the chat
  const line = String(m.deliverable || "").split("\n").map((l) => l.replace(/[#*_>`|-]/g, " ").replace(/\s+/g, " ").trim()).filter((l) => l.length > 12).sort((a, b) => b.length - a.length)[0] || "";
  assert.ok(line, "the practice answer has a line to look for");
  const probe = line.slice(0, 24);
  await t.page.waitForFunction((probe) => {
    const v = document.getElementById("view");
    return !!v && v.innerText.replace(/\s+/g, " ").includes(probe) && document.body.dataset.macFlow !== "on";
  }, probe, { timeout: WAIT });
  const state = await t.page.evaluate(() => ({ drawer: document.getElementById("mac-history-drawer").classList.contains("open"), text: document.body.innerText }));
  assert.equal(state.drawer, false, "the drawer closes when a chat opens");
  assert.doesNotMatch(state.text, /no such route/i);
}

test("item 3: a row click and Enter on a row open that chat (Simple Mac look, demo)", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple", env: ENV });
  try {
    const ids = await seed(t);
    await t.page.evaluate(() => { try { localStorage.removeItem("cc.hist.closed"); } catch {} });
    // mouse: the second row
    await openDrawer(t);
    const second = await t.page.evaluate(() => document.querySelectorAll("#mac-history-drawer .mac-hist-item")[1].dataset.id);
    assert.ok(ids.includes(second));
    await clickAt(t, `#mac-history-drawer .mac-hist-item[data-id="${second}"]`);
    await chatShown(t, second);

    // keyboard: a focused row and Enter
    await openDrawer(t);
    const third = await t.page.evaluate(() => { const b = document.querySelectorAll("#mac-history-drawer .mac-hist-item")[2]; b.focus(); return b.dataset.id; });
    assert.notEqual(third, second);
    await t.page.keyboard.press("Enter");
    await chatShown(t, third);

    // keyboard: the arrow keys from the search box, then Enter (the panel's way: ArrowDown twice, Enter)
    await openDrawer(t);
    await t.page.waitForFunction(() => document.activeElement?.classList.contains("mac-hist-search"), null, { timeout: WAIT });
    const picked = await t.page.evaluate(() => document.querySelectorAll("#mac-history-drawer .mac-hist-item")[1].dataset.id);
    await t.page.keyboard.press("ArrowDown");
    await t.page.keyboard.press("ArrowDown");
    await t.page.keyboard.press("Enter");
    await chatShown(t, picked);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 5: the Just chat bar in dark ----------

test("item 5: the Just chat bar reads at 4.5 : 1 or better in Simple dark (1440 x 900), and in light", { skip }, async () => {
  for (const theme of ["dark", "light"]) {
    const t = await bootPage({ mac: "default", hidePopups: false, theme, width: 1440, height: 900, env: ENV });
    try {
      await t.page.waitForFunction(() => window.CC.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
      await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,.cc-tour-invite,#update-bar,#upd-fail,#cc-expert-card{display:none!important}" });
      await t.page.waitForSelector("#mf-chat-card", { state: "visible", timeout: WAIT });
      await t.page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming?.().iterations === Infinity), null, { timeout: WAIT });
      const list = await paintedContrast(t.page, "#mf-chat-card b, #mf-chat-card small", { max: 2 });
      assert.equal(list.length, 2, `${theme}: both lines measured`);
      for (const x of list) assert.ok(x.ratio >= 4.5, `${theme}: ${x.ratio} "${x.text}" fg ${x.fg} on ${x.bg}`);
    } finally { await t.close(); }
  }
});

// ---------- item 8: the welcome screen ----------

test("item 8: welcome at 1366 x 800, every free-AI row has a button (or Ready), and \"key\" is said 6 times or fewer", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple", env: ENV });
  try {
    await t.page.evaluate(() => { window.CC.S.setup = { step: 1, history: false, keys: true, bookmarks: true, desktop: false, days: 180, result: null, busy: false, phase: "welcome" }; window.CC.go("setup"); });
    await t.page.waitForSelector("#su-welcome", { timeout: WAIT });
    await t.page.waitForFunction(() => document.querySelector("#cc-free-setup [data-fs-app]") && document.querySelector("#cc-free-setup [data-fs-key]") && window.CC.S.setup.detectChecked && window.CC.S.setup.privacyKnown, null, { timeout: WAIT });
    const info = await t.page.evaluate(() => {
      const shown = (el) => !el.closest("details:not([open])") && el.getClientRects().length > 0;
      const rows = [...document.querySelectorAll("#cc-free-setup .cc-fs-row")].filter(shown).map((r) => ({
        text: r.innerText.replace(/\s+/g, " ").trim(),
        action: r.querySelectorAll("button, a[href]").length > 0,
        ready: !!r.querySelector(".chip.green"),
      }));
      const text = document.getElementById("su-welcome").innerText;
      return { rows, keys: (text.match(/key/gi) || []).length, keyLines: text.split("\n").filter((l) => /key/i.test(l)), more: document.querySelector("#cc-free-setup .cc-fs-more summary")?.textContent || "" };
    });
    assert.ok(info.rows.length >= 4, `rows measured: ${info.rows.map((r) => r.text)}`);
    for (const r of info.rows) assert.ok(r.action || r.ready, `row with no button: "${r.text}"`);
    assert.ok(!info.rows.some((r) => /Grok Bot|Browser helper/.test(r.text)), "Grok Bot and Browser helper are not in the setup step");
    assert.match(info.more, /^More free sign-ups \(\d+\)$/);
    // Before: 16 on this branch at 1366 x 800 in demo (the 0.4.35 panel counted 20). The privacy line's "keys" is locked
    // wording (DECISIONS 31), and "Or paste an OpenRouter key" names what the box takes.
    assert.ok(info.keys <= 6, `"key" ${info.keys} times: ${JSON.stringify(info.keyLines)}`);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
