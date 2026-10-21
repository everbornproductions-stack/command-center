// MCP tool support (Phase 16).
// Settings > Tools: add MCP servers (local command, Streamable HTTP or SSE with headers or OAuth), see each
// server's tools, enable them for the current workspace, mark read-only, try one by hand.
// Command: how many tools a run gets, on / off, and the approval prompts (Allow once / Deny) for tools that write.
// Deliverable: which tools ran during the run. Secrets never reach this page: the server sends names only.
import { plainExplain, plainLabel } from "../plain.js";
const { S, api, toast, esc } = window.CC;

const css = `
#cc-mcp-approvals { position: fixed; right: 16px; bottom: 90px; z-index: 950; display: grid; gap: 10px; max-width: 440px; }
.cc-mcp-ask { background: #0f1724; border: 1px solid var(--amber, #fbbf24); border-radius: 12px; padding: 12px 14px; box-shadow: 0 12px 40px #000a; font-size: 12.5px; }
.cc-mcp-ask pre { max-height: 160px; overflow: auto; background: #0a0f18; border: 1px solid var(--line, #243044); border-radius: 8px; padding: 8px; margin: 8px 0; font-size: 11.5px; white-space: pre-wrap; word-break: break-word; }
.cc-mcp-tools { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
.cc-mcp-tools td { padding: 5px 6px; border-top: 1px solid var(--line, #243044); vertical-align: top; }
.cc-mcp-tools td.d { color: var(--muted, #8b96a8); max-width: 360px; }
.cc-mcp-srv { border: 1px solid var(--line, #243044); border-radius: 12px; padding: 10px 12px; margin-top: 10px; }
.cc-mcp-srv .hd { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cc-mcp-calls { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
`;
const style = document.createElement("style"); style.id = "cc-mcp-style"; style.textContent = css; document.head.appendChild(style);

let data = null; // last /api/mcp view
const pending = new Map(); // approval id -> info
async function load() { data = await api("/tools"); for (const p of data.pending || []) pending.set(p.id, p); return data; }
const short = (s, n = 110) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const pretty = (o) => { try { return JSON.stringify(o ?? {}, null, 2); } catch { return String(o); } };

// ---------- approval prompts ----------
function approvalsBox() {
  let box = document.getElementById("cc-mcp-approvals");
  if (!box) { box = document.createElement("div"); box.id = "cc-mcp-approvals"; document.body.appendChild(box); }
  return box;
}
function renderApprovals() {
  const box = approvalsBox();
  box.innerHTML = [...pending.values()].map((p) => `<div class="cc-mcp-ask" data-ask="${esc(p.id)}" role="alertdialog">
    <div><b>${esc(window.CC.pname(p.provider) || "An AI")}</b> wants to run <b>${esc(p.tool)}</b> on <b>${esc(p.serverName)}</b>${p.readOnly ? "" : ` <span class="chip amber">writes</span>`}</div>
    ${p.description ? `<div class="dim small" style="margin-top:4px">${esc(short(p.description, 160))}</div>` : ""}
    <pre>${esc(pretty(p.args))}</pre>
    <div class="row" style="gap:8px"><button class="btn sm primary" data-allow="${esc(p.id)}">Allow once</button><button class="btn sm" data-deny="${esc(p.id)}">Deny</button><span class="dim small" style="margin-left:auto">nothing runs until you choose</span></div>
  </div>`).join("");
  box.querySelectorAll("[data-allow],[data-deny]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.allow || b.dataset.deny;
    try { await api(`/tools/approvals/${encodeURIComponent(id)}`, { method: "POST", body: { allow: !!b.dataset.allow } }); } catch (e) { toast(e.message, true); }
    pending.delete(id); renderApprovals();
  }));
}

// ---------- Command widget ----------
async function renderCommand(el) {
  try { await load(); } catch { el.innerHTML = ""; return; }
  const d = data;
  if (!d.servers.length) { el.innerHTML = `<div class="route" style="margin-top:8px"><span class="small muted">Tools: none yet. <a href="#" id="cc-mcp-go">Add an ${esc(plainLabel("mcp"))} server in Settings</a>${d.demoAvailable ? ` or <a href="#" id="cc-mcp-demo">try the demo tools</a>` : ""}.</span><div class="hint">${esc(plainExplain("mcp"))}</div></div>`; }
  else el.innerHTML = `<div class="route" style="margin-top:8px"><div class="row small" style="gap:10px;flex-wrap:wrap"><span class="muted">Tools:</span>
      <label class="row small" style="gap:5px;cursor:pointer"><input type="checkbox" id="cc-mcp-on" ${d.settings.on ? "checked" : ""}> let AIs use them</label>
      <span class="chip ${d.enabledCount && d.settings.on ? "green" : ""}">${d.enabledCount} enabled in ${esc(d.workspace.name)}</span>
      <a href="#" id="cc-mcp-go" class="small" style="margin-left:auto">manage</a></div>
      <div class="dim small" style="margin-top:4px">Tools that write, send or delete ask for your OK each time. ${d.providers.filter((p) => !p.tools).length ? `No tools for ${esc(d.providers.filter((p) => !p.tools).map((p) => p.name).join(", "))} (no tool calling).` : ""}</div></div>`;
  el.querySelector("#cc-mcp-go")?.addEventListener("click", (e) => { e.preventDefault(); window.CC.go("settings"); setTimeout(() => document.getElementById("cc-mcp-panel")?.scrollIntoView({ behavior: "smooth" }), 200); });
  el.querySelector("#cc-mcp-demo")?.addEventListener("click", async (e) => { e.preventDefault(); try { await api("/tools/demo", { method: "POST" }); toast("Demo tools added and enabled"); renderCommand(el); } catch (err) { toast(err.message, true); } });
  el.querySelector("#cc-mcp-on")?.addEventListener("change", async (ev) => { try { data = await api("/tools/settings", { method: "POST", body: { on: ev.target.checked } }); renderCommand(el); } catch (err) { toast(err.message, true); } });
  renderApprovals();
}

// ---------- Deliverable: which tools ran ----------
function renderDeliverable(el, run) {
  const l = S.live; const calls = (l?.kind === "council" ? l.council?.toolCalls : l?.mission?.toolCalls) || [];
  if (!calls.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="cc-mcp-calls"><span class="small muted" style="width:100%">Tools used in this run</span>${calls.map((c) => `<span class="chip ${c.denied ? "amber" : c.ok ? "green" : "red"}" title="${esc(c.server || "")}${c.by ? ` · ${esc(window.CC.pname(c.by))}` : ""}">${esc(c.tool)}${c.server ? ` <span class="dim">${esc(c.server)}</span>` : ""} ${c.denied ? "denied" : c.ok ? "✓" : "error"}${c.ms ? ` ${(c.ms / 1000).toFixed(1)}s` : ""}</span>`).join("")}</div>`;
}

// ---------- Settings ----------
const TRANSPORT_LABEL = { stdio: "local command", http: "Streamable HTTP", sse: "SSE (older servers)" };
function serverCard(s, d) {
  const dot = s.status === "connected" ? "green" : s.status === "error" ? "red" : "grey";
  const remote = s.transport !== "stdio";
  const oauth = s.oauth;
  return `<div class="cc-mcp-srv" data-srv="${esc(s.id)}">
    <div class="hd"><span class="dot ${dot}"></span><b>${esc(s.name)}</b><span class="chip">${esc(TRANSPORT_LABEL[s.transport] || s.transport)}</span>${s.demo ? `<span class="chip">demo</span>` : ""}
      <span class="mono dim small" style="overflow:hidden;text-overflow:ellipsis;max-width:320px;white-space:nowrap" title="${esc(remote ? s.url : `${s.command} ${s.args.join(" ")}`)}">${esc(remote ? s.url : `${s.command} ${s.args.join(" ")}`)}</span>
      <span style="margin-left:auto" class="row small" style="gap:6px">
        ${remote && (oauth || s.lastError?.includes("Not authorized")) ? (oauth?.signedIn ? `<span class="chip green">signed in</span><button class="ghost small" data-signout="${esc(s.id)}">sign out</button>` : `<button class="btn sm" data-signin="${esc(s.id)}" title="${esc(plainExplain("oauth"))}">Sign in (${esc(plainLabel("oauth"))})</button>`) : ""}
        <button class="ghost small" data-refresh="${esc(s.id)}">refresh</button><button class="ghost small" data-edit="${esc(s.id)}">edit</button><button class="ghost small" style="color:var(--red)" data-remove="${esc(s.id)}">remove</button></span></div>
    ${s.lastError ? `<div class="small" style="color:var(--red);margin-top:4px">${esc(s.lastError)}</div>` : s.serverInfo ? `<div class="dim small" style="margin-top:4px">${esc(s.serverInfo.name || "")} ${esc(s.serverInfo.version || "")}${s.headerNames.length ? ` · headers: ${esc(s.headerNames.join(", "))} (values in the vault)` : ""}${s.envNames.length ? ` · env: ${esc(s.envNames.join(", "))} (values in the vault)` : ""}</div>` : ""}
    <div class="row small" style="gap:12px;margin-top:6px;flex-wrap:wrap">
      <label class="row small" style="gap:5px;cursor:pointer"><input type="checkbox" data-auto="${esc(s.id)}" ${s.autoReadOnly ? "checked" : ""}> run read-only tools without asking</label>
      <span class="dim">${s.enabledCount} of ${s.tools.length} tools enabled in ${esc(d.workspace.name)}</span>
      ${s.tools.length ? `<button class="ghost small" data-all="${esc(s.id)}" data-v="1">enable all</button><button class="ghost small" data-all="${esc(s.id)}" data-v="0">disable all</button>` : ""}</div>
    ${s.tools.length ? `<table class="cc-mcp-tools">${s.tools.map((t) => `<tr>
      <td><input type="checkbox" data-tool="${esc(t.name)}" data-s="${esc(s.id)}" ${t.enabled ? "checked" : ""} title="Enable for ${esc(d.workspace.name)}"></td>
      <td><b class="mono">${esc(t.name)}</b></td>
      <td class="d">${esc(short(t.description, 140))}</td>
      <td><select data-ro="${esc(t.name)}" data-s="${esc(s.id)}" style="width:auto;padding:2px 4px;font-size:11px" title="Read-only tools can run without asking when the box above is ticked; everything else asks every time">
        <option value="" ${t.override === null ? "selected" : ""}>${t.readOnlyHint ? "read-only (server says so)" : "writes (no read-only hint)"}</option>
        <option value="1" ${t.override === true ? "selected" : ""}>read-only (I say so)</option>
        <option value="0" ${t.override === false ? "selected" : ""}>writes (always ask)</option></select></td>
      <td><span class="chip ${t.needsApproval ? "amber" : "green"}">${t.needsApproval ? "asks" : "no prompt"}</span></td>
      <td><button class="ghost small" data-try="${esc(t.name)}" data-s="${esc(s.id)}">try</button></td></tr>`).join("")}</table><div class="small dim" data-out="${esc(s.id)}" style="margin-top:6px;white-space:pre-wrap"></div>` : `<div class="dim small" style="margin-top:6px">No tools listed yet${s.status === "error" ? "; fix the error above and refresh" : ""}.</div>`}
  </div>`;
}
function formHtml(f = {}) {
  const t = f.transport || "http";
  return `<div class="route" style="margin-top:10px" id="cc-mcp-form"><div class="cat-h">${f.id ? `Edit ${esc(f.name)}` : `Add an ${esc(plainLabel("mcp"))} server`}</div><div class="hint">${esc(plainExplain("mcp"))}</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
      <label class="small">Name<input type="text" id="mf-name" value="${esc(f.name || "")}" placeholder="GitHub, Notion, my files…" style="width:100%"></label>
      <label class="small">How to reach it<select id="mf-transport" style="width:100%">${Object.entries(TRANSPORT_LABEL).filter(([k]) => !(data?.hosted && k === "stdio")).map(([k, v]) => `<option value="${k}" ${t === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <div id="mf-stdio" style="grid-column:1/3;display:${t === "stdio" ? "grid" : "none"};grid-template-columns:1fr 2fr;gap:8px">
        <label class="small">Command<input type="text" id="mf-cmd" value="${esc(f.command || "")}" placeholder="npx" style="width:100%;font-family:var(--mono)"></label>
        <label class="small">Arguments<input type="text" id="mf-args" value="${esc((f.args || []).join(" "))}" placeholder="-y @modelcontextprotocol/server-filesystem C:\\Users\\me\\Documents" style="width:100%;font-family:var(--mono)"></label>
        <label class="small" style="grid-column:1/3">Environment for the command (one per line, NAME=value; stored in the vault)<textarea id="mf-env" rows="2" style="width:100%;font-family:var(--mono)" placeholder="${f.envNames?.length ? `saved: ${esc(f.envNames.join(", "))} (leave empty to keep)` : "GITHUB_TOKEN=..."}"></textarea></label>
      </div>
      <div id="mf-http" style="grid-column:1/3;display:${t === "stdio" ? "none" : "grid"};grid-template-columns:1fr;gap:8px">
        <label class="small">Server address<input type="text" id="mf-url" value="${esc(f.url || "")}" placeholder="https://mcp.example.com/mcp" style="width:100%;font-family:var(--mono)"></label>
        <label class="small">Headers (optional, one per line as Name: value; stored in the vault)<textarea id="mf-headers" rows="2" style="width:100%;font-family:var(--mono)" placeholder="${f.headerNames?.length ? `saved: ${esc(f.headerNames.join(", "))} (leave empty to keep)` : "Authorization: Bearer ..."}"></textarea></label>
        <label class="small">${esc(plainLabel("oauth"))} client ID (optional; only if the service gave you one and does not register clients itself)<input type="text" id="mf-client" value="${esc(f.oauth?.clientId || "")}" aria-label="OAuth client ID" style="width:100%;font-family:var(--mono)"></label><div class="hint">${esc(plainExplain("oauth"))}</div>
      </div>
      <label class="row small" style="gap:6px;grid-column:1/3"><input type="checkbox" id="mf-auto" ${f.autoReadOnly ? "checked" : ""}> Run this server's read-only tools without asking (tools that write always ask)</label>
    </div>
    <div class="row" style="margin-top:8px;gap:8px"><button class="btn sm primary" id="mf-save">${f.id ? "Save and reconnect" : "Add and connect"}</button><button class="btn sm" id="mf-cancel">Cancel</button><span class="small dim" id="mf-msg"></span></div>
    ${t === "stdio" || !f.transport ? `<div class="dim small" style="margin-top:6px">A local command runs on this PC with your account, like any program you start. Only add servers you trust.</div>` : ""}
  </div>`;
}
async function renderSettings(el) {
  try { await load(); } catch (e) { el.innerHTML = `<div class="panel" id="cc-mcp-panel"><h3>Tools</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const d = data;
  el.innerHTML = `<div class="panel" id="cc-mcp-panel"><h3>Tools (${esc(plainLabel("mcp"))} servers) <span class="right">${d.enabledCount} enabled in ${esc(d.workspace.name)}${d.pending.length ? ` · ${d.pending.length} waiting for your OK` : ""}</span></h3>
    <div class="hint" style="margin-bottom:8px">${esc(plainExplain("mcp"))} Enable tools per workspace (switch workspaces in the header). Calls go through this app's local server, never from the browser. Tools that write, send or delete ask for your OK every time.</div>
    <div class="row small" style="gap:12px;flex-wrap:wrap"><label class="row small" style="gap:5px;cursor:pointer"><input type="checkbox" id="mcp-on" ${d.settings.on ? "checked" : ""}> Let AIs use enabled tools</label>
      <label class="row small" style="gap:5px">Max tool rounds per answer <input type="number" id="mcp-rounds" min="1" max="20" value="${d.settings.maxRounds}" style="width:56px;padding:3px 5px"></label>
      <button class="btn sm" id="mcp-add" style="margin-left:auto">+ Add server</button>${d.demoAvailable && !d.servers.some((s) => s.demo) ? `<button class="btn sm" id="mcp-demo">Add demo tools</button>` : ""}</div>
    <div id="mcp-form-slot"></div>
    ${d.servers.map((s) => serverCard(s, d)).join("") || `<div class="empty" style="margin-top:10px">No servers yet. Add one, or try the demo tools (a clock, a word counter and a notepad that run on this PC).</div>`}
    ${d.recent.length ? `<details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Recent tool calls (${d.recent.length})</summary><table class="tbl small" style="margin-top:6px"><tbody>${d.recent.slice(0, 15).map((c) => `<tr><td class="dim mono">${new Date(c.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td><td>${esc(c.tool)}</td><td class="dim">${esc(c.serverName || "")}</td><td>${c.denied ? `<span class="chip amber">denied</span>` : c.ok ? `<span class="chip green">ok</span>` : `<span class="chip red">error</span>`}</td><td class="dim mono">${c.ms != null ? (c.ms / 1000).toFixed(1) + "s" : ""}</td><td class="dim small">${esc(c.error || "")}</td></tr>`).join("")}</tbody></table><div class="dim small">Arguments and results are not stored; only what ran and whether it worked.</div></details>` : ""}
    <div class="dim small" style="margin-top:10px">Headers, environment values and sign-in tokens are sealed in the vault and never shown again. Which AIs can call tools: ${esc(d.providers.filter((p) => p.tools).map((p) => p.name).join(", ") || "none keyed yet")}.</div>
  </div>`;
  const re = () => renderSettings(el);
  const slot = el.querySelector("#mcp-form-slot");
  const openForm = (f) => {
    slot.innerHTML = formHtml(f);
    const tsel = slot.querySelector("#mf-transport");
    tsel.addEventListener("change", () => { slot.querySelector("#mf-stdio").style.display = tsel.value === "stdio" ? "grid" : "none"; slot.querySelector("#mf-http").style.display = tsel.value === "stdio" ? "none" : "grid"; });
    slot.querySelector("#mf-cancel").addEventListener("click", () => { slot.innerHTML = ""; });
    slot.querySelector("#mf-save").addEventListener("click", async (ev) => {
      const b = ev.target; b.disabled = true; slot.querySelector("#mf-msg").textContent = "Connecting and listing tools…";
      const body = { id: f.id, name: slot.querySelector("#mf-name").value, transport: tsel.value, autoReadOnly: slot.querySelector("#mf-auto").checked };
      if (tsel.value === "stdio") { body.command = slot.querySelector("#mf-cmd").value; body.args = slot.querySelector("#mf-args").value; const env = slot.querySelector("#mf-env").value.trim(); if (env || !f.id) body.env = env; }
      else { body.url = slot.querySelector("#mf-url").value; const hd = slot.querySelector("#mf-headers").value.trim(); if (hd || !f.id) body.headers = hd; body.clientId = slot.querySelector("#mf-client").value; }
      try { const r = await api("/tools/servers", { method: "POST", body }); if (r.ok) toast(`${r.server.name}: ${r.server.tools.length} tool${r.server.tools.length === 1 ? "" : "s"} found`); else toast(`${r.server.name} saved, but: ${r.error}`, true); re(); }
      catch (e) { slot.querySelector("#mf-msg").textContent = e.message; b.disabled = false; }
    });
    slot.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  el.querySelector("#mcp-add").addEventListener("click", () => openForm({}));
  el.querySelector("#mcp-demo")?.addEventListener("click", async () => { try { await api("/tools/demo", { method: "POST" }); toast("Demo tools added and enabled"); re(); } catch (e) { toast(e.message, true); } });
  el.querySelector("#mcp-on").addEventListener("change", async (ev) => { try { await api("/tools/settings", { method: "POST", body: { on: ev.target.checked } }); } catch (e) { toast(e.message, true); } });
  el.querySelector("#mcp-rounds").addEventListener("change", async (ev) => { try { await api("/tools/settings", { method: "POST", body: { maxRounds: Number(ev.target.value) } }); toast("Saved"); } catch (e) { toast(e.message, true); } });
  el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openForm(d.servers.find((s) => s.id === b.dataset.edit) || {})));
  el.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => { const s = d.servers.find((x) => x.id === b.dataset.remove); if (!confirm(`Remove "${s?.name}"? Its headers, environment values and tokens are deleted from the vault.`)) return; try { await api(`/tools/servers/${encodeURIComponent(b.dataset.remove)}`, { method: "DELETE" }); re(); } catch (e) { toast(e.message, true); } }));
  el.querySelectorAll("[data-refresh]").forEach((b) => b.addEventListener("click", async () => { b.textContent = "…"; try { const r = await api(`/tools/servers/${encodeURIComponent(b.dataset.refresh)}/refresh`, { method: "POST" }); toast(r.ok ? `${r.server.name}: ${r.server.tools.length} tools` : r.error, !r.ok); } catch (e) { toast(e.message, true); } re(); }));
  el.querySelectorAll("[data-auto]").forEach((cb) => cb.addEventListener("change", async () => { try { await api(`/tools/servers/${encodeURIComponent(cb.dataset.auto)}/options`, { method: "POST", body: { autoReadOnly: cb.checked } }); re(); } catch (e) { toast(e.message, true); } }));
  el.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/tools/servers/${encodeURIComponent(b.dataset.all)}/tools`, { method: "POST", body: { all: b.dataset.v === "1" } }); re(); } catch (e) { toast(e.message, true); } }));
  el.querySelectorAll("[data-tool]").forEach((cb) => cb.addEventListener("change", async () => { try { await api(`/tools/servers/${encodeURIComponent(cb.dataset.s)}/tools`, { method: "POST", body: { tool: cb.dataset.tool, enabled: cb.checked } }); } catch (e) { toast(e.message, true); cb.checked = !cb.checked; } }));
  el.querySelectorAll("[data-ro]").forEach((sel) => sel.addEventListener("change", async () => { try { await api(`/tools/servers/${encodeURIComponent(sel.dataset.s)}/tools`, { method: "POST", body: { tool: sel.dataset.ro, readOnly: sel.value === "" ? null : sel.value === "1" } }); re(); } catch (e) { toast(e.message, true); } }));
  el.querySelectorAll("[data-try]").forEach((b) => b.addEventListener("click", async () => {
    const s = d.servers.find((x) => x.id === b.dataset.s); const t = s?.tools.find((x) => x.name === b.dataset.try); if (!t) return;
    const props = t.inputSchema?.properties || {};
    let args = {};
    if (Object.keys(props).length) { const ex = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.type === "number" || v.type === "integer" ? 0 : v.type === "boolean" ? false : ""])); const typed = prompt(`Arguments for ${t.name} as JSON${t.inputSchema?.required?.length ? ` (required: ${t.inputSchema.required.join(", ")})` : ""}`, JSON.stringify(ex)); if (typed === null) return; try { args = JSON.parse(typed || "{}"); } catch { return toast("That is not valid JSON", true); } }
    const out = el.querySelector(`[data-out="${CSS.escape(s.id)}"]`); out.textContent = `Running ${t.name}…`;
    try { const r = await api(`/tools/servers/${encodeURIComponent(s.id)}/call`, { method: "POST", body: { tool: t.name, args } }); out.textContent = `${t.name} ${r.ok ? "returned" : "failed"} in ${(r.ms / 1000).toFixed(1)}s:\n${r.text}`; }
    catch (e) { out.textContent = e.message; }
  }));
  el.querySelectorAll("[data-signin]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Opening…";
    try { const r = await api("/tools/oauth/start", { method: "POST", body: { id: b.dataset.signin, origin: location.origin } }); localStorage.setItem("cc.mcp.oauth", b.dataset.signin); window.open(r.url, "_blank", "noopener"); toast(`Sign in at ${r.issuer}; this page finishes the link when you come back.`); }
    catch (e) { toast(e.message, true); }
    b.disabled = false; b.textContent = `Sign in (${plainLabel("oauth")})`;
  }));
  el.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/tools/servers/${encodeURIComponent(b.dataset.signout)}/oauth`, { method: "DELETE" }); toast("Signed out; the token was removed from the vault"); re(); } catch (e) { toast(e.message, true); } }));
}

// ---------- OAuth: the browser came back with ?code=&state= ----------
async function finishOAuthIfBack() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state");
  if (!code || !state || !localStorage.getItem("cc.mcp.oauth")) return;
  const clean = () => { q.delete("code"); q.delete("state"); q.delete("iss"); history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash); };
  try { const r = await api("/tools/oauth/finish", { method: "POST", body: { code, state } }); toast(`Signed in to ${r.server?.name || "the tool server"}. You can close any extra tab.`); }
  catch (e) { toast(`Sign-in did not finish: ${e.message}`, true); }
  localStorage.removeItem("cc.mcp.oauth"); clean();
  if (S.view === "settings") window.CC.render();
}

CC.register({
  id: "mcp",
  command: { order: 16, render: renderCommand },
  deliverable: { order: 6, render: renderDeliverable },
  settings: { order: 9, render: renderSettings },
  onEvent(ev) {
    if (ev.type === "mcp.approval") { pending.set(ev.id, ev); renderApprovals(); }
    else if (ev.type === "mcp.approval.done") { pending.delete(ev.id); renderApprovals(); }
    else if (ev.type === "hello") { finishOAuthIfBack(); }
    else if (ev.type === "workspace.active") { data = null; }
  },
});
