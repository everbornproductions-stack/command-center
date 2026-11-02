// 0.4.39 (Chris, 2026-11-02: "We need to incorporate the agents a bit more... if someone selects an agent what happens?
// In the agent area shouldn't there be a way to see what agent is doing what for them and handling things they have
// assigned?"). The Agents page is the Team page (approved mockup: meldmind-dogfood/mockups/team-agents-0439.png):
//   - left: "Your team" with a live status per agent (Working, Needs your OK with a count, Free, Done) and a strip with
//     the counts (working, need your OK, done today)
//   - right: the selected agent's desk: a one-line "Tell <agent> what to do next" box with Assign, Chat with it,
//     + Give a task; Assigned (Review, Watch, Edit / Cancel, Try again); Done lately; Duties (schedules for this agent);
//     How it works for you
//   - the tabs Hire an agent, My agents and Prompts keep the old page's parts (web/features/agents.js draws them)
// A task is a normal run (server/plugins/team.js). Review shows the result with Approve (copy or save, never send),
// Ask for changes and Dismiss. Nothing is sent, posted or bought without the person's click.
// Also here: "Give to an agent" under a chat answer, the agent picker used by a project's steps, and the
// "Chatting with" line on the Expert chat page. Styles: /team.css.
const CC = window.CC;
const { api, toast, esc, md } = CC;
const S = () => CC.S;

if (!document.getElementById("team-css")) {
  const l = document.createElement("link");
  l.id = "team-css"; l.rel = "stylesheet"; l.href = "/team.css";
  document.head.appendChild(l);
}

const TABS = [["team", "Team"], ["hire", "Hire an agent"], ["mine", "My agents"], ["prompts", "Prompts"]];
const st = { data: null, sel: "", section: "team", helpers: null, seeAll: false, dutyOpen: false, loading: null, reloadT: 0, view: null };
const currentProject = () => document.getElementById("proj")?.value || S().project || null;
const money = (v) => { const n = Number(v || 0); return n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`; };
const ago = (ts) => { if (!ts) return ""; const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; const d = Math.round(s / 86400); return d === 1 ? "yesterday" : `${d} days ago`; };
const whenText = (ts) => { const d = new Date(ts); const today = new Date(); const tmr = new Date(Date.now() + 86400000); const hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); if (d.toDateString() === today.toDateString()) return `today ${hm}`; if (d.toDateString() === tmr.toDateString()) return `tomorrow ${hm}`; return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${hm}`; };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------- data ----------
async function load() {
  const pid = currentProject();
  const job = api(`/team${pid ? `?projectId=${encodeURIComponent(pid)}` : ""}`).then((d) => { st.data = d; return d; });
  st.loading = job;
  try { await job; } catch (e) { toast(e.message, true); st.data = st.data || { agents: [], tasks: [], duties: [], counts: { working: 0, review: 0, doneToday: 0 }, memory: [] }; }
  finally { if (st.loading === job) st.loading = null; }
  return st.data;
}
const agents = () => st.data?.agents || [];
const agentOf = (id) => agents().find((a) => a.id === id) || null;
const tasksOf = (id) => (st.data?.tasks || []).filter((t) => t.agentId === id);
const onPage = () => !!document.querySelector("#tm-page") && S().view === "agents";

// A live event or a click asks for a fresh copy; several in a row become one.
function reload() {
  clearTimeout(st.reloadT);
  st.reloadT = setTimeout(async () => { if (!onPage() || st.section !== "team") return; await load(); paintTeam(); }, 250);
}

// ---------- the page ----------
export async function renderTeamPage(view, helpers) {
  st.helpers = helpers || st.helpers;
  st.view = view;
  const focus = String(S().navFocus || "");
  const fm = focus.match(/data-team-tab=['"]?(\w+)/);
  if (fm && TABS.some(([id]) => id === fm[1])) st.section = fm[1];
  if (S().openAgentCreate) st.section = "mine";
  if (S().teamSelect) { st.sel = S().teamSelect; st.section = "team"; S().teamSelect = ""; }
  view.innerHTML = `<div class="tm-page" id="tm-page" data-section="${esc(st.section)}">
    <div class="tm-tabs" role="tablist" aria-label="Team">${TABS.map(([id, label]) => `<button type="button" role="tab" class="tm-tab${st.section === id ? " on" : ""}" data-team-tab="${id}" aria-selected="${st.section === id}">${esc(label)}</button>`).join("")}</div>
    <div id="tm-body"></div></div>`;
  view.querySelectorAll("[data-team-tab]").forEach((b) => b.addEventListener("click", () => { st.section = b.dataset.teamTab; renderTeamPage(view); }));
  const body = view.querySelector("#tm-body");
  if (st.section !== "team") {
    body.innerHTML = `<div id="team-section" data-section="${esc(st.section)}"></div>`;
    await st.helpers?.renderSection(body.firstElementChild, st.section);
    return;
  }
  if (!st.data) body.innerHTML = `<div class="empty">Loading your team...</div>`;
  await load();
  if (!onPage()) return;
  paintTeam();
}

function paintTeam() {
  const body = document.querySelector("#tm-page #tm-body");
  if (!body || st.section !== "team") return;
  const list = agents();
  if (!st.sel || !agentOf(st.sel)) st.sel = (list.find((a) => a.status === "review") || list.find((a) => a.status === "working") || list[0])?.id || "";
  const c = st.data?.counts || {};
  const keep = document.activeElement?.id === "tm-tell-text" ? { v: document.activeElement.value, s: document.activeElement.selectionStart } : null;
  const draft = document.getElementById("tm-tell-text")?.value || "";
  body.innerHTML = `<div class="tm-wrap">
    <aside class="tm-list" aria-label="Your team">
      <div class="tm-today" id="tm-today">
        <div><b>${c.working || 0}</b><small>working</small></div>
        <div class="tm-need"><b>${c.review || 0}</b><small>need your OK</small></div>
        <div class="tm-done"><b>${c.doneToday || 0}</b><small>done today</small></div>
      </div>
      <div class="tm-th">Your team <button type="button" class="tm-link" data-team-tab-go="hire">+ Hire</button></div>
      <div class="tm-members" role="list">${list.map(memberHtml).join("") || `<div class="dim small tm-pad">No one on your team yet. Press + Hire.</div>`}</div>
    </aside>
    <section class="tm-desk" id="tm-desk" aria-live="polite">${deskHtml(agentOf(st.sel))}</section>
  </div>`;
  const tell = body.querySelector("#tm-tell-text");
  if (tell && draft) tell.value = draft;
  if (keep && tell) { tell.focus(); try { tell.setSelectionRange(keep.s, keep.s); } catch { /* fine */ } }
  wireTeam(body);
}

const memberHtml = (a) => `<button type="button" role="listitem" class="tm-mem${a.id === st.sel ? " on" : ""}" data-agent="${esc(a.id)}" aria-pressed="${a.id === st.sel}">
    <span class="tm-av" style="--tint:${esc(a.tint || "#eef2f6")}" aria-hidden="true">${a.icon || "🤖"}</span>
    <span class="tm-who"><b>${esc(a.name)}</b><small>${esc(a.role || "")}</small></span>
    ${a.kind === "outside" && !a.ready ? `<span class="tm-st tm-st-off" data-status="off">Set up</span>` : `<span class="tm-st tm-st-${esc(a.status)}" data-status="${esc(a.status)}">${esc(a.label)}</span>`}
  </button>`;

// ---------- one desk ----------
function exampleFor(a) {
  const s = (a.starters || [])[0];
  if (s) return s.length > 60 ? `${s.slice(0, 57)}...` : s;
  return a.kind === "outside" ? "Find the invoice from last week in Gmail" : "Write 5 posts for Valentine's week";
}
function taskLine(t) {
  const bits = [];
  if (t.status === "review") { bits.push("Ready for your OK"); if (t.finishedAt) bits.push(`finished ${ago(t.finishedAt)}`); if (t.source === "duty") bits.push("from a duty"); if (t.cost > 0) bits.push(money(t.cost)); }
  else if (t.status === "working") { bits.push("Working"); if (t.step) bits.push(t.step); if (t.ai) bits.push(t.ai); if (t.cost > 0) bits.push(money(t.cost)); }
  else if (t.status === "waiting") { bits.push("Waiting to start"); if (t.startAt) bits.push(`you set it for ${whenText(t.startAt)}`); else if (t.source === "duty") bits.push("a duty"); }
  else if (t.status === "failed") { bits.push(`Failed: ${t.error || "the run did not finish"}`); }
  return bits.join(" · ");
}
function taskButtons(t, a) {
  if (t.status === "review") return `<button type="button" class="btn sm primary" data-task-review="${esc(t.id)}">Review</button>`;
  if (t.status === "working") return t.runId && a?.kind !== "outside" ? `<button type="button" class="btn sm" data-task-watch="${esc(t.runId)}">Watch</button>` : (a?.kind === "outside" ? `<button type="button" class="btn sm" data-task-cancel="${esc(t.id)}">Stop</button>` : "");
  if (t.status === "waiting") return `<button type="button" class="btn sm" data-task-edit="${esc(t.id)}">Edit</button><button type="button" class="btn sm" data-task-cancel="${esc(t.id)}">Cancel</button>`;
  if (t.status === "failed") return `<button type="button" class="btn sm primary" data-task-retry="${esc(t.id)}">Try again</button><button type="button" class="btn sm" data-task-dismiss="${esc(t.id)}">Dismiss</button>`;
  return "";
}
const taskHtml = (t, a) => `<div class="tm-task" data-task="${esc(t.id)}" data-status="${esc(t.status)}">
    <span class="tm-dot tm-dot-${esc(t.status)}" aria-hidden="true"></span>
    <div class="tm-tx"><b>${esc(t.title)}</b><small>${esc(taskLine(t))}</small></div>
    <div class="tm-ta">${taskButtons(t, a)}</div></div>`;
const doneHtml = (t) => `<div class="tm-res" data-task="${esc(t.id)}" data-status="${esc(t.status)}"><b>${esc(t.title)}</b><span>${esc(t.outcomeLabel || t.statusLabel)} · ${esc(ago(t.approvedAt || t.finishedAt || t.updatedAt))}</span>${t.status === "done" ? `<button type="button" class="tm-link" data-task-review="${esc(t.id)}">Open</button>` : ""}</div>`;

function dutiesHtml(a) {
  if (!a.canDuty) return `<div class="small dim">${esc(a.name)} takes tasks one at a time. Duties are for your AI employees and your own agents.</div>`;
  const list = (st.data?.duties || []).filter((d) => d.agentId === a.id);
  const rows = list.map((d) => `<div class="tm-duty" data-duty="${esc(d.id)}"><span class="tm-duty-name">${d.enabled ? "🔁" : "⏸"} ${esc(d.text || d.name)}</span><small>${esc(d.when.replace(/^every/, "Every"))}${d.enabled ? "" : d.pausedReason === "cap" ? ", paused: cap reached" : ", paused"}</small>
      <span class="tm-duty-acts"><button type="button" class="tm-link" data-duty-${d.enabled ? "pause" : "resume"}="${esc(d.id)}">${d.enabled ? "Pause" : "Resume"}</button><button type="button" class="tm-link" data-duty-del="${esc(d.id)}">Delete</button></span></div>`).join("");
  const form = st.dutyOpen ? `<form class="tm-duty-form" id="tm-duty-form">
      <label class="small">What to do each time <input type="text" id="td-text" maxlength="300" placeholder="Draft next week's 5 posts" required></label>
      <div class="tm-row">
        <label class="small">How often <select id="td-every"><option value="day">Every day</option><option value="week" selected>Every week</option><option value="month">Every month</option></select></label>
        <label class="small" id="td-day-wrap">On <select id="td-day">${DAY_NAMES.map((n, i) => `<option value="${i}" ${i === 1 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="small">At <input type="time" id="td-time" value="09:00"></label>
        <label class="small">Monthly cap ($) <input type="number" id="td-cap" min="0.01" step="0.01" value="1" style="width:80px"></label>
      </div>
      <div class="tm-row"><button type="submit" class="btn sm primary" id="td-add">Add duty</button><button type="button" class="btn sm" id="td-cancel">Cancel</button></div>
      <div class="small dim">It runs while Meldmind is open. The result lands on this desk, and nothing is sent or posted.</div>
    </form>` : "";
  return `${rows || (st.dutyOpen ? "" : `<div class="small dim">No duties yet. Press + Add for a job ${esc(a.name)} does on its own, every day, week or month.</div>`)}${form}`;
}

function howHtml(a) {
  const mem = st.data?.memory || [];
  const pid = currentProject();
  const pname = (S().projects || []).find((p) => p.id === pid)?.name || "this project";
  const items = [`<li>${esc(a.job || a.role || "")}</li>`];
  if (a.kind !== "outside") {
    items.push(mem.length ? `<li>Uses ${esc(pname)}'s project memory: ${esc(mem.join(", ").toLowerCase())}</li>` : pid ? `<li>${esc(pname)} has no project memory yet. Add your brand voice in Settings, Project memory.</li>` : `<li>Pick a project at the top to use its memory (brand voice, offers).</li>`);
    items.push(`<li>Spends up to ${money(a.cap)} a task, from your own AI accounts <button type="button" class="tm-link" id="tm-cap">Change</button></li>`);
  }
  items.push(`<li>${esc(st.data?.neverSends || "Never posts or sends: everything waits for your OK")}</li>`);
  return `<ul class="tm-how">${items.join("")}</ul>`;
}

function deskHtml(a) {
  if (!a) return `<div class="empty">Pick someone on your team, or press + Hire.</div>`;
  const mine = tasksOf(a.id);
  const open = mine.filter((t) => ["review", "working", "waiting", "failed"].includes(t.status));
  const order = { review: 0, failed: 1, working: 2, waiting: 3 };
  open.sort((x, y) => order[x.status] - order[y.status] || y.updatedAt - x.updatedAt);
  const done = mine.filter((t) => t.status === "done" || t.status === "dismissed");
  const shown = st.seeAll ? done.slice(0, 50) : done.slice(0, 3);
  const blocked = a.kind === "outside" && !a.ready;
  return `<div class="tm-dh">
      <span class="tm-av tm-av-big" style="--tint:${esc(a.tint || "#eef2f6")}" aria-hidden="true">${a.icon || "🤖"}</span>
      <div class="tm-dh-t"><h2 id="tm-desk-name">${esc(a.name)}</h2><p>${esc(a.job || a.role || "")}</p></div>
      <div class="tm-dh-acts">${a.kind === "outside" ? "" : `<button type="button" class="btn" id="tm-chat">💬 Chat with it</button>`}<button type="button" class="btn primary" id="tm-give" ${blocked ? "disabled" : ""}>+ Give a task</button></div>
    </div>
    ${blocked ? `<div class="tm-note" role="note">${esc(a.readyNote || `${a.name} is not set up yet.`)} <button type="button" class="btn sm" id="tm-setup">Set it up</button></div>` : ""}
    <form class="tm-tell" id="tm-tell" autocomplete="off">
      <input type="text" id="tm-tell-text" maxlength="2000" aria-label="Tell ${esc(a.name)} what to do next" placeholder="Tell ${esc(a.name)} what to do next, e.g. &quot;${esc(exampleFor(a))}&quot;" ${blocked ? "disabled" : ""}>
      <button type="submit" class="btn primary" id="tm-assign" ${blocked ? "disabled" : ""}>Assign</button>
    </form>
    <div class="tm-cols">
      <div class="tm-col">
        <div class="tm-card" id="tm-assigned"><h3>Assigned to ${esc(a.name)} <span>${open.length} open</span></h3>
          ${open.map((t) => taskHtml(t, a)).join("") || `<div class="small dim">Nothing assigned right now. Tell ${esc(a.name)} what to do next.</div>`}</div>
        <div class="tm-card" id="tm-donelately"><h3>Done lately ${done.length > 3 ? `<button type="button" class="tm-link" id="tm-seeall">${st.seeAll ? "Show less" : "See all"}</button>` : ""}</h3>
          ${shown.map(doneHtml).join("") || `<div class="small dim">Finished work shows here, with what happened to it.</div>`}</div>
      </div>
      <div class="tm-col">
        <div class="tm-card" id="tm-duties"><h3>Duties ${a.canDuty && !st.dutyOpen ? `<button type="button" class="tm-link" id="tm-duty-add">+ Add</button>` : ""}</h3>${dutiesHtml(a)}</div>
        <div class="tm-card" id="tm-howit"><h3>How it works for you <button type="button" class="tm-link" id="tm-edit">Edit</button></h3>${howHtml(a)}</div>
      </div>
    </div>`;
}

// ---------- clicks ----------
function wireTeam(root) {
  const a = agentOf(st.sel);
  root.querySelectorAll("[data-agent]").forEach((b) => b.addEventListener("click", () => {
    st.sel = b.dataset.agent; st.seeAll = false; st.dutyOpen = false;
    paintTeam();
    if ((document.getElementById("tm-page")?.clientWidth || 0) <= 700) document.getElementById("tm-desk")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }));
  root.querySelectorAll("[data-team-tab-go]").forEach((b) => b.addEventListener("click", () => { st.section = b.dataset.teamTabGo; renderTeamPage(st.view); }));
  if (!a) return;
  root.querySelector("#tm-tell")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = root.querySelector("#tm-tell-text");
    const text = box.value.trim();
    if (!text) { box.focus(); return toast(`Type what ${a.name} should do next.`, true); }
    const btn = root.querySelector("#tm-assign");
    btn.disabled = true;
    try { await assign({ agentId: a.id, text }); box.value = ""; }
    finally { btn.disabled = false; }
  });
  root.querySelector("#tm-chat")?.addEventListener("click", () => chatWith(a));
  root.querySelector("#tm-give")?.addEventListener("click", () => giveDialog({ agentId: a.id }));
  root.querySelector("#tm-setup")?.addEventListener("click", () => CC.openSettings?.(a.id === "grokbot" ? "[data-feature='grokbot']" : "[data-feature='browser']"));
  root.querySelector("#tm-seeall")?.addEventListener("click", () => { st.seeAll = !st.seeAll; paintTeam(); });
  root.querySelector("#tm-duty-add")?.addEventListener("click", () => { st.dutyOpen = true; paintTeam(); document.getElementById("td-text")?.focus(); });
  root.querySelector("#tm-edit")?.addEventListener("click", () => editAgent(a));
  root.querySelector("#tm-cap")?.addEventListener("click", async () => {
    const v = await CC.ask?.(`Most ${a.name} may spend on one task, in dollars:`, String(a.cap));
    if (v === null || v === undefined || v === "") return;
    try { await api(`/team/agents/${encodeURIComponent(a.id)}/cap`, { method: "POST", body: { cap: Number(String(v).replace(/[$\s]/g, "")) } }); toast("Cap saved."); await load(); paintTeam(); }
    catch (e) { toast(e.message, true); }
  });
  root.querySelectorAll("[data-task-review]").forEach((b) => b.addEventListener("click", () => reviewDialog(b.dataset.taskReview)));
  root.querySelectorAll("[data-task-watch]").forEach((b) => b.addEventListener("click", () => CC.openRun(b.dataset.taskWatch)));
  root.querySelectorAll("[data-task-edit]").forEach((b) => b.addEventListener("click", () => editTaskDialog(b.dataset.taskEdit)));
  root.querySelectorAll("[data-task-cancel]").forEach((b) => b.addEventListener("click", () => taskAction(b.dataset.taskCancel, "cancel", "Cancelled.")));
  root.querySelectorAll("[data-task-retry]").forEach((b) => b.addEventListener("click", () => taskAction(b.dataset.taskRetry, "retry", "Trying again.")));
  root.querySelectorAll("[data-task-dismiss]").forEach((b) => b.addEventListener("click", () => taskAction(b.dataset.taskDismiss, "dismiss", "Dismissed.")));
  // duties
  const form = root.querySelector("#tm-duty-form");
  if (form) {
    const every = form.querySelector("#td-every"), day = form.querySelector("#td-day"), wrap = form.querySelector("#td-day-wrap");
    const paintDay = () => {
      if (every.value === "day") { wrap.hidden = true; return; }
      wrap.hidden = false;
      day.innerHTML = every.value === "week" ? DAY_NAMES.map((n, i) => `<option value="${i}" ${i === 1 ? "selected" : ""}>${n}</option>`).join("") : Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">the ${i + 1}${["st", "nd", "rd"][((i + 1) % 10) - 1] && ![11, 12, 13].includes(i + 1) ? ["st", "nd", "rd"][((i + 1) % 10) - 1] : "th"}</option>`).join("");
    };
    every.addEventListener("change", paintDay);
    form.querySelector("#td-cancel").addEventListener("click", () => { st.dutyOpen = false; paintTeam(); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = form.querySelector("#td-text").value.trim();
      if (!text) return toast("Say what to do each time.", true);
      try {
        const r = await api(`/team/agents/${encodeURIComponent(a.id)}/duties`, { method: "POST", body: { text, every: every.value, day: every.value === "day" ? undefined : Number(day.value), time: form.querySelector("#td-time").value || "09:00", capUsd: Number(form.querySelector("#td-cap").value) || 1, projectId: currentProject() } });
        toast(`Duty added: ${r.when}.`);
        st.dutyOpen = false; await load(); paintTeam();
      } catch (err) { toast(err.message, true); }
    });
  }
  const duty = async (id, path, method = "POST", note = "") => { try { await api(`/schedules/${encodeURIComponent(id)}${path}`, { method }); if (note) toast(note); await load(); paintTeam(); } catch (e) { toast(e.message, true); } };
  root.querySelectorAll("[data-duty-pause]").forEach((b) => b.addEventListener("click", () => duty(b.dataset.dutyPause, "/pause", "POST", "Duty paused.")));
  root.querySelectorAll("[data-duty-resume]").forEach((b) => b.addEventListener("click", () => duty(b.dataset.dutyResume, "/resume", "POST", "Duty is on again.")));
  root.querySelectorAll("[data-duty-del]").forEach((b) => b.addEventListener("click", async () => { if (!(await CC.confirm("Delete this duty? Work it already did stays on the desk.", { danger: true, ok: "Delete" }))) return; duty(b.dataset.dutyDel, "", "DELETE", "Duty deleted."); }));
}

async function taskAction(id, action, note) {
  try { await api(`/team/tasks/${encodeURIComponent(id)}/${action}`, { method: "POST", body: {} }); if (note) toast(note); }
  catch (e) { toast(e.message, true); }
  await load(); paintTeam();
}

export async function assign({ agentId, text, title, startAt, source, projectId }) {
  try {
    const r = await api("/team/assign", { method: "POST", body: { agentId, text, title, startAt, source, projectId: projectId ?? currentProject() } });
    toast(r.task?.status === "waiting" ? `${r.task.agentName} will start ${whenText(r.task.startAt)}.` : `${r.task?.agentName || "The agent"} is on it.`);
    if (onPage()) { await load(); paintTeam(); }
    return r.task;
  } catch (e) { toast(e.message, true); if (onPage()) { await load(); paintTeam(); } return null; }
}

function chatWith(a) {
  S().employee = { id: a.id, name: a.name, team: true };
  S().scPage = "chat";
  CC.go("command");
  toast(`Chatting with ${a.name}. Its job script is used for every answer in this chat.`);
  setTimeout(() => document.getElementById("orders")?.focus(), 80);
}
async function editAgent(a) {
  if (a.kind === "custom") { await st.helpers?.load?.(); st.helpers?.editAgent?.(a.id); st.section = "mine"; renderTeamPage(st.view); return; }
  if (a.kind === "employee") { st.helpers?.showScript?.(a.employeeId); return; }
  CC.openSettings?.(a.id === "grokbot" ? "[data-feature='grokbot']" : "[data-feature='browser']");
}

// ---------- dialogs ----------
function dialog(html, { label = "Team" } = {}) {
  document.querySelector(".tm-dlg")?.remove();
  const el = document.createElement("div");
  el.className = "tm-dlg";
  el.innerHTML = `<div class="tm-dlg-box panel" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) el.remove(); });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") el.remove(); });
  document.body.appendChild(el);
  setTimeout(() => el.querySelector("textarea, input, button.primary")?.focus(), 30);
  return el;
}

// + Give a task, Give to an agent (a chat answer), Assign to (a project step). Picks the agent when none is given.
export function giveDialog({ agentId = "", title = "", text = "", source = "desk", heading = "", projectId } = {}) {
  const show = async () => {
    if (!st.data) await load();
    const list = agents().filter((a) => a.kind !== "outside" || a.ready);
    const pick = agentId || st.sel || list[0]?.id || "";
    const el = dialog(`<h3>${esc(heading || "Give a task")}</h3>
      <label class="small tm-field">Who does it <select id="tg-agent">${list.map((a) => `<option value="${esc(a.id)}" ${a.id === pick ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <label class="small tm-field">Short name (optional) <input type="text" id="tg-title" maxlength="120" value="${esc(title)}" placeholder="Valentine's week posts"></label>
      <label class="small tm-field">What to do <textarea id="tg-text" rows="${text ? 8 : 4}" maxlength="20000" placeholder="Say what you need, as you would to a person">${esc(text)}</textarea></label>
      <label class="small tm-field">When <select id="tg-when"><option value="now">Start now</option><option value="later">Later</option></select></label>
      <input type="datetime-local" id="tg-at" hidden aria-label="Start at">
      <div class="small dim">It runs with your own AI accounts and stays within the agent's cap. The result waits on its desk. Nothing is sent or posted without your click.</div>
      <div class="tm-row"><button type="button" class="btn primary" id="tg-go">Assign</button><button type="button" class="btn" data-close>Cancel</button></div>`, { label: heading || "Give a task" });
    const when = el.querySelector("#tg-when"), at = el.querySelector("#tg-at");
    when.addEventListener("change", () => { at.hidden = when.value !== "later"; if (!at.value) { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); at.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } });
    el.querySelector("#tg-go").addEventListener("click", async () => {
      const body = el.querySelector("#tg-text").value.trim();
      if (!body) return toast("Say what to do.", true);
      const startAt = when.value === "later" && at.value ? new Date(at.value).getTime() : undefined;
      if (when.value === "later" && !(startAt > Date.now())) return toast("Pick a time later than now.", true);
      const btn = el.querySelector("#tg-go"); btn.disabled = true;
      const id = el.querySelector("#tg-agent").value;
      const t = await assign({ agentId: id, text: body, title: el.querySelector("#tg-title").value.trim() || undefined, startAt, source, projectId });
      btn.disabled = false;
      if (t) { el.remove(); if (source !== "desk") { const name = t.agentName; toast(`${name} has it. See it on ${name}'s desk in Team.`); } }
    });
  };
  show();
}

function editTaskDialog(id) {
  const t = (st.data?.tasks || []).find((x) => x.id === id);
  if (!t) return;
  const local = t.startAt ? new Date(t.startAt - new Date(t.startAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const el = dialog(`<h3>Edit task</h3>
    <label class="small tm-field">Short name <input type="text" id="te-title" maxlength="120" value="${esc(t.title)}"></label>
    <label class="small tm-field">What to do <textarea id="te-text" rows="5">${esc(t.text)}</textarea></label>
    <label class="small tm-field">Start at <input type="datetime-local" id="te-at" value="${esc(local)}"></label>
    <div class="small dim">Clear the time to start it now.</div>
    <div class="tm-row"><button type="button" class="btn primary" id="te-save">Save</button><button type="button" class="btn" data-close>Cancel</button></div>`, { label: "Edit task" });
  el.querySelector("#te-save").addEventListener("click", async () => {
    const v = el.querySelector("#te-at").value;
    try { await api(`/team/tasks/${encodeURIComponent(id)}`, { method: "POST", body: { title: el.querySelector("#te-title").value, text: el.querySelector("#te-text").value, startAt: v ? new Date(v).getTime() : null } }); el.remove(); toast("Saved."); }
    catch (e) { toast(e.message, true); }
    await load(); paintTeam();
  });
}

async function reviewDialog(id) {
  let r;
  try { r = await api(`/team/tasks/${encodeURIComponent(id)}`); } catch (e) { return toast(e.message, true); }
  const t = r.task;
  const waiting = t.status === "review";
  const outsideAsk = waiting && r.job?.status === "needs_approval";
  // an approved task can be read, copied again or changed; only a task waiting for the OK (or plainly Done) is approved
  const canApprove = waiting || (t.status === "done" && t.outcome === "done");
  const el = dialog(`<h3>${esc(t.title)} <span class="tm-dlg-sub">${esc(t.agentName)}</span></h3>
    <div class="small dim">${esc(waiting ? (outsideAsk ? `${t.agentName} is asking for your OK before it goes on.` : "Ready for your OK. Read it, then approve, ask for changes or dismiss it.") : t.outcomeLabel || t.statusLabel)}</div>
    <div class="tm-result md" id="tr-result">${r.result ? md(r.result) : `<span class="dim">No result text came back.</span>`}</div>
    <div class="small dim tm-safe">Approving only copies or saves it. Nothing is sent or posted by Meldmind.</div>
    ${outsideAsk ? `<div class="tm-row"><button type="button" class="btn primary" id="tr-open-agent">Open ${esc(t.agentName)} to answer it</button><button type="button" class="btn" data-close>Close</button></div>` : `
    <div class="tm-row tm-review-acts">
      ${canApprove ? `<button type="button" class="btn primary" id="tr-copy">Approve and copy</button>
      <button type="button" class="btn" id="tr-save">Approve and save to MindMedia</button>` : `<button type="button" class="btn" id="tr-copy-only">Copy</button>`}
      <button type="button" class="btn" id="tr-changes">Ask for changes</button>
      ${canApprove ? `<button type="button" class="btn" id="tr-dismiss">Dismiss</button>` : `<button type="button" class="btn" data-close>Close</button>`}
    </div>
    <div id="tr-change-box" hidden><label class="small tm-field">What should change? <textarea id="tr-change-text" rows="3" placeholder="Shorter, and mention the Saturday sale"></textarea></label>
      <div class="tm-row"><button type="button" class="btn primary" id="tr-send-changes">Send to ${esc(t.agentName)}</button></div></div>`}`, { label: `Review ${t.title}` });
  const done = async (how, note) => {
    try { const out = await api(`/team/tasks/${encodeURIComponent(id)}/approve`, { method: "POST", body: { how } }); toast(out.saved?.where || note); el.remove(); }
    catch (e) { toast(e.message, true); }
    await load(); paintTeam();
  };
  el.querySelector("#tr-open-agent")?.addEventListener("click", () => { el.remove(); CC.openSettings?.(t.agentId === "grokbot" ? "[data-feature='grokbot']" : "[data-feature='browser']"); });
  el.querySelector("#tr-copy")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(r.result || ""); } catch { toast("Could not copy: select the text and press Ctrl+C.", true); return; }
    done("copied", "Approved and copied.");
  });
  el.querySelector("#tr-copy-only")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.result || ""); toast("Copied."); } catch { toast("Could not copy: select the text and press Ctrl+C.", true); } });
  el.querySelector("#tr-save")?.addEventListener("click", () => done("saved", "Approved and saved to MindMedia."));
  el.querySelector("#tr-dismiss")?.addEventListener("click", async () => { try { await api(`/team/tasks/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: {} }); toast("Dismissed."); el.remove(); } catch (e) { toast(e.message, true); } await load(); paintTeam(); });
  el.querySelector("#tr-changes")?.addEventListener("click", () => { const box = el.querySelector("#tr-change-box"); box.hidden = false; box.querySelector("textarea").focus(); });
  el.querySelector("#tr-send-changes")?.addEventListener("click", async () => {
    const text = el.querySelector("#tr-change-text").value.trim();
    if (!text) return toast("Say what should change.", true);
    try { await api(`/team/tasks/${encodeURIComponent(id)}/changes`, { method: "POST", body: { text } }); toast(`Sent to ${t.agentName}.`); el.remove(); }
    catch (e) { toast(e.message, true); }
    await load(); paintTeam();
  });
}

// ---------- elsewhere: a chat answer, a project's steps, a project's team ----------
// Under a chat answer (Make changes): the answer and its request become a task for someone on the team.
export function giveAnswer({ prompt = "", answer = "" } = {}) {
  const ask = String(prompt || "").trim();
  const text = `${ask ? `The request:\n${ask}\n\n` : ""}The answer to work from:\n${String(answer || "").trim()}\n\nTake it from here and make it ready to use.`;
  giveDialog({ heading: "Give to an agent", title: ask ? ask.slice(0, 80) : "", text, source: "chat" });
}
// Open one agent's desk (a project's team, a link anywhere).
export function openDesk(agentId) {
  S().teamSelect = agentId;
  st.section = "team";
  CC.go("agents");
}

function deliverableRender(el, run) {
  const text = run?.deliverable || "";
  if (!run?.id || !String(text).trim()) { el.innerHTML = ""; return; }
  el.innerHTML = `<button type="button" class="btn sm" id="tm-give-answer" title="Hand this answer and its request to someone on your team. It lands on their desk.">Give to an agent</button>`;
  el.querySelector("button").addEventListener("click", () => giveAnswer({ prompt: run.mission?.prompt || run.council?.prompt || run.mission?.goal || S().lastPrompt || "", answer: text }));
}
// The Expert chat page says who you are chatting with (Simple shows it under the chat box).
function commandRender(el) {
  const who = S().employee;
  if (!who?.team || S().uiMode === "simple") { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="tm-chatting" id="tm-chatting" role="status"><span>💬 Chatting with <b>${esc(who.name)}</b>. Its job script answers here.</span><button type="button" class="btn sm" id="tm-chat-stop">Stop</button><button type="button" class="btn sm" id="tm-chat-desk">Open its desk</button></div>`;
  el.querySelector("#tm-chat-stop").addEventListener("click", () => { S().employee = null; el.innerHTML = ""; });
  el.querySelector("#tm-chat-desk").addEventListener("click", () => openDesk(who.id));
}

function onEvent(ev) {
  if (ev.type === "team.task" || ev.type === "schedules.update" || (ev.type === "agents.update")) { if (onPage()) reload(); }
}

window.CC.team = { open: openDesk, give: giveDialog, giveAnswer, assign, reload: () => { if (onPage()) reload(); } };
CC.register({ id: "team", deliverable: { order: 40, render: deliverableRender }, command: { order: 2, render: commandRender }, onEvent });
