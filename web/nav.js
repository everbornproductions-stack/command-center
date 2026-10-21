// Grouped main menu. Every existing view stays reachable in Expert.
// Simple shows Chat, Projects, Create, Help, and Settings.
// Modified keys (Alt, Ctrl, Meta) are ignored so Alt+Space and other hotkeys keep working.
//
// The wide row is chosen from the free space in the top bar (ResizeObserver),
// not from a fixed window width and not from the desktop content-bounds report.
// That report can be smaller than the layout viewport on a scaled or multi-monitor
// display, so it only asks the bar to measure again. Dropdowns stay on one line:
//   narrow  the compact menus (about five), plus Help
//   normal  about eight dropdowns, spread across the free space, when they fit
// If eight menus would overflow the top bar, they merge back.

import { CREATE_VIEWS } from "./mode.js";

export const NAV_NORMAL = 1280;
export const NAV_LAYOUT_WAIT_MS = 150;
// Top bar chrome that is not the menus: padding, brand mark and name, the
// Simple / Expert switch, the month pill, and the connection pill.
export const NAV_CHROME_BASE = 547;
// The "an Everborn product" line and the clock. Hidden when the compact row
// would not fit beside them.
export const NAV_CHROME_EXTRA = 190;

export const GROUP_ORDER = ["work", "create", "business", "connect", "help"];

// Work (the largest menu) splits into Work, Agents, and Library. Live stays in Work.
// Settings splits off a Help menu so Replay the tour and Watch example projects fit.
export const SPLIT_ORDER = ["work", "agents", "library", "create", "business", "connect", "settings", "guides"];

export const GROUPS = {
  work: { id: "work", label: "Work" },
  create: { id: "create", label: "Create" },
  business: { id: "business", label: "Business" },
  connect: { id: "connect", label: "Connect" },
  help: { id: "help", label: "Settings" },
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
  refocus: "work",
  brain: "work",
  prompts: "create",
  images: "create",
  media: "create",
  publish: "create",
  subscriptions: "business",
  credits: "business",
  workspaces: "business",
  together: "business",
  reports: "business",
  settings: "help",
  setup: "help",
  help: "help",
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
  refocus: "work",
  brain: "library",
  prompts: "create",
  images: "create",
  media: "create",
  publish: "create",
  subscriptions: "business",
  credits: "business",
  workspaces: "business",
  together: "business",
  reports: "business",
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
  "everyday-work": "Docs and follow-up",
  refocus: "Refocus",
  brain: "Who's best",
  prompts: "Pro prompts",
  images: "Images",
  media: "Media",
  publish: "Publish",
  subscriptions: "Subscriptions",
  credits: "Credits",
  workspaces: "Teams",
  together: "Together",
  reports: "Reports",
  settings: "Settings",
  setup: "Setup",
  help: "Help",
  start: "Start a project",
};

const SETUP_AGAIN = { id: "connect-setup", label: "Run setup again", action: "connect-setup", home: false };
const TOUR_ITEM = { id: "tour", label: "Take the tour again", action: "tour", home: false };
const REPLAY_ITEM = { id: "replay-tour", label: "Replay the tour", action: "replay-tour", home: false };
const EXAMPLES_ITEM = { id: "watch-examples", label: "Watch example projects", action: "examples", home: false };
const UPDATES_ITEM = { id: "updates", label: "Check for updates", action: "updates", home: false };
const START_ITEM = { id: "start-project", label: "Start a project", view: "start", home: false };

// What the Settings menu is allowed to hold, in every layout.
export const SETTINGS_VIEWS = ["settings", "setup", "help"];
export const SETTINGS_ACTIONS = ["connect-setup", "tour", "updates"];

export function menuLabeledSettings(model) {
  return (model || []).find((g) => g.label === "Settings") || null;
}

export function isSettingsItem(item) {
  if (!item) return false;
  if (item.view === "start" || item.label === "Start a project") return false;
  if (item.action === "examples" || item.action === "replay-tour") return false;
  if (item.action && SETTINGS_ACTIONS.includes(item.action) && !item.view) return true;
  if (item.view && SETTINGS_VIEWS.includes(item.view) && !item.action) return true;
  return false;
}

function ensureStart(bucket) {
  if (!bucket.some((i) => i.view === "start")) bucket.push({ ...START_ITEM });
}

// Button text for one dropdown, matching the trigger labels in the bar.
export function rowLabels(layout) {
  if (layout === "normal") return SPLIT_ORDER.map((id) => SPLIT_GROUPS[id].label);
  // Narrow mounts the compact menus and a separate Help menu for the tour.
  return [...GROUP_ORDER.map((id) => GROUPS[id].label), "Help"];
}

// Inter at 14px, weight 600, plus 8px of horizontal padding on each trigger.
const CHAR_PX = 8.2;
const TRIGGER_PAD = 16;
const TRIGGER_GAP = 4;
const TABS_BOX = 8;

export function menusWidth(labels) {
  let n = TABS_BOX;
  for (let i = 0; i < labels.length; i++) {
    if (i) n += TRIGGER_GAP;
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
export const CONNECT_LINKS = [
  { id: "keys", label: "Keys and providers", view: "settings", focus: "#settings-keys" },
  { id: "mcp", label: "Tools (MCP)", view: "settings", focus: "[data-feature='mcp']" },
  { id: "integrations", label: "Integrations", view: "settings", focus: "[data-feature='grokbot']" },
  { id: "extension", label: "Browser extension", view: "settings", focus: "[data-feature='extension']" },
];

export function groupFor(view) {
  return HOME[view] || "work";
}

export function menuModel(views, layout = "narrow") {
  const split = splitLayout(layout);
  const order = split ? SPLIT_ORDER : GROUP_ORDER;
  const groups = split ? SPLIT_GROUPS : GROUPS;
  const buckets = Object.fromEntries(order.map((id) => [id, []]));
  const seen = new Set();
  for (const view of views || []) {
    if (!view || seen.has(view)) continue;
    seen.add(view);
    const gid = groupIdFor(view, layout);
    (buckets[gid] || buckets[groupFor(view)]).push({ view, label: LABELS[view] || view, home: true });
  }
  for (const link of CONNECT_LINKS) buckets.connect.push({ ...link, home: false });
  // Start a project belongs with Projects, in Work. It is not a settings item.
  ensureStart(buckets.work);
  if (split) {
    buckets.settings.push({ ...SETUP_AGAIN });
    buckets.settings.push({ ...TOUR_ITEM });
    buckets.settings.push({ ...UPDATES_ITEM });
    if (!buckets.guides.some((i) => i.view === "help")) buckets.guides.unshift({ view: "help", label: "Help", home: true });
    const helpAt = buckets.guides.findIndex((i) => i.view === "help");
    buckets.guides.splice(helpAt + 1, 0, { ...UPDATES_ITEM });
    buckets.guides.push({ ...SETUP_AGAIN });
    buckets.guides.push({ ...REPLAY_ITEM });
    buckets.guides.push({ ...EXAMPLES_ITEM });
  } else {
    buckets.help.push({ ...SETUP_AGAIN });
    buckets.help.push({ ...TOUR_ITEM });
    buckets.help.push({ ...UPDATES_ITEM });
  }
  return order.map((id) => ({ ...groups[id], items: buckets[id] }));
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
.nav-menu { position: relative; flex: 0 0 auto; }
.tabs .nav-trigger, .tabs button.nav-direct { white-space: nowrap; padding: 6px 8px; }
.tabs.nav-ready:not(.nav-split) .nav-trigger, .tabs.nav-ready:not(.nav-split) button.nav-direct { padding-left: 4px; padding-right: 4px; }
.nav-trigger { background: transparent; border: 0; border-radius: 8px; color: var(--muted); cursor: pointer; font-weight: 600; }
.nav-trigger:hover, .nav-trigger[aria-expanded="true"] { color: var(--text); }
.nav-trigger.active { background: #1a2436; color: #fff; box-shadow: inset 0 0 0 1px #2b3a52; }
.nav-panel { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; min-width: 220px; max-height: 70vh; overflow: auto; padding: 6px; background: #0d1420; border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 16px 40px #000a; display: none; }
.nav-menu.open .nav-panel { display: flex; flex-direction: column; gap: 2px; }
.nav-panel button { text-align: left; background: transparent; border: 0; border-radius: 8px; color: var(--text); padding: 8px 10px; cursor: pointer; }
.nav-panel button:hover, .nav-panel button:focus { background: #1a2436; outline: none; }
.nav-panel button.active { color: var(--accent-2); }
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

function helpMenu(buttons) {
  const help = menuShell("guides", "Help");
  help.panel.appendChild(buttonFor(buttons, "help", "Help"));
  help.panel.appendChild(itemButton(UPDATES_ITEM));
  help.panel.appendChild(itemButton(SETUP_AGAIN));
  help.panel.appendChild(itemButton(REPLAY_ITEM));
  help.panel.appendChild(itemButton(EXAMPLES_ITEM));
  return help.menu;
}

function mountExpert(root, views, buttons, layout) {
  const model = menuModel(views, layout);
  for (const group of model) {
    const { menu, panel } = menuShell(group.id, group.label);
    for (const item of group.items) {
      if (item.home && item.view) panel.appendChild(buttonFor(buttons, item.view, item.label));
      else panel.appendChild(itemButton(item));
    }
    root.appendChild(menu);
  }
  // Narrow keeps the compact menus and still mounts the walkthrough Help menu.
  // The wider row already includes that menu in the split model.
  if (!model.some((g) => g.id === "guides")) root.appendChild(helpMenu(buttons));
}

function mountSimple(root, views, buttons) {
  const have = new Set(views || []);
  const chat = buttonFor(buttons, "command", "Chat");
  chat.classList.add("nav-direct");
  chat.removeAttribute("role");
  root.appendChild(chat);
  const projects = buttonFor(buttons, "projects", "Projects");
  projects.classList.add("nav-direct");
  projects.removeAttribute("role");
  root.appendChild(projects);
  if (have.has("start")) {
    const start = buttonFor(buttons, "start", "Start a project");
    start.classList.add("nav-direct");
    start.removeAttribute("role");
    root.appendChild(start);
  }

  const create = menuShell("create", "Create");
  for (const view of CREATE_VIEWS) {
    if (have.has(view)) create.panel.appendChild(buttonFor(buttons, view, LABELS[view]));
  }
  root.appendChild(create.menu);
  root.appendChild(helpMenu(buttons));

  const settings = menuShell("settings", "Settings");
  settings.panel.appendChild(buttonFor(buttons, "settings", "Settings"));
  if (have.has("setup")) settings.panel.appendChild(buttonFor(buttons, "setup", "Setup"));
  settings.panel.appendChild(itemButton(SETUP_AGAIN));
  settings.panel.appendChild(itemButton(TOUR_ITEM));
  root.appendChild(settings.menu);
}

// Rebuilds when the mode or the width layout changes. The same pair is left in place so a re-render does not drop focus.
export function installNav(root, views, mode = "expert", layout = "narrow") {
  if (!root) return root;
  mode = mode === "simple" ? "simple" : "expert";
  layout = layout === "normal" ? "normal" : "narrow";
  if (root.dataset.nav === "1" && root.dataset.uiMode === mode && root.dataset.navLayout === layout) return root;
  ensureNavStyle();
  const buttons = [...root.querySelectorAll("button[data-view]")].filter((b) => !b.dataset.focus && !b.dataset.action);
  for (const b of buttons) b.remove();
  root.textContent = "";
  root.classList.add("nav-ready");
  root.classList.toggle("nav-split", layout === "normal");
  root.dataset.nav = "1";
  root.dataset.uiMode = mode;
  root.dataset.navLayout = layout;
  if (mode === "simple") mountSimple(root, views, buttons);
  else mountExpert(root, views, buttons, layout);
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

export function placeNavItem(root, view, label) {
  if (!root) return;
  if (root.dataset.uiMode === "simple") {
    if (view === "start") {
      if (root.querySelector('button.nav-direct[data-view="start"]')) return;
      const btn = itemButton({ view, label: label || "Start a project" });
      btn.classList.add("nav-direct");
      btn.removeAttribute("role");
      const projects = root.querySelector('button[data-view="projects"]');
      if (projects) projects.insertAdjacentElement("afterend", btn);
      else root.appendChild(btn);
      return;
    }
    if (view === "help") {
      const panel = root.querySelector("#nav-panel-guides");
      if (panel) {
        if (panel.querySelector(`button[data-view="${globalThis.CSS.escape(view)}"]`)) return;
        const btn = tuneItem(root, itemButton({ view, label: label || "Help" }));
        const replay = panel.querySelector("button[data-action='replay-tour']");
        if (replay) panel.insertBefore(btn, replay);
        else panel.appendChild(btn);
        return;
      }
      if (root.querySelector(`button[data-view="${globalThis.CSS.escape(view)}"]`)) return;
      const btn = itemButton({ view, label: label || "Help" });
      btn.classList.add("nav-direct");
      btn.removeAttribute("role");
      const settingsMenu = root.querySelector(".nav-menu[data-menu='settings']");
      if (settingsMenu) root.insertBefore(btn, settingsMenu);
      else root.appendChild(btn);
      return;
    }
    if (!CREATE_VIEWS.includes(view) && view !== "setup") return;
    const panel = root.querySelector(`#nav-panel-${view === "setup" ? "settings" : "create"}`);
    if (!panel) return;
    if (panel.querySelector(`button[data-view="${globalThis.CSS.escape(view)}"]`)) return;
    const btn = tuneItem(root, itemButton({ view, label: label || LABELS[view] || view, home: true }));
    const tour = panel.querySelector("button[data-action='tour']");
    if (tour) panel.insertBefore(btn, tour);
    else panel.appendChild(btn);
    return;
  }
  const group = groupIdFor(view, root.dataset.navLayout || "narrow");
  let panel = root.querySelector(`#nav-panel-${group}`);
  if (!panel) return;
  if (panel.querySelector(`button[data-view="${globalThis.CSS.escape(view)}"]`)) return;
  const btn = tuneItem(root, itemButton({ view, label: label || LABELS[view] || view, home: true }));
  const links = panel.querySelector("button[data-focus]");
  if (links) panel.insertBefore(btn, links);
  else panel.appendChild(btn);
}

export function markNav(root, view, menuId) {
  if (!root) return;
  root.querySelectorAll("button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view && !b.dataset.focus));
  root.querySelectorAll(".nav-trigger").forEach((t) => {
    const id = t.closest(".nav-menu")?.dataset.menu;
    let on = menuId ? id === menuId : !!t.closest(".nav-menu")?.querySelector(`button[data-view="${view}"]:not([data-focus])`);
    if (root.dataset.uiMode === "simple" && !menuId) {
      if (id === "create") on = CREATE_VIEWS.includes(view);
      else if (id === "guides") on = view === "help";
      else if (id === "settings") on = view === "settings" || view === "setup";
    }
    t.classList.toggle("active", !!on);
  });
}

export function closeNav(root) {
  if (root) closeMenus(root);
}

export const NAV_CSS = CSS;
