// One-click Sign in with Google and Sign in with Microsoft (0.4.17): PKCE, the shipped client
// config with env overrides, the narrow first-sign-in scopes, the separate Read my inbox step,
// the coming-soon fallback when no client id is set, and the one-shot loopback listener that
// closes after the browser comes back. Google and Microsoft are stand-ins on 127.0.0.1.
// No real Google or Microsoft address is called. Real waits, and every server is closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { startServer, waitBudget, tmpDir, raw } from "./helpers.js";
import { pkcePair, challengeFor, shippedClient, openLoopback, activeListeners, readClientFile, CLIENTS_FILE } from "../server/oauth-signin.js";
import { prepareOAuthSecret, googleSecretFromEnv, MISSING_SECRET } from "../scripts/inject-oauth-secret.mjs";

const SHIPPED_GOOGLE = "882564991373-1kkdvhs6bv58eba41m8g65ujqufiktka.apps.googleusercontent.com";
const SHIPPED_MS = "6873253c-9ea8-4c36-a57b-4c9668b050a4";

const G_ID = "1234567890-oneclick.apps.googleusercontent.com";
const G_SECRET = "oneclick-test-desktop-secret";
const MS_ID = "00000000-1111-2222-3333-444444444444";
const ACCESS = "oneclick-test-access-token";
const REFRESH = "oneclick-test-refresh-token";
const S = {
  calendar: "https://www.googleapis.com/auth/calendar.events",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  send: "https://www.googleapis.com/auth/gmail.send",
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  compose: "https://www.googleapis.com/auth/gmail.compose",
};
const EM = "\u2014", EN = "\u2013";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portRefuses(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(false); });
    sock.once("error", () => resolve(true));
  });
}

async function waitFor(fn, ms = waitBudget(10000)) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await sleep(150);
  }
  return last;
}

// ---------- pure parts ----------

test("PKCE pair: a long random verifier and its S256 challenge", () => {
  const a = pkcePair(), b = pkcePair();
  assert.equal(a.method, "S256");
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(a.verifier, b.verifier);
  assert.equal(a.challenge, crypto.createHash("sha256").update(a.verifier).digest("base64url"));
  assert.equal(challengeFor(a.verifier), a.challenge);
});

test("shipped client config: public ids committed, no secret, env overrides them", () => {
  const file = readClientFile(CLIENTS_FILE);
  assert.equal(file.google?.clientId, SHIPPED_GOOGLE);
  assert.equal(file.microsoft?.clientId, SHIPPED_MS);
  assert.equal("clientSecret" in (file.google || {}), false, "no secret is committed");
  assert.equal("clientSecret" in (file.microsoft || {}), false);
  // Google needs its desktop secret before one-click is ready. Microsoft is a public client.
  const g0 = shippedClient("google", { env: {}, file: CLIENTS_FILE });
  assert.deepEqual([g0.ready, g0.hasId, g0.clientId, g0.clientSecret], [false, true, SHIPPED_GOOGLE, null]);
  const m0 = shippedClient("microsoft", { env: {}, file: CLIENTS_FILE });
  assert.deepEqual([m0.ready, m0.clientId, m0.clientSecret], [true, SHIPPED_MS, null]);
  const g1 = shippedClient("google", { env: { CC_GOOGLE_CLIENT_SECRET: G_SECRET }, file: CLIENTS_FILE });
  assert.deepEqual([g1.ready, g1.clientId, g1.clientSecret], [true, SHIPPED_GOOGLE, G_SECRET]);
  assert.equal(shippedClient("google", { env: { CC_GOOGLE_CLIENT_SECRET: "has a space" }, file: CLIENTS_FILE }).ready, false);
  const g = shippedClient("google", { env: { CC_GOOGLE_CLIENT_ID: G_ID, CC_GOOGLE_CLIENT_SECRET: G_SECRET }, file: CLIENTS_FILE });
  assert.deepEqual([g.ready, g.clientId, g.clientSecret], [true, G_ID, G_SECRET]);
  const m = shippedClient("microsoft", { env: { CC_MS_CLIENT_ID: MS_ID }, file: CLIENTS_FILE });
  assert.deepEqual([m.ready, m.clientId, m.clientSecret], [true, MS_ID, null]);
  assert.equal(shippedClient("google", { env: { CC_GOOGLE_CLIENT_ID: "bad id with spaces" }, file: CLIENTS_FILE }).ready, false);
  const dir = tmpDir("cc-oauth-file-");
  try {
    const f = path.join(dir, "clients.json");
    fs.writeFileSync(f, JSON.stringify({ google: { clientId: "from-file-client-1234" }, microsoft: { clientId: "" } }));
    assert.equal(shippedClient("google", { env: {}, file: f }).clientId, "from-file-client-1234");
    assert.equal(shippedClient("microsoft", { env: {}, file: f }).ready, false);
    assert.equal(shippedClient("google", { env: { CC_GOOGLE_CLIENT_ID: G_ID }, file: f }).clientId, G_ID);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("loopback: one callback, the code reaches finish, and the listener closes", async () => {
  let got = null;
  const before = activeListeners();
  const run = await openLoopback({
    begin: async (redirectUri) => ({ url: `http://127.0.0.1:1/auth?redirect_uri=${encodeURIComponent(redirectUri)}`, state: "st-123" }),
    finish: async (q) => { got = q; return { ok: true }; },
    timeoutMs: waitBudget(20000),
  });
  try {
    assert.match(run.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal(activeListeners(), before + 1);
    const miss = await raw({ port: run.port, path: "/favicon.ico" });
    assert.equal(miss.status, 404);
    const r = await raw({ port: run.port, path: "/callback?code=abc&state=st-123" });
    assert.equal(r.status, 200);
    assert.match(r.text, /You are signed in/);
    assert.deepEqual(got, { code: "abc", state: "st-123" });
    assert.ok(await waitFor(() => portRefuses(run.port)), "the listener closed");
    assert.equal(activeListeners(), before);
  } finally { await run.handle.close(); }
});

test("loopback: a wrong state is refused, and the listener closes on its own after the wait", async () => {
  let called = 0;
  const done = [];
  const run = await openLoopback({
    begin: async () => ({ url: "http://127.0.0.1:1/auth", state: "good" }),
    finish: async () => { called++; return {}; },
    onDone: (x) => done.push(x),
    timeoutMs: waitBudget(20000),
  });
  try {
    const r = await raw({ port: run.port, path: "/callback?code=abc&state=evil" });
    assert.equal(r.status, 400);
    assert.match(r.text, /does not match/);
    assert.equal(called, 0);
    assert.equal(done[0]?.ok, false);
    assert.ok(await waitFor(() => portRefuses(run.port)));
  } finally { await run.handle.close(); }
  const timed = await openLoopback({ begin: async () => ({ url: "http://127.0.0.1:1/auth", state: "s" }), finish: async () => ({}), timeoutMs: 400 });
  try {
    await sleep(waitBudget(1200));
    assert.equal(timed.handle.closed, true);
    assert.ok(await waitFor(() => portRefuses(timed.port)));
  } finally { await timed.handle.close(); }
});

// ---------- through the app ----------

function idpMock() {
  const m = { hits: [], grant: { google: "", microsoft: "" }, challenges: {} };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const form = Object.fromEntries(new URLSearchParams(body));
    m.hits.push({ path: url.pathname, form });
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (url.pathname === "/google/token") {
      if (form.client_id !== G_ID || form.client_secret !== G_SECRET) return send(401, { error: "invalid_client" });
      if (form.grant_type === "authorization_code") {
        if (form.code !== "good-code") return send(400, { error: "invalid_grant" });
        const want = m.challenges[form.redirect_uri];
        if (!want || challengeFor(form.code_verifier) !== want) return send(400, { error: "invalid_grant", error_description: "PKCE check failed" });
      }
      return send(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: m.grant.google, token_type: "Bearer" });
    }
    if (url.pathname === "/common/oauth2/v2.0/token") {
      if (form.client_id !== MS_ID || form.client_secret) return send(401, { error: "invalid_client" });
      if (form.code !== "good-code") return send(400, { error: "invalid_grant" });
      const want = m.challenges[form.redirect_uri];
      if (!want || challengeFor(form.code_verifier) !== want) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: m.grant.microsoft, token_type: "Bearer" });
    }
    return send(404, { error: "no route" });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    m.base = `http://127.0.0.1:${server.address().port}`;
    m.close = () => new Promise((r) => server.close(r));
    resolve(m);
  }));
}

function envFor(m, extra = {}) {
  return {
    CC_STATUS_PAGES: "off",
    CC_SIGNIN_OPEN: "off",
    CC_GOOGLE_AUTH_URL: `${m.base}/google`,
    CC_GOOGLE_TOKEN_URL: `${m.base}/google`,
    CC_MS_LOGIN_URL: m.base,
    CC_GMAIL_API_URL: `${m.base}/gmail`,
    CC_DRIVE_API_URL: `${m.base}/drive`,
    CC_CALENDAR_API_URL: `${m.base}/calendar`,
    ...extra,
  };
}

const proStub = { rpc: () => ({ ok: true, tier: "pro", status: "active", email: "t@example.com", message: "ok" }) };
function seedKey(dir) {
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null }));
}
async function waitForTier(s, tier) {
  const st = await waitFor(async () => { const r = await s.api("/state"); return r.json?.license?.tier === tier ? r : null; }, waitBudget(20000));
  if (!st) throw new Error(`tier never became ${tier}`);
}

// Starts a sign-in, then plays the browser coming back to the loopback address.
async function signIn(s, m, provider, step, grant) {
  const start = await s.api(`/signin/${provider}`, { method: "POST", body: { step } });
  assert.equal(start.status, 200, start.text);
  const u = new URL(start.json.url);
  const redirect = new URL(u.searchParams.get("redirect_uri"));
  m.challenges[redirect.toString()] = u.searchParams.get("code_challenge");
  m.grant[provider] = grant;
  const port = Number(redirect.port);
  const back = await raw({ port, path: `/callback?code=good-code&state=${encodeURIComponent(u.searchParams.get("state"))}` });
  const closed = await waitFor(() => portRefuses(port));
  return { start, u, redirect, back, closed };
}

function emptyClientsFile() {
  const dir = tmpDir("cc-oauth-empty-");
  const file = path.join(dir, "oauth-clients.json");
  fs.writeFileSync(file, JSON.stringify({ google: { clientId: "" }, microsoft: { clientId: "" } }));
  return { file, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("no client id: both buttons say sign-in is coming and nothing opens", async () => {
  const m = await idpMock();
  const empty = emptyClientsFile();
  let s;
  try {
    s = await startServer({ env: envFor(m, { CC_OAUTH_CLIENTS_FILE: empty.file }) });
    const st = await s.api("/signin");
    assert.equal(st.status, 200, st.text);
    assert.equal(st.json.google.ready, false);
    assert.equal(st.json.microsoft.ready, false);
    assert.match(st.json.google.comingSoon, /coming soon/);
    assert.match(st.json.google.comingSoon, /own Google sign-in app under Advanced/);
    const g = await s.api("/signin/google", { method: "POST", body: { step: "first" } });
    assert.equal(g.status, 400);
    assert.equal(g.json.code, "coming_soon");
    const ms = await s.api("/signin/microsoft", { method: "POST", body: { step: "first" } });
    assert.equal(ms.json.code, "coming_soon");
    assert.equal(m.hits.length, 0);
    // the own-client path under Advanced still works as before
    const own = await s.api("/browser/google/client", { method: "POST", body: { clientId: "own-client-1234.apps.googleusercontent.com", clientSecret: "own-secret" } });
    assert.equal(own.status, 200, own.text);
    const ownStart = await s.api("/browser/google/start", { method: "POST", body: { origin: s.base, calendar: true } });
    assert.equal(ownStart.status, 200, ownStart.text);
    assert.equal(new URL(ownStart.json.url).searchParams.get("client_id"), "own-client-1234.apps.googleusercontent.com");
  } finally {
    if (s) await s.stop();
    await m.close();
    empty.done();
  }
});

test("shipped ids, no Google secret: Google falls back to Advanced, Microsoft still signs in", async () => {
  const m = await idpMock();
  let s;
  try {
    s = await startServer({ env: envFor(m) });
    const st = (await s.api("/signin")).json;
    assert.equal(st.google.ready, false);
    assert.match(st.google.comingSoon, /own Google sign-in app under Advanced/);
    assert.equal(st.microsoft.ready, true);
    const g = await s.api("/signin/google", { method: "POST", body: { step: "first" } });
    assert.equal(g.status, 400);
    assert.equal(g.json.code, "coming_soon");
    // the Advanced own-client path does not borrow the shipped Google id
    const own = await s.api("/browser/google/start", { method: "POST", body: { origin: s.base, calendar: true } });
    assert.equal(own.status, 400);
    assert.equal(own.json.code, "client_id");
    const ms = await s.api("/signin/microsoft", { method: "POST", body: { step: "first" } });
    assert.equal(ms.status, 200, ms.text);
    const u = new URL(ms.json.url);
    assert.equal(u.pathname, "/common/oauth2/v2.0/authorize", "the common authority");
    assert.equal(u.searchParams.get("client_id"), SHIPPED_MS);
    assert.deepEqual(u.searchParams.get("scope").split(" "), ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Send", "Calendars.ReadWrite"]);
    const redirect = new URL(u.searchParams.get("redirect_uri"));
    assert.equal(redirect.hostname, "localhost");
    assert.match(redirect.port, /^\d+$/);
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(u.searchParams.has("client_secret"), false);
    await s.api("/signin/microsoft/cancel", { method: "POST" });
    assert.ok(await waitFor(() => portRefuses(Number(redirect.port))));
  } finally {
    if (s) await s.stop();
    await m.close();
  }
  const src = fs.readFileSync(new URL("../server/microsoft.js", import.meta.url), "utf8");
  assert.match(src, /"https:\/\/login\.microsoftonline\.com"/);
  assert.match(src, /\/common\/oauth2\/v2\.0\/authorize/);
});

test("Google one-click: narrow first sign-in, separate Read my inbox, tokens only in the vault", async () => {
  const m = await idpMock();
  let s;
  try {
    s = await startServer({ env: envFor(m, { CC_GOOGLE_CLIENT_ID: G_ID, CC_GOOGLE_CLIENT_SECRET: G_SECRET }), cloud: proStub, seed: seedKey });
    await waitForTier(s, "pro");
    const ready = await s.api("/signin");
    assert.equal(ready.json.google.ready, true);
    assert.equal(JSON.stringify(ready.json).includes(G_SECRET), false);

    const first = await signIn(s, m, "google", "first", `${S.calendar} ${S.driveFile} ${S.send}`);
    const scopes = first.u.searchParams.get("scope").split(" ").sort();
    assert.deepEqual(scopes, ["openid", "email", "profile", S.calendar, S.driveFile, S.send].sort());
    assert.equal(scopes.includes(S.gmail), false, "no restricted read scope on the first sign-in");
    assert.equal(scopes.includes(S.compose), false);
    assert.equal(first.u.searchParams.get("client_id"), G_ID);
    assert.equal(first.u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(first.redirect.hostname, "127.0.0.1");
    assert.equal(first.redirect.pathname, "/callback");
    assert.equal(first.back.status, 200, first.back.text);
    assert.match(first.back.text, /You are signed in/);
    assert.ok(first.closed, "the loopback listener closed after the callback");

    let st = (await s.api("/signin")).json;
    assert.equal(st.google.connected, true);
    assert.equal(st.google.inbox.granted, false);
    assert.equal(st.google.waiting, false);
    const setup = await s.api("/connectsetup");
    for (const id of ["calendar", "drive", "gmail"]) assert.equal(setup.json.items.find((it) => it.id === id).status, "Connected", id);

    const inbox = await signIn(s, m, "google", "inbox", `${S.calendar} ${S.driveFile} ${S.send} ${S.gmail}`);
    assert.ok(inbox.u.searchParams.get("scope").split(" ").includes(S.gmail));
    assert.equal(inbox.u.searchParams.get("include_granted_scopes"), "true");
    assert.equal(inbox.back.status, 200, inbox.back.text);
    assert.ok(inbox.closed);
    st = (await s.api("/signin")).json;
    assert.equal(st.google.inbox.granted, true);

    const text = JSON.stringify(st) + JSON.stringify((await s.api("/browser/google")).json) + JSON.stringify(setup.json);
    assert.equal(text.includes(ACCESS) || text.includes(REFRESH) || text.includes(G_SECRET), false);
    await sleep(200);
    assert.equal(s.log.includes(ACCESS) || s.log.includes(REFRESH) || s.log.includes(G_SECRET), false, "no token in the log");
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});

test("Google one-click on Free asks only for what fits the plan", async () => {
  const m = await idpMock();
  let s;
  try {
    s = await startServer({ env: envFor(m, { CC_GOOGLE_CLIENT_ID: G_ID, CC_GOOGLE_CLIENT_SECRET: G_SECRET }) });
    const start = await s.api("/signin/google", { method: "POST", body: { step: "first" } });
    assert.equal(start.status, 200, start.text);
    assert.deepEqual(new URL(start.json.url).searchParams.get("scope").split(" "), ["openid", "email", "profile", S.calendar]);
    assert.match(start.json.note, /Pro includes all of them/);
    const cancel = await s.api("/signin/google/cancel", { method: "POST" });
    assert.equal(cancel.json.google.waiting, false);
    const port = Number(new URL(new URL(start.json.url).searchParams.get("redirect_uri")).port);
    assert.ok(await waitFor(() => portRefuses(port)));
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});

test("Microsoft one-click: public client, localhost redirect, send and calendar first", async () => {
  const m = await idpMock();
  let s;
  try {
    s = await startServer({ env: envFor(m, { CC_MS_CLIENT_ID: MS_ID }), cloud: proStub, seed: seedKey });
    await waitForTier(s, "pro");
    const r = await signIn(s, m, "microsoft", "first", "Mail.Send Calendars.ReadWrite openid profile email User.Read");
    const scopes = r.u.searchParams.get("scope").split(" ");
    assert.deepEqual(scopes.sort(), ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Send", "Calendars.ReadWrite"].sort());
    assert.equal(scopes.some((x) => /Mail\.Read/.test(x)), false);
    assert.equal(r.redirect.hostname, "localhost");
    assert.equal(r.u.searchParams.get("code_challenge_method"), "S256");
    assert.equal(r.back.status, 200, r.back.text);
    assert.ok(r.closed);
    const tok = m.hits.find((h) => h.path === "/common/oauth2/v2.0/token");
    assert.equal(tok.form.client_secret, undefined, "no secret for the public client");
    const st = (await s.api("/signin")).json;
    assert.equal(st.microsoft.connected, true);
    assert.deepEqual(st.microsoft.scopes.map((x) => x.id).sort(), ["calendar", "send"]);
    assert.equal(st.microsoft.inbox.granted, false);

    const inbox = await signIn(s, m, "microsoft", "inbox", "Mail.Read Mail.Send Calendars.ReadWrite");
    assert.ok(inbox.u.searchParams.get("scope").includes("Mail.Read"));
    assert.equal(inbox.back.status, 200, inbox.back.text);
    const after = (await s.api("/signin")).json;
    assert.equal(after.microsoft.inbox.granted, true);
    const outlook = (await s.api("/connectsetup")).json.items.find((it) => it.id === "outlook");
    assert.equal(outlook.status, "Connected");
    assert.equal(JSON.stringify(after).includes(ACCESS), false);

    const off = await s.api("/signin/microsoft", { method: "DELETE" });
    assert.equal(off.json.microsoft.connected, false);
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});

test("help and UI text: plain words, no dashes, Advanced path kept", () => {
  const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const files = ["docs/help/calendar.md", "docs/help/connect-your-apps.md", "web/features/app-signin.js", "server/oauth-signin.js", "server/microsoft.js", "server/plugins/signin.js", "scripts/inject-oauth-secret.mjs", "docs/RELEASING.md", "docs/roadmap.md"];
  for (const f of files) assert.equal(read(f).includes(EM) || read(f).includes(EN), false, f);
  assert.match(read("docs/help/calendar.md"), /Sign in with Google/);
  assert.match(read("docs/help/calendar.md"), /Read my inbox/);
  assert.match(read("docs/help/connect-your-apps.md"), /Sign in with Microsoft/);
  assert.match(read("web/features/browser.js"), /Advanced: use my own Google client/);
  assert.match(read("web/features/app-signin.js"), /window\.CC\.appSignIn = \{ html, wire/);
});

test("build injection: the Google secret goes into a copy for the build, is cleared, and is never printed", () => {
  const dir = tmpDir("cc-oauth-inject-");
  const file = path.join(dir, "oauth-clients.json");
  const original = fs.readFileSync(CLIENTS_FILE, "utf8");
  fs.writeFileSync(file, original);
  const logs = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  try {
    const none = prepareOAuthSecret({ file, env: {} });
    assert.equal(none.wrote, false);
    assert.equal(none.message, MISSING_SECRET);
    assert.equal(fs.readFileSync(file, "utf8"), original);
    assert.equal(googleSecretFromEnv({ CC_GOOGLE_CLIENT_SECRET: "local-one" }), "local-one");
    assert.equal(googleSecretFromEnv({ GOOGLE_OAUTH_CLIENT_SECRET: "build-one", CC_GOOGLE_CLIENT_SECRET: "local-one" }), "build-one");
    const odd = prepareOAuthSecret({ file, env: { GOOGLE_OAUTH_CLIENT_SECRET: "has spaces in it" } });
    assert.equal(odd.wrote, false);
    const p = prepareOAuthSecret({ file, env: { GOOGLE_OAUTH_CLIENT_SECRET: G_SECRET } });
    assert.equal(p.wrote, true);
    const during = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(during.google.clientSecret, G_SECRET);
    assert.equal(during.google.clientId, SHIPPED_GOOGLE);
    assert.equal(shippedClient("google", { env: {}, file }).ready, true);
    assert.equal(p.message.includes(G_SECRET), false);
    p.restore();
    p.restore();
    assert.equal(fs.readFileSync(file, "utf8"), original, "the file bytes are put back");
    assert.equal(logs.some((l) => l.includes(G_SECRET)), false, "nothing printed the secret");
  } finally {
    console.log = orig.log; console.error = orig.error;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(fs.readFileSync(CLIENTS_FILE, "utf8"), original, "the real file was not touched");
  const inject = fs.readFileSync(new URL("../scripts/inject-cloud-key.mjs", import.meta.url), "utf8");
  assert.match(inject, /prepareOAuthSecret\(\)/);
  assert.match(inject, /finally \{\s+try \{ oauth\.restore\(\); \}/, "cleared even when the build fails");
  const wf = fs.readFileSync(new URL("../.github/workflows/release-windows.yml", import.meta.url), "utf8");
  const uses = wf.match(/GOOGLE_OAUTH_CLIENT_SECRET: \$\{\{ secrets\.GOOGLE_OAUTH_CLIENT_SECRET \}\}/g) || [];
  assert.equal(uses.length, 1, "the Windows build step only (the Mac build is gated off until 0.7.0)");
  assert.equal((wf.match(/secrets\.GOOGLE_OAUTH_CLIENT_SECRET/g) || []).length, 1);
  assert.doesNotMatch(wf, /echo[^\n]*GOOGLE_OAUTH_CLIENT_SECRET/);
  const winBuild = wf.slice(wf.indexOf("- name: Build the Windows installer"), wf.indexOf("- name: Verify the installer signature"));
  assert.match(winBuild, /GOOGLE_OAUTH_CLIENT_SECRET: \$\{\{ secrets\.GOOGLE_OAUTH_CLIENT_SECRET \}\}/);
  const macBuild = wf.slice(wf.indexOf("- name: Build unsigned dmg and zip"), wf.indexOf("- name: Upload to the releases repo"));
  assert.doesNotMatch(macBuild, /GOOGLE_OAUTH_CLIENT_SECRET/, "the Mac workflow is not touched");
  assert.doesNotMatch(fs.readFileSync(new URL("../.github/workflows/windows-ci.yml", import.meta.url), "utf8"), /GOOGLE_OAUTH_CLIENT_SECRET/, "PR CI gets no secret");
});

test("roadmap names Google Meet transcripts for 0.6.0", () => {
  assert.match(fs.readFileSync(new URL("../docs/roadmap.md", import.meta.url), "utf8"), /Google Meet transcripts are planned for 0\.6\.0/);
});
