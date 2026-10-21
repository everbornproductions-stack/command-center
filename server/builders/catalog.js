// Builder definitions for HighLevel, accounting, and the other business tools.
// Each one is registered with the shared registry. A builder is absent until detect() says the need is here.
// HighLevel: the account is connected, or the person mentions HighLevel.
// Accounting: QuickBooks or Xero is connected, or a receipt or an invoice comes up.
// The rest: only when the chat topic matches.

import { register } from "./registry.js";
import { DOCUSEAL_NOTE, NINJA_NOTE, OCR_NOTE, INVOICE_READ_NOTE, WHISPER_NOTE } from "./drafts.js";

function textOf(ctx) {
  return String(ctx?.text || "");
}

function hasPhrase(text, phrase) {
  const hay = String(text || "").toLowerCase();
  const p = String(phrase || "").toLowerCase().trim();
  if (!p) return false;
  if (p.includes(" ")) return hay.includes(p);
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(hay);
}

function anyPhrase(text, phrases) {
  return phrases.some((p) => hasPhrase(text, p));
}

export function highlevelNeed(ctx) {
  const connected = ctx?.connected || {};
  if (connected.highlevel || connected.ghl) return { why: "HighLevel is connected." };
  if (anyPhrase(textOf(ctx), ["highlevel", "gohighlevel", "go highlevel", "ghl"])) return { why: "HighLevel was mentioned." };
  return false;
}

export function accountingNeed(ctx) {
  const connected = ctx?.connected || {};
  if (connected.quickbooks || connected.qbo) return { why: "QuickBooks is connected." };
  if (connected.xero) return { why: "Xero is connected." };
  if (anyPhrase(textOf(ctx), ["receipt", "receipts", "invoice", "invoices"])) return { why: "A receipt or an invoice came up." };
  return false;
}

function topic(ctx, phrases, why) {
  if (!anyPhrase(textOf(ctx), phrases)) return false;
  return { why };
}

function meetingNeed(ctx) {
  const t = textOf(ctx);
  if (anyPhrase(t, ["whisper", "meeting notes", "meeting transcript", "transcript"])) return { why: "Meeting notes came up." };
  if (hasPhrase(t, "meeting") && (hasPhrase(t, "notes") || hasPhrase(t, "summary"))) return { why: "Meeting notes came up." };
  return false;
}

const FORMS = {
  "hl-lead": [
    { id: "text", label: "What should the form do?", type: "textarea", placeholder: "A short form for new leads" },
    { id: "name", label: "Sample first name", type: "text", placeholder: "Optional. Used only if you publish a contact." },
    { id: "email", label: "Sample email", type: "text", placeholder: "Leave blank to save the form without creating a contact" },
    { id: "phone", label: "Sample phone", type: "text" },
  ],
  "hl-campaign": [
    { id: "text", label: "The message", type: "textarea", placeholder: "Write the text or email. You will approve the send." },
    { id: "channel", label: "Send as", type: "select", options: [{ id: "email", label: "Email" }, { id: "sms", label: "Text message" }] },
    { id: "recipients", label: "Who receives this?", type: "textarea", placeholder: "One HighLevel contact id per line" },
    { id: "sendTime", label: "Send time", type: "text", placeholder: "10:00" },
  ],
  "hl-workflows": [
    { id: "text", label: "What should these workflows do?", type: "textarea", placeholder: "Tag a contact to start the workflow" },
    { id: "tags", label: "Tags that start a workflow", type: "text" },
    { id: "contactId", label: "Contact to tag", type: "text", placeholder: "Leave blank to save the pack without tagging anyone" },
  ],
  "hl-pipeline": [
    { id: "text", label: "What should today's summary cover?", type: "textarea" },
    { id: "stages", label: "Stages", type: "text" },
    { id: "counts", label: "How many in each stage?", type: "text", placeholder: "0, 0, 0" },
  ],
  "hl-funnel": [
    { id: "text", label: "What is the page for?", type: "textarea" },
    { id: "offer", label: "The offer, in a few words", type: "text" },
  ],
  "acct-receipt": [
    { id: "text", label: "Paste the receipt", type: "textarea", placeholder: "North Bakery\n2026-10-21\nTotal $12.40" },
    { id: "engine", label: "Reader", type: "select", advanced: true, options: [
      { id: "tesseract", label: "Tesseract" },
      { id: "paddleocr", label: "PaddleOCR" },
      { id: "doctr", label: "docTR" },
    ] },
  ],
  "acct-qbo": [
    { id: "text", label: "Paste the receipt or describe the bill", type: "textarea", placeholder: "North Bakery\n2026-10-21\nTotal $12.40" },
  ],
  "acct-xero": [
    { id: "text", label: "Paste the receipt or describe the bill", type: "textarea", placeholder: "North Bakery\n2026-10-21\nTotal $12.40" },
  ],
  "acct-invoice-read": [
    { id: "text", label: "Paste the invoice", type: "textarea", placeholder: "From: North Bakery\nInvoice INV-14\n2026-10-21\nTotal $40.00" },
  ],
  "acct-invoice-make": [
    { id: "text", label: "What is this invoice for?", type: "textarea" },
    { id: "to", label: "Bill to", type: "text", placeholder: "Customer" },
    { id: "number", label: "Invoice number", type: "text" },
    { id: "item", label: "Item", type: "text", placeholder: "Service" },
    { id: "amount", label: "Amount", type: "text", placeholder: "40.00" },
    { id: "invoiceNinja", label: "Also send a copy to Invoice Ninja", type: "checkbox", advanced: true },
  ],
  "biz-chat": [
    { id: "text", label: "How should the chat greet people?", type: "textarea" },
    { id: "website", label: "Website address", type: "text", placeholder: "https://example.com" },
    { id: "welcome", label: "Welcome line", type: "text" },
  ],
  "biz-booking": [
    { id: "text", label: "What is the booking for?", type: "textarea" },
    { id: "title", label: "Page title", type: "text" },
    { id: "minutes", label: "Length in minutes", type: "text" },
  ],
  "biz-notes": [
    { id: "text", label: "Paste the meeting, or the words Whisper heard", type: "textarea", placeholder: "We agreed on the menu.\nAction: send the price list" },
  ],
  "biz-contract": [
    { id: "text", label: "Who is this for? Do not ask for legal terms.", type: "textarea", placeholder: "Send my template to the client" },
    { id: "templateId", label: "Your DocuSeal template number", type: "text" },
    { id: "email", label: "Email that should sign", type: "text" },
  ],
  "biz-review": [
    { id: "text", label: "Paste the review", type: "textarea", placeholder: "The bread was warm and the line was short." },
  ],
};

const NOTES = {
  "acct-receipt": OCR_NOTE,
  "acct-invoice-read": INVOICE_READ_NOTE,
  "acct-invoice-make": NINJA_NOTE,
  "biz-notes": WHISPER_NOTE,
  "biz-contract": DOCUSEAL_NOTE,
};

export function formFor(id) {
  return { fields: FORMS[id] || [{ id: "text", label: "Describe it", type: "textarea" }], note: NOTES[id] || "" };
}

const DEFINITIONS = [
  { id: "hl-lead", title: "Lead Capture Wizard", tier: "pro", group: "highlevel", summary: "A short form that saves a new lead.", publishNote: "Publish creates one contact in HighLevel when you include a sample email. Otherwise the form stays here.", detect: highlevelNeed },
  { id: "hl-campaign", title: "SMS and Email Campaign Builder", tier: "extreme", group: "highlevel", summary: "Write a text or an email. You approve every send.", publishNote: "Publish sends this message through HighLevel Conversations. You approve that send.", detect: highlevelNeed },
  { id: "hl-workflows", title: "Workflow Starter Pack", tier: "pro", group: "highlevel", summary: "Start a workflow by adding a tag to a contact.", publishNote: "Publish adds the tag. HighLevel starts the workflow that watches for that tag.", detect: highlevelNeed },
  { id: "hl-pipeline", title: "Pipeline Coach", tier: "pro", group: "highlevel", summary: "A daily summary of your pipeline.", publishNote: "Publish saves today's summary here. It does not message anyone.", detect: highlevelNeed },
  { id: "hl-funnel", title: "Funnel Copy Writer", tier: "pro", group: "highlevel", summary: "Headline, short line, and button text for a page.", publishNote: "Publish saves the copy here. It is not placed on a page.", detect: highlevelNeed },
  { id: "acct-receipt", title: "Receipt Snap", tier: "free", group: "accounting", summary: "Read a receipt and organize the shop, date, and amount.", publishNote: "Publish keeps the organized receipt here. It does not post it.", detect: accountingNeed },
  { id: "acct-qbo", title: "Send to QuickBooks", tier: "pro", group: "accounting", summary: "Post an organized receipt only after you approve it.", publishNote: "Publish posts this to QuickBooks after you click. It does not pay the bill.", detect: accountingNeed },
  { id: "acct-xero", title: "Send to Xero", tier: "pro", group: "accounting", summary: "Post an organized receipt only after you approve it.", publishNote: "Publish posts this to Xero as a draft bill after you click. It does not pay the bill.", detect: accountingNeed },
  { id: "acct-invoice-read", title: "Invoice Reader", tier: "free", group: "accounting", summary: "Read an invoice and list who, the number, and the total.", publishNote: "Publish keeps the reading here. It does not post it.", detect: accountingNeed },
  { id: "acct-invoice-make", title: "Invoice Maker", tier: "pro", group: "accounting", summary: "Make an invoice here. Invoice Ninja is optional.", publishNote: "Publish saves the invoice here. Invoice Ninja is off unless you turn it on.", detect: accountingNeed },
  { id: "biz-chat", title: "Website Chat Assistant", tier: "pro", group: "business", summary: "A chat box for your website, through Chatwoot.", publishNote: "Publish creates the website chat in Chatwoot after you click.", detect: (ctx) => topic(ctx, ["chatwoot", "live chat", "website chat", "chat widget", "chat box"], "A website chat came up.") },
  { id: "biz-booking", title: "Booking Page", tier: "free", group: "business", summary: "A page where someone picks a time, through Cal.com.", publishNote: "Publish creates the booking page on Cal.com after you click.", detect: (ctx) => topic(ctx, ["cal.com", "calcom", "booking page", "book a time", "book a call", "appointment", "appointments", "booking", "bookings"], "A booking came up.") },
  { id: "biz-notes", title: "Meeting Notes", tier: "free", group: "business", summary: "Notes and action items from a meeting, with Whisper.", publishNote: "Publish saves the notes here. Audio is not uploaded.", detect: meetingNeed },
  { id: "biz-contract", title: "Contract and e-sign Sender", tier: "pro", group: "business", summary: "Send your own template for a signature. Not legal advice.", publishNote: "Publish sends your template through DocuSeal after you click. This is not legal advice.", detect: (ctx) => topic(ctx, ["docuseal", "docusign", "e-sign", "esign", "e sign", "contract", "contracts"], "A contract or signature came up.") },
  { id: "biz-review", title: "Review Responder", tier: "free", group: "business", summary: "A reply draft. Nothing is posted until you approve it.", publishNote: "Publish approves the draft. It is not posted to the review site.", detect: (ctx) => topic(ctx, ["review response", "reply to a review", "google review", "customer review", "review responder", "star review"], "A review came up.") },
];

export function loadBuilders() {
  for (const def of DEFINITIONS) register(def);
  return DEFINITIONS.map((d) => d.id);
}

loadBuilders();
