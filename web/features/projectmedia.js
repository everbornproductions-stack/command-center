// Project Media library and persistent Asset Tray (Slice B3, gated by flag_projectmedia).
// Unifies generated images, video, audio, uploads, and project files into a single
// per-project Media tab and a collapsible Asset Tray across creation views.
const { S, api, apiBlobUrl, esc, toast, $, $$, render } = window.CC;

const CREATION_VIEWS = new Set([
  "command",
  "images",
  "media",
  "remix",
  "publish",
  "builders",
  "webbuilders",
]);

const ui = {
  subTabByProject: {},     // projectId -> "overview" | "media"
  filterType: "all",       // all | images | video | audio | uploads
  sort: "date-desc",       // date-desc | date-asc | name-asc | name-desc
  search: "",
  tag: "",
  collection: "",
  smart: "",
  selectedIds: new Set(),
  expandedStacks: new Set(),
  openSendMenuId: null,
  cacheByProject: {},      // projectId -> last API payload
  trayOpen: false,
  trayProjectId: "",
  trayType: "all",
  traySearch: "",
  trayDropWired: false,
};

function isEnabled() {
  // The server decides (release flag, env override or the saved setting) and sends the answer with the state.
  return S.projectMedia === true;
}

window.CC.projectMediaEnabled = isEnabled;

function injectStyles() {
  if (document.getElementById("cc-projectmedia-css")) return;
  const st = document.createElement("style");
  st.id = "cc-projectmedia-css";
  st.textContent = `
    .pm-subtabs { display:flex; gap:8px; margin-bottom:14px; border-bottom:1px solid var(--line); padding-bottom:8px; align-items:center; }
    .pm-subtab { padding:6px 14px; border-radius:6px; font-size:13px; cursor:pointer; border:1px solid transparent; background:transparent; color:var(--muted); }
    .pm-subtab.active { background:#112236; color:var(--fg); border-color:var(--accent, #22d3ee); font-weight:600; }
    .pm-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px; }
    .pm-dropzone { border:1px dashed var(--line); border-radius:8px; padding:12px 14px; margin-bottom:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:#0b111b; transition:border-color .15s, background .15s; }
    .pm-dropzone.dragover { border-color:var(--green, #22c55e); background:#0f241d; }
    .pm-filter-pills { display:flex; gap:4px; flex-wrap:wrap; }
    .pm-pill { padding:4px 10px; border-radius:999px; font-size:12px; border:1px solid var(--line); background:#0d1420; color:var(--muted); cursor:pointer; }
    .pm-pill.active { background:#142d4c; color:#fff; border-color:#38bdf8; }
    .pm-bulkbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:8px 12px; border-radius:8px; background:#132032; border:1px solid #2b4c7e; margin-bottom:12px; }
    .pm-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px; }
    .pm-card { background:#0d1420; border:1px solid var(--line); border-radius:10px; padding:10px; display:flex; flex-direction:column; gap:8px; position:relative; }
    .pm-card.selected { border-color:#38bdf8; box-shadow:0 0 0 1px #38bdf8; }
    .pm-thumb { height:140px; background:#070b12; border-radius:6px; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; }
    .pm-thumb img, .pm-thumb video { width:100%; height:100%; object-fit:cover; }
    .pm-card { min-width:0; overflow-wrap:anywhere; }
    .pm-dropzone span, .pm-bulkbar span, .tray-body .dim { overflow-wrap:anywhere; min-width:0; }
    .pm-badges { display:flex; gap:4px; flex-wrap:wrap; }
    .pm-badge { font-size:10px; padding:2px 6px; border-radius:4px; background:#17253a; color:#93c5fd; border:1px solid #1e3a5f; }
    .pm-badge.link { background:#2a1b3d; color:#d8b4fe; border-color:#581c87; }
    .pm-badge.usage { background:#122d24; color:#6ee7b7; border-color:#065f46; }
    .pm-badge.stack { background:#312514; color:#fcd34d; border-color:#78350f; cursor:pointer; }
    .pm-tags { display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
    .pm-tag { font-size:11px; padding:1px 6px; border-radius:4px; background:#1e293b; color:#cbd5e1; display:inline-flex; align-items:center; gap:4px; }
    .pm-lineage { border-top:1px dashed var(--line); padding-top:8px; margin-top:4px; display:flex; flex-direction:column; gap:6px; }
    .pm-lineage-row { display:flex; align-items:center; gap:6px; font-size:11px; background:#090e17; padding:4px 6px; border-radius:4px; }
    .pm-send-sheet { border-top:1px solid var(--line); padding-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
    #cc-asset-tray { position:fixed; right:16px; bottom:16px; z-index:900; width:360px; max-width:calc(100vw - 32px); background:#0c131f; border:1px solid var(--line); border-radius:10px; box-shadow:0 10px 28px rgba(0,0,0,.55); overflow:hidden; }
    #cc-asset-tray.collapsed { width:auto; }
    .tray-head { display:flex; align-items:center; gap:8px; padding:8px 12px; background:#111c2d; border-bottom:1px solid var(--line); }
    #cc-asset-tray.collapsed .tray-head { border-bottom:none; }
    .tray-body { padding:10px; max-height:320px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; }
    .tray-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; }
    .tray-item { background:#090e17; border:1px solid var(--line); border-radius:6px; padding:6px; cursor:grab; display:flex; flex-direction:column; gap:4px; }
    .tray-item:active { cursor:grabbing; }
    .tray-item img { width:100%; height:64px; object-fit:cover; border-radius:4px; background:#05080d; }
  `;
  document.head.appendChild(st);
}

// Files need the session token, so pictures and clips get a blob: address instead of a plain src.
const blobs = new Map();
function fillBlobs(root) {
  root.querySelectorAll("[data-pm-src]").forEach((el) => {
    const path = el.dataset.pmSrc;
    if (!blobs.has(path)) blobs.set(path, apiBlobUrl(path));
    blobs.get(path).then((u) => { el.src = u; }).catch(() => { blobs.delete(path); el.removeAttribute("data-pm-src"); el.alt = "missing"; });
  });
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(Number(ts)).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

async function fetchMedia(projectId) {
  if (!projectId) return null;
  const params = new URLSearchParams();
  if (ui.filterType && ui.filterType !== "all") params.set("type", ui.filterType);
  if (ui.sort) params.set("sort", ui.sort);
  if (ui.search.trim()) params.set("q", ui.search.trim());
  if (ui.tag) params.set("tag", ui.tag);
  if (ui.collection) params.set("collection", ui.collection);
  if (ui.smart) params.set("smart", ui.smart);
  const qs = params.toString();
  const data = await api(`/projectmedia/${encodeURIComponent(projectId)}${qs ? `?${qs}` : ""}`);
  ui.cacheByProject[projectId] = data;
  return data;
}

function readFilesAsBase64(fileList) {
  const files = Array.from(fileList || []);
  return Promise.all(
    files.map(
      (f) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = String(reader.result || "");
            const base64 = res.includes(",") ? res.split(",")[1] : res;
            resolve({
              name: f.name,
              mime: f.type || "application/octet-stream",
              data: base64,
            });
          };
          reader.onerror = () => reject(new Error(`Could not read ${f.name}`));
          reader.readAsDataURL(f);
        })
    )
  );
}

function renderThumbHtml(item) {
  const url = item.fileUrl;
  if (item.kind === "image" && item.hasFile) {
    return `<img data-pm-src="${esc(url)}" alt="${esc(item.name)}">`;
  }
  if (item.kind === "video" && item.hasFile) {
    return `<video data-pm-src="${esc(url)}" preload="metadata" muted controls></video>`;
  }
  if (item.kind === "audio") {
    return `<div class="small muted" style="padding:8px;text-align:center;width:100%">Audio: ${esc(item.name)}${item.hasFile ? `<audio data-pm-src="${esc(url)}" controls style="width:100%;margin-top:6px"></audio>` : ""}</div>`;
  }
  return `<div class="small muted" style="padding:10px;text-align:center"><div class="mono">${esc(item.kind.toUpperCase())}</div><div style="margin-top:4px;word-break:break-all">${esc(item.name)}</div></div>`;
}

function renderCardHtml(item, p) {
  const checked = ui.selectedIds.has(item.id);
  const expanded = ui.expandedStacks.has(item.id);
  const sendOpen = ui.openSendMenuId === item.id;
  const otherProjects = (S.projects || []).filter((x) => x.id !== p.id);

  const linkBadge = item.isLink && item.linkedFrom
    ? `<span class="pm-badge link" title="Metadata link, file stays in ${esc(item.linkedFrom.projectName)}">Linked from ${esc(item.linkedFrom.projectName)}</span>`
    : "";

  const stackBadge = item.versionCount > 1
    ? `<button type="button" class="pm-badge stack" data-pm-expand="${esc(item.id)}">${item.versionCount} versions ${expanded ? "▴" : "▾"}</button>`
    : "";

  const usageBadges = (item.usage || [])
    .map((u) => `<span class="pm-badge usage" title="${esc(u.label)}">${esc(u.label)}</span>`)
    .join("");

  const tagsHtml = (item.tags || [])
    .map(
      (t) =>
        `<span class="pm-tag">${esc(t)} <button type="button" class="ghost small" style="padding:0 2px;font-size:10px" data-pm-rmtag="${esc(t)}" data-pm-asset="${esc(item.id)}" aria-label="Remove tag ${esc(t)}">✕</button></span>`
    )
    .join("");

  const lineageHtml =
    expanded && Array.isArray(item.versions) && item.versions.length
      ? `<div class="pm-lineage">
          <div class="dim small">Version stack lineage (${item.versionCount} items):</div>
          <div class="pm-lineage-row"><span class="chip">v1 · root</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}</span></div>
          ${item.versions
            .map(
              (v, idx) => `<div class="pm-lineage-row">
                <span class="chip">v${idx + 2} · ${esc(v.op || "edit")}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v.prompt || v.name)}">${esc(v.name)}</span>
                <button type="button" class="ghost small" data-pm-unstack="${esc(v.id)}" title="Remove from stack">Unstack</button>
              </div>`
            )
            .join("")}
        </div>`
      : "";

  const sendMenuHtml = sendOpen
    ? `<div class="pm-send-sheet" role="menu" aria-label="Send to menu">
        <button type="button" class="btn sm" data-pm-send="remix" data-pm-asset="${esc(item.id)}">Send to Remix</button>
        <button type="button" class="btn sm" data-pm-send="finish" data-pm-asset="${esc(item.id)}">Send to Finish</button>
        <button type="button" class="btn sm" data-pm-send="copy-prompt" data-pm-asset="${esc(item.id)}">Copy prompt</button>
        ${
          otherProjects.length
            ? `<div class="row" style="width:100%;gap:4px;margin-top:4px">
                <select data-pm-target-proj="${esc(item.id)}" aria-label="Target project" style="flex:1;padding:3px 6px;font-size:12px">
                  ${otherProjects.map((op) => `<option value="${esc(op.id)}">${esc(op.name)}</option>`).join("")}
                </select>
                <button type="button" class="btn sm" data-pm-send="project" data-pm-asset="${esc(item.id)}">Send to Project</button>
              </div>`
            : `<span class="dim small">Create another project to link across projects.</span>`
        }
      </div>`
    : "";

  return `<div class="pm-card ${checked ? "selected" : ""}" data-pm-card="${esc(item.id)}" draggable="true">
    <div class="row" style="justify-content:space-between;gap:6px">
      <label class="row small" style="gap:6px;overflow:hidden;flex:1;cursor:pointer">
        <input type="checkbox" data-pm-check="${esc(item.id)}" ${checked ? "checked" : ""}>
        <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.name)}">${esc(item.name)}</span>
      </label>
      <span class="dim mono small">${esc(fmtDate(item.createdAt))}</span>
    </div>
    <div class="pm-thumb">${renderThumbHtml(item)}</div>
    <div class="pm-badges">
      <span class="pm-badge">${esc(item.isUpload ? "Upload" : item.kind)}</span>
      ${item.providerName ? `<span class="pm-badge">${esc(item.providerName)}</span>` : ""}
      ${linkBadge}
      ${stackBadge}
      ${usageBadges}
    </div>
    ${item.prompt ? `<div class="dim small" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" title="${esc(item.prompt)}">${esc(item.prompt)}</div>` : ""}
    <div class="pm-tags">
      ${tagsHtml}
      <button type="button" class="ghost small" style="font-size:11px;padding:1px 6px" data-pm-addtag="${esc(item.id)}">+ Tag</button>
      <button type="button" class="ghost small" style="font-size:11px;padding:1px 6px" data-pm-usage="${esc(item.id)}">+ Usage</button>
    </div>
    ${lineageHtml}
    <div class="row" style="justify-content:space-between;margin-top:auto;padding-top:4px">
      <span class="dim mono small">${esc(fmtSize(item.sizeBytes))}</span>
      <div class="row" style="gap:4px">
        <button type="button" class="btn sm" data-pm-sendmenu="${esc(item.id)}" aria-expanded="${sendOpen ? "true" : "false"}">Send to...</button>
      </div>
    </div>
    ${sendMenuHtml}
  </div>`;
}

function buildSmartOptions(smart, collections) {
  const opts = [`<option value="">All collections</option>`];
  if (Array.isArray(collections) && collections.length) {
    opts.push(`<optgroup label="Collections">`);
    for (const c of collections) {
      const val = `col:${c.name}`;
      const sel = ui.collection === c.name ? "selected" : "";
      opts.push(`<option value="${esc(val)}" ${sel}>Folder: ${esc(c.name)}</option>`);
    }
    opts.push(`</optgroup>`);
  }
  if (smart) {
    opts.push(`<optgroup label="Smart: By Date">`);
    opts.push(`<option value="smart:date:today" ${ui.smart === "date:today" ? "selected" : ""}>Today (${smart.byDate?.today || 0})</option>`);
    opts.push(`<option value="smart:date:this-week" ${ui.smart === "date:this-week" ? "selected" : ""}>This week (${smart.byDate?.["this-week"] || 0})</option>`);
    opts.push(`<option value="smart:date:older" ${ui.smart === "date:older" ? "selected" : ""}>Older (${smart.byDate?.older || 0})</option>`);
    opts.push(`</optgroup>`);
    if (Array.isArray(smart.byAi) && smart.byAi.length) {
      opts.push(`<optgroup label="Smart: Source AI">`);
      for (const a of smart.byAi) {
        const v = `smart:ai:${a.id}`;
        opts.push(`<option value="${esc(v)}" ${ui.smart === `ai:${a.id}` ? "selected" : ""}>AI: ${esc(a.label)} (${a.count})</option>`);
      }
      opts.push(`</optgroup>`);
    }
    if (Array.isArray(smart.byPrompt) && smart.byPrompt.length) {
      opts.push(`<optgroup label="Smart: Generation Prompt">`);
      for (const pr of smart.byPrompt) {
        const v = `smart:prompt:${pr.key}`;
        opts.push(`<option value="${esc(v)}" ${ui.smart === `prompt:${pr.key}` ? "selected" : ""}>Prompt: ${esc(pr.label)} (${pr.count})</option>`);
      }
      opts.push(`</optgroup>`);
    }
  }
  return opts.join("");
}

async function renderProjectMediaPanel(box, p) {
  if (!box || !p) return;
  injectStyles();
  let data = ui.cacheByProject[p.id];
  if (!data) {
    box.innerHTML = `<div class="panel"><div class="dim small">Loading project media...</div></div>`;
    try {
      data = await fetchMedia(p.id);
    } catch (e) {
      box.innerHTML = `<div class="panel"><div class="small" style="color:var(--red)">${esc(e.message)}</div></div>`;
      return;
    }
  }

  const items = data?.items || [];
  const allTags = data?.tags || ["client-ready", "draft", "final", "reference"];
  const selCount = ui.selectedIds.size;
  const otherProjects = (S.projects || []).filter((x) => x.id !== p.id);

  box.innerHTML = `<div class="panel" id="proj-media-panel">
    <div class="row" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Project Media <span class="dim small">(${data?.filteredTotal ?? items.length} of ${data?.total ?? items.length})</span></h3>
      <div class="row" style="margin-left:auto;gap:6px;flex-wrap:wrap">
        <button type="button" class="btn sm primary" data-pm-act="upload">Upload</button>
        <button type="button" class="btn sm" data-pm-act="from-last" title="${data?.lastGeneration ? esc(`Latest: ${data.lastGeneration.prompt || data.lastGeneration.jobId}`) : "Attach most recent generation"}">Add from last generation</button>
        <button type="button" class="btn sm" data-pm-act="new-collection">+ Collection</button>
        <button type="button" class="ghost small" data-pm-act="refresh">Refresh</button>
      </div>
    </div>

    <div class="pm-dropzone" id="pm-dropzone">
      <input type="file" id="pm-file-input" multiple hidden>
      <span class="small">Drag pictures, video, audio or files here, or click <b>Upload</b>. Your files are never copied twice.</span>
    </div>

    <div class="pm-toolbar">
      <div class="pm-filter-pills" role="group" aria-label="Filter media by type">
        ${[
          ["all", "All"],
          ["images", "Images"],
          ["video", "Video"],
          ["audio", "Audio"],
          ["uploads", "Uploads"],
        ]
          .map(
            ([id, label]) =>
              `<button type="button" class="pm-pill ${ui.filterType === id ? "active" : ""}" data-pm-type="${id}">${label}</button>`
          )
          .join("")}
      </div>

      <select id="pm-sort" aria-label="Sort media" style="width:auto;padding:4px 8px;font-size:12px">
        <option value="date-desc" ${ui.sort === "date-desc" ? "selected" : ""}>Date: Newest</option>
        <option value="date-asc" ${ui.sort === "date-asc" ? "selected" : ""}>Date: Oldest</option>
        <option value="name-asc" ${ui.sort === "name-asc" ? "selected" : ""}>Name: A to Z</option>
        <option value="name-desc" ${ui.sort === "name-desc" ? "selected" : ""}>Name: Z to A</option>
      </select>

      <select id="pm-smart-select" aria-label="Collections and smart groups" style="width:auto;padding:4px 8px;font-size:12px">
        ${buildSmartOptions(data?.smartCollections, data?.collections)}
      </select>

      <div class="row" style="flex:1;min-width:200px;gap:4px">
        <input type="search" id="pm-search" placeholder="Search by file name, prompt, tag, or AI" value="${esc(ui.search)}" style="flex:1;padding:5px 8px;font-size:12px" aria-label="Search project media">
        <button type="button" class="btn sm" data-pm-act="search">Search</button>
        ${ui.search || ui.tag || ui.collection || ui.smart || ui.filterType !== "all" ? `<button type="button" class="ghost small" data-pm-act="reset-filters">Reset</button>` : ""}
      </div>
    </div>

    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px">
      <span class="dim small">Tags:</span>
      <button type="button" class="pm-pill ${!ui.tag ? "active" : ""}" data-pm-tag="">All tags</button>
      ${allTags
        .map(
          (t) =>
            `<button type="button" class="pm-pill ${ui.tag === t ? "active" : ""}" data-pm-tag="${esc(t)}">#${esc(t)}</button>`
        )
        .join("")}
      <button type="button" class="ghost small" data-pm-act="select-all" style="margin-left:auto">Select all</button>
    </div>

    ${
      selCount > 0
        ? `<div class="pm-bulkbar" role="region" aria-label="Bulk actions">
            <span class="small"><b>${selCount}</b> selected</span>
            <button type="button" class="btn sm" data-pm-bulk="tag">Tag...</button>
            <button type="button" class="btn sm" data-pm-bulk="collection">Add to collection...</button>
            <button type="button" class="btn sm" data-pm-bulk="stack">Group as version stack</button>
            <button type="button" class="btn sm" data-pm-bulk="remix">Send to Remix</button>
            <button type="button" class="btn sm" data-pm-bulk="finish">Send to Finish</button>
            ${
              otherProjects.length
                ? `<select id="pm-bulk-proj" aria-label="Bulk target project" style="width:auto;padding:3px 6px;font-size:12px">
                    ${otherProjects.map((op) => `<option value="${esc(op.id)}">${esc(op.name)}</option>`).join("")}
                  </select>
                  <button type="button" class="btn sm" data-pm-bulk="link">Link to project</button>`
                : ""
            }
            <button type="button" class="btn sm" data-pm-bulk="export">Export manifest</button>
            <button type="button" class="btn sm danger" data-pm-bulk="delete">Remove</button>
            <button type="button" class="ghost small" data-pm-act="clear-select" style="margin-left:auto">Clear</button>
          </div>`
        : ""
    }

    ${
      items.length
        ? `<div class="pm-grid" id="pm-grid">${items.map((item) => renderCardHtml(item, p)).join("")}</div>`
        : `<div class="empty">No media matches in this project yet. Drag files above, click Upload, or click Add from last generation.</div>`
    }
  </div>`;

  fillBlobs(box);
  wireProjectMediaEvents(box, p);
}

function handleNavigateSendResult(res) {
  if (!res) return;
  if (res.target === "remix") {
    S.projectMediaPrefill = res;
    S.view = "remix";
    toast("Sent to Remix.");
    render();
    setTimeout(() => {
      const idea = $("#remix-idea");
      if (idea && res.prompt && !idea.value) idea.value = res.prompt;
    }, 80);
  } else if (res.target === "finish") {
    S.projectMediaPrefill = res;
    S.view = "media";
    toast("Sent to Finish.");
    render();
    setTimeout(() => {
      const mp = $("#md-prompt");
      if (mp && res.prompt && !mp.value) mp.value = res.prompt;
    }, 80);
  } else if (res.target === "copy-prompt") {
    const text = res.prompt || "";
    if (!text) return toast("No prompt stored on this asset.", true);
    navigator.clipboard?.writeText(text).catch(() => {});
    toast("Prompt copied.");
  } else if (res.target === "project") {
    toast(`Linked ${res.linkedCount || 1} asset(s) without copying files.`);
  }
}

function wireProjectMediaEvents(box, p) {
  const refreshPanel = async () => {
    await fetchMedia(p.id);
    await renderProjectMediaPanel(box, p);
  };

  const fileInput = $("#pm-file-input", box);
  const dropzone = $("#pm-dropzone", box);

  const doUpload = async (fileList) => {
    if (!fileList || !fileList.length) return;
    try {
      const encoded = await readFilesAsBase64(fileList);
      await api(`/projectmedia/${encodeURIComponent(p.id)}/upload`, {
        method: "POST",
        body: { files: encoded },
      });
      toast(`Uploaded ${encoded.length} file(s).`);
      await refreshPanel();
    } catch (e) {
      toast(e.message, true);
    }
  };

  fileInput?.addEventListener("change", () => doUpload(fileInput.files));

  if (dropzone) {
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer?.files?.length) doUpload(e.dataTransfer.files);
    });
  }

  $$("[data-pm-act]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      const act = b.dataset.pmAct;
      if (act === "upload") fileInput?.click();
      else if (act === "refresh") await refreshPanel();
      else if (act === "from-last") {
        try {
          const out = await api(`/projectmedia/${encodeURIComponent(p.id)}/from-last`, { method: "POST", body: {} });
          toast(out.mode === "linked" ? "Linked last generation into project." : "Added last generation to project.");
          await refreshPanel();
        } catch (e) {
          toast(e.message, true);
        }
      } else if (act === "new-collection") {
        const name = prompt("New collection name (e.g. Hero Shots, Finals, Storyboard)");
        if (!name) return;
        try {
          await api(`/projectmedia/${encodeURIComponent(p.id)}/collections`, {
            method: "POST",
            body: { action: "create", name },
          });
          toast(`Collection "${name}" created.`);
          await refreshPanel();
        } catch (e) {
          toast(e.message, true);
        }
      } else if (act === "search") {
        ui.search = $("#pm-search", box)?.value || "";
        await refreshPanel();
      } else if (act === "reset-filters") {
        ui.filterType = "all";
        ui.search = "";
        ui.tag = "";
        ui.collection = "";
        ui.smart = "";
        await refreshPanel();
      } else if (act === "select-all") {
        const cur = ui.cacheByProject[p.id]?.items || [];
        for (const a of cur) ui.selectedIds.add(a.id);
        await renderProjectMediaPanel(box, p);
      } else if (act === "clear-select") {
        ui.selectedIds.clear();
        await renderProjectMediaPanel(box, p);
      }
    })
  );

  $("#pm-search", box)?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.search = e.currentTarget.value || "";
      await refreshPanel();
    }
  });

  $$("[data-pm-type]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      ui.filterType = b.dataset.pmType || "all";
      await refreshPanel();
    })
  );

  $("#pm-sort", box)?.addEventListener("change", async (e) => {
    ui.sort = e.currentTarget.value || "date-desc";
    await refreshPanel();
  });

  $("#pm-smart-select", box)?.addEventListener("change", async (e) => {
    const val = e.currentTarget.value || "";
    ui.collection = "";
    ui.smart = "";
    if (val.startsWith("col:")) ui.collection = val.slice(4);
    else if (val.startsWith("smart:")) ui.smart = val.slice(6);
    await refreshPanel();
  });

  $$("[data-pm-tag]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      ui.tag = b.dataset.pmTag || "";
      await refreshPanel();
    })
  );

  $$("[data-pm-check]", box).forEach((cb) =>
    cb.addEventListener("change", async () => {
      const id = cb.dataset.pmCheck;
      if (cb.checked) ui.selectedIds.add(id);
      else ui.selectedIds.delete(id);
      await renderProjectMediaPanel(box, p);
    })
  );

  $$("[data-pm-expand]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.pmExpand;
      if (ui.expandedStacks.has(id)) ui.expandedStacks.delete(id);
      else ui.expandedStacks.add(id);
      await renderProjectMediaPanel(box, p);
    })
  );

  $$("[data-pm-unstack]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api(`/projectmedia/${encodeURIComponent(p.id)}/meta`, {
          method: "POST",
          body: { assetId: b.dataset.pmUnstack, parentId: null },
        });
        toast("Unstacked version.");
        await refreshPanel();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );

  $$("[data-pm-addtag]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      const tag = prompt("Add tag (client-ready, draft, final, reference, or custom):", "client-ready");
      if (!tag) return;
      try {
        await api(`/projectmedia/${encodeURIComponent(p.id)}/meta`, {
          method: "POST",
          body: { assetId: b.dataset.pmAddtag, addTags: [tag] },
        });
        await refreshPanel();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );

  $$("[data-pm-rmtag]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api(`/projectmedia/${encodeURIComponent(p.id)}/meta`, {
          method: "POST",
          body: { assetId: b.dataset.pmAsset, removeTags: [b.dataset.pmRmtag] },
        });
        await refreshPanel();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );

  $$("[data-pm-usage]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      const kind = prompt("Mark usage badge (posted, site, video):", "posted");
      if (!kind) return;
      try {
        await api(`/projectmedia/${encodeURIComponent(p.id)}/send`, {
          method: "POST",
          body: { assetId: b.dataset.pmUsage, target: kind.trim().toLowerCase() },
        });
        await refreshPanel();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );

  $$("[data-pm-sendmenu]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.pmSendmenu;
      ui.openSendMenuId = ui.openSendMenuId === id ? null : id;
      await renderProjectMediaPanel(box, p);
    })
  );

  $$("[data-pm-send]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      const target = b.dataset.pmSend;
      const assetId = b.dataset.pmAsset;
      const targetProjectId = $(`[data-pm-target-proj="${CSS.escape(assetId)}"]`, box)?.value || "";
      try {
        const res = await api(`/projectmedia/${encodeURIComponent(p.id)}/send`, {
          method: "POST",
          body: { assetId, target, targetProjectId },
        });
        ui.openSendMenuId = null;
        handleNavigateSendResult(res);
        if (target === "project") await refreshPanel();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );

  $$("[data-pm-bulk]", box).forEach((b) =>
    b.addEventListener("click", async () => {
      const act = b.dataset.pmBulk;
      const assetIds = [...ui.selectedIds];
      if (!assetIds.length) return;
      try {
        if (act === "tag") {
          const tag = prompt("Tag to apply to selected assets:", "client-ready");
          if (!tag) return;
          await api(`/projectmedia/${encodeURIComponent(p.id)}/bulk`, {
            method: "POST",
            body: { assetIds, action: "tag", tag },
          });
          toast(`Tagged ${assetIds.length} asset(s).`);
        } else if (act === "collection") {
          const collection = prompt("Collection name for selected assets:");
          if (!collection) return;
          await api(`/projectmedia/${encodeURIComponent(p.id)}/bulk`, {
            method: "POST",
            body: { assetIds, action: "collection", collection },
          });
          toast(`Added ${assetIds.length} asset(s) to "${collection}".`);
        } else if (act === "stack") {
          if (assetIds.length < 2) return toast("Select at least 2 assets to stack.", true);
          await api(`/projectmedia/${encodeURIComponent(p.id)}/bulk`, {
            method: "POST",
            body: { assetIds, action: "stack", parentId: assetIds[0] },
          });
          ui.selectedIds.clear();
          toast("Grouped selected assets into a version stack.");
        } else if (act === "link") {
          const targetProjectId = $("#pm-bulk-proj", box)?.value || "";
          if (!targetProjectId) return toast("Pick a target project first.", true);
          await api(`/projectmedia/${encodeURIComponent(p.id)}/bulk`, {
            method: "POST",
            body: { assetIds, action: "link", targetProjectId },
          });
          toast(`Linked ${assetIds.length} asset(s) to ${targetProjectId}.`);
        } else if (act === "remix" || act === "finish") {
          const res = await api(`/projectmedia/${encodeURIComponent(p.id)}/bulk`, {
            method: "POST",
            body: { assetIds, action: "send", sendTo: act },
          });
          handleNavigateSendResult(res);
          return;
        } else if (act === "export") {
          const res = await api(`/projectmedia/${encodeURIComponent(p.id)}/bulk`, {
            method: "POST",
            body: { assetIds, action: "export" },
          });
          const blob = new Blob([JSON.stringify(res.items || [], null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${p.id}-media-export.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1500);
          toast(`Exported ${res.count || 0} asset(s).`);
        } else if (act === "delete") {
          if (!confirm(`Remove ${assetIds.length} asset(s) from this project view?`)) return;
          await api(`/projectmedia/${encodeURIComponent(p.id)}/bulk`, {
            method: "POST",
            body: { assetIds, action: "delete" },
          });
          ui.selectedIds.clear();
          toast("Removed selected assets.");
        }
        await refreshPanel();
      } catch (e) {
        toast(e.message, true);
      }
    })
  );

  // Drag start for dragging cards into prompt boxes or Remix
  $$("[data-pm-card]", box).forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      const id = card.dataset.pmCard;
      const item = (ui.cacheByProject[p.id]?.items || []).find((x) => x.id === id);
      if (!item) return;
      e.dataTransfer?.setData("application/x-cc-asset", JSON.stringify(item));
      e.dataTransfer?.setData("text/plain", item.prompt || `[Asset: ${item.name}]`);
    });
  });
}

// Mounts the Overview | Media sub-tab inside renderProjectDetail when flag_projectmedia is ON.
window.CC.mountProjectMedia = (v, p) => {
  if (!isEnabled() || !v || !p) return;
  injectStyles();
  const headerRow = v.querySelector(".row");
  const overviewGrid = v.querySelector(".grid");
  if (!headerRow || !overviewGrid) return;

  const activeTab = ui.subTabByProject[p.id] || "overview";
  delete ui.cacheByProject[p.id]; // always show fresh files when the project opens

  let tabBar = v.querySelector(".pm-subtabs");
  if (!tabBar) {
    tabBar = document.createElement("div");
    tabBar.className = "pm-subtabs";
    headerRow.insertAdjacentElement("afterend", tabBar);
  }
  let mediaContainer = v.querySelector("#proj-media-slot");
  if (!mediaContainer) {
    mediaContainer = document.createElement("div");
    mediaContainer.id = "proj-media-slot";
    tabBar.insertAdjacentElement("afterend", mediaContainer);
  }

  const paintSubTabs = () => {
    const cur = ui.subTabByProject[p.id] || "overview";
    tabBar.innerHTML = `
      <button type="button" class="pm-subtab ${cur === "overview" ? "active" : ""}" data-proj-subtab="overview">Overview</button>
      <button type="button" class="pm-subtab ${cur === "media" ? "active" : ""}" data-proj-subtab="media">Media</button>
    `;
    overviewGrid.style.display = cur === "overview" ? "" : "none";
    mediaContainer.style.display = cur === "media" ? "" : "none";
    $$("[data-proj-subtab]", tabBar).forEach((b) =>
      b.addEventListener("click", () => {
        ui.subTabByProject[p.id] = b.dataset.projSubtab;
        paintSubTabs();
        if (ui.subTabByProject[p.id] === "media") {
          renderProjectMediaPanel(mediaContainer, p);
        }
      })
    );
  };

  paintSubTabs();
  if (activeTab === "media") {
    renderProjectMediaPanel(mediaContainer, p);
  }
};

// Wire global drop targets on prompt textareas and creation inputs so Asset Tray items can be dropped in one motion.
function ensureGlobalDropTargets() {
  if (ui.trayDropWired) return;
  ui.trayDropWired = true;
  document.addEventListener("dragover", (e) => {
    const t = e.target;
    if (!t || (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT")) return;
    if (e.dataTransfer?.types?.includes("application/x-cc-asset")) {
      e.preventDefault();
    }
  });
  document.addEventListener("drop", (e) => {
    const t = e.target;
    if (!t || (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT")) return;
    const raw = e.dataTransfer?.getData("application/x-cc-asset");
    if (!raw) return;
    e.preventDefault();
    try {
      const asset = JSON.parse(raw);
      const snippet = asset.prompt
        ? `${asset.prompt} [Ref: ${asset.name}]`
        : `[Ref: ${asset.name} (${asset.fileUrl})]`;
      t.value = t.value ? `${t.value}\n${snippet}` : snippet;
      t.dispatchEvent(new Event("input", { bubbles: true }));
      toast(`Inserted "${asset.name}" into prompt.`);
    } catch {
      /* ignore invalid drag payload */
    }
  });
}

function insertAssetIntoCurrentView(asset) {
  const selectors = [
    "#orders",
    "#im-prompt",
    "#md-prompt",
    "#remix-idea",
    "#remix-looks",
    "#builders-need",
    "#bd-notice",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const snippet = asset.prompt
        ? `${asset.prompt} [Ref: ${asset.name}]`
        : `[Ref: ${asset.name}]`;
      el.value = el.value ? `${el.value}\n${snippet}` : snippet;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
      toast(`Inserted "${asset.name}".`);
      return;
    }
  }
  navigator.clipboard?.writeText(asset.prompt || asset.name || "").catch(() => {});
  toast(`Copied "${asset.name}" reference.`);
}

// Persistent collapsible Asset Tray across creation views.
window.CC.syncAssetTray = async (viewName) => {
  const existing = document.getElementById("cc-asset-tray");
  if (!isEnabled() || !CREATION_VIEWS.has(String(viewName || S.view || ""))) {
    if (existing) existing.remove();
    return;
  }
  injectStyles();
  ensureGlobalDropTargets();

  const projectsList = S.projects || [];
  const activePid = ui.trayProjectId || S.project || projectsList[0]?.id || "";
  ui.trayProjectId = activePid;

  let tray = existing;
  if (!tray) {
    tray = document.createElement("aside");
    tray.id = "cc-asset-tray";
    tray.setAttribute("aria-label", "Project Asset Tray");
    document.body.appendChild(tray);
  }
  tray.classList.toggle("collapsed", !ui.trayOpen);

  if (!ui.trayOpen) {
    tray.innerHTML = `<div class="tray-head">
      <button type="button" class="btn sm" data-tray-act="toggle" aria-expanded="false">Asset Tray ${activePid ? `· ${esc(activePid)}` : ""}</button>
    </div>`;
    $("[data-tray-act='toggle']", tray)?.addEventListener("click", () => {
      ui.trayOpen = true;
      window.CC.syncAssetTray(S.view);
    });
    return;
  }

  let data = activePid ? ui.cacheByProject[activePid] : null;
  if (activePid && !data) {
    try {
      data = await api(`/projectmedia/${encodeURIComponent(activePid)}`);
      ui.cacheByProject[activePid] = data;
    } catch {
      data = { items: [] };
    }
  }

  const allItems = data?.items || [];
  const filtered = allItems.filter((a) => {
    if (ui.trayType !== "all") {
      if (ui.trayType === "images" && a.kind !== "image") return false;
      if (ui.trayType === "video" && a.kind !== "video") return false;
      if (ui.trayType === "audio" && a.kind !== "audio") return false;
      if (ui.trayType === "uploads" && !a.isUpload) return false;
    }
    if (ui.traySearch.trim()) {
      const q = ui.traySearch.trim().toLowerCase();
      const hay = `${a.name || ""} ${a.prompt || ""} ${(a.tags || []).join(" ")} ${a.provider || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  tray.innerHTML = `
    <div class="tray-head">
      <strong class="small" style="flex:1">Asset Tray</strong>
      <select id="tray-project-select" aria-label="Asset tray project" style="width:auto;max-width:140px;padding:2px 6px;font-size:11px">
        ${
          projectsList.length
            ? projectsList.map((pr) => `<option value="${esc(pr.id)}" ${pr.id === activePid ? "selected" : ""}>${esc(pr.name)}</option>`).join("")
            : `<option value="">No project</option>`
        }
      </select>
      <button type="button" class="ghost small" data-tray-act="refresh" title="Refresh tray">↻</button>
      <button type="button" class="ghost small" data-tray-act="toggle" aria-expanded="true">Collapse</button>
    </div>
    <div class="tray-body">
      <div class="row" style="gap:4px">
        <input type="search" id="tray-search" placeholder="Filter tray..." value="${esc(ui.traySearch)}" style="flex:1;padding:4px 6px;font-size:11px" aria-label="Filter asset tray">
        <select id="tray-type" aria-label="Asset tray type" style="width:auto;padding:4px 6px;font-size:11px">
          <option value="all" ${ui.trayType === "all" ? "selected" : ""}>All</option>
          <option value="images" ${ui.trayType === "images" ? "selected" : ""}>Images</option>
          <option value="video" ${ui.trayType === "video" ? "selected" : ""}>Video</option>
          <option value="audio" ${ui.trayType === "audio" ? "selected" : ""}>Audio</option>
          <option value="uploads" ${ui.trayType === "uploads" ? "selected" : ""}>Uploads</option>
        </select>
      </div>
      <div class="dim small">Drag any asset into a prompt or click Insert / Remix.</div>
      ${
        filtered.length
          ? `<div class="tray-grid">
              ${filtered
                .slice(0, 24)
                .map(
                  (a) => `<div class="tray-item" draggable="true" data-tray-asset="${esc(a.id)}" title="${esc(a.prompt || a.name)}">
                    ${a.kind === "image" && a.hasFile ? `<img data-pm-src="${esc(a.fileUrl)}" alt="${esc(a.name)}">` : `<div class="dim small mono" style="height:64px;display:flex;align-items:center;justify-content:center;background:#05080d;border-radius:4px">${esc(a.kind.toUpperCase())}</div>`}
                    <div class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">${esc(a.name)}</div>
                    <div class="row" style="gap:4px">
                      <button type="button" class="btn sm" style="flex:1;padding:2px 4px;font-size:10px" data-tray-insert="${esc(a.id)}">Insert</button>
                      <button type="button" class="btn sm" style="flex:1;padding:2px 4px;font-size:10px" data-tray-remix="${esc(a.id)}">Remix</button>
                    </div>
                  </div>`
                )
                .join("")}
            </div>`
          : `<div class="dim small" style="padding:10px 0;text-align:center">No assets in this project yet.</div>`
      }
    </div>
  `;

  fillBlobs(tray);
  $("[data-tray-act='toggle']", tray)?.addEventListener("click", () => {
    ui.trayOpen = false;
    window.CC.syncAssetTray(S.view);
  });

  $("[data-tray-act='refresh']", tray)?.addEventListener("click", async () => {
    if (activePid) delete ui.cacheByProject[activePid];
    await window.CC.syncAssetTray(S.view);
  });

  $("#tray-project-select", tray)?.addEventListener("change", (e) => {
    ui.trayProjectId = e.currentTarget.value || "";
    window.CC.syncAssetTray(S.view);
  });

  $("#tray-type", tray)?.addEventListener("change", (e) => {
    ui.trayType = e.currentTarget.value || "all";
    window.CC.syncAssetTray(S.view);
  });

  $("#tray-search", tray)?.addEventListener("input", (e) => {
    ui.traySearch = e.currentTarget.value || "";
    window.CC.syncAssetTray(S.view);
  });

  $$("[data-tray-asset]", tray).forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      const id = card.dataset.trayAsset;
      const asset = allItems.find((x) => x.id === id);
      if (!asset) return;
      e.dataTransfer?.setData("application/x-cc-asset", JSON.stringify(asset));
      e.dataTransfer?.setData("text/plain", asset.prompt || `[Asset: ${asset.name}]`);
    });
  });

  $$("[data-tray-insert]", tray).forEach((b) =>
    b.addEventListener("click", () => {
      const asset = allItems.find((x) => x.id === b.dataset.trayInsert);
      if (asset) insertAssetIntoCurrentView(asset);
    })
  );

  $$("[data-tray-remix]", tray).forEach((b) =>
    b.addEventListener("click", async () => {
      if (!activePid) return;
      try {
        const res = await api(`/projectmedia/${encodeURIComponent(activePid)}/send`, {
          method: "POST",
          body: { assetId: b.dataset.trayRemix, target: "remix" },
        });
        handleNavigateSendResult(res);
      } catch (e) {
        toast(e.message, true);
      }
    })
  );
};

window.CC.register({
  id: "projectmedia",
  settings: {
    order: 48,
    render(box) {
      const on = isEnabled();
      box.innerHTML = `<div class="panel">
        <h3>Project Media &amp; Asset Tray <span class="right">${on ? "on" : "off"}</span></h3>
        <label class="row small" style="gap:8px;cursor:pointer">
          <input type="checkbox" id="pm-flag-toggle" ${on ? "checked" : ""}>
          Enable unified Project Media tab and persistent Asset Tray (flag_projectmedia)
        </label>
        <div class="dim small" style="margin-top:6px">Unifies generated images, video, audio, and uploads inside each project with version stacks, tags, smart collections, cross-project links, and a draggable Asset Tray across creation views.</div>
      </div>`;
      $("#pm-flag-toggle", box)?.addEventListener("change", async (e) => {
        const nextOn = Boolean(e.currentTarget.checked);
        try {
          await api("/projectmedia/flag", { method: "POST", body: { on: nextOn } });
          S.settings = { ...(S.settings || {}), flag_projectmedia: nextOn };
          toast(nextOn ? "Project Media enabled." : "Project Media turned off.");
          window.CC.syncAssetTray?.(S.view);
          render();
        } catch (err) {
          toast(err.message, true);
        }
      });
    },
  },
  onEvent(ev) {
    if (ev?.type === "projectmedia.update" && ev.projectId) {
      delete ui.cacheByProject[ev.projectId];
      if (S.view === "projects" && S.openProject === ev.projectId) {
        const slot = document.getElementById("proj-media-slot");
        const proj = (S.projects || []).find((p) => p.id === ev.projectId);
        if (slot && proj && (ui.subTabByProject[proj.id] === "media")) {
          renderProjectMediaPanel(slot, proj);
        }
      }
      if (CREATION_VIEWS.has(S.view) && ui.trayOpen) {
        window.CC.syncAssetTray(S.view);
      }
    }
  },
  onState() {
    if (CREATION_VIEWS.has(S.view)) {
      window.CC.syncAssetTray?.(S.view);
    }
  },
});
