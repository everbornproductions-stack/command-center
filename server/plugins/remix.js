// Remix any app (Phase 96). Preview first. A click saves the project and the CREDITS file.
// The address is never opened. Installed files are never read. Nothing is posted.
import fs from "node:fs";
import path from "node:path";
import { SCRATCH_NOTE, SOURCES, CATALOG, MOD_TOOLS, planRemix, recipients, publicRun, suggest, library, shareTotals } from "../remix.js";
import { remixGate, countRemixMonth, REMIX_PRO_CAP, remixAbilityGate, remixAbilityAllowed, REMIX_PART_TIER } from "../feature-gate.js";
import { rate as rateBrain, brainSettings } from "../brain.js";
import { STARTS, PART_PLAIN, publishPlan, publishVaultId, runTool, voiceCommand, clearArt, applyReuseReport, accessReport, externalCommandAllowed } from "../remix-abilities.js";
import { projectFiles, safeRel, freshPage } from "../remix-build.js";
import { commitVersion } from "../remix-git.js";
import { setSecret, hasSecret, getSecret } from "../vault.js";

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
function abilityBlock(tier, ids) {
  for (const id of ids || []) {
    const g = remixAbilityGate({ tier, ability: id });
    if (!g.ok) return g;
  }
  return { ok: true, status: 200, code: null, message: "" };
}
function withAuto(plan, tier) {
  const ids = [...(plan.abilityIds || [])];
  const notes = [];
  if (remixAbilityAllowed(tier, "smoke-test") && !ids.includes("smoke-test")) {
    ids.push("smoke-test");
    notes.push("A page test was generated here. Playwright is Apache-2.0 and is not bundled.");
  }
  if (remixAbilityAllowed(tier, "access-report") && !ids.includes("access-report")) {
    ids.push("access-report");
    notes.push("A use check was written here. axe-core is MPL-2.0. pa11y is LGPL-3.0-only and stays a separate program. Neither was launched.");
  }
  return { ids, notes };
}
function partsView(tier) {
  return Object.entries(REMIX_PART_TIER).map(([id, need]) => ({
    id, tier: need, allowed: remixAbilityAllowed(tier, id), plain: PART_PLAIN[id] || id,
  }));
}
function writeProjectFiles(dir, plan) {
  const files = projectFiles(plan);
  for (const [rel, text] of Object.entries(files)) {
    const safe = safeRel(rel);
    if (!safe) continue;
    const file = path.join(dir, safe);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
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
      starts: STARTS.map((s) => ({ id: s.id, label: s.label, detail: s.detail })),
      parts: partsView(tierOf(h)),
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
    const abilityGate = abilityBlock(tierOf(h), plan.abilityIds);
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
        start: plan.start,
        abilityIds: plan.abilityIds,
        abilityGate,
      });
    }
    if (!g.ok) return h.json(res, g.status, { error: g.message, code: g.code, gate: g, scratchNote: SCRATCH_NOTE });
    if (body?.confirm !== true) return h.json(res, 400, { error: "Click Rebuild from scratch to start. Nothing was sent.", code: "confirm", scratchNote: SCRATCH_NOTE });
    if (plan.closeness.close && body?.acknowledgeClose !== true) {
      return h.json(res, 409, { error: "This is close to the original. Read the warning, then click again if you still want a from-scratch rebuild.", code: "too_close", warnings: plan.closeness.warnings, scratchNote: SCRATCH_NOTE });
    }
    if (!abilityGate.ok) return h.json(res, abilityGate.status, { error: abilityGate.message, code: abilityGate.code, ability: abilityGate.ability, scratchNote: SCRATCH_NOTE });
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
    const auto = withAuto(plan, tierOf(h));
    const creditsBody = auto.notes.length
      ? `${plan.creditsText}${auto.notes.map((n) => `- ${n}\n`).join("")}`
      : plan.creditsText;
    const savedPlan = { ...plan, abilityIds: auto.ids, creditsText: creditsBody };
    let rel = null;
    let version = null;
    if (!h.HOSTED && h.DATA_DIR) {
      const paths = creditsFile(h.DATA_DIR, projectId);
      fs.mkdirSync(paths.folder, { recursive: true });
      fs.writeFileSync(paths.file, creditsBody);
      writeProjectFiles(paths.folder, savedPlan);
      rel = paths.rel;
      if (auto.ids.includes("forks")) {
        try { version = await commitVersion(paths.folder); }
        catch { version = { ok: false, sent: false, version: "" }; }
      }
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
      creditsText: creditsBody,
      abilityIds: auto.ids,
      version,
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

  if (req.method === "POST" && p === "/test") {
    if (body?.confirm !== true) return h.json(res, 400, { error: "Press Test to check this. Nothing was launched.", code: "confirm" });
    const g = gate();
    if (!g.ok) return h.json(res, g.status, { error: g.message, code: g.code });
    if (!remixAbilityAllowed(tierOf(h), "smoke-test") || !remixAbilityAllowed(tierOf(h), "access-report")) {
      return h.json(res, 402, { error: "That choice is on Pro.", code: "ability_tier" });
    }
    const projectId = String(body?.projectId || "");
    let html = "";
    if (!h.HOSTED && h.DATA_DIR && /^remix-[a-z0-9]+$/.test(projectId)) {
      const file = path.join(h.DATA_DIR, "projects", projectId, "index.html");
      if (fs.existsSync(file)) html = fs.readFileSync(file, "utf8");
    }
    if (!html) html = freshPage({ projectName: "My remix", description: { looks: "A new page.", plays: "", works: "" }, start: "description" });
    const report = accessReport(html);
    return h.json(res, 200, { ok: true, ranExternal: false, sent: false, report, smoke: true });
  }

  if (req.method === "POST" && p === "/publish") {
    const g = gate();
    if (!g.ok) return h.json(res, g.status, { error: g.message, code: g.code, sent: false });
    const target = String(body?.target || "computer");
    const rowNeed = target === "phone" ? "publish-phone" : (target === "computer" ? "" : "publish-web");
    if (rowNeed && !remixAbilityAllowed(tierOf(h), rowNeed)) {
      const blocked = remixAbilityGate({ tier: tierOf(h), ability: rowNeed });
      return h.json(res, blocked.status, { error: blocked.message, code: blocked.code, sent: false });
    }
    if (body?.confirm !== true) return h.json(res, 400, { error: "Nothing is posted until you press Publish.", code: "confirm", sent: false });
    const vaultId = publishVaultId(target);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (token && vaultId) {
      if (token.length > 200) return h.json(res, 400, { error: "That token is too long.", code: "token", sent: false });
      try { await setSecret(vaultId, token); }
      catch (e) { return h.json(res, e.status || 400, { error: e.code === "vault_unavailable" ? e.message : "The token could not be stored.", code: e.code || "vault", sent: false }); }
    }
    const plan = publishPlan({ target, click: true, hasToken: !!(token || (vaultId && hasSecret(vaultId))) });
    if (!plan.ok) return h.json(res, 400, { error: plan.error, code: plan.code, sent: false });
    let started = false;
    let reason = plan.message;
    if (plan.bin) {
      const env = {};
      if (externalCommandAllowed() && plan.envName && vaultId) {
        const secret = getSecret(vaultId);
        if (secret?.key) env[plan.envName] = secret.key;
      }
      const run = await runTool(plan.bin, plan.args || [], { env });
      started = !!run.started;
      reason = run.reason || reason;
    }
    try { h.emit("log", { text: "Remix publish waited for a click. Nothing was posted." }); } catch { /* bus optional */ }
    return h.json(res, 200, { ok: true, sent: false, started, target, message: reason, saved: !!(token && vaultId) });
  }

  if (req.method === "POST" && p === "/token") {
    const g = gate();
    if (!g.ok) return h.json(res, g.status, { error: g.message, code: g.code, sent: false });
    const target = String(body?.target || "");
    const vaultId = publishVaultId(target);
    if (!vaultId) return h.json(res, 400, { error: "Choose a website, itch.io, or a phone.", code: "target" });
    if (body?.confirm !== true) return h.json(res, 400, { error: "Nothing is stored until you press Publish.", code: "confirm" });
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 200) return h.json(res, 400, { error: "Add your token first. It is stored with your keys.", code: "token" });
    const need = target === "phone" ? "publish-phone" : "publish-web";
    if (!remixAbilityAllowed(tierOf(h), need)) {
      const blocked = remixAbilityGate({ tier: tierOf(h), ability: need });
      return h.json(res, blocked.status, { error: blocked.message, code: blocked.code });
    }
    try { await setSecret(vaultId, token); }
    catch (e) { return h.json(res, e.status || 400, { error: e.code === "vault_unavailable" ? e.message : "The token could not be stored.", code: e.code || "vault" }); }
    try { h.emit("log", { text: "Remix stored a publish token in the vault." }); } catch { /* bus optional */ }
    return h.json(res, 200, { saved: true, target, sent: false });
  }

  if (req.method === "POST" && p === "/media") {
    const g = gate();
    if (!g.ok) return h.json(res, g.status, { error: g.message, code: g.code, downloaded: false });
    if (!remixAbilityAllowed(tierOf(h), "cc0-art")) return h.json(res, 402, { error: "That choice is on Pro.", code: "ability_tier", downloaded: false });
    const cleared = clearArt(body?.files);
    const reused = applyReuseReport(cleared.kept, body?.reuseReport);
    if (body?.confirm !== true) {
      return h.json(res, 400, { error: "Downloads wait until you approve them.", code: "media_approval", downloaded: false, kept: reused.kept.map((f) => f.name), rejected: [...cleared.rejected, ...reused.rejected] });
    }
    return h.json(res, 200, {
      ok: true, downloaded: false, sent: false, reuseRan: reused.reuseRan,
      kept: reused.kept.map((f) => ({ name: f.name, source: f.source, license: f.license })),
      rejected: [...cleared.rejected, ...reused.rejected],
      message: "Approved. Nothing was downloaded.",
    });
  }

  if (req.method === "POST" && p === "/voice") {
    const g = gate();
    if (!g.ok) return h.json(res, g.status, { error: g.message, code: g.code, started: false });
    if (!remixAbilityAllowed(tierOf(h), "voices")) return h.json(res, 402, { error: "That choice is on Extreme.", code: "ability_tier", started: false });
    const voice = voiceCommand(body?.kind);
    if (!voice) return h.json(res, 400, { error: "Choose Piper or Coqui.", code: "voice", started: false });
    if (body?.confirm !== true) return h.json(res, 400, { error: "A voice waits until you approve it.", code: "media_approval", started: false, external: true });
    const run = await runTool(voice.command[0], voice.command.slice(1));
    return h.json(res, 200, { ok: true, started: !!run.started, sent: false, external: true, gpl: !!voice.gpl, license: voice.license, message: run.reason });
  }

  if (req.method === "POST" && p === "/fork") {
    const g = gate();
    if (!g.ok) return h.json(res, g.status, { error: g.message, code: g.code, sent: false });
    if (body?.confirm !== true) return h.json(res, 400, { error: "Press Build to save a version.", code: "confirm", sent: false });
    if (!remixAbilityAllowed(tierOf(h), "forks")) return h.json(res, 402, { error: "That choice is on Pro.", code: "ability_tier", sent: false });
    const projectId = String(body?.projectId || "");
    if (h.HOSTED || !h.DATA_DIR || !/^remix-[a-z0-9]+$/.test(projectId)) return h.json(res, 404, { error: "That remix project was not found.", code: "missing" });
    const folder = path.join(h.DATA_DIR, "projects", projectId);
    if (!fs.existsSync(folder)) return h.json(res, 404, { error: "That remix project was not found.", code: "missing" });
    try {
      const version = await commitVersion(folder);
      return h.json(res, 200, version);
    } catch {
      return h.json(res, 500, { error: "The version could not be saved.", code: "fork", sent: false });
    }
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
