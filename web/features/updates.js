// Top-bar update button and Help > Check for updates.
// The main process (electron/updater.cjs) is what actually checks. This only shows the result
// and starts a download after a click. Nothing is fetched from here.

function labelFor(state) {
  if (!state) return null;
  if (state.phase === "downloading") {
    const n = state.percent != null ? state.percent : state.progress;
    return `Downloading ${n ?? 0}%`;
  }
  if (state.phase === "downloaded" || state.phase === "installing" || state.phase === "available" || state.available) return "Update ready, restart";
  return null;
}

const DOWNLOAD_PAGE = "https://github.com/everbornproductions-stack/command-center-releases/releases/latest";

function openDownload(state) {
  const url = (state && state.downloadUrl) || DOWNLOAD_PAGE;
  const desk = window.ccDesktop;
  if (desk?.openExternal) { desk.openExternal(url).catch(() => {}); return; }
  window.open(url, "_blank", "noopener");
}

let desktop = null;
let failHidden = false;

function merged() {
  const server = window.CC?.S?.update;
  if (desktop && (desktop.version || desktop.phase === "downloading" || desktop.phase === "downloaded" || desktop.phase === "available" || desktop.phase === "failed")) {
    return { phase: desktop.phase, version: desktop.version, percent: desktop.percent, progress: desktop.percent, available: desktop.phase === "available" || desktop.phase === "downloading" || desktop.phase === "downloaded", current: desktop.current, error: desktop.error, downloadUrl: desktop.downloadUrl, detail: desktop.detail };
  }
  if (server?.available || server?.error) return server;
  return server || desktop;
}

function paint() {
  const host = document.querySelector(".top-right");
  if (!host) return;
  let b = document.getElementById("upd-top");
  if (!b) {
    b = document.createElement("button");
    b.type = "button";
    b.id = "upd-top";
    b.className = "btn sm primary";
    b.hidden = true;
    b.addEventListener("click", onButton);
    host.prepend(b);
  }
  const state = merged();
  const label = labelFor(state);
  const failed = !label && state && (state.phase === "failed" || (state.error && !state.available && !state.version));
  // A failed check is a quiet line in the notice row above the page, not in the top bar,
  // so it never crowds the menus or covers the page (0.4.17). One line only: when the
  // engine's own notice already says it, this one stays hidden.
  let note = document.getElementById("upd-fail");
  const bar = document.getElementById("update-bar");
  const engineSays = !!bar && bar.style.display !== "none" && /Couldn't check for updates/.test(bar.textContent || "");
  if (failed && !failHidden && !engineSays) {
    if (!note) {
      note = document.createElement("div");
      note.id = "upd-fail";
      note.className = "update-bar quiet";
      note.setAttribute("role", "status");
      const text = document.createElement("b");
      text.textContent = "Couldn't check for updates";
      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "btn sm";
      dl.textContent = "Open the download page"; // 0.4.27: the check found nothing to download
      dl.addEventListener("click", () => openDownload(merged()));
      const hide = document.createElement("button");
      hide.type = "button";
      hide.className = "ghost small";
      hide.textContent = "Hide";
      hide.addEventListener("click", () => { failHidden = true; note.hidden = true; });
      note.append(text, dl, hide);
      (document.getElementById("notices") || host).appendChild(note);
    }
    note.hidden = false;
  } else if (note) note.hidden = true;
  if (!label) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = label;
  const version = state.version || state.latest;
  b.title = version ? `${label}: v${version}` : label;
  b.setAttribute("aria-label", b.title);
  b.disabled = state.phase === "downloading" || state.phase === "installing";
}

async function onButton() {
  const desk = window.ccDesktop;
  if (desk?.installUpdate) {
    try { await desk.installUpdate(); }
    catch (e) { window.CC?.toast?.(e.message || "Update failed", true); }
    return;
  }
  const u = window.CC?.S?.update;
  if (u?.url) { window.open(u.url, "_blank", "noopener"); return; }
  try { window.CC.S.update = await window.CC.api("/update/install", { method: "POST" }); paint(); window.CC.toast("Downloading the update; the app restarts when it is ready"); }
  catch (e) { window.CC?.toast?.(e.message || "Update failed", true); }
}

async function manualCheck() {
  window.CC?.toast?.("Checking for updates...");
  const desk = window.ccDesktop;
  try {
    if (desk?.checkForUpdates) {
      const st = await desk.checkForUpdates();
      if (st) desktop = st;
      paint();
      const label = labelFor(merged());
      if ((st?.phase === "failed" || st?.error) && !label) window.CC?.toast?.("Couldn't check for updates", true);
      else if (label) window.CC?.toast?.(st?.version ? `Update ready, restart: v${st.version}` : label);
      else window.CC?.toast?.("You have the newest version.");
      return;
    }
    const u = await window.CC.api("/update/check", { method: "POST" });
    window.CC.S.update = u;
    paint();
    if (u?.available) window.CC.toast(`Update ready, restart: v${u.latest}`);
    else if (u?.error) window.CC.toast("Couldn't check for updates", true);
    else window.CC.toast("You have the newest version.");
  } catch (e) { window.CC?.toast?.(e.message || "Could not check for updates", true); }
}

function closeMenu(b) {
  const menu = b.closest?.(".nav-menu");
  if (!menu) return;
  menu.classList.remove("open");
  menu.querySelector(".nav-trigger")?.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-action='updates']");
  if (!b) return;
  closeMenu(b);
  manualCheck();
});

window.CC.register({
  id: "updates",
  onState() { paint(); },
  onEvent(ev) {
    if (ev?.type === "update.state" && ev.update) { window.CC.S.update = ev.update; paint(); }
  },
});

if (window.ccDesktop?.onUpdate) window.ccDesktop.onUpdate((st) => { desktop = st; paint(); });
if (window.ccDesktop?.updateState) window.ccDesktop.updateState().then((st) => { if (st) { desktop = st; paint(); } }).catch(() => {});
paint();
