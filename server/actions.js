// Plain-request actions (Phase 54). A cheap fast model turns one sentence into an email
// draft and a calendar event. Meldmind sends the email and creates the event only when
// the person approves. The model never receives a token and never calls Gmail or Calendar.
// Grok Bot's calendar handoff is not used here.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { emit } from "./events.js";
import { cheapest } from "./router.js";
import { completeFallback } from "./fallback.js";
import { extractJson } from "./providers.js";
import { recordCall } from "./ledger.js";
import * as G from "./google.js";

const KIND = "actions.drafts";
const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const busy = new Set();

export function costNote(cost) {
  const n = Number(cost) || 0;
  const label = n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(2)}`;
  if (n > 0 && n < 0.01) return { label, note: `This draft cost ${label}, a fraction of a cent.` };
  return { label, note: `This draft cost ${label}.` };
}

export function systemPrompt(now = new Date()) {
  return [
    "PLAIN_REQUEST_ACTION.",
    "You draft only. You never send email and you never create calendar events.",
    "Reply with JSON only:",
    '{"email":{"to":"","subject":"","body":""},"event":{"summary":"","start":"","end":"","description":"","location":""}}',
    "Use null for email or event when the request does not ask for that part.",
    "Do not invent an email address. If the request has none, leave to as an empty string.",
    "start and end are ISO-8601 times.",
    "Use only facts from the request.",
    `Today is ${now.toISOString()}.`,
  ].join(" ");
}

function load() {
  const d = doc(KIND, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  return d;
}
const save = (d) => putDoc(KIND, d);

function cleanId(id) {
  const s = String(id || "");
  return /^pa-[a-f0-9]{16}$/.test(s) ? s : "";
}

function addressIn(text) {
  const m = String(text || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : "";
}

export function normalizeEmail(raw, request = "") {
  if (!raw || typeof raw !== "object") return null;
  let to = String(raw.to || "").trim();
  if (!to) to = addressIn(request);
  return {
    to,
    subject: String(raw.subject || "").replace(/[\r\n]/g, " ").trim().slice(0, 300),
    body: String(raw.body || "").slice(0, 20000),
  };
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    summary: String(raw.summary || "").replace(/[\r\n]/g, " ").trim().slice(0, 200),
    description: String(raw.description || "").slice(0, 8000),
    location: String(raw.location || "").replace(/[\r\n]/g, " ").trim().slice(0, 300),
    start: String(raw.start || "").trim().slice(0, 40),
    end: String(raw.end || "").trim().slice(0, 40),
  };
}

function safeErr(e) {
  return String(e?.message || "the model did not answer").replace(/\b[A-Za-z0-9_\-.]{24,}\b/g, "[hidden]").slice(0, 180);
}

function publicItem(item) {
  const shown = costNote(item.cost);
  return {
    id: item.id,
    request: item.request,
    email: item.email,
    event: item.event,
    cost: item.cost,
    costLabel: shown.label,
    note: shown.note,
    provider: item.provider,
    model: item.model,
    status: item.status,
    emailSent: item.emailSent || null,
    eventCreated: item.eventCreated || null,
    ready: { gmail: G.canSend(), calendar: G.canCalendar() },
  };
}

export async function draft(text) {
  const request = String(text || "").replace(/\u0000/g, "").trim();
  if (!request) throw fail(400, "Type a request first. Nothing was sent.");
  if (request.length > 2000) throw fail(400, "That request is too long. Nothing was sent.");
  const picked = cheapest(60);
  if (!picked) throw fail(409, "Connect an AI, or turn on demo mode, so a cheap model can draft this. Nothing was sent.");
  const t0 = Date.now();
  let answer;
  try {
    answer = await completeFallback({
      provider: picked.provider,
      model: picked.model,
      maxTokens: 400,
      system: systemPrompt(),
      messages: [{ role: "user", content: request }],
    }, { role: "action-draft", small: true, cls: { capability: "fast", difficulty: 1 }, mode: "economy", tools: false });
  } catch (e) {
    throw fail(502, `Could not draft that (${safeErr(e)}). Nothing was sent.`);
  }
  const entry = recordCall({
    provider: answer.provider, model: answer.model,
    usage: answer.usage || { input: 0, output: 0 },
    role: "action-draft", ms: Date.now() - t0,
  });
  const shown = costNote(entry?.cost || 0);
  const parsed = extractJson(answer.text || "");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw fail(422, `The draft did not come back in a usable form. Nothing was sent. ${shown.note}`, { cost: entry?.cost || 0, note: shown.note });
  }
  const email = parsed.email ? normalizeEmail(parsed.email, request) : null;
  const event = parsed.event ? normalizeEvent(parsed.event) : null;
  if (!email && !event) {
    throw fail(422, `That request did not include an email or a calendar event. Nothing was sent. ${shown.note}`, { cost: entry?.cost || 0, note: shown.note });
  }
  const item = {
    id: "pa-" + crypto.randomBytes(8).toString("hex"),
    request, email, event,
    cost: entry?.cost || 0,
    provider: answer.provider,
    model: answer.model,
    status: "draft",
    createdAt: Date.now(),
    emailSent: null,
    eventCreated: null,
  };
  const bag = load();
  bag.items.unshift(item);
  bag.items = bag.items.slice(0, 10);
  save(bag);
  return publicItem(item);
}

export function getDraft(id) {
  const sid = cleanId(id);
  const item = load().items.find((x) => x.id === sid);
  if (!item) throw fail(404, "That draft is not here. Nothing was sent.");
  return publicItem(item);
}

export async function approve(id, edits = {}) {
  const sid = cleanId(id);
  if (!sid) throw fail(404, "That draft is not here. Nothing was sent.");
  if (busy.has(sid)) throw fail(409, "That approval is already running.");
  busy.add(sid);
  try {
    const bag = load();
    const item = bag.items.find((x) => x.id === sid);
    if (!item) throw fail(404, "That draft is not here. Nothing was sent.");
    if (item.status === "done") return publicItem(item);
    if (item.status !== "draft" && item.status !== "partial") throw fail(409, "That draft cannot be approved. Nothing was sent.");
    const email = edits.email ? normalizeEmail(edits.email, item.request) : item.email;
    const event = edits.event ? normalizeEvent(edits.event) : item.event;
    if (!email && !event) throw fail(400, "Nothing to approve. Nothing was sent.");
    if (email && !item.emailSent && !G.canSend()) throw fail(409, "Gmail sending is not connected. Connect it and tick send email, then approve again. Nothing was sent.");
    if (event && !item.eventCreated && !G.canCalendar()) throw fail(409, "Google Calendar is not connected. Connect it, then approve again. Nothing was sent.");
    try {
      if (email && !item.emailSent) G.checkMail(email);
      if (event && !item.eventCreated) G.checkEvent(event);
    } catch (e) {
      throw fail(e.status || 400, `${e.message} Nothing was sent.`);
    }
    item.email = email;
    item.event = event;
    save(bag);
    if (email && !item.emailSent) {
      try {
        const sent = await G.gmailSend(email);
        item.emailSent = { id: sent.id || null, to: sent.to, subject: sent.subject };
        item.status = "partial";
        save(bag);
      } catch (e) {
        throw fail(e.status || 502, `${e.message} Nothing was sent.`);
      }
    }
    if (event && !item.eventCreated) {
      try {
        item.eventCreated = await G.createEvent(event);
        save(bag);
      } catch (e) {
        const sent = item.emailSent ? "The email was sent. " : "";
        throw fail(e.status || 502, `${sent}The calendar event was not created: ${e.message}`);
      }
    }
    item.status = "done";
    item.doneAt = Date.now();
    save(bag);
    emit("log", { text: "Plain request approved. Meldmind sent it through the connected accounts." });
    return publicItem(item);
  } finally {
    busy.delete(sid);
  }
}
