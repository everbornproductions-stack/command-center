// Programs on this PC. The person turns desktop control on, allows each app, and can
// dismiss a suggestion. Nothing is installed or bought from this card.
import { allAppsAllowed, toggleAllAppsLabel } from "../nav-state.js";
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

const PRO_LINE = "Program scan is part of Pro. Add a license key in Settings.";

function lockedPanel(title) {
  return `<div class="panel" id="app-discovery"><h3>${title}</h3><div class="dim small">${PRO_LINE} Nothing is installed or bought.</div></div>`;
}


function appRows(st) {
  const rows = st?.apps || [];
  if (!st?.optedIn) return `<div class="dim small">Desktop control is off. Turn it on to list programs on this PC.</div>`;
  if (!rows.length) return `<div class="dim small">No programs were found. Scan again after you install one, or update the app list.</div>`;
  const allOn = allAppsAllowed(rows);
  const head = `<div class="row small" style="gap:8px;margin-bottom:6px;align-items:center"><span class="dim" data-allow-count>${rows.filter((a) => a.allowed).length} of ${rows.length} allowed</span>${window.CC.flag?.("flag_navstate") ? `<button type="button" class="btn sm" data-toggle-all="${allOn ? "0" : "1"}" title="Toggle All">${toggleAllAppsLabel(rows)}</button>` : ""}</div>`;
  return head + rows.map((app) => {
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
  const syncToggleBtn = () => {
    const boxes = [...root.querySelectorAll("[data-allow]")];
    if (!boxes.length) return;
    const checkedCount = boxes.filter((b) => b.checked).length;
    const allOn = checkedCount === boxes.length;
    const btn = root.querySelector("[data-toggle-all]");
    if (btn) {
      btn.dataset.toggleAll = allOn ? "0" : "1";
      btn.textContent = allOn ? "Deselect All" : "Select All";
    }
    const cnt = root.querySelector("[data-allow-count]");
    if (cnt) cnt.textContent = `${checkedCount} of ${boxes.length} allowed`;
  };
  const toggleBtn = root.querySelector("[data-toggle-all]");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", async () => {
      const next = toggleBtn.dataset.toggleAll === "1";
      try {
        await api("/apps/allow-all", { method: "POST", body: { allowed: next } });
        root.querySelectorAll("[data-allow]").forEach((b) => { b.checked = next; });
        syncToggleBtn();
        toast(next ? "All programs allowed" : "All programs deselected");
        if (reload) reload();
      } catch (e) { toast(e.message, true); if (reload) reload(); }
    });
  }
  root.querySelectorAll("[data-allow]").forEach((box) => {
    box.addEventListener("change", () => syncToggleBtn());
  });
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

// Zapier, Make, any MCP server, and webhook tools.
// Simple: Settings shows Zapier and Make (More > Connections). Expert adds MCP,
// webhook tools, and the Meldmind webhook.

function mode() {
  return window.CC.uiMode?.() || window.CC.S?.uiMode || "simple";
}

let view = null;
async function load() {
  view = await api("/apps");
  return view;
}

function gateLine(g) {
  if (!g) return "";
  if (g.unlimited) return `${esc(g.tier)} : unlimited app connections. ${g.used} connected.`;
  return `${esc(g.tier)} : ${g.used} of ${g.limit} app connections. Free includes 1. Pro includes several (5). Extreme is unlimited.`;
}

function actionList(conn) {
  const rows = conn.actions || [];
  if (!rows.length) return `<div class="small dim">No actions listed yet.${conn.lastError ? ` ${esc(conn.lastError)}` : ""}</div>`;
  return `<ul class="small" style="margin:6px 0 0;padding-left:18px">${rows.map((a) => `<li><b>${esc(a.name)}</b> ${a.needsApproval ? `<span class="chip amber">asks first</span>` : `<span class="chip green">read</span>`} <span class="dim">${esc(a.description || "")}</span></li>`).join("")}</ul>`;
}

async function signIn(id) {
  if (!id) return;
  try {
    const r = await api("/tools/oauth/start", { method: "POST", body: { id, origin: location.origin } });
    if (r.url) window.open(r.url, "_blank", "noopener");
  } catch (e) { toast(e.message, true); }
}

function field(label, name, value, type = "text") {
  return `<label class="small">${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value || "")}" autocomplete="off" style="width:100%"></label>`;
}

function expertPanel(el, { simple = false } = {}) {
  const g = view?.guide || {};
  const cons = view?.connections || [];
  el.innerHTML = `<div class="panel" id="cc-apps-panel">
    <h3>${simple ? "Zapier and Make" : "Zapier, Make, and your own tools"}</h3>
    <p class="small dim">${gateLine(view?.gate)}</p>
    <section style="margin-top:12px">
      <h4>Zapier</h4>
      <p class="small">${esc(g.zapier || "")}</p>
      <form data-kind="zapier" style="display:grid;gap:8px">
        ${field("Address", "url", view?.presets?.zapier, "url")}
        ${field("Token", "token", "", "password")}
        <button class="btn sm primary" type="submit">Connect Zapier</button>
      </form>
    </section>
    <section style="margin-top:14px">
      <h4>Make</h4>
      <p class="small">${esc(g.make || "")}</p>
      <form data-kind="make" style="display:grid;gap:8px">
        ${field("Make address or scenario webhook", "url", view?.presets?.make, "url")}
        ${field("Token or API key", "token", "", "password")}
        <button class="btn sm primary" type="submit">Connect Make</button>
      </form>
    </section>
    ${simple ? "" : `    <section style="margin-top:14px">
      <h4>Any MCP server</h4>
      <p class="small">${esc(g.mcp || "")}</p>
      <form data-kind="mcp" style="display:grid;gap:8px">
        ${field("Name", "name", "My server")}
        ${field("Address", "url", "", "url")}
        ${field("Token", "token", "", "password")}
        <button class="btn sm primary" type="submit">Add MCP server</button>
      </form>
    </section>
    <section style="margin-top:14px">
      <h4>Webhook tool</h4>
      <p class="small">${esc(g.webhook || "")}</p>
      <form data-kind="webhook" style="display:grid;gap:8px">
        ${field("Name", "name", "My webhook")}
        ${field("Address", "url", "", "url")}
        ${field("Header name", "headerName", "Authorization")}
        ${field("Header value", "headerValue", "", "password")}
        <label class="small">Input schema (JSON object)<textarea name="schema" rows="3" style="width:100%" placeholder='{"type":"object","properties":{"text":{"type":"string"}}}'></textarea></label>
        <label class="row small" style="gap:6px"><input type="checkbox" name="readOnly"> This only reads. A send, post, or charge still asks.</label>
        <button class="btn sm primary" type="submit">Add webhook tool</button>
      </form>
    </section>
    <section style="margin-top:14px" id="cc-inbound">
      <h4>Let Zapier or Make start work here</h4>
      <p class="small">${esc(g.inbound || "")}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button type="button" class="btn sm primary" id="cc-inbound-new">Create the Meldmind webhook</button>
        <button type="button" class="btn sm" id="cc-template">Show the Meldmind template</button>
        ${view?.inbound?.hasToken ? `<button type="button" class="ghost small" id="cc-inbound-clear">Remove token</button>` : ""}
      </div>
      <div class="small" id="cc-inbound-out" style="margin-top:8px;white-space:pre-wrap"></div>
    </section>`}
    <div style="margin-top:14px">${cons.map((c) => `<div class="small" style="margin-top:8px"><b>${esc(c.name)}</b> <span class="chip">${esc(c.kind)}</span> <span class="mono dim">${esc(c.url || "")}</span> <button type="button" class="ghost small" data-remove="${esc(c.id)}">Remove</button>${c.mcpServerId ? ` <button type="button" class="ghost small" data-refresh="${esc(c.id)}">Refresh</button>` : ""}${actionList(c)}</div>`).join("") || `<div class="small dim">Nothing connected yet.</div>`}</div>
  </div>`;
  el.querySelectorAll("form").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.readOnly = !!form.querySelector("[name=readOnly]")?.checked;
    const kind = form.dataset.kind;
    try {
      const r = await api(`/apps/${kind}`, { method: "POST", body: data });
      form.querySelectorAll("[type=password]").forEach((i) => { i.value = ""; });
      if (r.error) toast(r.error, true);
      else toast("Saved");
      view = r.view;
      expertPanel(el);
    } catch (err) { toast(err.message, true); }
  }));
  el.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => {
    try { view = await api(`/apps/${encodeURIComponent(b.dataset.remove)}`, { method: "DELETE" }); expertPanel(el); } catch (err) { toast(err.message, true); }
  }));
  el.querySelectorAll("[data-refresh]").forEach((b) => b.addEventListener("click", async () => {
    try {
      const r = await api(`/apps/${encodeURIComponent(b.dataset.refresh)}/refresh`, { method: "POST", body: {} });
      view = r.view;
      if (r.error) toast(r.error, true);
      expertPanel(el);
    } catch (err) { toast(err.message, true); }
  }));
  el.querySelector("#cc-inbound-new")?.addEventListener("click", async () => {
    try {
      const r = await api("/apps/inbound", { method: "POST", body: {} });
      view = r.view;
      const out = el.querySelector("#cc-inbound-out");
      const origin = location.origin;
      out.textContent = `Address: ${origin}${r.path}\nToken (shown once): ${r.token}\nPut the token in the Authorization header as Bearer. It is not saved in the page after you leave.`;
      expertPanelKeepToken(el, out.textContent);
    } catch (err) { toast(err.message, true); }
  });
  el.querySelector("#cc-template")?.addEventListener("click", async () => {
    try {
      const r = await api("/apps/template");
      const out = el.querySelector("#cc-inbound-out");
      out.textContent = JSON.stringify(r.template, null, 2);
    } catch (err) { toast(err.message, true); }
  });
  el.querySelector("#cc-inbound-clear")?.addEventListener("click", async () => {
    try { const r = await api("/apps/inbound", { method: "DELETE" }); view = r.view; expertPanel(el); } catch (err) { toast(err.message, true); }
  });
}

function expertPanelKeepToken(el, text) {
  expertPanel(el);
  const out = el.querySelector("#cc-inbound-out");
  if (out) out.textContent = text;
}

window.CC.register({
  id: "zapier",
  settings: {
    order: 16,
    async render(el) {
      try { await load(); } catch (e) { el.innerHTML = `<div class="panel"><h3>Zapier and Make</h3><div class="small">${esc(e.message)}</div></div>`; return; }
      expertPanel(el);
    },
  },
});
