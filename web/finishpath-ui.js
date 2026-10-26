// The finish path on screen (flag_finishpath, 0.4.19): the Finish button that is always in view, the
// Looks good / Edit further pair under a result, the Finish preview card with one confirm, and the slim
// progress pill. Loaded only when the flag is on. Nothing here sends or spends: Finish opens Publish.
import { FINISH_LABEL, PAIR, UNDO_LABEL, BRANCH_LABEL, previewCard, pillInfo, latestDone, cleanText } from "./finishpath.js";
import { BAR_VIEWS } from "./projectbar.js";

const STYLE = `
.fp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 10px; min-width: 0; }
.fp-bar > * { min-width: 0; }
.fp-bar .fp-finish { overflow-wrap: anywhere; white-space: normal; order: 2; margin-left: auto; }
.fp-bar .fp-pill { order: 1; }
.fp-pill { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--accent, #22d3ee); background: var(--panel, #0e1726); color: var(--text, #e6edf6); font-size: 0.8125rem; overflow-wrap: anywhere; min-width: 0; }
.fp-pill[hidden] { display: none; }
.fp-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #22d3ee); animation: fp-pulse 1.4s ease-in-out infinite; }
@keyframes fp-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .fp-dot { animation: none; } }
.fp-pair { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; margin-top: 10px; min-width: 0; }
.fp-pair .btn { overflow-wrap: anywhere; white-space: normal; text-align: left; max-width: 100%; }
.fp-card { flex-basis: 100%; width: 100%; box-sizing: border-box; min-width: 0; padding: 12px; border: 1px solid var(--line, #2b3a52); border-radius: 12px; background: var(--panel-solid, #0d1420); overflow-wrap: anywhere; }
.fp-card h4 { margin: 0 0 6px; }
.fp-card ul { margin: 0 0 8px; padding-left: 18px; }
.fp-card .fp-excerpt { margin: 0 0 10px; color: var(--muted, #94a3b8); font-size: 0.8125rem; }
.fp-card .fp-acts { display: flex; flex-wrap: wrap; gap: 8px; }
`;
function ensureStyle() {
  if (document.getElementById("cc-fp-style")) return;
  const s = document.createElement("style");
  s.id = "cc-fp-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const CC = () => window.CC;
export const finishPathOn = () => !!CC().S?.flags?.finishpath;

function projectName() {
  const { S } = CC();
  return (S.projects || []).find((p) => p.id === S.project)?.name || "";
}

// One confirm. Opens the Finish drawer with the result. Remembers it the same way Send to Finish does.
export function confirmFinish(result) {
  const cc = CC();
  cc._finishText = { kind: result.kind, text: result.text };
  if (cc.openFinishDrawer) { cc.openFinishDrawer({ kind: result.kind, text: result.text, name: result.name, source: "Finish" }); return; }
  cc.toast("Finish is ready. Pick where it goes, then press the button there.");
  cc.go("publish");
}

// Draws the preview card into host and returns it. result: { kind, text, name }.
export async function openCard(host, result) {
  if (!host || !finishPathOn()) return null;
  ensureStyle();
  const { esc, api, toast } = CC();
  host.querySelector(":scope > .fp-card")?.remove();
  let card = previewCard({ ...result, projectName: projectName() });
  try {
    const r = await api("/finishpath/preview", { method: "POST", body: { ...result, projectName: projectName() } });
    if (r?.card) card = r.card;
  } catch { /* the local card is the same words */ }
  if (!card) { toast("There is nothing to finish yet.", true); return null; }
  const el = document.createElement("div");
  el.className = "fp-card";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Finish preview");
  el.innerHTML = `<h4>${esc(card.title)}</h4>
    <ul>${card.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <p class="fp-excerpt">${esc(card.excerpt)}</p>
    <div class="fp-acts"><button type="button" class="btn sm primary" data-fp-ok>${esc(card.confirm)}</button><button type="button" class="btn sm" data-fp-no>${esc(card.cancel)}</button></div>`;
  host.appendChild(el);
  el.querySelector("[data-fp-ok]").addEventListener("click", () => { el.remove(); confirmFinish(result); });
  el.querySelector("[data-fp-no]").addEventListener("click", () => el.remove());
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") el.remove(); });
  el.querySelector("[data-fp-ok]").focus();
  return el;
}

// The Looks good, Finish / Edit further pair under a result.
// opts: { kind, text, name, onEdit() }. Edit further hands the work back to the form.
export function mountPair(el, opts = {}) {
  if (!el || !finishPathOn()) return null;
  ensureStyle();
  const { esc } = CC();
  el.querySelector(":scope > .fp-pair")?.remove();
  const text = cleanText(opts.text);
  if (!text) return null;
  const pair = document.createElement("div");
  pair.className = "fp-pair";
  pair.setAttribute("role", "group");
  pair.setAttribute("aria-label", "Finish or edit");
  pair.innerHTML = `<button type="button" class="btn sm primary" data-fp-good>${esc(PAIR.good)}</button><button type="button" class="btn sm" data-fp-edit>${esc(PAIR.edit)}</button>`;
  el.appendChild(pair);
  const result = { kind: opts.kind || "command", text, name: opts.name || "" };
  CC()._lastResult = result;
  // One step (0.4.21, M16): Looks good, Finish opens the Finish panel straight away. No second confirm card.
  pair.querySelector("[data-fp-good]").addEventListener("click", () => confirmFinish(result));
  pair.querySelector("[data-fp-edit]").addEventListener("click", () => {
    pair.querySelector(".fp-card")?.remove();
    if (opts.onEdit) { opts.onEdit(); return; }
    const box = document.querySelector("#view textarea:not([disabled])");
    if (box) { box.focus(); box.scrollIntoView({ behavior: "smooth", block: "center" }); }
    CC().toast("Change the words, then run it again.");
  });
  return pair;
}

// The Finish button that is always in view, and the progress pill beside it.
export function syncBar() {
  const { S, $ } = CC();
  let bar = document.getElementById("fpbar");
  const show = finishPathOn() && BAR_VIEWS.includes(S.view) && S.view !== "publish" && !S.openProject;
  if (!show) { bar?.remove(); return; }
  ensureStyle();
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "fpbar";
    bar.className = "fp-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Finish");
    bar.innerHTML = `<button type="button" class="btn sm primary fp-finish" id="fp-finish">${FINISH_LABEL}</button>
      <span class="fp-pill" id="fp-pill" role="status" aria-live="polite" hidden><span class="fp-dot" aria-hidden="true"></span><span id="fp-pill-text"></span></span>`;
    const anchor = $("#projbar") || $("#view");
    if ($("#projbar")) anchor.after(bar); else anchor.before(bar);
    bar.querySelector("#fp-finish").addEventListener("click", finishNow);
  }
  syncPill();
}

export function syncPill() {
  const pill = document.getElementById("fp-pill");
  if (!pill) return;
  const info = pillInfo(CC().S.missions);
  pill.hidden = !info;
  const t = document.getElementById("fp-pill-text");
  if (t) t.textContent = info ? info.text : "";
}

// Finish with no result in hand: use the last one shown, else the newest finished job.
async function finishNow() {
  const { S, api, toast } = CC();
  const bar = document.getElementById("fpbar");
  if (bar?.querySelector(".fp-card")) { bar.querySelector(".fp-card").remove(); return; }
  let result = CC()._lastResult;
  if (!result?.text) {
    const m = latestDone(S.missions, S.project) || latestDone(S.missions);
    if (m?.id) {
      try {
        const full = await api(`/missions/${m.id}`);
        if (full?.deliverable) result = { kind: "command", text: cleanText(full.deliverable), name: cleanText(m.title || "", 60) };
      } catch { /* handled below */ }
    }
  }
  if (!result?.text) { toast("Make something first, then press Finish.", true); return; }
  confirmFinish(result); // one step (0.4.21, M16)
}

// Undo last step and Branch from here on a project's steps (the walkthrough stages Build and Review).
// onWalk(view) repaints the project. A branch opens the new project; the main line stays as it was.
export function mountStepTools(stage, w, onWalk) {
  if (!stage || !w || !finishPathOn() || w.example) return null;
  ensureStyle();
  const { api, toast, esc } = CC();
  const steps = w.plan?.steps || [];
  const lastDone = [...steps].reverse().find((s) => s.status === "done");
  if (!lastDone) return null;
  const busy = ["planning", "building", "revising"].includes(w.status);
  stage.querySelector(":scope > .fp-steptools")?.remove();
  const row = document.createElement("div");
  row.className = "fp-pair fp-steptools";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Undo or branch");
  row.innerHTML = `<button type="button" class="btn sm" data-fp-undo ${busy ? "disabled" : ""}>${esc(UNDO_LABEL)}</button>
    <button type="button" class="btn sm" data-fp-branch="${esc(lastDone.id)}" ${busy ? "disabled" : ""}>${esc(BRANCH_LABEL)}</button>
    <span class="small dim" style="overflow-wrap:anywhere;min-width:0">Undo puts the last finished step back to waiting. Branch makes a copy that keeps the steps up to "${esc(lastDone.title)}".</span>`;
  stage.appendChild(row);
  stage.querySelectorAll(".sp-step").forEach((el, i) => {
    const s = steps[i];
    if (!s || s.status !== "done" || el.querySelector("[data-fp-branch]")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn sm";
    b.dataset.fpBranch = s.id;
    b.textContent = BRANCH_LABEL;
    b.disabled = busy;
    b.style.marginTop = "6px";
    el.appendChild(b);
  });
  stage.addEventListener("click", async (e) => {
    const undo = e.target.closest("[data-fp-undo]");
    const branch = e.target.closest("[data-fp-branch]");
    if (!undo && !branch) return;
    try {
      if (undo) {
        const r = await api("/finishpath/undo", { method: "POST", body: { walkId: w.id } });
        toast(`Undid "${r.undone?.title || "the last step"}".`);
        onWalk(await api(`/walkthrough/${w.id}`));
      } else {
        const r = await api("/finishpath/branch", { method: "POST", body: { walkId: w.id, stepId: branch.dataset.fpBranch } });
        toast("Branch made. You are in the copy now. The first project is unchanged.");
        onWalk(await api(`/walkthrough/${r.walkId}`));
      }
    } catch (er) { toast(er.message, true); }
  });
  return row;
}
