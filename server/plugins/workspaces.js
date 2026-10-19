// Teams and shared workspaces (Phase 8, Studio tier). An owner creates a workspace, invites people by
// email with a role (admin, member, viewer), shares chosen projects into it, and sees AI usage per member.
// Invites are links: the app generates one and shows it once; nothing is emailed. Only a SHA-256 hash of
// the invite code is stored. The header switcher picks the active workspace ("Personal" = none); calls made
// while a workspace is active count toward that workspace's usage.
// Hosted mode: tables from supabase/workspaces.sql, accessed with the signed-in user's token (RLS enforces
// the same role rules server-side). Local mode (desktop, offline): the owner side lives in the per-user
// "workspaces" document; members can only join through a hosted hub. Routes: /api/workspaces/...
import crypto from "node:crypto";
import { HOSTED, ctx, doc, putDoc } from "../store.js";
import { rest } from "../hosted.js";
import { licenseState } from "../license.js";
import { listProjects } from "../projects.js";
import { emit } from "../events.js";
import { check as ssoCheck } from "../sso.js";

export const id = "workspaces";
const STUDIO = new Set(["studio", "owner"]);
const DOC = "workspaces";
const ACTIVE_DOC = "workspaces.active";
export const ROLES = ["owner", "admin", "member", "viewer"];
const INVITABLE = ["admin", "member", "viewer"];
const INVITE_DAYS = 14;

// ---------- roles and permissions (one table, used by routes, the UI and tests) ----------
export const PERMISSIONS = {
  "workspace.view":   ["owner", "admin", "member", "viewer"],
  "projects.view":    ["owner", "admin", "member", "viewer"],
  "usage.count":      ["owner", "admin", "member"],          // calls made while active count toward the workspace
  "usage.viewAll":    ["owner", "admin"],
  "projects.share":   ["owner", "admin"],
  "members.invite":   ["owner", "admin"],
  "members.remove":   ["owner", "admin"],
  "members.role":     ["owner", "admin"],
  "workspace.rename": ["owner", "admin"],
  "workspace.delete": ["owner"],
};
export const can = (role, action) => !!PERMISSIONS[action]?.includes(role);
export const permissionsFor = (role) => Object.fromEntries(Object.keys(PERMISSIONS).map((a) => [a, can(role, a)]));
// Who may grant or take away which role: the owner manages everyone; an admin manages members and viewers only.
export function canManageMember(actorRole, targetRole, newRole = null) {
  if (actorRole === "owner") return targetRole !== "owner" && (newRole === null || INVITABLE.includes(newRole));
  if (actorRole === "admin") return ["member", "viewer"].includes(targetRole) && (newRole === null || ["member", "viewer"].includes(newRole));
  return false;
}

function gate() {
  const s = licenseState();
  if (!STUDIO.has(s.tier)) throw Object.assign(new Error("Teams and shared workspaces are part of Studio: invite teammates or clients with a role, share chosen projects, see each member's AI usage."), { status: 402, code: "studio" });
  return s;
}
const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const month = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 7);
const q = (pathq, opts = {}) => rest(pathq, { ...opts, token: ctx().token });
const clean = (email) => String(email || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const cleanRole = (r) => (INVITABLE.includes(String(r || "").toLowerCase()) ? String(r).toLowerCase() : null);
export const hashCode = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");
const newCode = () => crypto.randomBytes(18).toString("base64url");
const me = () => { try { return clean(ctx().email) || "you"; } catch { return "you"; } };
const snapshot = (p) => ({ id: p.id, name: p.name, color: p.color, kind: p.kind, summary: p.summary || "", categories: (p.categories || []).map((c) => ({ id: c.id, name: c.name, links: (c.links || []).map((l) => ({ name: l.name, url: l.url })) })) });
function inviteLink(code, h, req) {
  const hub = HOSTED ? (h?.hubUrl || process.env.CC_HUB_URL || "") : "";
  const origin = hub || (req?.headers?.host ? `http://${req.headers.host}` : "");
  return `${origin.replace(/\/$/, "")}/#join=${code}`;
}

// ---------- local mode: one owner, documents only ----------
const local = () => {
  const d = doc(DOC, () => ({ list: [] }));
  for (const w of d.list) { w.members ||= []; w.projects ||= []; w.usage ||= {}; for (const m of w.members) m.role ||= "member"; }
  return d;
};
const activeId = () => doc(ACTIVE_DOC, () => ({ id: null })).id || null;
function localView() {
  const d = local();
  const mine = listProjects();
  const owned = d.list.map((w) => ({
    id: w.id, name: w.name, createdAt: w.createdAt, role: "owner", permissions: permissionsFor("owner"),
    members: w.members.map((m) => ({ email: m.email, role: m.role, status: m.status, invitedAt: m.invitedAt, expiresAt: m.expiresAt || null, joinedAt: m.joinedAt || null })),
    projects: w.projects.map((pid) => snapshot(mine.find((p) => p.id === pid) || { id: pid, name: pid, categories: [] })),
    usage: Object.entries(w.usage).flatMap(([mo, byEmail]) => Object.entries(byEmail).map(([email, b]) => ({ email, month: mo, calls: b.calls, cost: b.cost }))),
  }));
  const active = activeId();
  return { owned, memberOf: [], active: owned.some((w) => w.id === active) ? active : null };
}
function localWs(wsId) { const d = local(); const w = d.list.find((x) => x.id === wsId); if (!w) throw err(404, "workspace not found"); return { d, w }; }

// ---------- hosted mode ----------
async function hostedView() {
  const c = ctx();
  const myId = c.userId, email = clean(c.email);
  // 1. accept any open invitation addressed to this email (security-definer RPC; it never changes the role)
  await rest("rpc/ws_join_by_email", { method: "POST", token: c.token, body: {} }).catch(() => {});
  // 2. everything visible to me (RLS filters)
  const [ws, members, projects] = await Promise.all([
    q("workspaces?select=id,owner_id,name,created_at&order=created_at.asc"),
    q("workspace_members?select=workspace_id,email,user_id,role,status,invited_at,expires_at,joined_at&order=invited_at.asc"),
    q("workspace_projects?select=workspace_id,project_id,data,updated_at&order=updated_at.asc"),
  ]);
  const roleIn = (w) => w.owner_id === myId ? "owner" : ((members || []).find((m) => m.workspace_id === w.id && (m.user_id === myId || clean(m.email) === email) && m.status === "active")?.role || null);
  const managed = (ws || []).filter((w) => can(roleIn(w), "usage.viewAll")).map((w) => w.id);
  const usage = managed.length ? await q(`workspace_usage?select=workspace_id,user_id,email,month,calls,cost&workspace_id=in.(${managed.join(",")})&order=month.desc`) : await q(`workspace_usage?select=workspace_id,user_id,email,month,calls,cost&user_id=eq.${myId}`).catch(() => []);
  // Team SSO (Phase 24): a workspace whose sign-in rule this session does not meet shows as locked, without its contents
  const locked = new Map();
  for (const w of ws || []) { const role = roleIn(w); if (role && role !== "owner") { const r = await ssoCheck(w.id, role); if (!r.ok) locked.set(w.id, r.reason); } }
  const shape = (w) => {
    const role = roleIn(w);
    if (locked.has(w.id)) return { id: w.id, name: w.name, createdAt: new Date(w.created_at).getTime(), ownerId: w.owner_id, role, permissions: permissionsFor(role), members: [], projects: [], usage: [], locked: locked.get(w.id) };
    return {
      id: w.id, name: w.name, createdAt: new Date(w.created_at).getTime(), ownerId: w.owner_id, role, permissions: permissionsFor(role),
      members: (members || []).filter((m) => m.workspace_id === w.id).map((m) => ({ email: m.email, role: m.role, status: m.status, invitedAt: m.invited_at ? new Date(m.invited_at).getTime() : null, expiresAt: m.expires_at ? new Date(m.expires_at).getTime() : null, joinedAt: m.joined_at ? new Date(m.joined_at).getTime() : null })),
      projects: (projects || []).filter((p) => p.workspace_id === w.id).map((p) => p.data),
      usage: (usage || []).filter((u) => u.workspace_id === w.id).map((u) => ({ email: u.email, userId: u.user_id, month: u.month, calls: u.calls, cost: Number(u.cost) })),
    };
  };
  const all = (ws || []).filter((w) => roleIn(w));
  const active = activeId();
  return { owned: all.filter((w) => w.owner_id === myId).map(shape), memberOf: all.filter((w) => w.owner_id !== myId).map(shape), active: all.some((w) => w.id === active) ? active : null };
}
async function hostedRole(wsId) {
  const c = ctx();
  const ws = await q(`workspaces?select=id,owner_id&id=eq.${encodeURIComponent(wsId)}`);
  if (!ws?.length) throw err(404, "workspace not found");
  if (ws[0].owner_id === c.userId) return "owner";
  const m = await q(`workspace_members?select=role,status&workspace_id=eq.${encodeURIComponent(wsId)}&email=eq.${encodeURIComponent(clean(c.email))}`);
  return m?.[0]?.status === "active" ? m[0].role : null;
}
async function memberRole(wsId, email) {
  if (!HOSTED) return localWs(wsId).w.members.find((m) => m.email === email)?.role || null;
  const m = await q(`workspace_members?select=role&workspace_id=eq.${encodeURIComponent(wsId)}&email=eq.${encodeURIComponent(email)}`);
  return m?.[0]?.role || null;
}
const roleFor = async (wsId) => (HOSTED ? hostedRole(wsId) : (localWs(wsId), "owner"));
async function need(wsId, action) {
  const role = await roleFor(wsId);
  if (!can(role, action)) throw err(403, role ? `Your role (${role}) cannot do that here.` : "You are not in this workspace.", "role");
  return role;
}

// ---------- usage: every model call made while a workspace is active counts toward it ----------
const pending = new Map(); // userId -> { buckets: { wsId: { calls, cost } } }
function flushUsage(c) {
  const p = pending.get(c.userId); if (!p) return;
  pending.delete(c.userId);
  const m = month();
  for (const [ws, b] of Object.entries(p.buckets)) {
    rest("rpc/ws_add_usage", { method: "POST", token: c.token, body: { p_ws: ws, p_month: m, p_calls: b.calls, p_cost: +b.cost.toFixed(6) } })
      .catch((e) => console.error(`[workspaces] usage roll-up failed for ${c.email}: ${e.message}`));
  }
}
export function onEvent(ev) {
  if (ev.type !== "ledger.entry" || ev.entry?.kind !== "call") return;
  let c; try { c = ctx(); } catch { return; }
  let ws; try { ws = activeId(); } catch { return; }
  if (!ws) return;
  const cost = Number(ev.entry.cost) || 0;
  if (!HOSTED) {
    const d = local(); const w = d.list.find((x) => x.id === ws); if (!w) return;
    const mo = month(ev.entry.ts || Date.now()); const who = me();
    const b = ((w.usage[mo] ||= {})[who] ||= { calls: 0, cost: 0 });
    b.calls++; b.cost = +(b.cost + cost).toFixed(6);
    putDoc(DOC, d);
    return;
  }
  if (!c.userId || c.userId !== ev.user) return;
  let p = pending.get(c.userId);
  if (!p) { p = { buckets: {} }; pending.set(c.userId, p); const t = setTimeout(() => flushUsage(c), 20000); t.unref?.(); }
  const b = (p.buckets[ws] ||= { calls: 0, cost: 0 }); b.calls++; b.cost += cost;
}

// ---------- routes ----------
export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/workspaces/, "").replace(/\/$/, "");
  const seg = p.split("/").filter(Boolean);
  const method = req.method;
  const tier = licenseState().tier;
  const base = { hosted: HOSTED, tier, studio: STUDIO.has(tier), me: me(), roles: ROLES, permissionTable: PERMISSIONS };

  if (method === "GET" && !seg.length) {
    const v = HOSTED ? await hostedView() : localView();
    return h.json(res, 200, { ...base, ...v });
  }

  // switcher: which workspace is active for me ("Personal" = null). Anyone may switch to a workspace they are in.
  if (method === "POST" && seg[0] === "active" && seg.length === 1) {
    const wsId = body.id || null;
    if (wsId) {
      const role = await roleFor(wsId); if (!role) throw err(403, "You are not in this workspace.", "role");
      const sso = await ssoCheck(wsId, role); if (!sso.ok) throw err(403, sso.reason, "sso"); // Team SSO (Phase 24)
    }
    putDoc(ACTIVE_DOC, { id: wsId, at: Date.now() });
    emit("workspace.active", { id: wsId });
    return h.json(res, 200, { ok: true, active: wsId });
  }

  // join through an invite link (hosted only; the RPC checks the code hash, expiry and the signed-in email)
  if (method === "POST" && seg[0] === "join" && seg.length === 1) {
    const code = String(body.code || "").trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return h.json(res, 400, { error: "That invite link is not valid." });
    if (!HOSTED) return h.json(res, 400, { error: "Invite links are opened on the hosted hub: sign in there with the invited email.", code: "local" });
    try { const r = await rest("rpc/ws_accept_invite", { method: "POST", token: ctx().token, body: { p_hash: hashCode(code) } }); return h.json(res, 200, { ok: true, workspaceId: r || null }); }
    catch (e) { return h.json(res, 400, { error: /expired/i.test(e.message) ? "This invite has expired. Ask for a new link." : "This invite is not for the email you signed in with, or it was withdrawn." }); }
  }

  // everything below creates or changes something: Studio only
  if (method === "POST" && !seg.length) {
    gate();
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return h.json(res, 400, { error: "name required" });
    if (HOSTED) {
      const r = await q("workspaces", { method: "POST", prefer: "return=representation", body: { owner_id: ctx().userId, name } });
      emit("log", { text: `Workspace "${name}" created.` });
      return h.json(res, 200, { id: r?.[0]?.id, name });
    }
    const d = local(); const w = { id: "w-" + crypto.randomBytes(6).toString("hex"), name, createdAt: Date.now(), members: [], projects: [], usage: {} };
    d.list.push(w); putDoc(DOC, d);
    emit("log", { text: `Workspace "${name}" created.` });
    return h.json(res, 200, { id: w.id, name });
  }
  const wsId = seg[0];
  if (!wsId) return false;

  if (method === "PATCH" && seg.length === 1) {
    gate(); await need(wsId, "workspace.rename");
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return h.json(res, 400, { error: "name required" });
    if (HOSTED) await q(`workspaces?id=eq.${encodeURIComponent(wsId)}`, { method: "PATCH", prefer: "return=minimal", body: { name } });
    else { const { d, w } = localWs(wsId); w.name = name; putDoc(DOC, d); }
    return h.json(res, 200, { ok: true, name });
  }

  if (method === "DELETE" && seg.length === 1) {
    gate(); await need(wsId, "workspace.delete");
    if (HOSTED) await q(`workspaces?id=eq.${encodeURIComponent(wsId)}`, { method: "DELETE", prefer: "return=minimal" });
    else { const d = local(); d.list = d.list.filter((w) => w.id !== wsId); putDoc(DOC, d); }
    if (activeId() === wsId) putDoc(ACTIVE_DOC, { id: null, at: Date.now() });
    return h.json(res, 200, { ok: true });
  }

  if (seg[1] === "members") {
    gate();
    if (method === "POST" && seg.length === 2) {
      const actor = await need(wsId, "members.invite");
      const email = clean(body.email);
      const role = cleanRole(body.role || "member");
      if (!validEmail(email)) return h.json(res, 400, { error: "a valid email is required" });
      if (!role) return h.json(res, 400, { error: "role must be admin, member or viewer" });
      if (email === me()) return h.json(res, 400, { error: "that is your own address" });
      const existing = await memberRole(wsId, email);
      if (existing && !canManageMember(actor, existing, role)) throw err(403, `Your role (${actor}) cannot change a ${existing}.`, "role");
      if (!canManageMember(actor, existing || "member", role)) throw err(403, `Your role (${actor}) cannot invite an ${role}.`, "role");
      const code = newCode();
      const expiresAt = Date.now() + INVITE_DAYS * 86400000;
      if (HOSTED) {
        await q("workspace_members", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { workspace_id: wsId, email, role, invite_hash: hashCode(code), expires_at: new Date(expiresAt).toISOString() } });
      } else {
        const { d, w } = localWs(wsId);
        const m = w.members.find((x) => x.email === email);
        if (m) Object.assign(m, { role, inviteHash: hashCode(code), expiresAt }); else w.members.push({ email, role, status: "invited", invitedAt: Date.now(), expiresAt, inviteHash: hashCode(code) });
        putDoc(DOC, d);
      }
      emit("log", { text: `${email} invited as ${role}. Copy the invite link from the Workspaces tab and send it yourself; nothing was emailed.` });
      // the code is returned once and never stored in plain text
      return h.json(res, 200, { ok: true, email, role, expiresAt, link: inviteLink(code, h, req), emailed: false });
    }
    const email = seg[2] ? clean(decodeURIComponent(seg[2])) : null;
    if (method === "PATCH" && email) {
      const actor = await need(wsId, "members.role");
      const role = cleanRole(body.role);
      if (!role) return h.json(res, 400, { error: "role must be admin, member or viewer" });
      const current = await memberRole(wsId, email);
      if (!current) return h.json(res, 404, { error: "member not found" });
      if (!canManageMember(actor, current, role)) throw err(403, `Your role (${actor}) cannot make a ${current} an ${role}.`, "role");
      if (HOSTED) await q(`workspace_members?workspace_id=eq.${encodeURIComponent(wsId)}&email=eq.${encodeURIComponent(email)}`, { method: "PATCH", prefer: "return=minimal", body: { role } });
      else { const { d, w } = localWs(wsId); w.members.find((m) => m.email === email).role = role; putDoc(DOC, d); }
      return h.json(res, 200, { ok: true, email, role });
    }
    if (method === "DELETE" && email) {
      const actor = await need(wsId, "members.remove");
      const current = await memberRole(wsId, email);
      if (current && !canManageMember(actor, current)) throw err(403, `Your role (${actor}) cannot remove a ${current}.`, "role");
      if (HOSTED) await q(`workspace_members?workspace_id=eq.${encodeURIComponent(wsId)}&email=eq.${encodeURIComponent(email)}`, { method: "DELETE", prefer: "return=minimal" });
      else { const { d, w } = localWs(wsId); w.members = w.members.filter((m) => m.email !== email); putDoc(DOC, d); }
      return h.json(res, 200, { ok: true });
    }
  }

  if (seg[1] === "projects") {
    gate(); await need(wsId, "projects.share");
    if (method === "POST" && seg.length === 2) {
      const proj = listProjects().find((x) => x.id === body.projectId);
      if (!proj) return h.json(res, 404, { error: "project not found" });
      if (HOSTED) await q("workspace_projects", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { workspace_id: wsId, project_id: proj.id, data: snapshot(proj), updated_at: new Date().toISOString() } });
      else { const { d, w } = localWs(wsId); if (!w.projects.includes(proj.id)) w.projects.push(proj.id); putDoc(DOC, d); }
      return h.json(res, 200, { ok: true, projectId: proj.id });
    }
    if (method === "DELETE" && seg[2]) {
      const pid = decodeURIComponent(seg[2]);
      if (HOSTED) await q(`workspace_projects?workspace_id=eq.${encodeURIComponent(wsId)}&project_id=eq.${encodeURIComponent(pid)}`, { method: "DELETE", prefer: "return=minimal" });
      else { const { d, w } = localWs(wsId); w.projects = w.projects.filter((x) => x !== pid); putDoc(DOC, d); }
      return h.json(res, 200, { ok: true });
    }
  }

  // re-share: refresh the snapshots of every shared project (owner edited links)
  if (method === "POST" && seg[1] === "sync") {
    gate(); await need(wsId, "projects.share");
    if (!HOSTED) return h.json(res, 200, { ok: true, updated: 0 });
    const rows = await q(`workspace_projects?select=project_id&workspace_id=eq.${encodeURIComponent(wsId)}`);
    let n = 0;
    for (const r of rows || []) { const proj = listProjects().find((x) => x.id === r.project_id); if (!proj) continue; await q("workspace_projects", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { workspace_id: wsId, project_id: proj.id, data: snapshot(proj), updated_at: new Date().toISOString() } }); n++; }
    return h.json(res, 200, { ok: true, updated: n });
  }
  return false;
}
