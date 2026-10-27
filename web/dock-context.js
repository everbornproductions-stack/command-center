// Chat dock helpers (0.4.21). Pure: no DOM, so tests can import it in plain node.
// The dock shows on every page except the chat itself, fills a greyed suggestion from where the
// person is, and sends to the one shared working view (Command). The person's typing always wins.

const NO_DOCK = new Set(["command", "setup"]);

export const DOCK_MODES = [
  ["single", "Single"],
  ["council", "Council"],
  ["mission", "Mission"],
  ["research", "Research"],
  ["opinion", "Second opinion"],
];

// Which pages carry the dock. The chat page already is the chat, and first-run setup stays clean.
export function dockShows(view) {
  return !!view && !NO_DOCK.has(view);
}

// A short name for the page, used for the label and for picking the suggestion.
export function dockContext(view, openProject) {
  if (openProject) return "project";
  if (view === "projects") return "home";
  if (view === "images") return "images";
  if (view === "builders" || view === "webbuilders") return "builders";
  if (view === "media" || view === "mindmedia") return "media";
  if (view === "remix") return "remix";
  if (view === "research" || view === "search") return "research";
  if (view === "settings" || view === "credits" || view === "subscriptions") return "settings";
  if (view === "start") return "start";
  return "other";
}

export function contextLabel(ctx, projectName) {
  const name = String(projectName || "").trim();
  switch (ctx) {
    case "project": return name ? `Chatting about ${name}` : "Chatting about this project";
    case "images": return "Chat · Images";
    case "builders": return "Chat · Builders";
    case "media": return "Chat · Media";
    case "remix": return "Chat · Remix";
    case "research": return "Chat · Research";
    case "settings": return "Chat · Ask for help";
    case "start": return "Chat · Start a project";
    case "home": return name ? `Chat · Working in ${name}` : "Chat · Projects";
    default: return name ? `Chat · Working in ${name}` : "Chat";
  }
}

const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
const short = (s, n) => { const t = clean(s); return t.length > n ? t.slice(0, n - 1).trimEnd() + "..." : t; };

// The ready-to-send next step for this page, or null. Never written into the box by itself.
// input: { view, openProject, projectName, lastTitle, result: {title} | null }
export function suggestionFor(input = {}) {
  const ctx = dockContext(input.view, input.openProject);
  const name = clean(input.projectName);
  const who = name || "my business";
  if (input.result && input.result.title && ctx !== "settings") {
    return { id: "next", text: `Next: turn "${short(input.result.title, 50)}" into 5 short posts` };
  }
  switch (ctx) {
    case "project": {
      const step = input.lastTitle ? `pick up from "${short(input.lastTitle, 60)}" and do the next step` : "plan the first step and start on it";
      return { id: "project", text: `Continue building ${name || "this project"}: ${step}` };
    }
    case "images": return { id: "images", text: `Make an image: a clean, friendly picture for ${who}` };
    case "builders": return { id: "builders", text: `Build the next page for ${who} using the details I already entered` };
    case "media": return { id: "media", text: `Make a short video for ${who}: 15 seconds, friendly and clear` };
    case "remix": return { id: "remix", text: `Remix this for another channel and keep my voice` };
    case "research": return { id: "research", text: `Research ${who} and give me 5 ideas with sources` };
    case "start": return { id: "start", text: `Plan and build something for ${who}: tell me the first three steps` };
    case "home": return { id: "home", text: name ? `Continue building ${name}: plan the next step` : "Start a project: I want to make something new" };
    case "settings": return null;
    default: return name ? { id: "other", text: `Continue building ${name}: plan the next step` } : null;
  }
}

// "3 AIs working, step 2 of 5". live is S.live, working is how many AIs are lit right now.
export function workingLine(live, working = 0) {
  const l = live || {};
  const n = Math.max(0, working | 0);
  const tasks = Object.values(l.tasks || {});
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done" || t.status === "failed").length;
  const who = n ? `${n} AI${n === 1 ? "" : "s"} working` : "Getting started";
  if (l.kind === "mission" && total) return `${who}, step ${Math.min(total, done + 1)} of ${total}`;
  if (l.kind === "council") {
    const members = (l.council?.members || []).length || 0;
    return members ? `${who}, ${members} answering` : who;
  }
  if (l.status === "planning") return `${who}, planning`;
  return n ? `${who}, step 1 of 1` : who;
}

export function finishedLine(live) {
  const l = live || {};
  const total = Object.keys(l.tasks || {}).length;
  if (l.status === "failed" || l.status === "aborted") return "That run stopped before it finished.";
  // 0.4.23.1: count what really happened, step by step. "All done" only when every step finished clean.
  const bad = Object.values(l.tasks || {}).filter((t) => t && (t.status === "failed" || t.status === "waiting" || t.notDone || t.notSaved || t.notRun || t.qaFailed));
  if (bad.length || l.status === "done-with-errors") {
    if (!total) return "Finished with problems.";
    const n = bad.length || 1;
    return `Finished with problems: ${Math.max(0, total - n)} of ${total} step${total === 1 ? "" : "s"} worked, ${n} did not.`;
  }
  if (total) return `All ${total} step${total === 1 ? "" : "s"} done.`;
  return "Finished.";
}

// What the Back button says and where it goes.
export function backLabel(ret) {
  if (!ret) return "Back";
  if (ret.openProject || ret.project) return "Back to project";
  return "Back";
}
