// Background runs: a chat, council, or mission the person started with background: true
// keeps going after they leave the screen. When it reaches a finished status, an in-app
// done alert is recorded. Nothing is emailed from here. Push still follows the existing
// job-done opt-in in the alerts plugin.
import { doc, putDoc } from "./store.js";
import { emit } from "./events.js";

export const KIND = "background.runs";
const FINAL = new Set(["done", "done-with-errors", "failed", "aborted", "cancelled"]);

function state() {
  const s = doc(KIND, () => ({ runs: {}, alerts: [] }));
  s.runs ||= {};
  s.alerts ||= [];
  return s;
}

export function rememberBackground({ id, kind, title }) {
  const clean = String(id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
  if (!clean) return null;
  const s = state();
  s.runs[clean] = {
    id: clean,
    kind: kind === "council" || kind === "single" ? kind : "mission",
    title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 120),
    startedAt: Date.now(),
    status: "running",
    alerted: false,
  };
  putDoc(KIND, s);
  return s.runs[clean];
}

export function noteBackgroundUpdate(run) {
  if (!run?.id) return null;
  const s = state();
  const row = s.runs[run.id];
  if (!row || row.alerted) return null;
  row.status = run.status || row.status;
  if (run.title) row.title = String(run.title).replace(/\s+/g, " ").trim().slice(0, 120);
  if (!FINAL.has(run.status)) {
    putDoc(KIND, s);
    return null;
  }
  row.alerted = true;
  row.finishedAt = run.finishedAt || Date.now();
  const what = row.kind === "council" ? "Council" : row.kind === "single" ? "Chat" : "Mission";
  const headline = run.status === "failed" ? `${what} failed` : run.status === "aborted" || run.status === "cancelled" ? `${what} stopped` : run.status === "done-with-errors" ? `${what} done, with errors` : `${what} done`;
  const alert = {
    id: run.id,
    kind: row.kind,
    title: row.title,
    status: run.status,
    headline,
    at: Date.now(),
    seen: false,
  };
  s.alerts.unshift(alert);
  s.alerts = s.alerts.slice(0, 40);
  putDoc(KIND, s);
  emit("background.done", alert);
  emit("log", { text: `Background run finished: ${headline}. ${row.title || "Your run"}`, missionId: run.id });
  return alert;
}

export function backgroundView() {
  const s = state();
  return {
    runs: Object.values(s.runs).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 20),
    alerts: s.alerts,
  };
}

export function seeBackground(id) {
  const s = state();
  const want = id ? String(id) : "";
  for (const a of s.alerts) if (!want || a.id === want) a.seen = true;
  putDoc(KIND, s);
  return backgroundView();
}
