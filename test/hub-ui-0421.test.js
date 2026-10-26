// Hub screen (0.4.21): smart views, Trash with Restore, pending tiles, public link box, #mindmedia links (F27).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { parseMindMediaHash } from "../web/mm-hash.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("#mindmedia links are read", () => {
  assert.deepEqual(parseMindMediaHash("#mindmedia"), { projectId: "", assetId: "", view: "" });
  assert.deepEqual(parseMindMediaHash("#mindmedia/alpha/job:img-1:0"), { projectId: "alpha", assetId: "job:img-1:0", view: "" });
  assert.deepEqual(parseMindMediaHash("#mindmedia?view=needs-ending"), { projectId: "", assetId: "", view: "needs-ending" });
  assert.deepEqual(parseMindMediaHash("#mindmedia/my%20proj/abc"), { projectId: "my proj", assetId: "abc", view: "" });
  assert.equal(parseMindMediaHash("#teamjoin=abc"), null);
  assert.equal(parseMindMediaHash(""), null);
});

test("source: the hub shows smart views, Trash with Restore, working tiles and a public link box", () => {
  const t = read("web", "features", "mindmedia.js");
  for (const w of ["Smart views", "data-v=", "data-restore", "/mindmedia/restore", "Working on it", "mmh-pend", "/mindmedia/host", "Public link", "A piece you were waiting for is ready.", 'p.set("view", ui.view)']) assert.ok(t.includes(w), w);
  assert.equal(t.includes("—") || t.includes("–"), false);
  assert.match(read("web", "features", "mindmedia-save.js"), /hashchange/);
});

import { bootPage, findBrowser } from "./pw-helpers.js";
import { waitBudget } from "./helpers.js";

test("hub in a real browser: smart views, Trash and Restore, a #mindmedia link, no page errors", { skip: findBrowser() ? false : "no Chrome installed", timeout: waitBudget(90000) }, async () => {
  const t = await bootPage({ width: 1366, height: 800, mode: "simple" });
  try {
    const a = await t.api("/mindmedia/save", { body: { kind: "text", text: "Alpha words for the hub", name: "Alpha note", status: "Review" } });
    const b = await t.api("/mindmedia/save", { body: { kind: "text", text: "Beta words for the hub", name: "Beta note" } });
    assert.equal(a.status, 200);
    await t.api("/mindmedia/delete", { body: { items: [{ projectId: b.json.projectId, assetId: b.json.items[0].id }] } });
    await t.page.evaluate(() => { location.hash = "#mindmedia"; });
    await t.page.waitForSelector(".mmh-rail", { timeout: waitBudget(30000) });
    const rail = await t.page.textContent(".mmh-rail");
    assert.match(rail, /Smart views/);
    assert.match(rail, /Needs my OK/);
    await t.page.click('.mmh-rail [data-v="trash"]');
    await t.page.waitForSelector("[data-restore]", { timeout: waitBudget(30000) });
    assert.match(await t.page.textContent(".mmh-main"), /Beta note/);
    await t.page.click("[data-restore]");
    await t.page.waitForFunction(() => !document.querySelector("[data-restore]"), null, { timeout: waitBudget(30000) });
    const list = (await t.api("/mindmedia")).json;
    assert.ok(list.items.some((i) => i.name === "Beta note"), "restored item is back");
    await t.page.evaluate(() => { location.hash = "#mindmedia?view=needs-ok"; });
    await t.page.waitForFunction(() => /Alpha note/.test(document.querySelector(".mmh-main")?.textContent || ""), null, { timeout: waitBudget(30000) });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("source: Builders has a Connect HighLevel button that falls back to the paste form", () => {
  const t = read("web", "features", "builders.js");
  assert.match(t, /id="builders-hl-connect"/);
  assert.match(t, /\/publish\/connect\/ghlcrm\/start/);
  assert.match(t, /paste a HighLevel token below instead/);
});
