// Idle eviction (hosted only), driven by a fake clock. No real Supabase and no real keys.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";

const MIN = 60 * 1000;
const NOW = Date.parse("2026-10-20T12:00:00Z");

const stub = await new Promise((resolve) => {
  const docs = new Map();
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const u = new URL(req.url, "http://x");
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    if (u.pathname === "/auth/v1/user") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      return token === "token-idle-user-aaaaaaaa" ? send(200, { id: "user-cloud", email: "cloud@example.com" }) : send(401, { msg: "bad token" });
    }
    const uid = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
    if (u.pathname === "/rest/v1/user_docs" && req.method === "GET") return send(200, docs.get(uid) || []);
    if (u.pathname === "/rest/v1/user_docs" && req.method === "POST") {
      const b = JSON.parse(raw);
      const list = docs.get(b.user_id) || [];
      const i = list.findIndex((d) => d.kind === b.kind);
      const row = { kind: b.kind, data: b.data };
      if (i >= 0) list[i] = row; else list.push(row);
      docs.set(b.user_id, list);
      return send(201);
    }
    if (req.method === "GET") return send(200, []);
    return send(201);
  });
  server.listen(0, "127.0.0.1", () => resolve({ docs, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
});

process.env.CC_MODE = "hosted";
process.env.CC_IDLE_EVICT_MIN = "30";
process.env.CC_SUPABASE_URL = stub.url;
process.env.CC_SUPABASE_ANON_KEY = "anon-test-key";
process.env.CC_MASTER_KEY = crypto.randomBytes(32).toString("base64");
process.env.CC_SUPABASE_SERVICE_KEY = "service-test";

const store = await import("../server/store.js");
const idle = await import("../server/idle.js");
const auth = await import("../server/auth.js");

function memStore() {
  const s = { pending: false, flushed: 0, hasPending() { return s.pending; }, async flush() { s.flushed++; s.pending = false; }, putDoc() {}, async loadAll() {} };
  return s;
}
function add(id, ageMin, extra = {}) {
  const c = store.newContext(id, memStore());
  c.ready = true;
  c.email = `${id}@example.com`;
  c.lastSeen = NOW - ageMin * MIN;
  Object.assign(c, extra);
  if (extra.store) c.store = extra.store;
  store.registerContext(c);
  return c;
}
const gone = (id) => store.getContext(id) == null;

describe("idle eviction", { concurrency: 1 }, () => {

test("default idle time is 30 minutes, and a fake clock evicts only the idle hosted user", async () => {
  assert.equal(idle.idleMs({ CC_IDLE_EVICT_MIN: "" }), 30 * MIN);
  assert.equal(idle.idleMs({ CC_IDLE_EVICT_MIN: "15" }), 15 * MIN);
  const idleUser = add("idle-user", 31);
  const fresh = add("fresh-user", 29);
  const exact = add("exact-user", 30);
  try {
    const evicted = await idle.evictIdle({ now: NOW });
    assert.deepEqual(evicted.sort(), ["exact-user", "idle-user"]);
    assert.equal(gone("idle-user"), true);
    assert.equal(gone("exact-user"), true);
    assert.equal(gone("fresh-user"), false);
    assert.equal(fresh.userId, "fresh-user");
  } finally {
    store.dropContext("fresh-user");
  }
});

test("a running mission, council or media job, an open socket, or a pending write keeps the user", async () => {
  const mission = add("m", 90, { missionsInFlight: 1 });
  const council = add("c", 90, { councilsInFlight: 1 });
  const media = add("media", 90, { mediaJobsInFlight: 1 });
  const socket = add("sock", 90, { openSockets: 1 });
  const queued = add("queued", 90);
  queued.scheduled.set("q-1", { mission: { id: "q-1" } });
  const writing = add("write", 90);
  writing.store.pending = true;
  writing.store.flush = async () => { writing.store.flushed++; };
  writing.store.hasPending = () => true;
  const counted = add("counted", 90);
  try {
    const evicted = await idle.evictIdle({ now: NOW, socketCount: (c) => (c.userId === "counted" ? 1 : 0) });
    assert.deepEqual(evicted, []);
    for (const id of ["m", "c", "media", "sock", "queued", "write", "counted"]) assert.equal(gone(id), false, id);
    assert.equal(mission.missionsInFlight, 1);
    assert.equal(council.councilsInFlight, 1);
    assert.equal(media.mediaJobsInFlight, 1);
    assert.equal(socket.openSockets, 1);
    assert.equal(writing.store.flushed, 1, "writes are flushed before the keep-or-drop decision");
    assert.equal(mission.store.flushed, 0, "a running mission is not flushed just to be kept");
  } finally {
    for (const id of ["m", "c", "media", "sock", "queued", "write", "counted"]) store.dropContext(id);
  }
});

test("flush runs before the drop, and local mode drops nobody", async () => {
  const c = add("flush-me", 45);
  c.store.pending = true;
  let sawPending = true;
  c.store.hasPending = () => sawPending;
  c.store.flush = async () => { c.store.flushed++; sawPending = false; };
  const other = add("other", 90);
  try {
    assert.deepEqual(await idle.evictIdle({ now: NOW, hosted: false }), []);
    assert.equal(gone("flush-me"), false);
    assert.equal(gone("other"), false);
    assert.equal(c.store.flushed, 0, "local mode does not flush or evict");
    const evicted = await idle.evictIdle({ now: NOW });
    assert.deepEqual(evicted.sort(), ["flush-me", "other"]);
    assert.equal(c.store.flushed, 1);
    assert.equal(gone("flush-me"), true);
    assert.equal(gone("other"), true);
  } finally { store.dropContext("flush-me"); store.dropContext("other"); }
});

test("after eviction the next request reloads that user from Supabase", async () => {
  const token = "token-idle-user-aaaaaaaa";
  const first = await auth.contextForToken(token);
  assert.equal(first.userId, "user-cloud");
  assert.equal(first.docs.settings, undefined);
  store.runAs(first, () => store.putDoc("settings", { name: "kept" }));
  const evicted = await idle.evictIdle({ now: Date.now() + 31 * MIN });
  assert.deepEqual(evicted, ["user-cloud"]);
  assert.equal(store.getContext("user-cloud"), null);
  const saved = stub.docs.get("user-cloud")?.find((d) => d.kind === "settings");
  assert.equal(saved?.data?.name, "kept", "the waiting write was flushed before the drop");
  const second = await auth.contextForToken(token);
  assert.notEqual(second, first);
  assert.equal(second.docs.settings.name, "kept");
  assert.equal(second.ready, true);
  store.dropContext("user-cloud");
});

test("idle module has no em-dash", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "idle.js");
  assert.equal(fs.readFileSync(file, "utf8").includes("—"), false);
  await stub.close();
});

});
