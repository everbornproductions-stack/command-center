// Phase 53: Google Calendar OAuth, list / create / update, the setup checklist, and the
// Free 1 / Pro all connected-service limit. Grok Bot's calendar handoff stays.
// The Google stand-in is on 127.0.0.1. No real key and no real Google host.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, waitBudget } from "./helpers.js";
import * as G from "../server/google.js";
import { TIERS } from "../server/license.js";
import { TAGS, agentNeeds } from "../server/grokbot.js";
import { buildCatalog } from "../server/connect-setup.js";

const ACCESS = "calendar-test-access-token";
const REFRESH = "calendar-test-refresh-token";
const SECRET = "calendar-test-client-secret";
const CLIENT = "1234567890-calendar.apps.googleusercontent.com";
const EM = "\u2014";

function googleMock() {
  const m = { hits: [], events: [], grantScope: "" };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    m.hits.push({ method: req.method, path: url.pathname, auth: req.headers.authorization || "", body });
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === "/oauth/token") {
      const form = Object.fromEntries(new URLSearchParams(body));
      if (form.client_secret !== SECRET) return send(401, { error: "invalid_client" });
      if (form.grant_type === "authorization_code" && form.code !== "good-code") return send(400, { error: "invalid_grant" });
      return send(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: m.grantScope, token_type: "Bearer" });
    }
    if (req.headers.authorization !== `Bearer ${ACCESS}`) return send(401, { error: "unauthorized" });
    if (url.pathname === "/calendar/calendars/primary/events" && req.method === "GET") {
      return send(200, { items: m.events });
    }
    if (url.pathname === "/calendar/calendars/primary/events" && req.method === "POST") {
      const ev = JSON.parse(body);
      const row = { id: "evt_test_1", status: "confirmed", htmlLink: "https://calendar.google.com/calendar/event?eid=evt_test_1", ...ev };
      m.events.push(row);
      return send(200, row);
    }
    const upd = url.pathname.match(/^\/calendar\/calendars\/primary\/events\/([A-Za-z0-9_-]+)$/);
    if (upd && req.method === "PATCH") {
      const row = m.events.find((e) => e.id === upd[1]);
      if (!row) return send(404, { error: "not found" });
      Object.assign(row, JSON.parse(body));
      return send(200, row);
    }
    return send(404, { error: "no route" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base, hits: m.hits, events: m.events,
        get grantScope() { return m.grantScope; },
        set grantScope(v) { m.grantScope = v; },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function envFor(m) {
  return {
    CC_STATUS_PAGES: "off",
    CC_GOOGLE_CLIENT_ID: "",
    CC_GOOGLE_AUTH_URL: `${m.base}/auth`,
    CC_GOOGLE_TOKEN_URL: `${m.base}/oauth`,
    CC_GMAIL_API_URL: `${m.base}/gmail`,
    CC_DRIVE_API_URL: `${m.base}/drive`,
    CC_CALENDAR_API_URL: `${m.base}/calendar`,
  };
}

async function saveClient(s) {
  const r = await s.api("/browser/google/client", { method: "POST", body: { clientId: CLIENT, clientSecret: SECRET } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.text.includes(SECRET), false);
}

async function connect(s, m, { want, grant, keep = false }) {
  const start = await s.api("/browser/google/start", { method: "POST", body: { origin: s.base, ...want, keep } });
  assert.equal(start.status, 200, start.text);
  const au = new URL(start.json.url);
  assert.equal(au.hostname, "127.0.0.1");
  m.grantScope = grant;
  const fin = await s.api("/browser/google/finish", { method: "POST", body: { code: "good-code", state: au.searchParams.get("state") } });
  return { start, fin, scope: au.searchParams.get("scope") };
}

function leaked(text) {
  return text.includes(ACCESS) || text.includes(REFRESH) || text.includes(SECRET);
}

const proStub = { rpc: () => ({ ok: true, tier: "pro", status: "active", email: "t@example.com", message: "ok" }) };
function seedKey(dir) {
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null }));
}
async function waitForTier(s, tier) {
  const budget = waitBudget(20000);
  const t0 = Date.now();
  let st;
  while (Date.now() - t0 < budget) {
    st = await s.api("/state");
    if (st.json.license?.tier === tier) return st;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`tier never became ${tier}: ${JSON.stringify(st?.json?.license)}`);
}

test("calendar scope, checklist, and the Grok Bot handoff stay separate", () => {
  assert.equal(G.SCOPES.calendar, "https://www.googleapis.com/auth/calendar.events");
  assert.equal(TIERS.free.connectedServices, 1);
  assert.equal(TIERS.pro.connectedServices, Infinity);
  assert.ok(TAGS.includes("calendar"));
  assert.ok(agentNeeds("Book a meeting with Sam on my calendar").includes("calendar"));
  assert.equal(agentNeeds("Draft an email to a new client about our prices").includes("calendar"), false);
  const base = {
    providers: {},
    access: () => ({ auth: "key", connected: false }),
    dual: () => false,
    publish: () => [],
    library: () => ({ connected: false }),
    extensionPaired: () => false,
    mailAccounts: () => [],
    outlook: () => ({}),
  };
  const handed = buildCatalog({ ...base, google: () => ({ connected: false, scopes: [], clientSecretSaved: false }), grokbot: () => ({ ready: true }) });
  assert.equal(handed.find((it) => it.id === "calendar").status, "Not connected");
  assert.equal(handed.find((it) => it.id === "calendar").flow.type, "browser-google");
  assert.equal(handed.find((it) => it.id === "grokbot").status, "Handoff");
  const linked = buildCatalog({ ...base, google: () => ({ connected: true, scopes: [{ id: "calendar" }], clientId: "must-not-leak", clientSecretSaved: true }), grokbot: () => ({ ready: true }) });
  assert.equal(linked.find((it) => it.id === "calendar").status, "Connected");
  assert.equal(JSON.stringify(linked).includes("must-not-leak"), false);
  const help = fs.readFileSync(new URL("../docs/help/calendar.md", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../web/features/calendar.js", import.meta.url), "utf8");
  assert.match(help, /Create event and Update run only when you click/);
  assert.match(help, /Grok Bot can still take calendar work/);
  assert.match(ui, /Create event/);
  assert.match(ui, /data-cal-save/);
  assert.equal(help.includes(EM) || ui.includes(EM), false);
});

test("free: Calendar is a second connected service and is refused", async () => {
  const m = await googleMock();
  let s;
  try {
    s = await startServer({ env: envFor(m) });
    await saveClient(s);
    const gmail = await connect(s, m, { want: { gmail: true }, grant: G.SCOPES.gmail });
    assert.equal(gmail.fin.status, 200, gmail.fin.text);
    assert.equal(gmail.scope, G.SCOPES.gmail);
    let setup = await s.api("/connectsetup");
    assert.equal(setup.json.items.find((it) => it.id === "gmail").status, "Connected");
    assert.equal(setup.json.items.find((it) => it.id === "calendar").status, "Not connected");
    const cal = await connect(s, m, { want: { calendar: true }, keep: true, grant: `${G.SCOPES.gmail} ${G.SCOPES.calendar}` });
    assert.equal(cal.scope, `${G.SCOPES.gmail} ${G.SCOPES.calendar}`);
    assert.equal(cal.fin.status, 402, cal.fin.text);
    assert.match(cal.fin.json.error, /1 connected service/);
    setup = await s.api("/connectsetup");
    assert.equal(setup.json.items.find((it) => it.id === "gmail").status, "Connected");
    assert.equal(setup.json.items.find((it) => it.id === "calendar").status, "Not connected");
    const view = await s.api("/calendar");
    assert.equal(view.json.connected, false);
    assert.equal(leaked(cal.fin.text + view.text + s.log), false);
    assert.equal(m.hits.some((h) => h.path.startsWith("/calendar/")), false, "a refused sign-in does not call the Calendar API");
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});

test("pro: list, create, and update events on the local Calendar stand-in", async () => {
  const m = await googleMock();
  let s;
  try {
    s = await startServer({ env: envFor(m), cloud: proStub, seed: seedKey });
    await waitForTier(s, "pro");
    await saveClient(s);
    const wide = await connect(s, m, { want: { calendar: true }, grant: `${G.SCOPES.calendar} https://www.googleapis.com/auth/calendar` });
    assert.equal(wide.fin.status, 400);
    assert.match(wide.fin.json.error, /more than the helper asked for/);
    assert.equal((await s.api("/calendar")).json.connected, false);
    const gmail = await connect(s, m, { want: { gmail: true }, grant: G.SCOPES.gmail });
    assert.equal(gmail.fin.status, 200, gmail.fin.text);
    const cal = await connect(s, m, { want: { calendar: true }, keep: true, grant: `${G.SCOPES.gmail} ${G.SCOPES.calendar}` });
    assert.equal(cal.fin.status, 200, cal.fin.text);
    assert.ok(cal.fin.json.scopes.some((x) => x.id === "calendar"));
    assert.ok(cal.fin.json.scopes.some((x) => x.id === "gmail"));
    const setup = await s.api("/connectsetup");
    assert.equal(setup.json.items.find((it) => it.id === "calendar").status, "Connected");
    assert.equal(setup.json.items.find((it) => it.id === "gmail").status, "Connected");
    const before = m.hits.filter((h) => h.path.startsWith("/calendar/")).length;
    const listed = await s.api("/calendar/events");
    assert.equal(listed.status, 200, listed.text);
    assert.deepEqual(listed.json.events, []);
    const start = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 3600 * 1000 + 30 * 60 * 1000).toISOString();
    const created = await s.api("/calendar/events", { method: "POST", body: { summary: "Client call", start, end, description: "Pricing review", location: "Office" } });
    assert.equal(created.status, 200, created.text);
    assert.equal(created.json.event.summary, "Client call");
    assert.equal(created.json.event.id, "evt_test_1");
    assert.equal(created.json.event.link.startsWith("https://"), true);
    const updated = await s.api("/calendar/events/evt_test_1", { method: "POST", body: { summary: "Client call moved" } });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.json.event.summary, "Client call moved");
    const again = await s.api("/calendar/events");
    assert.equal(again.json.events[0].summary, "Client call moved");
    const calls = m.hits.filter((h) => h.path.startsWith("/calendar/"));
    assert.equal(calls.length, before + 4);
    assert.deepEqual(calls.slice(before).map((h) => h.method), ["GET", "POST", "PATCH", "GET"]);
    assert.ok(calls.every((h) => h.auth === `Bearer ${ACCESS}`));
    assert.equal(calls.some((h) => h.method === "DELETE"), false);
    const bad = await s.api(`/calendar/events/${encodeURIComponent("nope!")}`, { method: "POST", body: { summary: "nope" } });
    assert.equal(bad.status, 400);
    const dumped = `${listed.text}\n${created.text}\n${updated.text}\n${again.text}\n${s.log}`;
    assert.equal(leaked(dumped), false);
    assert.equal(dumped.includes(EM), false);
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});
