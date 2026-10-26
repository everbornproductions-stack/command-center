// Desktop control: list installed programs, let the person allow each one,
// score the allowed ones the same way a user-added tool is scored, and
// suggest a program while a mission or client job is being planned.
// Nothing is installed or bought here.

import { capsFor, inferCapabilities } from "./added-caps.js";
import { bundledCatalog, hydrateCatalog, matchOne, mergeCatalog, normName, pullCatalog, storedCatalog } from "./app-catalog.js";
import { scanInstalled, liveIo } from "./app-scan.js";
import { addRouteSource } from "./route-extras.js";
import { doc, putDoc, ctx } from "./store.js";
import { heuristicClassify } from "./router.js";
import { guard, isProFeature } from "./license.js";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setSecret, getSecret } from "./vault.js";
import { emit } from "./events.js";
import { localFetch } from "./loopback-fetch.js";
import { riskyAction } from "./action-policy.js";
import { assertRoom, gateTier, gateView } from "./feature-gate.js";
import {
  addServer, removeServer, findServer, serverView, connectServer, setToolPrefs, setServerOptions,
  listServers, markServer, onBeforeRemoteAdd, registerExtraTools, requestApproval, workspaceKey,
} from "./mcp.js";
import { ROOT } from "./paths.js";

const DOC = "apps.discovery";

function empty() {
  return { optedIn: false, suggestions: true, scannedAt: null, allows: {}, dismissed: [], apps: [], catalogExtra: [] };
}

export function loadState() {
  const saved = doc(DOC, empty);
  const base = empty();
  return {
    ...base,
    ...saved,
    allows: { ...base.allows, ...(saved?.allows || {}) },
    dismissed: Array.isArray(saved?.dismissed) ? saved.dismissed : [],
    apps: Array.isArray(saved?.apps) ? saved.apps : [],
    catalogExtra: Array.isArray(saved?.catalogExtra) ? saved.catalogExtra : [],
  };
}

function saveState(next) {
  putDoc(DOC, next);
  return next;
}

export function activeCatalog(state = loadState()) {
  return mergeCatalog(bundledCatalog(), hydrateCatalog(state.catalogExtra || []));
}

function slug(name, catalogId) {
  if (catalogId) return catalogId;
  const s = normName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return s || "app";
}

export function describeFound(found, catalog) {
  const rows = [];
  const seen = new Set();
  for (const item of found || []) {
    const hit = matchOne(item.name, catalog) || (item.file ? matchOne(item.file, catalog) : null);
    if (item.source === "path" && !hit) continue;
    const id = slug(hit?.title || item.name, hit?.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const inferred = hit ? [] : inferCapabilities({ name: item.name });
    const capabilities = hit ? hit.capabilities : inferred;
    rows.push({
      id,
      title: hit?.title || item.name,
      source: item.source,
      publisher: item.publisher || "",
      catalogId: hit?.id || null,
      capabilities,
      capabilitiesSource: hit ? "catalog" : inferred.length ? "name" : "none",
      price: hit?.price || null,
      url: hit?.url || null,
      reason: hit?.reason || "",
    });
    if (rows.length >= 250) break;
  }
  return rows;
}

export async function optIn(on, io = liveIo()) {
  const cur = loadState();
  if (!on) return saveState({ ...cur, optedIn: false });
  guard("appScan");
  const found = await scanInstalled(io);
  const apps = describeFound(found, activeCatalog(cur));
  return saveState({ ...cur, optedIn: true, scannedAt: Date.now(), apps });
}

export async function rescan(io = liveIo()) {
  guard("appScan");
  const cur = loadState();
  if (!cur.optedIn) {
    const err = new Error("Turn on desktop control before scanning.");
    err.status = 400;
    throw err;
  }
  const apps = describeFound(await scanInstalled(io), activeCatalog(cur));
  return saveState({ ...cur, scannedAt: Date.now(), apps });
}

export function setAllowed(id, allowed) {
  if (allowed) guard("appScan");
  const cur = loadState();
  if (!cur.optedIn) {
    const err = new Error("Turn on desktop control before allowing an app.");
    err.status = 400;
    throw err;
  }
  const app = cur.apps.find((row) => row.id === id);
  if (!app) {
    const err = new Error("That program is not in the list.");
    err.status = 404;
    throw err;
  }
  const allows = { ...cur.allows, [id]: !!allowed };
  return saveState({ ...cur, allows });
}

// Never-list for Select All (0.4.20). Programs that hold passwords, money, mail, remote control,
// system settings or private messages are never switched on by one click. A person can still
// allow one of them on purpose, one at a time.
const NEVER = [
  [/password|1password|bitwarden|keepass|lastpass|dashlane|keeper|authy|authenticator|vault|nordpass|roboform/i, "It holds passwords or sign-in codes."],
  [/bank|chase|wells fargo|schwab|fidelity|vanguard|paypal|venmo|cash app|zelle|coinbase|crypto|wallet|binance|metamask|quickbooks|quicken|turbotax|payroll|stripe|square|brokerage|robinhood/i, "It handles money."],
  [/outlook|thunderbird|mailbird|apple mail|windows mail|gmail|\bmail\b|eudora|postbox/i, "It holds your email."],
  [/whatsapp|signal|telegram|messenger|imessage|discord|slack|teams|skype|zoom|messages/i, "It holds private messages."],
  [/powershell|cmd\.exe|command prompt|terminal|regedit|registry|task scheduler|group policy|services\.msc|device manager|bios|disk management|windows security|defender|bitlocker/i, "It changes the system."],
  [/anydesk|teamviewer|remote desktop|rdp|vnc|logmein|splashtop|chrome remote|rustdesk/i, "It gives remote control of this computer."],
  [/vpn|proxy|tor browser|wireguard|openvpn/i, "It controls your network connection."],
];
export function sensitiveWhy(app) {
  const hay = `${app?.id || ""} ${app?.title || ""} ${app?.publisher || ""}`;
  for (const [re, why] of NEVER) if (re.test(hay)) return why;
  return "";
}

export function setAllAllowed(allowed, opts = {}) {
  if (allowed) guard("appScan");
  const cur = loadState();
  if (!cur.optedIn) {
    const err = new Error("Turn on desktop control before allowing an app.");
    err.status = 400;
    throw err;
  }
  const filterIds = Array.isArray(opts?.ids) && opts.ids.length ? new Set(opts.ids.map(String)) : null;
  const allows = { ...cur.allows };
  for (const app of cur.apps || []) {
    if (filterIds && !filterIds.has(app.id)) continue;
    if (allowed && sensitiveWhy(app)) continue;
    allows[app.id] = !!allowed;
  }
  // Persist bulk allow map.
  return saveState({ ...cur, allows });
}

export function dismissSuggestion(id) {
  const key = String(id || "").trim();
  if (!/^[a-z0-9-]{2,40}$/.test(key)) {
    const err = new Error("That suggestion is not in the list.");
    err.status = 400;
    throw err;
  }
  const cur = loadState();
  const dismissed = cur.dismissed.includes(key) ? cur.dismissed : [...cur.dismissed, key].slice(-80);
  return saveState({ ...cur, dismissed });
}

export function setSuggestions(on) {
  if (on) guard("appScan");
  const cur = loadState();
  return saveState({ ...cur, suggestions: !!on });
}

export async function updateCatalog(url, fetchImpl, io = liveIo()) {
  guard("appScan");
  const extra = storedCatalog(await pullCatalog(url, fetchImpl));
  const cur = loadState();
  const next = saveState({ ...cur, catalogExtra: extra });
  if (next.optedIn) return rescan(io);
  return next;
}

export function suggestFor(prompt, state = loadState()) {
  if (!isProFeature("appScan")) return [];
  if (!state.optedIn || state.suggestions === false) return [];
  const text = String(prompt || "").trim();
  if (text.length < 12) return [];
  const cls = heuristicClassify(text);
  const installed = new Set(state.apps.map((row) => row.catalogId).filter(Boolean));
  const allowed = new Set(Object.entries(state.allows || {}).filter(([, on]) => on).map(([id]) => id));
  const gone = new Set(state.dismissed || []);
  const hits = [];
  for (const app of activeCatalog(state)) {
    if (gone.has(app.id) || allowed.has(app.id)) continue;
    if (!app.capabilities.includes(cls.capability)) continue;
    if (app.keywords && !app.keywords.test(text)) continue;
    if (!app.keywords) continue;
    hits.push({ app, installed: installed.has(app.id) });
  }
  hits.sort((a, b) => Number(b.installed) - Number(a.installed) || a.app.title.localeCompare(b.app.title));
  return hits.slice(0, 2).map(({ app, installed: onPc }) => ({
    id: app.id,
    title: app.title,
    reason: app.reason,
    price: app.price === "paid" ? "Paid" : "Free",
    url: app.url,
    installed: onPc,
  }));
}

export function routeRows(state = loadState()) {
  if (!isProFeature("appScan")) return [];
  if (!state.optedIn) return [];
  const rows = [];
  for (const app of state.apps) {
    if (!state.allows?.[app.id]) continue;
    if (!app.capabilities?.length) continue;
    const caps = capsFor(app.capabilities);
    rows.push({
      provider: `app:${app.id}`,
      providerName: app.title,
      color: "#64748b",
      model: `app:${app.id}`,
      name: app.title,
      kind: "app",
      tier: "tool",
      in: 0,
      out: 0,
      caps,
      baseCaps: caps,
      available: true,
      keyed: true,
      status: "green",
      statusDetail: "Allowed on this PC",
      balance: null,
      discount: null,
      web: false,
      app: true,
      priceLabel: app.price,
      url: app.url,
    });
  }
  return rows;
}

export function publicState(state = loadState()) {
  return {
    pro: isProFeature("appScan"),
    optedIn: !!state.optedIn,
    suggestions: state.suggestions !== false,
    scannedAt: state.scannedAt || null,
    apps: (state.apps || []).map((app) => ({
      id: app.id,
      title: app.title,
      source: app.source,
      publisher: app.publisher || "",
      capabilities: app.capabilities || [],
      capabilitiesSource: app.capabilitiesSource || "none",
      price: app.price,
      url: app.url,
      reason: app.reason || "",
      allowed: !!state.allows?.[app.id],
      sensitive: !!sensitiveWhy(app),
      sensitiveWhy: sensitiveWhy(app),
    })),
    skippedByAll: (state.apps || []).filter((app) => sensitiveWhy(app) && !state.allows?.[app.id]).length,
  };
}

let routed = false;
export function installAppRoutes() {
  if (routed) return;
  routed = true;
  addRouteSource(() => {
    try { return routeRows(); } catch { return []; }
  });
}

export const APPS_DOC = "apps.connections";
export const INBOUND_DOC = "apps.inbound";
export const ZAPIER_MCP_URL = "https://mcp.zapier.com/api/v1/connect";
export const MAKE_OAUTH_URL = "https://mcp.make.com";
export const TEMPLATE_FILE = path.join(ROOT, "docs", "integrations", "meldmind-webhook.json");
export const HOOK_PATH = "/api/hooks/meldmind";
const WEBHOOK_RESULT_MAX = 8000;

export const GUIDE = {
  zapier: "Paste the Zapier MCP address. It is usually https://mcp.zapier.com/api/v1/connect. If a token is in the address, Meldmind stores it in the vault and takes it out of the address. Meldmind then lists the actions you turned on in Zapier. A chat or a mission can use them. Anything that sends, posts, or charges waits until you click Allow.",
  make: "Paste the Make MCP address (https://mcp.make.com for sign-in, or the address Make gave you). Or paste a scenario webhook, the hook.make.com address Make shows you. A scenario runs only after you click Allow, unless you mark that webhook as read only. A send, post, or charge still waits for Allow.",
  mcp: "Paste any MCP server address. Meldmind lists its tools. You pick which ones a chat or a mission may use. Sends, posts, and charges wait for Allow.",
  webhook: "Paste a webhook address, an optional header, and the JSON fields to send. The header value stays in the vault and is never shown again. The call waits for Allow unless you mark it as read only. A send, post, or charge still waits for Allow.",
  inbound: "Create a Meldmind webhook. Zapier or Make calls it to start a chat, a council, or a mission, and the result comes back in the reply. The token is shown once. On this computer the address is local. A cloud Zapier or Make can reach it only if you have made this computer reachable. Meldmind does not open a tunnel and does not send anything out until you click Allow.",
  simple: "Connect Zapier with one click. The usual address is filled in. Paste a token if Zapier gave you one. Actions you turned on show up here. A send, post, or charge waits until you click Allow.",
};

const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const toolSlug = (s, n = 24) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, n) || "tool";
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function connections() {
  const d = doc(APPS_DOC, () => ({ list: [] }));
  d.list ||= [];
  return d;
}
const saveConnections = (d) => putDoc(APPS_DOC, d);
export const listConnections = () => connections().list;
export const findConnection = (id) => connections().list.find((r) => r.id === id) || null;

export function connectionCount() {
  const rows = listConnections();
  const linked = new Set(rows.map((r) => r.mcpServerId).filter(Boolean));
  let n = rows.length;
  for (const s of listServers()) {
    if (s.demo || s.transport === "stdio") continue;
    if (linked.has(s.id) || s.appId) continue;
    n += 1;
  }
  return n;
}

export function assertCanAdd() {
  return assertRoom(connectionCount(), gateTier());
}
onBeforeRemoteAdd(() => assertCanAdd());

function bearerValue(token) {
  const t = String(token || "").trim();
  if (!t) return "";
  if (/[\r\n]/.test(t) || t.length > 500) throw err(400, "That token is not valid.");
  if (/^bearer\s+/i.test(t)) return t.replace(/^bearer\s+/i, "Bearer ");
  return `Bearer ${t}`;
}

// Pull a token out of a pasted address so it is stored in the vault, not in the URL we keep.
export function takeTokenFromUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return { url: "", token: "" };
  if (!/^https?:\/\/[^\s]+$/i.test(text)) throw err(400, "Paste an address that starts with http:// or https://");
  let u;
  try { u = new URL(text); } catch { throw err(400, "That address is not valid."); }
  if (u.username || u.password) throw err(400, "Put the token in the token box, not inside the address login.");
  let token = "";
  if (u.searchParams.has("token")) {
    token = u.searchParams.get("token") || "";
    u.searchParams.delete("token");
  }
  const make = u.pathname.match(/\/mcp\/u\/([^/]+)\/?$/);
  if (make) {
    token = token || decodeURIComponent(make[1]);
    u.pathname = "/mcp/stateless";
  }
  u.hash = "";
  return { url: u.toString(), token };
}

export function looksLikeMakeHook(url) {
  try {
    const host = new URL(url).hostname;
    return /(^|\.)hook\./i.test(host) && /make\.com$/i.test(host);
  } catch { return false; }
}

export function normalizeSchema(input) {
  if (input == null || input === "") return { type: "object", properties: {} };
  let obj = input;
  if (typeof input === "string") {
    try { obj = JSON.parse(input); } catch { throw err(400, "The input schema must be JSON."); }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw err(400, "The input schema must be a JSON object.");
  const text = JSON.stringify(obj);
  if (text.length > 8000) throw err(400, "The input schema is too long.");
  if (obj.type && obj.type !== "object") throw err(400, "The input schema type must be object.");
  const out = { type: "object", properties: obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties) ? obj.properties : {} };
  if (Array.isArray(obj.required)) out.required = obj.required.map((x) => String(x)).slice(0, 40);
  return out;
}

function cleanName(name, fallback) {
  const n = String(name || fallback || "").trim().slice(0, 60);
  if (!n) throw err(400, "Give this connection a name.");
  return n;
}

async function classifyAndEnable(serverId) {
  const s = findServer(serverId);
  if (!s) return;
  setServerOptions(serverId, { autoReadOnly: true });
  const tools = (findServer(serverId)?.lastTools) || [];
  for (const t of tools) {
    const readOnly = !riskyAction(t);
    setToolPrefs(serverId, { tool: t.name, enabled: true, readOnly });
  }
}

function publicActions(serverId) {
  const s = findServer(serverId);
  if (!s) return [];
  try {
    return serverView(s).tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      readOnly: !!t.readOnly,
      needsApproval: !!t.needsApproval,
      enabled: !!t.enabled,
    }));
  } catch { return []; }
}

export function connectionView(row) {
  const base = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    url: row.url || null,
    createdAt: row.createdAt || null,
    mcpServerId: row.mcpServerId || null,
    readOnly: !!row.readOnly,
    method: row.method || null,
    headerName: row.headerName || null,
    hasHeader: !!row.hasHeader,
    actions: row.mcpServerId ? publicActions(row.mcpServerId) : [],
    lastError: row.mcpServerId ? (findServer(row.mcpServerId)?.lastError || null) : null,
  };
  return base;
}

export function appsView() {
  const rows = listConnections();
  const inbound = readInbound();
  return {
    guide: GUIDE,
    presets: { zapier: ZAPIER_MCP_URL, make: MAKE_OAUTH_URL },
    gate: gateView(connectionCount()),
    connections: rows.map(connectionView),
    inbound: {
      enabled: !!inbound?.enabled,
      hasToken: !!inbound?.hash,
      path: HOOK_PATH,
      pollPath: `${HOOK_PATH}/runs/`,
    },
    workspace: workspaceKey(),
  };
}

export function readTemplate() {
  const raw = fs.readFileSync(TEMPLATE_FILE, "utf8");
  return JSON.parse(raw);
}

async function addMcpConnection({ kind, name, url, token, headerName }) {
  const pulled = takeTokenFromUrl(url);
  const explicit = String(token || "").trim();
  const secret = explicit || pulled.token;
  const header = secret ? { [String(headerName || "Authorization").trim() || "Authorization"]: bearerValue(secret) } : undefined;
  if (header) {
    const key = Object.keys(header)[0];
    if (!/^[A-Za-z0-9-]{1,40}$/.test(key)) throw err(400, "The header name may use letters, numbers, and dashes.");
  }
  const rowId = "app-" + crypto.randomBytes(4).toString("hex");
  const server = await addServer({
    name,
    transport: "http",
    url: pulled.url,
    headers: header,
    autoReadOnly: true,
  });
  const d = connections();
  const row = {
    id: rowId, kind, name, url: pulled.url, mcpServerId: server.id, createdAt: Date.now(),
    hasHeader: !!header, headerName: header ? Object.keys(header)[0] : null,
  };
  d.list.push(row);
  saveConnections(d);
  markServer(server.id, { appId: rowId, appKind: kind });
  let error = null;
  try {
    await connectServer(server.id, { refresh: true });
    await classifyAndEnable(server.id);
  } catch (e) { error = e.message; }
  emit("log", { text: error ? `${name} saved, but it could not be reached: ${error}` : `${name} connected. Its actions are listed. A send, post, or charge waits for Allow.` });
  return { row: findConnection(rowId), error };
}

export async function connectZapier({ url, token, name } = {}) {
  const raw = String(url || "").trim() || ZAPIER_MCP_URL;
  return addMcpConnection({ kind: "zapier", name: cleanName(name, "Zapier"), url: raw, token, headerName: "Authorization" });
}

export async function connectMake({ url, token, name, mode, schema, readOnly, headerName, headerValue } = {}) {
  const raw = String(url || "").trim();
  const asHook = mode === "webhook" || (raw && looksLikeMakeHook(raw));
  if (asHook) {
    if (!raw) throw err(400, "Paste the scenario webhook address.");
    return addWebhook({ name: cleanName(name, "Make scenario"), url: raw, token, headerName: headerName || (token ? "x-make-apikey" : ""), headerValue: headerValue || token, schema, readOnly: !!readOnly, kind: "make" });
  }
  const address = raw || MAKE_OAUTH_URL;
  return addMcpConnection({ kind: "make", name: cleanName(name, "Make"), url: address, token, headerName: "Authorization" });
}

export async function connectMcp({ url, token, name, headerName } = {}) {
  if (!String(url || "").trim()) throw err(400, "Paste the MCP server address.");
  return addMcpConnection({ kind: "mcp", name: cleanName(name, "MCP server"), url: String(url).trim(), token, headerName: headerName || "Authorization" });
}

export async function addWebhook({ name, url, method, headerName, headerValue, token, schema, readOnly, kind = "webhook" } = {}) {
  assertCanAdd();
  const pulled = takeTokenFromUrl(url);
  const title = cleanName(name, kind === "make" ? "Make scenario" : "Webhook");
  const verb = String(method || "POST").toUpperCase();
  if (verb !== "POST" && verb !== "GET") throw err(400, "The webhook method must be GET or POST.");
  const fields = normalizeSchema(schema);
  const id = "app-" + crypto.randomBytes(4).toString("hex");
  const hName = String(headerName || (token || pulled.token ? "Authorization" : "")).trim();
  const hValue = String(headerValue || token || pulled.token || "").trim();
  if (hValue && !hName) throw err(400, "Name the header that carries the secret.");
  if (hName && !/^[A-Za-z0-9-]{1,40}$/.test(hName)) throw err(400, "The header name may use letters, numbers, and dashes.");
  if (hValue) {
    if (/[\r\n]/.test(hValue) || hValue.length > 500) throw err(400, "That header value is not valid.");
    await setSecret(`app-${id}`, { key: "app", header: hName, value: hName.toLowerCase() === "authorization" ? bearerValue(hValue) : hValue });
  }
  const d = connections();
  d.list.push({
    id, kind, name: title, url: pulled.url, method: verb, createdAt: Date.now(),
    readOnly: !!readOnly && !riskyAction({ name: title }),
    hasHeader: !!hValue, headerName: hName || null, schema: fields,
  });
  saveConnections(d);
  emit("log", { text: `${title} saved. A chat or a mission can call it. ${d.list.at(-1).readOnly ? "It is marked read only." : "It waits for Allow before it runs."}` });
  return { row: findConnection(id), error: null };
}

export async function removeConnection(id) {
  const d = connections();
  const i = d.list.findIndex((r) => r.id === id);
  if (i < 0) throw err(404, "Connection not found.");
  const row = d.list[i];
  d.list.splice(i, 1);
  saveConnections(d);
  if (row.mcpServerId) { try { await removeServer(row.mcpServerId); } catch { /* already gone */ } }
  try { await setSecret(`app-${id}`, null); } catch { /* vault */ }
  emit("log", { text: `${row.name} removed. Its token was deleted from the vault.` });
  return appsView();
}

export async function refreshConnection(id) {
  const row = findConnection(id);
  if (!row) throw err(404, "Connection not found.");
  if (!row.mcpServerId) return { row, error: null };
  let error = null;
  try {
    await connectServer(row.mcpServerId, { refresh: true });
    await classifyAndEnable(row.mcpServerId);
  } catch (e) { error = e.message; }
  return { row: findConnection(id), error };
}

// ---------- webhook tools the router and missions can call ----------
function webhookNeedsApproval(row) {
  return riskyAction({ name: row.name, description: row.name }) || !row.readOnly;
}

async function executeWebhook(row, args, { missionId = null, taskId = null, provider = null, model = null, manual = false } = {}) {
  const t0 = Date.now();
  const toolName = row.name;
  if (!manual && webhookNeedsApproval(row)) {
    emit("log", { text: `Waiting for your OK before "${toolName}" runs. Nothing is sent until you click Allow.`, missionId });
    const ok = await requestApproval({
      serverId: row.id, serverName: row.name, tool: toolName, args: args || {}, provider, model,
      readOnly: false, description: `Webhook ${row.method || "POST"} ${row.url}`,
    });
    if (!ok) {
      return { text: `The person declined to run "${toolName}". Continue without it and say so.`, isError: true, denied: true, ms: Date.now() - t0 };
    }
  }
  const sec = getSecret(`app-${row.id}`);
  const headers = { accept: "application/json", connection: "close" };
  if (sec?.header && sec?.value) headers[sec.header] = sec.value;
  const method = row.method || "POST";
  let target = row.url;
  const bodyArgs = args && typeof args === "object" ? args : {};
  let body;
  if (method === "GET") {
    const u = new URL(row.url);
    for (const [k, v] of Object.entries(bodyArgs)) u.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
    target = u.toString();
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify(bodyArgs);
  }
  try {
    const res = await localFetch(target, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (res.status >= 300 && res.status < 400) {
      return { text: "The webhook redirected. Paste the final address instead. Nothing was followed.", isError: true, denied: false, ms: Date.now() - t0 };
    }
    const textRaw = await res.text().catch(() => "");
    let text = textRaw.slice(0, WEBHOOK_RESULT_MAX) || `(empty reply, HTTP ${res.status})`;
    if (!res.ok) text = `Webhook answered HTTP ${res.status}. ${text}`;
    emit("log", { text: `"${toolName}" ${res.ok ? "ran" : "returned an error"} in ${((Date.now() - t0) / 1000).toFixed(1)} s.`, missionId });
    emit("mcp.call", { serverId: row.id, serverName: row.name, tool: toolName, missionId, taskId, ok: res.ok, denied: false, ms: Date.now() - t0 });
    return { text, isError: !res.ok, denied: false, ms: Date.now() - t0 };
  } catch (e) {
    emit("log", { text: `"${toolName}" failed: ${e.message}`, level: "error", missionId });
    return { text: `Webhook error: ${e.message}`, isError: true, denied: false, ms: Date.now() - t0 };
  }
}

function webhookEntries() {
  const out = [];
  const seen = new Set();
  for (const row of listConnections()) {
    if (row.mcpServerId) continue;
    if (!row.url) continue;
    let name = `hook__${toolSlug(row.name, 40)}`;
    const base = name;
    let k = 2;
    while (seen.has(name)) name = `${base}_${k++}`;
    seen.add(name);
    const schema = row.schema && typeof row.schema === "object" ? row.schema : { type: "object", properties: {} };
    const entryRow = row;
    out.push({
      name,
      description: `${row.name} (${row.method || "POST"} webhook). ${webhookNeedsApproval(row) ? "Needs approval before it runs." : "Read only."}`.slice(0, 1024),
      parameters: schema,
      server: { id: row.id, name: row.name },
      tool: { name: row.name, description: row.name },
      readOnly: !!row.readOnly && !riskyAction({ name: row.name }),
      needsApproval: webhookNeedsApproval(row),
      kind: "webhook",
      run: (args, meta) => executeWebhook(entryRow, args, meta),
    });
  }
  return out;
}
registerExtraTools(() => webhookEntries());

// ---------- inbound token (hash only) ----------
function readInbound() {
  try { return ctx().docs?.[INBOUND_DOC] || null; } catch { return null; }
}
export function inboundPublic() {
  const d = readInbound();
  return { enabled: !!d?.enabled, hasToken: !!d?.hash, path: HOOK_PATH };
}
export function inboundMatches(presented) {
  const d = readInbound();
  if (!d?.enabled || !d.hash || typeof presented !== "string" || !presented || presented.length > 200) return false;
  const a = Buffer.from(sha(presented), "hex");
  const b = Buffer.from(d.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function createInboundToken() {
  const token = crypto.randomBytes(24).toString("base64url");
  putDoc(INBOUND_DOC, { enabled: true, hash: sha(token), createdAt: Date.now() });
  emit("log", { text: "Meldmind webhook created. The token is shown once and is not stored in plain text." });
  return { token, path: HOOK_PATH, template: readTemplate() };
}
export function clearInboundToken() {
  putDoc(INBOUND_DOC, { enabled: false, hash: null, createdAt: null });
  emit("log", { text: "Meldmind webhook token removed." });
  return inboundPublic();
}

export async function callWebhookNow(id, args) {
  const row = findConnection(id);
  if (!row || row.mcpServerId) throw err(404, "Webhook not found.");
  return executeWebhook(row, args || {}, { manual: true });
}