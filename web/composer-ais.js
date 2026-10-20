// Who appears under the chat box. A provider is listed only when it is actually
// connected: a saved API key that the provider has not rejected, or an MCP server.
// Demo AIs fill that row only while nothing real is connected, then they leave it.

export function isDemoAi(p) {
  return !!(p && (p.demo === true || String(p.id || "").startsWith("demo-")));
}

export function keyRejected(p) {
  const detail = String(p?.status?.detail || "");
  return p?.status?.status === "red" && /rejected|\b401\b/i.test(detail);
}

function unreachable(p) {
  const st = p?.status;
  if (!st || st.lastOk > 0) return false;
  if (st.network === true) return true;
  return st.status === "red" && /could not reach|connection refused|ECONNREFUSED|ENOTFOUND|\bnetwork\b/i.test(String(st.detail || ""));
}

export function isConnectedAi(p) {
  if (!p || isDemoAi(p)) return false;
  const mcp = !!(p.connect?.mcp?.configured);
  const key = !!(p.keyed || p.connect?.key?.configured);
  if (mcp) return true;
  if (!key || keyRejected(p) || unreachable(p)) return false;
  return true;
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
