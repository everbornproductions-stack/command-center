// Photo editor panel on the Images tab (flag_photoeditor, 0.4.19). Sliders change a copy of the pixels in
// the browser. The original photo is never rewritten. Save version stores the slider settings and an edited
// copy as a new picture in the project. Nothing here calls an AI or spends money.
import { SLIDERS, PRESETS, blankRecipe, normalizeRecipe, isBlank, applyRecipe } from "/photo-adjust.js";
const CC = window.CC;

const STYLE = `
.pe-card{margin-bottom:12px;overflow-wrap:anywhere;word-break:break-word}
.pe-main{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}
.pe-view{flex:1 1 320px;min-width:0}
.pe-view canvas{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line);display:block;background:#0003}
.pe-side{flex:1 1 260px;min-width:0}
.pe-sl{margin:6px 0}
.pe-sl label{display:flex;justify-content:space-between;gap:8px}
.pe-sl label span{min-width:0;overflow-wrap:anywhere}
.pe-sl input[type=range]{width:100%}
.pe-sl .small{overflow-wrap:anywhere}
.pe-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.pe-row input[type=text]{flex:1 1 140px;min-width:0}
.pe-ver{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-top:1px solid var(--line);padding:6px 0}
.pe-ver span{flex:1 1 120px;min-width:0;overflow-wrap:anywhere}
.pe-pr{border-top:1px solid var(--line);padding:6px 0}
.pe-pr div{overflow-wrap:anywhere}
`;
function ensureStyle() {
  if (document.getElementById("pe-style")) return;
  const s = document.createElement("style");
  s.id = "pe-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const PREVIEW_MAX = 900;
const RENDER_MAX = 3000;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That picture could not be opened."));
    img.src = url;
  });
}
function draw(img, max) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, ctx };
}

export async function openPhotoEditor({ host, imageId, index = 0, url, projectId = null }) {
  if (!host || !CC.S?.flags?.photoeditor) return;
  ensureStyle();
  const { api, esc, toast } = CC;
  let cfg = { sliders: SLIDERS, presets: PRESETS, prompts: [] };
  try { cfg = await api("/photoeditor/config"); } catch (e) { toast(e.message, true); return; }
  const expert = CC.S.uiMode === "expert";
  let recipe = blankRecipe();
  let mode = "after";
  host.innerHTML = `<div class="panel pe-card" id="pe-panel"><h3>Photo editor <span class="right">your original is never changed</span></h3>
    <div class="pe-main"><div class="pe-view"><div class="pe-row"><div class="seg" id="pe-seg"><button data-m="before">Before</button><button data-m="after" class="on">After</button></div><span class="dim small" id="pe-note">Loading the photo...</span></div><canvas id="pe-cv" width="10" height="10" aria-label="Photo preview"></canvas></div>
      <div class="pe-side"><div class="pe-row"><label class="small">Mood <select id="pe-preset" style="width:auto"><option value="">Pick a mood</option>${(cfg.presets || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label><button class="btn sm" id="pe-reset">Reset</button></div>
        <div id="pe-sliders">${(cfg.sliders || []).map((s) => `<div class="pe-sl"><label for="pe-s-${s.id}"><span>${esc(expert ? s.expert : s.plain)}</span><b id="pe-v-${s.id}">0</b></label><input type="range" id="pe-s-${s.id}" data-id="${s.id}" min="${s.min}" max="${s.max}" step="1" value="0"><div class="dim small">${esc(s.hint)}</div></div>`).join("")}</div>
        <div class="pe-row"><input type="text" id="pe-name" maxlength="80" placeholder="Name this version (optional)"><button class="btn sm primary" id="pe-save" disabled>Save version</button></div></div></div>
    <h4 style="margin:12px 0 4px">Versions</h4><div id="pe-vers" class="small dim">None yet.</div>
    <details style="margin-top:10px"><summary>Real photo prompts that keep your original</summary><div class="dim small" style="margin:6px 0">These ask an AI to change only light and color. Pick one, then use Edit on a gallery photo. The price shows first.</div><div id="pe-prompts">${(cfg.prompts || []).map((p) => `<div class="pe-pr"><b>${esc(p.title)}</b><div class="small dim">${esc(p.prompt)}</div><div class="pe-row"><button class="btn sm" data-use="${esc(p.id)}">Use this prompt</button></div></div>`).join("")}</div></details>
    <div class="pe-row"><button class="btn sm" id="pe-close">Close editor</button></div></div>`;
  const $ = (s) => host.querySelector(s);
  const cv = $("#pe-cv");
  let origImg, base, baseData;
  try {
    origImg = await loadImage(url);
    const d = draw(origImg, PREVIEW_MAX);
    base = d.canvas;
    baseData = d.ctx.getImageData(0, 0, base.width, base.height);
    cv.width = base.width; cv.height = base.height;
    $("#pe-note").textContent = `${origImg.naturalWidth} by ${origImg.naturalHeight}`;
  } catch (e) { $("#pe-note").textContent = ""; toast(e.message, true); return; }
  const cctx = cv.getContext("2d");
  let frame = 0;
  const paint = () => {
    frame = 0;
    if (mode === "before" || isBlank(recipe)) { cctx.putImageData(baseData, 0, 0); }
    else {
      const out = applyRecipe(baseData.data, base.width, base.height, recipe);
      cctx.putImageData(new ImageData(out, base.width, base.height), 0, 0);
    }
    $("#pe-save").disabled = isBlank(recipe);
  };
  const later = () => { if (!frame) frame = requestAnimationFrame(paint); };
  const setRecipe = (r) => {
    recipe = normalizeRecipe(r);
    for (const s of cfg.sliders) { $("#pe-s-" + s.id).value = recipe[s.id]; $("#pe-v-" + s.id).textContent = recipe[s.id]; }
    later();
  };
  paint();
  $("#pe-sliders").addEventListener("input", (e) => {
    const id = e.target?.dataset?.id; if (!id) return;
    recipe[id] = Number(e.target.value) || 0; $("#pe-v-" + id).textContent = recipe[id];
    $("#pe-preset").value = ""; later();
  });
  $("#pe-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-m]"); if (!b) return;
    mode = b.dataset.m;
    host.querySelectorAll("#pe-seg button").forEach((x) => x.classList.toggle("on", x === b));
    later();
  });
  $("#pe-preset").addEventListener("change", (e) => { const p = (cfg.presets || []).find((x) => x.id === e.target.value); if (p) setRecipe({ ...blankRecipe(), ...p.values }); });
  $("#pe-reset").addEventListener("click", () => { $("#pe-preset").value = ""; setRecipe(blankRecipe()); });
  $("#pe-close").addEventListener("click", () => { host.innerHTML = ""; });
  host.querySelectorAll("[data-use]").forEach((b) => b.addEventListener("click", () => {
    const p = (cfg.prompts || []).find((x) => x.id === b.dataset.use);
    const box = document.getElementById("im-prompt");
    if (p && box) { box.value = p.prompt; box.scrollIntoView({ behavior: "smooth" }); toast("Prompt added to the Images form. Pick Edit on a photo to use it."); }
  }));

  const versions = async () => {
    let items = [];
    try { items = (await api(`/photoeditor/versions?imageId=${encodeURIComponent(imageId)}`)).items || []; } catch {}
    const box = $("#pe-vers"); if (!box) return;
    box.className = items.length ? "small" : "small dim";
    box.innerHTML = items.length ? items.map((v) => `<div class="pe-ver"><span>${esc(v.name)}</span><button class="btn sm" data-open="${esc(v.id)}">Open</button><button class="btn sm" data-del="${esc(v.id)}">Delete</button></div>`).join("") : "None yet.";
    box.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => { const v = items.find((x) => x.id === b.dataset.open); if (v) { $("#pe-preset").value = ""; setRecipe(v.recipe); $("#pe-name").value = v.name; } }));
    box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!(await window.CC.confirm("Delete this version and its edited copy? Your original photo stays.", { danger: true, ok: "Delete" }))) return;
      try { await api(`/photoeditor/versions/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); toast("Version deleted. The original is untouched."); await versions(); CC.refreshImages?.(); } catch (er) { toast(er.message, true); }
    }));
  };
  await versions();

  $("#pe-save").addEventListener("click", async () => {
    if (isBlank(recipe)) return toast("Move a slider first.", true);
    const b = $("#pe-save"); b.disabled = true; b.textContent = "Saving...";
    try {
      const d = draw(origImg, RENDER_MAX);
      const full = d.ctx.getImageData(0, 0, d.canvas.width, d.canvas.height);
      const out = applyRecipe(full.data, d.canvas.width, d.canvas.height, recipe);
      d.ctx.putImageData(new ImageData(out, d.canvas.width, d.canvas.height), 0, 0);
      const dataUrl = d.canvas.toDataURL("image/jpeg", 0.92);
      await api("/photoeditor/versions", { method: "POST", body: { imageId, index, name: $("#pe-name").value.trim(), recipe, dataUrl, projectId } });
      toast("Version saved in the project. Your original is untouched.");
      $("#pe-name").value = "";
      await versions();
      CC.refreshImages?.();
    } catch (er) { toast(er.message, true); }
    finally { b.textContent = "Save version"; b.disabled = isBlank(recipe); }
  });
  host.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

CC.openPhotoEditor = openPhotoEditor;
CC.register?.({ id: "photo-editor" });
