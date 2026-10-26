// Team spaces (Phase 61). Extreme includes 5 seats, counting the owner.
// Phase 8 workspaces stay as they are (Studio). This does not rebuild them.
// An invite link is shown once. Nothing is emailed. Only a hash of the code is stored.
import crypto from "node:crypto";
import { HOSTED } from "../store.js";
import { seatCheck, assertSeats, EXTREME_TEAM_SEATS } from "../team-seat.js";
import { redact, bad } from "../together-text.js";
import { isBlocked } from "../moderation.js";
import { blockedUrl } from "../app-drivers.js";

export const id = "teamspaces";
const DOC = "teamspaces";
const INVITE_DAYS = 14;
const INVITABLE = ["admin", "member", "viewer"];

export const ROLES = ["owner", "admin", "member", "viewer"];
export const PERMISSIONS = {
  "space.view": ["owner", "admin", "member", "viewer"],
  "projects.view": ["owner", "admin", "member", "viewer"],
  "projects.share": ["owner", "admin"],
  "members.invite": ["owner", "admin"],
  "members.remove": ["owner", "admin"],
  "members.role": ["owner", "admin"],
  "space.rename": ["owner", "admin"],
  "space.delete": ["owner"],
};
export const can = (role, action) => !!PERMISSIONS[action]?.includes(role);
export const permissionsFor = (role) => Object.fromEntries(Object.keys(PERMISSIONS).map((a) => [a, can(role, a)]));

export function canManageMember(actorRole, targetRole, newRole = null) {
  if (actorRole === "owner") return targetRole !== "owner" && (newRole === null || INVITABLE.includes(newRole));
  if (actorRole === "admin") return ["member", "viewer"].includes(targetRole) && (newRole === null || ["member", "viewer"].includes(newRole));
  return false;
}

const clean = (email) => String(email || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
export const hashCode = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");
const newCode = () => crypto.randomBytes(18).toString("base64url");
const nid = () => "ts-" + crypto.randomBytes(6).toString("hex");
const me = (h) => { try { return clean(h.ctx().email) || "you"; } catch { return "you"; } };

function load(h) {
  const d = h.doc(DOC, () => ({ list: [] }));
  d.list ||= [];
  for (const s of d.list) { s.members ||= []; s.projects ||= []; }
  return d;
}
const save = (h, d) => h.putDoc(DOC, d);

function seatCount(d) {
  if (!d.list.length) return 0;
  const emails = new Set();
  for (const s of d.list) for (const m of s.members) if (m.email) emails.add(m.email);
  return 1 + emails.size;
}

function find(d, id) {
  const s = d.list.find((x) => x.id === id);
  if (!s) throw bad(404, "Team space not found.", "missing");
  return s;
}

function snapshotProject(h, id) {
  const p = (h.listProjects() || []).find((x) => x.id === id);
  if (!p) return { id, name: id, summary: "" };
  return { id: p.id, name: p.name, summary: redact(p.summary || "", 240) };
}

function viewSpace(h, s) {
  const blocks = (m) => isBlocked(h, m.email);
  return {
    id: s.id, name: s.name, createdAt: s.createdAt, role: "owner",
    permissions: permissionsFor("owner"),
    seats: 1 + s.members.length,
    members: s.members.filter((m) => !blocks(m)).map((m) => ({
      email: m.email, role: m.role, status: m.status, invitedAt: m.invitedAt, expiresAt: m.expiresAt || null, joinedAt: m.joinedAt || null,
    })),
    hiddenMembers: s.members.filter(blocks).length,
    projects: s.projects.map((pid) => snapshotProject(h, pid)),
  };
}

// An invite link only helps if the other person can open it. A link that starts with this computer's own
// address (127.0.0.1, localhost, 192.168.x) is a dead end, so it is never made. The link is built only
// from a public https address: CC_PUBLIC_URL, or the address the request came to when that is public.
export function inviteOrigin(req, env = process.env) {
  const fixed = String(env.CC_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (fixed && blockedUrl(fixed) === "") return new URL(fixed).origin;
  const host = String(req?.headers?.host || "").trim();
  if (host && blockedUrl(`https://${host}`) === "") return `https://${host}`;
  return "";
}

export function inviteLink(code, req) {
  const origin = inviteOrigin(req);
  return origin ? `${origin}/#teamjoin=${code}` : "";
}

export function inviteMessage({ space, code, link, role }) {
  const lines = [
    `You are invited to join "${space}" on Meldmind as ${role === "viewer" ? "a viewer" : role === "admin" ? "an admin" : "a member"}.`,
    "",
    "1. Open Meldmind on your computer.",
    "2. Go to Together, then Team spaces.",
    `3. Paste this code in the Join box and press Join: ${code}`,
  ];
  if (link) lines.push("", `Or open this link: ${link}`);
  lines.push("", "The code works once and expires in 14 days.");
  return lines.join("\n");
}

async function seatInfo(h) {
  const d = load(h);
  const used = seatCount(d);
  const gate = await seatCheck(used);
  const open = await seatCheck(0);
  return {
    used, limit: open.limit === Infinity ? null : open.limit, cap: EXTREME_TEAM_SEATS,
    tier: gate.tier, open: !!open.ok, full: !gate.ok, source: gate.source,
    code: open.ok ? (gate.ok ? null : gate.code) : open.code,
    message: open.ok ? (gate.ok ? null : gate.message) : open.message,
  };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/teamspaces/, "").replace(/\/$/, "") || "/";
  const d = load(h);

  if (req.method === "GET" && p === "/") {
    const seats = await seatInfo(h);
    return h.json(res, 200, {
      spaces: d.list.map((s) => viewSpace(h, s)),
      seats, roles: ROLES, me: me(h), hosted: HOSTED, hub: false,
      note: "Extreme includes 5 seats, counting you. Studio workspaces are separate and stay as they are.",
    });
  }

  if (req.method === "POST" && p === "/") {
    const name = String(body.name || "").trim();
    if (!name || name.length > 80) throw bad(400, "Give the team space a name.", "name");
    await assertSeats(0);
    const s = { id: nid(), name: redact(name, 80), createdAt: Date.now(), members: [], projects: [] };
    d.list.push(s);
    save(h, d);
    return h.json(res, 200, viewSpace(h, s));
  }

  const parts = p.split("/").filter(Boolean);
  if (parts[0] === "join" && req.method === "POST") {
    const code = String(body.code || "").trim();
    if (!code) throw bad(400, "Paste the invite code.", "code");
    const hash = hashCode(code);
    let hit = null, space = null;
    for (const s of d.list) {
      const m = s.members.find((x) => x.inviteHash === hash);
      if (m) { hit = m; space = s; break; }
    }
    if (!hit) throw bad(404, "That invite link is not valid.", "invite");
    if (hit.expiresAt && hit.expiresAt < Date.now()) throw bad(410, "That invite link has expired. Ask for a new one.", "expired");
    hit.status = "active";
    hit.joinedAt = Date.now();
    delete hit.inviteHash;
    save(h, d);
    return h.json(res, 200, { ok: true, emailed: false, local: !HOSTED, spaceId: space.id, email: hit.email, role: hit.role });
  }

  if (parts.length >= 1 && parts[0] !== "join") {
    const s = find(d, parts[0]);
    if (req.method === "PATCH" && parts.length === 1) {
      if (!can("owner", "space.rename")) throw bad(403, "You cannot rename this team space.", "role");
      const name = String(body.name || "").trim();
      if (!name || name.length > 80) throw bad(400, "Give the team space a name.", "name");
      s.name = redact(name, 80);
      save(h, d);
      return h.json(res, 200, viewSpace(h, s));
    }
    if (req.method === "DELETE" && parts.length === 1) {
      d.list = d.list.filter((x) => x.id !== s.id);
      save(h, d);
      return h.json(res, 200, { ok: true });
    }
    if (parts[1] === "members" && req.method === "POST" && parts.length === 2) {
      const email = clean(body.email);
      const role = String(body.role || "member").toLowerCase();
      if (!validEmail(email)) throw bad(400, "Enter a real email address. Nothing is emailed.", "email");
      if (!INVITABLE.includes(role)) throw bad(400, "Pick admin, member, or viewer.", "role");
      if (isBlocked(h, email)) throw bad(403, "You blocked this person. Unblock them before inviting.", "blocked");
      if (s.members.some((m) => m.email === email)) throw bad(409, "That person is already in this team space.", "duplicate");
      const known = d.list.some((sp) => sp.members.some((m) => m.email === email));
      if (!known) await assertSeats(seatCount(d));
      const code = newCode();
      const expiresAt = Date.now() + INVITE_DAYS * 86400000;
      s.members.push({ email, role, status: "invited", invitedAt: Date.now(), expiresAt, joinedAt: null, inviteHash: hashCode(code) });
      save(h, d);
      const link = inviteLink(code, req);
      return h.json(res, 200, { email, role, emailed: false, expiresAt, link, code, message: inviteMessage({ space: s.name, code, link, role }) });
    }
    if (parts[1] === "members" && parts[2] && req.method === "PATCH") {
      const email = clean(decodeURIComponent(parts[2]));
      const m = s.members.find((x) => x.email === email);
      if (!m) throw bad(404, "That person is not in this team space.", "missing");
      const role = String(body.role || "").toLowerCase();
      if (!canManageMember("owner", m.role, role)) throw bad(400, "That role change is not allowed.", "role");
      m.role = role;
      save(h, d);
      return h.json(res, 200, { email, role });
    }
    if (parts[1] === "members" && parts[2] && req.method === "DELETE") {
      const email = clean(decodeURIComponent(parts[2]));
      const m = s.members.find((x) => x.email === email);
      if (!m) throw bad(404, "That person is not in this team space.", "missing");
      if (!canManageMember("owner", m.role, null)) throw bad(403, "You cannot remove that person.", "role");
      s.members = s.members.filter((x) => x.email !== email);
      save(h, d);
      return h.json(res, 200, { ok: true });
    }
    if (parts[1] === "projects" && req.method === "POST" && parts.length === 2) {
      const projectId = String(body.projectId || "");
      const project = (h.listProjects() || []).find((x) => x.id === projectId);
      if (!project) throw bad(404, "Project not found.", "missing");
      if (!s.projects.includes(projectId)) s.projects.push(projectId);
      save(h, d);
      return h.json(res, 200, { ok: true, project: snapshotProject(h, projectId) });
    }
    if (parts[1] === "projects" && parts[2] && req.method === "DELETE") {
      const projectId = decodeURIComponent(parts[2]);
      s.projects = s.projects.filter((id) => id !== projectId);
      save(h, d);
      return h.json(res, 200, { ok: true });
    }
  }
  return false;
}
