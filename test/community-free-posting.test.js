// Free signed-in people post to the shared Community room with a per-install device token.
// A loopback Supabase mock answers; no real key and no real cloud. Temp data dirs are removed by the helper.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

function seedFree(dir) {
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ email: "free@example.com", tier: "free", status: "active", checkedAt: now, lastOkAt: now }));
  fs.writeFileSync(path.join(dir, "community.room.json"), JSON.stringify({ messages: [], reports: [], mutes: [], votes: [], recent: {} }));
}

test("the free-posting migration is a file only, with row level security and brakes", () => {
  const sql = read("supabase", "community_free_posting.sql");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public.community_free_devices from anon, authenticated/);
  assert.match(sql, /community_post_free/);
  assert.doesNotMatch(read("server", "plugins", "community.js"), /community_free_posting\.sql/);
  assert.doesNotMatch(read("package.json"), /community_free_posting/);
  assert.doesNotMatch(sql, /[–—]/);
});

test("a free signed-in person's post reaches the shared room once, with the same id after a refresh", async () => {
  const calls = [];
  const remote = [];
  const rpc = (fn, body) => {
    calls.push({ fn, body });
    if (fn === "community_post_free") {
      const id = `cloud-${remote.length + 1}`;
      remote.push({ id, channel: body.p_channel, username: body.p_name, body: body.p_body, kind: "text", share: null, createdAt: new Date().toISOString() });
      return { ok: true, id };
    }
    if (fn === "community_list") return { rows: remote.filter((r) => r.channel === body.p_channel) };
    return { ok: false };
  };
  const s = await startServer({ seed: seedFree, cloud: { rpc } });
  try {
    const home = await s.api("/community?channel=general");
    assert.equal(home.json.sync.mode, "device");
    assert.equal(home.json.sync.canShare, true);
    const join = await s.api("/community/join", { method: "POST", body: { username: "FreeAda" } });
    assert.equal(join.status, 200, JSON.stringify(join.json));
    const posted = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "Hello from a free account" } });
    assert.equal(posted.status, 200, JSON.stringify(posted.json));
    const sent = calls.filter((c) => c.fn === "community_post_free");
    assert.equal(sent.length, 1);
    assert.ok(sent[0].body.p_device.length >= 24);
    assert.equal(JSON.stringify(sent[0].body).includes("free@example.com"), false, "the email never leaves this computer");
    assert.equal(calls.some((c) => c.fn === "community_post"), false, "no licence-key call without a key");
    const again = await s.api("/community?channel=general");
    const mine = again.json.messages.filter((m) => m.body === "Hello from a free account");
    assert.equal(mine.length, 1, "own post shows once after the shared copy comes back");
    assert.equal(mine[0].id, "cloud-1");
    assert.ok(!mine[0].unsent);
  } finally { await s.stop(); }
});

test("when the shared room has no free door yet, the page says so before anyone types, and the post stays honest", async () => {
  const rpc = (fn) => (fn === "community_post_free"
    ? { httpStatus: 404, rows: { code: "PGRST202", message: "Could not find the function public.community_post_free" } }
    : fn === "community_list" ? { rows: [] } : { ok: false });
  const s = await startServer({ seed: seedFree, cloud: { rpc } });
  try {
    await s.api("/community/join", { method: "POST", body: { username: "FreeAda" } });
    const posted = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "Anyone there?" } });
    assert.equal(posted.status, 200);
    assert.equal(posted.json.delivered, false);
    assert.equal(posted.json.message.unsent.state, "local");
    assert.match(posted.json.message.unsent.reason, /not switched on|License key/);
    const home = await s.api("/community?channel=general");
    assert.equal(home.json.sync.canShare, false);
    assert.match(home.json.sync.note, /License key/);
    assert.doesNotMatch(home.json.sync.note, /[–—]/);
  } finally { await s.stop(); }
});

test("with the flag off, free people read the room and are told before they type", async () => {
  const s = await startServer({ seed: seedFree, cloud: { rpc: (fn) => (fn === "community_list" ? { rows: [] } : { ok: false }) }, env: { CC_FLAG_FREECHAT: "0" } });
  try {
    const home = await s.api("/community?channel=general");
    assert.equal(home.json.sync.canShare, false);
    assert.equal(home.json.sync.mode, "local");
  } finally { await s.stop(); }
});

test("list order and duplicates are fixed on the server", async () => {
  const { listMessages, emptyRoom } = await import("../server/community-chat.js");
  const room = emptyRoom();
  const mk = (id, at) => ({ id, channel: "general", email: "", displayName: "X", username: "X", body: id, kind: "text", share: null, createdAt: at, deleted: false });
  room.messages.push(mk("b", 2000), mk("a", 1000), mk("a", 1000), mk("c", 3000));
  const out = listMessages(room, "general", { email: "x@example.com" });
  assert.deepEqual(out.map((m) => m.id), ["a", "b", "c"]);
});
