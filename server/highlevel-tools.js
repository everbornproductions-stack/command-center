// Phase 33 item 1. HighLevel contacts, invoices, and workflows as tools.
// Reads can run. Anything that sends, charges, or changes data waits for a click.
// The token stays in the vault and is never logged.
import crypto from "node:crypto";
import { API, fresh } from "./publish/oauth.js";
import { getSecret } from "./vault.js";
import { checkOutgoing } from "./compliance-guard.js";

const VAULT = "ghl-crm";
const VERSION = "2021-07-28";

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

export function connectedSecret() {
  try {
    const s = getSecret(VAULT);
    if (s?.key && s.locationId) return s;
  } catch { /* vault not open */ }
  return null;
}

const str = (v, n = 500) => String(v ?? "").trim().slice(0, n);

function summarySend(a) {
  return `Send ${a.channel || "Email"} to contact ${a.contactId}: ${str(a.text, 240)}`;
}

export const ACTIONS = {
  search_contacts: {
    writes: false,
    description: "Find HighLevel contacts by name or email. Read only.",
    summary: (a) => `Look up contacts matching "${str(a.query, 80) || "all"}".`,
  },
  create_contact: {
    writes: true,
    description: "Create or update a HighLevel contact. Waits for a click. Nothing is saved until then.",
    summary: (a) => `Save contact ${str(a.name || a.email, 80)} in HighLevel.`,
  },
  list_invoices: {
    writes: false,
    description: "List HighLevel invoices. Read only. Does not charge anyone.",
    summary: () => "List invoices. Nothing is charged.",
  },
  create_invoice: {
    writes: true,
    description: "Create a HighLevel invoice. Waits for a click. Nothing is charged until then.",
    summary: (a) => `Create an invoice for ${str(a.amount, 40)} (${str(a.title, 80) || "invoice"}). Nothing is charged until you confirm.`,
  },
  list_workflows: {
    writes: false,
    description: "List HighLevel workflows. Read only.",
    summary: () => "List workflows.",
  },
  start_workflow: {
    writes: true,
    description: "Add a contact to a HighLevel workflow. This can message them. Waits for a click.",
    summary: (a) => `Add contact ${a.contactId} to workflow ${a.workflowId}. This can message them.`,
  },
  send_message: {
    writes: true,
    description: "Send an email or SMS through HighLevel. Waits for a click. Nothing is sent until then.",
    summary: summarySend,
  },
};

function schema(props, required = []) {
  return { type: "object", properties: props, required };
}

const PROP = {
  query: { type: "string", description: "Name or email to find" },
  name: { type: "string" },
  email: { type: "string" },
  phone: { type: "string" },
  contactId: { type: "string" },
  amount: { type: "string", description: "Amount to show before the click, such as 25.00" },
  title: { type: "string" },
  workflowId: { type: "string" },
  channel: { type: "string", description: "Email or SMS" },
  text: { type: "string", description: "The exact message" },
};

export function highlevelToolEntries() {
  if (!connectedSecret()) return [];
  return Object.entries(ACTIONS).map(([name, spec]) => ({
    name: `highlevel__${name}`,
    description: spec.description,
    parameters: schema(pickProps(name), requiredFor(name)),
    server: { id: "highlevel", name: "HighLevel" },
    tool: { name, description: spec.description },
    readOnly: !spec.writes,
    needsApproval: !!spec.writes,
    local: "highlevel",
  }));
}

function pickProps(name) {
  const keys = {
    search_contacts: ["query"],
    create_contact: ["name", "email", "phone"],
    list_invoices: [],
    create_invoice: ["contactId", "amount", "title"],
    list_workflows: [],
    start_workflow: ["contactId", "workflowId"],
    send_message: ["contactId", "channel", "text"],
  }[name] || [];
  return Object.fromEntries(keys.map((k) => [k, PROP[k]]));
}

function requiredFor(name) {
  return {
    create_contact: ["name"],
    create_invoice: ["amount"],
    start_workflow: ["contactId", "workflowId"],
    send_message: ["contactId", "text"],
  }[name] || [];
}

function argsFor(name, raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const key of Object.keys(pickProps(name))) out[key] = str(src[key], key === "text" ? 2000 : 200);
  return out;
}

async function api(path, { method = "GET", json } = {}) {
  const secret = await fresh("ghlcrm");
  if (!secret?.key || !secret.locationId) throw err(409, "Connect HighLevel for contacts, invoices, and workflows first.", "sign_in");
  const headers = {
    authorization: `Bearer ${secret.key}`,
    Version: VERSION,
    accept: "application/json",
    ...(json ? { "content-type": "application/json" } : {}),
  };
  let r;
  try {
    r = await fetch(`${API.ghl()}${path}`, {
      method,
      headers,
      body: json ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
  } catch (e) {
    throw err(502, `Could not reach HighLevel: ${e?.name === "TimeoutError" ? "no answer in time" : "network error"}`, "network");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = str(j.message || j.error || r.status, 180);
    throw err(r.status >= 500 ? 502 : 400, `HighLevel refused that request (${msg}).`, "highlevel");
  }
  return { secret, json: j };
}

async function perform(name, a) {
  const loc = (await fresh("ghlcrm")).locationId;
  if (name === "search_contacts") {
    const q = new URLSearchParams({ locationId: loc, query: a.query || "" });
    const { json } = await api(`/contacts/?${q}`);
    const rows = json.contacts || json.results || [];
    return rows.slice(0, 20).map((c) => ({ id: c.id, name: c.contactName || c.name || `${c.firstName || ""} ${c.lastName || ""}`.trim(), email: c.email || "" }));
  }
  if (name === "create_contact") {
    const [firstName, ...rest] = a.name.split(/\s+/);
    const { json } = await api("/contacts/", { method: "POST", json: { locationId: loc, firstName: firstName || a.name, lastName: rest.join(" "), email: a.email || undefined, phone: a.phone || undefined } });
    const c = json.contact || json;
    return { id: c.id || null, saved: true };
  }
  if (name === "list_invoices") {
    const q = new URLSearchParams({ altId: loc, altType: "location" });
    const { json } = await api(`/invoices/?${q}`);
    const rows = json.invoices || json.data || [];
    return rows.slice(0, 20).map((inv) => ({ id: inv.id || inv._id, title: inv.name || inv.title || "", amount: inv.total ?? inv.amount ?? null, status: inv.status || "" }));
  }
  if (name === "create_invoice") {
    if (!a.amount) throw err(400, "Say the amount before creating an invoice.", "amount");
    const { json } = await api("/invoices/", { method: "POST", json: { altId: loc, altType: "location", name: a.title || "Invoice", contactId: a.contactId || undefined, amount: a.amount } });
    return { id: json.invoice?.id || json.id || null, created: true };
  }
  if (name === "list_workflows") {
    const q = new URLSearchParams({ locationId: loc });
    const { json } = await api(`/workflows/?${q}`);
    const rows = json.workflows || json.data || [];
    return rows.slice(0, 20).map((w) => ({ id: w.id, name: w.name || "" }));
  }
  if (name === "start_workflow") {
    if (!a.contactId || !a.workflowId) throw err(400, "A contact and a workflow are required.", "args");
    await api(`/contacts/${encodeURIComponent(a.contactId)}/workflow/${encodeURIComponent(a.workflowId)}`, { method: "POST", json: {} });
    return { started: true };
  }
  if (name === "send_message") {
    if (!a.contactId || !a.text) throw err(400, "A contact and the message are required.", "args");
    const channel = /sms|text/i.test(a.channel) ? "SMS" : "Email";
    await api("/conversations/messages", { method: "POST", json: { type: channel, contactId: a.contactId, message: a.text, locationId: loc } });
    return { sent: true, channel };
  }
  throw err(400, "Unknown HighLevel action.", "action");
}

const plans = new Map();
const guardOf = (name, args, raw) => (name === "send_message" ? checkOutgoing({ text: args.text, channel: /sms|text/i.test(args.channel) ? "sms" : "email", consent: raw?.consent === true }) : null);

export function planHighlevel(name, raw) {
  const spec = ACTIONS[name];
  if (!spec) throw err(400, "Unknown HighLevel action.", "action");
  if (!connectedSecret()) throw err(409, "Connect HighLevel for contacts, invoices, and workflows first.", "sign_in");
  const args = argsFor(name, raw);
  if (!spec.writes) return { writes: false, summary: spec.summary(args), result: null, pending: perform(name, args) };
  const planId = "hl-" + crypto.randomBytes(6).toString("hex");
  const guard = guardOf(name, args, raw);
  if (guard && !guard.ok) throw err(422, `Not sent. ${guard.blocked[0].plain} ${guard.blocked[0].why}`, "compliance_block");
  plans.set(planId, { name, args, at: Date.now(), warnings: guard?.warnings || [] });
  return { writes: true, planId, summary: spec.summary(args), needsClick: true, warnings: guard?.warnings || [] };
}

export async function resolvePlan(planned) {
  if (planned.pending) return { summary: planned.summary, result: await planned.pending, sent: false };
  return planned;
}

export async function runHighlevelPlan(planId, confirmed, sendAnyway = false) {
  if (confirmed !== true) throw err(400, "Preview first, then confirm. Nothing was sent.", "confirm_required");
  const plan = plans.get(String(planId || ""));
  if (!plan || Date.now() - plan.at > 30 * 60 * 1000) throw err(409, "Preview first (or the preview expired). Nothing was sent.", "preview_required");
  if (plan.warnings?.length && sendAnyway !== true) throw err(409, "Review the warnings first. Press Fix it, or Send anyway if you are sure. Nothing was sent.", "compliance_review");
  plans.delete(String(planId));
  const result = await perform(plan.name, plan.args);
  return { summary: ACTIONS[plan.name].summary(plan.args), result, sent: plan.name === "send_message" };
}

// Council tools call this only after the approval click. confirmed must be true for a write.
export async function runHighlevelAction(name, raw, { confirmed = false } = {}) {
  const spec = ACTIONS[name];
  if (!spec) return { text: "Unknown HighLevel action.", isError: true };
  if (spec.writes && confirmed !== true) return { text: "This waits for a click. Nothing was sent.", isError: true, denied: true };
  { const g = guardOf(name, argsFor(name, raw), raw); if (g && !g.ok) return { text: `Not sent. ${g.blocked[0].plain} ${g.blocked[0].why}`, isError: true, denied: true }; }
  try {
    const result = await perform(name, argsFor(name, raw));
    return { text: JSON.stringify(result), isError: false };
  } catch (e) {
    return { text: e.message || "HighLevel request failed.", isError: true };
  }
}
