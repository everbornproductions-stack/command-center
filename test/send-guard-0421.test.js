// 0.4.21 send guard: publish checks the words, Gmail sends stop on a hard block, MCP does not force consent,
// SSN and card numbers are masked in titles and history, STOP and worst fair-housing phrases are covered.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, freePort, ROOT } from "./helpers.js";
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

// 0.4.22 panel row 37: the guard reads the built draft (the message that really goes out), not the
// box the person typed, so a draft that already says how to stop texts is not held for a false
// warning, and the send log keeps the same words.
test("the campaign guard checks the built draft, and the send log stores the words that went out", async () => {
  const port = await freePort();
  const calls = [];
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      calls.push({ path: req.url, body: raw ? JSON.parse(raw) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "ok" }));
    });
  });
  await new Promise((resolve) => mock.listen(port, "127.0.0.1", resolve));
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_GHL_API_URL: `http://127.0.0.1:${port}` } });
  const CHECKS = { tcpa: true, stop: true, quiet: true, a2p: true, canspam: true };
  try {
    await s.api("/builders/connect", { method: "POST", body: { service: "highlevel", token: "fixture-not-a-real-key", locationId: "loc-1" } });
    const body = { text: "Sale this weekend", recipients: "c-1", sendTime: "10:00", channel: "sms" };
    const preview = await s.api("/builders/hl-campaign/preview", { method: "POST", body: { ...body, checks: CHECKS } });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    const jobId = preview.json.job.id;
    const built = await s.api("/builders/hl-campaign/build", { method: "POST", body: { ...body, jobId, checks: CHECKS } });
    assert.equal(built.status, 200, JSON.stringify(built.json));
    const tested = await s.api("/builders/hl-campaign/test", { method: "POST", body: { ...body, jobId, checks: CHECKS } });
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.match(tested.json.draft.message, /Reply STOP to opt out\./, "the draft adds the stop line");

    // No "Send anyway": the draft already tells people how to stop the texts.
    const published = await s.api("/builders/hl-campaign/publish", { method: "POST", body: { ...body, jobId, checks: CHECKS, confirm: true } });
    assert.equal(published.status, 200, JSON.stringify(published.json));
    assert.equal(published.json.posted, true);
    const posts = calls.filter((c) => /conversations\/messages$/.test(c.path));
    assert.equal(posts.length, 1);
    assert.match(posts[0].body.message, /Reply STOP to opt out\./);

    const log = await s.api("/publish/send-log");
    assert.equal(log.status, 200, JSON.stringify(log.json));
    const row = log.json.items[0];
    assert.equal(row.text, posts[0].body.message, "the log keeps the words that went out");
    assert.equal(row.rules.includes("sms_no_optout"), false, "no false override on a draft with a stop line");
    assert.equal(row.sendAnyway, false);
  } finally {
    await s.stop();
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("a final message without a stop line still gets the warning, and the guard still runs at publish", () => {
  const finalText = "Sale this weekend";
  assert.ok(checkOutgoing({ text: finalText, channel: "sms", consent: true, sendTime: "10:00" }).warnings.some((w) => w.rule === "sms_no_optout"));
  const src = read("server", "plugins", "builders.js");
  assert.match(src, /checkOutgoing\(\{ text: outgoingText\(job, input\)/, "the publish check reads the built draft");
  assert.doesNotMatch(src, /checkOutgoing\(\{ text: input\.text/);
  assert.match(src, /text: sentText/);
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
