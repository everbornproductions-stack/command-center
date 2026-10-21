// Thumbs up / down under every finished deliverable, per AI that contributed.
const { S, api, toast, esc, pname, pcolor } = window.CC;

function contributors(run) {
  // which AI/model produced the thing being rated
  const out = [];
  if (run.kind === "council" && run.council) {
    for (const a of Object.values(run.council.answers || {})) if (a.text) out.push({ provider: a.provider, model: a.model, label: `${pname(a.provider)} (answer ${a.letter})` });
    if (run.council.verdict?.model) out.push({ provider: run.council.verdict.provider, model: run.council.verdict.model, label: `${pname(run.council.verdict.provider)} (verdict)` });
  } else if (run.kind === "mission" && run.mission) {
    for (const t of run.mission.tasks || []) if (t.output || t.status === "done") out.push({ provider: t.provider, model: t.model, label: `${pname(t.provider)} · ${t.title}`, capability: t.capability });
    if (run.mission.assembler) out.push({ provider: run.mission.assembler.provider, model: run.mission.assembler.model, label: `${pname(run.mission.assembler.provider)} (assembly)`, capability: "writing" });
  } else {
    const a = run.primary ? run.agents[run.primary] : null;
    if (a) out.push({ provider: a.provider, model: a.model, label: pname(a.provider) });
  }
  // dedupe by model
  const seen = new Set(); return out.filter((c) => c.model && !seen.has(c.model) && seen.add(c.model));
}

async function showPreference(el, cap) {
  const box = el.querySelector("#rt-prefer");
  if (!box) return;
  try {
    const sum = await api("/ratings/summary");
    if ((sum.count || 0) < 5) { box.textContent = ""; return; }
    const pick = await api(`/brain/pick?capability=${encodeURIComponent(cap || "writing")}`);
    const top = pick.ranked?.[0];
    box.textContent = top?.name ? `Meldmind now prefers ${top.name} for this kind of work.` : "";
  } catch { box.textContent = ""; }
}
async function render(el, run) {
  if (!run || !run.id) { el.innerHTML = ""; return; }
  const list = contributors(run);
  if (!list.length) { el.innerHTML = ""; return; }
  let existing = []; try { existing = await api(`/ratings/mission/${run.id}`); } catch {}
  const pid = run.mission?.projectId || run.council?.projectId || null;
  const cap = run.classification?.capability || run.mission?.classification?.capability || run.council?.classification?.capability || "writing";
  el.innerHTML = `<div class="route" style="margin-top:12px"><div class="small muted" style="margin-bottom:6px">Rate the result. This teaches the router who to pick next time.</div>
    ${list.map((c) => { const r = existing.find((x) => x.model === c.model); return `<div class="row small" style="padding:4px 0" data-model="${esc(c.model)}" data-provider="${esc(c.provider)}" data-cap="${esc(c.capability || cap)}">
      <span class="dot" style="background:${pcolor(c.provider)}"></span><span style="flex:1">${esc(c.label)}</span>
      <button class="ghost" data-up title="Good">${r?.up ? "👍" : "👍🏻"}</button><button class="ghost" data-down title="Not good">${r && !r.up ? "👎" : "👎🏻"}</button>
      <span class="chip ${r ? (r.up ? "green" : "red") : ""}" style="min-width:52px;justify-content:center">${r ? (r.up ? "good" : "poor") : "not rated"}</span></div>`; }).join("")}
    <input type="text" id="rt-note" placeholder="optional: what was good or wrong" style="margin-top:6px">
    ${pid && existing.some((x) => x.up) ? `<div class="row small" style="margin-top:6px"><button class="btn sm" id="rt-winner" title="Adds one line to this project's memory, so later prompts for the project learn from it">Keep as a past winner for this project</button></div>` : ""}
    <div id="rt-prefer" class="hint" role="status"></div></div>`;
  el.querySelector("#rt-winner")?.addEventListener("click", async () => {
    const good = existing.filter((x) => x.up).map((x) => list.find((c) => c.model === x.model)?.label || x.model);
    const note = existing.find((x) => x.up && x.note)?.note;
    const text = `"${(run.mission?.title || run.mission?.prompt || run.council?.prompt || "this result").slice(0, 90)}" by ${good.join(", ")}${note ? `: ${note}` : ""}`;
    try { await api("/memory/winner", { method: "POST", body: { projectId: pid, text } }); toast("Saved to this project's past winners"); } catch (e) { toast(e.message, true); }
  });
  showPreference(el, cap);
  el.querySelectorAll("[data-model]").forEach((row) => {
    const send = async (up) => { try { await api("/ratings", { method: "POST", body: { missionId: run.id, kind: run.kind, provider: row.dataset.provider, model: row.dataset.model, capability: row.dataset.cap, up, note: el.querySelector("#rt-note").value } }); toast(up ? "Thanks. The router will favour it for this kind of work." : "Noted. The router will lean away from it for this."); render(el, run); } catch (e) { toast(e.message, true); } };
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
    if (!confirm("Clear what your ratings taught? Council scores stay. Runs and the ledger stay.")) return;
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
