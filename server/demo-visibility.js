// Whether the pretend demo AIs should be on screen and in the router.
// They hide once any real AI connection exists: a saved key (even when the
// probe could not reach the host), a key in the Windows environment, a local
// model, OpenRouter, an AI CLI on this PC (agy, claude, codex, gemini, found on
// PATH or in its install folder), an official sign-in (manual handoff or
// Antigravity), a configured Grok Bot webhook, or a real app / MCP connection.
// A rejected key does not count. A media or tool key alone does not count.
// The demo tools server and demo catalog never count. Turning demo back on in
// Settings (demoKeep) keeps the pretend AIs in the lists. The router still
// will not send a real job to them while a real AI is connected.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROVIDERS } from "./registry.js";
import { hasSecret, getSecret } from "./vault.js";
import { getStatus } from "./health.js";
import { connectionOf } from "./connect.js";
import { doc, ctx } from "./store.js";

const CLI_BINS = ["agy", "claude", "codex", "gemini"];
const SIGNIN_DOC = "handoff.signin";
const AGY_DOC = "antigravity.state";
const GROK_BOT_VAULT = "agent-grokbot";
const MCP_DOC = "mcp.servers";
const APPS_DOC = "apps.connections";
const HOOKS_DOC = "byo.hooks";
const HIGHLEVEL_VAULT = "ghl-crm";

let cliCache = [];
const winEnvIds = new Set();

function rejected(status) {
  return status?.status === "red" && /rejected|\b401\b|not valid/i.test(String(status.detail || ""));
}

export function isDemoProvider(p) {
  return !!(p && (p.demo || String(p.id || "").startsWith("demo-")));
}

function isAiCli(name) {
  return CLI_BINS.includes(String(name || "").trim());
}

// Pure. `cli` is limited to the AI CLIs above. `handoff` is a real sign-in or
// webhook. `apps` is the number of real app and MCP connections.
// A saved text key counts even when the status says the host could not be reached.
// A rejected key counts only after it has succeeded once (lastOk).
export function connectedRealAi({ providers = [], cli = [], handoff = false, apps = 0 } = {}) {
  if ((Array.isArray(cli) ? cli : []).some(isAiCli)) return true;
  if (handoff) return true;
  if (Number(apps) > 0) return true;
  return (Array.isArray(providers) ? providers : []).some((p) => {
    if (!p || isDemoProvider(p) || p.kind !== "text") return false;
    if (p.noKey && (p.custom || p.auth === "local")) return true;
    if (p.mcp) return true;
    if (!p.keyed) return false;
    if (p.rejected && !(p.lastOk > 0)) return false;
    return true;
  });
}

export function setCliHits(names) {
  cliCache = [...new Set((names || []).map((n) => String(n).trim()).filter(isAiCli))];
  return cliNames();
}

export function cliNames() {
  return [...cliCache];
}

function injectedCli(connected) {
  return String(connected ?? process.env.CC_CLI_CONNECTED ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isAiCli);
}

function lookupBin(bin) {
  const cmd = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(cmd, [bin], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      resolve(!err && String(stdout || "").trim().length > 0);
    });
  });
}

// Where each CLI's own installer puts it when it is not on PATH. The desktop app
// often starts with a PATH that lacks these folders, so PATH alone missed agy.
export function cliInstallPaths(bin, { env = process.env, platform = process.platform, home } = {}) {
  const h = home || env.USERPROFILE || env.HOME || os.homedir() || "";
  const list = [];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || (h ? path.join(h, "AppData", "Local") : "");
    const roaming = env.APPDATA || (h ? path.join(h, "AppData", "Roaming") : "");
    if (bin === "agy" && local) list.push(...["agy.exe", "agy.cmd", "agy"].map((f) => path.join(local, "agy", "bin", f)));
    if (roaming) list.push(path.join(roaming, "npm", `${bin}.cmd`));
    if (h) list.push(path.join(h, ".local", "bin", `${bin}.exe`));
  } else if (h) {
    list.push(path.join(h, ".local", "bin", bin));
    if (bin === "claude") list.push(path.join(h, ".claude", "local", "claude"));
  }
  if (bin === "agy" && env.CC_AGY_BIN) list.unshift(env.CC_AGY_BIN);
  return list;
}

function installed(bin, exists) {
  return cliInstallPaths(bin).some((p) => { try { return !!p && exists(p); } catch { return false; } });
}

// PATH and install-folder scan for AI CLIs only. Nothing here reads a CLI token, cookie, or config.
export async function refreshCli({ scan, connected, exists = fs.existsSync } = {}) {
  const allowScan = scan === undefined ? process.env.CC_CLI_SCAN !== "0" : !!scan;
  const found = new Set(injectedCli(connected));
  if (allowScan) {
    for (const bin of CLI_BINS) {
      if (found.has(bin)) continue;
      if (installed(bin, exists) || await lookupBin(bin)) found.add(bin);
    }
  }
  cliCache = [...found];
  return cliNames();
}

export function setWindowsEnvKeys(ids) {
  winEnvIds.clear();
  for (const id of ids || []) if (id) winEnvIds.add(String(id));
  return [...winEnvIds];
}

function windowsEnvHas(id) {
  return winEnvIds.has(id);
}

// Presence only. The secret value is never printed and is not stored here.
export async function refreshWindowsEnv({ scan, providers } = {}) {
  const allow = scan === undefined ? process.env.CC_WIN_ENV_SCAN !== "0" : !!scan;
  winEnvIds.clear();
  if (!allow || process.platform !== "win32") return [];
  const list = (providers || Object.values(PROVIDERS)).filter((p) => p?.keyEnv && p.kind === "text" && !isDemoProvider(p) && /^\w+$/.test(p.keyEnv));
  if (!list.length) return [];
  const script = list.map((p) => {
    const n = p.keyEnv;
    return `$u=[Environment]::GetEnvironmentVariable('${n}','User'); if($u){"${n}=user"}; $m=[Environment]::GetEnvironmentVariable('${n}','Machine'); if($m){"${n}=machine"}`;
  }).join("; ");
  const out = await new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      resolve(err ? "" : String(stdout || ""));
    });
  });
  const found = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(user|machine)$/);
    if (!m) continue;
    const prov = list.find((p) => p.keyEnv === m[1]);
    if (prov && !winEnvIds.has(prov.id)) {
      winEnvIds.add(prov.id);
      found.push(prov.id);
    }
  }
  return found;
}

function safeHas(p) {
  try { return hasSecret(p.id, p.keyEnv); } catch { return false; }
}
function safeStatus(id) {
  try { return getStatus(id); } catch { return null; }
}
function safeMcp(id) {
  try { return !!connectionOf(id)?.mcp?.configured; } catch { return false; }
}

function handoffOn() {
  try {
    const connected = ctx().docs?.[SIGNIN_DOC]?.connected;
    if (connected && typeof connected === "object" && Object.values(connected).some((v) => v === true)) return true;
  } catch { /* no user context yet */ }
  try {
    if (doc(AGY_DOC, () => ({})).signedIn === true) return true;
  } catch { /* no user context yet */ }
  try {
    const s = getSecret(GROK_BOT_VAULT);
    if (s?.key && s?.url) return true;
  } catch { /* vault not ready */ }
  return false;
}

function listOf(name) {
  try {
    const list = doc(name, () => ({ list: [] }))?.list;
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// Real app and MCP connections: saved apps, MCP servers the person added (not
// the demo tools), custom webhook tools, and HighLevel. Values are never read.
export function appConnectionCount() {
  let n = 0;
  n += listOf(APPS_DOC).filter((r) => r && !r.demo).length;
  n += listOf(MCP_DOC).filter((s) => s && !s.demo && !String(s.id || "").startsWith("demo-")).length;
  n += listOf(HOOKS_DOC).filter((h) => h && !h.demo).length;
  try { const s = getSecret(HIGHLEVEL_VAULT); if (s?.key && s?.locationId) n += 1; } catch { /* vault not ready */ }
  return n;
}

function providerFacts() {
  return Object.values(PROVIDERS).map((p) => {
    const st = safeStatus(p.id);
    return {
      id: p.id,
      kind: p.kind,
      demo: !!p.demo,
      custom: !!p.custom,
      noKey: !!p.noKey,
      auth: p.auth || "",
      mcp: safeMcp(p.id),
      keyed: !!(safeHas(p) || windowsEnvHas(p.id)),
      rejected: rejected(st),
      lastOk: st?.lastOk || 0,
    };
  });
}

// True when this install has a real text AI the person can use. Nova, Atlas and
// Sage stand in for those. A media or tool key (Kling, Replicate, fal) does not
// replace them. Demo secrets never count. A saved key still counts when the
// health probe could not reach the host.
export function realAiConnected() {
  return connectedRealAi({ providers: providerFacts(), cli: cliNames(), handoff: handoffOn(), apps: appConnectionCount() });
}

export function demoKeepOn() {
  try { return !!doc("settings", () => ({})).demoKeep; } catch { return false; }
}

// Lists and pickers omit the pretend AIs. demoKeep is the Settings override.
export function demosHidden() {
  return realAiConnected() && !demoKeepOn();
}

// The banner at the top of every screen: demo mode is on and the pretend AIs are in use.
// active is demoActive() from server/mock.js. Off means no banner at all.
export function demoBanner(active = false) {
  return !!active && !demosHidden();
}

// Demo tools, demo catalog listings and other demo rows leave lists the same way.
export function visibleRows(list, { hidden = demosHidden() } = {}) {
  const rows = Array.isArray(list) ? list : [];
  if (!hidden) return rows.slice();
  return rows.filter((r) => !(r && (r.demo === true || r.seller?.demo === true || String(r.id || "").startsWith("demo-"))));
}

// A real job never calls Nova, Atlas, Sage, or the demo image model while a real
// AI is connected. Turning demo back on only puts them back in the lists.
export function realJobSkipsDemo(provider) {
  if (!realAiConnected()) return false;
  const id = typeof provider === "string" ? provider : provider?.id;
  const p = (id && PROVIDERS[id]) || (provider && typeof provider === "object" ? provider : null);
  return isDemoProvider(p || { id: id || "" });
}

// Saved custom agents pinned to a demo model stay in the document. Lists omit
// them while demos are hidden, and tag them demo so the record can come back.
export function visibleCustomAgents(list, { hidden = false } = {}) {
  const rows = (Array.isArray(list) ? list : []).map((a) => {
    if (!a) return a;
    const demo = !!(a.demo || String(a.provider || "").startsWith("demo-"));
    return demo ? { ...a, demo: true } : a;
  });
  if (!hidden) return rows;
  return rows.filter((a) => a && !a.demo);
}
