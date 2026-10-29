// Mac part "flow" (0.4.23): the Simple 3 step flow. Pick a style, tell us about it, AIs working, Done.
// It WRAPS what already exists: the orders box and Send (#orders, #go), CC.makeChat, the live run state (CC.S.live),
// the result hero, the versions buttons, the finish drawer and the photo strip. It builds none of those again.
// Draws only into #mac-flow. Expert never shows it. Logic lives in /mac/data/flow.js (unit tested).
import * as F from "/mac/data/flow.js";

const SLOT = "mac-flow";
const TICK_MS = 350;
const START_GRACE_MS = 20000;
const PATH_ART = { website: "g5", image: "g2", video: "g8", campaign: "g6", mod: "g1" };
const PATH_BLURB = { website: "A page for your business.", image: "A picture from your words.", video: "A short clip.", campaign: "A week of posts.", mod: "A change for your game." };
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let CC = null;
let bus = null;
let offBus = [];
let state = F.initial();
let chatOnly = false;
let slot = null;
let timer = 0;
let cost = "";
let costTimer = 0;
let costFor = "";
let note = "";
let mon = null;          // the watcher of the run that was sent: { t0, baseId, baseMake, started, doneAt, outcome, prev }
let sel = null;          // style picked on the style step (default: the popular one)
let ver = null;          // tile id shown on the done step
let held = [];           // photos on the tell step
let placeholder = null;  // where #simple-answer lived before the done step borrowed it
let lastSig = "";
let cardsList = null;
let homeIdeas = false;
let returnBtn = null;    // "Use the 3 steps": lives in the title bar (0.4.25 item 8), not over the sidebar footer

const simple = () => (CC.uiMode?.() || CC.S?.uiMode || "simple") === "simple";
const S = () => CC.S || {};

// ---------- slots ----------
function ensureSlot() {
  let root = document.getElementById("mac-root");
  if (!root) { root = document.createElement("div"); root.id = "mac-root"; document.body.appendChild(root); }
  let el = document.getElementById(SLOT);
  if (!el) { el = document.createElement("div"); el.id = SLOT; (document.getElementById("mac-main") || root).appendChild(el); }
  return el;
}

// 0.4.25 (item 8): the way back from "Just chat instead" sat fixed in the bottom-left corner, over the
// sidebar's "Settings and more". It now has its own place in the title bar, next to the page name.
function ensureReturn() {
  let b = document.getElementById("mf-return");
  if (!b) {
    b = document.createElement("button");
    b.type = "button"; b.className = "mf-return"; b.id = "mf-return"; b.hidden = true;
    b.textContent = "Use the 3 steps";
    b.setAttribute("aria-label", "Use the 3 steps");
  }
  const bar = document.getElementById("mac-titlebar");
  const after = bar?.querySelector(".mac-title");
  if (after) after.after(b); else if (b.parentElement !== slot) slot.appendChild(b);
  b.addEventListener("click", onClick);
  return b;
}
function paintReturn() {
  if (returnBtn) returnBtn.hidden = !(chatOnly && slot && !slot.hidden);
}

// ---------- state ----------
function emit() { bus?.emit("flow", { path: state.path, step: state.step, from: "flow" }); }
function set(next, opts = {}) {
  const changed = next.step !== state.step || next.path !== state.path;
  state = next;
  if (changed || opts.force) { lastSig = ""; render(); emit(); }
}

function wanted() { return simple() && (S().view || "command") === "command"; }

// ---------- cost line (the existing /route estimate, the same one the Auto team line uses) ----------
function wantCost(text) {
  const key = String(text || "").trim().slice(0, 300) || "Write a short friendly note";
  if (key === costFor) return;
  costFor = key;
  clearTimeout(costTimer);
  costTimer = setTimeout(async () => {
    let line = "";
    try {
      const r = await CC.api(`/route?prompt=${encodeURIComponent(key)}&mode=${encodeURIComponent(S().costMode || S().settings?.defaultMode || "balanced")}`);
      const best = r?.ranked?.[0];
      const usd = Number(best?.estCost);
      if (best && Number.isFinite(usd)) line = F.costLine(usd);
    } catch { /* fall back to the Auto team line */ }
    if (!line) line = F.costLine(CC.layout?.state?.estimate || document.getElementById("sc-team")?.textContent || "");
    if (key !== costFor) return;
    cost = line;
    document.querySelectorAll("#mac-flow .mf-cost").forEach((n) => { n.textContent = cost; n.hidden = !cost; });
  }, 250);
}
const costHtml = () => `<span class="mf-cost" role="status" ${cost ? "" : "hidden"}>${esc(cost)}</span>`;

// ---------- what the person typed on Home -> a path ----------
async function guessPath(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  try {
    const { makeIntent } = await import("/make-intent.js");
    const k = makeIntent(t)?.kind;
    if (k === "image" || k === "video") return k;
  } catch { /* words below */ }
  if (/\b(mod|minecraft|skyrim|game mod)\b/i.test(t)) return "mod";
  if (/\b(campaign|posts?|social|week of)\b/i.test(t)) return "campaign";
  if (/\b(web ?site|web ?page|landing page|site)\b/i.test(t)) return "website";
  return "";
}

// ---------- rendering ----------
function stepsHtml() {
  const n = F.STEP_NUMBER[state.step] || 1;
  return `<ol class="mf-steps" aria-label="Steps">${F.STEP_NAMES.map((name, i) => `<li class="${i + 1 === n ? "on" : ""}" ${i + 1 === n ? 'aria-current="step"' : ""}>${i + 1} ${esc(name)}</li>`).join("")}</ol>`;
}

function shell() {
  slot.innerHTML = `<div class="mf" role="region" aria-label="Make something" data-step="${state.step}" data-path="${esc(state.path)}">
    <div class="mf-head">
      <button type="button" class="mf-back" id="mf-back" aria-label="Back" ${state.step === "home" ? "hidden" : ""}>&larr; Back</button>
      <span class="mf-crumb" id="mf-crumb">${esc(F.crumb(state))}</span>
      <span class="mf-sp"></span>
      <button type="button" class="mf-link" id="mf-chat">Just chat instead</button>
    </div>
    <h1 class="mf-title" id="mf-title" tabindex="-1" aria-live="polite">${esc(F.stepTitle(state))}</h1>
    <div class="mf-body" id="mf-body"></div>
  </div>`;
  return $("#mf-body", slot);
}

function render() {
  if (!slot) return;
  releaseAnswer();
  const body = shell();
  slot.classList.toggle("mf-off", chatOnly);
  paintReturn();
  ({ home: renderHome, style: renderStyle, tell: renderTell, working: renderWorking, done: renderResult, incomplete: renderResult }[state.step] || renderHome)(body);
  if (note) { const n = document.createElement("p"); n.className = "mf-note"; n.setAttribute("role", "status"); n.textContent = note; body.prepend(n); note = ""; }
  const focus = $("#mf-text", slot) || $("#mf-ask", slot) || $("#mf-title", slot);
  try { focus?.focus({ preventScroll: true }); } catch { /* fine */ }
}

// ----- home -----
function renderHome(body) {
  const ideas = (CC.layout?.IDEAS || []).filter((i) => F.isPath(i.chip));
  homeIdeas = !!CC.layout?.IDEAS;
  body.innerHTML = `<p class="mf-sub">Pick what to make. Swipe, drag, or use the arrow keys.</p>
    ${stepsHtml()}
    <div class="mf-paths" id="mf-paths" role="list" aria-label="What to make" tabindex="0">${F.PATHS.map((p) => `<button type="button" role="listitem" class="mf-path" data-path="${p}" aria-label="${esc(F.PATH_LABEL[p])}. ${esc(PATH_BLURB[p])}"><span class="mf-art ${PATH_ART[p]}" aria-hidden="true"></span><b>${esc(F.PATH_LABEL[p])}</b><small>${esc(PATH_BLURB[p])}</small></button>`).join("")}</div>
    <div class="mf-box"><input id="mf-ask" type="text" aria-label="What do you want to make?" placeholder="Or just say it: a website for my bakery" autocomplete="off">${costHtml()}<button type="button" class="mf-go" id="mf-next">Next</button></div>
    ${ideas.length ? `<div class="mf-chips" role="group" aria-label="Quick picks"><span class="mf-chips-h">Quick picks</span>${ideas.map((i) => `<button type="button" class="mf-chip" data-idea="${esc(i.chip)}" data-text="${esc(i.text)}">${esc(i.text)}</button>`).join("")}</div>` : ""}`;
  const input = $("#mf-ask", body);
  input.value = state.text || "";
  wantCost(input.value);
  input.addEventListener("input", () => { state = F.setText(state, input.value); wantCost(input.value); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#mf-next", body).click(); } });
  $("#mf-next", body).addEventListener("click", async () => {
    const path = await guessPath(input.value);
    if (!path) { note = "Pick what to make above first, or say it with a word like picture, video, or website."; render(); return; }
    set(F.setText(F.start(state, path), input.value));
  });
  body.addEventListener("click", (e) => {
    const p = e.target.closest(".mf-path");
    if (p) { set(F.start(state, p.dataset.path)); return; }
    const c = e.target.closest("[data-idea]");
    if (c) quickPick(c.dataset.idea, c.dataset.text);
  });
  const row = $("#mf-paths", body);
  row.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { row.scrollBy({ left: (e.key === "ArrowRight" ? 1 : -1) * 270, behavior: "smooth" }); e.preventDefault(); } });
}

async function styleList(path) {
  if (cardsList?.[path]) return cardsList[path];
  let list = null;
  try {
    const m = await import("/mac/data/cards.js");
    const f = m.stylesFor || m.cardsFor || m.default?.stylesFor;
    const got = typeof f === "function" ? f(path) : (m.CARDS || m.STYLES || m.default)?.[path];
    if (Array.isArray(got) && got.length) list = got;
  } catch { /* stub or missing: the built-in three are used */ }
  (cardsList ||= {})[path] = F.stylesFor(path, list);
  return cardsList[path];
}

function quickPick(path, text) {
  let s = F.setText(F.start(state, path), text);
  s = F.pickStyle(s, F.popularStyle(path, null));
  sel = s.style;
  set(s);
}

// ----- style (step 1) -----
async function renderStyle(body) {
  const list = await styleList(state.path);
  if (state.step !== "style" || !body.isConnected) return;
  sel = state.style || list.find((s) => s.popular) || list[0];
  body.innerHTML = `<p class="mf-sub">The most popular one is already picked.</p>${stepsHtml()}<div class="mf-cardhost" id="mf-cardhost"></div>
    <div class="mf-actions"><button type="button" class="mf-go" id="mf-next">Next</button></div>`;
  const host = $("#mf-cardhost", body);
  const mark = () => host.querySelectorAll("[data-style-id]").forEach((b) => { const on = b.dataset.styleId === sel.id; b.classList.toggle("sel", on); b.setAttribute("aria-pressed", String(on)); });
  const choose = (s) => { const full = list.find((x) => x.id === (s?.id || s)) || { id: String(s?.id || s?.title || s), title: String(s?.title || s?.id || s), style: String(s?.style || s?.title || s?.id || s) }; sel = full; mark(); };
  const cards = CC.mac?.cards || CC.mac?.parts?.cards;
  let used = false;
  if (typeof cards?.mountCards === "function") {
    try { cards.mountCards(host, { path: state.path, onPick: choose }); used = host.children.length > 0; } catch { used = false; }
  }
  if (!used) {
    host.innerHTML = `<div class="mf-cards" role="list" aria-label="Styles">${list.map((s) => `<button type="button" role="listitem" class="mf-card" data-style-id="${esc(s.id)}" aria-pressed="false"><span class="mf-art ${PATH_ART[state.path]}" aria-hidden="true"></span><b>${esc(s.title)}</b><small>${esc(s.desc)}</small>${s.popular ? '<em class="mf-pop">Most popular</em>' : ""}</button>`).join("")}</div>`;
    host.addEventListener("click", (e) => { const b = e.target.closest("[data-style-id]"); if (b) choose(b.dataset.styleId); });
    host.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { host.querySelector(".mf-cards")?.scrollBy({ left: (e.key === "ArrowRight" ? 1 : -1) * 260, behavior: "smooth" }); } });
  }
  mark();
  $("#mf-next", body).addEventListener("click", () => set(F.pickStyle(state, sel)));
  $("#mf-next", body).focus();
}

// ----- tell us (step 2) -----
function renderTell(body) {
  body.innerHTML = `<p class="mf-sub">${esc(F.TELL_HINT[state.path] || "Tell us about it.")}</p>${stepsHtml()}
    <div class="mf-box"><input id="mf-text" type="text" aria-label="Tell us about it" placeholder="${esc(F.TELL_HINT[state.path] || "")}" autocomplete="off">${costHtml()}<button type="button" class="mf-go" id="mf-make" disabled>Make it</button></div>
    <div class="mf-photos"><span class="mf-photos-h">Your photos (swipe, tap one for full screen)</span><button type="button" class="mf-link" id="mf-addphoto">Add photos</button><input type="file" id="mf-file" hidden multiple accept="image/*" aria-label="Add photos"><div class="mf-strip" id="mf-strip"></div></div>
    ${runBusy() ? '<p class="mf-note">Your last job is still running. You can make this one when it is done.</p>' : ""}`;
  const input = $("#mf-text", body), make = $("#mf-make", body);
  input.value = state.text || "";
  const sync = () => { state = F.setText(state, input.value); make.disabled = !F.canGo(state); wantCost(F.buildPrompt(state.path, state.style, state.text)); };
  sync();
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !make.disabled) { e.preventDefault(); make.click(); } });
  make.addEventListener("click", makeIt);
  paintStrip();
  wirePhotos(body);
}

const runBusy = () => !!(S().awaitingRun || (S().live?.id && ["running", "planning", "assembling"].includes(S().live.status)));

async function paintStrip() {
  const host = $("#mf-strip", slot);
  if (!host) return;
  try {
    const { mountStrip } = await import("/features/upload-strip.js");
    mountStrip(host, held.map((p) => ({ ...p })), { srcFor: (f) => (f?.id ? CC.apiBlobUrl(`/orders-box/files/${encodeURIComponent(f.id)}`) : "") });
  } catch { host.textContent = held.map((p) => p.name).join(", "); }
}

async function wirePhotos(body) {
  try {
    const { wireUpload } = await import("/features/capture-input.js");
    wireUpload($("#mf-addphoto", body), $("#mf-file", body), {
      url: "/orders-box/files", before: held,
      onSaved(saved) { held.push(saved); state = F.addPhoto(state, saved); paintStrip(); },
    });
  } catch { $("#mf-addphoto", body)?.remove(); }
}

// ---------- sending: the same path as typing in the box and pressing Send ----------
async function chatPageReady() {
  if ((S().view || "command") !== "command") CC.go("command");
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    if (document.getElementById("orders") && document.getElementById("go")) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function sendPrompt(prompt, path) {
  if (!(await chatPageReady())) return false;
  const go = document.getElementById("go");
  if (go.disabled) return false;
  const box = document.getElementById("orders");
  box.value = prompt;
  S().lastOrders = prompt;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  S().skipProjectStart = F.skipsProjectStart(path);
  go.click();
  return true;
}

function snapshot(prev) {
  return { t0: Date.now(), baseId: S().live?.id || null, baseStatus: S().live?.status || null, baseMake: (S().make?.tiles || []).length, started: false, doneAt: 0, outcome: "", prev: prev || "", progress: 0 };
}

async function makeIt() {
  if (!F.canGo(state)) return;
  const prompt = withPhotoNotes(F.buildPrompt(state.path, state.style, state.text), state.path);
  const m = snapshot("");
  const ok = await sendPrompt(prompt, state.path);
  if (!ok) { note = "Wait for the other job to finish, then press Make it."; render(); return; }
  mon = m;
  set(F.go(state));
}

// A photo's note ("Attached: ...") only goes in with the text paths. A picture or video prompt stays clean.
function withPhotoNotes(prompt, path) {
  if (path === "image" || path === "video") return prompt;
  const notes = held.map((p) => p.note).filter(Boolean).join(" ");
  return notes ? `${prompt}\n${notes}` : prompt;
}

// ----- working -----
function renderWorking(body) {
  body.innerHTML = `<p class="mf-sub" id="mf-line" role="status" aria-live="polite">${esc([cost, S().autoLine].filter(Boolean).join(". "))}</p>
    <div class="mf-live" id="mf-live"><div class="mf-bars" id="mf-bars">${F.bars(0).map((b, i) => `<div class="mf-bar-row"><span>${esc(b.label)}</span><div class="mf-bar" role="progressbar" aria-label="${esc(b.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-bar="${i}" style="width:0"></i></div></div>`).join("")}</div></div>
    <div class="mf-ask" id="mf-askbox" hidden></div>
    <div class="mf-actions"><button type="button" class="mf-soft" id="mf-steps">Show steps</button><button type="button" class="mf-soft" id="mf-stop">Stop</button></div>`;
  const lo = CC.mac?.liveops || CC.mac?.parts?.liveops;
  if (typeof lo?.mountWorking === "function") { try { const h = $("#mf-live", body); const keep = h.innerHTML; lo.mountWorking(h); if (!h.children.length) h.innerHTML = keep; } catch { /* own bars stay */ } }
  $("#mf-steps", body).addEventListener("click", () => { bus.emit("open", { panel: "live" }); CC.layout?.seeLive?.(); });
  $("#mf-stop", body).addEventListener("click", () => {
    (document.querySelector(".mk-tile[data-state=working] .mk-stop, .mk-tile[data-state=ask] .mk-ask-no") || document.getElementById("stop-chat"))?.click();
    const t = lastTile();
    if (t && ["planning", "working", "ask"].includes(t.state)) { mon = null; set(F.back(state)); }
  });
  $("#mf-askbox", body).addEventListener("click", (e) => {
    const yes = e.target.closest("[data-ask=yes]"), no = e.target.closest("[data-ask=no]");
    if (yes) document.querySelector(".mk-tile[data-state=ask] .mk-ask-yes")?.click();
    if (no) { document.querySelector(".mk-tile[data-state=ask] .mk-ask-no")?.click(); mon = null; set(F.back(state)); }
  });
}

const tilesNow = () => S().make?.tiles || [];
const lastTile = () => { const t = tilesNow(); return t.length ? t[t.length - 1] : null; };

// What happened to the run that was sent: busy, ask, done, incomplete, or nothing yet.
function runOutcome() {
  if (!mon) return "idle";
  const tiles = tilesNow();
  if (tiles.length > mon.baseMake) {
    mon.started = true;
    const t = tiles[tiles.length - 1];
    if (t.state === "done") return "done";
    if (t.state === "error" || t.state === "stopped") return "incomplete";
    if (t.state === "ask") return "ask";
    return "busy";
  }
  const live = S().live;
  if (S().awaitingRun) { mon.started = true; return "busy"; }
  const rs = F.runState(live);
  if (rs === "busy") { mon.started = true; return "busy"; }
  if (mon.started && (rs === "done" || rs === "incomplete")) return rs;
  // A short run can finish between two ticks: a finished run with a new id counts too (not for a retry, which reuses the id).
  if (!mon.started && !mon.prev && live?.id && live.id !== mon.baseId && (rs === "done" || rs === "incomplete")) { mon.started = true; return rs; }
  return "waiting";
}

function progressNow() {
  const age = (Date.now() - mon.t0) / 1000;
  let p = 0.92 * (1 - Math.exp(-age / 10));
  const m = S().live?.mission;
  const tasks = m?.tasks || Object.values(S().live?.tasks || {});
  if (!lastTileSince() && tasks.length) { const d = tasks.filter((t) => t.status === "done").length; p = Math.max(p * 0.6, Math.min(0.95, d / tasks.length)); }
  return Math.max(mon.progress, p);
}
const lastTileSince = () => tilesNow().length > (mon?.baseMake || 0);

function tickWorking() {
  if (!mon) return;
  const out = runOutcome();
  const askBox = $("#mf-askbox", slot);
  if (askBox) {
    const t = lastTile();
    askBox.hidden = out !== "ask";
    if (out === "ask" && !askBox.firstChild) askBox.innerHTML = `<p>This one costs about $${Number(t?.usd || 0).toFixed(2)}. Make it?</p><button type="button" class="mf-go" data-ask="yes">Yes, make it</button> <button type="button" class="mf-soft" data-ask="no">No thanks</button>`;
    if (out !== "ask") askBox.innerHTML = "";
  }
  if (out === "waiting" && !mon.started && Date.now() - mon.t0 > START_GRACE_MS) {
    const back = mon.prev || "";
    mon = null;
    note = "That did not start. Check that an AI is connected, then try again.";
    set(back ? { ...state, step: back } : F.back(state), { force: true });
    return;
  }
  if (!mon.started && (S().view || "command") !== "command") { mon = null; set(F.back(state)); return; }
  if (out === "busy" || out === "ask" || out === "waiting") {
    mon.progress = progressNow();
    paintBars(mon.progress);
    return;
  }
  if (out === "done" || out === "incomplete") {
    paintBars(1);
    mon.doneAt ||= Date.now();
    if (Date.now() - mon.doneAt < 450) return;
    mon = null;
    set(F.finish(state, { incomplete: out === "incomplete" }));
  }
}

function paintBars(p) {
  F.bars(p).forEach((b, i) => {
    const bar = slot.querySelector(`[data-bar="${i}"]`);
    if (!bar) return;
    bar.style.width = `${b.pct}%`;
    bar.parentElement.setAttribute("aria-valuenow", String(b.pct));
  });
}

// ----- done / incomplete -----
function renderResult(body) {
  const bad = state.step === "incomplete";
  const tile = lastTile();
  const isTile = (state.path === "image" || state.path === "video") && tile;
  body.innerHTML = `${bad ? "" : stepsHtml()}
    <div class="mf-result-wrap">
      <div class="mf-result" id="mf-result" aria-label="Your result"></div>
      <div class="mf-side">
        ${bad ? `<div class="mf-badge" role="alert"><b>Incomplete.</b> Part of this did not work, so it is not marked Done.</div>` : ""}
        <div class="mf-vers" id="mf-vers" role="group" aria-label="Versions"></div>
        <p class="mf-meta" id="mf-meta"></p>
        ${bad ? `<button type="button" class="mf-finish" id="mf-retry">Retry</button>` : `<button type="button" class="mf-finish" id="mf-finish">${esc(F.finishLabel(state.path))}</button>`}
        ${bad ? "" : `<button type="button" class="mf-soft" id="mf-again">Try again</button>${isTile ? `<button type="button" class="mf-soft" id="mf-change">Change this part</button>` : ""}`}
        <button type="button" class="mf-soft" id="mf-more">More ways (PDF, Word, Copy)</button>
        <button type="button" class="mf-soft" id="mf-new">Make something else</button>
      </div>
    </div>`;
  adoptAnswer();
  $("#mf-finish", body)?.addEventListener("click", clickFinish);
  $("#mf-more", body).addEventListener("click", openMore);
  $("#mf-new", body).addEventListener("click", () => { resetAll(); });
  $("#mf-retry", body)?.addEventListener("click", retryNow);
  $("#mf-again", body)?.addEventListener("click", () => {
    const btn = document.querySelector("#mf-result #cc-v-again, #mf-result .mk-again");
    if (btn) btn.click(); else retryNow();
  });
  $("#mf-change", body)?.addEventListener("click", () => { const i = document.querySelector("#mf-result .mk-tile:not([hidden]) .mk-change-input"); i?.focus(); i?.scrollIntoView({ block: "nearest" }); });
  $("#mf-vers", body).addEventListener("click", (e) => { const b = e.target.closest("[data-tile]"); if (b) { ver = b.dataset.tile; syncResult(true); } });
  syncResult(true);
  $("#mf-finish", body)?.focus() || $("#mf-retry", body)?.focus();
}

// The existing result UI is borrowed, not rebuilt: #simple-answer (the made tiles, the result hero, the result card,
// the versions buttons) moves into the Done screen and goes back when the screen is left.
function adoptAnswer() {
  const host = $("#mf-result", slot);
  const answer = document.getElementById("simple-answer");
  if (!host || !answer) { if (host) host.innerHTML = `<p class="mf-note">Your result is in the chat. Press "Just chat instead" to see it.</p>`; return; }
  if (answer.parentElement === host) return;
  if (!placeholder) { placeholder = document.createComment("mac-flow-answer"); answer.parentNode?.insertBefore(placeholder, answer); }
  host.appendChild(answer);
}
function releaseAnswer() {
  const answer = document.getElementById("simple-answer");
  if (answer && placeholder?.parentNode && answer.closest("#mf-result")) placeholder.parentNode.insertBefore(answer, placeholder);
  placeholder?.remove();
  placeholder = null;
}

// Keeps the borrowed result right: one answer only (the page may draw a fresh one), only the chosen version, side text.
function syncResult(force) {
  const host = $("#mf-result", slot);
  if (!host) return;
  const all = [...document.querySelectorAll("#simple-answer")];
  if (all.length > 1 || (all[0] && !host.contains(all[0]))) {
    const fresh = all.find((a) => !host.contains(a)) || all[0];
    host.querySelectorAll("#simple-answer").forEach((a) => a !== fresh && a.remove());
    placeholder?.remove(); placeholder = null;
    if (fresh) { placeholder = document.createComment("mac-flow-answer"); fresh.parentNode?.insertBefore(placeholder, fresh); host.appendChild(fresh); }
  }
  const tiles = tilesNow();
  const root = tiles.length ? tiles[tiles.length - 1].root : "";
  const family = tiles.filter((t) => t.root === root && t.state === "done");
  const vers = $("#mf-vers", slot);
  if (vers && (state.path === "image" || state.path === "video") && family.length) {
    if (!ver || !family.some((t) => t.id === ver)) ver = family[family.length - 1].id;
    const sig = family.map((t) => t.id).join() + ver;
    if (vers.dataset.sig !== sig) { vers.dataset.sig = sig; vers.innerHTML = family.length > 1 ? family.map((t, i) => `<button type="button" class="mf-ver ${t.id === ver ? "on" : ""}" data-tile="${esc(t.id)}" aria-pressed="${t.id === ver}">Version ${i + 1}</button>`).join("") : ""; }
    host.querySelectorAll(".mk-tile").forEach((n) => { n.hidden = n.dataset.id !== ver; });
  }
  const meta = $("#mf-meta", slot);
  if (meta) {
    const t = lastTile();
    const bits = [];
    if (t?.state === "done") bits.push(t.practice ? "Practice, nothing spent" : t.usd ? `About $${Number(t.usd).toFixed(2)}` : "Free", "Saved in MindMedia");
    else if (cost) bits.push(cost);
    meta.textContent = bits.join(" · ");
  }
}

function clickFinish() {
  const host = $("#mf-result", slot);
  const btn = host?.querySelector(".mk-tile:not([hidden]) .rh-main, .mk-tile:not([hidden]) .mk-dl") || host?.querySelector(".rh-card .rh-main, .rh-main, .mk-dl");
  if (btn) { btn.click(); return; }
  openMore();
}

function openMore() {
  const t = lastTile();
  const tile = (state.path === "image" || state.path === "video") && t?.state === "done" ? t : null;
  const text = tile ? "" : String(S().live?.deliverable || "");
  const kind = state.path === "website" ? "site" : state.path === "image" ? "image" : state.path === "video" ? "media" : "command";
  CC.openFinishDrawer?.({ kind, text, name: tile?.name || F.PATH_LABEL[state.path], source: "Finish", item: tile?.assetId ? { projectId: tile.projectId, assetId: tile.assetId } : undefined });
}

function retryNow() {
  const prev = state.step;
  const rc = document.querySelector("#mf-result [data-rc-retry]");
  if (rc) {
    mon = snapshot(prev);
    rc.click();
    set(F.retry(state));
    return;
  }
  const prompt = withPhotoNotes(F.buildPrompt(state.path, state.style, state.text), state.path);
  const m = snapshot(prev);
  sendPrompt(prompt, state.path).then((ok) => {
    if (!ok) { note = "Wait for the other job to finish, then press Retry."; render(); return; }
    mon = m;
    set(F.retry(state));
  });
}

// A run began from the Done screen (Try again, a quick change, Change it): go back to the working step.
function tickDone() {
  syncResult();
  if (mon) return;
  const t = lastTile();
  const busyTile = t && ["planning", "working", "ask"].includes(t.state);
  const busyRun = S().awaitingRun || (S().live?.id && ["running", "planning", "assembling"].includes(S().live.status));
  if (busyTile || busyRun) {
    const m = snapshot(state.step);
    m.baseMake = Math.max(0, tilesNow().length - (busyTile ? 1 : 0));
    mon = m;
    set(F.retry(state));
  }
}

// ---------- reset, back ----------
function resetAll() {
  mon = null; held = []; sel = null; ver = null; cost = "";
  set(F.reset(), { force: true });
}
function goBack() {
  if (state.step === "home") return;
  if (state.step === "working") mon = null;
  set(F.back(state), { force: true });
}

// ---------- visibility ----------
function sync() {
  if (!slot) return;
  const show = wanted();
  slot.hidden = !show;
  document.body.dataset.macFlow = show && !chatOnly ? "on" : "off";
  paintReturn();
  if (!show) { releaseAnswer(); return; }
  if (chatOnly) { releaseAnswer(); }
  if (state.step === "home" && !!CC.layout?.IDEAS !== homeIdeas) render();
  if (state.step === "working") tickWorking();
  else if ((state.step === "done" || state.step === "incomplete") && !chatOnly) tickDone();
}

function onKey(e) {
  if (e.key !== "Escape" || !slot || slot.hidden || chatOnly) return;
  if (document.querySelector(".us-viewer, .fd-back, [role=dialog][aria-modal=true]")) return;
  if (state.step === "home") return;
  e.preventDefault();
  goBack();
}

function onClick(e) {
  if (e.target.closest("#mf-back")) goBack();
  else if (e.target.closest("#mf-chat")) { chatOnly = true; releaseAnswer(); render(); sync(); }
  else if (e.target.closest("#mf-return")) { chatOnly = false; render(); sync(); }
}

export default {
  id: "flow",
  mount(ctx) {
    CC = ctx.CC; bus = ctx.bus;
    slot = ensureSlot();
    slot.hidden = !wanted();
    slot.addEventListener("click", onClick);
    returnBtn = ensureReturn();
    document.addEventListener("keydown", onKey);
    offBus = [
      bus.on("flow", (d) => {
        if (!d || d.from === "flow") return;
        chatOnly = false;
        if (d.step === "home" || (!d.path && !d.step)) { resetAll(); return; }
        if (F.isPath(d.path)) { mon = null; held = []; set(F.start(state, d.path), { force: true }); }
        sync();
      }),
      bus.on("mode", () => sync()),
      bus.on("view", () => sync()),
    ];
    CC.mac ||= {};
    CC.mac.flow = { get state() { return state; }, start: (p) => set(F.start(state, p), { force: true }), reset: resetAll, back: goBack };
    render();
    sync();
    timer = setInterval(sync, TICK_MS);
  },
  unmount() {
    clearInterval(timer); clearTimeout(costTimer);
    document.removeEventListener("keydown", onKey);
    offBus.forEach((f) => f?.()); offBus = [];
    releaseAnswer();
    slot?.removeEventListener("click", onClick);
    returnBtn?.removeEventListener("click", onClick);
    returnBtn?.remove(); returnBtn = null;
    slot?.remove(); slot = null;
    delete document.body.dataset.macFlow;
    if (CC?.mac) delete CC.mac.flow;
  },
};
