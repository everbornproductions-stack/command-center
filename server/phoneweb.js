// Phone web companion (Slice D2, gated behind flag_phoneweb).
// Provides:
//   1. Feature flag check: isPhoneWebEnabled(settings, env) -> default false in tests.
//   2. Same project and Flow stage sync between desktop and phone.
//   3. Dual-control queued directions with "latest explicit direction wins" conflict resolution.
//   4. Live job progress, errors, and phone approval decisions (reusing server/phone-approvals.js).
//   5. One-tap phone quick actions: Schedule this, Book this, Email this, Post this to [platform],
//      Make this image (with lighting and ambience adjustments), and Find my home.

import { doc, putDoc, ctx } from "./store.js";
import { ask as askApproval, decide as decideApproval, publicState as approvalsState } from "./phone-approvals.js";

export const FLAG_NAME = "flag_phoneweb";
const DOC_KEY = "phoneweb.state";

export const FLOW_STAGES = [
  { id: "creative", label: "Creative", short: "Creative", order: 1, summary: "Shape the idea with voice, text, or reference links." },
  { id: "planning", label: "Planning", short: "Planning", order: 2, summary: "Turn the idea into a clear plan and pick the tools." },
  { id: "ai-movement", label: "AI Movement", short: "AI Movement", order: 3, summary: "Assign each part of the plan to the best AI." },
  { id: "build", label: "Build", short: "Build", order: 4, summary: "Watch live progress and steer with queued directions." },
  { id: "testing", label: "Testing and Tweaks", short: "Testing", order: 5, summary: "Check the result, request changes, and polish." },
  { id: "finish", label: "Finish", short: "Finish", order: 6, summary: "Approve, share, schedule, or publish the finished work." },
];

export const STAGE_IDS = new Set(FLOW_STAGES.map((s) => s.id));

export const QUICK_ACTIONS = [
  { id: "schedule", label: "Schedule this", short: "Schedule", needsApproval: false, description: "Save a time to run or review this item." },
  { id: "book", label: "Book this", short: "Book", needsApproval: true, description: "Prepare a booking and hold for your approval." },
  { id: "email", label: "Email this", short: "Email", needsApproval: true, description: "Draft an email from this work and hold before sending." },
  { id: "post", label: "Post this", short: "Post", needsApproval: true, description: "Format for a social platform and hold for approval." },
  { id: "image", label: "Make this image", short: "Image", needsApproval: false, description: "Create a photo or image brief with lighting and ambience." },
  { id: "home", label: "Find my home", short: "Home", needsApproval: false, description: "Open directions to your saved home address." },
];

export const POST_PLATFORMS = [
  { id: "instagram", label: "Instagram", maxChars: 2200 },
  { id: "x", label: "X", maxChars: 280 },
  { id: "facebook", label: "Facebook", maxChars: 4000 },
  { id: "linkedin", label: "LinkedIn", maxChars: 3000 },
  { id: "slack", label: "Slack", maxChars: 3000 },
  { id: "ghl", label: "HighLevel", maxChars: 4000 },
];

export const IMAGE_LIGHTING = [
  { id: "golden-hour", label: "Golden hour", prompt: "warm golden-hour sunlight with soft long shadows" },
  { id: "studio", label: "Studio key light", prompt: "clean three-point studio lighting with crisp catchlights" },
  { id: "soft-daylight", label: "Soft daylight", prompt: "diffused natural window daylight with gentle contrast" },
  { id: "neon-night", label: "Night neon", prompt: "atmospheric night scene with cyan and amber neon reflections" },
  { id: "dramatic", label: "Dramatic rim", prompt: "high-contrast directional rim light with deep shadows" },
];

export const IMAGE_AMBIENCE = [
  { id: "warm", label: "Warm and inviting", prompt: "warm colour grading and approachable atmosphere" },
  { id: "clean", label: "Clean minimal", prompt: "minimal uncluttered composition with neutral tones" },
  { id: "cinematic", label: "Cinematic", prompt: "shallow depth of field, filmic grain, and wide framing" },
  { id: "vibrant", label: "Vibrant", prompt: "rich saturated colours and lively energy" },
  { id: "moody", label: "Moody", prompt: "muted highlights and atmospheric depth" },
];

export function isPhoneWebEnabled(settingsObj = null, env = process.env) {
  let s = settingsObj;
  if (!s) {
    try { s = doc("settings", () => ({})); } catch { s = null; }
  }
  if (s && typeof s.flag_phoneweb === "boolean") return s.flag_phoneweb;
  if (s?.flags && typeof s.flags.flag_phoneweb === "boolean") return s.flags.flag_phoneweb;
  const raw = String(env?.CC_FLAG_PHONEWEB || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

function defaultDoc() {
  return {
    projectId: "",
    stage: "creative",
    updatedAt: 0,
    updatedBy: "desktop",
    homeLocation: "",
    homeMode: "driving",
    directions: [],
    quickHistory: [],
  };
}

export function readPhoneState() {
  const st = doc(DOC_KEY, defaultDoc);
  if (!Array.isArray(st.directions)) st.directions = [];
  if (!Array.isArray(st.quickHistory)) st.quickHistory = [];
  if (!STAGE_IDS.has(st.stage)) st.stage = "creative";
  return st;
}

export function writePhoneState(next) {
  return putDoc(DOC_KEY, next);
}

export function normalizeStage(stage) {
  const id = String(stage || "").trim().toLowerCase();
  if (STAGE_IDS.has(id)) return id;
  if (id === "movement" || id === "aimovement") return "ai-movement";
  if (id === "test" || id === "tweaks") return "testing";
  if (id === "done" || id === "finished") return "finish";
  return "";
}

export function stageInfo(stageId) {
  return FLOW_STAGES.find((s) => s.id === stageId) || FLOW_STAGES[0];
}

export function inferStageFromRun(run, fallback = "creative") {
  if (!run) return fallback;
  if (run.stage && STAGE_IDS.has(run.stage)) return run.stage;
  const st = String(run.status || "").toLowerCase();
  if (st === "planning") return "planning";
  if (st === "routing" || st === "assigning") return "ai-movement";
  if (st === "running" || st === "working" || st === "waiting") return "build";
  if (st === "qa" || st === "assembling" || st === "paused") return "testing";
  if (st === "done" || st === "done-with-errors") return "finish";
  return fallback;
}

export function setCompanionContext({ projectId, stage, homeLocation, homeMode, from = "phone", settings, putSettings, emit } = {}) {
  const st = readPhoneState();
  if (projectId !== undefined) st.projectId = String(projectId || "").trim();
  if (stage !== undefined) {
    const norm = normalizeStage(stage);
    if (!norm) {
      const err = new Error(`Unknown stage: ${stage}`);
      err.status = 400;
      err.code = "bad_stage";
      throw err;
    }
    st.stage = norm;
  }
  if (homeLocation !== undefined) st.homeLocation = String(homeLocation || "").trim().slice(0, 240);
  if (homeMode !== undefined && ["driving", "transit", "walking"].includes(homeMode)) st.homeMode = homeMode;
  st.updatedAt = Date.now();
  st.updatedBy = from === "desktop" ? "desktop" : "phone";
  writePhoneState(st);

  if (typeof settings === "function" && typeof putSettings === "function") {
    try {
      const cur = settings() || {};
      putSettings({
        ...cur,
        activeProject: st.projectId,
        activeStage: st.stage,
      });
    } catch {}
  }
  const summary = {
    projectId: st.projectId,
    stage: st.stage,
    stageLabel: stageInfo(st.stage).label,
    homeLocation: st.homeLocation,
    homeMode: st.homeMode,
    updatedAt: st.updatedAt,
    updatedBy: st.updatedBy,
  };
  if (typeof emit === "function") emit("phoneweb.sync", summary);
  return summary;
}

function sameScope(entry, runId, projectId) {
  const rA = entry.runId || null;
  const rB = runId || null;
  if (rA && rB) return rA === rB;
  if (rA !== rB) return false;
  const pA = entry.projectId || "";
  const pB = projectId || "";
  if (pA && pB) return pA === pB;
  return true;
}

// Dual-control queue: "latest explicit direction wins".
// When a new explicit direction arrives (explicit !== false and kind !== "note"),
// any earlier queued explicit direction in the same run/project scope is marked
// "superseded" and linked via supersededBy. Additive notes (explicit === false or
// kind === "note") stay queued alongside the winning direction.
export function queueDirection({
  text,
  runId = null,
  projectId = "",
  stage = "",
  from = "phone",
  inputMode = "text",
  explicit = true,
  kind = "direction",
  emit,
} = {}) {
  const clean = String(text || "").trim();
  if (!clean) {
    const err = new Error("Type or speak a direction first.");
    err.status = 400;
    err.code = "direction_empty";
    throw err;
  }
  const st = readPhoneState();
  const effProject = projectId !== undefined && projectId !== "" ? String(projectId) : st.projectId || "";
  const effStage = normalizeStage(stage) || st.stage || "creative";
  const isExplicit = explicit !== false && kind !== "note";
  const now = Date.now();
  const id = "dir-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 6);

  const supersededIds = [];
  if (isExplicit) {
    for (const item of st.directions) {
      if (item.status === "queued" && item.explicit !== false && sameScope(item, runId, effProject)) {
        item.status = "superseded";
        item.supersededBy = id;
        item.supersededAt = now;
        supersededIds.push(item.id);
      }
    }
  }

  const entry = {
    id,
    runId: runId ? String(runId) : null,
    projectId: effProject,
    stage: effStage,
    text: clean.slice(0, 4000),
    from: from === "desktop" ? "desktop" : "phone",
    inputMode: ["voice", "quick", "text"].includes(inputMode) ? inputMode : "text",
    kind: isExplicit ? "direction" : "note",
    explicit: isExplicit,
    status: "queued",
    supersededBy: null,
    createdAt: now,
  };

  st.directions.push(entry);
  if (st.directions.length > 200) st.directions = st.directions.slice(-200);
  writePhoneState(st);

  const q = queueView({ runId: entry.runId, projectId: effProject });
  if (typeof emit === "function") {
    emit("phoneweb.queue", { action: "queued", entry, supersededIds, queue: q });
  }
  return { entry, supersededIds, queue: q };
}

export function queueView({ runId = null, projectId = "" } = {}) {
  const st = readPhoneState();
  const effProject = projectId || st.projectId || "";
  const relevant = st.directions.filter((d) => {
    if (runId) return d.runId === runId || (!d.runId && (!effProject || d.projectId === effProject));
    if (effProject) return !d.projectId || d.projectId === effProject;
    return true;
  });

  const queued = relevant.filter((d) => d.status === "queued");
  const explicitQueued = queued.filter((d) => d.explicit !== false);
  const notesQueued = queued.filter((d) => d.explicit === false);
  const activeDirection = explicitQueued.at(-1) || notesQueued.at(-1) || null;
  const superseded = relevant.filter((d) => d.status === "superseded").slice(-10).reverse();
  const applied = relevant.filter((d) => d.status === "applied").slice(-10).reverse();

  const lines = [];
  if (activeDirection && activeDirection.explicit !== false) {
    lines.push(`Latest explicit direction (${activeDirection.from}): ${activeDirection.text}`);
  }
  for (const n of notesQueued) {
    lines.push(`Note (${n.from}): ${n.text}`);
  }
  const promptBlock = lines.join("\n");

  return {
    activeDirection,
    queued,
    notes: notesQueued,
    superseded,
    applied,
    totalQueued: queued.length,
    promptBlock,
    rule: "latest-explicit-wins",
  };
}

export function consumeQueuedForRun(runId = null, projectId = "", { emit } = {}) {
  if (!isPhoneWebEnabled()) return null;
  const st = readPhoneState();
  const effProject = projectId || st.projectId || "";
  const queued = st.directions.filter((d) => {
    if (d.status !== "queued") return false;
    if (runId) return d.runId === runId || (!d.runId && (!effProject || d.projectId === effProject));
    if (effProject) return !d.projectId || d.projectId === effProject;
    return true;
  });
  if (!queued.length) return null;

  const now = Date.now();
  const explicitQueued = queued.filter((d) => d.explicit !== false);
  const notesQueued = queued.filter((d) => d.explicit === false);
  const winner = explicitQueued.at(-1) || notesQueued.at(-1) || null;

  for (const item of queued) {
    item.status = "applied";
    item.appliedAt = now;
    if (runId && !item.runId) item.runId = runId;
  }
  writePhoneState(st);

  const lines = [];
  if (winner && winner.explicit !== false) {
    lines.push(`Latest explicit direction (${winner.from}): ${winner.text}`);
  }
  for (const n of notesQueued) {
    lines.push(`Additional note (${n.from}): ${n.text}`);
  }
  const promptBlock = lines.join("\n");
  const summary = winner ? winner.text.slice(0, 120) : "";

  const out = {
    winner,
    notes: notesQueued,
    items: queued,
    promptBlock,
    summary,
    appliedAt: now,
  };
  if (typeof emit === "function") {
    emit("phoneweb.queue", { action: "consumed", runId, ...out, queue: queueView({ runId, projectId: effProject }) });
  }
  return out;
}

export function cancelDirection(id, { emit } = {}) {
  const st = readPhoneState();
  const target = st.directions.find((d) => d.id === id);
  if (!target) return null;
  if (target.status === "queued") {
    target.status = "cancelled";
    target.cancelledAt = Date.now();
    writePhoneState(st);
  }
  const q = queueView({ runId: target.runId, projectId: target.projectId });
  if (typeof emit === "function") {
    emit("phoneweb.queue", { action: "cancelled", entry: target, queue: q });
  }
  return { entry: target, queue: q };
}

export function buildLiveJobSummary({ liveList, projectId = "", stage = "creative" } = {}) {
  let active = null;
  if (Array.isArray(liveList)) {
    const running = liveList.filter(Boolean);
    if (projectId) active = running.find((m) => m.projectId === projectId) || running[0] || null;
    else active = running[0] || null;
  }
  if (!active) {
    try {
      const all = ctx().store.listMissions((m) => m).filter(Boolean);
      all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      if (projectId) active = all.find((m) => m.projectId === projectId) || all[0] || null;
      else active = all[0] || null;
    } catch {}
  }
  const appState = approvalsState();
  if (!active) {
    return {
      id: null,
      kind: null,
      status: "idle",
      title: "Ready for your next direction",
      prompt: "",
      projectId: projectId || null,
      stage,
      stageLabel: stageInfo(stage).label,
      progress: { total: 0, done: 0, running: 0, failed: 0, waiting: 0, pct: 0 },
      tasks: [],
      errors: [],
      decisions: appState.pending || [],
      deliverablePreview: "",
      appliedDirections: [],
    };
  }

  const tasks = Array.isArray(active.tasks) ? active.tasks : [];
  const total = tasks.length || 1;
  const done = tasks.length
    ? tasks.filter((t) => t.status === "done").length
    : ["done", "done-with-errors"].includes(active.status) ? 1 : 0;
  const running = tasks.filter((t) => t.status === "running" || t.status === "working").length;
  const failed = tasks.filter((t) => t.status === "failed").length + (active.status === "failed" && !tasks.length ? 1 : 0);
  const waiting = tasks.filter((t) => t.status === "waiting").length + (active.status === "waiting" ? 1 : 0);
  const pct = Math.min(100, Math.round((done / total) * 100));

  const errors = [];
  if (active.error) errors.push(String(active.error));
  for (const t of tasks) {
    if (t.status === "failed" && t.error) errors.push(`${t.title || t.id}: ${t.error}`);
  }

  const deliv = String(active.deliverable || active.verdict?.text || "").trim();
  const inferredStage = inferStageFromRun(active, stage);

  return {
    id: active.id,
    kind: active.kind || "mission",
    status: active.status || "running",
    title: String(active.title || active.prompt || active.goal || "Current job").slice(0, 120),
    prompt: String(active.prompt || active.goal || "").slice(0, 400),
    projectId: active.projectId || projectId || null,
    stage: inferredStage,
    stageLabel: stageInfo(inferredStage).label,
    progress: { total, done, running, failed, waiting, pct },
    tasks: tasks.slice(0, 12).map((t) => ({
      id: t.id,
      title: t.title || t.id,
      status: t.status || "pending",
      provider: t.provider || null,
      model: t.model || null,
      error: t.error || null,
    })),
    errors,
    decisions: appState.pending || [],
    deliverablePreview: deliv.slice(0, 600),
    appliedDirections: active.appliedDirections || [],
    startedAt: active.startedAt || null,
    finishedAt: active.finishedAt || null,
  };
}

export function runQuickAction(body = {}, { emit } = {}) {
  const action = String(body.action || "").trim().toLowerCase();
  const meta = QUICK_ACTIONS.find((a) => a.id === action);
  if (!meta) {
    const err = new Error(`Unknown quick action: ${action || "none"}`);
    err.status = 400;
    err.code = "bad_quick_action";
    throw err;
  }

  const st = readPhoneState();
  const now = Date.now();
  const id = "qa-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const text = String(body.text || body.title || "").trim().slice(0, 2000);
  const projectId = body.projectId !== undefined ? String(body.projectId || "") : st.projectId || "";
  const stage = normalizeStage(body.stage) || st.stage || "creative";

  let entry = {
    id,
    action,
    label: meta.label,
    projectId,
    stage,
    text,
    createdAt: now,
    status: "done",
    approvalId: null,
    detail: {},
  };

  if (action === "schedule") {
    const when = String(body.when || "Tomorrow 09:00").trim().slice(0, 80);
    const note = text || "Scheduled from phone companion";
    entry.status = "scheduled";
    entry.summary = `Scheduled for ${when}: ${note.slice(0, 100)}`;
    entry.detail = { when, note };
  } else if (action === "book") {
    const item = text || String(body.service || "Reservation").trim();
    const when = String(body.when || "Next available slot").trim().slice(0, 80);
    const amount = body.amount != null && Number.isFinite(Number(body.amount)) ? Number(body.amount) : null;
    const ap = askApproval({
      kind: "buy",
      action: `Book ${item} (${when})`,
      amount,
    });
    entry.status = "needs-approval";
    entry.approvalId = ap.id;
    entry.summary = `Booking held for approval: ${item} (${when})`;
    entry.detail = { item, when, amount, approval: ap };
  } else if (action === "email") {
    const to = String(body.to || "").trim().slice(0, 160);
    const subject = String(body.subject || text.slice(0, 60) || "From Meldmind").trim().slice(0, 120);
    const draftBody = text || "Drafted from phone companion.";
    const ap = askApproval({
      kind: "send",
      action: `Email ${to || "recipient"}: ${subject}`,
      amount: null,
    });
    entry.status = "needs-approval";
    entry.approvalId = ap.id;
    entry.summary = `Email draft held for approval: ${subject}`;
    entry.detail = { to, subject, body: draftBody, approval: ap };
  } else if (action === "post") {
    const platId = String(body.platform || "instagram").trim().toLowerCase();
    const plat = POST_PLATFORMS.find((p) => p.id === platId) || POST_PLATFORMS[0];
    const caption = (text || "Ready to share.").slice(0, plat.maxChars);
    const ap = askApproval({
      kind: "send",
      action: `Post to ${plat.label}: ${caption.slice(0, 60)}`,
      amount: null,
    });
    entry.status = "needs-approval";
    entry.approvalId = ap.id;
    entry.summary = `Post to ${plat.label} held for approval`;
    entry.detail = { platform: plat.id, platformLabel: plat.label, caption, approval: ap };
  } else if (action === "image") {
    const lightId = String(body.lighting || "golden-hour").trim().toLowerCase();
    const ambId = String(body.ambience || "warm").trim().toLowerCase();
    const light = IMAGE_LIGHTING.find((l) => l.id === lightId) || IMAGE_LIGHTING[0];
    const amb = IMAGE_AMBIENCE.find((a) => a.id === ambId) || IMAGE_AMBIENCE[0];
    const subject = text || "Product hero shot on a clean surface";
    const fullPrompt = `${subject}. Lighting: ${light.prompt}. Ambience: ${amb.prompt}.`;
    entry.status = "created";
    entry.summary = `Image brief ready (${light.label}, ${amb.label})`;
    entry.detail = {
      subject,
      lighting: light.id,
      lightingLabel: light.label,
      ambience: amb.id,
      ambienceLabel: amb.label,
      prompt: fullPrompt,
    };
  } else if (action === "home") {
    const destination = String(body.homeLocation ?? st.homeLocation ?? "").trim().slice(0, 240);
    const mode = ["driving", "transit", "walking"].includes(body.homeMode) ? body.homeMode : (st.homeMode || "driving");
    if (destination) st.homeLocation = destination;
    st.homeMode = mode;
    const mapsUrl = destination
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${encodeURIComponent(mode)}`
      : "https://www.google.com/maps/dir/?api=1&travelmode=driving";
    entry.status = "ready";
    entry.summary = destination ? `Directions to ${destination} (${mode})` : "Directions home ready (set your home address to prefill)";
    entry.detail = {
      homeLocation: destination,
      travelMode: mode,
      mapsUrl,
    };
  }

  st.quickHistory.unshift(entry);
  if (st.quickHistory.length > 50) st.quickHistory = st.quickHistory.slice(0, 50);
  writePhoneState(st);

  if (typeof emit === "function") {
    emit("phoneweb.quick", { entry, approvals: approvalsState() });
  }
  return entry;
}

export function resolvePhoneApproval({ id, decision, emit } = {}) {
  const d = String(decision || "").trim().toLowerCase();
  if (!["approve", "approved", "decline", "declined"].includes(d)) {
    const err = new Error("Choose approve or decline.");
    err.status = 400;
    err.code = "bad_decision";
    throw err;
  }
  const result = decideApproval(id, d.startsWith("approve"), "phone");
  const st = readPhoneState();
  let updatedQuick = null;
  for (const item of st.quickHistory) {
    if (item.approvalId === id) {
      item.status = result.status === "approved" ? "approved" : "declined";
      item.decidedAt = result.decidedAt;
      if (item.detail?.approval) item.detail.approval = result;
      updatedQuick = item;
    }
  }
  if (updatedQuick) writePhoneState(st);
  if (typeof emit === "function") {
    emit("phoneweb.sync", { approval: result, quickAction: updatedQuick, approvals: approvalsState() });
  }
  return { approval: result, quickAction: updatedQuick, approvals: approvalsState() };
}
