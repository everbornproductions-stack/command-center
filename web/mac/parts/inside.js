// Mac part "inside" (0.4.26): the Chaos-style paper inside the Expert window.
// The look itself is all in /mac/css/inside.css (scoped to body[data-style="mac"][data-ui="expert"] #app).
// This file only adds what CSS cannot do:
//   1. the page header (.cx-head: title, a short line under it, and actions) at the top of #view, put back
//      after every redraw of #view;
//   2. one notice row (.cx-notes) that holds the Finish, Momentum and Project tools bars;
//   3. a letter square on each project card;
//   4. a short fade when the page changes (not on every redraw).
// It never moves focus, does nothing outside Expert, and unmount puts every moved bar and button back.
// The theme needs no code: inside.css reads body[data-theme] (the Mac light / dark button) only.

// Header words per view. Plain and short. "act" are buttons that press the page's own button (by id);
// "move" moves the page's own button into the header (it keeps its id and its click handler).
const HEADS = {
  command: { title: "Command", sub: "Tell your AIs what you want.", act: [["preview", "Preview route", ""], ["go", "Send orders", "primary"]] },
  projects: { title: "Projects", sub: (S) => { const n = (S?.projects || []).length; return `${n} project${n === 1 ? "" : "s"}`; }, move: ["newp"] },
  credits: { title: "Credits", sub: "What your AIs cost this month." },
  subscriptions: { title: "Subscriptions", sub: "Your plans, what they cost, and when they renew." },
  settings: { title: "Settings", sub: "Your AIs, privacy and defaults." },
  liveview: { title: "Live", sub: "Who is working, the step, and what it has cost" },
  history: { title: "History", sub: "Your past runs and chats." },
  agents: { title: "Agents", sub: "Helpers that take on jobs for you." },
};
const BAR_IDS = ["fpbar", "mmbar", "projbar"];

let CLEANUPS = [];
// Where a moved page button came from, so it can go back: element -> { parent, next }.
const HOMES = new Map();

function isExpert() {
  return document.body.dataset.style === "mac" && document.body.dataset.ui === "expert";
}

// Move a node without losing keyboard focus if it (or something in it) has it.
function moveKeepFocus(node, place) {
  const had = document.activeElement && node.contains(document.activeElement) ? document.activeElement : null;
  place(node);
  if (had && document.activeElement !== had) { try { had.focus({ preventScroll: true }); } catch { /* gone */ } }
}

function putHome(el) {
  const home = HOMES.get(el);
  HOMES.delete(el);
  if (el.dataset.cxMoved) { el.classList.remove("primary"); delete el.dataset.cxMoved; }
  if (!home || !home.parent.isConnected) return;
  const next = home.next && home.next.parentElement === home.parent ? home.next : null;
  moveKeepFocus(el, (n) => home.parent.insertBefore(n, next));
}

function dropHead(view) {
  const head = view?.querySelector(":scope > .cx-head");
  if (!head) return;
  for (const el of [...HOMES.keys()]) if (head.contains(el)) putHome(el);
  head.remove();
}

function buildHead(id, spec) {
  const head = document.createElement("header");
  head.className = "cx-head";
  head.dataset.view = id;
  const left = document.createElement("div");
  const h = document.createElement("h1");
  h.className = "cx-title";
  h.textContent = spec.title;
  const p = document.createElement("p");
  p.className = "cx-sub";
  left.append(h, p);
  const act = document.createElement("div");
  act.className = "cx-act";
  for (const [target, label, kind] of spec.act || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn${kind ? " " + kind : ""}`;
    b.dataset.cxFor = target;
    b.textContent = label;
    b.addEventListener("click", () => {
      const t = document.getElementById(target);
      if (t && !t.disabled) t.click();
    });
    act.appendChild(b);
  }
  head.append(left, act);
  return head;
}

// The header buttons follow the page's own button: same words, same disabled state, hidden when it is gone.
function syncProxies(head) {
  for (const b of head.querySelectorAll("[data-cx-for]")) {
    const t = document.getElementById(b.dataset.cxFor);
    const hide = !t || t.closest("[hidden]") !== null || getComputedStyle(t).display === "none";
    if (b.hidden !== hide) b.hidden = hide;
    if (!t) continue;
    const dis = !!t.disabled;
    if (b.disabled !== dis) b.disabled = dis;
    const words = (t.textContent || "").trim();
    if (words && b.textContent !== words) b.textContent = words;
  }
}

function paintHead(CC) {
  const view = document.getElementById("view");
  if (!view) return;
  // A redraw throws away the old header with the old button in it: forget those.
  for (const el of [...HOMES.keys()]) if (!el.isConnected) HOMES.delete(el);
  const id = CC.S?.view || "";
  const spec = HEADS[id];
  const want = isExpert() && !!spec && !(id === "projects" && CC.S?.openProject) && view.children.length > 0 &&
    !(view.children.length === 1 && view.firstElementChild.classList.contains("cx-head"));
  let head = view.querySelector(":scope > .cx-head");
  if (!want) { dropHead(view); return; }
  if (head && head.dataset.view !== id) { dropHead(view); head = null; }
  if (!head) head = buildHead(id, spec);
  if (view.firstElementChild !== head) view.prepend(head);
  const sub = typeof spec.sub === "function" ? spec.sub(CC.S) : spec.sub;
  const subEl = head.querySelector(".cx-sub");
  if (subEl && subEl.textContent !== sub) subEl.textContent = sub;
  const act = head.querySelector(".cx-act");
  for (const mid of spec.move || []) {
    const el = document.getElementById(mid);
    if (!el || head.contains(el) || !view.contains(el)) continue;
    HOMES.set(el, { parent: el.parentElement, next: el.nextSibling });
    el.classList.add("primary");
    el.dataset.cxMoved = "1";
    moveKeepFocus(el, (n) => act.appendChild(n));
  }
  syncProxies(head);
}

// Gather the Finish, Momentum and Project tools bars into one row above the page.
function paintNotes() {
  const view = document.getElementById("view");
  const col = view?.parentElement;
  if (!col) return;
  let box = col.querySelector(":scope > .cx-notes");
  if (!isExpert()) { unwrapNotes(col); return; }
  const loose = BAR_IDS.map((id) => document.getElementById(id)).filter((b) => b && b.parentElement === col);
  if (loose.length) {
    if (!box) {
      box = document.createElement("div");
      box.className = "cx-notes";
      col.insertBefore(box, loose.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? b : a)));
    }
    loose.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const more = box.querySelector(":scope > #cx-notes-more");
    for (const b of loose) moveKeepFocus(b, (n) => box.insertBefore(n, more));
  }
  if (box && !box.querySelector(":scope > :not(#cx-notes-more)")) { box.remove(); return; }
  if (box) paintMore(box);
}

// 0.4.27 (panel item 1): on a short window or a phone the row is one line (inside.css). When some chips do not fit,
// a More button at its right end opens the whole row; Less folds it again. Nothing is removed or hidden for good.
function paintMore(box) {
  let more = box.querySelector(":scope > #cx-notes-more");
  if (!more) {
    more = document.createElement("button");
    more.type = "button";
    more.id = "cx-notes-more";
    more.className = "btn sm";
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", () => {
      const open = !box.classList.contains("cx-open");
      box.classList.toggle("cx-open", open);
      paintMore(box);
      more.focus({ preventScroll: true });
    });
    box.appendChild(more);
    // The bars redraw their own chips; look again right after they do.
    let queued = false;
    box._cxObs = new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; if (box.isConnected && more.isConnected) paintMore(box); }); });
    box._cxObs.observe(box, { childList: true, subtree: true });
  }
  const open = box.classList.contains("cx-open");
  // Folded: does the one-line row run past its edge? (Open, the answer from just before it opened stands.)
  if (!open) box.dataset.cxCut = getComputedStyle(box).flexWrap === "nowrap" && box.scrollWidth > box.clientWidth + 1 ? "1" : "";
  const show = box.dataset.cxCut === "1";
  if (more.hidden === show) more.hidden = !show;
  const words = open ? "Less" : "More";
  if (more.textContent !== words) more.textContent = words;
  more.setAttribute("aria-expanded", String(open));
  more.setAttribute("aria-label", open ? "Show fewer tools" : "Show more tools");
  // Folded, a chip that runs under More (or past the edge) is not shown half cut: it waits behind More.
  const limit = show && !open ? more.getBoundingClientRect().left - 4 : Infinity;
  for (const c of box.querySelectorAll(":scope > :is(.fp-bar, .mm-bar, .projbar) > *, :scope .pb-tools > *")) {
    if (c === more || getComputedStyle(c).display === "contents") continue;
    const over = c.getBoundingClientRect().right > limit;
    if (over !== c.hasAttribute("data-cx-over")) c.toggleAttribute("data-cx-over", over);
  }
}

function unwrapNotes(col) {
  const box = col?.querySelector(":scope > .cx-notes");
  if (!box) return;
  box._cxObs?.disconnect();
  box.querySelector(":scope > #cx-notes-more")?.remove();
  box.querySelectorAll("[data-cx-over]").forEach((c) => c.removeAttribute("data-cx-over"));
  for (const b of [...box.children]) moveKeepFocus(b, (n) => col.insertBefore(n, box));
  box.remove();
}

// A letter square in front of each project card's name.
function paintCards() {
  const view = document.getElementById("view");
  if (!view) return;
  const on = isExpert();
  for (const card of view.querySelectorAll(".pcard")) {
    let av = card.querySelector(":scope > .cx-av");
    if (!on) { av?.remove(); continue; }
    const name = (card.querySelector("h4")?.firstChild?.textContent || card.querySelector("h4")?.textContent || "").trim();
    const letter = (name.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();
    if (!av) { av = document.createElement("span"); av.className = "cx-av"; av.setAttribute("aria-hidden", "true"); card.prepend(av); }
    if (av.textContent !== letter) av.textContent = letter;
  }
}

export default {
  id: "inside",

  mount(ctx) {
    const { CC, bus } = ctx;
    // Second sheet (0.4.26 polish): light-theme colours for the Talk bar, the chat dock and the sidebar search box.
    // It is separate so inside.css itself never names the frame. Colour only; dark, Simple and classic never match.
    if (!document.querySelector('link[data-mac-css="inside-dock"]')) {
      const sheet = document.createElement("link");
      sheet.rel = "stylesheet";
      sheet.href = "/mac/css/inside-dock.css";
      sheet.dataset.macCss = "inside-dock";
      document.head.appendChild(sheet);
    }
    CLEANUPS.push(() => document.querySelector('link[data-mac-css="inside-dock"]')?.remove());
    const view = document.getElementById("view");
    if (!view) return;
    let lastView = "", enterTimer = 0, queued = false;

    const paint = () => {
      queued = false;
      try { paintHead(CC); paintNotes(); paintCards(); } catch (e) { console.warn("[mac] inside:", e); }
    };
    // Mutation callbacks run before the next paint, so the header is back before anyone sees the page without it.
    const soon = () => { if (!queued) { queued = true; queueMicrotask(paint); } };

    // A short fade only when the page really changes, not on every redraw of the same page.
    const enter = () => {
      const id = CC.S?.view || "";
      if (id === lastView) return;
      lastView = id;
      if (!isExpert()) return;
      view.setAttribute("data-cx-enter", "");
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => view.removeAttribute("data-cx-enter"), 450);
    };

    const viewObs = new MutationObserver(() => { enter(); soon(); });
    viewObs.observe(view, { childList: true });
    const col = view.parentElement;
    const colObs = col ? new MutationObserver(soon) : null;
    colObs?.observe(col, { childList: true });
    const bodyObs = new MutationObserver(soon);
    bodyObs.observe(document.body, { attributes: true, attributeFilter: ["data-ui", "data-view"] });
    // The header buttons follow the page's buttons (Send turns into "Still working..." and back).
    // Once a second the More button also follows the chips (bars redraw their own buttons).
    const tick = setInterval(() => {
      const h = view.querySelector(":scope > .cx-head"); if (h) syncProxies(h);
      const notes = isExpert() && col?.querySelector(":scope > .cx-notes"); if (notes) paintMore(notes);
    }, 1000);
    // The More button in the notice row depends on the window size (one line on a short window or a phone).
    const onResize = () => soon();
    window.addEventListener("resize", onResize);

    CLEANUPS.push(
      () => { viewObs.disconnect(); colObs?.disconnect(); bodyObs.disconnect(); clearInterval(tick); clearTimeout(enterTimer); window.removeEventListener("resize", onResize); },
      bus.on("view", soon),
      bus.on("mode", soon),
      () => {
        view.removeAttribute("data-cx-enter");
        dropHead(view);
        unwrapNotes(col);
        for (const el of [...HOMES.keys()]) putHome(el);
        view.querySelectorAll(".pcard > .cx-av").forEach((a) => a.remove());
      },
    );
    paint();
  },

  unmount() {
    for (const fn of CLEANUPS.splice(0)) { try { fn(); } catch { /* already gone */ } }
  },
};
