// 0.4.23 Mac Live Ops: pure logic and data, no DOM. Unit tested in test/mac-liveops-0423.test.js.
// Reads the real run shape from web/app.js (CC.S.live):
//   live  = { id, kind: "mission"|"council"|"research"|"single", status, tasks, mission, council }
//   task  = { id, title, status, capability, cost, estCost, review, retried, revised, ... }
// Step statuses as web/app.js renderTasks draws them: queued, running, review, done, failed, waiting.

// The Simple "AIs working" card always shows exactly these 3 plain bars.
export const BAR_LABELS = ["Planning", "Writing", "Checking"];

// Same step fills the app already draws (web/app.js renderTasks).
const STEP_PCT = { done: 100, failed: 100, review: 85, running: 30 };

const KIND_WORDS = { mission: "Mission", council: "Council", research: "Research", single: "Chat" };

const STATUS_WORDS = {
  planning: "planning", running: "running", assembling: "assembling", scheduled: "queued",
  paused: "paused", waiting: "waiting", review: "reviewing",
  done: "done", "done-with-errors": "done with problems", failed: "stopped", aborted: "stopped",
};

// Priority keys as web/app.js PRIORITY words them (S.costMode, or settings.defaultMode, or "balanced").
const PRIORITY_WORDS = {
  max: "Max quality", quality: "Quality", balanced: "Balanced",
  savings: "Max savings", economy: "Max savings", speed: "Speed",
};

export function priorityWord(raw) {
  return PRIORITY_WORDS[raw || "balanced"] || PRIORITY_WORDS.balanced;
}

// Which of the 3 bars a step belongs to. The capability chip the engine sends decides;
// a step without one falls back to its place in the plan (first third, middle, last third).
function phaseOf(task, i, n) {
  const cap = String(task?.capability || "").toLowerCase();
  if (cap) {
    if (/plan/.test(cap)) return 0;
    if (/qa|check|review|test|verify|audit/.test(cap)) return 2;
    return 1;
  }
  return Math.min(2, Math.floor((i * 3) / Math.max(1, n)));
}

// "step 3 of 5": the first step that is not done yet, in plan order.
function stepPos(tasks) {
  const n = tasks.length;
  if (!n) return { k: 0, n: 0 };
  let i = tasks.findIndex((t) => String(t?.status || "") !== "done");
  if (i < 0) i = n - 1;
  return { k: i + 1, n };
}

/**
 * workingModel(live) -> { bars: [{label, pct}], line, showSteps }
 * Exactly 3 bars: Planning, Writing, Checking. pct is 0 to 100.
 * line is one plain sentence, e.g. "Working on step 3 of 5".
 * showSteps is true when there is a run to open (the "Show steps" link shows then).
 */
export function workingModel(live) {
  const l = live || {};
  const bars = BAR_LABELS.map((label) => ({ label, pct: 0 }));
  if (!l.id) return { bars, line: "Nothing running yet", showSteps: false };

  const tasks = Object.values(l.tasks || {});
  const n = tasks.length;
  const status = String(l.status || "");
  const sums = [0, 0, 0];
  const counts = [0, 0, 0];
  tasks.forEach((t, i) => {
    const p = phaseOf(t, i, n);
    sums[p] += STEP_PCT[String(t?.status || "")] ?? 0;
    counts[p] += 1;
  });
  counts.forEach((c, p) => { if (c) bars[p].pct = Math.round(sums[p] / c); });
  if (status === "done") for (const b of bars) b.pct = 100;

  const { k, n: total } = stepPos(tasks);
  const at = total ? `step ${k} of ${total}` : "";
  let line;
  if (status === "planning" && !total) line = "Planning your run";
  else if (status === "scheduled") line = total ? `Queued at ${at}` : "Waiting to start";
  else if (status === "paused") line = total ? `Paused at ${at}` : "Paused";
  else if (status === "done-with-errors") line = total ? `Finished with problems (${total} steps)` : "Finished with problems";
  else if (status === "done") line = total ? `All ${total} steps done` : "Done";
  else if (status === "failed" || status === "aborted") line = total ? `Stopped at ${at}` : "Stopped";
  else line = total ? `Working on ${at}` : "Working on it now";

  return { bars, line, showSteps: true };
}

/**
 * opsHeader(live, priorityRaw) -> one header line for the Live Ops screen,
 * e.g. "Mission running, step 3 of 5, $0.031 so far, Balanced".
 * Cost comes from the run the app already keeps (live.mission.cost or live.council.cost).
 */
export function opsHeader(live, priorityRaw) {
  const l = live || {};
  if (!l.id) return "Nothing running";
  const kind = KIND_WORDS[String(l.kind || "")] || "Run";
  const status = STATUS_WORDS[String(l.status || "")] || String(l.status || "running");
  const parts = [`${kind} ${status}`];
  const { k, n } = stepPos(Object.values(l.tasks || {}));
  if (n) parts.push(`step ${k} of ${n}`);
  const cost = Number(l.mission?.cost ?? l.council?.cost ?? 0) || 0;
  parts.push(`$${cost.toFixed(3)} so far`);
  parts.push(priorityWord(priorityRaw));
  return parts.join(", ");
}
