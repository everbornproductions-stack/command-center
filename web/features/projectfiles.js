// Chat with files (Phase 6): "Files in this project" in Command. Drop PDFs, Word files, text or images onto
// the box (or pick them), see what will be read and what it costs, then Add to project. After that every
// chat, council and mission in the project can answer from them, cited as [L1], [L2] (the library chips
// under the deliverable open the passage). Images are described once by an AI that can see them.
const { S, api, apiBlobUrl, toast, esc, money } = window.CC;

const css = `
.pf-drop { border: 1px dashed var(--line); border-radius: 10px; padding: 10px 12px; margin-top: 8px; transition: border-color .15s, background .15s; }
.pf-drop.over { border-color: var(--accent, #22d3ee); background: rgba(34, 211, 238, .06); }
.pf-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.pf-files .chip { display: inline-flex; align-items: center; gap: 4px; max-width: 260px; }
.pf-files .chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-files img { width: 22px; height: 22px; object-fit: cover; border-radius: 4px; }
.pf-files button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 2px; opacity: .7; }
`;
const style = document.createElement("style"); style.id = "cc-projectfiles-style"; style.textContent = css; document.head.appendChild(style);

const st = { stage: null, busy: false };
const currentProject = () => document.getElementById("proj")?.value || S.project || "";
const b64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const isBinary = (name) => /\.(pdf|docx|png|jpe?g|webp|gif)$/i.test(name);

async function readFiles(list) {
  const out = [];
  for (const f of list) out.push(isBinary(f.name) ? { name: f.name, data: b64(await f.arrayBuffer()) } : { name: f.name, text: await f.text() });
  return out;
}

async function renderCommand(el) {
  const pid = currentProject();
  if (!pid) { el.innerHTML = `<div class="pf-drop small dim" id="pf-drop">Pick a project to drop files into it and ask about them.</div>`; return; }
  let ov; try { ov = await api(`/projectfiles/${encodeURIComponent(pid)}`); } catch (e) { el.innerHTML = /desktop app/.test(e.message) ? `<div class="pf-drop small dim">${esc(e.message)}</div>` : ""; return; }
  const sg = st.stage?.projectId === pid ? st.stage : null;
  el.innerHTML = `<div class="pf-drop" id="pf-drop"><div class="row small" style="gap:8px;flex-wrap:wrap"><b>Files in this project</b>
      <span class="dim">drop PDFs, Word, text or images here, then ask about them</span>
      <label class="btn sm" style="margin-left:auto">Pick files<input type="file" id="pf-pick" multiple hidden></label></div>
    ${ov.files.length ? `<div class="pf-files">${ov.files.map((f) => `<span class="chip" title="${esc(f.title)} · ${f.chunks} passage${f.chunks === 1 ? "" : "s"}">${f.image ? `<img data-pf-img="${f.id}" alt="">` : ""}<span>${esc(f.title)}</span><button data-pf-del="${f.id}" title="Remove from this project">Remove</button></span>`).join("")}</div>
      <div class="dim small" style="margin-top:4px">Chats, councils and missions in this project read these and cite them as [L1], [L2].</div>` : ""}
    ${sg ? `<div class="route small" style="margin-top:8px">${sg.files.length + sg.images.length ? `Ready: ${[...sg.files.map((f) => esc(f.title)), ...sg.images.map((i) => `${esc(i.title)} (image)`)].join(", ")}.` : "Nothing new to add."}
      ${sg.skipped.length ? `<div class="dim">Skipped: ${sg.skipped.map((s) => `${esc(s.title)} (${esc(s.reason)})`).join("; ")}</div>` : ""}
      ${sg.files.length + sg.images.length ? `<div class="row" style="margin-top:6px;gap:8px"><span>≈ <b>${money(sg.estimate.usd, 5)}</b> <span class="dim">${sg.estimate.images ? `${sg.estimate.images} image${sg.estimate.images === 1 ? "" : "s"} described by ${esc(sg.estimate.describer)}, ` : ""}passages embedded by ${esc(sg.estimate.embed.providerName)}</span></span>${sg.estimate.capped ? '<span class="chip red">at its spend cap</span>' : ""}
        <button class="btn sm primary" id="pf-add" style="margin-left:auto" ${st.busy || sg.estimate.capped ? "disabled" : ""}>${st.busy ? "Adding..." : "Add to project"}</button><button class="btn sm" id="pf-cancel">Cancel</button></div>` : ""}
      <div class="dim" style="margin-top:4px">File text goes only to the embedding model${sg.images.length ? " and images only to the AI that describes them" : ""}, with your own key. Nothing is spent until you click Add.</div></div>` : ""}
    ${ov.library?.job?.status === "indexing" ? `<div class="dim small" style="margin-top:4px">Indexing ${ov.library.job.done} of ${ov.library.job.total} passages...</div>` : ""}</div>`;

  const drop = el.querySelector("#pf-drop");
  const take = async (files) => {
    if (!files?.length) return;
    try { const body = { files: await readFiles([...files]) }; const r = await api(`/projectfiles/${encodeURIComponent(pid)}/stage`, { method: "POST", body }); st.stage = { ...r, projectId: pid }; }
    catch (e) { toast(e.message, true); }
    renderCommand(el);
  };
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer?.files); });
  el.querySelector("#pf-pick").addEventListener("change", (e) => take(e.target.files));
  el.querySelector("#pf-cancel")?.addEventListener("click", () => { st.stage = null; renderCommand(el); });
  el.querySelector("#pf-add")?.addEventListener("click", async () => {
    st.busy = true; renderCommand(el);
    try {
      const r = await api(`/projectfiles/${encodeURIComponent(pid)}/add`, { method: "POST", body: { stageId: sg.stageId, estimate: sg.estimate.usd } });
      toast(`Added to the project${r.described.length ? ` (${r.described.length} image${r.described.length === 1 ? "" : "s"} described)` : ""}${r.failed.length ? `. Not added: ${r.failed.map((f) => `${f.title}: ${f.reason}`).join("; ")}` : ""}`, !!r.failed.length);
    } catch (e) { toast(e.message, true); }
    st.busy = false; st.stage = null; renderCommand(el);
  });
  el.querySelectorAll("[data-pf-del]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/projectfiles/${encodeURIComponent(pid)}/files/${b.dataset.pfDel}`, { method: "DELETE" }); renderCommand(el); } catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll("[data-pf-img]").forEach((img) => apiBlobUrl(`/projectfiles/${encodeURIComponent(pid)}/files/${img.dataset.pfImg}/image`).then((u) => { img.src = u; }).catch(() => img.remove()));
}

const box = () => document.querySelector('#cmd-extras [data-feature="projectfiles"]');
document.addEventListener("change", (e) => { if (e.target?.id === "proj" && box()) { st.stage = null; renderCommand(box()); } });
let pending = null;
function onEvent(ev) {
  if (ev.type !== "library.update" || !box() || st.busy) return;
  clearTimeout(pending);
  pending = setTimeout(() => { if (box()) renderCommand(box()); }, ev.action === "progress" ? 500 : 150);
}

CC.register({ id: "projectfiles", command: { order: 15, render: renderCommand }, onEvent });
