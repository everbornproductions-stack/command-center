// Phase 54: a plain request is drafted by a cheap model, then Gmail and Calendar
// run only after Approve. Mocks stay on 127.0.0.1. No real key and no real host.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "./helpers.js";
import { costNote } from "../server/actions.js";
import * as G from "../server/google.js";

const KEY = "xai-phase54DraftKey000001";
const ACCESS = "actions-test-access-token";
const REFRESH = "actions-test-refresh-token";
const SECRET = "actions-test-client-secret";
const CLIENT = "1234567890-actions.apps.googleusercontent.com";
const EM = "\u2014";
const BLANK = {
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
  PERPLEXITY_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "",
  CC_GOOGLE_CLIENT_ID: "", CC_STATUS_PAGES: "off",
};

function standIn() {
  const m = { hits: [], chats: [], grantScope: "", events: [] };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    if ((req.headers.authorization || "").includes(KEY) && url.pathname.includes(KEY)) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "key leaked into the URL" } }));
      return;
    }
    m.hits.push({ method: req.method, path: url.pathname, body });
    const send = (code, obj, type = "application/json") => {
      res.writeHead(code, { "content-type": type });
      res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
    };
    if (url.pathname.endsWith("/models")) return send(200, { data: [{ id: "grok-build-0.1" }] });
    if (url.pathname.endsWith("/chat/completions")) {
      const j = JSON.parse(body);
      m.chats.push(j);
      const start = new Date(Date.now() + 3600 * 1000).toISOString();
      const end = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      const text = JSON.stringify({
        email: { to: "", subject: "Note for this client", body: "Hello,\n\nFollowing up as you asked.\n" },
        event: { summary: "Client meeting", start, end, description: "From the request.", location: "Office" },
      });
      const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 30 } })}\n\ndata: [DONE]\n\n`;
      return send(200, payload, "text/event-stream");
    }
    if (url.pathname === "/oauth/token") {
      const form = Object.fromEntries(new URLSearchParams(body));
      if (form.client_secret !== SECRET) return send(401, { error: "invalid_client" });
      return send(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: m.grantScope, token_type: "Bearer" });
    }
    if (req.headers.authorization !== `Bearer ${ACCESS}`) return send(401, { error: "unauthorized" });
    if (url.pathname === "/gmail/gmail/v1/users/me/messages/send" && req.method === "POST") return send(200, { id: "sent-1" });
    if (url.pathname === "/calendar/calendars/primary/events" && req.method === "POST") {
      const ev = { id: "evt_test_1", status: "confirmed", htmlLink: "https://calendar.google.com/calendar/event?eid=evt_test_1", ...JSON.parse(body) };
      m.events.push(ev);
      return send(200, ev);
    }
    return send(404, { error: "no route" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base, hits: m.hits, chats: m.chats,
        set grantScope(v) { m.grantScope = v; },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const writes = (m) => m.hits.filter((h) => h.path.includes("/messages/send") || (h.path.startsWith("/calendar/") && h.method !== "GET"));

test("cost wording, the tour example, and the help articles", () => {
  const tiny = costNote(0.0001);
  assert.equal(tiny.label, "$0.000100");
  assert.match(tiny.note, /fraction of a cent/);
  assert.match(costNote(0).note, /\$0\.00/);
  const tour = fs.readFileSync(new URL("../web/features/tour.js", import.meta.url), "utf8");
  const help = fs.readFileSync(new URL("../docs/help/plain-requests.md", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../web/features/actions.js", import.meta.url), "utf8");
  const guide = fs.readFileSync(new URL("../docs/USER-GUIDE.md", import.meta.url), "utf8");
  for (const text of [tour, help, ui, guide]) {
    assert.match(text, /email this client and put it on my calendar/);
    assert.equal(text.includes(EM), false);
  }
  assert.match(tour, /title: "Try saying\.\.\."/);
  assert.match(help, /only after you click Approve once/);
  assert.match(help, /does not touch your accounts/);
  assert.match(ui, /id="plain-approve"/);
});

test("demo mode drafts the example and does not send before Calendar and Gmail are connected", async () => {
  const s = await startServer({ env: { ...BLANK } });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const drafted = await s.api("/actions/draft", { method: "POST", body: { text: "email this client and put it on my calendar" } });
    assert.equal(drafted.status, 200, drafted.text);
    assert.equal(drafted.json.email.subject, "Note for this client");
    assert.equal(drafted.json.event.summary, "Client meeting");
    assert.match(drafted.json.note, /fraction of a cent|\$0\.00/);
    assert.equal(drafted.json.status, "draft");
    const refused = await s.api(`/actions/${drafted.json.id}/approve`, { method: "POST", body: {} });
    assert.equal(refused.status, 409, refused.text);
    assert.match(refused.json.error, /Nothing was sent/);
    assert.equal(drafted.text.includes(KEY), false);
  } finally { await s.stop(); }
});

test("approve is the only click that sends the email and creates the event", async () => {
  const m = await standIn();
  let s;
  try {
    s = await startServer({ env: {
      ...BLANK,
      CC_DEV_OWNER: "1",
      CC_BASE_URL_XAI: `${m.base}/v1`,
      CC_GOOGLE_AUTH_URL: `${m.base}/auth`,
      CC_GOOGLE_TOKEN_URL: `${m.base}/oauth`,
      CC_GMAIL_API_URL: `${m.base}/gmail`,
      CC_CALENDAR_API_URL: `${m.base}/calendar`,
    } });
    const saved = await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEY } });
    assert.equal(saved.json?.status?.status, "green", saved.text);
    assert.equal(saved.text.includes(KEY), false);
    const client = await s.api("/browser/google/client", { method: "POST", body: { clientId: CLIENT, clientSecret: SECRET } });
    assert.equal(client.status, 200, client.text);
    const start = await s.api("/browser/google/start", { method: "POST", body: { origin: s.base, send: true, calendar: true } });
    assert.equal(start.status, 200, start.text);
    assert.equal(new URL(start.json.url).hostname, "127.0.0.1");
    m.grantScope = `${G.SCOPES.send} ${G.SCOPES.calendar}`;
    const fin = await s.api("/browser/google/finish", { method: "POST", body: { code: "good-code", state: new URL(start.json.url).searchParams.get("state") } });
    assert.equal(fin.status, 200, fin.text);

    const drafted = await s.api("/actions/draft", { method: "POST", body: { text: "email this client and put it on my calendar" } });
    assert.equal(drafted.status, 200, drafted.text);
    assert.equal(drafted.json.email.to, "");
    assert.equal(drafted.json.event.summary, "Client meeting");
    assert.ok(drafted.json.cost > 0 && drafted.json.cost < 0.01, String(drafted.json.cost));
    assert.match(drafted.json.note, /fraction of a cent/);
    assert.equal(writes(m).length, 0, "drafting does not touch Gmail or Calendar");
    assert.ok(m.chats.some((c) => /PLAIN_REQUEST_ACTION/.test(c.messages.find((x) => x.role === "system")?.content || "")));
    assert.equal(JSON.stringify(m.chats).includes(ACCESS), false);
    assert.equal(JSON.stringify(m.chats).includes(SECRET), false);

    const early = await s.api(`/actions/${drafted.json.id}/approve`, { method: "POST", body: {} });
    assert.equal(early.status, 400, early.text);
    assert.match(early.json.error, /Nothing was sent/);
    assert.equal(writes(m).length, 0);

    const ok = await s.api(`/actions/${drafted.json.id}/approve`, { method: "POST", body: {
      email: { to: "sam@client.test", subject: "Note for this client", body: "Hello Sam,\n\nSee you at the meeting.\n" },
    } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.status, "done");
    assert.deepEqual(ok.json.emailSent.to, ["sam@client.test"]);
    assert.equal(ok.json.eventCreated.summary, "Client meeting");
    assert.equal(ok.json.eventCreated.id, "evt_test_1");
    const sent = writes(m);
    assert.equal(sent.filter((h) => h.path.includes("/messages/send")).length, 1);
    assert.equal(sent.filter((h) => h.path.startsWith("/calendar/") && h.method === "POST").length, 1);
    const raw = JSON.parse(sent.find((h) => h.path.includes("/messages/send")).body).raw;
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    assert.match(mime, /To: sam@client\.test/);
    assert.match(mime, /Hello Sam/);

    const again = await s.api(`/actions/${drafted.json.id}/approve`, { method: "POST", body: {} });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.json.status, "done");
    assert.equal(writes(m).filter((h) => h.path.includes("/messages/send")).length, 1, "a second click does not send again");
    const dumped = `${drafted.text}\n${ok.text}\n${again.text}\n${s.log}`;
    assert.equal(dumped.includes(KEY) || dumped.includes(ACCESS) || dumped.includes(SECRET) || dumped.includes(REFRESH), false);
    assert.equal(dumped.includes(EM), false);
    const help = await s.api("/help");
    assert.ok(help.json.articles.some((a) => a.id === "plain-requests" && a.body.includes("Approve")));
    assert.ok(help.json.articles.some((a) => a.id === "calendar"));
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});
