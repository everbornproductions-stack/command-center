// Momentum Mode on screen (flag_momentum, 0.4.19): a slim bar of 2 to 4 suggested next steps. It only
// suggests. A click fills a form, focuses a box or opens a page; nothing runs, sends or spends by
// itself. Scoring is local and quick (web/momentum.js). Autosave is one short wait after a real change,
// never a loop. Loaded only when the flag is on.
import { suggest, variationText, guessLang, DEFAULT_WEIGHTS, WEIGHT_KEYS } from "./momentum.js";
import { BAR_VIEWS } from "./projectbar.js";
import { latestDone } from "./finishpath.js";

const STYLE = `
.mm-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 10px; padding: 6px 10px; border: 1px solid var(--line, #2b3a52); border-radius: 12px; background: var(--panel, #0e1726); min-width: 0; }
.mm-bar > * { min-width: 0; }
.mm-label { font-size: 0.8125rem; color: var(--muted, #94a3b8); }
.mm-bar .btn { overflow-wrap: anywhere; white-space: normal; text-align: left; max-width: 100%; }
.mm-why { flex-basis: 100%; margin: 0; padding-left: 18px; font-size: 0.8125rem; color: var(--muted, #94a3b8); overflow-wrap: anywhere; }
.mm-why[hidden], .mm-resume[hidden] { display: none; }
.mm-resume { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.mm-resume span { min-width: 0; overflow-wrap: anywhere; }
.mm-owner { flex-basis: 100%; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px; font-size: 0.8125rem; }
.mm-owner label { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.mm-owner input { width: 100%; min-width: 0; box-sizing: border-box; }
.mm-bar.low { gap: 4px; }
`;
function ensureStyle() {
  if (document.getElementById("cc-mm-style")) return;
  const s = document.createElement("style");
  s.id = "cc-mm-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const CC = () => window.CC;
export const momentumOn = () => !!CC().S?.flags?.momentum;
const lowPower = () => !!CC().S?.settings?.lightMode;
const expert = () => CC().uiMode?.() === "expert";

// What the page knows right now. One result at a time; the bar follows the newest.
const mem = {
  result: null, // { id, text, title, at, type }
  server: null, // { key, weights, disabled, history, owner, resume }
  dismissed: {},
  justDone: "",
  exitedKeys: new Set(),
  saveTimer: null,
  lastSaved: "",
  fetching: null,
  showWhy: false,
};
export function _reset() { Object.assign(mem, { result: null, server: null, dismissed: {}, justDone: "", exitedKeys: new Set(), saveTimer: null, lastSaved: "", fetching: null, showWhy: false }); }

const keyNow = () => CC().S?.project || "main";

// Called by the feature when a result is shown, so the bar knows what to suggest from.
export function noteResult(run) {
  if (!run?.id) return;
  const text = String(run.deliverable || "");
  if (mem.result?.id === run.id && mem.result.text === text) return;
  mem.result = { id: run.id, text, title: String(run.title || run.prompt || "").slice(0, 80), at: Date.now(), type: "text" };
  mem.justDone = "";
  scheduleSave();
  syncBar();
}

function currentResult() {
  if (mem.result) return mem.result;
  const { S } = CC();
  const m = latestDone(S.missions, S.project);
  if (!m) return null;
  return { id: m.id, text: String(m.title || m.prompt || ""), title: String(m.title || "").slice(0, 80), at: Number(m.finishedAt || m.startedAt) || Date.now(), type: "text" };
}

export function buildContext() {
  const { S } = CC();
  const r = currentResult();
  const draft = document.getElementById("orders")?.value || "";
  const hasResult = !!r;
  const stage = !hasResult ? "idea" : S.view === "publish" ? "finish" : draft.trim() ? "refine" : "result";
  return {
    stage, hasResult, resultType: r?.type || "text", resultAt: r?.at || 0, text: r?.text || draft,
    hasProject: !!S.project && (S.projects || []).some((p) => p.id === S.project),
    hasSaved: !!mem.server?.resume,
    history: mem.server?.history || {}, dismissed: mem.dismissed, justDone: mem.justDone,
    running: (S.missions || []).some((m) => ["planning", "running"].includes(m.status)),
    now: Date.now(),
  };
}

export function currentSuggestions() {
  const s = mem.server;
  return suggest(buildContext(), { weights: s?.weights || DEFAULT_WEIGHTS, disabled: s?.disabled || [], lowPower: lowPower() });
}

async function loadServer() {
  const key = keyNow();
  if (mem.server?.key === key) return mem.server;
  if (mem.fetching) return mem.fetching;
  mem.fetching = (async () => {
    try {
      const r = await CC().api(`/momentum/state?project=${encodeURIComponent(key)}`);
      mem.server = { key, weights: r.weights, disabled: r.disabled || [], history: r.history || {}, owner: !!r.owner, resume: r.resume || null, exited: !!r.exited };
    } catch { mem.server = { key, weights: DEFAULT_WEIGHTS, disabled: [], history: {}, owner: false, resume: null }; }
    mem.fetching = null;
    return mem.server;
  })();
  return mem.fetching;
}

// ---- autosave: one wait after a real change. Low Power saves on results and when the window hides. ----
function snapshot() {
  const r = currentResult();
  const ctx = buildContext();
  return { view: CC().S.view, stage: ctx.stage, resultType: ctx.resultType, runId: r?.id || "", draft: document.getElementById("orders")?.value || "", title: r?.title || "" };
}
export async function saveNow() {
  if (!momentumOn() || mem.exitedKeys.has(keyNow())) return null;
  const cp = snapshot();
  const sig = JSON.stringify([cp.runId, cp.draft, cp.stage]);
  if (sig === mem.lastSaved || (!cp.runId && !cp.draft)) return null;
  mem.lastSaved = sig;
  try { return await CC().api("/momentum/checkpoint", { method: "POST", body: { project: keyNow(), checkpoint: cp } }); } catch { return null; }
}
export function scheduleSave() {
  if (!momentumOn()) return;
  clearTimeout(mem.saveTimer);
  mem.saveTimer = setTimeout(() => { mem.saveTimer = null; saveNow(); }, lowPower() ? 8000 : 2000);
  try { mem.saveTimer.unref?.(); } catch { /* browser timers have no unref */ }
}
let wired = false;
function wireOnce() {
  if (wired) return;
  wired = true;
  document.addEventListener("input", (e) => { if (e.target?.id === "orders" && !lowPower()) { scheduleSave(); } });
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });
}

// ---- what a click does ----
function fillOrders(text) {
  const box = document.getElementById("orders");
  if (!box) { CC().toast("Open Command to use this.", true); return false; }
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}
const ACTIONS = {
  variations: () => { const t = variationText(currentResult()?.text); if (!t) { CC().toast("There is nothing to vary yet.", true); return false; } if (fillOrders(t)) CC().toast("Three versions are asked for in the box. Press Go when you are ready."); return true; },
  refine: () => { const b = document.getElementById("orders"); if (b) { b.focus(); b.scrollIntoView({ behavior: "smooth", block: "center" }); } CC().toast("Change the words in the box, then press Go."); return true; },
  shorten: () => { if (fillOrders(`Make this shorter and keep the meaning.\n\n${(currentResult()?.text || "").slice(0, 1500)}`)) CC().toast("Press Go when you are ready."); return true; },
  translate: () => { if (fillOrders(`Translate this into English.\n\n${(currentResult()?.text || "").slice(0, 1500)}`)) CC().toast("Press Go when you are ready."); return true; },
  finish: () => { const r = currentResult(); CC()._finishText = { kind: "command", text: r?.text || "" }; CC().toast("Sent to Finish. Check it, then publish."); CC().go("publish"); return true; },
  "add-project": async () => {
    const r = currentResult();
    if (!CC().S.flags?.nextactions) { CC().go("projects"); return true; }
    try { await CC().api("/nextactions/add", { method: "POST", body: { projectId: CC().S.project, kind: "command", ref: r?.id || "", name: (r?.title || "Result").slice(0, 60) } }); CC().toast("Added to the project."); } catch (e) { CC().toast(e.message, true); return false; }
    return true;
  },
  "to-remix": () => { CC()._remixPrefill = { idea: currentResult()?.text || "" }; CC().go("remix"); return true; },
  "save-media": () => { CC().go("media"); return true; },
  start: () => { const b = document.getElementById("orders"); if (b) b.focus(); else CC().go("command"); return true; },
  "see-projects": () => { CC().go("projects"); return true; },
  "pick-project": () => { CC().go("projects"); return true; },
  resume: () => resumeNow(),
};

async function resumeNow() {
  const { api, toast, go } = CC();
  try {
    const r = await api("/momentum/resume", { method: "POST", body: { project: keyNow(), accept: true } });
    const cp = r?.checkpoint;
    if (mem.server) mem.server.resume = null;
    if (!cp) { syncBar(); return false; }
    if (cp.view && cp.view !== CC().S.view && BAR_VIEWS.includes(cp.view)) go(cp.view);
    setTimeout(() => { if (cp.draft) fillOrders(cp.draft); toast("Picked up where you left off."); syncBar(); }, 60);
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function pick(id) {
  const fn = ACTIONS[id];
  if (!fn) return;
  const ok = await fn();
  if (ok === false) return;
  mem.justDone = id;
  if (mem.server) mem.server.history = { ...mem.server.history, [id]: (Number(mem.server.history[id]) || 0) + 1 };
  CC().api("/momentum/pick", { method: "POST", body: { project: keyNow(), actionId: id } }).catch(() => {});
  syncBar();
}

function notNow(actions) {
  const t = Date.now();
  for (const a of actions) mem.dismissed[a.id] = t;
  syncBar();
}

function turnOff() {
  mem.exitedKeys.add(keyNow());
  syncBar();
  CC().toast("Momentum is off for this project until you reopen Meldmind.");
}

// ---- Owner tuning hooks: weights, idle time and the action list, with a confirm and an undo ----
async function ownerPanel(bar) {
  const { api, toast, esc } = CC();
  bar.querySelector(".mm-owner")?.remove();
  let v;
  try { v = await api("/momentum/owner/view"); } catch (e) { toast(e.message, true); return; }
  const box = document.createElement("div");
  box.className = "mm-owner";
  box.innerHTML = `${WEIGHT_KEYS.map((k) => `<label>${esc(k.replace(/_/g, " "))}<input type="number" step="0.1" min="0" max="6" data-w="${k}" value="${v.weights[k]}"></label>`).join("")}
    <label>Idle seconds before Resume<input type="number" min="5" data-idle value="${Math.round(v.idleMs / 1000)}"></label>
    <div style="grid-column: 1 / -1; display:flex; flex-wrap:wrap; gap:6px"><button type="button" class="btn sm primary" data-save>Save tuning</button><button type="button" class="btn sm" data-undo>Undo last change</button><button type="button" class="btn sm" data-close>Close</button></div>`;
  bar.appendChild(box);
  const apply = async (url, body) => {
    try {
      const r = await api(url, { method: "POST", body: { ...body, confirm: true } });
      mem.server = null; await loadServer(); toast("Saved."); syncBar(); return r;
    } catch (e) { toast(e.message, true); return null; }
  };
  box.querySelector("[data-save]").addEventListener("click", () => {
    const weights = {};
    box.querySelectorAll("[data-w]").forEach((i) => { weights[i.dataset.w] = Number(i.value); });
    apply("/momentum/owner/tune", { weights, idleMs: Number(box.querySelector("[data-idle]").value) * 1000 });
  });
  box.querySelector("[data-undo]").addEventListener("click", () => apply("/momentum/owner/undo", {}));
  box.querySelector("[data-close]").addEventListener("click", () => box.remove());
}

function barHtml(out, esc) {
  const ex = expert();
  const btns = out.actions.map((a, i) => `<button type="button" class="btn sm${i === 0 ? " primary" : ""}" data-mm="${esc(a.id)}" title="${esc(ex ? a.expert : a.simple)}">${esc(a.label)}</button>`).join("");
  const why = out.actions.map((a) => `<li>${esc(a.label)}: ${esc(ex ? a.expert : a.simple)}</li>`).join("");
  return `<span class="mm-label">${ex ? "Momentum" : "Next"}</span>${btns}
    <button type="button" class="btn sm" data-mm-why aria-expanded="${mem.showWhy}">Why these?</button>
    <button type="button" class="btn sm" data-mm-not>Not now</button>
    <button type="button" class="btn sm" data-mm-off>Turn off</button>
    ${mem.server?.owner ? `<button type="button" class="btn sm" data-mm-tune>Tune</button>` : ""}
    <ul class="mm-why" ${mem.showWhy ? "" : "hidden"}>${why}</ul>`;
}

let drawing = false;
export function syncBar() {
  const { S, $, esc } = CC();
  let bar = document.getElementById("mmbar");
  const show = momentumOn() && BAR_VIEWS.includes(S.view) && S.view !== "publish" && !S.openProject && !mem.exitedKeys.has(keyNow());
  if (!show) { bar?.remove(); return; }
  wireOnce();
  if (mem.server?.key !== keyNow()) { loadServer().then(() => syncBar()); return; }
  ensureStyle();
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "mmbar";
    bar.className = "mm-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Next step suggestions");
    bar.addEventListener("click", onClick);
    const anchor = $("#fpbar") || $("#projbar");
    if (anchor) anchor.after(bar); else $("#view").before(bar);
  }
  if (drawing) return;
  drawing = true;
  try {
    const out = currentSuggestions();
    bar.classList.toggle("low", lowPower());
    bar.dataset.took = String(out.took_ms);
    const open = bar.querySelector(".mm-owner");
    const resume = mem.server.resume;
    bar.innerHTML = barHtml(out, esc);
    if (resume) {
      const r = document.createElement("div");
      r.className = "mm-resume";
      r.innerHTML = `<span>Pick up where you left off? You stopped${resume.checkpoint?.title ? ` on ${esc(resume.checkpoint.title)}` : " part way"}.</span><button type="button" class="btn sm primary" data-mm-resume>Pick up where I left off</button><button type="button" class="btn sm" data-mm-fresh>Start fresh</button>`;
      bar.prepend(r);
    }
    if (open) bar.appendChild(open);
    bar._out = out;
  } finally { drawing = false; }
}

function onClick(e) {
  const bar = e.currentTarget;
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.mm) return void pick(t.dataset.mm);
  if (t.hasAttribute("data-mm-why")) { mem.showWhy = !mem.showWhy; return void syncBar(); }
  if (t.hasAttribute("data-mm-not")) return void notNow(bar._out?.actions || []);
  if (t.hasAttribute("data-mm-off")) return void turnOff();
  if (t.hasAttribute("data-mm-tune")) return void ownerPanel(bar);
  if (t.hasAttribute("data-mm-resume")) return void resumeNow();
  if (t.hasAttribute("data-mm-fresh")) {
    CC().api("/momentum/resume", { method: "POST", body: { project: keyNow(), accept: false } }).catch(() => {});
    if (mem.server) mem.server.resume = null;
    syncBar();
  }
}

export { guessLang };
