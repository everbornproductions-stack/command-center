// 0.4.23 Mac-style GUI: runbar pure data and logic.
// Expert run bar above the chat box (FEATURE-MAP.md section 2).

export const RUN_MODES = [
  { id: "auto", label: "Auto team", help: "Meldmind picks Single, Mission or Council for you and says which" },
  { id: "single", label: "Single", help: "Best AI for the job" },
  { id: "council", label: "Council", help: "Several AIs answer and judge each other" },
  { id: "mission", label: "Mission", help: "Plan, assign, check, put together" },
  { id: "research", label: "Research", help: "Search the web and answer with numbered sources" },
  { id: "opinion", label: "Second opinion", help: "Two AIs answer the same orders. Differences are shown in plain words." }
];

// The ids are the data-m values of #cost-mode in web/app.js (PRIORITY). The bar uses them
// to click the real button, so they must match exactly.
export const PRIORITIES = [
  { id: "max", label: "Max quality" },
  { id: "quality", label: "Quality" },
  { id: "balanced", label: "Balanced" },
  { id: "savings", label: "Max savings" },
  { id: "speed", label: "Speed" }
];

export function costLine(estimate) {
  if (!estimate) return "Free";
  if (typeof estimate === "number") {
    if (estimate < 0.01) return "Less than 1 cent";
    if (estimate < 1) return `About ${Math.round(estimate * 100)} cents`;
    return `About $${estimate.toFixed(2)}`;
  }
  if (String(estimate).toLowerCase() === "free") return "Free";
  return String(estimate);
}
