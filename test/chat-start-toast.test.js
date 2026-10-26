// N2: asking chat for a website starts a project with a green toast, no red "Cannot set properties of null", and the draft leaves the box.
// Also the look offer must never sit over the middle of the page. Real browser; skips only when no Chrome is installed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";

const read = (...p) => fs.readFileSync(path.join(import.meta.dirname, "..", ...p), "utf8").replace(/\r\n/g, "\n");

test("source: chat clears the box before the Start screen replaces it", () => {
  const app = read("web", "app.js");
  const i = app.indexOf("const draftBox = $(\"#orders\")");
  const j = app.indexOf("startProject.startFromChat(kind, prompt)");
  assert.ok(i > 0 && j > i, "box is cleared before startFromChat runs");
  assert.doesNotMatch(app.slice(j, j + 200), /\$\("#orders"\)\.value = ""/);
});

test("source: look offer is a quiet corner line that removes itself", () => {
  const css = read("web", "look.css");
  const line = css.split("\n").find((l) => l.startsWith("#cc-look-offer {"));
  assert.ok(line);
  assert.match(line, /left:\s*16px/);
  assert.doesNotMatch(line, /translateX\(-50%\)/);
  assert.match(read("web", "features", "look.js"), /setTimeout\(\(\) => \{ try \{ bar\.remove\(\)/);
});

test("chat starts a project: success toast, no red error, box empty", { skip: findBrowser() ? false : "no Chrome installed" }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple" });
  try {
    await goChat(t.page);
    await t.page.fill("#orders", "Make me a one-page website for my dog-walking business");
    await t.page.click("#go");
    await t.page.waitForFunction(() => /Started a project/.test(document.body.innerText), null, { timeout: 15000 });
    const r = await t.page.evaluate(() => ({ red: [...document.querySelectorAll(".toast.err,.toast.bad,.toast.error")].map((e) => e.textContent), text: document.body.innerText, box: document.querySelector("#orders")?.value ?? "" }));
    assert.doesNotMatch(r.text, /Cannot set properties of null/);
    assert.deepEqual(r.red, []);
    assert.equal(r.box, "");
    assert.deepEqual(t.errors.filter((e) => /null/.test(e)), []);
  } finally { await t.close(); }
});

test("look offer does not cover the centre of the page", { skip: findBrowser() ? false : "no Chrome installed" }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple", hidePopups: false });
  try {
    await t.page.evaluate(() => {
      const bar = document.createElement("div"); bar.id = "cc-look-offer";
      bar.innerHTML = '<span>Try the new look?</span><button class="btn">Yes</button>';
      document.body.appendChild(bar);
    });
    const q = await t.page.evaluate(() => { const r = document.querySelector("#cc-look-offer").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, w: innerWidth, h: innerHeight }; });
    assert.ok(q.r < q.w / 2, `offer stays in the left corner: ${JSON.stringify(q)}`);
    assert.ok(q.t > q.h / 2, "offer is in the lower half");
  } finally { await t.close(); }
});
