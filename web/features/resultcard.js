// The result card under a finished mission (0.4.21, dogfood fixes): a loud banner when only a placeholder was made,
// "Incomplete" with the reasons and a one-click retry on another AI, the checks and their scores, the file that was
// really saved (path, Open file, phone and desktop preview), and the pictures with an "Add headline" box.
import { cardHtml, previewHtml } from "/result-card.js";
import { headlineDataUrl } from "/overlay.js";
const { api, apiBlobUrl, toast, esc } = window.CC;

const IMG = /\.(png|jpe?g|webp|svg)$/i;

function loadImage(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("The picture could not be opened.")); i.src = src; });
}

async function addHeadline(box, t, file, text, position) {
  const body = { jobId: t.media.jobId, i: file.i, text, position };
  try {
    const r = await api("/dogfood/overlay", { method: "POST", body });
    toast(`Headline added: ${r.name}. It is in MindMedia.`);
    return true;
  } catch (e) {
    if (e.code !== "not_png" && !/not a PNG/i.test(e.message || "")) { toast(e.message, true); return false; }
  }
  // a JPEG or WebP picture: draw it here, then the server keeps the PNG
  try {
    const src = await apiBlobUrl(`/media/file?id=${encodeURIComponent(t.media.jobId)}&i=${file.i}`);
    const img = await loadImage(src);
    const dataUrl = headlineDataUrl(img, text, { position });
    const r = await api("/dogfood/overlay/save", { method: "POST", body: { dataUrl, name: "headline", text } });
    toast(`Headline added: ${r.name}. It is in MindMedia.`);
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function paintMedia(el, m) {
  for (const t of m.tasks || []) {
    const files = (t.media?.files || []).filter((f) => IMG.test(f.name || ""));
    if (!t.media?.jobId || !files.length) continue;
    for (const f of files) {
      const wrap = document.createElement("div");
      wrap.className = "rc-media";
      wrap.style.cssText = "margin:8px 0;max-width:420px";
      const dry = /-dry-run\./.test(f.name);
      wrap.innerHTML = `<div class="small dim">${esc(t.title)}${dry ? " (placeholder, not a real picture)" : ""}</div><img alt="${esc(t.title)}" style="max-width:100%;border-radius:8px;border:1px solid var(--line, #556)">
        ${dry ? "" : `<div class="row small" style="gap:6px;margin-top:6px;flex-wrap:wrap"><input type="text" data-hl placeholder="Headline to put on the picture" style="flex:1;min-width:160px" maxlength="120"><select data-pos aria-label="Where the headline goes"><option value="bottom">Bottom</option><option value="center">Middle</option><option value="top">Top</option></select><button type="button" class="btn sm" data-add>Add headline</button></div>`}`;
      el.appendChild(wrap);
      apiBlobUrl(`/media/file?id=${encodeURIComponent(t.media.jobId)}&i=${f.i}`).then((u) => { wrap.querySelector("img").src = u; }).catch(() => { wrap.querySelector("img")?.remove(); });
      const input = wrap.querySelector("[data-hl]");
      if (input && t.media.overlay?.text && !t.media.overlay.ok) input.value = t.media.overlay.text;
      wrap.querySelector("[data-add]")?.addEventListener("click", async () => {
        const text = input.value.trim();
        if (!text) { toast("Write the headline first.", true); input.focus(); return; }
        await addHeadline(wrap, t, f, text, wrap.querySelector("[data-pos]").value);
      });
    }
  }
}

function render(el, run) {
  const m = run?.mission;
  if (!m || run.kind !== "mission" || !["done", "done-with-errors", "failed"].includes(run.status || m.status)) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="rc">${cardHtml(m, esc)}<div class="rc-media-slot"></div></div>`;
  el.querySelector("[data-rc-retry]")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { await api("/dogfood/retry", { method: "POST", body: { id: m.id } }); toast("Trying again. The AI that failed is left out this time."); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  });
  el.querySelector("[data-rc-open]")?.addEventListener("click", async () => {
    try { await api("/dogfood/file/open", { method: "POST", body: { mission: m.id } }); } catch (e) { toast(e.message, true); }
  });
  const pane = el.querySelector("[data-rc-pane]");
  el.querySelectorAll("[data-rc-preview]").forEach((b) => b.addEventListener("click", async () => {
    try {
      const f = await api(`/dogfood/file?mission=${encodeURIComponent(m.id)}`);
      pane.hidden = false;
      pane.innerHTML = previewHtml({ ...f, ok: f.saved }, b.dataset.rcPreview, esc);
    } catch (e) { toast(e.message, true); }
  }));
  paintMedia(el.querySelector(".rc-media-slot"), m);
}

window.CC.register({ id: "resultcard", deliverable: { order: 5, render } });
