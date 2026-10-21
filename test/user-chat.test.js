// Phase 92: people chat. Local until a hub address is set. Team-space members only.
// Report and block stay here. Keys and private-mode content are not shared.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, freePort, ROOT } from "./helpers.js";
import { openThread, sendMessage, readSpaces, roleIn, privateReason } from "../server/user-chat.js";

const SECRET = "sk-ant-api03-TESTKEYONLY0001";
const SPACE = {
  list: [{
    id: "ts-1",
    name: "Shop",
    members: [
      { email: "ada@shop.test", role: "member", status: "active" },
      { email: "bea@shop.test", role: "member", status: "active" },
      { email: "cam@shop.test", role: "viewer", status: "active" },
    ],
    projects: [],
  }, {
    id: "ts-2",
    name: "Other",
    members: [{ email: "dee@shop.test", role: "member", status: "active" }],
    projects: [],
  }],
};

function fake(docs, email) {
  const box = { docs: structuredClone(docs) };
  return {
    ctx: () => ({ email, docs: box.docs, userId: "local" }),
    doc: (kind, init) => {
      if (box.docs[kind] == null) box.docs[kind] = typeof init === "function" ? init() : init;
      return box.docs[kind];
    },
    putDoc: (kind, value) => { box.docs[kind] = value; },
  };
}

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}
function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("roles, private mode, and team spaces before workspaces", async () => {
  const h = fake({ teamspaces: SPACE, workspaces: { list: [{ id: "w-1", name: "Old", members: [{ email: "zed@nope.test", role: "member" }] }] } }, "you");
  const spaces = readSpaces(h);
  assert.equal(spaces[0].kind, "teamspace");
  assert.equal(spaces.some((s) => s.members.some((m) => m.email === "zed@nope.test")), false);
  assert.equal(roleIn(spaces[0], "you"), "owner");
  assert.equal(roleIn(spaces[0], "cam@shop.test"), "viewer");
  await assert.rejects(() => openThread(fake({ teamspaces: SPACE }, "cam@shop.test"), { spaceId: "ts-1", with: "ada@shop.test" }), /viewer/);
  const opened = await openThread(h, { spaceId: "ts-1", with: "ada@shop.test" });
  assert.equal(opened.sent, false);
  assert.equal(opened.thread.messages.length, 0);
  await assert.rejects(() => openThread(h, { spaceId: "ts-1", members: ["ada@shop.test", "dee@shop.test"] }), /not in this team space/);
  const many = Array.from({ length: 8 }, (_, i) => `p${i}@shop.test`);
  const wide = fake({ teamspaces: { list: [{ id: "ts-9", name: "Big", members: many.map((email) => ({ email, role: "member", status: "active" })) }] } }, "you");
  await assert.rejects(() => openThread(wide, { spaceId: "ts-9", members: many }), /8 people/);
  await assert.rejects(() => sendMessage(h, opened.thread.id, { text: "hi", private: true }), /Private mode/);
  assert.equal(h.doc("userchat").threads[0].messages.length, 0);
  await assert.rejects(() => sendMessage(h, opened.thread.id, { text: SECRET }), /looks like a key/);
  const priv = fake({ "private.mode": { chats: ["chat-9"] }, teamspaces: SPACE }, "you");
  const thread = await openThread(priv, { spaceId: "ts-1", with: "ada@shop.test" });
  assert.match(privateReason(priv, { privateChatId: "chat-9" }), /Private mode/);
  await assert.rejects(() => sendMessage(priv, thread.thread.id, { text: "secret notes", privateChatId: "chat-9" }), /Private mode/);
  const onlyWs = fake({ workspaces: { list: [{ id: "w-9", name: "Desk", members: [{ email: "ada@shop.test", role: "admin", status: "active" }] }] } }, "you");
  assert.equal(readSpaces(onlyWs)[0].kind, "workspace");
  for (const file of ["server/user-chat.js", "server/plugins/userchat.js", "web/features/userchat.js"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes("\u2014"), false, file);
  }
});

test("messages stay local until Send, then a hub gets a redacted copy", async () => {
  const port = await freePort();
  const hits = [];
  const hub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      hits.push({ method: req.method, path: req.url, auth: req.headers.authorization || "", body: body ? JSON.parse(body) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await listen(hub, port);
  const s = await startServer({
    env: { CC_USERCHAT_HUB: `http://127.0.0.1:${port}` },
    seed(dir) { fs.writeFileSync(path.join(dir, "teamspaces.json"), JSON.stringify(SPACE)); },
  });
  try {
    const home = await s.api("/userchat");
    assert.equal(home.status, 200);
    assert.equal(home.json.hub.configured, true);
    assert.equal(home.json.spaces[0].name, "Shop");
    assert.equal(hits.length, 0, "opening the page does not call the hub");
    const dm = await s.api("/userchat/threads", { method: "POST", body: { spaceId: "ts-1", with: "ada@shop.test" } });
    assert.equal(dm.status, 200);
    assert.equal(dm.json.sent, false);
    assert.equal(dm.json.thread.messages.length, 0);
    assert.equal(hits.length, 0, "opening a chat does not send");

    const sent = await s.api(`/userchat/threads/${dm.json.thread.id}/messages`, { method: "POST", body: { text: "Hello Ada" } });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.stored, "local");
    assert.equal(sent.json.hub.delivered, true);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].method, "POST");
    assert.equal(hits[0].path, "/api/userchat/inbox");
    assert.equal(hits[0].auth, "");
    assert.equal(hits[0].body.text, "Hello Ada");
    assert.equal(hits[0].body.private, false);
    assert.equal(Object.hasOwn(hits[0].body, "key"), false);

    const leaked = await s.api(`/userchat/threads/${dm.json.thread.id}/messages`, { method: "POST", body: { text: `see ${SECRET} please` } });
    assert.equal(leaked.status, 200);
    assert.equal(leaked.json.message.text.includes(SECRET), false);
    assert.match(leaked.json.message.text, /\[hidden\]/);
    assert.equal(hits[1].body.text.includes(SECRET), false);
    assert.equal(JSON.stringify(hits[1].body).includes("key"), false);

    const onlyKey = await s.api(`/userchat/threads/${dm.json.thread.id}/messages`, { method: "POST", body: { text: SECRET } });
    assert.equal(onlyKey.status, 400);
    const priv = await s.api(`/userchat/threads/${dm.json.thread.id}/messages`, { method: "POST", body: { text: "hidden chat", private: true } });
    assert.equal(priv.status, 400);
    assert.equal(hits.length, 2);

    const outsider = await s.api("/userchat/threads", { method: "POST", body: { spaceId: "ts-1", with: "zed@nope.test" } });
    assert.equal(outsider.status, 403);
    const group = await s.api("/userchat/threads", { method: "POST", body: { spaceId: "ts-1", members: ["ada@shop.test", "bea@shop.test"] } });
    assert.equal(group.status, 200);
    assert.equal(group.json.thread.kind, "group");
    assert.equal(group.json.thread.messages.length, 0);
    assert.equal(hits.length, 2);

    const report = await s.api("/userchat/report", { method: "POST", body: { targetType: "message", targetId: sent.json.message.id, reason: "spam" } });
    assert.equal(report.status, 200);
    assert.equal(report.json.sent, false);
    assert.equal((await s.api("/userchat/report", { method: "POST", body: { targetType: "message", targetId: "x", reason: "" } })).status, 400);
    const blocked = await s.api("/userchat/block", { method: "POST", body: { email: "ada@shop.test" } });
    assert.equal(blocked.json.sent, false);
    const after = await s.api("/userchat");
    assert.equal(after.json.threads.some((t) => (t.members || []).includes("ada@shop.test")), false);
    assert.equal((await s.api("/userchat/threads", { method: "POST", body: { spaceId: "ts-1", with: "ada@shop.test" } })).status, 403);
    assert.equal((await s.api("/userchat/unblock", { method: "POST", body: { email: "ada@shop.test" } })).status, 200);
    const back = await s.api("/userchat");
    assert.ok(back.json.threads.some((t) => t.id === dm.json.thread.id));
    const file = JSON.parse(fs.readFileSync(path.join(s.dir, "userchat.json"), "utf8"));
    assert.equal(JSON.stringify(file).includes(SECRET), false);
  } finally {
    await s.stop();
    await close(hub);
  }
});

test("with no hub and no team space file, a workspace member can be messaged locally", async () => {
  const s = await startServer({
    seed(dir) {
      fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify({
        list: [{ id: "w-1", name: "Desk", members: [{ email: "ada@shop.test", role: "member", status: "invited" }], projects: [], usage: {} }],
      }));
    },
  });
  try {
    const home = await s.api("/userchat");
    assert.equal(home.json.hub.configured, false);
    assert.equal(home.json.spaces[0].kind, "workspace");
    const dm = await s.api("/userchat/threads", { method: "POST", body: { spaceId: "w-1", with: "ada@shop.test" } });
    assert.equal(dm.status, 200);
    const sent = await s.api(`/userchat/threads/${dm.json.thread.id}/messages`, { method: "POST", body: { text: "Local only" } });
    assert.equal(sent.json.stored, "local");
    assert.equal(sent.json.hub.delivered, false);
    assert.equal(sent.json.hub.configured, false);
  } finally { await s.stop(); }
});
