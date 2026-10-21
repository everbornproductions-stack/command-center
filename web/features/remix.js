// Remix any app. The note stays on screen. Nothing runs until Rebuild from scratch.
const { api, toast, esc } = window.CC;

const SCRATCH_NOTE = "Remix rebuilds from scratch. It does not copy the app or game you show. It does not decompile, extract, or reuse that app's code, assets, names, or brand.";

let info = null;
let preview = null;
let previewKey = "";
let picksTouched = false;

function fieldValue(root, id) {
  return root.querySelector(id)?.value?.trim() || "";
}
function payload(root) {
  const packs = [...root.querySelectorAll("input[name='remix-pack']:checked")].map((el) => el.value);
  return {
    source: root.querySelector("input[name='remix-source']:checked")?.value || "screenshots",
    url: fieldValue(root, "#remix-url"),
    looks: fieldValue(root, "#remix-looks"),
    plays: fieldValue(root, "#remix-plays"),
    works: fieldValue(root, "#remix-works"),
    appType: fieldValue(root, "#remix-type") || "game",
    originalName: fieldValue(root, "#remix-original"),
    originalCharacters: fieldValue(root, "#remix-original-characters"),
    originalLook: fieldValue(root, "#remix-original-look"),
    own: {
      name: fieldValue(root, "#remix-name"),
      characters: fieldValue(root, "#remix-characters"),
      look: fieldValue(root, "#remix-own-look"),
      ideas: fieldValue(root, "#remix-ideas"),
      art: fieldValue(root, "#remix-art"),
    },
    engineId: fieldValue(root, "#remix-engine"),
    packIds: packs,
    modId: fieldValue(root, "#remix-mod"),
    pulls: [],
  };
}
function formKey(body) {
  return JSON.stringify(body);
}
function defaultsFor(type) {
  const catalog = info?.catalog || [];
  const engines = catalog.filter((c) => c.kind === "engine" || c.kind === "template");
  const learned = (info?.library || []).find((row) => row.appType === type && row.engineId);
  const engine = engines.find((c) => c.id === learned?.engineId) || engines.find((c) => (c.defaultFor || []).includes(type)) || engines[0];
  const packs = catalog.filter((c) => c.kind === "art" && (c.defaultFor || []).includes(type)).map((c) => c.id);
  return { engineId: engine?.id || "", packs };
}

function shell(gate) {
  const sources = info?.sources || [
    { id: "url", label: "A web address", detail: "You describe the page. Remix does not open the address." },
    { id: "screenshots", label: "Screenshots", detail: "You describe what is visible. Remix does not take assets out of the pictures." },
    { id: "recording", label: "A short screen recording", detail: "You describe what you saw. Remix does not pull frames or files out of the recording." },
    { id: "desktop", label: "An app on this computer", detail: "Observed only through what is visible on screen. Remix does not open the app's files." },
  ];
  const catalog = info?.catalog || [];
  const engines = catalog.filter((c) => c.kind === "engine" || c.kind === "template");
  const extra = catalog.filter((c) => c.kind === "art");
  const mods = info?.mods || [];
  const gateLine = gate?.message || "Checking your plan.";
  const picked = defaultsFor("game");
  return `<div id="remix-root">
    <div class="panel" style="margin-bottom:12px">
      <h3 style="margin-top:0">Remix</h3>
      <p class="small" id="remix-note" style="margin:0 0 8px">${esc(SCRATCH_NOTE)}</p>
      <p class="dim small" style="margin:0">${esc(gateLine)} Free tools are named from a catalog on this computer. Nothing is downloaded.</p>
    </div>
    <div class="grid" style="grid-template-columns: minmax(0,1fr) minmax(280px,380px); gap:12px">
      <form id="remix-form" class="panel">
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="lbl">What are you showing?</legend>
          ${sources.map((s, i) => `<label class="small" style="display:block;margin:4px 0"><input type="radio" name="remix-source" value="${esc(s.id)}" ${i === 1 ? "checked" : ""}> ${esc(s.label)}</label><div class="dim small" style="margin:0 0 6px 22px">${esc(s.detail)}</div>`).join("")}
        </fieldset>
        <label class="lbl" for="remix-url">Web address, if you have one</label>
        <input id="remix-url" type="url" autocomplete="off" placeholder="Kept on this screen only. It is not opened." style="width:100%">
        <label class="lbl" for="remix-looks">How it looks</label>
        <textarea id="remix-looks" style="min-height:64px;width:100%" placeholder="Colors, layout, and what is on the screen"></textarea>
        <label class="lbl" for="remix-plays">How it plays</label>
        <textarea id="remix-plays" style="min-height:64px;width:100%" placeholder="What a person does, and what happens next"></textarea>
        <label class="lbl" for="remix-works">How it works</label>
        <textarea id="remix-works" style="min-height:64px;width:100%" placeholder="Rules you could see. No code from the app."></textarea>
        <label class="lbl" for="remix-type">Kind</label>
        <select id="remix-type" style="width:100%">${["game", "app", "tool"].map((k) => `<option value="${k}">${k}</option>`).join("")}</select>
        <label class="lbl" for="remix-name">Your name for it</label>
        <input id="remix-name" type="text" maxlength="80" autocomplete="off" style="width:100%" placeholder="Your title, not theirs">
        <label class="lbl" for="remix-characters">Your characters</label>
        <input id="remix-characters" type="text" maxlength="500" autocomplete="off" style="width:100%" placeholder="Your characters">
        <label class="lbl" for="remix-own-look">Your look</label>
        <input id="remix-own-look" type="text" maxlength="500" autocomplete="off" style="width:100%" placeholder="Your colors and shapes">
        <label class="lbl" for="remix-ideas">Your ideas</label>
        <textarea id="remix-ideas" style="min-height:64px;width:100%" placeholder="What you want that is yours"></textarea>
        <label class="lbl" for="remix-art">Your art</label>
        <input id="remix-art" type="text" maxlength="500" autocomplete="off" style="width:100%" placeholder="Sketches or files you made. They are not taken from the other app.">
        <label class="lbl" for="remix-engine">Engine or template</label>
        <select id="remix-engine" style="width:100%">${engines.map((c) => `<option value="${esc(c.id)}" ${c.id === picked.engineId ? "selected" : ""}>${esc(c.name)} (${esc(c.license)})</option>`).join("")}<option value="none">No outside engine</option></select>
        <div class="lbl">Free art and templates</div>
        ${extra.map((c) => `<label class="small" style="display:block;margin:4px 0"><input type="checkbox" name="remix-pack" value="${esc(c.id)}" ${picked.packs.includes(c.id) ? "checked" : ""}> ${esc(c.name)} (${esc(c.license)})</label>`).join("") || `<div class="dim small">No art packs in the catalog.</div>`}
        <label class="lbl" for="remix-mod">Official mod tool</label>
        <select id="remix-mod" style="width:100%"><option value="">No mod. Build a new project.</option>${mods.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}: ${esc(m.tool)}</option>`).join("")}</select>
        <p class="dim small" id="remix-mod-note" style="margin:6px 0 0"></p>
        <details style="margin-top:10px">
          <summary class="small">Closeness check (optional)</summary>
          <label class="lbl" for="remix-original">Name of what you showed</label>
          <input id="remix-original" type="text" maxlength="80" autocomplete="off" style="width:100%" placeholder="Used only to warn you. It is not saved.">
          <label class="lbl" for="remix-original-characters">Their characters</label>
          <input id="remix-original-characters" type="text" maxlength="300" autocomplete="off" style="width:100%">
          <label class="lbl" for="remix-original-look">Their look and layout</label>
          <input id="remix-original-look" type="text" maxlength="500" autocomplete="off" style="width:100%">
        </details>
        <div class="row" style="margin-top:12px">
          <button type="button" class="btn sm" id="remix-preview-btn">Preview who receives this</button>
          <button type="button" class="btn sm primary" id="remix-run-btn" disabled>Rebuild from scratch</button>
        </div>
        <label class="small" id="remix-ack-row" hidden style="margin-top:8px"><input type="checkbox" id="remix-ack"> I have read the warning. This still rebuilds from scratch.</label>
      </form>
      <div>
        <div class="panel" id="remix-preview" aria-live="polite"><h3 style="margin-top:0">Preview</h3><p class="dim small">Nothing is sent until you click Rebuild from scratch.</p></div>
        <div class="panel" id="remix-past" style="margin-top:12px"><h3 style="margin-top:0">What worked before</h3><div class="dim small">Ratings stay on this computer and teach the next remix.</div></div>
      </div>
    </div>
  </div>`;
}

function previewHtml(data) {
  const who = data.recipients || { ais: [], services: [], withheld: [] };
  const ais = who.ais.length
    ? who.ais.map((a) => `<li><b>${esc(a.providerName)}</b> ${esc(a.name)}: ${esc(a.receives)}</li>`).join("")
    : `<li>No AI is connected. Nothing will be sent. The project and the CREDITS file can still be saved here.</li>`;
  const services = (who.services || []).map((s) => `<li><b>${esc(s.name)}</b>: ${esc(s.receives)}</li>`).join("");
  const held = (who.withheld || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const used = (data.pieces || []).map((p) => `<li>${esc(p.name)} (${esc(p.spdx)})${p.creditRequired ? `: ${esc(p.credit)}` : ""}</li>`).join("") || "<li>No outside piece passed the license check.</li>";
  const dropped = (data.rejected || []).map((p) => `<li>${esc(p.name)}: ${esc(p.reason)}</li>`).join("");
  const warnings = (data.closeness?.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("");
  const desc = data.description || {};
  return `<h3 style="margin-top:0">Preview</h3>
    <p class="small">${esc(data.scratchNote || SCRATCH_NOTE)}</p>
    <p class="small">${esc(data.gate?.message || "")}</p>
    <div class="lbl">How it looks, plays, and works</div>
    <p class="small">Looks: ${esc(desc.looks || "")}</p>
    <p class="small">Plays: ${esc(desc.plays || "")}</p>
    <p class="small">Works: ${esc(desc.works || "")}</p>
    <div class="lbl">AIs that will receive your words</div><ul class="small">${ais}</ul>
    <div class="lbl">Services</div><ul class="small">${services}</ul>
    <div class="lbl">Not sent</div><ul class="small">${held}</ul>
    <div class="lbl">License check</div><ul class="small">${used}</ul>
    ${dropped ? `<div class="lbl">Not used</div><ul class="small">${dropped}</ul>` : ""}
    ${warnings ? `<div class="lbl">Too close</div><ul class="small">${warnings}</ul>` : ""}
    <details><summary class="small">CREDITS</summary><pre class="small" style="white-space:pre-wrap">${esc(data.creditsText || "")}</pre></details>
    <details><summary class="small">Words the AIs will receive</summary><pre class="small" style="white-space:pre-wrap">${esc(data.goal || "")}</pre></details>`;
}

function pastHtml() {
  const runs = info?.runs || [];
  const lib = info?.library || [];
  const hints = lib.filter((row) => row.engineId || row.samples).map((row) => `<div class="small">${esc(row.appType)}: ${row.samples || 0} saved${row.engineId ? `, starts from ${esc(row.engineId)}` : ""}</div>`).join("");
  const rows = runs.slice(0, 8).map((r) => `<div class="row small" style="gap:6px;margin-top:6px"><span>${esc(r.appType)}, ${esc(r.engineId || "no engine")}, ${esc(r.rating || "not rated")}</span>
    <button type="button" class="btn sm" data-rate="${esc(r.id)}" data-up="1">Worked</button>
    <button type="button" class="btn sm" data-rate="${esc(r.id)}" data-up="0">Needs work</button></div>`).join("");
  return `<h3 style="margin-top:0">What worked before</h3>${hints || `<div class="dim small">Ratings stay on this computer and teach the next remix.</div>`}${rows}`;
}

function paintPreview(root, data) {
  const box = root.querySelector("#remix-preview");
  if (!box) return;
  box.innerHTML = previewHtml(data);
  const ack = root.querySelector("#remix-ack-row");
  if (ack) {
    const show = !!data?.closeness?.close;
    ack.hidden = !show;
    ack.style.display = show ? "block" : "none";
  }
  const run = root.querySelector("#remix-run-btn");
  const fresh = previewKey && previewKey === formKey(payload(root));
  const needsAck = !!data?.closeness?.close && !root.querySelector("#remix-ack")?.checked;
  if (run) run.disabled = !fresh || !data?.gate?.ok || needsAck;
}

async function loadRate(root, id, up) {
  try {
    await api("/remix/rate", { method: "POST", body: { id, up, fix: !up } });
    info = await api("/remix");
    const past = root.querySelector("#remix-past");
    if (past) past.innerHTML = pastHtml();
    wirePast(root);
    toast(up ? "Saved. The next remix can start from this." : "Saved. The next remix will try a different fit.");
  } catch (e) { toast(e.message, true); }
}
function wirePast(root) {
  root.querySelectorAll("[data-rate]").forEach((btn) => btn.addEventListener("click", () => loadRate(root, btn.dataset.rate, btn.dataset.up === "1")));
}
function markStale(root) {
  previewKey = "";
  const run = root.querySelector("#remix-run-btn");
  if (run) run.disabled = true;
}
function applyTypeDefaults(root) {
  if (picksTouched) return;
  const picked = defaultsFor(fieldValue(root, "#remix-type") || "game");
  const engine = root.querySelector("#remix-engine");
  if (engine && picked.engineId) engine.value = picked.engineId;
  root.querySelectorAll("input[name='remix-pack']").forEach((el) => { el.checked = picked.packs.includes(el.value); });
}

async function render(view) {
  view.innerHTML = `<div id="remix-root"><div class="panel"><p class="small" id="remix-note">${esc(SCRATCH_NOTE)}</p><p class="dim small">Loading Remix.</p></div></div>`;
  try { info = await api("/remix"); } catch (e) { toast(e.message, true); info = null; }
  picksTouched = false;
  preview = null;
  previewKey = "";
  view.innerHTML = shell(info?.gate);
  const root = view.querySelector("#remix-root");
  const past = root.querySelector("#remix-past");
  if (past) past.innerHTML = pastHtml();
  wirePast(root);
  const form = root.querySelector("#remix-form");
  form.addEventListener("input", (e) => {
    if (e.target?.id === "remix-ack") {
      if (preview) paintPreview(root, preview);
      return;
    }
    if (e.target?.name === "remix-pack" || e.target?.id === "remix-engine") picksTouched = true;
    markStale(root);
  });
  form.addEventListener("change", (e) => {
    if (e.target?.id === "remix-ack") return;
    if (e.target?.id === "remix-type") applyTypeDefaults(root);
    const mod = info?.mods?.find((m) => m.id === fieldValue(root, "#remix-mod"));
    const note = root.querySelector("#remix-mod-note");
    if (note) note.textContent = mod?.note || "";
    markStale(root);
  });
  root.querySelector("#remix-preview-btn").addEventListener("click", async () => {
    const body = payload(root);
    try {
      preview = await api("/remix/preview", { method: "POST", body });
      previewKey = formKey(body);
      paintPreview(root, preview);
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#remix-run-btn").addEventListener("click", async () => {
    const body = payload(root);
    if (formKey(body) !== previewKey) return toast("Preview this again before you rebuild.", true);
    try {
      const out = await api("/remix/run", { method: "POST", body: { ...body, confirm: true, acknowledgeClose: !!root.querySelector("#remix-ack")?.checked } });
      toast(out.ai?.started ? "Rebuild started from scratch." : "Project saved from scratch. Nothing was sent.");
      const box = root.querySelector("#remix-preview");
      if (box) box.insertAdjacentHTML("afterbegin", `<p class="small"><b>${esc(out.projectName || "Project")}</b> is saved. ${esc(out.ai?.reason || "")}</p>`);
      info = await api("/remix");
      const gate = root.querySelector("#remix-note")?.parentElement?.querySelector(".dim");
      if (gate && info?.gate?.message) gate.textContent = `${info.gate.message} Free tools are named from a catalog on this computer. Nothing is downloaded.`;
      const pastBox = root.querySelector("#remix-past");
      if (pastBox) pastBox.innerHTML = pastHtml();
      wirePast(root);
      markStale(root);
    } catch (e) { toast(e.message, true); }
  });
}

CC.register({
  id: "remix",
  tab: { label: "Remix", short: "Remix", icon: "✦", order: 24, render },
});
