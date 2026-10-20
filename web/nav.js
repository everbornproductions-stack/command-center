// Grouped main menu. Every existing view stays reachable in Expert.
// Simple shows Chat, Projects, Create, Help, and Settings.
// Modified keys (Alt, Ctrl, Meta) are ignored so Alt+Space and other hotkeys keep working.
//
// Width (window, not a one-time screen snapshot):
//   narrow  < 1280   the five compact dropdowns
//   normal  1280-1599  eight dropdowns, Work and Settings split
//   wide    >= 1600  those groups open into inline buttons

import { CREATE_VIEWS } from "./mode.js";

export const NAV_NORMAL = 1280;
export const NAV_WIDE = 1600;

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
  brain: "work",
  prompts: "create",
  images: "create",
  media: "create",
  publish: "create",
  subscriptions: "business",
  credits: "business",
  workspaces: "business",
  reports: "business",
  settings: "help",
  setup: "help",
  help: "help",
  start: "help",
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
  brain: "library",
  prompts: "create",
  images: "create",
  media: "create",
  publish: "create",
  subscriptions: "business",
  credits: "business",
  workspaces: "business",
  reports: "business",
  settings: "settings",
  setup: "settings",
  start: "settings",
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
  brain: "Who's best",
  prompts: "Pro prompts",
  images: "Images",
  media: "Media",
  publish: "Publish",
  subscriptions: "Subscriptions",
  credits: "Credits",
  workspaces: "Teams",
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

function ensureStart(bucket) {
  if (!bucket.some((i) => i.view === "start")) bucket.push({ ...START_ITEM });
}

export function navLayout(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w < NAV_NORMAL) return "narrow";
  if (w >= NAV_WIDE) return "wide";
  return "normal";
}

export function readNavWidth(win = globalThis) {
  const inner = win?.innerWidth;
  if (Number.isFinite(inner) && inner > 0) return inner;
  const client = win?.document?.documentElement?.clientWidth;
  if (Number.isFinite(client) && client > 0) return client;
  return 0;
}

function splitLayout(layout) {
  return layout === "normal" || layout === "wide";
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
  if (split) {
    ensureStart(buckets.settings);
    buckets.settings.push({ ...SETUP_AGAIN });
    buckets.settings.push({ ...TOUR_ITEM });
    buckets.settings.push({ ...UPDATES_ITEM });
    if (!buckets.guides.some((i) => i.view === "help")) buckets.guides.unshift({ view: "help", label: "Help", home: true });
    buckets.guides.push({ ...SETUP_AGAIN });
    buckets.guides.push({ ...REPLAY_ITEM });
    buckets.guides.push({ ...EXAMPLES_ITEM });
  } else {
    ensureStart(buckets.help);
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
.tabs.nav-ready { gap: 4px; align-items: stretch; overflow: visible; }
.nav-menu { position: relative; }
.nav-trigger { background: transparent; border: 0; padding: 6px 12px; border-radius: 8px; color: var(--muted); cursor: pointer; font-weight: 600; }
.nav-trigger:hover, .nav-trigger[aria-expanded="true"] { color: var(--text); }
.nav-trigger.active { background: #1a2436; color: #fff; box-shadow: inset 0 0 0 1px #2b3a52; }
.nav-panel { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; min-width: 220px; max-height: 70vh; overflow: auto; padding: 6px; background: #0d1420; border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 16px 40px #000a; display: none; }
.nav-menu.open .nav-panel { display: flex; flex-direction: column; gap: 2px; }
.nav-panel button { text-align: left; background: transparent; border: 0; border-radius: 8px; color: var(--text); padding: 8px 10px; cursor: pointer; }
.nav-panel button:hover, .nav-panel button:focus { background: #1a2436; outline: none; }
.nav-panel button.active { color: var(--accent-2); }
.nav-menu:nth-last-child(-n+3) .nav-panel { left: auto; right: 0; }
.tabs.nav-split, .tabs.nav-wide { flex: 1 1 520px; min-width: 0; flex-wrap: wrap; }
.tabs.nav-split .nav-trigger { padding: 6px 10px; }
.topbar:has(.tabs.nav-split), .topbar:has(.tabs.nav-wide) { height: auto; min-height: 56px; flex-wrap: wrap; row-gap: 6px; padding-top: 6px; padding-bottom: 6px; }
.app:has(.tabs.nav-split), .app:has(.tabs.nav-wide) { grid-template-rows: auto minmax(0, 1fr) var(--strip-h); }
.tabs.nav-wide { gap: 2px 10px; background: transparent; border: 0; padding: 0; align-items: center; }
.tabs.nav-wide .nav-menu { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.tabs.nav-wide .nav-trigger { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; padding: 4px 6px 4px 2px; cursor: default; pointer-events: none; }
.tabs.nav-wide .nav-panel { position: static; display: flex; flex-direction: row; flex-wrap: wrap; gap: 2px; min-width: 0; max-height: none; overflow: visible; padding: 0; background: transparent; border: 0; box-shadow: none; }
.tabs.nav-wide .nav-panel button { padding: 4px 8px; white-space: nowrap; }
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
  // Normal and wide already include that menu in the split model.
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

  const create = menuShell("create", "Create");
  for (const view of CREATE_VIEWS) {
    if (have.has(view)) create.panel.appendChild(buttonFor(buttons, view, LABELS[view]));
  }
  root.appendChild(create.menu);
  root.appendChild(helpMenu(buttons));

  const settings = menuShell("settings", "Settings");
  settings.panel.appendChild(buttonFor(buttons, "settings", "Settings"));
  if (have.has("setup")) settings.panel.appendChild(buttonFor(buttons, "setup", "Setup"));
  if (have.has("start")) settings.panel.appendChild(buttonFor(buttons, "start", "Start a project"));
  settings.panel.appendChild(itemButton(SETUP_AGAIN));
  settings.panel.appendChild(itemButton(TOUR_ITEM));
  root.appendChild(settings.menu);
}

function applyWide(root) {
  root.querySelectorAll(".nav-menu").forEach((menu) => {
    const trigger = menu.querySelector(".nav-trigger");
    if (trigger) {
      trigger.tabIndex = -1;
      trigger.setAttribute("aria-hidden", "true");
      trigger.removeAttribute("aria-haspopup");
      trigger.removeAttribute("aria-expanded");
    }
    menu.querySelector(".nav-panel")?.removeAttribute("role");
    menu.querySelectorAll("[role='menuitem']").forEach((b) => b.removeAttribute("role"));
  });
}

// Rebuilds when the mode or the width layout changes. The same pair is left in place so a re-render does not drop focus.
export function installNav(root, views, mode = "expert", layout = "narrow") {
  if (!root) return root;
  mode = mode === "simple" ? "simple" : "expert";
  layout = layout === "wide" || layout === "normal" ? layout : "narrow";
  if (root.dataset.nav === "1" && root.dataset.uiMode === mode && root.dataset.navLayout === layout) return root;
  ensureNavStyle();
  const buttons = [...root.querySelectorAll("button[data-view]")].filter((b) => !b.dataset.focus && !b.dataset.action);
  for (const b of buttons) b.remove();
  root.textContent = "";
  root.classList.add("nav-ready");
  root.classList.toggle("nav-wide", layout === "wide");
  root.classList.toggle("nav-split", layout === "normal");
  root.dataset.nav = "1";
  root.dataset.uiMode = mode;
  root.dataset.navLayout = layout;
  if (mode === "simple") mountSimple(root, views, buttons);
  else mountExpert(root, views, buttons, layout);
  if (layout === "wide") applyWide(root);
  if (!root.dataset.navKeys) {
    root.dataset.navKeys = "1";
    root.addEventListener("keydown", onNavKey);
  }
  return root;
}

// resize plus matchMedia. min-width tracks the window. resolution and device-width
// fire when the window moves onto another monitor, including one where resize does not.
export function watchNavLayout(onChange, win = globalThis) {
  if (!win || typeof win.matchMedia !== "function" || typeof onChange !== "function") return () => {};
  const apply = () => onChange(navLayout(readNavWidth(win)));
  win.addEventListener?.("resize", apply);
  const queries = [
    `(min-width: ${NAV_NORMAL}px)`,
    `(min-width: ${NAV_WIDE}px)`,
    `(min-device-width: ${NAV_NORMAL}px)`,
    `(min-device-width: ${NAV_WIDE}px)`,
  ];
  const lists = queries.map((q) => win.matchMedia(q));
  for (const mq of lists) mq.addEventListener?.("change", apply);
  let ratio = win.devicePixelRatio || 1;
  const watchRatio = () => {
    const mq = win.matchMedia(`(resolution: ${ratio}dppx)`);
    const onRes = () => {
      ratio = win.devicePixelRatio || ratio;
      apply();
      watchRatio();
    };
    mq.addEventListener?.("change", onRes);
  };
  watchRatio();
  win.visualViewport?.addEventListener?.("resize", apply);
  apply();
  return () => win.removeEventListener?.("resize", apply);
}

function menuState(menu) {
  const items = [...menu.querySelectorAll("[role='menuitem']")];
  const index = Math.max(0, items.indexOf(document.activeElement));
  return { open: menu.classList.contains("open"), index, count: items.length, items };
}

function onNavKey(e) {
  if (e.target.closest?.(".nav-wide")) return;
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

function tuneItem(root, btn) {
  if (root?.dataset?.navLayout === "wide") btn.removeAttribute("role");
  return btn;
}

export function placeNavItem(root, view, label) {
  if (!root) return;
  if (root.dataset.uiMode === "simple") {
    if (view === "start") {
      const panel = root.querySelector("#nav-panel-settings");
      if (!panel || panel.querySelector('button[data-view="start"]')) return;
      const btn = tuneItem(root, itemButton({ view, label: label || "Start a project" }));
      const tour = panel.querySelector("button[data-action='tour']");
      if (tour) panel.insertBefore(btn, tour);
      else panel.appendChild(btn);
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
      else if (id === "guides") on = view === "help" || view === "start";
      else if (id === "settings") on = view === "settings" || view === "setup";
    }
    t.classList.toggle("active", !!on);
  });
}

export function closeNav(root) {
  if (root) closeMenus(root);
}

export const NAV_CSS = CSS;
