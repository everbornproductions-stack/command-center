// Chat rooms by category (Phase 43). A running build can be shared into a room
// so it can be watched, then copied as a recipe. Opt in per mission.
// Local on this PC. A hosted hub is not deployed. No keys are shared.
import crypto from "node:crypto";
import { HOSTED } from "../store.js";
import { redact, bad } from "../together-text.js";
import { isBlocked, fileReport, blockPerson } from "../moderation.js";

export const id = "rooms";
const DOC = "rooms";
export const CATEGORIES = ["General", "Marketing", "Code", "Video", "Business", "Design"];

const nid = (prefix) => prefix + crypto.randomBytes(6).toString("hex");

function load(h) {
  const d = h.doc(DOC, () => ({ rooms: [], recipes: [] }));
  d.rooms ||= [];
  d.recipes ||= [];
  return d;
}

export function liveSnapshot(m) {
  const tasks = (m?.tasks || []).slice(0, 24).map((t) => ({
    title: redact(t.title || "Step", 160),
    status: String(t.status || "pending").slice(0, 40),
  }));
  const running = tasks.find((t) => t.status === "running" || t.status === "working");
  const waiting = tasks.find((t) => t.status !== "done" && t.status !== "failed");
  return {
    missionId: m.id,
    title: redact(m.title || "Build", 120),
    status: String(m.status || "running").slice(0, 40),
    step: running?.title || waiting?.title || (tasks.length ? "Watching" : "No steps yet"),
    tasks,
    goal: redact(m.prompt || m.goal || m.title || "", 800),
    updatedAt: Date.now(),
  };
}

function viewRoom(h, room) {
  const messages = (room.messages || []).filter((m) => !m.hidden && !isBlocked(h, m.authorId) && !isBlocked(h, m.author));
  return {
    id: room.id,
    name: room.name,
    category: room.category,
    createdAt: room.createdAt,
    members: (room.members || []).filter((m) => !isBlocked(h, m.id) && !isBlocked(h, m.name)).map((m) => ({ id: m.id, name: m.name, role: m.role })),
    hiddenMembers: (room.members || []).filter((m) => isBlocked(h, m.id) || isBlocked(h, m.name)).length,
    messages: messages.slice(-50).map((m) => ({ id: m.id, author: m.author, text: m.text, at: m.at })),
    hiddenMessages: (room.messages || []).filter((m) => m.hidden).length,
    live: publicLive(room.live),
    hub: false,
  };
}

async function missionOf(h, id) {
  try { return await h.ctx().store.getMission(id); }
  catch { return null; }
}

export function onEvent(ev, h) {
  if (ev.type !== "mission.update" || !ev.mission?.id) return;
  const d = load(h);
  let changed = false;
  for (const room of d.rooms) {
    if (room.live?.missionId !== ev.mission.id) continue;
    room.live = liveSnapshot(ev.mission);
    changed = true;
  }
  if (changed) h.putDoc(DOC, d);
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/rooms/, "").replace(/\/$/, "") || "/";
  const d = load(h);

  if (req.method === "GET" && p === "/") {
    return h.json(res, 200, {
      categories: CATEGORIES,
      hosted: HOSTED,
      hub: false,
      rooms: d.rooms.map((r) => ({ id: r.id, name: r.name, category: r.category, live: !!r.live, members: (r.members || []).length })),
      recipes: d.recipes.map(publicRecipe),
      note: "Rooms stay on this PC. A hosted hub is not running. Nothing is posted until you click.",
    });
  }

  if (req.method === "POST" && p === "/") {
    const name = redact(String(body.name || "").trim(), 80);
    const category = String(body.category || "");
    if (!name) throw bad(400, "Name the room.", "name");
    if (!CATEGORIES.includes(category)) throw bad(400, "Pick a category.", "category");
    const room = { id: nid("room-"), name, category, createdAt: Date.now(), members: [{ id: "you", name: "You", role: "owner" }], messages: [], live: null };
    d.rooms.push(room);
    h.putDoc(DOC, d);
    return h.json(res, 200, viewRoom(h, room));
  }

  const parts = p.split("/").filter(Boolean);

  if (parts[0] === "recipes" && parts[1] && req.method === "POST" && parts[2] === "start") {
    const recipe = d.recipes.find((r) => r.id === parts[1]);
    if (!recipe) throw bad(404, "Recipe not found.", "missing");
    if (!recipe.goal) throw bad(400, "This recipe has no goal to run.", "goal");
    let promise;
    try {
      promise = h.runMission({ goal: recipe.goal, mode: "economy", context: (recipe.steps || []).join("\n"), budgetUsd: 1 });
    } catch (e) {
      throw bad(e.status || 402, e.message, e.code || "pro_required");
    }
    promise?.catch?.((e) => h.emit("log", { text: `Recipe run failed: ${e.message}`, level: "error" }));
    return h.json(res, 202, { ok: true, recipeId: recipe.id, emailed: false });
  }

  if (!parts.length || parts[0] === "recipes") return false;
  const room = d.rooms.find((r) => r.id === parts[0]);
  if (!room) throw bad(404, "Room not found.", "missing");

  if (req.method === "GET" && parts.length === 1) return h.json(res, 200, viewRoom(h, room));

  if (req.method === "POST" && parts[1] === "messages" && parts[2] && parts[3] === "hide") {
    const message = room.messages.find((m) => m.id === parts[2]);
    if (!message) throw bad(404, "Message not found.", "missing");
    message.hidden = true;
    h.putDoc(DOC, d);
    return h.json(res, 200, { ok: true, hidden: true });
  }

  if (req.method === "POST" && parts[1] === "members" && parts.length === 2) {
    const name = redact(String(body.name || "").trim(), 60);
    if (!name) throw bad(400, "Name the person.", "name");
    if (isBlocked(h, name)) throw bad(403, "You blocked this person.", "blocked");
    const member = { id: nid("who-"), name, role: "member" };
    room.members.push(member);
    h.putDoc(DOC, d);
    return h.json(res, 200, { member });
  }

  if (req.method === "POST" && parts[1] === "messages" && parts.length === 2) {
    const text = redact(String(body.text || "").trim(), 2000);
    if (!text) throw bad(400, "Write a message. Nothing is sent until you click.", "text");
    const message = { id: nid("msg-"), author: "You", authorId: "you", text, at: Date.now(), hidden: false };
    room.messages.push(message);
    if (room.messages.length > 200) room.messages.splice(0, room.messages.length - 200);
    h.putDoc(DOC, d);
    return h.json(res, 200, { message, sent: false });
  }

  if (req.method === "POST" && parts[1] === "live") {
    const mission = await missionOf(h, String(body.missionId || ""));
    if (!mission) throw bad(404, "That build was not found on this PC.", "missing");
    room.live = liveSnapshot(mission);
    h.putDoc(DOC, d);
    const pub = viewRoom(h, room);
    return h.json(res, 200, { live: pub.live, recipeReady: !!room.live.goal });
  }

  if (req.method === "POST" && parts[1] === "recipe") {
    if (!room.live) throw bad(400, "Share a build into this room first.", "live");
    const recipe = {
      id: nid("recipe-"),
      roomId: room.id,
      title: room.live.title,
      goal: room.live.goal,
      steps: (room.live.tasks || []).map((t) => t.title),
      sourceMissionId: room.live.missionId,
      createdAt: Date.now(),
    };
    d.recipes.push(recipe);
    h.putDoc(DOC, d);
    return h.json(res, 200, { recipe: publicRecipe(recipe), copied: true });
  }

  if (req.method === "POST" && parts[1] === "report") {
    const row = fileReport(h, { area: "rooms", targetType: body.targetType, targetId: body.targetId || room.id, reason: body.reason });
    return h.json(res, 200, row);
  }

  if (req.method === "POST" && parts[1] === "block") {
    const key = body.key || body.memberId || body.name;
    const row = blockPerson(h, key);
    return h.json(res, 200, row);
  }

  return false;
}

function publicLive(live) {
  if (!live) return null;
  const copy = { ...live };
  delete copy.goal;
  return copy;
}

function publicRecipe(recipe) {
  return {
    id: recipe.id,
    roomId: recipe.roomId,
    title: recipe.title,
    goal: recipe.goal,
    steps: recipe.steps || [],
    createdAt: recipe.createdAt,
  };
}
