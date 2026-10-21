// Settings list for an app Meldmind may use after Antigravity. Allow is per app.
const { api, toast, esc } = window.CC;

const PRO_LINE = "Desktop control is part of Pro. Add a licence key in Settings.";

function row(app) {
  return `<label class="row small" style="gap:8px;padding:4px 0">
    <input type="checkbox" data-door="${esc(app.id)}" ${app.allowed ? "checked" : ""}>
    <span><b>${esc(app.name)}</b> <span class="dim">${esc(app.kind)}</span> ${app.lastActivity ? `<span class="dim">${esc(app.lastActivity)}</span>` : ""}</span>
  </label>`;
}

async function paint(root) {
  let st = { pro: false, apps: [], note: PRO_LINE };
  try { st = await api("/desktop-doors"); } catch (e) { toast(e.message, true); }
  if (!st.pro) {
    root.innerHTML = `<div class="panel" id="desktop-doors"><h3>Desktop doors</h3><div class="dim small">${PRO_LINE} Google Antigravity stays the first app. Nothing runs until you allow an app.</div></div>`;
    return;
  }
  root.innerHTML = `<div class="panel" id="desktop-doors"><h3>Desktop doors</h3>
    <div class="dim small">After Antigravity, you can allow a website, a Windows program, or an MCP server. Send, buy, and delete wait for a second click. Passwords are not stored. Stop ends the step.</div>
    <div id="door-rows" style="margin-top:8px">${(st.apps || []).map(row).join("") || `<div class="dim small">No extra apps yet.</div>`}</div>
    <div class="row" style="gap:8px;margin-top:8px">
      <input id="door-name" placeholder="App name" style="flex:1">
      <button class="btn sm" id="door-add" type="button">Add app</button>
    </div>
    ${st.using ? `<div class="dim small" style="margin-top:8px">Meldmind is using ${esc(st.using.name)}. <button class="btn sm" id="door-stop" type="button">Stop</button></div>` : ""}
  </div>`;
  root.querySelector("#door-add")?.addEventListener("click", async () => {
    try {
      await api("/desktop-doors/apps", { method: "POST", body: { name: root.querySelector("#door-name").value, kind: "desktop" } });
      paint(root);
    } catch (e) { toast(e.message, true); }
  });
  root.querySelectorAll("[data-door]").forEach((box) => {
    box.addEventListener("change", async () => {
      try {
        await api("/desktop-doors/allow", { method: "POST", body: { id: box.dataset.door, allowed: box.checked } });
        paint(root);
      } catch (e) { toast(e.message, true); box.checked = !box.checked; }
    });
  });
  root.querySelector("#door-stop")?.addEventListener("click", async () => {
    try { await api("/desktop-doors/stop", { method: "POST", body: { id: st.using.appId } }); paint(root); }
    catch (e) { toast(e.message, true); }
  });
}

window.CC.register({
  id: "desktop-doors",
  settings: { order: 46, render(container) { const root = document.createElement("div"); container.appendChild(root); paint(root); } },
});
