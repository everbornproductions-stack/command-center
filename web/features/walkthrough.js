// Start a project. The home card and the Work menu open the same wizard.
// Simple is the default. Expert is read from the Simple/Expert work when that
// setting exists (CC.experience, settings.experience, settings.uiMode). This
// file does not own the mode switch.
const { api, toast, esc, md, go } = window.CC;

const css = `
.sp-wrap { display: flex; flex-direction: column; gap: 14px; max-width: 920px; }
.sp-home { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card-bg, #0e1726); }
.sp-types { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.sp-type { text-align: left; background: var(--card-bg, #0e1726); border: 1px solid var(--line); border-radius: 12px; padding: 12px; color: var(--text); cursor: pointer; }
.sp-type:hover, .sp-type:focus { border-color: var(--accent); outline: none; }
.sp-type h4 { margin: 0 0 4px; font-size: 15px; }
.sp-rail { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sp-rail span { font-size: 12px; color: var(--dim); padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); }
.sp-rail span.on { color: var(--text); border-color: var(--accent); }
.sp-rail span.done { color: var(--muted); }
.sp-crumb { max-width: 100%; overflow-wrap: anywhere; font-size: 12px; color: var(--dim); padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--card-bg, #0e1726); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.sp-crumb.on { color: var(--text); border-color: var(--accent); font-weight: 600; }
.sp-crumb.done { color: var(--muted); border-color: #1e293b; }
.sp-crumb.skipped { opacity: 0.6; text-decoration: line-through; }
.sp-crumb-sep { color: var(--dim); font-size: 11px; border: none !important; padding: 0 2px !important; }
.sp-flowchart { display: flex; align-items: stretch; gap: 6px; overflow-x: auto; padding: 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--card-bg, #0b1320); }
.sp-flow-node { min-width: 128px; overflow-wrap: anywhere; word-break: break-word; flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--card-bg, #0e1726); color: var(--text); text-align: left; cursor: pointer; }
.sp-flow-node.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.sp-flow-node.done { border-color: #10b981; }
.sp-flow-node.skipped { opacity: 0.6; }
.sp-flow-edge { display: flex; align-items: center; color: var(--dim); font-size: 14px; padding: 0 2px; }
.sp-flow-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card-bg, #0e1726); }
.sp-banner { padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, #f59e0b 16%, var(--card-bg, #3a2a12)); border: 1px solid #a16207; color: color-mix(in srgb, #b45309 60%, var(--text, #fde68a)); }
.sp-step { padding: 8px 0; border-bottom: 1px solid var(--line); }
.sp-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#sp-root textarea, #sp-root input[type="text"] { width: 100%; }
@media (max-width: 640px) { .sp-home { align-items: stretch; } .sp-home .btn { width: 100%; } }
`;
if (!document.getElementById("sp-style")) {
  const style = document.createElement("style");
  style.id = "sp-style";
  style.textContent = css;
  document.head.appendChild(style);
}

let poll = null;
let pollId = "";
let liveLine = "";

function clientExperience() {
  const cc = window.CC || {};
  const reads = [];
  try { if (typeof cc.uiMode === "function") reads.push(cc.uiMode()); } catch { /* the mode switch is optional until it loads */ }
  try { if (typeof cc.experience === "function") reads.push(cc.experience()); } catch { /* older callers */ }
  const s = cc.S?.settings || {};
  reads.push(cc.S?.uiMode, s.uiMode, s.experience, cc.S?.experience);
  try {
    reads.push(localStorage.getItem("cc.experience"), localStorage.getItem("cc.uiMode"));
    reads.push(document.documentElement.dataset.experience);
  } catch { /* storage can be blocked */ }
  for (const v of reads) {
    const raw = String(v ?? "").trim().toLowerCase();
    if (raw === "expert" || raw === "advanced") return "expert";
    if (raw === "simple") return "simple";
  }
  return "simple";
}

function clientFlowStages(w) {
  if (w?.flowStagesEnabled === true) return true;
  const s = window.CC?.S?.settings || {};
  if (s.flag_flowstages === true || s.flags?.flag_flowstages === true) return true;
  try {
    const local = localStorage.getItem("cc.flag_flowstages");
    if (local === "1" || local === "true") return true;
  } catch { /* storage can be blocked */ }
  return false;
}

const qexp = () => {
  const base = `experience=${encodeURIComponent(clientExperience())}`;
  return clientFlowStages() ? `${base}&flag_flowstages=1` : base;
};
function stopPoll() { if (poll) clearInterval(poll); poll = null; pollId = ""; }
function startPoll(id) {
  if (poll && pollId === id) return;
  stopPoll();
  pollId = id;
  poll = setInterval(() => refreshWalk(id), 1200);
}

function homeHtml() {
  const expert = clientExperience() === "expert";
  return `<div class="sp-home" id="sp-home">
    <b>Start a project</b>
    <span class="chip">${expert ? "Expert" : "Simple"}</span>
    <span class="small dim" style="flex:1">Website, music video, marketing campaign, app, business plan, or reels.</span>
    <button class="btn sm primary" type="button" id="sp-open">Start a project</button>
  </div>`;
}
function bindHome(root) {
  root.querySelector("#sp-open")?.addEventListener("click", () => go("start"));
}
function renderHome(el) {
  el.innerHTML = homeHtml();
  bindHome(el);
}
function ensureHome() {
  const cc = window.CC;
  if (!cc?.S || cc.S.view !== "command") return;
  // Simple has Start a project in the top row. Its chat page stays chat only.
  if (cc.S.uiMode === "simple") return;
  if (document.getElementById("sp-home")) return;
  const view = document.getElementById("view");
  if (!view) return;
  const bar = document.createElement("div");
  bar.innerHTML = homeHtml();
  const node = bar.firstElementChild;
  view.prepend(node);
  bindHome(node);
}
new MutationObserver(() => ensureHome()).observe(document.getElementById("view") || document.body, { childList: true });

function rail(w) {
  const stages = w.stages || [];
  const at = stages.findIndex((s) => s.id === w.stage);
  if (!clientFlowStages(w)) {
    return `<div class="sp-rail" aria-label="Steps">${stages.map((s, i) => `<span class="${i === at ? "on" : i < at ? "done" : ""}">${esc(s.label)}</span>`).join("")}</div>`;
  }
  if (w.experience === "expert") {
    const nodes = (w.flowchart?.nodes || stages).map((s, i) => {
      const state = s.state || (i === at ? "active" : i < at ? "done" : "pending");
      const cls = state === "active" || state === "running" ? "on" : state === "done" ? "done" : state === "skipped" ? "skipped" : "";
      const badge = s.skipped ? "skipped" : s.autofilled ? "AI filled" : state;
      const edge = i < stages.length - 1 ? `<div class="sp-flow-edge" aria-hidden="true">→</div>` : "";
      return `<button type="button" class="sp-flow-node ${cls}" data-stage-jump="${esc(s.id)}" aria-current="${i === at ? "step" : "false"}">
        <div class="row small" style="justify-content:space-between;width:100%"><span class="mono dim">${i + 1}</span><span class="chip">${esc(badge)}</span></div>
        <b>${esc(s.label)}</b>
      </button>${edge}`;
    }).join("");
    return `<div class="sp-flowchart" role="region" aria-label="Live horizontal flowchart">${nodes}</div>`;
  }
  return `<nav class="sp-rail sp-breadcrumb" aria-label="Flow stages">${stages.map((s, i) => {
    const cls = `${i === at ? "on" : i < at ? "done" : ""}${s.skipped ? " skipped" : ""}`.trim();
    const sep = i < stages.length - 1 ? `<span class="sp-crumb-sep" aria-hidden="true">→</span>` : "";
    return `<button type="button" class="sp-crumb ${cls}" data-stage-jump="${esc(s.id)}" aria-current="${i === at ? "step" : "false"}"><span>${i + 1}. ${esc(s.label)}</span></button>${sep}`;
  }).join("")}</nav>`;
}

function flowControlsHtml(w) {
  if (!clientFlowStages(w) || w.example || w.readonly) return "";
  const isPaused = w.paused || w.status === "paused";
  const stacked = w.stackedSteps || [];
  const stageOptions = (w.stages || []).map((s) => `<option value="${esc(s.id)}" ${s.id === w.stage ? "selected" : ""}>${esc(s.label)}</option>`).join("");
  const currentEntry = (w.stages || []).find((s) => s.id === w.stage);
  return `<div class="sp-flow-bar" id="sp-flow-controls">
    <button class="btn sm" type="button" data-flow-action="autofill">Let AI fill</button>
    <button class="btn sm" type="button" data-flow-action="skip">Skip stage</button>
    <button class="btn sm" type="button" data-flow-action="move-up" title="Move stage earlier">Move left</button>
    <button class="btn sm" type="button" data-flow-action="move-down" title="Move stage later">Move right</button>
    <button class="btn sm" type="button" data-flow-action="add">+ Add step</button>
    ${currentEntry?.custom ? `<button class="btn sm" type="button" data-flow-action="remove">Remove step</button>` : ""}
    <span style="margin-left:auto;display:flex;gap:6px">
      ${isPaused
        ? `<button class="btn sm primary" type="button" data-flow-action="resume">Resume</button>`
        : `<button class="btn sm" type="button" data-flow-action="pause">Pause</button>`}
      <button class="btn sm" type="button" data-flow-action="save">Save</button>
    </span>
  </div>
  <details class="panel" id="sp-stack-panel" ${stacked.length ? "open" : ""}>
    <summary class="small"><b>Queued steps</b> <span class="dim">(${stacked.length} queued to auto-advance across stages)</span></summary>
    <div class="sp-actions" style="margin-top:8px">
      <select id="sp-stack-stage" aria-label="Stage for stacked step" style="width:auto">${stageOptions}</select>
      <input id="sp-stack-input" type="text" placeholder="Prompt or instruction for this stage" style="flex:1;min-width:180px">
      <button class="btn sm" type="button" data-stack-add>Stack step</button>
      ${stacked.length ? `<button class="btn sm primary" type="button" data-stack-run>Run queued steps</button>` : ""}
    </div>
    ${stacked.length ? `<ol class="small" style="margin:8px 0 0 18px;padding:0">${stacked.map((st) => `<li><b>${esc(st.flowStage || st.stage)}</b>: ${esc(st.prompt || st.title)} <span class="chip">${esc(st.status || "queued")}</span></li>`).join("")}</ol>` : ""}
  </details>`;
}

function wireFlowControls(root, w) {
  root.querySelectorAll("[data-stage-jump]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (w.example || w.readonly) return;
      try {
        paintWalk(await api(`/walkthrough/${w.id}/stage?${qexp()}`, { method: "POST", body: { stage: btn.dataset.stageJump, experience: clientExperience(), flag_flowstages: true } }));
      } catch (e) { toast(e.message, true); }
    });
  });
  root.querySelectorAll("[data-flow-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.flowAction;
      try {
        if (act === "autofill") {
          paintWalk(await api(`/walkthrough/${w.id}/autofill?${qexp()}`, { method: "POST", body: { stage: w.stage, experience: clientExperience(), flag_flowstages: true } }));
        } else if (act === "skip") {
          paintWalk(await api(`/walkthrough/${w.id}/skip?${qexp()}`, { method: "POST", body: { stage: w.stage, experience: clientExperience(), flag_flowstages: true } }));
        } else if (act === "move-up" || act === "move-down") {
          paintWalk(await api(`/walkthrough/${w.id}/reorder?${qexp()}`, { method: "POST", body: { stage: w.stage, direction: act === "move-up" ? "up" : "down", experience: clientExperience(), flag_flowstages: true } }));
        } else if (act === "add") {
          const label = await window.CC.ask("Step or stage name", "Custom check");
          if (!label) return;
          paintWalk(await api(`/walkthrough/${w.id}/add-stage?${qexp()}`, { method: "POST", body: { label, afterStage: w.stage, experience: clientExperience(), flag_flowstages: true } }));
        } else if (act === "remove") {
          paintWalk(await api(`/walkthrough/${w.id}/remove-stage?${qexp()}`, { method: "POST", body: { stage: w.stage, experience: clientExperience(), flag_flowstages: true } }));
        } else if (act === "pause") {
          paintWalk(await api(`/walkthrough/${w.id}/pause?${qexp()}`, { method: "POST", body: { experience: clientExperience(), flag_flowstages: true } }));
          toast("Project paused.");
        } else if (act === "resume") {
          paintWalk(await api(`/walkthrough/${w.id}/resume?${qexp()}`, { method: "POST", body: { experience: clientExperience(), flag_flowstages: true } }));
          toast("Project resumed.");
        } else if (act === "save") {
          paintWalk(await api(`/walkthrough/${w.id}/save?${qexp()}`, { method: "POST", body: { experience: clientExperience(), flag_flowstages: true } }));
          toast("Project saved.");
        }
      } catch (e) { toast(e.message, true); }
    });
  });
  root.querySelector("[data-stack-add]")?.addEventListener("click", async () => {
    const promptEl = root.querySelector("#sp-stack-input");
    const stageEl = root.querySelector("#sp-stack-stage");
    const text = String(promptEl?.value || "").trim();
    if (!text) { toast("Type a prompt for the stacked step.", true); return; }
    try {
      paintWalk(await api(`/walkthrough/${w.id}/stack?${qexp()}`, {
        method: "POST",
        body: { append: true, steps: [{ stage: stageEl?.value || w.stage, prompt: text }], experience: clientExperience(), flag_flowstages: true },
      }));
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("[data-stack-run]")?.addEventListener("click", async () => {
    try {
      paintWalk(await api(`/walkthrough/${w.id}/stack?${qexp()}`, {
        method: "POST",
        body: { append: true, steps: [], run: true, experience: clientExperience(), flag_flowstages: true },
      }));
    } catch (e) { toast(e.message, true); }
  });
}

function modeNote(w) {
  return w.experience === "expert"
    ? "Expert mode shows which AI was chosen and lets you edit the plan before it runs."
    : "Simple mode keeps the route in plain words. The same steps run either way.";
}

async function refreshWalk(id) {
  if (!document.getElementById("sp-root")) { stopPoll(); return; }
  try {
    const w = await api(`/walkthrough/${id}?${qexp()}`);
    if (w.status === "building" || w.status === "planning") {
      try { const lv = await api("/liveview"); liveLine = lv.flow?.summary || lv.step || ""; } catch { liveLine = ""; }
    }
    paintWalk(w);
    if (!["planning", "building", "revising"].includes(w.status)) stopPoll();
  } catch (e) { stopPoll(); toast(e.message, true); }
}

let wantExamples = false;
async function renderTab(view) {
  stopPoll();
  const examples = wantExamples;
  wantExamples = false;
  view.innerHTML = `<div class="sp-wrap" id="sp-root"><div class="empty">Loading…</div></div>`;
  if (pendingWalk) {
    const w = pendingWalk;
    pendingWalk = null;
    paintWalk(w);
    return;
  }
  try {
    const data = await api(`/walkthrough?${qexp()}`);
    if (examples) paintExamples(data);
    else paintPicker(data);
  } catch (e) {
    const root = document.getElementById("sp-root");
    if (root) root.innerHTML = `<div class="empty" role="alert">${esc(e.message)}</div>`;
  }
}

function paintPicker(data) {
  const root = document.getElementById("sp-root");
  if (!root) return;
  root.innerHTML = `
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <h3 style="margin:0">Start a project</h3>
      <span class="chip">${esc(data.modeLabel || "Simple")}</span>
      <button class="btn sm" type="button" id="sp-help" style="margin-left:auto">How this works</button>
    </div>
    <p class="small dim" style="margin:0">${esc(modeNote({ experience: data.experience }))} Pick a type, or watch a labeled example. An example does not call an AI.</p>
    <div id="sp-help-body"></div>
    <div class="sp-types">${(data.types || []).map((t) => `
      <div class="sp-type" style="border-top:3px solid ${esc(t.color || "#22d3ee")}">
        <h4>${esc(t.name)}</h4>
        <div class="small dim">${esc(t.blurb || "")}</div>
        <div class="sp-actions" style="margin-top:8px">
          <button class="btn sm primary" type="button" data-start="${esc(t.id)}">Start</button>
          <button class="btn sm" type="button" data-example="${esc(t.id)}">Watch an example</button>
        </div>
      </div>`).join("")}</div>
    ${(data.walks || []).length ? `<div class="panel"><h3>Your projects</h3>${data.walks.slice(0, 8).map((w) => `<button class="btn sm" type="button" data-open="${esc(w.id)}" style="margin:0 6px 6px 0">${esc(w.typeName)}: ${esc(w.plan?.title || w.idea || "In progress")}</button>`).join("")}</div>` : ""}`;
  root.querySelector("#sp-help").addEventListener("click", toggleHelp);
  root.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => begin(b.dataset.start)));
  root.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => watchExample(b.dataset.example)));
  root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openWalk(b.dataset.open)));
}

function paintExamples(data) {
  const root = document.getElementById("sp-root");
  if (!root) return;
  root.innerHTML = `
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <h3 style="margin:0">Watch example projects</h3>
      <span class="chip">Example data</span>
      <button class="btn sm" type="button" id="sp-all" style="margin-left:auto">Start a project</button>
    </div>
    <div class="sp-banner" role="note">Example data. Replay any sample, or reopen one of your projects. A sample does not call an AI and cannot be edited.</div>
    <div class="sp-types">${(data.types || []).map((t) => `
      <div class="sp-type" style="border-top:3px solid ${esc(t.color || "#22d3ee")}">
        <h4>${esc(t.name)}</h4>
        <div class="small dim">${esc(t.blurb || "")}</div>
        <div class="sp-actions" style="margin-top:8px">
          <button class="btn sm primary" type="button" data-example="${esc(t.id)}">Watch an example</button>
        </div>
      </div>`).join("")}</div>
    ${(data.walks || []).length ? `<div class="panel"><h3>Your projects</h3><p class="small dim">Open one to continue it. This is your work, not example data.</p>${data.walks.slice(0, 8).map((w) => `<button class="btn sm" type="button" data-open="${esc(w.id)}" style="margin:0 6px 6px 0">${esc(w.typeName)}: ${esc(w.plan?.title || w.idea || "In progress")}</button>`).join("")}</div>` : ""}`;
  root.querySelector("#sp-all").addEventListener("click", () => paintPicker(data));
  root.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => watchExample(b.dataset.example)));
  root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openWalk(b.dataset.open)));
}

async function toggleHelp() {
  const box = document.getElementById("sp-help-body");
  if (!box) return;
  if (box.dataset.open === "1") { box.innerHTML = ""; box.dataset.open = ""; return; }
  box.dataset.open = "1";
  box.innerHTML = `<div class="empty">Loading help…</div>`;
  const fallback = "Describe the idea, answer the questions, then ask the council for a plan. Nothing runs until you click Build it. Watch an example uses labeled example data and does not call an AI.";
  const showFallback = () => {
    box.innerHTML = `<div class="panel"><h3>How this works</h3><p>${esc(fallback)}</p></div>`;
  };
  try {
    const pack = await api("/help");
    const articles = pack.articles || [];
    const doc = articles.find((a) => a.id === "start-a-project")
      || articles.find((a) => String(a.id || "").startsWith("start-"))
      || null;
    if (!doc) { showFallback(); return; }
    box.innerHTML = `<div class="panel"><h3>${esc(doc.title)}</h3><div class="md">${md(doc.body || doc.markdown || "")}</div></div>`;
  } catch { showFallback(); }
}

let pendingWalk = null;
async function begin(type) {
  try {
    const w = await api(`/walkthrough?${qexp()}`, { method: "POST", body: { type, experience: clientExperience() } });
    pendingWalk = w;
    if (document.getElementById("sp-root") && window.CC.S.view === "start") paintWalk(w);
    else go("start");
  } catch (e) { toast(e.message, true); }
}
// Chat asked for a website or another project: make the project, save the idea, and show the questions.
let fromChat = "";
async function startFromChat(type, idea) {
  const w = await api(`/walkthrough?${qexp()}`, { method: "POST", body: { type, experience: clientExperience() } });
  const next = await api(`/walkthrough/${w.id}/idea?${qexp()}`, { method: "POST", body: { idea, experience: clientExperience() } });
  fromChat = idea;
  pendingWalk = next;
  if (document.getElementById("sp-root") && window.CC.S.view === "start") paintWalk(next);
  else go("start");
  return next;
}
async function openWalk(id) {
  try { paintWalk(await api(`/walkthrough/${id}?${qexp()}`)); }
  catch (e) { toast(e.message, true); }
}

function paintWalk(w) {
  const root = document.getElementById("sp-root");
  if (!root) return;
  const busy = ["planning", "building", "revising"].includes(w.status);
  if (busy) startPoll(w.id);
  const expert = w.experience === "expert";
  root.innerHTML = `
    <div class="sp-actions">
      <button class="btn sm" type="button" id="sp-back">All project types</button>
      <b>${esc(w.typeName)}</b>
      <span class="chip">${esc(w.modeLabel)}</span>
      ${w.paused || w.status === "paused" ? `<span class="chip amber">Paused</span>` : ""}
      ${w.example ? `<span class="chip amber">Example data</span>` : ""}
    </div>
    ${rail(w)}
    ${flowControlsHtml(w)}
    <p class="small dim" style="margin:0">${esc(modeNote(w))}</p>
    ${w.error ? `<div class="sp-banner" role="alert">${esc(w.error)}</div>` : ""}
    ${w.projectNote ? `<div class="small dim">${esc(w.projectNote)}</div>` : ""}
    <div id="sp-stage"></div>`;
  root.querySelector("#sp-back").addEventListener("click", () => renderTab(root.parentElement));
  wireFlowControls(root, w);
  const stage = root.querySelector("#sp-stage");
  if (fromChat) {
    const prompt = fromChat;
    fromChat = "";
    const note = document.createElement("div");
    note.className = "sp-banner";
    note.setAttribute("role", "note");
    note.innerHTML = `<span>Chat started these project steps for you. Nothing is built or sent until you click.</span> <button class="btn sm" type="button" id="sp-chat-instead">Answer in chat instead</button>`;
    stage.before(note);
    note.querySelector("#sp-chat-instead").addEventListener("click", () => {
      window.CC.S.skipProjectStart = true;
      go("command");
      setTimeout(() => { const box = document.getElementById("orders"); if (box) { box.value = prompt; box.focus(); } toast("Press Send to ask in chat."); }, 250);
    });
  }
  if (w.status === "planning") paintWait(stage, "The council is building the plan.");
  else if (w.status === "revising") paintReview(stage, w, true);
  else if (w.stage === "idea") paintIdea(stage, w);
  else if (w.stage === "questions") paintQuestions(stage, w);
  else if (w.stage === "plan") paintPlan(stage, w, expert);
  else if (w.stage === "build") paintBuild(stage, w, expert);
  else if (w.stage === "review") paintReview(stage, w, busy);
  else if (w.stage === "done") paintDone(stage, w);
  else paintIdea(stage, w);
}

function paintIdea(stage, w) {
  stage.innerHTML = `<label class="lbl" for="sp-idea">Describe the idea</label>
    <textarea id="sp-idea" rows="5" placeholder="A sentence or two is enough.">${esc(w.idea || "")}</textarea>
    <div class="sp-actions" style="margin-top:8px"><button class="btn sm primary" type="button" id="sp-idea-go">Continue</button></div>
    <div id="sp-build-all" style="margin-top:10px"></div>`;
  // Build it all for me: idea, questions, plan, build and test in one go.
  import("/build-all-ui.js").then(({ mountBuildAll }) => mountBuildAll(stage.querySelector("#sp-build-all"), {
    surface: "start",
    payload: () => ({ walkId: w.id, type: w.type, idea: stage.querySelector("#sp-idea").value, experience: clientExperience() }),
    onEnd: () => openWalk(w.id),
  })).catch(() => { /* the step by step buttons still work */ });
  stage.querySelector("#sp-idea-go").addEventListener("click", async () => {
    try { paintWalk(await api(`/walkthrough/${w.id}/idea?${qexp()}`, { method: "POST", body: { idea: stage.querySelector("#sp-idea").value, experience: clientExperience() } })); }
    catch (e) { toast(e.message, true); }
  });
}
function paintQuestions(stage, w) {
  stage.innerHTML = `<p class="small" style="margin-top:0">A few questions. Ones marked optional can stay blank. Empty facts stay empty. Nothing is invented to fill them.</p>
    ${(w.questions || []).map((q) => `<label class="lbl" for="sp-q-${esc(q.key)}">${esc(q.label)}${q.required ? "" : " (optional)"}</label>
      <input id="sp-q-${esc(q.key)}" type="text" data-q="${esc(q.key)}" value="${esc(w.answers?.[q.key] || "")}" placeholder="${esc(q.placeholder || "")}">`).join("")}
    <div class="sp-actions" style="margin-top:8px"><button class="btn sm primary" type="button" id="sp-q-go">Continue</button></div>`;
  stage.querySelector("#sp-q-go").addEventListener("click", async () => {
    const answers = {};
    stage.querySelectorAll("[data-q]").forEach((el) => { answers[el.dataset.q] = el.value; });
    try { paintWalk(await api(`/walkthrough/${w.id}/answers?${qexp()}`, { method: "POST", body: { answers, experience: clientExperience() } })); }
    catch (e) { toast(e.message, true); }
  });
  if (w.answers && Object.keys(w.answers).length) {
    const go = document.createElement("button");
    go.className = "btn sm primary";
    go.type = "button";
    go.textContent = "Ask the council for a plan";
    go.addEventListener("click", () => askPlan(w.id));
    stage.querySelector(".sp-actions").appendChild(go);
  }
}
async function askPlan(id) {
  try {
    const w = await api(`/walkthrough/${id}/plan?${qexp()}`, { method: "POST", body: { experience: clientExperience() } });
    paintWalk(w);
  } catch (e) { toast(e.message, true); }
}
function paintWait(stage, text) {
  stage.innerHTML = `<div class="empty" role="status">${esc(text)}</div>`;
}
function paintPlan(stage, w, expert) {
  const steps = w.plan?.steps || [];
  stage.innerHTML = `<h3 style="margin:0 0 6px">${esc(w.plan?.title || "Plan")}</h3>
    ${w.plan?.source === "template" ? `<p class="small dim">The council's notes did not come back as a step list, so a starter plan was used.</p>` : `<p class="small dim">The council built this plan. Nothing runs until you click Build.</p>`}
    ${steps.map((s, i) => `<div class="sp-step">
      <b>${i + 1}. ${esc(s.title)}</b>
      <div class="small dim">${expert ? `${esc(s.agentName || "unassigned")} · ${esc(s.capability || "")}${s.model ? ` · ${esc(s.model)}` : ""}` : esc(s.routedTo || "the best AI for this step")}</div>
      ${expert ? `<label class="lbl" for="sp-title-${esc(s.id)}">Title</label><input id="sp-title-${esc(s.id)}" type="text" data-title="${esc(s.id)}" value="${esc(s.title)}">
        <label class="lbl" for="sp-ins-${esc(s.id)}">Instructions</label><textarea id="sp-ins-${esc(s.id)}" rows="2" data-ins="${esc(s.id)}">${esc(s.instructions || "")}</textarea>` : `<div class="small">${esc(s.deliverable || "")}</div>`}
    </div>`).join("")}
    <div class="sp-actions"><button class="btn sm primary" type="button" id="sp-build">Build it</button></div>
    <p class="small dim">API chats do not appear in claude.ai, grok.com or ChatGPT history. Watch the work here, or open Live.</p>`;
  stage.querySelector("#sp-build").addEventListener("click", async () => {
    try {
      if (expert) {
        const edits = steps.map((s) => ({
          id: s.id,
          title: stage.querySelector(`[data-title="${s.id}"]`)?.value,
          instructions: stage.querySelector(`[data-ins="${s.id}"]`)?.value,
        }));
        await api(`/walkthrough/${w.id}/steps?${qexp()}`, { method: "POST", body: { steps: edits, experience: "expert" } });
      }
      const next = await api(`/walkthrough/${w.id}/build?${qexp()}`, { method: "POST", body: { experience: clientExperience(), priority: expert ? "balanced" : "balanced" } });
      liveLine = "";
      paintWalk(next);
    } catch (e) { toast(e.message, true); }
  });
}
function paintBuild(stage, w, expert) {
  const steps = w.plan?.steps || [];
  stage.innerHTML = `<div role="status"><b>${w.status === "failed" ? "The build stopped." : w.status === "paused" ? "The build is paused." : "Building each step."}</b>
      <div class="small dim">${esc(liveLine || "Progress shows on the live view and the flow map.")}</div></div>
    ${steps.map((s) => `<div class="sp-step"><b>${esc(s.title)}</b> <span class="chip">${esc(s.status || "queued")}</span>
      <div class="small dim">${expert ? esc(s.agentName || s.routedTo || "") : esc(s.routedTo || "")}</div>
      ${s.output ? `<div class="md small">${md(s.output)}</div>` : ""}</div>`).join("")}
    <div class="sp-actions">
      <button class="btn sm" type="button" id="sp-live">Open live view</button>
      ${w.status === "failed" ? `<button class="btn sm primary" type="button" id="sp-retry">Try the build again</button>` : ""}
    </div>
    <p class="small dim">API chats do not appear in claude.ai, grok.com or ChatGPT history. Watch the work here.</p>`;
  stage.querySelector("#sp-live").addEventListener("click", () => go("liveview"));
  stepTools(stage, w);
  stage.querySelector("#sp-retry")?.addEventListener("click", async () => {
    try { paintWalk(await api(`/walkthrough/${w.id}/build?${qexp()}`, { method: "POST", body: { experience: clientExperience() } })); }
    catch (e) { toast(e.message, true); }
  });
}
function paintReview(stage, w, busy) {
  stage.innerHTML = `<h3 style="margin:0 0 6px">Review</h3>
    <div class="md">${md(w.deliverable || "The deliverable is not ready yet.")}</div>
    ${(w.revisions || []).length ? `<p class="small dim">${w.revisions.length} revision${w.revisions.length === 1 ? "" : "s"} so far.</p>` : ""}
    <label class="lbl" for="sp-note">What should change?</label>
    <textarea id="sp-note" rows="3" placeholder="Say what to change. Nothing is sent." ${busy ? "disabled" : ""}></textarea>
    <div class="sp-actions" style="margin-top:8px">
      <button class="btn sm" type="button" id="sp-rev" ${busy ? "disabled" : ""}>${busy ? "Revising…" : "Revise"}</button>
      <button class="btn sm" type="button" id="sp-exp">Export</button>
      <button class="btn sm" type="button" id="sp-exp-zip">Export as a zip</button>
      <button class="btn sm" type="button" id="sp-chat">Share in chat</button>
      <button class="btn sm primary" type="button" id="sp-fin" ${busy ? "disabled" : ""}>${window.CC.S?.flags?.finishpath ? "Looks good, Finish" : "Finish"}</button>
      ${window.CC.S?.flags?.finishpath ? `<button class="btn sm" type="button" id="sp-edit-further" ${busy ? "disabled" : ""}>Edit further</button>` : ""}
      <button class="btn sm" type="button" id="sp-live">Open live view</button>
    </div>`;
  stage.querySelector("#sp-rev").addEventListener("click", async () => {
    const note = stage.querySelector("#sp-note").value;
    try { paintWalk(await api(`/walkthrough/${w.id}/revise?${qexp()}`, { method: "POST", body: { note, experience: clientExperience() } })); }
    catch (e) { toast(e.message, true); }
  });
  stage.querySelector("#sp-exp").addEventListener("click", () => downloadWalk(w.id));
  stage.querySelector("#sp-exp-zip").addEventListener("click", () => downloadWalk(w.id, "zip"));
  stage.querySelector("#sp-chat")?.addEventListener("click", () => {
    window.CC.shareInChat?.({
      kind: "mission",
      id: w.id,
      title: w.plan?.title || "A project",
      text: String(w.deliverable || "").replace(/\s+/g, " ").slice(0, 280),
    });
  });
  stage.querySelector("#sp-fin").addEventListener("click", async () => {
    try { paintWalk(await api(`/walkthrough/${w.id}/finish?${qexp()}`, { method: "POST", body: { experience: clientExperience() } })); }
    catch (e) { toast(e.message, true); }
  });
  stage.querySelector("#sp-live").addEventListener("click", () => go("liveview"));
  stage.querySelector("#sp-edit-further")?.addEventListener("click", () => { const n = stage.querySelector("#sp-note"); n.focus(); n.scrollIntoView({ behavior: "smooth", block: "center" }); });
  stepTools(stage, w);
}
// Undo last step and Branch from here (flag_finishpath). Loaded only when the flag is on.
function stepTools(stage, w) {
  if (!window.CC.S?.flags?.finishpath) return;
  import("../finishpath-ui.js").then((m) => m.mountStepTools(stage, w, paintWalk)).catch(() => {});
}
function paintDone(stage, w) {
  stage.innerHTML = `<h3 style="margin:0 0 6px">${esc(w.plan?.title || "Deliverable")}</h3>
    <div class="md" id="sp-done-view">${md(w.deliverable || "")}</div>
    <details id="sp-done-edit" style="margin-top:10px"><summary>Edit this project</summary>
      <label class="lbl" for="sp-done-text">Edit the text yourself</label>
      <textarea id="sp-done-text" rows="12" style="width:100%">${esc(w.deliverable || "")}</textarea>
      <div class="sp-actions" style="margin-top:6px"><button class="btn sm primary" type="button" id="sp-done-save">Save my edit</button></div>
      <label class="lbl" for="sp-done-note" style="margin-top:10px">Or ask the AI for a change</label>
      <textarea id="sp-done-note" rows="2" placeholder="Say what to change. Nothing is sent."></textarea>
      <div class="sp-actions" style="margin-top:6px"><button class="btn sm" type="button" id="sp-done-rev">Revise with AI</button></div>
    </details>
    <h4>Next steps</h4>
    <ul>${(w.nextSteps || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    <div class="sp-actions">
      <button class="btn sm primary" type="button" id="sp-exp-zip">Export as a zip</button>
      <button class="btn sm" type="button" id="sp-exp">Export as text</button>
      <button class="btn sm" type="button" id="sp-live">Open live view</button>
    </div>
    <p class="small dim">The file stays on this computer until you move it. Nothing is posted or emailed.</p>`;
  stage.querySelector("#sp-exp").addEventListener("click", () => downloadWalk(w.id));
  stage.querySelector("#sp-exp-zip").addEventListener("click", () => downloadWalk(w.id, "zip"));
  stage.querySelector("#sp-live").addEventListener("click", () => go("liveview"));
  stage.querySelector("#sp-done-save").addEventListener("click", async () => {
    try {
      paintWalk(await api(`/walkthrough/${w.id}/edit?${qexp()}`, { method: "POST", body: { deliverable: stage.querySelector("#sp-done-text").value, experience: clientExperience() } }));
      toast("Saved your edit.");
    } catch (e) { toast(e.message, true); }
  });
  stage.querySelector("#sp-done-rev").addEventListener("click", async () => {
    const note = stage.querySelector("#sp-done-note").value;
    try { paintWalk(await api(`/walkthrough/${w.id}/revise?${qexp()}`, { method: "POST", body: { note, experience: clientExperience() } })); }
    catch (e) { toast(e.message, true); }
  });
}
async function downloadWalk(id, format) {
  try {
    const file = await api(`/walkthrough/${id}/export?${qexp()}${format === "zip" ? "&format=zip" : ""}`);
    if (file.zipBase64) {
      const bin = atob(file.zipBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      downloadBlob(file.filename || "project.zip", new Blob([bytes], { type: "application/zip" }));
    } else download(file.filename || "project.md", file.markdown || "");
    toast("Exported. Nothing was sent.");
  } catch (e) { toast(e.message, true); }
}
function download(filename, markdown) { downloadBlob(filename, new Blob([markdown], { type: "text/markdown" })); }
function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

let exampleTimer = null;
async function watchExample(type) {
  stopPoll();
  if (exampleTimer) clearInterval(exampleTimer);
  const root = document.getElementById("sp-root");
  if (!root) return;
  root.innerHTML = `<div class="empty">Loading the example…</div>`;
  try {
    const view = await api(`/walkthrough/example/${type}?${qexp()}`);
    await api(`/walkthrough/example/${type}/play?${qexp()}`, { method: "POST", body: { experience: clientExperience() } });
    let at = 0;
    const frames = exampleFrames(view);
    const draw = () => {
      const box = document.getElementById("sp-root");
      if (!box) { clearInterval(exampleTimer); return; }
      const frame = frames[at];
      box.innerHTML = `
        <div class="sp-banner" role="note">${esc(view.disclaimer || "Example data.")}</div>
        <div class="sp-actions">
          <button class="btn sm" type="button" id="sp-ex-back">All project types</button>
          <b>${esc(view.typeName)}</b>
          <span class="chip">Example data</span>
          <span class="chip">${esc(view.modeLabel)}</span>
        </div>
        ${rail({ ...view, stage: frame.stage })}
        <h3 style="margin:0">${esc(frame.title)}</h3>
        <div class="md">${md(frame.body)}</div>
        <div class="sp-actions">
          <button class="btn sm" type="button" id="sp-ex-prev" ${at === 0 ? "disabled" : ""}>Back</button>
          <button class="btn sm" type="button" id="sp-ex-next" ${at === frames.length - 1 ? "disabled" : ""}>Next</button>
          <button class="btn sm" type="button" id="sp-ex-pause">Pause</button>
          <button class="btn sm" type="button" id="sp-ex-live">Open live view</button>
          <button class="btn sm" type="button" id="sp-ex-save">Download example</button>
        </div>
        <p class="small dim">Read-only. You cannot edit this sample or turn it into your project. Start a project to make a real one. The live view is playing the same example.</p>`;
      box.querySelector("#sp-ex-back").addEventListener("click", async () => {
        clearInterval(exampleTimer);
        paintPicker(await api(`/walkthrough?${qexp()}`));
      });
      box.querySelector("#sp-ex-prev").addEventListener("click", () => { at = Math.max(0, at - 1); draw(); });
      box.querySelector("#sp-ex-next").addEventListener("click", () => { at = Math.min(frames.length - 1, at + 1); draw(); });
      box.querySelector("#sp-ex-pause").addEventListener("click", () => { clearInterval(exampleTimer); exampleTimer = null; toast("Example paused"); });
      box.querySelector("#sp-ex-live").addEventListener("click", () => go("liveview"));
      box.querySelector("#sp-ex-save").addEventListener("click", () => { download(`example-${view.type}.md`, view.markdown || ""); toast("Example file saved. Nothing was sent."); });
    };
    draw();
    exampleTimer = setInterval(() => {
      if (at >= frames.length - 1) { clearInterval(exampleTimer); exampleTimer = null; return; }
      at += 1;
      draw();
    }, 2400);
  } catch (e) {
    root.innerHTML = `<div class="empty" role="alert">${esc(e.message)}</div>`;
  }
}
function exampleFrames(view) {
  const answers = (view.questions || []).filter((q) => view.answers?.[q.key]).map((q) => `- ${q.label}: ${view.answers[q.key]}`).join("\n");
  const plan = (view.plan?.steps || []).map((s, i) => `${i + 1}. ${s.title} (${s.routedTo || "example"})`).join("\n");
  const built = (view.plan?.steps || []).map((s) => `## ${s.title}\n\n${s.output || ""}`).join("\n\n");
  return [
    { stage: "idea", title: "The idea", body: view.idea || "" },
    { stage: "questions", title: "Clarifying answers", body: answers || "No answers in this sample." },
    { stage: "plan", title: view.plan?.title || "The plan", body: plan },
    { stage: "build", title: "Each step", body: built },
    { stage: "review", title: "The deliverable", body: view.deliverable || "" },
    { stage: "done", title: "Next steps", body: (view.nextSteps || []).map((n) => `- ${n}`).join("\n") },
  ];
}

window.CC.register({
  id: "start",
  tab: { label: "Start a project", short: "Start", icon: "✦", order: 4, render: renderTab },
  command: { order: 0, render: renderHome },
});
window.CC.startProject = {
  experience: clientExperience,
  open: () => { wantExamples = false; go("start"); },
  examples: () => { wantExamples = true; go("start"); },
  begin,
  startFromChat,
};
