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
export function normalizeProjectUiMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (m === "expert" || m === "simple") return m;
  return null;
}
export function ensureSampleProject({ uiMode = "simple", force = false } = {}) {
  const d = data();
  const mode = normalizeProjectUiMode(uiMode) || "simple";
  const existingSample = d.projects.find((x) => x.id === "sample-project" || x.sample === true);
  if (existingSample && !force) return existingSample;
  if (d.projects.length === 1 && d.projects[0].id === "my-project" && !force) {
    d.projects[0] = {
      ...d.projects[0],
      uiMode: d.projects[0].uiMode || mode,
      sample: true,
      starterPrompt: d.projects[0].starterPrompt || "Plan three quick wins for this week and draft the first message.",
    };
    save();
    return d.projects[0];
  }
  return saveProject({
    id: "sample-project",
    name: "Sample project",
    color: "#22d3ee",
    kind: "company",
    summary: "Ready sample project created during setup. Try a prompt or add links to where your work lives.",
    uiMode: mode,
    sample: true,
    starterPrompt: "Plan three quick wins for this week and draft the first message.",
    categories: [{ id: "links", name: "Links", links: [] }],
  });
}
export function saveProject(p) {
  const d = data();
  if (p && "uiMode" in p) p = { ...p, uiMode: normalizeProjectUiMode(p.uiMode) };
  const i = d.projects.findIndex((x) => x.id === p.id);
  if (i >= 0) d.projects[i] = { ...d.projects[i], ...p };
  else d.projects.push({ ...p, id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), categories: p.categories || [] });
  save();
  return d.projects.find((x) => x.id === (p.id || d.projects[d.projects.length - 1].id));
}
export function deleteProject(id) {
  const d = data();
  d.projects = d.projects.filter((p) => p.id !== id);
  save();
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
