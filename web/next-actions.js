// Next actions after a result, and one Send to menu (flag_nextactions, 0.4.19). Pure: no DOM, so the
// tests and the server can call it. Nothing here spends money. Every button either fills a form (the
// price still shows first) or files the result away.

export const KINDS = ["command", "image", "media", "remix"];

// The three buttons under every result.
export const NEXT_ACTIONS = [
  { id: "variations", label: "Make 3 variations" },
  { id: "project", label: "Add to project" },
  { id: "finish", label: "Finish" },
];

// The one Send to menu. The same four rows everywhere.
export const SEND_TO = [
  { id: "project", label: "Project" },
  { id: "remix", label: "Remix" },
  { id: "finish", label: "Finish" },
  { id: "prompt", label: "Copy prompt" },
];

export const MENU_LABEL = "Send to...";
export const MAX_TEXT = 600;

// Plain text from a result: no markdown marks, one line, cut to a size that fits a prompt box.
export function cleanText(text, max = MAX_TEXT) {
  return String(text ?? "").replace(/[#*>`|]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Three ways to ask again. Each one changes one thing, so the three come back different.
const ANGLES = [
  "Same idea, but a different mood and colors.",
  "Same idea, but closer in, with more detail.",
  "Same idea, but simpler and cleaner.",
];
export function variationPrompts(text, n = 3) {
  const base = cleanText(text);
  if (!base) return [];
  return ANGLES.slice(0, Math.max(1, Math.min(n, ANGLES.length))).map((a) => `${base}\n${a}`);
}

// The text that goes into the Command box to get three versions of an answer.
export function commandVariationText(text) {
  const base = cleanText(text, 400);
  return base ? `Give me 3 different versions of this. Keep each one short and label them A, B and C.\n\n${base}` : "";
}

// Which rows of the Send to menu apply to a kind of result. Remix has no Send to Remix (it is there).
export function sendRows(kind) {
  return SEND_TO.filter((r) => !(r.id === "remix" && kind === "remix"));
}

// The Send to link filed in a project. The ref is an id the person can find again.
export function resultLink({ kind, ref, name }) {
  const k = KINDS.includes(kind) ? kind : "command";
  const r = String(ref || "").replace(/[^\w.:-]/g, "").slice(0, 80);
  const label = cleanText(name, 80) || "Saved result";
  return { name: label, url: `meldmind:${k}${r ? "/" + r : ""}` };
}

// Scope shown on Remix: one item or a selection.
export function scopeLabel(count) {
  const n = Number(count) || 0;
  if (n <= 1) return "Scope: one item";
  return `Scope: ${n} items selected`;
}

// A short status line from a mission update, for the log beside the Remix action.
export function statusLine(mission) {
  if (!mission) return "";
  const last = Array.isArray(mission.log) && mission.log.length ? String(mission.log[mission.log.length - 1].text || "") : "";
  const word = { planning: "Planning", running: "Working", done: "Done", "done-with-errors": "Done with some problems", failed: "Stopped" }[mission.status] || String(mission.status || "");
  return cleanText(last ? `${word}. ${last}` : word, 160);
}

// The log kept beside the action: newest last, no repeats in a row, at most `max` lines.
export function pushLog(lines, line, max = 6) {
  const text = String(line || "").trim();
  const list = Array.isArray(lines) ? lines.slice() : [];
  if (text && list[list.length - 1] !== text) list.push(text);
  return list.slice(-max);
}

// 0.4.21 (dogfood 09): what the Build step of Remix says. A build whose mission failed never says the game
// is saved and never offers the saved folder: one plain line with the AI that failed and its error, and one
// way to build again without that AI. Pure: no DOM, so a test can feed it a mission object.
export const RETRY_AI_LABEL = "Try again with another AI";

function taskRows(tasks) {
  const rows = Array.isArray(tasks) ? tasks : tasks && typeof tasks === "object" ? Object.values(tasks) : [];
  return rows.filter((t) => t && typeof t === "object");
}

// The build stopped: the mission failed, or every task in it failed.
export function remixMissionFailed(mission) {
  if (!mission || typeof mission !== "object") return false;
  if (mission.status === "failed") return true;
  const tasks = taskRows(mission.tasks);
  return tasks.length > 0 && tasks.every((t) => t.status === "failed");
}

// The words for the Build step, from the mission itself when there is one.
export function remixBuiltView(mission, { projectName = "Project" } = {}) {
  const name = cleanText(projectName, 80) || "Project";
  if (!remixMissionFailed(mission)) {
    return { failed: false, message: `${name} is saved on this computer.`, action: "", avoid: [] };
  }
  const tasks = taskRows(mission?.tasks);
  const bad = tasks.find((t) => t.status === "failed" && t.error) || tasks.find((t) => t.status === "failed") || null;
  const who = cleanText(whoDid(bad), 60) || "An AI";
  const why = cleanText(bad?.error || mission?.error || "The build did not finish.", 220) || "The build did not finish.";
  const avoid = [...new Set(tasks.filter((t) => t.status === "failed" && t.provider).map((t) => String(t.provider)))];
  return {
    failed: true,
    message: `The build stopped. ${who} did not finish its part: ${why}`,
    action: RETRY_AI_LABEL,
    avoid,
  };
}

// Which AI a step belongs to, from the step itself: "Groq · code" becomes "Groq".
function whoDid(task) {
  if (!task) return "";
  const label = String(task.agentName || "").split("·")[0].trim();
  if (label) return label;
  const id = String(task.provider || "").trim().replace(/[-_]+/g, " ");
  return id ? id.replace(/^./, (c) => c.toUpperCase()) : "";
}
