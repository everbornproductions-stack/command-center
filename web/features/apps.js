// Programs on this PC. The person turns desktop control on, allows each app, and can
// dismiss a suggestion. Nothing is installed or bought from this card.
const { api, toast, esc } = window.CC;

function safeUrl(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "https:") return "";
    return u.href;
  } catch { return ""; }
}

function priceChip(price) {
  if (price === "paid" || price === "Paid") return `<span class="chip">Paid</span>`;
  if (price === "free" || price === "Free") return `<span class="chip green">Free</span>`;
  return "";
}

const PRO_LINE = "Program scan is part of Pro. Add a licence key in Settings.";

function lockedPanel(title) {
  return `<div class="panel" id="app-discovery"><h3>${title}</h3><div class="dim small">${PRO_LINE} Nothing is installed or bought.</div></div>`;
}

function appRows(st) {
  const rows = st?.apps || [];
  if (!st?.optedIn) return `<div class="dim small">Desktop control is off. Turn it on to list programs on this PC.</div>`;
  if (!rows.length) return `<div class="dim small">No programs were found. Scan again after you install one, or update the app list.</div>`;
  return rows.map((app) => {
    const href = safeUrl(app.url);
    const caps = (app.capabilities || []).join(", ");
    return `<label class="row small" style="gap:8px;padding:4px 0;align-items:flex-start">
      <input type="checkbox" data-allow="${esc(app.id)}" ${app.allowed ? "checked" : ""} style="margin-top:3px">
      <span style="flex:1"><b>${esc(app.title)}</b> ${priceChip(app.price)} ${caps ? `<span class="dim">${esc(caps)}</span>` : `<span class="dim">no task type yet</span>`}
        ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Official site</a>` : ""}</span>
    </label>`;
  }).join("");
}

function wireAllow(root, reload) {
  root.querySelectorAll("[data-allow]").forEach((box) => {
    box.addEventListener("change", async () => {
      try { await api("/apps/allow", { method: "POST", body: { id: box.dataset.allow, allowed: box.checked } }); toast(box.checked ? "Allowed" : "Not allowed"); }
      catch (e) { toast(e.message, true); if (reload) reload(); }
    });
  });
}

function suggestionHtml(rows) {
  if (!rows?.length) return "";
  return `<div class="route" id="app-suggest-card" style="margin-top:8px">${rows.map((row) => {
    const href = safeUrl(row.url);
    return `<div class="row" data-suggest="${esc(row.id)}" style="gap:8px;align-items:flex-start;padding:4px 0">
      <div style="flex:1"><b>${esc(row.title)}</b> ${priceChip(row.price)}
        <div class="small">${esc(row.reason)}</div>
        <div class="dim small">Meldmind will not install or buy this.${href ? ` <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Official site</a>` : ""}</div>
      </div>
      <button type="button" class="btn sm" data-dismiss="${esc(row.id)}">Dismiss</button>
    </div>`;
  }).join("")}</div>`;
}

CC.register({
  id: "apps",
  command: { order: 12, render(el) {
    el.innerHTML = `<div id="app-suggest"></div>`;
    const box = el.querySelector("#app-suggest");
    const orders = document.querySelector("#orders");
    let timer = null;
    let seq = 0;
    const paint = (rows) => { box.innerHTML = suggestionHtml(rows); wireDismiss(); };
    function wireDismiss() {
      box.querySelectorAll("[data-dismiss]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try { await api("/apps/dismiss", { method: "POST", body: { id: btn.dataset.dismiss } }); await refresh(); }
          catch (e) { toast(e.message, true); }
        });
      });
    }
    async function refresh() {
      const prompt = orders?.value || "";
      const n = ++seq;
      if (prompt.trim().length < 12) { box.innerHTML = ""; return; }
      let rows = [];
      try { rows = await api(`/apps/suggestions?prompt=${encodeURIComponent(prompt)}`); } catch { rows = []; }
      if (n !== seq) return;
      paint(Array.isArray(rows) ? rows : []);
    }
    orders?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 400); });
    refresh();
  } },
  settings: { order: 18, async render(el) {
    let st = { optedIn: false, suggestions: true, apps: [], pro: false };
    try { st = await api("/apps"); } catch (e) { el.innerHTML = `<div class="panel" id="app-discovery"><h3>Programs on this PC</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
    const paint = (next) => {
      st = next || st;
      if (st.pro === false) { el.innerHTML = lockedPanel("Programs on this PC"); return; }
      el.innerHTML = `<div class="panel" id="app-discovery"><h3>Programs on this PC <span class="right">names only</span></h3>
        <label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" id="app-desktop" ${st.optedIn ? "checked" : ""} style="margin-top:3px"><span><b>Let Meldmind use your desktop</b><div class="dim small">Lists installed programs by name. On Windows that is the uninstall list and the Start menu, plus command-line tools on PATH. File contents are not read. You allow each app. Allowed apps are scored and join the router's choices, the same as a tool you add. Nothing is installed or bought.</div></span></label>
        <label class="row small" style="gap:8px;margin-top:8px"><input type="checkbox" id="app-suggest-on" ${st.suggestions ? "checked" : ""}> Suggest a program while I plan a mission or client work</label>
        <div id="app-allow" style="margin-top:10px">${appRows(st)}</div>
        <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="app-scan" ${st.optedIn ? "" : "disabled"}>Scan again</button></div>
        <div class="row" style="margin-top:10px"><input type="url" id="app-catalog" placeholder="Capability list address, https only" style="flex:1;min-width:180px"><button type="button" class="btn sm" id="app-catalog-go">Update the app list</button></div>
        <div class="dim small" style="margin-top:4px">The list is a capability catalog. Updating it does not install or buy anything. It runs only when you click the button.</div>
      </div>`;
      el.querySelector("#app-desktop").addEventListener("change", async (ev) => {
        const on = ev.target.checked;
        ev.target.disabled = true;
        try { paint(await api("/apps/opt-in", { method: "POST", body: { on } })); toast(on ? "Desktop control is on" : "Desktop control is off"); }
        catch (e) { toast(e.message, true); ev.target.checked = !on; ev.target.disabled = false; }
      });
      el.querySelector("#app-suggest-on").addEventListener("change", async (ev) => {
        try { st = await api("/apps/settings", { method: "POST", body: { suggestions: ev.target.checked } }); toast(ev.target.checked ? "Suggestions on" : "Suggestions off"); }
        catch (e) { toast(e.message, true); ev.target.checked = !ev.target.checked; }
      });
      el.querySelector("#app-scan").addEventListener("click", async () => {
        try { paint(await api("/apps/scan", { method: "POST", body: {} })); toast("Scan finished"); }
        catch (e) { toast(e.message, true); }
      });
      el.querySelector("#app-catalog-go").addEventListener("click", async () => {
        const url = el.querySelector("#app-catalog").value.trim();
        if (!url) return toast("Paste an https address first", true);
        try { paint(await api("/apps/catalog", { method: "POST", body: { url } })); toast("App list updated"); }
        catch (e) { toast(e.message, true); }
      });
      wireAllow(el, async () => { try { paint(await api("/apps")); } catch {} });
    };
    paint(st);
  } },
  setup: { order: 12, async render(el) {
    if (el.parentElement?.id === "su-extras") { el.remove(); return; }
    let st = { optedIn: false, suggestions: true, apps: [], pro: false };
    try { st = await api("/apps"); } catch (e) { el.innerHTML = `<div class="panel"><h3>Programs on this PC</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
    if (st.pro === false) { el.innerHTML = lockedPanel("Programs on this PC"); return; }
    el.innerHTML = `<div class="panel"><h3>Programs on this PC <span class="right">allow each one</span></h3>
      <div class="dim small" style="margin-bottom:8px">Allowed apps are scored and join the router's choices. Meldmind will not install or buy a program. Turn suggestions off any time in Settings.</div>
      <div id="app-setup-allow">${appRows(st)}</div>
    </div>`;
    wireAllow(el, null);
  } },
});
