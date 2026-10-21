// One area for news and alerts (Phase 42): finished jobs, model-version notes,
// spend warnings, and app updates. Nothing is downloaded or sent from this list.
import { updateState } from "../update.js";
import { redact, bad } from "../together-text.js";

export const id = "newsfeed";
const DOC = "newsfeed";
const FINAL = new Set(["done", "done-with-errors", "failed"]);

const empty = () => ({ jobs: {}, models: [] });
const load = (h) => {
  const d = h.doc(DOC, empty);
  d.jobs ||= {};
  d.models ||= [];
  return d;
};

export function jobItem(m) {
  const status = m.status || "done";
  const label = status === "failed" ? "Failed" : status === "done-with-errors" ? "Done with errors" : "Finished";
  return {
    kind: "job",
    id: m.id,
    title: `${label}: ${redact(m.title || "Job", 120)}`,
    status,
    at: Number(m.finishedAt) || Date.now(),
  };
}

export function spendItems(state, names = {}) {
  const rows = [];
  for (const [pid, info] of Object.entries(state?.perProvider || {})) {
    if (!info || (info.level !== "amber" && info.level !== "stop")) continue;
    const name = names[pid] || pid;
    const title = info.level === "stop"
      ? `${name} hit its monthly spend cap`
      : `${name} is near its monthly spend cap`;
    rows.push({ kind: "spend", id: `spend:${pid}:${info.level}`, title, level: info.level, pct: info.pct, at: Date.now() });
  }
  return rows;
}

export function updateItem(state) {
  if (state?.available && state.latest) {
    return {
      kind: "update",
      id: `update:${state.latest}`,
      title: `Meldmind ${state.latest} is ready`,
      body: "Open Settings and choose Check for updates. Nothing downloads until you click.",
      at: state.checkedAt || Date.now(),
    };
  }
  return {
    kind: "update",
    id: "update:current",
    title: `You are on ${state?.current || "this version"}`,
    body: "No newer version is waiting.",
    at: state?.checkedAt || Date.now(),
  };
}

function namesOf(h) {
  const names = {};
  for (const p of Object.values(h.PROVIDERS || {})) names[p.id] = p.name;
  return names;
}

function rememberJob(d, m) {
  if (!m?.id || !FINAL.has(m.status) || d.jobs[m.id]) return false;
  d.jobs[m.id] = jobItem(m);
  return true;
}

function scanMissions(h, d) {
  let rows = [];
  try { rows = h.ctx().store.listMissions((m) => ({ id: m.id, title: m.title || m.prompt || "", status: m.status, finishedAt: m.finishedAt || null })); }
  catch { rows = []; }
  let changed = false;
  for (const m of rows) if (rememberJob(d, m)) changed = true;
  return changed;
}

export function onEvent(ev, h) {
  if (ev.type === "mission.update" && ev.mission) {
    const d = load(h);
    if (rememberJob(d, ev.mission)) h.putDoc(DOC, d);
    return;
  }
  if (ev.type === "model.version" && ev.model) {
    const d = load(h);
    d.models.push({
      kind: "model",
      id: "model-" + Date.now().toString(36),
      title: redact(ev.title || ev.model, 140),
      body: redact(ev.note || "A provider shipped a new model.", 300),
      at: Date.now(),
    });
    if (d.models.length > 40) d.models.splice(0, d.models.length - 40);
    h.putDoc(DOC, d);
  }
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/newsfeed/, "").replace(/\/$/, "") || "/";
  const d = load(h);
  if (req.method === "GET" && p === "/") {
    if (scanMissions(h, d)) h.putDoc(DOC, d);
    let caps = {};
    try { caps = h.doc("alerts.state", () => ({})); } catch { caps = {}; }
    const items = [
      ...Object.values(d.jobs),
      ...spendItems(caps, namesOf(h)),
      ...d.models,
      updateItem(updateState()),
    ].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 80);
    return h.json(res, 200, {
      items,
      kinds: ["job", "spend", "model", "update"],
      note: "Finished jobs, spend warnings, model notes, and app updates. Nothing is sent from this list.",
    });
  }
  if (req.method === "POST" && p === "/model") {
    const title = redact(String(body.title || body.model || "").trim(), 140);
    if (!title) throw bad(400, "Name the model.", "model");
    const row = { kind: "model", id: "model-" + Date.now().toString(36), title, body: redact(body.note || "A new model is available.", 300), at: Date.now() };
    d.models.push(row);
    h.putDoc(DOC, d);
    return h.json(res, 200, { item: row, watched: false });
  }
  return false;
}
