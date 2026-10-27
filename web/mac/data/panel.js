// 0.4.23 Mac panel data: the rows of the right hand settings drawer.
// Pure data and pure helpers, no DOM, so it can be unit tested on its own.
// Every row opens something that already exists in the app. `open` is one of:
//   { view }        a page from web/nav.js LABELS, with an optional focus selector
//   { settings }    CC.openSettings(focus), the real settings focus selector
//   { feature }     a settings widget registered in web/features/*.js (settings: {...})
//   { link }        an anchor that is already on the page
//   { mode }        the Simple/Expert switch in the top bar (clicks the real button)
// Rows come from docs/design-0423/FEATURE-MAP.md: sections 2, 5, 6, 7 and the
// 0.4.21 / 0.4.22 table. Plain short words, no dashes, spell license.

export const SECTIONS = [
  {
    id: "connections",
    title: "Connections",
    rows: [
      { id: "keys", title: "Keys and providers", line: "Add the key for each AI you use.", open: { settings: "#settings-keys" } },
      { id: "byo-apps", title: "Your apps", line: "Apps on this computer the AIs can use.", open: { feature: "byo" } },
      { id: "tools-mcp", title: "Tools (MCP)", line: "Add tools the AIs can call.", open: { feature: "mcp" } },
      { id: "integrations", title: "Integrations (Grok Bot)", line: "Your own helper when other AIs are busy.", open: { feature: "grokbot" } },
      { id: "browser-extension", title: "Browser extension", line: "Send a page from your browser to Meldmind.", open: { feature: "extension" } },
      { id: "highlevel", title: "HighLevel", line: "Contacts, invoices, and workflows.", open: { feature: "highlevel" } },
      { id: "zapier", title: "Zapier and Make", line: "Automations between your tools.", open: { feature: "zapier" } },
      { id: "find-my-ais", title: "Find my AIs", line: "See what is already on this computer.", open: { view: "setup" } },
    ],
  },
  {
    id: "cost",
    title: "Cost and speed",
    rows: [
      { id: "priority", title: "Priority", line: "How much to spend on each run.", open: { settings: "#s-mode" } },
      { id: "free-only", title: "Free only", line: "Free AIs first, and nothing spent when this is on.", open: { feature: "free-ais" } },
      { id: "plan-first", title: "Use my plan first", line: "Your own plans before paid keys.", open: { feature: "answer-wait" } },
      { id: "backup-credits", title: "Backup when credits run out", line: "Move the job to the next AI.", open: { feature: "fallback" } },
    ],
  },
  {
    id: "safety",
    title: "Safety and approvals",
    rows: [
      { id: "getdone-rules", title: "Get it done rules", line: "Ordinary steps run without asking each time.", open: { feature: "getdone" } },
      { id: "privacy-masking", title: "Privacy and masking", line: "Private mode, and private numbers stay hidden.", open: { feature: "privacy" } },
      { id: "send-check", title: "Send check", line: "A warning before a message goes out.", open: { feature: "guard-test" } },
    ],
  },
  {
    id: "voice",
    title: "Voice",
    rows: [
      { id: "voice-orders", title: "Voice orders", line: "Tap to talk, or hold the button.", open: { feature: "voice" } },
      { id: "voice-talk", title: "Talk to Meldmind", line: "Say a command out loud.", open: { feature: "voice-talk" } },
    ],
  },
  {
    id: "memories",
    title: "Memories",
    rows: [
      { id: "memories", title: "Memories", line: "What Meldmind remembers about you and your projects.", open: { feature: "memories" } },
    ],
  },
  {
    id: "project-memory",
    title: "Project memory",
    rows: [
      { id: "brand-kit", title: "Brand kit", line: "Your voice, your colors, words to never use.", open: { feature: "brand" } },
      { id: "project-memory", title: "Project memory", line: "Notes added to every prompt in one project.", open: { feature: "memory" } },
    ],
  },
  {
    id: "look",
    title: "Look",
    rows: [
      { id: "look-theme", title: "Theme", line: "Light or dark, and the background.", open: { feature: "look" } },
      { id: "text-size", title: "Text size", line: "Make the words bigger or smaller.", open: { feature: "a11y" } },
    ],
  },
  {
    id: "alerts",
    title: "Alerts",
    rows: [
      { id: "spend-alerts", title: "Spend caps and email alerts", line: "An email when you near a cap.", open: { feature: "alerts" } },
      { id: "phone-approvals", title: "Phone approvals", line: "Approve a step from your phone.", open: { settings: "#phone-pair" } },
    ],
  },
  {
    id: "account",
    title: "Account",
    rows: [
      { id: "updates", title: "Updates", line: "Check for the newest version.", open: { view: "help", focus: "#help-about" } },
      { id: "license-key", title: "License key", line: "Add the key you were given.", open: { settings: "#settings-plan" } },
      { id: "simple-expert", title: "Simple or Expert", line: "Switch this window between Simple and Expert.", open: { mode: "toggle" } },
    ],
  },
];

// The short Simple list behind the "Settings basics" entry. Same row ids, so one
// opener serves both. `title` only changes the words shown in Simple.
export const SIMPLE_BASICS = [
  { id: "keys", title: "Keys and connections" },
  { id: "free-only" },
  { id: "memories" },
  { id: "look-theme" },
  { id: "updates" },
];

export const SIMPLE_TITLE = "Settings basics";

// Every row, in section order.
export function allRows() {
  return SECTIONS.flatMap((s) => s.rows);
}

export function rowById(id) {
  return allRows().find((r) => r.id === id) || null;
}

// Which opener a row uses. One row has exactly one.
export function openKind(row) {
  const open = (row && row.open) || {};
  return ["view", "settings", "feature", "link", "mode"].find((k) => open[k]) || "";
}

// Sections to draw for a mode: Expert draws everything, Simple draws the short basics list.
export function sectionsForMode(mode) {
  if (mode !== "expert") {
    const rows = SIMPLE_BASICS.map((b) => {
      const row = rowById(b.id);
      return row ? { ...row, title: b.title || row.title } : null;
    }).filter(Boolean);
    return [{ id: "basics", title: SIMPLE_TITLE, rows }];
  }
  return SECTIONS.map((s) => ({ ...s, rows: s.rows.slice() }));
}

// Filter rows by plain words. Matches a row title, its line, or a section title
// (a matching section keeps all of its rows). An empty query keeps everything.
export function filterSections(sections, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return sections;
  const out = [];
  for (const s of sections) {
    const all = s.title.toLowerCase().includes(q);
    const rows = s.rows.filter((r) => all || r.title.toLowerCase().includes(q) || r.line.toLowerCase().includes(q));
    if (rows.length) out.push({ ...s, rows });
  }
  return out;
}
