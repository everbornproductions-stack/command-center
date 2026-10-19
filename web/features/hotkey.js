// Global hotkey quick launcher (Phase 24). Settings > Quick launcher: on/off and the shortcut (default Alt+Space).
// Press the keys in the box to record a shortcut. A shortcut Windows or another app already uses is left alone.
const { api, toast, esc } = window.CC;

// a keydown event as an Electron accelerator ("Ctrl+Shift+K"); null until a real key is pressed
function accelOf(e) {
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.metaKey) mods.push(navigator.platform.startsWith("Mac") ? "Command" : "Super");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const k = e.key;
  if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(k)) return null;
  const key = k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" }[k] || k;
  return [...mods, key].join("+");
}

async function renderSettings(el) {
  let d;
  try { d = await api("/hotkey"); } catch (e) { el.innerHTML = ""; return; }
  if (window.CC.S.mode === "hosted") { el.innerHTML = ""; return; }
  const light = !d.desktop ? "" : d.registered ? `<span class="chip green">ready: press ${esc(d.accelerator)} anywhere</span>` : d.enabled ? `<span class="chip amber">not active</span>` : `<span class="chip">off</span>`;
  el.innerHTML = `<div class="panel"><h3>Quick launcher <span class="right">${light}</span></h3>
    <div class="small muted">A global shortcut opens a small box over any app: type a question or orders, Enter sends it to Command AI (Chat or Council) and the app shows the answer. The default is ${esc(d.default)}. A shortcut that Windows or another app already uses is never taken over; pick another one then. The shortcut is released when Command AI quits.</div>
    ${d.desktop ? "" : `<div class="dim small" style="margin-top:6px">${esc(d.reason)}</div>`}
    <div class="row small" style="gap:10px;margin-top:10px;flex-wrap:wrap">
      <label class="row" style="gap:6px"><input type="checkbox" id="hk-on" ${d.enabled ? "checked" : ""}> On</label>
      <input type="text" id="hk-accel" value="${esc(d.accelerator)}" style="width:180px;font-family:var(--mono)" title="Click, then press the keys">
      <button class="btn sm primary" id="hk-save">Save</button>
      <button class="btn sm" id="hk-default">Use ${esc(d.default)}</button>
    </div>
    ${d.desktop && d.reason && !d.registered ? `<div class="small" style="margin-top:8px;color:var(--amber)">${esc(d.reason)}</div>` : ""}
    <div class="dim small" style="margin-top:6px">Windows also uses Alt+Space to open a window's own menu; while the launcher holds it, that menu is still under a right-click on the title bar.</div>
  </div>`;
  const box = el.querySelector("#hk-accel");
  box.addEventListener("keydown", (e) => { if (e.key === "Tab") return; e.preventDefault(); const a = accelOf(e); if (a) box.value = a; });
  const save = async (accelerator) => {
    try {
      const r = await api("/hotkey", { method: "POST", body: { enabled: el.querySelector("#hk-on").checked, accelerator } });
      toast(!r.enabled ? "Quick launcher off" : r.registered || !r.desktop ? `Shortcut saved: ${r.accelerator}` : r.reason || "Shortcut saved", r.enabled && r.desktop && !r.registered);
      renderSettings(el);
    } catch (e) { toast(e.message, true); }
  };
  el.querySelector("#hk-save").addEventListener("click", () => save(box.value));
  el.querySelector("#hk-default").addEventListener("click", () => save(d.default));
  el.querySelector("#hk-on").addEventListener("change", () => save(box.value));
}

window.CC.register({ id: "hotkey", settings: { order: 12, render: renderSettings } });
