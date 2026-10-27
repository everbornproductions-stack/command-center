// Mac part "expert" (0.4.23): pure data and logic for the Expert sidebar and the All tools launchpad.
// No DOM here. buildRegistry turns the real view list (web/nav.js LABELS, web/perf/registry.js views, feature tabs)
// into items, so every page that exists today has a place. coverage() proves nothing was left out.
// Group order and membership follow docs/design-0423/FEATURE-MAP.md.

export const GROUPS_MAC = [
  { id: "work", label: "Work" },
  { id: "create", label: "Create" },
  { id: "agents", label: "Agents" },
  { id: "library", label: "Library" },
  { id: "myday", label: "My day" },
  { id: "people", label: "People" },
  { id: "business", label: "Business" },
  { id: "settings", label: "Settings" },
  { id: "help", label: "Help" },
];

export const PER_PAGE = 21;
export const GRADIENTS = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8"];

// Which group each real view lives in. A view missing here still shows, at the end of Work.
export const VIEW_GROUP = {
  command: "work", start: "work", projects: "work", liveview: "work", compare: "work", refocus: "work",
  webbuilders: "create", images: "create", media: "create", remix: "create", builders: "create", prompts: "create", publish: "create", marketplace: "create",
  agents: "agents", pipelines: "agents", schedules: "agents",
  mindmedia: "library", history: "library", libraries: "library", artifacts: "library", brain: "library",
  "everyday-inbox": "myday", "everyday-plan": "myday", "everyday-work": "myday",
  community: "people", "ai-news": "people", userchat: "people", together: "people",
  workspaces: "business", credits: "business", subscriptions: "business", reports: "business",
  setup: "settings", settings: "settings",
  help: "help",
};

// Order inside each group (ids of views and of the extra items below). Unlisted ones go last.
export const ORDER = {
  work: ["command", "start", "projects", "liveops", "liveview", "mission", "council", "research", "opinion", "compare", "refocus"],
  create: ["webbuilders", "images", "media", "remix", "builders", "prompts", "publish", "marketplace"],
  agents: ["agents", "pipelines", "schedules", "outside-agents"],
  library: ["mindmedia", "history", "recent-chats", "memories", "libraries", "artifacts", "brain"],
  myday: ["everyday-inbox", "everyday-plan", "everyday-work"],
  people: ["community", "ai-news", "userchat", "together"],
  business: ["workspaces", "credits", "subscriptions", "reports"],
  settings: ["setup", "settings", "keys", "byo", "mcp", "integrations", "extension", "highlevel", "zapier",
    "panel-cost", "panel-safety", "panel-voice", "panel-projmem", "panel-alerts", "panel-look", "panel-account"],
  help: ["help", "tour", "connect-setup", "updates", "news", "try-demo", "user-guide", "contact", "about"],
};

// Items that are not a page of their own: they open Command in a run mode, a panel, or a Settings spot.
// open: {view, runMode?, focus?} | {panel, section?} | {action}
export const EXTRAS = [
  { id: "liveops", label: "Live Ops", group: "work", icon: "📡", plain: "Watch every AI work, step by step. Pause, edit, resume or stop.", open: { panel: "live" } },
  { id: "mission", label: "Missions", group: "work", icon: "🎯", plain: "Plan the job, hand it to specialists, check it, put it together.", open: { view: "command", runMode: "mission" }, keywords: "mission" },
  { id: "council", label: "Councils", group: "work", icon: "🏛", plain: "Several AIs answer, review each other, and one writes the verdict.", open: { view: "command", runMode: "council" }, keywords: "council" },
  { id: "research", label: "Research", group: "work", icon: "🔎", plain: "Searches the web and answers with numbered sources.", open: { view: "command", runMode: "research", focus: "#cc-search-cmd" } },
  { id: "opinion", label: "Second opinion", group: "work", icon: "⚖️", plain: "Two AIs answer. The differences are shown in plain words.", open: { view: "command", runMode: "opinion" } },
  { id: "outside-agents", label: "Outside agents", group: "agents", icon: "🤝", plain: "Hand work to Grok Bot, Claude Code, Codex and others.", open: { view: "settings", focus: "[data-feature='grokbot']" }, keywords: "grok bot handoff" },
  { id: "recent-chats", label: "Recent chats", group: "library", icon: "🕘", plain: "Every chat and mission, searchable. Reopen or redo.", open: { panel: "history" }, keywords: "history" },
  { id: "memories", label: "Memories", group: "library", icon: "🧠", plain: "What Meldmind remembers about you and each project.", open: { panel: "settings", section: "Memories" } },
  { id: "panel-cost", label: "Cost and speed", group: "settings", icon: "⚡", plain: "Free first, free only, backup AIs and priority.", open: { panel: "settings", section: "Cost and speed" } },
  { id: "panel-safety", label: "Safety and approvals", group: "settings", icon: "🛡", plain: "What needs a tap, hiding private numbers, the send check.", open: { panel: "settings", section: "Safety and approvals" } },
  { id: "panel-voice", label: "Voice", group: "settings", icon: "🎙", plain: "Push to talk, hands free, wake word.", open: { panel: "settings", section: "Voice" } },
  { id: "panel-projmem", label: "Project memory", group: "settings", icon: "📝", plain: "Brand voice, offers, things never to say.", open: { panel: "settings", section: "Project memory" } },
  { id: "panel-alerts", label: "Alerts", group: "settings", icon: "🔔", plain: "Email or phone when something needs you.", open: { panel: "settings", section: "Alerts" } },
  { id: "panel-look", label: "Look", group: "settings", icon: "🎨", plain: "Light, dark and glass.", open: { panel: "settings", section: "Look" } },
  { id: "panel-account", label: "Account", group: "settings", icon: "👤", plain: "License, updates, Simple or Expert.", open: { panel: "settings", section: "Account" } },
];

// Label changes for the Mac window. nav.js LABELS stays the source for every other label.
export const MAC_LABELS = {
  command: "Chat", liveview: "Live view", userchat: "People chat", settings: "All settings",
  webbuilders: "Website and marketing", images: "Images", media: "Video and media", workspaces: "Teams", help: "Search help",
};

export const ICONS = {
  command: "💬", start: "✨", projects: "🗂", liveview: "🛰", compare: "▥", refocus: "🧭",
  webbuilders: "🌐", images: "🖼", media: "🎬", remix: "🎮", builders: "🧱", prompts: "📚", publish: "🚀", marketplace: "🛍",
  agents: "🤖", pipelines: "⛓", schedules: "⏰",
  mindmedia: "🎞", history: "🕘", libraries: "🗃", artifacts: "🧩", brain: "🏆",
  "everyday-inbox": "📥", "everyday-plan": "🗓", "everyday-work": "📄",
  community: "👥", "ai-news": "📰", userchat: "💌", together: "🫂",
  workspaces: "🏢", credits: "💳", subscriptions: "↻", reports: "📊",
  setup: "🛠", settings: "⚙️", keys: "🔑", byo: "🖥", mcp: "🧰", integrations: "🤝", extension: "🧷", highlevel: "📇", zapier: "⚡",
  help: "❓", tour: "🧭", "connect-setup": "🔌", updates: "⬇️", news: "🆕", "try-demo": "🧪", "user-guide": "📘", contact: "✉️", about: "ℹ️",
};

export const PLAIN = {
  command: "Type what you want. Auto picks the team.",
  start: "A guided start for something new.",
  projects: "Each project keeps its files, media and memory.",
  liveview: "Who is working, the current step, cost so far and open-in links.",
  compare: "One question to 2 to 6 AIs side by side, with cost and speed. Pick a winner.",
  refocus: "Type a topic, see related past work, rebuild in a click.",
  webbuilders: "Builds a site and shows it in the Build panel.",
  images: "Make or edit pictures.",
  media: "Short videos. Switches maker if one fails.",
  remix: "Pick what to make, preview, build, test, publish.",
  builders: "Other builders: apps, docs, listings.",
  prompts: "The prompt library: ready prompts with blanks to fill.",
  publish: "Preview first, then post. Practice only if not connected.",
  marketplace: "Get or list agents and prompts.",
  agents: "Your own agents: model, instructions, tools, starters.",
  pipelines: "Saved missions. One click, fill 2 or 3 blanks, run.",
  schedules: "Run on a timer, a webhook or a new file. Spend cap. Approve before send.",
  mindmedia: "Everything you made, in one place.",
  history: "Import old chats, search them and keep them in sync.",
  libraries: "Your documents, for AIs to read.",
  artifacts: "Mini apps, charts and drawings from an answer.",
  brain: "Which AI wins at what, from your own jobs.",
  "everyday-inbox": "Inbox summary, replies in your tone, reminders.",
  "everyday-plan": "Morning briefing, find a time, email to a task.",
  "everyday-work": "Find and sum up a doc, meeting prep, lead follow-up.",
  community: "Talk with other Meldmind users.",
  "ai-news": "What is new in AI, in one place.",
  userchat: "Chat with people you work with.",
  together: "Work on one thing with others.",
  workspaces: "Seats and shared spaces. Make this computer the hub.",
  credits: "What each AI has left.",
  subscriptions: "Plans you pay for and what they cover.",
  reports: "Spend, savings and usage.",
  setup: "Scans this computer for AIs and keys.",
  settings: "Every setting on one page.",
  keys: "Add or check the keys for your AIs.",
  byo: "Apps on this computer.",
  mcp: "Add tools the AIs can use.",
  integrations: "Grok Bot assistant and other connections.",
  extension: "Send a page to Meldmind.",
  highlevel: "CRM posts and contacts.",
  zapier: "Connect Zapier and Make.",
  help: "Ask anything about Meldmind.",
  tour: "A one minute tour.",
  "connect-setup": "A checklist to get everything connected.",
  updates: "Get the newest version.",
  news: "Changes in this version.",
  "try-demo": "Practice with sample AIs, no cost.",
  "user-guide": "The full guide.",
  contact: "Send feedback or get in touch.",
  about: "About Meldmind.",
};

const ACTIONS = new Set(["tour", "connect-setup", "news", "demo-on", "updates"]);

function plainFor(id, label) {
  return PLAIN[id] || `Open ${label}.`;
}

function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function rank(group, id) {
  const at = (ORDER[group] || []).indexOf(id);
  return at < 0 ? 999 : at;
}

// views: ids of every page in this install. LABELS: nav.js LABELS. locks: nav.js VIEW_LOCKS.
// src: { helpItems: [...], connectLinks: [...], desktopOnly: [ids hidden on the web app] } from nav.js and desktop-only.js.
export function buildRegistry(views, LABELS = {}, locks = {}, src = {}) {
  const hide = new Set(src.desktopOnly || []);
  const rows = [];
  const seen = new Set();
  const put = (row) => {
    if (!row || !row.id || seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };
  for (const view of views || []) {
    if (!view || hide.has(view)) continue;
    const label = MAC_LABELS[view] || LABELS[view] || view;
    put({ id: view, label, group: VIEW_GROUP[view] || "work", icon: ICONS[view] || "▫️", plain: plainFor(view, label), open: { view } });
  }
  for (const x of EXTRAS) put({ ...x });
  const links = [...(src.connectLinks || [])];
  if (!links.some((l) => l.id === "zapier")) links.push({ id: "zapier", label: "Zapier and Make", view: "settings", focus: "[data-feature='zapier']" });
  for (const l of links) {
    put({ id: l.id, label: l.id === "integrations" ? "Integrations" : l.label, group: "settings", icon: ICONS[l.id] || "🔌", plain: plainFor(l.id, l.label), open: { view: l.view || "settings", focus: l.focus || "" } });
  }
  for (const h of src.helpItems || []) {
    if (h.view && !h.focus) continue; // the plain Search help page is already a view item
    const id = h.id || h.action;
    if (!id) continue;
    const open = h.action ? { action: h.action } : { view: h.view, focus: h.focus || "" };
    if (h.action && !ACTIONS.has(h.action)) continue;
    put({ id, label: h.label, group: "help", icon: ICONS[id] || "❔", plain: plainFor(id, h.label), open });
  }
  const items = rows.map((r) => {
    const lock = locks[r.id];
    return { ...r, lock: lock?.plan || "", lockCap: lock?.cap || "", keywords: r.keywords || "" };
  });
  const order = GROUPS_MAC.map((g) => g.id);
  items.sort((a, b) => (order.indexOf(a.group) - order.indexOf(b.group)) || (rank(a.group, a.id) - rank(b.group, b.id)));
  const counter = {};
  for (const it of items) {
    const n = counter[it.group] = (counter[it.group] ?? -1) + 1;
    it.gradient = GRADIENTS[(hash(it.group) + n) % GRADIENTS.length];
  }
  return items;
}

export function groupsOf(items) {
  return GROUPS_MAC.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter((g) => g.items.length);
}

export function pages(items, perPage = PER_PAGE) {
  const n = Math.max(1, Math.floor(perPage) || PER_PAGE);
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

// Every word typed must appear in the name, the plain words or the extra keywords.
export function search(items, q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice();
  return items.filter((i) => {
    const hay = `${i.label} ${i.plain} ${i.keywords || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// The views that no item opens. Empty means every page is reachable.
export function coverage(allViews, items) {
  const reach = new Set(items.map((i) => i.open?.view).filter(Boolean));
  return [...new Set(allViews || [])].filter((v) => !reach.has(v));
}

// The plan a lock needs on these license limits, or "" when open. Same rule as nav.js lockFor, for an item.
export function lockOf(item, limits) {
  if (!item?.lock) return "";
  if (!limits || typeof limits !== "object") return "";
  const v = limits[item.lockCap];
  if (v === null || v === true || (typeof v === "number" && v > 0)) return "";
  return item.lock;
}
