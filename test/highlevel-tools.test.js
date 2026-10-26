// Phase 33 item 1. HighLevel contacts, invoices, and workflows.
// A send, a charge, or a change waits for confirmed: true. The token never comes back.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "./helpers.js";

const TOKEN = "hl-crm-TEST-TOKEN";
const SECRET = "hsec-crm-TEST";
const SCOPES = ["contacts.readonly", "contacts.write", "invoices.readonly", "invoices.write", "workflows.readonly", "conversations.write"];

function startMock() {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const u = new URL(req.url, "http://127.0.0.1");
      const form = /form-urlencoded/.test(req.headers["content-type"] || "") ? Object.fromEntries(new URLSearchParams(body)) : null;
      let json = null;
      if (/json/.test(req.headers["content-type"] || "")) { try { json = JSON.parse(body); } catch { json = null; } }
      hits.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, form, json });
      const send = (st, obj) => { res.writeHead(st, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(obj)); };
      if (u.pathname === "/oauth/token") {
        if (form?.user_type !== "Location") return send(400, { error: "user_type" });
        if (form.code === "wide") return send(200, { access_token: TOKEN, scope: `${SCOPES.join(" ")} locations.write`, locationId: "loc-1" });
        return send(200, { access_token: TOKEN, refresh_token: "hl-refresh-TEST", expires_in: 3600, locationId: "loc-1", scope: SCOPES.join(" "), userType: "Location" });
      }
      if (u.pathname === "/contacts/" && req.method === "GET") return send(200, { contacts: [{ id: "c1", contactName: "Ada", email: "ada@example.com" }] });
      if (u.pathname === "/contacts/" && req.method === "POST") return send(200, { contact: { id: "c2" } });
      if (u.pathname === "/invoices/" && req.method === "GET") return send(200, { invoices: [{ id: "inv0", name: "Old", total: 10, status: "draft" }] });
      if (u.pathname === "/invoices/" && req.method === "POST") return send(200, { invoice: { id: "inv1" } });
      if (u.pathname === "/workflows/" && req.method === "GET") return send(200, { workflows: [{ id: "wf1", name: "Welcome" }] });
      if (/^\/contacts\/[^/]+\/workflow\/[^/]+$/.test(u.pathname) && req.method === "POST") return send(200, { ok: true });
      if (u.pathname === "/conversations/messages" && req.method === "POST") return send(200, { ok: true });
      send(404, { message: "no route" });
    });
    server.listen(0, "127.0.0.1", () => resolve({
      base: `http://127.0.0.1:${server.address().port}`,
      hits,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

const writes = (hits) => hits.filter((h) => h.method === "POST" && h.path !== "/oauth/token");

test("HighLevel writes wait for a click and the token stays in the vault", async () => {
  const mock = await startMock();
  const s = await startServer({
    env: { CC_DEV_OWNER: "1", CC_GHL_API_URL: mock.base, CC_GHL_AUTH_URL: mock.base },
  });
  try {
    const early = await s.api("/highlevel/preview", { method: "POST", body: { action: "send_message", contactId: "c1", text: "Hello" } });
    assert.equal(early.status, 409);
    assert.equal(writes(mock.hits).length, 0);

    const client = await s.api("/publish/connect/ghlcrm/client", { method: "POST", body: { clientId: "ghlcrm-client-id-1", clientSecret: SECRET } });
    assert.equal(client.status, 200, client.text);
    const wideStart = await s.api("/publish/connect/ghlcrm/start", { method: "POST", body: {} });
    assert.equal(wideStart.status, 200, wideStart.text);
    const asked = new URL(wideStart.json.url).searchParams.get("scope").split(" ");
    assert.deepEqual(asked, SCOPES);
    const wide = await s.api("/publish/connect/ghlcrm/finish", { method: "POST", body: { code: "wide", state: wideStart.json.state } });
    assert.equal(wide.status, 400);
    assert.equal(wide.json.code, "scope");
    assert.equal((await s.api("/publish/connect")).json.find((c) => c.id === "ghlcrm").connected, false);

    const start = await s.api("/publish/connect/ghlcrm/start", { method: "POST", body: {} });
    const fin = await s.api("/publish/connect/ghlcrm/finish", { method: "POST", body: { code: "ok", state: start.json.state } });
    assert.equal(fin.status, 200, fin.text);
    assert.equal(fin.json.connected, true);
    assert.equal(fin.text.includes(TOKEN), false);
    assert.equal(fin.text.includes(SECRET), false);
    const swap = mock.hits.filter((h) => h.path === "/oauth/token" && h.form?.code === "ok");
    assert.equal(swap.length, 1);
    assert.equal(swap[0].form.user_type, "Location");

    const social = fs.readFileSync(new URL("../server/publish/oauth.js", import.meta.url), "utf8");
    assert.match(social, /scopes: \["socialplanner\/post\.write", "socialplanner\/account\.readonly"\]/);

    const look = await s.api("/highlevel/preview", { method: "POST", body: { action: "search_contacts", query: "Ada" } });
    assert.equal(look.status, 200, look.text);
    assert.equal(look.json.writes, false);
    assert.equal(look.json.result[0].id, "c1");
    const contactHit = mock.hits.find((h) => h.path === "/contacts/" && h.method === "GET");
    assert.equal(contactHit.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(contactHit.headers.version, "2021-07-28");
    assert.equal(contactHit.query.locationId, "loc-1");

    const before = writes(mock.hits).length;
    const preview = await s.api("/highlevel/preview", { method: "POST", body: { action: "send_message", contactId: "c1", channel: "Email", text: "Hello from the test", consent: true } });
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.needsClick, true);
    assert.equal(preview.json.sent, false);
    assert.equal(writes(mock.hits).length, before);
    const refused = await s.api("/highlevel/run", { method: "POST", body: { planId: preview.json.planId, confirmed: false } });
    assert.equal(refused.status, 400);
    assert.equal(writes(mock.hits).length, before);
    const sent = await s.api("/highlevel/run", { method: "POST", body: { planId: preview.json.planId, confirmed: true } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.sent, true);
    assert.equal(sent.json.result.channel, "Email");
    const msg = mock.hits.filter((h) => h.path === "/conversations/messages");
    assert.equal(msg.length, 1);
    assert.equal(msg[0].json.message, "Hello from the test");

    // compliance guard: a guarantee is refused, no consent tick needs Send anyway
    const hard = await s.api("/highlevel/preview", { method: "POST", body: { action: "send_message", contactId: "c1", channel: "Email", text: "We guarantee your collections will be deleted", consent: true } });
    assert.equal(hard.status, 422, hard.text);
    assert.equal(hard.json.code, "compliance_block");
    const soft = await s.api("/highlevel/preview", { method: "POST", body: { action: "send_message", contactId: "c1", channel: "Email", text: "Hi [NAME], see you Friday" } });
    assert.equal(soft.status, 200, soft.text);
    assert.ok(soft.json.warnings.some((w) => w.rule === "missing_consent") && soft.json.warnings.some((w) => w.rule === "raw_marker"));
    const held = await s.api("/highlevel/run", { method: "POST", body: { planId: soft.json.planId, confirmed: true } });
    assert.equal(held.status, 409);
    assert.equal(held.json.code, "compliance_review");
    assert.equal(mock.hits.filter((h) => h.path === "/conversations/messages").length, 1);
    const anyway = await s.api("/highlevel/run", { method: "POST", body: { planId: soft.json.planId, confirmed: true, sendAnyway: true } });
    assert.equal(anyway.status, 200, anyway.text);

    const bill = await s.api("/highlevel/preview", { method: "POST", body: { action: "create_invoice", contactId: "c1", amount: "25.00", title: "Test invoice" } });
    assert.equal(bill.json.needsClick, true);
    assert.equal(mock.hits.filter((h) => h.path === "/invoices/" && h.method === "POST").length, 0);
    const charged = await s.api("/highlevel/run", { method: "POST", body: { planId: bill.json.planId, confirmed: true } });
    assert.equal(charged.json.result.created, true);
    assert.equal(mock.hits.filter((h) => h.path === "/invoices/" && h.method === "POST").length, 1);

    const flow = await s.api("/highlevel/preview", { method: "POST", body: { action: "start_workflow", contactId: "c1", workflowId: "wf1" } });
    assert.equal(mock.hits.filter((h) => /workflow/.test(h.path) && h.method === "POST").length, 0);
    const started = await s.api("/highlevel/run", { method: "POST", body: { planId: flow.json.planId, confirmed: true } });
    assert.equal(started.json.result.started, true);

    const page = JSON.stringify([
      (await s.api("/highlevel")).json,
      (await s.api("/publish/connect")).json,
      (await s.api("/state")).json,
    ]);
    assert.equal(page.includes(TOKEN), false);
    assert.equal(page.includes(SECRET), false);
    assert.equal(s.log.includes(TOKEN), false);
    assert.equal(s.log.includes(SECRET), false);
    const ghl = (await s.api("/publish/connect")).json.find((c) => c.id === "ghl");
    assert.equal(ghl.connected, false);
  } finally {
    await s.stop();
    await mock.close();
  }
});

test("HighLevel files use plain words", () => {
  for (const rel of ["server/highlevel-tools.js", "server/plugins/highlevel.js", "web/features/highlevel.js"]) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"), /\u2014/, rel);
  }
});

