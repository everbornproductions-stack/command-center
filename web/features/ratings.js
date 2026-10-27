// Thumbs up / down under every finished deliverable, per AI that contributed.
import { contributors, preferLine } from "./ratings-rows.js";

const { S, api, toast, esc, pname, pcolor } = window.CC;

export { contributors, preferLine };

export const WRONG_REASONS = [["wrong step", "A step was wrong"], ["cut off", "It was cut off"], ["wrong topic", "It was about something else"], ["not what i asked", "Not what I asked for"], ["file missing", "The content is good, the file is missing"], ["other", "Something else"]];
// one thumb for the whole run: "Is this usable?" On a thumbs down the person says why, and which step if one was wrong.
function resultRow(run, existing, list) {
  const r = existing.find((x) => x.scope === "result");
  const steps = list.filter((c) => c.stepId && !/:qa$|^assembly$/.test(c.stepId));
  return `<div class="route" id="rt-result" style="margin-top:10px"><div class="row small" style="gap:8px">
    <b style="flex:1">Is this usable?</b>
    <button class="btn sm" type="button" data-result-up>${r?.up === true ? "Yes, usable (chosen)" : "Yes, usable"}</button>
    <button class="btn sm" type="button" data-result-down>${r && r.up === false ? "No (chosen)" : "No"}</button>
    <span class="chip ${r ? (r.up ? "green" : "red") : ""}">${r ? (r.up ? "usable" : "not usable") : "not rated"}</span></div>
    <div class="row small" id="rt-why" hidden style="gap:8px;margin-top:6px;flex-wrap:wrap">
      <label>Why <select id="rt-reason">${WRONG_REASONS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>
      <label id="rt-step-wrap">Which step <select id="rt-step">${steps.map((c) => `<option value="${esc(c.stepId)}">${esc(c.label)}</option>`).join("")}</select></label>
      <button class="btn sm primary" type="button" id="rt-why-send">Send</button></div></div>`;
}
function wireResult(el, run, list, existing) {
  const box = el.querySelector("#rt-result");
  if (!box) return;
  const save = async (body) => { try { await api("/ratings", { method: "POST", body: { missionId: run.id, kind: run.kind, scope: "result", ...body } }); toast(body.up ? "Thanks. Marked as usable." : "Noted. Thank you."); render(el, run); } catch (e) { toast(e.message, true); } };
  box.querySelector("[data-result-up]")?.addEventListener("click", () => {
    save({ up: true });
    showPreference(el, run.classification?.capability || run.mission?.classification?.capability || run.council?.classification?.capability || "writing", list, existing, true);
  });
  const why = box.querySelector("#rt-why");
  box.querySelector("[data-result-down]")?.addEventListener("click", () => { why.hidden = false; box.querySelector("#rt-reason")?.focus(); });
  const reason = box.querySelector("#rt-reason"), stepWrap = box.querySelector("#rt-step-wrap");
  const syncStep = () => { if (stepWrap) stepWrap.hidden = reason.value !== "wrong step"; };
  reason?.addEventListener("change", syncStep); syncStep();
  box.querySelector("#rt-why-send")?.addEventListener("click", async () => {
    const wrong = reason.value === "wrong step" ? box.querySelector("#rt-step")?.value || "" : "";
    const note = el.querySelector("#rt-note")?.value || "";
    await save({ up: false, reason: reason.value, wrongStep: wrong || undefined, note });
    showPreference(el, run.classification?.capability || run.mission?.classification?.capability || run.council?.classification?.capability || "writing", list, existing, false);
    // the step that was wrong also gets its own thumbs down
    const c = wrong && list.find((x) => x.stepId === wrong);
    if (c) { try { await api("/ratings", { method: "POST", body: { missionId: run.id, kind: run.kind, provider: c.provider, model: c.model, capability: c.capability || "writing", stepId: c.stepId, stepKind: c.stepKind || undefined, up: false, note: "wrong step" } }); } catch { /* the whole-result thumb is already saved */ } }
  });
}

async function showPreference(el, cap, ran = [], existing = [], explicitUp = null) {
  const box = el.querySelector("#rt-prefer");
  if (!box) return;
  try {
    const sum = await api("/ratings/summary");
    if ((sum.count || 0) < 5) { box.textContent = ""; return; }
    const pick = await api(`/brain/pick?capability=${encodeURIComponent(cap || "writing")}`);
    const top = pick.ranked?.[0];
    const hasDown = existing.some((x) => x.up === false);
    const hasUp = explicitUp !== null ? explicitUp : existing.some((x) => x.up === true);
    const up = hasUp && !hasDown;
    box.textContent = preferLine({ up, ran, top });
  } catch { box.textContent = ""; }
}
async function render(el, run) {
  if (!run || !run.id) { el.innerHTML = ""; return; }
  const list = contributors(run, pname);
  // 0.4.21 (dogfood 10): a run that was stopped or errored keeps its rating rows, and says it did not finish
  const st = run.status || run.mission?.status || "";
  const unfinished = ["aborted", "failed", "done-with-errors", "cancelled"].includes(st);
  if (!list.length && !(unfinished && run.kind === "mission")) { el.innerHTML = ""; return; }
  let existing = []; try { existing = await api(`/ratings/mission/${run.id}`); } catch {}
  const pid = run.mission?.projectId || run.council?.projectId || null;
  const cap = run.classification?.capability || run.mission?.classification?.capability || run.council?.classification?.capability || "writing";
  el.innerHTML = `<div class="route" style="margin-top:12px">${unfinished ? `<div class="small" id="rt-unfinished" role="status" style="margin-bottom:6px"><b>${st === "aborted" || st === "cancelled" ? "Stopped before it finished." : st === "failed" ? "This run did not finish." : "Finished with problems."}</b> ${list.length ? "You can still rate the steps that ran." : "No step finished, but you can still say whether this was usable."}</div>` : ""}<div class="small muted" style="margin-bottom:6px">Rate the result. This teaches the router who to pick next time.</div>
    ${list.map((c) => { const r = existing.find((x) => !x.scope && (c.stepId ? x.stepId === c.stepId : x.model === c.model)); return `<div class="row small" style="padding:4px 0" data-model="${esc(c.model)}" data-provider="${esc(c.provider)}" data-cap="${esc(c.capability || cap)}" data-step="${esc(c.stepId || "")}" data-stepkind="${esc(c.stepKind || "")}">
      <span class="dot" style="background:${pcolor(c.provider)}"></span><span style="flex:1">${esc(c.label)}</span>
      <button class="ghost" data-up title="Good">${r?.up ? "👍" : "👍🏻"} Good</button><button class="ghost" data-down title="Not good">${r && !r.up ? "👎" : "👎🏻"} Not good</button>
      <span class="chip ${r ? (r.up ? "green" : "red") : ""}" style="min-width:52px;justify-content:center">${r ? (r.up ? "good" : "poor") : "not rated"}</span></div>`; }).join("")}
    <input type="text" id="rt-note" placeholder="optional: what was good or wrong" style="margin-top:6px">
    ${run.kind === "mission" ? resultRow(run, existing, list) : ""}
    ${pid && existing.some((x) => x.up) ? `<div class="row small" style="margin-top:6px"><button class="btn sm" id="rt-winner" title="Adds one line to this project's memory, so later prompts for the project learn from it">Keep as a past winner for this project</button></div>` : ""}
    <div id="rt-prefer" class="hint" role="status"></div></div>`;
  el.querySelector("#rt-winner")?.addEventListener("click", async () => {
    const good = existing.filter((x) => x.up).map((x) => list.find((c) => c.model === x.model)?.label || x.model);
    const note = existing.find((x) => x.up && x.note)?.note;
    const text = `"${(run.mission?.title || run.mission?.prompt || run.council?.prompt || "this result").slice(0, 90)}" by ${good.join(", ")}${note ? `: ${note}` : ""}`;
    try { await api("/memory/winner", { method: "POST", body: { projectId: pid, text } }); toast("Saved to this project's past winners"); } catch (e) { toast(e.message, true); }
  });
  showPreference(el, cap, list, existing);
  wireResult(el, run, list, existing);
  el.querySelectorAll("[data-model]").forEach((row) => {
    const send = async (up) => {
      try {
        await api("/ratings", { method: "POST", body: { missionId: run.id, kind: run.kind, provider: row.dataset.provider, model: row.dataset.model, capability: row.dataset.cap, up, note: el.querySelector("#rt-note").value, stepId: row.dataset.step || undefined, stepKind: row.dataset.stepkind || undefined } });
        toast(up ? "Thanks. The router will favour it for this kind of work." : "Noted. The router will lean away from it for this.");
        showPreference(el, cap, list, existing, up);
        render(el, run);
      } catch (e) { toast(e.message, true); }
    };
    row.querySelector("[data-up]").addEventListener("click", () => send(true));
    row.querySelector("[data-down]").addEventListener("click", () => send(false));
  });
}

function renderSettings(el) {
  el.innerHTML = `<div class="panel"><h3>What your ratings taught</h3>
    <div class="small">Thumbs up and thumbs down change who gets the next job of that kind. Council votes stay separate. Reset clears only the thumbs.</div>
    <div id="rt-learned" class="small" style="margin-top:8px">Loading...</div>
    <button class="btn sm" id="rt-reset" type="button" style="margin-top:8px">Reset ratings</button>
  </div>`;
  const box = el.querySelector("#rt-learned");
  const paint = (view) => {
    const lines = [...(view?.lines || []), ...(view?.early || [])];
    box.innerHTML = lines.length ? lines.map((l) => `<div>${esc(l.note)}</div>`).join("") : `<div class="dim">No ratings yet.</div>`;
  };
  api("/ratings/learned").then(paint).catch((e) => { box.textContent = e.message; });
  el.querySelector("#rt-reset").addEventListener("click", async () => {
    if (!(await window.CC.confirm("Clear what your ratings taught? Council scores stay. Runs and the ledger stay.", { danger: true, ok: "Clear" }))) return;
    try {
      paint(await api("/ratings/reset", { method: "POST", body: { confirm: true } }));
      toast("Ratings reset. Council scores stay.");
    } catch (e) { toast(e.message, true); }
  });
}

CC.register({
  id: "ratings",
  deliverable: { order: 20, render },
  settings: { order: 40, render: renderSettings },
});
