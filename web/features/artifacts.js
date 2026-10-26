// Artifacts side panel (Phase 20): HTML / JS mini apps, SVG, charts, Markdown and Python from an answer,
// rendered in a sandboxed frame, with versions, edit and re-run, and export as a file.
// The frame is <iframe sandbox="allow-scripts" srcdoc>, never allow-same-origin: it gets an opaque origin,
// so it cannot read this page (or the session token) and the server refuses its requests (Origin: null).
const { api, toast, esc, ago } = window.CC;

const SANDBOX = "allow-scripts";
const KIND_LABEL = { html: "HTML", svg: "SVG", markdown: "Markdown", chart: "Chart", js: "JavaScript", python: "Python" };
const FENCE = /```(html|htm|svg|xml|markdown|md|chart|json|js|javascript|python|py)\b[^\n]*\n[\s\S]*?```|```\n\s*(<!doctype html|<html[\s>]|<svg[\s>])/i;
const st = { items: [], open: null, v: null, editing: false, draft: "", frame: null, python: false };

async function loadList() { st.items = (await api("/artifacts")).items; }

// ---------- the sandboxed frame ----------
function mountFrame(box, html) {
  box.innerHTML = "";
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", SANDBOX);
  f.setAttribute("referrerpolicy", "no-referrer");
  f.setAttribute("title", "Artifact (sandboxed)");
  f.style.cssText = "width:100%;height:420px;border:1px solid var(--line);border-radius:8px;background:#fff;display:block";
  f.srcdoc = html;
  box.appendChild(f);
  st.frame = f;
  return f;
}
window.addEventListener("message", (e) => {
  const f = st.frame;
  if (!f || e.source !== f.contentWindow || !e.data || e.data.ccArtifact !== 1) return; // only our own frame
  if (e.data.type === "size") f.style.height = Math.max(160, Math.min(1600, Number(e.data.height) || 0) + 4) + "px";
  if (e.data.type === "error") { const n = document.getElementById("art-err"); if (n) n.textContent = `The artifact reported an error: ${String(e.data.text).slice(0, 300)}`; }
});

async function showFrame(box, a, v) {
  const r = await api(`/artifacts/${a.id}/frame${v ? `?v=${v}` : ""}`);
  return mountFrame(box, r.html);
}

// ---------- the side panel ----------
function panel() {
  let p = document.getElementById("art-panel");
  if (p) return p;
  p = document.createElement("aside");
  p.id = "art-panel";
  p.style.cssText = "position:fixed;top:0;right:0;bottom:0;width:min(760px,100vw);z-index:60;background:var(--panel-solid,#111827);border-left:1px solid var(--line);box-shadow:-12px 0 40px #0008;display:flex;flex-direction:column;transform:translateX(105%);transition:transform .18s ease";
  document.body.appendChild(p);
  return p;
}
export function closePanel() { const p = document.getElementById("art-panel"); if (p) p.style.transform = "translateX(105%)"; st.frame = null; st.open = null; }

export async function openArtifact(id, v = null) {
  try { st.open = await api(`/artifacts/${id}`); } catch (e) { toast(e.message, true); return; }
  st.v = v || st.open.versions[st.open.versions.length - 1].v;
  st.editing = false; st.python = false;
  const p = panel();
  p.style.transform = "none";
  await renderPanel();
}

async function renderPanel() {
  const a = st.open, p = panel();
  if (!a) return;
  const ver = a.versions.find((x) => x.v === st.v) || a.versions[a.versions.length - 1];
  const isPy = a.kind === "python";
  p.innerHTML = `<div style="padding:12px 14px;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center">
      <b style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.title)}">${esc(a.title)}</b>
      <span class="chip">${esc(KIND_LABEL[a.kind] || a.kind)}</span>
      <select id="art-v" title="Version">${a.versions.slice().reverse().map((x) => `<option value="${x.v}" ${x.v === ver.v ? "selected" : ""}>v${x.v} · ${esc(x.note || "")}</option>`).join("")}</select>
      <button class="btn sm" id="art-close" title="Close">Close</button></div>
    <div style="padding:8px 14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)">
      <button class="btn sm primary" id="art-run">${isPy ? "Run Python" : "Re-run"}</button>
      <button class="btn sm" id="art-edit">${st.editing ? "Close editor" : "Edit"}</button>
      <button class="btn sm" id="art-export">Export file</button>
      <button class="btn sm" id="art-keep" title="Keep this version in MindMedia">Save to MindMedia</button>
      <label class="small" title="Lets the artifact load scripts, styles and images from https:// addresses (CDNs). Never this app's own server."><input type="checkbox" id="art-net" ${a.net ? "checked" : ""}> Allow internet</label>
      <span style="flex:1"></span>
      <button class="btn sm" id="art-del">Delete</button></div>
    <div style="padding:12px 14px;overflow:auto;flex:1">
      <div class="small dim" style="margin-bottom:6px">Version ${ver.v} of ${a.versions.length}, saved ${ago(ver.at)} ago. Runs in a sandbox: no access to this app, your keys or your files${a.net ? "; may load from https:// addresses" : ", and no network"}.</div>
      <div id="art-err" class="small" style="color:var(--red,#ef4444)"></div>
      <div id="art-frame">${isPy && !st.python ? `<div class="empty">Python runs in your browser through Pyodide, downloaded (about 10 MB) only when you click Run Python.</div><pre class="small" style="max-height:300px;overflow:auto">${esc(ver.content)}</pre>` : ""}</div>
      ${st.editing ? `<div style="margin-top:12px"><textarea id="art-src" spellcheck="false" style="width:100%;min-height:260px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px">${esc(st.draft)}</textarea>
        <div class="row" style="gap:6px;margin-top:6px"><input id="art-note" placeholder="What changed (optional)" style="flex:1"><button class="btn sm" id="art-preview">Preview</button><button class="btn sm primary" id="art-save">Save as version ${a.versions[a.versions.length - 1].v + 1}</button></div>
        <div class="small dim">Saving adds a new version. Earlier versions stay as they are.</div></div>` : ""}
    </div>`;
  const $ = (s) => p.querySelector(s);
  const frameBox = $("#art-frame");
  if (!isPy || st.python) { try { await showFrame(frameBox, a, ver.v); } catch (e) { frameBox.innerHTML = `<div class="empty">${esc(e.message)}</div>`; } }
  $("#art-close").addEventListener("click", closePanel);
  $("#art-v").addEventListener("change", (e) => { st.v = Number(e.target.value); st.python = false; if (st.editing) st.draft = (a.versions.find((x) => x.v === st.v) || ver).content; renderPanel(); });
  $("#art-run").addEventListener("click", () => { $("#art-err").textContent = ""; st.python = true; if (st.editing) preview(); else renderPanel(); });
  $("#art-edit").addEventListener("click", () => { st.editing = !st.editing; st.draft = ver.content; renderPanel(); });
  $("#art-export").addEventListener("click", () => exportVersion(a, ver.v));
  $("#art-keep").addEventListener("click", async () => {
    try {
      const f = await api(`/artifacts/${a.id}/export?v=${ver.v}&format=json`);
      await window.CC.saveToMindMedia({ files: [{ name: f.filename, text: f.body, mime: f.mime }], kind: "file", name: a.title, source: "Artifacts", dedupeKey: `artifact:${a.id}` });
    } catch (e) { toast(e.message, true); }
  });
  $("#art-net").addEventListener("change", async (e) => { try { st.open = await api(`/artifacts/${a.id}/versions`, { method: "POST", body: { net: e.target.checked } }); renderPanel(); } catch (err) { toast(err.message, true); } });
  $("#art-del").addEventListener("click", async () => {
    if (!confirm(`Delete "${a.title}" and all ${a.versions.length} versions?`)) return;
    try { await api(`/artifacts/${a.id}`, { method: "DELETE" }); closePanel(); toast("Artifact deleted."); refreshTab(); } catch (e) { toast(e.message, true); }
  });
  async function preview() {
    st.draft = $("#art-src").value; st.python = true;
    try { const r = await api("/artifacts/preview", { method: "POST", body: { kind: a.kind, content: st.draft, net: a.net } }); mountFrame(frameBox, r.html); $("#art-err").textContent = ""; } catch (e) { $("#art-err").textContent = e.message; }
  }
  if (st.editing) {
    $("#art-src").addEventListener("input", (e) => { st.draft = e.target.value; });
    $("#art-preview").addEventListener("click", preview);
    $("#art-save").addEventListener("click", async () => {
      try { st.open = await api(`/artifacts/${a.id}/versions`, { method: "POST", body: { content: $("#art-src").value, note: $("#art-note").value } }); st.v = st.open.versions[st.open.versions.length - 1].v; st.editing = false; toast(`Saved as version ${st.v}.`); renderPanel(); refreshTab(); }
      catch (e) { toast(e.message, true); }
    });
  }
}

async function exportVersion(a, v) {
  try {
    const f = await api(`/artifacts/${a.id}/export?v=${v}&format=json`);
    const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([f.body], { type: f.mime })), download: f.filename });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    toast(`Exported ${f.filename}.`);
  } catch (e) { toast(e.message, true); }
}

// ---------- the tab: every artifact ----------
let tabView = null;
function refreshTab() { if (tabView?.isConnected && window.CC.S.view === "artifacts") renderTab(tabView); }
async function renderTab(view) {
  tabView = view;
  try { await loadList(); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  view.innerHTML = `<div class="panel"><h3>Artifacts <span class="right"><button class="btn sm" id="art-new">New artifact</button></span></h3>
      <div class="small muted">Web pages, mini apps, charts, SVG, Markdown, JavaScript and Python from your answers. Each opens in a side panel that runs it in a sandbox (no access to this app, your keys or files). Edits are saved as new versions; export any version as a file.</div></div>
    <div class="panel" id="art-new-box" style="display:none">
      <div class="row" style="gap:6px;flex-wrap:wrap"><input id="art-n-title" placeholder="Title" style="flex:1;min-width:180px"><select id="art-n-kind">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
      <textarea id="art-n-src" spellcheck="false" placeholder="Paste HTML, SVG, Markdown, a chart spec (JSON), JavaScript or Python" style="width:100%;min-height:160px;margin-top:6px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px"></textarea>
      <div class="small dim">Chart spec: {"type": "bar", "title": "Sales", "labels": ["Jan", "Feb"], "series": [{"name": "2026", "values": [3, 5]}]} (bar, line or pie)</div>
      <button class="btn sm primary" id="art-n-save" style="margin-top:6px">Save and open</button></div>
    <div class="panel">${st.items.length ? st.items.map((a) => `<div class="row small" style="padding:6px 0;gap:8px;border-bottom:1px solid var(--line)">
        <span class="chip">${esc(KIND_LABEL[a.kind] || a.kind)}</span><b style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}</b>
        <span class="dim">v${a.versions} · ${ago(a.updated)} ago</span><button class="btn sm" data-open="${esc(a.id)}">Open</button></div>`).join("") : `<div class="empty">No artifacts yet. When an answer contains HTML, a chart, SVG, Markdown, JavaScript or Python in a code block, click "Open in artifacts" under it.</div>`}</div>`;
  view.querySelector("#art-new").addEventListener("click", () => { const b = view.querySelector("#art-new-box"); b.style.display = b.style.display === "none" ? "" : "none"; });
  view.querySelector("#art-n-save").addEventListener("click", async () => {
    try { const a = await api("/artifacts", { method: "POST", body: { title: view.querySelector("#art-n-title").value, kind: view.querySelector("#art-n-kind").value, content: view.querySelector("#art-n-src").value } }); await renderTab(view); openArtifact(a.id); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openArtifact(b.dataset.open)));
}

// ---------- under a deliverable ----------
function renderDeliverable(el, run) {
  const text = run?.deliverable || "";
  if (!run?.id || !FENCE.test(text)) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="row small" style="gap:8px;margin-top:8px"><span class="muted">This answer has code that can run (a page, chart, SVG, Markdown, script or Python).</span><button class="btn sm" id="art-from-run">Open in artifacts</button></div>`;
  el.querySelector("#art-from-run").addEventListener("click", async () => {
    try {
      const projectId = run.mission?.projectId || run.council?.projectId || run.projectId || null;
      const r = await api("/artifacts/extract", { method: "POST", body: { text, runId: run.id, projectId } });
      if (!r.items.length) { toast("No runnable code block was found in this answer.", true); return; }
      if (r.items.length > 1) toast(`${r.items.length} artifacts saved. The others are in the Artifacts tab.`);
      openArtifact(r.items[0].id);
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- Settings: where Python comes from ----------
async function renderSettings(el) {
  let s; try { s = await api("/artifacts/settings"); } catch { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="panel"><h3>Artifacts: Python</h3>
    <div class="small muted">Python artifacts run in a sandbox through Pyodide, downloaded from this address only when you click Run Python. Point it at your own https:// copy if you prefer.</div>
    <div class="row" style="gap:6px;margin-top:6px"><input id="art-py" value="${esc(s.pyodideUrl)}" style="flex:1"><button class="btn sm" id="art-py-save">Save</button><button class="btn sm" id="art-py-reset">Default</button></div></div>`;
  const save = async (u) => { try { const r = await api("/artifacts/settings", { method: "POST", body: { pyodideUrl: u } }); el.querySelector("#art-py").value = r.pyodideUrl; toast("Saved."); } catch (e) { toast(e.message, true); } };
  el.querySelector("#art-py-save").addEventListener("click", () => save(el.querySelector("#art-py").value));
  el.querySelector("#art-py-reset").addEventListener("click", () => save(s.default));
}

window.CC.artifacts = { open: openArtifact, close: closePanel, mountFrame, SANDBOX };
window.CC.register({
  id: "artifacts",
  tab: { label: "Artifacts", short: "Artifacts", icon: "◧", order: 14, render: renderTab },
  deliverable: { order: 8, render: renderDeliverable },
  settings: { order: 12, render: renderSettings },
});
