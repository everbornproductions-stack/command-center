// Inbox summary, reply drafts, and local reminders. Read and draft freely.
// A reply leaves this computer only after Send, and the request must carry the exact text.
// Local reminders and to-dos stay on this computer. No password is stored.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { listAccounts } from "./mail-accounts.js";
import { gmailSearch, gmailSend, canSend } from "./google.js";
import { loadProfile } from "./prompts/apply.js";
import { scrubText } from "./prompts/safety.js";
import { assertOutgoingOk } from "./compliance-guard.js";
import { maskPrivate } from "./mask-private.js";

export const DOC = "everyday.inbox";
export const TRY_INBOX = "What needs me today in all my inboxes?";
export const TRY_REPLY = "Reply to Dana, say yes to Thursday";
export const TRY_REMIND = "Remind me at 5 to call Mom";
export const TRY_TODO = "Remind me to renew my license next month";

export const HOWTO = [
  { id: "inbox", title: "Inbox summary", say: TRY_INBOX, steps: ["Open Inbox and tasks.", "Click Try this example, or connect Google with read Gmail.", "Read the summary. Newsletters stay out of Needs a reply.", "Nothing is sent from this step."] },
  { id: "reply", title: "Reply in my tone", say: TRY_REPLY, steps: ["Pick a message that needs a reply.", "Type the instruction, for example the phrase above.", "Read the draft. It uses How to talk to me and My voice when those are filled in.", "Click Send only when the To, subject, and body on screen are the message you want."] },
  { id: "remind", title: "Plain-text reminders", say: TRY_REMIND, steps: ["Type a reminder in plain words.", "Click Add reminder. It stays on this computer.", "A to-do with no clock is a task. A clock makes it a reminder."] },
  { id: "todo", title: "To-dos", say: TRY_TODO, steps: ["Type the task.", "Click Add to-do.", "Mark it done when it is finished, or remove it."] },
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const MAX_ITEMS = 200;

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
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

function state() {
  const d = doc(DOC, () => ({ drafts: [], reminders: [], todos: [], log: [] }));
  d.drafts ||= [];
  d.reminders ||= [];
  d.todos ||= [];
  d.log ||= [];
  return d;
}
const save = (d) => putDoc(DOC, d);

export function toneFrom(profile) {
  const p = profile || {};
  return {
    directness: clip(p.directness, 80),
    length: clip(p.length, 80),
    voiceSample: clip(p.voiceSample, 240),
    wordsIUse: clip(p.wordsIUse, 120),
    wordsIAvoid: clip(p.wordsIAvoid, 120),
    sentenceStyle: clip(p.sentenceStyle, 80),
  };
}

export function emailOf(from) {
  const raw = String(from || "");
  const angled = raw.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : raw).trim();
  return EMAIL.test(addr) ? addr : "";
}
export function nameOf(from) {
  const raw = String(from || "").replace(/<[^>]+>/g, "").replace(/["']/g, "").trim();
  const first = raw.split(/\s+/)[0];
  return first || "there";
}

export function isNewsletter(message) {
  const t = `${message?.from || ""} ${message?.subject || ""} ${message?.snippet || ""}`.toLowerCase();
  return /\b(noreply|no-reply|newsletter|unsubscribe|promotions?)\b/.test(t);
}

export function summarizeAccounts(accounts) {
  const rows = [];
  const needs = [];
  for (const a of accounts || []) {
    const messages = Array.isArray(a.messages) ? a.messages : [];
    const headlines = messages.slice(0, 8).map((m) => ({
      id: clip(m.id, 80),
      from: clip(scrubText(m.from).text, 160),
      subject: clip(scrubText(m.subject).text, 180),
      snippet: clip(scrubText(m.snippet || m.text).text, 220),
      date: clip(m.date, 80),
      newsletter: isNewsletter(m),
    }));
    rows.push({
      id: a.id,
      label: clip(a.label, 40) || "Mailbox",
      provider: a.provider || "gmail",
      connected: a.connected !== false,
      count: messages.length,
      note: a.note ? clip(a.note, 240) : "",
      error: a.error ? clip(a.error, 240) : "",
      headlines,
    });
    for (const m of headlines) {
      if (!m.newsletter && (m.subject || m.snippet)) needs.push({ accountId: a.id, accountLabel: rows.at(-1).label, ...m });
    }
  }
  const lines = rows.map((r) => `${r.label}: ${r.count} message${r.count === 1 ? "" : "s"}${r.note ? `. ${r.note}` : ""}${r.error ? `. ${r.error}` : ""}`);
  return { readOnly: true, sends: false, accounts: rows, needs, lines, trySaying: TRY_INBOX };
}

export const SAMPLES = [
  {
    id: "sample-home", label: "Home", provider: "gmail", sample: true, connected: true,
    messages: [
      { id: "dana1", from: "Dana Lee <dana@shop.test>", subject: "Thursday", snippet: "Can you do Thursday at 2?", date: "Tue, 20 Oct 2026" },
      { id: "news1", from: "City Letters <noreply@letters.test>", subject: "Weekly newsletter", snippet: "Unsubscribe any time", date: "Mon, 19 Oct 2026" },
    ],
  },
  {
    id: "sample-work", label: "Work", provider: "gmail", sample: true, connected: true,
    messages: [
      { id: "mark1", from: "Mark <mark@client.test>", subject: "October invoice", snippet: "Did the October invoice go out?", date: "Tue, 20 Oct 2026" },
    ],
  },
];

export async function collectLive() {
  const out = [];
  let google = [];
  let gmail = [];
  let outlook = [];
  try { google = listAccounts("google").filter((a) => a.connected); } catch { google = []; }
  try { gmail = listAccounts("gmail").filter((a) => a.connected); } catch { gmail = []; }
  try { outlook = listAccounts("outlook").filter((a) => a.connected); } catch { outlook = []; }
  for (const a of google) {
    try {
      const messages = await gmailSearch("newer_than:2d in:inbox", 8, a.legacy ? null : a.id);
      out.push({ id: a.id, label: a.label, provider: "gmail", connected: true, messages });
    } catch (e) {
      out.push({ id: a.id, label: a.label, provider: "gmail", connected: true, messages: [], error: e.message });
    }
  }
  for (const a of gmail) {
    out.push({ id: a.id, label: a.label, provider: "gmail", connected: true, messages: [], note: "Connected for receipts. Inbox summary reads the Google sign-in that includes read Gmail." });
  }
  for (const a of outlook) {
    out.push({ id: a.id, label: a.label, provider: "outlook", connected: true, messages: [], note: "Connected for receipts. Open messages are not copied into this summary." });
  }
  return out;
}

function whenPhrase(instruction) {
  const m = String(instruction || "").match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i);
  return m ? m[0] : "that time";
}

export function draftReply({ from, subject, instruction, tone, accountId, messageId } = {}) {
  const to = emailOf(from);
  if (!to) throw fail(400, "That message has no reply address.");
  const who = nameOf(from);
  const say = clip(instruction, 500);
  if (!say) throw fail(400, "Say what the reply should do.");
  const t = tone || {};
  const avoid = String(t.wordsIAvoid || "").split(/[,/]/).map((w) => w.trim()).filter((w) => w.length > 2);
  const use = String(t.wordsIUse || "").split(/[,/]/).map((w) => w.trim()).filter(Boolean).slice(0, 3);
  const when = whenPhrase(say);
  const yes = /\bsay yes\b|\byes to\b|\bi can\b/i.test(say);
  let line;
  if (yes) line = use.length ? `Yes, ${when} works. I can do that ${use[0]}.` : `Yes, ${when} works for me.`;
  else line = use.length ? `${say} ${use[0]}.` : say;
  if (/gentle|warm/i.test(t.directness || "")) line = `I hope you are well. ${line}`;
  if (/short/i.test(t.length || "")) line = line.split(/(?<=[.!?])\s+/)[0];
  for (const w of avoid) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
    line = line.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  const sign = t.voiceSample ? "Thanks" : "Thanks";
  const subj = clip(subject, 180);
  const body = scrubText(`Hi ${who},\n\n${line}\n\n${sign}`).text;
  return {
    id: nid("dr"),
    status: "draft",
    accountId: accountId || null,
    messageId: messageId || null,
    to,
    subject: subj.toLowerCase().startsWith("re:") ? subj : `Re: ${subj || "your note"}`,
    body,
    toneNote: [t.directness, t.length, t.sentenceStyle].filter(Boolean).join(". "),
    createdAt: Date.now(),
    sentAt: null,
  };
}

export function rememberDraft(draft) {
  const d = state();
  d.drafts.unshift(draft);
  d.drafts = d.drafts.slice(0, 50);
  save(d);
  return publicDraft(draft);
}
export function publicDraft(draft) {
  if (!draft) return null;
  return {
    id: draft.id, status: draft.status, accountId: draft.accountId, messageId: draft.messageId,
    to: draft.to, subject: maskPrivate(draft.subject), body: maskPrivate(draft.body), toneNote: draft.toneNote || "",
    createdAt: draft.createdAt, sentAt: draft.sentAt || null,
  };
}
export function listDrafts() { return state().drafts.map(publicDraft); }

export function exactMail(body) {
  const to = emailOf(body?.to) || (EMAIL.test(String(body?.to || "").trim()) ? String(body.to).trim() : "");
  const subject = String(body?.subject || "").replace(/[\r\n]/g, " ").trim();
  const text = String(body?.body || "");
  if (!to) throw fail(400, "The reply needs one address in To.");
  if (!subject || subject.length > 300) throw fail(400, "The subject must be one line.");
  if (!text.trim() || text.length > 20000) throw fail(400, "The reply needs a body.");
  return { to, subject: maskPrivate(subject), body: maskPrivate(scrubText(text).text) };
}

export async function deliverExact(mail, accountId) {
  assertOutgoingOk({ text: `${mail?.subject || ""}\n${mail?.body || ""}`, channel: "email" });
  const sink = loopbackUrl(process.env.CC_EVERYDAY_MAIL_URL);
  if (sink) {
    const r = await fetch(sink, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({ to: mail.to, subject: mail.subject, body: mail.body }),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!r.ok) throw fail(502, "The local mail stand-in refused the reply.");
    return { via: "loopback", id: null };
  }
  if (!canSend(accountId || null)) throw fail(409, "Connect Gmail and tick send email before this can go out. The draft is still here.");
  const sent = await gmailSend({ to: mail.to, subject: mail.subject, body: mail.body }, accountId || null);
  return { via: "gmail", id: sent.id || null };
}

export async function sendDraft(id, body) {
  if (body?.confirm !== true) throw fail(400, "Send needs confirm: true, with the exact To, subject, and body.");
  const d = state();
  const draft = d.drafts.find((x) => x.id === id);
  if (!draft) throw fail(404, "That draft is not here.");
  if (draft.status === "sent") throw fail(409, "That reply was already sent.");
  const mail = exactMail(body);
  const delivered = await deliverExact(mail, draft.accountId);
  draft.to = mail.to;
  draft.subject = mail.subject;
  draft.body = mail.body;
  draft.status = "sent";
  draft.sentAt = Date.now();
  const entry = { id: nid("log"), at: draft.sentAt, action: "send-reply", summary: `Sent a reply to ${mail.to}: ${mail.subject}`, undo: "Gmail can undo a send from the Gmail window for a short time. Meldmind does not delete it." };
  d.log.unshift(entry);
  d.log = d.log.slice(0, 100);
  save(d);
  return { draft: publicDraft(draft), log: entry.summary, via: delivered.via, entry };
}

export function parseWhen(text, now = Date.now()) {
  const t = String(text || "");
  const base = new Date(now);
  let at = null;
  const clock = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (clock) {
    let h = Number(clock[1]);
    const min = Number(clock[2] || 0);
    const ap = (clock[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && h < 8) h += 12;
    const when = new Date(base);
    when.setSeconds(0, 0);
    when.setHours(h, min, 0, 0);
    if (when.getTime() <= now) when.setDate(when.getDate() + 1);
    at = when.getTime();
  }
  const day = WEEKDAYS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(t));
  if (day) {
    const when = new Date(at || now);
    const target = WEEKDAYS.indexOf(day);
    let add = (target - when.getDay() + 7) % 7;
    if (add === 0 && when.getTime() <= now) add = 7;
    when.setDate(when.getDate() + add);
    if (!clock) when.setHours(9, 0, 0, 0);
    at = when.getTime();
  }
  if (/\btomorrow\b/i.test(t)) {
    const when = new Date(at || now);
    when.setDate(new Date(now).getDate() + 1);
    if (!clock) when.setHours(9, 0, 0, 0);
    at = when.getTime();
  }
  if (/\bnext month\b/i.test(t)) {
    const when = new Date(now);
    when.setMonth(when.getMonth() + 1);
    when.setHours(9, 0, 0, 0);
    at = when.getTime();
  }
  return at;
}

export function parsePlain(text, now = Date.now()) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) throw fail(400, "Type the reminder or to-do first.");
  if (raw.length > 500) throw fail(400, "Keep it under 500 characters.");
  if (/password|ssn|social security/i.test(raw)) throw fail(400, "Do not put a password or an SSN in a reminder.");
  const reminder = /^remind me\b/i.test(raw);
  let title = raw
    .replace(/^remind me\s+/i, "")
    .replace(/^at\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\s+/i, "")
    .replace(/^(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/^add(?: a)? (?:to-?do|task)\s*[:,]?\s*/i, "")
    .trim();
  const at = reminder || /\bat\s+\d/i.test(raw) || /\bnext month\b|\btomorrow\b/i.test(raw) ? parseWhen(raw, now) : null;
  if (!title) title = raw;
  return { title: clip(title, 300), at, kind: at ? "reminder" : "todo" };
}

function publicItem(row) {
  return { id: row.id, title: row.title, at: row.at || null, done: !!row.done, createdAt: row.createdAt };
}

export function addReminder(text, now = Date.now()) {
  const parsed = parsePlain(text, now);
  if (!parsed.at) throw fail(400, "A reminder needs a time, such as at 5 or next month.");
  const d = state();
  if (d.reminders.length >= MAX_ITEMS) throw fail(400, "The reminder list is full. Remove one first.");
  const row = { id: nid("rm"), title: parsed.title, at: parsed.at, done: false, createdAt: Date.now() };
  d.reminders.unshift(row);
  d.log.unshift({ id: nid("log"), at: row.createdAt, action: "reminder", summary: `Reminder: ${row.title}`, undo: "Remove the reminder" });
  save(d);
  return publicItem(row);
}
export function addTodo(text, now = Date.now()) {
  const parsed = parsePlain(/^remind me\b/i.test(text) ? text : `Add a to-do: ${text}`, now);
  const d = state();
  if (d.todos.length >= MAX_ITEMS) throw fail(400, "The to-do list is full. Remove one first.");
  const row = { id: nid("td"), title: parsed.title, at: parsed.at, done: false, createdAt: Date.now() };
  d.todos.unshift(row);
  d.log.unshift({ id: nid("log"), at: row.createdAt, action: "todo", summary: `To-do: ${row.title}`, undo: "Remove the to-do" });
  save(d);
  return publicItem(row);
}

export function addMany(kind, items, { confirm = false, now = Date.now() } = {}) {
  const list = (Array.isArray(items) ? items : []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!list.length) throw fail(400, "Add at least one line.");
  if (list.length > 10 && !confirm) {
    return { needsConfirm: true, count: list.length, sample: list.slice(0, 3), saved: [] };
  }
  if (list.length > 30) throw fail(400, "Thirty lines is the limit for one add.");
  const saved = list.map((line) => (kind === "reminder" ? addReminder(line, now) : addTodo(line, now)));
  return { needsConfirm: false, count: saved.length, sample: list.slice(0, 3), saved };
}

export function listReminders(now = Date.now()) {
  return state().reminders.map((r) => ({ ...publicItem(r), due: !r.done && r.at <= now }));
}
export function listTodos() { return state().todos.map(publicItem); }

function mutate(listName, id, fn) {
  const d = state();
  const row = d[listName].find((x) => x.id === id);
  if (!row) throw fail(404, "That item is not here.");
  fn(row, d);
  save(d);
  return publicItem(row);
}
export const completeReminder = (id) => mutate("reminders", id, (row) => { row.done = true; });
export const completeTodo = (id) => mutate("todos", id, (row) => { row.done = true; });
export function removeItem(kind, id) {
  const d = state();
  const key = kind === "reminder" ? "reminders" : "todos";
  const before = d[key].length;
  d[key] = d[key].filter((x) => x.id !== id);
  if (d[key].length === before) throw fail(404, "That item is not here.");
  save(d);
  return { ok: true };
}

export function view(now = Date.now()) {
  const d = state();
  return {
    trySaying: { inbox: TRY_INBOX, reply: TRY_REPLY, remind: TRY_REMIND, todo: TRY_TODO },
    howto: HOWTO,
    drafts: d.drafts.map(publicDraft),
    reminders: listReminders(now),
    todos: listTodos(),
    log: d.log.slice(0, 30),
    safety: "A reply is sent only when you click Send. The click sends the To, subject, and body on screen. Reminders stay on this computer.",
  };
}

export function currentTone() {
  try { return toneFrom(loadProfile()); } catch { return toneFrom({}); }
}
