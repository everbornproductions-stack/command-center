// Mac part "shell" (0.4.23): the window frame and the title bar.
// It owns #mac-root and the seven slots the other parts draw into, the light / dark theme,
// the Simple / Expert switch, the ready pill and the crumb.
// Everything runs only while body[data-style="mac"] is set by /mac/index.js, and it all lives
// inside #mac-root, so turning the Mac style off puts the page back the way it was.
import { LABELS } from "/nav.js";
import { readyLine, crumbFor, modeBanner } from "/mac/data/shell.js";

const THEME_KEY = "cc.mac.theme";

const TITLEBAR = `
  <span class="mac-tl" aria-hidden="true"><i></i><i></i><i></i></span>
  <button type="button" class="mac-ib" id="mac-sidebtn" aria-expanded="false" aria-label="Show or hide history" title="Show or hide history"><span aria-hidden="true">▤</span><span class="sr-only">Side</span></button>
  <span class="mac-title"><b>Meldmind</b><small id="mac-crumb">Home</small></span>
  <span class="mac-gap"></span>
  <span class="mac-pill" id="mac-ready" role="status" title="Your AIs right now"><span class="mac-dot" aria-hidden="true"></span><span id="mac-ready-txt">No AIs yet</span></span>
  <span class="mac-toggle" id="mac-toggle" role="group" aria-label="Simple or Expert" data-mode="simple">
    <span class="mac-knob" aria-hidden="true"></span>
    <button type="button" id="mac-simple" class="on" aria-pressed="true">Simple</button>
    <button type="button" id="mac-expert" aria-pressed="false">Expert</button>
  </span>
  <button type="button" class="mac-ib" id="mac-theme" title="Light or dark" aria-label="Switch to dark"><span data-glyph aria-hidden="true">☾</span><span class="sr-only">Theme</span></button>
  <button type="button" class="mac-ib" id="mac-help" title="Help" aria-label="Help"><span aria-hidden="true">?</span><span class="sr-only">Help</span></button>
  <div class="mac-flash" id="mac-flash" role="status" aria-live="polite"></div>`;

// What mount undid: timers, observers and document listeners.
let CLEANUPS = [];
let FLASH_TIMER = 0;

// Make a slot inside the frame, reusing one that is already there.
function slot(id, parent) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement("div"); el.id = id; }
  if (el.parentElement !== parent) parent.appendChild(el);
  return el;
}

// Can this window draw frosted glass at all? The same feature test web/features/look.js uses.
function backdropOk() {
  try {
    if (typeof CSS === "undefined" || !CSS.supports) return true;
    return CSS.supports("backdrop-filter", "blur(2px)") || CSS.supports("-webkit-backdrop-filter", "blur(2px)");
  } catch { return true; }
}

export default {
  id: "shell",

  mount(ctx) {
    const { CC, bus } = ctx;
    const on = (el, ev, fn) => { el?.addEventListener(ev, fn); CLEANUPS.push(() => el?.removeEventListener(ev, fn)); };

    let root = document.getElementById("mac-root");
    if (!root) { root = document.createElement("div"); root.id = "mac-root"; document.body.appendChild(root); }

    const titlebar = slot("mac-titlebar", root);
    slot("mac-side", root);
    const main = slot("mac-main", root);
    slot("mac-flow", main);
    slot("mac-dock", root);
    slot("mac-launchpad", root);
    slot("mac-panel", root);

    if (!titlebar.querySelector(".mac-tl")) titlebar.innerHTML = TITLEBAR;

    const $ = (id) => document.getElementById(id);
    const sideBtn = $("mac-sidebtn"), crumbEl = $("mac-crumb"), readyEl = $("mac-ready-txt");
    const toggle = $("mac-toggle"), simpleBtn = $("mac-simple"), expertBtn = $("mac-expert");
    const themeBtn = $("mac-theme"), helpBtn = $("mac-help"), flash = $("mac-flash");

    let disposed = false, live = false, lastMode = "", lastView = "";
    CLEANUPS.push(() => { disposed = true; clearTimeout(FLASH_TIMER); });

    // ---- theme: light or dark, remembered on this computer ----
    const storedTheme = () => { const saved = CC.S?.settings?.theme; if (saved === "light" || saved === "dark") return saved; try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
    function applyTheme(value, emit) {
      const theme = value === "light" ? "light" : "dark";
      document.body.dataset.theme = theme;
      try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: the choice lives for this visit */ }
      const dark = theme === "dark";
      themeBtn?.setAttribute("aria-label", dark ? "Switch to light" : "Switch to dark");
      const glyph = themeBtn?.querySelector("[data-glyph]");
      if (glyph) glyph.textContent = dark ? "☀" : "☾";
      if (emit) { bus.emit("theme", theme); CC.api?.("/settings", { method: "POST", body: { theme } }).then(() => { if (CC.S?.settings) CC.S.settings.theme = theme; }).catch(() => {}); }
    }

    // ---- the title bar paint jobs ----
    function paintMode(mode) {
      const expert = mode === "expert";
      if (toggle) toggle.dataset.mode = expert ? "expert" : "simple";
      simpleBtn?.classList.toggle("on", !expert);
      expertBtn?.classList.toggle("on", expert);
      simpleBtn?.setAttribute("aria-pressed", String(!expert));
      expertBtn?.setAttribute("aria-pressed", String(expert));
      const words = expert ? "Show or hide the sidebar" : "Show or hide history";
      sideBtn?.setAttribute("aria-label", words);
      if (sideBtn) sideBtn.title = words;
      sideBtn?.setAttribute("aria-expanded", String(document.body.classList.contains("mac-sideopen")));
    }
    function paintCrumb() {
      const text = crumbFor(CC.S?.view, LABELS);
      if (crumbEl && crumbEl.textContent !== text) crumbEl.textContent = text;
    }
    function paintReady() {
      const text = readyLine(CC.S?.providers);
      if (readyEl && readyEl.textContent !== text) readyEl.textContent = text;
    }
    function flashMode(mode) {
      if (!flash) return;
      flash.textContent = modeBanner(mode);
      flash.classList.remove("on");
      void flash.offsetWidth; // restart the slide from the top
      flash.classList.add("on");
      clearTimeout(FLASH_TIMER);
      FLASH_TIMER = setTimeout(() => flash.classList.remove("on"), 1400);
    }

    // Frosted glass is off when this window cannot draw it, or when the Look setting says classic.
    function paintGlass() {
      const look = document.documentElement.dataset.look;
      const glassOff = (!!look && look !== "glass") || document.documentElement.dataset.blur === "off";
      document.body.classList.toggle("mac-noblur", glassOff || !backdropOk());
    }

    // ---- one cheap pass over the state the title bar reads ----
    function sync() {
      const mode = CC.uiMode?.() || "simple";
      const view = CC.S?.view || "";
      if (mode !== lastMode) {
        lastMode = mode;
        paintMode(mode);
        if (live) { flashMode(mode); bus.emit("mode", mode); }
      }
      if (view !== lastView) {
        lastView = view;
        paintCrumb();
        if (live) bus.emit("view", view);
      }
      sideBtn?.setAttribute("aria-expanded", String(document.body.classList.contains("mac-sideopen")));
      paintReady();
    }

    // Parts talk through the bus too: a view or mode another part announces repaints the bar.
    CLEANUPS.push(bus.on("view", paintCrumb), bus.on("mode", () => paintMode(CC.uiMode?.() || "simple")));

    paintMode(CC.uiMode?.() || "simple");
    paintCrumb();
    paintReady();
    paintGlass();
    applyTheme(storedTheme() || (document.documentElement.dataset.theme === "light" ? "light" : "dark"), false);
    lastMode = CC.uiMode?.() || "simple";
    lastView = CC.S?.view || "";
    live = true;

    // The other parts mount after this one, so they hear the first mode and view once everyone is in.
    const kick = setTimeout(() => { if (!disposed) { bus.emit("mode", lastMode); bus.emit("view", lastView); } }, 400);
    CLEANUPS.push(() => clearTimeout(kick));

    // The app writes body[data-ui] and body[data-view] on every redraw, so watch those two and tick once a second.
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-ui", "data-view", "class"] });
    CLEANUPS.push(() => obs.disconnect());
    const viewEl = document.getElementById("view");
    if (viewEl) {
      const viewObs = new MutationObserver(sync);
      viewObs.observe(viewEl, { attributes: true, attributeFilter: ["data-view"] });
      CLEANUPS.push(() => viewObs.disconnect());
    }
    const lookObs = new MutationObserver(paintGlass);
    lookObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-look", "data-blur"] });
    CLEANUPS.push(() => lookObs.disconnect());
    const tick = setInterval(sync, 1000);
    CLEANUPS.push(() => clearInterval(tick));

    // ---- buttons ----
    on(sideBtn, "click", () => {
      const open = document.body.classList.toggle("mac-sideopen");
      sideBtn.setAttribute("aria-expanded", String(open));
      const panel = (CC.uiMode?.() || "simple") === "simple" ? "history" : "sidebar";
      bus.emit("open", { panel, open });
    });
    // The switch moves the real buttons, so settings and the per-project mode keep working.
    on(simpleBtn, "click", () => document.getElementById("mode-simple")?.click());
    on(expertBtn, "click", () => document.getElementById("mode-expert")?.click());
    on(themeBtn, "click", () => applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark", true));
    on(helpBtn, "click", () => CC.go?.("help"));

    const onKey = (e) => {
      if (e.key !== "Escape" || !document.body.classList.contains("mac-sideopen")) return;
      document.body.classList.remove("mac-sideopen");
      sideBtn?.setAttribute("aria-expanded", "false");
      const panel = (CC.uiMode?.() || "simple") === "simple" ? "history" : "sidebar";
      bus.emit("open", { panel, open: false });
    };
    document.addEventListener("keydown", onKey);
    CLEANUPS.push(() => document.removeEventListener("keydown", onKey));
  },

  unmount() {
    for (const fn of CLEANUPS.splice(0)) { try { fn(); } catch { /* already gone */ } }
    clearTimeout(FLASH_TIMER);
    document.body.classList.remove("mac-sideopen", "mac-noblur");
    delete document.body.dataset.theme;
  },
};
