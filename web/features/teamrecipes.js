// Phase 61 add-on. Shared recipes on a workspace (Extreme). Phase 8 invites are unchanged.
const { api, toast, esc } = window.CC;

async function render(el) {
  if (!el) return;
  let data;
  try { data = await api("/teamrecipes"); }
  catch (e) {
    el.innerHTML = `<div class="panel"><h3>Shared team recipes</h3><div class="small">${esc(e.message)}</div></div>`;
    return;
  }
  const rows = data.workspaces || [];
  el.innerHTML = `<div class="panel"><h3>Shared team recipes <span class="right">${data.seatCap || 5} people</span></h3>
    <p class="small" style="margin:6px 0 0">${esc(data.note || "")}</p>
    ${rows.length ? rows.map((w) => `<div style="margin-top:12px" data-team="${esc(w.id)}">
      <b>${esc(w.name)}</b> <span class="chip">${w.seats} of ${w.seatCap}${w.overCap ? " · over the cap" : ""}</span>
      <div class="small dim" style="margin-top:4px">Recipes shared here: ${(w.recipes || []).map((r) => esc(r.name)).join(", ") || "none yet"}.</div>
      <div class="small dim">Keys in the vault: ${(w.keys || []).map((k) => `${esc(k.provider)} ${esc(k.masked || "")}`).join(", ") || "none saved for this workspace"}.</div>
      <form class="row" data-share style="gap:8px;margin-top:8px;flex-wrap:wrap">
        <input data-pipe value="instagram-week" aria-label="Recipe id" style="flex:1;min-width:160px">
        <button class="btn sm" type="submit">Share recipe</button>
      </form>
    </div>`).join("") : `<div class="dim small" style="margin-top:8px">Create a workspace above, then share a recipe with it.</div>`}
  </div>`;
  el.querySelectorAll("[data-team]").forEach((row) => {
    row.querySelector("[data-share]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pipelineId = row.querySelector("[data-pipe]").value.trim();
      if (!pipelineId) return;
      try {
        await api(`/teamrecipes/${encodeURIComponent(row.dataset.team)}/recipes`, { method: "POST", body: { pipelineId } });
        toast("Recipe shared on this PC. Nothing was emailed.");
        render(el);
      } catch (err) { toast(err.message, true); }
    });
  });
}

window.CC.mountTeamSpaces = render;
window.CC.register({ id: "teamrecipes" });
