// Multi-account Gmail / Google and Outlook. The original account stays on its old vault id.
// Added accounts use mail-acct-<id> in the same vault. Tokens never come back in a response or the log.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";
import { SCOPES } from "../server/google.js";

const CLIENT_SECRET = "GOCSPX-mailacct-secret-0123456789";
const LEGACY = "ya29.legacy-mailbox-token-012345";
const WORK = "ya29.work-mailbox-token-012345678";
const HOME_MS = "ewA.outlook-home-token-012345678";
const WORK_MS = "ewA.outlook-work-token-012345678";
const XAI_KEY = "xai-mailacctfakefakefake";
const SECRETS = [CLIENT_SECRET, LEGACY, WORK, HOME_MS, WORK_MS, XAI_KEY];

function sse(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 8 } })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
function meta(id, from, subject) {
  return { id, snippet: subject, payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, { name: "Date", value: "Tue, 20 Oct 2026" }], mimeType: "text/plain", body: { data: b64(subject) } } };
}

async function mock() {
  const m = { script: [], hits: [] };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "grok-4.3" }] });
    if (url.pathname === "/xai/v1/chat/completions") {
      const j = JSON.parse(body);
      const sys = j.messages.find((x) => x.role === "system")?.content || "";
      const user = j.messages.filter((x) => x.role === "user").map((x) => x.content).join("\n");
      if (/^You drive a web browser/.test(sys)) {
        const next = m.script.shift();
        const a = typeof next === "function" ? next(user) : next || { action: "done", answer: "script ran out" };
        return sse(res, JSON.stringify(a));
      }
      return sse(res, "ok");
    }
    if (url.pathname === "/oauth/token") {
      const f = Object.fromEntries(new URLSearchParams(body));
      m.hits.push({ path: url.pathname, grant: f.grant_type, code: f.code });
      if (f.client_secret !== CLIENT_SECRET) return send(401, { error: "invalid_client" });
      const access = f.code === "good-code" ? LEGACY : f.code === "work-code" ? WORK : "";
      if (f.grant_type === "authorization_code" && !access) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: access, refresh_token: "refresh-not-logged", expires_in: 3600, scope: `${SCOPES.gmail} ${SCOPES.drive}`, token_type: "Bearer" });
    }
    if (url.pathname === "/ms/common/oauth2/v2.0/token") {
      const f = Object.fromEntries(new URLSearchParams(body));
      m.hits.push({ path: url.pathname, code: f.code });
      const access = f.code === "ms-home" ? HOME_MS : f.code === "ms-work" ? WORK_MS : "";
      if (!access) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: access, refresh_token: "refresh-ms-not-logged", expires_in: 3600, scope: "https://graph.microsoft.com/Mail.Read offline_access", token_type: "Bearer" });
    }
    if (url.pathname.startsWith("/gmail/") || url.pathname.startsWith("/graph/")) {
      m.hits.push({ path: url.pathname, auth: req.headers.authorization || "", method: req.method });
      if (url.pathname.startsWith("/graph/")) return send(200, { value: [] });
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${LEGACY}` && auth !== `Bearer ${WORK}`) return send(401, { error: "unauthorized" });
      if (url.pathname === "/gmail/gmail/v1/users/me/messages" && req.method === "GET") {
        const id = auth.endsWith(WORK) ? "workmsg1" : "legmsg01";
        return send(200, { messages: [{ id }] });
      }
      if (url.pathname.endsWith("/workmsg1")) return send(200, meta("workmsg1", "work@shop.test", "Work inbox"));
      if (url.pathname.endsWith("/legmsg01")) return send(200, meta("legmsg01", "home@shop.test", "Home inbox"));
      return send(404, { error: "no route" });
    }
    if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/ms/")) { res.writeHead(200, { "content-type": "text/html" }); return res.end("signin"); }
    send(404, { error: `mock: ${url.pathname}` });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  m.base = `http://127.0.0.1:${srv.address().port}`;
  m.close = () => new Promise((r) => srv.close(r));
  return m;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(s, id, st) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const j = (await s.api("/browser/jobs")).json.find((x) => x.id === id);
    if (j && (Array.isArray(st) ? st : [st]).includes(j.status)) return j;
    await sleep(80);
  }
  throw new Error(`timed out on ${id}\n${s.log.slice(-1500)}`);
}

test("mail accounts: labels, default, add and remove, and each task uses the account it picked", async () => {
  const m = await mock();
  let s;
  const seen = [];
  try {
  s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BASE_URL_XAI: `${m.base}/xai/v1`,
    CC_GOOGLE_AUTH_URL: `${m.base}/auth`, CC_GOOGLE_TOKEN_URL: `${m.base}/oauth`,
    CC_GMAIL_API_URL: `${m.base}/gmail`, CC_DRIVE_API_URL: `${m.base}/drive`,
    CC_MS_LOGIN_URL: `${m.base}/ms`, CC_GRAPH_API_URL: `${m.base}/graph`,
    XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "",
    MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
    CC_GOOGLE_CLIENT_ID: "", CC_GMAIL_CLIENT_ID: "", CC_OUTLOOK_CLIENT_ID: "",
  } });
    assert.ok((await s.api("/state")).json.plugins.includes("mail-accounts"));
    let r = await s.api("/mail-accounts");
    assert.equal(r.status, 200); assert.deepEqual(r.json.accounts, []);
    assert.equal((await s.api("/mail-accounts", { method: "POST", body: { provider: "google" } })).status, 400);
    assert.equal((await s.api("/mail-accounts", { method: "POST", body: { provider: "imap", label: "Nope" } })).status, 400);
    assert.equal((await s.api("/mail-accounts/missing", { method: "DELETE" })).status, 404);

    await s.api("/keys", { method: "POST", body: { provider: "xai", key: XAI_KEY } });
    await s.api("/browser/google/client", { method: "POST", body: { clientId: "1234567890-test.apps.googleusercontent.com", clientSecret: CLIENT_SECRET } });

    // The original Google account (no accountId) stays the default.
    r = await s.api("/browser/google/start", { method: "POST", body: { origin: s.base, gmail: true, drive: true } });
    const legacyState = new URL(r.json.url).searchParams.get("state");
    r = await s.api("/browser/google/finish", { method: "POST", body: { code: "good-code", state: legacyState } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.connected, true);
    assert.ok(!r.text.includes(LEGACY) && !r.text.includes(CLIENT_SECRET));
    let accounts = (await s.api("/mail-accounts?provider=google")).json.accounts;
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, "google");
    assert.equal(accounts[0].legacy, true);
    assert.equal(accounts[0].isDefault, true);
    assert.equal(accounts[0].label, "Google");
    assert.equal(accounts[0].access, undefined);
    assert.equal(accounts[0].refresh, undefined);

    r = await s.api(`/mail-accounts/google/label`, { method: "POST", body: { label: "Home" } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.account.label, "Home");

    r = await s.api("/mail-accounts", { method: "POST", body: { provider: "google", label: "Work" } });
    assert.equal(r.status, 200, r.text);
    const work = r.json.account;
    assert.equal(work.label, "Work"); assert.equal(work.connected, false); assert.equal(work.isDefault, false); assert.equal(work.legacy, false);
    assert.match(work.id, /^ma_/);
    r = await s.api("/browser/google/start", { method: "POST", body: { origin: s.base, gmail: true, drive: true, accountId: work.id } });
    assert.equal(r.status, 200, r.text);
    r = await s.api("/browser/google/finish", { method: "POST", body: { code: "work-code", state: new URL(r.json.url).searchParams.get("state") } });
    assert.equal(r.status, 200, r.text);
    accounts = (await s.api("/mail-accounts?provider=google")).json.accounts;
    assert.equal(accounts.find((a) => a.id === work.id).connected, true);
    assert.equal(accounts.find((a) => a.id === "google").isDefault, true, "adding an account does not steal the default");

    const gmailAuth = () => m.hits.filter((h) => h.path === "/gmail/gmail/v1/users/me/messages").map((h) => h.auth);
    m.script.push(
      (u) => { assert.match(u, /GOOGLE: connected \(gmail, drive\) account "Work"/); return { action: "gmail_search", query: "in:inbox" }; },
      (u) => { assert.match(u, /from work@shop\.test/); return { action: "done", answer: "Work mailbox." }; },
    );
    let job = (await s.api("/browser/jobs", { method: "POST", body: { task: "Check the work inbox", accountId: work.id } })).json.job;
    assert.equal(job.accountId, work.id); assert.equal(job.accountLabel, "Work");
    let done = await until(s, job.id, ["done", "failed"]);
    assert.equal(done.status, "done", done.error);
    assert.deepEqual(gmailAuth(), [`Bearer ${WORK}`]);

    m.script.push(
      (u) => { assert.match(u, /account "Home"/); return { action: "gmail_search", query: "in:inbox" }; },
      (u) => { assert.match(u, /from home@shop\.test/); return { action: "done", answer: "Home mailbox." }; },
    );
    job = (await s.api("/browser/jobs", { method: "POST", body: { task: "Check the home inbox", accountId: "google" } })).json.job;
    done = await until(s, job.id, ["done", "failed"]);
    assert.equal(done.status, "done", done.error);
    assert.equal(gmailAuth().at(-1), `Bearer ${LEGACY}`);

    r = await s.api(`/mail-accounts/${encodeURIComponent(work.id)}/default`, { method: "POST", body: {} });
    assert.equal(r.json.accounts.find((a) => a.id === work.id).isDefault, true);
    assert.equal(r.json.accounts.find((a) => a.id === "google").isDefault, false);
    const before = gmailAuth().length;
    m.script.push(
      () => ({ action: "gmail_search", query: "in:inbox" }),
      (u) => { assert.match(u, /from work@shop\.test/); return { action: "done", answer: "Default is work." }; },
    );
    job = (await s.api("/browser/jobs", { method: "POST", body: { task: "Check the default inbox" } })).json.job;
    assert.equal(job.accountId, null, "omitted accountId means the default at run time");
    done = await until(s, job.id, ["done", "failed"]);
    assert.equal(done.status, "done", done.error);
    assert.equal(gmailAuth().slice(before).every((a) => a === `Bearer ${WORK}`), true, "a task with no account uses the default");

    assert.equal((await s.api("/browser/jobs", { method: "POST", body: { task: "Nope", accountId: "ma_missing" } })).status, 400);

    // Outlook, the read-only receipt mailbox, same three calls.
    await s.api("/services/mail/client", { method: "POST", body: { source: "outlook", clientId: "00000000-0000-0000-0000-000000000000" } });
    r = await s.api("/services/mail/start", { method: "POST", body: { source: "outlook", origin: s.base } });
    assert.equal((await s.api("/services/mail/finish", { method: "POST", body: { code: "ms-home", state: new URL(r.json.url).searchParams.get("state") } })).status, 200);
    r = await s.api("/mail-accounts", { method: "POST", body: { provider: "outlook", label: "Work mail" } });
    const msWork = r.json.account;
    assert.equal(msWork.isDefault, false);
    r = await s.api("/services/mail/start", { method: "POST", body: { source: "outlook", origin: s.base, accountId: msWork.id } });
    assert.equal((await s.api("/services/mail/finish", { method: "POST", body: { code: "ms-work", state: new URL(r.json.url).searchParams.get("state") } })).status, 200);
    const graphAuth = () => m.hits.filter((h) => h.path.startsWith("/graph/")).map((h) => h.auth);
    r = await s.api("/services/mail/scan", { method: "POST", body: { source: "outlook", accountId: "outlook" } });
    assert.equal(r.status, 200, r.text);
    assert.equal(graphAuth().at(-1), `Bearer ${HOME_MS}`);
    r = await s.api("/services/mail/scan", { method: "POST", body: { source: "outlook", accountId: msWork.id } });
    assert.equal(r.status, 200, r.text);
    assert.equal(graphAuth().at(-1), `Bearer ${WORK_MS}`);
    const outlook = (await s.api("/mail-accounts?provider=outlook")).json.accounts;
    assert.equal(outlook.length, 2);
    assert.ok(outlook.every((a) => a.connected));
    assert.equal((await s.api("/services")).json.mail.outlook.connected, true, "the original mailbox flag stays");

    r = await s.api(`/mail-accounts/${encodeURIComponent(work.id)}`, { method: "DELETE" });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.json.accounts.some((a) => a.id === work.id));
    assert.equal((await s.api("/browser/jobs", { method: "POST", body: { task: "Check work again", accountId: work.id } })).status, 400);
    r = await s.api("/mail-accounts/google", { method: "DELETE" });
    assert.equal(r.status, 200, r.text);
    assert.equal((await s.api("/browser/google")).json.clientSecretSaved, true, "removing the original account keeps the client secret");
    assert.equal((await s.api("/browser/google")).json.connected, false);

    const dumped = [];
    const walk = async (p, fn) => { const r2 = await fn(); dumped.push(r2.text || ""); return r2; };
    await walk("/mail-accounts", () => s.api("/mail-accounts"));
    await walk("/browser", () => s.api("/browser"));
    await walk("/services", () => s.api("/services"));
    await walk("/state", () => s.api("/state"));
    for (const sec of SECRETS) {
      assert.ok(!s.log.includes(sec), "never in the log");
      assert.ok(dumped.every((t) => !t.includes(sec)), "never in a response");
      for (const f of fs.readdirSync(s.dir)) {
        if (!f.endsWith(".json") && !f.endsWith(".jsonl")) continue;
        assert.ok(!fs.readFileSync(path.join(s.dir, f), "utf8").includes(sec), `${f} has no secret`);
      }
    }
    seen.push("ok");
  } finally {
    if (s) await s.stop();
    await m.close();
  }
  assert.equal(seen[0], "ok");
});
