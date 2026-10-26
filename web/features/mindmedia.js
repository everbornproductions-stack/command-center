// MindMedia: one place for everything Meldmind makes (0.4.20). Left rail (All media, Unfiled, one entry per
// project), a grid of cards, search and filters, an inspector on the right, a "Needs an ending" shelf and bulk select.
// Data: GET /api/mindmedia. Keep, move, rename, tag, status and delete go through /api/mindmedia/*.
// Publishing uses CC.publishPanel (web/features/mindmedia-parts.js) and the existing /api/publish routes.
import "/features/mindmedia-parts.js";
const { S, api, apiBlobUrl, downloadBlob, esc, toast } = window.CC;

const TYPES = [["all", "All"], ["image", "Images"], ["video", "Video"], ["audio", "Audio"], ["text", "Text"], ["site", "Sites"], ["file", "Files"]];
const ui = { project: "all", type: "all", status: "all", source: "all", tag: "", q: "", sort: "date-desc", select: false, selected: new Set(), focus: null, data: null, busy: false };
const blobs = new Map();

const CSS = `
.mmh { display: grid; grid-template-columns: 210px minmax(0, 1fr) 340px; gap: 14px; align-items: start; color: var(--text); }
.mmh.noinsp { grid-template-columns: 210px minmax(0, 1fr); }
.mmh h2 { margin: 0 0 4px; font-size: 1.25rem; }
.mmh .mmh-sub { color: var(--muted); font-size: .9rem; margin-bottom: 10px; }
.mmh-rail { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 8px; }
.mmh-rail button { display: flex; align-items: center; gap: 8px; text-align: left; background: transparent; border: 0; border-radius: 8px; color: var(--text); padding: 8px 10px; cursor: pointer; }
.mmh-rail button:hover, .mmh-rail button:focus-visible { background: color-mix(in srgb, var(--text) 10%, transparent); outline: none; }
.mmh-rail button[aria-current="true"] { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--text); font-weight: 600; }
.mmh-rail .n { margin-left: auto; color: var(--muted); font-size: .8rem; }
.mmh-rail .sec { font-size: .68rem; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); padding: 10px 10px 2px; }
.mmh-main { min-width: 0; }
.mmh-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.mmh-bar input[type="search"], .mmh-bar select { background: var(--field-bg); color: var(--field-text); border: 1px solid var(--field-border); border-radius: 8px; padding: 7px 10px; }
.mmh-bar input[type="search"] { flex: 1 1 200px; min-width: 140px; }
.mmh-types { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.mmh-types button { background: transparent; border: 1px solid var(--line-2); color: var(--text); border-radius: 999px; padding: 4px 12px; cursor: pointer; font-size: .85rem; }
.mmh-types button[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); }
.mmh-more { margin-bottom: 10px; }
.mmh-more summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
.mmh-more .mmh-bar { margin-top: 8px; }
.mmh-shelf { border: 1px solid var(--amber); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 14px; background: color-mix(in srgb, var(--amber) 8%, var(--panel-solid)); }
.mmh-shelf h3 { margin: 0 0 6px; font-size: .95rem; }
.mmh-shelf .it { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line-2); flex-wrap: wrap; }
.mmh-shelf .it:first-of-type { border-top: 0; }
.mmh-shelf .it span.nm { flex: 1 1 140px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mmh-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.mmh-card { position: relative; display: flex; flex-direction: column; text-align: left; padding: 0; background: var(--panel-solid); color: var(--text); border: 1px solid var(--line-2); border-radius: 12px; overflow: hidden; cursor: pointer; }
.mmh-card:hover, .mmh-card:focus-visible { border-color: var(--accent); outline: none; }
.mmh-card[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent); }
.mmh-thumb { aspect-ratio: 4 / 3; background: var(--field-bg); color: var(--muted); display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: .8rem; padding: 8px; }
.mmh-thumb img, .mmh-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.mmh-thumb .tx { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; color: var(--field-text); text-align: left; width: 100%; white-space: pre-wrap; }
.mmh-thumb .ic { font-size: 1.6rem; }
.mmh-meta { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 4px; }
.mmh-meta b { font-size: .88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mmh-meta small { color: var(--muted); }
.mmh-pick { position: absolute; top: 8px; left: 8px; width: 20px; height: 20px; accent-color: var(--accent); }
.mmh-insp { position: sticky; top: 8px; border: 1px solid var(--line-2); border-radius: var(--radius); background: var(--panel-solid); padding: 12px; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 90px); overflow: auto; }
.mmh-insp .pv { aspect-ratio: 4 / 3; background: var(--field-bg); border-radius: 10px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.mmh-insp .pv img, .mmh-insp .pv video { width: 100%; height: 100%; object-fit: contain; }
.mmh-insp .pv pre { margin: 0; padding: 10px; white-space: pre-wrap; overflow: auto; max-height: 100%; width: 100%; color: var(--field-text); font: inherit; font-size: .85rem; }
.mmh-insp input[type="text"], .mmh-insp select { width: 100%; background: var(--field-bg); color: var(--field-text); border: 1px solid var(--field-border); border-radius: 8px; padding: 6px 9px; }
.mmh-insp .acts { display: flex; flex-wrap: wrap; gap: 6px; }
.mmh-insp .dl { color: var(--muted); font-size: .82rem; }
.mmh-insp ul { margin: 0; padding-left: 18px; font-size: .85rem; }
.mmh-bulk { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--accent); border-radius: 10px; margin-bottom: 10px; background: var(--panel-solid); }
.mmh-empty { border: 1px dashed var(--line-2); border-radius: var(--radius); padding: 24px; text-align: center; color: var(--muted); }
@media (max-width: 1000px) {
  .mmh, .mmh.noinsp { grid-template-columns: minmax(0, 1fr); }
  .mmh-rail { position: static; flex-direction: row; overflow-x: auto; gap: 6px; padding-bottom: 4px; }
  .mmh-rail button { white-space: nowrap; border: 1px solid var(--line-2); border-radius: 999px; }
  .mmh-rail .sec { display: none; }
  .mmh-insp { position: fixed; left: 8px; right: 8px; bottom: 8px; top: auto; max-height: 72vh; z-index: 40; box-shadow: 0 -8px 30px color-mix(in srgb, var(--bg) 60%, transparent); }
}
`;
function ensureCss() {
  if (document.getElementById("mmh-css")) return;
  const st = document.createElement("style");
  st.id = "mmh-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

const expert = () => (S.uiMode || "simple") === "expert";
const key = (it) => `${it.projectId}::${it.id}`;
const fileUrl = (it) => `/projectmedia/file?projectId=${encodeURIComponent(it.projectId)}&assetId=${encodeURIComponent(it.id)}`;
const when = (t) => { try { return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; } };
const ICON = { video: "▶", audio: "♪", site: "▤", file: "□", text: "¶", image: "▣" };

function query() {
  const p = new URLSearchParams();
  p.set("project", ui.project);
  if (ui.type !== "all") p.set("type", ui.type);
  if (ui.status !== "all") p.set("status", ui.status);
  if (ui.source !== "all") p.set("source", ui.source);
  if (ui.tag) p.set("tag", ui.tag);
  if (ui.q) p.set("q", ui.q);
  p.set("sort", ui.sort);
  return p.toString();
}

async function load() {
  ui.data = await api(`/mindmedia?${query()}`);
  return ui.data;
}

function thumbInto(el, it) {
  if (it.kind === "text") { el.innerHTML = `<div class="tx">${esc(it.textPreview || it.name)}</div>`; return; }
  if (it.kind === "image" && it.hasFile) {
    const p = fileUrl(it);
    if (!blobs.has(p)) blobs.set(p, apiBlobUrl(p));
    blobs.get(p).then((u) => { el.innerHTML = `<img alt="${esc(it.name)}" src="${u}">`; }).catch(() => { el.innerHTML = `<span class="ic">${ICON.image}</span>`; });
    return;
  }
  el.innerHTML = `<span class="ic" aria-hidden="true">${ICON[it.kind] || ICON.file}</span>`;
}

function railHtml(d) {
  const row = (id, label, n) => `<button type="button" data-p="${esc(id)}" aria-current="${ui.project === id ? "true" : "false"}">${esc(label)}<span class="n">${n}</span></button>`;
  const projects = (d.projects || []).filter((p) => p.id !== "unfiled");
  let h = row("all", "All media", d.total) + row("unfiled", "Unfiled", d.unfiledCount || 0);
  if (projects.length) h += `<div class="sec">Projects</div>` + projects.map((p) => row(p.id, p.name, p.count)).join("");
  return h;
}

function cardHtml(it) {
  const sel = ui.selected.has(key(it));
  const pressed = ui.select ? sel : ui.focus && key(ui.focus) === key(it);
  return `<button type="button" class="mmh-card" data-k="${esc(key(it))}" aria-pressed="${pressed ? "true" : "false"}" aria-label="${esc(it.name)}, ${esc(it.kind)}, ${esc(it.status)}">
    ${ui.select ? `<input type="checkbox" class="mmh-pick" tabindex="-1" aria-hidden="true" ${sel ? "checked" : ""}>` : ""}
    <div class="mmh-thumb" data-th></div>
    <div class="mmh-meta"><b>${esc(it.name)}</b><span>${window.CC.mmStatusChip(it.status)}</span><small>${esc(it.source || "")} &middot; ${esc(it.projectName || "")} &middot; ${esc(when(it.createdAt))}</small></div></button>`;
}

function versionsOf(it, all) {
  const root = it.parentId && all.find((x) => x.id === it.parentId && x.projectId === it.projectId) ? it.parentId : it.id;
  return all.filter((x) => x.projectId === it.projectId && (x.id === root || x.parentId === root));
}

async function inspectorHtml(it, d) {
  const projects = (d.projects || []);
  const versions = versionsOf(it, d.items || []);
  const dests = it.destinations || [];
  const prov = it.provenance || {};
  return `<aside class="mmh-insp" aria-label="Details for ${esc(it.name)}">
    <div class="pv" data-pv></div>
    <label class="lbl" for="mmh-name">Name</label><input type="text" id="mmh-name" value="${esc(it.name)}">
    <label class="lbl" for="mmh-status">Status</label>
    <select id="mmh-status">${(d.statuses || []).map((s) => `<option ${s === it.status ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
    <label class="lbl" for="mmh-tags">Tags (separate with commas)</label><input type="text" id="mmh-tags" value="${esc((it.tags || []).join(", "))}">
    <div class="dl">${esc(it.source || "")} &middot; ${esc(it.projectName || "")} &middot; ${esc(new Date(it.createdAt || Date.now()).toLocaleString())}</div>
    ${prov.prompt || prov.model ? `<details><summary class="dl">How it was made</summary><div class="dl">${prov.prompt ? `Prompt: ${esc(prov.prompt)}<br>` : ""}${prov.model ? `Model: ${esc(prov.model)}<br>` : ""}${prov.provider ? `From: ${esc(prov.provider)}<br>` : ""}${prov.cost != null ? `Cost: $${Number(prov.cost).toFixed(2)}` : ""}</div></details>` : ""}
    ${dests.length ? `<div><div class="dl">Where it went</div><ul>${dests.map((x) => `<li>${/^https?:\/\//.test(x.link || "") ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.label)}</a>` : esc(x.label)} <span class="dl">${esc(new Date(x.at).toLocaleString())}</span></li>`).join("")}</ul></div>` : ""}
    ${versions.length > 1 ? `<div><div class="dl">Versions</div><ul>${versions.map((v) => `<li>${v.id === it.id ? "<b>" : ""}${esc(v.name)} (${esc(when(v.createdAt))})${v.id === it.id ? "</b>" : ""}</li>`).join("")}</ul></div>` : ""}
    <label class="lbl" for="mmh-move">Send to</label>
    <select id="mmh-move"><option value="">Move to a project...</option>${projects.filter((p) => p.id !== it.projectId).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
    <div class="acts"><button type="button" class="btn sm primary" data-a="publish">Publish</button><button type="button" class="btn sm" data-a="download">Download</button><button type="button" class="btn sm" data-a="delete">Delete</button><button type="button" class="btn sm" data-a="close">Close</button></div>
    <div data-pub></div>
  </aside>`;
}

async function fillPreview(el, it) {
  if (it.kind === "text") {
    try { const r = await api(`/mindmedia/item?projectId=${encodeURIComponent(it.projectId)}&assetId=${encodeURIComponent(it.id)}`); el.innerHTML = `<pre>${esc(r.text)}</pre>`; } catch { el.textContent = "Could not load the words."; }
    return;
  }
  if (!it.hasFile) { el.innerHTML = `<span class="dl">No file to preview.</span>`; return; }
  const p = fileUrl(it);
  if (!blobs.has(p)) blobs.set(p, apiBlobUrl(p));
  try {
    const u = await blobs.get(p);
    el.innerHTML = it.kind === "image" ? `<img alt="${esc(it.name)}" src="${u}">` : it.kind === "video" ? `<video controls src="${u}"></video>` : it.kind === "audio" ? `<audio controls src="${u}"></audio>` : `<span class="dl">Preview not available. Use Download.</span>`;
  } catch { el.textContent = "Could not load the preview."; }
}

async function render(view) {
  ensureCss();
  if (S.mmFocus) {
    const f = S.mmFocus; S.mmFocus = null;
    ui.project = "all"; ui.type = "all"; ui.status = "all"; ui.q = ""; ui.source = "all"; ui.tag = "";
    ui.focus = { projectId: f.projectId, id: f.assetId };
  }
  let d;
  try { d = await load(); } catch (e) { view.innerHTML = `<div class="empty" role="alert">${esc(e.message)}</div>`; return; }
  if (ui.focus) {
    const hit = (d.items || []).find((x) => x.projectId === ui.focus.projectId && x.id === ui.focus.id);
    ui.focus = hit || null;
  }
  const items = d.items || [];
  const showInsp = !ui.select && ui.focus;
  view.innerHTML = `<div class="mmh${showInsp ? "" : " noinsp"}">
    <nav class="mmh-rail" aria-label="MindMedia places">${railHtml(d)}</nav>
    <section class="mmh-main" aria-label="MindMedia">
      <h2>MindMedia</h2><div class="mmh-sub">Everything Meldmind makes, in one place. Nothing is posted or sent without your click.</div>
      <div class="mmh-bar"><input type="search" id="mmh-q" placeholder="Search names, words and prompts" aria-label="Search MindMedia" value="${esc(ui.q)}"><button type="button" class="btn sm" id="mmh-select">${ui.select ? "Done selecting" : "Select"}</button></div>
      <div class="mmh-types" role="group" aria-label="Type">${TYPES.map(([id, l]) => `<button type="button" data-t="${id}" aria-pressed="${ui.type === id}">${l}</button>`).join("")}</div>
      <details class="mmh-more" ${expert() || ui.status !== "all" || ui.tag || ui.source !== "all" ? "open" : ""}><summary>More filters</summary>
        <div class="mmh-bar">
          <label>Status <select id="mmh-fs"><option value="all">All</option>${(d.statuses || []).map((s) => `<option ${ui.status === s ? "selected" : ""} value="${esc(s)}">${esc(s)} (${d.statusCounts?.[s] || 0})</option>`).join("")}</select></label>
          <label>Tag <select id="mmh-ft"><option value="">Any</option>${(d.tags || []).map((t) => `<option ${ui.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label>Made by <select id="mmh-fo"><option value="all">Anything</option>${(d.sources || []).map((t) => `<option ${ui.source === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <label>Sort <select id="mmh-so"><option value="date-desc" ${ui.sort === "date-desc" ? "selected" : ""}>Newest</option><option value="date-asc" ${ui.sort === "date-asc" ? "selected" : ""}>Oldest</option><option value="name" ${ui.sort === "name" ? "selected" : ""}>Name</option></select></label>
        </div></details>
      ${ui.select ? `<div class="mmh-bulk" role="group" aria-label="Selected items"><b>${ui.selected.size} selected</b>
        <select id="mmh-bs" aria-label="Set status"><option value="">Set status...</option>${(d.statuses || []).map((s) => `<option>${esc(s)}</option>`).join("")}</select>
        <select id="mmh-bm" aria-label="Move to project"><option value="">Move to project...</option>${(d.projects || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
        <button type="button" class="btn sm" id="mmh-bd">Delete</button></div>` : ""}
      ${(d.needsEnding || []).length && ui.project === "all" && !ui.q && ui.type === "all" ? `<div class="mmh-shelf" role="region" aria-label="Needs an ending"><h3>Needs an ending</h3><div class="dl">Made but not used yet. Keep it, publish it, or discard it.</div>
        ${d.needsEnding.map((it) => `<div class="it" data-k="${esc(key(it))}"><span class="nm">${esc(it.name)}</span><button type="button" class="btn sm" data-e="keep">Keep</button><button type="button" class="btn sm primary" data-e="publish">Publish</button><button type="button" class="btn sm" data-e="discard">Discard</button></div>`).join("")}</div>` : ""}
      ${items.length ? `<div class="mmh-grid">${items.map(cardHtml).join("")}</div>` : `<div class="mmh-empty">${d.total ? "Nothing matches these filters." : "Nothing here yet. Anything you make in Meldmind shows up here: images, video, voice, written results and sites."}</div>`}
    </section>
    ${showInsp ? `<div id="mmh-insp-slot"></div>` : ""}
  </div>`;

  const byKey = new Map(items.concat(d.needsEnding || []).map((i) => [key(i), i]));
  view.querySelectorAll(".mmh-card").forEach((c) => thumbInto(c.querySelector("[data-th]"), byKey.get(c.dataset.k)));
  const redraw = () => render(view);
  view.querySelectorAll(".mmh-rail [data-p]").forEach((b) => b.addEventListener("click", () => { ui.project = b.dataset.p; ui.focus = null; ui.selected.clear(); redraw(); }));
  view.querySelectorAll(".mmh-types [data-t]").forEach((b) => b.addEventListener("click", () => { ui.type = b.dataset.t; redraw(); }));
  let qt;
  view.querySelector("#mmh-q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(async () => { ui.q = e.target.value; await redraw(); const q2 = view.querySelector("#mmh-q"); q2?.focus(); q2?.setSelectionRange(q2.value.length, q2.value.length); }, 250); });
  for (const [id, field] of [["#mmh-fs", "status"], ["#mmh-ft", "tag"], ["#mmh-fo", "source"], ["#mmh-so", "sort"]]) view.querySelector(id)?.addEventListener("change", (e) => { ui[field] = e.target.value; redraw(); });
  view.querySelector("#mmh-select").addEventListener("click", () => { ui.select = !ui.select; ui.selected.clear(); if (ui.select) ui.focus = null; redraw(); });
  view.querySelectorAll(".mmh-card").forEach((c) => c.addEventListener("click", () => {
    const it = byKey.get(c.dataset.k);
    if (ui.select) { const k = key(it); if (ui.selected.has(k)) ui.selected.delete(k); else ui.selected.add(k); redraw(); return; }
    ui.focus = it; redraw();
  }));

  // bulk
  const chosen = () => [...ui.selected].map((k) => byKey.get(k)).filter(Boolean);
  view.querySelector("#mmh-bs")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    try { for (const it of chosen()) await api("/mindmedia/meta", { method: "POST", body: { projectId: it.projectId, assetId: it.id, status: e.target.value } }); toast(`Status set to ${e.target.value}.`); ui.selected.clear(); redraw(); } catch (er) { toast(er.message, true); }
  });
  view.querySelector("#mmh-bm")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    try { for (const it of chosen()) await api("/mindmedia/move", { method: "POST", body: { projectId: it.projectId, assetId: it.id, targetProjectId: e.target.value } }); toast("Moved."); ui.selected.clear(); redraw(); } catch (er) { toast(er.message, true); }
  });
  view.querySelector("#mmh-bd")?.addEventListener("click", async () => {
    const list = chosen();
    if (!list.length) return toast("Pick something first.", true);
    if (!(await window.CC.confirm(`Move ${list.length} item${list.length === 1 ? "" : "s"} to the Trash? You can restore ${list.length === 1 ? "it" : "them"} for 30 days. Files in other places are not touched.`, { danger: true, ok: "Move to Trash" }))) return;
    try { await api("/mindmedia/delete", { method: "POST", body: { items: list.map((i) => ({ projectId: i.projectId, assetId: i.id })) } }); toast("Deleted."); ui.selected.clear(); redraw(); } catch (er) { toast(er.message, true); }
  });

  // shelf
  view.querySelectorAll(".mmh-shelf .it").forEach((row) => {
    const it = byKey.get(row.dataset.k);
    row.querySelector('[data-e="keep"]').addEventListener("click", async () => { try { await api("/mindmedia/ending", { method: "POST", body: { projectId: it.projectId, assetId: it.id, action: "keep" } }); toast("Kept."); redraw(); } catch (e) { toast(e.message, true); } });
    row.querySelector('[data-e="discard"]').addEventListener("click", async () => { try { await api("/mindmedia/ending", { method: "POST", body: { projectId: it.projectId, assetId: it.id, action: "discard" } }); toast("Discarded."); redraw(); } catch (e) { toast(e.message, true); } });
    row.querySelector('[data-e="publish"]').addEventListener("click", () => { ui.focus = it; ui.openPublish = true; redraw(); });
  });

  // inspector
  const slot = view.querySelector("#mmh-insp-slot");
  if (slot && ui.focus) {
    const it = ui.focus;
    slot.outerHTML = await inspectorHtml(it, d);
    const insp = view.querySelector(".mmh-insp");
    fillPreview(insp.querySelector("[data-pv]"), it);
    const patch = async (body, msg) => { try { await api("/mindmedia/meta", { method: "POST", body: { projectId: it.projectId, assetId: it.id, ...body } }); if (msg) toast(msg); redraw(); } catch (e) { toast(e.message, true); } };
    insp.querySelector("#mmh-name").addEventListener("change", (e) => { if (e.target.value.trim()) patch({ name: e.target.value.trim() }, "Renamed."); });
    insp.querySelector("#mmh-status").addEventListener("change", (e) => patch({ status: e.target.value }, `Status: ${e.target.value}.`));
    insp.querySelector("#mmh-tags").addEventListener("change", (e) => patch({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }, "Tags saved."));
    insp.querySelector("#mmh-move").addEventListener("change", async (e) => {
      if (!e.target.value) return;
      try { await api("/mindmedia/move", { method: "POST", body: { projectId: it.projectId, assetId: it.id, targetProjectId: e.target.value } }); toast("Moved."); ui.focus = null; redraw(); } catch (er) { toast(er.message, true); }
    });
    insp.querySelector('[data-a="close"]').addEventListener("click", () => { ui.focus = null; redraw(); });
    insp.querySelector('[data-a="delete"]').addEventListener("click", async () => {
      if (!(await window.CC.confirm(`Move "${it.name}" to the Trash? You can restore it for 30 days.`, { danger: true, ok: "Move to Trash" }))) return;
      try { await api("/mindmedia/delete", { method: "POST", body: { items: [{ projectId: it.projectId, assetId: it.id }] } }); toast("Deleted."); ui.focus = null; redraw(); } catch (e) { toast(e.message, true); }
    });
    insp.querySelector('[data-a="download"]').addEventListener("click", async () => {
      try {
        if (it.kind === "text") { const r = await api(`/mindmedia/item?projectId=${encodeURIComponent(it.projectId)}&assetId=${encodeURIComponent(it.id)}`); downloadBlob(URL.createObjectURL(new Blob([r.text], { type: "text/markdown" })), `${it.name.replace(/\.md$/i, "")}.md`); return; }
        downloadBlob(await apiBlobUrl(fileUrl(it)), it.name);
      } catch (e) { toast(e.message, true); }
    });
    const pubBox = insp.querySelector("[data-pub]");
    const openPub = () => window.CC.publishPanel(pubBox, { projectId: it.projectId, assetId: it.id, kind: it.kind, title: it.name, onResult: () => setTimeout(redraw, 600) });
    insp.querySelector('[data-a="publish"]').addEventListener("click", openPub);
    if (ui.openPublish) { ui.openPublish = false; openPub(); insp.scrollIntoView?.({ block: "nearest" }); }
  }
}

window.CC.register({
  id: "mindmedia",
  tab: { label: "MindMedia", short: "MindMedia", icon: "▦", order: 38, render },
  onEvent(ev) { if (ev.type === "projectmedia.update" && S.view === "mindmedia") { const v = document.getElementById("view"); if (v && !ui.busy) render(v); } },
});
