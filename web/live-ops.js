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
  // a stopped or errored mission keeps its rating rows and an "unfinished" note (0.4.21, dogfood 10)
  if (l.kind === "mission" && (l.status === "aborted" || l.status === "failed")) return true;
  return false;
}

// ---- Stale Live ops (0.4.21, dogfood 02) ----
// While the window was covered, the live feed stopped and Live ops kept showing "$0.03, running" for minutes after the
// run had finished. A run that is going is now re-read from the engine when the window comes back (focus, visible
// again) and every few seconds in the background, so what is shown never stays old.
export const POLL_MS = 4000;
export const RUNNING = ["planning", "running", "assembling", "scheduled", "started", "waiting", "review"];
export const isRunning = (status) => RUNNING.includes(String(status || ""));

/**
 * liveSync({ getLive, fetchRun, apply, doc, win, setIntervalFn, pollMs }) -> { refreshNow, stop }
 * getLive(): the live record ({ id, status }). fetchRun(id): the run as the engine has it now. apply(run): show it.
 * Polls only while a run is going; a focus or a window that is visible again refreshes at once (also a finished run, so a
 * run that ended while covered is shown as ended).
 */
export function liveSync({ getLive, fetchRun, apply, doc = typeof document !== "undefined" ? document : null, win = typeof window !== "undefined" ? window : null, setIntervalFn = setInterval, clearIntervalFn = clearInterval, pollMs = POLL_MS } = {}) {
  let busy = false;
  const refreshNow = async (why = "poll") => {
    const l = getLive?.();
    if (!l?.id || busy) return false;
    if (why === "poll" && !isRunning(l.status)) return false;
    if (why === "focus" && !isRunning(l.status) && !(l.status == null)) {
      // finished runs are re-read once on focus only when the card may be stale (no end stamp)
      if (l.finishStamp) return false;
    }
    busy = true;
    try {
      const run = await fetchRun(l.id);
      if (run && run.id === l.id) { apply(run); return true; }
    } catch { /* the next tick tries again */ }
    finally { busy = false; }
    return false;
  };
  const timer = setIntervalFn(() => { refreshNow("poll"); }, pollMs);
  timer?.unref?.();
  const onFocus = () => { refreshNow("focus"); };
  const onVisible = () => { if (!doc.hidden) refreshNow("focus"); };
  win?.addEventListener?.("focus", onFocus);
  doc?.addEventListener?.("visibilitychange", onVisible);
  return { refreshNow, stop() { clearIntervalFn(timer); win?.removeEventListener?.("focus", onFocus); doc?.removeEventListener?.("visibilitychange", onVisible); } };
}
