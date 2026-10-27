// Settings > Across computers. Plain list of what works with Meldmind's cloud (report-back, Teams),
// what needs one setup step, and what still needs the Meldmind hub (coming soon). The owner also
// sees the Owner checklist: the steps only Everborn can do so that paying on the website unlocks the app.
const { api, toast, esc } = window.CC;

const WORD = { ready: "Works", needs_setup: "Needs one setup step", soon: "Coming soon" };
const COLOR = { ready: "green", needs_setup: "amber", soon: "" };

async function render(el) {
  let data;
  try { data = await api("/hub"); } catch { el.innerHTML = ""; return; }
  const feats = (data.features || []).map((f) => `<div class="row small" style="gap:8px;padding:5px 0;border-bottom:1px solid var(--line)" data-hub-feature="${esc(f.id)}">
      <b>${esc(f.name)}</b><span class="chip ${COLOR[f.state] || ""}">${esc(WORD[f.state] || f.state)}</span>
      <span class="dim" style="flex-basis:100%">${esc(f.message)}</span></div>`).join("");
  const list = data.owner && Array.isArray(data.checklist) ? `<h4 style="margin:14px 0 6px">Owner checklist</h4>
    <div class="dim small">Steps only Everborn can do. Nothing here runs by itself and nothing is billed.</div>
    ${data.checklist.map((c) => `<label class="row small" style="gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--line)" data-owner-item="${esc(c.id)}">
      <input type="checkbox" data-owner-tick="${esc(c.id)}" ${c.done ? "checked" : ""} ${c.auto ? "disabled" : ""}>
      <span><b>${esc(c.title)}</b>${c.daysLeft != null && !c.done ? ` <span class="chip amber">${c.daysLeft > 0 ? `${c.daysLeft} days left` : "past due"}</span>` : ""}<br><span class="dim">${esc(c.how)}</span></span></label>`).join("")}` : "";
  el.innerHTML = `<div class="panel" data-hub-status><h3>Across computers</h3>${feats}${list}</div>`;
  el.querySelectorAll("[data-owner-tick]").forEach((cb) => cb.addEventListener("change", async () => {
    try { await api("/hub/checklist", { method: "POST", body: { id: cb.dataset.ownerTick, done: cb.checked } }); }
    catch (e) { toast(e.message, true); cb.checked = !cb.checked; }
  }));
}

window.CC.register({ id: "hub-status", settings: { order: 47, render } });
