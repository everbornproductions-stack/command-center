// Knowledge libraries (Phase 18): the Libraries tab (make a library, add files, a folder, Google Drive or
// Notion pages, see the estimate, index, try a question), the Command widget (which libraries this chat
// uses), library source chips under the deliverable ([L1], [L2] open the excerpt), and the Drive and Notion
// connections (read-only) in Settings.
const { S, api, toast, esc, money, ago } = window.CC;

const css = `
.lib-card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-top: 8px; }
.lib-card.open { border-color: var(--accent, #22d3ee); }
.lib-bar { height: 6px; background: var(--line); border-radius: 4px; overflow: hidden; margin-top: 6px; }
.lib-bar > i { display: block; height: 100%; background: var(--accent, #22d3ee); }
.lib-list { max-height: 260px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; margin-top: 6px; }
.lib-list .row { padding: 3px 0; }
.lib-hit { border-top: 1px solid var(--line); padding: 6px 0; }
.lib-hit pre, .lib-ex pre { white-space: pre-wrap; margin: 4px 0 0; font: 12px/1.4 var(--mono); max-height: 180px; overflow: auto; }
.lib-src { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.lib-src button.chip { cursor: pointer; max-width: 100%; }
.lib-src .n { color: var(--violet, #a78bfa); font-weight: 600; }
.lib-src .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
.lib-ex { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.md a.lib-cite { text-decoration: none; font-size: .78em; vertical-align: super; padding: 0 3px; border-radius: 4px; background: #1d1830; border: 1px solid #3b3160; color: var(--violet, #a78bfa); margin-left: 1px; cursor: pointer; }
`;
const style = document.createElement("style"); style.id = "cc-libraries-style"; style.textContent = css; document.head.appendChild(style);

const st = { data: null, open: null, detail: {}, stage: null, results: {}, drive: { folder: "", path: [], files: null, q: "", picked: new Set() }, notion: { pages: null, q: "", picked: new Set() }, busy: false, project: null };
async function load() { st.data = await api("/libraries"); return st.data; }
const libById = (id) => st.data?.libraries.find((l) => l.id === id) || null;
const SRC_LABEL = { file: "uploaded", folder: "folder on this PC", drive: "Google Drive", notion: "Notion" };
const projectName = (pid) => (S.projects || []).find((p) => p.id === pid)?.name || (pid === "_" ? "no project" : pid);
const currentProject = () => document.getElementById("proj")?.value || S.project || "";
const b64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const isBinary = (name) => /\.(pdf|docx)$/i.test(name);

// ---------- Tab ----------
function newLibraryForm(d) {
  const keyed = d.embedders.filter((e) => e.keyed);
  const opts = d.embedders.map((e, i) => `<option value="${i}" ${e.keyed && !e.capped ? "" : "disabled"}>${esc(e.name)}${e.custom ? "" : ` · ${money(e.per1M, 3)} per 1M tokens`}${e.keyed ? "" : " (no key)"}${e.capped ? " (spend cap reached)" : ""}</option>`).join("");
  return `<div class="panel"><h3>New library</h3>
    <div class="small muted">A library is your own files, folders, Google Drive files or Notion pages, cut into passages and indexed with the embedding model you pick here (your own key). Attach it to a chat, a workspace or an agent and the best passages go into the prompt, cited as [L1], [L2].</div>
    ${keyed.length ? "" : `<div class="small" style="color:var(--amber);margin-top:6px">No embedding model can be used yet: add an OpenAI, Google Gemini or Mistral key in Settings${d.demo ? "" : ", or turn on demo mode to try it with the pretend embedder"}.</div>`}
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><input type="text" id="lib-name" placeholder="Name, for example Company handbook" maxlength="80" style="flex:1;min-width:200px">
      <select id="lib-emb" style="width:auto;max-width:340px">${opts}</select></div>
    <div class="row small" id="lib-custom" style="gap:8px;margin-top:6px;display:none"><input type="text" id="lib-model" placeholder="embedding model, for example nomic-embed-text" style="flex:1"><label class="row" style="gap:4px">$ <input type="number" id="lib-price" min="0" step="0.01" value="0" style="width:70px"> per 1M tokens</label></div>
    <button class="btn sm primary" id="lib-create" style="margin-top:8px" ${keyed.length ? "" : "disabled"}>Create library</button></div>`;
}

function attachedText(l) {
  if (!l.attached.length) return `<span class="dim">not attached yet</span>`;
  return l.attached.map((a) => `<span class="chip violet">${a.scope === "chat" ? `chat: ${esc(projectName(a.target))}` : a.scope === "workspace" ? `workspace: ${esc(wsName(a.target))}` : `agent: ${esc(a.target)}`}</span>`).join(" ");
}
let workspaces = [];
const wsName = (id) => workspaces.find((w) => w.id === id)?.name || id;
async function loadWorkspaces() { try { const w = await api("/workspaces"); workspaces = [...(w.owned || []), ...(w.memberOf || [])].map((x) => ({ id: x.id, name: x.name })); } catch { workspaces = []; } }

function jobHtml(j) {
  if (!j) return "";
  const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
  if (j.status === "indexing") return `<div class="small dim" style="margin-top:6px">Indexing ${j.done} of ${j.total} passages · ${money(j.cost, 5)} so far</div><div class="lib-bar"><i style="width:${pct}%"></i></div>`;
  if (j.status === "done") return `<div class="small" style="margin-top:6px;color:var(--green)">Indexed ${j.files} file${j.files === 1 ? "" : "s"} (${j.total} passages, ${j.calls} embedding call${j.calls === 1 ? "" : "s"}, ${money(j.cost, 5)}).</div>`;
  return `<div class="small" style="margin-top:6px;color:var(--${j.status === "stopped" ? "amber" : "red"})">${esc(j.error || j.status)}</div>`;
}

function cardHtml(l) {
  const open = st.open === l.id;
  return `<div class="lib-card ${open ? "open" : ""}" data-lib="${esc(l.id)}">
    <div class="row" style="gap:8px;flex-wrap:wrap"><b style="cursor:pointer" data-toggle>${esc(l.name)}</b>
      <span class="small dim">${l.docs} file${l.docs === 1 ? "" : "s"} · ${l.chunks} passages · ${esc(l.embed.model)} through ${esc(l.embed.providerName)}</span>
      <span style="margin-left:auto" class="row" style="gap:6px"><button class="btn sm" data-toggle>${open ? "Close" : "Open"}</button></span></div>
    <div class="small" style="margin-top:4px">${attachedText(l)}</div>
    ${jobHtml(l.job)}
    ${open ? `<div data-body style="margin-top:10px"></div>` : ""}
  </div>`;
}

function stageHtml(s) {
  const e = s.estimate;
  return `<div class="route" style="margin-top:8px"><b>Ready to index</b>
    ${s.files.length ? `<div class="lib-list">${s.files.map((f) => `<div class="row small" style="gap:6px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(f.ref)}">${esc(f.title)}</span><span class="dim">${f.chunks} passage${f.chunks === 1 ? "" : "s"}${f.replaces ? " · replaces the older copy" : ""}</span></div>`).join("")}</div>` : `<div class="small dim">Nothing new to index.</div>`}
    ${s.skipped.length ? `<details style="margin-top:6px"><summary class="small muted" style="cursor:pointer">${s.skipped.length} skipped</summary><div class="lib-list">${s.skipped.map((x) => `<div class="row small" style="gap:6px"><span style="flex:1">${esc(x.title)}</span><span class="dim">${esc(x.reason)}</span></div>`).join("")}</div></details>` : ""}
    ${s.files.length ? `<div class="small" style="margin-top:8px">Estimate: about <b>${money(e.cost, 5)}</b> for ${e.tokens.toLocaleString()} tokens (${e.chunks} passages, ${e.calls} call${e.calls === 1 ? "" : "s"} to ${esc(e.model)} through ${esc(e.providerName)}, your own key). Every call goes in the ledger.${e.capped ? ` <span style="color:var(--red)">${esc(e.providerName)} is at its monthly spend cap, so indexing is refused.</span>` : ""}${e.keyed ? "" : ` <span style="color:var(--red)">No key saved for ${esc(e.providerName)}.</span>`}</div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn sm primary" data-index ${e.capped || !e.keyed ? "disabled" : ""}>Index ${s.files.length} file${s.files.length === 1 ? "" : "s"}</button><button class="btn sm" data-unstage>Cancel</button></div>` : `<div class="row" style="margin-top:8px"><button class="btn sm" data-unstage>Close</button></div>`}
  </div>`;
}

function driveHtml(d) {
  const g = st.data.sources.google;
  if (!g.connected) return `<div class="small dim">Google Drive is not connected. <a href="#" data-go-settings>Connect it in Settings</a> (read-only).</div>`;
  const files = st.drive.files;
  return `<div class="row small" style="gap:6px;flex-wrap:wrap"><input type="text" data-drive-q placeholder="search Drive, or browse below" value="${esc(st.drive.q)}" style="flex:1;min-width:180px"><button class="btn sm" data-drive-search>Search</button>${st.drive.path.length ? `<button class="btn sm" data-drive-up>Back</button>` : ""}<span class="dim">${esc(["My Drive", ...st.drive.path.map((p) => p.name)].join(" / "))}</span></div>
    ${files ? `<div class="lib-list">${files.length ? files.map((f) => `<div class="row small" style="gap:6px"><input type="checkbox" data-drive-pick="${esc(f.id)}" ${st.drive.picked.has(f.id) ? "checked" : ""} ${f.readable ? "" : "disabled"}>${f.folder ? `<a href="#" data-drive-open="${esc(f.id)}" data-name="${esc(f.name)}">📁 ${esc(f.name)}</a>` : `<span style="flex:1">${esc(f.name)}</span>`}<span class="dim" style="margin-left:auto">${f.folder ? "folder (all files inside)" : f.readable ? "" : "not readable"}</span></div>`).join("") : `<div class="small dim">Nothing here.</div>`}</div>` : `<div class="small dim" style="margin-top:4px">Loading…</div>`}
    <button class="btn sm" data-drive-stage style="margin-top:6px" ${st.drive.picked.size ? "" : "disabled"}>Read ${st.drive.picked.size} picked</button>`;
}
function notionHtml() {
  const n = st.data.sources.notion;
  if (!n.connected) return `<div class="small dim">Notion is not connected. <a href="#" data-go-settings>Connect it in Settings</a> (read-only).</div>`;
  const pages = st.notion.pages;
  return `<div class="row small" style="gap:6px"><input type="text" data-notion-q placeholder="search the pages shared with Meldmind" value="${esc(st.notion.q)}" style="flex:1"><button class="btn sm" data-notion-search>Search</button></div>
    ${pages ? `<div class="lib-list">${pages.length ? pages.map((p) => `<div class="row small" style="gap:6px"><input type="checkbox" data-notion-pick="${esc(p.id)}" ${st.notion.picked.has(p.id) ? "checked" : ""}><span style="flex:1">${esc(p.name)}</span>${p.modified ? `<span class="dim">${ago(new Date(p.modified).getTime())} ago</span>` : ""}</div>`).join("") : `<div class="small dim">No pages. In Notion, share pages with the integration (page menu > Connections).</div>`}</div>` : `<div class="small dim" style="margin-top:4px">Loading…</div>`}
    <button class="btn sm" data-notion-stage style="margin-top:6px" ${st.notion.picked.size ? "" : "disabled"}>Read ${st.notion.picked.size} picked</button>`;
}

function bodyHtml(l) {
  const det = st.detail[l.id];
  const pid = st.project ?? currentProject();
  const chatOn = l.attached.some((a) => a.scope === "chat" && a.target === (pid || "_"));
  const res = st.results[l.id];
  return `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px">
    <div>
      <div class="cat-h">Add</div>
      <div class="row small" style="gap:6px;flex-wrap:wrap;margin-top:4px">
        <label class="btn sm">Upload files<input type="file" data-up-files multiple style="display:none"></label>
        <label class="btn sm">Upload a folder<input type="file" data-up-folder webkitdirectory multiple style="display:none"></label>
      </div>
      <div class="row small" style="gap:6px;margin-top:6px"><input type="text" data-folder placeholder="or a folder on this PC, for example C:\\Users\\you\\Documents\\Handbook" style="flex:1"><button class="btn sm" data-folder-read>Read folder</button></div>
      <div class="small dim" style="margin-top:4px">Text, Markdown, CSV, JSON, code, HTML, Word (.docx) and PDF with real text (scanned PDFs are skipped). Up to ${st.data.limits.maxFileMb} MB per file. Reading is free; you see the estimate before anything is spent.</div>
      <details style="margin-top:8px" ${st.drive.files ? "open" : ""} data-drive-box><summary class="small" style="cursor:pointer">Google Drive</summary><div data-drive>${driveHtml()}</div></details>
      <details style="margin-top:6px" ${st.notion.pages ? "open" : ""} data-notion-box><summary class="small" style="cursor:pointer">Notion</summary><div data-notion>${notionHtml()}</div></details>
      ${st.stage?.libraryId === l.id ? stageHtml(st.stage) : ""}
      <div class="cat-h" style="margin-top:12px">In this library</div>
      ${det ? (det.documents.length ? `<div class="lib-list">${det.documents.map((d) => `<div class="row small" style="gap:6px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(d.ref)}">${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>` : esc(d.title)}</span><span class="dim">${esc(SRC_LABEL[d.source] || d.source)} · ${d.chunks}</span><button class="ghost small" data-rmdoc="${d.id}" title="Remove from the library">✕</button></div>`).join("")}</div>` : `<div class="small dim">Empty. Add files above.</div>`) : `<div class="small dim">Loading…</div>`}
    </div>
    <div>
      <div class="cat-h">Use it</div>
      <label class="row small" style="gap:6px;margin-top:4px"><input type="checkbox" data-att-chat ${chatOn ? "checked" : ""}> In Command chats for <select data-att-proj style="width:auto">${[["", "no project"], ...(S.projects || []).map((p) => [p.id, p.name])].map(([v, n]) => `<option value="${esc(v)}" ${v === (pid || "") ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      ${workspaces.length ? workspaces.map((w) => `<label class="row small" style="gap:6px;margin-top:4px"><input type="checkbox" data-att-ws="${esc(w.id)}" ${l.attached.some((a) => a.scope === "workspace" && a.target === w.id) ? "checked" : ""}> Whenever the workspace <b>${esc(w.name)}</b> is active</label>`).join("") : `<div class="small dim" style="margin-top:4px">Workspaces you are in can use it too (Workspaces tab).</div>`}
      ${l.attached.filter((a) => a.scope === "agent").map((a) => `<label class="row small" style="gap:6px;margin-top:4px"><input type="checkbox" checked data-att-agent="${esc(a.target)}"> Agent ${esc(a.target)}</label>`).join("")}
      <div class="small dim" style="margin-top:4px">Single, Council and Mission all use it. The best ${st.data.limits.topK} passages go to the AI answering (one small embedding call per question, in the ledger).</div>
      <div class="cat-h" style="margin-top:12px">Try a question</div>
      <div class="row small" style="gap:6px;margin-top:4px"><input type="text" data-q placeholder="ask something the files answer" style="flex:1"><select data-mode style="width:auto"><option value="hybrid">Keywords and meaning</option><option value="keyword">Keywords only (free)</option><option value="vector">Meaning only</option></select><button class="btn sm" data-ask>Search</button></div>
      ${res ? `<div class="small dim" style="margin-top:6px">${res.results.length} passage${res.results.length === 1 ? "" : "s"} · ${esc(res.mode)}${res.cost ? ` · ${money(res.cost, 6)}` : ""}${res.note ? ` · ${esc(res.note)}` : ""}</div>${res.results.map((r, i) => `<div class="lib-hit"><div class="row small" style="gap:6px"><b>${i + 1}.</b> ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}<span class="dim" style="margin-left:auto">${r.keyword ? `keyword #${r.keyword.rank}` : ""}${r.keyword && r.vector ? " · " : ""}${r.vector ? `meaning #${r.vector.rank} (${r.vector.score})` : ""}</span></div><pre>${esc(r.text.slice(0, 700))}${r.text.length > 700 ? "…" : ""}</pre></div>`).join("")}` : ""}
      <div class="row" style="gap:8px;margin-top:14px"><input type="text" data-rename value="${esc(l.name)}" maxlength="80" style="flex:1"><button class="btn sm" data-rename-save>Rename</button><button class="btn sm danger" data-del>Delete library</button></div>
    </div></div>`;
}

async function openDetail(id) { try { st.detail[id] = await api(`/libraries/${id}`); } catch (e) { toast(e.message, true); } }

async function stageAndShow(view, libId, body) {
  if (st.busy) return; st.busy = true;
  try { st.stage = await api(`/libraries/${libId}/stage`, { method: "POST", body }); }
  catch (e) { toast(e.message, true); }
  finally { st.busy = false; }
  renderTab(view);
}
async function uploadFiles(view, libId, fileList) {
  const files = [...fileList];
  if (!files.length) return;
  toast(`Reading ${files.length} file${files.length === 1 ? "" : "s"}…`);
  let stageId = null, batch = [], size = 0;
  const flush = async () => { if (!batch.length) return; const r = await api(`/libraries/${libId}/stage`, { method: "POST", body: { kind: "files", files: batch, stageId } }); stageId = r.stageId; st.stage = r; batch = []; size = 0; };
  try {
    for (const f of files) {
      const name = f.webkitRelativePath || f.name;
      if (f.size > st.data.limits.maxFileMb * 1048576) { batch.push({ name, text: "" }); continue; }
      const item = isBinary(name) ? { name, data: b64(await f.arrayBuffer()) } : { name, text: await f.text() };
      const n = (item.data || item.text).length;
      if (size + n > 3_500_000 || batch.length >= 150) await flush();
      batch.push(item); size += n;
    }
    await flush();
  } catch (e) { toast(e.message, true); }
  renderTab(view);
}

function wireCard(view, card) {
  const id = card.dataset.lib;
  const l = libById(id);
  const $c = (s) => card.querySelector(s);
  card.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => { st.open = st.open === id ? null : id; if (st.open) { st.results[id] = null; await openDetail(id); } renderTab(view); }));
  const body = $c("[data-body]");
  if (!body) return;
  body.innerHTML = bodyHtml(l);
  const $b = (s) => body.querySelector(s);
  $b("[data-up-files]").addEventListener("change", (e) => uploadFiles(view, id, e.target.files));
  $b("[data-up-folder]").addEventListener("change", (e) => uploadFiles(view, id, e.target.files));
  $b("[data-folder-read]").addEventListener("click", () => { const p = $b("[data-folder]").value.trim(); if (!p) return toast("Type the folder's path.", true); stageAndShow(view, id, { kind: "folder", path: p }); });
  body.querySelectorAll("[data-go-settings]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); CC.go("settings"); }));
  // Google Drive
  const driveLoad = async () => { st.drive.files = null; try { st.drive.files = (await api(`/libraries/google/files?${new URLSearchParams({ q: st.drive.q, folder: st.drive.folder })}`)).files; } catch (e) { st.drive.files = []; toast(e.message, true); } renderTab(view); };
  $b("[data-drive-box]")?.addEventListener("toggle", (e) => { if (e.target.open && !st.drive.files && st.data.sources.google.connected) driveLoad(); });
  $b("[data-drive-search]")?.addEventListener("click", () => { st.drive.q = $b("[data-drive-q]").value.trim(); driveLoad(); });
  $b("[data-drive-up]")?.addEventListener("click", () => { st.drive.path.pop(); st.drive.folder = st.drive.path.at(-1)?.id || ""; st.drive.q = ""; driveLoad(); });
  body.querySelectorAll("[data-drive-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); st.drive.path.push({ id: a.dataset.driveOpen, name: a.dataset.name }); st.drive.folder = a.dataset.driveOpen; st.drive.q = ""; driveLoad(); }));
  body.querySelectorAll("[data-drive-pick]").forEach((c) => c.addEventListener("change", () => { if (c.checked) st.drive.picked.add(c.dataset.drivePick); else st.drive.picked.delete(c.dataset.drivePick); const b = $b("[data-drive-stage]"); b.disabled = !st.drive.picked.size; b.textContent = `Read ${st.drive.picked.size} picked`; }));
  $b("[data-drive-stage]")?.addEventListener("click", () => { const ids = [...st.drive.picked]; st.drive.picked.clear(); stageAndShow(view, id, { kind: "drive", ids }); });
  // Notion
  const notionLoad = async () => { st.notion.pages = null; try { st.notion.pages = (await api(`/libraries/notion/pages?${new URLSearchParams({ q: st.notion.q })}`)).pages; } catch (e) { st.notion.pages = []; toast(e.message, true); } renderTab(view); };
  $b("[data-notion-box]")?.addEventListener("toggle", (e) => { if (e.target.open && !st.notion.pages && st.data.sources.notion.connected) notionLoad(); });
  $b("[data-notion-search]")?.addEventListener("click", () => { st.notion.q = $b("[data-notion-q]").value.trim(); notionLoad(); });
  body.querySelectorAll("[data-notion-pick]").forEach((c) => c.addEventListener("change", () => { if (c.checked) st.notion.picked.add(c.dataset.notionPick); else st.notion.picked.delete(c.dataset.notionPick); const b = $b("[data-notion-stage]"); b.disabled = !st.notion.picked.size; b.textContent = `Read ${st.notion.picked.size} picked`; }));
  $b("[data-notion-stage]")?.addEventListener("click", () => { const ids = [...st.notion.picked]; st.notion.picked.clear(); stageAndShow(view, id, { kind: "notion", ids }); });
  // stage: index or cancel
  $b("[data-index]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await api(`/libraries/${id}/index`, { method: "POST", body: { stageId: st.stage.stageId } }); st.stage = null; toast("Indexing started. The progress shows on the card."); await load(); renderTab(view); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
  $b("[data-unstage]")?.addEventListener("click", async () => { const sid = st.stage?.stageId; st.stage = null; if (sid) api(`/libraries/${id}/stage/${sid}`, { method: "DELETE" }).catch(() => {}); renderTab(view); });
  body.querySelectorAll("[data-rmdoc]").forEach((b) => b.addEventListener("click", async () => {
    const d = st.detail[id]?.documents.find((x) => String(x.id) === b.dataset.rmdoc);
    if (!d || !confirm(`Remove "${d.title}" from this library? The file itself is not touched.`)) return;
    try { await api(`/libraries/${id}/docs/${d.id}`, { method: "DELETE" }); await Promise.all([load(), openDetail(id)]); renderTab(view); } catch (e) { toast(e.message, true); }
  }));
  // attachments
  const attach = async (scope, target, on) => { try { await api("/libraries/attach", { method: "POST", body: { libraryId: id, scope, target, on } }); await load(); renderTab(view); } catch (e) { toast(e.message, true); } };
  $b("[data-att-proj]").addEventListener("change", (e) => { st.project = e.target.value; renderTab(view); });
  $b("[data-att-chat]").addEventListener("change", (e) => attach("chat", (st.project ?? currentProject()) || "_", e.target.checked));
  body.querySelectorAll("[data-att-ws]").forEach((c) => c.addEventListener("change", () => attach("workspace", c.dataset.attWs, c.checked)));
  body.querySelectorAll("[data-att-agent]").forEach((c) => c.addEventListener("change", () => attach("agent", c.dataset.attAgent, c.checked)));
  // try a question
  const ask = async () => {
    const q = $b("[data-q]").value.trim(); if (!q) return;
    try { st.results[id] = await api(`/libraries/${id}/search?${new URLSearchParams({ q, mode: $b("[data-mode]").value })}`); } catch (e) { toast(e.message, true); return; }
    renderTab(view);
  };
  $b("[data-ask]").addEventListener("click", ask);
  $b("[data-q]").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
  $b("[data-rename-save]").addEventListener("click", async () => { try { await api(`/libraries/${id}`, { method: "POST", body: { name: $b("[data-rename]").value } }); await load(); renderTab(view); toast("Renamed"); } catch (e) { toast(e.message, true); } });
  $b("[data-del]").addEventListener("click", async () => {
    if (!confirm(`Delete the library "${l.name}"? Its index (${l.chunks} passages) is removed from this PC and it is detached everywhere. Your original files are not touched.`)) return;
    try { await api(`/libraries/${id}`, { method: "DELETE" }); st.open = null; await load(); renderTab(view); toast("Library deleted"); } catch (e) { toast(e.message, true); }
  });
}

async function renderTab(view) {
  view = view || document.querySelector("#view");
  if (!view) return;
  if (!st.data) { view.innerHTML = `<div class="empty">Loading…</div>`; try { await Promise.all([load(), loadWorkspaces()]); } catch (e) { view.innerHTML = `<div class="panel"><div class="dim">${esc(e.message)}</div></div>`; return; } }
  const d = st.data;
  if (!d.available) { view.innerHTML = `<div class="panel"><h3>Knowledge libraries</h3><div class="small muted">${d.hosted ? "Libraries live in the desktop app for now: the index is a file on your PC. Open Meldmind on your computer to make and use them." : "Libraries need a newer runtime (node:sqlite). Update Meldmind."}</div></div>`; return; }
  const keep = view.querySelector("[data-q]")?.value;
  view.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) 320px">
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Knowledge libraries <span class="right small">${d.libraries.length} librar${d.libraries.length === 1 ? "y" : "ies"}</span></h3>
        ${d.libraries.length ? d.libraries.map(cardHtml).join("") : `<div class="empty">No libraries yet. Make one on the right, add files, and attach it to a chat.</div>`}</div>
    </div>
    <div class="grid" style="align-content:start">${newLibraryForm(d)}<div class="panel" id="lib-sources"></div></div></div>`;
  view.querySelectorAll(".lib-card").forEach((c) => wireCard(view, c));
  if (keep) { const q = view.querySelector("[data-q]"); if (q) q.value = keep; }
  renderSources(view.querySelector("#lib-sources"));
  const sel = view.querySelector("#lib-emb");
  const showCustom = () => { const e = d.embedders[Number(sel.value)]; view.querySelector("#lib-custom").style.display = e?.custom ? "flex" : "none"; };
  const firstOk = d.embedders.findIndex((e) => e.keyed && !e.capped); if (firstOk >= 0) sel.value = String(firstOk);
  sel.addEventListener("change", showCustom); showCustom();
  view.querySelector("#lib-create").addEventListener("click", async () => {
    const e = d.embedders[Number(sel.value)];
    if (!e) return toast("Pick the embedding model.", true);
    const body = { name: view.querySelector("#lib-name").value, provider: e.provider, model: e.custom ? view.querySelector("#lib-model").value : e.model };
    if (e.custom) body.per1M = Number(view.querySelector("#lib-price").value) || 0;
    try { const l = await api("/libraries", { method: "POST", body }); st.open = l.id; await load(); await openDetail(l.id); renderTab(view); toast(`Library "${l.name}" created. Add files to it.`); } catch (err) { toast(err.message, true); }
  });
}

// ---------- Drive and Notion connections (Settings, and the Libraries tab) ----------
function renderSources(el) {
  if (!el || !st.data) return;
  const g = st.data.sources.google, n = st.data.sources.notion;
  const block = (s, extra) => `<div style="margin-top:10px"><div class="row small" style="gap:8px"><span class="dot ${s.connected ? "green" : s.needsSignIn ? "amber" : "grey"}"></span><b>${esc(s.name)}</b><span class="dim">${s.connected ? `connected${s.workspace ? ` (${esc(s.workspace)})` : ""}, read-only` : s.needsSignIn ? "sign in again" : "not connected"}</span></div>
    <div class="small dim" style="margin-top:4px">${esc(s.setup)}</div>${extra}
    <div class="row small" style="gap:6px;margin-top:6px;flex-wrap:wrap"><input type="text" data-cid="${s.source}" value="${esc(s.clientId || "")}" placeholder="${s.sharedClient ? "using the browser helper's Google client" : "OAuth client ID"}" style="flex:1;min-width:160px;font-family:var(--mono)"><input type="password" data-csec="${s.source}" placeholder="${s.clientSecretSaved ? "secret saved in the vault" : "client secret"}" autocomplete="off" style="width:150px"></div>
    <div class="row" style="gap:6px;margin-top:6px"><button class="btn sm" data-csave="${s.source}">Save client</button><button class="btn sm primary" data-connect="${s.source}" data-pw-login="1">${s.connected ? "Connect again" : `Connect ${esc(s.name)}`}</button>${s.connected ? `<button class="btn sm danger" data-off="${s.source}" style="margin-left:auto">Disconnect</button>` : ""}</div></div>`;
  el.innerHTML = `<h3>Library sources</h3><div class="small muted">Read-only, through your own sign-in. Files are read only when you pick them in a library; the tokens stay in the vault.</div>
    ${block(g, `<div class="small dim" style="margin-top:2px">Asks Google for drive.readonly only; a wider grant is refused and nothing is kept.</div>`)}
    ${block(n, `<div class="small dim" style="margin-top:2px">Notion has no scopes in the sign-in link, so tick Read content only when you create the integration. Meldmind only ever calls Notion's read endpoints.</div>`)}`;
  const v = (s) => el.querySelector(s)?.value || "";
  const save = async (k) => { const body = { clientId: v(`[data-cid="${k}"]`) }; if (v(`[data-csec="${k}"]`).trim()) body.clientSecret = v(`[data-csec="${k}"]`); await api(`/libraries/${k}/client`, { method: "POST", body }); };
  el.querySelectorAll("[data-csave]").forEach((b) => b.addEventListener("click", async () => { try { await save(b.dataset.csave); await load(); renderSources(el); toast("Client saved"); } catch (e) { toast(e.message, true); } }));
  el.querySelectorAll("[data-connect]").forEach((b) => b.addEventListener("click", async () => {
    const k = b.dataset.connect;
    try { if (v(`[data-cid="${k}"]`) || v(`[data-csec="${k}"]`)) await save(k); const r = await api(`/libraries/${k}/start`, { method: "POST", body: { origin: location.origin } }); window.open(r.url, "_blank", "noopener"); toast("Sign in and allow read access; this page finishes the link when you come back."); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll("[data-off]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Disconnect? The tokens are removed from the vault. What is already indexed stays in your libraries.")) return;
    try { await api(`/libraries/${b.dataset.off}`, { method: "DELETE" }); await load(); renderSources(el); } catch (e) { toast(e.message, true); }
  }));
}
async function renderSettings(el) {
  if (!st.data) { try { await load(); } catch { el.innerHTML = ""; return; } }
  if (!st.data.available) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="panel" id="lib-sources-settings"></div>`;
  renderSources(el.firstElementChild);
}
async function finishIfBack() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state") || "";
  if (!code || !/^lib-[gn]-/.test(state)) return;
  for (const k of ["code", "state", "scope", "authuser", "prompt", "session_state", "iss", "hd"]) q.delete(k);
  history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
  const k = state.startsWith("lib-g-") ? "google" : "notion";
  try { const r = await api(`/libraries/${k}/finish`, { method: "POST", body: { code, state } }); toast(`${r.name} connected to your libraries (read-only).`); await load(); }
  catch (e) { toast(`Sign-in did not finish: ${e.message}`, true); }
}

// ---------- Command: which libraries this chat uses ----------
async function renderCommand(el) {
  const pid = currentProject();
  let a; try { a = await api(`/libraries/attached?${new URLSearchParams({ projectId: pid })}`); } catch { el.innerHTML = ""; return; }
  if (!a.libraries.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="route" style="margin-top:8px"><div class="row small" style="gap:8px;flex-wrap:wrap"><span class="muted">Libraries for this chat:</span>
    ${a.libraries.map((l) => `<label class="row small" style="gap:4px" title="${l.inUse && !l.chat ? "in use through the active workspace" : "use in this chat"}"><input type="checkbox" data-lib-chat="${esc(l.id)}" ${l.chat ? "checked" : ""}> ${esc(l.name)}${l.inUse && !l.chat ? ` <span class="chip violet">workspace</span>` : ""}</label>`).join("")}
    <span class="dim" style="margin-left:auto">${a.ids.length ? `excerpts cited as [L1], [L2]` : "none in use"}</span></div></div>`;
  el.querySelectorAll("[data-lib-chat]").forEach((c) => c.addEventListener("change", async () => {
    try { await api("/libraries/attach", { method: "POST", body: { libraryId: c.dataset.libChat, scope: "chat", target: currentProject() || "_", on: c.checked } }); st.data = null; renderCommand(el); }
    catch (e) { toast(e.message, true); c.checked = !c.checked; }
  }));
}
document.addEventListener("change", (e) => { if (e.target?.id === "proj") { const box = document.querySelector('#cmd-extras [data-feature="libraries"]'); if (box) renderCommand(box); } });

// ---------- Deliverable: library source chips; [L1] in the text opens the excerpt ----------
function sourcesOfLive() {
  const l = S.live; if (!l?.id) return [];
  return (l.kind === "council" ? l.council?.librarySources : l.mission?.librarySources) || [];
}
function showExcerpt(box, s) {
  const ex = box.querySelector(".lib-ex");
  if (ex?.dataset.n === s.n) { ex.remove(); return; }
  ex?.remove();
  const d = document.createElement("div"); d.className = "lib-ex"; d.dataset.n = s.n;
  d.innerHTML = `<div class="row small" style="gap:6px"><b class="n">[${esc(s.n)}]</b> ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}<span class="dim" style="margin-left:auto">library: ${esc(s.libraryName)}</span></div><pre>${esc(s.snippet || "")}${(s.snippet || "").length >= 600 ? "…" : ""}</pre>`;
  box.appendChild(d);
}
function linkify(root, sources, box) {
  if (!root || !sources.length) return;
  const byN = new Map(sources.map((s) => [s.n, s]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest("a, code, pre") ? NodeFilter.FILTER_REJECT : /\[L\d{1,2}\]/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const frag = document.createDocumentFragment(); const text = node.nodeValue; const re = /\[(L\d{1,2})\]/g; let m, last = 0;
    while ((m = re.exec(text))) {
      const s = byN.get(m[1]); if (!s) continue;
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = document.createElement("a"); a.className = "lib-cite"; a.href = "#"; a.title = `${s.title} (library: ${s.libraryName})`; a.textContent = m[1];
      a.addEventListener("click", (e) => { e.preventDefault(); showExcerpt(box, s); box.scrollIntoView({ block: "nearest" }); });
      frag.appendChild(a); last = m.index + m[0].length;
    }
    if (!last) continue;
    frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}
function renderDeliverable(el) {
  const sources = sourcesOfLive();
  if (!sources.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="lib-src"><span class="small muted" style="width:100%">From your libraries · click a tag to see the passage</span>${sources.map((s) => `<button class="chip" data-n="${esc(s.n)}" title="${esc(s.libraryName)}"><span class="n">[${esc(s.n)}]</span> <span class="t">${esc(s.title)}</span></button>`).join("")}</div>`;
  const box = el.querySelector(".lib-src");
  box.querySelectorAll("[data-n]").forEach((b) => b.addEventListener("click", () => showExcerpt(box, sources.find((s) => s.n === b.dataset.n))));
  linkify(document.getElementById("out-md"), sources, box);
  document.querySelectorAll("#council .ans .body").forEach((b) => linkify(b, sources, box));
}

// ---------- live updates ----------
let pending = null;
function onEvent(ev) {
  if (ev.type === "hello") finishIfBack();
  if (ev.type !== "library.update") return;
  clearTimeout(pending);
  pending = setTimeout(async () => {
    const view = document.querySelector("#view");
    if (!view?.querySelector(".lib-card, #lib-create")) { st.data = null; return; }
    try { await load(); if (ev.action === "indexed" && st.open === ev.id) await openDetail(ev.id); } catch { return; }
    renderTab(view);
  }, ev.action === "progress" ? 400 : 100);
}

CC.register({
  id: "libraries",
  tab: { label: "Libraries", short: "Libraries", icon: "▤", order: 13, render: (v) => { st.data = null; return renderTab(v); } },
  command: { order: 16, render: renderCommand },
  deliverable: { order: 6, render: renderDeliverable },
  settings: { order: 9, render: renderSettings },
  onEvent,
});
