// 0.4.34 (0.4.31 panel item 10, Ray and Tasha): AI answers about credit repair, homes, loans or insurance are checked with
// the Send-check rules and the warnings shown under them. Nothing is changed or blocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnswer } from "../server/compliance-guard.js";
import { startServer, waitBudget } from "./helpers.js";

test("checkAnswer flags risky lines only in answers on those topics", () => {
  const credit = checkAnswer("Dear client, we guarantee your credit score will go up 100 points and we will remove all negative items from your credit report.");
  assert.equal(credit.checked, true);
  assert.ok(credit.warnings.length >= 1, JSON.stringify(credit));
  const off = checkAnswer("Here are three cupcake flavors for spring: lemon, berry and honey.");
  assert.deepEqual(off, { checked: false, warnings: [] }, "a cupcake answer is not checked");
  const clean = checkAnswer("Our team reviews your credit report with you and explains your rights under federal law.");
  assert.equal(clean.checked, true);
  assert.ok(!clean.warnings.some((w) => w.level === "info"), "no send-time notes on an answer");
});

// 0.4.36 (panel 0434 item 9): cover shorthand credit promises and ordinary guarantee wording.
test("checkAnswer recognizes credit shorthand without flagging ordinary guarantees", () => {
  const shorthand = checkAnswer("We will remove all negative items and raise your score 120 points. Pay the $299 fee first.");
  assert.equal(shorthand.checked, true);
  assert.deepEqual(shorthand.warnings.map((w) => w.rule).sort(), ["croa_advance_fee", "croa_score_promise", "croa_will_remove"]);
  assert.equal(checkAnswer("Your high score in the game is guaranteed to go up.").checked, false, "a game score is not a credit topic");
  assert.deepEqual(checkAnswer("Our return policy says we guarantee fresh bread."), { checked: false, warnings: [] });
  assert.deepEqual(checkAnswer("Claim your free skin consultation, guaranteed."), { checked: false, warnings: [] });
  assert.equal(checkAnswer("We guarantee your credit repair will remove all negative items.").checked, true);
});

test("POST /api/answer-check answers with the warnings", { timeout: waitBudget(120000) }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const r = await s.api("/answer-check", { method: "POST", body: { text: "We guarantee your credit score will go up 100 points." } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.checked, true);
    assert.ok(r.json.warnings.length >= 1);
  } finally { await s.stop(); }
});
