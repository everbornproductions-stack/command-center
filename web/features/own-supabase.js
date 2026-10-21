// Decision 23. Optional advanced setting. Off by default. Not part of setup.
// The service key is sent once to the server and is never shown again.
const { api, toast, esc } = window.CC;

async function render(el) {
  let data;
  try { data = await api("/ownsupabase"); }
  catch (e) { el.innerHTML = `<div class="panel"><h3>Use your own Supabase</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  el.innerHTML = `<div class="panel"><h3>Use your own Supabase <span class="right">${data.using === "yours" ? "your project" : "Everborn"}</span></h3>
    <p class="small" style="margin:6px 0 0">${esc(data.note || "")}</p>
    <label class="row small" style="gap:8px;margin-top:10px"><input type="checkbox" id="sb-on" ${data.on ? "checked" : ""}> Use your own project</label>
    <label class="small" style="display:block;margin-top:8px">Project URL<input id="sb-url" value="${esc(data.url || "")}" placeholder="https://your-project.supabase.co" style="width:100%" autocomplete="off"></label>
    <label class="small" style="display:block;margin-top:8px">Publishable key ${data.publishableMask ? `<span class="dim">(saved ${esc(data.publishableMask)})</span>` : ""}<input id="sb-pub" type="password" placeholder="${data.publishableSet ? "Saved. Paste a new one to replace it." : "Publishable key only"}" style="width:100%" autocomplete="off"></label>
    <label class="small" style="display:block;margin-top:8px">Service key ${data.serviceKeySet ? `<span class="dim">(saved on this server)</span>` : ""}<input id="sb-svc" type="password" placeholder="Stays on the server. Never shown again." style="width:100%" autocomplete="off"></label>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn sm primary" type="button" id="sb-save">Save</button>
      <button class="btn sm" type="button" id="sb-check">Check project</button>
    </div>
    <div id="sb-out" class="small dim" style="margin-top:8px"></div>
  </div>`;
  el.querySelector("#sb-save").addEventListener("click", async () => {
    const body = { on: el.querySelector("#sb-on").checked, url: el.querySelector("#sb-url").value.trim() };
    const pub = el.querySelector("#sb-pub").value.trim();
    const svc = el.querySelector("#sb-svc").value.trim();
    if (pub) body.publishable = pub;
    if (svc) body.serviceKey = svc;
    try {
      await api("/ownsupabase", { method: "POST", body });
      toast("Saved. The normal app still uses Everborn's Supabase until this is on.");
      render(el);
    } catch (e) { toast(e.message, true); }
  });
  el.querySelector("#sb-check").addEventListener("click", async () => {
    const out = el.querySelector("#sb-out");
    try {
      const r = await api("/ownsupabase/check", { method: "POST", body: {} });
      out.textContent = r.ok ? `Reached your project (${r.status}).` : `The project answered ${r.status}.`;
    } catch (e) { out.textContent = e.message; toast(e.message, true); }
  });
}

window.CC.register({ id: "ownsupabase", settings: { order: 92, render } });
