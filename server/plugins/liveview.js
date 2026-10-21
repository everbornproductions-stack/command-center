// Live project view: who is working, the current step, ledger cost, Open in <service> links,
// and the flow-map state. All of it is derived from the bus, the ledger, health, and the
// missions and media jobs that already exist. No provider page is fetched.
import { getContext } from "../store.js";
import { allEntries } from "../ledger.js";
import { applyLiveEvent, buildLiveView, createState, openIn, HISTORY_NOTE } from "../liveview.js";
import { mapTutorials } from "../map-tutorials.js";

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

function viewFor(h, userId, reducedMotion) {
  const state = stateFor(userId || h.ctx().userId || "local");
  return buildLiveView(inputs(h, state, reducedMotion));
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
  const user = ev.user || null;
  const state = stateFor(user || "local");
  if (!applyLiveEvent(state, ev)) return;
  const c = user ? getContext(user) : null;
  if (c) h.runAs(c, () => publish(h, user));
  else publish(h, user);
}

export async function routes(req, res, url, _body, h) {
  if (req.method !== "GET") return false;
  const p = url.pathname.replace(/^\/api\/liveview\/?/, "");
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
