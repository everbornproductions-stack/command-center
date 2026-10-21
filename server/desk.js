// Home, private mode, who reads a prompt, backup file, project delete receipt,
// Do this again, Double-check this, tone, plain credits, and My chats.
// No keys in the backup file. Nothing here sends mail or spends without the route the person clicked.

import fs from "node:fs";
import { ctx } from "./store.js";
import { listProjects, deleteProject } from "./projects.js";
import { filesDir } from "./project-files.js";

export const BACKUP_FORMAT = "meldmind-backup";
export const BACKUP_VERSION = 1;

export const FIRST_COUNCIL = "A council sends your words to several AIs at once. Each one writes an answer. They read each other's answers and score them. One AI then writes a final answer from the strongest parts. You can see who wrote each part.";

export const PRIVATE_LINE = "Private mode is on. This stays on this computer. It is not used to teach the router, and it is left out of sync.";

export const TONES = [
  { id: "shorter", label: "Shorter", instruction: "Rewrite your last answer so it is shorter. Keep the facts. Do not add new claims." },
  { id: "warmer", label: "Warmer", instruction: "Rewrite your last answer in a warmer tone. Keep the facts. Do not add new claims." },
  { id: "direct", label: "More direct", instruction: "Rewrite your last answer so it is more direct. Keep the facts. Do not add new claims." },
  { id: "plain", label: "Plain words", instruction: "Rewrite your last answer in plain words. Keep the facts. Do not add new claims." },
];

const KEYISH = /sk-ant-|sk-proj-|sk-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{10,}|xai-[A-Za-z0-9]|gsk_[A-Za-z0-9]|ghp_[A-Za-z0-9]|github_pat_[A-Za-z0-9]|sb_secret|sb_publishable|eyJ[A-Za-z0-9_-]{10,}/;

export function writerLine(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  return `Written by ${n}.`;
}

export function plainMoney(n) {
  const v = Number(n) || 0;
  if (!Number.isFinite(v)) return "$0.00";
  if (v !== 0 && Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function plainCredits({ month = 0, today = 0, byProvider = {}, names = {} } = {}) {
  const rows = Object.entries(byProvider)
    .filter(([, b]) => (Number(b?.month) || 0) > 0 || (Number(b?.calls) || 0) > 0)
    .map(([id, b]) => {
      const name = names[id] || id;
      return { id, name, line: `${name} used about ${plainMoney(b.month)} this month.` };
    });
  return {
    line: `This month your AIs used about ${plainMoney(month)}. Today is about ${plainMoney(today)}.`,
    rows,
  };
}

export function chatRows(missions) {
  return (missions || [])
    .filter((m) => m && m.id && ["single", "council", "mission", "imported"].includes(m.kind))
    .map((m) => ({
      id: m.id,
      title: String(m.title || m.prompt || "Untitled chat").slice(0, 120),
      kind: m.kind,
      private: !!m.private,
      status: m.status || "",
      at: Number(m.finishedAt || m.startedAt || 0),
    }))
    .sort((a, b) => b.at - a.at);
}

export function returningUser({ missions, onboarded, keyed } = {}) {
  if ((missions || []).some((m) => m && m.id && m.kind)) return true;
  return !!(onboarded && keyed);
}

export function homeCard({ missions, projects, onboarded, keyed } = {}) {
  const show = returningUser({ missions, onboarded, keyed });
  if (!show) return { show: false, title: "", line: "", chats: [], projects: [] };
  const chats = chatRows(missions).slice(0, 8);
  return {
    show: true,
    title: "Welcome back",
    line: "Pick up a chat, or start a new one. Your projects are here too.",
    chats,
    projects: (projects || []).slice(0, 8).map((p) => ({ id: p.id, name: p.name || "Project" })),
  };
}

export function readersFor({ mode, names = [], planner = "" } = {}) {
  const who = [...names].map((n) => String(n || "").trim()).filter(Boolean);
  const unique = [...new Set(who)];
  if (mode === "mission") {
    const lead = planner || unique[0] || "";
    const rest = unique.filter((n) => n !== lead);
    const line = lead
      ? `${lead} will read the full prompt and write the plan.${rest.length ? ` These AIs may each read a step: ${rest.join(", ")}.` : ""}`
      : "No AI is connected yet. Add a key in Settings.";
    return { title: "Who will read this", line, readers: unique.map((name) => ({ name, role: name === lead ? "plan" : "step" })) };
  }
  const line = unique.length
    ? `These AIs will read your prompt: ${unique.join(", ")}.`
    : "No AI is connected yet. Add a key in Settings.";
  return { title: "Who will read this", line, readers: unique.map((name) => ({ name, role: "answer" })) };
}

export function repeatBody(run) {
  if (!run) return { error: "That chat was not found.", status: 404 };
  const projectId = run.projectId || null;
  const priv = !!run.private;
  if (run.kind === "single") {
    const prompt = String(run.prompt || "").trim();
    if (!prompt) return { error: "That chat has no prompt to repeat.", status: 400 };
    return { kind: "single", body: { prompt, projectId, provider: run.provider, model: run.model, mode: run.mode, private: priv } };
  }
  if (run.kind === "council") {
    const prompt = String(run.prompt || "").trim();
    if (!prompt) return { error: "That council has no prompt to repeat.", status: 400 };
    return { kind: "council", body: { prompt, projectId, mode: run.mode, qa: run.qa !== false, members: run.members, private: priv } };
  }
  if (run.kind === "mission") {
    const goal = String(run.goal || run.prompt || "").trim();
    if (!goal) return { error: "That mission has no prompt to repeat.", status: 400 };
    return { kind: "mission", body: { goal, projectId, mode: run.mode, qa: run.qa !== false, budgetUsd: run.budgetUsd, private: priv } };
  }
  return { error: "Do this again works on a chat, a council, or a mission.", status: 400 };
}

export function toneRequest(run, toneId) {
  const tone = TONES.find((t) => t.id === toneId);
  if (!tone) return { error: "Pick a tone.", status: 400 };
  if (!run) return { error: "That chat was not found.", status: 404 };
  if (run.kind === "single" && run.model) return { runId: run.id, text: tone.instruction, scope: "answer", target: run.model, label: tone.label };
  if (run.kind === "council") {
    const target = run.winner || run.chair?.model || run.members?.[0]?.model;
    if (target) return { runId: run.id, text: tone.instruction, scope: "answer", target, label: tone.label };
  }
  if (run.kind === "mission") {
    const task = (run.tasks || []).find((t) => t && t.output && t.id);
    if (task) return { runId: run.id, text: tone.instruction, scope: "answer", target: task.id, label: tone.label };
  }
  return { error: "There is no answer to restyle yet.", status: 400 };
}

export function writerOf(run) {
  if (!run) return null;
  if (run.kind === "single") {
    return { provider: run.provider || "", model: run.model || "", text: run.deliverable || "", prompt: run.prompt || "" };
  }
  if (run.kind === "council") {
    const key = run.winner || run.chair?.model;
    const answers = run.answers || {};
    const a = (key && answers[key]) || Object.values(answers).find((x) => x && x.text && !x.agent);
    if (!a && !run.verdict?.text) return null;
    return {
      provider: a?.provider || run.chair?.provider || "",
      model: a?.model || key || "",
      text: run.verdict?.text || a?.text || "",
      prompt: run.prompt || "",
    };
  }
  if (run.kind === "mission") {
    return {
      provider: run.assembler?.provider || run.tasks?.[0]?.provider || "",
      model: run.assembler?.model || run.tasks?.[0]?.model || "",
      text: run.deliverable || "",
      prompt: run.prompt || run.goal || "",
    };
  }
  return null;
}

export function secondReader(ranked, writerProvider) {
  return (ranked || []).find((m) => m && m.provider && m.provider !== writerProvider) || null;
}

function secretKey(key) {
  return /key|secret|token|password|anon/i.test(String(key || ""));
}

export function stripSettings(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (secretKey(k) || k === "cloud") continue;
    if (v && typeof v === "object") continue;
    out[k] = v;
  }
  return out;
}

function stripChat(m) {
  if (!m || typeof m !== "object") return null;
  const copy = JSON.parse(JSON.stringify(m));
  for (const k of Object.keys(copy)) if (secretKey(k)) delete copy[k];
  return copy;
}

export function backupDocument({ projects, chats, settings, now = new Date().toISOString() } = {}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    includesKeys: false,
    note: "One file for your projects, chats, and settings. AI keys are not in this file. Private chats are included and stay marked private.",
    projects: projects || [],
    chats: (chats || []).map(stripChat).filter(Boolean),
    settings: stripSettings(settings),
  };
}

export function assertNoKeys(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? {});
  if (KEYISH.test(raw)) {
    const e = new Error("This file looks like it contains a key. Meldmind will not restore it. Keys stay in the vault on this computer.");
    e.status = 400;
    e.code = "keys";
    throw e;
  }
}

export function readBackup(input) {
  let data = input;
  if (typeof input === "string") {
    try { data = JSON.parse(input); }
    catch {
      const e = new Error("That file is not a Meldmind backup.");
      e.status = 400;
      e.code = "format";
      throw e;
    }
  }
  if (!data || data.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION) {
    const e = new Error("That file is not a Meldmind backup.");
    e.status = 400;
    e.code = "format";
    throw e;
  }
  if (data.includesKeys) {
    const e = new Error("This backup says it includes keys. Meldmind will not restore a file that carries keys.");
    e.status = 400;
    e.code = "keys";
    throw e;
  }
  assertNoKeys(data);
  if (!Array.isArray(data.projects) || !Array.isArray(data.chats)) {
    const e = new Error("That backup is missing projects or chats.");
    e.status = 400;
    e.code = "format";
    throw e;
  }
  return data;
}

export function projectReceipt({ project, runs = [], files = [], removed = false } = {}) {
  if (!project) return null;
  const links = (project.categories || []).reduce((n, c) => n + ((c.links || []).length), 0);
  const titles = runs.map((r) => String(r.title || r.prompt || "Untitled chat").slice(0, 120));
  const fileNames = (files || []).map((f) => String(f)).slice(0, 40);
  const lines = [
    `Project: ${project.name || project.id}`,
    `${links} link${links === 1 ? "" : "s"} on this project.`,
    `${titles.length} chat${titles.length === 1 ? "" : "s"} stay in My chats and are no longer filed here.`,
    `${fileNames.length} project file${fileNames.length === 1 ? "" : "s"} ${removed ? "removed" : "will be removed"}.`,
    "AI keys were not touched.",
  ];
  return {
    projectId: project.id,
    name: project.name || project.id,
    links,
    chats: titles,
    files: fileNames,
    keptChats: true,
    keysTouched: false,
    removed: !!removed,
    lines,
  };
}

function projectFiles(id) {
  try {
    const dir = filesDir(id);
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f && f !== "." && f !== "..");
  } catch {
    return [];
  }
}

function runsFor(id) {
  try {
    return ctx().store.listMissions((m) => m).filter((m) => m && m.projectId === id);
  } catch {
    return [];
  }
}

export function projectRemoval(id, { remove = false } = {}) {
  const project = listProjects().find((p) => p.id === id);
  if (!project) {
    const e = new Error("project not found");
    e.status = 404;
    throw e;
  }
  const runs = runsFor(id);
  const files = projectFiles(id);
  const receipt = projectReceipt({ project, runs, files, removed: false });
  if (!remove) return receipt;
  const store = ctx().store;
  for (const m of runs) {
    m.projectId = null;
    try { store.saveMission(m); } catch { /* a chat that cannot be rewritten stays as it was */ }
  }
  try {
    const dir = filesDir(id);
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* the receipt still says the project card is gone */ }
  deleteProject(id);
  receipt.removed = true;
  receipt.lines = projectReceipt({ project, runs, files, removed: true }).lines;
  return receipt;
}
