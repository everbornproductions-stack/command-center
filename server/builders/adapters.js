// External calls for the builders. Each one runs only after a click.
// Tests point the base addresses at a local mock. No token is written into a URL or an error.
// Send to Xero uses the same JSON body as xero-node's AccountingApi.createInvoices.
// The package is not loaded here, so a test cannot open a client that calls api.xero.com.

import { parseReceipt, parseInvoice, meetingFromText } from "./drafts.js";

const trim = (url) => String(url || "").replace(/\/$/, "");

export function ghlBase() { return trim(process.env.CC_GHL_API_URL || "https://services.leadconnectorhq.com"); }
export function qboBase() { return trim(process.env.CC_QBO_API_URL || "https://quickbooks.api.intuit.com"); }
export function xeroBase() { return trim(process.env.CC_XERO_API_URL || "https://api.xero.com/api.xro/2.0"); }
export function calBase() { return trim(process.env.CC_CAL_API_URL || "https://api.cal.com"); }

function envOr(secretUrl, envName) {
  return trim(process.env[envName] || secretUrl || "");
}

function safeMessage(json, status, token) {
  let msg = json && typeof json.message === "string" ? json.message.slice(0, 160) : "";
  if (token && msg.includes(token)) msg = "";
  return msg ? `The service returned ${status}: ${msg}` : `The service returned ${status}. Nothing else was sent.`;
}

async function send(url, { method = "POST", headers, body, token }) {
  const r = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(safeMessage(json, r.status, token)), { status: 502, code: "service" });
  return json || {};
}

function ghlHeaders(token) {
  return { authorization: `Bearer ${token}`, Version: "2021-07-28", accept: "application/json", "content-type": "application/json" };
}

export function xeroInvoicePayload({ merchant, date, total }) {
  // Same body xero-node posts from AccountingApi.createInvoices(tenantId, { invoices }).
  const amount = Number(total);
  return {
    Invoices: [{
      Type: "ACCPAY",
      Contact: { Name: merchant || "Receipt" },
      Date: date || new Date().toISOString().slice(0, 10),
      LineItems: [{ Description: "Receipt", Quantity: 1, UnitAmount: Number.isFinite(amount) ? amount : 0 }],
      Status: "DRAFT",
    }],
  };
}

export function qboBillPayload({ merchant, total }) {
  const amount = Number(total);
  return {
    VendorRef: { name: merchant || "Receipt" },
    Line: [{
      DetailType: "AccountBasedExpenseLineDetail",
      Amount: Number.isFinite(amount) ? amount : 0,
      Description: "Receipt",
    }],
  };
}

export async function readReceipt({ engine, text }) {
  const id = ["tesseract", "paddleocr", "doctr"].includes(engine) ? engine : "tesseract";
  const url = trim(process.env.CC_OCR_URL || "");
  if (url) {
    const json = await send(url, { body: { engine: id, text: String(text || "") } });
    return { engine: id, merchant: json.merchant || "", date: json.date || "", total: json.total || "", reader: "remote", sent: false, posted: false };
  }
  return { engine: id, ...parseReceipt(text), reader: "local", sent: false, posted: false };
}

export async function readInvoiceText(text) {
  const url = trim(process.env.CC_INVOICE2DATA_URL || "");
  if (url) {
    const json = await send(url, { body: { text: String(text || "") } });
    return { from: json.from || "", number: json.number || "", date: json.date || "", total: json.total || "", to: json.to || "", reader: "invoice2data", sent: false, posted: false };
  }
  return { ...parseInvoice(text), reader: "local", sent: false, posted: false };
}

export async function readWhisper(text) {
  const url = trim(process.env.CC_WHISPER_URL || "");
  let transcript = String(text || "");
  let reader = "local";
  if (url) {
    const json = await send(url, { body: { text: transcript } });
    if (typeof json.text === "string" && json.text) transcript = json.text;
    reader = "whisper";
  }
  return { ...meetingFromText(transcript), reader, sent: false, posted: false };
}

export async function readPipeline(secret) {
  const url = `${ghlBase()}/opportunities/search?location_id=${encodeURIComponent(secret.locationId)}`;
  const json = await send(url, { method: "GET", headers: ghlHeaders(secret.key), token: secret.key });
  const rows = Array.isArray(json.opportunities) ? json.opportunities : [];
  return { count: rows.length, sent: false, posted: false };
}

async function postLead(secret, draft) {
  const body = {
    locationId: secret.locationId,
    firstName: draft.sample?.name || "",
    email: draft.sample?.email || "",
    phone: draft.sample?.phone || "",
    tags: ["new-lead"],
    source: "Meldmind",
  };
  const json = await send(`${ghlBase()}/contacts/`, { headers: ghlHeaders(secret.key), body, token: secret.key });
  return { posted: true, remoteId: json.contact?.id || json.id || null, reason: "The lead was created in HighLevel." };
}

async function postCampaign(secret, draft, sentTo) {
  const done = [...(sentTo || [])];
  const pending = (draft.recipients || []).filter((id) => !done.includes(id));
  try {
    for (const contactId of pending) {
      const body = {
        type: draft.channel === "sms" ? "SMS" : "Email",
        contactId,
        message: draft.message || "",
        subject: draft.channel === "email" ? "A note for you" : undefined,
      };
      await send(`${ghlBase()}/conversations/messages`, { headers: ghlHeaders(secret.key), body, token: secret.key });
      done.push(contactId);
    }
  } catch (e) {
    e.sentTo = done;
    throw e;
  }
  return { posted: true, sentTo: done, reason: "The message was sent through HighLevel Conversations." };
}

async function postTags(secret, draft) {
  const body = { tags: draft.tags || [] };
  await send(`${ghlBase()}/contacts/${encodeURIComponent(draft.contactId)}/tags`, { headers: ghlHeaders(secret.key), body, token: secret.key });
  return { posted: true, reason: "The tag was added. A workflow that watches for it can start." };
}

async function postQbo(secret, draft) {
  const body = qboBillPayload(draft);
  const json = await send(`${qboBase()}/v3/company/${encodeURIComponent(secret.realmId)}/bill`, {
    headers: { authorization: `Bearer ${secret.key}`, accept: "application/json", "content-type": "application/json" },
    body, token: secret.key,
  });
  return { posted: true, remoteId: json.Bill?.Id || json.id || null, reason: "Posted to QuickBooks. This does not pay the bill." };
}

async function postXero(secret, draft) {
  const body = xeroInvoicePayload(draft);
  const json = await send(`${xeroBase()}/Invoices`, {
    headers: {
      authorization: `Bearer ${secret.key}`,
      "xero-tenant-id": secret.tenantId,
      accept: "application/json",
      "content-type": "application/json",
    },
    body, token: secret.key,
  });
  const row = json.Invoices?.[0] || {};
  return { posted: true, remoteId: row.InvoiceID || null, reason: "Posted to Xero as a draft bill. This does not pay the bill." };
}

async function postChatwoot(secret, draft) {
  const base = envOr(secret.url, "CC_CHATWOOT_URL");
  if (!base) return { posted: false, needsUrl: true, reason: "Add the Chatwoot address. Nothing was sent." };
  const accountId = secret.accountId || "1";
  const body = {
    name: "Website chat",
    channel: { type: "web_widget", website_url: draft.website || "", welcome_title: "Chat", welcome_tagline: draft.welcome || "Hello. How can we help?" },
  };
  const json = await send(`${base}/api/v1/accounts/${encodeURIComponent(accountId)}/inboxes`, {
    headers: { api_access_token: secret.key, accept: "application/json", "content-type": "application/json" },
    body, token: secret.key,
  });
  return { posted: true, remoteId: json.id || null, reason: "The website chat was created in Chatwoot." };
}

async function postCal(secret, draft) {
  const body = { title: draft.title || "A time to talk", length: draft.minutes || 30 };
  const json = await send(`${calBase()}/v2/event-types`, {
    headers: { authorization: `Bearer ${secret.key}`, accept: "application/json", "content-type": "application/json" },
    body, token: secret.key,
  });
  return { posted: true, remoteId: json.event_type?.id || json.id || null, reason: "The booking page was created on Cal.com." };
}

async function postDocuseal(secret, draft) {
  const base = envOr(secret.url, "CC_DOCUSEAL_URL");
  if (!base) return { posted: false, needsUrl: true, reason: "Add the DocuSeal address. Nothing was sent." };
  const body = {
    template_id: draft.templateId,
    send_email: true,
    submitters: [{ email: draft.email, role: "Signer" }],
  };
  const json = await send(`${base}/api/submissions`, {
    headers: { "x-auth-token": secret.key, accept: "application/json", "content-type": "application/json" },
    body, token: secret.key,
  });
  return { posted: true, remoteId: json.id || null, reason: "Your template was sent for a signature. This is not legal advice." };
}

async function postNinja(secret, draft) {
  const base = envOr(secret.url, "CC_INVOICE_NINJA_URL");
  if (!base) return { posted: false, needsUrl: true, reason: "Add the Invoice Ninja address. Nothing was sent." };
  const body = { number: draft.number, client: draft.to, amount: draft.total, line_items: draft.lines || [] };
  const json = await send(`${base}/api/v1/invoices`, {
    headers: { "x-api-token": secret.key, accept: "application/json", "content-type": "application/json" },
    body, token: secret.key,
  });
  return { posted: true, remoteId: json.data?.id || null, reason: "The invoice was sent to Invoice Ninja. This does not take a payment." };
}

export async function publishExternal({ id, draft, secret, sentTo }) {
  if (id === "hl-lead") return postLead(secret, draft);
  if (id === "hl-campaign") return postCampaign(secret, draft, sentTo);
  if (id === "hl-workflows") return postTags(secret, draft);
  if (id === "acct-qbo") return postQbo(secret, draft);
  if (id === "acct-xero") return postXero(secret, draft);
  if (id === "acct-invoice-make") return postNinja(secret, draft);
  if (id === "biz-chat") return postChatwoot(secret, draft);
  if (id === "biz-booking") return postCal(secret, draft);
  if (id === "biz-contract") return postDocuseal(secret, draft);
  return { posted: false, reason: "Saved on this computer. Nothing was sent." };
}
