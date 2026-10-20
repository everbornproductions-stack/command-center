// What's new after an update, and the suggestion box.
// A card can be tried, skipped, or snoozed. Nothing connects, sends, or posts from here.
// Delivery of a suggestion is a loopback stub, or a local queue when that stub is absent.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { scrubText } from "./prompts/safety.js";
import { ROOT } from "./paths.js";

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
  { id: "suggest", title: "Suggest a connection or idea", say: TRY_SUGGEST, steps: ["Open Settings, the What's new card, or the connections page when nothing is connected.", "Write the idea. Pick a category if you want. An email is optional.", "Leave the version and OS box on, or turn it off. Chat is not included.", "Read the exact note, then click Send."] },
];

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

export function buildSuggestion({ text, category = "other", email = "", includeMeta = true } = {}, env = process.env) {
  const clean = clip(text, 2000);
  if (!clean) throw fail(400, "Write a suggestion first.");
  if (/password|passphrase|social security|\bssn\b|api[_ -]?key|secret key|bearer /i.test(clean)) {
    throw fail(400, "Do not include a password, an SSN, or a key.");
  }
  const scrubbed = scrubText(clean);
  if (scrubbed.redacted.length) throw fail(400, "Do not include a password, an SSN, or an account number.");
  const cat = String(category || "other");
  if (!CATS.has(cat)) throw fail(400, "Pick connection, action, bug, or other.");
  const mail = clip(email, 120);
  if (mail && !EMAIL.test(mail)) throw fail(400, "That email address does not look right.");
  const payload = { text: scrubbed.text, category: cat };
  if (mail) payload.email = mail;
  if (includeMeta !== false) {
    payload.version = VERSION;
    payload.os = env.CC_EVERYDAY_OS || process.platform;
  }
  return payload;
}

function samePayload(a, b) {
  const keys = (o) => Object.keys(o || {}).sort();
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = keys(a);
  const kb = keys(b);
  if (ka.join("|") !== kb.join("|")) return false;
  return ka.every((k) => a[k] === b[k]);
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
  const row = { id: nid("sg"), payload: expected, createdAt: Date.now(), delivered: false };
  try { row.delivered = await postLoopback(expected); } catch { row.delivered = false; }
  d.queue.push(row);
  if (d.queue.length > 100) d.queue.splice(0, d.queue.length - 100);
  save(d);
  return {
    thanks: THANKS,
    delivered: row.delivered,
    queued: !row.delivered,
    payload: expected,
    id: row.id,
  };
}

export function previewSuggestion(body) {
  return { payload: buildSuggestion(body || {}), sends: false, queued: false };
}
