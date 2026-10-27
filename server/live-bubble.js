// Live view extras (0.4.19 slice A4), all behind flag_livebubble:
//   1. the Free AI bubble: which free tiers answer right now, checked on a timer
//   2. credit badges on the AI bubbles: "Out of credits" and "via MCP" (reuses the credit backup state)
//   3. Clear idle projects: hide idle projects until they have new activity
// Nothing here runs unless the flag is on. The health check rides the shared scheduler (no own
// setInterval), starts only while someone is watching the Live view, and stops by itself afterwards.
import { PROVIDERS, geminiBase } from "./registry.js";
import { getSecret } from "./vault.js";
import { doc, putDoc, ctx, runAs } from "./store.js";
import { freeTierView, trouble } from "./fallback.js";
import { describePause } from "./pause.js";
import { mcpConfigured, connectionOf } from "./connect.js";
import { localFetch } from "./loopback-fetch.js";
import { scheduler as sharedScheduler } from "./perf/scheduler.js";

import { liveBubbleOn, DEFAULT_ON } from "./live-flag.js";
export { liveBubbleOn, DEFAULT_ON };

export const CHECK = { everyMs: 20000, timeoutMs: 2500, retries: 1, cacheMs: 60000, watchMs: 120000 };
export const FREE_EMPTY = "No free AI is answering right now.";
export const FREE_NOTE = "Free AIs take small jobs when your paid credits run out.";

// ---------- one probe ----------
// A cheap list-models call with a hard timeout. Never sends a prompt, never prints the key.
export async function defaultProbe(pid, { timeoutMs = CHECK.timeoutMs, secret = null } = {}) {
  const p = PROVIDERS[pid];
  let sec = secret;
  if (!sec && p) { try { sec = getSecret(p.id, p.keyEnv); } catch { sec = null; } }
  if (!p || !sec) return { ok: false, detail: "no key" };
  const url = p.id === "google" || p.api === "gemini" ? `${geminiBase(p)}/models?pageSize=1` : `${p.baseUrl}/models`;
  const headers = p.id === "google" || p.api === "gemini"
    ? { "x-goog-api-key": sec.key }
    : { ...(sec.headers || {}), ...(sec.key && sec.key !== "no-key" ? { authorization: `Bearer ${sec.key}` } : {}) };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await localFetch(url, { headers, signal: ctl.signal });
    try { await r.arrayBuffer(); } catch { /* body not needed */ }
    return r.ok ? { ok: true, detail: "ok" } : { ok: false, detail: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, detail: e?.name === "AbortError" ? "timed out" : "unreachable" };
  } finally { clearTimeout(timer); }
}

// One check with one retry. A timeout counts as a miss, so the second try is the last word.
export async function checkOne(pid, { probe = defaultProbe, timeoutMs = CHECK.timeoutMs, retries = CHECK.retries } = {}) {
  let last = { ok: false, detail: "not checked" };
  for (let i = 0; i <= retries; i++) {
    const t0 = Date.now();
    try { last = await probe(pid, { timeoutMs }); } catch (e) { last = { ok: false, detail: "unreachable" }; }
    if (last.ok) return { ok: true, detail: last.detail || "ok", latencyMs: Date.now() - t0 };
  }
  return { ok: false, detail: last.detail || "unreachable", latencyMs: null };
}

// ---------- the checker: cache, refresh, timer ----------
export function createFreeChecker({ probe = defaultProbe, now = Date.now, sched = sharedScheduler, members = defaultMembers, cfg = CHECK } = {}) {
  const cache = new Map(); // pid -> { ok, detail, latencyMs, checkedAt }
  const stops = new Map(); // key -> unregister
  let watchedAt = 0;
  let inflight = null;

  async function refresh({ force = false } = {}) {
    const list = members();
    const t = now();
    const due = list.filter((m) => !m.paused).filter((m) => force || !cache.get(m.id) || t - cache.get(m.id).checkedAt >= cfg.cacheMs - 1);
    if (inflight && !force) return inflight;
    const run = (async () => {
      await Promise.all(due.map(async (m) => {
        const r = await checkOne(m.id, { probe, timeoutMs: cfg.timeoutMs, retries: cfg.retries });
        cache.set(m.id, { ...r, checkedAt: now() });
      }));
    })();
    inflight = run.finally(() => { inflight = null; });
    return inflight;
  }

  function snapshot() {
    const list = members();
    const rows = list.map((m) => {
      const c = cache.get(m.id);
      // a models-list answer does not mean there is money behind the key: an out-of-credits AI is never "working"
      if (m.paused) return { id: m.id, name: m.name, ok: false, checked: true, paused: true, detail: [m.paused.label, m.paused.nextCheckText].filter(Boolean).join(". "), checkedAt: now() };
      return { id: m.id, name: m.name, ok: !!(c && c.ok), checked: !!c, detail: c ? c.detail : "not checked yet", checkedAt: c ? c.checkedAt : 0 };
    });
    return freeBubble(rows);
  }

  // Called when the Live view is read. Keeps the timer alive while someone watches.
  function watch(key = "local", run = (fn) => fn()) {
    watchedAt = now();
    if (stops.has(key)) return;
    const unregister = sched.register({
      id: `livefree:${key}`, everyMs: cfg.everyMs, firstMs: 0, pause: "idle",
      run: () => {
        if (now() - watchedAt > cfg.watchMs) { stop(key); return; }
        return run(() => refresh({ force: false }));
      },
    });
    stops.set(key, unregister);
  }
  function stop(key) { const f = stops.get(key); if (f) { stops.delete(key); try { f(); } catch { /* already gone */ } } }
  function stopAll() { for (const k of [...stops.keys()]) stop(k); }
  return { refresh, snapshot, watch, stop, stopAll, cache, isWatching: (k = "local") => stops.has(k) };
}

// Free tiers the person turned on, keyed, and not currently skipped for trouble.
export function defaultMembers() {
  const out = [];
  for (const t of freeTierView()) {
    if (!t.on || !t.keyed) continue;
    let paused = null;
    try { paused = describePause(t.provider) || (trouble(t.provider)?.kind === "credits" ? { label: "Out of credits", nextCheckText: "" } : null); } catch { paused = null; }
    if (!paused && trouble(t.provider)) continue;
    out.push({ id: t.provider, name: t.providerName, ...(paused ? { paused } : {}) });
  }
  return out;
}

// Pure shape for the bubble. `rows` are { id, name, ok, checked, detail }.
export function freeBubble(rows = []) {
  const working = rows.filter((r) => r.ok);
  const unchecked = rows.some((r) => !r.checked);
  const state = working.length ? "ok" : unchecked && rows.length ? "checking" : "empty";
  return {
    id: "free-ai", name: "Free AI", state, count: working.length, members: rows,
    label: state === "ok" ? `${working.length} working` : state === "checking" ? "Checking" : "None working",
    empty: state === "empty" ? FREE_EMPTY : "", note: FREE_NOTE, refresh: true,
  };
}

// ---------- credit badges ----------
// Out of credits comes from the same trouble table the fallback chain writes (or a health light that says so).
// "via MCP" shows when credits are out and an MCP server stands in for that AI's API key.
export function creditStates(ids, health = {}) {
  const out = {};
  for (const id of ids || []) {
    if (!id || id === "hub") continue;
    let outOfCredits = false;
    try { outOfCredits = trouble(id)?.kind === "credits" || describePause(id)?.kind === "credits"; } catch { outOfCredits = false; }
    if (!outOfCredits && /out of credits|no credits|spending limit/i.test(String(health[id]?.detail || ""))) outOfCredits = true;
    let viaMcp = false;
    try { viaMcp = outOfCredits && mcpConfigured(id) && !!connectionOf(id)?.mcp?.configured; } catch { viaMcp = false; }
    if (outOfCredits || viaMcp) out[id] = { outOfCredits, viaMcp };
  }
  return out;
}
export function badgeText(s) {
  if (!s) return "";
  if (s.viaMcp) return "via MCP";
  if (s.outOfCredits) return "Out of credits";
  return "";
}

// ---------- clear idle projects ----------
const CLEARED = "liveview.cleared";
export const clearedMap = () => doc(CLEARED, () => ({})) || {};
export function lastActive(project) {
  let t = 0;
  for (const r of project.runs || []) t = Math.max(t, r.finishedAt || 0, r.startedAt || 0);
  return t;
}
// Hide every idle project now. Returns how many were hidden.
export function clearIdle(view, now = Date.now()) {
  const map = { ...clearedMap() };
  let n = 0;
  for (const p of view.projects || []) { if (!p.working) { map[p.id] = now; n++; } }
  putDoc(CLEARED, map);
  return n;
}
export function unclearAll() { putDoc(CLEARED, {}); }
// Pure: split projects into shown and hidden. A cleared project comes back the moment it works
// or has a run newer than the time it was cleared.
export function applyCleared(projects, cleared = {}) {
  const shown = [], hidden = [];
  for (const p of projects || []) {
    const at = cleared[p.id];
    if (at && !p.working && lastActive(p) <= at) hidden.push(p); else shown.push(p);
  }
  return { shown, hidden };
}

export function currentUserKey() { return ctx()?.userId || "local"; }
export { runAs };
