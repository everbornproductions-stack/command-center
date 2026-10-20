// What's new snooze and the suggestion box. Local stub only. Send is a click.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  DAY, THANKS, TRY_INBOX, TRY_SUGGEST, MANIFEST_ID,
  buildSuggestion, loopbackUrl, nextSnooze, shouldPrompt, settleStatus,
} from "../server/everyday-news.js";

const EM = "\u2014";
const T0 = Date.UTC(2026, 9, 20, 15, 0, 0);

test("snooze is 3 days then 7 days, and a suggestion is an exact note", () => {
  const first = nextSnooze({ status: "pending", snoozes: 0 }, T0);
  assert.equal(first.status, "later");
  assert.equal(first.snoozes, 1);
  assert.equal(first.remindAt, T0 + 3 * DAY);
  assert.equal(shouldPrompt(first, T0 + 2 * DAY), false);
  assert.equal(shouldPrompt(first, T0 + 3 * DAY), true);
  const second = nextSnooze(first, T0 + 3 * DAY);
  assert.equal(second.snoozes, 2);
  assert.equal(second.remindAt, T0 + 3 * DAY + 7 * DAY);
  assert.equal(shouldPrompt(second, second.remindAt - 1), false);
  assert.equal(settleStatus(second, second.remindAt).status, "settings");
  assert.equal(shouldPrompt(second, second.remindAt), false);
  assert.equal(nextSnooze({ status: "skipped", snoozes: 0 }, T0).status, "skipped");
  assert.equal(loopbackUrl("https://example.com/x"), null);
  assert.equal(loopbackUrl("http://example.com/x"), null);
  assert.match(loopbackUrl("http://127.0.0.1:9/send"), /^http:\/\/127\.0\.0\.1:9\/send$/);
  const payload = buildSuggestion({ text: TRY_SUGGEST, category: "connection", includeMeta: true }, { CC_EVERYDAY_OS: "test-os" });
  assert.equal(payload.text, TRY_SUGGEST);
  assert.equal(payload.category, "connection");
  assert.equal(payload.os, "test-os");
  assert.equal("email" in payload, false);
  assert.throws(() => buildSuggestion({ text: "my password is hunter2" }), /password/);
  const files = ["server/everyday-news.js", "server/plugins/everyday-news.js", "web/features/everyday-news.js", "docs/help/everyday-whats-new.md", "docs/help/everyday-suggest.md"];
  for (const file of files) assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes(EM), false, file);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/help/everyday-whats-new.md"), "utf8"), /Try saying: What needs me today/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/tour.js"), "utf8"), /everydaySteps/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/connect-setup.js"), "utf8"), /everydaySuggest/);
  assert.equal(MANIFEST_ID, "everyday-2026-10-20");
  assert.equal(THANKS, "Thanks, Chris reads these");
  assert.equal(TRY_INBOX.includes(EM) || TRY_SUGGEST.includes(EM), false);
});

function sink() {
  const m = { sent: [] };
  const srv = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    m.sent.push(JSON.parse(body || "{}"));
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end("{}");
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      m.base = `http://127.0.0.1:${srv.address().port}`;
      m.close = () => new Promise((done) => { try { srv.closeAllConnections(); } catch {} srv.close(done); });
      resolve(m);
    });
  });
}

const BLANK = {
  CC_STATUS_PAGES: "off",
  CC_EVERYDAY_CLOCK: "1",
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
  PERPLEXITY_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "",
};

test("the card snoozes, try it does not send, and Send posts the exact note", async () => {
  const m = await sink();
  let s;
  const secret = "hunter2-everyday-secret";
  try {
    s = await startServer({ env: { ...BLANK, CC_EVERYDAY_FEEDBACK_URL: `${m.base}/send`, CC_EVERYDAY_OS: "test-os" } });
    assert.ok((await s.api("/state")).json.plugins.includes("everyday-news"));
    const first = await s.api(`/everyday-news?now=${T0}`);
    assert.equal(first.status, 200, first.text);
    assert.ok(first.json.prompt.some((i) => i.id === "calendar"));
    assert.ok(first.json.prompt.some((i) => i.say === TRY_INBOX));
    const connect = await s.api("/everyday-news/items/calendar/connect", { method: "POST", body: { now: T0 } });
    assert.equal(connect.json.started, false);
    assert.equal(connect.json.focus, "[data-id='calendar']");
    assert.match(connect.json.message, /checklist/);
    const tried = await s.api("/everyday-news/items/inbox/try", { method: "POST", body: { now: T0 } });
    assert.equal(tried.json.sends, false);
    assert.equal(tried.json.readOnly, true);
    assert.match(tried.json.sample, /Nothing was sent/);
    assert.equal(m.sent.length, 0);

    const later = await s.api("/everyday-news/items/reply/later", { method: "POST", body: { now: T0 } });
    assert.equal(later.json.item.snoozes, 1);
    const hidden = await s.api(`/everyday-news?now=${T0 + 2 * DAY}`);
    assert.equal(hidden.json.prompt.some((i) => i.id === "reply"), false);
    const back = await s.api(`/everyday-news?now=${T0 + 3 * DAY}`);
    assert.equal(back.json.prompt.some((i) => i.id === "reply"), true);
    const again = await s.api("/everyday-news/items/reply/later", { method: "POST", body: { now: T0 + 3 * DAY } });
    assert.equal(again.json.item.snoozes, 2);
    const still = await s.api(`/everyday-news?now=${T0 + 3 * DAY + 7 * DAY - 60000}`);
    assert.equal(still.json.prompt.some((i) => i.id === "reply"), false);
    assert.equal(still.json.settings.some((i) => i.id === "reply"), false);
    const settled = await s.api(`/everyday-news?now=${T0 + 3 * DAY + 7 * DAY}`);
    assert.equal(settled.json.prompt.some((i) => i.id === "reply"), false);
    assert.equal(settled.json.settings.some((i) => i.id === "reply"), true);

    await s.api("/everyday-news/items/brief/skip", { method: "POST", body: { now: T0 } });
    const skipped = await s.api(`/everyday-news?now=${T0 + 30 * DAY}`);
    assert.equal(skipped.json.prompt.some((i) => i.id === "brief"), false);
    const all = await s.api("/everyday-news/skip-all", { method: "POST", body: { now: T0 } });
    assert.equal(all.json.prompt.length, 0);
    const gone = await s.api(`/everyday-news?now=${T0 + 40 * DAY}`);
    assert.equal(gone.json.prompt.length, 0);

    const preview = await s.api("/everyday-news/suggestions/preview", { method: "POST", body: { text: TRY_SUGGEST, category: "connection", includeMeta: true } });
    assert.equal(preview.json.sends, false);
    assert.equal(preview.json.payload.os, "test-os");
    assert.equal((await s.api("/everyday-news")).json.waiting, 0);
    const bare = await s.api("/everyday-news/suggestions/send", { method: "POST", body: { text: TRY_SUGGEST, category: "connection", includeMeta: true, payload: preview.json.payload } });
    assert.equal(bare.status, 400);
    assert.equal(m.sent.length, 0);
    const mismatch = await s.api("/everyday-news/suggestions/send", { method: "POST", body: { confirm: true, text: TRY_SUGGEST, category: "connection", includeMeta: true, payload: { ...preview.json.payload, text: "other" } } });
    assert.equal(mismatch.status, 400);
    assert.equal(m.sent.length, 0);
    const sent = await s.api("/everyday-news/suggestions/send", { method: "POST", body: { confirm: true, text: TRY_SUGGEST, category: "connection", includeMeta: true, payload: preview.json.payload } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.thanks, THANKS);
    assert.equal(sent.json.delivered, true);
    assert.deepEqual(m.sent[0], preview.json.payload);
    const refused = await s.api("/everyday-news/suggestions/preview", { method: "POST", body: { text: `my password is ${secret}` } });
    assert.equal(refused.status, 400);
    const dumped = fs.readdirSync(s.dir).filter((f) => f.endsWith(".json")).map((f) => fs.readFileSync(path.join(s.dir, f), "utf8")).join("\n");
    assert.equal(dumped.includes(secret), false);
    assert.equal(s.log.includes(secret), false);
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});

test("without a loopback stub the suggestion stays on this computer", async () => {
  let s;
  try {
    s = await startServer({ env: { ...BLANK } });
    const preview = await s.api("/everyday-news/suggestions/preview", { method: "POST", body: { text: "Add a notes connection", category: "connection", includeMeta: false } });
    assert.equal(preview.json.payload.version, undefined);
    const sent = await s.api("/everyday-news/suggestions/send", { method: "POST", body: { confirm: true, text: "Add a notes connection", category: "connection", includeMeta: false, payload: preview.json.payload } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.delivered, false);
    assert.equal(sent.json.queued, true);
    assert.equal(sent.json.thanks, THANKS);
    assert.equal((await s.api("/everyday-news")).json.waiting, 1);
  } finally { if (s) await s.stop(); }
});
