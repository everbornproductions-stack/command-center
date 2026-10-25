// Phases 45 to 51. App cards, scores, MCP as an app, a website door, a signed-in
// profile, Windows UI Automation, and a screenshot fallback.
// A job with a fixture page, tree, or picture list stays on the fixture path.
// A live job opens Edge through Playwright, reads one Windows program through
// UI Automation, or sends one downscaled picture to the computer-use tool.
// A signed-in Edge or Chrome profile is used only when signedIn is true.
// It stays separate from the desktop-doors module in pull request 62.
// Safety: Allow per app, a second yes before send, buy, or delete, a banner, Stop,
// and no stored passwords.

import { capsFor } from "./added-caps.js";
import {
  askComputer, blockedScreen, blockedUrl, PAYMENT_REFUSAL, PAYMENT_SCREEN, browserRunning, clickAt, computerRequest,
  computerTarget, grabScreen, invokeControl, openBrowser, profilePlan, readWindow,
} from "./app-drivers.js";
import { observe, bestAtWhat } from "./brain.js";
import { emit } from "./events.js";
import { registerExternalAgent, unregisterExternalAgent } from "./external-agents.js";
import { gate } from "./feature-gate.js";
import { recordCall } from "./ledger.js";
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
const SECRET = /password|billing|stripe|payment|checkout/i;
const RELAY_HOST = /(^|\.)((chatgpt|claude)\.com|chat\.openai\.com)$/i;

function empty() {
  return { apps: [], using: null, stopped: {}, plans: {} };
}
export function loadState() {
  const saved = doc(DOC, empty);
  return {
    apps: Array.isArray(saved?.apps) ? saved.apps : [],
    using: saved?.using || null,
    stopped: saved?.stopped || {},
    plans: saved?.plans && typeof saved.plans === "object" && !Array.isArray(saved.plans) ? saved.plans : {},
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
    signedIn: !!app.signedIn,
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
    plans: Object.values(state.plans || {}).filter((pl) => Date.now() - pl.createdAt < PLAN_TTL_MS).map(publicPlan),
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
  const signedIn = raw.signedIn === true && (profile === "edge" || profile === "chrome");
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
    signedIn,
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

function prepareJob(id, body) {
  const state = loadState();
  const app = find(id, state);
  if (!app || !app.allowed) throw bad("Allow this app before Meldmind uses it.", 403, "allow");
  if (body.honorStop && state.stopped[id]) {
    return { early: { status: "stopped", steps: [], log: ["Stopped."], banner: null } };
  }
  delete state.stopped[id];
  const capability = String(body.capability || app.capabilities[0] || "analysis");
  if (capability === "writing") {
    return { early: { handed: false, status: "skipped", reason: "Writing stays with a text model.", steps: [], log: [] } };
  }
  if (body.browserRunning && (app.profile === "edge" || app.profile === "chrome")) {
    throw bad(`Close ${app.profile === "chrome" ? "Chrome" : "Edge"} before Meldmind uses that profile.`, 409, "browser_open");
  }
  const relay = relayOf(app.origin);
  const warn = app.profile === "edge" || app.profile === "chrome" ? PROFILE_WARNING : "";
  handoff(app, "working", { job: String(body.title || app.name).slice(0, 80), relay });
  emit("agent.start", { agent: agentId(app.id), provider: "app", model: app.name, role: "work", label: app.name });
  const using = banner(app, state);
  return { state, app, capability, relay, warn, using };
}

function failJob(prep, err) {
  const app = prep.app;
  app.activity = "Stopped";
  app.light = "red";
  prep.state.using = null;
  prep.state.plans = loadState().plans;
  saveState(prep.state);
  handoff(app, "failed", { result: err.message });
  emit("agent.error", { agent: agentId(app.id), provider: "app", model: app.name, error: err.message });
}

function finishJob(prep, result) {
  const fresh = loadState();
  prep.state.plans = fresh.plans; // a list planned or pressed during this job is kept as it is now
  if (fresh.stopped?.[prep.app.id]) {
    prep.state.stopped[prep.app.id] = fresh.stopped[prep.app.id];
    prep.state.using = null;
    if (result.status === "done") result = { ...result, status: "stopped", log: [...(result.log || []), "Stopped."] };
  }
  const { state, app, capability, relay, warn, using } = prep;
  result.relay = relay;
  result.warning = result.driver ? (result.signedIn ? PROFILE_WARNING : "") : warn;
  result.banner = result.status === "needs_approval" ? using : null;
  result.handed = result.status !== "skipped";
  if (result.status === "done") {
    finishObserve(app, capability, true, result.cost || 0);
    app.activity = result.log?.[result.log.length - 1] || "Done";
    app.lastSteps = result.steps || [];
    state.using = null;
    handoff(app, "done", { result: app.activity });
    emit("agent.done", { agent: agentId(app.id), provider: "app", model: app.name, cost: result.cost || 0 });
  } else if (result.status === "needs_approval" || result.status === "needs_confirm") {
    app.activity = "Waiting for your OK";
    if (result.status === "needs_confirm") state.using = null;
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

function dispatchFixture(app, body, state) {
  if (app.kind === "mcp") return runMcp(app, body, state);
  if (app.kind === "website") return runWebsite(app, body, state);
  if (body.shots || (app.screenshot && body.useScreenshot)) return runShots(app, body, state);
  return runDesktop(app, body, state);
}

export function runJob(id, body = {}) {
  const prep = prepareJob(id, body);
  if (prep.early) return prep.early;
  let result;
  try {
    result = dispatchFixture(prep.app, body, prep.state);
  } catch (err) {
    failJob(prep, err);
    throw err;
  }
  return finishJob(prep, result);
}

export async function runLive(id, body = {}) {
  const prep = prepareJob(id, body);
  if (prep.early) return prep.early;
  let result;
  try {
    if (prep.app.kind === "mcp") result = runMcp(prep.app, body, prep.state);
    else if (prep.app.kind === "website") result = await runWebsiteLive(prep.app, body);
    else if (prep.app.screenshot && (body.useScreenshot || body.shots)) result = await runShotsLive(prep.app, body);
    else result = await runDesktopLive(prep.app, body);
  } catch (err) {
    failJob(prep, err);
    throw err;
  }
  return finishJob(prep, result);
}

function halted(id, body) {
  if (body.signal?.aborted) return true;
  return !!loadState().stopped?.[id];
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
  return PAYMENT_SCREEN.test(`${image?.title || ""} ${image?.name || ""}`);
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
      return { status: "refused", reason: PAYMENT_REFUSAL, steps, log, sentImages: sent, cost: spent, estimate, cap };
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

function passwordField(field) {
  return !!(field && (field.password || field.type === "password" || SECRET.test(field.label || "")));
}

async function runWebsiteLive(app, body) {
  const plan = profilePlan(app);
  if (plan.signedIn) {
    const running = await browserRunning(plan.browser);
    if (running) throw bad(`Close ${plan.browser === "chrome" ? "Chrome" : "Edge"} before Meldmind uses that profile.`, 409, "browser_open");
  }
  const opened = blockedUrl(app.origin);
  if (opened) return { status: "refused", reason: opened, steps: [], log: [], cost: 0, driver: "playwright", signedIn: plan.signedIn };
  const session = await openBrowser(plan);
  const log = [];
  const steps = [];
  let spent = 0;
  const cap = app.spendCap || PAGE_CAP;
  const profile = plan.signedIn ? plan.browser : "owned";
  try {
    if (app.origin) await session.goto(app.origin);
    let page = await session.snapshot();
    const screen = blockedUrl(page?.url) || blockedScreen(page?.title);
    if (screen) return { status: "refused", reason: screen, steps, log, cost: spent, driver: "playwright", signedIn: plan.signedIn };
    const actions = Array.isArray(body.actions) ? body.actions : (Array.isArray(body.page?.actions) ? body.page.actions : []);
    if (!actions.length) {
      log.push("Read the page.");
      steps.push({ action: "open", ref: page?.url || app.origin || "" });
      return { status: "done", steps, log, cost: spent, driver: "playwright", profile, signedIn: plan.signedIn };
    }
    for (const action of actions) {
      if (halted(app.id, body) || (body.stopAfter != null && steps.length >= body.stopAfter)) {
        return { status: "stopped", steps, log: log.concat(["Stopped."]), cost: spent, driver: "playwright", signedIn: plan.signedIn };
      }
      if (steps.length >= STEP_CAP) return { status: "stopped", reason: "Step cap reached.", steps, log, cost: spent, driver: "playwright", signedIn: plan.signedIn };
      if (spent >= cap) return { status: "stopped", reason: "Spend cap reached.", steps, log, cost: spent, driver: "playwright", signedIn: plan.signedIn };
      if (!ACTIONS.includes(action.action)) continue;
      page = await session.snapshot();
      const blocked = blockedUrl(page?.url) || blockedScreen(page?.title);
      if (blocked) return { status: "refused", reason: blocked, steps, log, cost: spent, driver: "playwright", signedIn: plan.signedIn };
      const field = (page?.fields || []).find((item) => item.ref === action.ref);
      if (action.action === "type" && passwordField(field)) {
        log.push("Refused a password field.");
        continue;
      }
      const button = (page?.buttons || []).find((item) => item.ref === action.ref);
      const label = button?.label || field?.label || "";
      const kind = needsYes(action, label);
      if (kind && !body.confirm) {
        const item = approvalFor(app, kind, label || action.action, action.amount);
        return { status: "needs_approval", approvalId: item.id, reason: `Waiting to ${kind}.`, steps, log, cost: spent, driver: "playwright", signedIn: plan.signedIn };
      }
      if (kind && body.confirm) accepted(approvalFor(app, kind, label || action.action, action.amount), true);
      if (action.action === "open" && action.url) {
        const no = blockedUrl(action.url);
        if (no) return { status: "refused", reason: no, steps, log, cost: spent, driver: "playwright", signedIn: plan.signedIn };
        await session.goto(action.url);
      } else if (action.action === "click" || action.action === "submit") await session.click(action.ref);
      else if (action.action === "type") await session.type(action.ref, action.text || "");
      steps.push({ action: action.action, ref: action.ref || "" });
      log.push(safeLog(action.action === "type" ? `Typed into ${label || action.ref || "a field"}` : `${action.action} ${label || action.ref || ""}`.trim()));
      spent = +(spent + 0.01).toFixed(4);
    }
    return { status: "done", steps, log, cost: spent, driver: "playwright", profile, signedIn: plan.signedIn };
  } finally {
    await session.close();
  }
}

// ---------- desktop apps: plan first, press only a confirmed list ----------
// A desktop step with no explicit list (and every mission step) never presses anything on its own. It reads the
// window, plans which controls it would press (a dry run), and waits. The person sees the exact list and clicks
// Press these; only then are those controls pressed, in that order, with Stop checked before each one. Get it
// done does not skip this: only the confirm route (confirmPlan: true) presses a planned list.
export const PLAN_TTL_MS = 30 * 60 * 1000;
const PLAN_MAX = 8;
const isPassword = (n) => !!(n?.password || n?.type === "password" || /password/i.test(String(n?.name || "")));
function publicPlan(pl) {
  return { id: pl.id, appId: pl.appId, app: pl.app, title: pl.title || "", actions: pl.actions, createdAt: pl.createdAt, missionId: pl.missionId || null, taskId: pl.taskId || null };
}
// Which controls the step's words name, in the order the words name them. Passwords and unnamed controls are left out.
export function planFromTree(nodes, { title = "", instructions = "" } = {}) {
  const text = ` ${String(`${title}\n${instructions}`).toLowerCase()} `;
  const hits = [];
  for (const n of Array.isArray(nodes) ? nodes : []) {
    const name = String(n?.name || "").trim();
    if (!n?.id || !name || name.length < 2 || isPassword(n)) continue;
    const re = new RegExp(`(^|[^a-z0-9])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    const m = re.exec(text);
    if (m) hits.push({ at: m.index, ref: String(n.id), name, type: String(n.type || ""), risky: riskyLabel({ action: n.action || "click" }, name) || null });
  }
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set();
  return hits.filter((h) => !seen.has(h.ref) && seen.add(h.ref)).slice(0, PLAN_MAX).map(({ at, ...rest }) => rest);
}
function savePlan(app, body, actions) {
  const state = loadState();
  for (const [id, pl] of Object.entries(state.plans)) if (Date.now() - pl.createdAt >= PLAN_TTL_MS) delete state.plans[id];
  const id = "plan-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  state.plans[id] = { id, appId: app.id, app: app.name, title: String(body.title || "").slice(0, 120), actions, createdAt: Date.now(), missionId: body.missionId || null, taskId: body.taskId || null };
  saveState(state);
  emit("control.plan", { plan: publicPlan(state.plans[id]) });
  return state.plans[id];
}
export function getPlan(id) {
  const pl = loadState().plans[String(id || "")];
  return pl && Date.now() - pl.createdAt < PLAN_TTL_MS ? publicPlan(pl) : null;
}
export function cancelPlan(id) {
  const state = loadState();
  const pl = state.plans[String(id || "")];
  if (!pl) throw bad("That list is gone. Nothing was pressed.", 404, "no_plan");
  delete state.plans[pl.id];
  saveState(state);
  emit("control.plan", { plan: { ...publicPlan(pl), cancelled: true } });
  return { ok: true, cancelled: pl.id, pressed: 0 };
}
export const planLine = (actions) => actions.map((a, i) => `${i + 1}. ${a.name}${a.risky ? ` (this will ${a.risky})` : ""}`).join("\n");

async function pressPlan(app, body, nodes) {
  if (body.confirmPlan !== true) throw bad("Confirm the list of controls first. Nothing was pressed.", 409, "confirm_plan");
  const state = loadState();
  const pl = state.plans[String(body.planId || "")];
  if (!pl || pl.appId !== app.id || Date.now() - pl.createdAt >= PLAN_TTL_MS) throw bad("That list is gone or is for another app. Nothing was pressed.", 404, "no_plan");
  delete state.plans[pl.id]; // a list is pressed once
  saveState(state);
  const steps = [];
  const log = [];
  for (const a of pl.actions) {
    if (halted(app.id, body)) return { status: "stopped", steps, log: log.concat(["Stopped."]), cost: 0, driver: "uia", planId: pl.id };
    const node = nodes.find((n) => n.id && n.id === a.ref);
    if (!node) { log.push(safeLog(`${a.name} is no longer in the window. Skipped.`)); continue; }
    if (isPassword(node)) { log.push("Refused a password edit."); continue; }
    const kind = needsYes({ action: node.action || "click" }, node.name || a.name);
    if (kind) accepted(approvalFor(app, kind, node.name || a.name, node.amount), true); // the confirmed list named it
    await invokeControl(app.exe, a.ref);
    steps.push({ action: "invoke", ref: a.ref });
    log.push(safeLog(`Used ${node.name || a.name}`));
  }
  return { status: "done", steps, log, cost: 0, driver: "uia", exe: app.exe, planId: pl.id };
}

async function runDesktopLive(app, body) {
  const tree = await readWindow(app.exe);
  if (tree?.focusLost || (tree?.foreground && app.exe && tree.foreground !== app.exe)) {
    return { status: "stopped", reason: "Focus left the allowed program. Input stopped.", steps: [], log: [], cost: 0, driver: "uia" };
  }
  const nodes = tree?.nodes || [];
  if (body.planId) return pressPlan(app, body, nodes);
  const explicit = Array.isArray(body.actions) && body.actions.length > 0 && !body.fromMission;
  if (!explicit) {
    // no list: plan only. Nothing is pressed until the person confirms the exact list.
    const actions = planFromTree(nodes, body);
    if (!actions.length) {
      return { status: "nothing_to_press", reason: "Meldmind read the window but could not tell which controls to press. Nothing was pressed.", steps: [], log: ["Read the window. Nothing was pressed."], cost: 0, driver: "uia", plan: [] };
    }
    const pl = savePlan(app, body, actions);
    return { status: "needs_confirm", planId: pl.id, plan: actions, reason: `Check the controls Meldmind will press in ${app.name}, then click Press these. Nothing was pressed yet.`, steps: [], log: [`Planned ${actions.length} control${actions.length === 1 ? "" : "s"}. Nothing was pressed yet.`], cost: 0, driver: "uia" };
  }
  // a list the person gave: only controls that are really in this window are pressed
  const list = body.actions.filter((a) => nodes.some((n) => n.id && (n.id === a.id || n.id === a.ref)));
  const log = body.actions.length > list.length ? ["Skipped a control that is not in this window."] : [];
  const steps = [];
  for (const node of list) {
    if (halted(app.id, body) || (body.stopAfter != null && steps.length >= body.stopAfter)) {
      return { status: "stopped", steps, log: log.concat(["Stopped."]), cost: 0, driver: "uia" };
    }
    const known = nodes.find((item) => item.id && (item.id === node.id || item.id === node.ref)) || node;
    if (known.password || known.type === "password") {
      log.push("Refused a password edit.");
      continue;
    }
    const kind = needsYes({ action: known.action || node.action || "click" }, known.name || node.name || "");
    if (kind && !body.confirm) {
      const item = approvalFor(app, kind, known.name || node.name || kind, known.amount);
      return { status: "needs_approval", approvalId: item.id, reason: `Waiting to ${kind}.`, steps, log, cost: 0, driver: "uia" };
    }
    if (kind && body.confirm) accepted(approvalFor(app, kind, known.name || kind, known.amount), true);
    const ref = known.id || node.id || node.ref || "";
    if (ref && ref !== "ready") await invokeControl(app.exe, ref);
    steps.push({ action: "invoke", ref });
    log.push(safeLog(`Used ${known.name || node.name || "a control"}`));
  }
  return { status: "done", steps, log, cost: 0, driver: "uia", exe: app.exe };
}

async function runShotsLive(app, body) {
  if (!app.screenshot) throw bad("Screenshot control is off for this app. Turn it on for this app first.", 403, "screenshot_off");
  const supplied = Array.isArray(body.shots) ? body.shots : null;
  const cap = app.screenshotCap || SCREENSHOT_CAP;
  const estimate = +(((supplied?.length) || 1) * SHOT_USD).toFixed(2);
  if (!body.seenEstimate) {
    return { status: "estimate", estimate, cap, steps: [], log: [`About $${estimate.toFixed(2)} for this screenshot job. The cap is $${cap.toFixed(2)}.`], cost: 0, driver: "computer" };
  }
  const target = computerTarget();
  if (!target) throw bad("Add an Anthropic or OpenAI key before screenshot control can run.", 400, "needs_key");
  const rounds = supplied ? supplied.length : 1;
  const log = [];
  const steps = [];
  let spent = 0;
  let sent = [];
  for (let i = 0; i < rounds; i++) {
    if (halted(app.id, body)) return { status: "stopped", steps, log: log.concat(["Stopped."]), sentImages: sent, cost: spent, estimate, cap, driver: "computer" };
    if (spent + SHOT_USD > cap) {
      return { status: "stopped", reason: "Screenshot cap reached.", steps, log, sentImages: sent, cost: spent, estimate, cap, driver: "computer" };
    }
    const image = supplied ? supplied[i] : await grabScreen();
    if (shotBlocked(image) || blockedScreen(image?.title)) {
      return { status: "refused", reason: PAYMENT_REFUSAL, steps, log, sentImages: sent, cost: spent, estimate, cap, driver: "computer" };
    }
    const picture = downscale(image);
    const req = computerRequest({
      vendor: target.vendor,
      model: target.model,
      image: { data: image?.data || picture.id },
      task: body.title || app.name,
      width: picture.width,
      height: picture.height,
    });
    const reply = await askComputer(req);
    sent = [picture.id];
    recordCall({
      provider: target.vendor,
      model: target.model,
      usage: { input: 1200, output: 40, cost: SHOT_USD },
      role: "app-screenshot",
      estimated: true,
    });
    spent = +(spent + SHOT_USD).toFixed(2);
    const kind = riskyLabel({ action: "click", text: reply?.why || "" }, reply?.why || "");
    if (reply?.action === "click" && kind && !body.confirm) {
      const item = approvalFor(app, kind, reply.why || kind, null);
      return { status: "needs_approval", approvalId: item.id, reason: `Waiting to ${kind}.`, steps, log, sentImages: sent, cost: spent, estimate, cap, driver: "computer" };
    }
    if (reply?.action === "click" && kind && body.confirm) accepted(approvalFor(app, kind, reply.why || kind, null), true);
    if (reply?.action === "click") {
      await clickAt(reply.x, reply.y);
      steps.push({ action: "click", ref: picture.id, width: picture.width, height: picture.height });
      log.push(`Clicked from picture ${picture.id}`);
    } else {
      steps.push({ action: "ask", ref: picture.id, width: picture.width, height: picture.height });
      log.push("Read the screen.");
    }
  }
  return { status: "done", steps, log, sentImages: sent, cost: spent, estimate, cap, driver: "computer" };
}

export function suggestApp(capability) {
  return plannerRows().find((app) => app.capabilities.includes(capability)) || null;
}
