// Plain drafts for the guided builders. Nothing here calls a network.
// Outbound text stays a draft until a later click. Tax questions get one line
// and no advice. Credit-repair copy keeps the CROA limits from the prompt pack.

import crypto from "node:crypto";
import { scrub, CROA, RESPA } from "../prompts/safety.js";

export const STEPS = ["Describe", "Preview the AIs", "Build", "Test", "Publish"];

export const TAX_LINE = "Ask your accountant. Meldmind only organizes the receipt or invoice. It does not give tax advice.";
export const DOCUSEAL_NOTE = "DocuSeal is a separate service under the AGPL. Meldmind does not include it. You send your own template. This is not legal advice.";
export const NINJA_NOTE = "Invoice Ninja is optional and off. It is a separate service. Its Elastic License is not the Meldmind license. Nothing is sent there unless you turn it on and then publish.";
export const OCR_NOTE = "Receipt Snap can use Tesseract, PaddleOCR, or docTR. Tesseract is the default. Those programs are not bundled. Paste the receipt text, or point Test at a local reader.";
export const INVOICE_READ_NOTE = "Invoice Reader follows the invoice2data field list: who, number, date, and total. The invoice2data program is not bundled. Paste the invoice text, or point Test at a local reader.";
export const WHISPER_NOTE = "Meeting Notes can use Whisper on this computer. Whisper is not bundled. Paste the words, or point Test at a local Whisper address. Audio is not uploaded.";
export const LEGAL_LINE = "This is not legal advice. Use your own DocuSeal template. Meldmind does not write legal terms. Nothing was sent.";

const TAX_RE = /\b(tax|taxes|deductible|deduction|deductions|write-?off|irs|1099|vat|gst|taxable)\b/i;
const CREDIT_RE = /\b(credit repair|credit score|croa|furnisher|collection account)\b/i;
const LEGAL_RE = /\b(legal advice|write (me |us )?a (contract|clause|agreement)|sue\b|this is binding|guarantee (payment|results))\b/i;
const REFERRAL_RE = /\breferral (fee|reward|bonus)\b/i;

export const CAMPAIGN_CHECKS = [
  { id: "tcpa", label: "I have permission to text or email these people (TCPA)." },
  { id: "stop", label: "The message tells people they can reply STOP to opt out." },
  { id: "quiet", label: "I am sending from 8:00 am until 9:00 pm, outside quiet hours." },
  { id: "a2p", label: "If this is a text, the business number is registered (A2P 10DLC)." },
  { id: "canspam", label: "The email has a real address and a way to unsubscribe (CAN-SPAM)." },
];

export const CROA_CHECK = { id: "croa", label: "Credit repair note (CROA): I am not promising a result, a deletion, or a credit score change." };
export const LEGAL_CHECK = { id: "notLegal", label: "I understand this is not legal advice, and DocuSeal is a separate AGPL service. I am sending my own template." };

export function isTax(text) { return TAX_RE.test(String(text || "")); }
export function isCreditRepair(text) { return CREDIT_RE.test(String(text || "")); }
export function isLegalAsk(text) { return LEGAL_RE.test(String(text || "")); }

export function quietHoursOk(sendTime) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(sendTime || ""));
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return false;
  return hour >= 8 && hour < 21;
}

export function fingerprint(input) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
}

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function linesOf(value) {
  if (Array.isArray(value)) return value.map((s) => clip(s, 80)).filter(Boolean).slice(0, 20);
  return clip(value, 800).split(/\n|,/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
}

export function readInput(raw) {
  const b = raw && typeof raw === "object" ? raw : {};
  const channel = b.channel === "sms" ? "sms" : "email";
  const sendTime = /^\d{2}:\d{2}$/.test(b.sendTime || "") ? b.sendTime : "10:00";
  const engine = ["tesseract", "paddleocr", "doctr"].includes(b.engine) ? b.engine : "tesseract";
  const minutes = Number(b.minutes) > 0 ? Math.min(240, Math.round(Number(b.minutes))) : 30;
  return {
    text: clip(b.text ?? b.description, 4000),
    channel,
    sendTime,
    recipients: linesOf(b.recipients),
    engine,
    invoiceNinja: b.invoiceNinja === true,
    templateId: clip(b.templateId, 40),
    contactId: clip(b.contactId, 80),
    email: clip(b.email, 200),
    name: clip(b.name, 120),
    phone: clip(b.phone, 40),
    offer: clip(b.offer, 300),
    website: clip(b.website, 300),
    welcome: clip(b.welcome, 300) || "Hello. How can we help?",
    title: clip(b.title, 120) || "A time to talk",
    minutes,
    stages: clip(b.stages, 300) || "New, Contacted, Won",
    counts: clip(b.counts, 80) || "0, 0, 0",
    tags: clip(b.tags, 300) || "new-lead, booked, customer",
    to: clip(b.to, 120),
    number: clip(b.number, 40) || "INV-1001",
    amount: clip(b.amount, 20),
    item: clip(b.item, 120),
    merchant: clip(b.merchant, 120),
    date: clip(b.date, 40),
    total: clip(b.total, 20),
    useAi: b.useAi === true,
  };
}

export function cleanInput(raw) {
  const input = readInput(raw);
  const cleaned = scrub(input);
  return { input: cleaned.value, redacted: cleaned.redacted };
}

export function findDate(text) {
  const m = String(text || "").match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
  return m ? m[1] : "";
}

export function findMoney(text) {
  const m = String(text || "").match(/(?:total|amount|due|balance)\s*[:\s]*\$?\s*(\d{1,7}(?:\.\d{2})?)/i);
  return m ? m[1] : "";
}

export function parseReceipt(text) {
  const raw = String(text || "");
  const lines = raw.split(/\n/).map((s) => s.trim()).filter(Boolean);
  let merchant = lines.find((l) => !/\b(total|date|tax|invoice|amount)\b/i.test(l)) || "";
  if (!merchant) {
    const named = raw.match(/\b([A-Z][A-Za-z0-9&.'-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'-]{1,40}){0,3})\s+(?:total|amount|due)\b/i);
    merchant = named ? named[1].trim() : "";
  }
  return { merchant, date: findDate(raw), total: findMoney(raw) };
}

export function parseInvoice(text) {
  const raw = String(text || "");
  const from = raw.match(/\b(?:from|vendor|supplier)\s*[:\s]+([^\n]+)/i);
  const to = raw.match(/\b(?:bill to|billed to|to)\s*[:\s]+([^\n]+)/i);
  const number = raw.match(/\b(?:invoice|inv)\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Za-z0-9-]{2,20})/i);
  return {
    from: from ? from[1].trim().slice(0, 120) : "",
    to: to ? to[1].trim().slice(0, 120) : "",
    number: number ? number[1] : "",
    date: findDate(raw),
    total: findMoney(raw),
  };
}

export function meetingFromText(text) {
  const lines = String(text || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
  const actions = [];
  const rest = [];
  for (const line of lines) {
    if (/^(action|todo|next)\b[:\-\s]/i.test(line) || line.startsWith("- ")) {
      actions.push(line.replace(/^[-*\s]+/, "").replace(/^(action|todo|next)\b[:\-\s]*/i, "").trim());
    } else rest.push(line);
  }
  return { summary: rest.join(" ").slice(0, 500) || "No summary yet.", actions: actions.filter(Boolean).slice(0, 12) };
}

function stagesOf(input) {
  const names = String(input.stages || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const counts = String(input.counts || "").split(",").map((s) => Number(String(s).trim()));
  return (names.length ? names : ["New", "Contacted", "Won"]).map((name, i) => ({
    name, count: Number.isFinite(counts[i]) ? counts[i] : 0,
  }));
}

function organized(input) {
  const parsed = parseReceipt(`${input.merchant || ""}\n${input.text || ""}`);
  return {
    merchant: input.merchant || parsed.merchant,
    date: input.date || parsed.date,
    total: input.total || parsed.total,
  };
}

function campaignMessage(input) {
  let message = input.text || "A short note to your contacts.";
  if (input.channel === "sms" && !/\bSTOP\b/.test(message)) message += "\nReply STOP to opt out.";
  if (input.channel === "email" && !/unsubscribe/i.test(message)) message += "\nYou can unsubscribe from these emails.";
  if (isCreditRepair(input.text)) {
    message = message.replace(/\b(your |the )?score will (jump|rise|increase|go up)\b[^.!\n]*/gi, `${CROA} No score change is promised`);
    if (!message.includes(CROA)) message += `\n${CROA} This does not promise a result, a deletion, or a credit score change.`;
  }
  if (REFERRAL_RE.test(input.text) && !message.includes(RESPA)) message += `\n${RESPA} Referral rewards need a human review.`;
  return message;
}

export function requiredChecks(id, input) {
  if (id === "hl-campaign") {
    const checks = CAMPAIGN_CHECKS.map((c) => ({ ...c }));
    if (isCreditRepair(input?.text)) checks.push({ ...CROA_CHECK });
    return checks;
  }
  if (id === "biz-contract") return [{ ...LEGAL_CHECK }];
  return [];
}

export function missingChecks(id, input, checks) {
  const bag = checks && typeof checks === "object" ? checks : {};
  return requiredChecks(id, input).filter((c) => bag[c.id] !== true);
}

export function makeDraft(id, input) {
  const text = input?.text || "";
  const tax = isTax(text);
  const base = { builderId: id, taxBlocked: false, legalBlocked: false, line: "" };
  if (id === "biz-contract" && isLegalAsk(text)) {
    return { ...base, legalBlocked: true, line: LEGAL_LINE, templateId: "", email: "" };
  }
  if (id === "hl-lead") {
    return { ...base, fields: ["Name", "Email", "Phone"], consent: true, sample: { name: input.name, email: input.email, phone: input.phone } };
  }
  if (id === "hl-campaign") {
    return {
      ...base, channel: input.channel, message: campaignMessage(input), recipients: input.recipients,
      sendTime: input.sendTime, creditRepair: isCreditRepair(text),
    };
  }
  if (id === "hl-workflows") {
    const tags = String(input.tags || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
    return { ...base, tags: tags.length ? tags : ["new-lead", "booked", "customer"], contactId: input.contactId };
  }
  if (id === "hl-pipeline") {
    const stages = stagesOf(input);
    const total = stages.reduce((n, s) => n + s.count, 0);
    const summary = `Daily summary: ${stages.map((s) => `${s.name} ${s.count}`).join(", ")}. Total ${total}.`;
    return { ...base, stages, summary };
  }
  if (id === "hl-funnel") {
    const offer = input.offer || text || "Your offer";
    return { ...base, offer, headline: offer.slice(0, 80), line: "Tell people what they get, in one sentence.", button: "Get started" };
  }
  if (id === "acct-receipt") {
    const row = parseReceipt(text);
    return { ...base, engine: input.engine || "tesseract", ...row, taxBlocked: tax, line: tax ? TAX_LINE : "", note: OCR_NOTE };
  }
  if (id === "acct-qbo" || id === "acct-xero") {
    const row = organized(input);
    return { ...base, ...row, taxBlocked: tax, line: tax ? TAX_LINE : "" };
  }
  if (id === "acct-invoice-read") {
    const row = parseInvoice(text);
    return { ...base, ...row, taxBlocked: tax, line: tax ? TAX_LINE : "", note: INVOICE_READ_NOTE };
  }
  if (id === "acct-invoice-make") {
    const amount = input.amount || findMoney(text) || "0";
    return {
      ...base, to: input.to || "Customer", number: input.number || "INV-1001",
      lines: [{ item: input.item || "Service", amount }], total: amount,
      invoiceNinja: input.invoiceNinja === true, taxBlocked: tax, line: tax ? TAX_LINE : "", note: NINJA_NOTE,
    };
  }
  if (id === "biz-chat") return { ...base, website: input.website, welcome: input.welcome };
  if (id === "biz-booking") return { ...base, title: input.title, minutes: input.minutes };
  if (id === "biz-notes") return { ...base, ...meetingFromText(text), note: WHISPER_NOTE };
  if (id === "biz-contract") {
    return { ...base, templateId: input.templateId, email: input.email, note: DOCUSEAL_NOTE };
  }
  if (id === "biz-review") {
    const reply = text
      ? "Thank you for taking the time to write this. We read every review, and a person will follow up if needed."
      : "Thank you for taking the time to write this. We read every review.";
    return { ...base, reply, posted: false };
  }
  return { ...base, text };
}

export function needsRemote(id, draft) {
  if (id === "hl-campaign" || id === "acct-qbo" || id === "acct-xero" || id === "biz-chat" || id === "biz-booking" || id === "biz-contract") return true;
  if (id === "hl-lead") return !!draft?.sample?.email;
  if (id === "hl-workflows") return !!draft?.contactId;
  if (id === "acct-invoice-make") return !!draft?.invoiceNinja;
  return false;
}

export function pendingRecipients(all, sent) {
  const done = new Set(sent || []);
  return (all || []).filter((id) => id && !done.has(id));
}

export function aiRecipients(models) {
  const ais = (models || []).slice(0, 3).map((m) => ({
    provider: m.provider || "",
    providerName: m.providerName || m.provider || "AI",
    name: m.name || m.model || "Model",
    receives: "Your description, and only if you ask for a rewrite on Build. Nothing is sent yet.",
  }));
  if (!ais.length) ais.push({ provider: "", providerName: "No AI connected", name: "", receives: "Nothing will be sent. The draft can still be built on this computer." });
  return { ais, withheld: ["Keys and tokens", "Anything you did not type"] };
}
