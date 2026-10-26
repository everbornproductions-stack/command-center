// Desktop doors after Antigravity (phases 45 to 51).
// Fixture drivers only. This file does not open Edge, does not read a browser profile,
// does not call UI Automation, and does not send a screenshot to a model.
// Antigravity stays the first app. These doors are for an app the person allows.

import { capsFor } from "./added-caps.js";
import { observe, bestAtWhat } from "./brain.js";
import { emit } from "./events.js";
import { registerExternalAgent, unregisterExternalAgent } from "./external-agents.js";
import { guard, isProFeature } from "./license.js";
import { needsApproval } from "./mcp.js";
import { doc, putDoc } from "./store.js";

const DOC = "desktop.doors";
const DEFAULT_CAP = 1;
const IMAGE_USD = 0.4;

function empty() {
  return { apps: [], using: null };
}

export function loadState() {
  const saved = doc(DOC, empty);
  return { apps: Array.isArray(saved?.apps) ? saved.apps : [], using: saved?.using || null };
}

function saveState(next) {
  putDoc(DOC, next);
  return next;
}

function slug(name) {
  const s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return s || "app";
}

function cleanCaps(list) {
  const caps = capsFor(Array.isArray(list) ? list : []);
  const named = (Array.isArray(list) ? list : []).filter((c) => caps[c] === 90);
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
    profile: app.profile,
    allowed: !!app.allowed,
    status: app.status,
    model: app.model,
    scores: app.scores,
    lastActivity: app.lastActivity || "",
  };
}

export function publicState() {
  const state = loadState();
  return {
    pro: isProFeature("desktop"),
    apps: state.apps.map(publicApp),
    using: state.using,
    note: isProFeature("desktop") ? "" : "Desktop control is part of Pro. Add a license key in Settings.",
  };
}

export function plannerRows() {
  return loadState().apps.filter((app) => app.allowed && app.status === "allowed").map((app) => ({
    model: app.model,
    name: app.name,
    kind: "desktop",
    capabilities: app.capabilities,
  }));
}

function find(id, state = loadState()) {
  return state.apps.find((app) => app.id === id) || null;
}

function agentId(id) {
  return `desk-${id}`.slice(0, 41);
}

function remember(app) {
  if (!app.allowed) {
    try { unregisterExternalAgent(agentId(app.id)); } catch { /* not registered */ }
    return;
  }
  try {
    registerExternalAgent({
      id: agentId(app.id),
      name: app.name,
      via: app.kind === "mcp" ? "mcp" : app.kind,
      color: "#34d399",
    });
  } catch { /* a second allow keeps the node that is already there */ }
}

export function addApp(raw = {}) {
  guard("desktop");
  const name = String(raw.name || "").trim().slice(0, 40);
  if (!name) {
    const err = new Error("Type a name for the app.");
    err.status = 400;
    throw err;
  }
  if (/sk-|gsk_|xai-|AIza|Bearer /i.test(name)) {
    const err = new Error("A name cannot carry a key.");
    err.status = 400;
    throw err;
  }
  const kind = ["website", "desktop", "mcp"].includes(raw.kind) ? raw.kind : "desktop";
  const state = loadState();
  let id = slug(name);
  if (state.apps.some((app) => app.id === id)) id = `${id}-${state.apps.length + 1}`.slice(0, 40);
  const capabilities = cleanCaps(raw.capabilities);
  const app = {
    id,
    name,
    kind,
    capabilities,
    origin: String(raw.origin || "").slice(0, 200),
    exe: String(raw.exe || "").slice(0, 80),
    mcpServerId: String(raw.mcpServerId || "").slice(0, 80),
    spendCap: Math.min(5, Math.max(0.05, Number(raw.spendCap) || 0.25)),
    screenshot: !!raw.screenshot,
    profile: raw.profile === "signed-in" ? "signed-in" : "owned",
    allowed: false,
    status: "draft",
    model: `app.${id}`,
    scores: capsFor(capabilities),
    lastActivity: "",
  };
  state.apps.push(app);
  saveState(state);
  return publicApp(app);
}

export function setAllowed(id, allowed) {
  const state = loadState();
  const app = find(id, state);
  if (!app) {
    const err = new Error("That app is not in the list.");
    err.status = 404;
    throw err;
  }
  if (allowed) guard("desktop");
  app.allowed = !!allowed;
  app.status = allowed ? "allowed" : "revoked";
  if (!allowed && state.using?.appId === app.id) state.using = null;
  saveState(state);
  remember(app);
  return publicApp(app);
}

export function dispatchMock(id) {
  guard("desktop");
  const state = loadState();
  const app = find(id, state);
  if (!app || !app.allowed) {
    const err = new Error("Allow the app before Meldmind uses it.");
    err.status = 400;
    throw err;
  }
  const agent = agentId(app.id);
  state.using = { appId: app.id, name: app.name };
  app.lastActivity = "Mock step finished";
  saveState(state);
  emit("task.update", { task: { id: "desk", title: app.name, status: "running" } });
  emit("agent.start", { agent, provider: "desktop", model: app.model, label: app.name });
  emit("external.handoff", { agent, status: "working", name: app.name, cost: 0 });
  emit("ledger.entry", { provider: "desktop", model: app.model, cost: 0, note: "fixture" });
  emit("external.handoff", { agent, status: "done", name: app.name, cost: 0 });
  emit("agent.done", { agent, provider: "desktop", model: app.model, cost: 0 });
  const done = loadState();
  done.using = null;
  saveState(done);
  return { activity: app.lastActivity, cost: 0, agent };
}

// A writing step stays with a text model. An allowed app is used only when the step names it.
export function assignSteps(steps) {
  const state = loadState();
  return (steps || []).map((step) => {
    if (step?.capability === "writing") return { kind: "text", capability: "writing" };
    const app = step?.appId ? find(step.appId, state) : null;
    if (app?.allowed) return { kind: "app", appId: app.id, capability: app.capabilities[0] || "analysis", model: app.model };
    return { kind: "text", capability: step?.capability || "writing" };
  });
}

export function recordOutcome(id, { ok = true, capability = "analysis", runId = "desk" } = {}) {
  const app = find(id);
  if (!app) return null;
  return observe({ provider: "desktop", model: app.model, capability, runId, ok, cost: 0, ms: 1, score: ok ? 8 : 2 });
}

export function whoNames() {
  const apps = loadState().apps;
  const best = bestAtWhat({ mode: "balanced", top: 8 });
  const names = [];
  for (const cap of best.capabilities || []) {
    for (const row of cap.models || []) {
      const app = apps.find((item) => item.model === row.model);
      if (app && !names.includes(app.name)) names.push(app.name);
    }
  }
  return names;
}

// The existing MCP approval gate. callTool is the one client the server already has.
export async function runMcpStep({ server, tool, args = {}, callTool, confirm = false } = {}) {
  guard("desktop");
  if (typeof callTool !== "function") {
    const err = new Error("MCP tools stay on the one client.");
    err.status = 400;
    throw err;
  }
  const ask = needsApproval(server, tool);
  if (ask && !confirm) return { asked: true, ran: false };
  const result = await callTool(args);
  return { asked: ask, ran: true, result };
}

function loopbackPage(url) {
  let u;
  try { u = new URL(String(url || "")); } catch { return null; }
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") return null;
  return u;
}

export function parseFixturePage(html) {
  const fields = [];
  const buttons = [];
  const src = String(html || "");
  for (const tag of src.match(/<input\b[^>]*>/gi) || []) {
    const name = (tag.match(/\bname="([^"]+)"/i) || [])[1] || "";
    const type = ((tag.match(/\btype="([^"]+)"/i) || [])[1] || "text").toLowerCase();
    const label = (tag.match(/\baria-label="([^"]+)"/i) || [])[1] || name;
    fields.push({ ref: name || `f${fields.length + 1}`, label, password: type === "password" });
  }
  for (const tag of src.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || []) {
    const label = tag.replace(/<[^>]+>/g, "").trim();
    buttons.push({ ref: label.toLowerCase() || `b${buttons.length + 1}`, label, submit: /type="submit"/i.test(tag) || /send|submit/i.test(label) });
  }
  return { fields, buttons };
}

export async function runWebsite({ id, url, html, actions = [], confirm = false, stopped = false } = {}) {
  guard("desktop");
  const app = find(id);
  if (!app || !app.allowed || app.kind !== "website") {
    const err = new Error("Allow the website before Meldmind uses it.");
    err.status = 400;
    throw err;
  }
  const page = loopbackPage(url);
  if (!page) {
    const err = new Error("The fixture page has to be on this computer.");
    err.status = 400;
    throw err;
  }
  const parsed = parseFixturePage(html);
  const filled = {};
  const lines = [];
  for (const action of actions) {
    if (stopped) return { stopped: true, filled, lines };
    if (action.action === "type") {
      const field = parsed.fields.find((item) => item.ref === action.ref);
      if (!field) continue;
      if (field.password) {
        lines.push(`refused password field ${field.ref}`);
        continue;
      }
      filled[field.ref] = String(action.text || "");
      lines.push(`typed ${field.ref}`);
    }
    if (action.action === "submit") {
      if (!confirm) return { needsApproval: true, filled, lines, banner: `Meldmind is using ${app.name}` };
      lines.push("submitted");
    }
  }
  return { stopped: false, filled, lines, banner: null };
}

export function runSignedIn({ browserRunning = false, profilePath = "", fixtureRoot = "", origin = "" } = {}) {
  guard("desktop");
  if (browserRunning) {
    const err = new Error("Close Edge or Chrome, then try again.");
    err.status = 400;
    throw err;
  }
  const root = String(fixtureRoot || "");
  const file = String(profilePath || "");
  if (!root || !file.startsWith(root)) {
    const err = new Error("Only a fixture profile can be used here.");
    err.status = 400;
    throw err;
  }
  let host = "";
  try { host = new URL(origin).hostname; } catch { host = ""; }
  const relay = host === "chatgpt.com" || host === "claude.ai";
  return { touched: file, relay, read: false };
}

export function runDesktopTree({ id, tree = [], foregroundExe = "", actions = [], confirm = false } = {}) {
  guard("desktop");
  const app = find(id);
  if (!app || !app.allowed || app.kind !== "desktop") {
    const err = new Error("Allow the program before Meldmind uses it.");
    err.status = 400;
    throw err;
  }
  if (!app.exe || foregroundExe !== app.exe) return { did: false, reason: "The allowed program is not in front." };
  const lines = [];
  for (const action of actions) {
    const node = tree.find((item) => item.id === action.ref);
    if (!node) continue;
    if (node.password || node.type === "password") {
      lines.push(`refused password edit ${node.id}`);
      continue;
    }
    if (/^delete$/i.test(node.name || "") && !confirm) {
      return { needsApproval: true, lines, banner: `Meldmind is using ${app.name}` };
    }
    lines.push(`clicked ${node.name || node.id}`);
  }
  return { did: true, lines };
}

export function runScreenshot({ id, steps = [], capUsd = DEFAULT_CAP } = {}) {
  guard("desktop");
  const app = find(id);
  if (!app || !app.allowed || !app.screenshot) {
    const err = new Error("Turn on the screenshot fallback for this app first.");
    err.status = 400;
    throw err;
  }
  const cap = Math.min(5, Math.max(0.1, Number(capUsd) || DEFAULT_CAP));
  const sent = [];
  const clicks = [];
  let spent = 0;
  const seen = new Set();
  for (const step of steps) {
    const fresh = (step.images || []).filter((image) => image && !seen.has(image));
    const next = +(spent + fresh.length * IMAGE_USD).toFixed(2);
    if (next > cap) return { stopped: true, reason: "The spend cap stopped the job.", sent, clicks, spent };
    for (const image of fresh) seen.add(image);
    spent = next;
    sent.push(fresh);
    const target = String(step.target || "");
    if (/stripe|billing|checkout|payment/i.test(target)) {
      return { refused: true, reason: "Stripe, payment and billing stay out of this door.", sent, clicks, spent };
    }
    if (step.click) clicks.push(step.click);
  }
  return { stopped: false, sent, clicks, spent, cap };
}

export function stopUsing(id) {
  const state = loadState();
  if (!id || state.using?.appId === id) state.using = null;
  saveState(state);
  return publicState();
}
