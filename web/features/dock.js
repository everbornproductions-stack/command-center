// Chat dock (0.4.21): "chat stays put". A small chat sits at the bottom of every page except the chat
// itself. It fills a greyed suggestion from where you are (the suggestion is never typed for you), and
// Send moves to the one shared working view (Command). When the run is done there is a Back button.
// DOM ids are listed in the area C contract (cc-dock, cc-dock-input, cc-dock-send, cc-back-bar, ...).
import { dockShows, dockContext, contextLabel, suggestionFor, workingLine, finishedLine, backLabel, DOCK_MODES } from "/dock-context.js";

const CC = window.CC;
const S = () => CC.S;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BUSY = new Set(["running", "planning", "assembling"]);
const COLLAPSE_KEY = "cc.dock.collapsed";

let el = null;
let draft = "";          // what the person typed; survives page changes
let undoText = null;     // what was in the box before a suggestion was accepted
let skipped = "";        // suggestion text the person said no thanks to
let raf = 0;

function busy() {
  const s = S();
  return !!(s.awaitingRun || (s.live?.id && BUSY.has(s.live.status)));
}
function working() {
  const a = S().activeByProvider || {};
  return Object.values(a).filter((n) => n > 0).length;
}
function collapsed() {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    if (v === "1" || v === "0") return v === "1";
  } catch { /* storage can be blocked */ }
  return window.innerHeight < 800;
}
function setCollapsed(on) {
  try { localStorage.setItem(COLLAPSE_KEY, on ? "1" : "0"); } catch { /* fine */ }
  update();
}
function projectName() {
  const s = S();
  const id = s.openProject || s.project;
  return (s.projects || []).find((p) => p.id === id)?.name || "";
}
function lastRunTitle() {
  const s = S();
  const id = s.openProject || s.project;
  if (!id) return "";
  const runs = (s.missions || []).filter((m) => m.projectId === id && m.title).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return runs[0]?.title || "";
}
function currentSuggestion() {
  const s = S();
  return suggestionFor({ view: s.view, openProject: s.openProject, projectName: projectName(), lastTitle: lastRunTitle(), result: s.dockResult || null });
}

function mount() {
  if (el) return el;
  const col = document.querySelector(".view-col");
  const view = document.getElementById("view");
  if (!col || !view) return null;
  el = document.createElement("section");
  el.id = "cc-dock";
  el.className = "cc-dock";
  el.setAttribute("aria-label", "Chat");
  el.innerHTML = `
    <div class="dock-head">
      <span id="cc-dock-ctx" class="dock-ctx"></span>
      <button type="button" id="cc-dock-toggle" class="dock-toggle" aria-expanded="true" aria-controls="cc-dock-body"></button>
    </div>
    <div id="cc-dock-status" class="dock-status" role="status" hidden>
      <span class="dock-pulse" aria-hidden="true"></span><span id="cc-dock-status-text"></span>
      <button type="button" id="cc-dock-watch" class="btn sm">Watch</button>
    </div>
    <div id="cc-dock-body" class="dock-body">
      <div id="cc-dock-suggest" class="dock-suggest" hidden>
        <button type="button" id="cc-dock-chip" class="dock-chip" title="A suggestion. Nothing is typed until you use it."></button>
        <button type="button" id="cc-dock-use" class="btn sm">Use this</button>
        <button type="button" id="cc-dock-skip" class="ghost small">No thanks</button>
      </div>
      <button type="button" id="cc-dock-undo" class="dock-undo ghost small" hidden>Undo</button>
      <div class="dock-compose">
        <textarea id="cc-dock-input" rows="2" aria-label="Chat. Type what you want." placeholder="Type what you want. Press Ctrl+Enter to send."></textarea>
        <button type="button" id="cc-dock-send" class="btn primary">Send</button>
      </div>
      <div class="dock-row">
        <div id="cc-dock-modes" class="seg dock-modes" role="group" aria-label="How to run it" hidden>${DOCK_MODES.map(([m, l]) => `<button type="button" data-dock-mode="${m}">${esc(l)}</button>`).join("")}</div>
        <button type="button" id="cc-dock-more" class="ghost small">Full chat options</button>
      </div>
    </div>`;
  view.after(el);
  const input = el.querySelector("#cc-dock-input");
  input.value = draft;
  input.addEventListener("input", () => {
    draft = input.value;
    undoText = null;
    if (draft.trim() && S().dockResult) S().dockResult = null;
    queue();
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  el.querySelector("#cc-dock-send").addEventListener("click", send);
  el.querySelector("#cc-dock-toggle").addEventListener("click", () => setCollapsed(!collapsed()));
  el.querySelector("#cc-dock-use").addEventListener("click", useSuggestion);
  el.querySelector("#cc-dock-chip").addEventListener("click", useSuggestion);
  el.querySelector("#cc-dock-skip").addEventListener("click", () => { skipped = currentSuggestion()?.text || ""; if (S().dockResult) S().dockResult = null; update(); });
  el.querySelector("#cc-dock-undo").addEventListener("click", () => {
    if (undoText === null) return;
    input.value = undoText; draft = undoText; undoText = null; update(); input.focus();
  });
  el.querySelector("#cc-dock-modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dock-mode]"); if (!b) return;
    S().cmdMode = b.dataset.dockMode; S().cmdShortcut = "";
    update();
  });
  el.querySelector("#cc-dock-more").addEventListener("click", () => openWorkingView(false));
  el.querySelector("#cc-dock-watch").addEventListener("click", () => openWorkingView(false));
  return el;
}

// The greyed suggestion is only a chip. "Use this" is the person saying yes; Undo gives their words back.
function useSuggestion() {
  const sug = currentSuggestion(); if (!sug) return;
  const input = el.querySelector("#cc-dock-input");
  undoText = input.value;
  input.value = sug.text; draft = sug.text;
  if (S().dockResult) S().dockResult = null;
  update();
  input.focus();
}

function queue() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); }

function update() {
  const s = S();
  if (!s) return;
  const show = dockShows(s.view);
  document.body.classList.toggle("cc-dock-on", show && !!(el || mount()));
  if (!show) { if (el) el.hidden = true; document.body.classList.remove("cc-dock-collapsed"); syncBackBar(); syncExpertCard(); return; }
  if (!mount()) return;
  el.hidden = false;
  const col = collapsed();
  const expert = s.uiMode === "expert";
  const ctx = dockContext(s.view, s.openProject);
  el.dataset.view = s.view; el.dataset.ctx = ctx; el.dataset.collapsed = col ? "1" : "0"; el.dataset.ui = expert ? "expert" : "simple";
  document.body.classList.toggle("cc-dock-collapsed", col);
  el.querySelector("#cc-dock-ctx").textContent = contextLabel(ctx, projectName());
  const tg = el.querySelector("#cc-dock-toggle");
  tg.textContent = col ? "Open chat options" : "Collapse";
  tg.setAttribute("aria-expanded", col ? "false" : "true");
  // suggestion chip: only while the box is empty and the person has not said no
  const sug = currentSuggestion();
  const box = el.querySelector("#cc-dock-input");
  const showSug = !!sug && !box.value.trim() && sug.text !== skipped && !busy();
  const sugEl = el.querySelector("#cc-dock-suggest");
  sugEl.hidden = !showSug;
  if (showSug) el.querySelector("#cc-dock-chip").textContent = sug.text;
  el.querySelector("#cc-dock-undo").hidden = undoText === null;
  // Expert options
  const modes = el.querySelector("#cc-dock-modes");
  modes.hidden = !expert || col;
  const cur = s.cmdMode || "single";
  modes.querySelectorAll("[data-dock-mode]").forEach((b) => b.classList.toggle("on", b.dataset.dockMode === cur));
  el.querySelector("#cc-dock-more").hidden = col;
  // mini status while an AI run is going
  const st = el.querySelector("#cc-dock-status");
  st.hidden = !busy();
  if (busy()) el.querySelector("#cc-dock-status-text").textContent = workingLine(s.live, working());
  el.querySelector("#cc-dock-send").disabled = busy();
  syncBackBar();
  syncExpertCard();
}

// ---- Send: always goes to the one shared working view ----
function openWorkingView(keepReturn) {
  const s = S();
  if (!keepReturn) s.dockReturn = s.dockReturn || null;
  s.openProject = null;
  s.view = "command";
  CC.render();
}

async function send() {
  const s = S();
  const input = el.querySelector("#cc-dock-input");
  const text = input.value.trim();
  if (!text) return CC.toast("Type what you want first, or press Use this.", true);
  if (busy()) return CC.toast("Still working on the last one. Watch it, or wait for it to finish.", true);
  s.dockReturn = { view: s.view, openProject: s.openProject || null, project: s.openProject || s.project || "", name: projectName() };
  if (s.openProject) CC.setWorkingProject?.(s.openProject);
  s.lastOrders = text;
  s.dockResult = null;
  input.value = ""; draft = ""; undoText = null;
  s.openProject = null;
  s.view = "command";
  CC.render();
  // The chat page may load a moment later (its code loads on first use); wait for the real box.
  const deadline = Date.now() + 8000;
  const go = () => {
    const box = document.getElementById("orders");
    const btn = document.getElementById("go");
    if (box && btn && s.view === "command") {
      box.value = text;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      btn.click();
      return;
    }
    if (Date.now() < deadline) setTimeout(go, 50);
    else { input.value = text; draft = text; }
  };
  go();
}

// ---- Back bar on the working view ----
function syncBackBar() {
  const s = S();
  let bar = document.getElementById("cc-back-bar");
  const ret = s.dockReturn;
  if (!ret || s.view !== "command") {
    bar?.remove();
    if (ret && s.view !== "command") s.dockReturn = null;
    return;
  }
  const view = document.getElementById("view");
  if (!view) return;
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "cc-back-bar";
    bar.className = "back-bar";
    bar.innerHTML = `<button type="button" id="cc-back-btn" class="btn sm"></button><span class="back-note" role="status"></span>`;
    view.prepend(bar);
    bar.querySelector("#cc-back-btn").addEventListener("click", goBack);
  }
  const live = s.live || {};
  const isBusy = busy();
  bar.querySelector("#cc-back-btn").textContent = backLabel(ret);
  const note = bar.querySelector(".back-note");
  const place = ret.name || (ret.project ? "your project" : "");
  if (isBusy) note.textContent = "The AIs are working together on this. You can go back; it keeps running.";
  else if (live.id) note.textContent = `${finishedLine(live)}${place ? ` Saved in ${place}.` : ""}`;
  else note.textContent = "";
  bar.dataset.state = isBusy ? "working" : live.id ? "done" : "idle";
}

function goBack() {
  const s = S();
  const ret = s.dockReturn;
  if (!ret) return;
  const live = s.live || {};
  if (!busy() && live.id && live.status !== "failed" && live.status !== "aborted") {
    s.dockResult = { title: live.mission?.title || s.lastPrompt || "this result" };
  }
  s.dockReturn = null;
  s.view = ret.view || "projects";
  s.openProject = ret.openProject || null;
  CC.render();
}

// ---- Expert setup is a small card, never opened over the page (M24) ----
function syncExpertCard() {
  const s = S();
  let card = document.getElementById("cc-expert-card");
  if (!s.expertOffer || s.view === "setup") { card?.remove(); return; }
  if (card) return;
  const notices = document.getElementById("notices");
  if (!notices) return;
  card = document.createElement("div");
  card.id = "cc-expert-card";
  card.className = "dock-card";
  card.setAttribute("role", "region");
  card.setAttribute("aria-label", "Expert setup");
  card.innerHTML = `<span><b>You are in Expert.</b> A short setup (about 2 minutes) picks your AIs and defaults. Your page stays as it is.</span>
    <button type="button" id="cc-expert-start" class="btn sm primary">Set up Expert</button>
    <button type="button" id="cc-expert-later" class="ghost small">Later</button>`;
  notices.after(card);
  card.querySelector("#cc-expert-later").addEventListener("click", () => { s.expertOffer = false; card.remove(); });
  card.querySelector("#cc-expert-start").addEventListener("click", () => {
    s.expertOffer = false; card.remove();
    s.connectWizard = false; s.openProject = null; s.view = "setup";
    s.setup = s.setup || {}; s.setup.phase = "expert"; s.setup.expertStep = s.settings?.expertSetup?.step || "ais";
    CC.render();
  });
}

// ---- Expert Live ops starts as a slim status bar ----
function syncOpsSlim() {
  const s = S();
  const panel = document.getElementById("ops-panel");
  let slim = document.getElementById("cc-ops-slim");
  if (!panel || s.view !== "command") { slim?.remove(); return; }
  const live = s.live || {};
  const running = !!live.id && (busy() || Object.keys(live.tasks || {}).length > 0 || live.kind === "council");
  if (!running) { slim?.remove(); panel.classList.remove("slim-collapsed"); return; }
  const open = s.opsExpandedFor === live.id;
  if (!slim) {
    slim = document.createElement("div");
    slim.id = "cc-ops-slim";
    slim.className = "ops-slim";
    slim.innerHTML = `<span class="dock-pulse" aria-hidden="true"></span><span class="ops-slim-text"></span><button type="button" id="cc-ops-expand" class="btn sm"></button>`;
    panel.before(slim);
    slim.querySelector("#cc-ops-expand").addEventListener("click", () => {
      const l = S().live || {};
      S().opsExpandedFor = S().opsExpandedFor === l.id ? "" : l.id;
      syncOpsSlim();
      try { CC.graph?.resize?.(); } catch { /* the map redraws on its own */ }
    });
  }
  const finished = !busy();
  slim.querySelector(".ops-slim-text").textContent = finished ? finishedLine(live) : workingLine(live, working());
  const btn = slim.querySelector("#cc-ops-expand");
  btn.textContent = open ? "Hide the map" : "Live view";
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  panel.classList.toggle("slim-collapsed", !open);
}

CC.dock = {
  onRender() { update(); syncOpsSlim(); },
  update,
  expandOps() { const l = S().live || {}; if (l.id) { S().opsExpandedFor = l.id; syncOpsSlim(); } },
};

CC.register({
  id: "dock",
  onEvent() { queue(); setTimeout(syncOpsSlim, 0); },
  onState() { queue(); },
});
window.addEventListener("resize", () => queue());
update();
