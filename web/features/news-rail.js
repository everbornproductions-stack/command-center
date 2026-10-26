// AI News side panel. Opens from a small tab, moves left or right, and shrinks again.
// It only reads the published issue; nothing is posted or sent from here.
import { readRail, saveRail, railLinks } from "/news-rail.js";

const { api, esc, go } = window.CC;
let state = readRail(localStorage);
let links = [];
let unread = false;

const css = `
#cc-rail { position: fixed; top: 76px; z-index: 35; width: 280px; max-height: calc(100vh - 190px); display: flex; flex-direction: column; background: var(--panel-solid, #0d1420); color: var(--text, #e6edf7); border: 1px solid var(--line-2, #2a3a52); border-radius: 12px; box-shadow: 0 12px 32px #0008; }
#cc-rail[data-side="right"] { right: 14px; }
#cc-rail[data-side="left"] { left: 14px; }
#cc-rail[data-min="1"] { width: auto; max-height: none; }
#cc-rail .rail-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; }
#cc-rail .rail-title { flex: 1; font-weight: 650; text-align: left; background: none; border: 0; color: inherit; cursor: pointer; padding: 0; }
#cc-rail .rail-body { overflow: auto; padding: 0 12px 10px; }
#cc-rail .rail-body a { display: block; padding: 6px 0; border-top: 1px solid var(--line, #1f2b3d); color: var(--accent, #22d3ee); text-decoration: none; }
#cc-rail .rail-body a:hover { text-decoration: underline; }
#cc-rail .rail-src { color: var(--muted, #8a9bb3); font-size: .75rem; }
#cc-rail .rail-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #22d3ee); margin-left: 6px; }
@media (max-width: 760px) { #cc-rail { display: none; } }
`;

function mount() {
  if (!document.getElementById("cc-rail-style")) {
    const style = document.createElement("style");
    style.id = "cc-rail-style";
    style.textContent = css;
    document.head.appendChild(style);
  }
  let el = document.getElementById("cc-rail");
  if (state.hidden) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("aside");
    el.id = "cc-rail";
    el.setAttribute("aria-label", "AI News");
    document.body.appendChild(el);
  }
  el.dataset.side = state.side;
  el.dataset.min = state.min ? "1" : "0";
  const dot = unread ? `<span class="rail-dot" aria-label="New issue"></span>` : "";
  el.innerHTML = `<div class="rail-head">
      <button type="button" class="rail-title" data-rail="toggle" aria-expanded="${state.min ? "false" : "true"}">AI News${dot}</button>
      ${state.min ? "" : `<button type="button" class="btn sm" data-rail="side" aria-label="Move the panel to the ${state.side === "left" ? "right" : "left"}">Move ${state.side === "left" ? "right" : "left"}</button>
      <button type="button" class="btn sm" data-rail="toggle" aria-label="Minimize AI News">Minimize</button>
      <button type="button" class="btn sm" data-rail="hide" aria-label="Hide AI News. Settings can bring it back.">Hide</button>`}
    </div>
    ${state.min ? "" : `<div class="rail-body">
      ${links.length ? links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}${l.source ? `<div class="rail-src">${esc(l.source)}</div>` : ""}</a>`).join("") : `<div class="dim small">No issue yet. A new one is published each week.</div>`}
      <div style="margin-top:8px"><button type="button" class="btn sm" data-rail="open">Open AI News</button></div>
    </div>`}`;
  el.onclick = (ev) => {
    const act = ev.target.closest("[data-rail]")?.dataset.rail;
    if (!act) return;
    if (act === "toggle") state.min = !state.min;
    else if (act === "side") state.side = state.side === "left" ? "right" : "left";
    else if (act === "hide") state.hidden = true;
    else if (act === "open") { go("community"); return; }
    saveRail(localStorage, state);
    mount();
  };
}

async function load() {
  try {
    const news = await api("/community/news");
    links = railLinks(news);
    unread = !!news?.unread;
  } catch { links = []; }
  mount();
}

function renderSettings(host) {
  host.innerHTML = `<div class="panel"><h3>AI News panel</h3>
    <p class="small">A small side panel with this week's AI News links. It can sit on the left or the right, or shrink to a tab.</p>
    <label class="row" style="gap:8px"><input type="checkbox" id="cc-rail-show" ${state.hidden ? "" : "checked"}> Show the AI News panel</label></div>`;
  host.querySelector("#cc-rail-show").addEventListener("change", (ev) => {
    state.hidden = !ev.target.checked;
    saveRail(localStorage, state);
    mount();
  });
}

window.CC.register({
  id: "news-rail",
  settings: { order: 47, render: renderSettings },
  onState() { if (!document.getElementById("cc-rail") && !state.hidden && !load.started) { load.started = true; load(); } },
});
