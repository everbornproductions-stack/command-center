// 0.4.27: fixes from the 0.4.26 persona panel (meldmind-panel-0426/FIXES-0427.md items 1 to 12b).
// Real server in demo mode and headless Chrome; skips only when no Chrome is installed. Contrast is measured on the
// painted pixels and every "on screen" claim is an elementFromPoint hit test. Every Expert boot checks that
// body[data-ui] really is "expert" after the switch (LESSONS 2026-10-30: the 0.4.24 audit's Expert sweeps ran in Simple).
// Windows rules: one browser at a time, real waits, and every test closes its browser and server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { paintedContrast } from "./paint-helpers.js";
import { ENGINE_BOX_MS, STARTING_LINE } from "../web/engine-wait.js";
import { transcribeAudio, soundsSilent, soundsUnreadable, NOTHING_HEARD, UNREADABLE } from "../server/speech.js";
import { IMAGE_NO_KEY_LINE, plainPriceLine } from "../web/features/key-hints.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(30000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
// A failed update check every time: the update feed points at a closed local port, nothing leaves the PC.
const DEAD_FEED = { CC_UPDATE_FEED: "http://127.0.0.1:9/latest.json" };
const POPUPS = "#cc-startup,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,.toasts";
const low = (list, min = 4.5) => list.filter((x) => x.ratio < min).map((x) => `${x.ratio} "${x.text}" fg ${x.fg} on ${x.bg}`);

// Boot exactly as a new user does (Mac look on by default) and wait for every Mac part.
async function bootNew(opts) {
  const t = await bootPage({ mac: "default", hidePopups: false, ...opts });
  if (!t) return null;
  try {
    await t.page.waitForFunction(() => window.CC.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
    await t.page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: WAIT }).catch(() => {});
    await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
    await t.page.waitForTimeout(1500);
    return t;
  } catch (e) { await t.close(); throw e; }
}
// The Mac switch, then proof that the page really is in Expert (the confirm dialog is accepted by bootPage).
async function toExpert(t) {
  if (await t.page.evaluate(() => document.body.dataset.ui) !== "expert") await t.page.click("#mac-expert");
  await t.page.waitForFunction(() => document.body.dataset.ui === "expert" && !document.getElementById("mac-side").hidden, null, { timeout: WAIT });
  await t.page.waitForTimeout(800);
  assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "expert", "body[data-ui] is expert after the switch");
}
async function macTheme(t, theme) {
  if (await t.page.evaluate(() => document.body.dataset.theme) !== theme) await t.page.click("#mac-theme");
  await t.page.waitForFunction((th) => document.body.dataset.theme === th, theme, { timeout: WAIT });
  await t.page.waitForTimeout(400);
}
async function go(t, view) {
  await t.page.evaluate((v) => window.CC.go(v), view);
  await t.page.waitForFunction((v) => window.CC.S.view === v && document.getElementById("view").children.length > 0, view, { timeout: WAIT });
  await t.page.waitForTimeout(1000);
}
// Is the element fully inside the window and the top element at its centre, with no scrolling?
const onScreen = (page, sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { sel, found: false };
  const r = el.getBoundingClientRect();
  const inside = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const top = !!hit && (hit === el || el.contains(hit));
  return { sel, found: true, inside, top, by: top ? "" : hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none", rect: [r.left, r.top, r.width, r.height].map(Math.round).join(",") };
}, sel);

// ---------- items 1 and 4: the task box and Send on screen at laptop size, with three notices ----------

for (const [width, height, theme] of [[1366, 800, "light"], [1024, 768, "dark"]]) {
  test(`item 1 + 4: Expert Command at ${width} x ${height} (${theme}) shows the task box and Send without scrolling, with three notices waiting`, { skip }, async () => {
    const t = await bootNew({ theme, width, height, env: DEAD_FEED });
    try {
      await t.api("/update/check", { method: "POST", body: {} });
      await t.page.waitForFunction(() => /Couldn't check for updates/.test(document.getElementById("notices")?.textContent || ""), null, { timeout: WAIT });
      await toExpert(t); // a first switch to Expert also offers the Expert setup card
      await macTheme(t, theme);
      await go(t, "command");
      // Three notices: the failed update check, the Expert setup card, and the graphics offer (or a test bar with its own id
      // when this machine's graphics did not raise the offer). Only one shows; the rest wait behind "1 of 3".
      await t.page.evaluate(() => {
        const n = document.querySelectorAll("#mac-notices > :not(#notices):not(.mac-note-pager), #notices > *");
        const shown = [...n].filter((e) => e.getBoundingClientRect().height > 0).length;
        for (let i = shown; i < 3; i++) {
          const bar = document.createElement("div");
          bar.id = `test-notice-0427-${i}`; bar.className = "update-bar quiet"; bar.dataset.testNotice = "1";
          bar.innerHTML = `<span>Test notice ${i}</span><button type="button" class="btn sm">OK</button>`;
          document.getElementById("notices").appendChild(bar);
        }
      });
      // The notice on show stays put while others arrive (no jumping), so it can be any of them: "2 of 3" is fine.
      await t.page.waitForFunction(() => /^[1-9] of [3-9]$/.test(document.querySelector("#mac-notices .mac-note-count")?.textContent || ""), null, { timeout: WAIT });
      await t.page.waitForTimeout(600);
      const strip = await t.page.evaluate(() => {
        const bars = [...document.querySelectorAll("#mac-notices > :not(#notices):not(.mac-note-pager), #notices > *")].filter((e) => e.getBoundingClientRect().height > 0);
        const seen = bars.filter((e) => getComputedStyle(e).visibility !== "hidden" && e.getBoundingClientRect().height > 4);
        return { count: document.querySelector(".mac-note-count").textContent, seen: seen.map((e) => e.id), height: Math.round(document.getElementById("mac-notices").getBoundingClientRect().height), ui: document.body.dataset.ui };
      });
      assert.equal(strip.ui, "expert");
      assert.equal(strip.seen.length, 1, `one notice shows at a time (${strip.seen.join(", ")})`);
      assert.ok(strip.height <= 60, `the notice strip is one line (${strip.height}px)`);
      // Nothing scrolled, and both the task box and Send are on screen and on top.
      assert.equal(await t.page.evaluate(() => document.getElementById("view").scrollTop), 0);
      for (const sel of ["#orders", "#go"]) {
        const r = await onScreen(t.page, sel);
        assert.ok(r.found && r.inside && r.top, `${width}x${height} ${sel}: ${JSON.stringify(r)}`);
      }
      // Next shows the next notice, and its buttons take clicks.
      const first = await t.page.evaluate(() => document.querySelector("#mac-notices .mac-note-cur")?.id || "");
      await t.page.click("#mac-note-next");
      await t.page.waitForFunction((was) => { const c = document.querySelector("#mac-notices .mac-note-cur"); return !!c && c.id !== was; }, first, { timeout: WAIT });
      const cur = await t.page.evaluate(() => document.querySelector("#mac-notices .mac-note-cur")?.id || "");
      assert.ok(cur && cur !== first, `Next shows another notice (${first} then ${cur})`);
      for (const sel of [`#${cur} button`, "#mac-note-next"]) {
        const r = await onScreen(t.page, sel);
        assert.ok(r.inside && r.top, `${sel}: ${JSON.stringify(r)}`);
      }
      // The failed update check offers the download page, not a "Download".
      assert.match(await t.page.evaluate(() => document.getElementById("upd-dl")?.textContent || ""), /^Open the download page$/);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  });
}

test("item 1: the notice row is one line with More on a short window, and More opens the rest", { skip }, async () => {
  const t = await bootNew({ theme: "light", width: 1366, height: 800 });
  try {
    await toExpert(t);
    await go(t, "command");
    await t.page.waitForSelector("#app .cx-notes #projbar", { state: "attached", timeout: WAIT }); // its chips may wait behind More
    await t.page.waitForTimeout(1200);
    const folded = await t.page.evaluate(() => { const b = document.querySelector("#app .cx-notes"); const m = document.getElementById("cx-notes-more"); return { h: Math.round(b.getBoundingClientRect().height), more: !!m && !m.hidden, words: m?.textContent }; });
    assert.ok(folded.h <= 44, `one line (${folded.h}px)`);
    assert.deepEqual([folded.more, folded.words], [true, "More"]);
    await t.page.click("#cx-notes-more");
    await t.page.waitForTimeout(400);
    const open = await t.page.evaluate(() => { const b = document.querySelector("#app .cx-notes"); return { h: Math.round(b.getBoundingClientRect().height), words: document.getElementById("cx-notes-more").textContent, expanded: document.getElementById("cx-notes-more").getAttribute("aria-expanded") }; });
    assert.ok(open.h > folded.h, `More opens the row (${open.h}px)`);
    assert.deepEqual([open.words, open.expanded], ["Less", "true"]);
  } finally { await t.close(); }
});

// ---------- item 2: Expert at phone width ----------

test("item 2: Expert at 390 x 844 is not cut off; the sidebar starts as its rail and the bottom tabs keep their labels apart", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 390, height: 844 });
  try {
    await toExpert(t);
    const side = await t.page.evaluate(() => {
      const s = document.getElementById("mac-side").getBoundingClientRect(), a = document.getElementById("app").getBoundingClientRect();
      return { collapsed: document.getElementById("mac-side").classList.contains("mx-collapsed"), sideW: Math.round(s.width), sideRight: Math.round(s.right), appLeft: Math.round(a.left), appRight: Math.round(a.right) };
    });
    assert.equal(side.collapsed, true, "the sidebar starts as the slim rail");
    assert.ok(side.sideW <= 40 && side.appLeft >= side.sideRight - 1, `the sidebar does not cover the page ${JSON.stringify(side)}`);
    assert.ok(side.appRight <= 390, "the window fits the screen");
    for (const v of ["command", "credits", "projects"]) {
      await go(t, v);
      const cut = await t.page.evaluate(() => {
        const W = innerWidth;
        const scrollsSideways = (el) => { for (let a = el.parentElement; a && a.id !== "view"; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth) return true; } return false; };
        return [...document.querySelectorAll("#view *")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden" && (r.right > W + 1 || r.width > W) && !scrollsSideways(e);
        }).slice(0, 6).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${String(e.className).split(" ")[0]} ${Math.round(e.getBoundingClientRect().right)}`);
      });
      assert.deepEqual(cut, [], `${v}: nothing in the page is wider than the window`);
      const head = await t.page.evaluate(() => { const h = document.querySelector("#view > .cx-head"); return h ? Math.round(h.getBoundingClientRect().right) : 0; });
      assert.ok(head <= 390, `${v}: the page header fits (${head})`);
    }
    // KPI tiles are one column on a phone.
    await go(t, "credits");
    const cols = await t.page.evaluate(() => getComputedStyle(document.querySelector("#view .kpi")).gridTemplateColumns.split(" ").length);
    assert.equal(cols, 1, "one KPI column");
    // The bottom tab labels do not run together: every visible tab has its own box.
    const tabs = await t.page.evaluate(() => [...document.querySelectorAll("#mobile-nav button")].filter((b) => !b.hidden && b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, fit: b.scrollWidth <= b.clientWidth + 1, text: b.textContent.trim() }; }));
    assert.ok(tabs.length >= 5, `${tabs.length} tabs`);
    for (let i = 1; i < tabs.length; i++) assert.ok(tabs[i].l >= tabs[i - 1].r - 0.5, `${tabs[i - 1].text} and ${tabs[i].text} do not overlap`);
    assert.deepEqual(tabs.filter((x) => !x.fit).map((x) => x.text), [], "each label fits its tab");
    // Opening the sidebar lays it over the page; a pick closes it again.
    await t.page.click("#mac-side .mx-reopen");
    await t.page.waitForFunction(() => !document.getElementById("mac-side").classList.contains("mx-collapsed"), null, { timeout: WAIT });
    await t.page.waitForTimeout(600);
    await t.page.click('#mac-side .si[data-id]');
    await t.page.waitForFunction(() => document.getElementById("mac-side").classList.contains("mx-collapsed"), null, { timeout: WAIT });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 3: the project mode note ----------

test("item 3a + 3b: global Simple with a remembered Expert project shows the note after a reload, readable in light and dark", { skip }, async () => {
  for (const theme of ["light", "dark"]) {
    const t = await bootNew({ theme, width: 1366, height: 800, mode: "simple" });
    try {
      const made = await t.api("/projects", { body: { name: "Bakery posts" } });
      const id = made.json?.id || made.json?.project?.id;
      assert.ok(id, made.text);
      assert.equal((await t.api("/projects", { body: { id, uiMode: "expert" } })).status, 200);
      await t.api("/settings", { body: { uiMode: "simple", uiModeChosen: true } });
      await t.page.evaluate((pid) => localStorage.setItem("cc.project", pid), id);
      await t.page.reload({ waitUntil: "domcontentloaded" });
      await t.page.waitForFunction(() => window.CC?.mac && Object.keys(window.CC.mac.parts).length >= window.CC.mac.PARTS.length, null, { timeout: WAIT });
      await t.page.addStyleTag({ content: `${POPUPS}{display:none!important}` });
      await t.page.waitForSelector("#cc-project-mode-note", { timeout: WAIT });
      // The Command view draws its extras (the phone companion among them) after load; the project must stay put.
      await t.page.waitForTimeout(3000);
      await macTheme(t, theme);
      const got = await t.page.evaluate(() => ({ project: window.CC.S.project, ui: document.body.dataset.ui, note: document.getElementById("cc-project-mode-note")?.innerText || "", forced: document.getElementById("cc-project-mode-note")?.style.color || "", shown: document.querySelector("#mac-notices .mac-note-cur, #mac-notices:not(.mac-paged) #cc-project-mode-note")?.id || "" }));
      assert.equal(got.project, id, "the remembered project is still the active one");
      assert.equal(got.ui, "expert", "the window follows the project's own mode");
      assert.match(got.note, /This project is set to Expert\./);
      assert.equal(got.forced, "", "no forced text colour");
      assert.equal(got.shown, "cc-project-mode-note", "the note is the notice on show");
      const c = await paintedContrast(t.page, "#cc-project-mode-note > span", { max: 1 });
      assert.equal(c.length, 1, `${theme}: note measured`);
      assert.deepEqual(low(c), [], `${theme}: note text`);
    } finally { await t.close(); }
  }
});

test("item 3c: the seeded sample project has no mode of its own; the source no longer stamps one", { skip }, async () => {
  const t = await bootPage({ width: 1024, height: 700 });
  try {
    const again = await t.api("/setup/done", { body: { ensureSampleProject: true } });
    assert.equal(again.status, 200);
    const projects = (await t.api("/state")).json.projects || [];
    assert.ok(projects.length >= 1);
    for (const p of projects.filter((x) => x.sample || x.id === "my-project" || x.id === "sample-project")) assert.equal(p.uiMode ?? null, null, `${p.id} has no own mode`);
    if (again.json?.sampleProject) assert.equal(again.json.sampleProject.uiMode ?? null, null);
  } finally { await t.close(); }
  const src = read("server", "projects.js");
  const fn = src.slice(src.indexOf("export function ensureSampleProject"), src.indexOf("function wouldCycle"));
  assert.doesNotMatch(fn, /uiMode:/, "ensureSampleProject writes no uiMode");
  assert.match(read("server", "index.js"), /ensureSampleProject\(\)/);
});

// ---------- items 7 and 8: light Expert contrast and text size ----------

const MUTED = "#view .cx-head .cx-sub, #view .muted, #view .dim, #view .hint, #view label.lbl, #view .kpi .k .l, #view .kpi .k .s, #view :is(.btn.primary, #go):disabled";

test("item 7: light Expert muted text is at least 4.5:1 on the painted paper (1366 and 390)", { skip }, async () => {
  for (const [width, height] of [[1366, 800], [390, 844]]) {
    const t = await bootNew({ theme: "light", width, height });
    try {
      await toExpert(t);
      await macTheme(t, "light");
      let measured = 0;
      for (const v of ["command", "credits", "projects", "agents"]) {
        await go(t, v);
        const list = await paintedContrast(t.page, MUTED, { max: 30 });
        measured += list.length;
        assert.deepEqual(low(list), [], `${width} ${v}`);
      }
      assert.ok(measured >= 8, `${width}: measured ${measured}`);
      const muted = await t.page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--cx-muted").trim());
      assert.equal(muted, "#4b5563");
    } finally { await t.close(); }
  }
});

test("item 8: no 11 px text on Subscriptions in Expert, and the sidebar group headings are 12 px", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1440, height: 900 });
  try {
    await toExpert(t);
    await go(t, "subscriptions");
    const small = await t.page.evaluate(() => [...document.querySelectorAll("#view *")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} ${getComputedStyle(e).fontSize} "${e.textContent.trim().slice(0, 20)}"`));
    assert.deepEqual(small.slice(0, 10), [], "text under 12 px on Subscriptions");
    const grp = await t.page.evaluate(() => getComputedStyle(document.querySelector("#mac-side .grp")).fontSize);
    assert.equal(grp, "12px");
  } finally { await t.close(); }
});

// ---------- item 5: starting-up wording and the ready pill ----------

test("item 5: the starting-up line matches the box timing", () => {
  assert.equal(ENGINE_BOX_MS, 45000);
  assert.equal(STARTING_LINE, "Meldmind is starting up. This can take up to 45 seconds.");
  assert.doesNotMatch(STARTING_LINE, /minute/);
});

test("item 5: while the engine is down the title bar pill says Starting... with a grey dot", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 800 });
  try {
    await t.page.waitForFunction(() => document.getElementById("conn-txt")?.textContent === "live", null, { timeout: WAIT });
    await t.page.waitForFunction(() => /ready|No AIs yet/.test(document.getElementById("mac-ready-txt")?.textContent || ""), null, { timeout: WAIT });
    await t.s.stop();
    await t.page.waitForSelector("#engine-starting", { timeout: WAIT });
    await t.page.waitForFunction(() => document.getElementById("mac-ready-txt")?.textContent === "Starting...", null, { timeout: WAIT });
    const pill = await t.page.evaluate(() => ({ wait: document.getElementById("mac-ready").classList.contains("mac-wait"), dot: getComputedStyle(document.querySelector("#mac-ready .mac-dot")).backgroundColor, line: document.getElementById("engine-starting").textContent }));
    assert.equal(pill.wait, true);
    assert.notEqual(pill.dot, "rgb(48, 209, 88)", "not the green ready dot");
    assert.equal(pill.line, STARTING_LINE);
  } finally { await t.close(); }
});

// ---------- item 9: voice ----------

test("item 9: a recording the service cannot open gets its own line; a quiet one still says closer to the mic", async () => {
  const audio = { mime: "audio/webm", buf: Buffer.from("noise") };
  const keys = { groq: { key: "gsk_fake0427" } };
  const deps = (fetchImpl) => ({ hasSecret: (id) => id in keys, getSecret: (id) => keys[id], fetchImpl });
  const reply = (status, j) => ({ ok: status < 400, status, text: async () => JSON.stringify(j) });
  const bad = async () => reply(400, { error: { message: "could not process file - is it a valid media file?" } });
  await assert.rejects(() => transcribeAudio(audio, deps(bad)), (e) => e.status === 422 && e.code === "voice_unreadable" && e.message === UNREADABLE);
  const quiet = async () => reply(400, { error: { message: "Audio file is too short. Minimum audio length is 0.01 seconds." } });
  await assert.rejects(() => transcribeAudio(audio, deps(quiet)), (e) => e.code === "voice_silent" && e.message === NOTHING_HEARD);
  assert.equal(soundsSilent(400, "could not process file - is it a valid media file?"), false);
  assert.equal(soundsUnreadable(400, "Invalid media file"), true);
  assert.equal(soundsUnreadable(429, "invalid media file"), false, "a rate limit is never an unreadable file");
  assert.equal(UNREADABLE, "That recording could not be read. Try again.");
  // The Talk bar asks /api/voice/ready (local Whisper counts) before it shows the key line.
  assert.match(read("web", "features", "voice-talk.js"), /api\("\/voice\/ready"\)/);
});

// ---------- items 10 to 12: small words and code items ----------

test("items 10, 11, 12, 12b: plain words and the small code fixes", () => {
  assert.equal(IMAGE_NO_KEY_LINE, "Add a free Google Gemini key in Settings to make pictures.");
  assert.equal(plainPriceLine({ seconds: 5, note: "5s x $0.07/s (direct-API resource-pack rate; consumer plan credits = 50)" }, 0.35), "5 seconds, about $0.35 with your own key");
  assert.equal(plainPriceLine({}, 0.004), "about $0.00 with your own key");
  const media = read("web", "features", "media.js");
  assert.doesNotMatch(media, /estimate\.note/, "the jargon note is no longer shown");
  const app = read("web", "app.js");
  assert.match(app, /Use global \(\$\{globalUiMode\(\) === "expert" \? "Expert" : "Simple"\}\)/, "Use global names the global choice");
  assert.doesNotMatch(app, /color:#eef2f8"; \/\/ light text on the bar/, "no forced note colour");
  assert.match(app, /Type what you want first\. Preview route then shows/, "Preview route says what to do with an empty box");
  assert.match(app, /if \(simple\) \{\s*const box = \$\("#orders"\);\s*if \(box && box\.value\.trim\(\) === prompt\) box\.value = "";/, "Simple chat empties the box after Send");
  for (const f of [["web", "mac", "css", "shell.css"], ["web", "mac", "css", "inside.css"], ["web", "mac", "css", "flow.css"], ["web", "mac", "css", "runbar.css"], ["web", "mac", "parts", "shell.js"], ["web", "mac", "parts", "inside.js"], ["web", "mac", "parts", "expert.js"], ["web", "engine-wait.js"], ["server", "speech.js"]]) {
    assert.equal(/[–—]/.test(read(...f)), false, `${f.join("/")} has no dashes`);
  }
});

test("item 10: in Simple chat the box is empty after Send, so a second Send does not repeat the job", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 1366, height: 800 });
  try {
    await t.api("/demo", { body: { on: true } });
    await t.page.evaluate(() => window.CC.refresh?.());
    await t.page.waitForTimeout(1200);
    assert.equal(await t.page.evaluate(() => document.body.dataset.ui), "simple");
    await t.page.click("#mf-chat"); // Just chat instead
    await t.page.waitForSelector("#orders", { timeout: WAIT });
    await t.page.fill("#orders", "Write one friendly line for my bakery");
    await t.page.click("#go");
    await t.page.waitForFunction(() => !!window.CC.S.live?.id, null, { timeout: WAIT });
    await t.page.waitForFunction(() => (document.getElementById("orders")?.value || "") === "", null, { timeout: WAIT });
    assert.equal(await t.page.evaluate(() => window.CC.S.lastPrompt), "Write one friendly line for my bakery", "the words are kept for the answer title");
  } finally { await t.close(); }
});

test("item 10b: Simple at 390 wide gives the Or just say it box the whole first row", { skip }, async () => {
  const t = await bootNew({ theme: "dark", width: 390, height: 844 });
  try {
    await t.page.waitForSelector("#mac-flow #mf-ask", { timeout: WAIT });
    const g = await t.page.evaluate(() => { const box = document.querySelector("#mac-flow .mf-box").getBoundingClientRect(); const ask = document.getElementById("mf-ask").getBoundingClientRect(); const next = document.getElementById("mf-next").getBoundingClientRect(); return { box: box.width, ask: ask.width, nextBelow: next.top >= ask.bottom - 1 }; });
    assert.ok(g.ask >= g.box * 0.8, `the box is ${Math.round(g.ask)} of ${Math.round(g.box)} px`);
    assert.equal(g.nextBelow, true, "Next is on the second row");
  } finally { await t.close(); }
});
