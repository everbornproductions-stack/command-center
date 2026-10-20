// Whether the pretend demo AIs should be on screen and in the router.
// A saved real key, or a connected MCP server, hides them. A rejected key or a
// provider that could not be reached does not count: those checks are not a
// connected AI. Turning demo back on in Settings (demoKeep) keeps the pretend
// AIs in the lists. The router still will not send a real job to them while a
// real AI is connected.
import { PROVIDERS } from "./registry.js";
import { hasSecret } from "./vault.js";
import { getStatus } from "./health.js";
import { connectionOf } from "./connect.js";
import { doc } from "./store.js";

function rejected(status) {
  return status?.status === "red" && /rejected|\b401\b|not valid/i.test(String(status.detail || ""));
}

function unreachable(status) {
  if (status?.network === true) return true;
  return status?.status === "red" && /could not reach|connection refused|ECONNREFUSED|ENOTFOUND|network/i.test(String(status.detail || ""));
}

export function isDemoProvider(p) {
  return !!(p && (p.demo || String(p.id || "").startsWith("demo-")));
}

// True when this install has a real text AI the person can use. Nova, Atlas and
// Sage stand in for those. A media or tool key (Kling, Replicate, fal) does not
// replace them. Demo secrets never count.
export function realAiConnected() {
  return Object.values(PROVIDERS).some((p) => {
    if (!p || isDemoProvider(p) || p.kind !== "text") return false;
    let mcp = false;
    try { mcp = !!connectionOf(p.id)?.mcp?.configured; } catch { mcp = false; }
    if (mcp) return true;
    if (!hasSecret(p.id, p.keyEnv)) return false;
    const st = getStatus(p.id);
    if (rejected(st)) return false;
    if (unreachable(st) && !(st.lastOk > 0)) return false;
    return true;
  });
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
