// Grouped main menu. Every existing view stays reachable in Expert.
// Simple shows Chat, Projects, Create, Help, and Settings.
// Modified keys (Alt, Ctrl, Meta) are ignored so Alt+Space and other hotkeys keep working.

import { CREATE_VIEWS } from "./mode.js";

export const GROUP_ORDER = ["work", "create", "business", "connect", "help"];

export const GROUPS = {
  work: { id: "work", label: "Work" },
  create: { id: "create", label: "Create" },
  business: { id: "business", label: "Business" },
  connect: { id: "connect", label: "Connect" },
  help: { id: "help", label: "Settings" },
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

export function menuModel(views) {
  const buckets = Object.fromEntries(GROUP_ORDER.map((id) => [id, []]));
  const seen = new Set();
  for (const view of views || []) {
    if (!view || seen.has(view)) continue;
    seen.add(view);
    buckets[groupFor(view)].push({ view, label: LABELS[view] || view, home: true });
  }
  for (const link of CONNECT_LINKS) buckets.connect.push({ ...link, home: false });
  if (!buckets.help.some((i) => i.view === "start")) buckets.help.push({ id: "start-project", label: "Start a project", view: "start", home: false });
  buckets.help.push({ id: "tour", label: "Take the tour again", action: "tour", home: false });
  buckets.help.push({ id: "updates", label: "Check for updates", action: "updates", home: false });
  return GROUP_ORDER.map((id) => ({ ...GROUPS[id], items: buckets[id] }));
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

function mountExpert(root, views, buttons) {
  const model = menuModel(views);
  for (const group of model) {
    const { menu, panel } = menuShell(group.id, group.label);
    for (const item of group.items) {
      if (item.home && item.view) panel.appendChild(buttonFor(buttons, item.view, item.label));
      else panel.appendChild(itemButton(item));
    }
    root.appendChild(menu);
  }
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

  if (have.has("help")) {
    const help = buttonFor(buttons, "help", "Help");
    help.classList.add("nav-direct");
    help.removeAttribute("role");
    root.appendChild(help);
  }

  const settings = menuShell("settings", "Settings");
  settings.panel.appendChild(buttonFor(buttons, "settings", "Settings"));
  if (have.has("setup")) settings.panel.appendChild(buttonFor(buttons, "setup", "Setup"));
  if (have.has("start")) settings.panel.appendChild(buttonFor(buttons, "start", "Start a project"));
  settings.panel.appendChild(itemButton({ id: "tour", label: "Take the tour again", action: "tour" }));
  root.appendChild(settings.menu);
}

// Rebuilds when the mode changes. Same mode is left in place so a re-render does not drop focus.
export function installNav(root, views, mode = "expert") {
  if (!root) return root;
  mode = mode === "simple" ? "simple" : "expert";
  if (root.dataset.nav === "1" && root.dataset.uiMode === mode) return root;
  ensureNavStyle();
  const buttons = [...root.querySelectorAll("button[data-view]")].filter((b) => !b.dataset.focus && !b.dataset.action);
  for (const b of buttons) b.remove();
  root.textContent = "";
  root.classList.add("nav-ready");
  root.dataset.nav = "1";
  root.dataset.uiMode = mode;
  if (mode === "simple") mountSimple(root, views, buttons);
  else mountExpert(root, views, buttons);
  if (!root.dataset.navKeys) {
    root.dataset.navKeys = "1";
    root.addEventListener("keydown", onNavKey);
  }
  return root;
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

export function placeNavItem(root, view, label) {
  if (!root) return;
  if (root.dataset.uiMode === "simple") {
    if (view === "start") {
      const panel = root.querySelector("#nav-panel-settings");
      if (!panel || panel.querySelector('button[data-view="start"]')) return;
      const btn = itemButton({ view, label: label || "Start a project" });
      const tour = panel.querySelector("button[data-action='tour']");
      if (tour) panel.insertBefore(btn, tour);
      else panel.appendChild(btn);
      return;
    }
    if (view === "help") {
      if (root.querySelector(`button.nav-direct[data-view="${globalThis.CSS.escape(view)}"]`)) return;
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
    const btn = itemButton({ view, label: label || LABELS[view] || view, home: true });
    const tour = panel.querySelector("button[data-action='tour']");
    if (tour) panel.insertBefore(btn, tour);
    else panel.appendChild(btn);
    return;
  }
  const group = groupFor(view);
  let panel = root.querySelector(`#nav-panel-${group}`);
  if (!panel) return;
  if (panel.querySelector(`button[data-view="${globalThis.CSS.escape(view)}"]`)) return;
  const btn = itemButton({ view, label: label || LABELS[view] || view, home: true });
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
      else if (id === "settings") on = view === "settings" || view === "setup";
    }
    t.classList.toggle("active", !!on);
  });
}

export function closeNav(root) {
  if (root) closeMenus(root);
}

export const NAV_CSS = CSS;
