// "Use my plan first": the official apps on this PC (Claude Code, Codex, Gemini CLI), signed in with the
// person's own subscription, become choices in the router. While the switch is on and an app is ready,
// they rank before any model that charges per call (see applyPlanFirst in server/plans.js).
// An app that says it is out of quota sits out for an hour, and the next best choice takes the job.
// A meter counts the answers each app gave today. Nothing here signs in or reads a sign-in file.
import { doc, putDoc } from "./store.js";
import { PROVIDERS } from "./registry.js";
import { registerLocalRoute } from "./local-routes.js";
import { addRouteSource } from "./route-extras.js";
import { readPlanFirst } from "./plans.js";
import { ROUTES, routeOn, routeById, cachedStatus, allStatus, askApp } from "./sub-routes.js";
import { LIMIT_REST_MS } from "./cli-limit.js";
import { noteRest as poolRest, clearRest as poolClear, workerUsable } from "./worker-pool.js";

export const METER_DOC = "plan.meter";
// 0.4.28 (dogfood loan-calc): an app out of its plan rests until the reset time it gave, else a few hours
export const OUT_MS = LIMIT_REST_MS;
export const planId = (routeId) => `plan-${routeId}`;
const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function meter(now = Date.now()) {
  let d = null;
  try { d = doc(METER_DOC, () => ({ day: day(now), counts: {}, outAt: {}, outUntil: {} })); } catch { d = null; }
  const m = d && typeof d === "object" ? d : { day: day(now), counts: {}, outAt: {}, outUntil: {} };
  if (m.day !== day(now)) return { day: day(now), counts: {}, outAt: m.outAt || {}, outUntil: m.outUntil || {} };
  return { day: m.day, counts: m.counts || {}, outAt: m.outAt || {}, outUntil: m.outUntil || {} };
}

export function noteAnswer(routeId, now = Date.now()) {
  const m = meter(now);
  m.counts[routeId] = (m.counts[routeId] || 0) + 1;
  delete m.outAt[routeId];
  delete m.outUntil[routeId];
  putDoc(METER_DOC, m);
  try { poolClear(routeId); } catch { /* the helper list is best effort */ }
}

// until: when the app said its limit ends (its own reset time); else it rests OUT_MS (a few hours)
export function noteOutOfQuota(routeId, now = Date.now(), until = null) {
  const m = meter(now);
  m.outAt[routeId] = now;
  const u = Number(until) || 0;
  m.outUntil[routeId] = u > now ? u : now + OUT_MS;
  putDoc(METER_DOC, m);
  // 0.4.29: the helper list (server/worker-pool.js) rests it until the same time
  try { poolRest(routeId, { until: m.outUntil[routeId], error: "out of usage", now }); } catch { /* best effort */ }
}

// When the app comes back (ms), or 0 when it is not resting.
export function restingUntil(routeId, now = Date.now()) {
  const m = meter(now);
  const u = Number(m.outUntil[routeId]) || 0;
  if (u) return u > now ? u : 0;
  const at = Number(m.outAt[routeId]) || 0; // an entry from before 0.4.28
  return at > 0 && now - at < OUT_MS ? at + OUT_MS : 0;
}
export const outOfQuota = (routeId, now = Date.now()) => restingUntil(routeId, now) > 0;

let refreshing = false;
function refreshSoon() {
  if (refreshing) return;
  refreshing = true;
  allStatus({ refresh: true }).catch(() => {}).finally(() => { refreshing = false; });
}

// Ready apps, from the last check. The router cannot wait for a check, so a missing or old one starts a new one.
export function readyPlanRoutes(now = Date.now()) {
  const known = cachedStatus();
  if (!known || now - known.at > 60000) refreshSoon();
  if (!known) return [];
  return ROUTES.filter((r) => !r.agy && routeOn(r.id) && known.rows.some((x) => x.id === r.id && x.status === "ready"));
}

function capsOf(route) {
  const p = PROVIDERS[route.providers[0]];
  const m = p?.models?.find((x) => x.default) || p?.models?.[0];
  return m?.caps || { reasoning: 75, code: 75, writing: 75, research: 70, creative: 72, analysis: 75, math: 72, fast: 70 };
}

export function planRouteModels() {
  if (!readPlanFirst()) return [];
  const out = [];
  for (const r of readyPlanRoutes()) {
    if (outOfQuota(r.id)) continue;
    if (!workerUsable(r.id)) continue; // 0.4.29: switched off or resting in Your AI helpers
    const caps = capsOf(r);
    out.push({
      provider: planId(r.id), providerName: `${r.name} (your plan)`, color: PROVIDERS[r.providers[0]]?.color || null,
      model: planId(r.id), name: `${r.ai} through ${r.name}`, tier: "plan", in: 0, out: 0, caps, baseCaps: caps,
      available: true, keyed: true, status: "green", statusDetail: "Your own subscription, no API charge", balance: null, discount: null, web: false,
      planRoute: true,
    });
  }
  return out;
}

async function* planStream(route, opts = {}) {
  const system = typeof opts.system === "string" && opts.system.trim() ? `${opts.system.trim()}\n\n` : "";
  const text = (opts.messages || []).map((m) => (typeof m?.content === "string" ? m.content : "")).filter(Boolean).join("\n\n");
  const ready = readyPlanRoutes().find((r) => r.id === route.id) || route;
  const res = await askApp(ready, `${system}${text}`, { signal: opts.signal });
  if (!res.ok) {
    if (res.code === "quota") noteOutOfQuota(route.id, Date.now(), res.until || res.resetAt || null);
    const err = new Error(res.message || `${route.name} could not answer.`);
    err.status = res.code === "quota" ? 429 : 502;
    err.code = res.code || "failed";
    if (res.code === "quota") { err.limit = true; err.until = restingUntil(route.id) || null; }
    throw err;
  }
  noteAnswer(route.id);
  yield { type: "delta", text: res.text };
  yield { type: "done", usage: { input: 0, output: 0, cost: 0 }, stop: "end" };
}

// One plain line for where the feature lives: who the jobs go to, or the one step to take.
export function loginLine(names, on) {
  if (!on) return "Jobs go to the cheapest good AI. Turn on Use my plan first to send them to the AI you are signed in to.";
  if (!names.length) return "No signed-in app found yet. Sign in to Claude Code, Codex or Gemini CLI on this PC and jobs go there first, with no extra charge.";
  return `Jobs go to the AI you are signed in to first: ${names.join(", ")}. No extra charge. Free AIs on this PC still go before it.`;
}

export function planMeterView(now = Date.now()) {
  const m = meter(now);
  const known = cachedStatus();
  const on = readPlanFirst();
  const readyNames = ROUTES.filter((r) => !r.agy && routeOn(r.id) && known?.rows.some((x) => x.id === r.id && x.status === "ready") && !outOfQuota(r.id, now)).map((r) => r.name);
  return {
    on,
    line: loginLine(readyNames, on),
    day: m.day,
    routes: ROUTES.filter((r) => !r.agy).map((r) => ({
      id: r.id, name: r.name, ai: r.ai,
      ready: !!known?.rows.some((x) => x.id === r.id && x.status === "ready"),
      answersToday: m.counts[r.id] || 0,
      outOfQuota: outOfQuota(r.id, now),
      outAt: m.outAt[r.id] || null,
      backAt: restingUntil(r.id, now) || null,
    })),
  };
}

let registered = false;
export function registerPlanFirst() {
  if (registered) return;
  registered = true;
  for (const r of ROUTES) {
    if (r.agy) continue;
    registerLocalRoute(planId(r.id), (opts) => planStream(routeById(r.id), opts), `${r.name} (your plan)`);
  }
  addRouteSource(planRouteModels);
}
registerPlanFirst();
