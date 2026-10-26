// AI News side panel. Docked in its own column on wide windows (open by default), a floating card on mid windows,
// and a small pill on phones that opens the News screen. It only reads the published issue; nothing is posted or sent here.
import { readRail, saveRail, railLinks, railMode, togglePin, RAIL_KEY, appRows, isAppUrl } from "/news-rail.js";

const { api, esc, go } = window.CC;
const mode = () => railMode(window.innerWidth);
let state = readRail(localStorage, window.innerWidth);
let links = [];
let inApp = appRows(null);
let shipped = null;
let unread = false;
let checkedAt = 0;
let refreshing = false;
const WEEKLY_CHECK_MS = 30 * 60 * 1000; // the feed is weekly; checking twice an hour while the window is open is cheap

const css = `
#cc-rail { position: fixed; top: 68px; z-index: 35; width: 280px; max-height: calc(100vh - 190px); display: flex; flex-direction: column; background: var(--panel-solid, #0d1420); color: var(--text, #e6edf7); border: 1px solid var(--line-2, #2a3a52); border-radius: 12px; box-shadow: 0 12px 32px #0008; }
#cc-rail[data-side="right"] { right: 14px; }
#cc-rail[data-side="left"] { left: 14px; }
#cc-rail[data-min="1"] { width: auto; max-height: none; top: auto; bottom: 14px; }
/* Docked: its own full-height column. The page gets a gutter of the same width, so the panel never covers text. */
#cc-rail[data-mode="dock"][data-min="0"] { top: 64px; bottom: calc(var(--strip-h, 40px) + 8px); max-height: none; width: 272px; }
body[data-ui="simple"] #cc-rail[data-mode="dock"][data-min="0"] { bottom: 14px; }
body:not([data-ui="simple"]) #cc-rail[data-side="right"][data-mode="dock"] { right: calc(var(--feed-w, 340px) + 8px); }
body:not([data-ui="simple"]) #cc-rail[data-side="right"][data-min="1"] { right: calc(var(--feed-w, 340px) + 8px); }
body.rail-dock-right .view-col { padding-right: 288px; }
body.rail-dock-left .view-col { padding-left: 288px; }
#cc-rail .rail-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; }
#cc-rail .rail-head .btn { white-space: nowrap; padding: 4px 8px; }
#cc-rail .rail-title { flex: 1 1 100%; white-space: nowrap; font-weight: 650; text-align: left; background: none; border: 0; color: inherit; cursor: pointer; padding: 0; }
#cc-rail .rail-body { overflow: auto; padding: 0 12px 10px; }
#cc-rail .rail-link { display: flex; align-items: flex-start; gap: 6px; border-top: 1px solid var(--line, #1f2b3d); }
#cc-rail .rail-link a { flex: 1; display: block; padding: 6px 0; color: var(--accent, #22d3ee); text-decoration: none; }
#cc-rail .rail-link a:hover { text-decoration: underline; }
#cc-rail .rail-pin { background: none; border: 0; cursor: pointer; color: var(--muted, #8a9bb3); padding: 6px 2px; font-size: .75rem; }
#cc-rail .rail-pin[aria-pressed="true"] { color: var(--accent, #22d3ee); }
#cc-rail .rail-src { color: var(--muted, #8a9bb3); font-size: .75rem; }
#cc-rail .rail-h { margin: 10px 0 2px; font-size: .75rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #8a9bb3); }
#cc-rail .rail-ship { margin: 4px 0; padding-left: 16px; font-size: .8125rem; }
#cc-rail .rail-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #22d3ee); margin-left: 6px; }
/* Phones: a small pill above the bottom menu that opens the News screen. */
#cc-rail[data-mode="phone"] { top: auto; bottom: 74px; left: auto; right: 12px; width: auto; max-height: none; border-radius: 999px; }
#cc-rail[data-mode="phone"] .rail-head { padding: 6px 12px; }
`;

// 0.4.21 (L3, F24): in Expert under 1500 px the rail starts minimized, so the page has room for the
// orders, the answer and Live ops. A choice the person saved (Minimize / open) always wins.
let effMin = false;
let lastExpert = null;
const isExpert = () => window.CC?.S?.uiMode === "expert";
function explicitMin() {
  try { return typeof (JSON.parse(localStorage.getItem(RAIL_KEY) || "{}") || {}).min === "boolean"; } catch { return false; }
}
function autoMin() { return isExpert() && window.innerWidth < 1500 && !explicitMin(); }

function applyDock(el) {
  const docked = !!el && mode() === "dock" && !effMin && !state.hidden;
  document.body.classList.toggle("rail-dock-right", docked && state.side === "right");
  document.body.classList.toggle("rail-dock-left", docked && state.side === "left");
}

function linkRow(l) {
  const pinned = state.pins.some((p) => p.url === l.url);
  if (isAppUrl(l.url)) {
    return `<div class="rail-link"><a href="#" data-app-open="${esc(l.url.slice(4))}">${esc(l.title)}${l.source ? `<div class="rail-src">${esc(l.source)}</div>` : ""}</a>
    <button type="button" class="rail-pin" data-pin="${esc(l.url)}" data-title="${esc(l.title)}" aria-pressed="${pinned ? "true" : "false"}" aria-label="${pinned ? "Unpin" : "Pin"} ${esc(l.title)}">${pinned ? "Pinned" : "Pin"}</button></div>`;
  }
  return `<div class="rail-link"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}${l.source ? `<div class="rail-src">${esc(l.source)}</div>` : ""}</a>
    <button type="button" class="rail-pin" data-pin="${esc(l.url)}" data-title="${esc(l.title)}" aria-pressed="${pinned ? "true" : "false"}" aria-label="${pinned ? "Unpin" : "Pin"} ${esc(l.title)}">${pinned ? "Pinned" : "Pin"}</button></div>`;
}

function bodyHtml() {
  const pins = state.pins.length ? `<div class="rail-h">Pinned</div>${state.pins.map(linkRow).join("")}` : "";
  const list = links.filter((l) => !state.pins.some((p) => p.url === l.url));
  const mine = inApp.filter((l) => !state.pins.some((p) => p.url === l.url));
  const inside = mine.length ? `<div class="rail-h">In Meldmind</div>${mine.map(linkRow).join("")}` : "";
  let main;
  if (links.length) main = `${pins ? `<div class="rail-h">This week</div>` : ""}${list.map(linkRow).join("")}`;
  else {
    main = `<div class="dim small">No issue yet. A new one is published each week.</div>`;
    if (shipped?.bullets?.length) main += `<div class="rail-h">What Meldmind shipped (${esc(shipped.version)})</div><ul class="rail-ship">${shipped.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  }
  return `${pins}${main}${inside}<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap">
      <button type="button" class="btn sm" data-rail="open">Open AI News</button>
      <button type="button" class="btn sm" data-rail="refresh" ${refreshing ? "disabled" : ""}>${refreshing ? "Checking..." : "Refresh"}</button></div>`;
}

// Opens what an in-app row points at: the What's new card, a Help article, a page, or a prompt template.
function openInApp(target) {
  const CC = window.CC;
  if (target === "whatsnew") { if (CC.tour?.openNews) CC.tour.openNews(); else go("help"); return; }
  const [kind, id] = target.split(":");
  if (kind === "help") { CC.S.helpArticle = id; go("help"); return; }
  if (kind === "template") { CC.S.openTemplateId = id; go("prompts"); return; }
  if (kind === "view") go(id);
}

function mount() {
  if (!document.getElementById("cc-rail-style")) {
    const style = document.createElement("style");
    style.id = "cc-rail-style";
    style.textContent = css;
    document.head.appendChild(style);
  }
  let el = document.getElementById("cc-rail");
  if (state.hidden) { el?.remove(); applyDock(null); return; }
  if (!el) {
    el = document.createElement("aside");
    el.id = "cc-rail";
    el.setAttribute("aria-label", "AI News");
    document.body.appendChild(el);
  }
  const m = mode();
  // On a phone the panel is only the pill; a tap opens the News screen.
  const min = m === "phone" ? true : (state.min || autoMin());
  effMin = min;
  el.dataset.side = state.side;
  el.dataset.mode = m;
  el.dataset.min = min ? "1" : "0";
  const dot = unread ? `<span class="rail-dot" aria-label="New issue"></span>` : "";
  el.innerHTML = `<div class="rail-head">
      <button type="button" class="rail-title" data-rail="${m === "phone" ? "open" : "toggle"}" aria-expanded="${min ? "false" : "true"}">AI News${dot}</button>
      ${min ? "" : `<button type="button" class="btn sm" data-rail="side" aria-label="Dock the panel on the ${state.side === "left" ? "right" : "left"}">Move ${state.side === "left" ? "right" : "left"}</button>
      <button type="button" class="btn sm" data-rail="toggle" aria-label="Minimize AI News">Minimize</button>
      <button type="button" class="btn sm" data-rail="hide" aria-label="Hide AI News. Open Community, then AI News, to bring it back.">Hide</button>`}
    </div>
    ${min ? "" : `<div class="rail-body">${bodyHtml()}</div>`}`;
  el.onclick = async (ev) => {
    const app = ev.target.closest("[data-app-open]");
    if (app) { ev.preventDefault(); openInApp(app.dataset.appOpen); return; }
    const pin = ev.target.closest("[data-pin]");
    if (pin) {
      state.pins = togglePin(state.pins, { url: pin.dataset.pin, title: pin.dataset.title });
      saveRail(localStorage, state);
      mount();
      return;
    }
    const act = ev.target.closest("[data-rail]")?.dataset.rail;
    if (!act) return;
    if (act === "toggle") state.min = !effMin;
    else if (act === "side") state.side = state.side === "left" ? "right" : "left";
    else if (act === "hide") state.hidden = true;
    else if (act === "open") { (window.CC.openCommunity || go)("news"); return; }
    else if (act === "refresh") { await load(true); return; }
    saveRail(localStorage, state);
    mount();
  };
  applyDock(el);
}

async function load(fresh = false) {
  if (refreshing) return;
  refreshing = true;
  if (fresh) mount();
  try {
    const news = await api(`/community/news${fresh ? "?fresh=1" : ""}`);
    links = railLinks(news);
    inApp = appRows(news);
    shipped = news?.shipped || null;
    unread = !!news?.unread;
    checkedAt = Date.now();
  } catch { links = []; }
  refreshing = false;
  mount();
}

function renderSettings(host) {
  host.innerHTML = `<div class="panel"><h3>AI News panel</h3>
    <p class="small">A side panel with this week's AI News links. On a wide window it opens by default in its own column on the left or right, so it never covers your page. Minimize it to a tab any time.</p>
    <label class="row" style="gap:8px"><input type="checkbox" id="cc-rail-show" ${state.hidden ? "" : "checked"}> Show the AI News panel</label></div>`;
  host.querySelector("#cc-rail-show").addEventListener("change", (ev) => {
    state.hidden = !ev.target.checked;
    saveRail(localStorage, state);
    mount();
    if (!state.hidden && !links.length) load();
  });
}

// Bring the panel back from anywhere (0.4.21, F7): the Community News screen has a Show button, so Simple needs no Settings page.
window.CC.newsRail = {
  hidden: () => !!state.hidden,
  show() { state.hidden = false; saveRail(localStorage, state); mount(); if (!links.length) load(); },
};

function start() {
  if (start.done) return;
  start.done = true;
  if (!state.hidden) load();
  // Switching Simple/Expert repaints the panel at once instead of waiting for the next state tick.
  try { new MutationObserver(() => { const ex = isExpert(); if (lastExpert !== ex && !state.hidden) mount(); lastExpert = ex; }).observe(document.body, { attributes: true, attributeFilter: ["data-ui"] }); } catch { /* no observer */ }
  window.addEventListener("resize", () => {
    clearTimeout(start.t);
    start.t = setTimeout(() => { if (!state.hidden) mount(); }, 150);
  });
  // The feed is weekly. While the window is visible and open, look again twice an hour; coming back to the window after a while also checks.
  setInterval(() => { if (!document.hidden && !state.hidden) load(); }, WEEKLY_CHECK_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !state.hidden && Date.now() - checkedAt > WEEKLY_CHECK_MS) load(); });
}

window.CC.register({
  id: "news-rail",
  settings: { order: 47, render: renderSettings },
  onState() { start(); const ex = isExpert(); if (lastExpert !== ex && !state.hidden) mount(); lastExpert = ex; },
});
// Shell modules load after the first state arrives, so start here too.
start();
