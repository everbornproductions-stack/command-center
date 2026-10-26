// The finish path (flag_finishpath, 0.4.19): an always-visible Finish button, a Looks good / Edit
// further pair after a result, one Finish preview card, an inline progress pill, and Undo / Branch on
// project steps. Pure: no DOM, so the tests and the server can call it. Nothing here sends, posts or
// spends. Finish only opens Publish with the result, where the person still picks where it goes.

export const FINISH_LABEL = "Finish";
export const PAIR = { good: "Looks good, Finish", edit: "Edit further" };
export const UNDO_LABEL = "Undo last step";
export const BRANCH_LABEL = "Branch from here";
export const KINDS = ["command", "image", "media", "remix", "project"];
export const MAX_TEXT = 4000;

const KIND_WORDS = { command: "answer", image: "image set", media: "media job", remix: "remix", project: "project" };

export function cleanText(text, max = MAX_TEXT) {
  return String(text ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

// The one card shown before Finish. Plain lines, one confirm. Returns null when there is nothing to finish.
export function previewCard({ kind, text, name, projectName } = {}) {
  const body = cleanText(text);
  if (!body) return null;
  const k = KINDS.includes(kind) ? kind : "command";
  const words = body.split(/\s+/).filter(Boolean).length;
  const excerpt = body.replace(/[#*>`|]/g, " ").replace(/\s+/g, " ").trim();
  const lines = [
    `What: your ${KIND_WORDS[k]}${name ? `, ${cleanText(name, 70)}` : ""}`,
    `Size: about ${words} word${words === 1 ? "" : "s"}`,
    projectName ? `Project: ${cleanText(projectName, 70)}` : "Project: none picked",
    "Next: Publish opens with this result. Nothing is sent until you pick where it goes and press the button there.",
  ];
  return {
    title: "Ready to finish?",
    kind: k,
    lines,
    excerpt: excerpt.length > 220 ? `${excerpt.slice(0, 217)}...` : excerpt,
    confirm: FINISH_LABEL,
    cancel: "Not yet",
  };
}

// The slim progress pill: how many jobs are working. Null when nothing runs.
export function pillInfo(missions) {
  const live = (Array.isArray(missions) ? missions : []).filter((m) => m && ["planning", "running"].includes(m.status));
  if (!live.length) return null;
  const planning = live.every((m) => m.status === "planning");
  const text = live.length === 1
    ? `${planning ? "Planning" : "Working"}: ${cleanText(live[0].title || "your request", 40)}`
    : `Working on ${live.length} jobs`;
  return { count: live.length, text };
}

// The newest finished mission, optionally for one project, so Finish has something to show at once.
export function latestDone(missions, projectId) {
  const rows = (Array.isArray(missions) ? missions : []).filter((m) => m && ["done", "done-with-errors"].includes(m.status) && (!projectId || m.projectId === projectId));
  rows.sort((a, b) => (Number(b.finishedAt || b.startedAt) || 0) - (Number(a.finishedAt || a.startedAt) || 0));
  return rows[0] || null;
}

// ---- Undo and Branch on project steps (walkthrough plans) ----
const stepsOf = (walk) => (Array.isArray(walk?.plan?.steps) ? walk.plan.steps : []);

export function lastDoneStep(walk) {
  const steps = stepsOf(walk);
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].status === "done") return steps[i];
  return null;
}
export const canUndo = (walk) => !!lastDoneStep(walk) && !walk.example;

// Puts the last finished step back to waiting and keeps its words so nothing is lost. Works on a copy.
export function undoLast(walk) {
  const step = lastDoneStep(walk);
  if (!step || walk?.example) return { ok: false, reason: "There is no finished step to undo." };
  const next = JSON.parse(JSON.stringify(walk));
  const s = next.plan.steps.find((x) => x.id === step.id);
  const undone = Array.isArray(next.undone) ? next.undone : [];
  undone.push({ id: s.id, title: s.title, output: s.output || "", at: Date.now() });
  next.undone = undone.slice(-10);
  s.status = "queued";
  s.output = null;
  next.stage = "build";
  next.status = "ready";
  next.deliverable = "";
  next.error = "";
  return { ok: true, walk: next, step: { id: s.id, title: s.title } };
}

// A new project that keeps the steps up to and including stepId. Later steps wait again. The main line is untouched.
export function branchWalk(walk, stepId, newId, now = Date.now()) {
  const steps = stepsOf(walk);
  const at = steps.findIndex((s) => s.id === stepId);
  if (at < 0 || walk?.example) return { ok: false, reason: "That step was not found." };
  const next = JSON.parse(JSON.stringify(walk));
  next.id = newId;
  next.branchOf = walk.id;
  next.branchStep = stepId;
  next.createdAt = now;
  next.updatedAt = now;
  next.revisions = [];
  next.undone = [];
  next.deliverable = "";
  next.error = "";
  next.paused = false;
  next.stage = "build";
  next.status = "ready";
  next.plan.steps = next.plan.steps.map((s, i) => (i <= at ? s : { ...s, status: "queued", output: null }));
  if (next.plan.title) next.plan.title = `${cleanText(next.plan.title, 60)} (branch)`;
  return { ok: true, walk: next };
}
