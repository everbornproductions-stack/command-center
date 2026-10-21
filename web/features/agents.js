// Custom agents and the prompt library (Phase 19). The Agents tab: my agents (model, instructions, tools,
// libraries, starters), saved prompts with {{variables}} filled in a small form before sending, export and
// import as JSON, sharing with a workspace, what others shared with me, and Marketplace listing drafts.
// The Command view gets a row of saved prompts and agents. A run is a single chat: it shows in the Command view.
const { api, toast, esc, md } = window.CC;
const S = () => window.CC.S;

const st = { data: null, edit: null, editPrompt: null, workspaces: [], loaded: false };
const currentProject = () => document.getElementById("proj")?.value || S().project || null;
const VAR_RE = /\{\{\s*([A-Za-z][\w .-]{0,39}?)\s*\}\}/g;
const varsOf = (t) => { const out = []; for (const m of String(t || "").matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]); return out; };

async function load() {
  try { st.data = await api("/agents"); } catch (e) { toast(e.message, true); st.data = st.data || { agents: [], prompts: [], shared: [], listings: [], tools: [], libraries: [], categories: [] }; }
  try { const w = await api("/workspaces"); st.workspaces = [...(w.owned || []), ...(w.memberOf || [])].filter((x) => ["owner", "admin", "member"].includes(x.role)); } catch { st.workspaces = []; }
  st.loaded = true;
}

// ---------- model choices: the AIs with a key ----------
function modelOptions(sel) {
  const list = (S().providers || []).filter((p) => p.kind === "text" && p.keyed);
  return `<option value="auto" ${!sel ? "selected" : ""}>Auto (best for each job)</option>` + list.map((p) => `<optgroup label="${esc(p.name)}">${(p.models || []).map((m) => { const v = `${p.id}|${m.id}`; return `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(m.name)}</option>`; }).join("")}</optgroup>`).join("");
}

// ---------- the run / fill dialogs ----------
function dialog(html) {
  document.querySelector(".cc-agents-dlg")?.remove();
  const el = document.createElement("div");
  el.className = "cc-agents-dlg";
  el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:60";
  el.innerHTML = `<div class="panel" role="dialog" style="width:min(560px,92vw);max-height:86vh;overflow:auto">${html}</div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) el.remove(); });
  document.body.appendChild(el);
  return el;
}
const afterRun = () => { document.querySelector(".cc-agents-dlg")?.remove(); toast("Running. Watch it in the Command view."); window.CC.go("command"); };

function runAgentDialog(a, { shared = null } = {}) {
  const el = dialog(`<h3>Run ${esc(a.name)} <span class="right small dim">${esc(a.modelName || "Auto")}</span></h3>
    ${a.description ? `<div class="small muted">${esc(a.description)}</div>` : ""}
    ${(a.starters || []).length ? `<div class="row small" style="gap:6px;flex-wrap:wrap;margin-top:8px">${a.starters.map((s, i) => `<button class="btn sm" data-starter="${i}">${esc(s)}</button>`).join("")}</div>` : ""}
    <textarea id="ag-run-text" rows="4" style="width:100%;margin-top:8px" placeholder="What should ${esc(a.name)} do?"></textarea>
    <div class="small dim" style="margin-top:6px">Runs as one chat with your own keys; the cost goes in the ledger and counts toward your spend caps. Tools that change something still ask for your OK.</div>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn primary" id="ag-run-go">Run</button><button class="btn" data-close>Cancel</button></div>`);
  el.querySelectorAll("[data-starter]").forEach((b) => b.addEventListener("click", () => { el.querySelector("#ag-run-text").value = a.starters[Number(b.dataset.starter)]; }));
  el.querySelector("#ag-run-go").addEventListener("click", async () => {
    const prompt = el.querySelector("#ag-run-text").value.trim();
    if (!prompt) return toast("Type what you want, or pick a starter.", true);
    try {
      if (shared) await api(`/agents/shared/${encodeURIComponent(shared.workspaceId)}/agent/${encodeURIComponent(shared.itemId)}/run`, { method: "POST", body: { prompt, projectId: currentProject() } });
      else await api(`/agents/${a.id}/run`, { method: "POST", body: { prompt, projectId: currentProject() } });
      afterRun();
    } catch (e) { toast(e.message, true); }
  });
}

// every {{variable}} gets a field; Send stays refused (server too) until each one is filled
function fillDialog(p, { shared = null } = {}) {
  const vars = varsOf(p.text);
  const agents = st.data?.agents || [];
  const el = dialog(`<h3>${esc(p.name)}</h3>
    <div class="small muted mono" style="white-space:pre-wrap;max-height:120px;overflow:auto;border:1px solid var(--line);padding:6px;border-radius:6px">${esc(p.text)}</div>
    ${vars.map((v) => `<label class="small" style="display:block;margin-top:8px">${esc(v)} <span class="dim">(required)</span><input type="text" data-var="${esc(v)}" style="width:100%" required></label>`).join("") || `<div class="small dim" style="margin-top:8px">No variables in this prompt.</div>`}
    ${shared ? "" : `<label class="small" style="display:block;margin-top:8px">Run with <select id="pr-agent" style="width:100%"><option value="">No agent (plain chat)</option>${agents.map((a) => `<option value="${esc(a.id)}" ${a.id === p.agentId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>`}
    <div class="small" id="pr-preview" style="margin-top:8px"></div>
    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn primary" id="pr-send">Send</button>${shared ? "" : `<button class="btn" id="pr-orders" title="Put the filled text in the orders box, to run it as a council or a mission">Put in orders box</button>`}<button class="btn" data-close>Cancel</button></div>`);
  const values = () => Object.fromEntries([...el.querySelectorAll("[data-var]")].map((i) => [i.dataset.var, i.value]));
  const missing = () => vars.filter((v) => !String(values()[v] || "").trim());
  const preview = () => { const m = missing(); el.querySelector("#pr-preview").innerHTML = m.length ? `<span class="dim">Still to fill: ${m.map((x) => `{{${esc(x)}}}`).join(", ")}</span>` : `<div class="md">${md(p.text.replace(VAR_RE, (_, n) => values()[n]))}</div>`; el.querySelector("#pr-send").disabled = !!m.length; const o = el.querySelector("#pr-orders"); if (o) o.disabled = !!m.length; };
  el.querySelectorAll("[data-var]").forEach((i) => i.addEventListener("input", preview));
  preview();
  el.querySelector("#pr-send").addEventListener("click", async () => {
    if (missing().length) return toast("Fill in every field first.", true);
    try {
      if (shared) await api(`/agents/shared/${encodeURIComponent(shared.workspaceId)}/prompt/${encodeURIComponent(shared.itemId)}/run`, { method: "POST", body: { values: values(), projectId: currentProject() } });
      else await api(`/agents/prompts/${p.id}/run`, { method: "POST", body: { values: values(), agentId: el.querySelector("#pr-agent").value, projectId: currentProject() } });
      afterRun();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelector("#pr-orders")?.addEventListener("click", async () => {
    try { const r = await api(`/agents/prompts/${p.id}/fill`, { method: "POST", body: { values: values() } }); S().lastOrders = r.text; el.remove(); window.CC.go("command"); }
    catch (e) { toast(e.message, true); }
  });
}

function shareDialog(kind, item) {
  if (!st.workspaces.length) return toast("Make a workspace first (Workspaces tab, Studio), or ask to be invited to one.", true);
  const el = dialog(`<h3>Share "${esc(item.name)}"</h3>
    <div class="small muted">Everyone in the workspace sees a copy. Members can run it and copy it into their own list; viewers can only look. Sharing again updates the copy. No keys are ever shared: each person runs it with their own.</div>
    <select id="sh-ws" style="width:100%;margin-top:8px">${st.workspaces.map((w) => `<option value="${esc(w.id)}">${esc(w.name)} (you are ${esc(w.role)})</option>`).join("")}</select>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn primary" id="sh-go">Share</button><button class="btn" data-close>Cancel</button></div>`);
  el.querySelector("#sh-go").addEventListener("click", async () => {
    try { await api(kind === "agent" ? `/agents/${item.id}/share` : `/agents/prompts/${item.id}/share`, { method: "POST", body: { workspaceId: el.querySelector("#sh-ws").value } }); el.remove(); toast("Shared."); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
}

function listingDialog(kind, item) {
  const cats = st.data?.categories || [];
  const el = dialog(`<h3>Marketplace listing for "${esc(item.name)}"</h3>
    <div class="small muted">This saves a listing draft. The Marketplace is not open yet, so nothing is published and there is no price. Buyers will bring their own AIs, keys and libraries.</div>
    <label class="small" style="display:block;margin-top:8px">Category <select id="ls-cat" style="width:100%">${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>
    <label class="small" style="display:block;margin-top:8px">One-line promise <input type="text" id="ls-promise" maxlength="140" style="width:100%" placeholder="e.g. Captions in your brand voice, every time"></label>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn primary" id="ls-go">Save draft</button><button class="btn" data-close>Cancel</button></div>`);
  el.querySelector("#ls-go").addEventListener("click", async () => {
    try { const r = await api(kind === "agent" ? `/agents/${item.id}/listing` : `/agents/prompts/${item.id}/listing`, { method: "POST", body: { category: el.querySelector("#ls-cat").value, promise: el.querySelector("#ls-promise").value } }); el.remove(); toast(r.note); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
}

// ---------- export / import ----------
async function exportFile(q = "") {
  try {
    const bundle = await api(`/agents/export${q}`);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `command-ai-agents-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { toast(e.message, true); }
}
function importFile() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
  inp.addEventListener("change", async () => {
    const f = inp.files?.[0]; if (!f) return;
    try { const r = await api("/agents/import", { method: "POST", body: { data: await f.text() } }); toast(`Imported ${r.agents.length} agent(s) and ${r.prompts.length} prompt(s).${r.notes.length ? ` ${r.notes.join(" ")}` : ""}`); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  inp.click();
}

// ---------- editors ----------
function agentEditor(a) {
  const d = st.data;
  const allow = new Set(a.tools?.allow || []);
  const libs = new Set(a.libraries || []);
  const sel = a.provider ? `${a.provider}|${a.model}` : "";
  return `<div class="panel"><h3>${a.id ? `Edit ${esc(a.name)}` : "New agent"}</h3>
    <label class="small" style="display:block">Name <input type="text" id="ae-name" maxlength="${d.limits?.name || 60}" value="${esc(a.name || "")}" style="width:100%"></label>
    <label class="small" style="display:block;margin-top:6px">What it is for (optional) <input type="text" id="ae-desc" maxlength="300" value="${esc(a.description || "")}" style="width:100%"></label>
    <label class="small" style="display:block;margin-top:6px">Model <select id="ae-model" style="width:100%">${modelOptions(sel)}</select></label>
    <label class="small" style="display:block;margin-top:6px">Instructions <textarea id="ae-instr" rows="6" style="width:100%" placeholder="Who it is, what it does, how it answers, what it must never say">${esc(a.instructions || "")}</textarea></label>
    <div class="small" style="margin-top:6px">Tools <select id="ae-tools">${["off", "all", "some"].map((m) => `<option value="${m}" ${(a.tools?.mode || "off") === m ? "selected" : ""}>${{ off: "No tools", all: "Every tool I have switched on", some: "Only the ones ticked below" }[m]}</option>`).join("")}</select>
      <div id="ae-toollist" style="margin-top:4px;${(a.tools?.mode || "off") === "some" ? "" : "display:none"}">${d.tools.length ? d.tools.map((sv) => `<div class="dim" style="margin-top:4px">${esc(sv.serverName)}</div>${sv.tools.map((t) => `<label class="row" style="gap:4px"><input type="checkbox" data-tool="${esc(t.key)}" ${allow.has(t.key) ? "checked" : ""}> ${esc(t.name)}${t.switchedOn ? "" : ` <span class="dim">(switched off in Settings > Tools)</span>`}</label>`).join("")}`).join("") : `<span class="dim">No tool servers yet: add one in Settings > Tools.</span>`}</div></div>
    <div class="small" style="margin-top:6px">Knowledge libraries ${d.libraries.length ? d.libraries.map((l) => `<label class="row" style="gap:4px"><input type="checkbox" data-lib="${esc(l.id)}" ${libs.has(l.id) ? "checked" : ""}> ${esc(l.name)}</label>`).join("") : `<span class="dim">none yet (Libraries tab${d.hosted ? ", desktop app only" : ""})</span>`}</div>
    <label class="small" style="display:block;margin-top:6px">Starter prompts, one per line (up to ${d.limits?.starters || 8}) <textarea id="ae-starters" rows="3" style="width:100%">${esc((a.starters || []).join("\n"))}</textarea></label>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn primary" id="ae-save">Save</button><button class="btn" id="ae-cancel">Cancel</button></div></div>`;
}
function promptEditor(p) {
  return `<div class="panel"><h3>${p.id ? `Edit ${esc(p.name)}` : "New prompt"}</h3>
    <label class="small" style="display:block">Name <input type="text" id="pe-name" maxlength="60" value="${esc(p.name || "")}" style="width:100%"></label>
    <label class="small" style="display:block;margin-top:6px">Prompt <textarea id="pe-text" rows="5" style="width:100%" placeholder="Write a {{tone}} post about {{product}}.">${esc(p.text || "")}</textarea></label>
    <div class="small dim">Put {{name}} where a value goes. Every variable is asked for before sending.</div>
    <label class="small" style="display:block;margin-top:6px">Run with <select id="pe-agent" style="width:100%"><option value="">No agent (plain chat)</option>${(st.data.agents || []).map((a) => `<option value="${esc(a.id)}" ${a.id === p.agentId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn primary" id="pe-save">Save</button><button class="btn" id="pe-cancel">Cancel</button></div></div>`;
}

// ---------- the tab ----------
const agentCard = (a) => `<div class="row small" style="gap:6px;padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
  <div style="flex:1;min-width:180px"><b>${esc(a.name)}</b> <span class="dim">${esc(a.modelName || "")}${a.providerName ? ` · ${esc(a.providerName)}` : ""}</span>
    <div class="dim">${esc(a.description || a.instructions.slice(0, 90))}</div>
    <div class="dim">${a.tools.mode === "off" ? "no tools" : a.tools.mode === "all" ? "all switched-on tools" : `${a.tools.allow.length} tool(s)`} · ${a.libraryNames.length} librar${a.libraryNames.length === 1 ? "y" : "ies"} · ${a.starters.length} starter(s)</div></div>
  <button class="btn sm primary" data-arun="${esc(a.id)}">Run</button><button class="btn sm" data-aedit="${esc(a.id)}">Edit</button><button class="btn sm" data-ashare="${esc(a.id)}">Share</button><button class="btn sm" data-alist="${esc(a.id)}" title="Prepare a Marketplace listing draft">List</button><button class="btn sm" data-aexp="${esc(a.id)}">Export</button><button class="btn sm" data-adel="${esc(a.id)}" title="Delete">Delete</button></div>`;
const promptCard = (p) => `<div class="row small" style="gap:6px;padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
  <div style="flex:1;min-width:160px"><b>${esc(p.name)}</b>${p.agentName ? ` <span class="chip">${esc(p.agentName)}</span>` : ""}<div class="dim mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px">${esc(p.text)}</div></div>
  <button class="btn sm primary" data-puse="${esc(p.id)}">Use</button><button class="btn sm" data-pedit="${esc(p.id)}">Edit</button><button class="btn sm" data-pshare="${esc(p.id)}">Share</button><button class="btn sm" data-plist="${esc(p.id)}">List</button><button class="btn sm" data-pdel="${esc(p.id)}" title="Delete">Delete</button></div>`;
const sharedCard = (x) => `<div class="row small" style="gap:6px;padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
  <div style="flex:1;min-width:160px"><b>${esc(x.name)}</b> <span class="chip">${x.kind}</span> <span class="dim">${esc(x.workspaceName || "workspace")} · shared by ${esc(x.mine ? "you" : x.sharedBy || "someone")} · you are ${esc(x.role)}</span>
    ${x.permissions.use ? "" : `<div class="dim">Read-only for your role.</div>`}</div>
  <button class="btn sm" data-sview="${esc(x.workspaceId)}|${x.kind}|${esc(x.itemId)}">View</button>
  ${x.permissions.use ? `<button class="btn sm primary" data-srun="${esc(x.workspaceId)}|${x.kind}|${esc(x.itemId)}">${x.kind === "agent" ? "Run" : "Use"}</button><button class="btn sm" data-scopy="${esc(x.workspaceId)}|${x.kind}|${esc(x.itemId)}">Copy to mine</button>` : ""}
  ${x.permissions.remove ? `<button class="btn sm" data-sdel="${esc(x.workspaceId)}|${x.kind}|${esc(x.itemId)}" title="Remove from the workspace">Remove</button>` : ""}</div>`;

async function refresh() { await load(); const v = document.querySelector("#view"); if (v?.querySelector("#ag-root")) renderTab(v); }

async function renderTab(view) {
  if (!st.loaded) { view.innerHTML = `<div class="empty">Loading…</div>`; await load(); }
  const d = st.data;
  view.innerHTML = `<div id="ag-root" class="grid" style="grid-template-columns: minmax(0,1fr) minmax(0,1fr)">
    <div class="grid" style="align-content:start">
      ${st.edit ? agentEditor(st.edit) : ""}
      <div class="panel"><h3>My agents <span class="right"><button class="btn sm primary" id="ag-new">+ New agent</button></span></h3>
        <div class="small muted">An agent is a model with your instructions, the tools and libraries it may use, and a few starter prompts. Runs use your own keys and show in the Command view.</div>
        ${d.agents.length ? d.agents.map(agentCard).join("") : `<div class="dim small" style="margin-top:8px">No agents yet.</div>`}
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn sm" id="ag-export">Export all</button><button class="btn sm" id="ag-import">Import a file</button></div></div>
      <div class="panel"><h3>Shared with my workspaces</h3>${d.sharedError ? `<div class="small dim">${esc(d.sharedError)}</div>` : ""}
        ${d.shared.length ? d.shared.map(sharedCard).join("") : `<div class="dim small">Nothing shared yet.</div>`}</div>
    </div>
    <div class="grid" style="align-content:start">
      ${st.editPrompt ? promptEditor(st.editPrompt) : ""}
      <div class="panel"><h3>Prompt library <span class="right"><button class="btn sm primary" id="pr-new">+ New prompt</button></span></h3>
        <div class="small muted">Saved prompts with {{variables}}: a small form asks for each value before sending.</div>
        ${d.prompts.length ? d.prompts.map(promptCard).join("") : `<div class="dim small" style="margin-top:8px">No saved prompts yet.</div>`}</div>
      <div class="panel"><h3>Marketplace drafts</h3>
        ${d.listings.length ? d.listings.map((l) => `<div class="row small" style="gap:6px;padding:4px 0"><span style="flex:1"><b>${esc(l.title)}</b> <span class="dim">${esc(l.category)} · ${esc(l.promise)} · v${l.version}</span></span><span class="chip">draft</span><button class="btn sm" data-ldel="${esc(l.id)}" title="Delete draft">Delete</button></div>`).join("") : `<div class="dim small">No drafts. Use List on an agent or prompt.</div>`}
        <div class="small dim" style="margin-top:6px">The Marketplace is not open yet: drafts are kept on this computer and nothing is published.</div></div>
    </div></div>`;
  const $v = (s) => view.querySelector(s);
  const findA = (id) => d.agents.find((x) => x.id === id), findP = (id) => d.prompts.find((x) => x.id === id);
  const splitRef = (v) => { const [workspaceId, kind, itemId] = v.split("|"); return { workspaceId, kind, itemId }; };
  $v("#ag-new").addEventListener("click", () => { st.edit = { name: "", instructions: "", tools: { mode: "off", allow: [] }, libraries: [], starters: [] }; renderTab(view); });
  $v("#pr-new").addEventListener("click", () => { st.editPrompt = { name: "", text: "" }; renderTab(view); });
  $v("#ag-export").addEventListener("click", () => exportFile());
  $v("#ag-import").addEventListener("click", importFile);
  view.querySelectorAll("[data-arun]").forEach((b) => b.addEventListener("click", () => runAgentDialog(findA(b.dataset.arun))));
  view.querySelectorAll("[data-aedit]").forEach((b) => b.addEventListener("click", () => { st.edit = structuredClone(findA(b.dataset.aedit)); renderTab(view); }));
  view.querySelectorAll("[data-ashare]").forEach((b) => b.addEventListener("click", () => shareDialog("agent", findA(b.dataset.ashare))));
  view.querySelectorAll("[data-alist]").forEach((b) => b.addEventListener("click", () => listingDialog("agent", findA(b.dataset.alist))));
  view.querySelectorAll("[data-aexp]").forEach((b) => b.addEventListener("click", () => exportFile(`?agents=${encodeURIComponent(b.dataset.aexp)}&prompts=${d.prompts.filter((p) => p.agentId === b.dataset.aexp).map((p) => p.id).join(",")}`)));
  view.querySelectorAll("[data-adel]").forEach((b) => b.addEventListener("click", async () => { const a = findA(b.dataset.adel); if (!confirm(`Delete the agent "${a.name}"? Its libraries and tools are not touched.`)) return; try { await api(`/agents/${a.id}`, { method: "DELETE" }); await refresh(); } catch (e) { toast(e.message, true); } }));
  view.querySelectorAll("[data-puse]").forEach((b) => b.addEventListener("click", () => fillDialog(findP(b.dataset.puse))));
  view.querySelectorAll("[data-pedit]").forEach((b) => b.addEventListener("click", () => { st.editPrompt = structuredClone(findP(b.dataset.pedit)); renderTab(view); }));
  view.querySelectorAll("[data-pshare]").forEach((b) => b.addEventListener("click", () => shareDialog("prompt", findP(b.dataset.pshare))));
  view.querySelectorAll("[data-plist]").forEach((b) => b.addEventListener("click", () => listingDialog("prompt", findP(b.dataset.plist))));
  view.querySelectorAll("[data-pdel]").forEach((b) => b.addEventListener("click", async () => { const p = findP(b.dataset.pdel); if (!confirm(`Delete the prompt "${p.name}"?`)) return; try { await api(`/agents/prompts/${p.id}`, { method: "DELETE" }); await refresh(); } catch (e) { toast(e.message, true); } }));
  view.querySelectorAll("[data-ldel]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/agents/listings/${b.dataset.ldel}`, { method: "DELETE" }); await refresh(); } catch (e) { toast(e.message, true); } }));
  const sharedItem = (v) => { const r = splitRef(v); return d.shared.find((x) => x.workspaceId === r.workspaceId && x.kind === r.kind && x.itemId === r.itemId); };
  view.querySelectorAll("[data-sview]").forEach((b) => b.addEventListener("click", () => { const x = sharedItem(b.dataset.sview); dialog(`<h3>${esc(x.name)} <span class="right small dim">${esc(x.kind)}</span></h3>${x.kind === "agent" ? `<div class="small dim">Model: ${esc(x.data.model || "Auto")}</div><div class="md small" style="margin-top:6px">${md(x.data.instructions || "")}</div>${(x.data.starters || []).length ? `<div class="small" style="margin-top:6px">Starters: ${x.data.starters.map(esc).join(" · ")}</div>` : ""}` : `<div class="mono small" style="white-space:pre-wrap">${esc(x.data.text || "")}</div>`}<div class="row" style="margin-top:10px"><button class="btn" data-close>Close</button></div>`); }));
  view.querySelectorAll("[data-srun]").forEach((b) => b.addEventListener("click", () => { const x = sharedItem(b.dataset.srun); if (x.kind === "agent") runAgentDialog({ ...x.data, modelName: x.data.model || "Auto" }, { shared: x }); else fillDialog({ ...x.data }, { shared: x }); }));
  view.querySelectorAll("[data-scopy]").forEach((b) => b.addEventListener("click", async () => { const r = splitRef(b.dataset.scopy); try { const out = await api(`/agents/shared/${encodeURIComponent(r.workspaceId)}/${r.kind}/${encodeURIComponent(r.itemId)}/copy`, { method: "POST" }); toast(`Copied into your list.${out.notes.length ? ` ${out.notes.join(" ")}` : ""}`); await refresh(); } catch (e) { toast(e.message, true); } }));
  view.querySelectorAll("[data-sdel]").forEach((b) => b.addEventListener("click", async () => { const r = splitRef(b.dataset.sdel); if (!confirm("Remove this from the workspace? Your own copy stays.")) return; try { await api(`/agents/shared/${encodeURIComponent(r.workspaceId)}/${r.kind}/${encodeURIComponent(r.itemId)}`, { method: "DELETE" }); await refresh(); } catch (e) { toast(e.message, true); } }));

  // agent editor
  if (st.edit) {
    $v("#ae-tools").addEventListener("change", (e) => { $v("#ae-toollist").style.display = e.target.value === "some" ? "" : "none"; });
    $v("#ae-cancel").addEventListener("click", () => { st.edit = null; renderTab(view); });
    $v("#ae-save").addEventListener("click", async () => {
      const [provider, model] = $v("#ae-model").value === "auto" ? [null, null] : $v("#ae-model").value.split("|");
      const body = {
        name: $v("#ae-name").value, description: $v("#ae-desc").value, provider, model, instructions: $v("#ae-instr").value,
        tools: { mode: $v("#ae-tools").value, allow: [...view.querySelectorAll("[data-tool]:checked")].map((i) => i.dataset.tool) },
        libraries: [...view.querySelectorAll("[data-lib]:checked")].map((i) => i.dataset.lib), starters: $v("#ae-starters").value.split("\n"),
      };
      try { await api(st.edit.id ? `/agents/${st.edit.id}` : "/agents", { method: "POST", body }); toast(`Saved "${body.name.trim()}".`); st.edit = null; await refresh(); }
      catch (e) { toast(e.message, true); }
    });
  }
  // prompt editor
  if (st.editPrompt) {
    $v("#pe-cancel").addEventListener("click", () => { st.editPrompt = null; renderTab(view); });
    $v("#pe-save").addEventListener("click", async () => {
      const body = { name: $v("#pe-name").value, text: $v("#pe-text").value, agentId: $v("#pe-agent").value || null };
      try { await api(st.editPrompt.id ? `/agents/prompts/${st.editPrompt.id}` : "/agents/prompts", { method: "POST", body }); toast(`Saved "${body.name.trim()}".`); st.editPrompt = null; await refresh(); }
      catch (e) { toast(e.message, true); }
    });
  }
}

// ---------- Command view: saved prompts and agents one click away ----------
async function renderCommand(el) {
  if (!st.loaded) await load();
  const d = st.data;
  if (!d || (!d.prompts.length && !d.agents.length)) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="route" style="margin-top:8px"><div class="row small" style="gap:6px;flex-wrap:wrap"><span class="muted">Saved:</span>
    ${d.prompts.slice(0, 8).map((p) => `<button class="btn sm" data-cmd-p="${esc(p.id)}" title="${esc(p.text.slice(0, 200))}">${esc(p.name)}</button>`).join("")}
    ${d.agents.slice(0, 6).map((a) => `<button class="btn sm" data-cmd-a="${esc(a.id)}" title="Run this agent">▸ ${esc(a.name)}</button>`).join("")}</div></div>`;
  el.querySelectorAll("[data-cmd-p]").forEach((b) => b.addEventListener("click", () => fillDialog(d.prompts.find((p) => p.id === b.dataset.cmdP))));
  el.querySelectorAll("[data-cmd-a]").forEach((b) => b.addEventListener("click", () => runAgentDialog(d.agents.find((a) => a.id === b.dataset.cmdA))));
}

function onEvent(ev) {
  if (ev.type === "agents.update" || (ev.type === "library.update" && ev.action === "deleted")) { st.loaded = false; const v = document.querySelector("#view"); if (v?.querySelector("#ag-root") && !st.edit && !st.editPrompt) refresh(); }
}

CC.register({ id: "agents", tab: { label: "Agents", short: "Agents", icon: "◎", order: 13, render: renderTab }, command: { order: 14, render: renderCommand }, onEvent });
