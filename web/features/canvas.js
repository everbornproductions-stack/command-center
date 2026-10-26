// Canvas (0.4.21, area D): a Framer-style workspace for the thing being made.
// Pages (left, slim) | the canvas (center, live) | Properties (right), a prompt bar docked under the canvas, one Publish
// button at the top right. Simple mode shows canvas + prompt bar + Publish; the two panels slide in on demand.
// Nothing is sent from here by itself: the prompt bar asks the same chat the rest of the app uses, and Publish opens
// the Finish drawer, which shows a preview first. Styles: /canvas.css (theme variables only).
import { projectIntent } from "/project-intent.js";

const CC = window.CC;
const { api, apiBlobUrl, esc, toast, S } = CC;

const STATUSES = ["Draft", "Review", "Approved", "Published"];
const ICON = { video: "▶", audio: "♪", site: "▤", file: "□", text: "¶", image: "▣" };
const SIZES = [["desktop", "Desktop"], ["tablet", "Tablet"], ["phone", "Phone"]];
const HTML_START = /^\s*(?:<!doctype html|<html|<body|<main|<section|<div|<h1|<header|<style)/i;

const cv = { el: null, open: false, items: [], sel: "live", size: "desktop", left: false, right: false, timer: 0, sig: "", busy: false, blob: new Map(), textCache: new Map(), returnFocus: null };

const projId = () => S.project || "";
const projName = () => (S.projects || []).find((p) => p.id === S.project)?.name || "My project";
const simple = () => (CC.uiMode?.() || S.uiMode || "simple") === "simple";
const keyOf = (it) => `${it.projectId}|${it.id}`;
const fileUrl = (it) => `/projectmedia/file?projectId=${encodeURIComponent(it.projectId)}&assetId=${encodeURIComponent(it.id)}`;

function liveText() {
  const l = S.live || {};
  return String(l.deliverable || l.agents?.[l.primary]?.text || "");
}
const liveStatus = () => (S.live?.status === "running" || S.awaitingRun ? "working" : "");

function build() {
  if (cv.el) return cv.el;
  const el = document.createElement("section");
  el.id = "cc-canvas";
  el.hidden = true;
  el.setAttribute("aria-label", "Canvas");
  el.innerHTML = `
    <div class="cv-top">
      <button type="button" class="btn sm" id="cv-pages-toggle" aria-controls="cv-left" aria-expanded="false">Pages</button>
      <span class="cv-title" id="cv-title"></span>
      <span class="cv-chip" id="cv-chip" role="status"></span>
      <span class="cv-gap"></span>
      <div class="cv-sizes" id="cv-sizes" role="group" aria-label="Preview size">${SIZES.map(([id, label]) => `<button type="button" data-size="${id}" aria-pressed="${id === "desktop"}">${label}</button>`).join("")}</div>
      <span class="cv-gap"></span>
      <button type="button" class="btn sm" id="cv-props-toggle" aria-controls="cv-right" aria-expanded="false">Properties</button>
      <button type="button" class="btn sm" id="cv-close">Close canvas</button>
      <button type="button" class="btn primary" id="cv-publish">Publish</button>
    </div>
    <nav class="cv-left" id="cv-left" aria-label="Pages"></nav>
    <div class="cv-stage" id="cv-stage"><div class="cv-frame">
      <div class="cv-bar"><i></i><i></i><i></i><span id="cv-barname"></span></div>
      <div class="cv-view" id="cv-view" aria-live="polite"></div>
      <span class="cv-live" id="cv-live" hidden>Making it now</span>
    </div></div>
    <aside class="cv-right" id="cv-right" aria-label="Properties"></aside>
    <form class="cv-prompt" id="cv-prompt">
      <label class="mm-sr" for="cv-input">Tell Meldmind what to make or change</label>
      <textarea id="cv-input" rows="1" placeholder="Tell Meldmind what to make or change. It appears above as it is made."></textarea>
      <button type="submit" class="btn primary" id="cv-send">Send</button>
    </form>`;
  document.body.appendChild(el);
  cv.el = el;
  const $ = (s) => el.querySelector(s);
  $("#cv-close").addEventListener("click", closeCanvas);
  $("#cv-pages-toggle").addEventListener("click", () => setPanel("left", !cv.left));
  $("#cv-props-toggle").addEventListener("click", () => setPanel("right", !cv.right));
  $("#cv-sizes").addEventListener("click", (e) => { const b = e.target.closest("[data-size]"); if (b) setSize(b.dataset.size); });
  $("#cv-publish").addEventListener("click", publish);
  $("#cv-left").addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (b) { cv.sel = b.dataset.page; paint(true); if (window.innerWidth <= 900) setPanel("left", false); }
    if (e.target.closest("[data-new]")) { $("#cv-input").focus(); if (window.innerWidth <= 900) setPanel("left", false); }
  });
  $("#cv-prompt").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  $("#cv-input").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send(); } });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector(".fd-back")) closeCanvas(); });
  return el;
}

function setPanel(which, on) {
  cv[which] = !!on;
  cv.el.dataset[which] = on ? "1" : "0";
  cv.el.querySelector(which === "left" ? "#cv-pages-toggle" : "#cv-props-toggle").setAttribute("aria-expanded", on ? "true" : "false");
  if (which === "right" && on) paintProps();
  try { localStorage.setItem("cc.canvas.panels", JSON.stringify({ left: cv.left, right: cv.right, mode: simple() ? "simple" : "expert" })); } catch {}
}
function setSize(size) {
  cv.size = SIZES.some(([id]) => id === size) ? size : "desktop";
  cv.el.dataset.size = cv.size;
  cv.el.querySelectorAll("[data-size]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.size === cv.size)));
  paintProps();
}

async function loadItems() {
  try {
    const q = new URLSearchParams({ project: projId() || "all", sort: "date-desc" });
    const d = await api(`/mindmedia?${q}`);
    cv.items = (d.items || []).slice(0, 60);
  } catch { cv.items = []; }
}

const current = () => (cv.sel === "live" ? null : cv.items.find((i) => keyOf(i) === cv.sel) || null);

function paintPages() {
  const left = cv.el.querySelector("#cv-left");
  const lt = liveText();
  const rows = [];
  rows.push(`<div class="cv-h">Pages</div>`);
  rows.push(`<button type="button" class="cv-page" data-page="live" aria-current="${cv.sel === "live"}"><i>●</i><span>${lt || liveStatus() ? "Newest answer" : "New page"}</span></button>`);
  rows.push(`<div class="cv-h">Saved in this project</div>`);
  if (!cv.items.length) rows.push(`<p class="cv-empty">Nothing saved yet. Finish a result and it shows up here.</p>`);
  for (const it of cv.items) rows.push(`<button type="button" class="cv-page" data-page="${esc(keyOf(it))}" aria-current="${cv.sel === keyOf(it)}" title="${esc(it.name)}"><i>${ICON[it.kind] || "□"}</i><span>${esc(it.name)}</span></button>`);
  rows.push(`<div class="cv-h">Add</div><button type="button" class="cv-page" data-new="1"><i>+</i><span>Ask for something new</span></button>`);
  left.innerHTML = rows.join("");
}

async function textOf(it) {
  const k = keyOf(it);
  if (cv.textCache.has(k)) return cv.textCache.get(k);
  let t = String(it.textPreview || "");
  try {
    const u = await apiBlobUrl(fileUrl(it));
    t = await (await fetch(u)).text();
  } catch { /* the preview text is enough */ }
  cv.textCache.set(k, t);
  return t;
}

function setView(cls, node) {
  const v = cv.el.querySelector("#cv-view");
  v.className = `cv-view ${cls}`;
  v.replaceChildren(node);
}
function htmlNode(html) {
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", ""); // a page being made can look like itself but cannot run scripts or reach the app
  f.title = "Preview";
  f.srcdoc = html;
  return f;
}
function textNode(text) {
  const d = document.createElement("div");
  d.className = "md";
  if (CC.md) d.innerHTML = CC.md(text); else { const p = document.createElement("pre"); p.textContent = text; d.appendChild(p); }
  return d;
}
function blank(title, body) {
  const d = document.createElement("div");
  d.className = "cv-blank";
  d.innerHTML = `<h2>${esc(title)}</h2><p>${esc(body)}</p>`;
  return d;
}

async function paintStage(force) {
  const it = current();
  const lt = liveText();
  const status = liveStatus();
  const sig = it ? `item|${keyOf(it)}|${it.name}` : `live|${lt.length}|${lt.slice(-40)}|${status}`;
  cv.el.querySelector("#cv-live").hidden = !status;
  if (!force && sig === cv.sig) return;
  cv.sig = sig;
  cv.el.querySelector("#cv-barname").textContent = it ? it.name : (lt ? "Newest answer" : "New page");
  if (!it) {
    if (!lt) { setView("text", blank(status ? "Working on it" : "Start with a few words", status ? "Your answer shows up here as it is written." : "Type what you want in the bar below. What gets made appears here, big, while it is made.")); return; }
    setView(HTML_START.test(lt) ? "" : "text", HTML_START.test(lt) ? htmlNode(lt) : textNode(lt));
    return;
  }
  if (it.kind === "image") { const u = await apiBlobUrl(fileUrl(it)).catch(() => ""); const img = document.createElement("img"); img.alt = it.name; img.src = u; setView("media", img); return; }
  if (it.kind === "video" || it.kind === "audio") { const u = await apiBlobUrl(fileUrl(it)).catch(() => ""); const m = document.createElement(it.kind === "video" ? "video" : "audio"); m.controls = true; m.src = u; setView("media", m); return; }
  const t = await textOf(it);
  if (cv.sig !== sig) return; // the choice changed while the file loaded
  setView(HTML_START.test(t) ? "" : "text", HTML_START.test(t) ? htmlNode(t) : textNode(t || "This page has no preview."));
}

function paintTop() {
  const it = current();
  cv.el.querySelector("#cv-title").textContent = it ? `${projName()} / ${it.name}` : projName();
  const chip = cv.el.querySelector("#cv-chip");
  const w = liveStatus();
  const status = w ? "working" : it ? String(it.status || "Draft").toLowerCase() : (liveText() ? "draft" : "");
  chip.dataset.state = w ? "working" : (status === "approved" || status === "published") ? "ready" : "";
  chip.textContent = w ? "Making it now" : it ? it.status || "Draft" : liveText() ? "Draft" : "Empty";
}

function paintProps() {
  const box = cv.el.querySelector("#cv-right");
  if (!cv.right) return;
  const it = current();
  const dark = (document.documentElement.dataset.theme || "dark") !== "light";
  box.innerHTML = `<div class="cv-h">Properties</div>
    <label class="cv-field"><b>Name</b><input type="text" id="cv-name" value="${esc(it ? it.name : projName())}" ${it ? "" : "readonly"} aria-describedby="cv-name-help"></label>
    <p class="cv-empty" id="cv-name-help" ${it ? "hidden" : ""}>Pick a saved page on the left to rename it. The project name is changed on the Chat screen.</p>
    <label class="cv-field"><b>Status</b><select id="cv-status" ${it ? "" : "disabled"}>${STATUSES.map((s) => `<option ${it && s === it.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
    <div class="cv-field"><b>Size</b><div class="cv-seg" role="group" aria-label="Preview size">${SIZES.map(([id, label]) => `<button type="button" class="btn sm" data-size="${id}" aria-pressed="${id === cv.size}">${label}</button>`).join("")}</div></div>
    <div class="cv-field"><b>Style of the app</b><div class="cv-seg" role="group" aria-label="App colours"><button type="button" class="btn sm" data-style="dark" aria-pressed="${dark}">Dark</button><button type="button" class="btn sm" data-style="light" aria-pressed="${!dark}">Light</button></div></div>
    <div class="cv-field"><b>Publish</b><button type="button" class="btn primary" id="cv-publish2" style="width:100%">Publish this</button><p class="cv-empty">You see a preview first. Nothing goes out until you say so.</p></div>`;
  box.querySelector("#cv-name")?.addEventListener("change", async (e) => {
    const name = e.target.value.trim();
    if (!it || !name) return;
    try { await api("/mindmedia/meta", { method: "POST", body: { projectId: it.projectId, assetId: it.id, name } }); toast("Renamed."); await loadItems(); paint(true); } catch (er) { toast(er.message, true); }
  });
  box.querySelector("#cv-status")?.addEventListener("change", async (e) => {
    if (!it) return;
    try { await api("/mindmedia/meta", { method: "POST", body: { projectId: it.projectId, assetId: it.id, status: e.target.value } }); toast(`Status: ${e.target.value}.`); await loadItems(); paint(true); } catch (er) { toast(er.message, true); }
  });
  box.querySelectorAll("[data-size]").forEach((b) => b.addEventListener("click", () => setSize(b.dataset.size)));
  box.querySelectorAll("[data-style]").forEach((b) => b.addEventListener("click", async () => { try { await CC.themes?.set?.({ mode: b.dataset.style }); } catch (er) { toast(er.message, true); } paintProps(); }));
  box.querySelector("#cv-publish2")?.addEventListener("click", publish);
}

function paint(force) {
  if (!cv.open) return;
  paintPages(); paintTop(); paintStage(force); paintProps();
}

async function publish() {
  const it = current();
  let text = it ? await textOf(it) : liveText();
  if (!text && !it) { toast("Make something first, then Publish.", true); return; }
  const html = HTML_START.test(text);
  CC.openFinishDrawer?.({ kind: html ? "site" : "text", text, name: it?.name || projName(), projectId: it?.projectId || projId() || undefined, item: it ? { projectId: it.projectId, assetId: it.id, kind: it.kind } : null, source: "Canvas" });
}

async function send() {
  const box = cv.el.querySelector("#cv-input");
  const prompt = box.value.trim();
  if (!prompt) { toast("Type what you want first.", true); return; }
  if (cv.busy) return;
  cv.busy = true;
  try {
    if (CC.confirmRisky && !(await CC.confirmRisky(prompt))) return;
    // A big ask (a website, an app, a plan) goes to the step by step Start screen, exactly like chat does.
    const kind = projectIntent(prompt);
    if (kind && !S.skipProjectStart) {
      await CC.ensureView?.("start");
      if (CC.startProject?.startFromChat) { closeCanvas(); box.value = ""; await CC.startProject.startFromChat(kind, prompt); toast("Started a project for this. Answer a few questions to go on."); return; }
    }
    if (!(S.providers || []).some((p) => p.kind === "text" && p.keyed)) { closeCanvas(); S.view = "settings"; CC.render(); toast("Add an AI key first, then ask again.", true); return; }
    S.lastPrompt = prompt;
    S.awaitingRun = true;
    cv.sel = "live";
    box.value = "";
    const started = await api("/chat", { method: "POST", body: { prompt, projectId: projId() || null, private: !!S.settings?.privateMode } });
    S.stopId = started?.runId || started?.id || "";
    S.live = { id: started?.runId || started?.id || null, kind: "single", status: "running", agents: {}, tasks: {}, mission: null, council: null, deliverable: "", primary: null };
    cv.sig = "";
    paint(true);
  } catch (e) {
    S.awaitingRun = false;
    toast(e.message || "That did not work.", true);
  } finally { cv.busy = false; }
}

async function tick() {
  if (!cv.open) return;
  if (S.awaitingRun && S.live?.status && S.live.status !== "running") S.awaitingRun = false;
  const before = cv.items.length;
  if (!liveStatus() && cv.lastWorking) { await loadItems(); }
  cv.lastWorking = !!liveStatus();
  paintTop(); paintStage(false);
  if (cv.items.length !== before) paintPages();
}

export async function openCanvas(opts = {}) {
  build();
  cv.returnFocus = document.activeElement;
  const saved = (() => { try { return JSON.parse(localStorage.getItem("cc.canvas.panels") || "{}"); } catch { return {}; } })();
  cv.open = true;
  cv.el.hidden = false;
  document.body.classList.add("cc-canvas-on");
  const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom;
  if (top) cv.el.style.setProperty("--cv-top", `${Math.round(top)}px`);
  // Simple: canvas, prompt bar and Publish only. Expert opens both panels (remembered).
  const sm = simple();
  setPanel("left", sm ? false : saved.mode === "expert" ? !!saved.left : true);
  setPanel("right", sm ? false : saved.mode === "expert" ? !!saved.right : true);
  setSize(cv.size);
  cv.sel = opts.select || "live";
  await loadItems();
  if (cv.sel === "live" && !liveText() && !liveStatus() && cv.items[0]) cv.sel = keyOf(cv.items[0]);
  cv.sig = "";
  paint(true);
  clearInterval(cv.timer);
  cv.timer = setInterval(tick, 1000);
  cv.el.querySelector("#cv-input").focus();
}

export function closeCanvas() {
  if (!cv.el || !cv.open) return;
  cv.open = false;
  cv.el.hidden = true;
  clearInterval(cv.timer);
  document.body.classList.remove("cc-canvas-on");
  try { cv.returnFocus?.focus?.(); } catch {}
}

// The entry: an "Open canvas" button on the project bar, kept there after every redraw.
function ensureButton() {
  const bar = document.getElementById("projbar");
  if (!bar || bar.querySelector("#cc-open-canvas")) return;
  const b = document.createElement("button");
  b.type = "button"; b.id = "cc-open-canvas"; b.className = "btn sm"; b.textContent = "Open canvas";
  b.title = "See what you are making, big, while it is made";
  b.addEventListener("click", () => openCanvas());
  (bar.querySelector(".pb-tools") || bar).appendChild(b);
}
let obs = null;
function watch() {
  if (obs || typeof MutationObserver !== "function") return;
  let t = 0;
  obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(ensureButton, 120); });
  obs.observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
  ensureButton();
}

CC.openCanvas = openCanvas;
CC.closeCanvas = closeCanvas;
CC.canvas = { open: openCanvas, close: closeCanvas, state: cv };
CC.register({ id: "canvas", onState() { watch(); } });
watch();
