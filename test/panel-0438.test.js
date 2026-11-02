// 0.4.38: fixes from the 0.4.36 persona panel (meldmind-panel-0436\FIXES-0438.md items 1, 2, 3 and 5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { idsFor } from "../web/perf/registry.js";
import { checkAnswer } from "../server/compliance-guard.js";
import { practiceBody } from "../server/demo-answers.js";
import { findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";

test("item 2: Light mode loads the answer check on Chat (and still skips the other answer panels)", () => {
  const light = idsFor("command", { light: true });
  assert.ok(light.includes("answer-check"), JSON.stringify(light));
  assert.ok(!light.includes("next-actions"), "the other answer panels stay off in Light mode");
  assert.ok(idsFor("command").includes("answer-check"));
});

test("item 3: a placeholder left in is flagged in any answer; a clean everyday answer is not checked", () => {
  const r = checkAnswer("Hi [Name],\n\nJust checking in on your renewal. Let me know a good time to talk.");
  assert.equal(r.checked, true);
  assert.deepEqual(r.warnings.map((w) => w.rule), ["raw_marker"]);
  assert.deepEqual(checkAnswer("Hi Dana, your renewal is coming up. Want to talk Tuesday?"), { checked: false, warnings: [] });
  assert.deepEqual(checkAnswer("Our return policy says we guarantee fresh bread."), { checked: false, warnings: [] }, "the 0.4.36 false alarm stays gone");
  assert.equal(checkAnswer("Use {{first_name}} at the top.").checked, true);
});

test("item 5: a number that is not a count of lines stays in the practice answer", () => {
  assert.match(practiceBody("Reply to a 2-star review about slow service", "atlas-pro"), /2-star/);
  assert.doesNotMatch(practiceBody("Reply to a 2-star review about slow service", "atlas-pro"), / -star/);
});

test("browser item 1: the Get free AIs card has a solid background in the Mac look, light and dark", { skip }, async () => {
  for (const theme of ["light", "dark"]) {
    const t = await bootMac({ mode: "simple", width: 1366, height: 800, theme });
    try {
      const p = t.page;
      await p.evaluate(() => window.CC.freeAis.open());
      await p.waitForSelector("#cc-free-ais .card", { timeout: 20000 });
      const bg = await p.evaluate(() => getComputedStyle(document.querySelector("#cc-free-ais .card")).backgroundColor);
      const alpha = (bg.match(/rgba?\(([^)]+)\)/)?.[1] || "").split(",").map((x) => Number(x.trim()))[3];
      assert.ok(bg && bg !== "transparent" && !(alpha === 0), `${theme}: the card is not see-through (${bg})`);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }
});
