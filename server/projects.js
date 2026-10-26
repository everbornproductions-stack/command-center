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

export function saveProject(p) {
  const d = data();
  const id = p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const patch = { ...p };
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
