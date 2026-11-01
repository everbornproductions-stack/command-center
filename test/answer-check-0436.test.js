// 0.4.36 (panel 0434 items 2 and 3): the answer check showed nowhere: it was folded into the closed "More actions", and Light
// mode skipped it. It now sits right under the answer, above Copy, in every mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { planActions, ABOVE } from "../web/answer-actions.js";
import { findBrowser, bootPage } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const ROOT = path.join(import.meta.dirname, "..");

test("the answer check is never planned under More actions", () => {
  assert.ok(ABOVE.has("answer-check"));
  const plan = planActions(["answer-check", "share", "next-actions", "desk"]);
  assert.deepEqual(plan.more, ["share"]);
});

test("Light mode still draws the answer check (and only it) under an answer", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const fn = app.slice(app.indexOf("function renderExtras("), app.indexOf("function renderExtras(") + 900);
  assert.match(fn, /if \(light && kind === "command"\) return;/);
  assert.match(fn, /if \(light && f\.id !== "answer-check"\) continue;/);
});

test("browser: the answer check shows above Copy with More actions closed", { skip }, async () => {
  const t = await bootPage({});
  try {
    const r = await t.page.evaluate(async () => {
      const { arrangeAnswerActions } = await import("/answer-actions.js");
      const box = document.createElement("div");
      box.innerHTML = `<div data-feature="share"><button>Share</button></div>`
        + `<div data-feature="answer-check"><div class="cc-answer-check">Check this wording: "perfect for young families" can break fair housing rules.</div></div>`
        + `<div data-feature="next-actions"><button>Make another</button></div>`;
      document.body.appendChild(box);
      arrangeAnswerActions(box, { open: false });
      const chk = box.querySelector(".cc-answer-check");
      const copy = box.querySelector("#cc-copy-main");
      const more = box.querySelector("details.answer-more");
      const out = {
        text: chk.innerText.trim(),
        above: !!(chk.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING),
        inMore: !!chk.closest("details.answer-more"),
        moreOpen: more.open,
        shareInMore: !!more.querySelector("[data-feature='share']"),
      };
      box.remove();
      return out;
    });
    assert.match(r.text, /young families/);
    assert.equal(r.above, true, "above Copy");
    assert.equal(r.inMore, false, "not folded away");
    assert.equal(r.moreOpen, false);
    assert.equal(r.shareInMore, true, "the other actions still go under More");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

// ---------- item 3: the Mac card rule no longer squeezes the Get free AIs card ----------

test("browser: Mac look at 1366 x 768, Get free AIs opens full size at its top with the title in view", { skip }, async () => {
  const t = await bootMac({ mode: "expert", width: 1366, height: 768 });
  try {
    const p = t.page;
    await p.evaluate(() => window.CC.freeAis.open());
    await p.waitForSelector("#cc-free-ais #cc-free-ais-title", { timeout: 20000 });
    await p.waitForFunction(() => document.activeElement?.id === "cc-free-ais-title", null, { timeout: 20000 });
    const r = await p.evaluate(() => {
      const card = document.querySelector("#cc-free-ais .card").getBoundingClientRect();
      const title = document.getElementById("cc-free-ais-title").getBoundingClientRect();
      return { w: card.width, h: card.height, scroll: document.querySelector("#cc-free-ais .card").scrollTop, titleTop: title.top, titleBottom: title.bottom, cardTop: card.top };
    });
    assert.ok(r.w >= 600, `card width ${r.w}`);
    assert.ok(r.h > 400, `card height ${r.h}, not the 260 px carousel tile`);
    assert.equal(r.scroll, 0, "opens at its top");
    assert.ok(r.titleTop >= r.cardTop && r.titleBottom <= 768, `title in view ${JSON.stringify(r)}`);
    // the style carousel keeps its tiles
    const css = fs.readFileSync(path.join(ROOT, "web", "mac", "css", "cards.css"), "utf8");
    assert.doesNotMatch(css, /body\[data-style="mac"\] \.card\b/, "no bare Mac .card rule");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
