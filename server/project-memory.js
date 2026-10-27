// Project memory (R5): brand voice, offers, never-say list, past winners and facts per project.
// The server adds it to every prompt run for that project (single chats, councils, missions, pipelines,
// schedules and queued off-peak runs), so the first answer already sounds like the project.
// Stored as the user's own document "memory.projects": { [projectId]: { voice, offers, never, winners, facts, updatedAt } }.
import fs from "node:fs";
import path from "node:path";
import { doc, putDoc } from "./store.js";
import { listProjects } from "./projects.js";
import { recallBlock, hasBlock } from "./memories.js";

export const KIND = "memory.projects";
export const FIELDS = ["voice", "offers", "never", "winners", "facts"];
export const LABELS = { voice: "Brand voice", offers: "Offers and calls to action", never: "Never say / never do", winners: "Past winners (what worked)", facts: "Facts to keep straight" };
export const MAX_FIELD = 4000;
// the header every memory block starts with; a prompt that already carries it is not given a second copy
export const MARKER = "PROJECT MEMORY for ";

const all = () => doc(KIND, () => ({}));
export const memoryOf = (projectId) => (projectId && all()[projectId]) || {};

export function saveMemory(projectId, patch = {}) {
  const d = all();
  const cur = d[projectId] || {};
  for (const f of FIELDS) if (typeof patch[f] === "string") cur[f] = patch[f].slice(0, MAX_FIELD);
  cur.updatedAt = Date.now();
  d[projectId] = cur;
  putDoc(KIND, d);
  return cur;
}

export function contextFor(projectId, query = "") {
  const m = memoryOf(projectId);
  const parts = FIELDS.filter((f) => typeof m[f] === "string" && m[f].trim()).map((f) => `${LABELS[f].toUpperCase()}:\n${m[f].trim()}`);
  const proj = listProjects().find((p) => p.id === projectId);
  const block = parts.length ? `${MARKER}${proj?.name || projectId} (follow this; it overrides generic defaults):\n${parts.join("\n\n")}` : "";
  // 0.4.21 Memories: what the user told Meldmind to keep (About me, This project, Knowledge)
  const recalled = recallBlock(query, projectId);
  return [block, recalled].filter(Boolean).join("\n\n");
}

// Appends the project's memory and the recalled memories to a prompt or context once each.
// query is what the memories are matched against (default: the text itself).
export function withMemory(text, projectId, query) {
  const t = text || "";
  const q = query === undefined ? t : query;
  let out = t;
  const proj = contextFor(projectId, q);
  if (!proj) return t;
  // each half is added once: a prompt that already carries the project block or the recall block keeps it as is
  const pm = proj.includes(MARKER) ? proj.slice(proj.indexOf(MARKER)).split(/\n\n(?=WHAT I REMEMBER)/)[0] : "";
  const rb = proj.includes("WHAT I REMEMBER") ? proj.slice(proj.indexOf("WHAT I REMEMBER")) : "";
  const add = [pm && !out.includes(MARKER) ? pm : "", rb && !hasBlock(out) ? rb : ""].filter(Boolean).join("\n\n");
  if (!add) return t;
  return out ? `${out}\n\n${add}` : add;
}

// true when the text carries any memory block (project notes or recalled memories)
export const carriesMemory = (text) => String(text || "").includes(MARKER) || hasBlock(text);

// A thumbs-up result kept as a past winner: one short dated line, newest first, within the field limit.
export function addWinner(projectId, line) {
  const clean = String(line || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!projectId || !clean) return null;
  const cur = memoryOf(projectId).winners || "";
  if (cur.split("\n").some((l) => l.includes(clean))) return memoryOf(projectId);
  const entry = `- ${new Date().toISOString().slice(0, 10)}: ${clean}`;
  let next = cur.trim() ? `${entry}\n${cur.trim()}` : entry;
  while (next.length > MAX_FIELD && next.includes("\n")) next = next.slice(0, next.lastIndexOf("\n"));
  return saveMemory(projectId, { winners: next });
}

// ---------- HQ client-file importer ----------
// Sorts the sections of an HQ markdown brief into the memory fields by their headings; anything else is a fact.
const SECTION_RULES = [
  ["never", /never|don'?t|do not|avoid|compliance|guardrail|rules|banned|forbidden/i],
  ["voice", /voice|tone|style|brand|personality|how (we|they) (talk|sound|write)/i],
  ["offers", /offer|pricing|price|package|service|call to action|\bcta\b|tier/i],
  ["winners", /winner|what worked|wins\b|results|proof|case stud|best perform/i],
];
export function sortSections(md) {
  const out = Object.fromEntries(FIELDS.map((f) => [f, []]));
  let field = "facts", buf = [];
  const flush = () => { const body = buf.join("\n").trim(); if (body) out[field].push(body); buf = []; };
  for (const line of String(md || "").split(/\r?\n/)) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      field = h[0].startsWith("# ") ? "facts" : SECTION_RULES.find(([, re]) => re.test(h[1]))?.[0] || "facts";
      buf.push(line.trim());
    } else buf.push(line);
  }
  flush();
  return Object.fromEntries(FIELDS.map((f) => [f, out[f].join("\n\n").slice(0, MAX_FIELD)]));
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
export function hqFilesFor(hqDir, project) {
  if (!hqDir || !project) return [];
  const slug = String(project.hqClient || project.id || "");
  const list = [];
  if (SLUG.test(slug)) list.push(path.join(hqDir, "company", "clients", `${slug}.md`));
  if (project.id === "everborn" || project.hqClient === "everborn") list.push(path.join(hqDir, "company", "everborn.md"));
  return list;
}

// Fills each field from the HQ file when the field is empty or still holds exactly what the last import
// wrote. Anything the person typed or edited is kept.
export function importHq(hqDir, projectId) {
  const proj = listProjects().find((x) => x.id === projectId);
  if (!proj) { const e = new Error("project not found"); e.status = 404; throw e; }
  const candidates = hqFilesFor(hqDir, proj);
  const found = candidates.filter((f) => fs.existsSync(f));
  if (!found.length) { const e = new Error(`No HQ file for this project (looked for ${candidates.map((c) => path.basename(c)).join(", ") || "a client slug"})`); e.status = 404; throw e; }
  const sorted = sortSections(found.map((f) => fs.readFileSync(f, "utf8")).join("\n\n"));
  const d = all();
  const cur = d[projectId] || {};
  const prev = cur.importedText || {};
  const imported = {}, kept = [];
  for (const f of FIELDS) {
    if (!sorted[f]) continue;
    const mine = (cur[f] || "").trim();
    if (!mine || mine === (prev[f] || "").trim()) { cur[f] = sorted[f]; imported[f] = sorted[f]; }
    else kept.push(f);
  }
  d[projectId] = { ...cur, importedText: { ...prev, ...imported }, importedFrom: found.map((f) => path.basename(f)), importedAt: Date.now(), updatedAt: Date.now() };
  putDoc(KIND, d);
  return { ...d[projectId], filled: Object.keys(imported), kept };
}
