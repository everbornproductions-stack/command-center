// Graduate notice. A handoff-only actor (Grok Bot on its webhook, or a provider whose
// auth is handoff, such as Suno) can later gain its own API or MCP route. The app
// then asks once: add it to councils and missions? One click approves. Not now
// dismisses. The webhook stays the handoff (decision 15). An xAI key is Grok the
// model, not a direct route for Grok Bot (decision 21). This module never calls a
// webhook and never logs a key.
import { PROVIDERS } from "./registry.js";
import { hasSecret } from "./vault.js";
import { listServers } from "./mcp.js";
import { mcpConfigured } from "./connect.js";
import { readiness, saveConfig, NAME, AGENT_ID } from "./grokbot.js";
import { doc, putDoc } from "./store.js";

export const DOC = "graduate.state";
const COUNCIL = new Set(["anthropic", "openai", "xai", "google"]);
const GROK_MCP = /grok\s*bot/i;

export const noticeText = (name) => `${name} can now run directly. Add it to councils and missions?`;

const blank = () => ({ seen: {}, pending: {}, approved: {}, dismissed: {}, routes: {} });

export function grokBotMcp(servers) {
  return (servers || []).some((s) => GROK_MCP.test(String(s?.name || "")));
}

// Pure. `actors` are { id, name, handoff, direct }. First sight of handoff-only
// is a baseline. A later move to both (or handoff replaced by direct) asks.
// Already both on first sight asks. Direct-only, with no handoff behind it, does not.
export function stepGraduate(state, actors, now = Date.now()) {
  const next = {
    seen: { ...(state?.seen || {}) },
    pending: { ...(state?.pending || {}) },
    approved: { ...(state?.approved || {}) },
    dismissed: { ...(state?.dismissed || {}) },
    routes: { ...(state?.routes || {}) },
  };
  for (const a of actors || []) {
    if (!a?.id) continue;
    const handoff = !!a.handoff;
    const direct = !!a.direct;
    const mode = handoff && direct ? "both" : handoff ? "handoff" : direct ? "direct" : "none";
    const prev = Object.prototype.hasOwnProperty.call(next.seen, a.id) ? next.seen[a.id] : undefined;
    next.seen[a.id] = mode;
    if (next.approved[a.id] || next.dismissed[a.id]) {
      delete next.pending[a.id];
      continue;
    }
    const firstBoth = prev === undefined && mode === "both";
    const gainedBoth = (prev === "handoff" || prev === "none") && mode === "both";
    const replaced = prev === "handoff" && mode === "direct";
    const still = !!next.pending[a.id] && (mode === "both" || mode === "direct");
    if (firstBoth || gainedBoth || replaced || still) {
      const kept = next.pending[a.id];
      next.pending[a.id] = { id: a.id, name: a.name, text: noticeText(a.name), at: kept?.at || now };
    } else {
      delete next.pending[a.id];
    }
  }
  return next;
}

export function isRouteActor(id) {
  if (!id || COUNCIL.has(id)) return false;
  if (id === AGENT_ID) return true;
  return PROVIDERS[id]?.auth === "handoff";
}

function load() {
  const d = doc(DOC, blank);
  return { ...blank(), ...(d && typeof d === "object" ? d : {}) };
}
function save(state) {
  putDoc(DOC, state);
  return state;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function publicGraduate(state) {
  const notices = Object.values(state?.pending || {}).map((n) => ({ id: n.id, name: n.name, text: n.text }));
  return { notices };
}

function actorsOf(state) {
  const route = state.routes?.grokbot || {};
  let mcp = false;
  try { mcp = grokBotMcp(listServers()); } catch { mcp = false; }
  const grokDirect = !!(hasSecret("grokbot-direct") || route.api || route.mcp || mcp);
  const via = readiness().via;
  const list = [{ id: AGENT_ID, name: NAME, handoff: via === "webhook" || via === "mock", direct: grokDirect }];
  for (const p of Object.values(PROVIDERS)) {
    if (p.auth !== "handoff") continue;
    const r = state.routes?.[p.id] || {};
    let linked = false;
    try { linked = mcpConfigured(p.id); } catch { linked = false; }
    const direct = !!(hasSecret(p.id) || linked || r.api || r.mcp);
    list.push({ id: p.id, name: p.name, handoff: true, direct });
  }
  return list;
}

export function recompute() {
  const prev = load();
  const next = stepGraduate(prev, actorsOf(prev));
  if (!same(prev, next)) save(next);
  return publicGraduate(next);
}

export function setRoute(id, via) {
  if (!isRouteActor(id)) {
    const err = new Error("That AI is not a handoff. Claude, ChatGPT, Grok and Gemini need their own API key.");
    err.status = 400;
    throw err;
  }
  if (via !== "api" && via !== "mcp") {
    const err = new Error("Choose api or mcp.");
    err.status = 400;
    throw err;
  }
  const prev = load();
  const routes = { ...(prev.routes || {}) };
  routes[id] = { ...(routes[id] || {}), [via]: true };
  const next = stepGraduate({ ...prev, routes }, actorsOf({ ...prev, routes }));
  save(next);
  return publicGraduate(next);
}

export async function approve(id) {
  if (!isRouteActor(id)) {
    const err = new Error("That AI is not a handoff.");
    err.status = 400;
    throw err;
  }
  if (id === AGENT_ID) await saveConfig({ auto: true });
  const prev = load();
  const pending = { ...(prev.pending || {}) };
  delete pending[id];
  const next = {
    ...prev,
    pending,
    approved: { ...(prev.approved || {}), [id]: { at: Date.now(), directOk: true, include: true } },
  };
  save(next);
  return { ...publicGraduate(next), approved: true };
}

export function dismiss(id) {
  if (!isRouteActor(id)) {
    const err = new Error("That AI is not a handoff.");
    err.status = 400;
    throw err;
  }
  const prev = load();
  const pending = { ...(prev.pending || {}) };
  delete pending[id];
  const next = {
    ...prev,
    pending,
    dismissed: { ...(prev.dismissed || {}), [id]: { at: Date.now() } },
  };
  save(next);
  return publicGraduate(next);
}
