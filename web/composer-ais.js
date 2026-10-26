// Who appears under the chat box, and which providers may sit on the hub.
// A saved text key counts even when the probe could not reach the host.
// A rejected key does not. A local model and a text MCP server count.
// Demo AIs fill the row only while nothing real is connected, then they leave it.

export function isDemoAi(p) {
  return !!(p && (p.demo === true || String(p.id || "").startsWith("demo-")));
}

export function keyRejected(p) {
  const detail = String(p?.status?.detail || "");
  return p?.status?.status === "red" && /rejected|\b401\b/i.test(detail);
}

function textKind(p) {
  return !p?.kind || p.kind === "text";
}

// A text AI the person can use. Media and tool providers do not count here.
// A saved key still counts when the status says the host could not be reached.
export function countsAsRealAi(p) {
  if (!p || isDemoAi(p) || !textKind(p)) return false;
  if (p.connect?.mcp?.configured) return true;
  if (p.noKey && (p.custom || p.auth === "local")) return true;
  const key = !!(p.keyed || p.connect?.key?.configured);
  if (!key) return false;
  if (keyRejected(p) && !(p.status?.lastOk > 0)) return false;
  return true;
}

function mediaUnreachable(p) {
  const st = p?.status;
  if (!st || st.lastOk > 0) return false;
  if (st.network === true) return true;
  return st.status === "red" && /could not reach|connection refused|ECONNREFUSED|ENOTFOUND|\bnetwork\b/i.test(String(st.detail || ""));
}

export function isConnectedAi(p) {
  if (!p || isDemoAi(p)) return false;
  if (p.connect?.mcp?.configured) return true;
  if (textKind(p) && p.noKey && (p.custom || p.auth === "local")) return true;
  const key = !!(p.keyed || p.connect?.key?.configured);
  if (!key) return false;
  if (keyRejected(p) && !(p.status?.lastOk > 0)) return false;
  // A saved text key still counts when the probe cannot reach the host.
  // A media key does not, so a dead video host does not clear the text demos.
  if (!textKind(p) && mediaUnreachable(p)) return false;
  return true;
}

// Drop Nova, Atlas and Sage once a real AI is connected, unless Settings keeps demo on.
export function hideDemoBots(list, { demoKeep = false, realAi = false } = {}) {
  const providers = Array.isArray(list) ? list : [];
  if (demoKeep) return providers.slice();
  const real = !!realAi || providers.some(countsAsRealAi);
  if (!real) return providers.slice();
  return providers.filter((p) => !isDemoAi(p));
}

// One line at the top while demo AIs are kept on by choice next to a real AI.
export const DEMO_BANNER_TEXT = "You're in demo mode, using pretend AIs.";
export const DEMO_BANNER_ACTION = "Exit demo mode";
// On while demo mode is on and its pretend AIs are in the lists. The server answer wins.
export function demoBannerOn({ demoBanner, demo = false, demoKeep = false, realAi = false } = {}) {
  if (typeof demoBanner === "boolean") return demoBanner;
  return !!demo && (!realAi || !!demoKeep);
}

// Hub roster. Demo nodes stay only while no real AI is connected (or demoKeep is on).
export function graphNodes(providers, subscriptions = [], { demoKeep = false, realAi = false } = {}) {
  const list = hideDemoBots(providers, { demoKeep, realAi });
  const subs = Array.isArray(subscriptions) ? subscriptions : [];
  const textOn = list.filter((p) => p.kind === "text" && (p.keyed || p.noKey));
  const textGrey = list.filter((p) => p.kind === "text" && !isDemoAi(p) && !p.keyed && !p.noKey).slice(0, Math.max(0, 8 - textOn.length));
  const media = list.filter((p) => !isDemoAi(p) && p.kind !== "text" && p.kind !== "agent" && (p.keyed || subs.some((s) => s.provider === p.id && (s.credits != null || s.renews))));
  const agents = list.filter((p) => p.kind === "agent" && !isDemoAi(p));
  return [...textOn, ...textGrey, ...agents, ...media];
}

function chipOf(p) {
  const model = (p.models || []).find((m) => m.default) || (p.models || [])[0];
  const mcpOnly = !!(p.connect?.mcp?.configured) && !(p.keyed || p.connect?.key?.configured);
  return {
    id: p.id,
    name: p.name || p.id,
    model: model?.name || "",
    demo: isDemoAi(p),
    via: mcpOnly ? "mcp" : "key",
  };
}

// Real connections win. With none, the demo AIs are the whole list. With any, demo is omitted.
export function composerAis(providers) {
  const list = Array.isArray(providers) ? providers : [];
  const real = list.filter(isConnectedAi);
  const shown = real.length ? real : list.filter(isDemoAi);
  return shown.map(chipOf);
}

// ---- Bottom AI bar (0.4.21) ----
// Only AIs that are connected in some way get a tile: a saved key, a signed-in account, an MCP or
// local connection, or a tracked subscription. Demo AIs are already filtered by hideDemoBots, so
// they only show in demo mode. An agent counts when its own status is up.
export function isOnBar(p, subscriptions = []) {
  if (!p) return false;
  if (isDemoAi(p)) return true;
  if (isConnectedAi(p)) return true;
  if (p.access?.connected) return true;
  if (p.connect?.mcp?.configured) return true;
  if (p.kind === "agent") return p.status?.status === "green" || p.status?.status === "amber";
  const subs = Array.isArray(subscriptions) ? subscriptions : [];
  return subs.some((s) => s.provider === p.id && (s.credits != null || s.renews));
}

export function barProviders(providers, subscriptions = []) {
  const list = Array.isArray(providers) ? providers : [];
  return list.filter((p) => isOnBar(p, subscriptions));
}
