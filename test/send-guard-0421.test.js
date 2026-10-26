// 0.4.21 send guard: publish checks the words, Gmail sends stop on a hard block, MCP does not force consent,
// SSN and card numbers are masked in titles and history, STOP and worst fair-housing phrases are covered.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { checkOutgoing, maskSensitive, assertOutgoingOk } from "../server/compliance-guard.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("worst fair-housing phrases block, texts without STOP get a warning, numbers are masked", () => {
  for (const t of ["Lovely home, adults only", "No kids please", "English speaking only", "Christian preferred buyers"]) {
    const r = checkOutgoing({ text: t, channel: "slack" });
    assert.equal(r.ok, false, t);
    assert.equal(r.warnings.filter((w) => w.rule === "fair_housing").length, 0, "no duplicate warn for the same words");
  }
  assert.equal(checkOutgoing({ text: "Safe neighborhood with a yard", channel: "slack" }).ok, true, "milder wording stays a warning");
  assert.ok(checkOutgoing({ text: "Sale this week", channel: "sms", consent: true }).warnings.some((w) => w.rule === "sms_no_optout"));
  assert.ok(!checkOutgoing({ text: "Sale this week. Reply STOP to opt out.", channel: "sms", consent: true }).warnings.some((w) => w.rule === "sms_no_optout"));
  assert.equal(maskSensitive("SSN 123-45-6789 ok"), "SSN ***-**-6789 ok");
  assert.equal(maskSensitive("card 4242 4242 4242 4242 ok"), "card **** **** **** 4242 ok");
  assert.equal(maskSensitive("call 916 555 0100"), "call 916 555 0100");
  assert.throws(() => assertOutgoingOk({ text: "Adults only apartment", channel: "email" }), (e) => e.status === 422 && e.code === "compliance_block");
});

test("source: Gmail sends, the MCP path and the everyday senders are guarded", () => {
  assert.match(read("server", "google.js"), /assertOutgoingOk\(\{ text: `\$\{m\.subject\}/);
  assert.match(read("server", "everyday-plan.js"), /assertOutgoingOk/);
  assert.match(read("server", "everyday-inbox.js"), /assertOutgoingOk/);
  assert.equal(/guardOf\(name, argsFor\(name, raw\), \{ consent: true \}\)/.test(read("server", "highlevel-tools.js")), false);
});

test("publish preview and post refuse blocked words and mask numbers in the title and history", async () => {
  const s = await startServer({});
  try {
    const bad = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", title: "Open house", text: "Lovely condo, adults only." } });
    assert.equal(bad.status, 200);
    assert.ok(bad.json.problems.some((p) => /keeps certain people out/.test(p)), JSON.stringify(bad.json.problems));
    const ok = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", title: "Client 123-45-6789 update", text: "We guarantee a great week." } });
    assert.ok(ok.json.warnings.some((w) => w.rule === "guaranteed_results"));
    const post = await s.api("/publish/post", { method: "POST", body: { channel: "slack", previewId: ok.json.previewId, confirmed: true } });
    assert.equal(post.status, 200, JSON.stringify(post.json));
    assert.doesNotMatch(post.json.title, /123-45-6789/);
    assert.match(post.json.title, /\*\*\*-\*\*-6789/);
    const hist = await s.api("/publish/history");
    assert.doesNotMatch(JSON.stringify(hist.json), /123-45-6789/);
  } finally { await s.stop(); }
});

test("quiet hours are a real clock check for texts (8 am to 9 pm)", () => {
  const rules = (t, ch = "sms") => checkOutgoing({ text: "Sale. Reply STOP to opt out.", channel: ch, consent: true, sendTime: t }).warnings.map((w) => w.rule);
  assert.ok(rules("07:30").includes("quiet_hours"));
  assert.ok(rules("21:00").includes("quiet_hours"));
  assert.ok(rules("10:00 pm").includes("quiet_hours"));
  assert.ok(!rules("10:00").includes("quiet_hours"));
  assert.ok(!rules("8:00 am").includes("quiet_hours"));
  assert.ok(!rules("05:00", "email").includes("quiet_hours"));
});
