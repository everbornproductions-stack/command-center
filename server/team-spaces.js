// Phase 61 add-on. Shared recipes on a workspace, for Extreme.
// Phase 8 workspaces are not rebuilt. Invite links stay as they are (shown once, not emailed).
// Keys stay in the vault. A shared recipe is the steps only.
import { doc, putDoc } from "./store.js";
import { gate, TEAM_SEATS } from "./feature-gate.js";
import { findPipeline } from "./plugins/pipelines.js";
import { list as listKeys } from "./workspace-keys.js";
import { scrubText } from "./prompts/safety.js";

const DOC = "teamspaces.recipes";

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

function recipesDoc() {
  const d = doc(DOC, () => ({ byWorkspace: {} }));
  if (!d.byWorkspace || typeof d.byWorkspace !== "object") d.byWorkspace = {};
  return d;
}

function workspaces() {
  return doc("workspaces", () => ({ list: [] })).list || [];
}

export function seatCount(ws) {
  const members = Array.isArray(ws?.members) ? ws.members.length : 0;
  return members + 1;
}

function cleanText(value) {
  let text = scrubText(String(value ?? "")).text;
  text = text.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+)\b/g, "[REDACTED]");
  return text;
}

function snapshot(pipe) {
  return {
    pipelineId: pipe.id,
    name: cleanText(pipe.name || "Recipe"),
    description: cleanText(pipe.description || ""),
    inputs: (pipe.inputs || []).map((i) => ({
      key: cleanText(i.key || ""),
      label: cleanText(i.label || ""),
      placeholder: cleanText(i.placeholder || ""),
    })),
    steps: (pipe.steps || []).map((s) => ({
      title: cleanText(s.title || ""),
      instructions: cleanText(s.instructions || ""),
      deliverable: cleanText(s.deliverable || ""),
    })),
  };
}

function workspaceOrThrow(wsId) {
  const w = workspaces().find((x) => x.id === wsId);
  if (!w) throw err(404, "Workspace not found.");
  return w;
}

export async function teamView() {
  const open = gate("teamSpaces");
  const saved = recipesDoc().byWorkspace;
  const list = [];
  for (const w of workspaces()) {
    const seats = seatCount(w);
    let keys = [];
    try {
      keys = (await listKeys(w.id)).map((k) => ({ provider: k.provider, masked: k.masked }));
    } catch { keys = []; }
    list.push({
      id: w.id,
      name: w.name,
      seats,
      seatCap: TEAM_SEATS,
      overCap: seats > TEAM_SEATS,
      recipes: saved[w.id] || [],
      keys,
    });
  }
  return {
    open: true,
    tier: open.tier,
    seatCap: TEAM_SEATS,
    note: "Shared recipes stay with the workspace on this PC. Keys stay in the vault. Invite links are still shown once and nothing is emailed. Team spaces are part of Extreme. Nothing is charged from here.",
    workspaces: list,
  };
}

export function saveSharedRecipe(wsId, pipelineId) {
  const w = workspaceOrThrow(wsId);
  gate("teamSeats", { count: seatCount(w) });
  const pipe = findPipeline({ doc }, pipelineId);
  if (!pipe) throw err(404, "Recipe not found.");
  const snap = snapshot(pipe);
  const d = recipesDoc();
  const rows = d.byWorkspace[wsId] || [];
  const id = `r-${Date.now().toString(36)}`;
  const row = { id, sharedAt: Date.now(), ...snap };
  d.byWorkspace[wsId] = [row, ...rows.filter((x) => x.pipelineId !== pipe.id)].slice(0, 40);
  putDoc(DOC, d);
  return { recipe: row, seats: seatCount(w), seatCap: TEAM_SEATS };
}

export function removeSharedRecipe(wsId, recipeId) {
  workspaceOrThrow(wsId);
  gate("teamSpaces");
  const d = recipesDoc();
  const before = d.byWorkspace[wsId] || [];
  d.byWorkspace[wsId] = before.filter((x) => x.id !== recipeId);
  if (d.byWorkspace[wsId].length === before.length) throw err(404, "Shared recipe not found.");
  putDoc(DOC, d);
  return { ok: true };
}
