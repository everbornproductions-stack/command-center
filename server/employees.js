// AI employees (0.4.14). Ready-made agents with a job script, built on the custom agents model
// (server/custom-agents.js): a run is one chat with the script as the system prompt, through smart
// fallback, the ledger and the spend caps, exactly like running a custom agent.
//
//  - The team: the 20 playbook employees (server/employee-playbook.js) are on every install from the
//    start, plus any library employee the person added. A preset can be taken off the team and put back.
//  - The library (server/employee-library.js): more employees to browse and add with one click.
//  - Customize copies an employee into My agents, where every field can be edited.
//  - Suggestions: a keyword match on what the person typed (Simple mode, the Command view), on a
//    project's name and summary (suggested team), and on a mission step (who does which step).
//  - Nothing here sends, posts or buys. The scripts say so too.
//
// The catalog ships with the app, so an update can improve a script. Only the person's choices are
// stored: { added: [ids], removed: [ids] } in the "agents.employees" document. Never a key or secret.
import { doc, putDoc } from "./store.js";
import { PLAYBOOK } from "./employee-playbook.js";
import { LIBRARY } from "./employee-library.js";
import { createAgent, getAgent, systemFor as customSystemFor } from "./custom-agents.js";
import { listProjects, saveProject } from "./projects.js";

export const EMPLOYEES_DOC = "agents.employees";
export const CATEGORIES = ["Front desk and support", "Sales", "Marketing", "Content and creators", "Operations", "Money", "Hiring", "Small business", "Legal basics", "Research", "Coding and tech"];
export const DEFAULT_TEAM = ["executive-assistant", "social-content", "support-agent"];
export const MAX_CREW = 6;

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const ALL = [...PLAYBOOK.map((e) => ({ ...e, source: "playbook" })), ...LIBRARY.map((e) => ({ ...e, source: "library" }))];
const BY_ID = new Map(ALL.map((e) => [e.id, e]));

export const allEmployees = () => ALL;
export const getEmployee = (id) => BY_ID.get(String(id || "")) || null;

function stateDoc() {
  const d = doc(EMPLOYEES_DOC, () => ({ added: [], removed: [] }));
  if (!Array.isArray(d.added)) d.added = [];
  if (!Array.isArray(d.removed)) d.removed = [];
  return d;
}
// no signed-in user (a pure call, or a hosted request before sign-in): the out-of-the-box team
const readState = () => { try { return stateDoc(); } catch { return { added: [], removed: [] }; } };
export function onTeam(id) {
  const e = getEmployee(id);
  if (!e) return false;
  const d = readState();
  return e.source === "playbook" ? !d.removed.includes(id) : d.added.includes(id);
}

// list rows leave the script out (it is long); GET /api/agents/employees/<id> has it
export function employeeView(e, { full = false } = {}) {
  const row = { id: e.id, name: e.name, category: e.category, oneLiner: e.oneLiner, starters: e.starters || [], kinds: e.kinds || [], source: e.source, onTeam: onTeam(e.id), approval: approvalFor(e.id) };
  if (full) { row.instructions = e.instructions; row.blanks = blanksIn(e.instructions); }
  return row;
}
// the [bracket] blanks in a script, each once, so the UI can say what to fill in
export function blanksIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/\[([^\]\n]{1,60})\]/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out.slice(0, 40);
}

// What happens to an employee's finished work (0.4.21): "queue" puts it in MindMedia as Review for the person's OK
// (the default), "own" keeps it as a Draft. Either way nothing is sent without a click.
export const APPROVALS = ["queue", "own"];
export function approvalFor(id) {
  const m = readState().approval;
  return m && APPROVALS.includes(m[id]) ? m[id] : "queue";
}
export function setApproval(id, mode) {
  if (!getEmployee(id)) throw err(404, "No such employee.");
  if (!APPROVALS.includes(mode)) throw err(400, "Choose Send on its own or Queue for my OK.");
  const d = stateDoc();
  d.approval = { ...(d.approval && typeof d.approval === "object" ? d.approval : {}), [id]: mode };
  putDoc(EMPLOYEES_DOC, d);
  return { id, approval: mode };
}

export const teamList = () => ALL.filter((e) => onTeam(e.id)).map((e) => employeeView(e));
export const libraryList = () => ALL.filter((e) => !onTeam(e.id)).map((e) => employeeView(e));
export function overview() {
  const team = teamList();
  return { team, library: libraryList(), categories: CATEGORIES, counts: { team: team.length, playbook: PLAYBOOK.length, library: LIBRARY.length } };
}

export function addEmployee(id) {
  const e = getEmployee(id);
  if (!e) throw err(404, "No such employee.");
  const d = stateDoc();
  if (e.source === "playbook") d.removed = d.removed.filter((x) => x !== id);
  else if (!d.added.includes(id)) d.added.push(id);
  putDoc(EMPLOYEES_DOC, d);
  return employeeView(e);
}
export function removeEmployee(id) {
  const e = getEmployee(id);
  if (!e) throw err(404, "No such employee.");
  const d = stateDoc();
  if (e.source === "playbook") { if (!d.removed.includes(id)) d.removed.push(id); }
  else d.added = d.added.filter((x) => x !== id);
  putDoc(EMPLOYEES_DOC, d);
  return employeeView(e);
}

// Customize: an editable copy in My agents (the custom agents model, Auto model, no tools)
export function customizeEmployee(id) {
  const e = getEmployee(id);
  if (!e) throw err(404, "No such employee.");
  return createAgent({ name: e.name, description: e.oneLiner, instructions: e.instructions, starters: e.starters, provider: null, model: null, tools: { mode: "off", allow: [] }, libraries: [] });
}

// ---------- running ----------
export function systemForEmployee(e) {
  return `You are the AI employee "${e.name}". What you do for the person: ${e.oneLiner}\nFollow this job script from the person you work for:\n\n${e.instructions}\n\nWords in [square brackets] are blanks. If you need one the person has not filled in, ask for it in one short question or write [ASK] in its place. Never say you sent, posted, booked or paid for anything: you write drafts and the person decides. Markdown allowed. No filler.`;
}
// What runChat needs for one employee run, shaped like custom-agents runOptions().
export function employeeRunOptions(id, { prompt, projectId = null, search } = {}) {
  const e = getEmployee(id);
  if (!e) throw err(404, "No such employee.");
  const text = String(prompt ?? "").replace(/\r\n/g, "\n").trim().slice(0, 20000);
  if (!text) throw err(400, `Type what you want ${e.name} to do, or pick a starter.`);
  return { prompt: text, projectId, search: typeof search === "boolean" ? search : undefined, system: systemForEmployee(e), agent: { id: `emp-${e.id}`, name: e.name }, tools: false };
}

// ---------- suggestions ----------
const norm = (s) => ` ${String(s || "").toLowerCase().replace(/[^a-z0-9.+#'-]+/g, " ").replace(/\s+/g, " ").trim()} `;
function scoreFor(e, hay) {
  let score = 0;
  for (const k of e.keywords || []) {
    const kw = norm(k);
    if (kw.trim().length < 2) continue;
    if (hay.includes(kw)) score += kw.trim().includes(" ") ? 3 : 2;
  }
  return score;
}
// Best employees for what the person typed. Team members win ties, so a suggestion is usually one
// they can use right away; a library employee still shows when it fits clearly better.
export function suggestEmployees(text, { limit = 3, teamOnly = false } = {}) {
  const hay = norm(String(text || "").slice(0, 4000));
  if (hay.trim().length < 3) return [];
  return ALL
    .filter((e) => !teamOnly || onTeam(e.id))
    .map((e) => ({ e, score: scoreFor(e, hay) + (onTeam(e.id) ? 0.5 : 0) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
    .slice(0, Math.max(1, Math.min(10, limit)))
    .map(({ e, score }) => ({ ...employeeView(e), score }));
}

// Suggested team for a project: what its name and summary point to, topped up with the defaults.
export function suggestTeam({ name = "", summary = "", size = 4 } = {}) {
  const picks = suggestEmployees(`${name} ${summary}`, { limit: size }).map((x) => x.id);
  for (const id of DEFAULT_TEAM) if (picks.length < size && !picks.includes(id)) picks.push(id);
  return picks.slice(0, size).map((id) => employeeView(getEmployee(id)));
}
export function projectTeam(projectId) {
  const p = listProjects().find((x) => x.id === projectId);
  if (!p) throw err(404, "No such project.");
  const saved = Array.isArray(p.team) ? p.team.filter((id) => getEmployee(id)) : [];
  return { projectId: p.id, team: saved.map((id) => employeeView(getEmployee(id))), saved: saved.length > 0, suggested: suggestTeam({ name: p.name, summary: p.summary }) };
}
// Save a project's team; library employees picked here join the team too, so they can be used.
export function setProjectTeam(projectId, ids) {
  const p = listProjects().find((x) => x.id === projectId);
  if (!p) throw err(404, "No such project.");
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => getEmployee(id)).slice(0, MAX_CREW * 2);
  for (const id of clean) if (!onTeam(id)) addEmployee(id);
  saveProject({ id: p.id, team: clean });
  return projectTeam(p.id);
}

// ---------- missions ----------
// The employees picked for a mission (custom agents from My agents work too), each with its system text.
export function resolveCrew(ids) {
  const out = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw || "").slice(0, 80);
    if (!id || out.some((c) => c.id === id)) continue;
    const e = getEmployee(id);
    if (e) { out.push({ id, name: e.name, keywords: e.keywords || [], instructions: e.instructions, system: systemForEmployee(e) }); continue; }
    const a = getAgent(id);
    if (a) out.push({ id, name: a.name, keywords: String(`${a.name} ${a.description || ""}`).toLowerCase().split(/\W+/).filter((w) => w.length > 3), instructions: a.instructions, system: customSystemFor(a) });
    if (out.length >= MAX_CREW) break;
  }
  return out;
}
// Who on the crew does this step: best keyword match on the step, else take turns.
export function crewFor(crew, task, index = 0) {
  if (!crew?.length) return null;
  const hay = norm(`${task?.title || ""} ${task?.instructions || ""} ${task?.deliverable || ""} ${task?.capability || ""}`);
  let best = null, bestScore = 0;
  for (const c of crew) { const s = scoreFor(c, hay); if (s > bestScore) { best = c; bestScore = s; } }
  return best || crew[index % crew.length];
}
// The system text for one mission step done by a crew member.
export function crewSystem(member, goal) {
  return `You are the AI employee "${member.name}" on a team working toward this goal:\n${goal}\n\nYour job script (follow its rules and style; words in [square brackets] are blanks, write [ASK] if you need one):\n\n${member.instructions}\n\nDo only your task. Output the deliverable itself in Markdown, no preamble, no questions back.`;
}
