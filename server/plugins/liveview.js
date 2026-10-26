// Live project view: who is working, the current step, ledger cost, Open in <service> links,
// and the flow-map state. All of it is derived from the bus, the ledger, health, and the
// missions and media jobs that already exist. No provider page is fetched.
import { getContext } from "../store.js";
import { allEntries } from "../ledger.js";
import { applyLiveEvent, buildLiveView, createState, openIn, HISTORY_NOTE } from "../liveview.js";
import { mapTutorials } from "../map-tutorials.js";
import { PROVIDERS } from "../registry.js";
import { liveBubbleOn } from "../live-flag.js";

export const id = "liveview";
const WATCH = new Set(["mission.update", "council.update", "agent.start", "agent.done", "agent.error", "agent.msg", "task.update", "ledger.entry", "external.handoff"]);
const boards = new Map();

function stateFor(userId) {
  const key = userId || "local";
  let s = boards.get(key);
  if (!s) { s = createState(); boards.set(key, s); }
  return s;
}

function inputs(h, state, reducedMotion) {
  const c = h.ctx();
  let missions = [];
  try { missions = c.store.listMissions((m) => m).filter(Boolean); } catch { missions = []; }
  const jobs = c.docs?.["media.jobs"]?.items || [];
  return { state, projects: h.listProjects(), missions, ledger: allEntries(), jobs, health: c.health || {}, reducedMotion: !!reducedMotion };
}

// Slice A4 (flag_livebubble): the extras load only when the flag is on, so a build with it off
// never pulls in the checker, the scheduler job or the credit lookups.
let bubble = null;
let checker = null;
async function loadBubble() {
  if (!bubble) {
    bubble = await import("../live-bubble.js");
  }
  if (!checker) checker = bubble.createFreeChecker();
  return bubble;
}
function extrasFor(h, input) {
  if (!bubble || !checker || !liveBubbleOn()) return null;
  const c = h.ctx();
  const key = c.userId || "local";
  checker.watch(key, (fn) => h.runAs(c, async () => { await fn(); publish(h, c.userId || null); }));
  return {
    credit: bubble.creditStates(Object.keys(PROVIDERS), input.health),
    cleared: bubble.clearedMap(),
    applyCleared: bubble.applyCleared,
    free: checker.snapshot(),
  };
}

function viewFor(h, userId, reducedMotion) {
  const state = stateFor(userId || h.ctx().userId || "local");
  const input = inputs(h, state, reducedMotion);
  return buildLiveView({ ...input, extras: extrasFor(h, input) });
}

function fullView(h, userId, reducedMotion) {
  return { ...viewFor(h, userId, reducedMotion), tutorials: mapTutorials() };
}

function publish(h, userId) {
  try { h.emit("liveview.update", { view: fullView(h, userId, false) }); }
  catch (e) { console.error("[liveview]", e.message); }
}

export function onEvent(ev, h) {
  if (!WATCH.has(ev?.type)) return;
  if (liveBubbleOn() && !bubble) { loadBubble().catch(() => {}); }
  const user = ev.user || null;
  const state = stateFor(user || "local");
  if (!applyLiveEvent(state, ev)) return;
  const c = user ? getContext(user) : null;
  if (c) h.runAs(c, () => publish(h, user));
  else publish(h, user);
}

export async function routes(req, res, url, _body, h) {
  const p = url.pathname.replace(/^\/api\/liveview\/?/, "");
  if (liveBubbleOn()) await loadBubble();
  // Slice A4 routes. Off means they do not exist (404 from the router, same as before the slice).
  if (p === "free" || p === "clear-idle" || p === "show-all") {
    if (!liveBubbleOn()) return false;
    const b = await loadBubble();
    if (p === "free" && (req.method === "GET" || req.method === "POST")) {
      const c = h.ctx();
      checker.watch(c.userId || "local", (fn) => h.runAs(c, async () => { await fn(); publish(h, c.userId || null); }));
      if (req.method === "POST" || url.searchParams.get("refresh") === "1") await checker.refresh({ force: true });
      else if (!checker.cache.size) await checker.refresh({ force: false });
      return h.json(res, 200, checker.snapshot());
    }
    if (p === "clear-idle" && req.method === "POST") {
      const view = viewFor(h, h.ctx().userId, false);
      const n = b.clearIdle(view);
      return h.json(res, 200, { cleared: n, view: fullView(h, h.ctx().userId, false) });
    }
    if (p === "show-all" && req.method === "POST") {
      b.unclearAll();
      return h.json(res, 200, { view: fullView(h, h.ctx().userId, false) });
    }
    return false;
  }
  if (req.method !== "GET") return false;
  const reduced = url.searchParams.get("motion") === "reduce";
  if (p === "" || p === "/") return h.json(res, 200, fullView(h, h.ctx().userId, reduced));
  if (p === "link") {
    const provider = String(url.searchParams.get("provider") || "");
    if (!provider) return h.json(res, 400, { error: "provider required" });
    const link = openIn(provider, { taskId: url.searchParams.get("taskId") || "" });
    return h.json(res, 200, { ...link, note: HISTORY_NOTE });
  }
  const proj = p.match(/^project\/([^/]+)$/);
  if (proj) {
    const id = decodeURIComponent(proj[1]);
    const project = viewFor(h, h.ctx().userId, reduced).projects.find((x) => x.id === id);
    if (!project) return h.json(res, 404, { error: "project not found" });
    return h.json(res, 200, project);
  }
  const run = p.match(/^run\/([^/]+)$/);
  if (run) {
    const id = decodeURIComponent(run[1]);
    const found = viewFor(h, h.ctx().userId, reduced).runs.find((x) => x.id === id);
    if (!found) return h.json(res, 404, { error: "not found" });
    return h.json(res, 200, found);
  }
  return false;
}

// Tests and shutdown: stop the Free AI timer.
export function stopLiveBubble() { try { checker?.stopAll(); } catch { /* nothing running */ } }
