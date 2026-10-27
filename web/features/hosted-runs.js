// Extreme: opt in, then hand one schedule or mission to the hosted worker.
// The header pill says "Cloud" while that job is still out. The full
// "Running in the cloud" text is in its tooltip and aria-label.
const { api, toast, esc, money } = window.CC;
const S = () => window.CC.S;
const CLOUD_LABEL = "Running in the cloud";
const CLOUD_SHORT = "Cloud";

function paintPill(data) {
  const pill = document.getElementById("cloud-pill");
  const text = document.getElementById("cloud-txt");
  if (!pill || !text) return;
  const on = !!(data && data.runningInCloud);
  pill.hidden = !on;
  const full = on ? (data.label || CLOUD_LABEL) : CLOUD_LABEL;
  text.textContent = CLOUD_SHORT;
  pill.title = full;
  pill.setAttribute("aria-label", full);
}

async function refresh() {
  try {
    const data = await api("/hosted-runs");
    paintPill(data);
    return data;
  } catch (e) {
    paintPill(null);
    return null;
  }
}

function jobLine(j) {
  const state = j.status === "queued" || j.status === "running" ? CLOUD_LABEL : (j.status || "");
  return `<div class="row small" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
    <b>${esc(j.title || j.refId || j.kind)}</b>
    <span class="dim">${esc(j.kind)}</span>
    <span class="pill ${j.status === "done" ? "green" : j.status === "stopped" || j.status === "failed" ? "red" : ""}">${esc(state)}</span>
    <span class="right dim">${j.cost ? esc(money(j.cost)) : ""}</span>
    ${j.text ? `<div class="small" style="flex-basis:100%">${esc(j.text)}</div>` : ""}
  </div>`;
}

async function renderPanel(el) {
  const data = await refresh();
  if (!data) { el.innerHTML = ""; return; }
  if (data.surface === "web") {
    el.innerHTML = `<div class="panel"><h3>Web app</h3>
      <div class="small">You are in the hosted web app. Desktop-only tools stay on the Meldmind app on your computer.</div>
    </div>`;
    return;
  }
  const hubNote = data.hub && !data.hub.ready ? `<div class="small" data-hub-soon style="margin-bottom:6px"><span class="chip">Coming soon</span> ${esc(data.hub.note)}. Until then a schedule or mission runs on this computer only.</div>` : "";
  const gate = data.allowed
    ? ""
    : `<div class="small">Running while this PC is off is part of Extreme. A schedule or mission stays on this computer until then.</div>`;
  const opt = data.allowed && !data.optIn
    ? `<div class="small" style="margin-top:8px">Nothing is handed to the cloud until you turn this on.</div>
       <button class="btn sm primary" id="hr-on" type="button" style="margin-top:8px">Turn on cloud runs</button>`
    : "";
  let schedules = [];
  if (data.allowed && data.optIn) { try { schedules = (await api("/schedules")).items || []; } catch { schedules = []; } }
  const missions = (S().missions || []).filter((m) => m.kind === "mission");
  const choices = [
    ...schedules.filter((s) => s.trigger?.type !== "folder").map((s) => ({ kind: "schedule", id: s.id, title: s.name })),
    ...missions.map((m) => ({ kind: "mission", id: m.id, title: m.title || m.prompt || "Mission" })),
  ];
  const folderNote = schedules.some((s) => s.trigger?.type === "folder") ? `<div class="small dim" style="margin-top:6px">A watched folder stays on this computer.</div>` : "";
  const hand = data.allowed && data.optIn ? `<form id="hr-form" style="margin-top:10px">
      ${choices.length ? `<label class="small">Hand this off <select id="hr-pick">${choices.map((c) => `<option value="${esc(c.kind)}:${esc(c.id)}">${esc(c.kind === "mission" ? "Mission" : "Schedule")}: ${esc(c.title)}</option>`).join("")}</select></label>` : `<div class="small dim">No schedule or mission to hand off yet.</div>`}
      ${folderNote}
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
        <label class="small">Budget ($) <input id="hr-budget" type="number" min="0.01" step="0.01" value="1" style="width:90px"></label>
      </div>
      <label class="row small" style="gap:8px;margin-top:8px"><input type="checkbox" id="hr-opt"> I want this to run while this PC is off</label>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn sm primary" type="submit" ${choices.length ? "" : "disabled"}>Hand to the cloud</button>
        <button class="btn sm" id="hr-sync" type="button">Bring results back</button>
      </div>
    </form>` : "";
  const jobs = (data.jobs || []).length ? `<div style="margin-top:10px">${data.jobs.map(jobLine).join("")}</div>` : "";
  el.innerHTML = `<div class="panel" id="hosted-runs"><h3>Run while this PC is off <span class="right small dim">${data.runningInCloud ? CLOUD_LABEL : "Extreme"}</span></h3>
    ${hubNote}${gate}${opt}${hand}${jobs}
    <div class="small dim" style="margin-top:8px">Your keys are sealed on this computer. The hosted worker is the only place that opens them. A result comes back when this PC is on again.</div>
  </div>`;
  el.querySelector("#hr-on")?.addEventListener("click", async () => {
    try { await api("/hosted-runs/opt-in", { method: "POST", body: { optIn: true } }); toast("Cloud runs are on"); renderPanel(el); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelector("#hr-sync")?.addEventListener("click", async () => {
    try { const r = await api("/hosted-runs/sync", { method: "POST" }); paintPill(r); toast(r.broughtBack?.length ? "Results are back" : "Nothing new yet"); renderPanel(el); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelector("#hr-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const optIn = el.querySelector("#hr-opt").checked;
    if (!optIn) { toast("Tick the box to confirm this one.", true); return; }
    const pick = el.querySelector("#hr-pick")?.value || "";
    const split = pick.indexOf(":");
    if (split < 1) { toast("Choose a schedule or a mission.", true); return; }
    try {
      const r = await api("/hosted-runs/handoff", { method: "POST", body: { kind: pick.slice(0, split), id: pick.slice(split + 1), budgetUsd: Number(el.querySelector("#hr-budget").value), optIn: true } });
      paintPill(r);
      toast(r.runningInCloud ? CLOUD_LABEL : "Handed to the cloud");
      renderPanel(el);
    } catch (e) { toast(e.message, true); }
  });
}

window.CC.register({
  id: "hosted-runs",
  settings: { order: 8, render: renderPanel },
  onState() { refresh(); },
});
