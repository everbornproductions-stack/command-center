// Projects hub: every project has categories (Social Posts, Music Videos, Website, Client Work...)
// with clickable links to where the work lives (YouTube, Instagram, GHL, Cloudflare...).
// Every new user, desktop or hosted, starts with one empty project. The owner's own projects are
// not shipped with the app; an import example lives in docs/owner-seed.example.json (not bundled).
// The optional HQ adapter reads <CC_HQ_DIR>/hq/state.json (task board) and
// <CC_HQ_DIR>/studio/credit-log.csv (media credits) and is only active when CC_HQ_DIR points somewhere.
import fs from "node:fs";
import path from "node:path";
import { HQ_DIR, readJson } from "./paths.js";
import { HOSTED, doc, putDoc } from "./store.js";

const SEED = { projects: [{ id: "my-project", name: "My project", color: "#22d3ee", kind: "company", summary: "Rename me in Projects, then add links to where the work lives.", categories: [{ id: "links", name: "Links", links: [] }] }] };
const data = () => doc("projects", () => structuredClone(SEED));
const save = () => putDoc("projects", data());
export function loadProjects() { return data(); }
export const listProjects = () => data().projects;
export function saveProject(p) {
  const d = data();
  const i = d.projects.findIndex((x) => x.id === p.id);
  if (i >= 0) d.projects[i] = { ...d.projects[i], ...p };
  else d.projects.push({ ...p, id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), categories: p.categories || [] });
  save();
  return d.projects.find((x) => x.id === (p.id || d.projects[d.projects.length - 1].id));
}
export function deleteProject(id) {
  const d = data();
  d.projects = d.projects.filter((p) => p.id !== id);
  if (Array.isArray(d.recentlyDeleted)) d.recentlyDeleted = d.recentlyDeleted.filter((e) => e.project?.id !== id);
  save();
}

// ---------- Recently Deleted (soft delete) ----------
// A deleted project moves to recentlyDeleted with a time stamp. It leaves listProjects(), so Live,
// pickers and the Free project count stop seeing it. Runs and files are not touched until it is
// removed for good (by the owner, or after KEEP_DAYS).
export const KEEP_DAYS = 30;
export function trashProject(id, now = Date.now()) {
  const d = data();
  const p = d.projects.find((x) => x.id === id);
  if (!p) return null;
  d.projects = d.projects.filter((x) => x.id !== id);
  d.recentlyDeleted = (d.recentlyDeleted || []).filter((e) => e.project?.id !== id);
  d.recentlyDeleted.push({ deletedAt: now, project: p });
  save();
  return { id: p.id, name: p.name, deletedAt: now };
}
export function listDeleted() {
  return (data().recentlyDeleted || []).map((e) => ({ id: e.project.id, name: e.project.name, color: e.project.color, deletedAt: e.deletedAt, expiresAt: e.deletedAt + KEEP_DAYS * 86400000 }));
}
export function deletedProject(id) {
  return (data().recentlyDeleted || []).find((e) => e.project?.id === id)?.project || null;
}
export function restoreProject(id) {
  const d = data();
  const e = (d.recentlyDeleted || []).find((x) => x.project?.id === id);
  if (!e) return null;
  if (d.projects.some((x) => x.id === id)) { const err = new Error("A project with that id already exists."); err.status = 409; throw err; }
  const taken = new Set(d.projects.map((x) => String(x.name || "").trim().toLowerCase()));
  const p = { ...e.project };
  if (taken.has(String(p.name || "").trim().toLowerCase())) p.name = `${p.name} (restored)`;
  d.recentlyDeleted = d.recentlyDeleted.filter((x) => x !== e);
  d.projects.push(p);
  save();
  return p;
}
export function expiredDeleted(now = Date.now()) {
  return (data().recentlyDeleted || []).filter((e) => now - e.deletedAt > KEEP_DAYS * 86400000).map((e) => e.project.id);
}
export function addLink(projectId, categoryId, link) {
  const p = data().projects.find((x) => x.id === projectId);
  if (!p) throw new Error("project not found");
  let c = p.categories.find((x) => x.id === categoryId);
  if (!c) { c = { id: categoryId, name: categoryId, links: [] }; p.categories.push(c); }
  c.links.push({ name: link.name, url: link.url });
  save();
  return p;
}
export function removeLink(projectId, categoryId, url) {
  const p = data().projects.find((x) => x.id === projectId);
  const c = p?.categories.find((x) => x.id === categoryId);
  if (c) c.links = c.links.filter((l) => l.url !== url);
  save();
  return p;
}

// ---------- HQ adapter (optional, local PC only, needs CC_HQ_DIR) ----------
export function hqSnapshot() {
  // the HQ folder is a local-PC feature; a hosted hub has no such folder, and nothing is guessed
  if (HOSTED || !HQ_DIR) return { available: false, dir: HQ_DIR || null, tasks: [], decisions: [], agents: [], credits: null, updated: null };
  const stateFile = path.join(HQ_DIR, "hq", "state.json");
  const creditFile = path.join(HQ_DIR, "studio", "credit-log.csv");
  const out = { available: fs.existsSync(stateFile), dir: HQ_DIR, tasks: [], decisions: [], agents: [], credits: null, updated: null };
  if (out.available) {
    const st = readJson(stateFile, {});
    out.updated = st.updated || null;
    out.tasks = (st.tasks || []).filter((t) => t.status !== "done").map((t) => ({ id: t.id, title: t.title, owner: t.owner, client: t.client, status: t.status, priority: t.priority, due: t.due || null }));
    out.decisions = (st.decisions_for_chris || []).filter((d) => d.status === "open").map((d) => ({ id: d.id, question: d.question, recommendation: d.recommendation, date: d.date }));
    out.agents = (st.agents || []).map((a) => ({ id: a.id, name: a.name, dept: a.dept, status: a.status, current: (a.current || []).length }));
  }
  if (fs.existsSync(creditFile)) {
    const lines = fs.readFileSync(creditFile, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    const head = lines.shift().split(",");
    const idx = (n) => head.indexOf(n);
    const byTool = {}, byProject = {}, byDay = {};
    let total = 0, rows = 0;
    for (const line of lines) {
      const cells = splitCsv(line);
      const credits = Number(cells[idx("credits")] || 0);
      if (!credits) continue;
      rows++; total += credits;
      const tool = cells[idx("tool")] || "?", proj = cells[idx("project")] || "?", day = cells[idx("date")] || "?";
      byTool[tool] = (byTool[tool] || 0) + credits;
      byProject[proj] = (byProject[proj] || 0) + credits;
      byDay[day] = (byDay[day] || 0) + credits;
    }
    out.credits = { total, rows, byTool, byProject, byDay, file: creditFile };
  }
  return out;
}
function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
