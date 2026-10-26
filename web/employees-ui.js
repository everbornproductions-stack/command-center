// AI employees outside the Agents tab (0.4.14): the Simple chat hint ("Best helper for this"), the
// mission team picker in the Command view, and a project's team on its Projects page.
// Plain helpers: app.js passes api, esc and toast in, so tests can call the HTML builders directly.

// ---------- Simple chat: suggest the right employee for what the person typed ----------
export function employeeHintHtml({ chosen = null, suggestion = null, esc }) {
  if (chosen) {
    return `<div class="row small" style="gap:6px;flex-wrap:wrap"><span>Working with <b>${esc(chosen.name)}</b>.</span><button type="button" class="btn sm" data-emp-stop>Stop using ${esc(chosen.name)}</button></div>`;
  }
  if (!suggestion) return "";
  return `<div class="row small" style="gap:6px;flex-wrap:wrap"><span>Best helper for this: <b>${esc(suggestion.name)}</b>. <span class="dim">${esc(suggestion.oneLiner)}</span></span><button type="button" class="btn sm primary" data-emp-pick="${esc(suggestion.id)}">Use ${esc(suggestion.name)}</button></div>`;
}

// Debounced suggestions while the person types. state holds { employee } (the chosen one).
export function wireEmployeeHint({ box, input, state, api, esc, delay = 450, onPick = null }) {
  if (!box || !input) return () => {};
  let timer = null, seq = 0, last = null;
  const paint = () => {
    box.innerHTML = employeeHintHtml({ chosen: state.employee || null, suggestion: state.employee ? null : last, esc });
    box.querySelector("[data-emp-stop]")?.addEventListener("click", () => { state.employee = null; paint(); });
    box.querySelector("[data-emp-pick]")?.addEventListener("click", () => { if (last) state.employee = { id: last.id, name: last.name }; paint(); if (last && onPick) onPick(state.employee); });
  };
  const look = async () => {
    const text = input.value.trim();
    const mine = ++seq;
    if (text.length < 8) { last = null; paint(); return; }
    try {
      const r = await api(`/agents/employees/suggest?limit=1&text=${encodeURIComponent(text.slice(0, 1500))}`);
      if (mine !== seq) return;
      last = r.items?.[0] || null;
    } catch { last = null; }
    paint();
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(look, delay); });
  paint();
  if (input.value.trim()) look();
  return look;
}

// ---------- Command view: employees for a mission ----------
export function missionTeamHtml({ team = [], picked = [], suggested = [], esc }) {
  const on = new Set(picked);
  const names = team.filter((e) => on.has(e.id)).map((e) => e.name);
  const offer = suggested.filter((e) => !on.has(e.id)).slice(0, 3);
  return `<div class="route" id="emp-mission" style="margin-top:8px">
    <div class="small"><span class="muted">Employees for this mission:</span> ${names.length ? names.map((n) => `<span class="chip">${esc(n)}</span>`).join(" ") : `<span class="dim">none picked, the planner uses its own specialists</span>`}</div>
    ${offer.length ? `<div class="row small" style="gap:6px;flex-wrap:wrap;margin-top:4px"><span class="dim">Suggested:</span>${offer.map((e) => `<button type="button" class="btn sm" data-emp-suggest="${esc(e.id)}" title="${esc(e.oneLiner)}">+ ${esc(e.name)}</button>`).join("")}</div>` : ""}
    <details style="margin-top:4px"><summary class="small">Choose employees</summary>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px;margin-top:4px">${team.map((e) => `<label class="row small" style="gap:6px" title="${esc(e.oneLiner)}"><input type="checkbox" data-emp-mission="${esc(e.id)}" ${on.has(e.id) ? "checked" : ""}> ${esc(e.name)}</label>`).join("")}</div>
      <div class="small dim" style="margin-top:4px">Each step goes to the best fit and follows that employee's script. Up to 6.</div>
    </details></div>`;
}

// ---------- Projects page: the team for one project ----------
export function projectTeamHtml({ data, all = [], esc }) {
  const picked = new Set((data.saved ? data.team : data.suggested).map((e) => e.id));
  const top = data.saved ? data.team : data.suggested;
  const rest = all.filter((e) => !top.some((t) => t.id === e.id));
  const row = (e) => `<label class="row small" style="gap:6px;align-items:flex-start;padding:3px 0"><input type="checkbox" data-team="${esc(e.id)}" ${picked.has(e.id) ? "checked" : ""}> <span><b>${esc(e.name)}</b> <span class="dim">${esc(e.oneLiner)}</span></span></label>`;
  return `<h3>Team for this project</h3>
    <div class="small muted">${data.saved ? "These AI employees work on this project. Missions here start with them." : "Suggested for this project. Untick anyone you don't need, then Save."}</div>
    <div style="margin-top:6px">${top.map(row).join("")}</div>
    ${rest.length ? `<details style="margin-top:4px"><summary class="small">More employees</summary><div style="max-height:220px;overflow:auto">${rest.map(row).join("")}</div></details>` : ""}
    <div class="row" style="margin-top:8px"><button class="btn sm primary" id="team-save">${data.saved ? "Save changes" : "Save team"}</button></div>`;
}

export async function renderProjectTeam(el, project, { api, esc, toast, onSaved } = {}) {
  if (!el || !project) return;
  el.innerHTML = `<h3>Team for this project</h3><div class="dim small">Loading...</div>`;
  let data, all = [];
  try {
    data = await api(`/agents/employees/project/${encodeURIComponent(project.id)}`);
    const ov = await api("/agents/employees");
    all = [...(ov.team || []), ...(ov.library || [])];
  } catch (e) { el.innerHTML = `<h3>Team for this project</h3><div class="dim small">${esc(e.message)}</div>`; return; }
  el.innerHTML = projectTeamHtml({ data, all, esc });
  el.querySelector("#team-save").addEventListener("click", async () => {
    const ids = [...el.querySelectorAll("[data-team]:checked")].map((c) => c.dataset.team);
    try {
      const saved = await api(`/agents/employees/project/${encodeURIComponent(project.id)}`, { method: "POST", body: { ids } });
      toast(ids.length ? `Team saved: ${saved.team.map((e) => e.name).join(", ")}.` : "Team cleared.");
      onSaved?.(saved.team.map((e) => e.id));
      renderProjectTeam(el, project, { api, esc, toast, onSaved });
    } catch (e) { toast(e.message, true); }
  });
}
