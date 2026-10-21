// People chat (Phase 92). Direct messages and small groups for people in the same
// team space. Messages stay on this computer until a hub address is set. Nothing is
// sent until Send. Keys and private-mode content are never included.
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { HOSTED } from "./store.js";
import { localFetch } from "./loopback-fetch.js";
import { redact, hasSecret, bad } from "./redact-text.js";

export const DOC = "userchat";
export const MAX_PEOPLE = 8;
const SEND_ROLES = new Set(["owner", "admin", "member"]);

const empty = () => ({ threads: [], blocks: [], reports: [], inbox: [] });
const clean = (email) => String(email || "").trim().toLowerCase();
const nid = (prefix) => prefix + crypto.randomBytes(6).toString("hex");

export function me(h) {
  try { return clean(h.ctx().email) || "you"; } catch { return "you"; }
}

function load(h) {
  const d = h.doc(DOC, empty);
  d.threads ||= [];
  d.blocks ||= [];
  d.reports ||= [];
  d.inbox ||= [];
  return d;
}

function shapeSpace(kind, row) {
  const members = [];
  for (const m of row.members || []) {
    const email = clean(m.email);
    if (!email) continue;
    members.push({ email, role: m.role || "member", status: m.status || "active" });
  }
  return { id: row.id, name: row.name || "Team space", kind, members };
}

export function readSpaces(h) {
  let docs = {};
  try { docs = h.ctx().docs || {}; } catch { docs = {}; }
  const teams = docs.teamspaces;
  if (teams && Array.isArray(teams.list) && teams.list.length) return teams.list.map((row) => shapeSpace("teamspace", row));
  const ws = docs.workspaces;
  if (ws && Array.isArray(ws.list) && ws.list.length) return ws.list.map((row) => shapeSpace("workspace", row));
  return [];
}

export function roleIn(space, who) {
  const hit = (space?.members || []).find((m) => m.email === who);
  if (hit) return hit.role || "member";
  return "owner";
}

export function hubTarget() {
  if (HOSTED) return { configured: true, mode: "hosted", host: "" };
  const raw = String(process.env.CC_USERCHAT_HUB || "").trim();
  if (!raw) return { configured: false, mode: "local", host: "" };
  let u;
  try { u = new URL(raw); } catch { return { configured: false, mode: "local", host: "", error: "The hub address is not valid." }; }
  if (u.username || u.password) return { configured: false, mode: "local", host: "", error: "The hub address cannot include a password." };
  const loop = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
  if (u.protocol === "http:" && !loop) return { configured: false, mode: "local", host: "", error: "The hub address must be https." };
  if (u.protocol !== "https:" && u.protocol !== "http:") return { configured: false, mode: "local", host: "", error: "The hub address must be https." };
  return { configured: true, mode: "remote", host: u.host, url: u.origin };
}

let modCached;
async function sharedMod() {
  if (modCached !== undefined) return modCached;
  const file = new URL("./moderation.js", import.meta.url);
  if (!fs.existsSync(file)) { modCached = null; return null; }
  try { modCached = await import(pathToFileURL(file).href); }
  catch { modCached = null; }
  return modCached;
}

async function blockedSet(h) {
  const mod = await sharedMod();
  if (mod?.blockKeys) {
    try { return mod.blockKeys(h); } catch { /* use the local list */ }
  }
  return new Set(load(h).blocks.map((b) => b.key));
}

export function privateReason(h, body) {
  if (body?.private === true || body?.privateMode === true || body?.source === "private") {
    return "Private mode stays on this computer. It is not shared.";
  }
  const id = String(body?.privateChatId || "");
  if (!id) return "";
  let bag = null;
  try { bag = h.ctx().docs["private.mode"]; } catch { bag = null; }
  const ids = bag?.chats || bag?.ids || [];
  if (Array.isArray(ids) && ids.map(String).includes(id)) return "Private mode stays on this computer. It is not shared.";
  return "";
}

function spaceFor(h, spaceId) {
  const spaces = readSpaces(h);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) throw bad(404, "Team space not found.", "missing");
  return space;
}

function assertCanSend(space, who) {
  const role = roleIn(space, who);
  if (!SEND_ROLES.has(role)) throw bad(403, "A viewer can read the team space but cannot send a message.", "role");
  return role;
}

function othersInSpace(space, who, emails) {
  const known = new Map(space.members.map((m) => [m.email, m]));
  const out = [];
  for (const raw of emails) {
    const email = clean(raw);
    if (!email || email === who) continue;
    if (!known.has(email)) throw bad(403, "That person is not in this team space.", "member");
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

function publicThread(thread, blocked) {
  if ((thread.members || []).some((email) => blocked.has(email))) return null;
  return {
    id: thread.id,
    kind: thread.kind,
    spaceId: thread.spaceId,
    spaceKind: thread.spaceKind,
    title: thread.title,
    members: thread.members,
    createdAt: thread.createdAt,
    messages: (thread.messages || []).map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at })),
  };
}

async function reportRows(h, d) {
  const mod = await sharedMod();
  if (mod?.readMod) {
    try {
      return (mod.readMod(h).reports || [])
        .filter((r) => !r.area || r.area === "userchat")
        .map((r) => ({ id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason, at: r.at, sent: false }));
    } catch { /* local copy below */ }
  }
  return (d.reports || []).map((r) => ({ id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason, at: r.at, sent: false }));
}

export async function overview(h) {
  const who = me(h);
  const blocked = await blockedSet(h);
  const d = load(h);
  const hub = hubTarget();
  const spaces = readSpaces(h).map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    role: roleIn(s, who),
    members: s.members.filter((m) => m.email !== who && !blocked.has(m.email)).map((m) => ({ email: m.email, role: m.role, status: m.status })),
  }));
  return {
    me: who,
    hub: { configured: !!hub.configured, mode: hub.mode, host: hub.host || "" },
    spaces,
    threads: d.threads.map((t) => publicThread(t, blocked)).filter(Boolean),
    blocks: [...blocked].map((key) => ({ key })),
    reports: await reportRows(h, d),
    sent: false,
    note: "Messages stay on this computer until a hub is set. Nothing is sent until you click Send. Keys and private mode are not shared.",
  };
}

export async function openThread(h, body) {
  const who = me(h);
  const space = spaceFor(h, String(body.spaceId || ""));
  assertCanSend(space, who);
  const listed = Array.isArray(body.members) ? body.members : body.with ? [body.with] : [];
  const others = othersInSpace(space, who, listed);
  const blocked = await blockedSet(h);
  if (others.some((email) => blocked.has(email))) throw bad(403, "You blocked this person. Unblock them before you message them.", "blocked");
  if (!others.length) throw bad(400, "Pick someone in this team space.", "members");
  const kind = others.length === 1 ? "direct" : "group";
  if (kind === "group" && others.length + 1 > MAX_PEOPLE) throw bad(400, "A small group can hold up to 8 people, including you.", "size");
  const d = load(h);
  if (kind === "direct") {
    const id = directId(space.id, who, others[0]);
    let thread = d.threads.find((t) => t.id === id);
    let created = false;
    if (!thread) {
      created = true;
      thread = { id, kind, spaceId: space.id, spaceKind: space.kind, title: others[0], members: [who, others[0]].sort(), messages: [], createdAt: Date.now() };
      d.threads.push(thread);
      h.putDoc(DOC, d);
    }
    return { thread: publicThread(thread, new Set()), created, sent: false };
  }
  const title = redact(String(body.title || others.join(", ")), 80);
  const thread = {
    id: nid("gp-"),
    kind,
    spaceId: space.id,
    spaceKind: space.kind,
    title,
    members: [who, ...others].sort(),
    messages: [],
    createdAt: Date.now(),
  };
  d.threads.push(thread);
  h.putDoc(DOC, d);
  return { thread: publicThread(thread, new Set()), created: true, sent: false };
}

export function directId(spaceId, a, b) {
  const key = [clean(a), clean(b)].sort().join("|");
  return "dm-" + crypto.createHash("sha256").update(`${spaceId}|${key}`).digest("hex").slice(0, 16);
}

async function deliver(hub, payload) {
  if (!hub.configured || hub.mode !== "remote" || !hub.url) return { delivered: false, skipped: true };
  const body = JSON.stringify({
    id: payload.id,
    threadId: payload.threadId,
    from: payload.from,
    text: payload.text,
    at: payload.at,
    members: payload.members,
    private: false,
  });
  try {
    const r = await localFetch(`${hub.url}/api/userchat/inbox`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-meldmind-chat": "1" },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    if (r.status >= 300 && r.status < 400) return { delivered: false, error: "The hub redirected the message. It was kept on this computer." };
    if (!r.ok) return { delivered: false, error: "The hub did not take the message. It was kept on this computer." };
    return { delivered: true };
  } catch {
    return { delivered: false, error: "The hub did not answer. The message was kept on this computer." };
  }
}

export async function sendMessage(h, threadId, body) {
  const held = privateReason(h, body);
  if (held) throw bad(400, held, "private");
  const textIn = String(body?.text || "");
  const text = redact(textIn, 2000).trim();
  if (!text) throw bad(400, "Write a message first.", "text");
  if (hasSecret(textIn) && redact(textIn, 2000).replace(/\[hidden\]/g, "").trim() === "") {
    throw bad(400, "That message looks like a key, so it was not sent.", "secret");
  }
  const who = me(h);
  const d = load(h);
  const thread = d.threads.find((t) => t.id === threadId);
  if (!thread) throw bad(404, "That chat is not here.", "missing");
  const space = spaceFor(h, thread.spaceId);
  assertCanSend(space, who);
  if (!thread.members.includes(who)) throw bad(403, "You are not in this chat.", "member");
  const blocked = await blockedSet(h);
  if (thread.members.some((email) => email !== who && blocked.has(email))) throw bad(403, "You blocked this person. Unblock them before you message them.", "blocked");
  const message = { id: nid("msg-"), from: who, text, at: Date.now() };
  const hub = hubTarget();
  const delivery = await deliver(hub, { ...message, threadId: thread.id, members: thread.members });
  thread.messages.push({ ...message, hub: delivery.delivered ? "hub" : "local" });
  if (thread.messages.length > 400) thread.messages.splice(0, thread.messages.length - 400);
  h.putDoc(DOC, d);
  return {
    message: { id: message.id, from: message.from, text: message.text, at: message.at },
    stored: hub.mode === "hosted" ? "hub" : "local",
    hub: { configured: !!hub.configured, delivered: !!delivery.delivered, error: delivery.error || null },
    sent: true,
  };
}

export async function blockPerson(h, email) {
  const key = clean(email);
  const who = me(h);
  if (!key || key === who) throw bad(400, "Pick someone else to block.", "block");
  const mod = await sharedMod();
  if (mod?.blockPerson) return { ...mod.blockPerson(h, key), sent: false };
  const d = load(h);
  if (!d.blocks.some((b) => b.key === key)) d.blocks.push({ key, at: Date.now() });
  h.putDoc(DOC, d);
  return { blocked: true, key, sent: false };
}

export async function unblockPerson(h, email) {
  const key = clean(email);
  const mod = await sharedMod();
  if (mod?.unblockPerson) return { ...mod.unblockPerson(h, key), sent: false };
  const d = load(h);
  d.blocks = d.blocks.filter((b) => b.key !== key);
  h.putDoc(DOC, d);
  return { blocked: false, key, sent: false };
}

export async function fileReport(h, body) {
  const mod = await sharedMod();
  if (mod?.fileReport) {
    const row = mod.fileReport(h, { ...body, area: "userchat" });
    return { ...row, sent: false };
  }
  const reason = redact(String(body?.reason || "").replace(/\s+/g, " ").trim(), 500);
  if (!reason) throw bad(400, "Say why you are reporting this.", "reason");
  const types = ["message", "member", "room", "reply"];
  if (!types.includes(body?.targetType)) throw bad(400, "Pick a message or a person to report.", "target");
  const d = load(h);
  const row = {
    id: nid("rp-"),
    area: "userchat",
    targetType: body.targetType,
    targetId: redact(String(body.targetId || ""), 120),
    reason,
    at: Date.now(),
    sent: false,
  };
  d.reports.push(row);
  if (d.reports.length > 200) d.reports.splice(0, d.reports.length - 200);
  h.putDoc(DOC, d);
  return row;
}

export async function receiveInbox(h, body) {
  const held = privateReason(h, body);
  if (held) throw bad(400, held, "private");
  const textIn = String(body?.text || "");
  const text = redact(textIn, 2000).trim();
  if (!text) throw bad(400, "Write a message first.", "text");
  if (hasSecret(textIn) && text.replace(/\[hidden\]/g, "").trim() === "") throw bad(400, "That message looks like a key, so it was not kept.", "secret");
  const d = load(h);
  const row = {
    id: redact(String(body.id || nid("in-")), 80),
    threadId: redact(String(body.threadId || ""), 80),
    from: clean(body.from) || "someone",
    text,
    at: Number(body.at) || Date.now(),
    members: Array.isArray(body.members) ? body.members.map(clean).filter(Boolean).slice(0, MAX_PEOPLE) : [],
    private: false,
  };
  d.inbox.push(row);
  if (d.inbox.length > 200) d.inbox.splice(0, d.inbox.length - 200);
  h.putDoc(DOC, d);
  return { ok: true, stored: "hub", sent: false, id: row.id };
}
