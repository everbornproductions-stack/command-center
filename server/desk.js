// Home, private mode, who reads a prompt, backup file, project delete receipt,
// Do this again, Double-check this, tone, plain credits, and My chats.
// No keys in the backup file. Nothing here sends mail or spends without the route the person clicked.

import fs from "node:fs";
import { ctx } from "./store.js";
import { listProjects, deleteProject } from "./projects.js";
import { filesDir } from "./project-files.js";
import { PROVIDERS } from "./registry.js";

export const BACKUP_FORMAT = "meldmind-backup";
export const BACKUP_VERSION = 1;

export const FIRST_COUNCIL = "A council sends your words to several AIs at once. Each one writes an answer. They read each other's answers and score them. One AI then writes a final answer from the strongest parts. You can see who wrote each part.";

export const PRIVATE_LINE = "Private mode is on. This stays on this computer. It is not used to teach the router, and it is left out of sync.";

export const TONES = [
  { id: "shorter", label: "Shorter", instruction: "Write the next answer so it is shorter. Keep the facts. Do not add new claims. Do not send, post, or buy anything." },
  { id: "warmer", label: "Warmer", instruction: "Write the next answer in a warmer tone. Keep the facts. Do not add new claims. Do not send, post, or buy anything." },
  { id: "direct", label: "More direct", instruction: "Write the next answer so it is more direct. Keep the facts. Do not add new claims. Do not send, post, or buy anything." },
  { id: "plain", label: "Plain words", instruction: "Write the next answer in plain words. Keep the facts. Do not add new claims. Do not send, post, or buy anything." },
];

export const RECEIPT_FILE = "meldmind-receipt.txt";

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

function groupDigits(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// A balance Phase 25 already stored. Empty string means nothing was reported. Never invent a number.
export function balanceWords(balance) {
  if (!balance || typeof balance !== "object") return "";
  if (balance.unit === "characters" && balance.limit != null && balance.used != null) {
    const left = Number(balance.limit) - Number(balance.used);
    if (!Number.isFinite(left)) return "";
    return `${groupDigits(Math.max(0, Math.round(left)))} characters left`;
  }
  if (balance.left == null || balance.left === "") return "";
  const n = Number(balance.left);
  if (!Number.isFinite(n)) return "";
  if (!balance.unit || balance.unit === "USD") return `about ${plainMoney(n)} left`;
  return `about ${n} ${balance.unit} left`;
}

export function plainCredits({ month = 0, today = 0, byProvider = {}, names = {}, balances = null } = {}) {
  const rows = Object.entries(byProvider)
    .filter(([, b]) => (Number(b?.month) || 0) > 0 || (Number(b?.calls) || 0) > 0)
    .map(([id, b]) => {
      const name = names[id] || id;
      return { id, name, line: `${name} used about ${plainMoney(b.month)} this month.` };
    });
  const left = balances && typeof balances === "object"
    ? Object.entries(balances).map(([id, balance]) => {
      const name = names[id] || id;
      const words = balanceWords(balance);
      return { id, name, line: words ? `${name} has ${words}.` : `No remaining balance is reported for ${name}.` };
    })
    : [];
  return {
    line: `This month your AIs used about ${plainMoney(month)}. Today is about ${plainMoney(today)}.`,
    rows,
    left,
  };
}

// Connected AIs only (a grey light is no key). Balances come from health, including a null balance.
export function creditsView({ ledger = {}, statuses = {}, providers = {} } = {}) {
  const names = {};
  const balances = {};
  for (const [id, p] of Object.entries(providers || {})) {
    if (!p) continue;
    names[id] = p.name || id;
    const st = statuses[id];
    if (!st || st.status === "grey") continue;
    balances[id] = st.balance ?? null;
  }
  return plainCredits({ month: ledger.month, today: ledger.today, byProvider: ledger.byProvider, names, balances });
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

function seatFrom(names, readers) {
  if (Array.isArray(readers) && readers.length) {
    const seen = new Set();
    const out = [];
    for (const r of readers) {
      const name = String(r?.name || "").trim();
      const id = String(r?.id || "").trim();
      const key = id || name;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ id, name });
    }
    return out;
  }
  const unique = [...new Set((names || []).map((n) => String(n || "").trim()).filter(Boolean))];
  return unique.map((name) => ({ id: "", name }));
}

function namedRows(items, pick) {
  return (items || []).map(pick).filter((row) => row && row.name);
}

// The first `limit` seats, then drop anyone the person removed. The next AI is not pulled in.
export function takeMembers(ranked, { limit = 4, skip = [] } = {}) {
  const gone = new Set((Array.isArray(skip) ? skip : []).map((s) => String(s || "").trim()).filter(Boolean));
  const seen = new Set();
  const offered = [];
  const cap = Math.max(0, Number(limit) || 0);
  for (const m of ranked || []) {
    if (!m?.provider || seen.has(m.provider)) continue;
    seen.add(m.provider);
    offered.push(m);
    if (offered.length >= cap) break;
  }
  return offered.filter((m) => !gone.has(m.provider)).map((m) => ({ provider: m.provider, model: m.model }));
}

// Only real provider ids. A client cannot name a model to force a seat.
export function cleanSkip(skip) {
  const known = new Set(Object.keys(PROVIDERS));
  const out = [];
  for (const raw of Array.isArray(skip) ? skip : []) {
    const id = String(raw || "").trim();
    if (!known.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= 12) break;
  }
  return out;
}

// Every model of a removed provider, so a fallback cannot hand them the prompt.
export function skipAvoid(skip) {
  const out = [];
  for (const id of Array.isArray(skip) ? skip : []) {
    const p = PROVIDERS[id];
    if (!p) continue;
    const models = p.models || [];
    if (!models.length) out.push({ provider: id, model: id });
    for (const m of models) if (m?.id) out.push({ provider: id, model: m.id });
  }
  return out;
}

export function readersFor({ mode, names = [], planner = "", readers, tools, services } = {}) {
  const seats = seatFrom(names, readers);
  const toolRows = namedRows(tools, (t) => {
    const name = String(t?.name || t?.tool?.name || "").trim();
    if (!name) return null;
    const server = String(t?.server?.name || (typeof t?.server === "string" ? t.server : "") || "").trim();
    return { name, server };
  });
  const serviceRows = namedRows(services, (s) => {
    const name = String(s?.name || "").trim();
    if (!name) return null;
    return { id: String(s?.id || ""), name };
  });
  const toolsLine = toolRows.length
    ? `These tools can be used: ${toolRows.map((t) => (t.server ? `${t.name} (${t.server})` : t.name)).join(", ")}.`
    : "No tools are on.";
  const servicesLine = serviceRows.length
    ? `These connected services will receive the prompt: ${serviceRows.map((s) => s.name).join(", ")}.`
    : "No connected service will receive this prompt.";
  const extra = { tools: toolRows, toolsLine, services: serviceRows, servicesLine };
  if (mode === "mission") {
    const lead = planner || seats[0]?.name || "";
    const rest = seats.map((s) => s.name).filter((n) => n !== lead);
    const line = lead
      ? `${lead} will read the full prompt and write the plan.${rest.length ? ` These AIs may each read a step: ${rest.join(", ")}.` : ""}`
      : "No AI is connected yet. Add a key in Settings.";
    return { title: "Who will read this", line, readers: seats.map((s) => ({ ...s, role: s.name === lead ? "plan" : "step" })), ...extra };
  }
  const unique = seats.map((s) => s.name);
  const line = unique.length
    ? `These AIs will read your prompt: ${unique.join(", ")}.`
    : "No AI is connected yet. Add a key in Settings.";
  return { title: "Who will read this", line, readers: seats.map((s) => ({ ...s, role: "answer" })), ...extra };
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
  const id = typeof run === "string" ? run : toneId;
  const tone = TONES.find((t) => t.id === id);
  if (!tone) return { error: "Pick a tone.", status: 400 };
  return { text: tone.instruction, label: tone.label, tone: tone.id };
}

// A click sets the next answer only. The same tone again, or an empty tone, clears it. Nothing is sent.
export function armTone(current, toneId) {
  if (toneId == null || toneId === "" || toneId === false) {
    return { nextTone: null, label: "", line: "The next answer will use the usual tone." };
  }
  const tone = TONES.find((t) => t.id === toneId);
  if (!tone) return { error: "Pick a tone.", status: 400 };
  if (current === tone.id) {
    return { nextTone: null, label: tone.label, cleared: true, line: `${tone.label} is off. The next answer will use the usual tone.` };
  }
  return { nextTone: tone.id, label: tone.label, line: `Next answer: ${tone.label}. This does not send anything.` };
}

export function consumeTone(settings) {
  const tone = TONES.find((t) => t.id === settings?.nextTone) || null;
  if (!tone) return { tone: null, settings };
  return { tone, settings: { ...settings, nextTone: null } };
}

export function toneAdd(system, instruction) {
  const extra = String(instruction || "").trim();
  if (!extra) return system || "";
  return `${system || ""}\n\n${extra}`.trim();
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

export function receiptFile(receipt) {
  const lines = Array.isArray(receipt?.lines) ? receipt.lines : [];
  return { name: RECEIPT_FILE, text: `${lines.join("\n")}${lines.length ? "\n" : ""}` };
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

export function projectRemoval(id, { remove = false, project: given = null } = {}) {
  const project = given || listProjects().find((p) => p.id === id);
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
  receipt.file = receiptFile(receipt);
  return receipt;
}
