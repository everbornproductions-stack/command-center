// Ask to modify a picture or video that is already on this computer.
// Show the plan, then Run. Nothing is spent or sent from this file.
const { api, apiBlobUrl, downloadBlob, toast } = window.CC;

const ASKS = {
  image: [
    ["Retouch", "Retouch this picture"],
    ["Variation", "Make a variation of this picture"],
    ["Describe", "Describe this picture"],
  ],
  video: [
    ["Trim", "Trim this video shorter"],
    ["Caption", "Caption this video"],
    ["Describe", "Describe this video"],
  ],
};

if (!document.getElementById("mm-style")) {
  const style = document.createElement("style");
  style.id = "mm-style";
  style.textContent = `.mm-panel { margin-top: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; }
.mm-panel img, .mm-panel video { max-width: 240px; max-height: 160px; display: block; margin-top: 6px; background: #0b1220; }
.mm-actions, .mm-save { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.mm-panel textarea, .mm-panel select { width: 100%; }`;
  document.head.appendChild(style);
}

export function mediaKind(file) {
  const kind = file?.kind;
  const mime = String(file?.mime || "");
  const name = String(file?.name || "").toLowerCase();
  if (kind === "video" || mime.startsWith("video/") || /\.(mp4|webm|mov)$/.test(name)) return "video";
  if (kind === "image" || mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name)) return "image";
  return "";
}

function projectSelect() {
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Project");
  const projects = window.CC.S?.projects || [];
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name || project.id;
    sel.appendChild(option);
  }
  if (!sel.options.length) {
    const option = document.createElement("option");
    option.value = "my-project";
    option.textContent = "My project";
    sel.appendChild(option);
  }
  return sel;
}

export function mountModify(host, { file, where, ideaId, sourceUrl }) {
  const kind = mediaKind(file);
  if (!host || !kind || !file?.id) return;
  host.replaceChildren();
  const panel = document.createElement("div");
  panel.className = "mm-panel";
  const intro = document.createElement("div");
  intro.className = "dim small";
  intro.textContent = "A picture or video can be retouched or described after you see the plan. Run is a separate click. Nothing is sent until then.";
  const preview = document.createElement("div");
  const ask = document.createElement("textarea");
  ask.rows = 2;
  ask.maxLength = 2000;
  ask.setAttribute("aria-label", kind === "video" ? "What to do with this video" : "What to do with this picture");
  ask.placeholder = kind === "video" ? "Trim, caption, or describe this video" : "Retouch, vary, or describe this picture";
  const actions = document.createElement("div");
  actions.className = "mm-actions";
  for (const [label, words] of ASKS[kind]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn sm";
    button.textContent = label;
    button.addEventListener("click", () => { ask.value = words; });
    actions.appendChild(button);
  }
  const planBtn = document.createElement("button");
  planBtn.type = "button";
  planBtn.className = "btn sm";
  planBtn.textContent = "Show the plan";
  actions.appendChild(planBtn);
  const note = document.createElement("div");
  note.className = "small";
  note.style.marginTop = "6px";
  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "btn sm primary";
  runBtn.textContent = "Run";
  runBtn.hidden = true;
  const result = document.createElement("div");
  const saveRow = document.createElement("div");
  saveRow.className = "mm-save";
  saveRow.hidden = true;
  panel.append(intro, preview, ask, actions, note, runBtn, result, saveRow);
  host.appendChild(panel);

  const body = () => ({ fileId: file.id, where, ideaId: ideaId || undefined, ask: ask.value });
  let planned = null;

  ask.addEventListener("input", () => {
    planned = null;
    runBtn.hidden = true;
    note.textContent = "";
  });

  planBtn.addEventListener("click", async () => {
    planned = null;
    runBtn.hidden = true;
    try {
      planned = await api("/media-modify/plan", { method: "POST", body: body() });
      note.textContent = planned.message || "";
      runBtn.hidden = !planned.provider;
    } catch (e) {
      note.textContent = "";
      toast(e.message, true);
    }
  });

  runBtn.addEventListener("click", async () => {
    if (!planned?.provider) return;
    runBtn.disabled = true;
    try {
      const out = await api("/media-modify/run", {
        method: "POST",
        body: { ...body(), confirm: true, estimate: planned.usd },
      });
      note.textContent = out.message || "";
      await showResult(result, saveRow, out.job, kind);
    } catch (e) {
      toast(e.message, true);
    }
    runBtn.disabled = false;
  });

  if (sourceUrl) {
    apiBlobUrl(sourceUrl).then((url) => {
      const el = document.createElement(kind === "video" ? "video" : "img");
      el.src = url;
      if (kind === "video") el.controls = true;
      el.alt = file.name || "Preview";
      preview.appendChild(el);
    }).catch(() => {});
  }
}

async function showResult(result, saveRow, job, kind) {
  result.replaceChildren();
  saveRow.replaceChildren();
  if (!job?.id) return;
  if (job.text) {
    const pre = document.createElement("pre");
    pre.className = "small";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = job.text;
    result.appendChild(pre);
  }
  const previewPath = job.galleryId ? `/images/${encodeURIComponent(job.galleryId)}/file` : "";
  const filePath = `/media-modify/file/${encodeURIComponent(job.id)}`;
  if (previewPath || kind === "video" || (job.mime || "").startsWith("image/") || (job.mime || "").startsWith("video/")) {
    try {
      const url = await apiBlobUrl(previewPath || filePath);
      const el = document.createElement(kind === "video" || String(job.mime || "").startsWith("video/") ? "video" : "img");
      el.src = url;
      if (el.tagName === "VIDEO") el.controls = true;
      el.alt = "Result";
      result.appendChild(el);
    } catch { /* the text above is the result */ }
  }
  const download = document.createElement("button");
  download.type = "button";
  download.className = "btn sm";
  download.textContent = "Download";
  download.addEventListener("click", async () => {
    try { downloadBlob(await apiBlobUrl(filePath), job.name || "result"); }
    catch (e) { toast(e.message, true); }
  });
  const sel = projectSelect();
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn sm";
  save.textContent = "Save to project";
  save.addEventListener("click", async () => {
    try {
      const saved = await api("/media-modify/save", { method: "POST", body: { jobId: job.id, projectId: sel.value } });
      toast(saved.message || "Saved in the project.");
    } catch (e) { toast(e.message, true); }
  });
  saveRow.hidden = false;
  saveRow.append(download, sel, save);
}
