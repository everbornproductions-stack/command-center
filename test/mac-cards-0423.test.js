import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { PATHS, pageOf, nextIndex, dotsFor, stylesFor, pathData } from "../web/mac/data/cards.js";

const skip = findBrowser() ? false : "no Chrome installed";
const ROOT = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("cards data: every path has popular style, 6+ styles, finish label, no dashes or jargon", () => {
  const jargonRegex = /\b(api|json|token|auth|oauth)\b/i;
  for (const [key, pathObj] of Object.entries(PATHS)) {
    assert.ok(pathObj.id, `${key} has id`);
    assert.ok(pathObj.title, `${key} has title`);
    assert.ok(pathObj.describePlaceholder, `${key} has describePlaceholder`);
    assert.ok(pathObj.finish, `${key} has finish`);
    assert.ok(Array.isArray(pathObj.styles), `${key} styles is array`);
    assert.ok(pathObj.styles.length >= 6, `${key} has at least 6 styles (${pathObj.styles.length})`);

    const populars = pathObj.styles.filter(s => s.popular);
    assert.equal(populars.length, 1, `${key} has exactly one popular style`);

    for (const s of pathObj.styles) {
      assert.ok(s.id, `style has id in ${key}`);
      assert.ok(s.name, `style has name in ${key}`);
      assert.ok(s.desc, `style has desc in ${key}`);
      assert.ok(s.gradient, `style has gradient in ${key}`);
      assert.ok(s.prompt, `style has prompt in ${key}`);

      // Check no dashes or jargon
      const text = s.name + " " + s.desc + " " + pathObj.title + " " + pathObj.describePlaceholder + " " + pathObj.finish;
      assert.equal(/[\u2013\u2014]/.test(text), false, `no en/em dashes in ${key}`);
      assert.equal(jargonRegex.test(text), false, `no jargon in ${key}: ${text}`);
    }
  }
});

test("cards pure logic: pageOf, nextIndex, dotsFor", () => {
  assert.equal(pageOf(0, 3), 0);
  assert.equal(pageOf(3, 3), 1);
  assert.equal(nextIndex(0, 1, 5), 1);
  assert.equal(nextIndex(4, 1, 5), 4); // clamped
  assert.equal(nextIndex(0, -1, 5), 0); // clamped
  assert.equal(dotsFor(7, 1), 7);
  assert.equal(dotsFor(7, 3), 3);
});

test("cards browser: mountCards interaction, popular pre-picked, ArrowRight, Enter, dots", { skip }, async () => {
  const t = await bootMac({ mode: "simple" });
  try {
    const res = await t.page.evaluate(async () => {
      const container = document.createElement("div");
      container.id = "test-cards-container";
      document.body.appendChild(container);

      let picked = null;
      const ctrl = window.CC.mac.cards.mountCards(container, {
        path: "website",
        onPick: (s) => { picked = s; }
      });

      const cards = container.querySelectorAll(".card");
      const dots = container.querySelectorAll(".dots i");
      const firstPicked = picked;

      // Check the pre-selected card is the popular one, and it carries the badge
      const popularIdx = Array.from(cards).findIndex(c => c.classList.contains("sel"));
      const popularStyle = window.CC.mac.cards.PATHS.website.styles[popularIdx];
      const popularIsTrue = popularStyle.popular === true;
      const badge = cards[popularIdx].querySelector(".badge");
      const badgeText = badge ? badge.textContent.trim() : "";

      // Test setIndex / navigation
      ctrl.setIndex(2);
      const afterSetId = ctrl.getCurrent().id;

      // Test container focus and keydown ArrowRight
      const cardsEl = container.querySelector(".cards");
      cardsEl.focus();
      const ev = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true });
      cardsEl.dispatchEvent(ev);
      const afterKeyId = ctrl.getCurrent().id;

      // Enter picks whatever is selected now (index 3 after ArrowRight)
      picked = null;
      cardsEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const pickedAfterEnterId = picked ? picked.id : null;

      return {
        cardCount: cards.length,
        dotCount: dots.length,
        popularIsTrue,
        badgeText,
        popularName: popularStyle.name,
        pickedPopularName: firstPicked.name,
        currentAfterSet: afterSetId,
        currentAfterKey: afterKeyId,
        pickedAfterEnterId
      };
    });

    assert.equal(res.cardCount, 7);
    // mountCards draws one dot per card, so the perPage it really uses is 1.
    const perPage = 1;
    assert.equal(res.dotCount, dotsFor(res.cardCount, perPage));
    assert.equal(res.popularIsTrue, true);
    assert.equal(res.badgeText, "Most popular");
    assert.equal(res.pickedPopularName, res.popularName);
    assert.equal(res.currentAfterSet, PATHS.website.styles[2].id);
    assert.equal(res.currentAfterKey, PATHS.website.styles[3].id);
    assert.equal(res.pickedAfterEnterId, PATHS.website.styles[3].id);
    assert.deepEqual(t.errors, []);
  } finally {
    await t.close();
  }
});

test("cards data: the flow reads styles per path, and its Game mod path \"mod\" maps to remix", () => {
  assert.equal(pathData("mod"), PATHS.remix);
  const mod = stylesFor("mod");
  assert.equal(mod.length, PATHS.remix.styles.length);
  assert.equal(mod.filter((s) => s.popular).length, 1);
  for (const s of stylesFor("image")) {
    assert.ok(s.title && s.style && s.id, "title, style and id for the flow");
    assert.equal(/\[/.test(s.style), false, "the style words carry no [placeholder]");
  }
  assert.deepEqual(stylesFor("nope"), []);
});
