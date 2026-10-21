// Refocus routes. Find reads local history, project files, saved outputs, and Drive
// when it is already connected. Rebuild starts a mission only after this click.
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

export const id = "refocus";

function cleanTopic(v) {
  const t = String(v || "").replace(/\s+/g, " ").trim();
  if (t.length < 2) throw Object.assign(new Error("Type a topic first, for example music videos."), { status: 400, code: "topic" });
  if (t.length > 200) throw Object.assign(new Error("Keep the topic under 200 characters."), { status: 400, code: "topic" });
  return t;
}

async function projectFiles(topic) {
  const out = [];
  let libs = [];
  try { libs = L.listLibraries(); } catch { return out; }
  for (const lib of libs) {
    try {
      const found = await L.search(lib.id, topic, { mode: "keyword", k: 5 });
      for (const hit of found.results || []) out.push(fromFile(hit));
    } catch { /* a library with no index is skipped */ }
  }
  return out;
}

function savedOutputs() {
  const out = [];
  try { for (const job of listJobs({})) if (job?.id) out.push(fromMedia(job)); } catch { /* media store not ready */ }
  try {
    for (const row of listArtifacts({})) {
      try { out.push(fromArtifact(getArtifact(row.id))); } catch { /* skip one bad row */ }
    }
  } catch { /* artifacts store not ready */ }
  return out;
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

async function collect(h, topic) {
  const names = Object.fromEntries(Object.entries(h.PROVIDERS || {}).map(([pid, p]) => [pid, p.name]));
  const runs = [];
  try {
    for (const m of h.ctx().store.listMissions((row) => row)) {
      const item = fromRun(m, names);
      if (item) runs.push(item);
    }
  } catch { /* no runs yet */ }
  const [files, drive] = await Promise.all([projectFiles(topic), driveItems(topic)]);
  const record = readRecord();
  const found = assemble({ runs, files, outputs: savedOutputs(), drive: drive.items, topic, record });
  const mode = h.settings?.().defaultMode || "balanced";
  return {
    topic,
    items: found.items.map(publicItem),
    plan: found.plan,
    skippedPrivate: found.skippedPrivate,
    drive: { connected: drive.connected, count: drive.items.length, error: drive.error, receives: false },
    whoWillRead: whoWillRead({ prompt: goalFrom(topic, found.plan), mode, record }),
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
      const found = await collect(h, topic);
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
