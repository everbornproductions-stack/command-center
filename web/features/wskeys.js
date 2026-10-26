// Per-workspace API keys (Phase 24). Settings > Workspace API keys: owners and admins save a provider key for a
// workspace; it is used only while that workspace is active (header switcher), never for Personal or another
// workspace. Keys are shown masked only.
const { api, toast, esc, ago, pname } = window.CC;

async function renderSettings(el) {
  let ws, d;
  try { ws = await api("/workspaces"); } catch { el.innerHTML = ""; return; }
  const all = [...(ws.owned || []), ...(ws.memberOf || [])].filter((w) => !w.locked);
  if (!all.length) { el.innerHTML = ""; return; }
  const pick = el.dataset.ws && all.some((w) => w.id === el.dataset.ws) ? el.dataset.ws : ws.active || all[0].id;
  try { d = await api(`/wskeys?workspace=${encodeURIComponent(pick)}`); } catch (e) { el.innerHTML = `<div class="panel"><h3>Workspace API keys</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const activeName = all.find((w) => w.id === d.active)?.name;
  el.innerHTML = `<div class="panel"><h3>Workspace API keys <span class="right">${d.active ? `active: ${esc(activeName || "a workspace")}${d.using.length ? ` · using its ${d.using.map((p) => esc(pname(p))).join(", ")} key${d.using.length === 1 ? "" : "s"}` : ""}` : "Personal: your own keys"}</span></h3>
    <div class="small muted">A key saved here is used only for calls made while that workspace is the active one in the header switcher. Personal and other workspaces never use it. For any provider without a workspace key, your own key is used. Keys are kept in the vault${window.CC.S.mode === "hosted" ? " of the hub, encrypted, and are never sent to a browser" : " on this PC"}; only owners and admins can add or remove them.</div>
    <div class="row small" style="gap:8px;margin-top:8px">Workspace <select id="wk-ws">${all.map((w) => `<option value="${esc(w.id)}" ${w.id === pick ? "selected" : ""}>${esc(w.name)} (${esc(w.role)})</option>`).join("")}</select></div>
    ${d.note ? `<div class="small" style="margin-top:6px;color:var(--amber)">${esc(d.note)}</div>` : ""}
    ${d.keys.length ? d.keys.map((k) => `<div class="row small" style="gap:8px;padding:4px 0;border-bottom:1px solid var(--line)"><b style="width:120px">${esc(k.providerName)}</b><span class="mono">${esc(k.masked)}</span><span class="dim">${k.addedBy ? `added by ${esc(k.addedBy)}` : ""}${k.updatedAt ? ` · ${esc(ago(k.updatedAt))}` : ""}</span>${d.canManage ? `<button class="ghost small" data-wk-rm="${esc(k.provider)}" style="margin-left:auto">remove</button>` : ""}</div>`).join("") : `<div class="dim small" style="margin-top:6px">No workspace keys yet: everyone uses their own.</div>`}
    ${d.canManage ? `<div class="row small" style="gap:8px;margin-top:10px;flex-wrap:wrap"><select id="wk-p">${d.providers.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select><input type="password" id="wk-key" placeholder="Paste the workspace's key" autocomplete="off" style="flex:1;min-width:200px"><button class="btn sm primary" id="wk-save">Save for this workspace</button></div>
      ${d.studio ? "" : `<div class="dim small" style="margin-top:4px">Saving workspace keys needs Studio.</div>`}` : ""}
  </div>`;
  el.querySelector("#wk-ws").addEventListener("change", (e) => { el.dataset.ws = e.target.value; renderSettings(el); });
  el.querySelector("#wk-save")?.addEventListener("click", async () => {
    const key = el.querySelector("#wk-key").value.trim(); if (!key) return toast("Paste the key first", true);
    try { const r = await api(`/wskeys/${encodeURIComponent(pick)}`, { method: "POST", body: { provider: el.querySelector("#wk-p").value, key } }); toast(`Saved for the workspace (${r.masked})`); el.dataset.ws = pick; renderSettings(el); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-wk-rm]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await window.CC.confirm(`Remove the workspace's ${pname(b.dataset.wkRm)} key? Members fall back to their own key.`, { danger: true, ok: "Remove" }))) return;
    try { await api(`/wskeys/${encodeURIComponent(pick)}/${encodeURIComponent(b.dataset.wkRm)}`, { method: "DELETE" }); toast("Removed"); renderSettings(el); } catch (e) { toast(e.message, true); }
  }));
}

window.CC.register({ id: "wskeys", settings: { order: 46, render: renderSettings } });
