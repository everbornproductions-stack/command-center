// Refocus routes. Find reads local history, project files, saved outputs, folders on this PC
// (Videos, Downloads, Documents, OneDrive, Google Drive for desktop), Claude sessions, Grok Bot
// and other agent results, and Drive when it is already connected. Rebuild starts a mission only after this click.
import { assertRefocusFind, assertRefocusRebuild, refocusGate } from "../feature-gate.js";
import { whoWillRead } from "../readers.js";
import {
  assemble, publicItem, goalFrom, fromRun, fromDrive, fromMedia, fromArtifact, fromFile,
  readRecord, rememberChoice, noteWorked,
} from "../refocus.js";
import { driveSearch, driveRead, granted } from "../google.js";
import { listJobs } from "../media-jobs.js";
import { listArtifacts, getArtifact } from "../artifacts.js";
import * as L from "../libraries.js";
import { listJobs as grokJobs } from "../grokbot.js";
import { normalizeHandoff } from "../external-agents.js";
import { DATA_DIR, HQ_DIR } from "../paths.js";
import { HOSTED } from "../store.js";
import { localRoots, claudeSessionDirs, searchFiles, searchClaudeSessions } from "../refocus-search.js";
import { fromGrokJob, fromHandoff } from "../refocus.js";

export const id = "refocus";

// Outside agent handoffs seen on the bus this session (Grok Bot jobs are read from its own store).
const handoffs = new Map();
export function onEvent(ev) {
  if (ev?.type !== "external.handoff") return;
  const rec = normalizeHandoff(ev);
  if (!rec || rec.agent === "grokbot") return;
  handoffs.set(`${rec.agent}:${rec.jobId}`, { ...rec, at: Date.now() });
  if (handoffs.size > 300) handoffs.delete(handoffs.keys().next().value);
}

function note(h, text, level) {
  console.log(`[refocus] ${text}`);
  try { h.emit("log", { text: `Refocus: ${text}`, level }); } catch { /* the log is best effort */ }
}

function cleanTopic(v) {
  const t = String(v || "").replace(/\s+/g, " ").trim();
  if (t.length < 2) throw Object.assign(new Error("Type a topic first, for example music videos."), { status: 400, code: "topic" });
  if (t.length > 200) throw Object.assign(new Error("Keep the topic under 200 characters."), { status: 400, code: "topic" });
  return t;
}

async function projectFiles(topic, errors) {
  const out = [];
  let libs = [];
  try { libs = L.listLibraries(); } catch (e) { errors.push(`project libraries: ${e.message}`); return out; }
  for (const lib of libs) {
    try {
      const found = await L.search(lib.id, topic, { mode: "keyword", k: 5 });
      for (const hit of found.results || []) out.push(fromFile(hit));
    } catch (e) { errors.push(`library ${lib.name || lib.id}: ${e.message}`); }
  }
  return out;
}

function savedOutputs(errors) {
  const out = [];
  try { for (const job of listJobs({})) if (job?.id) out.push(fromMedia(job)); } catch (e) { errors.push(`media jobs: ${e.message}`); }
  try {
    for (const row of listArtifacts({})) {
      try { out.push(fromArtifact(getArtifact(row.id))); } catch { /* skip one bad row */ }
    }
  } catch (e) { errors.push(`saved outputs: ${e.message}`); }
  return out;
}

function agentOutputs(errors) {
  const grok = [];
  try { for (const j of grokJobs(200)) { const it = fromGrokJob(j); if (it) grok.push(it); } } catch (e) { errors.push(`Grok Bot jobs: ${e.message}`); }
  const other = [...handoffs.values()].map(fromHandoff).filter(Boolean);
  return { grok, other };
}

// Local folders the projects point at (a link that is a folder path on this PC).
function projectDirs(h) {
  const out = [];
  if (HQ_DIR) out.push(HQ_DIR);
  try {
    for (const p of h.listProjects?.() || []) {
      for (const c of p.categories || []) for (const l of c.links || []) {
        const u = String(l?.url || "");
        if (/^[a-z]:[\\/]/i.test(u) || u.startsWith("/")) out.push(u);
        else if (u.startsWith("file:///")) { try { out.push(decodeURIComponent(new URL(u).pathname).replace(/^\/([a-z]:)/i, "$1")); } catch { /* not a path */ } }
      }
    }
  } catch { /* no projects yet */ }
  return out;
}

async function thisPc(h, topic, wide, errors) {
  if (HOSTED) return { items: [], searched: [{ place: "This PC", kind: "folder", madeBy: "This PC", count: 0, error: "not searched in the hosted app" }] };
  try {
    const roots = localRoots({ projectDirs: projectDirs(h), wide });
    const [files, sessions] = await Promise.all([
      searchFiles({ topic, roots, wide, dataDir: DATA_DIR }),
      searchClaudeSessions({ topic, dirs: claudeSessionDirs({}) }),
    ]);
    if (!roots.length) errors.push("no local folders were found to search (no Videos, Downloads, Documents, Drive, or OneDrive folders)");
    return { items: [...files.items, ...sessions.items], searched: [...files.searched, ...sessions.searched] };
  } catch (e) {
    errors.push(`this PC: ${e.message}`);
    return { items: [], searched: [{ place: "This PC", kind: "folder", madeBy: "This PC", count: 0, error: e.message }] };
  }
}

async function driveItems(topic) {
  let allowed = false;
  try { allowed = granted().includes("drive"); } catch { return { connected: false, items: [], error: null }; }
  if (!allowed) return { connected: false, items: [], error: null };
  try {
    const files = await driveSearch(topic, 5);
    const items = [];
    for (const file of files || []) {
      let text = "";
      try { text = (await driveRead(file.id))?.text || ""; } catch { text = ""; }
      items.push(fromDrive({ ...file, text }));
    }
    return { connected: true, items, error: null };
  } catch (e) {
    return { connected: true, items: [], error: e.message || "Drive could not be read." };
  }
}

const countIn = (found, list) => { const ids = new Set(list.map((x) => x.id)); return found.filter((x) => ids.has(x.id)).length; };

async function collect(h, topic, { wide = false } = {}) {
  const errors = [];
  const names = Object.fromEntries(Object.entries(h.PROVIDERS || {}).map(([pid, p]) => [pid, p.name]));
  const runs = [];
  try {
    for (const m of h.ctx().store.listMissions((row) => row)) {
      const item = fromRun(m, names);
      if (item) runs.push(item);
    }
  } catch (e) { errors.push(`chat and mission history: ${e.message}`); }
  const [files, drive, pc] = await Promise.all([projectFiles(topic, errors), driveItems(topic), thisPc(h, topic, wide, errors)]);
  if (drive.error) errors.push(`Google Drive: ${drive.error}`);
  const outputs = savedOutputs(errors);
  const agents = agentOutputs(errors);
  const record = readRecord();
  const found = assemble({ runs, files, outputs, drive: drive.items, ai: [...agents.grok, ...agents.other], local: pc.items, topic, record });
  const searched = [
    { place: "Chats and missions in Meldmind", kind: "history", count: countIn(found.items, runs), total: runs.length },
    { place: "Grok Bot results", kind: "ai", madeBy: "Grok Bot", count: countIn(found.items, agents.grok), total: agents.grok.length },
    { place: "Other connected agents", kind: "ai", count: countIn(found.items, agents.other), total: agents.other.length },
    { place: "Project files", kind: "project", count: countIn(found.items, files), total: files.length },
    { place: "Saved outputs", kind: "output", count: countIn(found.items, outputs), total: outputs.length },
    { place: drive.connected ? "Google Drive (connected)" : "Google Drive (not connected)", kind: "cloud", count: countIn(found.items, drive.items), error: drive.error || null },
    ...pc.searched.map((r) => ({ place: r.place, kind: r.kind, madeBy: r.madeBy, path: r.path || null, count: countIn(found.items, pc.items.filter((i) => (i.rootPath || i.path || "").startsWith(r.path || "\0"))), scanned: r.scanned || 0, error: r.error || null })),
  ];
  for (const e of errors) note(h, `a source could not be read: ${e}`, "error");
  if (!pc.searched.length) note(h, "no folders on this PC were searched.", "warn");
  if (!found.items.length) note(h, `nothing found for "${topic.slice(0, 80)}". Looked in ${searched.length} places: ${searched.map((r) => `${r.place} (${r.count}${r.error ? `, ${r.error}` : ""})`).join("; ").slice(0, 900)}`);
  const mode = h.settings?.().defaultMode || "balanced";
  return {
    topic,
    wide,
    count: found.items.length,
    searched,
    results: found.results.map(publicItem),
    items: found.items.map(publicItem),
    plan: found.plan,
    skippedPrivate: found.skippedPrivate,
    drive: { connected: drive.connected, count: drive.items.length, error: drive.error, receives: false },
    whoWillRead: whoWillRead({ prompt: goalFrom(topic, found.plan), mode, record, kind: "mission" }),
    sent: false,
  };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/refocus/, "").replace(/\/$/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, { ...refocusGate(), sent: false });
    if (m === "POST" && p === "/find") {
      assertRefocusFind();
      const topic = cleanTopic(body?.topic);
      const found = await collect(h, topic, { wide: body?.wide === true });
      return h.json(res, 200, found);
    }
    if (m === "POST" && p === "/rebuild") {
      assertRefocusRebuild();
      const topic = cleanTopic(body?.topic);
      const found = await collect(h, topic);
      const goal = goalFrom(topic, found.plan);
      const readers = found.whoWillRead.readers.filter((r) => r.mission);
      const chosen = rememberChoice(found.plan, readers);
      const promise = h.runMission({ goal, context: goal, mode: h.settings?.().defaultMode || "balanced" });
      promise.then((mission) => { if (mission?.status === "done") noteWorked(chosen); }).catch((e) => h.emit("log", { text: `Refocus rebuild failed: ${e.message}`, level: "error" }));
      h.emit("log", { text: `Refocus rebuild started for "${topic.slice(0, 80)}".` });
      return h.json(res, 202, { ok: true, started: true, sent: true, goal, whoWillRead: found.whoWillRead, chosen });
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code || null, upgrade: e.upgrade || null });
  }
  return false;
}
