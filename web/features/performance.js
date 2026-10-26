// Settings > Performance. Loaded only when Settings is opened.
const { api, toast, esc } = window.CC;

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1000000000) {
    const s = (n / 1000000000).toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s} GB`;
  }
  if (n >= 1000000) return `${Math.round(n / 1000000)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${Math.round(n)} B`;
}

async function renderPanel(el) {
  el.innerHTML = `<div class="panel" id="perf-panel">
    <h3>Performance</h3>
    <label class="row" style="gap:8px;align-items:flex-start">
      <input type="checkbox" id="perf-light" style="margin-top:3px">
      <span><b>Light mode</b> for an older PC<div class="dim small">Slows background checks, turns off motion, and leaves extra panels off the home screen. Chats, keys, and projects stay. A schedule still waits until you approve it.</div></span>
    </label>
    <p class="dim small" style="margin:8px 0 0"><button type="button" class="btn sm" id="perf-help">How this stays fast</button></p>
    <h3 style="margin-top:16px">Add-ons</h3>
    <p class="dim small">These tools are not in the installer. The size is shown first. Nothing downloads until you click Install. Until then, Meldmind uses a connected AI when it can.</p>
    <div id="perf-addons"><div class="dim small">Loading add-ons...</div></div>
  </div>`;
  const box = el.querySelector("#perf-light");
  const list = el.querySelector("#perf-addons");
  el.querySelector("#perf-help").addEventListener("click", () => window.CC.openHelp?.("stay-light"));

  let light = !!window.CC.S?.settings?.lightMode;
  box.checked = light;
  box.addEventListener("change", async () => {
    box.disabled = true;
    try {
      const saved = await api("/perf/light", { method: "POST", body: { on: box.checked } });
      light = !!saved.lightMode;
      const S = window.CC.S;
      S.settings = { ...(S.settings || {}), lightMode: light };
      toast(light ? "Light mode on" : "Light mode off");
      window.CC.render?.();
    } catch (e) {
      box.checked = light;
      toast(e.message, true);
    } finally {
      box.disabled = false;
    }
  });

  async function load() {
    const data = await api("/perf");
    light = !!data.lightMode;
    box.checked = light;
    const S = window.CC.S;
    if (S.settings) S.settings.lightMode = light;
    const rows = data.addons || [];
    if (!rows.length) {
      list.innerHTML = `<div class="dim small">No add-ons are listed.</div>`;
      return;
    }
    list.innerHTML = rows.map((a) => {
      const onDisk = a.installed ? `On this PC, ${formatBytes(a.installedBytes)}.` : "Not installed.";
      const route = a.route === "local" ? "Using the copy on this PC." : esc(a.cloud || "Using a connected AI.");
      const install = a.installed
        ? ""
        : `<button type="button" class="btn sm" data-install="${esc(a.id)}">Install, ${esc(a.sizeLabel || "")}</button>`;
      const remove = a.installed || a.approved
        ? `<button type="button" class="btn sm" data-remove="${esc(a.id)}">Remove</button>`
        : "";
      return `<div class="route" data-addon="${esc(a.id)}" style="margin-top:8px">
        <div class="row" style="gap:8px;flex-wrap:wrap"><b>${esc(a.name)}</b><span class="dim small">${esc(a.sizeLabel || "")}</span></div>
        <div class="dim small" style="margin-top:4px">${esc(a.summary || "")}</div>
        <div class="small" style="margin-top:4px">${esc(onDisk)} ${route}</div>
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">${install}${remove}</div>
      </div>`;
    }).join("");
  }

  list.addEventListener("click", async (ev) => {
    const install = ev.target.closest("[data-install]");
    const remove = ev.target.closest("[data-remove]");
    if (install) {
      install.disabled = true;
      try {
        const row = await api(`/perf/addons/${encodeURIComponent(install.dataset.install)}`, { method: "POST", body: { approve: true } });
        toast(row.message || `${row.name || "Add-on"}: ${row.installed ? "installed" : "saved"}`);
        await load();
      } catch (e) {
        toast(e.message, true);
        install.disabled = false;
      }
      return;
    }
    if (remove) {
      const name = remove.closest("[data-addon]")?.querySelector("b")?.textContent || "this add-on";
      if (!(await window.CC.confirm(`Remove ${name} from this PC?`, { danger: true, ok: "Remove" }))) return;
      remove.disabled = true;
      try {
        await api(`/perf/addons/${encodeURIComponent(remove.dataset.remove)}`, { method: "DELETE" });
        toast("Removed");
        await load();
      } catch (e) {
        toast(e.message, true);
        remove.disabled = false;
      }
    }
  });

  try { await load(); }
  catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

window.CC.register({
  id: "performance",
  settings: { order: 15, render: renderPanel },
});
