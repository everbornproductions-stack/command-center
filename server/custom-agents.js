// Custom agents and the prompt library (Phase 19). Not to be confused with server/agents.js, which holds the
// outside agents (Grok Bot, the browser helper).
//
//  - An agent is a name, a model (or "auto": the router picks per job), instructions, which MCP tools it may
//    use (Phase 16: off, every tool switched on, or a chosen few; the person's own on/off switches and the
//    approval prompts still apply), knowledge libraries (Phase 18, kept in the libraries' "agent" attachments)
//    and starter prompts. Running one is a single chat with the agent's instructions as the system prompt;
//    the call goes through smart fallback, the ledger and the spend caps like every other chat.
//  - A saved prompt is text with {{variables}}. Every variable is required: the form asks for each one and
//    the server refuses to fill a prompt with a value missing. Substitution is one pass (a value that itself
//    holds {{x}} stays as typed).
//  - Export / import: one JSON file with agents and prompts. Never any key or secret (an agent has none).
//    Imported items always get new ids; a model, library or tool this copy does not have is dropped with a note.
//  - Sharing to a workspace (Phase 8 roles): a snapshot of the item. Owner, admin and member may share, use
//    (run it, copy it into their own list) and update or remove what they shared; owner and admin may manage
//    anything shared there; a viewer can only look. Local mode keeps the snapshots in a document (the owner's
//    side, as with shared projects); hosted mode in the workspace_agents table (supabase/agents.sql, RLS).
//  - Marketplace (Phase 10): an item can be prepared as a listing draft. Nothing is published: the Marketplace
//    is not built yet. Drafts carry no price (Phase 10 decides, behind its flag).
import crypto from "node:crypto";
import { HOSTED, ctx, doc, putDoc } from "./store.js";
import { rest } from "./hosted.js";
import { PROVIDERS } from "./registry.js";
import { liveModels } from "./health.js";
import { licenseState } from "./license.js";
import { listServers } from "./mcp.js";
import * as L from "./libraries.js";
import { emit } from "./events.js";
import { usernameOf } from "./account-name.js";

export const AGENTS_DOC = "agents.custom";
export const PROMPTS_DOC = "agents.prompts";
export const SHARED_DOC = "agents.shared";    // local mode: { [workspaceId]: [ shared row ] }
export const LISTINGS_DOC = "agents.listings";
export const FORMAT = "command-ai/agents";
export const FORMAT_VERSION = 1;
export const LIMITS = { name: 60, description: 300, instructions: 20000, starters: 8, starter: 300, text: 20000, value: 20000, libraries: 20, tools: 100, items: 200, variables: 30 };
export const TOOL_MODES = ["off", "all", "some"];
export const KINDS = ["agent", "prompt"];
export const LISTING_CATEGORIES = ["Social Posts", "Music Videos", "Client Work", "Sales", "Ops", "Writing", "Research", "Other"];

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
const newId = (p) => `${p}-${crypto.randomBytes(5).toString("hex")}`;
const me = () => { try { return String(ctx().email || "").toLowerCase() || "you"; } catch { return "you"; } };

// ---------- {{variables}} ----------
const VAR_RE = /\{\{\s*([A-Za-z][\w .-]{0,39}?)\s*\}\}/g;
// names in order of first appearance, each once
export function variablesOf(text) {
  const out = [];
  for (const m of String(text || "").matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
// every variable is required; returns the filled text or throws 400 with the missing names
export function fillPrompt(text, values = {}) {
  const vars = variablesOf(text);
  const v = values && typeof values === "object" ? values : {};
  const missing = vars.filter((n) => String(v[n] ?? "").trim() === "");
  if (missing.length) throw err(400, `Fill in ${missing.map((n) => `{{${n}}}`).join(", ")} first.`, { code: "missing", missing });
  const long = vars.find((n) => String(v[n]).length > LIMITS.value);
  if (long) throw err(400, `{{${long}}} is too long (${LIMITS.value} characters at most).`);
  return String(text).replace(VAR_RE, (_, n) => String(v[n]));
}

// ---------- documents ----------
const agentsDoc = () => { const d = doc(AGENTS_DOC, () => ({ list: [] })); d.list ||= []; return d; };
const promptsDoc = () => { const d = doc(PROMPTS_DOC, () => ({ list: [] })); d.list ||= []; return d; };
export const listAgents = () => agentsDoc().list.map(agentView);
export const listPrompts = () => promptsDoc().list.map(promptView);
export const getAgent = (id) => agentsDoc().list.find((a) => a.id === id) || null;
export const getPrompt = (id) => promptsDoc().list.find((p) => p.id === id) || null;

function modelInfo(provider, model) {
  const p = PROVIDERS[provider];
  const m = p?.models?.find((x) => x.id === model);
  return { providerName: p?.name || provider, modelName: m?.name || model };
}
export function agentView(a) {
  const libs = L.available() ? a.libraries.map((id) => L.getLibrary(id)).filter(Boolean).map((l) => ({ id: l.id, name: l.name })) : [];
  return { ...a, ...(a.provider ? modelInfo(a.provider, a.model) : { providerName: null, modelName: "Auto (best for each job)" }), libraryNames: libs, available: !a.provider || !!PROVIDERS[a.provider] };
}
export const promptView = (p) => ({ ...p, variables: variablesOf(p.text), agentName: p.agentId ? getAgent(p.agentId)?.name || null : null });

// ---------- validation ----------
// a model must be one this copy knows (listed, or discovered from the provider); "auto" is null / null
function checkModel(provider, model, { lenient = false, notes } = {}) {
  provider = str(provider, 80) || null; model = str(model, 120) || null;
  if (!provider || provider === "auto") return { provider: null, model: null };
  const p = PROVIDERS[provider];
  const known = p && p.kind === "text" && model && ((p.models || []).some((m) => m.id === model) || (liveModels[provider] || []).includes(model) || p.custom);
  if (known) return { provider, model };
  if (lenient) { notes?.push(`"${model || provider}" is not set up here, so the router picks the model.`); return { provider: null, model: null }; }
  throw err(400, p ? `${p.name} has no model "${model}".` : `Unknown AI "${provider}". Add its key in Settings first, or pick Auto.`);
}
const toolKey = (serverId, tool) => `${serverId}/${tool}`;
function checkTools(t, { lenient = false, notes } = {}) {
  const mode = TOOL_MODES.includes(t?.mode) ? t.mode : "off";
  let allow = Array.isArray(t?.allow) ? [...new Set(t.allow.map((x) => str(x, 200)).filter((x) => /^[\w.-]{1,80}\/.{1,118}$/.test(x)))].slice(0, LIMITS.tools) : [];
  if (mode !== "some") return { mode, allow: [] };
  const servers = new Set(listServers().map((s) => s.id));
  const unknown = allow.filter((k) => !servers.has(k.split("/")[0]));
  if (unknown.length) {
    if (!lenient) throw err(400, `Unknown tool server: ${unknown[0].split("/")[0]}. Add it in Settings > Tools first.`);
    notes?.push(`${unknown.length} tool${unknown.length === 1 ? "" : "s"} from a tool server this copy does not have ${unknown.length === 1 ? "was" : "were"} left out.`);
    allow = allow.filter((k) => !unknown.includes(k));
  }
  return { mode: allow.length ? "some" : "off", allow };
}
function checkLibraries(ids, { lenient = false, notes } = {}) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const want = [...new Set(ids.map((x) => str(typeof x === "object" ? x?.id : x, 80)).filter(Boolean))].slice(0, LIMITS.libraries);
  if (!L.available()) { if (lenient && want.length) notes?.push("Knowledge libraries live in the desktop app; the library links were left out."); else if (want.length) throw err(400, "Knowledge libraries live in the desktop app for now."); return []; }
  const ok = want.filter((id) => L.getLibrary(id));
  if (ok.length < want.length) {
    if (!lenient) throw err(400, "One of the picked libraries does not exist any more.");
    notes?.push(`${want.length - ok.length} knowledge librar${want.length - ok.length === 1 ? "y is" : "ies are"} not on this computer and ${want.length - ok.length === 1 ? "was" : "were"} left out.`);
  }
  return ok;
}
export function cleanAgent(input = {}, opts = {}) {
  const name = str(input.name, LIMITS.name);
  if (!name) throw err(400, "Give the agent a name.");
  const instructions = str(input.instructions, LIMITS.instructions + 1);
  if (!instructions) throw err(400, "Write the agent's instructions (what it is for and how it should answer).");
  if (instructions.length > LIMITS.instructions) throw err(400, `Instructions are too long (${LIMITS.instructions} characters at most).`);
  const starters = (Array.isArray(input.starters) ? input.starters : []).map((s) => str(s, LIMITS.starter)).filter(Boolean).slice(0, LIMITS.starters);
  return { name, description: str(input.description, LIMITS.description), ...checkModel(input.provider, input.model, opts), instructions, tools: checkTools(input.tools, opts), libraries: checkLibraries(input.libraries, opts), starters };
}
export function cleanPrompt(input = {}, { lenient = false, notes } = {}) {
  const name = str(input.name, LIMITS.name);
  if (!name) throw err(400, "Give the prompt a name.");
  const text = str(input.text, LIMITS.text + 1);
  if (!text) throw err(400, "Write the prompt text. Put {{name}} where a value goes.");
  if (text.length > LIMITS.text) throw err(400, `The prompt is too long (${LIMITS.text} characters at most).`);
  if (variablesOf(text).length > LIMITS.variables) throw err(400, `${LIMITS.variables} variables at most.`);
  let agentId = str(input.agentId, 40) || null;
  if (agentId && !getAgent(agentId)) { if (!lenient) throw err(400, "That agent does not exist any more."); notes?.push(`Prompt "${name}": its agent was not found, so it runs on its own.`); agentId = null; }
  return { name, description: str(input.description, LIMITS.description), text, agentId };
}

// ---------- library attachments mirror agent.libraries (so the Libraries tab shows "via agent") ----------
function syncLibraries(agentId, ids) {
  if (!L.available()) return;
  const now = new Set(L.attachments().agent?.[agentId] || []);
  const want = new Set(ids);
  for (const id of now) if (!want.has(id)) { try { L.setAttached({ libraryId: id, scope: "agent", target: agentId, on: false }); } catch {} }
  for (const id of want) if (!now.has(id)) { try { L.setAttached({ libraryId: id, scope: "agent", target: agentId, on: true }); } catch {} }
}
// libraries deleted since the agent was saved disappear from it
function liveLibraries(a) { return L.available() ? a.libraries.filter((id) => L.getLibrary(id)) : []; }

// ---------- agents CRUD ----------
export function createAgent(input, opts = {}) {
  const d = agentsDoc();
  if (d.list.length >= LIMITS.items) throw err(400, `${LIMITS.items} agents at most.`);
  const a = { id: newId("ag"), ...cleanAgent(input, opts), createdAt: Date.now(), updatedAt: Date.now(), version: 1 };
  d.list.push(a); putDoc(AGENTS_DOC, d);
  syncLibraries(a.id, a.libraries);
  emit("agents.update", { action: "created", id: a.id });
  return agentView(a);
}
export function updateAgent(id, input) {
  const d = agentsDoc(); const a = d.list.find((x) => x.id === id);
  if (!a) throw err(404, "No such agent.");
  Object.assign(a, cleanAgent({ ...a, ...input }), { updatedAt: Date.now(), version: (a.version || 1) + 1 });
  putDoc(AGENTS_DOC, d);
  syncLibraries(a.id, a.libraries);
  emit("agents.update", { action: "updated", id });
  return agentView(a);
}
export function deleteAgent(id) {
  const d = agentsDoc(); const a = d.list.find((x) => x.id === id);
  if (!a) throw err(404, "No such agent.");
  d.list = d.list.filter((x) => x.id !== id); putDoc(AGENTS_DOC, d);
  syncLibraries(id, []);
  // prompts that ran with it now run on their own
  const pd = promptsDoc(); let n = 0;
  for (const p of pd.list) if (p.agentId === id) { p.agentId = null; n++; }
  if (n) putDoc(PROMPTS_DOC, pd);
  emit("agents.update", { action: "deleted", id });
  return { ok: true };
}

// ---------- prompts CRUD ----------
export function createPrompt(input, opts = {}) {
  const d = promptsDoc();
  if (d.list.length >= LIMITS.items) throw err(400, `${LIMITS.items} prompts at most.`);
  const p = { id: newId("pr"), ...cleanPrompt(input, opts), createdAt: Date.now(), updatedAt: Date.now() };
  d.list.push(p); putDoc(PROMPTS_DOC, d);
  emit("agents.update", { action: "prompt", id: p.id });
  return promptView(p);
}
export function updatePrompt(id, input) {
  const d = promptsDoc(); const p = d.list.find((x) => x.id === id);
  if (!p) throw err(404, "No such prompt.");
  Object.assign(p, cleanPrompt({ ...p, ...input }), { updatedAt: Date.now() });
  putDoc(PROMPTS_DOC, d);
  return promptView(p);
}
export function deletePrompt(id) {
  const d = promptsDoc();
  if (!d.list.some((x) => x.id === id)) throw err(404, "No such prompt.");
  d.list = d.list.filter((x) => x.id !== id); putDoc(PROMPTS_DOC, d);
  return { ok: true };
}

// ---------- running ----------
// What runChat needs for one agent: the system prompt, the pinned model (or none), tools and libraries.
export function systemFor(a) {
  return `You are the custom agent "${a.name}", set up by the person you are working for. Follow these instructions from them:\n\n${a.instructions}\n\nMarkdown allowed. No filler.`;
}
export function runOptions(a, { prompt, projectId = null, search } = {}) {
  const text = str(prompt, LIMITS.text);
  if (!text) throw err(400, "Type what you want the agent to do, or pick a starter.");
  const pinned = a.provider && PROVIDERS[a.provider] ? { provider: a.provider, model: a.model } : {};
  return {
    prompt: text, projectId, ...pinned, search: typeof search === "boolean" ? search : undefined,
    system: systemFor(a), agent: { id: a.id || null, name: a.name },
    tools: a.tools?.mode === "off" ? false : undefined,
    toolAllow: a.tools?.mode === "some" ? a.tools.allow : undefined,
    // the agent's own libraries plus the chat's and the workspace's (Phase 18 attach rules); a shared snapshot uses its list
    agentId: a.id || undefined, libraries: a.id ? undefined : (liveLibraries(a).length ? liveLibraries(a) : undefined),
  };
}

// ---------- export / import ----------
const portableAgent = (a) => ({
  ref: a.id, name: a.name, description: a.description, provider: a.provider, model: a.model, instructions: a.instructions,
  tools: { mode: a.tools?.mode || "off", allow: a.tools?.allow || [] },
  libraries: (L.available() ? liveLibraries(a) : []).map((id) => ({ id, name: L.getLibrary(id)?.name || id })), starters: a.starters || [],
});
const portablePrompt = (p) => ({ ref: p.id, name: p.name, description: p.description, text: p.text, agentRef: p.agentId || null });
export function exportBundle({ agents, prompts } = {}) {
  const pickA = Array.isArray(agents) ? agentsDoc().list.filter((a) => agents.includes(a.id)) : agentsDoc().list;
  const pickP = Array.isArray(prompts) ? promptsDoc().list.filter((p) => prompts.includes(p.id)) : promptsDoc().list;
  return { format: FORMAT, version: FORMAT_VERSION, app: "Meldmind", exportedAt: new Date().toISOString(), agents: pickA.map(portableAgent), prompts: pickP.map(portablePrompt) };
}
function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  for (let i = 2; i < 100; i++) { const n = `${name.slice(0, LIMITS.name - 5)} (${i})`; if (!taken.has(n)) return n; }
  return `${name.slice(0, 40)} ${crypto.randomBytes(2).toString("hex")}`;
}
export function importBundle(data) {
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { throw err(400, "That file is not JSON."); } }
  if (!data || data.format !== FORMAT) throw err(400, "That is not a Meldmind agents file.");
  if (Number(data.version) > FORMAT_VERSION) throw err(400, "That file comes from a newer Meldmind. Update the app, then import it.");
  const inA = Array.isArray(data.agents) ? data.agents : [], inP = Array.isArray(data.prompts) ? data.prompts : [];
  if (!inA.length && !inP.length) throw err(400, "The file has no agents or prompts.");
  if (agentsDoc().list.length + inA.length > LIMITS.items || promptsDoc().list.length + inP.length > LIMITS.items) throw err(400, `${LIMITS.items} agents and ${LIMITS.items} prompts at most.`);
  const notes = [], refMap = new Map(), agentsOut = [], promptsOut = [];
  // check every item first, so a bad file adds nothing
  const takenA = new Set(agentsDoc().list.map((a) => a.name)), takenP = new Set(promptsDoc().list.map((p) => p.name));
  const readyA = inA.map((x, i) => { try { const c = cleanAgent(x || {}, { lenient: true, notes }); c.name = uniqueName(c.name, takenA); takenA.add(c.name); return { ref: str(x?.ref, 40), c }; } catch (e) { throw err(400, `Agent ${i + 1}: ${e.message}`); } });
  const readyP = inP.map((x, i) => { try { const c = cleanPrompt({ ...(x || {}), agentId: null }, { lenient: true, notes }); c.name = uniqueName(c.name, takenP); takenP.add(c.name); return { agentRef: str(x?.agentRef, 40), c }; } catch (e) { throw err(400, `Prompt ${i + 1}: ${e.message}`); } });
  const d = agentsDoc();
  for (const { ref, c } of readyA) {
    const a = { id: newId("ag"), ...c, createdAt: Date.now(), updatedAt: Date.now(), version: 1, imported: true };
    d.list.push(a); if (ref) refMap.set(ref, a.id); agentsOut.push(a);
  }
  putDoc(AGENTS_DOC, d);
  for (const a of agentsOut) syncLibraries(a.id, a.libraries);
  const pd = promptsDoc();
  for (const { agentRef, c } of readyP) {
    const p = { id: newId("pr"), ...c, agentId: agentRef && refMap.has(agentRef) ? refMap.get(agentRef) : null, createdAt: Date.now(), updatedAt: Date.now(), imported: true };
    if (agentRef && !refMap.has(agentRef)) notes.push(`Prompt "${p.name}": its agent was not in the file, so it runs on its own.`);
    pd.list.push(p); promptsOut.push(p);
  }
  putDoc(PROMPTS_DOC, pd);
  emit("agents.update", { action: "imported" });
  emit("log", { text: `Imported ${agentsOut.length} agent${agentsOut.length === 1 ? "" : "s"} and ${promptsOut.length} prompt${promptsOut.length === 1 ? "" : "s"}.${notes.length ? ` ${notes.length} note${notes.length === 1 ? "" : "s"}: ${notes[0]}` : ""}` });
  return { agents: agentsOut.map(agentView), prompts: promptsOut.map(promptView), notes: [...new Set(notes)] };
}

// ---------- workspace sharing ----------
export const SHARE_PERMISSIONS = {
  "agents.view":   ["owner", "admin", "member", "viewer"],
  "agents.use":    ["owner", "admin", "member"],          // run it, copy it into my own list
  "agents.share":  ["owner", "admin", "member"],          // share mine, update or remove what I shared
  "agents.manage": ["owner", "admin"],                    // update or remove anything shared in the workspace
};
export const canShare = (role, action) => !!SHARE_PERMISSIONS[action]?.includes(role);
const STUDIO = new Set(["studio", "owner"]);
function studioGate() {
  if (!STUDIO.has(licenseState().tier)) throw err(402, "Sharing agents and prompts with a workspace is part of Studio, like the workspaces themselves.", { code: "studio" });
}
const q = (pathq, opts = {}) => rest(pathq, { ...opts, token: ctx().token });
const localWorkspaces = () => doc("workspaces", () => ({ list: [] })).list || [];
const sharedDoc = () => doc(SHARED_DOC, () => ({}));

// my role in a workspace (null: not in it)
export async function roleIn(wsId) {
  wsId = str(wsId, 80);
  if (!wsId) return null;
  if (!HOSTED) return localWorkspaces().some((w) => w.id === wsId) ? "owner" : null;
  try { const r = await q("rpc/ws_role", { method: "POST", body: { ws: wsId } }); return typeof r === "string" ? r : (Array.isArray(r) ? r[0] : r) || null; } catch { return null; }
}
async function need(wsId, action) {
  const role = await roleIn(wsId);
  if (!canShare(role, action)) throw err(role ? 403 : 404, role ? `Your role (${role}) cannot do that here: a viewer can look but not change, run or copy.` : "You are not in this workspace.", { code: "role" });
  return role;
}
const snapshotOf = (kind, item) => (kind === "agent" ? portableAgent(item) : portablePrompt(item));
const rowView = (r, role) => {
  const mine = r.sharedBy === me();
  const data = { ...(r.data || {}) };
  const author = String(data.authorUsername || "").trim();
  delete data.authorUsername;
  return {
    workspaceId: r.workspaceId, workspaceName: r.workspaceName || null, kind: r.kind, itemId: r.itemId, name: data.name || r.itemId, data,
    variables: r.kind === "prompt" ? variablesOf(data.text) : undefined, sharedBy: author || "someone", mine, updatedAt: r.updatedAt, role,
    permissions: { use: canShare(role, "agents.use"), edit: (mine && canShare(role, "agents.share")) || canShare(role, "agents.manage"), remove: (mine && canShare(role, "agents.share")) || canShare(role, "agents.manage") },
  };
};

async function sharedRows(wsId = null) {
  if (!HOSTED) {
    const names = new Map(localWorkspaces().map((w) => [w.id, w.name]));
    const d = sharedDoc();
    return Object.entries(d).filter(([ws]) => names.has(ws) && (!wsId || ws === wsId)).flatMap(([ws, rows]) => rows.map((r) => ({ ...r, workspaceId: ws, workspaceName: names.get(ws) })));
  }
  const rows = await q(`workspace_agents?select=workspace_id,kind,item_id,shared_by_email,data,updated_at${wsId ? `&workspace_id=eq.${encodeURIComponent(wsId)}` : ""}&order=updated_at.desc`);
  const ids = [...new Set((rows || []).map((r) => r.workspace_id))];
  const ws = ids.length ? await q(`workspaces?select=id,name&id=in.(${ids.map(encodeURIComponent).join(",")})`).catch(() => []) : [];
  const names = new Map((ws || []).map((w) => [w.id, w.name]));
  return (rows || []).map((r) => ({ workspaceId: r.workspace_id, workspaceName: names.get(r.workspace_id) || null, kind: r.kind, itemId: r.item_id, sharedBy: String(r.shared_by_email || "").toLowerCase(), data: r.data, updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null }));
}
// every item shared in the workspaces I am in, with what my role lets me do
export async function listShared() {
  const rows = await sharedRows();
  const roles = new Map();
  for (const ws of new Set(rows.map((r) => r.workspaceId))) roles.set(ws, await roleIn(ws));
  return rows.filter((r) => canShare(roles.get(r.workspaceId), "agents.view")).map((r) => rowView(r, roles.get(r.workspaceId)));
}
async function findShared(wsId, kind, itemId) {
  if (!KINDS.includes(kind)) throw err(400, "kind must be agent or prompt");
  const rows = await sharedRows(wsId);
  return rows.find((r) => r.kind === kind && r.itemId === itemId) || null;
}
// share (or update the shared copy of) one of my agents or prompts
export async function share(kind, itemId, wsId) {
  if (!KINDS.includes(kind)) throw err(400, "kind must be agent or prompt");
  const item = kind === "agent" ? getAgent(itemId) : getPrompt(itemId);
  if (!item) throw err(404, kind === "agent" ? "No such agent." : "No such prompt.");
  const role = await need(wsId, "agents.view");
  if (!canShare(role, "agents.share")) throw err(403, `Your role (${role}) cannot share into this workspace.`, { code: "role" });
  studioGate();
  const existing = await findShared(wsId, kind, itemId);
  if (existing && existing.sharedBy !== me() && !canShare(role, "agents.manage")) throw err(403, "Someone else shared this item; only they, an admin or the owner can update it.", { code: "role" });
  const data = snapshotOf(kind, item);
  const author = usernameOf();
  if (author) data.authorUsername = author;
  if (!HOSTED) {
    const d = sharedDoc(); const rows = (d[wsId] ||= []);
    const i = rows.findIndex((r) => r.kind === kind && r.itemId === itemId);
    const row = { kind, itemId, sharedBy: existing?.sharedBy || me(), data, updatedAt: Date.now() };
    if (i >= 0) rows[i] = row; else rows.push(row);
    putDoc(SHARED_DOC, d);
  } else {
    await q("workspace_agents", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { workspace_id: wsId, kind, item_id: itemId, shared_by: existing ? undefined : ctx().userId, shared_by_email: existing?.sharedBy || me(), data, updated_at: new Date().toISOString() } });
  }
  emit("log", { text: `${kind === "agent" ? "Agent" : "Prompt"} "${item.name}" shared with the workspace.` });
  return { ok: true, kind, itemId, workspaceId: wsId };
}
export async function unshare(wsId, kind, itemId) {
  const role = await need(wsId, "agents.view");
  const row = await findShared(wsId, kind, itemId);
  if (!row) throw err(404, "That item is not shared there.");
  const v = rowView(row, role);
  if (!v.permissions.remove) throw err(403, `Your role (${role}) cannot remove this from the workspace.`, { code: "role" });
  if (!HOSTED) { const d = sharedDoc(); d[wsId] = (d[wsId] || []).filter((r) => !(r.kind === kind && r.itemId === itemId)); if (!d[wsId].length) delete d[wsId]; putDoc(SHARED_DOC, d); }
  else await q(`workspace_agents?workspace_id=eq.${encodeURIComponent(wsId)}&kind=eq.${kind}&item_id=eq.${encodeURIComponent(itemId)}`, { method: "DELETE", prefer: "return=minimal" });
  return { ok: true };
}
// a shared item for using: checks agents.use (a viewer is refused)
export async function sharedForUse(wsId, kind, itemId) {
  const role = await need(wsId, "agents.use");
  const row = await findShared(wsId, kind, itemId);
  if (!row) throw err(404, "That item is not shared there.");
  return { role, row };
}
// copy a shared item into my own list (a prompt's agent comes along when it is shared there too)
export async function copyShared(wsId, kind, itemId) {
  const { row } = await sharedForUse(wsId, kind, itemId);
  const bundle = { format: FORMAT, version: FORMAT_VERSION, agents: [], prompts: [] };
  if (kind === "agent") bundle.agents.push(row.data);
  else {
    bundle.prompts.push(row.data);
    if (row.data?.agentRef) { const a = await findShared(wsId, "agent", row.data.agentRef); if (a) bundle.agents.push(a.data); }
  }
  return importBundle(bundle);
}
// the agent a shared snapshot describes, ready for runOptions (its libraries only if they are on this computer)
export function agentFromSnapshot(data) {
  const notes = [];
  const c = cleanAgent(data || {}, { lenient: true, notes });
  return { agent: { id: null, ...c }, notes };
}

// ---------- Marketplace listing drafts (Phase 10 reads these; nothing is published here) ----------
// marketplace.md, Trust: items are data, never code, and anything that tries to get at keys or switch off checks is refused.
const RISKY = [
  [/\b(api[ _-]?keys?|secret keys?|access tokens?|passwords?|session tokens?)\b[^.\n]{0,80}\b(send|post|upload|reveal|print|show|share|email|exfiltrat\w*|forward)\b/i, "asks for keys, tokens or passwords to be revealed or sent"],
  [/\b(send|post|upload|reveal|print|show|share|email|forward)\b[^.\n]{0,80}\b(api[ _-]?keys?|secret keys?|access tokens?|passwords?|session tokens?)\b/i, "asks for keys, tokens or passwords to be revealed or sent"],
  [/\bignore (all |any )?(previous|prior|above|earlier) (instructions|rules)\b/i, "tries to override the app's instructions"],
  [/\b(disable|turn off|skip|bypass)\b[^.\n]{0,40}\b(qa|quality check|approval|safety|spend caps?|ledger)\b/i, "tries to switch off checks"],
  [/\bexfiltrat/i, "mentions exfiltration"],
];
export function scanForListing(texts) {
  const hay = texts.filter(Boolean).join("\n");
  return [...new Set(RISKY.filter(([re]) => re.test(hay)).map(([, why]) => why))];
}
const listingsDoc = () => { const d = doc(LISTINGS_DOC, () => ({ list: [] })); d.list ||= []; return d; };
export const listListings = () => listingsDoc().list;
export function prepareListing(kind, itemId, input = {}) {
  if (!KINDS.includes(kind)) throw err(400, "kind must be agent or prompt");
  const item = kind === "agent" ? getAgent(itemId) : getPrompt(itemId);
  if (!item) throw err(404, kind === "agent" ? "No such agent." : "No such prompt.");
  const category = LISTING_CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) throw err(400, `Pick a category: ${LISTING_CATEGORIES.join(", ")}.`);
  const promise = str(input.promise, 140);
  if (!promise) throw err(400, "Write the one-line promise buyers will see.");
  const bundle = kind === "agent" ? exportBundle({ agents: [itemId], prompts: [] }) : exportBundle({ agents: item.agentId ? [item.agentId] : [], prompts: [itemId] });
  // buyers bring their own AIs, libraries and tools: the listing keeps the model only as a suggestion and no library links
  for (const a of bundle.agents) a.libraries = [];
  const flagged = scanForListing([item.name, item.description, item.instructions, item.text, ...(item.starters || []), promise]);
  if (flagged.length) throw err(400, `This cannot be listed: it ${flagged.join(" and ")}.`, { code: "flagged", flagged });
  const d = listingsDoc();
  const prev = d.list.find((x) => x.kind === kind && x.itemId === itemId);
  const listing = { id: prev?.id || newId("ls"), kind, itemId, title: item.name, category, promise, bundle, author: usernameOf() || "", status: "draft", price: null, version: (prev?.version || 0) + 1, updatedAt: Date.now(), note: "Draft only. The Marketplace is not open yet; nothing was published. Pricing is decided in Phase 10." };
  if (prev) Object.assign(prev, listing); else d.list.push(listing);
  putDoc(LISTINGS_DOC, d);
  return listing;
}
export function removeListing(id) { const d = listingsDoc(); const n = d.list.length; d.list = d.list.filter((x) => x.id !== id); if (d.list.length === n) throw err(404, "No such listing."); putDoc(LISTINGS_DOC, d); return { ok: true }; }
