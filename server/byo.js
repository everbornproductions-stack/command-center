// Bring your own apps (Phase 33). HighLevel contacts, invoices, and workflows,
// an MCP server by URL on the Phase 16 client, and custom webhook tools.
// Anything that sends, charges, or changes data waits for a confirm click.
// Header values live in the vault. They are never written to a log or a reply.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { getSecret, setSecret } from "./vault.js";
import { emit } from "./events.js";
import { localFetch } from "./loopback-fetch.js";
import { API, fresh } from "./publish/oauth.js";
import { isPrivateIPv4 } from "./pairing.js";
import { gate } from "./feature-gate.js";
import { licenseState } from "./license.js";
import {
  addServer, connectServer, findServer, listServers, markServer, redactServerError,
  registerExtraTools, removeServer, requestApproval, serverView, setToolPrefs,
} from "./mcp.js";

const HOOK_DOC = "byo.hooks";
const PENDING_MS = 10 * 60 * 1000;
const pending = new Map();

const fail = (status, message, code = "byo") => Object.assign(new Error(message), { status, code });
const hooksDoc = () => { const d = doc(HOOK_DOC, () => ({ list: [] })); d.list ||= []; return d; };
const saveHooks = (d) => putDoc(HOOK_DOC, d);
const hookVault = (id) => `byo-hook-${id}`;

export function scrub(text, secrets) {
  let out = String(text ?? "");
  const list = [];
  for (const s of secrets || []) {
    const v = String(s || "");
    if (v.length < 4) continue;
    list.push(v);
    if (!v.startsWith("Bearer ")) list.push(`Bearer ${v}`);
  }
  for (const s of list) out = out.split(s).join("saved secret");
  return out;
}

function checkUrl(raw) {
  const text = String(raw || "").trim();
  if (!text || text.length > 2000) throw fail(400, "Type the address.");
  let u;
  try { u = new URL(text); } catch { throw fail(400, "That address is not a valid URL."); }
  if (u.username || u.password) throw fail(400, "The address cannot include a username or password.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^169\.254\./.test(host)) throw fail(400, "That address is a link-local address and is refused.");
  if (u.protocol === "https:") return u.toString();
  if (u.protocol !== "http:") throw fail(400, "The address must start with https://.");
  const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (local || isPrivateIPv4(host)) return u.toString();
  throw fail(400, "An http address is only allowed for this computer or a private network. Use https:// for everything else.");
}

function cleanName(v, label) {
  const name = String(v || "").replace(/[\r\n]/g, " ").trim().slice(0, 60);
  if (!name) throw fail(400, `Give the ${label} a name.`);
  return name;
}

function cleanFields(fields) {
  if (fields == null || fields === "") return [];
  if (!Array.isArray(fields)) throw fail(400, "Fields must be a list.");
  if (fields.length > 8) throw fail(400, "A webhook can have up to 8 fields.");
  return fields.map((f) => {
    const key = String(f?.key || f?.name || "").trim();
    if (!/^[a-z][a-z0-9_]{0,24}$/.test(key)) throw fail(400, "A field name starts with a letter and uses letters, numbers, or underscores.");
    const label = String(f?.label || key).replace(/[\r\n]/g, " ").trim().slice(0, 40) || key;
    return { key, label };
  });
}

function cleanArgs(fields, args) {
  const src = args && typeof args === "object" ? args : {};
  const out = {};
  for (const f of fields || []) {
    if (src[f.key] == null || src[f.key] === "") continue;
    const v = String(src[f.key]);
    if (v.length > 2000) throw fail(400, "A field is too long.");
    out[f.key] = v;
  }
  return out;
}

function headerPair(name, value, { required = false } = {}) {
  const n = String(name || "").trim();
  const v = String(value || "");
  if (!n && !v) return null;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(n)) throw fail(400, "The header name must be letters, numbers, or hyphens.");
  if (!v.trim()) throw fail(400, required ? "Type the header value." : "Type the header value, or leave both header fields empty.");
  if (/[\r\n]/.test(v) || v.length > 8000) throw fail(400, "That header value cannot be saved.");
  return { name: n, value: v };
}

function ghlSecret() {
  const s = getSecret("ghl");
  return s?.key && s.locationId ? s : null;
}

function remember(row) {
  while (pending.size > 20) pending.delete(pending.keys().next().value);
  pending.set(row.id, row);
  const t = setTimeout(() => pending.delete(row.id), PENDING_MS);
  t.unref?.();
  row.timer = t;
  return { id: row.id, name: row.name, effect: row.effect, summary: row.summary };
}

function publicPending() {
  const now = Date.now();
  const out = [];
  for (const row of pending.values()) {
    if (now - row.at > PENDING_MS) { pending.delete(row.id); continue; }
    out.push({ id: row.id, name: row.name, effect: row.effect, summary: row.summary });
  }
  return out;
}

function publicHook(h) {
  return {
    id: h.id, name: h.name, url: h.url, headerName: h.headerName || "",
    headerSaved: !!getSecret(hookVault(h.id))?.value, effect: h.effect, fields: h.fields || [],
  };
}

export function publicState() {
  const s = licenseState();
  return {
    pro: s.tier !== "free",
    highlevel: {
      connected: !!ghlSecret(),
      tools: HL.map((t) => ({ id: t.id, name: t.label, effect: t.effect, fields: t.fields })),
    },
    hooks: hooksDoc().list.map(publicHook),
    mcp: listServers().filter((row) => row.byo).map(serverView),
    pending: publicPending(),
  };
}

async function ghlCall(method, path, body, secret) {
  const base = API.ghl().replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${secret}`, Version: "2021-07-28", Accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  let res;
  try {
    res = await localFetch(base + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      redirect: "manual", signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw fail(502, scrub(`HighLevel did not answer: ${e.message}`, [secret]));
  }
  if (res.status >= 300 && res.status < 400) throw fail(502, "HighLevel tried to redirect. That was refused.");
  const text = await res.text();
  const clean = scrub(text, [secret]).slice(0, 8000);
  if (!res.ok) throw fail(502, scrub(`HighLevel answered HTTP ${res.status}: ${clean.slice(0, 300)}`, [secret]));
  return clean || "(HighLevel returned nothing)";
}

async function ghlReady() {
  if (!ghlSecret()) throw fail(409, "HighLevel is not connected. Add a token and a location id in Publishing.");
  const s = await fresh("ghl");
  if (!s?.key || !s.locationId) throw fail(409, "HighLevel is not connected. Add a token and a location id in Publishing.");
  return s;
}

const idOk = (v) => /^[A-Za-z0-9_-]{1,80}$/.test(String(v || ""));

const HL = [
  {
    id: "list_contacts", label: "List contacts", effect: "read", fields: [],
    async exec(s) { return ghlCall("GET", `/contacts/?locationId=${encodeURIComponent(s.locationId)}`, null, s.key); },
  },
  {
    id: "list_invoices", label: "List invoices", effect: "read", fields: [],
    async exec(s) { return ghlCall("GET", `/invoices/?altId=${encodeURIComponent(s.locationId)}&altType=location`, null, s.key); },
  },
  {
    id: "list_workflows", label: "List workflows", effect: "read", fields: [],
    async exec(s) { return ghlCall("GET", `/workflows/?locationId=${encodeURIComponent(s.locationId)}`, null, s.key); },
  },
  {
    id: "create_contact", label: "Create a contact", effect: "write",
    fields: [
      { key: "first_name", label: "First name" },
      { key: "last_name", label: "Last name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
    ],
    async exec(s, args) {
      return ghlCall("POST", "/contacts/", {
        locationId: s.locationId,
        firstName: args.first_name || "",
        lastName: args.last_name || "",
        email: args.email || "",
        phone: args.phone || "",
      }, s.key);
    },
  },
  {
    id: "create_invoice", label: "Create an invoice", effect: "write",
    fields: [
      { key: "name", label: "Invoice name" },
      { key: "currency", label: "Currency" },
    ],
    async exec(s, args) {
      return ghlCall("POST", "/invoices/", {
        altId: s.locationId, altType: "location", name: args.name || "Invoice", currency: args.currency || "USD",
      }, s.key);
    },
  },
  {
    id: "start_workflow", label: "Start a workflow", effect: "write",
    fields: [
      { key: "contact_id", label: "Contact id" },
      { key: "workflow_id", label: "Workflow id" },
    ],
    async exec(s, args) {
      if (!idOk(args.contact_id) || !idOk(args.workflow_id)) throw fail(400, "Contact id and workflow id are required.");
      return ghlCall("POST", `/contacts/${encodeURIComponent(args.contact_id)}/workflow/${encodeURIComponent(args.workflow_id)}`, {}, s.key);
    },
  },
];

function hlTool(id) {
  const t = HL.find((x) => x.id === id);
  if (!t) throw fail(404, "Unknown HighLevel tool.");
  return t;
}

export async function runHighLevel(tool) {
  const t = hlTool(tool);
  if (t.effect !== "read") throw fail(400, "This HighLevel change waits for a confirm click. Prepare it, then click Send.");
  const s = await ghlReady();
  emit("log", { text: `Your apps: "${t.id}" on HighLevel ran.` });
  return { ok: true, text: await t.exec(s, {}) };
}

export async function prepareHighLevel(tool, args) {
  const t = hlTool(tool);
  if (t.effect !== "write") throw fail(400, "This HighLevel tool runs when you click Run. It does not need a second confirm.");
  if (!ghlSecret()) throw fail(409, "HighLevel is not connected. Add a token and a location id in Publishing.");
  const clean = cleanArgs(t.fields, args);
  const id = "p-" + crypto.randomBytes(6).toString("hex");
  return remember({
    id, kind: "highlevel", tool: t.id, args: clean, name: t.label, effect: "write",
    summary: `${t.label}. Nothing is sent until you click Send.`, at: Date.now(),
  });
}

async function callHook(hook, args) {
  const sec = getSecret(hookVault(hook.id));
  const secret = sec?.value || "";
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (hook.headerName && secret) headers[hook.headerName] = secret;
  let res;
  try {
    res = await localFetch(hook.url, {
      method: "POST", headers, body: JSON.stringify({ name: hook.name, fields: args || {} }),
      redirect: "manual", signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw fail(502, scrub(`The webhook did not answer: ${e.message}`, [secret]));
  }
  if (res.status >= 300 && res.status < 400) throw fail(502, "The webhook tried to redirect. That was refused.");
  const text = await res.text();
  const clean = scrub(text, [secret]).slice(0, 8000);
  if (!res.ok) throw fail(502, scrub(`The webhook answered HTTP ${res.status}: ${clean.slice(0, 300)}`, [secret]));
  return clean || "(the webhook returned nothing)";
}

export async function addHook(body) {
  gate("byoWebhook");
  const name = cleanName(body.name, "webhook");
  const url = checkUrl(body.url);
  const effect = body.effect === "read" ? "read" : "write";
  const fields = cleanFields(body.fields);
  const header = headerPair(body.headerName, body.headerValue);
  const id = "h-" + crypto.randomBytes(5).toString("hex");
  if (header) await setSecret(hookVault(id), { key: "byo", value: header.value });
  const d = hooksDoc();
  d.list.push({ id, name, url, headerName: header?.name || "", effect, fields, createdAt: Date.now() });
  saveHooks(d);
  emit("log", { text: `Custom webhook "${name}" saved. Nothing is sent until you click Send.` });
  return { ...publicState(), hook: { id, name } };
}

export async function removeHook(id) {
  const d = hooksDoc();
  const i = d.list.findIndex((h) => h.id === id);
  if (i < 0) throw fail(404, "Webhook not found.");
  const name = d.list[i].name;
  d.list.splice(i, 1);
  saveHooks(d);
  await setSecret(hookVault(id), null);
  emit("log", { text: `Custom webhook "${name}" removed. Its header was deleted from the vault.` });
  return publicState();
}

function findHook(id) {
  const h = hooksDoc().list.find((x) => x.id === id);
  if (!h) throw fail(404, "Webhook not found.");
  return h;
}

export async function runHook(id, args) {
  const h = findHook(id);
  if (h.effect !== "read") throw fail(400, "This webhook changes something. Prepare it, then click Send.");
  const clean = cleanArgs(h.fields, args);
  emit("log", { text: `Your apps: webhook "${h.name}" ran.` });
  return { ok: true, text: await callHook(h, clean) };
}

export function prepareHook(id, args) {
  const h = findHook(id);
  if (h.effect === "read") throw fail(400, "This webhook is read only. Click Run. It does not need a second confirm.");
  const clean = cleanArgs(h.fields, args);
  const pid = "p-" + crypto.randomBytes(6).toString("hex");
  return remember({
    id: pid, kind: "hook", hookId: h.id, args: clean, name: h.name, effect: "write",
    summary: `Send "${h.name}". Nothing is sent until you click Send.`, at: Date.now(),
  });
}

export async function confirmPending(id) {
  const row = pending.get(String(id || ""));
  if (!row) throw fail(409, "That send is no longer waiting. Prepare it again.");
  pending.delete(row.id);
  clearTimeout(row.timer);
  let text;
  if (row.kind === "highlevel") {
    const t = hlTool(row.tool);
    const s = await ghlReady();
    text = await t.exec(s, row.args || {});
    emit("log", { text: `Your apps: "${t.id}" on HighLevel ran.` });
  } else if (row.kind === "hook") {
    const h = findHook(row.hookId);
    text = await callHook(h, row.args || {});
    emit("log", { text: `Your apps: webhook "${h.name}" ran.` });
  } else throw fail(409, "That send is no longer waiting. Prepare it again.");
  return { ok: true, text };
}

export async function addByoMcp(body) {
  gate("byoMcp");
  const name = cleanName(body.name, "server");
  const url = checkUrl(body.url);
  const header = headerPair(body.headerName, body.headerValue);
  const secret = header?.value || "";
  const row = await addServer({ name, transport: "http", url, headers: header ? { [header.name]: header.value } : undefined });
  markServer(row.id, { byo: true });
  let error = null;
  try {
    await connectServer(row.id, { refresh: true });
    const tools = findServer(row.id)?.lastTools || [];
    if (tools.length) setToolPrefs(row.id, { all: true });
  } catch (e) {
    error = scrub(e.message || "Could not reach the server.", [secret]).slice(0, 300);
  }
  if (secret) redactServerError(row.id, (text) => scrub(text, [secret]));
  emit("log", { text: error ? `MCP server "${name}" saved, but it could not be reached.` : `MCP server "${name}" connected.` });
  const view = serverView(findServer(row.id));
  return { ...publicState(), ok: !error, error, server: view };
}

export async function removeByoMcp(id) {
  const row = findServer(id);
  if (!row || !row.byo) throw fail(404, "Server not found.");
  const name = row.name;
  await removeServer(id);
  emit("log", { text: `MCP server "${name}" removed. Its header was deleted from the vault.` });
  return publicState();
}

function toolResult(text, t0, extra = {}) {
  return { text, isError: !!extra.isError, denied: !!extra.denied, ms: Date.now() - t0 };
}

async function approvedCall(serverId, serverName, tool, description, args, exec) {
  const t0 = Date.now();
  emit("log", { text: `Your apps: "${tool}" on ${serverName} is waiting for your OK.` });
  const ok = await requestApproval({ serverId, serverName, tool, args, readOnly: false, description: description || "" });
  if (!ok) return toolResult(`The person declined to run "${tool}". Continue without it and say so.`, t0, { isError: true, denied: true });
  try {
    const text = await exec();
    emit("log", { text: `Your apps: "${tool}" on ${serverName} ran.` });
    return toolResult(text, t0);
  } catch (e) {
    emit("log", { text: `Your apps: "${tool}" on ${serverName} failed.`, level: "error" });
    return toolResult(`Tool error: ${e.message}`, t0, { isError: true });
  }
}

export function toolEntries() {
  const out = [];
  if (ghlSecret()) {
    for (const t of HL) {
      const write = t.effect === "write";
      out.push({
        name: `highlevel_${t.id}`,
        description: `${t.label} in HighLevel. ${write ? "This changes data and waits for approval." : "This reads data."}`.slice(0, 1024),
        parameters: { type: "object", properties: Object.fromEntries(t.fields.map((f) => [f.key, { type: "string", description: f.label }])) },
        server: { id: "highlevel", name: "HighLevel" },
        tool: { name: t.id, description: t.label },
        readOnly: !write,
        needsApproval: write,
        byo: true,
        call: async (args) => {
          const t0 = Date.now();
          try {
            if (!write) {
              const text = await t.exec(await ghlReady(), {});
              emit("log", { text: `Your apps: "${t.id}" on HighLevel ran.` });
              return toolResult(text, t0);
            }
            const clean = cleanArgs(t.fields, args);
            return await approvedCall("highlevel", "HighLevel", t.id, t.label, clean, async () => t.exec(await ghlReady(), clean));
          } catch (e) {
            return toolResult(`Tool error: ${e.message}`, t0, { isError: true });
          }
        },
      });
    }
  }
  for (const h of hooksDoc().list) {
    const write = h.effect !== "read";
    out.push({
      name: `webhook_${h.id.replace(/[^a-z0-9]+/gi, "_")}`.slice(0, 60),
      description: `${write ? "Custom webhook" : "Custom read webhook"} "${h.name}". ${write ? "This waits for approval before it is sent." : "This runs when the model calls it."}`.slice(0, 1024),
      parameters: { type: "object", properties: Object.fromEntries((h.fields || []).map((f) => [f.key, { type: "string", description: f.label }])) },
      server: { id: `byo-hook-${h.id}`, name: h.name },
      tool: { name: "send", description: h.name },
      readOnly: !write,
      needsApproval: write,
      byo: true,
      call: async (args) => {
        const t0 = Date.now();
        try {
          const clean = cleanArgs(h.fields, args);
          if (!write) {
            const text = await callHook(h, clean);
            emit("log", { text: `Your apps: webhook "${h.name}" ran.` });
            return toolResult(text, t0);
          }
          return await approvedCall(`byo-hook-${h.id}`, h.name, "send", h.name, clean, () => callHook(h, clean));
        } catch (e) {
          return toolResult(`Tool error: ${e.message}`, t0, { isError: true });
        }
      },
    });
  }
  return out;
}

export function registerByoTools() {
  registerExtraTools(toolEntries);
}
