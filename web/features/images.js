// Image generation in chat (Phase 21): the Images tab (form + gallery), an image row under the Command
// orders, "Make an image from this" under the deliverable, and the Replicate / fal keys in Settings.
// The price is always shown first; Generate stays off until the estimate for the current choices is on screen.
import { mountBar } from "../next-actions-ui.js";
const { S, api, apiBlobUrl, toast, esc, money, go } = window.CC;

const OP_LABEL = { generate: "New image", edit: "Edit", variation: "Variation" };
const st = { providers: [], items: [], source: null, prefill: null, est: null };
const urls = new Map(); // "<id>:<i>" -> blob: URL (the files need the session token, so <img src> gets a blob)

async function loadProviders() { try { st.providers = (await api("/images/providers")).items; } catch { st.providers = []; } return st.providers; }
async function loadGallery() { try { st.items = (await api("/images")).items; } catch { st.items = []; } return st.items; }
async function blob(id, i = 0) {
  const k = `${id}:${i}`;
  if (!urls.has(k)) urls.set(k, await apiBlobUrl(`/images/${id}/file?i=${i}`));
  return urls.get(k);
}
function fillThumbs(root) {
  root.querySelectorAll("img[data-img]").forEach((img) => { const [id, i] = img.dataset.img.split(":"); blob(id, Number(i)).then((u) => { img.src = u; }).catch(() => { img.alt = "missing"; }); });
}
const ready = (p) => p.ready != null ? p.ready : p.keyed;
const provOptions = (op, sel) => st.providers.filter((p) => p.ops.includes(op)).map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}${ready(p) ? (p.keyed ? "" : " (MCP)") : " (no key)"}${p.capped ? " (at cap)" : ""}</option>`).join("");
const modelOptions = (pid, op) => { const p = st.providers.find((x) => x.id === pid); return (p?.models || []).filter((m) => op === "generate" || !p.editModel || m.edit).map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join(""); };

// ---------- the form ----------
function formHtml(pre = {}) {
  const op = pre.op || "generate";
  const first = st.providers.find((p) => p.ops.includes(op) && ready(p)) || st.providers.find((p) => p.ops.includes(op));
  return `<div class="panel" id="im-form"><h3>Make an image <span class="right">your own keys · price first · nothing spends until you click Generate</span></h3>
    <div class="row"><div class="seg" id="im-op">${Object.keys(OP_LABEL).map((k) => `<button data-op="${k}" class="${k === op ? "on" : ""}">${OP_LABEL[k]}</button>`).join("")}</div>
      <select id="im-prov" style="width:auto">${provOptions(op, first?.id)}</select><select id="im-model" style="width:auto">${modelOptions(first?.id, op)}</select></div>
    <label class="lbl">What should the image show?</label><textarea id="im-prompt" style="min-height:70px" placeholder="A cosy bakery window at dawn, warm light, film photo">${esc(pre.prompt || "")}</textarea>
    <div class="row" style="margin-top:8px">
      <label class="small">Shape <select id="im-size" style="width:auto"><option value="square">Square</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
      <label class="small">Quality <select id="im-quality" style="width:auto"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></label>
      <label class="small">How many <input type="number" id="im-n" value="1" min="1" max="4" style="width:60px;padding:5px 8px"></label>
      <select id="im-proj" style="width:auto"><option value="">No project</option>${(S.projects || []).map((p) => `<option value="${p.id}" ${p.id === S.project ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="row small" id="im-src-row" style="margin-top:8px;display:none"><span>Source image:</span><span id="im-src" class="dim">none yet: click Edit or Variation on a gallery image, or upload one</span><label class="btn sm">Upload<input type="file" id="im-up" accept="image/png,image/jpeg,image/webp" style="display:none"></label></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="im-est">Estimate</button><span class="small" id="im-est-out"></span><button class="btn sm primary" id="im-go" style="margin-left:auto" disabled>Generate</button></div>
    <div id="im-new" class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px"></div><div id="im-na"></div></div>`;
}

function wireForm(root, after) {
  const $ = (s) => root.querySelector(s);
  let op = $("#im-op button.on")?.dataset.op || "generate";
  const stale = () => {
    st.est = null; $("#im-go").disabled = true; $("#im-go").title = "Press Estimate first";
    $("#im-est-out").textContent = "Press Estimate first. Generate wakes up when the price is on screen.";
    // 0.4.20: the price is worked out for you a moment after you stop changing choices
    clearTimeout(st.autoEst);
    st.autoEst = setTimeout(() => { if (root.isConnected && !st.est) $("#im-est")?.click(); }, 600);
  };
  const showSrc = () => {
    $("#im-src-row").style.display = op === "generate" ? "none" : "";
    $("#im-src").textContent = st.source ? (st.source.imageId ? `gallery image ${st.source.label || st.source.imageId}` : `upload: ${st.source.name}`) : "none yet: click Edit or Variation on a gallery image, or upload one";
  };
  const setOp = (next) => {
    op = next;
    root.querySelectorAll("#im-op button").forEach((b) => b.classList.toggle("on", b.dataset.op === op));
    const cur = $("#im-prov").value;
    $("#im-prov").innerHTML = provOptions(op, cur);
    $("#im-model").innerHTML = modelOptions($("#im-prov").value, op);
    $("#im-prompt").placeholder = op === "variation" ? "Optional: what to change. Empty makes a fresh take on the same image." : op === "edit" ? "What to change, e.g. make the sky stormy" : "A cosy bakery window at dawn, warm light, film photo";
    showSrc(); stale();
  };
  root.querySelector("#im-op").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setOp(b.dataset.op); });
  $("#im-prov").addEventListener("change", () => { $("#im-model").innerHTML = modelOptions($("#im-prov").value, op); stale(); });
  for (const s of ["#im-model", "#im-size", "#im-quality", "#im-n"]) $(s).addEventListener("change", stale);
  $("#im-up").addEventListener("change", (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 3.5e6) return toast("That picture is over 3.5 MB. Make it smaller first.", true);
    const r = new FileReader();
    r.onload = () => { st.source = { dataUrl: r.result, name: f.name }; showSrc(); };
    r.readAsDataURL(f);
  });
  const choice = () => ({ provider: $("#im-prov").value, model: $("#im-model").value || undefined, op, size: $("#im-size").value, quality: $("#im-quality").value, n: Number($("#im-n").value) || 1 });
  $("#im-est").addEventListener("click", async () => {
    try {
      const e = await api("/images/estimate", { method: "POST", body: choice() });
      st.est = e;
      const can = e.ready != null ? e.ready : e.keyed;
      const warn = !can ? `<span class="chip amber">${esc(e.keyMessage)}</span>` : e.capped ? `<span class="chip red">at its spend cap</span>` : e.wouldExceed ? `<span class="chip red">would pass the spend cap ($${e.capLeft} left)</span>` : "";
      $("#im-est-out").innerHTML = `about <b>${money(e.usd, 3)}</b> <span class="dim">${esc(e.note)}</span> ${warn}`;
      $("#im-go").disabled = !(e.ready != null ? e.ready : e.keyed) || e.capped || e.wouldExceed;
      $("#im-go").title = $("#im-go").disabled ? (!can ? (e.keyMessage || "Add a key first") : "Over the spend cap") : "";
    } catch (er) { toast(er.message, true); }
  });
  $("#im-proj")?.addEventListener("change", (e) => { if (S.flags?.projectbar) window.CC.setWorkingProject?.(e.target.value); });
  $("#im-go").addEventListener("click", async () => {
    if (!st.est) return;
    if (op !== "generate" && !st.source) return toast("Pick a source image first: Edit or Variation on a gallery image, or Upload.", true);
    const b = $("#im-go"); b.disabled = true; b.textContent = "Generating...";
    try {
      const src = op === "generate" ? undefined : st.source.imageId ? { imageId: st.source.imageId, index: st.source.index || 0 } : { dataUrl: st.source.dataUrl, name: st.source.name };
      const row = await api("/images", { method: "POST", body: { ...choice(), prompt: $("#im-prompt").value.trim(), source: src, estimate: st.est.usd, projectId: $("#im-proj").value || null, runId: S.live?.id || null } });
      toast(`${row.files.length} image${row.files.length === 1 ? "" : "s"} saved to the gallery`);
      $("#im-new").innerHTML = row.files.map((f) => `<img data-img="${row.id}:${f.i}" alt="" style="width:140px;height:140px;object-fit:cover;border-radius:8px;border:1px solid var(--line)">`).join("");
      fillThumbs($("#im-new"));
      // Next actions (flag): Make 3 variations only sets the count to 3 and waits for the price.
      mountBar($("#im-na"), {
        kind: "image", text: $("#im-prompt").value, ref: row.id, name: `Image: ${$("#im-prompt").value.trim().slice(0, 50)}`,
        onVariations: () => { $("#im-n").value = 3; stale(); toast("Set to 3 images. Press Estimate to see the price."); $("#im-est").focus(); },
      });
      if (window.CC.S?.flags?.finishpath) import("../finishpath-ui.js").then((m) => m.mountPair($("#im-na"), { kind: "image", text: $("#im-prompt").value, name: `Image: ${$("#im-prompt").value.trim().slice(0, 50)}`, onEdit: () => $("#im-prompt").focus() })).catch(() => {});
      after?.(row);
    } catch (er) { toast(er.message, true); }
    finally { b.textContent = "Generate"; b.disabled = false; }
  });
  showSrc();
  return { setOp };
}

// ---------- the gallery ----------
function galleryHtml() {
  if (!st.items.length) return `<div class="dim small">No images yet. In demo mode the demo provider draws free sketches.</div>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${st.items.flatMap((r) => r.files.map((f) => `<div class="small" style="border:1px solid var(--line);border-radius:8px;overflow:hidden">
    <img data-img="${r.id}:${f.i}" alt="${esc(r.params?.prompt || "")}" title="${esc(r.params?.prompt || "")}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block;background:#0003">
    <div style="padding:6px"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.params?.prompt || "")}</div>
    <div class="dim">${esc(OP_LABEL[r.op] || r.op)} · ${esc(r.provider)}${r.cost ? ` · ${money(r.cost / r.files.length, 3)}` : ""}</div>
    <div class="row" style="gap:4px;margin-top:4px"><button class="btn sm" data-act="edit" data-id="${r.id}" data-i="${f.i}" ${r.demo ? "disabled title=\"demo sketches cannot be sources\"" : ""}>Edit</button><button class="btn sm" data-act="variation" data-id="${r.id}" data-i="${f.i}" ${r.demo ? "disabled" : ""}>Variation</button><button class="btn sm" data-act="save" data-id="${r.id}" data-i="${f.i}" data-name="${esc(f.name)}">Save</button><button class="btn sm" data-act="del" data-id="${r.id}" title="Delete this batch">Delete</button><button class="btn sm" data-act="personas" data-id="${r.id}" title="See how real people would react to this design idea">Test with personas</button></div></div></div>`)).join("")}</div>`;
}

async function renderTab(view) {
  await Promise.all([loadProviders(), loadGallery()]);
  // CC._imagePrefill: "Make an image: ..." from the chat box suggestions (0.4.17). Price still shows first.
  const pre = st.prefill || window.CC._imagePrefill || {}; st.prefill = null; window.CC._imagePrefill = null;
  view.innerHTML = `${formHtml(pre)}<div class="panel" style="margin-top:12px"><h3>Gallery <span class="right">${st.items.length ? `${st.items.length} batch${st.items.length === 1 ? "" : "es"}` : "No images yet"} · also listed on the Media tab</span></h3><div id="im-gal">${galleryHtml()}</div></div>`;
  const form = wireForm(view, () => renderGallery(view));
  if (pre.op) form.setOp(pre.op);
  wireGallery(view, form);
}
async function renderGallery(view) {
  await loadGallery();
  const g = view.querySelector("#im-gal"); if (!g) return;
  g.innerHTML = galleryHtml(); fillThumbs(g);
}
function wireGallery(view, form) {
  fillThumbs(view);
  view.querySelector("#im-gal").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const { act, id } = b.dataset, i = Number(b.dataset.i) || 0;
    if (act === "edit" || act === "variation") { st.source = { imageId: id, index: i, label: `${id}${i ? ` #${i + 1}` : ""}` }; form.setOp(act); view.querySelector("#im-form").scrollIntoView({ behavior: "smooth" }); return; }
    if (act === "personas") {
      const r = st.items.find((x) => x.id === id);
      const box = view.querySelector("#im-prompt");
      return window.CC.testWithPersonas?.({ text: `An image made from this description:\n${r?.params?.prompt || ""}`, kind: "design", onUse: (text) => { if (box) { box.value = text.replace(/^An image made from this description:\s*/i, ""); box.scrollIntoView({ behavior: "smooth" }); } } });
    }
    if (act === "save") { try { const u = await blob(id, i); const a = document.createElement("a"); a.href = u; a.download = b.dataset.name; document.body.appendChild(a); a.click(); a.remove(); } catch (er) { toast(er.message, true); } return; }
    if (act === "del") { if (!confirm("Delete this batch of images and its files?")) return; try { await api(`/images/${id}`, { method: "DELETE" }); for (const k of [...urls.keys()]) if (k.startsWith(id + ":")) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); } renderGallery(view); } catch (er) { toast(er.message, true); } }
  });
}

CC.register({
  id: "images",
  tab: { label: "Images", short: "Images", icon: "◧", order: 21, render: (v) => renderTab(v) },
  // in chat: the orders box text becomes the prompt; the price shows before the Generate click
  command: { order: 30, async render(el) {
    await loadProviders();
    const keyedOnes = st.providers.filter((p) => ready(p));
    el.innerHTML = `<div class="row small" style="margin-top:8px;gap:6px"><span class="dim">Image from these orders:</span><select id="imc-prov" style="width:auto">${provOptions("generate", keyedOnes[0]?.id)}</select><button class="btn sm" id="imc-est">Price</button><span id="imc-out"></span><button class="btn sm primary" id="imc-go" disabled>Generate</button></div><div id="imc-new" class="row" style="gap:6px;flex-wrap:wrap"></div>`;
    let est = null;
    const prompt = () => (document.getElementById("orders")?.value || "").trim();
    el.querySelector("#imc-prov").addEventListener("change", () => { est = null; el.querySelector("#imc-go").disabled = true; el.querySelector("#imc-out").textContent = ""; });
    el.querySelector("#imc-est").addEventListener("click", async () => {
      if (!prompt()) return toast("Type the orders first", true);
      try { est = await api("/images/estimate", { method: "POST", body: { provider: el.querySelector("#imc-prov").value } }); const can = est.ready != null ? est.ready : est.keyed; el.querySelector("#imc-out").innerHTML = can ? (est.capped || est.wouldExceed ? `<span class="chip red">spend cap</span>` : `about <b>${money(est.usd, 3)}</b>`) : `<span class="chip amber">${esc(est.keyMessage)}</span>`; el.querySelector("#imc-go").disabled = !can || est.capped || est.wouldExceed; }
      catch (e) { toast(e.message, true); }
    });
    el.querySelector("#imc-go").addEventListener("click", async () => {
      if (!est || !prompt()) return;
      const b = el.querySelector("#imc-go"); b.disabled = true; b.textContent = "Generating...";
      try {
        const row = await api("/images", { method: "POST", body: { provider: est.provider, model: est.model, prompt: prompt(), estimate: est.usd, projectId: S.project || null, runId: S.live?.id || null } });
        const box = el.querySelector("#imc-new");
        box.innerHTML = row.files.map((f) => `<img data-img="${row.id}:${f.i}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--line);margin-top:6px">`).join("") + `<a href="#" class="small" id="imc-open" style="align-self:end">open the gallery</a>`;
        fillThumbs(box);
        box.querySelector("#imc-open").addEventListener("click", (e) => { e.preventDefault(); go("images"); });
      } catch (e) { toast(e.message, true); }
      finally { b.textContent = "Generate"; b.disabled = false; }
    });
  } },
  deliverable: { order: 16, render(el, run) {
    if (!run?.id) { el.innerHTML = ""; return; }
    const text = (run.deliverable || "").replace(/[#*>`|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
    el.innerHTML = `<div class="row small" style="margin-top:8px"><button class="btn sm" id="im-from">Make an image from this</button><span class="dim">opens Images with the prompt filled in; the price shows first</span></div>`;
    el.querySelector("#im-from").addEventListener("click", () => { st.prefill = { op: "generate", prompt: text }; go("images"); });
  } },
  settings: { order: 41, render: (el) => renderSettings(el) },
});

async function renderSettings(el) {
    await loadProviders();
    const row = (pid, label, hint) => { const p = st.providers.find((x) => x.id === pid); return `<div class="row" style="margin-top:6px"><span style="width:150px">${esc(label)}</span><input type="password" data-ik="${pid}" placeholder="${p?.keyed ? "key saved" : esc(hint)}" style="flex:1"><button class="btn sm" data-isave="${pid}">Save</button><span class="chip ${p?.keyed ? "green" : ""}">${p?.keyed ? "keyed" : "no key"}</span></div>`; };
    el.innerHTML = `<div class="panel"><h3>Image generation <span class="right">OpenAI, Gemini, xAI, Replicate, fal</span></h3>
      <div class="dim small">OpenAI GPT-Image, Google Gemini and xAI use the keys in AI keys above. Flux runs through Replicate or fal with the keys below (the fal key is shared with the Media tab). Keys are sealed in the vault. Every image is a ledger line and counts toward that provider's spend cap.</div>
      ${row("replicate", "Replicate (Flux)", "r8_...")}${row("fal", "fal.ai (Flux)", "key id:secret")}</div>`;
    el.querySelectorAll("[data-isave]").forEach((b) => b.addEventListener("click", async () => {
      const pid = b.dataset.isave, key = el.querySelector(`[data-ik="${pid}"]`).value.trim();
      if (!key) return toast("Paste the key first", true);
      try { await api("/keys", { method: "POST", body: { provider: pid, key } }); toast("Key saved"); renderSettings(el); } catch (e) { toast(e.message, true); }
    }));
}
