// Grouped main menu. Every existing view stays reachable.
// Modified keys (Alt, Ctrl, Meta) are ignored so Alt+Space and other hotkeys keep working.

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
  buckets.help.push({ id: "tour", label: "Help tour", action: "tour", home: false });
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

export function installNav(root, views) {
  if (!root || root.dataset.nav === "1") return root;
  ensureNavStyle();
  const model = menuModel(views);
  const buttons = [...root.querySelectorAll("button[data-view]")];
  root.textContent = "";
  root.classList.add("nav-ready");
  root.dataset.nav = "1";
  for (const group of model) {
    const menu = document.createElement("div");
    menu.className = "nav-menu";
    menu.dataset.menu = group.id;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "nav-trigger";
    trigger.textContent = group.label;
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `nav-panel-${group.id}`);
    const panel = document.createElement("div");
    panel.className = "nav-panel";
    panel.id = `nav-panel-${group.id}`;
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", group.label);
    for (const item of group.items) {
      if (item.home && item.view) {
        const existing = buttons.find((b) => b.dataset.view === item.view);
        const btn = existing || itemButton(item);
        btn.setAttribute("role", "menuitem");
        if (!btn.textContent) btn.textContent = item.label;
        panel.appendChild(btn);
      } else panel.appendChild(itemButton(item));
    }
    menu.append(trigger, panel);
    root.appendChild(menu);
  }
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
  const group = groupFor(view);
  let panel = root.querySelector(`#nav-panel-${group}`);
  if (!panel) return;
  if (panel.querySelector(`button[data-view="${CSS.escape(view)}"]`)) return;
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
    const on = menuId ? id === menuId : !!t.closest(".nav-menu")?.querySelector(`button[data-view="${view}"]:not([data-focus])`);
    t.classList.toggle("active", !!on);
  });
}

export function closeNav(root) {
  if (root) closeMenus(root);
}

export const NAV_CSS = CSS;
