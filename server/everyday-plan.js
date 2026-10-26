// Morning briefing, email to a task or a local calendar hold, and find-a-time drafts.
// A routine may read and prepare. Mail goes out only after Send, with the exact text.
// Calendar holds stay on this computer until a calendar connection writes them.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { canSend, gmailSend } from "./google.js";
import { scrubText } from "./prompts/safety.js";
import { assertOutgoingOk } from "./compliance-guard.js";

export const DOC = "everyday.plan";
export const TRY_BRIEF = "Every weekday at 8: agenda, inbox, tasks, weather, and news";
export const TRY_EXTRACT = "Turn this email into a task and a calendar hold";
export const TRY_SLOTS = "Find 3 open 30 min slots next week for Ana";

export const HOWTO = [
  { id: "brief", title: "Morning briefing", say: TRY_BRIEF, steps: ["Open Day plan.", "Keep the one weekday routine, or add a city.", "Click Prepare now. The briefing is read only.", "A second routine asks for Pro."] },
  { id: "extract", title: "Email to a task or a hold", say: TRY_EXTRACT, steps: ["Paste the email.", "Read the task and the hold. Nothing is written yet.", "Click Save task and hold. The hold stays on this computer.", "Google Calendar is not written from this page."] },
  { id: "slots", title: "Find a time", say: TRY_SLOTS, steps: ["Add busy blocks if you have them, or leave the day open.", "Name the person, the address, and how long.", "Read the draft. It lists the open slots.", "Click Send only when that draft is the email you want."] },
];

const DAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
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

function state() {
  const d = doc(DOC, () => ({ routines: [], outputs: [], tasks: [], holds: [], drafts: [], busy: [], log: [] }));
  for (const k of ["routines", "outputs", "tasks", "holds", "drafts", "busy", "log"]) d[k] ||= [];
  return d;
}
const save = (d) => putDoc(DOC, d);

export function isPro(tier) { return tier === "pro" || tier === "studio" || tier === "owner"; }

export function createRoutine({ name, hour = 8, minute = 0, weekdays = true, city = "" } = {}, { tier = "free" } = {}) {
  const d = state();
  if (!isPro(tier) && d.routines.length >= 1) throw fail(402, "Free includes one morning routine. Pro adds more.");
  if (d.routines.length >= 20) throw fail(400, "Twenty routines is the limit.");
  const h = Number(hour), m = Number(minute);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) throw fail(400, "Pick an hour and a minute.");
  const row = {
    id: nid("br"),
    name: clip(name || "Weekday morning", 80),
    hour: h, minute: m, weekdays: weekdays !== false,
    city: clip(city, 80),
    enabled: true,
    createdAt: Date.now(),
  };
  d.routines.push(row);
  save(d);
  return publicRoutine(row);
}
export function publicRoutine(r) {
  return { id: r.id, name: r.name, hour: r.hour, minute: r.minute, weekdays: !!r.weekdays, city: r.city || "", enabled: !!r.enabled };
}
export function listRoutines() { return state().routines.map(publicRoutine); }

export function isDue(routine, now, lastAt) {
  if (!routine?.enabled) return false;
  const d = new Date(now);
  if (routine.weekdays && (d.getDay() === 0 || d.getDay() === 6)) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins < routine.hour * 60 + routine.minute) return false;
  if (!lastAt) return true;
  return new Date(lastAt).toDateString() !== d.toDateString();
}

function clockIn(text) {
  const t = String(text || "");
  return t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
    || t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)
    || t.match(/\b(\d{1,2})\s*(am|pm)\b/i);
}

export function parseMoment(text, now = Date.now()) {
  const t = String(text || "");
  let weekday = null;
  for (const [name, n] of Object.entries(DAYS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(t)) { weekday = n; break; }
  }
  const clock = clockIn(t);
  if (weekday === null && !clock) return null;
  let h = 9, min = 0;
  if (clock) {
    h = Number(clock[1]);
    min = Number(clock[2] || 0);
    const ap = (clock[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (!ap && !clock[2] && h < 8) h += 12;
  }
  const when = new Date(now);
  when.setSeconds(0, 0);
  if (weekday === null) {
    when.setHours(h, min, 0, 0);
    if (when.getTime() <= now) when.setDate(when.getDate() + 1);
  } else {
    let add = (weekday - when.getDay() + 7) % 7;
    when.setHours(h, min, 0, 0);
    if (add === 0 && when.getTime() <= now) add = 7;
    when.setDate(when.getDate() + add);
  }
  return when.getTime();
}

export function extractEmail({ from, subject, body, now = Date.now() } = {}) {
  const text = scrubText(`${subject || ""}\n${body || ""}`).text;
  if (/password|social security|\bssn\b/i.test(text)) throw fail(400, "That email looks like it contains a password or an SSN. It was not saved.");
  const start = parseMoment(text, now);
  const title = clip(scrubText(subject).text || "Follow up", 180) || "Follow up";
  const task = { title, from: clip(from, 160), note: clip(text, 500) };
  let hold = null;
  if (start) {
    const mins = /\b(\d{1,3})\s*min/.test(text) ? Math.min(240, Number(RegExp.$1)) : 60;
    hold = { title, start, end: start + mins * 60000, with: clip(from, 160) };
  }
  return { task, hold, needsClick: true, readOnly: true };
}

export function saveExtraction(parsed) {
  const d = state();
  const task = { id: nid("tk"), title: parsed.task.title, note: parsed.task.note || "", from: parsed.task.from || "", done: false, createdAt: Date.now() };
  d.tasks.unshift(task);
  let hold = null;
  if (parsed.hold) {
    hold = { id: nid("hd"), title: parsed.hold.title, start: parsed.hold.start, end: parsed.hold.end, with: parsed.hold.with || "", where: "local", createdAt: Date.now() };
    d.holds.unshift(hold);
  }
  d.log.unshift({ id: nid("log"), at: Date.now(), action: "save-hold", summary: hold ? `Saved a task and a local hold: ${task.title}` : `Saved a task: ${task.title}` });
  save(d);
  return { task: publicTask(task), hold: hold ? publicHold(hold) : null, wroteCalendar: false };
}
function publicTask(t) { return { id: t.id, title: t.title, note: t.note || "", from: t.from || "", done: !!t.done, createdAt: t.createdAt }; }
function publicHold(h) { return { id: h.id, title: h.title, start: h.start, end: h.end, with: h.with || "", where: "local" }; }

export function addBusy({ title, start, end } = {}) {
  const a = Number(start), b = Number(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) throw fail(400, "A busy block needs a start and a later end.");
  const d = state();
  const row = { id: nid("bz"), title: clip(title || "Busy", 80), start: a, end: b };
  d.busy.push(row);
  save(d);
  return row;
}

export function openSlots({ busy = [], now = Date.now(), days = 7, minutes = 30, count = 3 } = {}) {
  const length = Math.min(240, Math.max(15, Number(minutes) || 30));
  const want = Math.min(8, Math.max(1, Number(count) || 3));
  const span = Math.min(21, Math.max(1, Number(days) || 7));
  const slots = [];
  const cursor = new Date(now);
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(9, 0, 0, 0);
  const limit = new Date(now);
  limit.setDate(limit.getDate() + span + 1);
  while (cursor < limit && slots.length < want) {
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(9, 0, 0, 0);
      continue;
    }
    const slotEnd = cursor.getTime() + length * 60000;
    const dayEnd = new Date(cursor);
    dayEnd.setHours(17, 0, 0, 0);
    if (slotEnd > dayEnd.getTime()) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(9, 0, 0, 0);
      continue;
    }
    const hit = busy.some((b) => cursor.getTime() < Number(b.end) && slotEnd > Number(b.start));
    if (!hit) {
      slots.push({ start: cursor.getTime(), end: slotEnd });
      cursor.setTime(slotEnd);
    } else cursor.setTime(cursor.getTime() + 30 * 60000);
  }
  return slots;
}

export function formatWhen(ms) {
  return new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function proposeMail({ to, name, slots, minutes = 30 } = {}) {
  const addr = String(to || "").trim();
  if (!EMAIL.test(addr)) throw fail(400, "The proposal needs one email address.");
  if (!slots?.length) throw fail(400, "No open slot was found in that window.");
  const who = clip(name || "there", 40);
  const lines = slots.map((s, i) => `${i + 1}. ${formatWhen(s.start)}`).join("\n");
  const body = scrubText(`Hi ${who},\n\nHere are ${slots.length} open ${minutes} minute times:\n${lines}\n\nReply with the one that works.\n\nThanks`).text;
  return {
    id: nid("sl"),
    status: "draft",
    to: addr,
    subject: `${slots.length} times (${minutes} min)`,
    body,
    slots,
    createdAt: Date.now(),
    sentAt: null,
  };
}

export function rememberDraft(draft) {
  const d = state();
  d.drafts.unshift(draft);
  d.drafts = d.drafts.slice(0, 40);
  save(d);
  return publicDraft(draft);
}
export function publicDraft(draft) {
  if (!draft) return null;
  return { id: draft.id, status: draft.status, to: draft.to, subject: draft.subject, body: draft.body, slots: draft.slots || [], createdAt: draft.createdAt, sentAt: draft.sentAt || null };
}

export async function deliverExact(mail) {
  assertOutgoingOk({ text: `${mail?.subject || ""}\n${mail?.body || ""}`, channel: "email" });
  const sink = loopbackUrl(process.env.CC_EVERYDAY_MAIL_URL);
  if (sink) {
    const r = await fetch(sink, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify(mail), signal: AbortSignal.timeout(8000), redirect: "error" });
    if (!r.ok) throw fail(502, "The local mail stand-in refused the message.");
    return { via: "loopback" };
  }
  if (!canSend(null)) throw fail(409, "Connect Gmail and tick send email before this can go out. The draft is still here.");
  await gmailSend({ to: mail.to, subject: mail.subject, body: mail.body }, null);
  return { via: "gmail" };
}

export async function sendDraft(id, body) {
  if (body?.confirm !== true) throw fail(400, "Send needs confirm: true, with the exact To, subject, and body.");
  const d = state();
  const draft = d.drafts.find((x) => x.id === id);
  if (!draft) throw fail(404, "That draft is not here.");
  if (draft.status === "sent") throw fail(409, "That email was already sent.");
  const to = String(body.to || "").trim();
  const subject = String(body.subject || "").replace(/[\r\n]/g, " ").trim();
  const text = String(body.body || "");
  if (!EMAIL.test(to) || !subject || !text.trim()) throw fail(400, "The email needs a To, a subject, and a body.");
  const mail = { to, subject, body: scrubText(text).text };
  const delivered = await deliverExact(mail);
  draft.to = mail.to;
  draft.subject = mail.subject;
  draft.body = mail.body;
  draft.status = "sent";
  draft.sentAt = Date.now();
  d.log.unshift({ id: nid("log"), at: draft.sentAt, action: "send-slots", summary: `Sent time options to ${mail.to}` });
  save(d);
  return { draft: publicDraft(draft), via: delivered.via };
}

export async function extraBusy(start, end) {
  try {
    const cal = await import("./calendar.js");
    if (typeof cal.freeBusy === "function") {
      const rows = await cal.freeBusy(start, end);
      return Array.isArray(rows) ? rows : [];
    }
  } catch { /* no calendar connection in this build */ }
  return [];
}

export async function agendaLines(now) {
  const day = new Date(now);
  const start = new Date(day); start.setHours(0, 0, 0, 0);
  const end = new Date(day); end.setHours(23, 59, 59, 999);
  const d = state();
  const lines = d.holds.filter((h) => h.start >= start.getTime() && h.start <= end.getTime()).map((h) => `${formatWhen(h.start)} ${h.title} (saved on this computer)`);
  try {
    const cal = await import("./calendar.js");
    if (typeof cal.agendaBetween === "function") {
      const rows = await cal.agendaBetween(start.getTime(), end.getTime());
      for (const row of rows || []) lines.push(clip(row.title || row.summary || "Calendar event", 160));
    }
  } catch { /* calendar connection is separate */ }
  return lines;
}

async function inboxLines() {
  try {
    const inbox = await import("./everyday-inbox.js");
    const accounts = await inbox.collectLive();
    const sum = inbox.summarizeAccounts(accounts);
    return sum.lines.length ? sum.lines : ["No connected inbox returned mail."];
  } catch {
    return ["Inbox summary is ready when Inbox and tasks is installed. Nothing was fetched here."];
  }
}

export async function prepareBriefing(routine, now, { sample = false } = {}) {
  const tasks = state().tasks.filter((t) => !t.done).slice(0, 8).map((t) => t.title);
  const briefing = {
    id: nid("bf"),
    routineId: routine.id,
    preparedAt: now,
    readOnly: true,
    sends: false,
    sample: !!sample,
    sections: [
      { id: "agenda", title: "Agenda", lines: await agendaLines(now).then((l) => l.length ? l : ["Nothing on the local agenda."]) },
      { id: "inbox", title: "Inbox", lines: await inboxLines() },
      { id: "tasks", title: "Tasks", lines: tasks.length ? tasks : ["No open tasks."] },
      { id: "weather", title: "Weather", lines: [sample ? `Sample only: clear and 62 F${routine.city ? ` in ${routine.city}` : ""}. Not a live forecast.` : (routine.city ? `Weather for ${routine.city} is not fetched in this build.` : "Add a city if you want a weather line. Nothing is fetched.")] },
      { id: "news", title: "News", lines: sample ? ["Sample: Local desk roundup.", "Sample: One product note.", "These are sample headlines, not live news."] : ["News is not fetched in this build."] },
    ],
  };
  const d = state();
  const row = d.routines.find((r) => r.id === routine.id);
  if (row) row.lastAt = now;
  d.outputs.unshift(briefing);
  d.outputs = d.outputs.slice(0, 30);
  d.log.unshift({ id: nid("log"), at: now, action: "briefing", summary: `Prepared the morning briefing for ${routine.name}. Nothing was sent.` });
  save(d);
  return briefing;
}

export async function tick(now = Date.now(), { sample = false } = {}) {
  const d = state();
  const made = [];
  for (const routine of d.routines) {
    if (!isDue(routine, now, routine.lastAt)) continue;
    made.push(await prepareBriefing(routine, now, { sample }));
  }
  return made;
}

export function view() {
  const d = state();
  return {
    trySaying: { brief: TRY_BRIEF, extract: TRY_EXTRACT, slots: TRY_SLOTS },
    howto: HOWTO,
    routines: d.routines.map(publicRoutine),
    outputs: d.outputs.slice(0, 8),
    tasks: d.tasks.map(publicTask),
    holds: d.holds.map(publicHold),
    busy: d.busy,
    drafts: d.drafts.map(publicDraft),
    log: d.log.slice(0, 20),
    safety: "The briefing only reads. A hold stays on this computer. An email goes out only when you click Send.",
  };
}

export function removeHold(id) {
  const d = state();
  const before = d.holds.length;
  d.holds = d.holds.filter((h) => h.id !== id);
  if (d.holds.length === before) throw fail(404, "That hold is not here.");
  save(d);
  return { ok: true };
}
export function completeTask(id) {
  const d = state();
  const row = d.tasks.find((t) => t.id === id);
  if (!row) throw fail(404, "That task is not here.");
  row.done = true;
  save(d);
  return publicTask(row);
}

export function previewMany(emails) {
  const list = Array.isArray(emails) ? emails : [];
  if (list.length > 10) return { needsConfirm: true, count: list.length, sample: list.slice(0, 3).map((e) => clip(e.subject || e.from || "email", 80)) };
  return { needsConfirm: false, count: list.length, sample: [] };
}
