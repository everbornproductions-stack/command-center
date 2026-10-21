// Start a project. The home card and the Work menu open the same wizard.
// Simple is the default. Expert is read from the Simple/Expert work when that
// setting exists (CC.experience, settings.experience, settings.uiMode). This
// file does not own the mode switch.
const { api, toast, esc, md, go } = window.CC;

const css = `
.sp-wrap { display: flex; flex-direction: column; gap: 14px; max-width: 920px; }
.sp-home { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: #0e1726; }
.sp-types { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.sp-type { text-align: left; background: #0e1726; border: 1px solid var(--line); border-radius: 12px; padding: 12px; color: var(--text); cursor: pointer; }
.sp-type:hover, .sp-type:focus { border-color: var(--accent); outline: none; }
.sp-type h4 { margin: 0 0 4px; font-size: 15px; }
.sp-rail { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-rail span { font-size: 12px; color: var(--dim); padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); }
.sp-rail span.on { color: var(--text); border-color: var(--accent); }
.sp-rail span.done { color: var(--muted); }
.sp-banner { padding: 8px 10px; border-radius: 10px; background: #3a2a12; border: 1px solid #a16207; color: #fde68a; }
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
const qexp = () => `experience=${encodeURIComponent(clientExperience())}`;
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
  const at = (w.stages || []).findIndex((s) => s.id === w.stage);
  return `<div class="sp-rail" aria-label="Steps">${(w.stages || []).map((s, i) => `<span class="${i === at ? "on" : i < at ? "done" : ""}">${esc(s.label)}</span>`).join("")}</div>`;
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
      ${w.example ? `<span class="chip amber">Example data</span>` : ""}
    </div>
    ${rail(w)}
    <p class="small dim" style="margin:0">${esc(modeNote(w))}</p>
    ${w.error ? `<div class="sp-banner" role="alert">${esc(w.error)}</div>` : ""}
    ${w.projectNote ? `<div class="small dim">${esc(w.projectNote)}</div>` : ""}
    <div id="sp-stage"></div>`;
  root.querySelector("#sp-back").addEventListener("click", () => renderTab(root.parentElement));
  const stage = root.querySelector("#sp-stage");
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
    <div class="sp-actions" style="margin-top:8px"><button class="btn sm primary" type="button" id="sp-idea-go">Continue</button></div>`;
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
  stage.innerHTML = `<div role="status"><b>${w.status === "failed" ? "The build stopped." : "Building each step."}</b>
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
      <button class="btn sm" type="button" id="sp-chat">Share in chat</button>
      <button class="btn sm primary" type="button" id="sp-fin" ${busy ? "disabled" : ""}>Finish</button>
      <button class="btn sm" type="button" id="sp-live">Open live view</button>
    </div>`;
  stage.querySelector("#sp-rev").addEventListener("click", async () => {
    const note = stage.querySelector("#sp-note").value;
    try { paintWalk(await api(`/walkthrough/${w.id}/revise?${qexp()}`, { method: "POST", body: { note, experience: clientExperience() } })); }
    catch (e) { toast(e.message, true); }
  });
  stage.querySelector("#sp-exp").addEventListener("click", () => downloadWalk(w.id));
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
}
function paintDone(stage, w) {
  stage.innerHTML = `<h3 style="margin:0 0 6px">${esc(w.plan?.title || "Deliverable")}</h3>
    <div class="md">${md(w.deliverable || "")}</div>
    <h4>Next steps</h4>
    <ul>${(w.nextSteps || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    <div class="sp-actions">
      <button class="btn sm primary" type="button" id="sp-exp">Export</button>
      <button class="btn sm" type="button" id="sp-live">Open live view</button>
    </div>
    <p class="small dim">The file stays on this computer until you move it. Nothing is posted or emailed.</p>`;
  stage.querySelector("#sp-exp").addEventListener("click", () => downloadWalk(w.id));
  stage.querySelector("#sp-live").addEventListener("click", () => go("liveview"));
}
async function downloadWalk(id) {
  try {
    const file = await api(`/walkthrough/${id}/export?${qexp()}`);
    download(file.filename || "project.md", file.markdown || "");
    toast("Exported. Nothing was sent.");
  } catch (e) { toast(e.message, true); }
}
function download(filename, markdown) {
  const blob = new Blob([markdown], { type: "text/markdown" });
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
};
