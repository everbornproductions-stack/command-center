// What's new after an update, and the suggestion box.
// A card can be tried, skipped, or snoozed. Nothing connects, sends, or posts from here.
// Delivery of a suggestion is a loopback stub, or a local queue when that stub is absent.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { ROOT } from "./paths.js";
import { addIdeaUpload, assertNoSecret, claimPending, dropPending, pendingMeta, removeIdeaFiles, savePending } from "./box-files.js";

export const DOC = "everyday.news";
export const MANIFEST_ID = "everyday-2026-10-20";
export const THANKS = "Thanks, Chris reads these";
export const DAY = 86400000;

export const TRY_INBOX = "What needs me today in all my inboxes?";
export const TRY_SUGGEST = "I want a connection for my calendar";

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

export const ITEMS = [
  { id: "calendar", kind: "connection", title: "Google Calendar is now available", detail: "Connect from the checklist. Sign-in starts only from that row.", say: "" },
  { id: "inbox", kind: "action", title: "Inbox summary", say: TRY_INBOX },
  { id: "reply", kind: "action", title: "Reply in my tone", say: "Reply to Dana, say yes to Thursday" },
  { id: "brief", kind: "action", title: "Morning briefing", say: "Every weekday at 8: agenda, inbox, tasks, weather, and news" },
  { id: "remind", kind: "action", title: "Reminders and to-dos", say: "Remind me at 5 to call Mom" },
  { id: "extract", kind: "action", title: "Email to a task or a hold", say: "Turn this email into a task and a calendar hold" },
  { id: "slots", kind: "action", title: "Find a time", say: "Find 3 open 30 min slots next week for Ana" },
  { id: "docs", kind: "action", title: "Find and summarize a doc", say: "Find the Q3 proposal and summarize it" },
  { id: "meeting", kind: "action", title: "Meeting prep", say: "Prep me for my 2pm" },
  { id: "leads", kind: "action", title: "New lead follow-up", say: "When a new HighLevel lead comes in, draft a text and email" },
];

const SAMPLES = {
  inbox: "Sample only. Home: Dana asked about Thursday. Work: Mark asked a question. Nothing was sent.",
  reply: "Sample draft: Yes, Thursday works. This stays a draft until you click Send on the inbox page.",
  brief: "Sample briefing: agenda, inbox, and tasks. Weather and news were not fetched. Nothing was sent.",
  remind: "Sample reminder: call Mom at 5:00. It stays on this computer.",
  extract: "Sample: a task and a local hold. Google Calendar was not written.",
  slots: "Sample: three open slots drafted for Ana. The email was not sent.",
  docs: "Sample summary of the Q3 proposal. Read only. Nothing was saved to Drive.",
  meeting: "Sample: prep notes and two action items. Nothing was emailed.",
  leads: "Sample drafts: one email and one text. Neither was sent. Twilio was not contacted.",
};

export const HOWTO = [
  { id: "news", title: "What's new", say: TRY_INBOX, steps: ["After an update, read each new connection and action.", "Try it runs a sample and does not send.", "Skip hides that item for good.", "Remind me later waits 3 days, then 7 days, then the item moves to Settings and stops asking.", "Skip all clears the card. Sign-in still starts only from the checklist."] },
  { id: "suggest", title: "Suggest a connection or idea", say: TRY_SUGGEST, steps: ["Open Settings, the What's new card, or the connections page when nothing is connected.", "Write the idea, or use Voice and edit the words. Upload a file, a screenshot, or a document if you want. Up to 4 files, about 4 MB each. They stay on this computer.", "Pick a category if you want. An email is optional.", "Leave the version and OS box on, or turn it off. Chat is not included.", "Read the exact note, then click Send.", "After that you can edit, delete, or re-prioritize the idea, add a comment, and set a status: new, planned, building, or shipped. Those changes stay on this computer and are not sent again."] },
];

export const IDEA_STATUSES = ["new", "planned", "building", "shipped"];
const IDEA_STATUS = new Set(IDEA_STATUSES);

const CATS = new Set(["connection", "action", "bug", "other"]);
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const nid = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function loopbackUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== "http:") return null;
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return null;
  return u.toString();
}

export function clockNow(bodyNow) {
  if (process.env.CC_EVERYDAY_CLOCK === "1") {
    const n = Number(bodyNow);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}

function blank(id) {
  return { id, status: "pending", snoozes: 0, remindAt: null };
}

function state() {
  const d = doc(DOC, () => ({ manifest: MANIFEST_ID, items: {}, queue: [] }));
  d.items ||= {};
  d.queue ||= [];
  d.manifest = MANIFEST_ID;
  for (const item of ITEMS) if (!d.items[item.id]) d.items[item.id] = blank(item.id);
  return d;
}
const save = (d) => putDoc(DOC, d);

export function settleStatus(row, now) {
  if (row?.status === "later" && (row.snoozes || 0) >= 2 && now >= (row.remindAt || 0)) {
    return { ...row, status: "settings" };
  }
  return row;
}

export function shouldPrompt(row, now) {
  const r = settleStatus(row || { status: "pending" }, now);
  if (r.status === "pending") return true;
  if (r.status === "later" && now >= (r.remindAt || 0)) return true;
  return false;
}

export function nextSnooze(row, now) {
  const n = row?.snoozes || 0;
  if (row?.status === "skipped" || row?.status === "settings") return { ...row };
  if (n >= 2) return { ...row, status: "settings" };
  if (n <= 0) return { ...row, status: "later", snoozes: 1, remindAt: now + 3 * DAY };
  return { ...row, status: "later", snoozes: 2, remindAt: now + 7 * DAY };
}

function itemById(id) {
  const item = ITEMS.find((x) => x.id === id);
  if (!item) throw fail(404, "That item is not in this update.");
  return item;
}

function applySettle(d, now) {
  let changed = false;
  for (const item of ITEMS) {
    const next = settleStatus(d.items[item.id], now);
    if (next.status !== d.items[item.id].status) {
      d.items[item.id] = next;
      changed = true;
    }
  }
  if (changed) save(d);
}

function publicItem(item, row) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    detail: item.detail || "",
    say: item.say || "",
    status: row.status,
    snoozes: row.snoozes || 0,
    remindAt: row.remindAt || null,
  };
}

export function view(now = Date.now()) {
  const d = state();
  applySettle(d, now);
  const prompt = [];
  const settings = [];
  for (const item of ITEMS) {
    const row = d.items[item.id];
    const pub = publicItem(item, row);
    if (shouldPrompt(row, now)) prompt.push(pub);
    else if (row.status === "settings") settings.push(pub);
  }
  return {
    manifest: MANIFEST_ID,
    prompt,
    settings,
    waiting: d.queue.filter((q) => !q.delivered).length,
    thanks: THANKS,
    trySaying: { news: TRY_INBOX, suggest: TRY_SUGGEST },
    howto: HOWTO,
    ideas: ideaList(d.queue).map(publicIdea),
    safety: "Nothing connects, sends, posts, or deletes from this card. Sign-in starts only from the checklist.",
  };
}

export function remindLater(id, now) {
  const d = state();
  applySettle(d, now);
  itemById(id);
  const row = d.items[id];
  if (row.status === "skipped") return publicItem(itemById(id), row);
  d.items[id] = nextSnooze(row, now);
  save(d);
  return publicItem(itemById(id), d.items[id]);
}

export function skipItem(id) {
  const d = state();
  itemById(id);
  d.items[id] = { ...d.items[id], status: "skipped" };
  save(d);
  return publicItem(itemById(id), d.items[id]);
}

export function skipAll() {
  const d = state();
  for (const item of ITEMS) {
    const row = d.items[item.id];
    if (row.status === "pending" || row.status === "later") d.items[item.id] = { ...row, status: "skipped" };
  }
  save(d);
  return view(Date.now());
}

export function tryItem(id) {
  const item = itemById(id);
  if (item.kind !== "action") throw fail(400, "Try it is for an action. A connection uses the checklist.");
  const d = state();
  d.items[id] = { ...d.items[id], status: "tried" };
  save(d);
  return { item: publicItem(item, d.items[id]), sample: SAMPLES[id] || "Sample only. Nothing was sent.", sends: false, readOnly: true };
}

export function connectItem(id) {
  const item = itemById(id);
  if (item.kind !== "connection") throw fail(400, "Connect is only for a new connection.");
  const d = state();
  d.items[id] = { ...d.items[id], status: "done" };
  save(d);
  return {
    started: false,
    focus: "[data-id='calendar']",
    message: "Sign-in starts only from the checklist row.",
    item: publicItem(item, d.items[id]),
  };
}

function fileNames(fileIds) {
  if (!fileIds) return [];
  if (!Array.isArray(fileIds)) throw fail(400, "Files were not listed correctly.");
  if (fileIds.length > 4) throw fail(400, "Up to 4 files can go with one idea.");
  const seen = new Set();
  return fileIds.map((id) => {
    if (seen.has(id)) throw fail(400, "That file is already attached.");
    seen.add(id);
    return { name: pendingMeta(id).name };
  });
}

export function buildSuggestion({ text, category = "other", email = "", includeMeta = true, fileIds } = {}, env = process.env) {
  const clean = assertNoSecret(clip(text, 2000));
  if (!clean) throw fail(400, "Write a suggestion first.");
  const cat = String(category || "other");
  if (!CATS.has(cat)) throw fail(400, "Pick connection, action, bug, or other.");
  const mail = clip(email, 120);
  if (mail && !EMAIL.test(mail)) throw fail(400, "That email address does not look right.");
  const payload = { text: clean, category: cat };
  if (mail) payload.email = mail;
  if (includeMeta !== false) {
    payload.version = VERSION;
    payload.os = env.CC_EVERYDAY_OS || process.platform;
  }
  const names = fileNames(fileIds);
  if (names.length) payload.files = names;
  return payload;
}

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
  return out;
}

function samePayload(a, b) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

async function postLoopback(payload) {
  const url = loopbackUrl(process.env.CC_EVERYDAY_FEEDBACK_URL);
  if (!url) return false;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  return r.ok;
}

export async function sendSuggestion(body) {
  if (body?.confirm !== true) throw fail(400, "Send is a separate click.");
  const expected = buildSuggestion(body || {});
  if (!samePayload(expected, body?.payload)) {
    throw fail(400, "The note on the page does not match what would be sent. Read it again.");
  }
  const d = state();
  const id = nid("sg");
  const files = claimPending(id, body?.fileIds || []);
  const row = {
    id,
    payload: expected,
    createdAt: Date.now(),
    delivered: false,
    status: "new",
    rank: nextRank(d.queue),
    comments: [],
    files,
  };
  try { row.delivered = await postLoopback(expected); } catch { row.delivered = false; }
  d.queue.push(row);
  if (d.queue.length > 100) {
    const dropped = d.queue.splice(0, d.queue.length - 100);
    for (const old of dropped) removeIdeaFiles(old.id);
  }
  save(d);
  return {
    thanks: THANKS,
    delivered: row.delivered,
    queued: !row.delivered,
    payload: expected,
    id: row.id,
    idea: publicIdea(row),
    resent: false,
  };
}

function nextRank(queue) {
  return queue.reduce((max, row) => Math.max(max, row.rank || 0), 0) + 1;
}

function ideaList(queue) {
  return [...queue].sort((a, b) => (a.rank || 0) - (b.rank || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

function publicIdea(row) {
  const payload = row.payload || {};
  return {
    id: row.id,
    text: payload.text || "",
    category: payload.category || "other",
    status: IDEA_STATUS.has(row.status) ? row.status : "new",
    rank: row.rank || 0,
    createdAt: row.createdAt || 0,
    delivered: !!row.delivered,
    files: (row.files || []).map(({ id, name, mime, bytes }) => ({ id, name, mime, bytes })),
    comments: (row.comments || []).map(({ id, text, createdAt }) => ({ id, text, createdAt })),
  };
}

function findIdea(d, id) {
  const row = d.queue.find((item) => item.id === id);
  if (!row) throw fail(404, "That idea is not on this computer.");
  return row;
}

const keptLocal = "Saved on this computer. This edit was not sent.";

export function updateIdea(id, body = {}) {
  const d = state();
  const row = findIdea(d, id);
  if (body.text != null || body.category != null) {
    const next = buildSuggestion({
      text: body.text != null ? body.text : row.payload?.text,
      category: body.category || row.payload?.category || "other",
      email: row.payload?.email || "",
      includeMeta: false,
    });
    row.payload = { ...row.payload, text: next.text, category: next.category };
  }
  if (body.status != null) {
    const status = String(body.status);
    if (!IDEA_STATUS.has(status)) throw fail(400, "Status is new, planned, building, or shipped.");
    row.status = status;
  }
  row.comments ||= [];
  row.files ||= [];
  save(d);
  return { idea: publicIdea(row), ideas: ideaList(d.queue).map(publicIdea), resent: false, message: keptLocal };
}

export function addIdeaComment(id, text) {
  const clean = assertNoSecret(clip(text, 1000));
  if (!clean) throw fail(400, "Write a comment first.");
  const d = state();
  const row = findIdea(d, id);
  row.comments ||= [];
  row.comments.push({ id: nid("cm"), text: clean, createdAt: Date.now() });
  save(d);
  return { idea: publicIdea(row), resent: false, message: "Saved on this computer. The comment was not sent." };
}

export function moveIdea(id, direction) {
  if (direction !== "up" && direction !== "down") throw fail(400, "Move an idea up or down.");
  const d = state();
  const list = ideaList(d.queue);
  list.forEach((row, index) => { row.rank = index + 1; });
  const index = list.findIndex((row) => row.id === id);
  if (index < 0) throw fail(404, "That idea is not on this computer.");
  const next = direction === "up" ? index - 1 : index + 1;
  if (next >= 0 && next < list.length) {
    const rank = list[index].rank;
    list[index].rank = list[next].rank;
    list[next].rank = rank;
  }
  save(d);
  return { idea: publicIdea(list[index]), ideas: ideaList(d.queue).map(publicIdea), resent: false };
}

export function deleteIdea(id) {
  const d = state();
  const index = d.queue.findIndex((row) => row.id === id);
  if (index < 0) throw fail(404, "That idea is not on this computer.");
  const [row] = d.queue.splice(index, 1);
  removeIdeaFiles(row.id);
  save(d);
  return { deleted: true, id: row.id, ideas: ideaList(d.queue).map(publicIdea) };
}

export function attachPending(body) {
  return savePending(body || {});
}

export function forgetPending(id) {
  return dropPending(id);
}

export function attachToIdea(id, body) {
  const d = state();
  const row = findIdea(d, id);
  row.files ||= [];
  const file = addIdeaUpload(id, body || {}, row.files.length);
  row.files.push(file);
  save(d);
  return { file, idea: publicIdea(row), resent: false, message: "Saved on this computer. This file was not sent." };
}

export function previewSuggestion(body) {
  return { payload: buildSuggestion(body || {}), sends: false, queued: false };
}
