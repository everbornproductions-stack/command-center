// Scheduled and triggered agents (Phase 22). The Schedules tab: run an agent, a chat or a mission on a
// schedule, from a webhook (its own secret token, shown once) or when a new file lands in a watched folder;
// a monthly spend cap per schedule; results that are sent somewhere wait for your Approve; run history.
const { api, toast, esc, money, ago } = window.CC;
const S = () => window.CC.S;

const st = { data: null, edit: null, token: null };
const CRON_PRESETS = [["0 9 * * 1-5", "Weekdays at 9:00"], ["0 8 * * 1", "Mondays at 8:00"], ["@daily", "Every day at midnight"], ["@hourly", "Every hour"], ["*/15 * * * *", "Every 15 minutes"]];
const STATUS_CLS = { queued: "", running: "amber", needs_approval: "amber", done: "green", failed: "red", stopped: "red", rejected: "" };
const TRIG = { cron: "Schedule", webhook: "Webhook", folder: "Watched folder" };
const triggers = () => (S().mode === "hosted" ? { cron: TRIG.cron, webhook: TRIG.webhook } : TRIG);
const KIND = { agent: "Agent", chat: "Chat", mission: "Mission" };

async function load() {
  try { st.data = await api("/schedules"); } catch (e) { toast(e.message, true); st.data = st.data || { items: [], runs: [], agents: [], note: "", defaultCap: 1 }; }
}

function trigText(s) {
  const t = s.trigger;
  if (t.type === "cron") return `${esc(t.cron)}${s.nextRun ? ` · next ${new Date(s.nextRun).toLocaleString()}` : ""}`;
  if (t.type === "folder") return `${esc(t.folder)}${t.pattern ? ` (${esc(t.pattern)})` : ""}`;
  return `POST <span class="mono">${esc(location.origin + s.hookPath)}</span>`;
}
function targetText(s) {
  if (s.target.kind === "agent") return `Agent: ${esc(st.data.agents.find((a) => a.id === s.target.agentId)?.name || "(deleted agent)")}`;
  return `${KIND[s.target.kind]}: ${esc(s.target.text.slice(0, 80))}`;
}
const pill = (r) => `<span class="pill ${STATUS_CLS[r.status] || ""}">${esc(r.statusLabel || r.status)}</span>`;

function form(s) {
  const e = s || { name: "", target: { kind: st.data.agents.length ? "agent" : "chat", text: "", agentId: st.data.agents[0]?.id || "" }, trigger: { type: "cron", cron: "0 9 * * 1-5" }, capUsd: st.data.defaultCap, after: { action: "none" } };
  const projects = S().projects || [];
  return `<div class="panel" id="sch-form"><h3>${s ? `Edit ${esc(s.name)}` : "New schedule"}</h3>
    <label class="small">Name<input type="text" id="sf-name" value="${esc(e.name)}" maxlength="80"></label>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <label class="small">What runs <select id="sf-kind">${["agent", "chat", "mission"].map((k) => `<option value="${k}" ${e.target.kind === k ? "selected" : ""}>${KIND[k]}</option>`).join("")}</select></label>
      <label class="small" id="sf-agent-wrap">Agent <select id="sf-agent">${st.data.agents.map((a) => `<option value="${esc(a.id)}" ${a.id === e.target.agentId ? "selected" : ""}>${esc(a.name)}</option>`).join("") || `<option value="">No agents yet (Agents tab)</option>`}</select></label>
      <label class="small">Project <select id="sf-proj"><option value="">No project</option>${projects.map((p) => `<option value="${esc(p.id)}" ${p.id === e.target.projectId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    </div>
    <textarea id="sf-text" rows="3" style="width:100%;margin-top:8px" placeholder="What should it do each time? (for an agent this is optional)">${esc(e.target.text || "")}</textarea>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <label class="small">Trigger <select id="sf-trig">${Object.entries(triggers()).map(([k, v]) => `<option value="${k}" ${e.trigger.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <span id="sf-cron-wrap"><label class="small">When (cron) <input type="text" id="sf-cron" value="${esc(e.trigger.cron || "0 9 * * 1-5")}" style="width:150px"></label>
        <select id="sf-cron-preset" class="small"><option value="">Presets</option>${CRON_PRESETS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></span>
      <span id="sf-folder-wrap"><label class="small">Folder <input type="text" id="sf-folder" value="${esc(e.trigger.folder || "")}" placeholder="C:\\Users\\you\\Drop" style="width:240px"></label>
        <label class="small">Files <input type="text" id="sf-pattern" value="${esc(e.trigger.pattern || "")}" placeholder="*.txt, *.csv" style="width:110px"></label></span>
    </div>
    <div class="small dim" id="sf-hook-note" style="margin-top:6px">A webhook gets its own address and secret token. The token is shown once when you save; keep it in the sending service, not in a shared document.</div>
    ${S().mode === "hosted" ? `<div class="small dim" style="margin-top:6px">Watched folders stay on the desktop app.</div>` : ""}
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <label class="small">Monthly spend cap ($) <input type="number" id="sf-cap" min="0.01" step="0.01" value="${esc(e.capUsd)}" style="width:90px"></label>
      <label class="small">After the run <select id="sf-after"><option value="none" ${e.after.action === "none" ? "selected" : ""}>Keep the result here</option><option value="webhook" ${e.after.action === "webhook" ? "selected" : ""}>Send it to a web address (asks you first)</option></select></label>
      <input type="text" id="sf-url" value="${esc(e.after.url || "")}" placeholder="https://..." style="width:240px">
    </div>
    <div class="small dim" style="margin-top:6px">Each run uses your own keys; every call is in the ledger and counts toward your spend caps. When this schedule reaches its own cap it stops and you get an alert. A result that is sent anywhere waits in "Needs your approval" until you click Approve.</div>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn primary" id="sf-save">${s ? "Save" : "Create"}</button>${s ? `<button class="btn" id="sf-cancel">Cancel</button>` : ""}</div>
  </div>`;
}

function wireForm(view) {
  const $ = (q) => view.querySelector(q);
  const sync = () => {
    $("#sf-agent-wrap").style.display = $("#sf-kind").value === "agent" ? "" : "none";
    const t = $("#sf-trig").value;
    $("#sf-cron-wrap").style.display = t === "cron" ? "" : "none";
    $("#sf-folder-wrap").style.display = t === "folder" ? "" : "none";
    $("#sf-hook-note").style.display = t === "webhook" ? "" : "none";
    $("#sf-url").style.display = $("#sf-after").value === "webhook" ? "" : "none";
  };
  ["#sf-kind", "#sf-trig", "#sf-after"].forEach((q) => $(q).addEventListener("change", sync));
  $("#sf-cron-preset").addEventListener("change", (e) => { if (e.target.value) $("#sf-cron").value = e.target.value; });
  sync();
  $("#sf-cancel")?.addEventListener("click", () => { st.edit = null; renderTab(view); });
  $("#sf-save").addEventListener("click", async () => {
    const t = $("#sf-trig").value;
    const body = {
      name: $("#sf-name").value,
      target: { kind: $("#sf-kind").value, agentId: $("#sf-agent").value, text: $("#sf-text").value, projectId: $("#sf-proj").value || null },
      trigger: t === "cron" ? { type: t, cron: $("#sf-cron").value } : t === "folder" ? { type: t, folder: $("#sf-folder").value, pattern: $("#sf-pattern").value } : { type: t },
      capUsd: Number($("#sf-cap").value),
      after: $("#sf-after").value === "webhook" ? { action: "webhook", url: $("#sf-url").value } : { action: "none" },
    };
    try {
      const r = await api(st.edit ? `/schedules/${st.edit}` : "/schedules", { method: "POST", body });
      st.edit = null; st.token = r.token ? { id: r.schedule.id, token: r.token } : null;
      toast("Saved"); renderTab(view);
    } catch (e) { toast(e.message, true); }
  });
}

function approvalPanel() {
  const held = (st.data.runs || []).filter((r) => r.status === "needs_approval");
  if (!held.length) return "";
  return `<div class="panel" style="border-color:var(--amber, #f59e0b)"><h3>Needs your approval <span class="right small dim">nothing is sent until you click Approve</span></h3>
    ${held.map((r) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div class="row small"><b>${esc(r.scheduleName)}</b><span class="dim" style="margin-left:8px">${ago(r.finishedAt || r.at)}</span><span class="right dim">will be sent to ${esc(r.after?.url || "")}</span></div>
      <pre class="small" style="white-space:pre-wrap;max-height:180px;overflow:auto;margin:6px 0">${esc(r.output || r.preview || "")}</pre>
      <div class="row" style="gap:8px"><button class="btn sm primary" data-approve="${esc(r.id)}">Approve and send</button><button class="btn sm" data-reject="${esc(r.id)}">Don't send</button></div>
    </div>`).join("")}</div>`;
}

async function renderTab(view) {
  view.innerHTML = `<div class="empty">Loading…</div>`;
  await load();
  const d = st.data;
  const editing = st.edit ? d.items.find((s) => s.id === st.edit) : null;
  view.innerHTML = `<div id="sch-root" class="grid" style="grid-template-columns:minmax(0,1fr) 380px">
    <div class="grid" style="align-content:start">
      <div class="panel small" style="border-left:3px solid var(--amber, #f59e0b)">${esc(d.note)}</div>
      ${st.token ? `<div class="panel"><h3>Webhook token (shown once)</h3><div class="small">Send <span class="mono">POST ${esc(location.origin)}/api/schedules/hook/${esc(st.token.id)}</span> with the header <span class="mono">X-CC-Trigger-Token</span> (or <span class="mono">Authorization: Bearer</span>) set to:</div><input type="text" readonly class="mono" value="${esc(st.token.token)}" style="width:100%;margin-top:6px" onclick="this.select()"><div class="small dim" style="margin-top:6px">A JSON body is optional and is handed to the run as data. The address only works while this app is running, and only from places that can reach this PC.</div><button class="btn sm" id="sch-token-ok" style="margin-top:6px">I saved it</button></div>` : ""}
      ${approvalPanel()}
      <div class="panel"><h3>Schedules <span class="right small dim">${d.items.length}</span></h3>
        ${d.items.map((s) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
          <div class="row"><b>${esc(s.name)}</b><span class="pill ${s.enabled ? "green" : s.pausedReason === "cap" ? "red" : ""}" style="margin-left:8px">${s.enabled ? "On" : s.pausedReason === "cap" ? "Paused: spend cap" : "Paused"}</span><span class="right mono small">${money(s.spent, 4)} of ${money(s.capUsd, 2)} this month</span></div>
          <div class="small muted">${targetText(s)}</div>
          <div class="small dim">${TRIG[s.trigger.type]}: ${trigText(s)}${s.after.action === "webhook" ? ` · then send to ${esc(s.after.url)} after your OK` : ""}</div>
          <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
            <button class="btn sm" data-run="${esc(s.id)}">Run now</button>
            <button class="btn sm" data-toggle="${esc(s.id)}" data-on="${s.enabled ? "0" : "1"}">${s.enabled ? "Pause" : "Resume"}</button>
            <button class="btn sm" data-edit="${esc(s.id)}">Edit</button>
            ${s.trigger.type === "webhook" ? `<button class="btn sm" data-token="${esc(s.id)}">New token</button>` : ""}
            <button class="btn sm" data-del="${esc(s.id)}">Delete</button>
          </div></div>`).join("") || `<div class="empty">No schedules yet. Create one on the right.</div>`}
      </div>
      <div class="panel"><h3>Run history</h3>
        ${(d.runs || []).slice(0, 60).map((r) => `<div class="row small" style="padding:5px 0;border-bottom:1px solid var(--line);gap:8px">${pill(r)}<span>${esc(r.scheduleName)}</span><span class="dim">${esc(r.source)}${r.file ? `: ${esc(r.file.name)}` : ""}</span><span class="dim">${ago(r.at)}</span>${r.error ? `<span class="dim" title="${esc(r.error)}">${esc(r.error.slice(0, 80))}</span>` : ""}${r.sent ? `<span class="dim">sent to ${esc(r.sent.to)}</span>` : ""}<span class="mono" style="margin-left:auto">${money(r.cost || 0, 4)}</span></div>`).join("") || `<div class="dim small">No runs yet.</div>`}
      </div>
    </div>
    <div class="grid" style="align-content:start">${form(editing)}</div>
  </div>`;
  wireForm(view);
  view.querySelector("#sch-token-ok")?.addEventListener("click", () => { st.token = null; renderTab(view); });
  const act = (sel, fn) => view.querySelectorAll(sel).forEach((b) => b.addEventListener("click", async () => { try { await fn(b); } catch (e) { toast(e.message, true); } }));
  act("[data-run]", async (b) => { await api(`/schedules/${b.dataset.run}/run`, { method: "POST" }); toast("Run queued"); renderTab(view); });
  act("[data-toggle]", async (b) => { await api(`/schedules/${b.dataset.toggle}/${b.dataset.on === "1" ? "resume" : "pause"}`, { method: "POST" }); renderTab(view); });
  act("[data-edit]", async (b) => { st.edit = b.dataset.edit; renderTab(view); });
  act("[data-token]", async (b) => { if (!confirm("Make a new token? The old one stops working right away.")) return; const r = await api(`/schedules/${b.dataset.token}/token`, { method: "POST" }); st.token = { id: r.schedule.id, token: r.token }; renderTab(view); });
  act("[data-del]", async (b) => { if (!confirm("Delete this schedule? Its run history stays.")) return; await api(`/schedules/${b.dataset.del}`, { method: "DELETE" }); renderTab(view); });
  act("[data-approve]", async (b) => { const r = await api(`/schedules/runs/${b.dataset.approve}/approve`, { method: "POST" }); toast(r.status === "done" ? "Sent" : r.error || "Could not send", r.status !== "done"); renderTab(view); });
  act("[data-reject]", async (b) => { await api(`/schedules/runs/${b.dataset.reject}/reject`, { method: "POST" }); toast("Not sent"); renderTab(view); });
}

let pending = null;
function onEvent(ev) {
  if (ev.type !== "schedules.run" && ev.type !== "schedules.update") return;
  if (ev.type === "schedules.run" && ev.run?.status === "needs_approval") toast(`"${ev.run.scheduleName}" has a result waiting for your approval (Schedules tab).`);
  const view = document.querySelector("#view");
  if (!view?.querySelector("#sch-root") || view.querySelector("#sch-form :focus")) return; // never wipe a form being typed in
  clearTimeout(pending); pending = setTimeout(() => renderTab(view), 400);
}

CC.register({ id: "schedules", tab: { label: "Schedules", short: "Schedules", icon: "⏱", order: 16, render: renderTab }, onEvent });
