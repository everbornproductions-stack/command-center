// Free vs Pro table shared by Settings and the upgrade prompt.
// The words match server/feature-gate.js. The test locks that.

export const COMPARE_ROWS = [
  ["Try it now", "Yes", "Yes"],
  ["Simple mode", "Yes", "Yes"],
  ["Learning router", "Yes", "Yes"],
  ["Safety checks", "Yes", "Yes"],
  ["Backup and restore", "Yes", "Yes"],
  ["Double-check this", "Yes", "Yes"],
  ["Connected services", "1", "Unlimited"],
  ["Email accounts per provider", "1", "8"],
  ["Projects", "3", "Unlimited"],
  ["Councils", "5 a month", "Unlimited"],
  ["Missions", "No", "Yes"],
  ["Schedules", "No", "Yes"],
  ["Do this again", "No", "Yes"],
  ["Desktop control", "No", "Yes"],
  ["Program scan", "No", "Yes"],
  ["Industry packs", "No", "Yes"],
  ["Public share links", "No", "Yes"],
  ["PDF and Word export", "No", "Yes"],
  ["Background runs", "No", "Yes"],
  ["Pause missions", "No", "Yes"],
  ["Shared learning", "No", "Yes"],
  ["Scores dashboard", "No", "Yes"],
  ["Phone pairing", "No", "Yes"],
  ["Full history search", "No", "Yes"],
  ["Subscriptions tracker", "No", "Yes"],
];

export function compareTable(esc) {
  const e = typeof esc === "function" ? esc : (s) => String(s ?? "");
  const body = COMPARE_ROWS.map((r) => `<tr><td>${e(r[0])}</td><td>${e(r[1])}</td><td>${e(r[2])}</td></tr>`).join("");
  return `<table class="tbl" id="cc-compare"><thead><tr><th></th><th>Free</th><th>Pro</th></tr></thead><tbody>${body}</tbody></table><div class="dim small" style="margin-top:6px">A 14-day Pro trial can be started in Settings. It does not start by itself. Nothing is charged from here.</div>`;
}
