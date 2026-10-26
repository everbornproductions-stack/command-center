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

export const METER_DOC = "plan.meter";
export const OUT_MS = 60 * 60 * 1000;
export const planId = (routeId) => `plan-${routeId}`;
const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function meter(now = Date.now()) {
  let d = null;
  try { d = doc(METER_DOC, () => ({ day: day(now), counts: {}, outAt: {} })); } catch { d = null; }
  const m = d && typeof d === "object" ? d : { day: day(now), counts: {}, outAt: {} };
  if (m.day !== day(now)) return { day: day(now), counts: {}, outAt: m.outAt || {} };
  return { day: m.day, counts: m.counts || {}, outAt: m.outAt || {} };
}

export function noteAnswer(routeId, now = Date.now()) {
  const m = meter(now);
  m.counts[routeId] = (m.counts[routeId] || 0) + 1;
  delete m.outAt[routeId];
  putDoc(METER_DOC, m);
}

export function noteOutOfQuota(routeId, now = Date.now()) {
  const m = meter(now);
  m.outAt[routeId] = now;
  putDoc(METER_DOC, m);
}

export const outOfQuota = (routeId, now = Date.now()) => {
  const at = Number(meter(now).outAt[routeId]) || 0;
  return at > 0 && now - at < OUT_MS;
};

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
    if (res.code === "quota") noteOutOfQuota(route.id);
    const err = new Error(res.message || `${route.name} could not answer.`);
    err.status = res.code === "quota" ? 429 : 502;
    err.code = res.code || "failed";
    throw err;
  }
  noteAnswer(route.id);
  yield { type: "delta", text: res.text };
  yield { type: "done", usage: { input: 0, output: 0, cost: 0 }, stop: "end" };
}

export function planMeterView(now = Date.now()) {
  const m = meter(now);
  const known = cachedStatus();
  return {
    on: readPlanFirst(),
    day: m.day,
    routes: ROUTES.filter((r) => !r.agy).map((r) => ({
      id: r.id, name: r.name, ai: r.ai,
      ready: !!known?.rows.some((x) => x.id === r.id && x.status === "ready"),
      answersToday: m.counts[r.id] || 0,
      outOfQuota: outOfQuota(r.id, now),
      outAt: m.outAt[r.id] || null,
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
