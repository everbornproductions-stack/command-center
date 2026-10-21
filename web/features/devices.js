// Settings > Devices. The licence server is the list of computers on this key.
// Removing one is a click. Nothing is removed until the person confirms.
const { S, api, toast, esc, refresh } = window.CC;

const PLATFORMS = { win32: "Windows", windows: "Windows", darwin: "Mac", mac: "Mac", linux: "Linux", web: "Web", android: "Android", ios: "iPhone" };

function platformLabel(p) {
  const key = String(p || "").toLowerCase();
  return PLATFORMS[key] || (p ? String(p) : "Computer");
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function panel(inner) {
  return `<div class="panel" id="settings-devices"><h3>Devices</h3>${inner}</div>`;
}

function html(data) {
  const cap = Number(data?.maxDevices) > 0 ? Number(data.maxDevices) : 2;
  const intro = `<div class="small muted">A key works on ${cap} computer${cap === 1 ? "" : "s"}: a PC and a laptop. Remove one here to free a spot. Each person has their own key. An Extreme team seat is its own key, with its own ${cap} computer${cap === 1 ? "" : "s"}.</div>`;
  if (data?.message && !(data.devices || []).length) {
    return panel(`${intro}<div class="small" style="margin-top:8px">${esc(data.message)}</div>`);
  }
  const rows = (data.devices || []).map((d) => {
    const name = d.name || platformLabel(d.platform);
    const here = d.thisComputer ? `<span class="chip">This computer</span>` : "";
    const seen = when(d.lastSeen);
    return `<div class="row" style="margin-top:8px;gap:8px;align-items:center">
      <span style="flex:1">${esc(name)} <span class="dim small">${esc(platformLabel(d.platform))}${seen ? ` · ${esc(seen)}` : ""}</span> ${here}</span>
      <button type="button" class="btn sm" data-dev-remove="${esc(d.deviceId)}" data-dev-name="${esc(name)}" data-dev-here="${d.thisComputer ? "1" : "0"}">Remove</button>
    </div>`;
  }).join("");
  const empty = rows ? "" : `<div class="dim small" style="margin-top:8px">No computers registered yet. Activate the key on a computer to add it.</div>`;
  const note = data?.message ? `<div class="dim small" style="margin-top:8px">${esc(data.message)}</div>` : "";
  return panel(`${intro}${rows}${empty}${note}`);
}

function wire(el) {
  el.querySelectorAll("[data-dev-remove]").forEach((b) => b.addEventListener("click", async () => {
    const name = b.dataset.devName || "this computer";
    const here = b.dataset.devHere === "1";
    const q = here
      ? "Remove this computer from the key? This computer drops to Free until you activate the key again."
      : `Remove ${name} from this key? That computer will need the key again.`;
    if (!confirm(q)) return;
    b.disabled = true;
    try {
      const r = await api("/license/devices/remove", { method: "POST", body: { deviceId: b.dataset.devRemove } });
      if (r.license) S.license = r.license;
      toast(r.message || "Removed");
      if (refresh) await refresh();
      else renderSettings(el);
    } catch (e) {
      toast(e.message, true);
      b.disabled = false;
    }
  }));
}

async function renderSettings(el) {
  el.innerHTML = panel(`<div class="dim small">Loading computers...</div>`);
  let data;
  try { data = await api("/license/devices"); }
  catch (e) { data = { devices: [], message: e.message || "Could not load the computers on this key.", maxDevices: S.license?.maxDevices || 2 }; }
  if (!el.isConnected) return;
  el.innerHTML = html(data);
  wire(el);
}

window.CC.register({
  id: "devices",
  settings: { order: 1, render: renderSettings },
});
