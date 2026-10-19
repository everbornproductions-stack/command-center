// Phase 8: teams and shared workspaces. Roles and permissions, invite links (hash stored, link shown once,
// nothing emailed), role changes, the active-workspace switcher, per-member usage, and the Studio gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";
import { can, canManageMember, permissionsFor, PERMISSIONS, ROLES, hashCode, validEmail } from "../server/plugins/workspaces.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("permission table: owner > admin > member > viewer", () => {
  assert.deepEqual(ROLES, ["owner", "admin", "member", "viewer"]);
  for (const a of Object.keys(PERMISSIONS)) assert.equal(can("owner", a), true, `owner can ${a}`);
  assert.equal(can("admin", "workspace.delete"), false);
  assert.equal(can("admin", "members.invite"), true);
  assert.equal(can("admin", "usage.viewAll"), true);
  assert.equal(can("member", "members.invite"), false);
  assert.equal(can("member", "projects.share"), false);
  assert.equal(can("member", "usage.count"), true);
  assert.equal(can("viewer", "projects.view"), true);
  assert.equal(can("viewer", "usage.count"), false);
  assert.equal(can(null, "projects.view"), false);
  assert.equal(can("viewer", "no.such.action"), false);
  assert.equal(permissionsFor("viewer")["members.remove"], false);
});

test("who may manage whom: owner manages all but owner; admin only members and viewers", () => {
  assert.equal(canManageMember("owner", "admin", "viewer"), true);
  assert.equal(canManageMember("owner", "member", "admin"), true);
  assert.equal(canManageMember("owner", "member", "owner"), false, "nobody becomes owner by invite");
  assert.equal(canManageMember("admin", "member", "viewer"), true);
  assert.equal(canManageMember("admin", "member", "admin"), false, "admins cannot create admins");
  assert.equal(canManageMember("admin", "admin"), false, "admins cannot remove admins");
  assert.equal(canManageMember("member", "viewer"), false);
  assert.equal(canManageMember("viewer", "viewer", "member"), false);
});

test("helpers: email validation and invite hashing", () => {
  assert.equal(validEmail("a@b.co"), true);
  assert.equal(validEmail("not-an-email"), false);
  assert.equal(hashCode("abc").length, 64);
  assert.notEqual(hashCode("abc"), hashCode("abd"));
});

test("free copy: tab readable, every write route is Studio-gated (402)", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/workspaces", { noToken: true })).status, 401);
    const g = await s.api("/workspaces");
    assert.equal(g.status, 200); assert.equal(g.json.studio, false); assert.deepEqual(g.json.owned, []);
    assert.deepEqual(g.json.roles, ROLES);
    const c = await s.api("/workspaces", { method: "POST", body: { name: "Team" } });
    assert.equal(c.status, 402); assert.equal(c.json.code, "studio");
    const sw = await s.api("/workspaces/active", { method: "POST", body: { id: null } });
    assert.equal(sw.status, 200, "switching back to Personal is always allowed");
  } finally { await s.stop(); }
});

test("owner copy: create, invite with roles (link once, hash stored), change role, share, switch, usage, remove, delete", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const c = await s.api("/workspaces", { method: "POST", body: { name: "Snap Credit Fix team" } });
    assert.equal(c.status, 200); const id = c.json.id; assert.match(id, /^w-[0-9a-f]{12}$/);
    assert.equal((await s.api("/workspaces", { method: "POST", body: { name: "  " } })).status, 400);

    // invites
    const bad = await s.api(`/workspaces/${id}/members`, { method: "POST", body: { email: "nope" } });
    assert.equal(bad.status, 400);
    const badRole = await s.api(`/workspaces/${id}/members`, { method: "POST", body: { email: "x@example.com", role: "owner" } });
    assert.equal(badRole.status, 400, "owner is not an invitable role");
    const inv = await s.api(`/workspaces/${id}/members`, { method: "POST", body: { email: "Ana@Example.com", role: "viewer" } });
    assert.equal(inv.status, 200, JSON.stringify(inv.json)); assert.equal(inv.json.email, "ana@example.com"); assert.equal(inv.json.role, "viewer");
    assert.equal(inv.json.emailed, false, "nothing is emailed");
    const code = inv.json.link.match(/#join=([A-Za-z0-9_-]+)$/)?.[1];
    assert.ok(code && code.length >= 16, "invite link carries a code");
    assert.ok(inv.json.expiresAt > Date.now() + 13 * 86400000);
    const stored = fs.readFileSync(path.join(s.dir, "workspaces.json"), "utf8");
    assert.ok(!stored.includes(code), "the invite code is never stored in plain text");
    assert.ok(stored.includes(hashCode(code)), "only its hash is stored");
    await s.api(`/workspaces/${id}/members`, { method: "POST", body: { email: "ben@example.com", role: "admin" } });

    // role change
    const rc = await s.api(`/workspaces/${id}/members/${encodeURIComponent("ana@example.com")}`, { method: "PATCH", body: { role: "member" } });
    assert.equal(rc.status, 200); assert.equal(rc.json.role, "member");
    assert.equal((await s.api(`/workspaces/${id}/members/${encodeURIComponent("ana@example.com")}`, { method: "PATCH", body: { role: "owner" } })).status, 400);
    assert.equal((await s.api(`/workspaces/${id}/members/${encodeURIComponent("zed@example.com")}`, { method: "PATCH", body: { role: "viewer" } })).status, 404);

    // share a project
    const pr = await s.api("/projects", { method: "POST", body: { name: "Client A" } });
    assert.equal(pr.status, 200);
    const sh = await s.api(`/workspaces/${id}/projects`, { method: "POST", body: { projectId: pr.json.id || "client-a" } });
    assert.equal(sh.status, 200);
    assert.equal((await s.api(`/workspaces/${id}/projects`, { method: "POST", body: { projectId: "missing" } })).status, 404);

    // rename
    assert.equal((await s.api(`/workspaces/${id}`, { method: "PATCH", body: { name: "SCF team" } })).status, 200);

    let g = await s.api("/workspaces");
    const w = g.json.owned[0];
    assert.equal(w.name, "SCF team"); assert.equal(w.role, "owner"); assert.equal(w.permissions["workspace.delete"], true);
    assert.deepEqual(w.members.map((m) => [m.email, m.role, m.status]), [["ana@example.com", "member", "invited"], ["ben@example.com", "admin", "invited"]]);
    assert.ok(!JSON.stringify(g.json).includes("inviteHash"), "hashes are not sent to the browser");
    assert.equal(w.projects.length, 1);
    assert.equal(g.json.active, null);

    // switcher + usage: a demo call while the workspace is active counts toward it
    assert.equal((await s.api("/workspaces/active", { method: "POST", body: { id: "w-doesnotexist" } })).status, 404);
    const act = await s.api("/workspaces/active", { method: "POST", body: { id } });
    assert.equal(act.status, 200); assert.equal(act.json.active, id);
    assert.equal((await s.api("/workspaces")).json.active, id);
    await s.api("/demo", { method: "POST", body: { on: true } });
    const chat = await s.api("/chat", { method: "POST", body: { prompt: "Say hi in three words." } });
    assert.ok([200, 202].includes(chat.status), `chat accepted (${chat.status})`);
    let calls = 0;
    for (let i = 0; i < 60 && !calls; i++) { await sleep(250); g = await s.api("/workspaces"); calls = (g.json.owned[0].usage || []).reduce((n, u) => n + u.calls, 0); }
    assert.ok(calls >= 1, "the call made while active is counted for this workspace");

    // remove + delete (delete also resets the switcher to Personal)
    assert.equal((await s.api(`/workspaces/${id}/members/${encodeURIComponent("ben@example.com")}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api("/workspaces")).json.owned[0].members.length, 1);
    const join = await s.api("/workspaces/join", { method: "POST", body: { code } });
    assert.equal(join.status, 400); assert.equal(join.json.code, "local", "invite links are accepted on the hosted hub");
    assert.equal((await s.api(`/workspaces/${id}`, { method: "DELETE" })).status, 200);
    g = await s.api("/workspaces");
    assert.deepEqual(g.json.owned, []); assert.equal(g.json.active, null);
  } finally { await s.stop(); }
});
