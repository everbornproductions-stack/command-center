// (e) Local server blocks cross-site requests: per-launch token, Host and Origin pinning, JSON-only writes, WebSocket auth.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer } from "./helpers.js";

let s;
before(async () => { s = await startServer(); });
after(async () => { await s?.stop(); });

const wsOnce = (url, { origin, send } = {}) => new Promise((resolve) => {
  const ws = new WebSocket(url, origin ? { headers: { origin } } : {});
  const out = { messages: [], code: null };
  const t = setTimeout(() => { try { ws.terminate(); } catch {} resolve({ ...out, timeout: true }); }, 4000);
  ws.on("open", () => { if (send) ws.send(JSON.stringify(send)); });
  ws.on("message", (m) => { out.messages.push(JSON.parse(String(m))); if (out.messages.some((x) => x.type === "hello")) { clearTimeout(t); ws.close(); resolve(out); } });
  ws.on("close", (code) => { out.code = code; clearTimeout(t); resolve(out); });
  ws.on("error", () => {});
});

test("index.html carries a per-launch token; health and config need none", async () => {
  assert.ok(s.token && s.token.length === 64, "64 hex chars");
  assert.equal((await s.api("/health", { noToken: true })).status, 200);
  assert.equal((await s.api("/config", { noToken: true })).status, 200);
});

test("no token → 401; wrong token → 401; correct → 200", async () => {
  assert.equal((await s.api("/state", { noToken: true })).status, 401);
  assert.equal((await s.api("/state", { noToken: true, headers: { "x-cc-token": "0".repeat(64) } })).status, 401);
  assert.equal((await s.api("/state", { noToken: true, headers: { "x-cc-token": s.token.slice(0, 63) } })).status, 401);
  assert.equal((await s.api("/state")).status, 200);
  // a write with the token works
  const r = await s.api("/settings", { method: "POST", body: { budgetMonthly: 42 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.budgetMonthly, 42);
});

test("foreign Origin → 403 even with the token; loopback Origin is fine", async () => {
  assert.equal((await s.api("/state", { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await s.api("/settings", { method: "POST", body: { budgetMonthly: 1 }, headers: { origin: "http://evil.example:" + s.port } })).status, 403);
  assert.equal((await s.api("/state", { headers: { origin: `http://127.0.0.1:${s.port}` } })).status, 200);
  assert.equal((await s.api("/state", { headers: { origin: `http://localhost:${s.port}` } })).status, 200);
});

test("bad Host → 421 for the API and for static files (DNS rebinding)", async () => {
  const api = await s.api("/state", { headers: { host: `evil.example:${s.port}` } });
  assert.equal(api.status, 421);
  const page = await s.raw({ path: "/", headers: { host: "evil.example" } });
  assert.equal(page.status, 421);
  assert.ok(!page.text.includes("cc-token"), "the token page is not served to a foreign Host");
  const ok = await s.raw({ path: "/", headers: { host: `localhost:${s.port}` } });
  assert.equal(ok.status, 200);
  assert.ok(ok.text.includes('name="cc-token"'));
});

test("text/plain POST → 415; JSON → 2xx", async () => {
  const plain = await s.raw({ method: "POST", path: "/api/settings", headers: { "content-type": "text/plain", "x-cc-token": s.token }, body: JSON.stringify({ budgetMonthly: 7 }) });
  assert.equal(plain.status, 415);
  const none = await s.raw({ method: "POST", path: "/api/settings", headers: { "x-cc-token": s.token }, body: JSON.stringify({ budgetMonthly: 7 }) });
  assert.equal(none.status, 415);
  const ok = await s.raw({ method: "POST", path: "/api/settings", headers: { "content-type": "application/json; charset=utf-8", "x-cc-token": s.token }, body: JSON.stringify({ budgetMonthly: 8 }) });
  assert.equal(ok.status, 200);
  assert.equal((await s.api("/state")).json.settings.budgetMonthly, 8);
});

test("downloads need the token too", async () => {
  assert.equal((await s.api("/setup/bookmarks.html", { noToken: true })).status, 401);
  assert.equal((await s.api("/pair/qr.svg?u=http://localhost", { noToken: true })).status, 401);
  assert.equal((await s.api("/pair/qr.svg?u=http://localhost")).status, 200);
});

test("WebSocket: wrong token or foreign Origin is closed; the right token gets hello", async () => {
  const url = `ws://127.0.0.1:${s.port}/ws`;
  const bad = await wsOnce(url, { send: { type: "auth", token: "nope" } });
  assert.equal(bad.code, 4401);
  assert.ok(bad.messages.some((m) => m.type === "auth.error"));
  assert.ok(!bad.messages.some((m) => m.type === "hello"));
  const notAuth = await wsOnce(url, { send: { type: "hello" } });
  assert.equal(notAuth.code, 4401);
  const foreign = await wsOnce(url, { origin: "https://evil.example", send: { type: "auth", token: s.token } });
  assert.equal(foreign.code, 4403);
  assert.ok(!foreign.messages.some((m) => m.type === "hello"));
  const good = await wsOnce(url, { origin: `http://localhost:${s.port}`, send: { type: "auth", token: s.token } });
  assert.ok(good.messages.some((m) => m.type === "hello"), "hello received");
  assert.equal(good.messages.find((m) => m.type === "hello").state.license.tier, "free");
});
