// Pipelines tab: saved missions with pre-decided steps. One click, pick the project, fill 2–3 inputs, run.
const { S, api, toast, esc, md, go, refresh, ago } = window.CC;

let cache = [];
async function load() { try { cache = await api("/pipelines"); } catch (e) { toast(e.message, true); cache = []; } return cache; }

function projectOptions(sel) { return `<option value="">No project</option>` + S.projects.map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join(""); }

async function renderTab(view) {
  view.innerHTML = `<div class="empty">Loading pipelines…</div>`;
  const list = await load();
  let runs = []; try { runs = await api("/pipelines/runs"); } catch {}
  const cats = [...new Set(list.map((p) => p.category))];
  view.innerHTML = `
  <div class="grid" style="grid-template-columns: minmax(0,1fr) 340px">
    <div>
      <div class="row" style="margin-bottom:12px"><h3 style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)">Pipelines</h3><span class="dim small">one click, steps already assigned to the best AI for each</span><button class="btn sm" id="pl-new" style="margin-left:auto">+ New from last mission</button></div>
      ${cats.map((c) => `<div class="cat-h">${esc(c)}</div><div class="pcards">${list.filter((p) => p.category === c).map((p) => `
        <div class="pcard" style="--c:${p.builtIn ? "var(--accent)" : "var(--violet)"}" data-pl="${esc(p.id)}">
          <h4>${esc(p.icon || "✦")} ${esc(p.name)}</h4><div class="muted small">${esc(p.description || "")}</div>
          <div class="cats">${p.steps.map((s) => `<span class="chip">${esc(s.title)}</span>`).join("")}</div>
          <div class="row small dim" style="margin-top:10px"><span>${p.steps.length} steps · ${esc(p.mode || "balanced")}</span>${!p.builtIn ? `<button class="ghost small" data-del="${esc(p.id)}" style="margin-left:auto;color:var(--red)">delete</button>` : ""}</div>
        </div>`).join("")}</div>`).join("")}
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel" id="pl-form"><h3>Run a pipeline</h3><div class="empty">Pick a pipeline on the left.</div></div>
      <div class="panel"><h3>Recent pipeline runs</h3>${runs.slice(0, 10).map((r) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(r.name)}</span><span class="dim" style="margin-left:auto">${ago(r.startedAt)} ago</span></div>`).join("") || `<div class="dim small">None yet.</div>`}</div>
    </div>
  </div>`;
  view.querySelectorAll("[data-pl]").forEach((c) => c.addEventListener("click", (e) => { if (e.target.closest("[data-del]")) return; showForm(view, list.find((p) => p.id === c.dataset.pl)); }));
  view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async (e) => { e.stopPropagation(); if (!confirm("Delete this pipeline?")) return; await api(`/pipelines/${b.dataset.del}`, { method: "DELETE" }); renderTab(view); }));
  view.querySelector("#pl-new").addEventListener("click", () => newFromMission(view));
}

function showForm(view, p) {
  const box = view.querySelector("#pl-form");
  box.innerHTML = `<h3>${esc(p.icon || "✦")} ${esc(p.name)}</h3>
    <div class="muted small" style="margin-bottom:8px">${esc(p.description || "")}</div>
    ${(p.inputs || []).map((i) => `<label class="lbl">${esc(i.label)}</label>${i.multiline ? `<textarea data-in="${esc(i.key)}" placeholder="${esc(i.placeholder || "")}" style="min-height:90px"></textarea>` : `<input type="text" data-in="${esc(i.key)}" placeholder="${esc(i.placeholder || "")}">`}`).join("")}
    <label class="lbl">Project</label><select id="pl-proj">${projectOptions(S.project)}</select>
    <label class="lbl">When</label><div class="seg" id="pl-when"><button data-m="now" class="on">Now</button><button data-m="offpeak">Off-peak</button></div>
    <div class="route" style="margin-top:10px"><b>Steps</b><ol style="margin:6px 0 0 18px;padding:0" class="small">${p.steps.map((s) => `<li>${esc(s.title)} <span class="dim">· ${esc(s.capability)}</span></li>`).join("")}</ol></div>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="pl-run">Run pipeline</button><span class="dim small">${p.steps.length} tasks · QA ${p.qa === false ? "off" : "on"} · cap $${p.budgetUsd || 3}</span></div>`;
  let when = "now";
  box.querySelector("#pl-when").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; when = b.dataset.m; box.querySelectorAll("#pl-when button").forEach((x) => x.classList.toggle("on", x === b)); });
  box.querySelector("#pl-run").addEventListener("click", async () => {
    const values = {}; box.querySelectorAll("[data-in]").forEach((i) => { values[i.dataset.in] = i.value.trim(); });
    const projectId = box.querySelector("#pl-proj").value || null;
    try {
      const r = await api("/pipelines/run", { method: "POST", body: { id: p.id, values, projectId, runAt: when } });
      toast(r.scheduled ? `Queued for ${new Date(r.scheduled.scheduledFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${r.scheduled.reason}` : `Running: ${r.goal}`);
      go("command");
    } catch (e) { toast(e.message, true); }
  });
}

async function newFromMission(view) {
  const last = S.missions.find((m) => m.kind === "mission" && (m.status === "done" || m.status === "done-with-errors"));
  if (!last) return toast("Run a mission first; then it can be saved as a pipeline.", true);
  let full; try { full = await api(`/missions/${last.id}`); } catch (e) { return toast(e.message, true); }
  const name = prompt("Name this pipeline", full.title || "My pipeline"); if (!name) return;
  const idx = Object.fromEntries((full.tasks || []).map((t, i) => [t.id, i + 1]));
  const steps = (full.tasks || []).map((t) => ({ title: t.title, capability: t.capability, deps: (t.deps || []).map((d) => idx[d]).filter(Boolean), instructions: t.instructions || t.title, deliverable: t.deliverable || "" }));
  try { await api("/pipelines/save", { method: "POST", body: { name, description: `Saved from "${full.title}"`, category: "Custom", steps, assembly: full.plan?.assembly || "", mode: full.mode, qa: full.qa } }); toast("Pipeline saved"); renderTab(view); }
  catch (e) { toast(e.message, true); }
}

CC.register({
  id: "pipelines",
  tab: { label: "Pipelines", short: "Pipelines", icon: "⛓", order: 15, render: renderTab },
  command: { order: 5, render(el) {
    el.innerHTML = `<div class="row small" style="margin-top:8px"><span class="dim">Or run a saved pipeline:</span><button class="btn sm" id="pl-open">Pipelines →</button></div>`;
    el.querySelector("#pl-open").addEventListener("click", () => go("pipelines"));
  } },
});
