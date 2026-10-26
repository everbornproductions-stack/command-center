// Review and Take Over Tasks, project mirroring and Owner tools (flag_takeover).
// Loaded by the Schedules tab only when the flag is on. Every change waits for a click and a confirm dialog.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function takeoverEnabled(S) {
  return !!(S && (S.flags?.takeover || S.settings?.flag_takeover));
}
export function isOwnerTier(S) {
  return S?.license?.tier === "owner";
}

export function taskRowHtml(t) {
  const when = t.when ? esc(t.when) : "time not found";
  const state = t.takenSchedule ? `<span class="pill green">Taken over (paused in Schedules)</span>` : t.active ? "" : `<span class="pill">Paused there</span>`;
  const buttons = t.takenSchedule
    ? (t.canPause && !t.pausedOriginal ? `<button type="button" class="btn sm" data-tk-pause="${esc(t.id)}">Pause the original</button>` : t.pausedOriginal ? `<span class="small dim">Original paused</span>` : `<span class="small dim">Pause it in ${esc(t.sourceName)} yourself.</span>`)
    : `${t.needsTime ? `<input type="text" data-tk-cron="${esc(t.id)}" placeholder="0 9 * * 1-5" aria-label="When it runs" style="width:140px">` : ""}<button type="button" class="btn sm primary" data-tk-take="${esc(t.id)}">Take over</button><button type="button" class="btn sm" data-tk-skip="${esc(t.id)}">Not this one</button>`;
  return `<div class="tk-row" style="padding:8px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere">
    <div class="row" style="gap:8px;flex-wrap:wrap"><b>${esc(t.name)}</b><span class="small dim">from ${esc(t.sourceName)}</span>${state}</div>
    <div class="small muted">Runs: ${when}</div>
    ${t.prompt ? `<div class="small dim" style="white-space:pre-wrap;max-height:80px;overflow:auto">${esc(t.prompt.slice(0, 300))}</div>` : ""}
    <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${buttons}</div></div>`;
}

export function ownerHtml(o) {
  const s = o.settings || {};
  const num = (k, label, min, max, step) => `<label class="small" style="display:block;margin:4px 0">${label} <input type="number" data-tk-own="${k}" value="${esc(s[k])}" min="${min}" max="${max}" step="${step}" style="width:90px"></label>`;
  return `<div class="panel" id="tk-owner"><h3>Owner tools <span class="right small dim">saved only after you confirm</span></h3>
    <label class="small" style="display:block;margin:4px 0">Connection to use <select data-tk-own="transport"><option value="auto"${s.transport === "auto" ? " selected" : ""}>Auto</option><option value="api"${s.transport === "api" ? " selected" : ""}>Keys only</option><option value="mcp"${s.transport === "mcp" ? " selected" : ""}>Plug-in connection only</option></select></label>
    ${num("finishHigh", "Finish: confident above", 0.5, 0.99, 0.01)}${num("finishLow", "Finish: ask below", 0.1, 0.9, 0.01)}
    ${num("momentumIdleSec", "Momentum: idle seconds", 5, 300, 1)}${num("momentumBarSize", "Momentum: actions shown", 2, 4, 1)}
    <div class="row" style="gap:6px;margin-top:6px"><button type="button" class="btn sm primary" id="tk-own-save">Save changes</button><button type="button" class="btn sm" id="tk-own-undo"${(o.history || []).length ? "" : " disabled"}>Undo last change</button></div>
    <div class="small dim" style="margin-top:8px;overflow-wrap:anywhere">${o.routing?.plain ? esc(o.routing.plain) : ""}</div>
    <div class="small dim" style="overflow-wrap:anywhere">Recent tool calls: ${(o.logs?.tools || []).length}. Recent takeover steps: ${(o.logs?.takeover || []).length}.</div>
    ${(o.logs?.takeover || []).slice(0, 5).map((l) => `<div class="small dim" style="overflow-wrap:anywhere">${esc(l.text)}</div>`).join("")}
  </div>`;
}

export function mirrorHtml(m) {
  const targets = (m.targets || []).map((t) => `<button type="button" class="btn sm" data-tk-mirror="${esc(t.kind)}|${esc(t.id)}" data-tk-proj="${esc(m.projectId)}">Send brief to ${esc(t.name)}</button>`).join("") || `<span class="small dim">No connected AI can take a project brief yet.</span>`;
  return `<div class="small" style="margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid var(--line);padding-left:8px">${esc(m.brief)}</div><div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${targets}</div><div class="small dim">${esc(m.note || "")}</div>`;
}

export async function mount(host) {
  const { api, toast } = window.CC;
  const S = () => window.CC.S;
  const st = { review: null, owner: null, mirror: null, msg: "" };
  async function refresh() {
    try { st.review = (await api("/takeover/state")).review; } catch (e) { st.review = { tasks: [], log: [] }; toast(e.message, true); }
    if (isOwnerTier(S())) { try { st.owner = await api("/takeover/owner"); } catch { st.owner = null; } }
    draw();
  }
  function draw() {
    const projects = S().projects || [];
    host.innerHTML = `<div class="panel" id="tk-root"><h3>Other AIs <span class="right small dim">nothing changes until you click</span></h3>
      <div class="small muted">Review and Take Over Tasks looks at the plug-in connections you added and shows scheduled tasks they report. You choose which to copy into Schedules.</div>
      <div class="row" style="gap:6px;margin:8px 0;flex-wrap:wrap"><button type="button" class="btn sm primary" id="tk-look">Review and Take Over Tasks</button><button type="button" class="btn sm" id="tk-paste-toggle">Paste an export</button></div>
      <div id="tk-paste" hidden><textarea id="tk-paste-text" rows="4" style="width:100%" placeholder="Paste the exported task list (JSON)"></textarea><button type="button" class="btn sm" id="tk-paste-go">Read it</button></div>
      <div class="small dim" role="status" id="tk-msg" style="overflow-wrap:anywhere">${esc(st.msg)}</div>
      ${(st.review?.tasks || []).map(taskRowHtml).join("") || `<div class="small dim">No tasks to review yet.</div>`}
      <h3 style="margin-top:12px">Mirror a project</h3>
      <div class="row" style="gap:6px;flex-wrap:wrap"><select id="tk-proj" aria-label="Project"><option value="">Pick a project</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><button type="button" class="btn sm" id="tk-prev">See the brief</button></div>
      <div id="tk-mirror">${st.mirror ? mirrorHtml(st.mirror) : ""}</div></div>${st.owner ? ownerHtml(st.owner) : ""}`;
    wire();
  }
  const guarded = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  function wire() {
    const q = (s) => host.querySelector(s);
    q("#tk-look")?.addEventListener("click", guarded(async () => {
      const r = await api("/takeover/look", { method: "POST", body: {} });
      st.review = r.view; st.msg = r.report.length ? r.report.map((x) => `${x.source}: ${x.message}`).join(" ") : "No plug-in connections to look at. Add one in Settings, or paste an export.";
      draw();
    }));
    q("#tk-paste-toggle")?.addEventListener("click", () => { const p = q("#tk-paste"); p.hidden = !p.hidden; });
    q("#tk-paste-go")?.addEventListener("click", guarded(async () => { st.review = await api("/takeover/import", { method: "POST", body: { text: q("#tk-paste-text").value, label: "Pasted export" } }); st.msg = "Read the export."; draw(); }));
    host.querySelectorAll("[data-tk-take]").forEach((b) => b.addEventListener("click", guarded(async () => {
      if (!confirm("Copy this task into Schedules? It starts paused, so nothing runs twice.")) return;
      const cron = host.querySelector(`[data-tk-cron="${b.dataset.tkTake}"]`)?.value || "";
      const r = await api(`/takeover/task/${b.dataset.tkTake}/take`, { method: "POST", body: { confirm: true, cron } });
      st.review = r.view; st.msg = "Taken over. Find it in Schedules, paused."; draw();
    })));
    host.querySelectorAll("[data-tk-skip]").forEach((b) => b.addEventListener("click", guarded(async () => { st.review = await api(`/takeover/task/${b.dataset.tkSkip}/dismiss`, { method: "POST", body: {} }); draw(); })));
    host.querySelectorAll("[data-tk-pause]").forEach((b) => b.addEventListener("click", guarded(async () => {
      if (!confirm("Ask the other AI to pause its own copy of this task?")) return;
      const r = await api(`/takeover/task/${b.dataset.tkPause}/pause-original`, { method: "POST", body: { confirm: true } });
      st.review = r.view; draw();
    })));
    q("#tk-prev")?.addEventListener("click", guarded(async () => { const id = q("#tk-proj").value; if (!id) return; st.mirror = await api(`/takeover/mirror/${encodeURIComponent(id)}`); draw(); q("#tk-proj").value = id; }));
    host.querySelectorAll("[data-tk-mirror]").forEach((b) => b.addEventListener("click", guarded(async () => {
      const [kind, id] = b.dataset.tkMirror.split("|");
      if (!confirm("Send this project brief? It has the name, summary and section names only.")) return;
      const r = await api(`/takeover/mirror/${encodeURIComponent(b.dataset.tkProj)}`, { method: "POST", body: { kind, id, confirm: true } });
      toast(`Sent to ${r.target}`);
    })));
    q("#tk-own-save")?.addEventListener("click", guarded(async () => {
      const patch = {};
      host.querySelectorAll("[data-tk-own]").forEach((el) => { patch[el.dataset.tkOwn] = el.value; });
      if (!confirm("Save these owner settings?")) return;
      await api("/takeover/owner/change", { method: "POST", body: { patch, confirm: true } });
      toast("Saved"); refresh();
    }));
    q("#tk-own-undo")?.addEventListener("click", guarded(async () => {
      if (!confirm("Put the last owner change back?")) return;
      await api("/takeover/owner/undo", { method: "POST", body: { confirm: true } });
      toast("Put back"); refresh();
    }));
  }
  await refresh();
}
