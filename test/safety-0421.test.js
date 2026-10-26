// 0.4.21 M-safety: the send check covers every path, private numbers are hidden before any preview,
// a plan that names an AI that cannot run is re-planned, and no raw JavaScript error reaches the person.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { maskPrivate, maskDeep } from "../server/mask-private.js";
import { maskSensitive, checkOutgoing, assertOutgoingOk } from "../server/compliance-guard.js";
import { makeDraft, cleanInput } from "../server/builders/drafts.js";
import { buildPayload } from "../server/plugins/publish.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("one shared mask: SSNs (dashed or labeled), cards and labeled account numbers keep only four digits", () => {
  assert.equal(maskPrivate("SSN 123-45-6789 ok"), "SSN ***-**-6789 ok");
  assert.equal(maskPrivate("my social security number is 123456789."), "my social security number is ***-**-6789.");
  assert.equal(maskPrivate("card 4242 4242 4242 4242"), "card **** **** **** 4242");
  assert.equal(maskPrivate("Account number: 000123456789 please"), "Account number: ****6789 please");
  assert.equal(maskPrivate("routing #021000021"), "routing #****0021");
  assert.equal(maskPrivate("call 916 555 0100, order 12345"), "call 916 555 0100, order 12345");
  assert.equal(maskSensitive, maskPrivate, "the guard and the send log use the same helper");
  assert.deepEqual(maskDeep({ a: ["SSN 123-45-6789"], b: { c: "acct 99887766" }, n: 4 }), { a: ["SSN ***-**-6789"], b: { c: "acct ****7766" }, n: 4 });
});

test("a missing permission is warned on the draft and on the Gmail check, not forced to yes", () => {
  const sms = (extra) => makeDraft("hl-campaign", cleanInput({ text: "Spring sale. Reply STOP to opt out.", channel: "sms", recipients: "c-1", sendTime: "10:00", ...extra }).input);
  assert.ok(sms().compliance.warnings.some((w) => w.rule === "missing_consent"));
  assert.ok(!makeDraft("hl-campaign", { text: "Spring sale. Reply STOP to opt out.", channel: "sms", recipients: "c-1", consent: true }).compliance.warnings.some((w) => w.rule === "missing_consent"));
  assert.ok(assertOutgoingOk({ text: "Hello there", channel: "email" }).warnings.some((w) => w.rule === "missing_consent"));
  assert.ok(!assertOutgoingOk({ text: "Hello there", channel: "email", consent: true }).warnings.some((w) => w.rule === "missing_consent"));
  assert.ok(checkOutgoing({ text: "Hi", channel: "email" }).needsAck);
  for (const f of ["server/compliance-guard.js", "server/builders/drafts.js", "server/plugins/publish.js"]) assert.doesNotMatch(read(f), /consent: true,? ?(?:sendTime|creditRepair|\})/, `${f} no longer forces consent`);
});

test("Slack, Instagram and HighLevel posts: private numbers are hidden in the payload, preview and history", async () => {
  for (const channel of ["slack", "instagram", "ghl"]) {
    const pl = buildPayload({ channel, title: "Client SSN 123-45-6789", text: "Card 4242 4242 4242 4242, account number 555566667777" });
    assert.doesNotMatch(`${pl.title} ${pl.text}`, /123-45-6789|4242 4242 4242 4242|555566667777/, channel);
    assert.equal(pl.masked, true);
  }
  const s = await startServer({});
  try {
    const pv = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", channelId: "C0123456789", title: "SSN 123-45-6789", text: "hello" } });
    assert.equal(pv.status, 200);
    assert.doesNotMatch(JSON.stringify(pv.json), /123-45-6789/);
    assert.ok(pv.json.warnings.some((w) => w.rule === "private_numbers_hidden"));
    const post = await s.api("/publish/post", { method: "POST", body: { channel: "slack", previewId: pv.json.previewId, confirmed: true } });
    assert.ok([200, 502].includes(post.status));
    assert.doesNotMatch(JSON.stringify(post.json), /123-45-6789/);
    const hist = await s.api("/publish/history");
    assert.doesNotMatch(JSON.stringify(hist.json), /123-45-6789/);
    assert.match(JSON.stringify(hist.json), /\*\*\*-\*\*-6789/);
  } finally { await s.stop(); }
});

test("HighLevel plans and Gmail drafts hide private numbers in the preview", async () => {
  const hl = read("server/highlevel-tools.js"), inbox = read("server/everyday-inbox.js"), plan = read("server/everyday-plan.js");
  assert.match(hl, /args\.text = maskPrivate\(args\.text\)/);
  assert.match(hl, /summary: maskPrivate\(spec\.summary\(args\)\)/);
  for (const t of [inbox, plan]) assert.match(t, /body: maskPrivate\(draft\.body\)/);
  const d = makeDraft("hl-campaign", { text: "Hi SSN 123-45-6789", channel: "email", recipients: "c-1" });
  assert.match(maskDeep(d).message, /\*\*\*-\*\*-6789/);
});
