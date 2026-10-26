// Grouped main menu. Every existing view stays reachable in Expert and in Simple.
// Simple shows Chat, Start a project, Projects, My day, Create, More, Help, and Settings.
// Zapier, Make, and the other connectors are under More > Connections in Simple.
// Settings holds settings only (Settings, Find my AIs). Help holds the tour, Get everything
// connected, updates, What's new, the user guide, contact, and About. Each action has one name
// everywhere. Connect has two sections: Apps and AIs, then People (People, Together, Community).
// Modified keys (Alt, Ctrl, Meta) are ignored so Alt+Space and other hotkeys keep working.
//
// The wide row is chosen from the free space in the top bar (ResizeObserver),
// not from a fixed window width and not from the desktop content-bounds report.
// That report can be smaller than the layout viewport on a scaled or multi-monitor
// display, so it only asks the bar to measure again. Dropdowns stay on one line:
//   narrow  the compact menus (about six, Help included)
//   normal  about eight dropdowns, spread across the free space, when they fit
// If eight menus would overflow the top bar, they merge back.
//
// Priority-plus: free space left after the menus promotes the most used pages
// onto the bar as direct buttons, in a fixed order, as many as fit. A promoted
// page leaves its menu (Create, More, Work, ...) so it is never listed twice.
// Simple: Pro prompts, Builders, Community, Connections. Expert: Command, Start a
// project, Projects, Pro prompts, Builders, Community, Missions, Councils,
// Research, Remix. A promoted row uses normal gaps instead of spreading out.

import { CREATE_VIEWS, DAY_VIEWS } from "./mode.js";
import { isDesktopOnly } from "./desktop-only.js";

export const NAV_NORMAL = 1280;
export const NAV_LAYOUT_WAIT_MS = 150;
// Top bar chrome that is not the menus: padding, brand mark and name, the
// Simple / Expert switch, the month pill, and the connection pill.
export const NAV_CHROME_BASE = 547;
// The "an Everborn product" line and the clock. Hidden when the compact row
// would not fit beside them.
export const NAV_CHROME_EXTRA = 190;

export const GROUP_ORDER = ["work", "create", "business", "connect", "help", "guides"];

// Work (the largest menu) splits into Work, Agents, and Library. Live stays in Work.
export const SPLIT_ORDER = ["work", "agents", "library", "create", "business", "connect", "settings", "guides"];

export const GROUPS = {
  work: { id: "work", label: "Work" },
  create: { id: "create", label: "Create" },
  business: { id: "business", label: "Business" },
  connect: { id: "connect", label: "Connect" },
  help: { id: "help", label: "Settings" },
  guides: { id: "guides", label: "Help" },
};

const SPLIT_GROUPS = {
  work: { id: "work", label: "Work" },
  agents: { id: "agents", label: "Agents" },
  library: { id: "library", label: "Library" },
  create: { id: "create", label: "Create" },
  business: { id: "business", label: "Business" },
  connect: { id: "connect", label: "Connect" },
  settings: { id: "settings", label: "Settings" },
  guides: { id: "guides", label: "Help" },
};

const HOME = {
  command: "work",
  projects: "work",
  compare: "work",
  pipelines: "work",
  agents: "work",
  liveview: "work",
  schedules: "work",
  libraries: "work",
  artifacts: "work",
  history: "work",
  "everyday-inbox": "work",
  "everyday-plan": "work",
  "everyday-work": "work",
  refocus: "work",
  brain: "work",
  prompts: "create",
  images: "create",
  media: "create",
  publish: "create",
  remix: "create",
  builders: "create",
  webbuilders: "create",
  marketplace: "create",
  subscriptions: "business",
  credits: "business",
  workspaces: "business",
  reports: "business",
  // People-to-people pages sit in Connect, in a People section (Chris, 2026-10-21).
  together: "connect",
  userchat: "connect",
  community: "connect",
  settings: "help",
  setup: "help",
  help: "guides",
  start: "work",
};

// Same pages, fewer items per dropdown. groupFor() stays on HOME so mobile and
// the locked menu tests keep the compact group for each view.
const SPLIT_HOME = {
  command: "work",
  projects: "work",
  compare: "work",
  pipelines: "work",
  liveview: "work",
  agents: "agents",
  schedules: "agents",
  libraries: "library",
  artifacts: "library",
  history: "library",
  "everyday-inbox": "work",
  "everyday-plan": "work",
  "everyday-work": "work",
  refocus: "work",
  brain: "library",
  prompts: "create",
  images: "create",
  media: "create",
  publish: "create",
  remix: "create",
  builders: "create",
  webbuilders: "create",
  marketplace: "create",
  subscriptions: "business",
  credits: "business",
  workspaces: "business",
  reports: "business",
  together: "connect",
  userchat: "connect",
  community: "connect",
  settings: "settings",
  setup: "settings",
  start: "work",
  help: "guides",
};

export const LABELS = {
  command: "Command",
  projects: "Projects",
  compare: "Compare",
  pipelines: "Pipelines",
  agents: "Agents",
  liveview: "Live",
  schedules: "Schedules",
  libraries: "Libraries",
  artifacts: "Artifacts",
  history: "History",
  "everyday-inbox": "Inbox and tasks",
  "everyday-plan": "Day plan",
  "everyday-work": "Docs and follow-up",
  refocus: "Refocus",
  brain: "Who's best",
  prompts: "Pro prompts",
  images: "Images",
  media: "Media",
  publish: "Publish",
  remix: "Remix",
  builders: "Builders",
  webbuilders: "Web and marketing",
  marketplace: "Marketplace",
  subscriptions: "Subscriptions",
  credits: "Credits",
  workspaces: "Teams",
  together: "Together",
  userchat: "People",
  reports: "Reports",
  community: "Community",
  settings: "Settings",
  // Settings > Find my AIs is the longer setup page (keys on this PC, browser history,
  // bookmarks). Help > Get everything connected is the integrations checklist. 0.4.17.
  setup: "Find my AIs",
  help: "Search help",
  start: "Start a project",
};

const SETUP_AGAIN = { id: "connect-setup", label: "Get everything connected", action: "connect-setup", home: false };
const TOUR_ITEM = { id: "tour", label: "Take the tour", action: "tour", home: false };
const NEWS_ITEM = { id: "news", label: "What's new", action: "news", home: false };
const DEMO_ITEM = { id: "try-demo", label: "Try demo mode", action: "demo-on", home: false };
const UPDATES_ITEM = { id: "updates", label: "Check for updates", action: "updates", home: false };
const GUIDE_ITEM = { id: "user-guide", label: "User guide", view: "help", focus: "#can-do", home: false };
const CONTACT_ITEM = { id: "contact", label: "Contact and feedback", view: "help", focus: "#help-contact", home: false };
const ABOUT_ITEM = { id: "about", label: "About Meldmind", view: "help", focus: "#help-about", home: false };
const START_ITEM = { id: "start-project", label: "Start a project", view: "start", home: false };

// The Help menu, in this order, in Simple and Expert and at every width.
// The web app has no setup scan and no updater, so those two are desktop only.
export function helpItems(surface = "") {
  const web = surface === "web";
  return [
    { view: "help", label: LABELS.help, home: true },
    { ...TOUR_ITEM },
    ...(web ? [] : [{ ...SETUP_AGAIN }, { ...UPDATES_ITEM }]),
    { ...NEWS_ITEM },
    { ...DEMO_ITEM },
    { ...GUIDE_ITEM },
    { ...CONTACT_ITEM },
    { ...ABOUT_ITEM },
  ];
}

// Every data-action a menu item can carry, and who handles it.
export const MENU_ACTIONS = {
  tour: "window.CC.tour.start (web/app.js menu click)",
  "connect-setup": "window.CC.connectSetup.open (web/app.js menu click)",
  news: "window.CC.tour.openNews (web/app.js menu click)",
  "demo-on": "setDemo(true) (web/app.js menu click)",
  updates: "manualCheck (web/features/updates.js document click)",
};

// Pages that need a paid plan. The menu item still opens the page, which explains
// the plan. The note is only a label. cap is the licence limit that unlocks it.
export const VIEW_LOCKS = {
  pipelines: { cap: "missions", plan: "Pro" },
  schedules: { cap: "scheduler", plan: "Pro" },
  history: { cap: "historySearch", plan: "Pro" },
  subscriptions: { cap: "subscriptionsTab", plan: "Pro" },
  workspaces: { cap: "teamSeats", plan: "Extreme" },
};

// The plan a view needs on these limits, or "" when it is open. No limits means
// the licence has not loaded yet, so nothing is marked.
export function lockFor(view, limits) {
  const lock = VIEW_LOCKS[view];
  if (!lock || !limits || typeof limits !== "object") return "";
  const v = limits[lock.cap];
  if (v === null || v === true || (typeof v === "number" && v > 0)) return "";
  return lock.plan;
}

export function lockNote(plan) {
  return plan ? `Part of ${plan}. The page explains the plan. Add a licence key in Settings.` : "";
}

// What the Settings menu is allowed to hold, in every layout: settings pages only.
export const SETTINGS_VIEWS = ["settings", "setup"];
export const SETTINGS_ACTIONS = [];

export function menuLabeledSettings(model) {
  return (model || []).find((g) => g.label === "Settings") || null;
}

export function isSettingsItem(item) {
  if (!item || item.action) return false;
  return !!(item.view && SETTINGS_VIEWS.includes(item.view) && !item.focus);
}

// Start a project sits right before Projects, in Simple and Expert.
function ensureStart(bucket) {
  const at = bucket.findIndex((i) => i.view === "start");
  const start = at >= 0 ? bucket.splice(at, 1)[0] : { ...START_ITEM };
  const projects = bucket.findIndex((i) => i.view === "projects");
  if (projects >= 0) bucket.splice(projects, 0, start);
  else bucket.push(start);
}

// Button text for one dropdown, matching the trigger labels in the bar.
export function rowLabels(layout) {
  if (layout === "normal") return SPLIT_ORDER.map((id) => SPLIT_GROUPS[id].label);
  return GROUP_ORDER.map((id) => GROUPS[id].label);
}

// Inter at 14px, weight 600, plus 8px of horizontal padding on each trigger.
const CHAR_PX = 8.2;
const TRIGGER_PAD = 16;
const TRIGGER_GAP = 4;
const TABS_BOX = 8;

export function menusWidth(labels, gap = TRIGGER_GAP) {
  let n = TABS_BOX;
  for (let i = 0; i < labels.length; i++) {
    if (i) n += gap;
    n += TRIGGER_PAD + Math.ceil(String(labels[i] || "").length * CHAR_PX);
  }
  return n;
}

export function compactNeed() { return menusWidth(rowLabels("narrow")); }
export function eightNeed() { return menusWidth(rowLabels("normal")); }

// Below this CSS width the product line and the clock are hidden, so the menus
// keep the row. A full bar (those extras plus eight menus) needs about this much.
export const NAV_TRIM_AT = 1660;

export function chromeWidth(width) {
  const w = Number(width) || 0;
  return NAV_CHROME_BASE + (w > NAV_TRIM_AT ? NAV_CHROME_EXTRA : 0);
}

export function navAvailable(width) {
  const w = Number(width);
  if (!Number.isFinite(w)) return 0;
  return Math.max(0, w - chromeWidth(w));
}

// Smallest window width where eight dropdowns fit. Under NAV_TRIM_AT the product
// line and the clock are gone, so the row fits sooner than on the full bar.
export function eightMenuMin() {
  const trimmed = eightNeed() + NAV_CHROME_BASE;
  const full = trimmed + NAV_CHROME_EXTRA;
  if (trimmed <= NAV_TRIM_AT) return trimmed;
  return full;
}

// Eight dropdowns when they fit. Otherwise the compact row. Never a second line.
export function navLayout(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w < 1) return "narrow";
  if (eightNeed() <= navAvailable(w)) return "normal";
  return "narrow";
}

export function navSingleRow(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w < 1) return true;
  const need = menusWidth(rowLabels(navLayout(w)));
  if (need <= w - NAV_CHROME_BASE - NAV_CHROME_EXTRA) return true;
  return need <= w - NAV_CHROME_BASE;
}

export function rowOverflows(root) {
  if (!root) return false;
  const bar = root.closest?.(".topbar") || root.parentElement;
  if (bar && bar.scrollWidth > bar.clientWidth + 1) return true;
  return root.scrollWidth > root.clientWidth + 1;
}

export function readNavWidth(win = globalThis) {
  const inner = win?.innerWidth;
  if (Number.isFinite(inner) && inner > 0) return inner;
  const client = win?.document?.documentElement?.clientWidth;
  if (Number.isFinite(client) && client > 0) return client;
  return 0;
}

export function readNavDisplay(win = globalThis) {
  const s = win?.screen;
  return { width: Number(s?.width) || 0, height: Number(s?.height) || 0 };
}

// The desktop app reports a move or a display change so the bar can measure again.
// Its width is not the breakpoint: on a scaled multi-monitor desktop that number
// can be smaller than the layout viewport and would lock the compact row.
let reported = null;
let cssAt = 0;
let lastSlot = 0;

export function resetNavMeasure() {
  reported = null;
  cssAt = 0;
  lastSlot = 0;
}

export function noteNavDisplay(metrics) {
  const width = Number(metrics?.width);
  const screenWidth = Number(metrics?.screenWidth);
  const screenHeight = Number(metrics?.screenHeight);
  reported = {
    width: Number.isFinite(width) && width > 0 ? width : 0,
    screenWidth: Number.isFinite(screenWidth) && screenWidth > 0 ? screenWidth : 0,
    screenHeight: Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : 0,
    at: Date.now(),
  };
  return reported;
}

function pxOf(style, name) {
  if (!style) return 0;
  const n = parseFloat(style[name]);
  return Number.isFinite(n) ? n : 0;
}

function boxWidth(el) {
  if (!el) return 0;
  const rect = el.getBoundingClientRect?.();
  if (rect && rect.width > 0) return rect.width;
  return el.offsetWidth || 0;
}

function computed(el) {
  try { return typeof getComputedStyle === "function" ? getComputedStyle(el) : null; } catch { return null; }
}

// Free width for the menus. The right cluster is flex-grow, so its border box
// is not its content. Sum the children instead, or a wide bar looks empty.
export function measureMenuSlot(bar) {
  if (!bar || !(bar.clientWidth > 0)) return 0;
  const style = computed(bar);
  const pad = style ? pxOf(style, "paddingLeft") + pxOf(style, "paddingRight") : 36;
  const gap = style ? (pxOf(style, "columnGap") || pxOf(style, "gap") || 24) : 24;
  const brandW = boxWidth(bar.querySelector?.(".brand"));
  const right = bar.querySelector?.(".top-right");
  let rightW = 0;
  if (right) {
    const widths = [...(right.children || [])].map(boxWidth).filter((w) => w > 0);
    if (widths.length) {
      const rs = computed(right);
      const childGap = rs ? (pxOf(rs, "columnGap") || pxOf(rs, "gap") || 12) : 12;
      const summed = widths.reduce((n, w) => n + w, 0) + childGap * Math.max(0, widths.length - 1);
      // scrollWidth stays at the content size when a flex sibling has squeezed the box
      rightW = Math.max(summed, right.scrollWidth || 0);
    }
  }
  let gaps = 0;
  if (brandW > 0) gaps += gap;
  if (rightW > 0) gaps += gap;
  return Math.max(0, bar.clientWidth - pad - brandW - rightW - gaps);
}

export function layoutForSlot(slot) {
  const s = Number(slot);
  if (!Number.isFinite(s) || s < 1) return "narrow";
  return eightNeed() <= s ? "normal" : "narrow";
}

export function measureNav(win = globalThis) {
  const css = readNavWidth(win);
  const fromWin = readNavDisplay(win);
  let display = { width: fromWin.width, height: fromWin.height };
  if (reported?.screenWidth > 0 && reported?.screenHeight > 0) display = { width: reported.screenWidth, height: reported.screenHeight };
  return { width: lastSlot > 0 ? lastSlot : css, display, slot: lastSlot };
}

export function currentNavLayout(win = globalThis) {
  if (lastSlot > 0) return layoutForSlot(lastSlot);
  return navLayout(readNavWidth(win));
}

function splitLayout(layout) {
  return layout === "normal";
}

export function groupIdFor(view, layout = "narrow") {
  if (splitLayout(layout) && SPLIT_HOME[view]) return SPLIT_HOME[view];
  return groupFor(view);
}

// Same Settings page, scrolled to the panel. Not a second copy of the app.
// Connect has two sections: Apps and AIs (the links below), then People.
export const APPS_SECTION = "Apps and AIs";
export const PEOPLE_SECTION = "People";
export const PEOPLE_ORDER = ["userchat", "together", "community"];
export const BUSINESS_ORDER = ["credits", "subscriptions", "reports", "workspaces"];

export const CONNECT_LINKS = [
  { id: "keys", label: "Keys and providers", view: "settings", focus: "#settings-keys" },
  { id: "byo", label: "Your apps", view: "settings", focus: "[data-feature='byo']" },
  { id: "mcp", label: "Tools (MCP)", view: "settings", focus: "[data-feature='mcp']" },
  { id: "integrations", label: "Integrations", view: "settings", focus: "[data-feature='grokbot']" },
  { id: "extension", label: "Browser extension", view: "settings", focus: "[data-feature='extension']" },
  { id: "highlevel", label: "HighLevel", view: "settings", focus: "[data-feature='highlevel']" },
];

// Simple: More > Connections. Same Settings panels, opened past the basics.
// MCP and Integrations stay in Expert (their panels are Expert only).
export const SIMPLE_CONNECT_LINKS = [
  { id: "zapier", label: "Zapier and Make", view: "settings", focus: "[data-feature='zapier']" },
  ...CONNECT_LINKS.filter((l) => l.id !== "mcp" && l.id !== "integrations"),
].map((l) => ({ ...l, section: "Connections" }));

export function groupFor(view) {
  return HOME[view] || "work";
}

// Gap between items on a promoted row. Normal spacing, not spread.
export const PROMOTE_GAP = 8;

// Promotion order. view + focus or runMode opens Command set up for that kind of
// run. Those three are shortcuts, not menu items, so nothing leaves a menu for them.
export const SIMPLE_PROMOTE = [
  { id: "prompts", label: LABELS.prompts, view: "prompts" },
  { id: "builders", label: LABELS.builders, view: "builders" },
  { id: "community", label: LABELS.community, view: "community" },
  { id: "connections", label: "Connections", menu: true },
];

export const COMMAND_MODES = {
  mission: "Mission mode: describe the goal",
  council: "Council mode: ask several AIs",
  research: "Research: ask with sources",
};

export function shortcutModeOf(item) {
  if (!item) return "";
  const ds = item.dataset || item;
  if (ds.view && ds.view !== "command") return "";
  if (ds.runMode) return ds.runMode;
  if (ds.focus === "#cc-search-cmd") return "research";
  return "";
}

export function commandHeading(mode, uiMode = "expert") {
  if (uiMode === "simple") return "Chat";
  return COMMAND_MODES[mode] || "Marching orders";
}

export const EXPERT_PROMOTE = [
  { id: "command", label: LABELS.command, view: "command" },
  { id: "start", label: LABELS.start, view: "start" },
  { id: "projects", label: LABELS.projects, view: "projects" },
  { id: "prompts", label: LABELS.prompts, view: "prompts" },
  { id: "builders", label: LABELS.builders, view: "builders" },
  { id: "community", label: LABELS.community, view: "community" },
  { id: "missions", label: "Missions", view: "command", runMode: "mission" },
  { id: "councils", label: "Councils", view: "command", runMode: "council" },
  { id: "research", label: "Research", view: "command", focus: "#cc-search-cmd", runMode: "research" },
  { id: "remix", label: LABELS.remix, view: "remix" },
];

const SIMPLE_ROW = ["Chat", "Start a project", "Projects", "\u2600 My day", "Create", "More", "Help", "Settings"];

// The candidates this install has, in promotion order.
export function promotable(mode, views, surface = "") {
  const web = surface === "web";
  const have = new Set(web ? (views || []).filter((view) => !isDesktopOnly(view)) : (views || []));
  have.add("start");
  const list = mode === "simple" ? SIMPLE_PROMOTE : EXPERT_PROMOTE;
  return list.filter((p) => p.menu || have.has(p.view));
}

// Promoted entries for these ids, in promotion order.
// Start a project comes up only together with Projects, so it stays right before it.
export function promotedItems(mode, views, surface = "", promote = []) {
  const ids = new Set(promote || []);
  const all = promotable(mode, views, surface);
  const out = all.filter((p) => ids.has(p.id));
  const pair = all.some((p) => p.id === "projects") && !ids.has("projects");
  return pair ? out.filter((p) => p.id !== "start") : out;
}

// A promoted page that leaves its menu (not a Command shortcut).
function leavesMenu(p) {
  return !!p.view && !p.focus && !p.runMode;
}

// Which candidates fit in this free width, in order. Stops at the first that does
// not fit, so the row always keeps the top of the list.
export function promoteFor(mode, views, slot, layout = "narrow", surface = "") {
  const s = Number(slot);
  if (!Number.isFinite(s) || s < 1) return [];
  const base = mode === "simple" ? SIMPLE_ROW : rowLabels(layout);
  const labels = [...base];
  const out = [];
  for (const p of promotable(mode, views, surface)) {
    labels.push(p.label);
    if (menusWidth(labels, PROMOTE_GAP) > s) break;
    out.push(p.id);
  }
  return out;
}

// Free width for the promotion check. Same source as the layout.
export function currentNavPromote(mode, views, layout = "narrow", surface = "", win = globalThis) {
  const slot = lastSlot > 0 ? lastSlot : navAvailable(readNavWidth(win));
  return promoteFor(mode === "simple" ? "simple" : "expert", views, slot, layout, surface);
}

export function menuModel(views, layout = "narrow", opts = {}) {
  const web = opts.surface === "web";
  const up = promotedItems("expert", views, opts.surface, opts.promote);
  const gone = new Set(up.filter(leavesMenu).map((p) => p.view));
  const split = splitLayout(layout);
  const order = split ? SPLIT_ORDER : GROUP_ORDER;
  const groups = split ? SPLIT_GROUPS : GROUPS;
  const buckets = Object.fromEntries(order.map((id) => [id, []]));
  const seen = new Set();
  const source = web ? (views || []).filter((view) => !isDesktopOnly(view)) : (views || []);
  for (const view of source) {
    if (!view || seen.has(view)) continue;
    seen.add(view);
    const gid = groupIdFor(view, layout);
    (buckets[gid] || buckets[groupFor(view)]).push({ view, label: LABELS[view] || view, home: true });
  }
  // Connect: Apps and AIs first, then People (People, Together, Community).
  const people = buckets.connect.splice(0).map((i) => ({ ...i, section: PEOPLE_SECTION }))
    .sort((a, b) => PEOPLE_ORDER.indexOf(a.view) - PEOPLE_ORDER.indexOf(b.view));
  for (const link of CONNECT_LINKS) buckets.connect.push({ ...link, home: false, section: APPS_SECTION });
  buckets.connect.push(...people);
  // Business keeps money and team pages, in this order.
  buckets.business.sort((a, b) => BUSINESS_ORDER.indexOf(a.view) - BUSINESS_ORDER.indexOf(b.view));
  // Start a project belongs with Projects, in Work. It is not a settings item.
  ensureStart(buckets.work);
  const help = buckets.guides;
  const rest = help.filter((i) => i.view !== "help");
  help.length = 0;
  help.push(...helpItems(web ? "web" : ""), ...rest);
  const promoted = up.map((p) => ({ id: `up-${p.id}`, label: p.label, direct: true, promoted: true, items: [{ view: p.view, label: p.label, focus: p.focus, runMode: p.runMode, home: leavesMenu(p) }] }));
  const menus = order.map((id) => ({ ...groups[id], items: buckets[id].filter((i) => !(i.view && !i.focus && !i.action && gone.has(i.view))) }));
  return [...promoted, ...menus];
}

// Every item a mounted menu can show, for the audit test and docs/menu-audit-0.4.13.md.
export function allMenuItems(views, { mode = "expert", layout = "narrow", surface = "", promote = [] } = {}) {
  if (mode === "simple") return simpleModel(views, surface, promote).flatMap((g) => g.items.map((i) => ({ ...i, menu: g.label })));
  return menuModel(views, layout, { surface, promote }).flatMap((g) => g.items.map((i) => ({ ...i, menu: g.label })));
}

// Keyboard inside one menu. Alt, Ctrl, and Meta are not handled here.
export function navKey(state, key, { altKey = false, ctrlKey = false, metaKey = false } = {}) {
  if (altKey || ctrlKey || metaKey) return { ...state, action: "ignore" };
  const count = state.count || 0;
  if (!state.open) {
    if (key === "ArrowDown" || key === "Enter" || key === " ") return { open: true, index: 0, action: "open" };
    if (key === "ArrowRight") return { ...state, action: "next-menu" };
    if (key === "ArrowLeft") return { ...state, action: "prev-menu" };
    return { ...state, action: "none" };
  }
  if (key === "Escape" || key === "Tab") return { open: false, index: 0, action: "close" };
  if (key === "ArrowDown") return { open: true, index: count ? (state.index + 1) % count : 0, action: "move" };
  if (key === "ArrowUp") return { open: true, index: count ? (state.index - 1 + count) % count : 0, action: "move" };
  if (key === "Home") return { open: true, index: 0, action: "move" };
  if (key === "End") return { open: true, index: Math.max(0, count - 1), action: "move" };
  if (key === "Enter" || key === " ") return { open: false, index: state.index || 0, action: "activate" };
  if (key === "ArrowRight") return { open: false, index: 0, action: "next-menu" };
  if (key === "ArrowLeft") return { open: false, index: 0, action: "prev-menu" };
  return { ...state, action: "type" };
}

const CSS = `
.topbar { flex-wrap: nowrap; }
.topbar > .tabs.nav-ready { flex: 1 1 auto; min-width: 0; justify-content: space-between; }
.topbar > .top-right { flex: 0 0 auto; }
.tabs, .tabs.nav-ready, .tabs.nav-split { display: flex; flex-wrap: nowrap; align-items: stretch; overflow: visible; }
.tabs.nav-ready { gap: 8px; }
.tabs.nav-split { gap: 16px; }
.tabs.nav-ready:not(.nav-split) { gap: 2px; }
.tabs.nav-ready.nav-promoted { justify-content: flex-start; gap: ${PROMOTE_GAP}px; }
.nav-menu { position: relative; flex: 0 0 auto; }
.tabs .nav-trigger, .tabs button.nav-direct { white-space: nowrap; padding: 6px 8px; }
.tabs.nav-ready:not(.nav-split) .nav-trigger, .tabs.nav-ready:not(.nav-split) button.nav-direct { padding-left: 4px; padding-right: 4px; }
.tabs.nav-ready.nav-promoted .nav-trigger, .tabs.nav-ready.nav-promoted button.nav-direct { padding-left: 8px; padding-right: 8px; }
.nav-trigger { background: transparent; border: 0; border-radius: 8px; color: var(--muted); cursor: pointer; font-weight: 600; }
.nav-trigger:hover, .nav-trigger[aria-expanded="true"] { color: var(--text); }
.nav-trigger.active { background: #1a2436; color: #fff; box-shadow: inset 0 0 0 1px #2b3a52; }
.nav-panel { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; min-width: 220px; max-height: 70vh; overflow: auto; padding: 6px; background: var(--card-bg, #0d1420); border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 16px 40px #000a; display: none; }
.nav-menu.open .nav-panel { display: flex; flex-direction: column; gap: 2px; }
.nav-panel button { text-align: left; background: transparent; border: 0; border-radius: 8px; color: var(--text); padding: 8px 10px; cursor: pointer; }
.nav-panel button:hover, .nav-panel button:focus { background: #1a2436; outline: none; }
.nav-panel button.active { color: var(--accent-2); }
.nav-section { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); padding: 8px 10px 2px; border-top: 1px solid var(--line-2); margin-top: 4px; }
.nav-lock { color: var(--amber, #f59e0b); font-size: 12px; margin-left: 4px; }
.nav-menu:nth-last-child(-n+3) .nav-panel { left: auto; right: 0; }
@media (max-width: ${NAV_TRIM_AT}px) { .brand-tag, .clock { display: none; } }
.mobile-more-label { grid-column: 1 / -1; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); padding: 6px 4px 0; }
.mobile-more-group { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
`;

export function ensureNavStyle() {
  if (typeof document === "undefined" || document.getElementById("cc-nav-style")) return;
  const style = document.createElement("style");
  style.id = "cc-nav-style";
  style.textContent = CSS;
  document.head.appendChild(style);
}

function closeMenus(root) {
  root.querySelectorAll(".nav-menu.open").forEach((menu) => {
    menu.classList.remove("open");
    const trigger = menu.querySelector(".nav-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function itemButton(item) {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("role", "menuitem");
  b.textContent = item.label;
  if (item.view) b.dataset.view = item.view;
  if (item.focus) b.dataset.focus = item.focus;
  if (item.action) b.dataset.action = item.action;
  if (item.runMode) b.dataset.runMode = item.runMode;
  if (item.view === "setup") b.id = "tab-setup";
  return b;
}

function menuShell(id, label) {
  const menu = document.createElement("div");
  menu.className = "nav-menu";
  menu.dataset.menu = id;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "nav-trigger";
  trigger.textContent = label;
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `nav-panel-${id}`);
  const panel = document.createElement("div");
  panel.className = "nav-panel";
  panel.id = `nav-panel-${id}`;
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", label);
  menu.append(trigger, panel);
  return { menu, panel };
}

function buttonFor(buttons, view, label) {
  const existing = buttons.find((b) => b.dataset.view === view && !b.dataset.focus);
  const btn = existing || itemButton({ view, label });
  btn.textContent = label || btn.textContent || LABELS[view] || view;
  btn.setAttribute("role", "menuitem");
  if (view === "setup") btn.id = "tab-setup";
  return btn;
}

// Simple keeps a short row. Pages that are not on it are under More, grouped the
// same way as Expert, so every page is still one click away.
const SIMPLE_TOP = new Set(["command", "start", "projects", "help", "settings", ...CREATE_VIEWS, ...DAY_VIEWS]);

export function simpleModel(views, surface = "", promote = []) {
  const web = surface === "web";
  const have = new Set(web ? (views || []).filter((view) => !isDesktopOnly(view)) : (views || []));
  const up = promotedItems("simple", views, surface, promote);
  const gone = new Set(up.filter(leavesMenu).map((p) => p.view));
  const day = [["everyday-inbox", "Inbox and tasks"], ["everyday-plan", "Day plan"], ["userchat", "People"]]
    .filter(([view]) => have.has(view)).map(([view, label]) => ({ view, label, home: true }));
  const create = CREATE_VIEWS.filter((view) => have.has(view) && !gone.has(view)).map((view) => ({ view, label: LABELS[view], home: true }));
  const more = [];
  const people = [];
  for (const view of have) {
    if (SIMPLE_TOP.has(view) || gone.has(view)) continue;
    if (PEOPLE_ORDER.includes(view)) people.push({ view, label: LABELS[view] || view, home: true, section: PEOPLE_SECTION });
    else more.push({ view, label: LABELS[view] || view, home: true });
  }
  // Same order as Expert: People pages in their own section, after the plain pages.
  more.push(...people.sort((a, b) => PEOPLE_ORDER.indexOf(a.view) - PEOPLE_ORDER.indexOf(b.view)));
  const connections = up.some((p) => p.menu);
  if (!connections) for (const link of SIMPLE_CONNECT_LINKS) more.push({ ...link, home: false });
  const promoted = up.map((p) => p.menu
    ? { id: "connections", label: p.label, promoted: true, items: SIMPLE_CONNECT_LINKS.map(({ section, ...link }) => ({ ...link, home: false })) }
    : { id: `up-${p.id}`, label: p.label, direct: true, promoted: true, items: [{ view: p.view, label: p.label, home: true }] });
  return [
    { id: "chat", label: "Chat", direct: true, items: [{ view: "command", label: "Chat", home: true }] },
    { id: "start", label: "Start a project", direct: true, items: [{ view: "start", label: "Start a project", home: true }] },
    { id: "projects", label: "Projects", direct: true, items: [{ view: "projects", label: "Projects", home: true }] },
    { id: "myday", label: "My day", items: day },
    ...promoted,
    { id: "create", label: "Create", items: create },
    { id: "more", label: "More", items: more },
    { id: "guides", label: "Help", items: helpItems(surface) },
    { id: "settings", label: "Settings", direct: true, items: [{ view: "settings", label: "Settings", home: true }] },
  ];
}

function mountItems(panel, buttons, items) {
  let section = "";
  for (const item of items) {
    if (item.section && item.section !== section) {
      section = item.section;
      const head = document.createElement("div");
      head.className = "nav-section";
      head.dataset.section = section;
      head.setAttribute("role", "presentation");
      head.textContent = section;
      panel.appendChild(head);
    }
    if (item.home && item.view && !item.focus) panel.appendChild(buttonFor(buttons, item.view, item.label));
    else panel.appendChild(itemButton(item));
  }
}

function directButton(buttons, item) {
  const btn = item.focus || item.runMode ? itemButton(item) : buttonFor(buttons, item.view, item.label);
  btn.classList.add("nav-direct", "nav-promoted");
  btn.removeAttribute("role");
  return btn;
}

function mountExpert(root, views, buttons, layout, surface, promote) {
  const model = menuModel(views, layout, { surface, promote });
  for (const group of model) {
    if (group.direct) {
      root.appendChild(directButton(buttons, group.items[0]));
      continue;
    }
    const { menu, panel } = menuShell(group.id, group.label);
    mountItems(panel, buttons, group.items);
    root.appendChild(menu);
  }
}

function mountSimple(root, views, buttons, surface, promote) {
  for (const group of simpleModel(views, surface, promote)) {
    if (group.promoted && group.direct) {
      root.appendChild(directButton(buttons, group.items[0]));
      continue;
    }
    if (group.direct) {
      const item = group.items[0];
      let btn;
      if (item.view === "command") btn = buttonFor(buttons, "command", "Chat");
      else if (item.view === "start") btn = buttonFor(buttons, "start", "Start a project");
      else if (item.view === "projects") btn = buttonFor(buttons, "projects", "Projects");
      else btn = buttonFor(buttons, item.view, item.label);
      btn.classList.add("nav-direct");
      btn.removeAttribute("role");
      root.appendChild(btn);
      continue;
    }
    // My day, Create, and More hide when they would be empty.
    if (!group.items.length && group.id !== "guides") continue;
    const shell = menuShell(group.id, group.label);
    if (group.id === "myday") {
      const trigger = shell.menu.querySelector(".nav-trigger");
      if (trigger) trigger.textContent = "\u2600 My day";
    }
    mountItems(shell.panel, buttons, group.items);
    root.appendChild(shell.menu);
  }
}

// Rebuilds when the mode or the width layout changes. The same pair is left in place so a re-render does not drop focus.
export function installNav(root, views, mode = "expert", layout = "narrow", surface = "", promote = []) {
  if (!root) return root;
  mode = mode === "simple" ? "simple" : "expert";
  layout = layout === "normal" ? "normal" : "narrow";
  surface = surface === "web" ? "web" : "";
  const up = promotedItems(mode, views, surface, promote).map((p) => p.id);
  const upKey = up.join(",");
  if (root.dataset.nav === "1" && root.dataset.uiMode === mode && root.dataset.navLayout === layout && (root.dataset.navSurface || "") === surface && (root.dataset.navPromote || "") === upKey) return root;
  ensureNavStyle();
  const buttons = [...root.querySelectorAll("button[data-view]")].filter((b) => !b.dataset.focus && !b.dataset.action && !b.dataset.runMode);
  for (const b of buttons) b.remove();
  root.textContent = "";
  root.classList.add("nav-ready");
  root.classList.toggle("nav-split", layout === "normal");
  root.classList.toggle("nav-promoted", up.length > 0);
  root.dataset.navPromote = upKey;
  root.dataset.nav = "1";
  root.dataset.uiMode = mode;
  root.dataset.navLayout = layout;
  root.dataset.navSurface = surface;
  if (mode === "simple") mountSimple(root, views, buttons, surface, up);
  else mountExpert(root, views, buttons, layout, surface, up);
  if (!root.dataset.navKeys) {
    root.dataset.navKeys = "1";
    root.addEventListener("keydown", onNavKey);
  }
  return root;
}

// Resize, matchMedia (both directions), zoom / devicePixelRatio, and the desktop
// display channel. Each one asks the top bar to measure its own free space.
// The first read is immediate. Later reads wait so a drag does not rebuild the
// bar on every pixel. The returned function removes every listener.
export function watchNavLayout(onChange, win = globalThis) {
  if (!win || typeof win.matchMedia !== "function" || typeof onChange !== "function") return () => {};
  let timer = null;
  let first = true;
  let ro = null;
  const readSlot = () => {
    const bar = win?.document?.querySelector?.(".topbar");
    if (!bar) return;
    const slot = measureMenuSlot(bar);
    if (slot > 0) lastSlot = slot;
  };
  const emit = () => { readSlot(); onChange(currentNavLayout(win)); };
  const armObserver = () => {
    if (ro || typeof win.ResizeObserver !== "function") return;
    const bar = win?.document?.querySelector?.(".topbar");
    if (!bar) return;
    try {
      ro = new win.ResizeObserver(() => schedule());
      // The update button is added to the right cluster after the first measure.
      // Watching that cluster, then the bar, so a late button shrinks the menu slot
      // instead of covering Settings and Help. The bar is observed last.
      const right = bar.querySelector?.(".top-right");
      if (right) ro.observe(right);
      ro.observe(bar);
    } catch { ro = null; }
  };
  const schedule = () => {
    armObserver();
    if (first) { first = false; emit(); return; }
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; emit(); }, NAV_LAYOUT_WAIT_MS);
  };
  const onCss = () => { cssAt = Date.now(); schedule(); };
  win.addEventListener?.("resize", onCss);
  const splitAt = eightMenuMin();
  const queries = [
    `(min-width: ${NAV_NORMAL}px)`,
    `(max-width: ${NAV_NORMAL - 1}px)`,
    `(min-width: ${splitAt}px)`,
    `(max-width: ${splitAt - 1}px)`,
    `(min-device-width: ${NAV_NORMAL}px)`,
    `(max-device-width: ${NAV_NORMAL - 1}px)`,
    `(min-device-width: ${splitAt}px)`,
    `(max-device-width: ${splitAt - 1}px)`,
  ];
  const lists = queries.map((q) => win.matchMedia(q));
  for (const mq of lists) mq.addEventListener?.("change", onCss);
  const ratioListeners = [];
  let ratio = win.devicePixelRatio || 1;
  const watchRatio = () => {
    const mq = win.matchMedia(`(resolution: ${ratio}dppx)`);
    const onRes = () => {
      ratio = win.devicePixelRatio || ratio;
      onCss();
      watchRatio();
    };
    mq.addEventListener?.("change", onRes);
    ratioListeners.push([mq, onRes]);
  };
  watchRatio();
  const vv = win.visualViewport;
  vv?.addEventListener?.("resize", onCss);
  let offDesktop = () => {};
  if (typeof win.ccDesktop?.onNavDisplay === "function") {
    offDesktop = win.ccDesktop.onNavDisplay((payload) => { noteNavDisplay(payload); schedule(); }) || (() => {});
  }
  schedule();
  return () => {
    clearTimeout(timer);
    timer = null;
    try { ro?.disconnect(); } catch { /* already gone */ }
    ro = null;
    win.removeEventListener?.("resize", onCss);
    vv?.removeEventListener?.("resize", onCss);
    for (const mq of lists) mq.removeEventListener?.("change", onCss);
    for (const [mq, fn] of ratioListeners) mq.removeEventListener?.("change", fn);
    try { offDesktop(); } catch { /* already gone */ }
  };
}

function menuState(menu) {
  const items = [...menu.querySelectorAll("[role='menuitem']")];
  const index = Math.max(0, items.indexOf(document.activeElement));
  return { open: menu.classList.contains("open"), index, count: items.length, items };
}

function onNavKey(e) {
  const trigger = e.target.closest?.(".nav-trigger");
  const item = e.target.closest?.("[role='menuitem']");
  const menu = (trigger || item)?.closest?.(".nav-menu");
  if (!menu) return;
  const st = menuState(menu);
  const next = navKey({ open: st.open, index: item ? st.index : 0, count: st.count }, e.key, { altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
  if (next.action === "ignore" || next.action === "none" || next.action === "type") return;
  if (next.action === "next-menu" || next.action === "prev-menu") {
    const menus = [...menu.parentElement.querySelectorAll(".nav-menu")];
    const at = menus.indexOf(menu);
    const dest = menus[(at + (next.action === "next-menu" ? 1 : menus.length - 1)) % menus.length];
    closeMenus(menu.parentElement);
    dest.querySelector(".nav-trigger")?.focus();
    e.preventDefault();
    return;
  }
  if (next.action === "open") {
    closeMenus(menu.parentElement);
    menu.classList.add("open");
    menu.querySelector(".nav-trigger")?.setAttribute("aria-expanded", "true");
    st.items[0]?.focus();
    e.preventDefault();
    return;
  }
  if (next.action === "close") {
    closeMenus(menu.parentElement);
    menu.querySelector(".nav-trigger")?.focus();
    if (e.key !== "Tab") e.preventDefault();
    return;
  }
  if (next.action === "move") {
    st.items[next.index]?.focus();
    e.preventDefault();
    return;
  }
  if (next.action === "activate") {
    st.items[next.index]?.click();
    e.preventDefault();
  }
}

function tuneItem(_root, btn) {
  return btn;
}

// A page button on the bar itself (a promoted page or a Simple direct button).
const PAGE_BUTTON = ":not([data-focus]):not([data-run-mode])";

export function placeNavItem(root, view, label) {
  if (!root) return;
  if (root.querySelector(`.nav-promoted[data-view="${globalThis.CSS.escape(view)}"]${PAGE_BUTTON}`)) return;
  if (root.dataset.uiMode === "simple") {
    if (view === "help" || view === "settings") return;
    if (root.querySelector(`button[data-view="${globalThis.CSS.escape(view)}"]:not([data-focus])`)) return;
    if (view === "start") {
      const btn = itemButton({ view, label: label || "Start a project" });
      btn.classList.add("nav-direct");
      btn.removeAttribute("role");
      const projects = root.querySelector('button[data-view="projects"]');
      if (projects) projects.insertAdjacentElement("beforebegin", btn);
      else root.appendChild(btn);
      return;
    }
    const gid = CREATE_VIEWS.includes(view) ? "create" : DAY_VIEWS.includes(view) ? "myday" : "more";
    let panel = root.querySelector(`#nav-panel-${gid}`);
    if (!panel) {
      const shell = menuShell(gid, gid === "more" ? "More" : gid === "create" ? "Create" : "My day");
      const help = root.querySelector(".nav-menu[data-menu='guides']");
      if (help) root.insertBefore(shell.menu, help);
      else root.appendChild(shell.menu);
      panel = shell.panel;
    }
    // A page that loads later goes above More > Connections.
    const btn = tuneItem(root, itemButton({ view, label: LABELS[view] || label || view, home: true }));
    const section = panel.querySelector(".nav-section");
    if (section) panel.insertBefore(btn, section);
    else panel.appendChild(btn);
    return;
  }
  const group = groupIdFor(view, root.dataset.navLayout || "narrow");
  let panel = root.querySelector(`#nav-panel-${group}`);
  if (!panel) return;
  if (panel.querySelector(`button[data-view="${globalThis.CSS.escape(view)}"]:not([data-focus])`)) return;
  const btn = tuneItem(root, itemButton({ view, label: LABELS[view] || label || view, home: true }));
  // A people page that loads later joins the People section at the end of Connect.
  if (group === "connect") {
    if (!panel.querySelector(`.nav-section[data-section="${PEOPLE_SECTION}"]`)) {
      const head = document.createElement("div");
      head.className = "nav-section";
      head.dataset.section = PEOPLE_SECTION;
      head.setAttribute("role", "presentation");
      head.textContent = PEOPLE_SECTION;
      panel.appendChild(head);
    }
    panel.appendChild(btn);
    return;
  }
  const links = panel.querySelector("button[data-focus]");
  if (links) panel.insertBefore(btn, links);
  else panel.appendChild(btn);
}

// Adds or clears the plan note on locked pages. Called after each licence load.
export function markLocks(root, limits) {
  if (!root) return;
  root.querySelectorAll("button[data-view]").forEach((b) => {
    if (b.dataset.focus) return;
    const plan = lockFor(b.dataset.view, limits);
    let tag = b.querySelector(".nav-lock");
    if (!plan) {
      tag?.remove();
      if (b.dataset.lock) { b.removeAttribute("title"); delete b.dataset.lock; }
      return;
    }
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "nav-lock";
      b.appendChild(tag);
    }
    tag.textContent = ` \u{1F512} ${plan}`;
    b.dataset.lock = plan;
    b.title = lockNote(plan);
  });
}

export function markNav(root, view, menuId, runMode = "") {
  if (!root) return;
  const mode = typeof runMode === "object" && runMode ? String(runMode.runMode || "") : String(runMode || "");
  const activeShortcut = root.dataset?.uiMode === "simple" || view !== "command" ? "" : mode;
  const buttons = [...root.querySelectorAll("button[data-view]")];
  const shortcutBtn = activeShortcut
    ? buttons.find((b) => b.dataset.view === "command" && shortcutModeOf(b) === activeShortcut)
    : null;
  buttons.forEach((b) => {
    const on = shortcutBtn ? b === shortcutBtn : (b.dataset.view === view && !b.dataset.focus && !b.dataset.runMode);
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const onBar = !!shortcutBtn || !!root.querySelector(`.nav-promoted[data-view="${(globalThis.CSS?.escape || String)(view || "")}"]${PAGE_BUTTON}`);
  root.querySelectorAll(".nav-trigger").forEach((t) => {
    const id = t.closest(".nav-menu")?.dataset.menu;
    let on = menuId ? id === menuId : !!t.closest(".nav-menu")?.querySelector(`button[data-view="${view}"]:not([data-focus])`);
    if (root.dataset.uiMode === "simple" && !menuId) {
      if (id === "create") on = CREATE_VIEWS.includes(view);
      else if (id === "guides") on = view === "help";
      else if (id === "myday") on = DAY_VIEWS.includes(view);
      else if (id === "more") on = !SIMPLE_TOP.has(view);
    }
    // A promoted page is lit on the bar, not on the menu it left.
    if (onBar && !menuId) on = false;
    t.classList.toggle("active", !!on);
  });
}

export function closeNav(root) {
  if (root) closeMenus(root);
}

export const NAV_CSS = CSS;
