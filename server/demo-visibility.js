// Whether the pretend demo AIs should be on screen and in the router.
// They hide once any real text AI is connected: a saved key (even when the
// probe could not reach the host), a local model, OpenRouter, the agy CLI,
// an official sign-in, or a configured Grok Bot webhook. A rejected key does
// not count. A media or tool key does not count. Turning demo back on in
// Settings (demoKeep) keeps the pretend AIs in the lists. The router still
// will not send a real job to them while a real AI is connected.
import { execFile } from "node:child_process";
import { PROVIDERS } from "./registry.js";
import { hasSecret, getSecret } from "./vault.js";
import { getStatus } from "./health.js";
import { connectionOf } from "./connect.js";
import { doc, ctx } from "./store.js";

const CLI_BINS = ["agy"];
const SIGNIN_DOC = "handoff.signin";
const GROK_BOT_VAULT = "agent-grokbot";

let cliCache = [];
const winEnvIds = new Set();

function rejected(status) {
  return status?.status === "red" && /rejected|\b401\b|not valid/i.test(String(status.detail || ""));
}

export function isDemoProvider(p) {
  return !!(p && (p.demo || String(p.id || "").startsWith("demo-")));
}

function isAgy(name) {
  return CLI_BINS.includes(String(name || "").trim());
}

// Pure. `cli` is already limited to agy. `handoff` is a real sign-in or webhook.
// A saved text key counts even when the status says the host could not be reached.
// A rejected key counts only after it has succeeded once (lastOk).
export function connectedRealAi({ providers = [], cli = [], handoff = false } = {}) {
  if ((Array.isArray(cli) ? cli : []).some(isAgy)) return true;
  if (handoff) return true;
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
  cliCache = [...new Set((names || []).map((n) => String(n).trim()).filter(isAgy))];
  return cliNames();
}

export function cliNames() {
  return [...cliCache];
}

function injectedCli(connected) {
  return String(connected ?? process.env.CC_CLI_CONNECTED ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isAgy);
}

function lookupBin(bin) {
  const cmd = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(cmd, [bin], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      resolve(!err && String(stdout || "").trim().length > 0);
    });
  });
}

// PATH scan is agy only. Nothing here reads a CLI token, cookie, or config.
export async function refreshCli({ scan, connected } = {}) {
  const allowScan = scan === undefined ? process.env.CC_CLI_SCAN !== "0" : !!scan;
  const found = new Set(injectedCli(connected));
  if (allowScan) {
    for (const bin of CLI_BINS) {
      if (found.has(bin)) continue;
      if (await lookupBin(bin)) found.add(bin);
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
    const s = getSecret(GROK_BOT_VAULT);
    if (s?.key && s?.url) return true;
  } catch { /* vault not ready */ }
  return false;
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
  return connectedRealAi({ providers: providerFacts(), cli: cliNames(), handoff: handoffOn() });
}

export function demoKeepOn() {
  try { return !!doc("settings", () => ({})).demoKeep; } catch { return false; }
}

// Lists and pickers omit the pretend AIs. demoKeep is the Settings override.
export function demosHidden() {
  return realAiConnected() && !demoKeepOn();
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
