// Bring your own apps. Free is refused. Owner confirms once. Secrets stay out of
// the reply and the log. The HighLevel mock and the webhook mock are on this machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const hidden = (text, secret) => !String(text || "").includes(secret);

function mock() {
  const hits = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        hits.push({ method: req.method, url: req.url, auth: req.headers.authorization || "", extra: req.headers["x-byo-test"] || "" });
        if (req.url.startsWith("/mcp")) {
          let msg = {};
          try { msg = JSON.parse(body || "{}"); } catch { msg = {}; }
          if (!msg.id) { res.writeHead(202); return res.end(); }
          let result = {};
          if (msg.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mock", version: "0" } };
          if (msg.method === "tools/list") result = { tools: [{ name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} } }] };
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        }
        const echo = req.headers.authorization || req.headers["x-byo-test"] || "";
        res.writeHead(200, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify({ ok: true, method: req.method, url: req.url, echo }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({
      hits, base: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

test("simple licence copy hides the setup form, and Your apps posts only from a click", () => {
  const app = read("web", "app.js");
  const fn = app.slice(app.indexOf("function licenceCloudFields"), app.indexOf("function renderSettings"));
  assert.match(fn, /S\.uiMode !== "expert"/);
  assert.match(fn, /id="cl-url"/);
  assert.match(fn, /Licence server connection/);
  assert.equal(fn.includes("supabase.co"), false);
  assert.equal(fn.includes("\u2014"), false);
  const byo = read("web", "features", "byo.js");
  const server = read("server", "byo.js");
  assert.match(byo, /Your apps/);
  assert.match(byo, /data-send/);
  assert.equal(byo.includes("\u2014") || server.includes("\u2014"), false);
  assert.match(read("web", "features", "grokbot.js"), /data-plumbing="1"/);
  assert.match(read("server", "plugins", "byo.js"), /confirmPending/);
});

test("the free tier cannot add a webhook or an MCP server by URL", async () => {
  const s = await startServer();
  try {
    const hook = await s.api("/byo/hooks", { method: "POST", body: { name: "Hook", url: "https://example.com/hook" } });
    assert.equal(hook.status, 402);
    assert.equal(hook.json.code, "pro_required");
    const mcp = await s.api("/byo/mcp", { method: "POST", body: { name: "Remote", url: "https://example.com/mcp" } });
    assert.equal(mcp.status, 402);
    assert.equal(mcp.json.code, "pro_required");
    const home = await s.api("/byo");
    assert.equal(home.status, 200);
    assert.equal(home.json.pro, false);
    assert.equal(home.json.hooks.length, 0);
  } finally { await s.stop(); }
});

test("webhooks and HighLevel wait for Send, and saved secrets stay out of the reply", async () => {
  const m = await mock();
  const hookSecret = "hook-secret-not-real-aa";
  const mcpSecret = "mcp-header-not-real-bb";
  const ghlSecret = "ghl-token-not-real-cc";
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_GHL_API_URL: m.base, CC_STATUS_PAGES: "off" } });
  try {
    const bad = await s.api("/byo/hooks", { method: "POST", body: { name: "Nope", url: "http://169.254.1.1/hook", headerName: "Authorization", headerValue: hookSecret } });
    assert.equal(bad.status, 400);
    assert.equal(hidden(JSON.stringify(bad.json), hookSecret), true);

    const made = await s.api("/byo/hooks", { method: "POST", body: {
      name: "Desk hook", url: `${m.base}/hook`, headerName: "X-Byo-Test", headerValue: hookSecret, fields: [{ key: "note", label: "Note" }],
    } });
    assert.equal(made.status, 200, made.json?.error);
    const hookId = made.json.hook.id;
    assert.equal(hidden(JSON.stringify(made.json), hookSecret), true);
    assert.equal(made.json.hooks[0].headerSaved, true);
    const before = m.hits.filter((h) => h.url.startsWith("/hook")).length;
    const prep = await s.api(`/byo/hooks/${hookId}/prepare`, { method: "POST", body: { args: { note: "hello" } } });
    assert.equal(prep.status, 200, prep.json?.error);
    assert.equal(m.hits.filter((h) => h.url.startsWith("/hook")).length, before, "prepare does not call the webhook");
    const sent = await s.api("/byo/confirm", { method: "POST", body: { id: prep.json.id } });
    assert.equal(sent.status, 200, sent.json?.error);
    assert.equal(hidden(JSON.stringify(sent.json), hookSecret), true);
    assert.equal(m.hits.filter((h) => h.url.startsWith("/hook") && h.extra === hookSecret).length, 1);
    const again = await s.api("/byo/confirm", { method: "POST", body: { id: prep.json.id } });
    assert.equal(again.status, 409);
    assert.equal(m.hits.filter((h) => h.url.startsWith("/hook")).length, 1);

    const keys = await s.api("/publish/keys", { method: "POST", body: { channel: "ghl", token: ghlSecret, locationId: "loc_test_1" } });
    assert.equal(keys.status, 200, keys.json?.error);
    const state = await s.api("/byo");
    assert.equal(state.json.highlevel.connected, true);
    assert.equal(hidden(JSON.stringify(state.json), ghlSecret), true);
    const listed = await s.api("/byo/highlevel/run", { method: "POST", body: { tool: "list_contacts" } });
    assert.equal(listed.status, 200, listed.json?.error);
    assert.equal(hidden(JSON.stringify(listed.json), ghlSecret), true);
    assert.ok(m.hits.some((h) => h.method === "GET" && h.url.startsWith("/contacts/")));
    const postsBefore = m.hits.filter((h) => h.method === "POST" && h.url.startsWith("/contacts")).length;
    const draft = await s.api("/byo/highlevel/prepare", { method: "POST", body: { tool: "create_contact", args: { first_name: "Ada", email: "ada@example.com" } } });
    assert.equal(draft.status, 200, draft.json?.error);
    assert.equal(m.hits.filter((h) => h.method === "POST" && h.url.startsWith("/contacts")).length, postsBefore, "prepare does not create the contact");
    const created = await s.api("/byo/confirm", { method: "POST", body: { id: draft.json.id } });
    assert.equal(created.status, 200, created.json?.error);
    assert.equal(hidden(JSON.stringify(created.json), ghlSecret), true);
    assert.equal(m.hits.filter((h) => h.method === "POST" && h.url.startsWith("/contacts")).length, 1);
    assert.equal((await s.api("/byo/confirm", { method: "POST", body: { id: draft.json.id } })).status, 409);

    const remote = await s.api("/byo/mcp", { method: "POST", body: { name: "Local MCP", url: `${m.base}/mcp`, headerName: "Authorization", headerValue: mcpSecret } });
    assert.equal(remote.status, 200, remote.json?.error);
    assert.equal(remote.json.ok, true, remote.json.error);
    assert.equal(hidden(JSON.stringify(remote.json), mcpSecret), true);
    assert.ok(m.hits.some((h) => h.url.startsWith("/mcp") && h.auth === mcpSecret));
    assert.equal(remote.json.mcp.length, 1);
    assert.ok(remote.json.mcp[0].tools.some((t) => t.name === "ping" && t.enabled));

    const log = s.log;
    assert.equal(hidden(log, hookSecret) && hidden(log, mcpSecret) && hidden(log, ghlSecret), true);
    const live = await s.api("/liveview");
    assert.equal(live.json.tutorials.length, 6);
  } finally {
    await s.stop();
    await m.close();
  }
});
