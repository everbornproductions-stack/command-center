// Mac part "panel" (0.4.23): the settings drawer that slides in from the right.
// Opens on bus "open" {panel: "settings", section?}, paints the rows of the mode the
// window is in (Expert: every section, Simple: Settings basics), and every row click
// opens the real setting through the app's own openers. Escape and Done close it.
import { sectionsForMode, filterSections, rowById, SIMPLE_TITLE } from "/mac/data/panel.js";

const SLOT = "mac-panel";
const HEAD = `
  <header class="mp-head">
    <h2 class="mp-title" id="mac-panel-title">Settings</h2>
    <button type="button" class="mp-done" data-mp-done>Done</button>
  </header>
  <p class="mp-sub">Advanced settings. Changes save by themselves.</p>
  <div class="mp-find">
    <input type="search" data-mp-find placeholder="Search settings" aria-label="Search settings" autocomplete="off" spellcheck="false">
  </div>
  <div class="mp-scroll" data-mp-body></div>`;

let ctx = null;
let panel = null;
let query = "";
let lastFocus = null;
let offBus = [];
let onDocKey = null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// The shell part makes the slots. Until it exists, this part makes its own.
function ensurePanel() {
  const have = document.getElementById(SLOT);
  if (have && have.querySelector("[data-mp-body]")) return have;
  let el = have;
  if (!el) {
    let root = document.getElementById("mac-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "mac-root";
      document.body.appendChild(root);
    }
    el = document.createElement("section");
    el.id = SLOT;
    root.appendChild(el);
  }
  el.classList.add("mac-panel");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", "mac-panel-title");
  el.setAttribute("aria-hidden", "true");
  el.inert = true;
  if (!el.querySelector("[data-mp-body]")) el.innerHTML = HEAD;
  return el;
}

function modeNow() {
  const m = ctx?.CC?.uiMode?.();
  return m === "expert" ? "expert" : "simple";
}

function rowHtml(r) {
  return `<button type="button" class="mp-row" data-row="${esc(r.id)}">
    <span class="mp-row-t">${esc(r.title)}</span>
    <span class="mp-row-l">${esc(r.line)}</span>
  </button>`;
}

function paint(section) {
  const body = panel?.querySelector("[data-mp-body]");
  if (!body) return;
  const expert = modeNow() === "expert";
  const title = panel.querySelector(".mp-title");
  if (title) title.textContent = expert ? "Settings" : SIMPLE_TITLE;
  const sections = filterSections(sectionsForMode(modeNow()), query);
  body.innerHTML = sections.length
    ? sections.map((s) => `<section class="mp-sec" data-section="${esc(s.id)}">
        <h3 class="mp-sec-t">${esc(s.title)}</h3>
        ${s.rows.map(rowHtml).join("")}
      </section>`).join("")
    : `<p class="mp-empty">No setting matches those words.</p>`;
  if (section) body.querySelector(`[data-section="${CSS.escape(section)}"]`)?.scrollIntoView({ block: "start" });
}

function open(section) {
  if (!panel) return;
  lastFocus = document.activeElement;
  query = "";
  const find = panel.querySelector("[data-mp-find]");
  if (find) find.value = "";
  paint(section);
  panel.classList.add("on");
  panel.inert = false;
  panel.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => panel?.querySelector("[data-mp-find]")?.focus());
}

function close() {
  if (!panel || !panel.classList.contains("on")) return;
  panel.classList.remove("on");
  panel.inert = true;
  panel.setAttribute("aria-hidden", "true");
  const back = lastFocus;
  lastFocus = null;
  if (back && document.contains(back) && typeof back.focus === "function") { try { back.focus(); } catch { /* the old focus target is gone */ } }
}

function isOpen() {
  return !!panel?.classList.contains("on");
}

// One row, one existing opener. Nothing is rebuilt here.
function openRow(row) {
  const { CC } = ctx;
  const open = row.open || {};
  if (open.view) {
    if (open.focus) CC.S.navFocus = open.focus;
    CC.go(open.view);
  } else if (open.settings) {
    CC.openSettings?.(open.settings);
  } else if (open.feature) {
    CC.openSettings?.(`[data-feature='${open.feature}']`);
  } else if (open.link) {
    const el = document.querySelector(open.link);
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    try { el?.focus?.(); } catch { /* anchors are not always focusable */ }
  } else if (open.mode) {
    const want = open.mode === "toggle" ? (modeNow() === "expert" ? "simple" : "expert") : open.mode;
    document.getElementById(`mode-${want}`)?.click();
  }
}

export default {
  id: "panel",
  mount(c) {
    ctx = c;
    panel = ensurePanel();

    panel.querySelector("[data-mp-done]")?.addEventListener("click", close);
    panel.querySelector("[data-mp-find]")?.addEventListener("input", (e) => {
      query = e.target.value || "";
      paint();
    });
    panel.querySelector("[data-mp-body]")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-row]");
      if (!b) return;
      const row = rowById(b.dataset.row);
      if (!row) return;
      openRow(row);
      close();
    });

    offBus.push(c.bus.on("open", (d) => (d?.panel === "settings" ? open(d.section) : close())));
    offBus.push(c.bus.on("mode", () => { if (isOpen()) paint(); }));

    onDocKey = (e) => {
      if (e.key !== "Escape" || !isOpen()) return;
      e.preventDefault();
      close();
    };
    document.addEventListener("keydown", onDocKey);
  },
  unmount() {
    for (const off of offBus) { try { off(); } catch { /* already gone */ } }
    offBus = [];
    if (onDocKey) document.removeEventListener("keydown", onDocKey);
    onDocKey = null;
    close();
    panel?.remove();
    panel = null;
    ctx = null;
  },
};
