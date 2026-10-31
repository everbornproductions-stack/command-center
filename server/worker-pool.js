// 0.4.29: "Your AI helpers", the in-app AI worker pool (docs/flow/PLAN.md section 7).
// Meldmind keeps one list of the AI programs and accounts on this PC (Claude Code, Antigravity, Gemini CLI, Codex,
// OpenCode, Freebuff, Grok Bot, the browser helper, plus the API AIs that have a key), remembers which one is out of
// usage and until when, and hands each step to the best one that is free right now.
//
// The registry is plain JSON on the settings doc (settings.workerPool.workers[id]) with the same field shapes as the
// build-queue prototype (everborn-hq/tools/build-queue/workers.json): id, label, kind (cli / api / agent), free,
// enabled, cooldownHours, restingUntil, lastError, needs. The official apps that the subscription backup already
// knows (server/sub-routes.js) keep their one on / off switch there (doc "subroutes.settings", routes[id]), so the
// helper switch and the Settings switch are the same switch.
//
// This file is a leaf: it imports only the store and the limit reader, so the router, plan-first, Antigravity, the
// agents and smart fallback can all call it without an import loop. Detection of installed programs is handed in
// (detectAll() loads the existing detectors on demand). Nothing here runs a program, signs in or sends anything.
// Decision 16 (smart fallback) is unchanged: API AIs are benched by server/fallback.js; this file only mirrors that
// rest for the helper list, and only drops an API AI from a step when the person switched it off here.
import { doc, putDoc } from "./store.js";
import { cliLimit } from "./cli-limit.js";

export const SETTINGS_DOC = "settings";
export const POOL_KEY = "workerPool";
export const ROUTE_DOC = "subroutes.settings"; // the same doc as SETTINGS in server/sub-routes.js
export const HOUR = 60 * 60 * 1000;
export const KINDS = ["cli", "api", "agent"];
export const STATUS_WORD = { ready: "Ready", resting: "Resting", signin: "Needs sign-in", off: "Off", missing: "Not installed" };
export const LIGHT = { ready: "green", resting: "amber", signin: "amber", off: "grey", missing: "grey" };
export const SAVINGS_MODES = new Set(["savings", "economy"]);

// The helpers Meldmind knows by name. `route` links a helper to its official-app switch in sub-routes.js.
// `providers` are the router ids that mean this helper (plan-first rows are "plan-<route id>").
export const DEFAULT_WORKERS = [
  { id: "claude-code", label: "Claude Code", kind: "cli", free: false, cooldownHours: 5, route: "claude-code", providers: ["plan-claude-code"],
    good: "Careful code and long, detailed jobs", needs: "Install Claude Code and sign in once with your Claude plan." },
  { id: "antigravity", label: "Antigravity", kind: "cli", free: true, cooldownHours: 6, route: "antigravity", providers: ["antigravity", "agy"],
    good: "Building apps and code, free", needs: "Install Google Antigravity and sign in once." },
  { id: "gemini-cli", label: "Gemini CLI", kind: "cli", free: true, cooldownHours: 22, route: "gemini-cli", providers: ["plan-gemini-cli"],
    good: "Quick answers, research and summaries, free", needs: "Install Gemini CLI and sign in once with Google." },
  { id: "codex", label: "Codex", kind: "cli", free: true, cooldownHours: 6, route: "codex", providers: ["plan-codex"],
    good: "Code fixes and tests", needs: "Install Codex and sign in once with your ChatGPT account." },
  { id: "opencode", label: "OpenCode", kind: "cli", free: true, cooldownHours: 12, providers: ["opencode"],
    good: "Code with free models", needs: "Start OpenCode's server, then add it with Add custom provider (OpenCode)." },
  { id: "freebuff", label: "Freebuff", kind: "agent", free: true, cooldownHours: 3, providers: ["freebuff"],
    good: "Free coding help", needs: "Set it up once under Free coder (Freebuff)." },
  { id: "grokbot", label: "Grok Bot", kind: "agent", free: false, cooldownHours: 1, providers: ["grokbot", "grok-bot"],
    good: "Signed-in browsing, Gmail, Drive and Calendar", needs: "Add its webhook and sender key under Integrations." },
  { id: "browser-helper", label: "Browser helper", kind: "agent", free: true, cooldownHours: 1, providers: ["browser-helper", "browser"],
    good: "Reading web pages in its own window", needs: "Turn it on under Integrations, Browser helper." },
];
// API AIs that have a free allowance or run on this PC with no charge.
export const FREE_API = new Set(["google", "groq", "openrouter", "ollama", "lmstudio", "lm-studio"]);
const API_COOLDOWN_HOURS = 0.25;
const API_GOOD = {
  anthropic: "Writing, careful reasoning and code", openai: "Writing, code and analysis", xai: "Fast answers and current events",
  google: "Long documents and research, free allowance", groq: "Very fast short answers, free allowance", openrouter: "Many models through one key, free route",
  perplexity: "Web research with sources", mistral: "Writing and code", deepseek: "Code and math at a low price",
};

const byId = new Map(DEFAULT_WORKERS.map((w) => [w.id, w]));
const providerToWorker = new Map();
for (const w of DEFAULT_WORKERS) for (const p of w.providers) providerToWorker.set(p, w.id);

const clip = (s, n = 200) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
export const apiId = (pid) => `api:${pid}`;
export const isApiId = (id) => String(id || "").startsWith("api:");

// ---------- stored state ----------
function settingsDoc() {
  try { const d = doc(SETTINGS_DOC, () => ({})); return d && typeof d === "object" ? d : {}; } catch { return {}; }
}
/** The stored part of the registry: { workers: { id: { enabled?, restingUntil?, lastError?, cooldownHours? } } }. */
export function poolState() {
  const raw = settingsDoc()[POOL_KEY];
  const workers = raw && typeof raw === "object" && raw.workers && typeof raw.workers === "object" ? raw.workers : {};
  return { workers };
}
function saveEntry(id, patch) {
  const s = settingsDoc();
  const cur = poolState();
  const prev = cur.workers[id] && typeof cur.workers[id] === "object" ? cur.workers[id] : {};
  const next = { ...prev, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  putDoc(SETTINGS_DOC, { ...s, [POOL_KEY]: { ...cur, workers: { ...cur.workers, [id]: next } } });
  return next;
}
function routeDoc() {
  try { const d = doc(ROUTE_DOC, () => ({ routes: {}, website: false })); return d && typeof d === "object" ? d : { routes: {} }; } catch { return { routes: {} }; }
}

/** The fixed facts of one helper (built-in or an API AI), or null for an unknown id. */
export function workerSpec(id, providers = null) {
  if (byId.has(id)) return byId.get(id);
  if (isApiId(id)) {
    const pid = id.slice(4);
    if (!/^[a-z0-9][a-z0-9_.-]{0,60}$/i.test(pid)) return null;
    const p = providers?.[pid] || null;
    return { id, label: p?.name || pid, kind: "api", free: FREE_API.has(pid) || !!p?.noKey, cooldownHours: API_COOLDOWN_HOURS, providers: [pid], api: pid,
      good: API_GOOD[pid] || "Chat, writing and planning", needs: p?.noKey ? "Start it on this PC." : `Add a ${p?.name || pid} API key in Settings.` };
  }
  return null;
}

/** Which helper a router provider id means ("plan-claude-code" -> "claude-code", "anthropic" -> "api:anthropic"), or "". */
export function workerIdFor(provider) {
  const p = String(provider || "");
  if (!p || p === "meldmind" || p === "app") return "";
  if (providerToWorker.has(p)) return providerToWorker.get(p);
  if (p.startsWith("plan-") && byId.has(p.slice(5))) return p.slice(5);
  if (/^[a-z0-9][a-z0-9_.-]{0,60}$/i.test(p)) return apiId(p);
  return "";
}

// ---------- on / off ----------
export function isEnabled(id) {
  const spec = workerSpec(id);
  if (spec?.route) return routeDoc().routes?.[spec.route] !== false;
  return poolState().workers[id]?.enabled !== false;
}
export function setEnabled(id, on) {
  const spec = workerSpec(id);
  if (!spec) throw Object.assign(new Error("No helper with that name."), { status: 404, code: "unknown" });
  const val = on === true;
  if (spec.route) {
    const d = routeDoc();
    putDoc(ROUTE_DOC, { ...d, routes: { ...(d.routes || {}), [spec.route]: val } });
  } else saveEntry(id, { enabled: val });
  return isEnabled(id);
}

// ---------- rest after a limit ----------
export function cooldownMs(id) {
  const own = Number(poolState().workers[id]?.cooldownHours);
  const h = own > 0 ? own : Number(workerSpec(id)?.cooldownHours) || 3;
  return Math.round(h * HOUR);
}
/** When the helper is back (ms), or 0 when it is not resting. */
export function restingUntil(id, now = Date.now()) {
  const u = Number(poolState().workers[id]?.restingUntil) || 0;
  return u > now ? u : 0;
}
export const isResting = (id, now = Date.now()) => restingUntil(id, now) > 0;
/** The helper can take a step now: switched on and not resting. (Installed and signed in is the router's job.) */
export const workerUsable = (id, now = Date.now()) => !!id && isEnabled(id) && !isResting(id, now);

/**
 * Rest a helper: until the time it gave, else for its cooldown. Returns the time it is back.
 * Every limit or rest event in the app comes here (plan-first, Antigravity, Freebuff, smart fallback).
 */
export function noteRest(id, { until = null, error = "", now = Date.now() } = {}) {
  if (!id || !workerSpec(id)) return 0;
  const u = Number(until) || 0;
  const back = u > now ? u : now + cooldownMs(id);
  saveEntry(id, { restingUntil: back, lastError: clip(error) || undefined, restedAt: now });
  return back;
}
/** A limit message from a helper ("You've hit your session limit, resets 2:30pm"): rests it until that time. Null when it is not a limit. */
export function noteLimit(id, text, now = Date.now()) {
  const lim = cliLimit(String(text || ""), { now });
  if (!lim) return null;
  const back = noteRest(id, { until: lim.resetAt || null, error: text, now });
  return { until: back, words: lim.words || "" };
}
/** The helper answered (or its account works again): no longer resting. */
export function clearRest(id) {
  if (!id) return false;
  const cur = poolState().workers[id];
  if (!cur || (!cur.restingUntil && !cur.lastError)) return false;
  saveEntry(id, { restingUntil: undefined, lastError: undefined, restedAt: undefined });
  return true;
}
export const noteProviderRest = (provider, opts = {}) => noteRest(workerIdFor(provider), opts);
export const clearProviderRest = (provider) => clearRest(workerIdFor(provider));

// ---------- picking ----------
/**
 * Pick the helper for a step from listed rows ({ id, kind, free, status }): the first one that is ready (switched on,
 * installed, signed in and not resting), in the order given. On Max savings the free ones go first.
 * opts: { mode, kinds, exclude }
 */
export function pickWorker(rows, { mode = "balanced", kinds = null, exclude = [] } = {}) {
  const skip = new Set(exclude || []);
  let list = (rows || []).filter((w) => w && w.status === "ready" && !skip.has(w.id) && (!kinds || kinds.includes(w.kind)));
  if (SAVINGS_MODES.has(String(mode))) list = [...list.filter((w) => w.free), ...list.filter((w) => !w.free)];
  return list[0] || null;
}

/**
 * The router's ranked models, seen through the helper list (mission steps use this; see openRank in mission.js):
 *  - a helper the person switched off, or one resting after a limit, is left out;
 *  - on Max savings a free app on this PC goes before a paid-plan app, swapping only the places apps already hold,
 *    so the API order (decision 16) is untouched.
 * If that would leave nothing, the router's own list is used, so a run never stops here.
 */
export function poolRank(list, { mode = "balanced", now = Date.now() } = {}) {
  const src = Array.isArray(list) ? list : [];
  if (!src.length) return src;
  const kept = src.filter((m) => { const id = workerIdFor(m?.provider); return !id || !workerSpec(id) ? true : workerUsable(id, now); });
  const out = kept.length ? kept : src;
  if (!SAVINGS_MODES.has(String(mode))) return out;
  const slots = [], apps = [];
  out.forEach((m, i) => { const spec = workerSpec(workerIdFor(m?.provider)); if (spec && spec.kind !== "api") { slots.push(i); apps.push({ m, free: !!spec.free }); } });
  if (apps.length < 2) return out;
  const ordered = [...apps.filter((a) => a.free), ...apps.filter((a) => !a.free)];
  const res = [...out];
  slots.forEach((slot, k) => { res[slot] = ordered[k].m; });
  return res;
}

/** The helper for a mission step, for the Live view: { id, label } or null. */
export function helperFor(task, providers = null) {
  if (!task) return null;
  if (task.save || task.run || task.provider === "meldmind") return { id: "meldmind", label: "Meldmind" };
  if (task.app && task.appId) {
    const spec = workerSpec(task.appId);
    return { id: spec ? spec.id : String(task.appId), label: spec?.label || String(task.model || task.appId) };
  }
  if (task.media) return { id: `media:${task.media.provider || ""}`, label: String(task.media.providerName || task.media.provider || "Media maker") };
  const id = workerIdFor(task.provider);
  const spec = workerSpec(id, providers);
  if (!spec) return task.provider ? { id: String(task.provider), label: String(task.provider) } : null;
  const demo = spec.kind === "api" && !!providers?.[spec.api]?.demo; // a practice AI already says "(demo)"
  return { id: spec.id, label: spec.kind === "api" && !demo ? `${spec.label} (API)` : spec.label };
}

/** "Claude Code: out of usage" for one earlier try on a step. */
export function tryLine(n, attempt = {}, providers = null) {
  const h = helperFor({ provider: attempt.provider }, providers);
  const who = h?.label || attempt.provider || "An AI";
  const why = attempt.kind === "limit" ? "out of usage" : clip(attempt.reason || attempt.kind || "did not finish", 80);
  return `Try ${n} (${who}: ${why})`;
}

// ---------- the list with status ----------
const clock = (ms) => { try { return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

/** One helper row for the page. det: { installed, signedIn, needs } from detection. */
export function workerRow(spec, det = {}, now = Date.now()) {
  const stored = poolState().workers[spec.id] || {};
  const enabled = isEnabled(spec.id);
  const back = restingUntil(spec.id, now);
  let status;
  if (!enabled) status = "off";
  else if (det.installed === false) status = "missing";
  else if (det.signedIn === false) status = "signin";
  else if (back) status = "resting";
  else status = "ready";
  const backLabel = back ? clock(back) : "";
  const statusLabel = status === "resting" ? `Resting, back at ${backLabel}` : status === "off" && det.installed === false ? "Off, not installed" : STATUS_WORD[status];
  return {
    id: spec.id, label: spec.label, kind: spec.kind, free: !!spec.free, enabled,
    cooldownHours: Number(stored.cooldownHours) > 0 ? Number(stored.cooldownHours) : spec.cooldownHours,
    restingUntil: back || null, backLabel, lastError: stored.lastError || "",
    needs: status === "missing" || status === "signin" ? (det.needs || spec.needs || "") : "",
    good: spec.good || "", status, statusLabel, light: LIGHT[status],
  };
}

/**
 * The whole helper list. detected: { [id]: { installed, signedIn, needs } }; apiProviders: [{ id, name, keyed, noKey }].
 * Order: apps on this PC, then agents, then API AIs.
 */
export function listWorkers({ detected = {}, apiProviders = [], providers = null, now = Date.now() } = {}) {
  const rows = [];
  for (const kind of ["cli", "agent"]) for (const w of DEFAULT_WORKERS) if (w.kind === kind) rows.push(workerRow(w, detected[w.id] || {}, now));
  const pmap = providers || Object.fromEntries((apiProviders || []).map((p) => [p.id, p]));
  for (const p of apiProviders || []) {
    if (!p?.id || byId.has(p.id) || providerToWorker.has(p.id)) continue;
    const spec = workerSpec(apiId(p.id), pmap);
    if (!spec) continue;
    rows.push(workerRow(spec, { installed: true, signedIn: p.keyed !== false || !!p.noKey, needs: spec.needs }, now));
  }
  return rows;
}

// ---------- detection (the existing detectors, loaded on demand) ----------
/**
 * What is installed and signed in, from the detectors Meldmind already has. Each check is best effort: a failure
 * reads as "not installed". opts.detectors replaces any of them (tests use fakes; no real program is ever run here).
 */
export async function detectAll({ detectors = {}, refresh = false } = {}) {
  const out = {};
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
  const apps = await safe(async () => {
    if (detectors.apps) return detectors.apps();
    const SR = await import("./sub-routes.js");
    return SR.allStatus({ refresh });
  }, []);
  for (const row of apps || []) {
    if (!byId.has(row.id)) continue;
    out[row.id] = { installed: row.status !== "missing", signedIn: row.status === "ready" ? true : row.status === "signin" ? false : undefined };
  }
  out.opencode = await safe(async () => {
    if (detectors.opencode) return detectors.opencode();
    const [SR, REG] = await Promise.all([import("./sub-routes.js"), import("./registry.js")]);
    const added = !!REG.PROVIDERS.opencode;
    const bin = await SR.findBin({ bin: "opencode", envBin: "CC_OPENCODE_BIN" });
    if (!bin && !added) return { installed: false };
    return { installed: true, signedIn: added, needs: added ? "" : byId.get("opencode").needs };
  }, { installed: false });
  out.freebuff = await safe(async () => {
    if (detectors.freebuff) return detectors.freebuff();
    const FB = await import("./freebuff-agent.js");
    const v = FB.freebuff?.view?.() || {};
    if (!v.installed) return { installed: false };
    return { installed: true, signedIn: v.signedIn === true || FB.freebuffReady() };
  }, { installed: false });
  out.grokbot = await safe(async () => {
    if (detectors.grokbot) return detectors.grokbot();
    const GB = await import("./grokbot.js");
    const r = GB.readiness();
    return { installed: true, signedIn: !!r.ready, needs: r.ready ? "" : clip(r.detail) };
  }, { installed: false });
  out["browser-helper"] = await safe(async () => {
    if (detectors.browser) return detectors.browser();
    const BH = await import("./browser.js");
    const r = BH.readiness();
    return { installed: true, signedIn: !!r.ready, needs: r.ready ? "" : clip(r.detail) };
  }, { installed: false });
  return out;
}

/** API AIs worth listing: text providers with a key, or that run on this PC with no key. Never the practice AIs. */
export async function apiProviderList({ source = null } = {}) {
  if (source) return source();
  try {
    const [REG, V] = await Promise.all([import("./registry.js"), import("./vault.js")]);
    return Object.values(REG.PROVIDERS)
      .filter((p) => p.kind === "text" && !p.demo && !p.local && !String(p.id).startsWith("plan-"))
      .map((p) => ({ id: p.id, name: p.name, noKey: !!p.noKey, keyed: !!p.noKey || V.hasSecret(p.id, p.keyEnv) }))
      .filter((p) => p.keyed);
  } catch { return []; }
}

/** The page's list: GET /api/workers. */
export async function workersView({ detectors, apiSource, refresh = false, now = Date.now() } = {}) {
  const [detected, apiProviders] = await Promise.all([detectAll({ detectors, refresh }), apiProviderList({ source: apiSource })]);
  const workers = listWorkers({ detected, apiProviders, now });
  return {
    workers,
    title: "Your AI helpers",
    line: "Meldmind hands each step to the best helper that is free right now. A helper that runs out of usage rests until it is back, and the next one takes the step. Nothing is merged or applied without your OK.",
  };
}
