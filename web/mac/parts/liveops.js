// Mac part "liveops" (0.4.23): the Simple "AIs working" card and the Expert Live Ops screen.
// It never rebuilds the app's own nodes: #ops-panel (which holds #graph, #tasks and #council) and #feed
// are reparented into this screen and handed back when the screen closes.
// Talk to the rest of the Mac layer through the bus ("open" with {panel: "live"}) and window.CC only.
import { BAR_LABELS, workingModel, opsHeader } from "/mac/data/liveops.js";

const P = {
  ctx: null,
  card: null,          // { el, line, rows: [{bar, fill}], steps }
  screen: null,        // { el, main, line, hint, pause, resume, stop, feedCol, feedBtn, feedBox, title }
  panel: null, panelOrigin: null,
  feed: null, feedOrigin: null,
  timer: null,
  registered: false,
  origGo: null,
  offBus: null,
  onKey: null,
};

// ---- slots (the shell makes these; each part creates a missing one itself) ----
const SLOT_IN = { "mac-flow": "mac-main" };
function ensureSlot(id) {
  const have = document.getElementById(id);
  if (have) return have;
  const parent = id === "mac-root" ? document.body
    : SLOT_IN[id] ? ensureSlot(SLOT_IN[id])
      : ensureSlot("mac-root");
  const el = document.createElement("div");
  el.id = id;
  parent.appendChild(el);
  return el;
}
function slot(id) { return P.ctx?.slot?.(id) || document.getElementById(id) || ensureSlot(id); }

function live() { return P.ctx?.CC?.S?.live || {}; }
function priorityRaw() {
  const S = P.ctx?.CC?.S || {};
  return S.costMode || S.settings?.defaultMode || "balanced";
}
function busEmit(name, data) { try { P.ctx?.bus?.emit(name, data); } catch (e) { console.warn("[mac liveops]", e); } }

// ---- the Simple card: 3 plain bars, one line, one "Show steps" link ----
function buildCard() {
  const el = document.createElement("div");
  el.className = "mac-work";
  el.dataset.macLiveops = "card";
  const line = document.createElement("p");
  line.className = "mac-work-line";
  line.setAttribute("role", "status");
  el.appendChild(line);
  const box = document.createElement("div");
  box.className = "mac-work-bars";
  const rows = BAR_LABELS.map((label) => {
    const row = document.createElement("div");
    row.className = "mac-work-row";
    const name = document.createElement("span");
    name.className = "mac-work-label";
    name.textContent = label;
    const bar = document.createElement("div");
    bar.className = "mac-work-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", label);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", "0");
    const fill = document.createElement("i");
    bar.appendChild(fill);
    row.append(name, bar);
    box.appendChild(row);
    return { bar, fill };
  });
  el.appendChild(box);
  const steps = document.createElement("button");
  steps.type = "button";
  steps.className = "mac-work-steps";
  steps.textContent = "Show steps";
  steps.addEventListener("click", () => busEmit("open", { panel: "live" }));
  el.appendChild(steps);
  return { el, line, rows, steps };
}

function drawCard() {
  const c = P.card;
  if (!c || !c.el.isConnected) return;
  const m = workingModel(live());
  c.line.textContent = m.line;
  m.bars.forEach((b, i) => {
    const r = c.rows[i];
    if (!r) return;
    r.fill.style.width = `${b.pct}%`;
    r.bar.setAttribute("aria-valuenow", String(b.pct));
  });
  c.steps.hidden = !m.showSteps;
}

function mountWorking(container) {
  const host = container || slot("mac-flow");
  if (!host) return null;
  if (!P.card) P.card = buildCard();
  if (P.card.el.parentElement !== host) host.appendChild(P.card.el);
  drawCard();
  ensureTimer();
  return P.card.el;
}

// ---- the Live Ops screen: adopts #ops-panel and #feed, never rebuilds them ----
function wanted(id) {
  const b = document.getElementById(id);
  return !!b && b.style.display !== "none";
}

function buildScreen() {
  const el = document.createElement("section");
  el.id = "mac-lo";
  el.className = "mac-lo";
  el.setAttribute("aria-label", "Live Ops");
  el.hidden = true;

  const head = document.createElement("div");
  head.className = "mac-lo-head";
  const title = document.createElement("h2");
  title.className = "mac-lo-title";
  title.tabIndex = -1;
  title.textContent = "Live Ops";
  const line = document.createElement("p");
  line.className = "mac-lo-line";
  line.setAttribute("role", "status");
  const btns = document.createElement("div");
  btns.className = "mac-lo-btns";
  const mk = (id, text, cls) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.className = cls;
    b.textContent = text;
    btns.appendChild(b);
    return b;
  };
  const pause = mk("mac-lo-pause", "Pause", "mac-lo-btn");
  const resume = mk("mac-lo-resume", "Resume", "mac-lo-btn");
  const stop = mk("mac-lo-stop", "Stop", "mac-lo-btn mac-lo-danger");
  const close = mk("mac-lo-close", "Close", "mac-lo-btn mac-lo-close");
  // The Mac buttons press the app's own buttons, so every rule and call stays the app's.
  pause.addEventListener("click", () => document.getElementById("ops-pause")?.click());
  resume.addEventListener("click", () => document.getElementById("ops-resume")?.click());
  stop.addEventListener("click", () => document.getElementById("abort")?.click());
  close.addEventListener("click", () => closeScreen());
  head.append(title, line, btns);

  const cols = document.createElement("div");
  cols.className = "mac-lo-cols";
  const main = document.createElement("div");
  main.className = "mac-lo-main";
  main.id = "mac-lo-main";
  const hint = document.createElement("p");
  hint.className = "mac-lo-hint dim";
  hint.id = "mac-lo-hint";
  hint.textContent = "Open Expert to see every step.";
  main.appendChild(hint);
  const feed = document.createElement("aside");
  feed.className = "mac-lo-feed";
  feed.id = "mac-lo-feed";
  const feedBtn = document.createElement("button");
  feedBtn.type = "button";
  feedBtn.id = "mac-lo-feedbtn";
  feedBtn.className = "mac-lo-feedbtn";
  feedBtn.textContent = "Live feed";
  feedBtn.setAttribute("aria-expanded", "true");
  feedBtn.setAttribute("aria-controls", "mac-lo-feedbox");
  const feedBox = document.createElement("div");
  feedBox.className = "mac-lo-feedbox";
  feedBox.id = "mac-lo-feedbox";
  feed.append(feedBtn, feedBox);
  feedBtn.addEventListener("click", () => {
    const open = feed.classList.toggle("closed") === false;
    feedBtn.setAttribute("aria-expanded", String(open));
  });
  cols.append(main, feed);
  el.append(head, cols);
  return { el, main, line, hint, pause, resume, stop, title, feedCol: feed, feedBtn, feedBox };
}

function remember(kind, node) {
  const cur = kind === "panel" ? P.panel : P.feed;
  if (cur === node) return;
  const origin = { parent: node.parentElement, next: node.nextSibling };
  if (kind === "panel") { P.panel = node; P.panelOrigin = origin; }
  else { P.feed = node; P.feedOrigin = origin; }
}

// Take the newest copy of the app's node into the screen and drop the stale copy we hold.
function adopt(kind, id) {
  const s = P.screen;
  if (!s) return null;
  const all = [...document.querySelectorAll(`#${id}`)];
  if (!all.length) return null;
  const inside = all.filter((e) => s.el.contains(e));
  const outside = all.filter((e) => !s.el.contains(e));
  const target = outside.length ? outside[outside.length - 1] : inside[0];
  for (const stale of inside) if (stale !== target) stale.remove();
  const slotEl = kind === "panel" ? s.main : s.feedBox;
  if (target.parentElement !== slotEl) {
    remember(kind, target);
    slotEl.appendChild(target);
  }
  return target;
}

// Give a node back on close: the app's fresh copy wins, otherwise go back to where it came from.
function giveBack(kind, id) {
  const s = P.screen;
  if (!s) return;
  const inside = s.el.querySelector(`#${id}`);
  const outside = [...document.querySelectorAll(`#${id}`)].filter((e) => !s.el.contains(e));
  const origin = kind === "panel" ? P.panelOrigin : P.feedOrigin;
  if (outside.length) { if (inside) inside.remove(); }
  else if (inside) {
    const parent = origin?.parent;
    if (parent?.isConnected) {
      const ref = origin.next?.isConnected && origin.next.parentElement === parent ? origin.next : null;
      parent.insertBefore(inside, ref);
    } else inside.remove();
  }
  if (kind === "panel") { P.panel = null; P.panelOrigin = null; }
  else { P.feed = null; P.feedOrigin = null; }
}

function syncScreen() {
  const s = P.screen;
  if (!s || s.el.hidden) return;
  adopt("panel", "ops-panel");
  adopt("feed", "feed");
  const hasPanel = !!s.el.querySelector("#ops-panel");
  s.hint.hidden = hasPanel;
  if (!hasPanel) {
    const expert = P.ctx?.CC?.uiMode?.() === "expert";
    s.hint.textContent = expert ? "The steps show here when a run starts." : "Open Expert to see every step.";
  }
}

function repaintScreen() {
  const s = P.screen;
  if (!s || s.el.hidden) return;
  s.line.textContent = opsHeader(live(), priorityRaw());
  s.pause.hidden = !wanted("ops-pause");
  s.resume.hidden = !wanted("ops-resume");
  s.stop.hidden = !wanted("abort");
}

function openScreen(container) {
  const host = container || slot("mac-main");
  if (!host) return null;
  if (!P.screen) P.screen = buildScreen();
  const s = P.screen;
  if (s.el.parentElement !== host) host.appendChild(s.el);
  s.el.hidden = false;
  syncScreen();
  repaintScreen();
  ensureTimer();
  try { s.title.focus(); } catch { /* focusing is a nicety */ }
  return s.el;
}

function closeScreen() {
  const s = P.screen;
  if (!s || s.el.hidden) return;
  giveBack("panel", "ops-panel");
  giveBack("feed", "feed");
  s.el.hidden = true;
}

function paint() {
  try {
    if (P.card) drawCard();
    if (P.screen && !P.screen.el.hidden) { syncScreen(); repaintScreen(); }
  } catch (e) { console.warn("[mac liveops]", e); }
}
function ensureTimer() {
  if (P.timer) return;
  P.timer = setInterval(paint, 1000);
}
function stopTimer() { if (P.timer) { clearInterval(P.timer); P.timer = null; } }

export default {
  id: "liveops",
  mount(ctx) {
    P.ctx = ctx;
    const CC = ctx.CC;

    // State ticks: the app calls onState after every full state load (web/app.js, web/features/index.js).
    if (!P.registered && typeof CC?.register === "function") {
      CC.register({ id: "mac-liveops", onState() { paint(); } });
      P.registered = true;
    }

    // The screen opens from the bus; opening any page closes it.
    P.offBus = ctx.bus?.on?.("open", (d) => { if (d?.panel === "live") openScreen(); });
    if (typeof CC?.go === "function") {
      P.origGo = CC.go;
      const orig = CC.go.bind(CC);
      CC.go = (view, ...rest) => {
        const r = orig(view, ...rest);
        try {
          // Lead integration fix: Chat (command) stays the chat with the run bar; Live Ops opens only from
          // the bus ({panel:"live"}: sidebar Live Ops, "Show steps"). Going to any page closes the screen.
          if (view) closeScreen();
        } catch (e) { console.warn("[mac liveops go]", e); }
        return r;
      };
    }

    // Escape closes the screen (it is the top layer while open).
    P.onKey = (e) => {
      if (e.key !== "Escape") return;
      if (P.screen && !P.screen.el.hidden) { e.stopPropagation(); closeScreen(); }
    };
    document.addEventListener("keydown", P.onKey);

    CC.mac.liveops = {
      mountWorking(container) { return mountWorking(container); },
      mountOps(container) { return openScreen(container); },
    };
  },
  unmount(ctx) {
    try {
      closeScreen();
      P.screen?.el.remove();
      P.card?.el.remove();
    } catch { /* ignore */ }
    stopTimer();
    try { P.offBus?.(); } catch { /* ignore */ }
    P.offBus = null;
    if (P.onKey) { document.removeEventListener("keydown", P.onKey); P.onKey = null; }
    if (P.origGo && ctx?.CC?.go) { ctx.CC.go = P.origGo; }
    P.origGo = null;
    P.card = null;
    P.screen = null;
    P.panel = null;
    P.panelOrigin = null;
    P.feed = null;
    P.feedOrigin = null;
    P.ctx = null;
    if (ctx?.CC?.mac) delete ctx.CC.mac.liveops;
  },
};
