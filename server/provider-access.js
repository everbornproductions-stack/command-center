// How each provider really connects, and the words the strip and the provider list use.
// auth is one of: key, oauth, mcp, handoff, local.
import { PROVIDERS } from "./registry.js";
import { hasSecret } from "./vault.js";
import { connectionOf } from "./connect.js";
import { describePause, creditLine, CHECK_AGAIN_TITLE } from "./pause.js";
import { troubleFor, busyLine } from "./fallback.js";

export const AUTH_TYPES = ["key", "oauth", "mcp", "handoff", "local"];

export function authOf(p) {
  if (!p) return null;
  if (AUTH_TYPES.includes(p.auth)) return p.auth;
  if (p.noKey) return "local";
  if (p.api || p.keyEnv) return "key";
  return null;
}

function linkedMcp(p, conn) {
  if (!conn?.mcp) return false;
  if (p?.mcpOauth || p?.auth === "oauth") return !!conn.mcp.signedIn;
  return !!conn.mcp.configured;
}

export function unconnectedMcp(id) {
  const p = PROVIDERS[id];
  if (!p || (p.auth !== "mcp" && p.auth !== "oauth")) return false;
  try { return !linkedMcp(p, connectionOf(id)); } catch { return true; }
}

// One label for the strip and the provider list. Null means the caller shows spend or the health detail.
export function accessFor(p) {
  if (!p) return null;
  const auth = authOf(p);
  const keyed = !!(p.keyEnv || p.api || p.custom) && hasSecret(p.id, p.keyEnv);
  let conn = null;
  try { conn = connectionOf(p.id); } catch { conn = null; }
  const mcpLinked = linkedMcp(p, conn) || !!(conn?.both && conn.mcp?.configured);
  const paused = describePause(p.id);
  let label = null;
  let connect = false;
  let connected = false;
  if (paused) {
    label = paused.label;
    connected = true;
  } else if (auth === "handoff") {
    label = "Handoff";
    connected = true;
  } else if (auth === "local") {
    label = "Local app";
    connected = true;
  } else if (auth === "mcp" || auth === "oauth") {
    connected = mcpLinked;
    label = connected ? "Connected" : "Not connected";
    connect = !connected;
  } else if (auth === "key") {
    if (!keyed && (conn?.mcp?.configured || conn?.mcp?.signedIn)) {
      label = "Connected";
      connected = true;
    } else if (!keyed) {
      label = "No key";
      connected = false;
    } else {
      label = null;
      connected = true;
    }
  }
  // 0.4.21 Gemini check: the cooldown the trouble table holds, with the model name and its end time
  // ("Gemini 3.8 Flash: busy until 8:42 PM"). Null when this AI can take work.
  let busy = null;
  try { busy = busyLine(troubleFor(p.id)); } catch { busy = null; }
  return {
    auth,
    label,
    connect,
    connected,
    busy,
    paused: !!paused,
    pause: paused ? { label: paused.label, kind: paused.kind, nextCheckAt: paused.nextCheckAt, nextCheckText: paused.nextCheckText, checkAgainTitle: CHECK_AGAIN_TITLE } : null,
    credits: p.kind === "text" && keyed ? creditLine(p.id) : null,
    billing: paused?.billing || p.links?.billing || null,
    note: p.authNote || null,
    mcpUrl: p.mcpUrl || null,
  };
}
