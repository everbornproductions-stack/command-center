// Docs, meeting prep, and a mock lead follow-up.
// Drive and Notion are read when already connected. Nothing is written there.
// A lead draft is sent only after a click, and only into a local outbox or a loopback stub.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { scrubText } from "./prompts/safety.js";

export const DOC = "everyday.work";
export const TRY_DOCS = "Find the Q3 proposal and summarize it";
export const TRY_PREP = "Prep me for my 2pm";
export const TRY_TRANSCRIPT = "Summarize yesterday's call and list to-dos";
export const TRY_LEAD = "When a new HighLevel lead comes in, draft a text and email";
export const TWILIO_NOTICE = "Twilio charges the user's account, but this build does not send a text or look up a price.";

export const HOWTO = [
  { id: "docs", title: "Find and summarize a doc", say: TRY_DOCS, steps: ["Open Docs and follow-up.", "Type the name or a phrase.", "Read the summary. Drive and Notion are only read when they are already connected.", "Save a copy writes a doc on this computer. It does not write to Drive or Notion."] },
  { id: "meeting", title: "Meeting prep and a transcript", say: TRY_PREP, steps: ["Add the meeting title, the time, and any notes.", "Prep me reads related docs on this computer. It does not record the call.", "Paste a transcript and read the summary and the action items.", "Add the to-dos only when you click."] },
  { id: "leads", title: "New lead follow-up", say: TRY_LEAD, steps: ["This is a Pro action. The draft is created on this computer.", "HighLevel is not called.", "Read the email and the text. Twilio is not contacted and no price is looked up.", "Send one channel with its own click."] },
];

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const SECRET_RE = /password|passphrase|social security|\bssn\b|api[_ -]?key|secret key|bearer /i;
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const nid = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function isPro(tier) { return tier === "pro" || tier === "studio" || tier === "owner"; }

export function loopbackUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== "http:") return null;
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return null;
  return u.toString();
}

function state() {
  const d = doc(DOC, () => ({ pages: [], meetings: [], tasks: [], leads: [], outbox: [] }));
  for (const k of ["pages", "meetings", "tasks", "leads", "outbox"]) d[k] ||= [];
  return d;
}
const save = (d) => putDoc(DOC, d);

export function rejectSecrets(text) {
  const raw = String(text || "");
  if (SECRET_RE.test(raw)) throw fail(400, "Do not include a password, an SSN, or a key.");
  const scrubbed = scrubText(raw);
  if (scrubbed.redacted.length) throw fail(400, "Do not include a password, an SSN, or an account number.");
  return scrubbed.text;
}

export function summarizeText(text) {
  const clean = rejectSecrets(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, 3).join(" ");
}

export function actionsFromTranscript(text) {
  const clean = rejectSecrets(text);
  const items = [];
  for (const line of clean.split(/\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const t = raw.replace(/^[-*]\s+/, "").trim();
    if (/^[-*]\s+/.test(raw) || /\b(will|need to|needs to)\b/i.test(t) || /^(action|todo|to-do)\s*:/i.test(t)) items.push(clip(t, 200));
  }
  return items.slice(0, 20);
}

export function addPage({ title, text, source = "local" } = {}) {
  const name = clip(title, 140);
  const body = rejectSecrets(text);
  if (!name || !body.trim()) throw fail(400, "A doc needs a title and some text.");
  const d = state();
  const row = { id: nid("pg"), title: name, text: body.trim().slice(0, 20000), source, createdAt: Date.now() };
  d.pages.push(row);
  save(d);
  return publicPage(row);
}
function publicPage(p) {
  return { id: p.id, title: p.title, source: p.source || "local", summary: summarizeText(p.text) };
}

async function remoteDocs(q) {
  const notes = [];
  const matches = [];
  let lib;
  try { lib = await import("./library-sources.js"); } catch {
    notes.push("Drive and Notion are not available in this build.");
    return { matches, notes };
  }
  try {
    const files = await lib.driveList({ q });
    for (const f of (files || []).slice(0, 3)) {
      if (f.folder || !f.readable) continue;
      const items = await lib.driveItems([f.id]);
      const text = items?.[0]?.text || "";
      if (!text) continue;
      matches.push({ source: "drive", ref: f.id, title: f.name || items[0].title, summary: summarizeText(text), readOnly: true });
    }
  } catch {
    notes.push("Google Drive is not connected, so this search used docs on this computer.");
  }
  try {
    const pages = await lib.notionList({ q });
    for (const p of (pages || []).slice(0, 3)) {
      const items = await lib.notionItems([p.id]);
      const text = items?.[0]?.text || "";
      if (!text) continue;
      matches.push({ source: "notion", ref: p.id, title: p.name || items[0].title, summary: summarizeText(text), readOnly: true });
    }
  } catch {
    notes.push("Notion is not connected, so this search used docs on this computer.");
  }
  return { matches, notes };
}

export async function findDocs(q) {
  const query = clip(q, 200);
  if (!query) throw fail(400, "Say what to find.");
  rejectSecrets(query);
  const needle = query.toLowerCase();
  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  const local = state().pages.filter((p) => {
    const hay = `${p.title} ${p.text}`.toLowerCase();
    return hay.includes(needle) || (words.length && words.every((w) => hay.includes(w)));
  }).slice(0, 5).map((p) => ({ source: p.source || "local", ref: p.id, title: p.title, summary: summarizeText(p.text), readOnly: true }));
  const remote = await remoteDocs(query);
  return {
    query,
    matches: local.concat(remote.matches).slice(0, 8),
    notes: remote.notes,
    sends: false,
    wroteDrive: false,
    wroteNotion: false,
  };
}

export function saveCopy({ title, text, confirm } = {}) {
  if (confirm !== true) throw fail(400, "Saving a copy is a separate click.");
  const page = addPage({ title, text, source: "meldmind" });
  return { page, wroteDrive: false, wroteNotion: false };
}

export function addMeeting(body = {}) {
  if (body.record === true || body.audio) throw fail(400, "This build does not record calls.");
  const title = clip(body.title, 140);
  if (!title) throw fail(400, "Name the meeting.");
  const notes = body.notes ? rejectSecrets(clip(body.notes, 2000)) : "";
  const transcript = body.transcript ? rejectSecrets(String(body.transcript).slice(0, 20000)) : "";
  const d = state();
  const row = {
    id: nid("mt"),
    title,
    at: clip(body.at, 80),
    with: clip(body.with, 120),
    notes,
    transcript,
    createdAt: Date.now(),
  };
  d.meetings.push(row);
  save(d);
  return publicMeeting(row);
}
function publicMeeting(m) {
  return { id: m.id, title: m.title, at: m.at || "", with: m.with || "", notes: m.notes || "" };
}
function mustMeeting(id) {
  const row = state().meetings.find((m) => m.id === id);
  if (!row) throw fail(404, "That meeting is not on this computer.");
  return row;
}

export function prepMeeting(id) {
  const m = mustMeeting(id);
  const words = m.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const related = state().pages.filter((p) => {
    const hay = `${p.title} ${p.text}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  }).slice(0, 3);
  const lines = [];
  if (m.at) lines.push(`When: ${m.at}`);
  if (m.with) lines.push(`With: ${m.with}`);
  if (m.notes) lines.push(m.notes);
  for (const p of related) lines.push(`Doc: ${p.title}. ${summarizeText(p.text)}`);
  if (!lines.length) lines.push("No notes or related docs on this computer yet.");
  return { meeting: publicMeeting(m), lines, sends: false, readOnly: true, wroteCalendar: false };
}

export function summarizeMeeting(id) {
  const m = mustMeeting(id);
  const summary = m.transcript ? summarizeText(m.transcript) : "No transcript yet.";
  return { meeting: publicMeeting(m), summary, actions: m.transcript ? actionsFromTranscript(m.transcript) : [], sends: false, readOnly: true };
}

export function saveTasks(id, { confirm } = {}) {
  const preview = summarizeMeeting(id);
  if (confirm !== true) return { ...preview, saved: false };
  const d = state();
  const made = [];
  for (const title of preview.actions) {
    if (d.tasks.some((t) => t.meetingId === id && t.title === title)) continue;
    const row = { id: nid("tk"), meetingId: id, title, done: false, createdAt: Date.now() };
    d.tasks.push(row);
    made.push(row);
  }
  save(d);
  return { ...preview, saved: true, tasks: made.map((t) => ({ id: t.id, title: t.title })) };
}

function draftFor(lead) {
  const name = clip(lead.name, 80) || "there";
  const email = clip(lead.email, 120);
  const phone = clip(lead.phone, 40);
  const note = lead.note ? rejectSecrets(clip(lead.note, 500)) : "";
  if (email && !EMAIL.test(email)) throw fail(400, "That email address does not look right.");
  if (!email && !phone) throw fail(400, "Add an email or a phone number.");
  return {
    email: email ? { to: email, subject: `Following up, ${name}`, body: `Hi ${name},\n\nThanks for reaching out.${note ? ` ${note}` : ""}\n` } : null,
    sms: phone ? { to: phone, body: `Hi ${name}, thanks for reaching out. Reply here and we will help.` } : null,
  };
}

export function addLead(body = {}, { tier = "free" } = {}) {
  if (!isPro(tier)) throw fail(402, "New lead follow-up is a Pro action.");
  for (const key of Object.keys(body || {})) {
    if (/password|ssn|token|secret|api/i.test(key)) throw fail(400, "Do not include a password, an SSN, or a key.");
  }
  const drafts = draftFor(body);
  const d = state();
  const row = {
    id: nid("ld"),
    name: clip(body.name, 80),
    drafts,
    sent: {},
    createdAt: Date.now(),
  };
  d.leads.push(row);
  save(d);
  return publicLead(row);
}
function publicLead(row) {
  return {
    id: row.id,
    name: row.name,
    drafts: row.drafts,
    sent: row.sent || {},
    notice: TWILIO_NOTICE,
    highlevel: false,
    sends: false,
  };
}
function mustLead(id) {
  const row = state().leads.find((l) => l.id === id);
  if (!row) throw fail(404, "That lead draft is not on this computer.");
  return row;
}

export async function sendLead(id, body = {}, { tier = "free" } = {}) {
  if (!isPro(tier)) throw fail(402, "New lead follow-up is a Pro action.");
  if (body.confirm !== true) throw fail(400, "Send is a separate click.");
  const channel = body.channel === "sms" || body.channel === "email" ? body.channel : "";
  if (!channel) throw fail(400, "Pick email or text.");
  const d = state();
  const lead = d.leads.find((l) => l.id === id) || mustLead(id);
  const draft = lead.drafts?.[channel];
  if (!draft) throw fail(400, "That channel has no draft.");
  if (lead.sent?.[channel]) throw fail(409, "That draft was already sent.");
  if (draft.to !== body.to || (channel === "email" ? draft.subject !== body.subject || draft.body !== body.body : draft.body !== body.body)) {
    throw fail(400, "The note on the page does not match what would be sent. Read it again.");
  }
  const row = { id: nid("ob"), leadId: id, channel, to: draft.to, subject: draft.subject || "", body: draft.body, at: Date.now(), delivered: false, network: false };
  const url = loopbackUrl(process.env.CC_EVERYDAY_LEAD_URL);
  if (url) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, to: draft.to, subject: draft.subject || "", body: draft.body }),
        redirect: "error",
        signal: AbortSignal.timeout(4000),
      });
      row.delivered = r.ok;
    } catch { row.delivered = false; }
  }
  d.outbox.push(row);
  lead.sent[channel] = row.id;
  save(d);
  return { sent: true, network: false, delivered: row.delivered, notice: TWILIO_NOTICE, outbox: { channel, to: row.to, subject: row.subject, body: row.body } };
}

export function view() {
  const d = state();
  return {
    pages: d.pages.map(publicPage),
    meetings: d.meetings.map(publicMeeting),
    tasks: d.tasks.map((t) => ({ id: t.id, title: t.title, meetingId: t.meetingId, done: !!t.done })),
    leads: d.leads.map(publicLead),
    outbox: d.outbox.map((o) => ({ id: o.id, channel: o.channel, to: o.to, delivered: !!o.delivered, network: false })),
    trySaying: { docs: TRY_DOCS, prep: TRY_PREP, transcript: TRY_TRANSCRIPT, lead: TRY_LEAD },
    howto: HOWTO,
    notice: TWILIO_NOTICE,
    safety: "Nothing is sent, posted, or deleted from this page without a click. Drive and Notion are read only. HighLevel and Twilio are not called.",
  };
}
