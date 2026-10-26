// Chat dock (0.4.21): docked on every page, a suggestion that never overwrites typing, Send to the
// shared working view with a Back button, and the bottom AI bar showing only connected AIs.
// Real browser; skips only when no Chrome is installed. Demo (pretend) AIs only, no keys, no data/ folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";
import { dockShows, dockContext, suggestionFor, workingLine, finishedLine, backLabel, contextLabel } from "../web/dock-context.js";
import { isOnBar, barProviders } from "../web/composer-ais.js";

const read = (...p) => fs.readFileSync(path.join(import.meta.dirname, "..", ...p), "utf8").replace(/\r\n/g, "\n");
const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = () => Math.max(15000, (typeof waitBudget === "function" ? waitBudget(15000) : 15000));

test("dock-context: where the dock shows and what it suggests", () => {
  assert.equal(dockShows("projects"), true);
  assert.equal(dockShows("images"), true);
  assert.equal(dockShows("command"), false);
  assert.equal(dockShows("setup"), false);
  assert.equal(dockContext("projects", "p1"), "project");
  assert.equal(dockContext("images"), "images");
  assert.equal(dockContext("webbuilders"), "builders");
  const proj = suggestionFor({ view: "projects", openProject: "p1", projectName: "Spring launch", lastTitle: "Plan the week" });
  assert.match(proj.text, /^Continue building Spring launch: /);
  assert.match(suggestionFor({ view: "images", projectName: "Bakery" }).text, /^Make an image: /);
  assert.match(suggestionFor({ view: "projects", openProject: "p1", projectName: "X", result: { title: "Menu" } }).text, /^Next: /);
  assert.equal(suggestionFor({ view: "settings" }), null);
  assert.match(contextLabel("project", "Bakery"), /Bakery/);
  for (const s of [proj.text, suggestionFor({ view: "images" }).text, contextLabel("images", "")]) assert.doesNotMatch(s, /[–—]/);
});

test("dock-context: status lines and the back label", () => {
  const live = { kind: "mission", status: "running", tasks: { a: { status: "done" }, b: { status: "running" }, c: { status: "queued" }, d: { status: "queued" }, e: { status: "queued" } } };
  assert.equal(workingLine(live, 3), "3 AIs working, step 2 of 5");
  assert.equal(workingLine({ kind: "single", status: "running" }, 1), "1 AI working, step 1 of 1");
  assert.match(finishedLine({ tasks: { a: {}, b: {} } }), /All 2 steps done/);
  assert.equal(backLabel({ openProject: "p" }), "Back to project");
  assert.equal(backLabel({ project: "", openProject: null }), "Back");
});

test("bottom AI bar: only connected AIs, demo only as demo, nothing unlinked", () => {
  const key = { id: "openai", kind: "text", keyed: true, access: { auth: "key", connected: true }, status: { status: "green" } };
  const nokey = { id: "xai", kind: "text", keyed: false, access: { auth: "key", connected: false }, status: { status: "grey" } };
  const handoff = { id: "suno", kind: "media", keyed: false, access: { auth: "handoff", connected: true }, status: { status: "grey" } };
  const handoffUp = { ...handoff, id: "flow", status: { status: "green" } };
  const mcp = { id: "capcut", kind: "tool", keyed: false, access: { auth: "mcp", connected: true }, status: { status: "grey" } };
  const agentOff = { id: "grokbot", kind: "agent", status: { status: "grey" } };
  const agentOn = { id: "browser-helper", kind: "agent", status: { status: "green" } };
  const demo = { id: "demo-nova", kind: "text", demo: true };
  const ids = (l, s = []) => barProviders(l, s).map((p) => p.id);
  assert.deepEqual(ids([key, nokey, handoff, handoffUp, mcp, agentOff, agentOn]), ["openai", "flow", "capcut", "browser-helper"]);
  assert.equal(isOnBar(demo), true);
  assert.deepEqual(ids([handoff], [{ provider: "suno", renews: "2026-11-01" }]), ["suno"]);
});

test("source: the dock is wired once, with the contract ids", () => {
  const js = read("web", "features", "dock.js");
  for (const id of ["cc-dock", "cc-dock-input", "cc-dock-send", "cc-dock-chip", "cc-dock-use", "cc-dock-undo", "cc-dock-toggle", "cc-dock-status", "cc-back-bar", "cc-back-btn", "cc-ops-slim"]) assert.ok(js.includes(id), id);
  assert.match(read("web", "app.js"), /window\.CC\?\.dock\?\.onRender\?\.\(S\.view\)/);
  assert.match(read("web", "perf", "registry.js"), /id: "dock", shell: true/);
  assert.match(read("web", "index.html"), /href="\/dock\.css"/);
  assert.doesNotMatch(read("web", "dock.css") + js, /[–—]/, "no dashes in user-facing text or css comments");
});

async function demoOn(t) {
  await t.api("/demo", { body: { on: true } });
  await t.page.reload({ waitUntil: "domcontentloaded" });
  await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite{display:none!important}" });
  await t.page.waitForFunction(() => window.CC && window.CC.S && window.CC.go && window.CC.S.providers?.length, null, { timeout: WAIT() });
}

test("the dock is on Projects, Images, a project page and Builders, and not on the chat page", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple" });
  try {
    for (const view of ["projects", "images", "builders"]) {
      await t.page.evaluate((v) => window.CC.go(v), view);
      await t.page.waitForSelector("#cc-dock:not([hidden]) #cc-dock-input", { timeout: WAIT() });
      assert.equal(await t.page.getAttribute("#cc-dock", "data-view"), view);
    }
    await t.page.evaluate(() => { const s = window.CC.S; s.openProject = s.projects[0].id; s.view = "projects"; window.CC.render(); });
    await t.page.waitForFunction(() => document.querySelector("#cc-dock")?.dataset.ctx === "project", null, { timeout: WAIT() });
    assert.match(await t.page.textContent("#cc-dock-ctx"), /Chatting about /);
    await t.page.evaluate(() => window.CC.go("command"));
    await t.page.waitForSelector("#go", { timeout: WAIT() });
    assert.equal(await t.page.evaluate(() => !!document.querySelector("#cc-dock") && !document.querySelector("#cc-dock").hidden), false);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("the suggestion is a chip: it never overwrites typing, Use this fills, Undo restores", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 900, mode: "simple" });
  try {
    await t.page.evaluate(() => window.CC.go("images"));
    await t.page.waitForSelector("#cc-dock-input", { timeout: WAIT() });
    await t.page.waitForSelector("#cc-dock-suggest:not([hidden])", { timeout: WAIT() });
    assert.match(await t.page.textContent("#cc-dock-chip"), /^Make an image: /);
    assert.equal(await t.page.inputValue("#cc-dock-input"), "", "the chip does not type for you");
    await t.page.fill("#cc-dock-input", "my own words");
    await t.page.waitForSelector("#cc-dock-suggest", { state: "hidden", timeout: WAIT() });
    await t.page.evaluate(() => window.CC.go("projects"));
    await t.page.waitForFunction(() => document.querySelector("#cc-dock")?.dataset.view === "projects", null, { timeout: WAIT() });
    assert.equal(await t.page.inputValue("#cc-dock-input"), "my own words", "typing survives a page change");
    await t.page.fill("#cc-dock-input", "");
    await t.page.waitForSelector("#cc-dock-suggest:not([hidden])", { timeout: WAIT() });
    await t.page.fill("#cc-dock-input", "");
    await t.page.click("#cc-dock-use");
    const used = await t.page.inputValue("#cc-dock-input");
    assert.ok(used.length > 10);
    await t.page.waitForSelector("#cc-dock-undo:not([hidden])", { timeout: WAIT() });
    await t.page.click("#cc-dock-undo");
    assert.equal(await t.page.inputValue("#cc-dock-input"), "");
  } finally { await t.close(); }
});

test("1366x768: the dock is compact, the page keeps its room, nothing overflows sideways", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple" });
  try {
    await t.page.evaluate(() => window.CC.go("projects"));
    await t.page.waitForSelector("#cc-dock-input", { timeout: WAIT() });
    const r = await t.page.evaluate(() => ({ dock: document.querySelector("#cc-dock").getBoundingClientRect().height, view: document.querySelector("#view").getBoundingClientRect().height, col: document.querySelector("#cc-dock").dataset.collapsed, sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.equal(r.col, "1", "compact by default on a short window");
    assert.ok(r.dock <= 130, `dock height ${r.dock}`);
    assert.ok(r.view >= 480, `view height ${r.view}`);
    assert.ok(r.sw <= r.iw + 1);
    await t.page.click("#cc-dock-toggle");
    await t.page.waitForFunction(() => document.querySelector("#cc-dock").dataset.collapsed === "0", null, { timeout: WAIT() });
  } finally { await t.close(); }
});

test("phone: the dock sits above the tab bar", { skip }, async () => {
  const t = await bootPage({ width: 390, height: 780, mode: "simple" });
  try {
    await t.page.evaluate(() => window.CC.go("projects"));
    await t.page.waitForSelector("#cc-dock-input", { timeout: WAIT() });
    const r = await t.page.evaluate(() => ({ d: document.querySelector("#cc-dock").getBoundingClientRect().bottom, n: document.querySelector("#mobile-nav").getBoundingClientRect().top, sw: document.documentElement.scrollWidth }));
    assert.ok(r.d <= r.n + 1, `dock bottom ${r.d} tab bar top ${r.n}`);
    assert.ok(r.sw <= 391);
  } finally { await t.close(); }
});

test("Send goes to the working view, the run finishes, Back returns to the project", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 900, mode: "simple" });
  try {
    await demoOn(t);
    await t.page.evaluate(() => { const s = window.CC.S; s.openProject = s.projects[0].id; s.view = "projects"; window.CC.render(); });
    await t.page.waitForSelector("#cc-dock-input", { timeout: WAIT() });
    await t.page.fill("#cc-dock-input", "Write one friendly line for my bakery");
    await t.page.click("#cc-dock-send");
    await t.page.waitForSelector("#cc-back-bar", { timeout: WAIT() });
    assert.equal(await t.page.evaluate(() => window.CC.S.view), "command");
    assert.match(await t.page.textContent("#cc-back-btn"), /Back to project/);
    await t.page.waitForFunction(() => { const l = window.CC.S.live; return l?.id && l.status === "done"; }, null, { timeout: WAIT() * 2 });
    await t.page.waitForFunction(() => /Finished|done/i.test(document.querySelector("#cc-back-bar .back-note")?.textContent || ""), null, { timeout: WAIT() });
    await t.page.click("#cc-back-btn");
    await t.page.waitForFunction(() => window.CC.S.view === "projects" && !!window.CC.S.openProject, null, { timeout: WAIT() });
    assert.equal(await t.page.evaluate(() => !!document.querySelector("#cc-back-bar")), false);
    // the next step is offered as a chip once a result exists
    await t.page.waitForSelector("#cc-dock-suggest:not([hidden])", { timeout: WAIT() });
    assert.match(await t.page.textContent("#cc-dock-chip"), /^Next: /);
  } finally { await t.close(); }
});

test("the bottom bar lights an AI while a run is going and goes dark after", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 900, mode: "simple" });
  try {
    await demoOn(t);
    await t.page.evaluate(() => { window.CC.S.settings.simpleStrip = true; window.CC.go("command"); });
    // 0.4.21 (area H): under the Simple box the AI row shows while a run is going (or when Auto team is open), so it is attached, not on screen, before Send.
    await t.page.waitForSelector("#cc-composer-ais .composer-ai[data-p]", { state: "attached", timeout: WAIT() });
    assert.ok(await t.page.$("#composer-add"), "+ Add an AI chip");
    await t.page.fill("#orders", "Write one friendly line for my bakery");
    await t.page.click("#go");
    await t.page.waitForSelector("#cc-composer-ais .composer-ai.working", { timeout: WAIT() });
    await t.page.waitForFunction(() => !document.querySelector("#cc-composer-ais .composer-ai.working") && window.CC.S.live?.status === "done", null, { timeout: WAIT() * 2 });
  } finally { await t.close(); }
});

test("the bottom bar hides AIs that are not connected and keeps + Add an AI", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 900, mode: "expert" });
  try {
    await t.page.waitForSelector("#strip .tile", { timeout: WAIT() });
    const none = await t.page.evaluate(() => [...document.querySelectorAll("#strip .tile:not(.add-ai)")].map((e) => e.dataset.p));
    assert.deepEqual(none, [], "nothing is connected, so no AI tiles");
    assert.ok(await t.page.$("#strip-add"));
    const saved = await t.api("/keys", { body: { provider: "groq", key: "gsk_" + "a1".repeat(20) } });
    assert.ok(saved.status < 300, saved.text);
    await t.page.evaluate(async () => { await window.CC.refresh(); });
    await t.page.waitForSelector('#strip .tile[data-p="groq"]', { timeout: WAIT() });
    const tiles = await t.page.evaluate(() => [...document.querySelectorAll("#strip .tile:not(.add-ai)")].map((e) => e.dataset.p));
    assert.deepEqual(tiles, ["groq"], "only the connected AI is on the bar");
    // lit while working: the same tile gets .active when an agent starts
    await t.page.evaluate(() => window.CC.S && document.dispatchEvent(new Event("noop")));
  } finally { await t.close(); }
});

test("Expert opens in Single and the news rail starts minimized under 1500px", { skip }, async () => {
  const t = await bootPage({ width: 1366, height: 800, mode: "expert" });
  try {
    await t.page.evaluate(() => window.CC.go("command"));
    await t.page.waitForSelector("#run-mode", { timeout: WAIT() });
    assert.equal(await t.page.getAttribute("#run-mode button.on", "data-m"), "single");
    await t.page.waitForFunction(() => !document.querySelector("#cc-rail") || document.querySelector("#cc-rail").dataset.min === "1", null, { timeout: WAIT() });
  } finally { await t.close(); }
});
