// Remix any app (Phase 96). Preview first. A click saves the project and the CREDITS file.
// The address is never opened. Installed files are never read. Nothing is posted.
import fs from "node:fs";
import path from "node:path";
import { SCRATCH_NOTE, SOURCES, CATALOG, MOD_TOOLS, planRemix, recipients, publicRun, suggest, library, shareTotals } from "../remix.js";
import { remixGate, countRemixMonth, REMIX_PRO_CAP } from "../feature-gate.js";
import { rate as rateBrain, brainSettings } from "../brain.js";

export const id = "remix";
const KIND = "remix.runs";

function runsOf(h) {
  const d = h.doc(KIND, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  return d;
}
function tierOf(h) {
  try { return h.licenseState().tier || "free"; } catch { return "free"; }
}
function optedIn() {
  try { return !!brainSettings().shareOptIn; } catch { return false; }
}
function ranked(h) {
  try {
    return (h.rank({ capability: "code", difficulty: 2, mode: "economy", estIn: 700, estOut: 500 }) || []).slice(0, 4);
  } catch { return []; }
}
function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function creditsFile(dir, projectId) {
  const folder = path.join(dir, "projects", projectId);
  return { folder, file: path.join(folder, "CREDITS.md"), rel: `projects/${projectId}/CREDITS.md` };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/remix/, "") || "/";
  const items = () => runsOf(h).items.map(publicRun);
  const gate = () => remixGate({ tier: tierOf(h), used: countRemixMonth(items()) });

  if (req.method === "GET" && (p === "" || p === "/")) {
    return h.json(res, 200, {
      scratchNote: SCRATCH_NOTE,
      sources: Object.entries(SOURCES).map(([sid, s]) => ({ id: sid, label: s.label, detail: s.detail })),
      catalog: CATALOG.map((c) => ({ id: c.id, name: c.name, kind: c.kind, license: c.license, url: c.url, note: c.note, defaultFor: c.defaultFor || [] })),
      mods: MOD_TOOLS.map((m) => ({ id: m.id, name: m.name, tool: m.tool, note: m.note })),
      gate: gate(),
      library: library(items()),
      runs: items().slice(0, 20),
      proCap: REMIX_PRO_CAP,
      share: shareTotals(items(), { optedIn: optedIn() }),
    });
  }

  if (req.method === "GET" && p === "/gate") return h.json(res, 200, gate());

  if (req.method === "GET" && p.startsWith("/credits/")) {
    const projectId = p.slice("/credits/".length);
    if (!/^remix-[a-z0-9]+$/.test(projectId)) return h.json(res, 404, { error: "That remix project was not found.", code: "missing" });
    if (!items().some((r) => r.projectId === projectId)) return h.json(res, 404, { error: "That remix project was not found.", code: "missing" });
    if (h.HOSTED || !h.DATA_DIR) return h.json(res, 200, { projectId, creditsText: "", creditsFile: null });
    const file = creditsFile(h.DATA_DIR, projectId).file;
    if (!fs.existsSync(file)) return h.json(res, 404, { error: "CREDITS was not written for that project.", code: "missing" });
    return h.json(res, 200, { projectId, creditsFile: `projects/${projectId}/CREDITS.md`, creditsText: fs.readFileSync(file, "utf8") });
  }

  if (req.method === "POST" && (p === "/preview" || p === "/run")) {
    const learned = suggest(items(), body?.appType);
    const plan = planRemix(body || {}, { learned });
    if (!plan.ok) return h.json(res, 400, { error: plan.error, code: plan.code, scratchNote: SCRATCH_NOTE });
    const g = gate();
    const who = recipients({ models: ranked(h), source: plan.sourceKind });
    const share = shareTotals(items(), { optedIn: optedIn() });
    if (p === "/preview") {
      return h.json(res, 200, {
        ran: false,
        scratchNote: SCRATCH_NOTE,
        gate: g,
        description: plan.description,
        pieces: plan.pieces,
        rejected: plan.rejected,
        mod: plan.mod,
        steps: plan.steps,
        closeness: plan.closeness,
        creditsText: plan.creditsText,
        goal: plan.goal,
        projectName: plan.projectName,
        recipients: who,
        share,
        suggestion: learned,
      });
    }
    if (!g.ok) return h.json(res, g.status, { error: g.message, code: g.code, gate: g, scratchNote: SCRATCH_NOTE });
    if (body?.confirm !== true) return h.json(res, 400, { error: "Click Rebuild from scratch to start. Nothing was sent.", code: "confirm", scratchNote: SCRATCH_NOTE });
    if (plan.closeness.close && body?.acknowledgeClose !== true) {
      return h.json(res, 409, { error: "This is close to the original. Read the warning, then click again if you still want a from-scratch rebuild.", code: "too_close", warnings: plan.closeness.warnings, scratchNote: SCRATCH_NOTE });
    }
    try { h.guard("projects", { count: h.listProjects().length }); }
    catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code || "projects" }); }

    const projectId = newId("remix-");
    const runId = newId("rx");
    h.saveProject({
      id: projectId,
      name: plan.projectName,
      color: "#22d3ee",
      kind: "remix",
      summary: plan.summary,
      categories: [{ id: "remix", name: "Remix", links: [] }],
    });
    let rel = null;
    if (!h.HOSTED && h.DATA_DIR) {
      const paths = creditsFile(h.DATA_DIR, projectId);
      fs.mkdirSync(paths.folder, { recursive: true });
      fs.writeFileSync(paths.file, plan.creditsText);
      rel = paths.rel;
    }
    const ais = who.ais;
    let missionStarted = false;
    if (ais.length && typeof h.runMission === "function") {
      try {
        const pending = h.runMission({
          goal: plan.goal,
          context: "Remix rebuilds from scratch. Use only the person's own characters, art, and ideas, and the free tools named in the goal.",
          projectId,
          mode: "economy",
          budgetUsd: 1,
          maxTasks: 4,
          qa: true,
          search: false,
          tools: false,
        });
        missionStarted = true;
        if (pending && typeof pending.catch === "function") pending.catch(() => { try { h.emit("log", { text: "Remix mission stopped before it finished.", level: "error" }); } catch { /* already logged */ } });
      } catch { missionStarted = false; }
    }
    const row = publicRun({
      id: runId,
      ts: Date.now(),
      appType: plan.appType,
      sourceKind: plan.sourceKind,
      engineId: plan.engineId,
      packIds: plan.packIds,
      modId: plan.modId,
      provider: ais[0]?.provider || "",
      model: ais[0]?.model || "",
      projectId,
      missionStarted,
      rating: null,
      fix: false,
    });
    const doc = runsOf(h);
    doc.items.unshift(row);
    doc.items = doc.items.slice(0, 400).map(publicRun);
    h.putDoc(KIND, doc);
    try { h.emit("log", { text: "Remix saved a new project from scratch." }); } catch { /* bus is optional in tests */ }
    return h.json(res, 200, {
      ran: true,
      scratchNote: SCRATCH_NOTE,
      gate: remixGate({ tier: tierOf(h), used: countRemixMonth(doc.items) }),
      projectId,
      projectName: plan.projectName,
      creditsFile: rel,
      creditsText: plan.creditsText,
      goal: plan.goal,
      description: plan.description,
      pieces: plan.pieces,
      rejected: plan.rejected,
      steps: plan.steps,
      closeness: plan.closeness,
      run: row,
      ai: missionStarted
        ? { started: true, reason: "The AIs are building this from scratch." }
        : { started: false, reason: "No AI is connected, so nothing was sent. The project and the CREDITS file are saved on this computer." },
      recipients: who,
      share: shareTotals(doc.items, { optedIn: optedIn() }),
    });
  }

  if (req.method === "POST" && p === "/rate") {
    const runId = String(body?.id || "");
    if (typeof body?.up !== "boolean" || !runId) return h.json(res, 400, { error: "Say whether this remix worked, and which one.", code: "rating" });
    const doc = runsOf(h);
    const i = doc.items.findIndex((r) => r.id === runId);
    if (i < 0) return h.json(res, 404, { error: "That remix was not found.", code: "missing" });
    const next = publicRun({ ...doc.items[i], rating: body.up ? "up" : "down", fix: !!body.fix });
    doc.items[i] = next;
    doc.items = doc.items.map(publicRun);
    h.putDoc(KIND, doc);
    if (next.model) {
      try { rateBrain({ runId: next.id, provider: next.provider, model: next.model, capability: "creative", up: body.up }); } catch { /* learning router off */ }
    }
    const hint = suggest(doc.items, next.appType);
    return h.json(res, 200, { run: next, suggestion: hint, share: shareTotals(doc.items, { optedIn: optedIn() }) });
  }

  return false;
}
