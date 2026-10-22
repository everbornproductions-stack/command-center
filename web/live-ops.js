// Expert Command layout rules for the right column.
// Live ops never scrolls inside itself: it shows the newest tasks and a See all button.
// When nothing is running and the last run left nothing to show, it is one line.
// Deliverable stays hidden until there is a result to show.

export const OPS_SHOWN = 3;
export const IDLE_LINE = "Nothing running";

const FINISHED = ["done", "done-with-errors", "failed", "aborted"];

export function runFinished(live) {
  return FINISHED.includes(live?.status);
}

// "running": graph and tasks. "idle": one line. A finished mission or council keeps its steps and answers.
export function opsState(live) {
  const l = live || {};
  if (!l.id) return "idle";
  const hasTasks = Object.keys(l.tasks || {}).length > 0;
  const hasCouncil = l.kind === "council" && !!l.council;
  if (runFinished(l) && !hasTasks && !hasCouncil) return "idle";
  return "running";
}

// Newest first by last update. touched maps task id to an increasing counter; unknown ids keep plan order.
export function newestTasks(tasks, touched = {}, n = OPS_SHOWN) {
  const list = Object.values(tasks || {}).map((t, i) => ({ t, i, at: touched[t.id] || 0 }));
  list.sort((a, b) => (b.at - a.at) || (b.i - a.i));
  const all = list.map((x) => x.t);
  return { shown: n > 0 ? all.slice(0, n) : all, total: all.length };
}

// The Deliverable panel shows only once there is something written, or a run ended with a message to read.
export function showDeliverable(live, text) {
  const l = live || {};
  if (!l.id) return false;
  if (text) return true;
  if (l.status === "waiting") return true; // out of API credits: the waiting box is the deliverable for now
  if (l.kind === "research" && (l.status === "aborted" || l.status === "failed")) return true;
  return false;
}
