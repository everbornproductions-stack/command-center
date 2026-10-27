// Mac part "expert" (0.4.23): the Expert sidebar (#mac-side) and the All tools launchpad (#mac-launchpad).
// Both are built from the real page list (web/nav.js, web/perf/registry.js, feature tabs) by /mac/data/expert.js,
// so every page and feature that exists today can be reached. Draws nothing in Simple.
import { LABELS, VIEW_LOCKS, helpItems, CONNECT_LINKS } from "/nav.js";
import { isDesktopOnly, DESKTOP_ONLY } from "/desktop-only.js";
import { FEATURES } from "/perf/registry.js";
import { buildRegistry, groupsOf, pages, search, lockOf, PER_PAGE } from "/mac/data/expert.js";

const LS_GROUPS = "cc.mac.groups";
const LS_SIDE = "cc.mac.side";
const COLS = 7;

let st = null;

function store(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage blocked */ } }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function ensureSlot(id, madeCls) {
  let root = document.getElementById("mac-root");
  if (!root) { root = el("div"); root.id = "mac-root"; document.body.appendChild(root); }
  let s = document.getElementById(id);
  if (!s) { s = el("div"); s.id = id; s.dataset.madeBy = "expert"; (root || document.body).appendChild(s); }
  s.classList.add(madeCls);
  return s;
}

// Every page this install has: nav.js labels, pages the feature registry loads on demand, feature tabs, and the nav buttons.
export function installedViews(CC = window.CC) {
  const out = new Set(Object.keys(LABELS));
  for (const f of FEATURES) for (const v of f.views || []) out.add(v);
  for (const f of CC?.byKind?.("tab") || []) out.add(f.id);
  document.querySelectorAll("#tabs button[data-view]").forEach((b) => out.add(b.dataset.view));
  if (CC?.S?.mode === "hosted") for (const v of [...out]) if (isDesktopOnly(v)) out.delete(v);
  return [...out];
}

function makeItems(CC) {
  const web = CC?.S?.mode === "hosted";
  return buildRegistry(installedViews(CC), LABELS, VIEW_LOCKS, {
    helpItems: helpItems(web ? "web" : ""),
    connectLinks: CONNECT_LINKS,
    desktopOnly: web ? DESKTOP_ONLY : [],
  });
}

// Opens an item the same way the 0.4.21 menus do. Nothing here is a second copy of a page.
export function openItem(ctx, item) {
  const { CC, bus } = ctx;
  const o = item?.open;
  if (!o) return false;
  if (o.panel) { bus.emit("open", { panel: o.panel, section: o.section || "" }); return true; }
  if (o.action) { runAction(CC, o.action); return true; }
  if (o.view) {
    const S = CC.S;
    S.connectWizard = false;
    if (o.view === "setup") { S.setup = S.setup || {}; S.setup.fullFlow = false; S.setup.phase = "scan"; }
    if (o.runMode) { S.cmdMode = o.runMode; S.cmdShortcut = o.runMode; S.focusOrders = true; }
    else S.cmdShortcut = "";
    if (o.view === "settings" && o.focus && CC.openSettings) { CC.openSettings(o.focus); }
    else {
      S.navFocus = o.focus || "";
      CC.go(o.view);
    }
    bus.emit("view", o.view);
    return true;
  }
  return false;
}

// The old menu handlers listen for a click on a data-action button. Click a short lived one so the same code runs.
function runAction(CC, action) {
  if (action === "tour") return CC.tour?.start?.();
  if (action === "connect-setup") return CC.connectSetup?.open?.();
  if (action === "news") return CC.tour?.openNews?.();
  const host = action === "demo-on" ? document.getElementById("tabs") : document.body;
  if (!host) return CC.toast?.("That is not ready yet.", true);
  const b = el("button");
  b.dataset.action = action;
  b.hidden = true;
  host.appendChild(b);
  b.click();
  b.remove();
}

function isSelected(CC, item) {
  const o = item.open || {};
  if (!o.view || o.view !== CC.S?.view) return false;
  if (o.view === "command") {
    const mode = CC.S.cmdShortcut || "";
    return o.runMode ? mode === o.runMode : (!mode && !o.focus);
  }
  return !o.focus;
}

// ---------- sidebar ----------
function openGroups() {
  const saved = store(LS_GROUPS, null);
  return saved && typeof saved === "object" ? saved : { work: true };
}

function itemButton(item, limits, cls) {
  const b = el("button", cls);
  b.type = "button";
  b.dataset.id = item.id;
  const lock = lockOf(item, limits);
  b.setAttribute("aria-label", lock ? `${item.label}. Part of ${lock}.` : item.label);
  b.title = item.plain;
  const ic = el("span", "mx-ic", item.icon);
  ic.setAttribute("aria-hidden", "true");
  b.append(ic, el("span", "mx-nm", item.label));
  if (lock) b.append(el("span", "lk", lock));
  return b;
}

function renderSide() {
  const { CC, side } = st;
  const q = st.q.trim();
  const limits = CC.S?.license?.limits;
  const open = openGroups();
  // A redraw (view change, mode tick) must not drop focus from the search box, or typing lands nowhere.
  const old = side.querySelector(".mx-srch");
  const typing = !!old && document.activeElement === old;
  const caret = typing ? [old.selectionStart, old.selectionEnd] : null;
  side.textContent = "";
  const inner = el("div", "mx-sidein");
  const head = el("div", "mx-sidehead");
  const box = el("input", "mx-srch");
  box.type = "search";
  box.placeholder = "Search features";
  box.setAttribute("aria-label", "Search features");
  box.value = st.q;
  box.addEventListener("input", () => { st.q = box.value; renderSide(); const n = side.querySelector(".mx-srch"); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const first = side.querySelector(".si"); first?.click(); }
    if (e.key === "Escape" && st.q) { st.q = ""; renderSide(); side.querySelector(".mx-srch")?.focus(); }
  });
  const col = el("button", "mx-collapse", "◀");
  col.type = "button";
  col.title = "Hide the sidebar";
  col.setAttribute("aria-label", "Hide the sidebar");
  col.addEventListener("click", () => setCollapsed(true));
  head.append(box, col);
  inner.append(head);
  const shown = q ? search(st.items, q) : st.items;
  const groups = groupsOf(shown);
  if (!groups.length) inner.append(el("div", "mx-none", "Nothing matches. Try a shorter word."));
  const cur = st.items.find((i) => isSelected(CC, i));
  for (const g of groups) {
    const isOpen = q ? true : !!open[g.id] || cur?.group === g.id;
    const gh = el("button", "grp");
    gh.type = "button";
    gh.dataset.group = g.id;
    gh.setAttribute("aria-expanded", String(isOpen));
    gh.append(el("span", "mx-gn", g.label), el("span", "mx-car", isOpen ? "▾" : "▸"));
    gh.addEventListener("click", () => {
      if (q) return;
      const o = openGroups();
      o[g.id] = !isOpen;
      save(LS_GROUPS, o);
      renderSide();
      side.querySelector(`.grp[data-group="${g.id}"]`)?.focus();
    });
    inner.append(gh);
    if (!isOpen) continue;
    const list = el("div", "mx-list");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", g.label);
    for (const it of g.items) {
      const b = itemButton(it, limits, "si");
      if (isSelected(CC, it)) { b.classList.add("on"); b.setAttribute("aria-current", "page"); }
      b.addEventListener("click", () => openItem(st.ctx, it));
      list.append(b);
    }
    inner.append(list);
  }
  const all = el("button", "mx-all", "All tools");
  all.type = "button";
  all.addEventListener("click", () => openLaunchpad());
  inner.append(all);
  side.append(inner);
  const rb = el("button", "mx-reopen", "▶");
  rb.type = "button";
  rb.title = "Show the sidebar";
  rb.setAttribute("aria-label", "Show the sidebar");
  rb.addEventListener("click", () => setCollapsed(false));
  side.append(rb);
  if (typing) { box.focus(); try { box.setSelectionRange(caret[0] ?? box.value.length, caret[1] ?? box.value.length); } catch { /* not a text box */ } }
}

function setCollapsed(on) {
  st.collapsed = !!on;
  save(LS_SIDE, st.collapsed ? "closed" : "open");
  st.side.classList.toggle("mx-collapsed", st.collapsed);
  document.body.classList.toggle("mx-side-closed", st.collapsed);
  const target = st.side.querySelector(st.collapsed ? ".mx-reopen" : ".mx-srch");
  target?.focus?.();
}

// The Simple / Expert buttons are the existing ones. The shell part tells the bus; this also watches CC.uiMode(), so the part works alone.
function tick() {
  if (!st) return;
  const want = (st.CC.uiMode?.() || "simple") === "expert";
  if (want !== st.expert) setExpert(want);
  else syncSelected();
}

function syncSelected() {
  if (!st?.expert) return;
  const key = `${st.CC.S?.view}|${st.CC.S?.cmdShortcut || ""}`;
  if (key === st.lastKey) return;
  st.lastKey = key;
  if (!st.q) renderSide();
  else st.side.querySelectorAll(".si").forEach((b) => {
    const it = st.items.find((i) => i.id === b.dataset.id);
    const on = it && isSelected(st.CC, it);
    b.classList.toggle("on", !!on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}

// ---------- launchpad ----------
function openLaunchpad() {
  if (!st?.expert) return;
  st.lpQ = "";
  st.lpPage = 0;
  st.lastFocus = document.activeElement;
  st.lp.classList.add("on");
  st.lp.setAttribute("aria-hidden", "false");
  renderLaunchpad();
  st.lp.querySelector(".mx-lpq")?.focus();
}

function closeLaunchpad(restore = true) {
  if (!st) return;
  st.lp.classList.remove("on");
  st.lp.setAttribute("aria-hidden", "true");
  if (restore) st.lastFocus?.focus?.();
}

function lpGo(p) {
  const count = st.lpPages.length;
  st.lpPage = Math.max(0, Math.min(count - 1, p));
  const track = st.lp.querySelector(".mx-lpt");
  if (track) track.style.transform = `translateX(${-100 * st.lpPage}%)`;
  st.lp.querySelectorAll(".mx-dots i").forEach((d, i) => {
    d.classList.toggle("on", i === st.lpPage);
    d.setAttribute("aria-current", i === st.lpPage ? "true" : "false");
  });
}

function renderLaunchpad() {
  const { CC, lp } = st;
  const limits = CC.S?.license?.limits;
  const found = search(st.items, st.lpQ);
  st.lpPages = pages(found, PER_PAGE);
  lp.textContent = "";
  const top = el("div", "mx-lptop");
  const box = el("input", "mx-lpq");
  box.type = "search";
  box.placeholder = "Search all tools";
  box.setAttribute("aria-label", "Search all tools");
  box.value = st.lpQ;
  box.addEventListener("input", () => { st.lpQ = box.value; st.lpPage = 0; renderLaunchpad(); const n = lp.querySelector(".mx-lpq"); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); });
  const x = el("button", "mx-lpx", "Close");
  x.type = "button";
  x.addEventListener("click", () => closeLaunchpad());
  top.append(box, x);
  const view = el("div", "mx-lpv");
  const track = el("div", "mx-lpt");
  if (!st.lpPages.length) track.append(el("div", "mx-lpnone", "Nothing matches. Try a shorter word."));
  st.lpPages.forEach((pg, pi) => {
    const grid = el("div", "mx-lpg");
    grid.dataset.page = String(pi);
    for (const it of pg) {
      const b = el("button", "app");
      b.type = "button";
      b.dataset.id = it.id;
      const lock = lockOf(it, limits);
      b.setAttribute("aria-label", lock ? `${it.label}. Part of ${lock}.` : it.label);
      b.title = it.plain;
      const ic = el("i", it.gradient, it.icon);
      ic.setAttribute("aria-hidden", "true");
      b.append(ic, el("span", "mx-an", it.label));
      if (lock) b.append(el("span", "lk", lock));
      b.addEventListener("click", () => { closeLaunchpad(false); openItem(st.ctx, it); });
      grid.append(b);
    }
    track.append(grid);
  });
  view.append(track);
  const dots = el("div", "mx-dots");
  dots.setAttribute("role", "group");
  dots.setAttribute("aria-label", "Pages");
  st.lpPages.forEach((_, i) => {
    const d = el("i");
    d.dataset.p = String(i);
    d.setAttribute("role", "button");
    d.setAttribute("aria-label", `Page ${i + 1}`);
    d.tabIndex = 0;
    d.addEventListener("click", () => lpGo(i));
    d.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); lpGo(i); } });
    dots.append(d);
  });
  lp.append(top, view, dots);
  lp.setAttribute("role", "dialog");
  lp.setAttribute("aria-label", "All tools");
  lpGo(st.lpPage);
  // swipe with a pointer or finger
  let x0 = null;
  view.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
  view.addEventListener("pointerup", (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 60) lpGo(st.lpPage + (e.clientX < x0 ? 1 : -1)); x0 = null; });
}

function lpKey(e) {
  if (!st?.lp.classList.contains("on")) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeLaunchpad(); return; }
  const apps = [...st.lp.querySelectorAll(`.mx-lpg[data-page="${st.lpPage}"] .app`)];
  const at = apps.indexOf(document.activeElement);
  const field = document.activeElement?.classList?.contains("mx-lpq");
  if (e.key === "ArrowRight" && (at >= 0 && at < apps.length - 1)) { e.preventDefault(); apps[at + 1].focus(); }
  else if (e.key === "ArrowLeft" && at > 0) { e.preventDefault(); apps[at - 1].focus(); }
  else if (e.key === "ArrowRight" || e.key === "PageDown") {
    if (field && e.key === "ArrowRight") return; // let the caret move in the search box
    e.preventDefault(); lpGo(st.lpPage + 1); focusFirst();
  } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
    if (field) return;
    e.preventDefault(); lpGo(st.lpPage - 1); focusFirst();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (at >= 0) apps[Math.min(apps.length - 1, at + COLS)]?.focus(); else apps[0]?.focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (at >= COLS) apps[at - COLS].focus(); else st.lp.querySelector(".mx-lpq")?.focus();
  } else if (e.key === "Enter" && field) {
    apps[0]?.click();
  }
}

function focusFirst() {
  st.lp.querySelector(`.mx-lpg[data-page="${st.lpPage}"] .app`)?.focus();
}

// ---------- mode ----------
function setExpert(on) {
  if (!st) return;
  st.expert = on;
  document.body.classList.toggle("mx-expert", on);
  if (on) {
    st.items = makeItems(st.CC);
    st.side.hidden = false;
    st.side.classList.toggle("mx-collapsed", st.collapsed);
    document.body.classList.toggle("mx-side-closed", st.collapsed);
    st.lastKey = "";
    renderSide();
  } else {
    closeLaunchpad(false);
    st.side.textContent = "";
    st.side.hidden = true;
    document.body.classList.remove("mx-side-closed");
  }
}

export default {
  id: "expert",
  mount(ctx) {
    const { CC, bus } = ctx;
    const side = ensureSlot("mac-side", "mx-side");
    const lp = ensureSlot("mac-launchpad", "mx-lp");
    side.setAttribute("aria-label", "Sidebar");
    lp.setAttribute("aria-hidden", "true");
    st = { ctx, CC, bus, side, lp, q: "", lpQ: "", lpPage: 0, lpPages: [], items: [], expert: false, collapsed: store(LS_SIDE, "open") === "closed", off: [] };
    st.off.push(bus.on("mode", (m) => setExpert(m === "expert")));
    st.off.push(bus.on("view", () => syncSelected()));
    st.off.push(bus.on("open", (e) => {
      if (e?.panel === "launchpad") openLaunchpad();
      else if (e?.panel === "sidebar" && st.expert) setCollapsed(!st.collapsed);
      else if (e?.panel && e.panel !== "launchpad" && st.lp.classList.contains("on")) closeLaunchpad(false);
    }));
    st.keydown = (e) => lpKey(e);
    document.addEventListener("keydown", st.keydown, true);
    // a click on the dimmed backdrop (not on a tool) closes the launchpad
    lp.addEventListener("click", (e) => { if (e.target === lp || e.target.classList.contains("mx-lpg") || e.target.classList.contains("mx-lpv")) closeLaunchpad(); });
    if ((CC.uiMode?.() || "simple") === "expert") setExpert(true); else side.hidden = true;
    st.timer = setInterval(tick, 400);
  },
  unmount() {
    if (!st) return;
    clearInterval(st.timer);
    document.removeEventListener("keydown", st.keydown, true);
    st.off.forEach((f) => f());
    document.body.classList.remove("mx-expert", "mx-side-closed");
    st.side.textContent = "";
    st.lp.textContent = "";
    st.lp.classList.remove("on");
    for (const s of [st.side, st.lp]) if (s.dataset.madeBy === "expert") s.remove();
    st = null;
  },
};
