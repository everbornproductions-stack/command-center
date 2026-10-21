// Short tour: one idea per step, a Try it button, skip any time, replay from Help.
// Steps come from web/features/guide.js and hide when their page is not in this app.
import { liveProbe, rememberWalks, tourSteps } from "./guide.js";

const { S, api, toast, esc, go } = window.CC;

const css = `
#cc-tour { position: fixed; inset: 0; z-index: 70; pointer-events: none; }
#cc-tour .spot { position: fixed; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(3,6,12,.58), 0 0 0 2px var(--accent); transition: all .25s ease; }
#cc-tour .spot.none { box-shadow: 0 0 0 9999px rgba(3,6,12,.58); width: 0; height: 0; left: 50%; top: 50%; }
#cc-tour .card { position: fixed; width: 380px; max-width: calc(100vw - 24px); background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 14px; padding: 16px 18px; box-shadow: 0 24px 60px rgba(0,0,0,.45); pointer-events: auto; font-size: 13.5px; line-height: 1.5; }
#cc-tour .card h4 { margin: 0 0 6px; font-size: 16px; }
#cc-tour .card .step { color: var(--dim); font-family: var(--mono); font-size: 11px; margin-left: auto; }
#cc-tour .plan { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 0; }
#cc-tour .card .note { margin-top: 6px; }
.cc-tour-invite { position: fixed; left: 18px; bottom: calc(var(--strip-h) + 16px); z-index: 45; display: flex; gap: 10px; align-items: center; background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 12px; padding: 10px 14px; box-shadow: 0 12px 30px rgba(0,0,0,.35); font-size: 13px; }
#cc-whats-new { position: fixed; inset: 0; z-index: 80; background: rgba(3,6,12,.62); display: flex; align-items: center; justify-content: center; padding: 16px; }
#cc-whats-new .card { width: 460px; max-width: 100%; max-height: calc(100vh - 32px); overflow: auto; background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 14px; padding: 18px 20px; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
#cc-whats-new h4 { margin: 0 0 6px; font-size: 18px; }
#cc-whats-new ul { margin: 10px 0 0; padding-left: 18px; }
#cc-whats-new li { margin: 6px 0; }
@media (max-width: 760px) { #cc-tour .card { left: 12px !important; right: 12px; bottom: calc(var(--strip-h) + 64px); top: auto !important; width: auto; } .cc-tour-invite { left: 12px; right: 12px; bottom: calc(var(--strip-h) + 66px); } }
`;
const style = document.createElement("style"); style.id = "cc-tour-style"; style.textContent = css; document.head.appendChild(style);

let tour = null;
let synced = false;
let idx = -1;
let el = null;
let timer = null;
let pinned = null;
let newsOpen = false;
let newsDismissed = false;

function steps() {
  return pinned || tourSteps(liveProbe());
}

async function sync() {
  try { tour = await api("/tour"); } catch { /* invite waits until the next state tick */ }
  await rememberWalks(api);
  synced = true;
  maybeInvite();
}

function hideNews() {
  const box = document.getElementById("cc-whats-new");
  if (box?._newsKey) document.removeEventListener("keydown", box._newsKey);
  box?.remove();
  newsOpen = false;
}
function maybeInvite() {
  if (idx >= 0) return;
  if (window.CC.askingMode?.()) { hideNews(); document.querySelector(".cc-tour-invite")?.remove(); return; }
  if (S.view === "setup") { hideNews(); document.querySelector(".cc-tour-invite")?.remove(); return; }
  if (!newsDismissed && tour?.whatsNew) { showNews(); return; }
  if (newsOpen) return;
  const existing = document.querySelector(".cc-tour-invite");
  const show = tour && !tour.completed && !tour.skippedAt && S.view !== "setup";
  if (!show) { existing?.remove(); return; }
  if (existing) return;
  const d = document.createElement("div"); d.className = "cc-tour-invite";
  d.innerHTML = `<span>👋</span><span>New here? <b>Take a short tour</b>. You can skip it any time.</span><button class="btn sm primary" id="cc-tour-go">Start</button><button class="ghost small" id="cc-tour-later">Not now</button>`;
  document.body.appendChild(d);
  d.querySelector("#cc-tour-go").addEventListener("click", () => start());
  d.querySelector("#cc-tour-later").addEventListener("click", async () => { d.remove(); try { tour = await api("/tour/skip", { method: "POST" }); } catch { /* the next visit can offer it again after a reset */ } });
}

function showNews() {
  const n = tour?.whatsNew;
  if (!n || idx >= 0 || S.view === "setup") return;
  document.querySelector(".cc-tour-invite")?.remove();
  let box = document.getElementById("cc-whats-new");
  if (box) return;
  newsOpen = true;
  box = document.createElement("div");
  box.id = "cc-whats-new";
  box.innerHTML = `<div class="card" role="dialog" aria-labelledby="cc-news-title"><h4 id="cc-news-title">${esc(n.title)}</h4><div class="dim small">Version ${esc(n.version)}. This note shows once for this version.</div><ul>${(n.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul><div class="row" style="margin-top:14px"><button class="btn sm" id="cc-news-tour">Take the tour</button><button class="btn sm primary" id="cc-news-ok" style="margin-left:auto">Got it</button></div></div>`;
  document.body.appendChild(box);
  const onKey = (e) => { if (e.key === "Escape") dismissNews(false); };
  document.addEventListener("keydown", onKey);
  box._newsKey = onKey;
  box.querySelector("#cc-news-ok").addEventListener("click", () => dismissNews(false));
  box.querySelector("#cc-news-tour").addEventListener("click", () => dismissNews(true));
}
async function dismissNews(thenTour) {
  newsDismissed = true;
  const box = document.getElementById("cc-whats-new");
  if (box?._newsKey) document.removeEventListener("keydown", box._newsKey);
  box?.remove();
  newsOpen = false;
  try { tour = await api("/tour/whats-new/seen", { method: "POST" }); } catch { /* the note can show again next launch if this save failed */ }
  if (thenTour) start();
  else maybeInvite();
}

new MutationObserver(() => { if (synced) maybeInvite(); }).observe(document.getElementById("view") || document.body, { childList: true });

export async function start(at = 0) {
  document.querySelector(".cc-tour-invite")?.remove();
  await rememberWalks(api);
  pinned = tourSteps(liveProbe());
  if (!pinned.length) {
    pinned = null;
    toast("The tour is empty because those pages are not in this app yet.");
    return;
  }
  if (!el) {
    el = document.createElement("div"); el.id = "cc-tour"; el.innerHTML = `<div class="spot none"></div><div class="card"></div>`; document.body.appendChild(el);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    document.addEventListener("keydown", onKey);
    timer = setInterval(position, 400);
  }
  show(at);
}
function close() {
  pinned = null;
  if (!el) return;
  el.remove(); el = null; idx = -1; clearInterval(timer); timer = null;
  window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); document.removeEventListener("keydown", onKey);
}
function onKey(e) { if (e.key === "Escape") skip(); else if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") back(); }
async function skip() { close(); try { tour = await api("/tour/skip", { method: "POST" }); } catch { /* skip still closes the card */ } toast("Tour skipped. Take the tour again from Help."); }
async function finish() { close(); try { tour = await api("/tour/complete", { method: "POST" }); } catch { /* the card is already closed */ } toast("Tour done. Replay it any time from Help."); }
function next() { const list = steps(); if (idx >= list.length - 1) return finish(); show(idx + 1); }
function back() { if (idx > 0) show(idx - 1); }

function follow(open) {
  if (!open) return;
  if (open.article) {
    window.CC.openHelp?.(open.article);
    return;
  }
  if (open.view && S.view !== open.view) go(open.view);
  if (open.focus) setTimeout(() => document.querySelector(open.focus)?.scrollIntoView({ block: "center" }), 60);
}

function show(i) {
  const list = steps();
  if (!list.length) return close();
  if (i >= list.length) i = list.length - 1;
  idx = i; const st = list[i];
  if (st.view && S.view !== st.view) go(st.view);
  const last = i === list.length - 1;
  const price = st.tier === "free" ? "Free" : `${esc(st.tierLabel)}, ${esc(st.price)}`;
  const card = el.querySelector(".card");
  card.innerHTML = `<div class="row" style="gap:8px"><h4>${esc(st.title)}</h4><span class="step">${i + 1} / ${list.length}</span></div>
    <div class="plan"><span class="chip">${price}</span></div>
    <div class="muted">${esc(st.body)}</div>
    ${st.priceNote ? `<div class="note dim small">${esc(st.priceNote)}</div>` : ""}
    <div class="row" style="margin-top:10px"><button class="btn sm primary" id="cc-tour-try" type="button">Try it</button></div>
    <div class="row" style="margin-top:12px"><button class="ghost small" id="cc-tour-skip">Skip tour</button><span style="margin-left:auto"></span>${i > 0 ? `<button class="btn sm" id="cc-tour-back">Back</button>` : ""}<button class="btn sm primary" id="cc-tour-next">${last ? "Finish" : "Next"}</button></div>`;
  card.querySelector("#cc-tour-skip").addEventListener("click", skip);
  card.querySelector("#cc-tour-back")?.addEventListener("click", back);
  card.querySelector("#cc-tour-next").addEventListener("click", next);
  card.querySelector("#cc-tour-try").addEventListener("click", () => { follow(st.open); requestAnimationFrame(position); });
  requestAnimationFrame(position);
}

function position() {
  if (!el) return;
  const st = steps()[idx]; const spot = el.querySelector(".spot"), card = el.querySelector(".card");
  const t = st?.target ? document.querySelector(st.target) : null;
  const r = t?.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, cw = card.offsetWidth || 380, ch = card.offsetHeight || 220, pad = 14;
  if (r && r.width && r.height) {
    spot.className = "spot"; spot.style.left = `${r.left - 6}px`; spot.style.top = `${r.top - 6}px`; spot.style.width = `${r.width + 12}px`; spot.style.height = `${r.height + 12}px`;
    if (vw <= 760) return;
    let top = r.bottom + pad, left = r.left;
    if (top + ch > vh - 10) top = r.top - ch - pad;
    if (top < 10) { top = Math.max(10, Math.min(vh - ch - 10, r.top)); left = r.right + pad; }
    if (left + cw > vw - 10) left = Math.max(10, vw - cw - 10);
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  } else {
    spot.className = "spot none";
    if (vw <= 760) return;
    card.style.left = `${Math.max(10, (vw - cw) / 2)}px`; card.style.top = `${Math.max(10, (vh - ch) / 2 - 40)}px`;
  }
}

function renderPanel(el2) {
  const t = tour || {};
  const n = steps().length;
  el2.innerHTML = `<div class="panel"><h3>Onboarding tour <span class="right">${t.completed ? `finished ${t.completedAt ? new Date(t.completedAt).toLocaleDateString() : ""}` : t.skippedAt ? "skipped" : "not taken yet"}</span></h3>
    <div class="row"><button class="btn sm" id="cc-tour-start">Take the tour again</button><span class="dim small">${n} steps in this app. Each one has a Try it button. Skip any time, and replay from Help.</span>${t.completed || t.skippedAt ? `<button class="ghost small" id="cc-tour-reset" style="margin-left:auto">reset</button>` : ""}</div>
  </div>`;
  el2.querySelector("#cc-tour-start").addEventListener("click", () => { go("command"); setTimeout(() => start(), 120); });
  el2.querySelector("#cc-tour-reset")?.addEventListener("click", async () => { try { tour = await api("/tour/reset", { method: "POST" }); renderPanel(el2); maybeInvite(); } catch (e) { toast(e.message, true); } });
  if (!Array.isArray(window.CC.guideWalks)) rememberWalks(api).then(() => { if (el2.isConnected) renderPanel(el2); });
}

function onMode() { if (idx >= 0) show(0); }
window.CC.tour = { start, open: start, state: () => tour, onMode };

CC.register({
  id: "tour",
  settings: { order: 7, render: renderPanel },
  onState() { if (!synced) sync(); else maybeInvite(); },
});
if (S.providers.length && !synced) sync();
