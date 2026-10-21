// Inbox summary, reply drafts, and local reminders.
// Mocks stay on 127.0.0.1. A reply is posted only after Send. No real key or mailbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT, waitBudget } from "./helpers.js";
import { SCOPES } from "../server/google.js";
import {
  summarizeAccounts, SAMPLES, draftReply, parsePlain, toneFrom, loopbackUrl, TRY_INBOX, TRY_REPLY, TRY_REMIND, TRY_TODO,
} from "../server/everyday-inbox.js";

const EM = "\u2014";
const CLIENT_SECRET = "GOCSPX-everyday-secret-0123456789";
const LEGACY = "ya29.everyday-home-token-012345";
const WORK = "ya29.everyday-work-token-012345";
const SECRETS = [CLIENT_SECRET, LEGACY, WORK];

test("summary keeps mailboxes apart and a draft waits for the exact send", () => {
  const sum = summarizeAccounts(SAMPLES);
  assert.equal(sum.readOnly, true);
  assert.equal(sum.sends, false);
  assert.equal(sum.accounts.length, 2);
  assert.equal(sum.accounts[0].label, "Home");
  assert.equal(sum.accounts[1].label, "Work");
  assert.ok(sum.needs.some((n) => n.subject === "Thursday"));
  assert.ok(sum.needs.some((n) => n.subject === "October invoice"));
  assert.equal(sum.needs.some((n) => /newsletter/i.test(n.subject)), false);
  const tone = toneFrom({ directness: "direct", wordsIUse: "gladly", wordsIAvoid: "awesome" });
  const draft = draftReply({ from: "Dana Lee <dana@shop.test>", subject: "Thursday", instruction: TRY_REPLY, tone });
  assert.equal(draft.status, "draft");
  assert.equal(draft.to, "dana@shop.test");
  assert.match(draft.body, /Thursday/);
  assert.match(draft.body, /gladly/);
  assert.equal(draft.body.includes("awesome"), false);
  assert.equal(loopbackUrl("https://example.com/send"), null);
  assert.equal(loopbackUrl("http://127.0.0.1:9/send")?.startsWith("http://127.0.0.1:9/"), true);
  const now = new Date(2026, 9, 20, 9, 0, 0).getTime();
  const remind = parsePlain(TRY_REMIND, now);
  assert.equal(remind.kind, "reminder");
  assert.equal(remind.title, "call Mom");
  assert.equal(new Date(remind.at).getHours(), 17);
  assert.equal(new Date(remind.at).getDate(), 20);
  const todo = parsePlain(TRY_TODO, now);
  assert.equal(todo.kind, "reminder");
  assert.match(todo.title, /renew my license/);
  assert.equal(new Date(todo.at).getMonth(), 10);
  assert.throws(() => parsePlain("Remind me of my password"), /password/);
  for (const file of ["server/everyday-inbox.js", "server/plugins/everyday-inbox.js", "web/features/everyday-inbox.js", "docs/help/everyday-inbox.md", "docs/help/everyday-reminders.md"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes(EM), false, file);
  }
  const help = fs.readFileSync(path.join(ROOT, "docs/help/everyday-inbox.md"), "utf8");
  assert.match(help, /Try saying: What needs me today/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/help/everyday-reminders.md"), "utf8"), /Try saying: Remind me at 5/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/everyday-inbox.js"), "utf8"), /Try saying/);
  assert.equal(TRY_INBOX.includes(EM), false);
});

function meta(id, from, subject) {
  const b64 = Buffer.from(subject, "utf8").toString("base64url");
  return { id, snippet: subject, payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, { name: "Date", value: "Tue, 20 Oct 2026" }], mimeType: "text/plain", body: { data: b64 } } };
}

async function mock() {
  const m = { hits: [], sent: [] };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    m.hits.push({ path: url.pathname, method: req.method, auth: req.headers.authorization || "" });
    if (url.pathname === "/send") { m.sent.push(JSON.parse(body)); return send(200, { ok: true }); }
    if (url.pathname === "/oauth/token") {
      const f = Object.fromEntries(new URLSearchParams(body));
      if (f.client_secret !== CLIENT_SECRET) return send(401, { error: "invalid_client" });
      const access = f.code === "good-code" ? LEGACY : f.code === "work-code" ? WORK : "";
      if (!access) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: access, refresh_token: "refresh-not-logged", expires_in: 3600, scope: `${SCOPES.gmail} ${SCOPES.send}`, token_type: "Bearer" });
    }
    if (url.pathname === "/gmail/gmail/v1/users/me/messages" && req.method === "GET") {
      const auth = req.headers.authorization || "";
      const id = auth.endsWith(WORK) ? "workmsg1" : "homems01";
      return send(200, { messages: [{ id }] });
    }
    if (url.pathname.endsWith("/workmsg1")) return send(200, meta("workmsg1", "Work Lead <lead@shop.test>", "Work question"));
    if (url.pathname.endsWith("/homems01")) return send(200, meta("homems01", "Dana Lee <dana@shop.test>", "Thursday"));
    if (url.pathname.endsWith("/messages/send")) return send(200, { id: "sent-should-not-run" });
    if (url.pathname.startsWith("/auth/")) { res.writeHead(200, { "content-type": "text/html", connection: "close" }); return res.end("signin"); }
    send(404, { error: "no route" });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  m.base = `http://127.0.0.1:${srv.address().port}`;
  m.close = () => new Promise((resolve) => { try { srv.closeAllConnections(); } catch {} srv.close(resolve); });
  return m;
}

test("two mailboxes summarize apart, and Send is the only delivery", async () => {
  const m = await mock();
  let s;
  try {
    s = await startServer({ env: {
      CC_DEV_OWNER: "1",
      CC_STATUS_PAGES: "off",
      CC_EVERYDAY_MAIL_URL: `${m.base}/send`,
      CC_GOOGLE_AUTH_URL: `${m.base}/auth`,
      CC_GOOGLE_TOKEN_URL: `${m.base}/oauth`,
      CC_GMAIL_API_URL: `${m.base}/gmail`,
      CC_GOOGLE_CLIENT_ID: "",
      ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
      PERPLEXITY_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "",
    } });
    assert.ok((await s.api("/state")).json.plugins.includes("everyday-inbox"));
    const page = await s.api("/everyday-inbox");
    assert.equal(page.status, 200);
    assert.equal(page.json.trySaying.inbox, TRY_INBOX);
    assert.ok(page.json.howto.some((h) => h.say === TRY_REPLY));

    const sample = await s.api("/everyday-inbox/summary", { method: "POST", body: { sample: true } });
    assert.equal(sample.status, 200);
    assert.equal(sample.json.sample, true);
    assert.equal(sample.json.needs.length, 2);
    assert.equal(m.sent.length, 0, "a summary does not send");

    await s.api("/prompts/profile", { method: "POST", body: { wordsIUse: "gladly", directness: "direct" } });
    const made = await s.api("/everyday-inbox/draft", { method: "POST", body: {
      from: "Dana Lee <dana@shop.test>", subject: "Thursday", instruction: TRY_REPLY,
    } });
    assert.equal(made.status, 200, made.text);
    assert.equal(made.json.sent, false);
    assert.match(made.json.draft.body, /gladly/);
    assert.equal(m.sent.length, 0);
    const blocked = await s.api(`/everyday-inbox/drafts/${made.json.draft.id}/send`, { method: "POST", body: { to: made.json.draft.to, subject: made.json.draft.subject, body: made.json.draft.body } });
    assert.equal(blocked.status, 400);
    assert.equal(m.sent.length, 0);

    const exact = { confirm: true, to: made.json.draft.to, subject: "Re: Thursday", body: "Hi Dana,\n\nYes, Thursday works. I can do that gladly.\n\nThanks" };
    const sent = await s.api(`/everyday-inbox/drafts/${made.json.draft.id}/send`, { method: "POST", body: exact });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.sent, true);
    assert.equal(sent.json.via, "loopback");
    assert.equal(m.sent.length, 1);
    assert.equal(m.sent[0].to, exact.to);
    assert.equal(m.sent[0].subject, exact.subject);
    assert.equal(m.sent[0].body, exact.body);
    assert.equal(m.hits.filter((h) => h.path.endsWith("/messages/send")).length, 0, "the loopback stand-in is not Gmail");
    const again = await s.api(`/everyday-inbox/drafts/${made.json.draft.id}/send`, { method: "POST", body: exact });
    assert.equal(again.status, 409);
    assert.equal(m.sent.length, 1);

    await s.api("/browser/google/client", { method: "POST", body: { clientId: "1234567890-everyday.apps.googleusercontent.com", clientSecret: CLIENT_SECRET } });
    let start = await s.api("/browser/google/start", { method: "POST", body: { origin: s.base, gmail: true, send: true } });
    assert.equal((await s.api("/browser/google/finish", { method: "POST", body: { code: "good-code", state: new URL(start.json.url).searchParams.get("state") } })).status, 200);
    await s.api("/mail-accounts/google/label", { method: "POST", body: { label: "Home" } });
    const work = (await s.api("/mail-accounts", { method: "POST", body: { provider: "google", label: "Work" } })).json.account;
    start = await s.api("/browser/google/start", { method: "POST", body: { origin: s.base, gmail: true, send: true, accountId: work.id } });
    assert.equal((await s.api("/browser/google/finish", { method: "POST", body: { code: "work-code", state: new URL(start.json.url).searchParams.get("state") } })).status, 200);
    const live = await s.api("/everyday-inbox/summary", { method: "POST", body: {} });
    assert.equal(live.status, 200, live.text);
    assert.equal(live.json.sample, false);
    const labels = live.json.accounts.map((a) => a.label);
    assert.ok(labels.includes("Home") && labels.includes("Work"), labels.join(","));
    const subjects = live.json.accounts.flatMap((a) => a.headlines.map((h) => h.subject));
    assert.ok(subjects.includes("Thursday"));
    assert.ok(subjects.includes("Work question"));
    assert.equal(m.sent.length, 1, "reading inboxes does not send");

    const added = await s.api("/everyday-inbox/plain", { method: "POST", body: { text: TRY_REMIND } });
    assert.equal(added.status, 200, added.text);
    assert.equal(added.json.kind, "reminder");
    assert.equal(added.json.item.title, "call Mom");
    const todo = await s.api("/everyday-inbox/plain", { method: "POST", body: { text: "buy milk" } });
    assert.equal(todo.json.kind, "todo");
    assert.equal(todo.json.item.title, "buy milk");
    const month = await s.api("/everyday-inbox/plain", { method: "POST", body: { text: TRY_TODO } });
    assert.equal(month.json.kind, "reminder");
    assert.match(month.json.item.title, /license/);
    const secret = await s.api("/everyday-inbox/plain", { method: "POST", body: { text: "Remind me of password hunter2" } });
    assert.equal(secret.status, 400);
    const bulk = await s.api("/everyday-inbox/bulk", { method: "POST", body: { kind: "todo", items: Array.from({ length: 11 }, (_, i) => `task ${i}`) } });
    assert.equal(bulk.json.needsConfirm, true);
    assert.equal(bulk.json.count, 11);
    assert.equal(bulk.json.sample.length, 3);
    assert.equal(bulk.json.saved.length, 0);
    const before = (await s.api("/everyday-inbox")).json.todos.length;
    assert.equal(before, 1);
    const saved = await s.api("/everyday-inbox/bulk", { method: "POST", body: { kind: "todo", confirm: true, items: Array.from({ length: 11 }, (_, i) => `task ${i}`) } });
    assert.equal(saved.json.saved.length, 11);
    const done = await s.api(`/everyday-inbox/todos/${todo.json.item.id}/done`, { method: "POST", body: {} });
    assert.equal(done.json.item.done, true);
    assert.equal((await s.api(`/everyday-inbox/reminders/${added.json.item.id}`, { method: "DELETE" })).status, 200);

    const t0 = Date.now();
    while (Date.now() - t0 < waitBudget(5000) && !s.log.includes("Sent a reply")) await new Promise((r) => setTimeout(r, 50));
    for (const sec of SECRETS) {
      assert.equal(s.log.includes(sec), false, "secret in the log");
      assert.equal(JSON.stringify(sent.json).includes(sec), false);
    }
    const dumped = fs.readdirSync(s.dir).filter((f) => f.endsWith(".json") || f.endsWith(".jsonl"));
    for (const f of dumped) {
      const text = fs.readFileSync(path.join(s.dir, f), "utf8");
      for (const sec of SECRETS) assert.equal(text.includes(sec), false, f);
    }
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});
