// Compliance send guard: table of look-alike inputs, rule packs from data files, and the send paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkOutgoing, loadRules } from "../server/compliance-guard.js";

const ids = (r) => r.warnings.map((w) => w.rule);
const base = { channel: "sms", consent: true };

test("clearly illegal promises are blocked", () => {
  for (const text of [
    "We guarantee your collections will be deleted in 30 days",
    "100% deleted or your money back",
    "We promise all late payments will be removed",
    "We will remove your negative items fast",
    "Pay upfront and we start your credit repair",
  ]) {
    const r = checkOutgoing({ ...base, text, creditRepair: true });
    assert.equal(r.ok, false, text);
    assert.ok(r.blocked.length, text);
    assert.equal(r.blocked[0].canSendAnyway, false);
  }
});

test("honest copy passes clean", () => {
  for (const text of [
    "Hi Sam, your review is ready. Reply STOP to opt out.",
    "We review your reports and dispute what is wrong or unverified. Results vary.",
    "Your guaranteed-to-be-fun open house is Saturday",  // hyphen compound still warns, never blocks
  ]) {
    const r = checkOutgoing({ ...base, text });
    assert.equal(r.ok, true, text);
  }
  assert.deepEqual(ids(checkOutgoing({ ...base, text: "See you Saturday at 10." })), []);
});

test("warnings: guarantee, fair housing, Reg Z, markers, score points, consent", () => {
  assert.ok(ids(checkOutgoing({ ...base, text: "Satisfaction guaranteed" })).includes("guaranteed_results"));
  assert.ok(ids(checkOutgoing({ ...base, text: "Adults only building, safe neighborhood" })).includes("fair_housing"));
  assert.ok(ids(checkOutgoing({ ...base, text: "Payments as low as $899 a month, 5.5% APR" })).includes("reg_z_trigger"));
  assert.ok(ids(checkOutgoing({ ...base, text: "Hi [NAME], welcome" })).includes("raw_marker"));
  assert.ok(ids(checkOutgoing({ ...base, text: "Hi {{first_name}}" })).includes("raw_marker"));
  assert.ok(ids(checkOutgoing({ ...base, text: "We can boost your credit score by 100 points" })).includes("croa_score_promise"));
  const noConsent = checkOutgoing({ channel: "email", text: "Hello" });
  assert.ok(ids(noConsent).includes("missing_consent"));
  assert.equal(noConsent.ok, true);
  assert.equal(noConsent.needsAck, true);
  for (const w of noConsent.warnings) assert.ok(w.plain && w.why && !/[\u2013\u2014]/.test(w.plain + w.why));
});

test("a credit-only rule does not fire on a plain real estate message", () => {
  assert.equal(checkOutgoing({ ...base, text: "We will remove the old fence before you move in" }).ok, true);
});

test("send time is an honest notice that needs no extra click", () => {
  const r = checkOutgoing({ ...base, text: "Hello", sendTime: "10:00" });
  assert.ok(ids(r).includes("send_time_label"));
  assert.equal(r.needsAck, false);
});

test("rule packs load from data files and a bad file is skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rules-"));
  fs.writeFileSync(path.join(dir, "extra.json"), JSON.stringify({ pack: "extra", rules: [{ id: "no_cats", level: "warn", pattern: "\\bcats?\\b", plain: "Mentions cats.", why: "Test pack." }, { id: "bad", pattern: "(" }] }));
  fs.writeFileSync(path.join(dir, "broken.json"), "{ nope");
  const rules = loadRules(dir);
  assert.deepEqual(rules.map((r) => r.id), ["no_cats"]);
  assert.deepEqual(ids(checkOutgoing({ ...base, text: "I like cats" }, { rulesList: rules })), ["no_cats"]);
  assert.ok(loadRules().length >= 8);
});

test("HighLevel plan blocks a guarantee, and a warning needs Send anyway", async () => {
  const hl = await import("../server/highlevel-tools.js");
  assert.ok(hl.ACTIONS.send_message);
  const src = fs.readFileSync(new URL("../server/highlevel-tools.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /compliance_block/);
  assert.match(src, /compliance_review/);
  const b = fs.readFileSync(new URL("../server/plugins/builders.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(b, /compliance_block/);
  assert.match(b, /sendAnyway/);
  const a = fs.readFileSync(new URL("../server/plugins/buildall.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(a, /checkOutgoing/);
});
