// Mission mode: marching orders in, a finished deliverable out.
// 1. A planner model breaks the goal into tasks with a capability tag and dependencies.
// 2. The router assigns each task to the best available AI (Quality, Balanced, Max savings, or Speed).
// 3. Tasks run in dependency waves, in parallel, streaming. Each AI may run as several
//    sub-agents (one per task). A different AI QA-reviews each deliverable when qa is on.
// 4. An assembler compiles the final deliverable.
import { PROVIDERS } from "./registry.js";
import { attachPdf, stepNotDone } from "./mission-pdf.js";
import { complete, extractJson } from "./providers.js";
import { recordCall } from "./ledger.js";
import { noteCall, isDeadNow, heldByRealFailure } from "./health.js";
import { emit } from "./events.js";
import { classify, rank } from "./router.js";
import { ctx, doc, putDoc } from "./store.js";
import { augment as webAugment, sourcesBlock } from "./search.js";
import { prepareWeb } from "./research.js";
import { augment as libraryAugment, publicSources as publicLibrarySources } from "./libraries.js";
import { overheadCost } from "./precost.js";
import { freeOnlyOn, hasPaidKey, freeOnlyError, calibratedEstimate, noteActual, stepLine, creditCheck } from "./free-first.js";
import { fallbackChat, completeFallback, fallbackRecord, announce as announceFallback, troubleKind } from "./fallback.js";
import { observe, markPrivateRun } from "./brain.js";
import { AGENT_ID as GROKBOT } from "./grokbot.js";
import { missionAgent, agentName, cancelAgentJob, onAnyJobFinished } from "./agents.js";
import { withMemory, contextFor, carriesMemory, MARKER as MEMORY_MARKER } from "./project-memory.js";
import { normalizeMode, planMode, reviewMode } from "./modes.js";
import { cleanSkip, skipAvoid, toneAdd } from "./desk.js";
import * as MEDIA from "./media-jobs.js";
import * as MSW from "./media-switch.js";
import { demoActive as mediaDemoOn } from "./mock.js";
import { demosHidden as mediaDemosHidden } from "./demo-visibility.js";
import { guardUsd as mediaGuardUsd } from "./make-it.js";
import { suggestApp, runLive, planLine } from "./control-apps.js";
import { openGrant, endGrant, grantView } from "./getdone.js";
import { resolveCrew, crewFor, crewSystem } from "./employees.js";
import { keepEmployeeWork } from "./mindmedia-employees.js";
import { consumeQueuedForRun } from "./phoneweb.js";
import { isNavStateEnabled } from "./web-config.js";
import { plainMessage } from "./plain-error.js";
import { unavailableNamed, replanLine, scrubUnavailable, cleanCapability, stepAgentName, handToWorkingAI } from "./plan-safe.js";
import { claimCheck, stripSaveClaims, judgeStep, continuePrompt, joinContinuation, wantsSearch, diskCheck, onDisk, removedApiNotes, NO_REMOVED_APIS_LINE, stripSearchLeaks, namedFile, fileExt, CODE_TOKEN_CAP, WORK_TOKEN_CAP, MAX_CONTINUES, checkTruncation, isEmptyOutput, missingInputs, inputMissingLine } from "./step-guard.js";
import { saveNamedFile, writeProjectFile, codeFor, isWritableName, NOT_SAVED_LINE } from "./named-file.js";
import { exportNames, compareExports, exportLossLine, KEEP_EXPORTS_LINE } from "./export-check.js";
import { runNodeTest, runReport, isRunStep, findNodeCommand, asksOtherCommand, NOT_RUN_LINE } from "./run-node-test.js";
import { isLocalSaveStep, SAVE_LINE, savePost, splitPost, stripHelperNotes } from "./mindmedia-step.js";
import { dryRunBanner, preflight, mediaStatus, neededMedia } from "./media-preflight.js";
import { localizeImagePlan, drawLocally, namedImage, localDrawNote } from "./local-draw.js";
import fs from "node:fs";
import path from "node:path";
import { extractHeadline, overlayPng, isPng } from "./overlay.js";
import { namedSources, attachSources, sourceBlock, projectFolders, find as findInFolder } from "./code-source.js";

// ---- Never-say-no planner workaround chain (Slice A5, Item 9) ----
// Order: 1. installed_app -> 2. browser_helper -> 3. smaller_steps -> 4. closest_option.
// Safety rule (PLAN.md Section 2): never bypass approvals for send, pay, delete, or sign,
// and never touch billing or password screens.
export const WORKAROUND_ORDER = ["installed_app", "browser_helper", "smaller_steps", "closest_option"];
const SECRET_SCREEN_RE = /\b(password|passcode|2fa|billing|stripe|payment\s*method|checkout|credit\s*card|cvv|bank\s*account)\b/i;
const APPROVAL_VERBS = [
  ["pay", /\b(buy|purchase|pay|charge|subscribe|upgrade)\b/i],
  ["delete", /\b(delete|remove|erase|wipe|drop)\b/i],
  ["sign", /\b(sign\s+contract|sign\s+document|docusign|e-sign|countersign)\b/i],
  ["send", /\b(send|submit|post|publish|email|message|reply|broadcast)\b/i],
];

export function checkWorkaroundSafety(text) {
  const raw = String(text || "");
  const touchesSecretScreen = SECRET_SCREEN_RE.test(raw);
  let approvalKind = null;
  for (const [kind, re] of APPROVAL_VERBS) {
    if (re.test(raw)) { approvalKind = kind; break; }
  }
  const requiresApproval = approvalKind !== null;
  const safetyNote = touchesSecretScreen
    ? "Billing and password screens are never touched automatically. Complete any password or payment step yourself."
    : requiresApproval
      ? `Requires your approval before any ${approvalKind} action runs.`
      : "Read and draft steps only; nothing is sent, paid, deleted, or signed without your OK.";
  return {
    safeToAutomate: !touchesSecretScreen,
    touchesSecretScreen,
    requiresApproval,
    approvalKind,
    neverBypassApproval: true,
    neverTouchBillingOrPasswords: true,
    safetyNote,
  };
}

export function decomposeIntoSmallerSteps(goal, cls = {}) {
  const cleanGoal = String(goal || "Complete the request").trim();
  const cap = cls?.capability || "writing";
  return [
    {
      id: "t1",
      title: "Outline key inputs and scope",
      capability: cap === "media" || cap === "agent" ? "writing" : cap,
      difficulty: 1,
      needWeb: false,
      deps: [],
      instructions: `List the exact inputs, constraints, and target outcome for: ${cleanGoal}`,
      deliverable: "A short, concrete checklist of inputs and scope.",
    },
    {
      id: "t2",
      title: "Draft the core deliverable step by step",
      capability: "writing",
      difficulty: 1,
      needWeb: false,
      deps: ["t1"],
      instructions: `Draft the main content or action steps for: ${cleanGoal}`,
      deliverable: "The drafted content or step-by-step instructions.",
    },
    {
      id: "t3",
      title: "Review and prepare next actions",
      capability: "analysis",
      difficulty: 1,
      needWeb: false,
      deps: ["t2"],
      instructions: `Check the draft against the goal and list the final actions the user can confirm: ${cleanGoal}`,
      deliverable: "Final verified deliverable and confirmation checklist.",
    },
  ];
}

export function buildWorkaroundPlan({
  goal,
  cls = {},
  mode = "balanced",
  browser,
  missionAgentFn = missionAgent,
  suggestAppFn = suggestApp,
  openRankFn = null,
} = {}) {
  const cleanGoal = String(goal || "").trim() || "Complete the task";
  const title = cleanGoal.slice(0, 48);
  const safety = checkWorkaroundSafety(cleanGoal);
  const chainTried = [];

  if (safety.touchesSecretScreen) {
    chainTried.push(...WORKAROUND_ORDER);
    const msg = `### Safe workaround plan\n\n${safety.safetyNote}\n\n1. Open the page or app yourself and handle the password or billing screen directly.\n2. Once signed in or past billing, ask Meldmind to draft or review the non-sensitive steps.`;
    return {
      step: "closest_option",
      chainTried,
      safety,
      title,
      assembly: "Present the safe manual steps clearly.",
      tasks: [{
        id: "t1",
        title: "Safe manual step for protected screen",
        capability: "writing",
        difficulty: 1,
        deps: [],
        status: "done",
        provider: "workaround",
        model: "safety-gate",
        agentName: "Safety gate (never touches billing or passwords)",
        estCost: 0,
        cost: 0,
        output: msg,
        review: null,
        workaround: { step: "closest_option", safety },
      }],
      deliverable: msg,
      workaround: {
        step: "closest_option",
        chainTried,
        requiresApproval: safety.requiresApproval,
        approvalKind: safety.approvalKind,
        neverBypassApproval: true,
        neverTouchBillingOrPasswords: true,
        safetyBlocked: true,
        note: safety.safetyNote,
      },
    };
  }

  // Step 1: Try installed/allowed apps on this PC.
  chainTried.push("installed_app");
  const appPick = (typeof suggestAppFn === "function" && (suggestAppFn(cls?.capability || "") || suggestAppFn("code") || suggestAppFn("creative") || suggestAppFn("research"))) || null;
  if (appPick) {
    const t1 = {
      id: "t1",
      title: `Use ${appPick.name} for ${title}`,
      capability: cls?.capability || "reasoning",
      difficulty: 1,
      deps: [],
      instructions: cleanGoal,
      deliverable: "Step prepared in the allowed app (waits for your confirmation before pressing controls).",
      app: true,
      appId: appPick.id,
      status: "queued",
      provider: "app",
      model: appPick.name,
      agentName: `${appPick.name} · workaround`,
      estCost: 0,
      cost: 0,
      output: null,
      review: null,
      requiresApproval: safety.requiresApproval,
      approvalKind: safety.approvalKind,
      workaround: { step: "installed_app", appId: appPick.id, appName: appPick.name, safety },
    };
    return {
      step: "installed_app",
      chainTried,
      safety,
      title,
      assembly: `Run through allowed app ${appPick.name}.`,
      tasks: [t1],
      deliverable: null,
      workaround: {
        step: "installed_app",
        chainTried,
        appId: appPick.id,
        appName: appPick.name,
        requiresApproval: safety.requiresApproval,
        approvalKind: safety.approvalKind,
        neverBypassApproval: true,
        neverTouchBillingOrPasswords: true,
        note: `Routed to allowed app ${appPick.name}. ${safety.safetyNote}`,
      },
    };
  }

  // Step 2: Try the built-in browser helper.
  chainTried.push("browser_helper");
  const ma = browser === false ? null : (typeof missionAgentFn === "function" ? missionAgentFn({ browser }) : null);
  if (ma) {
    const t1 = {
      id: "t1",
      title: `Browser helper: ${title}`,
      capability: "agent",
      difficulty: 1,
      deps: [],
      needs: Array.isArray(ma.TAGS) && ma.TAGS.length ? [ma.TAGS[0]] : ["web"],
      agent: true,
      status: "queued",
      provider: ma.id,
      model: ma.id,
      agentName: `${ma.name} · workaround`,
      instructions: cleanGoal,
      deliverable: "Step handled in the browser helper window (waits for your OK before any send, pay, delete, or sign).",
      estCost: 0,
      cost: 0,
      output: null,
      review: null,
      requiresApproval: safety.requiresApproval,
      approvalKind: safety.approvalKind,
      workaround: { step: "browser_helper", agentId: ma.id, agentName: ma.name, safety },
    };
    return {
      step: "browser_helper",
      chainTried,
      safety,
      title,
      assembly: `Use ${ma.name} with approval gates intact.`,
      tasks: [t1],
      deliverable: null,
      workaround: {
        step: "browser_helper",
        chainTried,
        agentId: ma.id,
        agentName: ma.name,
        requiresApproval: safety.requiresApproval,
        approvalKind: safety.approvalKind,
        neverBypassApproval: true,
        neverTouchBillingOrPasswords: true,
        note: `Routed to ${ma.name}. ${safety.safetyNote}`,
      },
    };
  }

  // Step 3: Break into smaller difficulty-1 steps and check if any light/local/demo model can run them.
  chainTried.push("smaller_steps");
  const smallTasks = decomposeIntoSmallerSteps(cleanGoal, cls);
  const smallPick = typeof openRankFn === "function" ? (openRankFn({ capability: "writing", difficulty: 1, mode })?.[0] || null) : null;
  if (smallPick) {
    const assigned = smallTasks.map((st) => ({
      ...st,
      status: "queued",
      provider: smallPick.provider,
      model: smallPick.model,
      agentName: `${smallPick.providerName || smallPick.provider} · smaller step`,
      estCost: smallPick.estCost || 0,
      cost: 0,
      output: null,
      review: null,
      requiresApproval: safety.requiresApproval,
      approvalKind: safety.approvalKind,
      workaround: { step: "smaller_steps", safety },
    }));
    return {
      step: "smaller_steps",
      chainTried,
      safety,
      title,
      assembly: "Combine the smaller step outputs into one clear answer.",
      tasks: assigned,
      deliverable: null,
      workaround: {
        step: "smaller_steps",
        chainTried,
        provider: smallPick.provider,
        model: smallPick.model,
        requiresApproval: safety.requiresApproval,
        approvalKind: safety.approvalKind,
        neverBypassApproval: true,
        neverTouchBillingOrPasswords: true,
        note: `Broke the job into ${assigned.length} smaller steps for ${smallPick.providerName || smallPick.provider}. ${safety.safetyNote}`,
      },
    };
  }

  // Step 4: Offer the closest viable option with an immediate actionable breakdown.
  chainTried.push("closest_option");
  const closestTasks = smallTasks.map((st, idx) => ({
    ...st,
    status: "done",
    provider: "workaround",
    model: "closest-option",
    agentName: "Workaround planner · closest viable option",
    estCost: 0,
    cost: 0,
    output: `**Step ${idx + 1}: ${st.title}**\n${st.instructions}\n- Deliverable: ${st.deliverable}`,
    review: null,
    requiresApproval: safety.requiresApproval,
    approvalKind: safety.approvalKind,
    workaround: { step: "closest_option", safety },
  }));
  const deliverable = [
    `### Closest viable plan for: ${cleanGoal}`,
    "",
    "No live AI key or allowed desktop app was ready for automatic execution, so Meldmind broke your goal into smaller ready-to-run steps:",
    "",
    ...closestTasks.map((t) => t.output),
    "",
    "### Closest options to finish this automatically",
    "1. **Use an app on this PC**: Open **Settings > Programs on this PC** and allow a matching app.",
    "2. **Use the built-in browser helper**: Turn on the browser helper in **Command** for web steps.",
    "3. **Connect one key or Practice AIs**: Add a free OpenRouter key in **Settings > My AIs**, or click **Try it now** in Setup.",
    "",
    `*Safety note: ${safety.safetyNote}*`,
  ].join("\n");

  return {
    step: "closest_option",
    chainTried,
    safety,
    title,
    assembly: "Provide the decomposed steps and closest viable options.",
    tasks: closestTasks,
    deliverable,
    workaround: {
      step: "closest_option",
      chainTried,
      requiresApproval: safety.requiresApproval,
      approvalKind: safety.approvalKind,
      neverBypassApproval: true,
      neverTouchBillingOrPasswords: true,
      note: `Offered closest viable option with ${closestTasks.length} smaller steps. ${safety.safetyNote}`,
    },
  };
}

export function resolveTaskWorkaround(t, {
  goal = "",
  mode = "balanced",
  browser,
  MA = null,
  suggestAppFn = suggestApp,
  openRankFn = null,
} = {}) {
  const safety = checkWorkaroundSafety(`${t?.title || ""} ${t?.instructions || ""} ${goal}`);
  const chainTried = [];

  if (!safety.touchesSecretScreen) {
    chainTried.push("installed_app");
    const appPick = typeof suggestAppFn === "function" ? (suggestAppFn(t.capability || "") || suggestAppFn("writing")) : null;
    if (appPick) {
      return {
        ...t,
        app: true,
        appId: appPick.id,
        status: "queued",
        provider: "app",
        model: appPick.name,
        agentName: `${appPick.name} · workaround`,
        estCost: 0,
        output: null,
        review: null,
        cost: 0,
        requiresApproval: safety.requiresApproval,
        approvalKind: safety.approvalKind,
        workaround: { step: "installed_app", chainTried, appId: appPick.id, safety },
      };
    }

    chainTried.push("browser_helper");
    if (MA && browser !== false) {
      const needs = Array.isArray(MA.TAGS) && MA.TAGS.length ? [MA.TAGS[0]] : ["web"];
      return {
        ...t,
        capability: "agent",
        needs,
        agent: true,
        status: "queued",
        provider: MA.id,
        model: MA.id,
        agentName: `${MA.name} · workaround`,
        estCost: 0,
        output: null,
        review: null,
        cost: 0,
        requiresApproval: safety.requiresApproval,
        approvalKind: safety.approvalKind,
        workaround: { step: "browser_helper", chainTried, agentId: MA.id, safety },
      };
    }

    chainTried.push("smaller_steps");
    const smallPick = typeof openRankFn === "function" ? (openRankFn({ capability: "writing", difficulty: 1, mode })?.[0] || null) : null;
    if (smallPick) {
      return {
        ...t,
        difficulty: 1,
        status: "queued",
        provider: smallPick.provider,
        model: smallPick.model,
        agentName: `${smallPick.providerName || smallPick.provider} · smaller step`,
        estCost: smallPick.estCost || 0,
        output: null,
        review: null,
        cost: 0,
        requiresApproval: safety.requiresApproval,
        approvalKind: safety.approvalKind,
        workaround: { step: "smaller_steps", chainTried, provider: smallPick.provider, safety },
      };
    }
  } else {
    chainTried.push("installed_app", "browser_helper", "smaller_steps");
  }

  chainTried.push("closest_option");
  const fallbackText = safety.touchesSecretScreen
    ? `Skipped automatic control on "${t.title}": ${safety.safetyNote}`
    : `**Closest viable option for "${t.title}"**\n- Action: ${t.instructions || t.title}\n- Expected result: ${t.deliverable || "Completed step"}\n- Tip: Allow a matching program in Settings > Programs on this PC or connect an AI key to run this step automatically.\n- Safety: ${safety.safetyNote}`;
  return {
    ...t,
    status: "done",
    provider: "workaround",
    model: "closest-option",
    agentName: "Workaround · closest viable option",
    estCost: 0,
    cost: 0,
    output: fallbackText,
    review: null,
    requiresApproval: safety.requiresApproval,
    approvalKind: safety.approvalKind,
    workaround: { step: "closest_option", chainTried, safety },
  };
}

const running = new Map(); // id -> AbortController (ids are unique across users)
const live = new Map(); // id -> the mission object while it runs (a media job finished meanwhile lands on it)
export const liveMissionList = () => [...live.values()];
const issued = new Set(); // ids handed to a run, so pause can find one that has not registered yet
const pendingPause = new Set();
const scheduledOf = () => ctx().scheduled; // per user: id -> { timer, mission, opts }
const saveDoc = (m) => ctx().store.saveMission(m, missionSummary(m));

export const ONE_AI_LABEL = "Get a one-AI answer";
// "This try cost $0.03 for planning." (or "... before it stopped."), so a failed run never hides a charge
export function costLine(spent, mission = {}) {
  const usd = Number(spent) || 0;
  const amount = usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(4);
  const planningOnly = !(mission.tasks || []).some((t) => (Number(t.cost) || 0) > 0);
  return `This try cost $${amount}${planningOnly ? " for planning" : " before it stopped"}. You can try again or get a one-AI answer.`;
}
class MissionPause extends Error {
  constructor() {
    super("Mission paused");
    this.name = "MissionPause";
    this.code = "paused";
  }
}
// 0.4.21 (dogfood 15): only the person's own Pause pauses a mission. An AI that is paused for no credits throws
// code "paused" too (server/fallback.js), but with a kind (credits, rate); that is a failed call, never a paused
// mission. Before this, a mission where every AI was out of credits sat at "paused" with nothing to resume.
export function isMissionPause(err) {
  return err instanceof MissionPause || (err?.code === "paused" && !err.kind && err.status !== 402);
}
function shouldPause(mission) {
  if (mission && pendingPause.has(mission.id)) {
    pendingPause.delete(mission.id);
    mission.pauseRequested = true;
  }
  return !!mission?.pauseRequested;
}
function armPause(mission, ctl) {
  if (mission) mission.pauseRequested = true;
  if (mission) pendingPause.delete(mission.id);
  if (ctl && !ctl.signal.aborted) {
    try { ctl.abort("pause"); } catch { /* already stopped */ }
  }
}
function rewindTask(t) {
  if (!t || t.status === "done" || t.status === "waiting" || t.status === "failed") return;
  t.status = "queued";
  t.error = null;
  t.output = null;
  t.startedAt = null;
}
function throwIfPause(mission, ctl, t) {
  const reason = ctl?.signal?.reason;
  const pausing = shouldPause(mission) || (ctl?.signal?.aborted && reason === "pause");
  if (!pausing) return;
  armPause(mission, ctl);
  if (t) rewindTask(t);
  throw new MissionPause();
}

// Compact row for lists (the same shape index.js used to build from the files).
export function missionSummary(m) {
  return { id: m.id, kind: m.kind, title: m.title || m.prompt?.slice(0, 90), projectId: m.projectId, private: !!m.private, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt || null, cost: m.cost, tasks: m.tasks?.length || 0, providers: [...new Set((m.tasks || []).map((t) => t.provider))].concat(m.provider ? [m.provider] : []) };
}

export function abortMission(id) {
  pendingPause.delete(id);
  const scheduled = scheduledOf();
  if (scheduled.has(id)) {
    clearTimeout(scheduled.get(id).timer);
    const m = scheduled.get(id).mission;
    scheduled.delete(id); persistScheduled();
    m.status = "cancelled"; m.finishedAt = Date.now();
    emit("mission.update", { mission: m });
    emit("log", { text: `Scheduled mission cancelled: ${m.title}`, missionId: id });
    return true;
  }
  const mission = live.get(id);
  if (mission) mission.pauseRequested = false;
  const ctl = running.get(id);
  if (ctl && !ctl.signal.aborted) {
    try { ctl.abort("abort"); } catch { /* already stopped */ }
  }
  return running.has(id);
}

export function pauseMission(id) {
  const scheduled = scheduledOf();
  if (scheduled.has(id)) return { ok: false, reason: "scheduled" };
  const mission = live.get(id);
  const ctl = running.get(id);
  if (mission && ctl) {
    if (mission.status === "paused") return { ok: true, state: "paused" };
    armPause(mission, ctl);
    return { ok: true, state: "stopping" };
  }
  if (issued.has(id)) {
    pendingPause.add(id);
    return { ok: true, state: "queued" };
  }
  return { ok: false, reason: "missing" };
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function editPausedMission(id, patch = {}) {
  if (live.has(id) || running.has(id)) throw httpError("Wait until the mission is paused.", 409);
  const m = await ctx().store.getMission(id);
  if (!m || m.kind !== "mission") throw httpError("Mission not found.", 404);
  if (m.status !== "paused") throw httpError("Only a paused mission can be edited.", 409);
  if (typeof patch.goal === "string" && patch.goal.trim()) {
    m.prompt = patch.goal.trim().slice(0, 8000);
    m.goalEdited = true;
  }
  if (Array.isArray(patch.tasks)) {
    for (const edit of patch.tasks) {
      const t = (m.tasks || []).find((x) => x && x.id === edit?.id);
      if (!t || t.status === "done" || t.status === "waiting") continue;
      if (typeof edit.title === "string" && edit.title.trim()) t.title = edit.title.trim().slice(0, 200);
      if (typeof edit.instructions === "string") t.instructions = String(edit.instructions).slice(0, 4000);
      if (typeof edit.deliverable === "string") t.deliverable = String(edit.deliverable).slice(0, 1000);
      t.edited = true;
    }
  }
  saveDoc(m);
  emit("mission.update", { mission: publicMission(m) });
  emit("log", { text: "Paused mission updated.", missionId: id });
  return publicMission(m);
}

export async function beginResume(id) {
  if (running.has(id)) throw httpError("This mission is already running.", 409);
  const stored = await ctx().store.getMission(id);
  if (!stored || stored.kind !== "mission") throw httpError("Mission not found.", 404);
  if (stored.status !== "paused") throw httpError("Only a paused mission can resume.", 409);
  // Register the run before this function resolves, so pause can see it, and do not wait for the work.
  const promise = runMission({
    goal: stored.prompt,
    mode: stored.mode || "balanced",
    projectId: stored.projectId,
    qa: stored.qa !== false,
    budgetUsd: stored.budgetUsd ?? 2,
    id: stored.id,
    restore: stored,
  });
  promise.catch((e) => emit("log", { text: `Mission failed: ${e.message}`, level: "error" }));
  return { ok: true, id: stored.id };
}

function persistScheduled() {
  putDoc("scheduled", [...scheduledOf().values()].map((s) => ({ mission: s.mission, opts: s.opts })));
}
// Queue a mission for a cheaper window (the next time-of-day discount) instead of running now.
export function scheduleMission(opts, at, reason) {
  const id = "q-" + Date.now().toString(36);
  const mission = { id, kind: "mission", title: opts.goal.slice(0, 90), prompt: opts.goal, projectId: opts.projectId || null, mode: opts.mode, status: "scheduled", startedAt: Date.now(), scheduledFor: at.getTime(), reason, tasks: [], cost: 0, log: [] };
  const delay = Math.max(0, at.getTime() - Date.now());
  const scheduled = scheduledOf();
  const timer = setTimeout(() => {
    scheduled.delete(id); persistScheduled();
    mission.status = "started"; mission.finishedAt = Date.now();
    saveDoc(mission);
    emit("mission.update", { mission });
    emit("log", { text: `Off-peak window open: starting "${mission.title}".`, missionId: id });
    runMission(opts).catch((e) => emit("log", { text: `Mission failed: ${e.message}`, level: "error" }));
  }, delay);
  timer.unref?.();
  scheduled.set(id, { timer, mission, opts, at: at.getTime() });
  persistScheduled();
  saveDoc(mission);
  emit("mission.update", { mission });
  emit("log", { text: `Mission queued for ${at.toLocaleString()} (${reason}).`, missionId: id });
  return mission;
}
export const scheduledMissions = () => [...scheduledOf().values()].map((s) => s.mission);
export function restoreScheduled() {
  const list = doc("scheduled", () => []);
  for (const s of list) {
    const at = new Date(Math.max(Date.now() + 5000, s.mission.scheduledFor || 0));
    scheduleMission(s.opts, at, s.mission.reason || "restored after restart");
  }
}

export async function runMission({ goal, mode = "balanced", projectId, qa = true, budgetUsd = 2, maxTasks = 6, context = "", search, searchMode, filter, tools, grokbot, browser, libraries, private: isPrivate = false, skip, tone, toneId, id: givenId, restore = null, getItDone, sendMessages, employees }) {
  mode = normalizeMode(mode) || "balanced";
  const skipped = cleanSkip(skip);
  const skipSet = new Set(skipped);
  const held = skipAvoid(skipped);
  // After the first 402 / 429 from an AI, every later step of this run leaves that AI out (all of its models).
  const runTrouble = (pid) => { if (skipSet.has(pid)) return; skipSet.add(pid); held.push(...skipAvoid([pid])); };
  // 0.4.21 (dogfood 11, 12): an AI that is out of credits, rate limited or holding after a real 402/429/403
  // takes no new work while another AI can run, so the plan line and every step name the AIs that will really run.
  const canTakeWork = (m) => { try { return !isDeadNow(m.provider) && !heldByRealFailure(m.provider); } catch { return true; } };
  const keepAlive = (list) => { const live = (list || []).filter(canTakeWork); return live.length ? live : list; };
  const openRank = (opts) => keepAlive(rank(opts).filter((m) => m && !skipSet.has(m.provider)));
  const openPick = (opts) => openRank(opts)[0] || null;
  const planning = planMode(mode);
  const looking = reviewMode(mode);
  const id = restore?.id || givenId || ("m-" + Date.now().toString(36));
  issued.add(id);
  if (isPrivate) markPrivateRun(id);
  const ctl = new AbortController();
  running.set(id, ctl);
  lateWhileRunning.set(id, []);
  const t0 = restore?.startedAt || Date.now();
  // project memory (R5): voice, offers, never-say list and past winners ride along in the context of every step
  // (the QA reviewer and the assembler get it too, so the never-say list holds in the final deliverable)
  const memBlock = contextFor(projectId, goal);
  context = withMemory(context, projectId, `${goal}\n${context}`);
  const memNote = memBlock ? `\n\n${memBlock}` : "";
  // the folders a code step may write into: only the project's own, never another project's
  const codeFolders = () => (projectId ? projectFolders(projectId) : []);
  const mission = restore || { id, kind: "mission", prompt: goal, projectId: projectId || null, private: !!isPrivate, mode, qa, budgetUsd, status: "planning", startedAt: t0, tasks: [], plan: null, cost: 0, deliverable: null, log: [], sources: [], toolCalls: [], fallbacks: [], memory: carriesMemory(context), ...(toneId ? { tone: toneId } : {}) };
  // AI employees picked for this mission: each step goes to the best fit and runs with its job script
  const crew = resolveCrew(restore ? restore.employees : employees);
  if (!restore && crew.length) mission.employees = crew.map((c) => c.id);
  if (restore) {
    mission.status = "running";
    mission.pauseRequested = false;
    mission.finishedAt = null;
    mission.error = null;
    for (const t of mission.tasks || []) rewindTask(t);
  }
  live.set(id, mission);
  const user = ctx();
  user.missionsInFlight = (user.missionsInFlight || 0) + 1;
  let lib = null; // knowledge-library excerpts for this mission (Phase 18)
  let searchOn = false;
  let MA = null;
  const needsWebModel = (t) => !!t.needWeb && !searchOn;
  const crewMember = (t) => (t.employee ? crew.find((c) => c.id === t.employee.id) || null : null);
  const log = (text, extra = {}) => { mission.log.push({ ts: Date.now(), text }); emit("log", { text, missionId: id, ...extra }); };
  const update = () => { emit("mission.update", { mission: publicMission(mission) }); save(mission); };
  const spend = (e) => { mission.cost = +(mission.cost + e.cost).toFixed(5); };
  const spendEntry = (e) => { spend(e); return e; };
  const explicitSearch = typeof search === "boolean" ? search : undefined;
  // smart fallback (Phase 26): every hop is kept on the mission and announced in the feed
  const stoodIn = (ev, agent, role, taskId = null) => { mission.fallbacks.push(fallbackRecord(ev)); announceFallback(ev, { missionId: id, taskId, agentFrom: agent, agentTo: agent, role }); };
  let plan = null;
  let planner = null;

  try {
    openGrant({ runId: id, text: goal, toggle: getItDone === true, send: sendMessages === true });
    update();
    if (shouldPause(mission)) { armPause(mission, ctl); throw new MissionPause(); }
    if (restore?.tasks?.length) {
      plan = { title: mission.plan?.title || mission.title || String(goal || "").slice(0, 40), assembly: mission.plan?.assembly || "", tasks: mission.tasks };
      context = mission.runContext || context;
      searchOn = !!mission.searchWasOn;
      MA = missionAgent({ grokbot, browser });
      planner = mission.planner ? { ...mission.planner, providerName: mission.planner.providerName || PROVIDERS[mission.planner.provider]?.name || mission.planner.provider } : null;
      mission.status = "running";
      update();
    } else {
    const cls = await classify(goal, { onCall: (c) => { spend(recordCall({ ...c, missionId: id })); } });
    mission.classification = cls;

    // ---- live web search (Phase 15): one search on the goal; the sources ride along as context ----
    // 0.4.21: no web search the person did not ask for (dogfood 03 and 04: it ran on a landing page and a campaign plan and leaked "[1]" into the answer)
    const askedSearch = explicitSearch === true || searchMode === "pro" || (explicitSearch === undefined && wantsSearch(goal));
    mission.searchAsked = askedSearch;
    const web = await prepareWeb({ prompt: goal, kind: "mission", missionId: id, explicit: askedSearch ? explicitSearch : false, needWeb: !!cls?.needWeb && askedSearch, filter, mode: searchMode === "pro" ? "pro" : undefined });
    mission.searched = web != null;
    searchOn = !!web && !web.native && !web.skipped;
    if (web?.native) log("Search the web is set to the model's own search, which missions cannot use. Pick Tavily, Brave or Serper in Settings > Web search.");
    if (web?.sources?.length) { mission.sources = web.sources; mission.searchEngine = web.name; spend({ cost: web.cost || 0 }); context = `${context ? `${context}\n\n` : ""}${web.block}`; }
    // ---- knowledge libraries (Phase 18): the best excerpts for the goal ride along as context, cited as [L1], [L2] ----
    lib = await libraryAugment({ prompt: goal, projectId, missionId: id, explicit: Array.isArray(libraries) ? libraries : undefined });
    if (lib) { mission.librarySources = publicLibrarySources(lib.sources); spend({ cost: lib.cost || 0 }); if (lib.block) context = `${context ? `${context}\n\n` : ""}${lib.block}`; update(); }

    // 0.4.21 (dogfood 01): a code task that names a file reads that file; every worker gets it in its context
    try {
      const named = namedSources(goal);
      const folders = named.length ? projectFolders(projectId) : [];
      if (named.length && folders.length) {
        const files = attachSources(goal, { projectId, folders });
        const missing = named.filter((n) => !files.some((f) => f.name === n));
        const editing = /\b(fix|patch|change|edit|update|refactor|debug|review|modify|bug|rename|line)\b/i.test(goal);
        if (files.length || (editing && missing.length)) {
          context = `${context ? `${context}\n\n` : ""}${sourceBlock(files, editing ? missing : [])}`;
          mission.attachedFiles = files.map((f) => ({ name: f.name, lines: f.from > 1 || f.truncated ? [f.from, f.to] : null }));
          log(files.length ? `Attached ${files.map((f) => f.name).join(", ")} from your project folder to every step.` : `${missing.join(", ")} was not found in the project folder, so no code is attached.`);
        }
      }
    } catch (e) { console.error("[mission] attach source:", e.message); }

    // Grok Bot (Phase 12), else the built-in browser helper (Phase 27): offered to the planner only when it
    // is ready and not left out by the person
    MA = missionAgent({ grokbot, browser });
    const agentOn = !!MA;
    const agentLine = !agentOn ? "" : MA.id === GROKBOT
      ? `\nA step that must act in the person's signed-in browser, Gmail, Google Drive, Google Calendar or with their teammate bots gets capability "agent" and "needs": a list from ${JSON.stringify(MA.TAGS)}; their own assistant, ${MA.name}, does those steps. Never use "agent" for plain writing, research or analysis.`
      : `\nA step that must act on a website (signed-in pages, forms), in the person's Gmail or in their Google Drive gets capability "agent" and "needs": a list from ${JSON.stringify(MA.TAGS)}; the built-in ${MA.name} does those steps in its own browser window (every send, post or form submit waits for the person's OK). Never use "agent" for plain writing, research or analysis.`;

    // 0.4.21: a live credit check BEFORE planning, so the plan and the estimate use only AIs that work
    try {
      const cc = await creditCheck({});
      mission.creditCheck = { summary: cc.summary, out: cc.out.map((o) => o.name), replace: cc.replace || "", freeOnly: cc.freeOnly };
      log(`Credit check: ${cc.summary}.${cc.replace ? ` ${cc.replace}` : ""}${cc.freeOnly ? " Free only is on." : ""}`);
    } catch { /* the check is a help, never a blocker */ }
    // ---- 1. Plan ----
    planner = openPick({ capability: "reasoning", difficulty: 3, mode: planning });
    const navFlag = isNavStateEnabled(doc("settings", () => ({})));
    if (!planner) {
      if (!navFlag) throw new Error("No AI is available to plan. Add an API key in Settings.");
      const wPlan = buildWorkaroundPlan({ goal, cls, mode, browser, missionAgentFn: () => MA, suggestAppFn: suggestApp, openRankFn: openRank });
      mission.workaround = wPlan.workaround;
      mission.plan = { title: wPlan.title, assembly: wPlan.assembly };
      mission.title = wPlan.title;
      mission.tasks = wPlan.tasks;
      mission.runContext = context;
      mission.searchWasOn = searchOn;
      log(`Workaround planner (${wPlan.step}): ${wPlan.workaround.note}`);
      if (wPlan.deliverable) {
        mission.deliverable = wPlan.deliverable;
        mission.status = "done";
        update();
        return mission;
      }
      plan = { title: wPlan.title, assembly: wPlan.assembly, tasks: wPlan.tasks };
      mission.status = "running";
      update();
    } else {
    mission.planner = { provider: planner.provider, model: planner.model };
    const pAgent = `${id}:planner`;
    emit("agent.start", { agent: pAgent, provider: planner.provider, model: planner.model, role: "plan", missionId: id, label: `${planner.providerName} planning` });
    log(`Drawing up the plan.`);
    const s0 = Date.now();
    try {
      let planExtra = "";
      const callPlanner = () => completeFallback({
        provider: planner.provider, model: planner.model, maxTokens: 1500, signal: ctl.signal,
        system: `You are the chief of staff for a small creative/marketing business. Break the goal into ${Math.min(maxTasks, 6)} or fewer concrete tasks that different AI specialists can do independently, with dependencies where one needs another's output. Reply with JSON only:
{"title": "<=8 words", "tasks": [{"id": "t1", "title": "<=10 words", "capability": "reasoning|code|writing|research|creative|analysis|math|media${agentOn ? "|agent" : ""}", "difficulty": 1|2|3, "needWeb": false, "deps": [], "instructions": "precise instructions for the specialist, 1-3 sentences", "deliverable": "what the output must contain"}], "assembly": "how the final deliverable should be put together, 1-2 sentences"}
Keep it tight: no task that just restates the goal. Research tasks need needWeb true only if live information is required.${MEDIA_LINE}${SAVE_LINE}${agentLine}${planExtra}`,
        messages: [{ role: "user", content: `GOAL:\n${goal}${context ? `\n\nCONTEXT:\n${context}` : ""}` }],
      }, { missionId: id, role: "plan", tools: false, cls: { capability: "reasoning", difficulty: 3 }, mode: planning, skipProviders: skipSet, onTrouble: runTrouble }, { onFallback: (ev) => { stoodIn(ev, pAgent, "plan"); mission.planner = { provider: ev.to.provider, model: ev.to.model, standIn: { for: ev.from.provider, reason: ev.reason, via: ev.via || null } }; } });
      const r = await callPlanner();
      // 0.4.21 (dogfood 11, 12): name the AI that really drew the plan up. When smart fallback stood in
      // (ChatGPT 429, OpenRouter 402, Gemini 429, then Claude Opus) the log says who really did it.
      const plannedBy = PROVIDERS[r.provider]?.name || r.provider;
      const stoodFor = mission.planner?.standIn ? PROVIDERS[mission.planner.standIn.for]?.name || mission.planner.standIn.for : null;
      log(stoodFor ? `${plannedBy} is drawing up the plan (standing in for ${stoodFor}).` : `${plannedBy} is drawing up the plan.`);
      const ms = Date.now() - s0;
      noteCall(r.provider, true, ms);
      spend(recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: id, role: "plan", ms }));
      plan = extractJson(r.text);
      // 0.4.21 never just stops: a plan that hands a step to an AI or agent that cannot run now (Antigravity, Grok Bot,
      // an AI with no key) is planned again for the connected AIs, and cleaned up if it still names them.
      const readyIds = new Set([...openRank({ capability: "reasoning", difficulty: 2, mode }).map((m) => m.provider), ...(MA ? [MA.id] : [])]);
      const named = unavailableNamed(plan, { goal, readyIds });
      if (named.length) {
        const readyNames = [...new Set(openRank({ capability: "reasoning", difficulty: 2, mode }).map((m) => m.providerName))].slice(0, 6);
        log(`The plan named ${named.map((n) => n.name).join(" and ")}, which cannot run right now. Planning again with the AIs that are connected.`);
        planExtra = replanLine(named.map((n) => n.name), readyNames);
        try {
          const r2 = await callPlanner();
          spend(recordCall({ provider: r2.provider, model: r2.model, usage: r2.usage, missionId: id, role: "plan", ms: Date.now() - s0 }));
          const again = extractJson(r2.text);
          if (again?.tasks?.length) plan = again;
        } catch (e2) { log(`The second plan did not come back (${plainMessage(e2)}). Using the first one on the connected AIs.`); }
        const still = unavailableNamed(plan, { goal, readyIds });
        if (still.length) plan = scrubUnavailable(plan, still);
        mission.replanned = { named: named.map((n) => n.name) };
      }
      // fields only the engine sets (who runs a step, whether it is an agent or app step) are never taken from the plan's words:
      // "agent": "Grok Bot" in a plan used to turn a normal step into an agent step that could not run
      if (Array.isArray(plan?.tasks)) plan.tasks = plan.tasks.filter((t) => t && typeof t === "object").map(({ agent, app, appId, agentName: _an, agentJob, workaround, provider, model, status, output, review, cost, estCost, ...t }) => ({ ...t, capability: cleanCapability(t.capability, cls.capability || "reasoning") }));
      emit("agent.done", { agent: pAgent, provider: r.provider, model: r.model, missionId: id, ms });
    } catch (err) {
      noteCall(planner.provider, false, Date.now() - s0, err);
      emit("agent.error", { agent: pAgent, provider: planner.provider, model: planner.model, missionId: id, error: err.message });
      throw err;
    }
    if (!plan?.tasks?.length) {
      plan = { title: goal.slice(0, 40), tasks: [{ id: "t1", title: "Do the job", capability: cls.capability, difficulty: cls.difficulty, needWeb: cls.needWeb, deps: [], instructions: goal, deliverable: "The complete answer" }], assembly: "Use the single task output." };
    }
    plan.tasks = plan.tasks.slice(0, maxTasks).map((t, i) => ({ ...t, id: t.id || `t${i + 1}`, deps: (t.deps || []).filter(Boolean) }));
    mission.plan = { title: plan.title, assembly: plan.assembly };
    mission.title = plan.title;
    // 0.4.21 (dogfood 12): a code step that names a file can only save it when the project folder is known. Say so before any work starts.
    if (plan.tasks.some((t) => stepFileNames(t).some((n) => !/\.html?$/i.test(n))) && !codeFolders().length) {
      mission.planNote = `Heads up before we start: ${NOT_SAVED_LINE} Link your project folder to this project to have files written there.`;
      log(mission.planNote);
    }
    // 0.4.21 (dogfood 13): no image AI connected. A flat graphic is drawn here (no "render with Pillow" step that cannot run);
    // any other image job says at planning time that it cannot be made and what to add.
    if (neededMedia(goal).includes("image")) {
      const ist = mediaStatus("image", goal);
      if (ist?.local) {
        const fixed = localizeImagePlan(plan, goal);
        if (fixed.changed) { plan = fixed.plan; log("The plan had a step that renders the picture with a program. Meldmind draws this flat graphic itself instead."); }
        mission.planNote = [mission.planNote, ist.message].filter(Boolean).join(" ");
        log(ist.message);
      } else if (ist && !ist.ok) {
        mission.planNote = [mission.planNote, ist.message].filter(Boolean).join(" ");
        log(ist.message, { level: "error" });
      }
    }

    // ---- 2. Assign ----
    // a task that needs live information is limited to models with their own web access, unless the
    // search engine is on: then any model can do it, because the task gets its own search results
    const used = new Map();
    for (const t of plan.tasks) {
      // 0.4.21 (dogfood 10): "save it to my MindMedia / my library" is a local step done by Meldmind itself. It never goes to
      // Grok Bot or the browser helper (the planner had invented a "signed-in MindMedia account").
      if (isLocalSaveStep(t)) {
        const { agent: _a, needs: _n, ...rest } = t;
        mission.tasks.push({ ...rest, capability: "save", save: true, status: "queued", provider: "meldmind", model: "MindMedia", agentName: "Meldmind · save to MindMedia", estCost: 0, output: null, review: null, cost: 0 });
        continue;
      }
      // 0.4.21 (dogfood 12): "run the tests" is done here, on this PC, by node. No AI can run a command from a chat reply.
      if (isRunStep(t)) {
        const { agent: _a, needs: _n, ...rest } = t;
        mission.tasks.push({ ...rest, capability: "run", run: true, status: "queued", provider: "meldmind", model: "node", agentName: "Meldmind · runs node tests here", estCost: 0, output: null, review: null, cost: 0 });
        continue;
      }
      // a step that needs signed-in browsing, Gmail, Drive, Calendar or teammate bots goes to the agent
      const fit = agentOn ? MA.want({ prompt: `${t.title}. ${t.instructions || ""}`, explicit: MA.id === GROKBOT ? grokbot : browser }) : null;
      if (agentOn && (t.capability === "agent" || (fit.use && fit.needs.length))) {
        const needs = [...new Set([...(Array.isArray(t.needs) ? t.needs.filter((x) => MA.TAGS.includes(x)) : []), ...fit.needs])];
        mission.tasks.push({ ...t, capability: "agent", needs, agent: true, status: "queued", provider: MA.id, model: MA.id, agentName: `${MA.name} · ${needs.map((x) => MA.TAG_LABEL[x]).join(", ") || (MA.id === GROKBOT ? "its own computer" : "its own window")}`, estCost: 0, output: null, review: null, cost: 0 });
        continue;
      }
      // a media step (R2): a video, image or voice file through a media provider; the estimate is shown and a
      // paid one waits for the person's OK (no key: a dry run with a placeholder file)
      const media = t.capability === "media" ? mediaPlan(t, goal) : null;
      if (media) {
        mission.tasks.push({ ...t, capability: "media", media, status: "queued", provider: media.provider, model: media.provider, agentName: `${media.providerName} · ${media.kind}${media.dryRun ? " (dry run)" : ""}`, estCost: 0, output: null, review: null, cost: 0 });
        continue;
      }
      if (t.capability === "media") t.capability = "creative"; // not a kind a media provider makes: a text AI writes the brief
      if (t.capability === "agent") t.capability = "research"; // nobody to hand it to: the best text AI does what it can
      // An allowed app takes a step of its own task type. Writing stays with a text model.
      // Grok Bot and the browser helper already took their agent steps above.
      if (t.capability !== "writing" && t.capability !== "agent" && t.capability !== "media") {
        const appPick = suggestApp(t.capability || "");
        if (appPick) {
          mission.tasks.push({ ...t, app: true, appId: appPick.id, status: "queued", provider: "app", model: appPick.name, agentName: `${appPick.name} · ${t.capability}`, estCost: 0, output: null, review: null, cost: 0 });
          continue;
        }
      }
      const ranked = openRank({ capability: t.capability || "reasoning", difficulty: Number(t.difficulty) || 2, mode, needWeb: needsWebModel(t) });
      // spread the load: prefer a provider not already carrying 2 tasks when scores are close
      let choice = ranked[0];
      for (const c of ranked.slice(0, 4)) {
        if ((used.get(c.provider) || 0) < 2 && c.score >= (ranked[0].score - 6)) { choice = c; break; }
      }
      if (!choice) choice = ranked[0];
      if (!choice) {
        if (!navFlag && freeOnlyOn() && hasPaidKey()) throw freeOnlyError();
        if (!navFlag) throw new Error(`No AI available for task "${t.title}" (${t.capability}${t.needWeb ? ", needs web: turn on Search the web or add a Perplexity key" : ""}).`);
        const wt = resolveTaskWorkaround(t, { goal, mode, browser, MA, suggestAppFn: suggestApp, openRankFn: openRank });
        mission.tasks.push(wt);
        continue;
      }
      used.set(choice.provider, (used.get(choice.provider) || 0) + 1);
      mission.tasks.push({ ...t, status: "queued", provider: choice.provider, model: choice.model, agentName: `${choice.providerName} · ${t.capability}`, estCost: choice.estCost, output: null, review: null, cost: 0 });
    }
    // 0.4.21: dogfood estimates ran 3 to 5 times low. A step-count multiplier (or the observed actual / estimate ratio
    // once there are real runs) sits on top of the old QA factor. The raw number is kept to learn from.
    // 0.4.21 (dogfood 11, 12): the estimate also covers the classifier, planner, assembler and one QA review per AI
    // step, each priced as the AI that will really run it once dead AIs are left out.
    const aiSteps = mission.tasks.filter((t) => !t.agent && !t.media && !t.app && !t.save && !t.run && !t.workaround);
    const small = (opts) => openPick({ ...opts, small: true });
    const ovh = overheadCost({
      steps: aiSteps.length || 1, qa: qa && aiSteps.length > 0,
      classifier: small({ capability: "fast", difficulty: 1, mode: "economy" }),
      planner: mission.planner?.model ? (openRank({ capability: "reasoning", difficulty: 3, mode: planning }).find((m) => m.model === mission.planner.model) || mission.planner) : null,
      assembler: openPick({ capability: "writing", difficulty: 3, mode: planning }) || planner,
      reviewers: aiSteps.map((t) => openRank({ capability: "analysis", difficulty: 2, mode: looking, exclude: [t.model], small: true }).find((m) => m.provider !== t.provider) || small({ capability: "analysis", difficulty: 2, mode: looking })),
    });
    const cal = calibratedEstimate(mission.tasks.reduce((a, t) => a + t.estCost, 0), { qa, steps: mission.tasks.length, overhead: ovh.total });
    mission.estimateParts = { classify: +ovh.classify.toFixed(5), plan: +ovh.plan.toFixed(5), assemble: +ovh.assemble.toFixed(5), qa: +ovh.qa.toFixed(5) };
    const est = cal.value;
    mission.estimateRaw = +cal.raw.toFixed(6); mission.estimateFactor = +cal.factor.toFixed(2);
    mission.estimatedCost = +est.toFixed(4);
    const agentTasks = mission.tasks.filter((t) => t.agent).length;
    const mediaTasks = mission.tasks.filter((t) => t.media);
    const mediaUsd = +mediaTasks.reduce((a, t) => a + (t.media.dryRun ? 0 : Number(t.media.usd) || 0), 0).toFixed(4);
    const appNames = mission.tasks.filter((t) => t.app).map((t) => t.model);
    const plannedBy = mission.planner ? (PROVIDERS[mission.planner.provider]?.name || mission.planner.provider) : null;
    log(`Plan: ${mission.tasks.length} tasks → ${[...used.keys()].map((p) => stepAgentName(p) || p).concat(appNames).concat(agentTasks ? [`${MA?.name || "The agent"} (${agentTasks}, results are async and can take minutes)`] : []).concat(mediaTasks.map((t) => `${t.media.providerName} (${t.media.kind}${t.media.dryRun ? ", dry run, nothing spent" : `, about $${t.media.usd}, waits for your OK`})`)).join(", ")}.${plannedBy ? ` Planned by ${plannedBy}.` : ""} Estimated $${est.toFixed(3)}${mediaUsd ? ` plus about $${mediaUsd} of media if you approve it` : ""}.`);
    if (mediaTasks.length) {
      const pf = preflight(goal, { kinds: [...new Set(mediaTasks.map((t) => t.media.kind))] });
      mission.preflight = { blocked: pf.blocked, lines: pf.lines, banner: pf.banner };
      if (pf.blocked) log(`Heads up before anything is made: ${pf.banner}`, { level: "error" });
    }
    if (est > budgetUsd) {
      log(`Estimate exceeds the $${budgetUsd} budget. Switching every task to Max savings.`);
      for (const t of mission.tasks) {
        if (t.agent || t.media || t.app || t.save || t.run || t.workaround) continue;
        const e = openPick({ capability: t.capability, difficulty: t.difficulty, mode: "savings", needWeb: needsWebModel(t) });
        if (e) { t.provider = e.provider; t.model = e.model; t.agentName = `${e.providerName} · ${t.capability}`; t.estCost = e.estCost; }
      }
    }
    if (crew.length) {
      let n = 0;
      for (const t of mission.tasks) {
        if (t.agent || t.media || t.app || t.save || t.run || t.workaround) continue;
        const c = crewFor(crew, t, n++);
        t.employee = { id: c.id, name: c.name };
      }
      log(`Team: ${mission.tasks.filter((t) => t.employee).map((t) => `${t.employee.name} on "${t.title}"`).join(", ")}.`);
    }
    mission.runContext = context;
    mission.searchWasOn = searchOn;
    mission.status = "running";
    update();
    }

    }

    // ---- 3. Execute in waves ----
    const done = new Set();
    const outputs = {};
    for (const t of mission.tasks) {
      if (t.status === "done" || t.status === "waiting" || t.status === "failed") {
        done.add(t.id);
        if (t.output) outputs[t.id] = t.output;
      }
    }
    // An agent step (Grok Bot or the browser helper): hand it over, then wait for the result (up to the
    // mission wait). A result that comes back later is added to this mission by the finish listener at the end of this file.
    const agentTask = async (t) => {
      const agent = `${id}:${t.id}`;
      const AID = t.provider || MA?.id || GROKBOT, ANAME = MA?.name || agentName(AID);
      t.status = "running"; t.startedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      emit("agent.start", { agent, provider: AID, model: AID, role: "work", missionId: id, taskId: t.id, label: `${ANAME}: ${t.title} (results are async and can take minutes)` });
      for (const d of t.deps) { const dep = mission.tasks.find((x) => x.id === d); if (dep && dep.provider !== AID) emit("agent.msg", { from: dep.provider, to: AID, missionId: id, text: `handing off "${dep.title}"` }); }
      const inputs = t.deps.map((d) => `### Input from task "${mission.tasks.find((x) => x.id === d)?.title}"\n${outputs[d] || "(missing)"}`).join("\n\n");
      const s = Date.now();
      try {
        const job = await MA.dispatch({ task: `${t.title}\n${t.instructions || ""}\nDeliverable: ${t.deliverable || "a short report of what was done"}`, context: [`Mission goal: ${goal}`, inputs, context].filter(Boolean).join("\n\n"), needs: t.needs, source: { kind: "mission", runId: id, taskId: t.id, projectId } });
        t.agentJob = { jobId: job.id, status: job.status };
        if (job.status === "failed") throw new Error(job.error);
        emit("task.update", { missionId: id, task: pubTask(t) }); update();
        const fin = await MA.awaitJob(job.id, { timeoutMs: MA.waitMs("mission"), signal: ctl.signal, onUpdate: (j) => { t.agentJob.status = j.status; emit("task.update", { missionId: id, task: pubTask(t) }); update(); } });
        if (fin) t.agentJob.status = fin.status;
        if (fin?.status === "done") {
          // 0.4.21 (dogfood 12): "done" with no words and no files did nothing. It is not a finished step; the next AI takes it.
          const said = String(fin.text || "").replace(/[\s\u200b]+/g, " ").trim();
          if (isEmptyOutput(said) && !(fin.artifacts || []).length) {
            t.agentEmpty = true; t.status = "failed"; t.error = `Nothing came back. ${ANAME} said it was done but sent back nothing.`;
            t.attempts = [...(t.attempts || []), { provider: AID, model: AID, kind: "empty", reason: "The AI sent back nothing." }];
            emit("agent.error", { agent, provider: AID, model: AID, missionId: id, taskId: t.id, error: t.error });
            observe({ provider: AID, model: AID, capability: "agent", difficulty: t.difficulty, runId: id, ok: false });
            log(`"${t.title}" failed: ${t.error} Handing it to the next AI.`);
          } else {
          t.output = said || `${ANAME} reported this step done and made ${(fin.artifacts || []).length} file${(fin.artifacts || []).length === 1 ? "" : "s"}.`; t.artifacts = fin.artifacts || []; outputs[t.id] = t.output; t.status = "done";
          t.work = { cost: 0, ms: Date.now() - s, free: true };
          observe({ provider: AID, model: AID, capability: "agent", difficulty: t.difficulty, runId: id, ok: true, cost: 0, ms: Date.now() - s });
          emit("agent.done", { agent, provider: AID, model: AID, missionId: id, taskId: t.id, ms: Date.now() - s, cost: 0 });
          }
        } else if (fin?.status === "failed") {
          throw new Error(fin.error || `${ANAME} reported a failure`);
        } else if (ctl.signal.aborted) {
          throwIfPause(mission, ctl, t);
          try { cancelAgentJob(job.id, "mission aborted"); } catch { /* already finished or gone: nothing to cancel */ }
          t.status = "failed"; t.error = "Mission aborted";
        } else {
          // still out: dependents go on without it; its result is added to this mission when it comes back
          t.status = "waiting"; outputs[t.id] = `(${ANAME} is still working on "${t.title}"; its result is added to this mission when it comes back.)`;
          log(`${ANAME} is still on "${t.title}" (${MA.STATUS_LABEL[t.agentJob.status].toLowerCase()}). The mission goes on; the result is added here when it comes back${AID === GROKBOT ? `, or paste it in on the ${ANAME} card` : ""}.`);
          emit("agent.done", { agent, provider: AID, model: AID, missionId: id, taskId: t.id, ms: Date.now() - s, cost: 0 });
        }
      } catch (err) {
        if (isMissionPause(err)) throw err;
        throwIfPause(mission, ctl, t);
        t.status = "failed"; t.error = err.message;
        if (!ctl.signal.aborted) observe({ provider: AID, model: AID, capability: "agent", difficulty: t.difficulty, runId: id, ok: false });
        emit("agent.error", { agent, provider: AID, model: AID, missionId: id, taskId: t.id, error: err.message });
      }
      if (t.status !== "failed") done.add(t.id);
      t.finishedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      update();
    };
    // ---- 0.4.21 (dogfood 12): real file writes and real test runs ----
    // A step that is empty gets the next AI. An agent that reports "done" with no words and no files did nothing.
    const toolRecord = (t, rec) => {
      const full = { taskId: t.id, by: "meldmind", ok: true, ...rec };
      mission.toolCalls.push(full);
      t.toolRecords = [...(t.toolRecords || []), rec];
      t.toolCalls = (t.toolCalls || 0) + 1;
    };
    // the code of a code step goes to the file the step names, inside the project folder only
    const codeWrite = (t) => {
      if (t.save || t.run || t.media || t.agent) return;
      const folders = codeFolders();
      const names = stepFileNames(t).filter((n) => folders.length || !/\.html?$/i.test(n)); // a page with no folder is still kept as a MindMedia item at the end
      if (!names.length) return;
      t.wantFiles = names;
      t.writes = [];
      const text = String(t.output || "");
      const prim = primaryName(t, names);
      let jobs = names.map((n) => ({ name: n, code: codeFor(text, n) })).filter((j) => j.code);
      if (!jobs.length) { const c = codeFor(text, prim, { onlyName: true }); if (c) jobs = [{ name: prim, code: c }]; }
      const bad = [];
      const lines = [];
      if (!jobs.length) bad.push(folders.length ? `Not saved: there was no code for ${prim} in this answer.` : NOT_SAVED_LINE);
      for (const j of jobs) {
        let old = null;
        for (const root of folders) { try { const hit = findInFolder(path.resolve(root), j.name); if (hit) { old = fs.readFileSync(hit, "utf8"); break; } } catch { /* unreadable: treated as new */ } }
        if (old && /\.(?:m?js|cjs|ts)$/i.test(j.name)) {
          const cmp = compareExports(old, j.code);
          if (!cmp.ok) { // the old file stays as it is; QA fails the step with the plain reason
            t.exportLoss = [...(t.exportLoss || []), ...cmp.removed];
            bad.push(`Not saved: ${j.name} was not changed, because the new code dropped ${cmp.removed.join(", ")}.`);
            continue;
          }
        }
        const r = writeProjectFile({ folders, name: j.name, text: j.code });
        if (!r.ok) { bad.push(r.error); continue; }
        toolRecord(t, { tool: "write_file", path: r.path, bytes: r.bytes });
        t.writes.push({ name: j.name, path: r.path, bytes: r.bytes, existed: r.existed });
        lines.push(`Wrote ${j.name} (${r.bytes} bytes)`);
        log(`Wrote ${j.name} (${r.bytes} bytes) in your project folder.`);
      }
      if (lines.length) { t.wroteLine = lines.join(". "); t.output = `${t.output}\n\n${lines.join("\n")}`; outputs[t.id] = t.output; }
      if (bad.length) {
        t.notSaved = { files: names, line: [...new Set(bad)].join(" ") };
        t.output = `${t.output}\n\n${t.notSaved.line}`; outputs[t.id] = t.output;
        log(`"${t.title}": ${t.notSaved.line}`, { level: "error" });
      }
      emit("task.update", { missionId: id, task: pubTask(t) }); update();
    };
    // Claims need proof: "saved" with no write record, "test output" with no run record, or a lost export, fail the step
    const deterministicQa = (t) => {
      if (t.save || t.run || t.media || t.agent) return null;
      let issue = t.exportLoss?.length ? exportLossLine(t.exportLoss) : "";
      if (!issue) issue = removedApiNotes(t.output)[0] || "";
      // 0.4.21 (dogfood 14): a step that names files is checked against the disk, not against its own words
      if (Array.isArray(t.wantFiles) && t.wantFiles.length) {
        const dc = diskCheck(t.wantFiles, t.writes || []);
        t.diskCheck = dc.lines;
        if (!issue && dc.missing.length) issue = `${dc.missing.join(" and ")} ${dc.missing.length > 1 ? "were" : "was"} not found on disk, so this step is not done`;
      }
      if (!issue) { const c = claimCheck(t.output, (mission.toolCalls || []).filter((r) => r.taskId === t.id)); if (!c.ok) issue = c.reason; }
      if (!issue) return null;
      return { provider: "meldmind", model: "check", pass: false, score: 1, issues: [issue], fix: null, unchecked: false, deterministic: true, tries: [] };
    };
    // "Run tests and report exact output": node runs the test file here and the real output goes on to the next step
    const runTask = async (t) => {
      t.status = "running"; t.startedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      const text = `${t.title}\n${t.instructions || ""}\n${t.deliverable || ""}`;
      const folders = codeFolders();
      const depWrites = (t.deps || []).flatMap((d) => mission.tasks.find((x) => x.id === d)?.writes || []);
      let found = findNodeCommand(text);
      if (!found && !asksOtherCommand(text)) {
        const w = [...depWrites].reverse().find((x) => /(?:\.test|\.spec|^test[-_])[^/]*\.(?:m?js|cjs)$/i.test(x.name)) || null;
        if (w) found = { test: false, file: w.name };
      }
      let res;
      if (!found) res = { ran: false, line: NOT_RUN_LINE };
      else {
        const fileName = found.file;
        let cwd = null, rel = fileName;
        const wrote = depWrites.find((x) => x.name === fileName || path.basename(x.name) === path.basename(fileName));
        if (wrote) { cwd = folders.find((f) => wrote.path.startsWith(path.resolve(f) + path.sep)) || null; if (cwd) rel = path.relative(path.resolve(cwd), wrote.path).replace(/\\/g, "/"); }
        if (!cwd) for (const f of folders) { try { const hit = findInFolder(path.resolve(f), fileName); if (hit) { cwd = path.resolve(f); rel = path.relative(cwd, hit).replace(/\\/g, "/"); break; } } catch { /* next folder */ } }
        res = cwd ? await runNodeTest({ cmd: `node ${found.test ? "--test " : ""}${rel}`, cwd }) : { ran: false, line: folders.length ? `Not run: ${fileName} was not found in your project folder.` : "Not run: Meldmind does not know your project folder, so it cannot run anything." };
      }
      t.output = runReport(res);
      outputs[t.id] = t.output;
      t.status = "done"; t.error = null;
      t.work = { cost: 0, ms: Date.now() - t.startedAt, free: true };
      if (res.ran) { toolRecord(t, { tool: "run", cmd: res.cmd, exit: res.exit, output: res.output }); log(`Ran ${res.cmd} here: exit ${res.exit === null ? "none" : res.exit}.`); }
      else { t.notRun = { line: res.line }; log(`"${t.title}": ${res.line}`, { level: "error" }); }
      done.add(t.id);
      t.finishedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      update();
    };
    // 0.4.21 (dogfood 10): a local "save to MindMedia" step. No network, no agent. The caption, hashtags and the picture
    // made by the earlier steps become ONE post item (Draft); a placeholder or missing picture is never used as the post image.
    const saveTask = async (t) => {
      t.status = "running"; t.startedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      try {
        const depTasks = (t.deps || []).map((d) => mission.tasks.find((x) => x.id === d)).filter(Boolean);
        const textDeps = depTasks.filter((d) => !d.media && !d.save && d.status === "done" && d.output && !d.notDone);
        const mediaDep = depTasks.find((d) => d.media?.kind === "image");
        const realFile = mediaDep && mediaDep.status === "done" && !mediaDep.media.dryRun ? (mediaDep.media.files || [])[0] : null;
        const raw = textDeps.map((d) => d.output).join("\n\n");
        const { caption, hashtags } = splitPost(raw || "", { keepEmoji: /emoji/i.test(goal) });
        let image = null;
        if (realFile?.name) {
          const abs = path.join(MEDIA.projectMediaDir(projectId), realFile.name);
          if (fs.existsSync(abs)) image = { name: realFile.name, path: abs, mime: realFile.mime };
        }
        const imageNote = !mediaDep ? "" : image ? "" : mediaDep.media?.dryRun ? "No picture was made (only a practice frame), so the post has no picture yet." : "No picture came back from the picture step, so the post has no picture yet.";
        const out = savePost({ projectId, missionId: id, title: mission.title || t.title, caption, hashtags, image, imageNote });
        t.output = out.text;
        if (out.ok) { t.status = "done"; t.error = null; t.saved = { link: out.link, where: out.where, id: out.saved?.id || null }; }
        else { t.status = "failed"; t.error = out.error || out.text; }
      } catch (err) {
        if (isMissionPause(err)) throw err;
        throwIfPause(mission, ctl, t);
        t.status = "failed"; t.error = `Not saved to MindMedia: ${plainMessage(err)}`; t.output = t.error;
      }
      if (t.status !== "failed") { outputs[t.id] = t.output; done.add(t.id); }
      t.finishedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      update();
    };
    // A media step: the job is made with its estimate. A dry run (no key) runs at once and saves a placeholder;
    // a paid one waits for the person's OK on the Media tab, and its file is added to this mission once it is
    // made (mediaFinished at the end of this file). Dependents go on with the step's note.
    const mediaTask = async (t) => {
      t.status = "running"; t.startedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      const inputs = t.deps.map((d) => outputs[d]).filter(Boolean).join("\n\n");
      // voice speaks the script it was handed; video and image use the planner's prompt
      const words = t.media.kind === "voice" && inputs ? inputs.replace(/[#*>`|_]/g, "").replace(/\s+/g, " ").trim() : (t.media.prompt || t.instructions || t.title);
      try {
        if (t.media.local) {
          const r = await drawLocally({ goal: `${goal}\n${t.media.prompt || ""}`, name: namedImage(goal) || namedImage(t.media.prompt), projectId, missionId: id });
          t.media.provider = "local-draw"; t.media.dryRun = false; t.media.usd = 0;
          t.media.files = [r.png, r.svg].filter(Boolean).map((f) => ({ name: f.name, path: f.path, bytes: f.bytes }));
          t.media.disk = r.disk; t.media.pngMade = r.pngMade;
          t.output = r.line;
          outputs[t.id] = t.output;
          if (r.ok) { t.media.status = "done"; t.status = "done"; t.error = null; }
          else { t.media.status = "failed"; t.status = "failed"; t.error = r.line; }
          if (t.status === "done") done.add(t.id);
          t.finishedAt = Date.now();
          emit("task.update", { missionId: id, task: pubTask(t) }); update();
          return;
        }
        // any connected maker, another one when the first fails, never a quiet placeholder (practice only in demo mode)
        const practice = mediaDemoOn() && !mediaDemosHidden() && !MSW.status(t.media.kind).ok;
        const sw = practice ? null : await MSW.missionMediaStep({ kind: t.media.kind, prompt: words, projectId, missionId: id, missionTaskId: t.id, guardUsd: mediaGuardUsd() });
        if (sw?.image) {
          const raw = MEDIA.getJob(sw.image.row.id);
          t.media.provider = sw.image.maker.id; t.media.jobId = sw.image.row.id; t.media.status = "done"; t.media.dryRun = false; t.media.usd = sw.image.maker.usd;
          t.media.files = raw ? MEDIA.publicJob(raw).files : [];
          t.output = `${sw.image.maker.name} made the picture (about $${sw.image.maker.usd}).${sw.image.tried.length > 1 ? ` ${sw.image.tried.filter((x) => !x.ok).map((x) => x.name).join(" and ")} could not, so it stepped in.` : ""} Saved to the project. Open it on the Media tab.`;
          t.status = "done"; t.error = null; t.cost = +(Number(sw.image.maker.usd) || 0).toFixed(5);
          outputs[t.id] = t.output; spend({ cost: t.cost });
          done.add(t.id); t.finishedAt = Date.now();
          emit("task.update", { missionId: id, task: pubTask(t) }); update();
          return;
        }
        const job = sw?.job || MEDIA.createJob({ provider: t.media.provider, kind: t.media.kind, params: { prompt: words.slice(0, MEDIA.MAX_PROMPT), text: words.slice(0, MEDIA.MAX_PROMPT) }, projectId, missionId: id, missionTaskId: t.id, approve: false, origin: "mission" });
        if (sw?.maker) t.media.provider = sw.maker.id;
        t.media.jobId = job.id; t.media.usd = job.estimate?.usd ?? t.media.usd;
        const fin = job.status === "awaiting_ok" ? null : await MEDIA.awaitJob(job.id, 60000);
        mediaOnTask(t, fin || MEDIA.getJob(job.id) || job);
        headlineOnImage(t, fin || MEDIA.getJob(job.id) || job, goal);
        if (t.output) outputs[t.id] = t.output;
        if (t.cost) spend({ cost: t.cost });
      } catch (err) {
        if (isMissionPause(err)) throw err;
        throwIfPause(mission, ctl, t);
        t.status = "failed"; t.error = err.message;
      }
      if (t.status !== "failed") done.add(t.id);
      t.finishedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      update();
    };
    const appTask = async (t) => {
      t.status = "running"; t.startedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      try {
        const result = await runLive(t.appId, {
          capability: t.capability,
          title: t.title,
          instructions: t.instructions,
          live: true,
          honorStop: true,
          signal: ctl.signal,
          // a mission step never presses on its own: it plans the controls and waits for Press these
          fromMission: true,
          missionId: id,
          taskId: t.id,
        });
        t.cost = result.cost || 0;
        if (t.cost) spend({ cost: t.cost });
        if (result.status === "done") {
          t.output = (result.log || []).filter(Boolean).join("\n") || `${t.model} finished this step.`;
          outputs[t.id] = t.output;
          t.status = "done";
        } else if (result.status === "needs_confirm") {
          t.output = `${t.model} will press these controls once you confirm the list (Press these, in Command):\n${planLine(result.plan || [])}\nNothing was pressed yet.`;
          t.appPlan = { planId: result.planId, actions: result.plan || [] };
          outputs[t.id] = t.output;
          t.status = "waiting";
        } else if (result.status === "nothing_to_press") {
          t.output = result.reason;
          outputs[t.id] = t.output;
          t.status = "waiting";
        } else if (result.status === "needs_approval" || result.status === "estimate") {
          t.output = result.reason || (result.log || [])[0] || "Waiting for your OK.";
          outputs[t.id] = t.output;
          t.status = "waiting";
        } else {
          t.status = "failed";
          t.error = result.reason || "The app stopped.";
        }
      } catch (err) {
        t.status = "failed";
        t.error = err.message;
      }
      if (t.status !== "failed") done.add(t.id);
      t.finishedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      update();
    };
    // ---- 0.4.21 step guard (dogfood 02, 03, 04) ----
    // What file type a step makes ("index.html", a landing page), so a cut-off page is told from a finished one.
    const stepExt = (t) => {
      const hint = `${t.title}. ${t.instructions || ""} ${t.deliverable || ""}`;
      const named = fileExt(namedFile(hint)) || (t.capability === "code" ? fileExt(namedFile(goal)) : "");
      if (named) return named;
      if (t.capability === "code" && /\bhtml\b|landing page|web ?page/i.test(hint)) return "html";
      return "";
    };
    const tokenCap = (t) => (t.capability === "code" || ["html", "css", "js", "json"].includes(stepExt(t)) ? CODE_TOKEN_CAP : WORK_TOKEN_CAP);
    const judgeOf = (t, text, stop) => judgeStep(text, { goal, title: t.title, instructions: t.instructions, deliverable: t.deliverable, stop, ext: stepExt(t), capability: t.capability });
    // A call on a given model that is not streamed to a card: cost is recorded, the words go to the step's feed.
    const callOnce = async (t, { provider, model, system, messages, maxTokens, role }) => {
      const agent = `${id}:${t.id}`;
      const s0 = Date.now();
      const r = await completeFallback({ provider, model, maxTokens, signal: ctl.signal, system, messages },
        { missionId: id, taskId: t.id, role, tools: false, cls: { capability: t.capability, difficulty: t.difficulty, needWeb: needsWebModel(t) }, mode, avoid: held, skipProviders: skipSet, onTrouble: runTrouble },
        { onDelta: (d) => emit("agent.delta", { agent, missionId: id, taskId: t.id, text: d }), onFallback: (ev) => stoodIn(ev, agent, role, t.id) });
      noteCall(r.provider, true, Date.now() - s0);
      const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: id, taskId: t.id, role, ms: Date.now() - s0 });
      spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
      return r;
    };
    // Carry a cut-off answer on (the same AI, a bigger cap), up to three times.
    const continueOutput = async (t, text, { system, messages }) => {
      let cur = text;
      for (let i = 0; i < MAX_CONTINUES && !ctl.signal.aborted; i++) {
        const tr = checkTruncation(cur, { ext: stepExt(t), capability: t.capability, stop: i === 0 && t.stopReason ? t.stopReason : null });
        if (!tr.truncated) break;
        log(`"${t.title}" was cut off (${tr.reason}). Asking ${PROVIDERS[t.provider]?.name || t.provider} to carry on (${i + 1} of ${MAX_CONTINUES}).`);
        t.continued = (t.continued || 0) + 1;
        const r = await callOnce(t, { provider: t.provider, model: t.model, system, maxTokens: CODE_TOKEN_CAP, role: "continue", messages: [...messages, { role: "assistant", content: cur }, { role: "user", content: continuePrompt(cur, stepExt(t)) }] });
        if (!r.text.trim()) break;
        cur = joinContinuation(cur, r.text);
        t.stopReason = r.stop || null;
        if (String(r.stop || "").match(/length|max_tokens/)) continue;
      }
      return cur;
    };
    // The check, the carry-on, and up to two retries on another AI. Leaves the step "failed" with a plain reason when none works.
    const settleStep = async (t, { system, messages, stop }) => {
      t.attempts = t.attempts || [];
      t.stopReason = stop || null;
      let text = String(t.output || "");
      let verdict = judgeOf(t, text, stop);
      if (verdict.kind === "truncated") {
        try { text = await continueOutput(t, text, { system, messages }); } catch (err) { if (isMissionPause(err)) throw err; throwIfPause(mission, ctl, t); }
        verdict = judgeOf(t, text, null);
      }
      const tried = new Set([t.provider]);
      let retries = 0;
      while (!verdict.ok && retries < 2 && !ctl.signal.aborted) {
        t.attempts.push({ provider: t.provider, model: t.model, kind: verdict.kind, reason: verdict.reason });
        const alt = openRank({ capability: t.capability, difficulty: t.difficulty, mode, needWeb: needsWebModel(t), exclude: [t.model] }).find((m) => !tried.has(m.provider));
        if (!alt) break;
        log(`"${t.title}" from ${PROVIDERS[t.provider]?.name || t.provider} was not usable (${verdict.reason}) and was not accepted. Retrying on ${alt.providerName}.`);
        emit("agent.msg", { from: t.provider, to: alt.provider, missionId: id, text: `retry "${t.title}"` });
        tried.add(alt.provider);
        t.provider = alt.provider; t.model = alt.model; t.agentName = `${alt.providerName} · ${t.capability} (retry)`; t.retried = true;
        emit("task.update", { missionId: id, task: pubTask(t) });
        try {
          const r = await callOnce(t, { provider: alt.provider, model: alt.model, system, messages, maxTokens: tokenCap(t), role: "work" });
          t.provider = r.provider; t.model = r.model;
          text = r.text; t.stopReason = r.stop || null;
          verdict = judgeOf(t, text, r.stop);
          if (verdict.kind === "truncated") { text = await continueOutput(t, text, { system, messages }); verdict = judgeOf(t, text, null); }
        } catch (err) {
          if (isMissionPause(err)) throw err;
          throwIfPause(mission, ctl, t);
          verdict = { ok: false, kind: "error", reason: String(err.message || err).slice(0, 140) };
        }
        retries++;
      }
      if (verdict.ok) {
        t.output = text; outputs[t.id] = text; t.guard = null;
        return true;
      }
      t.attempts.push({ provider: t.provider, model: t.model, kind: verdict.kind, reason: verdict.reason });
      t.guard = { kind: verdict.kind, reason: verdict.reason };
      t.truncated = verdict.kind === "truncated";
      t.output = text; delete outputs[t.id];
      t.status = "failed";
      t.error = `${verdict.kind === "empty" ? "Nothing came back." : verdict.kind === "refusal" ? "The AI refused." : verdict.kind === "truncated" ? "The answer was cut off." : verdict.kind === "off-brief" ? "The answer was about something else." : "The step failed."} ${verdict.reason}`.trim();
      emit("agent.error", { agent: `${id}:${t.id}`, provider: t.provider, model: t.model, missionId: id, taskId: t.id, error: t.error });
      log(`"${t.title}" failed: ${t.error}`);
      return false;
    };
    // QA: a reviewer gets 60 seconds, then the next one. A reply that is not JSON is asked for once more, then the reviewer is switched.
    // A check that could not be done is never a pass.
    const QA_MS = () => Number(process.env.CC_QA_TIMEOUT_MS) || 60000;
    const qaReviewers = (t, skip = []) => {
      const ranked = openRank({ capability: "analysis", difficulty: 2, mode: looking, exclude: [t.model], small: true });
      const seen = new Set();
      let list = ranked.filter((m) => m.provider !== t.provider && !skip.includes(m.provider) && !seen.has(m.provider) && seen.add(m.provider)).slice(0, 3);
      if (!list.length) list = ranked.filter((m) => !skip.includes(m.provider)).slice(0, 1);
      if (!list.length) list = openRank({ capability: "analysis", mode: looking, small: true }).slice(0, 1);
      return list;
    };
    const askReviewer = async (t, reviewer, text, { fix = false } = {}) => {
      const ragent = `${id}:${t.id}:qa`;
      emit("agent.msg", { from: t.provider, to: reviewer.provider, missionId: id, text: `QA "${t.title}"` });
      emit("agent.start", { agent: ragent, provider: reviewer.provider, model: reviewer.model, role: "qa", missionId: id, taskId: t.id, label: `${reviewer.providerName} checking "${t.title}"` });
      const to = new AbortController();
      const onAbort = () => to.abort(ctl.signal.reason);
      ctl.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => to.abort("qa-timeout"), QA_MS());
      const s3 = Date.now();
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await completeFallback({ provider: reviewer.provider, model: reviewer.model, maxTokens: 500, signal: to.signal, system: `You QA another AI's deliverable. Reply with JSON only: {"pass": true|false, "score": 1-10, "issues": ["<=15 words each", ...], "fix": "if not pass, the single most important correction in <=40 words"}${attempt ? " Your last reply was not valid JSON. Reply with the JSON object and nothing else." : ""}`, messages: [{ role: "user", content: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions}\nDELIVERABLE REQUIRED: ${t.deliverable}${memNote}\n\nOUTPUT TO CHECK:\n${text.slice(0, 12000)}` }] },
            { missionId: id, taskId: t.id, role: "qa", small: true, tools: false, cls: { capability: "analysis", difficulty: 2 }, mode: looking, avoid: [{ provider: t.provider, model: t.model }, ...held], skipProviders: skipSet, onTrouble: runTrouble }, { onFallback: (ev) => stoodIn(ev, ragent, "qa", t.id) });
          const ms = Date.now() - s3;
          noteCall(r.provider, true, ms);
          const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: id, taskId: t.id, role: "qa", ms });
          spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
          const j = extractJson(r.text);
          if (j && typeof j === "object" && ("pass" in j || "score" in j)) {
            emit("agent.done", { agent: ragent, provider: r.provider, model: r.model, missionId: id, taskId: t.id, ms, cost: e.cost });
            const score = Number(j.score);
            return { provider: r.provider, model: r.model, pass: j.pass === true || (j.pass === undefined && Number.isFinite(score) && score >= 7), score: Number.isFinite(score) ? score : null, issues: Array.isArray(j.issues) ? j.issues.slice(0, 6) : [], fix: j.fix || null, ms };
          }
          log(`${reviewer.providerName} sent back a check that could not be read${attempt ? "" : ". Asking once more"}.`);
        }
        emit("agent.error", { agent: ragent, provider: reviewer.provider, model: reviewer.model, missionId: id, taskId: t.id, error: "unreadable check" });
        return { unreadable: true, provider: reviewer.provider, model: reviewer.model };
      } catch (err) {
        if (isMissionPause(err)) throw err;
        if (ctl.signal.aborted) throw err;
        const slow = to.signal.aborted && to.signal.reason === "qa-timeout";
        noteCall(reviewer.provider, false, Date.now() - s3, err);
        emit("agent.error", { agent: ragent, provider: reviewer.provider, model: reviewer.model, missionId: id, taskId: t.id, error: slow ? "too slow" : err.message });
        if (slow) log(`${reviewer.providerName} took more than ${Math.round(QA_MS() / 1000)} seconds to check "${t.title}". Switching reviewer.`);
        return { failed: true, slow, provider: reviewer.provider, model: reviewer.model, error: slow ? "too slow" : err.message };
      } finally { clearTimeout(timer); ctl.signal.removeEventListener("abort", onAbort); }
    };
    // Returns the review record kept on the step: { pass, score, issues, fix, provider, model, unchecked?, tries }
    const qaStep = async (t, text, { skip = [] } = {}) => {
      if (t.review?.deterministic) return null; // already failed on a claim with no proof: no need to ask an AI
      const reviewers = qaReviewers(t, skip);
      // no reviewer can run: the step says so in plain words, and is never counted as passed
      if (!reviewers.length) return { provider: null, model: null, pass: false, unchecked: true, score: null, issues: ["Not reviewed: no AI was ready to check this step."], fix: null, tries: [] };
      const tries = [];
      for (const rv of reviewers) {
        const out = await askReviewer(t, rv, text);
        if (out.pass !== undefined) return { ...out, tries };
        tries.push({ provider: rv.provider, why: out.slow ? "too slow" : out.unreadable ? "unreadable" : out.error || "failed" });
      }
      return { provider: reviewers[0].provider, model: reviewers[0].model, pass: false, unchecked: true, score: null, issues: ["The check could not be done: " + tries.map((x) => `${PROVIDERS[x.provider]?.name || x.provider} ${x.why}`).join(", ")], fix: null, tries };
    };
    const applyQueuedDirections = () => {
      const consumed = consumeQueuedForRun(id, projectId, { emit });
      if (!consumed) return;
      mission.appliedDirections = [...(mission.appliedDirections || []), ...consumed.items];
      for (const t of mission.tasks) {
        if (!done.has(t.id) && t.status !== "failed" && !t.agent && !t.media && !t.app && !t.save && !t.run) {
          t.instructions = `${t.instructions || ""}\n\n${consumed.promptBlock}`.trim();
        }
      }
      if (plan) plan.assembly = `${plan.assembly || ""}\n\n${consumed.promptBlock}`.trim();
      log(`Applied queued direction: ${consumed.summary}`);
      update();
    };
    // The run's own limit is a hard stop: once what was spent reaches it, no new step or assembly starts.
    const limitNote = () => {
      const lim = Number(budgetUsd);
      if (!(Number.isFinite(lim) && lim > 0 && mission.cost >= lim)) return "";
      const fmt = (n) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`; // enough digits that "$0.0007 of $0.0005" never reads "$0.00 of $0.00"
      return `Stopped. This run reached its ${fmt(lim)} spending limit and spent ${fmt(mission.cost)}. Nothing more was spent. Raise the limit to continue.`;
    };
    const runLimit = () => {
      const note = limitNote();
      if (note) { const e = new Error(note); e.code = "run_budget"; throw e; }
    };
    while (done.size < mission.tasks.length) {
      // 0.4.20: at the limit, keep what is finished and hand it back (below) instead of failing with nothing.
      if (limitNote() && mission.tasks.some((t) => t.output && !t.media)) { mission.limitReached = true; break; }
      runLimit();
      if (shouldPause(mission)) { armPause(mission, ctl); throw new MissionPause(); }
      if (ctl.signal.aborted && !mission.pauseRequested) throw new Error("Mission aborted");
      const hold = Number(process.env.CC_MISSION_WAVE_HOLD_MS) || 0;
      if (hold > 0) {
        await new Promise((r) => setTimeout(r, hold));
        if (shouldPause(mission)) { armPause(mission, ctl); throw new MissionPause(); }
        if (ctl.signal.aborted && !mission.pauseRequested) throw new Error("Mission aborted");
      }
      applyQueuedDirections();
      const wave = mission.tasks.filter((t) => !done.has(t.id) && t.status !== "failed" && t.deps.every((d) => done.has(d)));
      if (!wave.length) {
        // unresolved deps (cycle or failed dep): run the rest without inputs
        const rest = mission.tasks.filter((t) => !done.has(t.id) && t.status !== "failed");
        if (!rest.length) break;
        for (const t of rest) t.deps = [];
        continue;
      }
      const settled = await Promise.allSettled(wave.map(async (t) => {
        if (shouldPause(mission)) { rewindTask(t); throw new MissionPause(); }
        if (t.run) return runTask(t);
        if (t.agent) {
          await agentTask(t);
          if (!t.agentEmpty) return;
          // an agent that sent back nothing: the step goes on to a working AI, never "done"
          t.agent = false; t.agentEmpty = false; t.status = "queued"; t.error = null; t.agentJob = null; t.retried = true;
          t.capability = ["reasoning", "code", "writing", "research", "creative", "analysis", "math", "fast"].includes(mission.classification?.capability) ? mission.classification.capability : "reasoning";
          done.delete(t.id);
        }
        if (t.save) return saveTask(t);
        if (t.media) return mediaTask(t);
        if (t.app) return appTask(t);
        // 0.4.21 (dogfood 09): a step routed to an agent that is not set up has no entry in PROVIDERS, and
        // reading its name stopped the mission ("Cannot read properties of undefined (reading 'name')").
        // It is handed to a working AI here instead.
        const handOff = handToWorkingAI(t, () => openRank({ capability: t.capability || "reasoning", difficulty: Number(t.difficulty) || 2, mode, needWeb: needsWebModel(t) }));
        if (handOff) { Object.assign(t, handOff); t.reassigned = true; }
        // 0.4.21 (dogfood 08): an earlier step failed or came back empty, so this one is not run on "(missing)"
        // (that redid the earlier work and billed it twice). It stops here with "Input missing" on the card.
        const missingIn = missingInputs(t, mission.tasks, outputs);
        if (missingIn.length) {
          t.status = "failed"; t.inputMissing = missingIn; t.error = inputMissingLine(missingIn); t.finishedAt = Date.now();
          log(`"${t.title}" was not run: ${t.error}`);
          emit("task.update", { missionId: id, task: pubTask(t) }); update();
          return;
        }
        const agent = `${id}:${t.id}`;
        t.status = "running"; t.startedAt = Date.now();
        emit("task.update", { missionId: id, task: pubTask(t) });
        emit("agent.start", { agent, provider: t.provider, model: t.model, role: "work", missionId: id, taskId: t.id, label: `${stepAgentName(t.provider) || "An AI"}: ${t.title}` });
        for (const d of t.deps) { const dep = mission.tasks.find((x) => x.id === d); if (dep && dep.provider !== t.provider) emit("agent.msg", { from: dep.provider, to: t.provider, missionId: id, text: `handing off "${dep.title}"` }); }
        const inputs = t.deps.map((d) => `### Input from task "${mission.tasks.find((x) => x.id === d)?.title}"\n${outputs[d] || "(missing)"}`).join("\n\n");
        // 0.4.21 (dogfood 12): editing a file that already exists keeps its exports
        if (!/Do not change exported names/.test(t.instructions || "")) {
          const fl = codeFolders();
          const existing = fl.length && stepFileNames(t).some((n) => { try { return !!findInFolder(path.resolve(fl[0]), n) || fl.some((f) => !!findInFolder(path.resolve(f), n)); } catch { return false; } });
          if (existing) t.instructions = `${t.instructions || ""}\n${KEEP_EXPORTS_LINE}`.trim();
        }
        // a task that needs live information gets its own search, numbered after the mission's sources
        let taskWeb = "";
        if (searchOn && t.needWeb && !ctl.signal.aborted) {
          const tw = await webAugment({ prompt: `${t.title}. ${t.instructions || ""}`, kind: "mission", missionId: id, taskId: t.id, explicit: true, offset: mission.sources.length, role: "task-search", filter });
          if (tw?.sources?.length) { mission.sources = [...mission.sources, ...tw.sources]; mission.searchEngine = mission.searchEngine || tw.name; spend({ cost: tw.cost || 0 }); taskWeb = tw.block; update(); }
        }
        const s = Date.now();
        let text = "";
        let stopReason = null;
        const workSystem = toneAdd(crewMember(t) ? crewSystem(crewMember(t), goal) : `You are a specialist (${t.capability}) on a team working toward this goal:\n${goal}\n\nDo only your task. Output the deliverable itself in Markdown, no preamble, no questions back.${t.capability === "code" ? `\n${NO_REMOVED_APIS_LINE}` : ""}`, tone);
        const workMessages = [{ role: "user", content: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions}\nDELIVERABLE: ${t.deliverable}${inputs ? `\n\n${inputs}` : ""}${context ? `\n\nCONTEXT:\n${context}` : ""}${taskWeb ? `\n\n${taskWeb}` : ""}` }];
        try {
          // MCP tools (Phase 16) ride along for specialists that can call them; writes ask first.
          // Smart fallback (Phase 26): a specialist whose provider is out of credits, rate limited or refusing
          // its key is replaced (same model via OpenRouter first, then the next-best model) and the task says so.
          for await (const ev of fallbackChat({
            provider: t.provider, model: t.model, maxTokens: tokenCap(t), signal: ctl.signal,
            system: workSystem,
            messages: workMessages,
          }, { missionId: id, taskId: t.id, tools, role: "work", mode, cls: { capability: t.capability, difficulty: t.difficulty, needWeb: needsWebModel(t) }, avoid: held, skipProviders: skipSet, onTrouble: runTrouble })) {
            if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, taskId: t.id, text: ev.text }); }
            else if (ev.type === "fallback") {
              text = ""; stoodIn(ev, agent, "work", t.id);
              t.provider = ev.to.provider; t.model = ev.to.model; t.agentName = `${ev.to.providerName} · ${t.capability} (for ${ev.from.providerName})`; t.retried = true; t.standIn = { for: ev.from.provider, forModel: ev.from.model, reason: ev.reason, via: ev.via || null };
              emit("task.update", { missionId: id, task: pubTask(t) }); update();
            }
            else if (ev.type === "tool" && ev.phase === "done") { mission.toolCalls.push({ taskId: t.id, by: t.provider, tool: ev.tool, server: ev.server, ok: ev.ok, denied: ev.denied, ms: ev.ms }); t.toolCalls = (t.toolCalls || 0) + 1; update(); }
            else if (ev.type === "done") {
              stopReason = ev.stop || null;
              const ms = Date.now() - s;
              noteCall(t.provider, true, ms);
              const e = recordCall({ provider: t.provider, model: t.model, usage: ev.usage, missionId: id, taskId: t.id, role: "work", ms });
              spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
              t.work = { cost: e.cost, ms, free: !!e.free };
              emit("agent.done", { agent, provider: t.provider, model: t.model, missionId: id, taskId: t.id, ms, cost: e.cost });
            }
          }
          t.output = text;
          outputs[t.id] = text;
          t.status = qa ? "review" : "done";
        } catch (err) {
          if (isMissionPause(err)) throw err;
          throwIfPause(mission, ctl, t);
          noteCall(t.provider, false, Date.now() - s, err);
          emit("agent.error", { agent, provider: t.provider, model: t.model, missionId: id, taskId: t.id, error: err.message });
          // learning router (Phase 28): a model that failed the job itself is marked; account trouble is not held against it
          if (!troubleKind(err) && !ctl.signal.aborted) observe({ provider: t.provider, model: t.model, capability: t.capability, difficulty: t.difficulty, runId: id, ok: false });
          // one retry on a different provider
            const alt = openRank({ capability: t.capability, difficulty: t.difficulty, mode, needWeb: needsWebModel(t), exclude: [t.model] }).find((m) => m.provider !== t.provider);
          if (alt && !ctl.signal.aborted) {
            log(`${stepAgentName(t.provider) || "An AI"} failed "${t.title}" (${err.message.slice(0, 80)}). Re-assigning to ${alt.providerName}.`);
            emit("agent.msg", { from: t.provider, to: alt.provider, missionId: id, text: `re-assign "${t.title}"` });
            t.provider = alt.provider; t.model = alt.model; t.agentName = `${alt.providerName} · ${t.capability}`; t.retried = true;
            const s2 = Date.now();
            try {
              const r = await complete({ provider: alt.provider, model: alt.model, maxTokens: 2500, signal: ctl.signal, system: toneAdd(`You are a specialist (${t.capability}). Goal: ${goal}. Do only your task; output the deliverable in Markdown.`, tone), messages: [{ role: "user", content: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions}\nDELIVERABLE: ${t.deliverable}${inputs ? `\n\n${inputs}` : ""}` }] }, (d) => emit("agent.delta", { agent, missionId: id, taskId: t.id, text: d }));
              noteCall(alt.provider, true, Date.now() - s2);
              const e = recordCall({ provider: alt.provider, model: alt.model, usage: r.usage, missionId: id, taskId: t.id, role: "work", ms: Date.now() - s2 });
              spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
              t.work = { cost: e.cost, ms: Date.now() - s2, free: !!e.free };
              t.output = r.text; outputs[t.id] = r.text; t.status = qa ? "review" : "done";
            } catch (err2) {
              noteCall(alt.provider, false, Date.now() - s2, err2);
              if (!troubleKind(err2) && !ctl.signal.aborted) observe({ provider: alt.provider, model: alt.model, capability: t.capability, difficulty: t.difficulty, runId: id, ok: false });
              t.status = "failed"; t.error = err2.message;
            }
          } else { t.status = "failed"; t.error = err.message; }
        }
        // 0.4.21: an empty, refused, cut-off or off-topic answer is a failure to retry, never "done"
        if (t.status === "review" || t.status === "done") await settleStep(t, { system: workSystem, messages: workMessages, stop: stopReason, inputs });
        // 0.4.21 (dogfood 12): the code goes into the project folder, and what really happened is checked against what the step says
        if (t.status === "review" || t.status === "done") {
          try { codeWrite(t); } catch (e) { t.notSaved = { files: t.wantFiles || [], line: `Not saved: ${String(e.message || e).slice(0, 120)}` }; }
          const det = deterministicQa(t);
          if (det) { t.review = det; log(`QA failed "${t.title}": ${det.issues[0]}`, { level: "error" }); emit("task.update", { missionId: id, task: pubTask(t) }); }
        }
        emit("task.update", { missionId: id, task: pubTask(t) });

        // ---- QA by a different AI ----
        if (t.status === "review") {
          let first = null;
          try {
            first = await qaStep(t, t.diskCheck?.length ? `${t.output}\n\nDISK CHECK (read from the disk by Meldmind, not written by the AI):\n${t.diskCheck.join("\n")}\nA file marked missing means the step is not done.` : t.output);
            if (first) {
              t.review = { provider: first.provider, model: first.model, pass: first.pass === true, score: first.score ?? null, issues: first.issues || [], fix: first.fix || null, unchecked: !!first.unchecked, tries: first.tries || [] };
              emit("task.update", { missionId: id, task: pubTask(t) });
            }
            if (first && !first.pass && !first.unchecked && first.fix && !ctl.signal.aborted) {
              emit("agent.msg", { from: first.provider, to: t.provider, missionId: id, text: `revise: ${String(first.fix).slice(0, 60)}` });
              const s4 = Date.now();
              try {
                const r2 = await completeFallback({ provider: t.provider, model: t.model, maxTokens: tokenCap(t), signal: ctl.signal, system: toneAdd(`Revise your deliverable. Apply the QA correction and output the full corrected deliverable in Markdown, nothing else.`, tone), messages: [{ role: "user", content: `TASK: ${t.title}\n\nYOUR DRAFT:\n${t.output}\n\nQA CORRECTION:\n${first.fix}\nISSUES: ${(first.issues || []).join("; ")}` }] },
                  { missionId: id, taskId: t.id, role: "revise", tools: false, cls: { capability: t.capability, difficulty: t.difficulty }, mode, avoid: held, skipProviders: skipSet, onTrouble: runTrouble }, { onDelta: (d) => emit("agent.delta", { agent, missionId: id, taskId: t.id, text: d }), onFallback: (ev) => stoodIn(ev, agent, "revise", t.id) });
                noteCall(r2.provider, true, Date.now() - s4);
                const e2 = recordCall({ provider: r2.provider, model: r2.model, usage: r2.usage, missionId: id, taskId: t.id, role: "revise", ms: Date.now() - s4 });
                spend(e2); t.cost = +(t.cost + e2.cost).toFixed(5);
                // a revision that came back empty, refused or cut off is not taken: the draft stays
                const vr = judgeOf(t, r2.text, r2.stop);
                if (vr.ok) {
                  t.output = r2.text; outputs[t.id] = r2.text; t.revised = true;
                  // the revision is checked once more, by a different reviewer when there is one
                  const second = await qaStep(t, t.diskCheck?.length ? `${t.output}\n\nDISK CHECK (read from the disk by Meldmind, not written by the AI):\n${t.diskCheck.join("\n")}\nA file marked missing means the step is not done.` : t.output, { skip: [first.provider] });
                  if (second) t.review = { provider: second.provider, model: second.model, pass: second.pass === true, score: second.score ?? null, issues: second.issues || [], fix: second.fix || null, unchecked: !!second.unchecked, tries: second.tries || [], firstScore: first.score ?? null };
                } else log(`The revision of "${t.title}" was not usable (${vr.reason}); keeping the first draft.`);
              } catch (err3) {
                if (isMissionPause(err3)) throw err3;
                throwIfPause(mission, ctl, t);
                noteCall(t.provider, false, Date.now() - s4, err3);
              }
            }
          } catch (err) {
            if (isMissionPause(err)) throw err;
            throwIfPause(mission, ctl, t);
          }
          // QA is on: every AI step ends with a review or an honest "not reviewed", never silence
          if (!t.review) t.review = { provider: null, model: null, pass: false, unchecked: true, score: null, issues: ["Not reviewed: the check could not be done."], fix: null, tries: [] };
          // a check that failed after its retry never counts as a pass
          if (t.review && t.review.pass !== true) { t.qaFailed = true; log(`QA did not pass "${t.title}"${t.review.unchecked ? " (the check could not be done)" : ""}.`); }
          t.status = "done";
        } else if (t.status === "done" && t.review?.deterministic) {
          t.qaFailed = true; // QA is off, but a claim with no proof still fails the step
        }
        if (t.status === "done") {
          done.add(t.id);
          // learning router (Phase 28): the job, its QA score, what the work call cost and how long it took
          observe({ provider: t.provider, model: t.model, capability: t.capability, difficulty: t.difficulty, runId: id, ok: true, qa: t.review?.score ?? null, cost: t.work?.cost ?? null, ms: t.work?.ms ?? null, free: !!t.work?.free });
        }
        t.finishedAt = Date.now();
        emit("task.update", { missionId: id, task: pubTask(t) });
        update();
      }));
      if (shouldPause(mission) || settled.some((r) => r.status === "rejected" && (isMissionPause(r.reason)))) {
        armPause(mission, ctl);
        throw new MissionPause();
      }
      // failed tasks count as resolved so the loop ends
      for (const t of mission.tasks) if (t.status === "failed") done.add(t.id);
    }
    applyQueuedDirections();

    // ---- 4. Assemble ----
    // media steps are files, not text: they skip the assembler and get their own section at the end
    const finished = mission.tasks.filter((t) => t.output && !t.media && t.status !== "failed");
    const madeMedia = mission.tasks.filter((t) => t.media && t.output && (t.status === "done" || (t.media.local && t.media.files?.length))); // a drawing kept as SVG is handed over with its "Not made" line
    const waiting = mission.tasks.filter((t) => t.status === "waiting" && !t.media);
    const waitingMedia = mission.tasks.filter((t) => t.status === "waiting" && t.media);
    if (!finished.length && !madeMedia.length && !waiting.length && !waitingMedia.length) throw Object.assign(new Error("Nothing came back. Every step failed, so there is nothing to hand over. Add credits in Settings if an AI is out, or press Try again."), { code: "empty" });
    const pendingNote = (waiting.length ? `\n\n---\n**Still waiting on ${MA?.name || "the agent"}:** ${waiting.map((t) => `"${t.title}"`).join(", ")}. Each result is added to this mission when it comes back${MA?.id === GROKBOT ? `, or paste it in on the ${MA.name} card` : ""}.` : "")
      + (waitingMedia.length ? `\n\n---\n**Media waiting for your OK:** ${waitingMedia.map((t) => `"${t.title}" (${t.media.providerName} ${t.media.kind}, about $${t.media.usd})`).join(", ")}. Approve it on the Media tab; nothing is spent until you do, and the file is added to this mission when it is made.` : "");
    const mediaNote = madeMedia.length ? `\n\n${madeMedia.map((t) => mediaSection(t)).join("\n\n")}` : "";
    if (!finished.length) mission.deliverable = (mediaNote + pendingNote).trim();
    else if (limitNote()) {
      // the limit was reached: hand back the finished pieces as they are instead of paying for an assembly
      log(limitNote());
      mission.deliverable = `${finished.map((t) => `## ${t.title}\n${t.output}`).join("\n\n")}\n\n---\n${limitNote()}`;
      mission.limitReached = true;
    }
    else await assemble(plan, planner);
    if (finished.length && (mediaNote || pendingNote)) mission.deliverable = (mission.deliverable || "") + mediaNote + pendingNote;
    if (!String(mission.deliverable || "").trim() && !waiting.length && !waitingMedia.length) throw Object.assign(new Error("Nothing came back. The AIs finished with an empty result. Press Try again, or add credits in Settings."), { code: "empty" });
    finishChecks();
    // a PDF task gets a real PDF made here, saved as .pdf and .md in the project folder (server/mission-pdf.js)
    try { await attachPdf(mission, { goal, log }); } catch (e) { mission.savedPdf = { ok: false, error: `Not saved: ${String(e.message || e).slice(0, 140)}` }; }
    mission.status = mission.tasks.some((t) => t.status === "failed" || (stepIsNotDone(t) && !mission.savedPdf?.ok)) || mission.limitReached || (mission.savedPdf && !mission.savedPdf.ok) || mission.incomplete || mission.banner ? "done-with-errors" : "done";
    try { keepEmployeeWork(mission); } catch (e) { console.error("[mission] mindmedia employee save:", e.message); }
  } catch (err) {
    if (isMissionPause(err) || mission.pauseRequested) {
      mission.status = "paused";
      mission.pausedAt = Date.now();
      mission.error = null;
      for (const t of mission.tasks || []) if (t.status === "running" || t.status === "review") rewindTask(t);
      log("Mission paused. You can edit the steps that have not finished, then resume.");
    } else {
      mission.status = ctl.signal.aborted ? "aborted" : "failed";
      mission.error = plainMessage(err); // never a raw program error
      // 0.4.21 (dogfood 15): a failed try says what it cost, and offers a one-AI answer instead of a raw error
      if (mission.status === "failed") {
        const spent = Number(mission.cost) || 0;
        if (spent > 0 && !/This try cost/.test(mission.error)) mission.error = `${mission.error} ${costLine(spent, mission)}`;
        mission.retry = { oneAI: true, cost: spent, label: ONE_AI_LABEL };
      }
      log(`Mission ${mission.status}: ${mission.error}`);
    }
  } finally {
    user.missionsInFlight = Math.max(0, (user.missionsInFlight || 1) - 1);
    running.delete(id);
    live.delete(id);
    issued.delete(id);
    pendingPause.delete(id);
    // A paused mission keeps its Get it done grant until it resumes and ends.
    if (mission.status !== "paused") { mission.finishedAt = Date.now(); endGrant(id); }
    update();
    log(`Mission ${mission.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s, $${mission.cost.toFixed(4)}.`);
    try { if (mission.status === "done" || mission.status === "done-with-errors") noteActual(mission.estimateRaw, mission.cost); } catch { /* calibration is optional */ }
    for (const job of lateWhileRunning.get(id) || []) lateResult(job).catch((e) => console.error("[mission] late result:", e.message));
    lateWhileRunning.delete(id);
  }
  return mission;

  async function assemble(plan, planner) {
    const finished = mission.tasks.filter((t) => t.output && !t.media && t.status !== "failed");
    mission.status = "assembling"; update();
    const asm = { ...(openPick({ capability: "writing", difficulty: 3, mode: planning }) || planner) };
    if (!asm.provider) {
      mission.deliverable = finished.map((t) => `## ${t.title}\n${t.output}`).join("\n\n");
      return;
    }
    mission.assembler = { provider: asm.provider, model: asm.model };
    const aAgent = `${id}:assembler`;
    emit("agent.start", { agent: aAgent, provider: asm.provider, model: asm.model, role: "assemble", missionId: id, label: `${asm.providerName} assembling the deliverable` });
    for (const t of finished) if (t.provider !== asm.provider) emit("agent.msg", { from: t.provider, to: asm.provider, missionId: id, text: `deliver "${t.title}"` });
    const s5 = Date.now();
    let text = "";
    let asmStop = null;
    const asmSystem = toneAdd(`You assemble the final deliverable for the user from the team's task outputs. Assembly guidance: ${plan.assembly || "combine into one clean document"}. Output the deliverable in Markdown, well structured, no preamble. Do not mention tasks or teams; just deliver.${mission.sources.length ? " Keep every [n] citation exactly as written; the numbers refer to the web sources listed at the end." : ""}${lib?.sources?.length ? " Keep every [L1], [L2] ... library tag exactly as written; they refer to the library excerpts listed at the end." : ""}${mission.sources.length ? "" : " Do not add [1] style citations and do not mention search results: nothing was searched."}`, tone);
    const asmMessages = [{ role: "user", content: `GOAL:\n${goal}${memNote}\n\n${finished.map((t) => `## ${t.title}\n${t.output}`).join("\n\n")}${mission.sources.length ? `\n\n${sourcesBlock(mission.sources, mission.searchEngine)}` : ""}${lib?.block ? `\n\n${lib.block}` : ""}` }];
    try {
      for await (const ev of fallbackChat({
        provider: asm.provider, model: asm.model, maxTokens: CODE_TOKEN_CAP, signal: ctl.signal,
        system: asmSystem,
        messages: asmMessages,
      }, { missionId: id, role: "assemble", tools: false, cls: { capability: "writing", difficulty: 3 }, mode: planning, avoid: held, skipProviders: skipSet, onTrouble: runTrouble })) {
        if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent: aAgent, missionId: id, text: ev.text }); }
        else if (ev.type === "fallback") { text = ""; stoodIn(ev, aAgent, "assemble"); asm.provider = ev.to.provider; asm.model = ev.to.model; mission.assembler = { provider: asm.provider, model: asm.model, standIn: { for: ev.from.provider, reason: ev.reason, via: ev.via || null } }; update(); }
        else if (ev.type === "done") {
          asmStop = ev.stop || null;
          const ms = Date.now() - s5;
          noteCall(asm.provider, true, ms);
          const e = spendEntry(recordCall({ provider: asm.provider, model: asm.model, usage: ev.usage, missionId: id, role: "assemble", ms }));
          observe({ provider: asm.provider, model: asm.model, capability: "writing", difficulty: 3, runId: id, ok: true, cost: e.cost, ms, free: e.free });
          emit("agent.done", { agent: aAgent, provider: asm.provider, model: asm.model, missionId: id, ms });
        }
      }
      // 0.4.21: a final answer that stops mid-page is carried on, not handed over cut off
      const fext = fileExt(namedFile(goal)) || (mission.classification?.capability === "code" ? "html" : "");
      for (let i = 0; i < MAX_CONTINUES && !ctl.signal.aborted; i++) {
        const tr = checkTruncation(text, { ext: fext, capability: mission.classification?.capability, stop: i === 0 ? asmStop : null });
        if (!tr.truncated) break;
        log(`The final answer was cut off (${tr.reason}). Asking ${PROVIDERS[asm.provider]?.name || asm.provider} to carry on (${i + 1} of ${MAX_CONTINUES}).`);
        const s6 = Date.now();
        const r = await completeFallback({ provider: asm.provider, model: asm.model, maxTokens: CODE_TOKEN_CAP, signal: ctl.signal, system: asmSystem, messages: [...asmMessages, { role: "assistant", content: text }, { role: "user", content: continuePrompt(text, fext) }] },
          { missionId: id, role: "continue", tools: false, cls: { capability: "writing", difficulty: 3 }, mode: planning, avoid: held, skipProviders: skipSet, onTrouble: runTrouble }, { onDelta: (d) => emit("agent.delta", { agent: aAgent, missionId: id, text: d }) });
        spend(recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: id, role: "continue", ms: Date.now() - s6 }));
        if (!r.text.trim()) break;
        text = joinContinuation(text, r.text);
        asmStop = r.stop || null;
      }
      mission.assemblerStop = asmStop;
      mission.deliverable = text;
    } catch (err) {
      if (isMissionPause(err)) throw err;
      throwIfPause(mission, ctl);
      noteCall(asm.provider, false, Date.now() - s5, err);
      if (!troubleKind(err) && !ctl.signal.aborted) observe({ provider: asm.provider, model: asm.model, capability: "writing", difficulty: 3, runId: id, ok: false });
      emit("agent.error", { agent: aAgent, provider: asm.provider, model: asm.model, missionId: id, error: err.message });
      mission.deliverable = finished.map((t) => `## ${t.title}\n${t.output}`).join("\n\n");
    }
  }

  // 0.4.21: the checks every finished mission goes through before it may say "done"
  function finishChecks() {
    const noSources = !(mission.sources || []).length;
    if (noSources) {
      mission.deliverable = stripSearchLeaks(mission.deliverable || "");
      for (const t of mission.tasks) if (typeof t.output === "string" && !t.media) t.output = stripSearchLeaks(t.output);
    }
    const want = namedFile(goal);
    const fext = fileExt(want) || (mission.classification?.capability === "code" ? "html" : "");
    const tr = checkTruncation(mission.deliverable || "", { ext: fext, capability: mission.classification?.capability, stop: mission.assemblerStop });
    if (tr.truncated) mission.deliverableTruncated = tr.reason;
    // 0.4.21 (dogfood 12): files really written into the project folder by the code steps, and the steps that could not
    const wrote = mission.tasks.flatMap((t) => (t.writes || []).map((w) => ({ ...w, taskId: t.id })));
    const unsaved = mission.tasks.filter((t) => t.notSaved);
    const hit = want && wrote.find((w) => path.basename(w.name).toLowerCase() === path.basename(want).toLowerCase());
    const wantImg = namedImage(goal);
    if (want || wantImg) mission.deliverable = stripSaveClaims(mission.deliverable || "");
    if (hit) {
      mission.savedFile = { ok: true, name: hit.name, requested: want, path: hit.path, bytes: hit.bytes, ext: fileExt(hit.name), previewable: false, readable: false, projectId: projectId || null, inProjectFolder: true };
      log(`Wrote ${hit.name} (${hit.bytes} bytes) in your project folder.`);
    } else if (want && !/\.html?$/i.test(want) && unsaved.some((t) => (t.notSaved.files || []).some((n) => path.basename(n).toLowerCase() === path.basename(want).toLowerCase()))) {
      mission.savedFile = { ok: false, name: want, error: unsaved.find((t) => (t.notSaved.files || []).some((n) => path.basename(n).toLowerCase() === path.basename(want).toLowerCase())).notSaved.line };
      log(mission.savedFile.error, { level: "error" });
    } else if (want) {
      if (mission.deliverableTruncated) mission.savedFile = { ok: false, name: want, error: `Not saved: the result was cut off (${tr.reason}), so ${want} was not written.` };
      else mission.savedFile = saveNamedFile({ goal, name: want, text: mission.deliverable, projectId, missionId: id });
      log(mission.savedFile?.ok ? `Saved ${mission.savedFile.name} in the project folder.` : String(mission.savedFile?.error || `Not saved: ${want}.`), mission.savedFile?.ok ? {} : { level: "error" });
    }
    // a picture drawn here: the saved file comes from the drawing step's own disk check
    if (wantImg && !mission.savedFile) {
      const dt = mission.tasks.find((t) => t.media?.local);
      const png = dt?.media?.files?.find((f) => /\.png$/i.test(f.name || ""));
      if (png) mission.savedFile = { ok: true, name: png.name, requested: path.basename(wantImg), path: png.path, bytes: png.bytes, ext: "png", previewable: false, readable: false, projectId: projectId || null };
      else if (dt) mission.savedFile = { ok: false, name: path.basename(wantImg), error: dt.output || `Not made: ${path.basename(wantImg)}.` };
    }
    // "Saved as" is shown only for a file that is on the disk right now
    if (mission.savedFile?.ok && mission.savedFile.path && !onDisk(mission.savedFile.path).exists) {
      mission.savedFile = { ok: false, name: mission.savedFile.name, error: `Not saved: ${mission.savedFile.name} is not on the disk.` };
      log(mission.savedFile.error, { level: "error" });
    }
    // the final answer says plainly what was written, what was not, and what was not run
    {
      const tail = [];
      for (const w of wrote) tail.push(`Wrote ${w.name} (${w.bytes} bytes)`);
      for (const t of unsaved) tail.push(t.notSaved.line);
      for (const t of mission.tasks) if (t.notRun) tail.push(t.notRun.line);
      const add = [...new Set(tail)].filter((l) => !String(mission.deliverable || "").includes(l));
      if (add.length) mission.deliverable = `${String(mission.deliverable || "").trimEnd()}\n\n---\n${add.join("\n")}`.trim();
    }
    // a card is never titled as a file when no file was written
    if (!mission.savedFile?.ok && /\.[a-z0-9]{2,5}$/i.test(String(mission.title || "").trim())) { mission.title = String(mission.title).trim().replace(/\.[a-z0-9]{2,5}$/i, ""); if (mission.plan) mission.plan.title = mission.title; }
    const banner = dryRunBanner(mission.tasks);
    if (banner) { mission.banner = banner; log(`NOT A REAL RESULT: ${banner.text}`, { level: "error" }); }
    const reasons = [];
    for (const t of mission.tasks) {
      if (t.notSaved) reasons.push({ taskId: t.id, title: t.title, kind: "not-saved", reason: t.notSaved.line, provider: t.provider });
      if (t.notRun) reasons.push({ taskId: t.id, title: t.title, kind: "not-run", reason: t.notRun.line, provider: null });
      if (t.status === "failed") reasons.push({ taskId: t.id, title: t.title, kind: t.guard?.kind || "failed", reason: t.error || "The step failed.", provider: t.provider });
      else if (t.qaFailed) reasons.push({ taskId: t.id, title: t.title, kind: t.review?.unchecked ? "qa-unchecked" : "qa-failed", reason: t.review?.unchecked ? "QA could not check this step, so it is not counted as passed." : `QA did not pass this step${t.review?.score != null ? ` (score ${t.review.score} of 10)` : ""}${t.review?.issues?.[0] ? `: ${t.review.issues[0]}` : ""}.`, provider: t.provider });
    }
    if (mission.deliverableTruncated) reasons.push({ taskId: null, title: "Final answer", kind: "truncated", reason: `The final answer was cut off: ${tr.reason}`, provider: mission.assembler?.provider || null });
    mission.incomplete = reasons.length ? { reasons, retryAvoid: [...new Set(reasons.map((r) => r.provider).filter(Boolean))] } : null;
    if (mission.incomplete) log(`Incomplete: ${reasons.map((r) => `${r.title} (${r.reason})`).join(" ").slice(0, 400)}`, { level: "error" });
  }
}

function pubTask(t) {
  return { notSaved: t.notSaved || null, notRun: t.notRun || null, toolRecords: t.toolRecords || [], wroteLine: t.wroteLine || null, run: !!t.run, notDone: stepIsNotDone(t) || !!t.practice, id: t.id, title: t.title, capability: t.capability, difficulty: t.difficulty, deps: t.deps, status: t.status, provider: t.provider, model: t.model, agentName: t.agentName, estCost: t.estCost, cost: t.cost, review: t.review, retried: !!t.retried, revised: !!t.revised, edited: !!t.edited, standIn: t.standIn || null, error: t.error || null, startedAt: t.startedAt || null, finishedAt: t.finishedAt || null, chars: t.output ? t.output.length : 0, output: t.output ? String(t.output).slice(0, 20000) : "", thread: Array.isArray(t.thread) ? t.thread : [], instructions: t.instructions || "", toolCalls: t.toolCalls || 0, agent: !!t.agent, save: !!t.save, app: !!t.app, appId: t.appId || null, needs: t.needs || null, agentJob: t.agentJob || null, artifacts: t.artifacts || null, late: !!t.late, followPending: !!t.followPending, media: t.media || null, employee: t.employee || null, workaround: t.workaround || null, requiresApproval: !!t.requiresApproval, approvalKind: t.approvalKind || null, guard: t.guard || null, truncated: !!t.truncated, continued: t.continued || 0, attempts: t.attempts || [], qaFailed: !!t.qaFailed, inputMissing: t.inputMissing || null, stepKind: t.media?.kind ? `media/${t.media.kind}` : (t.agent ? "agent" : t.app ? "app" : t.capability || null), ...(stepLine(t) || {}) };
}
export function publicMission(m) {
  return { replanned: m.replanned || null, id: m.id, kind: m.kind, title: m.title || m.prompt?.slice(0, 90), prompt: m.prompt, projectId: m.projectId, private: !!m.private, mode: m.mode, qa: m.qa, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt || null, pausedAt: m.pausedAt || null, cost: m.cost, estimatedCost: m.estimatedCost, budgetUsd: m.budgetUsd, limitReached: !!m.limitReached, planner: m.planner, assembler: m.assembler, plan: m.plan, classification: m.classification, tasks: (m.tasks || []).map(pubTask), deliverable: m.deliverable, thread: Array.isArray(m.thread) ? m.thread : [], doubleCheck: m.doubleCheck || null, tone: m.tone || null, error: m.error || null, retry: m.retry || null, log: m.log, sources: m.sources || [], searchEngine: m.searchEngine || null, searched: m.searched === true ? true : m.searched === false ? false : null, librarySources: m.librarySources || [], toolCalls: m.toolCalls || [], fallbacks: m.fallbacks || [], memory: !!m.memory, getDone: grantView(m.id), employees: m.employees || [], appliedDirections: m.appliedDirections || [], workaround: m.workaround || null, savedPdf: m.savedPdf || null, costText: totalCostText(m), steps: stepsReport(m), freeOnly: freeOnlyOn(), estimateFactor: m.estimateFactor || null, banner: m.banner || null, incomplete: m.incomplete || null, savedFile: m.savedFile ? { ...m.savedFile } : null, planNote: m.planNote || null, preflight: m.preflight || null, deliverableTruncated: m.deliverableTruncated || null, searchAsked: m.searchAsked === true, attachedFiles: m.attachedFiles || [] };
}
// 0.4.21: which AI did each step, what it cost, and why it was handed off (shown on the result card)
export function stepsReport(m) {
  return (m.tasks || []).map((t) => { const l = stepLine(t); return l ? { id: t.id, title: t.title, ai: PROVIDERS[t.provider]?.name || t.agentName || t.provider, provider: t.provider, model: t.model, cost: t.cost || 0, costText: l.costText, why: l.why, status: t.status } : null; }).filter(Boolean);
}
// a step that finished but did not do what it set out to: not saved, not run, or says it could not
function stepIsNotDone(t) { return stepNotDone(t) || !!t?.notSaved || !!t?.notRun; }
// the files a code step names ("save in place as cronwords.js", "add cronwords.test.js"), by the step's own words
function stepFileNames(t) {
  if (!t || t.capability !== "code" || t.save || t.run || t.media || t.agent) return [];
  return namedSources(`${t.title || ""}\n${t.instructions || ""}\n${t.deliverable || ""}`).filter(isWritableName);
}
// which of several named files this step is mostly about: the one in its title, else a test file for a test step, else the first non-test file
function primaryName(t, names) {
  if (names.length === 1) return names[0];
  const title = String(t.title || "").toLowerCase();
  const isTest = (n) => /(?:\.test|\.spec)\.|^test[-_]/i.test(path.basename(n));
  return names.find((n) => title.includes(path.basename(n).toLowerCase()))
    || (/\btests?\b/.test(title) ? names.find(isTest) : names.find((n) => !isTest(n)))
    || names[0];
}
function totalCostText(m) {
  const c = Number(m.cost) || 0;
  const rows = (m.tasks || []).filter((t) => !t.agent && !t.media && !t.app && !t.save && !t.run);
  if (c > 0) return `$${c < 0.01 ? c.toFixed(4) : c.toFixed(2)} (${[...new Set(rows.filter((t) => t.cost > 0).map((t) => PROVIDERS[t.provider]?.name || t.provider))].join(", ") || "paid AIs"})`;
  return rows.length ? "$0 (free AIs only)" : "$0";
}
function save(m) {
  saveDoc(m);
}

// ---- an agent's result (Grok Bot or the browser helper) that came back after its mission moved on (or after a restart) ----
// It lands on its task and is added to the deliverable under the task's title.
const lateWhileRunning = new Map(); // mission id -> jobs that finished after the wait, while the mission still ran
// 0.4.21 (dogfood 10): Stop must never take the app down. A late result that cannot be filed is logged and dropped; it is
// never an unhandled rejection. A job the mission itself cancelled because the person pressed Stop is not a late result.
onAnyJobFinished((job) => { Promise.resolve().then(() => lateResult(job)).catch((e) => { try { emit("log", { text: `A late agent result could not be filed (${plainMessage(e)}).`, level: "error" }); } catch { /* nothing more to do */ } }); });
const stoppedByMission = (job) => job?.status === "failed" && /\bmission aborted\b/i.test(String(job.error || ""));
async function lateResult(job) {
  if (job.source?.kind !== "mission" || !job.source.runId) return;
  if (stoppedByMission(job)) return;
  if (lateWhileRunning.has(job.source.runId)) { lateWhileRunning.get(job.source.runId).push(job); return; }
  const m = await ctx().store.getMission(job.source.runId);
  const t = m?.tasks?.find((x) => x.agentJob?.jobId === job.id);
  if (!t) return;
  const AID = job.agent || t.provider || GROKBOT, ANAME = agentName(AID);
  t.agentJob.status = job.status; t.late = true; t.finishedAt = Date.now();
  if (job.status === "done") {
    t.status = "done"; t.error = null; t.output = job.text || `${ANAME} reported this step done.`; t.artifacts = job.artifacts || [];
    const by = job.by === "you" ? "pasted in by you" : `from ${ANAME}, after the rest of the mission`;
    m.deliverable = `${m.deliverable || ""}\n\n## ${t.title} (${by})\n\n${t.output}`.trim();
    observe({ provider: AID, model: AID, capability: "agent", difficulty: t.difficulty, runId: m.id, ok: true, cost: 0 });
  } else {
    t.status = "failed"; t.error = job.error || `${ANAME} reported a failure`;
    observe({ provider: AID, model: AID, capability: "agent", difficulty: t.difficulty, runId: m.id, ok: false });
  }
  if (m.status === "done" && t.status === "failed") m.status = "done-with-errors";
  save(m);
  emit("grokbot.late", { runId: m.id, kind: "mission", mission: publicMission(m), agent: AID });
  emit("log", { text: `${ANAME} ${t.status === "done" ? "finished" : "could not finish"} "${t.title}"; the mission was updated.`, missionId: m.id });
}

// ---- media steps (R2): a video, image or voice file made by a media provider ----
const MEDIA_LINE = `\nA step that must produce a finished video clip, image or voice-over file (not a script, brief or prompt for one) gets capability "media" and "media": {"kind": "video|image|voice", "prompt": "what to generate, under 80 words"}; for voice, put it after the step that writes the words (deps) and the file speaks that step's output. Use "media" only when the goal asks for the file itself. Its cost is shown first and a paid one waits for the person's OK.`;
function mediaPlan(t, goal = "") {
  const kind = String(t.media?.kind || "").toLowerCase();
  if (!MEDIA.KINDS.includes(kind)) return null;
  try {
    const prompt = String(t.media?.prompt || t.instructions || t.title || "").slice(0, MEDIA.MAX_PROMPT);
    const st = MSW.status(kind);
    if (kind === "image" && !st.provider && mediaStatus("image", goal || prompt)?.local) return { kind, prompt, provider: "local-draw", providerName: "Meldmind drawing", usd: 0, note: localDrawNote(), dryRun: false, local: true, jobId: null, status: null, files: [] };
    if (st.provider) return { kind, prompt, provider: st.provider, providerName: st.providerName, usd: st.usd ?? MEDIA.estimate({ provider: st.provider, kind, params: { prompt, text: prompt } }).usd, note: st.alternatives.length ? `If it fails, ${st.alternatives.join(" or ")} steps in.` : "", dryRun: false, jobId: null, status: null, files: [] };
    const provider = MEDIA.chooseProvider(kind);
    const est = MEDIA.estimate({ provider, kind, params: { prompt, text: prompt } });
    return { kind, prompt, provider, providerName: est.providerName, usd: est.usd, note: st.message, needsKey: st.message, dryRun: est.dryRun, jobId: null, status: null, files: [], ...(est.dryRun ? { needs: st.message || null } : {}) };
  } catch { return null; }
}
// 0.4.21: the headline the task asks for is put on a finished image inside Meldmind (a real PNG next to the picture).
// A picture that is not a PNG is marked for the page to finish with its canvas (web/overlay.js).
function headlineOnImage(t, job, goal) {
  try {
    if (!t.media || t.media.kind !== "image" || job.status !== "done" || job.dryRun) return;
    const text = extractHeadline(goal) || extractHeadline(`${t.instructions || ""} ${t.media.prompt || ""}`);
    if (!text) return;
    const f = MEDIA.outputFile(job.id, 0);
    if (!f) { t.media.overlay = { ok: false, text, pending: true, reason: "The picture is not saved on this PC, so the headline was not added." }; return; }
    const buf = fs.readFileSync(f);
    if (!isPng(buf)) { t.media.overlay = { ok: false, text, pending: true, jobId: job.id, reason: "This picture is not a PNG. Use Add headline on the picture to finish it." }; return; }
    const r = overlayPng(buf, text);
    const out = path.join(path.dirname(f), `${job.id}-headline.png`);
    fs.writeFileSync(out, r.png);
    MEDIA.addOutput(job.id, out);
    t.media.files = MEDIA.publicJob(MEDIA.getJob(job.id)).files;
    t.media.overlay = { ok: true, text, file: path.basename(out) };
    t.output = `${t.output}\nHeadline added on the picture: ${path.basename(out)}.`;
  } catch (e) { t.media.overlay = { ok: false, text: "", reason: `The headline was not added: ${String(e.message).slice(0, 120)}` }; }
}
// a job's state onto its task: made (or a dry run, or declined) is done, still waiting is waiting
function mediaOnTask(t, job) {
  t.media.status = job.status; t.media.usd = job.estimate?.usd ?? t.media.usd; t.media.dryRun = !!job.dryRun;
  t.media.files = MEDIA.publicJob(job).files;
  t.output = MEDIA.resultLine(job);
  // 0.4.21 (dogfood 10): a practice frame is not the picture. Say so plainly, with the one setup step, so later steps
  // (and the person) never treat it as the real post image.
  if (job.dryRun || job.status === "dry-run") {
    t.practice = true;
    t.output += ` No ${t.media.kind === "voice" ? "voice-over" : t.media.kind} was made: this is only a practice file, not a real one. ${MSW.setupMessage(t.media.kind)}`;
  }
  if (job.status === "failed") { t.status = "failed"; t.error = job.error || "media job failed"; }
  else if (["awaiting_ok", "queued", "processing"].includes(job.status)) t.status = "waiting";
  else { t.status = "done"; t.error = null; }
  if (job.status === "done" && !job.dryRun) t.cost = +(Number(job.estimate?.usd) || 0).toFixed(5);
}
const mediaSection = (t) => `## ${t.title}\n\n${t.output}`;
// a job that was waiting for the person's OK finished: its file lands on the task and in the deliverable
MEDIA.onJobFinished(async (job) => {
  if (job.origin !== "mission" || !job.missionId) return;
  const inFlight = live.get(job.missionId);
  const m = inFlight || await ctx().store.getMission(job.missionId);
  const t = m?.tasks?.find((x) => x.media?.jobId === job.id);
  if (!t || t.status !== "waiting") return; // a dry run or a quick job is handled by the step itself
  mediaOnTask(t, job);
  t.late = true; t.finishedAt = Date.now();
  if (t.cost) m.cost = +((m.cost || 0) + t.cost).toFixed(5);
  emit("task.update", { missionId: m.id, task: pubTask(t) });
  if (inFlight) return; // the mission is still going: its own save and deliverable pick this up
  if (t.status === "done") m.deliverable = `${m.deliverable || ""}\n\n${mediaSection(t)}`.trim();
  if (m.status === "done" && t.status === "failed") m.status = "done-with-errors";
  save(m);
  emit("mission.update", { mission: publicMission(m) });
  emit("log", { text: `${t.media.providerName} ${t.media.kind} for "${t.title}" ${t.status === "done" ? (job.status === "declined" ? "was not made (you said no)" : "is ready") : "could not be made"}; the mission was updated.`, missionId: m.id });
});
