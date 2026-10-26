// The next actions bar and the one Send to menu (flag_nextactions, 0.4.19). Drawn under a result by
// Command, Images, Media and Remix. Nothing here spends money: a button fills a form (the price still
// shows first), copies words, or files the result under a project. Loaded by those pages only.
import { NEXT_ACTIONS, MENU_LABEL, sendRows, cleanText } from "./next-actions.js";

const STYLE = `
.na-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; margin-top: 10px; min-width: 0; }
.na-bar > * { min-width: 0; }
.na-bar .btn { overflow-wrap: anywhere; white-space: normal; text-align: left; max-width: 100%; }
.na-send { position: relative; min-width: 0; }
.na-send > summary { cursor: pointer; list-style: none; }
.na-send > summary::-webkit-details-marker { display: none; }
.na-menu { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding: 6px; border: 1px solid var(--line-2, #2b3a52); border-radius: 10px; background: var(--panel-solid, #0d1420); min-width: 0; max-width: 100%; }
.na-menu .btn { width: 100%; }
.na-pick { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; flex-basis: 100%; min-width: 0; overflow-wrap: anywhere; }
.na-pick select { max-width: 100%; min-width: 0; width: auto; }
.na-note { flex-basis: 100%; overflow-wrap: anywhere; min-width: 0; }
`;
function ensureStyle() {
  if (document.getElementById("cc-na-style")) return;
  const s = document.createElement("style");
  s.id = "cc-na-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const CC = () => window.CC;
export const nextActionsOn = () => !!CC().S?.flags?.nextactions;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

// opts: { kind: command|image|media|remix, text, ref, name, onVariations(), addTo(projectId), finish() }
// onVariations fills the right form with three tries. addTo overrides how a result is filed (Remix).
export function mountBar(el, opts = {}) {
  if (!el || !nextActionsOn()) return null;
  ensureStyle();
  const { esc, toast, api, go, S } = CC();
  const kind = opts.kind || "command";
  const text = cleanText(opts.text);
  el.querySelector(":scope > .na-bar")?.remove();
  const bar = document.createElement("div");
  bar.className = "na-bar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Next actions");
  bar.innerHTML = `${NEXT_ACTIONS.map((a) => `<button type="button" class="btn sm" data-na="${a.id}">${esc(a.label)}</button>`).join("")}
    <details class="na-send"><summary class="btn sm" aria-label="${esc(MENU_LABEL)}">${esc(MENU_LABEL)}</summary>
    <div class="na-menu" role="menu">${sendRows(kind).map((r) => `<button type="button" class="btn sm" role="menuitem" data-send="${r.id}">${esc(r.label)}</button>`).join("")}</div></details>
    <div class="na-pick dim small" data-na-pick hidden></div>`;
  el.appendChild(bar);
  const menu = bar.querySelector(".na-send");
  const pick = bar.querySelector("[data-na-pick]");

  const addTo = async (projectId) => {
    try {
      if (opts.addTo) await opts.addTo(projectId);
      else await api("/nextactions/add", { method: "POST", body: { projectId, kind, ref: opts.ref || "", name: opts.name || text.slice(0, 60) } });
      const name = (S.projects || []).find((p) => p.id === projectId)?.name || "the project";
      toast(`Added to ${name}.`);
      pick.hidden = true;
    } catch (e) { toast(e.message, true); }
  };
  const askProject = () => {
    const projects = S.projects || [];
    if (!projects.length) { toast("Make a project first, then add this to it.", true); return; }
    pick.hidden = false;
    const first = S.project && projects.some((p) => p.id === S.project) ? S.project : projects[0].id;
    pick.innerHTML = `<label>Project <select data-na-proj>${projects.map((p) => `<option value="${esc(p.id)}" ${p.id === first ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <button type="button" class="btn sm primary" data-na-ok>Add</button><button type="button" class="btn sm" data-na-cancel>Cancel</button>`;
    pick.querySelector("[data-na-ok]").addEventListener("click", () => addTo(pick.querySelector("[data-na-proj]").value));
    pick.querySelector("[data-na-cancel]").addEventListener("click", () => { pick.hidden = true; });
    pick.querySelector("[data-na-proj]").focus();
  };
  const toFinish = () => {
    if (opts.finish) { opts.finish(); return; }
    CC()._finishText = { kind, text };
    toast("Sent to Finish. Check it, then publish.");
    go("publish");
  };
  const toRemix = () => {
    CC()._remixPrefill = { idea: text };
    go("remix");
  };
  const toPrompt = async () => { toast(await copyText(text) ? "Prompt copied." : "Copy did not work here.", false); };
  const variations = () => {
    if (!opts.onVariations) { toast("Variations are not set up here.", true); return; }
    opts.onVariations(text);
  };

  const run = {
    variations, project: askProject, finish: toFinish, remix: toRemix, prompt: toPrompt,
  };
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-na], [data-send]");
    if (!b) return;
    const id = b.dataset.na || b.dataset.send;
    if (b.dataset.send && menu) menu.open = false;
    run[id]?.();
  });
  bar.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu?.open) { menu.open = false; menu.querySelector("summary").focus(); } });
  return bar;
}
