// Google Antigravity card. Install, sign-in, and a task each take a click.
// The password never comes through Meldmind. The manual handoff stays available.
const { api, toast, esc } = window.CC;
let settingsEl = null;

const css = `
.cc-agy { border: 1px solid var(--line); border-left: 3px solid #34d399; border-radius: 10px; padding: 10px 12px; }
.cc-agy .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
`;
const style = document.createElement("style");
style.id = "cc-agy-style";
style.textContent = css;
document.head.appendChild(style);

async function renderSettings(el) {
  settingsEl = el;
  if (window.CC.S?.license?.limits?.desktop !== true) {
    el.innerHTML = `<div class="panel" id="prov-antigravity"><h3>Google Antigravity</h3><div class="dim small">Desktop control is part of Pro. Add a license key in Settings.</div></div>`;
    return;
  }
  el.innerHTML = `<div class="panel" id="prov-antigravity"><h3>Google Antigravity</h3><div class="dim small">Checking this PC...</div></div>`;
  let data = null;
  try { data = await api("/antigravity"); } catch (e) {
    el.innerHTML = `<div class="panel" id="prov-antigravity"><h3>Google Antigravity</h3><div class="dim small">${esc(e.message)}</div></div>`;
    return;
  }
  const c = data.card || {};
  const isConnected = !!(c.found && c.light === "green");
  const isInstalled = !!c.found;
  const jobs = (data.jobs || []).slice(0, 5).map((j) => `<div class="small" style="margin-top:4px"><b>${esc(j.status)}</b> ${esc(j.task || "")}${j.error ? ` <span style="color:var(--red)">${esc(j.error)}</span>` : ""}${j.text ? `<div class="dim">${esc(j.text.slice(0, 240))}</div>` : ""}</div>`).join("");
  el.innerHTML = `<div class="panel" id="prov-antigravity"><h3>Google Antigravity ${isConnected ? '<span class="chip green" id="agy-connected-badge">Connected</span>' : ""}<span class="right"><span class="light ${esc(c.light || "grey")}" style="display:inline-block;width:8px;height:8px;border-radius:50%"></span> ${esc(c.detail || "")}</span></h3>
    <div class="small muted">Antigravity runs on this PC through its agy command. Meldmind does not store a password, and it never puts a key on the command line. If agy cannot run, use the manual handoff instead.</div>
    <div class="cc-agy" style="margin-top:10px">
      <label class="row small"><input type="checkbox" id="agy-allow" ${c.allowed ? "checked" : ""}> Allow Meldmind to hand coding tasks to Antigravity</label>
      <div class="row" style="margin-top:8px">
        <button class="btn sm primary" id="agy-install" type="button" ${isInstalled ? "hidden disabled" : ""}>${isInstalled ? "Installed" : "Install and connect"}</button>
        <button class="btn sm" id="agy-signin" type="button" ${isConnected ? "hidden" : ""}>Sign in</button>
        <button class="btn sm" id="agy-check" type="button">Check</button>
        <button class="btn sm" id="agy-mcp" type="button">Add to Antigravity</button>
        <button class="btn sm" id="agy-handoff" type="button">Manual handoff</button>
      </div>
      <div class="dim small" style="margin-top:6px">Install and connect runs Google's installer, then opens sign-in in your browser. You sign in once. Check sends one short test task.</div>
      <label class="lbl" style="margin-top:10px">Task</label>
      <textarea id="agy-task" placeholder="What should Antigravity do?" style="width:100%;min-height:64px"></textarea>
      <div class="row" style="margin-top:6px">
        <button class="btn sm primary" id="agy-send" type="button">Send task</button>
        <button class="btn sm" id="agy-stop" type="button">Stop</button>
      </div>
      ${jobs ? `<div class="cat-h" style="margin-top:10px">Recent tasks</div>${jobs}` : ""}
    </div></div>`;
  const again = () => renderSettings(el);
  el.querySelector("#agy-allow").addEventListener("change", async (e) => {
    try { await api("/antigravity/allow", { method: "POST", body: { allow: e.target.checked } }); toast(e.target.checked ? "Antigravity is allowed" : "Antigravity will not be picked on its own"); }
    catch (err) { toast(err.message, true); }
  });
  el.querySelector("#agy-install").addEventListener("click", async () => {
    if (!window.confirm("Install Antigravity with Google's installer, then open sign-in in your browser? Meldmind does not see your password.")) return;
    try {
      const r = await api("/antigravity/install", { method: "POST", body: { confirm: true } });
      toast(r.message || "Installer finished", !r.ok);
      if (r.ok) {
        const s = await api("/antigravity/signin", { method: "POST", body: { confirm: true } });
        toast(s.message || "Sign-in opened", !s.ok);
      }
      again();
    } catch (err) { toast(err.message, true); }
  });
  el.querySelector("#agy-signin").addEventListener("click", async () => {
    try { const r = await api("/antigravity/signin", { method: "POST", body: { confirm: true } }); toast(r.message || "Sign-in opened", r.ok === false); } catch (err) { toast(err.message, true); }
  });
  el.querySelector("#agy-mcp").addEventListener("click", async () => {
    try {
      const preview = await api("/bridge/mcp");
      if (!preview.ok) return toast(preview.message || "Could not prepare that", true);
      if (!window.confirm(preview.message || "Add Meldmind to Antigravity?")) return toast("Nothing was written");
      const wrote = await api("/bridge/mcp", { method: "POST", body: { confirm: true } });
      toast(wrote.message || "Added", wrote.ok === false);
    } catch (err) { toast(err.message, true); }
  });
  el.querySelector("#agy-check").addEventListener("click", async () => {
    try { const r = await api("/antigravity/verify", { method: "POST", body: { confirm: true } }); toast(r.message || "Check started", r.ok === false); again(); } catch (err) { toast(err.message, true); }
  });
  el.querySelector("#agy-handoff").addEventListener("click", () => { window.CC.go?.("settings"); toast("Use the manual handoff for Google Antigravity. Paste the reply back yourself."); });
  el.querySelector("#agy-send").addEventListener("click", async () => {
    const task = el.querySelector("#agy-task").value.trim();
    if (!task) return toast("Type a task first", true);
    try { const r = await api("/antigravity/jobs", { method: "POST", body: { task } }); toast("Task sent to Antigravity"); el.dataset.job = r.job?.id || ""; again(); }
    catch (err) { toast(err.message, true); }
  });
  el.querySelector("#agy-stop").addEventListener("click", async () => {
    const id = el.dataset.job;
    if (!id) return toast("No task is running", true);
    try { await api(`/antigravity/jobs/${encodeURIComponent(id)}/stop`, { method: "POST" }); toast("Stop sent"); again(); }
    catch (err) { toast(err.message, true); }
  });
}

window.CC.register({
  id: "antigravity",
  settings: { order: 4, render: renderSettings },
  onEvent(ev) {
    if (ev.type === "antigravity.job" && settingsEl && window.CC.S?.view === "settings") renderSettings(settingsEl);
  },
});
