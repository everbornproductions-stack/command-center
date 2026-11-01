// 0.4.31 (Chris: "in project view it shouldn't have the whole description unless you click on it to expand"): a project
// card shows one line of its description; More opens the rest in place without opening the project.
import test from "node:test";
import assert from "node:assert/strict";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const LONG = "A full rebrand for the bakery: new logo, menu boards, a website with online orders, a week of posts, and a short video for the opening on Saturday morning.";

test("project cards fold a long description to one line; More opens it in place; a short one has no More", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple" });
  try {
    await t.page.waitForFunction(() => (window.CC.S.projects || []).length > 0, null, { timeout: 20000 });
    await t.page.evaluate((long) => { const ps = window.CC.S.projects; ps[0].summary = long; ps.push({ ...ps[0], id: ps[0].id + "-b", name: "Short one", summary: "Taxes.", categories: [] }); window.CC.go("projects"); }, LONG);
    await t.page.waitForSelector(".pcard-sum", { timeout: 15000 });
    await t.page.waitForFunction(() => document.querySelectorAll("[data-psum]").length >= 2, null, { timeout: 15000 });
    await t.page.waitForFunction(() => [...document.querySelectorAll("[data-psum]")].some((b) => b.hidden), null, { timeout: 5000 });
    const before = await t.page.evaluate(() => {
      const [a, b] = [...document.querySelectorAll(".pcard-sum")];
      const [ma, mb] = [...document.querySelectorAll("[data-psum]")];
      return { hA: a.getBoundingClientRect().height, moreA: !ma.hidden && ma.getBoundingClientRect().height > 0, moreB: !mb.hidden };
    });
    assert.ok(before.hA < 26, `one line: ${before.hA}px`);
    assert.equal(before.moreA, true, "a long description has More");
    assert.equal(before.moreB, false, "a short one has no More");
    await t.page.click("[data-psum]:not([hidden])");
    const after = await t.page.evaluate(() => {
      const a = document.querySelector(".pcard-sum"); const m = document.querySelector("[data-psum]");
      return { h: a.getBoundingClientRect().height, label: m.textContent, exp: m.getAttribute("aria-expanded"), opened: window.CC.S.openProject || null };
    });
    assert.ok(after.h > before.hA + 10, "the whole description shows");
    assert.equal(after.label, "Less"); assert.equal(after.exp, "true");
    assert.equal(after.opened, null, "More does not open the project");
  } finally { await t.close(); }
});
