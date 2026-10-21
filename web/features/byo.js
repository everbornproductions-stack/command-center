// Your apps. HighLevel tools, an MCP server by URL, and a custom webhook.
// This page never sends on its own. A change waits for Send.
const { api, toast, esc } = window.CC;

function fieldInputs(fields, prefix) {
  return (fields || []).map((f) => `<label class="lbl" for="${prefix}-${esc(f.key)}">${esc(f.label || f.key)}</label><input id="${prefix}-${esc(f.key)}" data-field="${esc(f.key)}" type="text" maxlength="2000" autocomplete="off">`).join("");
}

function renderPanel(el, data) {
  const hl = data.highlevel || { connected: false, tools: [] };
  const proNote = data.pro ? "" : `<div class="dim small" style="margin-top:6px">An MCP server by URL and a custom webhook are part of Pro. HighLevel uses the connection you already saved.</div>`;
  el.innerHTML = `<div class="panel" id="byo-root"><h3>Your apps</h3>
    <div class="small muted">Connect a HighLevel account, any MCP server by its address, or a webhook you control. Nothing is sent, charged, or changed until you click Send.</div>
    ${proNote}
    <div class="cat-h" style="margin-top:14px">HighLevel</div>
    <div class="small">${hl.connected ? `<span class="chip green">Connected</span> Contacts, invoices, and workflows can be used from here and from a council.` : `<span class="chip">Not connected</span> Add a private token and a location id under Publishing. Connect does not post.`}</div>
    <div class="grid" style="gap:8px;margin-top:8px">${(hl.tools || []).map((t) => `<div class="route" data-hl="${esc(t.id)}">
      <b>${esc(t.name)}</b> <span class="chip">${t.effect === "write" ? "Needs Send" : "Read"}</span>
      ${fieldInputs(t.fields, "hl-" + t.id)}
      <div class="row" style="gap:8px;margin-top:6px">${t.effect === "write"
        ? `<button type="button" class="btn sm" data-hl-prepare="${esc(t.id)}">Prepare</button>`
        : `<button type="button" class="btn sm" data-hl-run="${esc(t.id)}">Run</button>`}</div>
    </div>`).join("")}</div>
    <div class="cat-h" style="margin-top:14px">MCP server by URL</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
      <input id="byo-mcp-name" type="text" placeholder="Name" maxlength="60" autocomplete="off">
      <input id="byo-mcp-url" type="text" placeholder="https://example.com/mcp" autocomplete="off">
      <input id="byo-mcp-header" type="text" placeholder="Header name (optional)" autocomplete="off">
      <input id="byo-mcp-value" type="password" placeholder="Header value (optional)" autocomplete="off">
    </div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn sm primary" id="byo-mcp-add">Add server</button></div>
    <div class="dim small" style="margin-top:4px">Uses the same MCP connection as Tools. The header value stays in the vault.</div>
    ${(data.mcp || []).map((s) => `<div class="row small" style="margin-top:6px;gap:8px"><b>${esc(s.name)}</b><span class="dim mono">${esc(s.url || "")}</span><span class="chip">${esc(s.status || "")}</span><button type="button" class="btn sm" data-mcp-del="${esc(s.id)}" style="margin-left:auto">Remove</button></div>`).join("")}
    <div class="cat-h" style="margin-top:14px">Custom webhook</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
      <input id="byo-hook-name" type="text" placeholder="Name" maxlength="60" autocomplete="off">
      <input id="byo-hook-url" type="text" placeholder="https://example.com/hook" autocomplete="off">
      <input id="byo-hook-header" type="text" placeholder="Header name (optional)" autocomplete="off">
      <input id="byo-hook-value" type="password" placeholder="Header value (optional)" autocomplete="off">
      <label class="row small" style="gap:6px"><input id="byo-hook-read" type="checkbox"> Read only (no extra confirm)</label>
      <input id="byo-hook-fields" type="text" placeholder="Fields, e.g. email, note" autocomplete="off">
    </div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn sm primary" id="byo-hook-add">Save webhook</button></div>
    ${(data.hooks || []).map((h) => `<div class="route" style="margin-top:8px" data-hook="${esc(h.id)}">
      <b>${esc(h.name)}</b> <span class="chip">${h.effect === "read" ? "Read" : "Needs Send"}</span>
      <div class="dim small mono">${esc(h.url || "")}${h.headerSaved ? " · header saved" : ""}</div>
      ${fieldInputs(h.fields, "hook-" + h.id)}
      <div class="row" style="gap:8px;margin-top:6px">
        ${h.effect === "read" ? `<button type="button" class="btn sm" data-hook-run="${esc(h.id)}">Run</button>` : `<button type="button" class="btn sm" data-hook-prepare="${esc(h.id)}">Prepare</button>`}
        <button type="button" class="btn sm" data-hook-del="${esc(h.id)}">Remove</button>
      </div>
    </div>`).join("")}
    ${(data.pending || []).length ? `<div class="cat-h" style="margin-top:14px">Waiting for Send</div>${data.pending.map((p) => `<div class="row" style="gap:8px;margin-top:6px"><span>${esc(p.summary || p.name)}</span><button type="button" class="btn sm primary" data-send="${esc(p.id)}">Send</button></div>`).join("")}` : ""}
  </div>`;
  const val = (sel) => el.querySelector(sel)?.value || "";
  const argsFrom = (box) => {
    const args = {};
    box.querySelectorAll("[data-field]").forEach((i) => { if (i.value.trim()) args[i.dataset.field] = i.value; });
    return args;
  };
  async function reload(message) {
    if (message) toast(message);
    try { renderPanel(el, await api("/byo")); } catch (e) { toast(e.message, true); }
  }
  el.querySelectorAll("[data-hl-run]").forEach((b) => b.addEventListener("click", async () => {
    try { const r = await api("/byo/highlevel/run", { method: "POST", body: { tool: b.dataset.hlRun } }); toast("Read finished. Nothing was changed."); el.querySelector(`[data-hl="${b.dataset.hlRun}"]`)?.insertAdjacentHTML("beforeend", `<pre class="small" style="white-space:pre-wrap">${esc(r.text || "")}</pre>`); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll("[data-hl-prepare]").forEach((b) => b.addEventListener("click", async () => {
    const box = b.closest("[data-hl]");
    try { await api("/byo/highlevel/prepare", { method: "POST", body: { tool: b.dataset.hlPrepare, args: argsFrom(box) } }); await reload("Prepared. Click Send when you want it to go."); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelector("#byo-mcp-add").addEventListener("click", async () => {
    try {
      const r = await api("/byo/mcp", { method: "POST", body: { name: val("#byo-mcp-name"), url: val("#byo-mcp-url"), headerName: val("#byo-mcp-header"), headerValue: val("#byo-mcp-value") } });
      await reload(r.ok ? "Server added." : "Server saved. It could not be reached yet.");
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-mcp-del]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/byo/mcp/${encodeURIComponent(b.dataset.mcpDel)}`, { method: "DELETE" }); await reload("Server removed."); } catch (e) { toast(e.message, true); }
  }));
  el.querySelector("#byo-hook-add").addEventListener("click", async () => {
    const fields = val("#byo-hook-fields").split(",").map((s) => s.trim()).filter(Boolean).map((key) => ({ key, label: key }));
    try {
      await api("/byo/hooks", { method: "POST", body: { name: val("#byo-hook-name"), url: val("#byo-hook-url"), headerName: val("#byo-hook-header"), headerValue: val("#byo-hook-value"), effect: el.querySelector("#byo-hook-read").checked ? "read" : "write", fields } });
      await reload("Webhook saved. Nothing is sent until you click Send.");
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-hook-prepare]").forEach((b) => b.addEventListener("click", async () => {
    const box = b.closest("[data-hook]");
    try { await api(`/byo/hooks/${encodeURIComponent(b.dataset.hookPrepare)}/prepare`, { method: "POST", body: { args: argsFrom(box) } }); await reload("Prepared. Click Send when you want it to go."); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll("[data-hook-run]").forEach((b) => b.addEventListener("click", async () => {
    const box = b.closest("[data-hook]");
    try { await api(`/byo/hooks/${encodeURIComponent(b.dataset.hookRun)}/run`, { method: "POST", body: { args: argsFrom(box) } }); toast("Webhook ran."); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll("[data-hook-del]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/byo/hooks/${encodeURIComponent(b.dataset.hookDel)}`, { method: "DELETE" }); await reload("Webhook removed."); } catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll("[data-send]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/byo/confirm", { method: "POST", body: { id: b.dataset.send } }); await reload("Sent."); }
    catch (e) { toast(e.message, true); }
  }));
}

async function renderSettings(el) {
  el.innerHTML = `<div class="panel" id="byo-root"><h3>Your apps</h3><div class="dim small">Loading...</div></div>`;
  try { renderPanel(el, await api("/byo")); }
  catch (e) { el.innerHTML = `<div class="panel" id="byo-root"><h3>Your apps</h3><div class="dim small">${esc(e.message)}</div></div>`; }
}

window.CC.register({ id: "byo", settings: { order: 4, render: renderSettings } });
