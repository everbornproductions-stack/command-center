// What's new snooze and the suggestion box. Local stub only. Send is a click.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  DAY, THANKS, TRY_INBOX, TRY_SUGGEST, MANIFEST_ID, IDEA_STATUSES,
  buildSuggestion, loopbackUrl, nextSnooze, shouldPrompt, settleStatus,
} from "../server/everyday-news.js";
import { classifyFile } from "../server/box-files.js";

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
  const files = ["server/everyday-news.js", "server/plugins/everyday-news.js", "server/box-files.js", "server/dictate.js", "server/local-whisper.js", "server/plugins/orders-box.js", "server/media-modify.js", "server/plugins/media-modify.js", "web/features/everyday-news.js", "web/features/orders-input.js", "web/features/capture-input.js", "web/features/media-modify.js", "docs/help/everyday-whats-new.md", "docs/help/everyday-suggest.md", "docs/help/idea-box.md"];
  for (const file of files) assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes(EM), false, file);
  assert.throws(() => classifyFile("virus.exe", Buffer.from("MZ")), /not allowed/);
  assert.throws(() => classifyFile("page.html", Buffer.from("<html></html>")), /not allowed/);
  assert.deepEqual(IDEA_STATUSES, ["new", "planned", "building", "shipped"]);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/help/idea-box.md"), "utf8"), /edit before Send/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/orders-input.js"), "utf8"), /Nothing is sent until that click/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/tour.js"), "utf8"), /Voice writes what you say/);
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

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("an idea can carry a file, change status, and keep later edits on this computer", async () => {
  const m = await sink();
  let s;
  const secret = "hunter2-file-secret";
  const pngB64 = PNG.toString("base64");
  try {
    s = await startServer({ env: { ...BLANK, CC_EVERYDAY_FEEDBACK_URL: `${m.base}/send`, CC_EVERYDAY_OS: "test-os", CC_WHISPER_BIN: "off" } });
    assert.ok((await s.api("/state")).json.plugins.includes("orders-box"));
    const refused = await s.api("/everyday-news/suggestions/files", { method: "POST", body: { name: "secret.txt", mime: "text/plain", data: Buffer.from(`my password is ${secret}`).toString("base64") } });
    assert.equal(refused.status, 400);
    const exe = await s.api("/everyday-news/suggestions/files", { method: "POST", body: { name: "run.exe", mime: "application/octet-stream", data: pngB64 } });
    assert.equal(exe.status, 400);
    const shot = await s.api("/everyday-news/suggestions/files", { method: "POST", body: { name: "shot.png", mime: "image/png", data: pngB64 } });
    assert.equal(shot.status, 200, shot.text);
    assert.equal(shot.json.name, "shot.png");
    const preview = await s.api("/everyday-news/suggestions/preview", { method: "POST", body: { text: "A shot of the idea", category: "other", includeMeta: false, fileIds: [shot.json.id] } });
    assert.equal(preview.status, 200, preview.text);
    assert.deepEqual(preview.json.payload.files, [{ name: "shot.png" }]);
    assert.equal(JSON.stringify(preview.json.payload).includes(pngB64), false);
    const sent = await s.api("/everyday-news/suggestions/send", { method: "POST", body: { confirm: true, text: "A shot of the idea", category: "other", includeMeta: false, fileIds: [shot.json.id], payload: preview.json.payload } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.idea.status, "new");
    assert.equal(m.sent.length, 1);
    assert.equal(JSON.stringify(m.sent[0]).includes(pngB64), false);
    assert.deepEqual(m.sent[0].files, [{ name: "shot.png" }]);
    const got = await s.api(`/everyday-news/files/${sent.json.id}/${shot.json.id}`);
    assert.equal(got.status, 200, got.text);
    assert.match(String(got.headers["content-disposition"]), /attachment/);
    assert.match(String(got.headers["content-type"]), /^image\/png/);
    assert.equal(got.headers["x-content-type-options"], "nosniff");
    const stored = walk(s.dir).find((f) => f.endsWith(`${shot.json.id}.bin`));
    assert.ok(stored);
    assert.equal(fs.readFileSync(stored).equals(PNG), true);
    const jsonDump = walk(s.dir).filter((f) => f.endsWith(".json")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    assert.equal(jsonDump.includes(pngB64), false);
    assert.equal(jsonDump.includes(secret), false);

    const edited = await s.api(`/everyday-news/suggestions/${sent.json.id}`, { method: "POST", body: { text: "A clearer shot of the idea", status: "planned" } });
    assert.equal(edited.status, 200, edited.text);
    assert.equal(edited.json.resent, false);
    assert.match(edited.json.message, /not sent/);
    assert.equal(edited.json.idea.status, "planned");
    assert.equal(m.sent.length, 1);
    const noted = await s.api(`/everyday-news/suggestions/${sent.json.id}/comments`, { method: "POST", body: { text: "Chris, this is the one to build" } });
    assert.equal(noted.status, 200, noted.text);
    assert.match(noted.json.message, /not sent/);
    assert.equal(m.sent.length, 1);
    const leak = await s.api(`/everyday-news/suggestions/${sent.json.id}/comments`, { method: "POST", body: { text: `password ${secret}` } });
    assert.equal(leak.status, 400);
    const bad = await s.api(`/everyday-news/suggestions/${sent.json.id}`, { method: "POST", body: { status: "later" } });
    assert.equal(bad.status, 400);

    const secondPreview = await s.api("/everyday-news/suggestions/preview", { method: "POST", body: { text: "Second idea", category: "action", includeMeta: false } });
    const second = await s.api("/everyday-news/suggestions/send", { method: "POST", body: { confirm: true, text: "Second idea", category: "action", includeMeta: false, payload: secondPreview.json.payload } });
    assert.equal(second.status, 200, second.text);
    const moved = await s.api(`/everyday-news/suggestions/${second.json.id}/move`, { method: "POST", body: { direction: "up" } });
    assert.equal(moved.json.ideas[0].id, second.json.id);
    assert.equal(moved.json.ideas[0].text, "Second idea");
    const shipped = await s.api(`/everyday-news/suggestions/${second.json.id}`, { method: "POST", body: { status: "shipped" } });
    assert.equal(shipped.json.idea.status, "shipped");
    const building = await s.api(`/everyday-news/suggestions/${sent.json.id}`, { method: "POST", body: { status: "building" } });
    assert.equal(building.json.idea.status, "building");
    assert.equal(m.sent.length, 2);

    const order = await s.api("/orders-box/files", { method: "POST", body: { name: "notes.txt", mime: "text/plain", data: Buffer.from("Add a notes connection").toString("base64") } });
    assert.equal(order.status, 200, order.text);
    assert.equal(order.json.sends, false);
    assert.match(order.json.note, /Add a notes connection/);
    assert.match(order.json.note, /stays on this computer|From notes.txt/);
    const orderFile = await s.api(`/orders-box/files/${order.json.id}`);
    assert.match(String(orderFile.headers["content-disposition"]), /attachment/);
    const orderSecret = await s.api("/orders-box/files", { method: "POST", body: { name: "secret.txt", mime: "text/plain", data: Buffer.from(`my password is ${secret}`).toString("base64") } });
    assert.equal(orderSecret.status, 400);
    const dumped = walk(s.dir).map((f) => fs.readFileSync(f)).join("\n");
    assert.equal(dumped.includes(secret), false);

    const gone = await s.api(`/everyday-news/suggestions/${sent.json.id}/delete`, { method: "POST", body: {} });
    assert.equal(gone.json.deleted, true);
    assert.equal(gone.json.ideas.some((idea) => idea.id === sent.json.id), false);
    assert.equal((await s.api(`/everyday-news/files/${sent.json.id}/${shot.json.id}`)).status, 404);
    assert.equal(m.sent.length, 2);
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});

test("voice uses local Whisper and does not submit the idea", async () => {
  const whisper = path.join(ROOT, "test", "fixtures", "fake-whisper.mjs");
  const audio = Buffer.from("not-real-audio").toString("base64");
  let ok;
  let fail;
  try {
    ok = await startServer({ env: { ...BLANK, CC_WHISPER_BIN: whisper } });
    const heard = await ok.api("/voice/dictate", { method: "POST", body: { mime: "audio/webm", audio } });
    assert.equal(heard.status, 200, heard.text);
    assert.equal(heard.json.provider, "whisper");
    assert.match(heard.json.text, /calendar/);
    assert.equal((await ok.api("/everyday-news")).json.ideas.length, 0);
    assert.equal((await ok.api("/everyday-news")).json.waiting, 0);
  } finally { if (ok) await ok.stop(); }
  try {
    fail = await startServer({ env: { ...BLANK, CC_WHISPER_BIN: whisper, FAKE_WHISPER_FAIL: "1" } });
    const missed = await fail.api("/voice/dictate", { method: "POST", body: { mime: "audio/webm", audio } });
    assert.equal(missed.status, 409, missed.text);
    assert.match(missed.json.error, /free key/);
    assert.equal((await fail.api("/everyday-news")).json.ideas.length, 0);
  } finally { if (fail) await fail.stop(); }
});
