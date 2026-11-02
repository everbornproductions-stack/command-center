// 0.4.37 (Chris, after the 0.4.36 install: "Meldmind seems frozen"): the 0.4.36 What's new note was so long that
// Got it sat below the window, and the dimmed app looked stuck. Only the list scrolls now; the buttons stay in view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findBrowser, bootPage } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";

test("browser: a long What's new note keeps Got it on screen in a short window, and Got it closes it", { skip }, async () => {
  const t = await bootPage({ width: 1000, height: 560 });
  try {
    const p = t.page;
    // a long note of its own (0.4.39's real note has 4 items and fits): 14 bullets like the 0.4.36 one that hid Got it
    const long = { version: "9.9.9", title: "What's new", bullets: Array.from({ length: 14 }, (_, i) => `Change number ${i + 1}: a sentence long enough to wrap onto a second line in the note, like the real release notes do.`) };
    await p.route(/\/api\/tour\/whats-new/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ whatsNew: long }) }));
    await p.evaluate(() => window.CC.tour.openNews());
    await p.waitForSelector("#cc-whats-new #cc-news-ok", { timeout: 20000 });
    const r = await p.evaluate(() => {
      const ok = document.getElementById("cc-news-ok").getBoundingClientRect();
      const body = document.querySelector("#cc-whats-new .news-body");
      const hit = document.elementFromPoint(ok.left + ok.width / 2, ok.top + ok.height / 2);
      return { okBottom: ok.bottom, vh: innerHeight, onTop: !!hit?.closest("#cc-news-ok"), scrolls: body.scrollHeight > body.clientHeight, items: document.querySelectorAll("#cc-whats-new li").length };
    });
    assert.equal(r.items, 14, `the long note (${r.items} items)`);
    assert.ok(r.okBottom <= r.vh, `Got it is inside the window ${JSON.stringify(r)}`);
    assert.equal(r.onTop, true, "Got it can be clicked without scrolling");
    assert.equal(r.scrolls, true, "the list scrolls on its own at this height");
    await p.click("#cc-news-ok");
    await p.waitForFunction(() => !document.getElementById("cc-whats-new"), null, { timeout: 10000 });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
