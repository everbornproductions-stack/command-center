// 0.4.23 part "flow": pure state machine tests first, then real-browser tests (Simple, Mac on, practice AIs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as F from "../web/mac/data/flow.js";
import { makeIntent } from "../web/make-intent.js";
import { findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";
import { waitBudget } from "./helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(25000);
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("source: files exist and carry no em or en dashes", () => {
  for (const f of [["web", "mac", "data", "flow.js"], ["web", "mac", "parts", "flow.js"], ["web", "mac", "css", "flow.css"]]) {
    assert.equal(/[–—]/.test(read(...f)), false, f.join("/"));
  }
  assert.match(read("web", "mac", "css", "flow.css").replace(/\/\*[\s\S]*?\*\//g, "").split("}").filter((b) => b.trim()).map((b) => b.split("{")[0].trim()).join("\n"), /body\[data-style="mac"\]/);
});

test("css: every selector starts with body[data-style=\"mac\"]", () => {
  const css = read("web", "mac", "css", "flow.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const heads = [];
  css.replace(/(^|\})\s*([^{}@][^{}]*)\{/g, (_, __, h) => { heads.push(h); return ""; });
  assert.ok(heads.length > 20);
  for (const h of heads) for (const sel of h.split(",")) {
    const s = sel.trim();
    if (/^(from|to|\d+%)$/.test(s) || s.startsWith("@media")) continue;
    assert.ok(s.startsWith('body[data-style="mac"]'), s);
  }
});

test("start: each path goes to the style step and clears old work", () => {
  for (const p of F.PATHS) {
    const s = F.start({ ...F.initial(), text: "old", photos: [1] }, p);
    assert.deepEqual(s, { path: p, step: "style", style: null, text: "", photos: [], runId: "" });
  }
  assert.deepEqual(F.start(F.initial(), "nonsense"), F.initial());
});

test("pickStyle: moves to tell, keeps the path, takes a card or a plain name", () => {
  let s = F.start(F.initial(), "image");
  s = F.pickStyle(s, { id: "photo", title: "Real photo", style: "a realistic photograph" });
  assert.equal(s.step, "tell");
  assert.equal(s.style.id, "photo");
  assert.equal(F.pickStyle(s, "x").style.title, "x");
  assert.equal(F.pickStyle(F.initial(), { id: "a" }).step, "home", "no path, no move");
  assert.equal(F.pickStyle(s, null), s);
});

test("setText, photos: text is capped, photos add and remove, at most 12", () => {
  let s = F.setText(F.start(F.initial(), "website"), "x".repeat(900));
  assert.equal(s.text.length, 600);
  for (let i = 0; i < 15; i++) s = F.addPhoto(s, { name: `p${i}.png` });
  assert.equal(s.photos.length, 12);
  s = F.removePhoto(s, 0);
  assert.equal(s.photos.length, 11);
  assert.equal(s.photos[0].name, "p1.png");
  assert.equal(F.addPhoto(s, null), s);
});

test("go: needs the tell step and a real sentence", () => {
  let s = F.pickStyle(F.start(F.initial(), "image"), "photo");
  assert.equal(F.canGo(s), false);
  assert.equal(F.go(s).step, "tell");
  s = F.setText(s, "ab");
  assert.equal(F.canGo(s), false);
  s = F.setText(s, "a dog on a beach");
  assert.equal(F.canGo(s), true);
  const w = F.go(s, "run1");
  assert.equal(w.step, "working");
  assert.equal(w.runId, "run1");
  assert.equal(F.go(F.initial()).step, "home");
  assert.equal(F.setRun(w, "r2").runId, "r2");
});

test("finish: working ends as done or incomplete, nothing else does", () => {
  const w = { ...F.initial(), path: "website", step: "working", text: "bakery" };
  assert.equal(F.finish(w).step, "done");
  assert.equal(F.finish(w, { incomplete: true }).step, "incomplete");
  assert.equal(F.finish({ ...w, step: "tell" }).step, "tell");
  assert.equal(F.finish({ ...w, step: "done" }, { incomplete: true }).step, "done");
});

test("retry: from incomplete or done back to working, same words", () => {
  const i = { ...F.initial(), path: "video", step: "incomplete", text: "waves", runId: "r" };
  const r = F.retry(i);
  assert.equal(r.step, "working");
  assert.equal(r.text, "waves");
  assert.equal(F.retry({ ...i, step: "style" }).step, "style");
});

test("back: every step has a way back, home is the end", () => {
  const base = { ...F.initial(), path: "campaign", style: { id: "a", title: "A", style: "a" }, text: "shop", runId: "r" };
  assert.deepEqual(F.back({ ...base, step: "style" }), F.initial());
  const tell = F.back({ ...base, step: "tell" });
  assert.equal(tell.step, "style");
  assert.equal(tell.style, null);
  for (const st of ["working", "done", "incomplete"]) {
    const b = F.back({ ...base, step: st });
    assert.equal(b.step, "tell");
    assert.equal(b.runId, "");
    assert.equal(b.text, "shop", "the words are kept");
  }
  assert.equal(F.back(F.initial()).step, "home");
  assert.equal(F.reset().step, "home");
});

test("transitions never change the old state", () => {
  const a = F.start(F.initial(), "image");
  const frozen = JSON.stringify(a);
  F.pickStyle(a, "x"); F.setText(a, "hello there"); F.addPhoto(a, { name: "a" }); F.back(a);
  assert.equal(JSON.stringify(a), frozen);
});

test("finish label per path", () => {
  // 0.4.28: five file paths were added after the first five (test/mac-paths-0428.test.js covers them)
  assert.deepEqual(F.PATHS.map(F.finishLabel), ["Publish site", "Download image", "Download video", "Post campaign", "Download mod", "Open spreadsheet", "Open document", "Open slides", "Open file", "Open list"]);
  assert.equal(F.finishLabel("zzz"), "Finish");
});

test("buildPrompt: one prompt per path, picture and video still read as picture and video", () => {
  const st = { style: "a realistic photograph" };
  const img = F.buildPrompt("image", st, "A woman on a beach.");
  assert.equal(img, "Make an image of A woman on a beach, in the style of a realistic photograph");
  assert.equal(makeIntent(img).kind, "image");
  const vid = F.buildPrompt("video", { style: "calm" }, "waves rolling in");
  assert.equal(vid, "Make a 5 second video of waves rolling in, calm");
  assert.equal(makeIntent(vid).kind, "video");
  assert.equal(makeIntent(vid).seconds, 5);
  assert.match(F.buildPrompt("website", { style: "clean" }, "my bakery in Austin"), /^Build a website for my bakery in Austin\. Style: clean\. .*HTML/);
  assert.match(F.buildPrompt("campaign", { style: "friendly" }, "my flower shop"), /^Plan a marketing campaign for my flower shop\. Style: friendly\. .*week/);
  assert.match(F.buildPrompt("mod", { style: "a harder game" }, "bigger zombies"), /^Make a game mod: bigger zombies\. Style: a harder game$/);
  assert.equal(F.buildPrompt("image", null, "a cat"), "Make an image of a cat");
  assert.equal(F.buildPrompt("image", "a plain string", "a cat"), "Make an image of a cat, in the style of a plain string");
  assert.equal(F.buildPrompt("other", null, "  hi   there "), "hi there");
  for (const p of F.PATHS) assert.equal(/[–—]/.test(F.buildPrompt(p, { style: "x" }, "y")), false);
});

test("skipsProjectStart: only the text paths", () => {
  // 0.4.28: the file paths skip the project questions too
  assert.deepEqual(F.PATHS.filter(F.skipsProjectStart), ["website", "campaign", "mod", "spreadsheet", "document", "slides", "script", "data"]);
});

test("costLine: Free, about price, or empty", () => {
  assert.equal(F.costLine(0), "Free");
  assert.equal(F.costLine(0.004), "About $0.01 or less");
  assert.equal(F.costLine(0.042), "About $0.04");
  assert.equal(F.costLine("Auto team, about $0.04"), "About $0.04");
  assert.equal(F.costLine("Auto team, about $0.01 or less"), "About $0.01 or less");
  assert.equal(F.costLine("Free: Groq"), "Free");
  assert.equal(F.costLine("Auto team"), "");
  assert.equal(F.costLine(""), "");
});

test("styles: cards data wins, the built-in three are the fallback, one is popular", () => {
  for (const p of F.PATHS) {
    const l = F.stylesFor(p, null);
    assert.equal(l.length, 3, p);
    assert.equal(l.filter((s) => s.popular).length, 1, p);
    assert.equal(F.popularStyle(p, null).id, l[0].id);
  }
  const custom = F.stylesFor("image", [{ title: "Neon" }, { id: "b", title: "Mist", popular: true }]);
  assert.equal(custom.length, 2);
  assert.equal(F.popularStyle("image", [{ title: "Neon" }, { id: "b", title: "Mist", popular: true }]).id, "b");
  assert.equal(custom[0].style, "Neon");
  assert.equal(F.popularStyle("image", [{ title: "Neon" }]).id, "Neon", "first is popular when none is marked");
});

test("bars: three bars that only grow", () => {
  assert.deepEqual(F.bars(0).map((b) => b.pct), [0, 0, 0]);
  assert.deepEqual(F.bars(1).map((b) => b.pct), [100, 100, 100]);
  const mid = F.bars(0.5).map((b) => b.pct);
  assert.equal(mid[0], 100);
  assert.ok(mid[1] > 0 && mid[1] < 100);
  assert.equal(F.bars(9).length, 3);
  assert.equal(F.bars(NaN)[0].pct, 0);
});

test("runState and crumbs and titles", () => {
  assert.equal(F.runState(null), "none");
  assert.equal(F.runState({ id: "a", status: "running" }), "busy");
  assert.equal(F.runState({ id: "a", status: "done" }), "done");
  assert.equal(F.runState({ id: "a", status: "done-with-errors" }), "incomplete");
  assert.equal(F.runState({ id: "a", status: "done", mission: { incomplete: { reasons: ["x"] } } }), "incomplete");
  assert.equal(F.runState({ id: "a", status: "done", mission: { tasks: [{ status: "failed" }] } }), "incomplete");
  assert.equal(F.crumb(F.initial()), "");
  assert.equal(F.crumb({ ...F.initial(), path: "website", step: "tell" }), "Website · step 2");
  assert.equal(F.stepTitle(F.initial()), "What do you want to make?");
  assert.equal(F.stepTitle({ ...F.initial(), path: "image", step: "style" }), "Pick a style for your image");
  assert.equal(F.stepTitle({ ...F.initial(), step: "incomplete" }), "Not quite finished");
  for (const k of ["home", "style", "tell", "working", "done", "incomplete"]) assert.equal(/[–—]/.test(F.stepTitle({ ...F.initial(), path: "image", step: k })), false);
  assert.equal(F.active(F.initial()), false);
});

// ---------- real browser: Simple, Mac on, practice AIs ----------
async function macDemo(opts = {}) {
  const t = await bootMac({ mode: "simple", width: 1366, height: 900, ...opts });
  assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
  await t.page.reload({ waitUntil: "domcontentloaded" });
  await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,.cc-tour-invite{display:none!important}" });
  await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go && window.CC.mac && window.CC.mac.flow && window.CC.featuresReady === true, null, { timeout: WAIT });
  await t.page.waitForSelector("#mac-flow .mf[data-step=home]", { timeout: WAIT });
  await t.page.waitForFunction(() => window.CC.makeChat && window.CC.makeChat.handle && window.CC.layout && document.getElementById("orders"), null, { timeout: WAIT });
  return t;
}
const visible = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => { const q = e.getBoundingClientRect(); const cs = getComputedStyle(e); return q.width > 0 && q.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; }).length, sel);
const step = (page) => page.evaluate(() => document.querySelector("#mac-flow .mf")?.dataset.step || "");
const waitStep = (page, s) => page.waitForSelector(`#mac-flow .mf[data-step=${s}]`, { timeout: WAIT });
const JARGON = /\b(API|JSON|token|mission|council|endpoint|provider|webhook|MCP|prompt|undefined|NaN|\[object)\b/i;

test("browser: Simple, image path: pick a style, tell us, make it, Done with ONE finish button", { skip }, async () => {
  const t = await macDemo();
  try {
    const home = await t.page.evaluate(() => ({ title: document.querySelector("#mf-title").textContent, paths: [...document.querySelectorAll(".mf-path")].map((b) => b.dataset.path), shown: !document.getElementById("mac-flow").hidden }));
    assert.equal(home.title, "What do you want to make?");
    assert.deepEqual(home.paths, ["website", "image", "video", "campaign", "mod", "spreadsheet", "document", "slides", "script", "data"]);
    assert.equal(home.shown, true);
    assert.ok(await visible(t.page, "#mf-ask") === 1, "the box is on Home");
    await t.page.waitForFunction(() => document.querySelectorAll(".mf-chip").length >= 3, null, { timeout: WAIT });
    // 1 pick a style: the popular one is already picked
    await t.page.click('.mf-path[data-path="image"]');
    await waitStep(t.page, "style");
    // With the cards part merged the carousel is the cards part's (.card / .badge); alone, the flow's own fallback cards.
    await t.page.waitForSelector(".mf-card.sel, [data-style-id].sel, #mf-cardhost .card.sel", { timeout: WAIT });
    const sel = await t.page.evaluate(() => ({ n: document.querySelectorAll("[data-style-id], #mf-cardhost .card").length, pop: (document.querySelector(".mf-card.sel .mf-pop, #mf-cardhost .card.sel .badge")?.textContent || "").trim() }));
    assert.ok(sel.n >= 3);
    assert.equal(sel.pop, "Most popular");
    await t.page.click("#mf-next");
    // 2 tell us about it
    await waitStep(t.page, "tell");
    assert.equal(await t.page.evaluate(() => document.querySelector("#mf-make").disabled), true, "Make it waits for a sentence");
    await t.page.fill("#mf-text", "a woman on a beach at sunset");
    await t.page.waitForFunction(() => !document.querySelector("#mf-make").disabled, null, { timeout: WAIT });
    await t.page.waitForFunction(() => /^(Free|About \$)/.test(document.querySelector("#mac-flow .mf-cost")?.textContent || ""), null, { timeout: WAIT });
    await t.page.click("#mf-make");
    await waitStep(t.page, "working");
    assert.equal(await visible(t.page, ".mf-bar"), 3, "three progress bars");
    // 3 done
    await waitStep(t.page, "done");
    await t.page.waitForSelector("#mf-result img.mk-img", { timeout: WAIT });
    const r = await t.page.evaluate(() => {
      const f = document.querySelector("#mac-flow");
      const vis = (e) => { const q = e.getBoundingClientRect(); const cs = getComputedStyle(e); return q.width > 0 && q.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
      const img = document.querySelector("#mf-result img.mk-img");
      const sent = document.getElementById("orders")?.value;
      return {
        finish: [...f.querySelectorAll("button")].filter(vis).filter((b) => /^(Download image|Publish|Post|Download)/.test(b.textContent.trim())).map((b) => b.textContent.trim()),
        w: img.naturalWidth, imgBox: img.getBoundingClientRect().width, text: f.innerText, sent,
        dupAnswer: document.querySelectorAll("#simple-answer").length, more: !!f.querySelector("#mf-more"),
      };
    });
    assert.deepEqual(r.finish, ["Download image"], "ONE finish button");
    assert.ok(r.w > 0 && r.imgBox >= 200, `a big finished picture (${r.imgBox}px)`);
    assert.equal(r.dupAnswer, 1);
    assert.equal(r.more, true);
    assert.doesNotMatch(r.text, JARGON);
    assert.equal(/[–—]/.test(r.text), false, "no dashes on screen");
    // the one button really finishes: it downloads
    const dl = t.page.waitForEvent("download", { timeout: WAIT });
    await t.page.click("#mf-finish");
    assert.match((await dl).suggestedFilename(), /\.(png|svg|jpe?g|webp)$/i);
    // More ways opens the full finish drawer
    await t.page.click("#mf-more");
    await t.page.waitForSelector(".fd", { timeout: WAIT });
    await t.page.keyboard.press("Escape");
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("browser: back, Escape, quick picks, Just chat instead, the way back in", { skip }, async () => {
  const t = await macDemo();
  try {
    await t.page.click('.mf-path[data-path="video"]');
    await waitStep(t.page, "style");
    await t.page.click("#mf-next");
    await waitStep(t.page, "tell");
    await t.page.fill("#mf-text", "waves rolling in");
    await t.page.click("#mf-back");
    await waitStep(t.page, "style");
    await t.page.click("#mf-next");
    await waitStep(t.page, "tell");
    assert.equal(await t.page.inputValue("#mf-text"), "waves rolling in", "the words are kept");
    await t.page.keyboard.press("Escape");
    await waitStep(t.page, "style");
    await t.page.keyboard.press("Escape");
    await waitStep(t.page, "home");
    // a quick pick starts a path with the sentence filled in
    await t.page.waitForSelector(".mf-chip", { timeout: WAIT });
    await t.page.click('.mf-chip[data-idea="website"]');
    await waitStep(t.page, "tell");
    assert.match(await t.page.inputValue("#mf-text"), /bakery/i);
    // typing a sentence on Home picks the path
    await t.page.keyboard.press("Escape"); await t.page.keyboard.press("Escape");
    await waitStep(t.page, "home");
    await t.page.fill("#mf-ask", "gibberish");
    await t.page.click("#mf-next");
    await t.page.waitForSelector(".mf-note", { timeout: WAIT });
    assert.equal(await step(t.page), "home", "no guess, no move");
    await t.page.fill("#mf-ask", "a 5 second video of waves");
    await t.page.click("#mf-next");
    await waitStep(t.page, "style");
    assert.equal(await t.page.evaluate(() => window.CC.mac.flow.state.path), "video");
    // the dock can start a path
    await t.page.evaluate(() => window.CC.mac.bus.emit("flow", { path: "campaign", step: "style" }));
    await t.page.waitForFunction(() => window.CC.mac.flow.state.path === "campaign", null, { timeout: WAIT });
    // Just chat instead: the normal Simple chat page shows, with a way back
    await t.page.click("#mf-chat");
    await t.page.waitForFunction(() => document.body.dataset.macFlow === "off", null, { timeout: WAIT });
    assert.equal(await visible(t.page, "#orders"), 1, "the chat box is reachable");
    assert.equal(await visible(t.page, ".mf"), 0);
    await t.page.click("#mf-return");
    await t.page.waitForFunction(() => document.body.dataset.macFlow === "on", null, { timeout: WAIT });
    assert.equal(await visible(t.page, ".mf"), 1);
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("browser: Expert never shows the flow, Simple again does", { skip }, async () => {
  const t = await macDemo();
  try {
    assert.equal(await visible(t.page, "#mac-flow .mf"), 1);
    await t.api("/settings", { body: { uiMode: "expert", uiModeChosen: true } });
    await t.page.evaluate(() => (document.getElementById("mode-expert") || document.querySelector("[data-mode=expert]"))?.click());
    await t.page.waitForFunction(() => (window.CC.uiMode?.() || window.CC.S.uiMode) === "expert", null, { timeout: WAIT });
    await t.page.waitForFunction(() => document.getElementById("mac-flow").hidden === true, null, { timeout: WAIT });
    assert.equal(await visible(t.page, "#mac-flow .mf"), 0);
    assert.equal(await visible(t.page, "#orders"), 1, "Expert keeps the normal Command screen");
    await t.page.evaluate(() => (document.getElementById("mode-simple") || document.querySelector("[data-mode=simple]"))?.click());
    await t.page.waitForFunction(() => document.getElementById("mac-flow").hidden === false, null, { timeout: WAIT });
  } finally { await t.close(); }
});

test("browser: website path ends with Publish site and the page in the result", { skip }, async () => {
  const t = await macDemo();
  try {
    await t.page.click('.mf-path[data-path="website"]');
    await waitStep(t.page, "style");
    await t.page.click("#mf-next");
    await waitStep(t.page, "tell");
    await t.page.fill("#mf-text", "my bakery in Austin");
    await t.page.click("#mf-make");
    await waitStep(t.page, "working");
    await t.page.waitForSelector('#mac-flow .mf[data-step=done], #mac-flow .mf[data-step=incomplete]', { timeout: WAIT });
    const r = await t.page.evaluate(() => ({ step: document.querySelector("#mac-flow .mf").dataset.step, label: document.querySelector("#mf-finish, #mf-retry")?.textContent.trim(), answer: document.querySelectorAll("#simple-answer").length, project: window.CC.S.view }));
    assert.equal(r.answer, 1);
    assert.equal(r.project, "command", "the website went through chat, not the Start a project screen");
    if (r.step === "done") assert.equal(r.label, "Publish site");
    else assert.equal(r.label, "Retry");
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});

test("browser: an Incomplete run shows the Incomplete badge and Retry, and Retry presses the existing retry button", { skip }, async () => {
  const t = await macDemo();
  try {
    await t.page.click('.mf-path[data-path="website"]');
    await waitStep(t.page, "style");
    await t.page.click("#mf-next");
    await waitStep(t.page, "tell");
    await t.page.fill("#mf-text", "my flower shop");
    // Force the engine's answer: the Send click is replaced by a run that ended Incomplete (the engine's own word for it).
    await t.page.evaluate(() => {
      window.__retried = 0;
      document.getElementById("go").addEventListener("click", (e) => {
        e.stopImmediatePropagation();
        const a = document.getElementById("simple-answer");
        a.hidden = false;
        a.insertAdjacentHTML("beforeend", `<div class="rc"><div class="rc-incomplete" role="alert"><b>Incomplete.</b> Part of this job did not work.</div><button type="button" data-rc-retry>Try again on another AI</button></div>`);
        a.querySelector("[data-rc-retry]").addEventListener("click", () => { window.__retried++; window.CC.S.live = { ...window.CC.S.live, status: "running" }; });
        window.CC.S.live = { id: "forced-1", kind: "mission", status: "done-with-errors", agents: {}, tasks: {}, mission: { id: "forced-1", incomplete: { reasons: [{ title: "Build the page", reason: "It failed." }] }, tasks: [{ id: "t1", status: "failed" }] }, deliverable: "" };
      }, true);
    });
    await t.page.click("#mf-make");
    await waitStep(t.page, "incomplete");
    const r = await t.page.evaluate(() => {
      const f = document.querySelector("#mac-flow");
      const vis = (e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).display !== "none"; };
      return { retry: !!f.querySelector("#mf-retry") && vis(f.querySelector("#mf-retry")), badge: f.querySelector(".mf-badge")?.textContent || "", finish: !!f.querySelector("#mf-finish"), title: f.querySelector("#mf-title").textContent };
    });
    assert.equal(r.retry, true);
    assert.match(r.badge, /^Incomplete\./);
    assert.equal(r.finish, false, "no finish button on an Incomplete run");
    assert.equal(r.title, "Not quite finished");
    await t.page.click("#mf-retry");
    await waitStep(t.page, "working");
    assert.equal(await t.page.evaluate(() => window.__retried), 1);
    assert.equal(t.errors.length, 0, t.errors.join("\n"));
  } finally { await t.close(); }
});
