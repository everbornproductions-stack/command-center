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

function wouldCycle(projects, id, parentId) {
  if (!parentId || !id) return false;
  if (id === parentId) return true;
  const visited = new Set([id]);
  let cur = parentId;
  while (cur) {
    if (visited.has(cur)) return true;
    visited.add(cur);
    const found = projects.find((x) => x.id === cur);
    cur = found?.parentId || null;
  }
  return false;
}

// One status vocabulary for projects (0.4.20, I12): shown as colored chips on cards and on the detail page.
export const PROJECT_STATUSES = ["Draft", "Review", "Approved", "Scheduled", "Published"];
export function saveProject(p) {
  // 0.4.21 (F18): "Unfiled" is the hub's own shelf for work with no project, so no project may take that name.
  if (p.name !== undefined && /^\s*unfiled\s*$/i.test(String(p.name))) throw new Error("\"Unfiled\" is the shelf for work with no project. Pick another name.");
  if (p.id && String(p.id).toLowerCase() === "unfiled") throw new Error("\"Unfiled\" is the shelf for work with no project. Pick another name.");
  const d = data();
  const id = p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const patch = { ...p };
  if (patch.status !== undefined) {
    const hit = PROJECT_STATUSES.find((x) => x.toLowerCase() === String(patch.status || "").trim().toLowerCase());
    if (hit) patch.status = hit; else delete patch.status;
  }
  if (patch.parentId !== undefined) {
    const pid = patch.parentId ? String(patch.parentId).trim() : null;
    if (pid && wouldCycle(d.projects, id, pid)) {
      throw new Error("A project cannot be its own parent.");
    }
    patch.parentId = pid || null;
  }
  const i = d.projects.findIndex((x) => x.id === p.id);
  if (i >= 0) d.projects[i] = { ...d.projects[i], ...patch };
  else d.projects.push({ ...patch, id, categories: patch.categories || [] });
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
  for (const p of d.projects) {
    if (p.parentId === id) p.parentId = null;
  }
  save();
}
export function listSubProjects(parentId) {
  if (!parentId) return [];
  return data().projects.filter((p) => p.parentId === parentId);
}
export function projectTree() {
  const all = data().projects;
  const byParent = new Map();
  for (const p of all) {
    const key = p.parentId || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(p);
  }
  const buildNode = (proj, seen = new Set()) => {
    if (seen.has(proj.id)) return { ...proj, subProjects: [] };
    const nextSeen = new Set(seen);
    nextSeen.add(proj.id);
    const children = (byParent.get(proj.id) || []).map((c) => buildNode(c, nextSeen));
    return { ...proj, subProjects: children };
  };
  return (byParent.get(null) || []).map((root) => buildNode(root));
}
export function expandProject(projectId, extra = {}) {
  const p = data().projects.find((x) => x.id === projectId);
  if (!p) return null;
  const subProjects = listSubProjects(projectId);
  const allLinks = (p.categories || []).flatMap((c) => (c.links || []).map((l) => ({ ...l, categoryId: c.id, categoryName: c.name })));
  const walks = Array.isArray(extra.walks)
    ? extra.walks.filter((w) => w.projectId === projectId)
    : (doc("walkthrough.items", () => ({ items: [] }))?.items || []).filter((w) => w.projectId === projectId);
  const missions = Array.isArray(extra.missions) ? extra.missions.filter((m) => m.projectId === projectId) : [];

  const prompts = [
    ...missions.map((m) => ({ id: m.id, kind: m.kind || "run", title: m.title || m.prompt || "Run", status: m.status || "done" })),
    ...walks.filter((w) => w.idea).map((w) => ({ id: w.id, kind: "walkthrough", title: w.plan?.title || w.idea.slice(0, 80), stage: w.stage, status: w.status || "ready" })),
    ...(Array.isArray(p.prompts) ? p.prompts : []),
  ];
  const images = [
    ...allLinks.filter((l) => /image|photo|thumbnail|art|design|figma|canva/i.test(`${l.categoryName} ${l.name} ${l.url}`)),
    ...(Array.isArray(extra.images) ? extra.images : []),
    ...(Array.isArray(p.images) ? p.images : []),
  ];
  const videos = [
    ...allLinks.filter((l) => /video|youtube|vimeo|tiktok|reel|kling|runway|clip/i.test(`${l.categoryName} ${l.name} ${l.url}`)),
    ...(Array.isArray(extra.videos) ? extra.videos : []),
    ...(Array.isArray(p.videos) ? p.videos : []),
  ];
  const automations = [
    ...allLinks.filter((l) => /automation|workflow|zapier|make|n8n|highlevel|ghl|schedule/i.test(`${l.categoryName} ${l.name} ${l.url}`)),
    ...(Array.isArray(extra.automations) ? extra.automations : []),
    ...(Array.isArray(p.automations) ? p.automations : []),
  ];
  const documents = [
    ...walks.filter((w) => w.deliverable).map((w) => ({ id: w.id, title: w.plan?.title || w.type, preview: String(w.deliverable).slice(0, 200) })),
    ...allLinks.filter((l) => /doc|plan|sheet|notion|drive|deliverable|copy/i.test(`${l.categoryName} ${l.name} ${l.url}`)),
    ...(Array.isArray(extra.documents) ? extra.documents : []),
    ...(Array.isArray(p.documents) ? p.documents : []),
  ];
  return {
    id: p.id,
    name: p.name,
    parentId: p.parentId || null,
    subProjects: subProjects.map((s) => ({ id: s.id, name: s.name, summary: s.summary || "", color: s.color || "#22d3ee", parentId: s.parentId })),
    prompts,
    images,
    videos,
    automations,
    documents,
    counts: {
      prompts: prompts.length,
      images: images.length,
      videos: videos.length,
      automations: automations.length,
      documents: documents.length,
      subProjects: subProjects.length,
    },
  };
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
    out.tasks = (st.tasks || []).filter((t) => t.status !== "done").map((t) => ({ id: t.id, title: plainPaths(t.title), owner: t.owner, client: t.client, status: t.status, priority: t.priority, due: t.due || null }));
    out.decisions = (st.decisions_for_chris || []).filter((d) => d.status === "open").map((d) => ({ id: d.id, question: plainPaths(d.question), recommendation: d.recommendation == null ? d.recommendation : plainPaths(d.recommendation), date: d.date }));
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
// Raw file paths (temp folders, drive letters, home folders) mean nothing to a person reading a question.
export function plainPaths(text) {
  return String(text ?? "")
    .replace(/[A-Za-z]:\\[^\s"'<>|,;)]+/g, "a file on this computer")
    .replace(/(?:\/tmp|\/var\/folders|\/home\/[^\s/]+|\/Users\/[^\s/]+)(?:\/[^\s"'<>|,;)]+)*/g, "a file on this computer");
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
