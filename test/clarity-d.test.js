// Area D clarity fixes (panel list): source pins for plain words, plus real-browser checks for the project
// picker, the Ctrl+Enter hint, the Expert switch on Settings, and the Settings section chips.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
import { matchScreensForQuery } from "../web/help-rank.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("plain words: setup toast, tour answer step, sample label, balance line, tooltips", () => {
  assert.match(read("web", "app.js"), /Setup complete\. You are in Chat\. Type below\.", false, null, 6000/);
  assert.match(read("web", "features", "tour.js"), /Send a question and your answer will show here/);
  assert.match(read("server", "demo-answers.js"), /PRACTICE_LABEL = "Sample answer: add a key for real answers"/);
  assert.match(read("web", "features", "desk.js"), /This AI does not tell Meldmind its balance/);
  const aa = read("web", "answer-actions.js");
  assert.match(aa, /Double-check[^\n]*tip:/);
  assert.match(aa, /Test with personas[^\n]*tip:/);
  assert.match(read("web", "app.js"), /You are in Expert\. Back to Simple any time\./);
});

test("Help: Search help panel comes first and Help says Chat, not Command", () => {
  const h = read("web", "features", "help.js");
  assert.ok(h.indexOf('id="help-list-panel"') < h.indexOf('id="help-context"'));
  const r = read("web", "help-rank.js");
  assert.doesNotMatch(r, /Command \(Chat\)|Command and Chat|Open Command/);
});

test("Help jump chips match whole words and cover connections and phone", () => {
  const labels = (q) => matchScreensForQuery(q).map((t) => t.label);
  assert.ok(!labels("gmail").includes("Images"));
  assert.ok(labels("gmail").some((l) => /Your apps/.test(l)));
  assert.ok(!labels("client safety").includes("Projects"));
  assert.ok(labels("phone").some((l) => /Phone companion/.test(l)));
});

const skip = findBrowser() ? false : "no Chrome installed";

test("Chat shows one project picker and the Ctrl+Enter hint", { skip }, async () => {
  const t = await bootPage({ mode: "simple" });
  try {
    await t.api("/projects", { body: { name: "Alpha" } });
    await t.page.evaluate(() => window.CC.go("command"));
    await goChat(t.page);
    await t.page.reload({ waitUntil: "load" });
    await t.page.addStyleTag({ content: "#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer{display:none!important}" });
    await goChat(t.page);
    const r = await t.page.evaluate(() => {
      const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
      return { pickers: vis("#proj, #pb-select").length, hint: document.querySelector("#send-hint")?.textContent || "" };
    });
    assert.ok(r.pickers <= 1, `visible project pickers: ${r.pickers}`);
    assert.match(r.hint, /Ctrl\+Enter/);
  } finally { await t.close(); }
});

test("Switching to Expert on Settings stays on Settings and says so", { skip }, async () => {
  const t = await bootPage({ mode: "simple" });
  try {
    await t.page.evaluate(() => window.CC.go("settings"));
    await t.page.waitForSelector("#mode-expert", { timeout: 10000 });
    await t.page.click("#mode-expert");
    await t.page.waitForFunction(() => /You are in Expert/.test(document.querySelector("#toasts")?.textContent || ""), null, { timeout: 8000 });
    const body = await t.page.evaluate(() => document.querySelector("#view")?.textContent || "");
    assert.doesNotMatch(body, /Expert setup \d of \d/);
  } finally { await t.close(); }
});

test("Settings section chips filter the long page and Show all brings it back", { skip }, async () => {
  const t = await bootPage({ mode: "expert" });
  try {
    await t.page.evaluate(() => { window.CC.S.settingsMore = true; window.CC.go("settings"); });
    await t.page.waitForSelector("#settings-groups-bar", { timeout: 10000 });
    const count = () => t.page.evaluate(() => [...document.querySelector("#settings-keys").parentElement.children].filter((e) => !e.hidden).length);
    const before = await count();
    await t.page.click('[data-settings-jump="#settings-group-privacy"]');
    const after = await count();
    assert.ok(after < before, `filtered ${before} -> ${after}`);
    await t.page.click("#settings-show-all");
    assert.equal(await count(), before);
  } finally { await t.close(); }
});
