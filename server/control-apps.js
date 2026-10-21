// Phases 45 to 51. App cards, scores, MCP as an app, a website door, a signed-in
// profile, Windows UI Automation, and a screenshot fallback.
// Fixture drivers only. This file does not open Edge, does not read a browser profile,
// does not call UI Automation, and does not send a picture to a model.
// It stays separate from the desktop-doors module in pull request 62.
// Safety: Allow per app, a second yes before send, buy, or delete, a banner, Stop,
// and no stored passwords.

import { capsFor } from "./added-caps.js";
import { observe, bestAtWhat } from "./brain.js";
import { emit } from "./events.js";
import { registerExternalAgent, unregisterExternalAgent } from "./external-agents.js";
import { gate } from "./feature-gate.js";
import { needsApproval } from "./mcp.js";
import { ask, decide, phoneReady } from "./phone-approvals.js";
import { doc, putDoc } from "./store.js";

const DOC = "control.apps";
export const ACTIONS = ["open", "click", "type", "submit", "scroll", "back", "ask", "done", "fail"];
export const PROFILE_WARNING = "This uses the cookies in that browser profile. Site terms may limit automation. The profile is not uploaded.";
export const SCREENSHOT_CAP = 1;
const STEP_CAP = 12;
const PAGE_CAP = 0.25;
const SHOT_USD = 0.4;
const RISKY = /\b(send|submit|post|publish|buy|purchase|pay|delete|remove)\b/i;
const SECRET = /password|billing|square|checkout/i;
const RELAY_HOST = /(^|\.)((chatgpt|claude)\.com|chat\.openai\.com)$/i;

function empty() {
  return { apps: [], using: null, stopped: {} };
}
export function loadState() {
  const saved = doc(DOC, empty);
  return {
    apps: Array.isArray(saved?.apps) ? saved.apps : [],
    using: saved?.using || null,
    stopped: saved?.stopped || {},
  };
}
function saveState(next) {
  putDoc(DOC, next);
  return next;
}
function slug(name) {
  const s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return s || "app";
}
function agentId(id) {
  return `app-${id}`.slice(0, 41);
}
function find(id, state = loadState()) {
  return state.apps.find((app) => app.id === id) || null;
}
function bad(message, status = 400, code = "control") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function cleanCaps(list) {
  const caps = capsFor(Array.isArray(list) ? list : []);
  const named = (Array.isArray(list) ? list : []).filter((cap) => caps[cap] === 90);
  return named.length ? named : ["analysis"];
}

function publicApp(app) {
  return {
    id: app.id,
    name: app.name,
    kind: app.kind,
    capabilities: app.capabilities,
    origin: app.origin || "",
    exe: app.exe || "",
    mcpServerId: app.mcpServerId || "",
    spendCap: app.spendCap,
    screenshot: !!app.screenshot,
    screenshotCap: app.screenshotCap,
    profile: app.profile,
    allowed: !!app.allowed,
    status: app.status,
    light: app.status === "allowed" ? "green" : app.status === "revoked" ? "grey" : "grey",
    activity: app.activity || "",
    scores: app.scores || null,
  };
}

export function publicState() {
  const state = loadState();
  const using = state.using ? state.apps.find((app) => app.id === state.using.id) : null;
  return {
    apps: state.apps.map(publicApp),
    planner: plannerRows(),
    using: using ? { id: using.id, name: using.name, text: `Meldmind is using ${using.name}` } : null,
  };
}

export function plannerRows() {
  return loadState().apps
    .filter((app) => app.allowed && app.status === "allowed")
    .map((app) => ({ id: app.id, model: app.name, name: app.name, kind: app.kind, capabilities: app.capabilities }));
}

function remember(app) {
  const id = agentId(app.id);
  if (!app.allowed) {
    try { unregisterExternalAgent(id); } catch { /* not registered */ }
    return;
  }
  try {
    registerExternalAgent({
      id,
      name: app.name,
      via: app.kind === "mcp" ? "mcp" : app.kind,
      color: "#34d399",
    });
  } catch { /* already registered */ }
}

export function addApp(raw = {}) {
  const state = loadState();
  gate("desktop", { count: state.apps.filter((app) => app.status !== "revoked").length });
  const name = String(raw.name || "").trim().slice(0, 40);
  if (!name) throw bad("Type a name for the app.");
  if (/sk-|gsk_|xai-|AIza|Bearer /i.test(name)) throw bad("A name cannot carry a key.");
  const kind = ["website", "desktop", "mcp"].includes(raw.kind) ? raw.kind : "desktop";
  let id = slug(name);
  if (state.apps.some((app) => app.id === id)) id = `${id}-${state.apps.length + 1}`.slice(0, 40);
  const profile = ["edge", "chrome", "owned"].includes(raw.profile) ? raw.profile : "owned";
  const app = {
    id,
    name,
    kind,
    capabilities: cleanCaps(raw.capabilities),
    origin: String(raw.origin || "").slice(0, 200),
    exe: String(raw.exe || "").slice(0, 120),
    mcpServerId: String(raw.mcpServerId || "").slice(0, 80),
    spendCap: Number(raw.spendCap) > 0 ? Number(raw.spendCap) : PAGE_CAP,
    screenshot: !!raw.screenshot,
    screenshotCap: SCREENSHOT_CAP,
    profile,
    allowed: false,
    status: "draft",
    activity: "",
    scores: capsFor(cleanCaps(raw.capabilities)),
    lastSteps: [],
  };
  state.apps.push(app);
  saveState(state);
  return publicApp(app);
}

export function setAllowed(id, allowed) {
  const state = loadState();
  const app = find(id, state);
  if (!app) throw bad("That app is not in the list.", 404);
  if (allowed) gate("desktop");
  app.allowed = !!allowed;
  app.status = allowed ? "allowed" : "revoked";
  if (!allowed) app.activity = "";
  remember(app);
  if (!allowed && state.using?.id === id) state.using = null;
  saveState(state);
  return publicState();
}

export function stopUsing(id) {
  const state = loadState();
  state.stopped[id || state.using?.id || ""] = Date.now();
  if (!id || state.using?.id === id) state.using = null;
  saveState(state);
  return publicState();
}

function banner(app, state) {
  state.using = { id: app.id, since: Date.now() };
  saveState(state);
  return { id: app.id, name: app.name, text: `Meldmind is using ${app.name}` };
}

function handoff(app, status, extra = {}) {
  emit("external.handoff", {
    agent: agentId(app.id),
    name: app.name,
    status,
    at: Date.now(),
    ...extra,
  });
}

function riskyLabel(action, label) {
  const hay = `${action?.action || ""} ${label || ""} ${action?.text || ""}`;
  if (/\b(buy|purchase|pay)\b/i.test(hay)) return "buy";
  if (/\b(delete|remove)\b/i.test(hay)) return "delete";
  if (RISKY.test(hay) || action?.action === "submit") return "send";
  return null;
}

function needsYes(action, label) {
  return riskyLabel(action, label);
}

function approvalFor(app, kind, label, amount) {
  const item = ask({ kind, action: `${kind === "buy" ? "Buy" : kind === "delete" ? "Delete" : "Send"} on ${app.name}: ${label || kind}`, amount });
  return item;
}

function accepted(item, confirm) {
  if (!item) return true;
  if (confirm) {
    decide(item.id, true, "pc");
    return true;
  }
  if (phoneReady()) return false;
  return false;
}

function finishObserve(app, capability, ok, cost) {
  if (capability === "writing") return;
  const cap = app.capabilities.includes(capability) ? capability : app.capabilities[0] || "analysis";
  observe({ provider: "app", model: app.name, capability: cap, difficulty: 2, runId: `app-${app.id}`, ok, cost: cost || 0, ms: 1 });
  app.scores = capsFor(app.capabilities);
}

function safeLog(line) {
  return String(line || "").replace(/\b(sk-[A-Za-z0-9_\-]{4,})\b/g, "").slice(0, 160);
}

export function runJob(id, body = {}) {
  const state = loadState();
  const app = find(id, state);
  if (!app || !app.allowed) throw bad("Allow this app before Meldmind uses it.", 403, "allow");
  if (body.honorStop && state.stopped[id]) {
    return { status: "stopped", steps: [], log: ["Stopped."], banner: null };
  }
  delete state.stopped[id];
  const capability = String(body.capability || app.capabilities[0] || "analysis");
  if (capability === "writing") {
    return { handed: false, status: "skipped", reason: "Writing stays with a text model.", steps: [], log: [] };
  }
  if (body.browserRunning && (app.profile === "edge" || app.profile === "chrome")) {
    throw bad(`Close ${app.profile === "chrome" ? "Chrome" : "Edge"} before Meldmind uses that profile.`, 409, "browser_open");
  }
  const relay = relayOf(app.origin);
  const warn = app.profile === "edge" || app.profile === "chrome" ? PROFILE_WARNING : "";
  handoff(app, "working", { job: String(body.title || app.name).slice(0, 80), relay });
  emit("agent.start", { agent: agentId(app.id), provider: "app", model: app.name, role: "work", label: app.name });
  const using = banner(app, state);
  let result;
  try {
    if (app.kind === "mcp") result = runMcp(app, body, state);
    else if (app.kind === "website") result = runWebsite(app, body, state);
    else if (body.shots || app.screenshot && body.useScreenshot) result = runShots(app, body, state);
    else result = runDesktop(app, body, state);
  } catch (err) {
    app.activity = "Stopped";
    app.light = "red";
    state.using = null;
    saveState(state);
    handoff(app, "failed", { result: err.message });
    emit("agent.error", { agent: agentId(app.id), provider: "app", model: app.name, error: err.message });
    throw err;
  }
  result.relay = relay;
  result.warning = warn;
  result.banner = result.status === "needs_approval" ? using : null;
  result.handed = result.status !== "skipped";
  if (result.status === "done") {
    finishObserve(app, capability, true, result.cost || 0);
    app.activity = result.log?.[result.log.length - 1] || "Done";
    app.lastSteps = result.steps || [];
    state.using = null;
    handoff(app, "done", { result: app.activity });
    emit("agent.done", { agent: agentId(app.id), provider: "app", model: app.name, cost: result.cost || 0 });
  } else if (result.status === "needs_approval") {
    app.activity = "Waiting for your OK";
    handoff(app, "needs_approval", { result: result.reason || "Waiting for your OK" });
  } else {
    state.using = null;
    app.activity = result.reason || result.status;
    handoff(app, result.status === "stopped" ? "failed" : "done", { result: app.activity });
  }
  saveState(state);
  result.who = bestAtWhat({}).capabilities.flatMap((row) => row.models).find((row) => row.model === app.name) || null;
  return result;
}

function relayOf(origin) {
  try { return RELAY_HOST.test(new URL(origin).hostname); } catch { return false; }
}

function runWebsite(app, body, state) {
  const page = body.page || {};
  const actions = Array.isArray(page.actions) ? page.actions : [];
  const log = [];
  const steps = [];
  let spent = 0;
  const cap = app.spendCap || PAGE_CAP;
  for (const action of actions) {
    if (body.stopAfter != null && steps.length >= body.stopAfter) {
      state.stopped[app.id] = Date.now();
      return { status: "stopped", steps, log: log.concat(["Stopped."]), cost: spent };
    }
    if (steps.length >= STEP_CAP) return { status: "stopped", reason: "Step cap reached.", steps, log, cost: spent };
    if (spent >= cap) return { status: "stopped", reason: "Spend cap reached.", steps, log, cost: spent };
    if (!ACTIONS.includes(action.action)) continue;
    const field = (page.fields || []).find((item) => item.ref === action.ref);
    if (action.action === "type" && (field?.password || field?.type === "password" || SECRET.test(field?.label || ""))) {
      log.push("Refused a password field.");
      continue;
    }
    const button = (page.buttons || []).find((item) => item.ref === action.ref);
    const label = button?.label || field?.label || "";
    const kind = needsYes(action, label);
    if (kind && !body.confirm) {
      const item = approvalFor(app, kind, label || action.action, action.amount);
      return { status: "needs_approval", approvalId: item.id, reason: `Waiting to ${kind}.`, steps, log, cost: spent };
    }
    if (kind && body.confirm) {
      const item = approvalFor(app, kind, label || action.action, action.amount);
      accepted(item, true);
    }
    steps.push({ action: action.action, ref: action.ref || "" });
    log.push(safeLog(action.action === "type" ? `Typed into ${label || action.ref || "a field"}` : `${action.action} ${label || action.ref || ""}`.trim()));
    spent = +(spent + 0.01).toFixed(4);
  }
  return { status: "done", steps, log, cost: spent, profile: app.profile };
}

function runDesktop(app, body, state) {
  const tree = body.tree || {};
  if (tree.foreground && app.exe && tree.foreground !== app.exe) {
    return { status: "stopped", reason: "Focus left the allowed program. Input stopped.", steps: [], log: [], cost: 0 };
  }
  const log = [];
  const steps = [];
  for (const node of tree.actions || tree.nodes || []) {
    if (body.stopAfter != null && steps.length >= body.stopAfter) {
      return { status: "stopped", steps, log: log.concat(["Stopped."]), cost: 0 };
    }
    if (node.password || node.type === "password") {
      log.push("Refused a password edit.");
      continue;
    }
    const kind = needsYes({ action: node.action || "click" }, node.name || "");
    if (kind && !body.confirm) {
      const item = approvalFor(app, kind, node.name || kind, node.amount);
      return { status: "needs_approval", approvalId: item.id, reason: `Waiting to ${kind}.`, steps, log, cost: 0 };
    }
    steps.push({ action: "invoke", ref: node.id || node.name || "" });
    log.push(safeLog(`Used ${node.name || "a control"}`));
  }
  if (!steps.length && !(tree.actions || tree.nodes || []).length) {
    steps.push({ action: "invoke", ref: "ready" });
    log.push("Read the window.");
  }
  return { status: "done", steps, log, cost: 0, exe: app.exe };
}

export function downscale(image) {
  const w = Number(image?.width) || 1024;
  const h = Number(image?.height) || 768;
  const long = Math.max(w, h);
  const scale = long > 1280 ? 1280 / long : 1;
  return { id: String(image?.id || "shot"), width: Math.round(w * scale), height: Math.round(h * scale) };
}

function shotBlocked(image) {
  return /square|billing|checkout/i.test(`${image?.title || ""} ${image?.name || ""}`);
}

function runShots(app, body) {
  if (!app.screenshot) throw bad("Screenshot control is off for this app. Turn it on for this app first.", 403, "screenshot_off");
  const shots = Array.isArray(body.shots) ? body.shots : [];
  const cap = app.screenshotCap || SCREENSHOT_CAP;
  const estimate = +((shots.length || 1) * SHOT_USD).toFixed(2);
  if (!body.seenEstimate) {
    return { status: "estimate", estimate, cap, steps: [], log: [`About $${estimate.toFixed(2)} for this screenshot job. The cap is $${cap.toFixed(2)}.`], cost: 0 };
  }
  const log = [];
  const steps = [];
  let spent = 0;
  let sent = [];
  for (const image of shots) {
    if (shotBlocked(image)) {
      return { status: "refused", reason: "Square and billing screens are refused.", steps, log, sentImages: sent, cost: spent, estimate, cap };
    }
    if (spent + SHOT_USD > cap) {
      return { status: "stopped", reason: "Screenshot cap reached.", steps, log, sentImages: sent, cost: spent, estimate, cap };
    }
    const picture = downscale(image);
    sent = [picture.id];
    steps.push({ action: "click", ref: picture.id, width: picture.width, height: picture.height });
    log.push(`Clicked from picture ${picture.id}`);
    spent = +(spent + SHOT_USD).toFixed(2);
  }
  return { status: "done", steps, log, sentImages: sent, cost: spent, estimate, cap };
}

function runMcp(app, body) {
  const toolName = String(body.tool?.name || "read").slice(0, 60);
  const server = { autoReadOnly: !!body.tool?.autoReadOnly, prefs: {} };
  const tool = { name: toolName, annotations: { readOnlyHint: body.tool?.readOnlyHint === true } };
  const askFirst = needsApproval(server, tool);
  if (askFirst && !body.confirm) {
    const item = approvalFor(app, "send", toolName, null);
    return { status: "needs_approval", approvalId: item.id, reason: "Waiting to run that tool.", steps: [], log: [], cost: 0, via: "mcp" };
  }
  return {
    status: "done",
    ran: true,
    via: "mcp",
    serverId: app.mcpServerId,
    steps: [{ action: "tool", ref: toolName }],
    log: [`Ran ${toolName} through the existing MCP client.`],
    cost: 0,
  };
}

export function suggestApp(capability) {
  return plannerRows().find((app) => app.capabilities.includes(capability)) || null;
}
