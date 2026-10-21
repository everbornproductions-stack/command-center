// Pro prompts: browse by category, fill from the Business Profile, and halt when a fact is missing.
import { marketplacePacks, mountPromptBoard } from "./prompt-board.js";
const { api, toast, esc, go } = window.CC;
const S = () => window.CC.S;

const NOTE = "Pre-built pro prompts, written by our team, so you get expert-level results without being a prompt expert.";
let pack = null;
let removedId = "";
let timer = 0;

function voiceReady() {
  const has = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const feature = (window.CC.features || []).some((f) => f.id === "voice");
  return has && feature;
}

function fieldHtml(field, value) {
  const v = value == null ? "" : String(value);
  const speak = voiceReady() ? `<button type="button" class="btn sm" data-speak="${esc(field.key)}">Speak</button>` : "";
  if (field.kind === "bool" || field.key === "scf") {
    return `<label class="row small" style="gap:8px;margin-top:8px"><input type="checkbox" data-k="${esc(field.key)}" ${v === "true" || v === true ? "checked" : ""}> ${esc(field.label)}</label>`;
  }
  if (field.multiline) return `<label class="small" style="display:block;margin-top:8px">${esc(field.label)}${field.required === false ? "" : " *"} ${speak}<textarea data-k="${esc(field.key)}" rows="3" style="width:100%">${esc(v)}</textarea></label>`;
  return `<label class="small" style="display:block;margin-top:8px">${esc(field.label)}${field.required === false ? "" : " *"} ${speak}<input data-k="${esc(field.key)}" value="${esc(v)}" style="width:100%"></label>`;
}

function readFields(root) {
  const inputs = {};
  root.querySelectorAll("[data-k]").forEach((el) => {
    inputs[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
  });
  return inputs;
}

function bindSpeak(root) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return;
  root.querySelectorAll("[data-speak]").forEach((btn) => btn.addEventListener("click", () => {
    const input = root.querySelector(`[data-k="${btn.dataset.speak}"]`);
    if (!input) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.onresult = (ev) => { input.value = `${input.value ? input.value + " " : ""}${ev.results[0][0].transcript}`; };
    rec.start();
    toast("Listening. Speak, then pause.");
  }));
}

async function mountInterview(el) {
  if (!el) return;
  let profile = {};
  let fields = [];
  let steps = [];
  try {
    const r = await api("/prompts/profile");
    profile = r.profile || {};
    fields = r.fields || [];
    steps = r.interview || [];
  } catch (e) { el.innerHTML = `<div class="dim small">${esc(e.message)}</div>`; return; }
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  el.innerHTML = `<div class="panel"><h3>Business Profile</h3>
    <div class="small dim">A short interview. Later prompts reuse it. You can speak an answer when the mic is available.</div>
    ${steps.map((step) => `<div style="margin-top:12px"><b>${esc(step.title)}</b>${step.voice && !voiceReady() ? `<div class="dim small">Type this one. Speech recognition is not available in this window.</div>` : ""}${step.fields.map((key) => fieldHtml(byKey[key] || { key, label: key }, profile[key])).join("")}</div>`).join("")}
    <div class="row" style="margin-top:12px"><button class="btn sm primary" type="button" id="pp-save-profile">Save profile</button></div>
  </div>`;
  bindSpeak(el);
  el.querySelector("#pp-save-profile").addEventListener("click", async () => {
    try {
      const saved = await api("/prompts/profile", { method: "POST", body: readFields(el) });
      toast(saved.profile?.businessName ? "Profile saved." : "Profile saved. Add the business name when you have it.");
    } catch (e) { toast(e.message, true); }
  });
}
window.CC.mountPromptInterview = mountInterview;

function paintChip() {
  const orders = document.getElementById("orders");
  if (!orders) return;
  let row = document.getElementById("pp-chip");
  if (!row) {
    row = document.createElement("div");
    row.id = "pp-chip";
    orders.insertAdjacentElement("afterend", row);
  }
  if (!pack || !pack.id || removedId === pack.id) { row.innerHTML = ""; return; }
  const applied = !!pack.applied;
  row.innerHTML = `<div class="row small" style="gap:8px;margin-top:6px;flex-wrap:wrap">
    <span class="chip violet">${applied ? "Using" : "Suggested"}: ${esc(pack.name)}</span>
    ${applied ? "" : `<button class="btn sm" type="button" id="pp-use">Use this</button>`}
    <button class="btn sm" type="button" id="pp-chip-x" aria-label="Remove Pro prompt">Remove</button>
    <span class="dim">${pack.halted ? esc(pack.message || "") : "You can remove this before you send."}</span>
  </div>
  ${pack.halted ? `<div id="pp-missing" class="small" style="margin-top:6px">${(pack.questions || []).map((q) => `<div>${esc(q)}</div>`).join("")}<div id="pp-miss-fields"></div><button class="btn sm" type="button" id="pp-fill">Save these facts</button></div>` : ""}`;
  row.querySelector("#pp-use")?.addEventListener("click", () => { pack.applied = true; window.CC.promptPack = packState(); paintChip(); });
  row.querySelector("#pp-chip-x")?.addEventListener("click", async () => {
    removedId = pack.id;
    pack.applied = false;
    window.CC.promptPack = { removed: true };
    try { await api("/prompts/dismiss", { method: "POST", body: { id: removedId } }); } catch { /* still remove the chip */ }
    paintChip();
  });
  if (pack.halted && pack.template) {
    const box = row.querySelector("#pp-miss-fields");
    box.innerHTML = (pack.template.inputs || []).filter((f) => (pack.missing || []).some((m) => m.key === f.key)).map((f) => fieldHtml(f, "")).join("");
    row.querySelector("#pp-fill").addEventListener("click", async () => {
      pack.inputs = { ...(pack.inputs || {}), ...readFields(box) };
      await consider(document.getElementById("orders")?.value || "", true);
    });
  }
}

function packState() {
  if (!pack?.id || removedId === pack.id || !pack.applied) return pack?.removed ? { removed: true } : null;
  return { templateId: pack.id, inputs: pack.inputs || {}, applied: true, removed: false, halted: !!pack.halted, message: pack.message };
}

function publishPack() {
  window.CC.promptPack = pack?.applied ? packState() : null;
  if (window.CC.promptPack) window.CC.promptPack.halted = !!pack?.halted;
  paintChip();
}

async function consider(text, keepApplied) {
  const value = String(text || "").trim();
  if (!value) { pack = null; window.CC.promptPack = null; paintChip(); return; }
  try {
    const r = await api("/prompts/detect", { method: "POST", body: { text: value, llm: true } });
    const match = r.match;
    if (!match?.id || match.id === removedId) { pack = null; window.CC.promptPack = null; paintChip(); return; }
    const list = await api("/prompts");
    const template = (list.templates || []).find((t) => t.id === match.id);
    const prior = pack?.id === match.id ? pack.inputs || {} : {};
    pack = { id: match.id, name: match.name, applied: keepApplied || !!match.autoApply, halted: false, inputs: prior, template };
    try {
      const rendered = await api("/prompts/render", { method: "POST", body: { id: match.id, inputs: prior } });
      pack.inputs = rendered.values || prior;
      pack.halted = false;
    } catch (e) {
      if (e.code !== "prompt_halt") throw e;
      pack.halted = true;
      pack.message = e.message;
      pack.questions = e.questions || [];
      pack.missing = e.missing || [];
    }
    publishPack();
  } catch { /* a failed detect leaves the orders as typed */ }
}

function openCustom(item) {
  const box = document.getElementById("pp-form");
  if (!box || !item) return;
  box.innerHTML = `<div class="panel"><h3>${esc(item.name)}</h3>
    <div class="small dim">Your prompt. Nothing is sent until you put it in the orders box and send it yourself.</div>
    <pre class="small" style="white-space:pre-wrap;margin-top:8px">${esc(item.text || "")}</pre>
    <button class="btn sm primary" type="button" id="pp-custom-orders">Put in orders</button>
  </div>`;
  box.querySelector("#pp-custom-orders").addEventListener("click", () => {
    const text = item.text || item.name;
    const orders = document.getElementById("orders");
    if (orders) orders.value = text;
    window.CC.S.lastOrders = text;
    toast("In the orders box. Nothing is sent.");
    go("command");
  });
}

function openPack(item) {
  const box = document.getElementById("pp-form");
  if (!box || !item) return;
  const expert = window.CC.S?.uiMode === "expert" || window.CC.uiMode?.() === "expert";
  box.innerHTML = `<div class="panel"><h3>${esc(item.name)}</h3>
    <div class="small dim">${esc(item.description || "Marketplace prompt pack")}</div>
    <div class="small dim" style="margin-top:6px">This pack stays in the Marketplace category. Nothing is installed or sent from here.</div>
    ${expert ? `<button class="btn sm" type="button" id="pp-pack-open">Open in Marketplace</button>` : ""}
  </div>`;
  box.querySelector("#pp-pack-open")?.addEventListener("click", () => go("marketplace"));
}

async function renderTab(view) {
  let data = { templates: [], categories: [], note: NOTE, schedules: [], integrations: {}, custom: [] };
  try { data = await api("/prompts"); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const market = await api("/marketplace").catch(() => null);
  const model = {
    templates: data.templates || [],
    custom: data.custom || [],
    marketplace: marketplacePacks(market),
  };
  view.innerHTML = `<div class="grid" style="gap:14px">
    <div class="panel"><h3>Pro prompts</h3><p class="small" style="margin:6px 0 0">${esc(data.note || NOTE)}</p>
      <input id="pp-q" placeholder="Search prompts" style="width:100%;margin-top:10px" aria-label="Search prompts">
      <div id="pp-tools" class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px" hidden></div>
    </div>
    <div id="pp-list"></div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn sm" type="button" id="pp-sched">Add Friday and daily schedules</button>
      <button class="btn sm" type="button" id="pp-team">Create the 3-agent team</button>
      <button class="btn sm" type="button" id="pp-lev">Create the two leverage pipelines</button>
    </div>
    <div id="pp-form"></div>
    <div id="pp-interview"></div>
  </div>`;
  mountPromptBoard(view, model, {
    esc,
    toast,
    onOpen: (id) => openTemplate(data, id),
    onCustom: openCustom,
    onPack: openPack,
    onMove: async (id, shelf) => {
      const saved = await api("/prompts/shelf", { method: "POST", body: { id, shelf } });
      const row = model.custom.find((p) => p.id === id);
      if (row) row.shelf = saved.shelf || shelf;
    },
  });
  view.querySelector("#pp-sched").addEventListener("click", async () => {
    try { const r = await api("/prompts/schedules", { method: "POST", body: {} }); toast(r.note || "Schedules added, paused."); } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#pp-team").addEventListener("click", async () => {
    try { const r = await api("/prompts/team", { method: "POST", body: {} }); toast(`Team ready: ${r.agents.map((a) => a.name).join(", ")}.`); } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#pp-lev").addEventListener("click", async () => {
    try { const r = await api("/prompts/pipelines", { method: "POST", body: { id: "ai-leverage" } }); toast(`Pipelines: ${r.pipelines.map((p) => p.name).join(", ")}.`); } catch (e) { toast(e.message, true); }
  });
  mountInterview(view.querySelector("#pp-interview"));
}

async function openTemplate(data, id) {
  const t = data.templates.find((row) => row.id === id);
  const box = document.getElementById("pp-form");
  if (!t || !box) return;
  let profile = {};
  try { profile = (await api("/prompts/profile")).profile || {}; } catch { /* form still works */ }
  const valueFor = (f) => (f.profile && profile[f.profile]) || "";
  box.innerHTML = `<div class="panel"><h3>${esc(t.name)}</h3><div class="small dim">${esc(t.description)}</div>
    ${t.locked ? `<div class="small">Industry packs are part of Pro ($15.99/month). Add a licence key in Settings. Credit repair does not promise a score change. Outbound text stays a draft.</div>` : ""}
    ${t.inputs.map((f) => fieldHtml(f, valueFor(f))).join("")}
    <div id="pp-halt" class="small" style="margin-top:8px"></div>
    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn sm primary" type="button" id="pp-run">Run</button>
      <button class="btn sm" type="button" id="pp-orders">Put in orders</button>
      ${t.id === "agent-team" ? `<button class="btn sm" type="button" id="pp-make-team">Create the linked agents</button>` : ""}
      ${t.id === "ai-leverage" ? `<button class="btn sm" type="button" id="pp-make-lev">Create the two pipelines</button>` : ""}
      ${t.id === "brain-dump-brief" ? `<button class="btn sm" type="button" id="pp-make-pipe">Convert to a pipeline</button>` : ""}
      ${t.id === "best-worst-clients" ? `<button class="btn sm" type="button" id="pp-flags">Save red flags for Stalled client check</button>` : ""}
      ${t.kling && data.integrations?.kling ? `<button class="btn sm" type="button" id="pp-kling">Open in Media</button>` : ""}
    </div>
    <div class="dim small" style="margin-top:6px">Drafts stay here. Nothing is sent. ${t.kling ? "Media does not generate until you click Generate." : ""}</div>
  </div>`;
  bindSpeak(box);
  const inputs = () => readFields(box);
  const run = async (send) => {
    try {
      await api("/prompts/render", { method: "POST", body: { id: t.id, inputs: inputs(), saveProfile: t.id === "business-profile" || t.id === "master-voice" } });
      pack = { id: t.id, name: t.name, applied: true, halted: false, inputs: inputs(), template: t };
      removedId = "";
      window.CC.promptPack = packState();
      const brief = Object.entries(inputs()).filter(([, v]) => String(v ?? "").trim()).map(([k, v]) => `${k}: ${v}`).join("\n") || t.name;
      window.CC.S.lastOrders = brief;
      const orders = document.getElementById("orders");
      if (orders) orders.value = brief;
      if (send) {
        await api("/chat", { method: "POST", body: { prompt: brief, promptPack: { templateId: t.id, inputs: inputs() } } });
        toast("Running. Watch it in Command.");
        go("command");
      } else { toast("In the orders box. Remove the chip if you do not want this prompt."); go("command"); }
    } catch (e) { box.querySelector("#pp-halt").textContent = [e.message, ...(e.questions || [])].join(" "); }
  };
  box.querySelector("#pp-run").addEventListener("click", () => run(true));
  box.querySelector("#pp-orders").addEventListener("click", () => run(false));
  box.querySelector("#pp-make-team")?.addEventListener("click", async () => { try { await api("/prompts/team", { method: "POST", body: {} }); toast("Three agents and a pipeline are ready."); } catch (e) { toast(e.message, true); } });
  box.querySelector("#pp-make-lev")?.addEventListener("click", async () => { try { await api("/prompts/pipelines", { method: "POST", body: { id: "ai-leverage" } }); toast("Two pipelines created."); } catch (e) { toast(e.message, true); } });
  box.querySelector("#pp-make-pipe")?.addEventListener("click", async () => { try { await api("/prompts/pipelines", { method: "POST", body: { id: "brain-dump-brief", inputs: inputs() } }); toast("Pipeline created from the brief."); } catch (e) { toast(e.message, true); } });
  box.querySelector("#pp-flags")?.addEventListener("click", async () => {
    const text = inputs().clients || "";
    try { await api("/prompts/links", { method: "POST", body: { key: "stalledFlags", text } }); toast("Red flags saved for Stalled client check."); } catch (e) { toast(e.message, true); }
  });
  box.querySelector("#pp-kling")?.addEventListener("click", () => {
    window.CC._mediaPrefill = { kind: "video", prompt: inputs().idea || "" };
    go("media");
    toast("Media is open. Nothing is generated until you click Generate.");
  });
}

window.CC.register({
  id: "prompts",
  tab: { label: "Pro prompts", short: "Prompts", icon: "✎", order: 18, render: renderTab },
  command: { order: 3, render(el) {
    el.innerHTML = "";
    const orders = document.getElementById("orders");
    if (!orders || orders.dataset.pp) { paintChip(); return; }
    orders.dataset.pp = "1";
    orders.addEventListener("input", () => {
      clearTimeout(timer);
      window.CC.S.lastOrders = orders.value;
      timer = setTimeout(() => consider(orders.value, false), 350);
    });
    paintChip();
  } },
  deliverable: { order: 3, render(el, run) {
    if (!run?.deliverable) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" style="margin-top:8px"><button class="btn sm" type="button" id="pp-save-run">Save this as a reusable prompt</button><span class="dim">Saved for next time. Nothing is sent.</span></div>`;
    el.querySelector("#pp-save-run").addEventListener("click", async () => {
      const text = (run.prompt || window.CC.S.lastOrders || run.deliverable || "").slice(0, 20000);
      const name = (pack?.name || run.title || "Saved prompt").slice(0, 60);
      try { await api("/prompts/save", { method: "POST", body: { name, text } }); toast("Saved. Find it under Pro prompts and Agents."); }
      catch (e) { toast(e.message, true); }
    });
  } },
  setup: { order: 4, render: mountInterview },
  settings: { order: 14, render(el) { el.innerHTML = `<div id="pp-settings"></div>`; mountInterview(el.querySelector("#pp-settings")); } },
});
