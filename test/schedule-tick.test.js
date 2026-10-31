// Hosted schedule tick. A local PostgREST stub stands in for Supabase. No real keys and no Cloudflare.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECRET = "tick-secret-test-value";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const stub = await new Promise((resolve) => {
  const live = new Map(); // userId -> [{ kind, data }]
  // The all-users list stays at the seeded lastSlot, so a second tick still looks due in Supabase.
  const listed = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const u = new URL(req.url, "http://x");
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    if (u.pathname === "/rest/v1/user_docs" && req.method === "GET" && u.searchParams.get("kind") === "eq.schedules" && !u.searchParams.has("user_id")) {
      return send(200, listed);
    }
    const uid = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
    if (u.pathname === "/rest/v1/user_docs" && req.method === "GET") return send(200, live.get(uid) || []);
    if (u.pathname === "/rest/v1/user_docs" && req.method === "POST") {
      const b = JSON.parse(raw);
      const list = live.get(b.user_id) || [];
      const i = list.findIndex((d) => d.kind === b.kind);
      const row = { kind: b.kind, data: b.data };
      if (i >= 0) list[i] = row; else list.push(row);
      live.set(b.user_id, list);
      return send(201);
    }
    if (req.method === "GET") return send(200, []);
    return send(201);
  });
  server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    seed(userId, list) {
      const data = { list };
      live.set(userId, [{ kind: "schedules", data }]);
      listed.push({ user_id: userId, data: JSON.parse(JSON.stringify(data)) });
    },
    close: () => new Promise((r) => server.close(r)),
  }));
});

process.env.CC_MODE = "hosted";
process.env.CC_TICK_SECRET = SECRET;
process.env.CC_SUPABASE_URL = stub.url;
process.env.CC_SUPABASE_ANON_KEY = "anon-test-key";
process.env.CC_SUPABASE_SERVICE_KEY = "service-test";
process.env.CC_MASTER_KEY = crypto.randomBytes(32).toString("base64");

const store = await import("../server/store.js");
const S = await import("../server/schedules.js");
const tick = await import("../server/schedule-tick.js");

const slot = S.slotOf(Date.now());
const d = new Date(slot);
const cron = `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
const sched = (id, extra = {}) => ({
  id, name: id, enabled: true, pausedReason: null,
  target: { kind: "chat", text: "hi" },
  trigger: { type: "cron", cron },
  capUsd: 5, after: { action: "none" },
  lastSlot: 0, hookHash: null, createdAt: 0, updatedAt: 0,
  ...extra,
});

stub.seed("user-a", [sched("sch-user-a"), sched("sch-user-a-off", { enabled: false })]);
stub.seed("user-b", [sched("sch-user-b"), sched("sch-user-b-done", { lastSlot: slot })]);
stub.seed("user-off", [sched("sch-user-off", { enabled: false })]);

const calls = [];
S.configure({
  now: () => Date.now(),
  run: async (s) => { calls.push(s.id); return { status: "done", cost: 0, deliverable: "ok" }; },
  alert() {},
  send: async () => ({ status: 200 }),
});

const api = await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (res2, status, body) => {
      const raw = JSON.stringify(body);
      res2.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(raw) });
      res2.end(raw);
    };
    if (url.pathname === tick.TICK_PATH) return tick.handleScheduleTick(req, res, send);
    send(res, 404, { error: "not found" });
  });
  server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
});

function post(secret) {
  return new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json" };
    if (secret !== undefined) headers["x-cc-tick-secret"] = secret;
    const req = http.request({ hostname: "127.0.0.1", port: api.port, path: tick.TICK_PATH, method: "POST", headers }, (res) => {
      let raw = ""; res.on("data", (c) => { raw += c; }); res.on("end", () => resolve({ status: res.statusCode, raw, body: raw ? JSON.parse(raw) : null }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("hosted schedule tick", { concurrency: 1 }, () => {

test("a bad secret is 401 and runs nothing", async () => {
  assert.equal(tick.tickSecretOk("nope"), false);
  assert.equal(tick.tickSecretOk(""), false);
  assert.equal(tick.tickSecretOk(SECRET, ""), false);
  const missing = await post(undefined);
  const wrong = await post("not-the-secret");
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, "unauthorized");
  assert.equal(wrong.raw.includes(SECRET), false);
  assert.equal(calls.length, 0);
});

test("one tick runs each due slot once, for two users, and a second tick does not repeat them", async () => {
  const first = await post(SECRET);
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.runs, 2);
  // the reply tells the Worker when to wake the container next: the same cron, a year from this slot at most
  assert.equal(typeof first.body.nextDue, "number");
  assert.ok(first.body.nextDue > slot, "the next wake-up is after the slot that just ran");
  assert.ok(first.body.nextDue <= slot + 400 * 86400000);
  await S.idle();
  assert.deepEqual(calls.slice().sort(), ["sch-user-a", "sch-user-b"]);
  const users = new Set(first.body.items.map((r) => r.userId));
  assert.deepEqual([...users].sort(), ["user-a", "user-b"]);
  assert.equal(store.getContext("user-off"), null, "a user with nothing due is not loaded");
  const again = await post(SECRET);
  assert.equal(again.status, 200);
  assert.equal(again.body.runs, 0);
  await S.idle();
  assert.equal(calls.length, 2, "a slot already claimed in memory does not run again");
});

test("a watched folder is refused on the hub, and the desktop note is unchanged", async () => {
  const c = store.getContext("user-a");
  assert.throws(
    () => store.runAs(c, () => S.createSchedule({ name: "Watch", target: { kind: "chat", text: "hi" }, trigger: { type: "folder", folder: "/tmp" }, capUsd: 1 })),
    (e) => e.status === 400 && /desktop app/.test(e.message),
  );
  assert.match(S.NOTE, /Desktop schedules only run while the app is running/);
});

test("a schedule change adds the user's next slot as a header once, and nothing without a change", async () => {
  const c = store.getContext("user-a");
  const fakeRes = () => {
    const headers = {};
    return { headers, headersSent: false, setHeader(k, v) { headers[k.toLowerCase()] = v; }, writeHead() { this.headersSent = true; return this; } };
  };
  c.schedHint = null;
  const quiet = fakeRes();
  tick.attachNextDueHint(quiet, c);
  quiet.writeHead(200);
  assert.equal(quiet.headers[tick.NEXT_DUE_HEADER], undefined, "no change, no header");

  const made = store.runAs(c, () => S.createSchedule({ name: "Hourly", target: { kind: "chat", text: "hi" }, trigger: { type: "cron", cron: "0 * * * *" }, capUsd: 1 }));
  const res = fakeRes();
  tick.attachNextDueHint(res, c);
  res.writeHead(200);
  const at = Number(res.headers[tick.NEXT_DUE_HEADER]);
  assert.ok(Number.isFinite(at) && at > Date.now() - 60000, "the header is a time in ms");
  assert.equal(new Date(at).getMinutes(), 0);
  assert.ok(at <= Date.now() + 3600000 + 60000, "the hourly schedule is due within the hour");
  const again = fakeRes();
  tick.attachNextDueHint(again, c);
  again.writeHead(200);
  assert.equal(again.headers[tick.NEXT_DUE_HEADER], undefined, "the hint is sent once");
  store.runAs(c, () => S.deleteSchedule(made.schedule.id));
  c.schedHint = null;
  assert.equal(S.earliestDue([{ enabled: false, trigger: { type: "cron", cron: "* * * * *" } }, { enabled: true, trigger: { type: "webhook" } }]), null);
});

test("wrangler has the cron and no secrets, and the worker sends the secret from the environment", async () => {
  const wrangler = read("wrangler.jsonc");
  const worker = read("worker/index.js") + read("worker/hub-clock.js");
  assert.match(wrangler, /"crons": \["\*\/15 \* \* \* \*"\]/);
  assert.doesNotMatch(wrangler, /CC_TICK_SECRET"\s*:|CC_MASTER_KEY|CC_SUPABASE_ANON_KEY|CC_SUPABASE_SERVICE_KEY/);
  assert.equal(wrangler.includes(SECRET), false);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /x-cc-tick-secret/);
  assert.match(worker, /env\.CC_TICK_SECRET/);
  assert.match(worker, /\/api\/internal\/schedules\/tick/);
  assert.equal(worker.includes(SECRET), false);
  assert.match(read("server/schedule-tick.js"), /if \(!HOSTED\) return send\(res, 404/);
  for (const f of ["server/schedule-tick.js", "server/plugins/schedules.js", "worker/index.js", "worker/hub-clock.js", "wrangler.jsonc"]) {
    assert.equal(read(f).includes("—"), false, f);
  }
  store.dropContext("user-a");
  store.dropContext("user-b");
  await api.close();
  await stub.close();
});

});
