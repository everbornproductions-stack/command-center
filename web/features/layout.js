// Layout (0.4.21, area H): the Simple window the way the chat apps do it, but using the whole screen.
//   - a slim left sidebar (New, Projects, MindMedia, Recent chats, and the profile menu at the bottom) that is
//     collapsible and shows icons only on narrow windows. It reuses the hidden top menu: every item is a click on
//     the original button, so nothing is removed and nothing is out of date.
//   - the chat column: a greeting and one big box on the empty first screen, the box docked at the bottom once
//     something is running, results inline above it
//   - the Build panel on the right (the canvas, docked): opens by itself on wide windows when there is something
//     to show, and for big builds (a web page, a mission) on any window wide enough
//   - Live Ops as one status line with a "See live" link that opens the full map as an overlay
// Styles: /layout.css. The DOM ids are listed in docs/layout-0421.md.
import { workingLine, finishedLine } from "/dock-context.js";
import { AgentGraph } from "/graph.js";
import { graphNodes } from "/composer-ais.js";

const CC = window.CC;
const { api, apiBlobUrl, esc, toast } = CC;
const S = () => CC.S;
const BUSY = new Set(["running", "planning", "assembling"]);
const SIDE_KEY = "cc.side";
const WIDE = 1500;      // from this width the Build panel opens by itself when there is a result
const DOCK_MIN = 1000;  // under this width the canvas stays a full window overlay
const HTML_START = /^\s*(?:<!doctype html|<html|<body|<main|<section|<div|<h1|<header|<style)/i;

// What the starter chips put in the box. The person finishes the sentence; nothing is sent.
export const CHIPS = {
  image: "Make an image of ",
  video: "Make a 5 second video of ",
  website: "Build a website for my ",
  campaign: "Plan a marketing campaign for my ",
};
export const IDEAS = [
  { chip: "image", text: "A woman on a beach at sunset", label: "A picture" },
  { chip: "website", text: "A website for my bakery", label: "A website" },
  { chip: "video", text: "A 5 second video of waves rolling in", label: "A short video" },
  { chip: "campaign", text: "A week of posts for my flower shop", label: "A week of posts" },
];

const st = { dismissed: "", userOpen: false, chats: [], media: [], recentAt: 0, mediaAt: 0, menuOpen: false, createOpen: false, live: null, estimate: "", estAt: 0 };

const simple = () => (CC.uiMode?.() || S().uiMode || "simple") === "simple";
const wide = () => window.innerWidth >= 761;
const busy = () => { const s = S(); return !!(s.awaitingRun || (s.live?.id && BUSY.has(s.live.status)) || s.make?.tiles?.some((t) => t.state === "working" || t.state === "planning")); };
const workingCount = () => Object.values(S().activeByProvider || {}).filter((n) => n > 0).length;

// ---------- the sidebar ----------
// The first-run welcome screen has its own steps, so the sidebar waits until it is done.
function sideWanted() { return simple() && wide() && !document.querySelector("#gate[style*='block']") && !(S().view === "setup" && S().setup?.phase === "welcome"); }

function buildSide() {
  let side = document.getElementById("cc-side");
  if (side) return side;
  const app = document.getElementById("app");
  const col = document.querySelector(".view-col");
  if (!app || !col) return null;
  side = document.createElement("aside");
  side.id = "cc-side";
  side.setAttribute("aria-label", "Sidebar");
  side.innerHTML = `
    <div class="side-top"><button type="button" id="side-collapse" class="side-collapse" aria-label="Collapse the sidebar" aria-expanded="true" title="Collapse or open the sidebar"><span aria-hidden="true">&laquo;</span></button></div>
    <nav class="side-nav" aria-label="Sidebar">
      <button type="button" class="side-item" id="side-new" data-side="new" title="Start something new"><i aria-hidden="true">+</i><span>New</span></button>
      <button type="button" class="side-item" id="side-projects" data-side="projects" title="Projects"><i aria-hidden="true">&#9638;</i><span>Projects</span></button>
      <button type="button" class="side-item" id="side-mindmedia" data-side="mindmedia" title="MindMedia: everything you made"><i aria-hidden="true">&#9635;</i><span>MindMedia</span></button>
      <div class="side-group">
        <button type="button" class="side-item" id="side-create" data-side="create" aria-expanded="false" aria-controls="side-create-list" title="Create"><i aria-hidden="true">&#10022;</i><span>Create</span></button>
        <div class="side-sub" id="side-create-list" hidden></div>
      </div>
    </nav>
    <div class="side-h" id="side-recent-h">Recent chats</div>
    <div class="side-recent" id="side-recent" role="list" aria-labelledby="side-recent-h"></div>
    <div class="side-foot">
      <button type="button" class="side-item" id="side-profile" aria-haspopup="menu" aria-expanded="false" aria-controls="side-menu" title="Settings, keys, look, Expert mode and help"><i aria-hidden="true">&#9786;</i><span>Settings and more</span></button>
    </div>
    <div class="side-menu" id="side-menu" role="menu" aria-label="Settings and more" hidden></div>`;
  app.insertBefore(side, col);
  side.addEventListener("click", onSideClick);
  document.addEventListener("click", (e) => { if (st.menuOpen && !e.target.closest("#side-menu, #side-profile")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.menuOpen) { closeMenu(); document.getElementById("side-profile")?.focus(); } });
  return side;
}

function sideCollapsed() {
  if (window.innerWidth < 1100) return true;
  try { const v = localStorage.getItem(SIDE_KEY); if (v === "1" || v === "0") return v === "1"; } catch { /* storage can be blocked */ }
  return false;
}
function applySide() {
  const on = sideWanted();
  const side = buildSide();
  document.body.classList.toggle("mm-side-on", on);
  if (!side) return;
  side.hidden = !on;
  const col = sideCollapsed();
  document.body.dataset.side = col ? "c" : "o";
  const b = side.querySelector("#side-collapse");
  b.setAttribute("aria-expanded", String(!col));
  b.setAttribute("aria-label", col ? "Open the sidebar" : "Collapse the sidebar");
  b.firstElementChild.innerHTML = col ? "&raquo;" : "&laquo;";
  const s = S();
  const cur = s.view === "command" && !s.openProject ? "new" : s.view === "projects" ? "projects" : s.view === "mindmedia" ? "mindmedia" : "";
  side.querySelectorAll("[data-side]").forEach((el) => { if (el.dataset.side !== "create") el.classList.toggle("active", el.dataset.side === cur); });
  paintRecent();
}

function onSideClick(e) {
  const b = e.target.closest("button"); if (!b) return;
  if (b.id === "side-collapse") { try { localStorage.setItem(SIDE_KEY, document.body.dataset.side === "c" ? "0" : "1"); } catch { /* fine */ } applySide(); return; }
  if (b.id === "side-profile") { st.menuOpen ? closeMenu() : openMenu(); return; }
  if (b.dataset.chat) { openChat(b.dataset.chat); return; }
  if (b.dataset.sideAct === "orig") { runOriginal(b); return; }
  const places = { "side-new": newChat, "side-projects": () => CC.go("projects"), "side-mindmedia": () => CC.go("mindmedia"), "side-create": () => toggleCreate() };
  places[b.id]?.();
}

// "New": a fresh first screen. A run that is still going keeps going; the box just gets the focus.
export function newChat() {
  const s = S();
  if (s.awaitingRun || (s.live?.id && BUSY.has(s.live.status))) {
    CC.go("command");
    toast("Still working on the last one. It keeps going.");
    setTimeout(() => document.getElementById("orders")?.focus(), 50);
    return;
  }
  CC.makeChat?.reset?.();
  s.live = { id: null, kind: null, status: null, agents: {}, tasks: {}, mission: null, council: null, deliverable: "", primary: null };
  s.lastOrders = "";
  s.openProject = null;
  st.dismissed = ""; st.userOpen = false;
  st.feed = null; st.feedDismissed = "";
  CC.canvas?.feed?.(null);
  CC.canvas?.close?.();
  CC.go("command");
  setTimeout(() => document.getElementById("orders")?.focus(), 50);
}

// ---------- the menu items are the hidden top menu's own buttons ----------
const origs = new Map();
let seq = 0;
function origItems(menu) {
  const panel = document.querySelector(`#tabs .nav-menu[data-menu="${menu}"] .nav-panel`);
  const out = [];
  if (!panel) return out;
  for (const el of panel.children) {
    if (el.classList.contains("nav-section")) { out.push({ section: el.textContent.trim() }); continue; }
    if (el.tagName !== "BUTTON") continue;
    const id = `o${++seq}`;
    origs.set(id, el);
    const label = [...el.childNodes].filter((n) => n.nodeType === 3 || !n.classList?.contains("nav-lock")).map((n) => n.textContent).join("").trim();
    const lock = el.querySelector(".nav-lock")?.textContent.trim() || "";
    out.push({ id, label, lock, view: el.dataset.view || "", title: el.getAttribute("title") || "" });
  }
  return out;
}
function itemsHtml(items) {
  return items.map((i) => i.section
    ? `<div class="side-sec" role="presentation">${esc(i.section)}</div>`
    : `<button type="button" role="menuitem" class="side-sub-item" data-side-act="orig" data-o="${esc(i.id)}" ${i.title ? `title="${esc(i.title)}"` : ""}>${esc(i.label)}${i.lock ? `<span class="side-lock">${esc(i.lock)}</span>` : ""}</button>`).join("");
}
function runOriginal(b) {
  const el = origs.get(b.dataset.o);
  closeMenu();
  if (el && el.isConnected) { el.click(); return; }
  toast("That item is not available right now.", true);
}

function toggleCreate(force) {
  const list = document.getElementById("side-create-list");
  const btn = document.getElementById("side-create");
  if (!list || !btn) return;
  st.createOpen = typeof force === "boolean" ? force : !st.createOpen;
  if (st.createOpen) {
    const items = origItems("create").filter((i) => i.section || !["mindmedia"].includes(i.view));
    list.innerHTML = itemsHtml(items);
  }
  list.hidden = !st.createOpen;
  btn.setAttribute("aria-expanded", String(st.createOpen));
}

// ---------- the profile menu ----------
function menuHtml() {
  const help = origItems("guides");
  const more = origItems("more").filter((i) => i.section || !["settings", "setup", "subscriptions", "credits"].includes(i.view) || i.view === "setup");
  const first = [
    ["settings", "Settings"], ["keys", "Keys and connections"], ["look", "Look and theme"], ["expert", "Expert mode"],
  ].map(([k, l]) => `<button type="button" role="menuitem" class="side-sub-item" data-menu-act="${k}">${esc(l)}</button>`).join("");
  const second = [["community", "Community"], ["news", "AI News"]].map(([k, l]) => `<button type="button" role="menuitem" class="side-sub-item" data-menu-act="${k}">${esc(l)}</button>`).join("");
  return `${first}<div class="side-sec" role="presentation">Community and news</div>${second}
    <details class="side-det"><summary>Help</summary>${itemsHtml(help)}</details>
    <details class="side-det"><summary>More pages</summary>${itemsHtml(more)}</details>`;
}
function openMenu() {
  const menu = document.getElementById("side-menu");
  if (!menu) return;
  menu.innerHTML = menuHtml();
  menu.hidden = false;
  st.menuOpen = true;
  document.getElementById("side-profile")?.setAttribute("aria-expanded", "true");
  menu.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.sideAct === "orig") { runOriginal(b); return; }
    const k = b.dataset.menuAct; if (!k) return;
    closeMenu();
    if (k === "settings") CC.go("settings");
    else if (k === "keys") CC.openSettings?.("#settings-keys");
    else if (k === "look") CC.openSettings?.("[data-feature='look']");
    else if (k === "expert") document.getElementById("mode-expert")?.click();
    else if (k === "community") CC.go("community");
    else if (k === "news") (CC.openCommunity || CC.go)("news");
  };
  menu.querySelector("button")?.focus();
}
function closeMenu() {
  const menu = document.getElementById("side-menu");
  if (menu) menu.hidden = true;
  st.menuOpen = false;
  document.getElementById("side-profile")?.setAttribute("aria-expanded", "false");
}

// ---------- recent chats ----------
async function loadRecent(force) {
  if (!force && Date.now() - st.recentAt < 15000) return;
  st.recentAt = Date.now();
  try {
    const home = await api("/desk/home");
    st.chats = (home.chats || []).slice(0, 12);
    st.projects = (home.projects || []).slice(0, 6);
  } catch { /* the list stays as it was */ }
  paintRecent();
  paintHomeTiles();
}
function paintRecent() {
  const box = document.getElementById("side-recent");
  if (!box) return;
  box.innerHTML = st.chats.length
    ? st.chats.map((c) => `<button type="button" class="side-chat" role="listitem" data-chat="${esc(c.id)}" title="${esc(c.title)}"><i aria-hidden="true">&#9679;</i><span>${esc(c.title)}</span></button>`).join("")
    : `<div class="side-empty">Your chats show up here.</div>`;
}
async function openChat(id) {
  try {
    const m = await api(`/missions/${id}`);
    const s = S();
    CC.makeChat?.reset?.();
    s.live = { id: m.id, kind: m.kind, status: m.status, agents: {}, tasks: {}, mission: null, council: null, deliverable: "", primary: null };
    if (m.kind === "council") { s.live.council = m; s.live.deliverable = m.verdict?.text || ""; }
    else { s.live.mission = m; s.live.deliverable = m.deliverable || ""; if (m.kind !== "mission") s.live.agents = { x: { provider: m.provider, model: m.model, text: m.deliverable, done: true, role: "answer" } }; s.live.primary = "x"; }
    s.view = "command"; s.openProject = null;
    CC.render();
  } catch (e) { toast(e.message, true); }
}

// ---------- the Simple chat page ----------
function chatEl() { return document.querySelector("#view .cmd.simple-chat"); }

function syncChat() {
  const cmd = chatEl();
  if (!cmd) return;
  const s = S();
  const run = !!(s.live?.id || s.make?.active || s.awaitingRun);
  cmd.dataset.state = run ? "run" : "empty";
  document.body.dataset.chat = run ? "run" : "empty";
  const isBusy = busy();
  cmd.dataset.busy = isBusy ? "1" : "0";
  const slim = document.getElementById("sc-live");
  if (slim) {
    slim.hidden = !isBusy;
    if (isBusy) {
      const live = s.live || {};
      const makeTile = (s.make?.tiles || []).find((t) => t.state === "working" || t.state === "planning");
      const line = makeTile && !live.id ? `1 AI working, ${makeTile.kind === "video" ? "making your video" : makeTile.kind === "audio" ? "making your voice" : "making your image"}` : workingLine(live, workingCount());
      const t = document.getElementById("sc-live-text"); if (t && t.textContent !== line) t.textContent = line;
    }
  }
  const go = document.getElementById("go");
  if (go) go.title = "Send (Ctrl+Enter)";
  syncBuilt();
  paintEstimate();
}

// A web page answer is shown in the Build panel, not as code in the chat: the chat gets a short card, and the code is one click away.
function syncBuilt() {
  const ans = document.getElementById("simple-answer");
  if (!ans) return;
  const html = hasHtml() && !ans.hidden;
  if (ans.dataset.html !== (html ? "1" : "0")) ans.dataset.html = html ? "1" : "0";
  let card = document.getElementById("sc-built");
  if (!html) { card?.remove(); if (ans.classList.contains("show-code")) ans.classList.remove("show-code"); return; }
  const open = panelOpen();
  if (!card) {
    card = document.createElement("div");
    card.id = "sc-built"; card.className = "sc-built";
    (document.getElementById("out-md") || ans).before(card);
  }
  const busyNow = busy();
  const want = `<b>${busyNow ? "Building your page..." : "Your page is ready."}</b> <span>${open ? "It is open in the Build panel, where you can look at it, step through versions, download it and publish it." : "Open it to look at it, step through versions, download it and publish it."}</span>
    <span class="sc-built-row">${open ? "" : `<button type="button" class="btn sm primary" id="sc-built-open">Open it</button>`}<button type="button" class="btn sm" id="sc-code" aria-pressed="${ans.classList.contains("show-code")}">${ans.classList.contains("show-code") ? "Hide the code" : "Show the code"}</button></span>`;
  if (card.dataset.sig !== want) { card.dataset.sig = want; card.innerHTML = want; }
}

// "Auto team, about $0.04": the real cost of the best-fit AI for what is typed (or a short default request).
const fmtUsd = (n) => `$${n.toFixed(2)}`;
async function loadEstimate() {
  const box = document.getElementById("orders");
  const prompt = (box?.value || "").trim().slice(0, 300) || "Write a short friendly note";
  if (st.estFor === prompt && Date.now() - st.estAt < 60000) return;
  st.estFor = prompt; st.estAt = Date.now();
  try {
    const r = await api(`/route?prompt=${encodeURIComponent(prompt)}&mode=${encodeURIComponent(S().costMode || S().settings?.defaultMode || "balanced")}`);
    const best = r?.ranked?.[0];
    const usd = Number(best?.estCost);
    st.estimate = best && Number.isFinite(usd) ? (usd >= 0.005 ? `Auto team, about ${fmtUsd(usd)}` : "Auto team, about $0.01 or less") : "Auto team";
  } catch { st.estimate = "Auto team"; }
  paintEstimate();
}
function paintEstimate() {
  const b = document.getElementById("sc-team");
  if (!b) return;
  const open = b.getAttribute("aria-expanded") === "true";
  // 0.4.21: a mode picked under More options replaces "Auto team" on the button
  const picked = window.CC?.S?.simpleRunMode;
  const base = `${st.estimate || "Auto team"}`;
  const text = picked && picked !== "auto" ? base.replace(/^Auto team/, `${picked[0].toUpperCase()}${picked.slice(1)} mode`) : base;
  const label = `${text} ${open ? "▴" : "▾"}`;
  if (b.textContent !== label) b.textContent = label;
}
let estTimer = 0;
function queueEstimate() { clearTimeout(estTimer); estTimer = setTimeout(loadEstimate, 700); }

function setMore(on) {
  const panel = document.querySelector("#view .sc-panel");
  const b = document.getElementById("sc-team");
  if (!panel || !b) return;
  panel.classList.toggle("more-open", on);
  document.body.classList.toggle("mm-more", on);
  b.setAttribute("aria-expanded", String(on));
  paintEstimate();
  if (on) document.getElementById("sc-more")?.scrollIntoView({ block: "nearest" });
}

function fillChip(kind, text) {
  const box = document.getElementById("orders");
  if (!box) return;
  const t = text || CHIPS[kind] || "";
  box.value = t;
  S().lastOrders = t;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  try { box.setSelectionRange(t.length, t.length); } catch { /* fine */ }
  box.classList.remove("sc-pulse"); void box.offsetWidth; box.classList.add("sc-pulse");
}

// The empty screen is not empty: the example ideas, the newest things made, and recent chats and projects.
function paintHomeTiles() {
  const home = document.getElementById("simple-home");
  const cmd = chatEl();
  if (!home || !cmd) return;
  let ideas = document.getElementById("sc-ideas");
  if (!ideas) {
    ideas = document.createElement("div");
    ideas.id = "sc-ideas"; ideas.className = "panel sc-card";
    home.prepend(ideas);
  }
  ideas.innerHTML = `<h3>Try one of these</h3><div class="sc-idea-list">${IDEAS.map((i) => `<button type="button" class="sc-idea" data-sc-idea="${esc(i.chip)}" data-text="${esc(i.text)}"><b>${esc(i.label)}</b><span>${esc(i.text)}</span></button>`).join("")}</div>`;
  let media = document.getElementById("sc-media");
  if (!media) {
    media = document.createElement("div");
    media.id = "sc-media"; media.className = "panel sc-card";
    ideas.after(media);
  }
  const shown = st.media.slice(0, 6);
  media.innerHTML = `<h3>Made recently <button type="button" class="ghost small" id="sc-media-all">Open MindMedia</button></h3>${shown.length
    ? `<div class="sc-thumbs">${shown.map((m) => `<button type="button" class="sc-thumb" data-sc-media="${esc(m.projectId)}|${esc(m.id)}" title="${esc(m.name)}">${m.kind === "image" && m.thumb ? `<img alt="" src="${esc(m.thumb)}">` : `<span class="sc-thumb-kind" aria-hidden="true">${m.kind === "video" ? "&#9654;" : m.kind === "audio" ? "&#9834;" : m.kind === "site" ? "&#9636;" : "&para;"}</span>`}<span class="sc-thumb-name">${esc(m.name)}</span></button>`).join("")}</div>`
    : `<p class="dim small" style="margin:0">Everything you make shows up here, and in MindMedia.</p>`}`;
  const proj = st.projects || [];
  let projs = document.getElementById("sc-projects");
  if (!projs) { projs = document.createElement("div"); projs.id = "sc-projects"; projs.className = "panel sc-card"; media.after(projs); }
  projs.innerHTML = `<h3>Projects</h3>${proj.length ? `<div class="sc-plist">${proj.map((p) => `<button type="button" class="btn sm" data-sc-proj="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</div>` : `<p class="dim small" style="margin:0">Make a project to keep related things together.</p>`}`;
}

async function loadMedia(force) {
  if (!force && Date.now() - st.mediaAt < 20000) return;
  st.mediaAt = Date.now();
  try {
    const d = await api(`/mindmedia?${new URLSearchParams({ project: "all", sort: "date-desc" })}`);
    const items = (d.items || []).slice(0, 6);
    const out = [];
    for (const it of items) {
      const m = { id: it.id, projectId: it.projectId, name: it.name, kind: it.kind, thumb: "" };
      if (it.kind === "image") { try { m.thumb = await apiBlobUrl(`/projectmedia/file?projectId=${encodeURIComponent(it.projectId)}&assetId=${encodeURIComponent(it.id)}`); } catch { /* a name tile is fine */ } }
      out.push(m);
    }
    st.media = out;
  } catch { /* the tile keeps its note */ }
  paintHomeTiles();
}

function onDocClick(e) {
  const t = e.target;
  const chip = t.closest?.("[data-sc-chip]");
  if (chip) { fillChip(chip.dataset.scChip); return; }
  const idea = t.closest?.("[data-sc-idea]");
  if (idea) { fillChip(idea.dataset.scIdea, idea.dataset.text); return; }
  if (t.closest?.("#sc-team")) { setMore(!document.querySelector("#view .sc-panel")?.classList.contains("more-open")); return; }
  if (t.closest?.("#sc-live-open")) { seeLive(); return; }
  if (t.closest?.("#sc-media-all")) { CC.go("mindmedia"); return; }
  if (t.closest?.("#sc-built-open")) { openInPanel(); return; }
  if (t.closest?.("#sc-code")) { document.getElementById("simple-answer")?.classList.toggle("show-code"); syncBuilt(); return; }
  const m = t.closest?.("[data-sc-media]");
  if (m) { openInPanel(m.dataset.scMedia); return; }
  const p = t.closest?.("[data-sc-proj]");
  if (p) { CC.openProjectById?.(p.dataset.scProj); return; }
}

// ---------- the Build panel ----------
function hasHtml() {
  const l = S().live || {};
  const txt = String(l.deliverable || l.agents?.[l.primary]?.text || "");
  return HTML_START.test(txt);
}
function isBigBuild() {
  const s = S(); const l = s.live || {};
  if (hasHtml()) return true;
  if (l.kind === "mission" && Object.keys(l.tasks || {}).length > 1) return true;
  return false;
}
function hasResult() {
  const s = S();
  if ((s.make?.tiles || []).some((t) => t.state === "done")) return true;
  const l = s.live || {};
  return !!(l.id && (l.deliverable || Object.keys(l.tasks || {}).length || l.status === "running"));
}
function resultSig() {
  const s = S(); const l = s.live || {};
  return `${l.id || ""}|${(s.make?.tiles || []).filter((t) => t.state === "done").length}|${hasHtml() ? "h" : ""}`;
}
function canDock() { return simple() && window.innerWidth >= DOCK_MIN && (S().view === "command" || S().view === "start"); }
function panelOpen() { return !!CC.canvas?.state?.open && CC.canvas.state.docked; }

function newestKey() {
  const tiles = (S().make?.tiles || []).filter((t) => t.state === "done" && t.assetId);
  const t = tiles[tiles.length - 1];
  return t ? `${t.projectId || "unfiled"}|${t.assetId}` : "";
}

export async function openInPanel(key) {
  if (!CC.canvas) return;
  if (!(window.innerWidth >= DOCK_MIN)) { CC.canvas.open({ select: key || undefined }); return; }
  st.userOpen = true;
  await CC.canvas.open({ docked: true, select: key || undefined });
  if (key) CC.canvas.show(key);
}
export function closePanel() { st.userOpen = false; st.dismissed = resultSig(); CC.canvas?.close?.(); applyPanelVars(); }

function applyPanelVars() { document.body.classList.toggle("mm-panel-open", panelOpen()); }

let syncing = false;
async function syncPanel() {
  if (syncing || !CC.canvas) return;
  syncing = true;
  try {
    if (!canDock()) {
      if (panelOpen()) CC.canvas.close();
      return;
    }
    const sig = resultSig();
    const want = hasResult() && (isBigBuild() || window.innerWidth >= WIDE) && st.dismissed !== sig;
    if (!panelOpen() && (want || st.userOpen)) {
      const key = newestKey();
      await CC.canvas.open({ docked: true, select: key || undefined });
      if (key) await CC.canvas.show(key);
    } else if (panelOpen()) {
      // a new finished picture shows in the open panel
      const key = newestKey();
      if (key && st.lastKey !== key) { st.lastKey = key; await CC.canvas.show(key); }
    }
    if (!panelOpen() && !want && !st.userOpen) st.lastKey = "";
  } finally { syncing = false; applyPanelVars(); }
}

// A big build that is not in chat (Start a project) hands its newest text here: the Build panel opens by itself and fills
// as the steps finish.
export function buildFeed(src) {
  st.feed = src && (src.text || src.working) ? src : null;
  CC.canvas?.feed?.(st.feed);
  if (!st.feed || !canDock() || panelOpen()) return;
  if (st.feedDismissed === st.feed.name) return;
  CC.canvas.open({ docked: true });
}
window.addEventListener("cc:canvas-closed", (e) => { if (e.detail?.docked) { st.dismissed = resultSig(); st.userOpen = false; if (st.feed) st.feedDismissed = st.feed.name; } document.body.classList.remove("mm-panel-open"); });
window.addEventListener("cc:mindmedia-saved", () => { st.mediaAt = 0; syncChat(); setTimeout(() => { syncChat(); syncPanel(); loadMedia(true); }, 400); });
// The status line and the lit AI icons follow the run, so look again every second while the chat page is open.
setInterval(() => { if (!document.hidden && simple() && S().view === "command" && chatEl()) { syncChat(); queuePanel(); } }, 1000);

// ---------- Live ops: one line, and the full map as an overlay on request ----------
export function seeLive() {
  if (document.getElementById("cc-live-over")) return;
  const over = document.createElement("div");
  over.id = "cc-live-over";
  over.setAttribute("role", "dialog");
  over.setAttribute("aria-modal", "true");
  over.setAttribute("aria-label", "Live view");
  over.innerHTML = `<div class="lo-card"><div class="lo-head"><b>Live view</b><span class="lo-line" id="lo-line" role="status"></span><button type="button" class="btn sm" id="lo-close">Close</button></div>
    <div class="lo-graph" id="lo-graph"></div><div class="lo-steps" id="lo-steps"></div></div>`;
  document.body.appendChild(over);
  const s = S();
  let graph = null;
  try {
    graph = new AgentGraph(over.querySelector("#lo-graph"));
    graph.setProviders(graphNodes(s.providers, s.subscriptions, { demoKeep: !!s.settings?.demoKeep, realAi: !!s.realAi }));
  } catch { /* the text lines below still say what is happening */ }
  const lit = new Set();
  const paint = () => {
    const sx = S();
    over.querySelector("#lo-line").textContent = busy() ? workingLine(sx.live, workingCount()) : finishedLine(sx.live);
    const act = sx.activeByProvider || {};
    for (const [id, n] of Object.entries(act)) { if (n > 0 && !lit.has(id)) { lit.add(id); try { graph?.activate(id, "working"); } catch { /* fine */ } } }
    for (const id of [...lit]) if (!(act[id] > 0)) { lit.delete(id); try { graph?.deactivate(id, ""); } catch { /* fine */ } }
    const tasks = Object.values(sx.live?.tasks || {});
    over.querySelector("#lo-steps").innerHTML = tasks.length ? `<ol>${tasks.map((t) => `<li><span class="chip">${esc(t.status || "")}</span> ${esc(t.title || t.id || "")}</li>`).join("")}</ol>` : "";
  };
  paint();
  const timer = setInterval(paint, 800);
  const close = () => { clearInterval(timer); document.removeEventListener("keydown", onKey, true); over.remove(); document.getElementById("sc-live-open")?.focus(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  over.querySelector("#lo-close").addEventListener("click", close);
  over.addEventListener("click", (e) => { if (e.target === over) close(); });
  over.querySelector("#lo-close").focus();
}

// ---------- wiring ----------
let obs = null;
function watchAnswer() {
  obs?.disconnect();
  const ans = document.getElementById("simple-answer");
  if (!ans || typeof MutationObserver !== "function") return;
  obs = new MutationObserver(() => { syncChat(); queuePanel(); });
  obs.observe(ans, { attributes: true, attributeFilter: ["hidden", "class"] });
}
let panelTimer = 0;
function queuePanel() { clearTimeout(panelTimer); panelTimer = setTimeout(syncPanel, 120); }

function onRender(view) {
  document.body.dataset.view = view || S().view;
  applySide();
  if (simple() && wide()) { loadRecent(); }
  if (view === "command" && simple() && chatEl()) {
    syncChat();
    paintHomeTiles();
    loadMedia();
    watchAnswer();
    const box = document.getElementById("orders");
    if (box && !box.dataset.scEst) { box.dataset.scEst = "1"; box.addEventListener("input", queueEstimate); }
    if (!st.estimate) loadEstimate(); else paintEstimate();
  }
  queuePanel();
}

document.addEventListener("click", onDocClick);
window.addEventListener("resize", () => { clearTimeout(onRender.t); onRender.t = setTimeout(() => { applySide(); queuePanel(); }, 120); });

CC.layout = { onRender, newChat, openInPanel, closePanel, seeLive, buildFeed, syncChat, sync: () => { syncChat(); queuePanel(); }, CHIPS, IDEAS, state: st };
// The first page is drawn before this module loads (and is not drawn again when no AI is connected yet), so catch up now.
setTimeout(() => { try { onRender(S().view); } catch { /* the next render does it */ } }, 0);
CC.register({
  id: "layout",
  onEvent() { if (simple()) { syncChat(); queuePanel(); } },
  onState() { if (simple()) { syncChat(); applySide(); } },
});
