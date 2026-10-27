// Multi-AI takeover and Owner tools (0.4.19 slice D3, flag_takeover).
// Project mirroring and "Review and Take Over Tasks" use only supported MCP servers the person already
// added in Settings, the local Antigravity bridge, and pasted export text. Nothing here scrapes a page,
// reads a login, or calls an AI. Looking is read-only. Taking over, pausing the original, mirroring and
// every Owner change need an explicit confirm from a click (confirm: true), and are checked on the server.
// Secrets are stripped from every brief and task. Owner tools also need the owner tier.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { stripSecrets } from "./handoff.js";
import { parseCron } from "./schedules.js";

export const FLAG_NAME = "flag_takeover";
export const STATE_DOC = "takeover.state";
export const OWNER_DOC = "takeover.owner";
export const MAX_FOUND = 60;
export const MAX_LOG = 60;

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
// Keeps line breaks (0.4.21, M39): the risky-line check and Safer copy work line by line.
const clipBlock = (s, n) => String(s ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const err = (status, message, code) => Object.assign(new Error(message), { status, code });

// ---------- plug-in points (tests set their own) ----------
export const io = {
  now: () => Date.now(),
  listServers: () => [],                       // () -> [{ id, name, enabled? }]
  connect: async () => { throw new Error("No MCP client configured."); }, // (serverId) -> { tools, client }
  tier: () => "free",
  listProjects: () => [],
  createSchedule: () => { throw new Error("No scheduler configured."); },
  bridgeReady: () => false,
  bridgeSend: async () => { throw new Error("No bridge configured."); },
};
export function configure(parts) { Object.assign(io, parts); }

// ---------- state ----------
const empty = () => ({ found: [], taken: {}, dismissed: [], mirrors: {}, log: [], lastLookAt: 0 });
function load() {
  const s = doc(STATE_DOC, empty) || {};
  const b = empty();
  return { ...b, ...s, found: Array.isArray(s.found) ? s.found : [], log: Array.isArray(s.log) ? s.log : [], dismissed: Array.isArray(s.dismissed) ? s.dismissed : [], taken: s.taken || {}, mirrors: s.mirrors || {} };
}
const save = (s) => { s.log = s.log.slice(0, MAX_LOG); putDoc(STATE_DOC, s); return s; };
function note(s, text) { s.log.unshift({ at: io.now(), text: clip(stripSecrets(text), 200) }); }

// ---------- reading what another AI reports ----------
// A tool is only used for looking when its name is a plain reader of tasks and it needs no input.
const LOOK_NAME = /^(list|get|search|find|read|view)_?[a-z_]*(scheduled_?tasks?|schedules?|automations?|routines?|recurring_?tasks?|tasks?|jobs?)$/i;
const ACT_WORD = /(delete|remove|create|add|update|edit|run|execute|send|post|pay|cancel|pause|resume|disable|enable|write|set|trigger|start|stop)/i;
export function isLookTool(tool) {
  const name = String(tool?.name || "");
  if (!LOOK_NAME.test(name) || ACT_WORD.test(name.replace(/^(list|get|search|find|read|view)_?/i, ""))) return false;
  const req = tool?.inputSchema?.required;
  return !Array.isArray(req) || req.length === 0;
}
const PAUSE_NAME = /^(pause|disable|stop|deactivate)_?[a-z_]*(scheduled_?tasks?|schedules?|automations?|routines?|recurring_?tasks?|tasks?|jobs?)$/i;
export function pauseTool(tools) {
  return (tools || []).find((t) => PAUSE_NAME.test(String(t?.name || "")) && Object.keys(t.inputSchema?.properties || {}).some((k) => /^(id|task_?id|schedule_?id|job_?id|automation_?id)$/i.test(k)) && (t.inputSchema?.required || []).every((k) => /^(id|task_?id|schedule_?id|job_?id|automation_?id)$/i.test(k))) || null;
}
const idKeyOf = (tool) => Object.keys(tool.inputSchema?.properties || {}).find((k) => /^(id|task_?id|schedule_?id|job_?id|automation_?id)$/i.test(k));

const CRON_KEYS = ["cron", "schedule", "cron_expression", "cronExpression", "recurrence", "rrule", "when"];
const NAME_KEYS = ["name", "title", "label"];
const TEXT_KEYS = ["prompt", "instructions", "instruction", "description", "task", "text", "command"];
const ID_KEYS = ["id", "task_id", "taskId", "schedule_id", "job_id", "uuid"];
const pick = (o, keys) => { for (const k of keys) if (o[k] != null && typeof o[k] !== "object" && String(o[k]).trim()) return String(o[k]); return ""; };

export function everyMinute(expr) {
  const f = String(expr || "").trim().split(/\s+/);
  return f.length >= 5 && (f[0] === "*" || f[0] === "*/1") && f.slice(1, 5).every((x) => x === "*");
}

function cronOrNull(s) {
  const v = String(s || "").trim();
  if (!v) return null;
  try { return parseCron(v).expr; } catch { return null; }
}

// One reported task becomes one review row. Prompts are cleaned of secrets and clipped.
export function normalizeTask(raw, source) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const extId = clip(pick(raw, ID_KEYS), 120);
  const prompt = clipBlock(stripSecrets(pick(raw, TEXT_KEYS)), 2000);
  const name = clip(stripSecrets(pick(raw, NAME_KEYS)), 80) || clip(prompt, 60);
  if (!name && !prompt) return null;
  const whenRaw = clip(pick(raw, CRON_KEYS), 120);
  const cron = cronOrNull(whenRaw);
  const key = `${source.id}|${extId || name}|${whenRaw}`;
  return {
    id: "tk-" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 12),
    sourceId: source.id,
    sourceName: clip(source.name, 40),
    sourceKind: source.kind,
    extId,
    name: name || "Task",
    prompt,
    when: whenRaw,
    cron,
    active: raw.enabled === false || raw.active === false || raw.paused === true || raw.status === "paused" ? false : true,
  };
}

export function parseTaskList(text, source) {
  let data;
  try { data = JSON.parse(String(text || "")); } catch { return { items: [], unreadable: true }; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data?.schedules) ? data.schedules : Array.isArray(data?.items) ? data.items : Array.isArray(data?.automations) ? data.automations : null;
  if (!list) return { items: [], unreadable: true };
  const items = list.map((r) => normalizeTask(r, source)).filter(Boolean);
  return { items, unreadable: false };
}

function replaceFound(s, sourceId, items) {
  const keep = s.found.filter((f) => f.sourceId !== sourceId);
  s.found = [...items, ...keep].slice(0, MAX_FOUND);
}

// Read-only look at every connected MCP server that offers a plain task list. Returns what it saw and why not.
export async function lookForTasks({ serverIds } = {}) {
  const s = load();
  const report = [];
  const servers = io.listServers().filter((v) => v.enabled !== false && (!serverIds || serverIds.includes(v.id)));
  for (const sv of servers) {
    const source = { id: sv.id, name: sv.name || sv.id, kind: "mcp" };
    let sess;
    try { sess = await io.connect(sv.id); }
    catch (e) { report.push({ source: source.name, ok: false, message: "Could not connect: " + clip(e.message, 120) }); continue; }
    const tool = (sess.tools || []).find(isLookTool);
    if (!tool) { report.push({ source: source.name, ok: false, message: "This server does not offer a plain list of scheduled tasks." }); continue; }
    try {
      const r = await sess.client.callTool(tool.name, {});
      if (r?.isError) { report.push({ source: source.name, ok: false, message: "It could not list tasks right now." }); continue; }
      const got = parseTaskList(r?.text, source);
      if (got.unreadable) { report.push({ source: source.name, ok: false, message: "It answered, but not in a list Meldmind can read." }); continue; }
      for (const it of got.items) { it.pauseTool = pauseTool(sess.tools)?.name || null; }
      replaceFound(s, source.id, got.items);
      report.push({ source: source.name, ok: true, count: got.items.length, message: got.items.length ? `${got.items.length} found.` : "No scheduled tasks found." });
    } catch (e) { report.push({ source: source.name, ok: false, message: "Could not read tasks: " + clip(e.message, 120) }); }
  }
  s.lastLookAt = io.now();
  note(s, `Looked for tasks on ${servers.length} server${servers.length === 1 ? "" : "s"}.`);
  save(s);
  return { report, view: reviewView() };
}

// Tasks from an export the person pasted or picked (JSON list). Read-only, nothing is called.
export function importExport({ text, label } = {}) {
  const raw = String(text || "");
  if (!raw.trim()) throw err(400, "Paste the exported list first.", "empty");
  if (raw.length > 400000) throw err(400, "That export is too large.", "too_large");
  const source = { id: "paste-" + crypto.createHash("sha1").update(clip(label, 40) || "export").digest("hex").slice(0, 6), name: clip(label, 40) || "Pasted export", kind: "export" };
  const got = parseTaskList(raw, source);
  if (got.unreadable) throw err(400, "That is not a JSON list of tasks.", "unreadable");
  const s = load();
  replaceFound(s, source.id, got.items);
  s.lastLookAt = io.now();
  note(s, `Read ${got.items.length} task${got.items.length === 1 ? "" : "s"} from ${source.name}.`);
  save(s);
  return reviewView();
}

export function reviewView() {
  const s = load();
  const rows = s.found.filter((f) => !s.dismissed.includes(f.id)).map((f) => ({
    ...f,
    takenSchedule: s.taken[f.id]?.scheduleId || null,
    pausedOriginal: !!s.taken[f.id]?.pausedOriginal,
    canPause: !!f.pauseTool && f.sourceKind === "mcp",
    needsTime: !f.cron,
  }));
  return { tasks: rows, lastLookAt: s.lastLookAt, log: s.log.slice(0, 12), note: "Looking changes nothing. Take over copies a task into Schedules, paused, after you click." };
}

export function dismissTask(id) {
  const s = load();
  if (!s.found.some((f) => f.id === id)) throw err(404, "No such task.", "missing");
  if (!s.dismissed.includes(id)) s.dismissed.push(id);
  save(s);
  return reviewView();
}

// Take over: copy the task into Meldmind's own scheduler. It is created paused, so nothing runs twice.
export function takeOver(id, { confirm, cron } = {}) {
  if (confirm !== true) throw err(409, "Take over needs your click to confirm.", "confirm");
  const s = load();
  const f = s.found.find((x) => x.id === id);
  if (!f) throw err(404, "No such task.", "missing");
  if (s.taken[id]) throw err(409, "That task was already taken over.", "already");
  const useCron = cronOrNull(cron) || f.cron;
  if (!useCron) throw err(400, "Meldmind could not read when this task runs. Type a schedule like 0 9 * * 1-5 and try again.", "needs_time");
  if (everyMinute(useCron)) throw err(400, "That runs every minute. Pick a slower time, such as every hour (0 * * * *). Nothing was copied.", "too_often");
  const text = f.prompt || f.name;
  const made = io.createSchedule({ name: `${f.name} (from ${f.sourceName})`, target: { kind: "chat", text }, trigger: { type: "cron", cron: useCron }, enabled: false });
  s.taken[id] = { scheduleId: made.schedule.id, at: io.now(), pausedOriginal: false };
  note(s, `Took over "${f.name}" from ${f.sourceName}. It is paused in Schedules.`);
  save(s);
  return { ok: true, scheduleId: made.schedule.id, view: reviewView() };
}

// Pause the original in the other AI. Only when that server has a plain pause tool, and only on confirm.
export async function pauseOriginal(id, { confirm } = {}) {
  if (confirm !== true) throw err(409, "Pausing the original needs your click to confirm.", "confirm");
  const s = load();
  const f = s.found.find((x) => x.id === id);
  if (!f) throw err(404, "No such task.", "missing");
  if (!s.taken[id]) throw err(409, "Take the task over first.", "not_taken");
  if (f.sourceKind !== "mcp" || !f.pauseTool || !f.extId) throw err(400, "That AI has no way to pause it from here. Pause it there yourself.", "unsupported");
  const sess = await io.connect(f.sourceId);
  const tool = pauseTool(sess.tools);
  if (!tool || tool.name !== f.pauseTool) throw err(400, "That AI no longer offers a pause step.", "unsupported");
  const r = await sess.client.callTool(tool.name, { [idKeyOf(tool)]: f.extId });
  if (r?.isError) throw err(502, "The other AI could not pause it. Pause it there yourself.", "failed");
  s.taken[id].pausedOriginal = true;
  note(s, `Paused "${f.name}" on ${f.sourceName}.`);
  save(s);
  return { ok: true, view: reviewView() };
}

// ---------- project mirroring ----------
const WRITE_NAME = /^(create|upsert|save|set|update|add)_(project|context|note|memory)s?$/i;
const NAME_PROPS = ["name", "title", "project", "project_name"];
const BODY_PROPS = ["content", "text", "body", "description", "notes", "summary", "instructions", "context", "memory"];

// A short brief of the project: name, summary, category names. No links, no files, no secrets.
export function projectBrief(project) {
  if (!project) return "";
  const cats = (project.categories || []).map((c) => clip(c.name, 40)).filter(Boolean).slice(0, 12);
  const lines = [`Meldmind project: ${clip(project.name, 80)}`];
  if (project.summary) lines.push(clip(project.summary, 600));
  if (cats.length) lines.push("Sections: " + cats.join(", "));
  return stripSecrets(lines.join("\n")).slice(0, 1500);
}
function mirrorArgs(tool, project, brief) {
  const props = Object.keys(tool.inputSchema?.properties || {});
  const nameKey = NAME_PROPS.find((k) => props.includes(k));
  const bodyKey = BODY_PROPS.find((k) => props.includes(k));
  const args = {};
  if (nameKey) args[nameKey] = clip(project.name, 80);
  if (bodyKey) args[bodyKey] = brief;
  const req = tool.inputSchema?.required || [];
  if (!bodyKey && !nameKey) return null;
  if (req.some((k) => !(k in args))) return null;
  return args;
}

// Where this project could be mirrored, with the exact text that would be sent. Nothing is sent here.
export async function mirrorPreview(projectId) {
  const project = io.listProjects().find((p) => p.id === projectId);
  if (!project) throw err(404, "Pick a project first.", "project");
  const brief = projectBrief(project);
  const targets = [];
  for (const sv of io.listServers().filter((v) => v.enabled !== false)) {
    try {
      const sess = await io.connect(sv.id);
      const tool = (sess.tools || []).find((t) => WRITE_NAME.test(String(t.name)) && mirrorArgs(t, project, brief));
      if (tool) targets.push({ kind: "mcp", id: sv.id, name: clip(sv.name || sv.id, 40), tool: tool.name });
    } catch { /* a server that will not connect is simply not offered */ }
  }
  if (io.bridgeReady()) targets.push({ kind: "bridge", id: "antigravity", name: "Google Antigravity", tool: "bridge job" });
  const st = load();
  return { projectId, projectName: project.name, brief, targets, mirrored: st.mirrors[projectId] || {}, note: "Nothing is sent until you click Send brief. The brief has the project name, summary and section names only." };
}

export async function mirrorPush(projectId, { kind, id, confirm } = {}) {
  if (confirm !== true) throw err(409, "Sending the brief needs your click to confirm.", "confirm");
  const project = io.listProjects().find((p) => p.id === projectId);
  if (!project) throw err(404, "Pick a project first.", "project");
  const brief = projectBrief(project);
  const prev = await mirrorPreview(projectId);
  const target = prev.targets.find((t) => t.kind === kind && t.id === id);
  if (!target) throw err(400, "That place cannot take a project brief.", "target");
  if (kind === "mcp") {
    const sess = await io.connect(id);
    const tool = (sess.tools || []).find((t) => t.name === target.tool);
    const args = tool && mirrorArgs(tool, project, brief);
    if (!args) throw err(400, "That place cannot take a project brief.", "target");
    const r = await sess.client.callTool(tool.name, args);
    if (r?.isError) throw err(502, `${target.name} could not save the brief.`, "failed");
  } else {
    await io.bridgeSend({ task: `Remember this Meldmind project for later work.\n${brief}`, agent: "antigravity" });
  }
  const s = load();
  s.mirrors[projectId] = { ...(s.mirrors[projectId] || {}), [`${kind}:${id}`]: { at: io.now(), name: target.name } };
  note(s, `Sent the "${project.name}" brief to ${target.name}.`);
  save(s);
  return { ok: true, target: target.name, mirrored: s.mirrors[projectId] };
}

// ---------- Owner tools ----------
export const OWNER_DEFAULTS = { transport: "auto", finishHigh: 0.85, finishLow: 0.6, momentumIdleSec: 20, momentumBarSize: 3 };
const OWNER_LIMITS = {
  transport: (v) => (["auto", "api", "mcp"].includes(v) ? v : null),
  finishHigh: (v) => (Number.isFinite(+v) && +v >= 0.5 && +v <= 0.99 ? +(+v).toFixed(2) : null),
  finishLow: (v) => (Number.isFinite(+v) && +v >= 0.1 && +v <= 0.9 ? +(+v).toFixed(2) : null),
  momentumIdleSec: (v) => (Number.isInteger(+v) && +v >= 5 && +v <= 300 ? +v : null),
  momentumBarSize: (v) => (Number.isInteger(+v) && +v >= 2 && +v <= 4 ? +v : null),
};
export const isOwner = () => io.tier() === "owner";
function requireOwner() {
  if (!isOwner()) throw err(403, "Owner tools are for the owner account.", "owner_only");
}
export function ownerSettings() {
  const d = doc(OWNER_DOC, () => ({ values: {}, history: [] })) || {};
  return { ...OWNER_DEFAULTS, ...(d.values || {}) };
}
const ownerHistory = () => (doc(OWNER_DOC, () => ({ values: {}, history: [] })) || {}).history || [];

// Change owner settings. Needs the owner tier and a confirm. Every change is kept so it can be put back.
export function ownerChange(patch, { confirm } = {}) {
  requireOwner();
  if (confirm !== true) throw err(409, "Owner changes need your click to confirm.", "confirm");
  const d = doc(OWNER_DOC, () => ({ values: {}, history: [] })) || { values: {}, history: [] };
  const before = { ...OWNER_DEFAULTS, ...(d.values || {}) };
  const next = { ...before };
  const changed = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!OWNER_LIMITS[k]) throw err(400, `"${k}" is not an owner setting.`, "unknown");
    const ok = OWNER_LIMITS[k](v);
    if (ok === null) throw err(400, `That value is not allowed for ${k}.`, "range");
    if (ok !== before[k]) { next[k] = ok; changed[k] = { from: before[k], to: ok }; }
  }
  if (next.finishLow >= next.finishHigh) throw err(400, "The low threshold must stay under the high one.", "range");
  if (!Object.keys(changed).length) return { ok: true, changed, settings: before };
  const history = [{ at: io.now(), changed }, ...(d.history || [])].slice(0, 30);
  putDoc(OWNER_DOC, { values: next, history });
  return { ok: true, changed, settings: next };
}
export function ownerUndo({ confirm } = {}) {
  requireOwner();
  if (confirm !== true) throw err(409, "Owner changes need your click to confirm.", "confirm");
  const d = doc(OWNER_DOC, () => ({ values: {}, history: [] })) || { values: {}, history: [] };
  const [last, ...rest] = d.history || [];
  if (!last) throw err(409, "There is nothing to undo.", "empty");
  const values = { ...(d.values || {}) };
  for (const [k, c] of Object.entries(last.changed)) values[k] = c.from;
  putDoc(OWNER_DOC, { values, history: rest });
  return { ok: true, settings: { ...OWNER_DEFAULTS, ...values } };
}

// Read-only owner view. `parts` are lazy readers the plugin supplies (router, model watch, MCP log).
export function ownerView(parts = {}) {
  requireOwner();
  const safe = (fn) => { try { return fn ? fn() : null; } catch { return null; } };
  return {
    settings: ownerSettings(),
    defaults: OWNER_DEFAULTS,
    history: ownerHistory().slice(0, 10),
    routing: safe(parts.routing),
    models: safe(parts.models),
    logs: { tools: safe(parts.toolLog) || [], takeover: load().log.slice(0, 20) },
    note: "Changes here are saved only after you confirm, and Undo puts the last one back.",
  };
}
