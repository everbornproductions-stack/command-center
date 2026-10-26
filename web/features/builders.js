// Guided builders. A card shows up only when the need is detected.
// Describe, Preview the AIs, Build, Test, Publish. Nothing is sent until Publish.
const { api, toast, esc } = window.CC;

const GROUPS = [
  { id: "highlevel", label: "HighLevel" },
  { id: "accounting", label: "Accounting" },
  { id: "business", label: "Business tools" },
];

let info = null;
let openId = "";
let preview = null;
let previewKey = "";
let job = null;
let lastBody = null;
let lastChecks = {};
let endResult = null; // the finished card for the open builder: { id, text, title, saved, posted, reason }

function fieldValue(root) {
  const body = {};
  root.querySelectorAll("[data-field]").forEach((el) => {
    body[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
  });
  body.useAi = !!root.querySelector("#builders-use-ai")?.checked;
  return body;
}
function formKey(body) { return JSON.stringify(body); }
function checksOf(root) {
  const checks = {};
  root.querySelectorAll("[data-check]").forEach((el) => { checks[el.dataset.check] = el.checked; });
  return checks;
}
function draftText(draft) {
  if (!draft) return "";
  if (draft.legalBlocked) return draft.line || "";
  const bits = [];
  if (draft.line) bits.push(draft.line);
  if (draft.message) bits.push(draft.message);
  if (draft.summary && draft.actions) bits.push(`${draft.summary} ${draft.actions.length ? `Actions: ${draft.actions.join("; ")}` : ""}`.trim());
  else if (draft.summary) bits.push(draft.summary);
  if (draft.headline) bits.push(`${draft.headline}. ${draft.line || ""} Button: ${draft.button || ""}`.trim());
  if (draft.reply) bits.push(draft.reply);
  if (draft.merchant || draft.total) bits.push([draft.merchant, draft.date, draft.total ? `Total ${draft.total}` : ""].filter(Boolean).join(". "));
  if (draft.from || draft.number) bits.push([draft.from, draft.number, draft.total ? `Total ${draft.total}` : ""].filter(Boolean).join(". "));
  if (draft.fields) bits.push(`Fields: ${draft.fields.join(", ")}. ${draft.sample?.email ? `Sample email ${draft.sample.email}.` : "No contact is created until you add an email."}`);
  if (draft.tags) bits.push(`Tags: ${draft.tags.join(", ")}.`);
  if (draft.welcome) bits.push(draft.welcome);
  if (draft.title && draft.minutes) bits.push(`${draft.title}, ${draft.minutes} minutes.`);
  if (draft.to && draft.number) bits.push(`${draft.number} for ${draft.to}. Amount ${draft.total || "0"}.`);
  if (draft.note && !bits.includes(draft.note)) bits.push(draft.note);
  return bits.filter(Boolean).join(" ");
}
function stepIndex() {
  const step = job?.step;
  if (step === "published") return 4;
  if (step === "tested") return 3;
  if (step === "built") return 2;
  if (preview) return 1;
  return 0;
}

function shell() {
  const steps = info?.steps || ["Describe", "Preview the AIs", "Build", "Test", "Publish"];
  const connected = info?.connections || {};
  const names = [connected.highlevel && "HighLevel", connected.quickbooks && "QuickBooks", connected.xero && "Xero"].filter(Boolean);
  return `<div id="builders-root">
    <div class="panel" style="margin-bottom:12px">
      <h3 style="margin-top:0">Builders</h3>
      <p class="small" style="margin:0 0 8px">Describe what you need. A builder shows up only when it fits. Nothing is sent, posted, or charged until you click Publish.</p>
      <p class="dim small" style="margin:0 0 8px">${names.length ? `Connected: ${esc(names.join(", "))}.` : "No HighLevel, QuickBooks, or Xero connection yet. You can still describe a need below."}</p>
      <label class="lbl" for="builders-need">What are you working on?</label>
      <textarea id="builders-need" style="min-height:72px;width:100%" placeholder="For example: a HighLevel lead form, a receipt, or a booking page"></textarea>
      <div class="row" style="margin-top:8px">
        <button type="button" class="btn sm primary" id="builders-show">Show builders</button>
      </div>
      <details style="margin-top:10px">
        <summary class="small">Connections and more options</summary>
        <p class="dim small">A token is saved in the vault and is not shown again. This does not send anything.</p>
        <label class="lbl" for="builders-service">Service</label>
        <select id="builders-service" style="width:100%">
          <option value="highlevel">HighLevel (Private Integration token)</option>
          <option value="quickbooks">QuickBooks</option>
          <option value="xero">Xero</option>
          <option value="chatwoot">Chatwoot</option>
          <option value="cal">Cal.com</option>
          <option value="docuseal">DocuSeal</option>
          <option value="invoiceninja">Invoice Ninja</option>
        </select>
        <label class="lbl" for="builders-token">Token</label>
        <input id="builders-token" type="password" autocomplete="off" style="width:100%">
        <label class="lbl" for="builders-extra">Location, company, or organisation id</label>
        <input id="builders-extra" type="text" autocomplete="off" style="width:100%" placeholder="HighLevel location, QuickBooks company, or Xero organisation">
        <label class="lbl" for="builders-url">Address, if this service asks for one</label>
        <input id="builders-url" type="url" autocomplete="off" style="width:100%" placeholder="Only for Chatwoot, DocuSeal, or Invoice Ninja">
        <button type="button" class="btn sm" id="builders-connect" style="margin-top:8px">Save connection</button>
        <div class="dim small" id="builders-conn" style="margin-top:6px"></div>
      </details>
    </div>
    <div id="builders-list"></div>
    <div id="builders-work"></div>
    <p class="dim small" style="margin-top:8px">${esc(steps.join(", "))}.</p>
  </div>`;
}

function listHtml() {
  const rows = info?.builders || [];
  if (!rows.length) return `<div class="panel"><p class="small" style="margin:0">No builder fits yet. Mention HighLevel, a receipt, an invoice, a booking, meeting notes, a contract, a review, or a chat box for your site.</p></div>`;
  return GROUPS.map((group) => {
    const items = rows.filter((b) => b.group === group.id);
    if (!items.length) return "";
    return `<div class="panel" style="margin-bottom:12px"><h3 style="margin-top:0">${esc(group.label)}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px">
      ${items.map((b) => `<button type="button" class="btn" data-open="${esc(b.id)}" style="text-align:left;height:auto;white-space:normal">
        <b>${esc(b.title)}</b>
        <div class="small">${esc(b.tier === "extreme" ? "Extreme" : b.tier === "pro" ? "Pro" : "Free")}. ${esc(b.summary || "")}</div>
        <div class="dim small">${esc(b.why || "")}</div>
      </button>`).join("")}
      </div></div>`;
  }).join("");
}

function workHtml() {
  const builder = (info?.builders || []).find((b) => b.id === openId);
  if (!builder) return "";
  const form = info?.forms?.[builder.id] || { fields: [] };
  const steps = info?.steps || [];
  const at = stepIndex();
  const visible = (form.fields || []).filter((f) => !f.advanced);
  const advanced = (form.fields || []).filter((f) => f.advanced);
  const checks = preview?.checks || form.checks || [];
  const gate = preview?.gate;
  const fresh = !!(preview && previewKey && lastBody && previewKey === formKey(lastBody));
  return `<div class="panel" id="builders-card">
    <h3 style="margin-top:0">${esc(builder.title)}</h3>
    <p class="small" style="margin-top:0">${esc(builder.publishNote || "")}</p>
    ${form.note ? `<p class="dim small">${esc(form.note)}</p>` : ""}
    <div id="builders-result" aria-live="polite"></div>
    <ol class="small" style="padding-left:18px">
      ${steps.map((name, i) => `<li${i === at ? ` aria-current="step"` : ""}><b>${esc(name)}</b></li>`).join("")}
    </ol>
    <div id="builders-form">
      ${visible.map((f) => fieldHtml(f)).join("")}
      <details style="margin-top:8px">
        <summary class="small">More options</summary>
        ${advanced.map((f) => fieldHtml(f)).join("")}
        <label class="small" style="display:block;margin-top:8px"><input type="checkbox" id="builders-use-ai"> Ask the AIs to rewrite this on Build. Off keeps the draft here and spends nothing.</label>
      </details>
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn sm" id="builders-preview">Preview the AIs</button>
        <button type="button" class="btn sm" id="builders-build" ${fresh && gate?.ok ? "" : "disabled"}>Build</button>
        <button type="button" class="btn sm" id="builders-test" ${job?.step === "built" || job?.step === "tested" ? "" : "disabled"}>Test</button>
        <button type="button" class="btn sm primary" id="builders-publish" ${job?.step === "tested" && gate?.ok !== false ? "" : "disabled"}>Publish</button>
      </div>
      <div id="builders-checks" style="margin-top:8px">${checksHtml(checks)}</div>
      <div id="builders-build-all" style="margin-top:10px"></div>
    </div>
    <div id="builders-preview-box" aria-live="polite" style="margin-top:12px">${previewHtml()}</div>
  </div>`;
}
function fieldHtml(f) {
  if (f.type === "checkbox") return `<label class="small" style="display:block;margin:8px 0"><input type="checkbox" data-field="${esc(f.id)}"> ${esc(f.label)}</label>`;
  if (f.type === "select") {
    const opts = (f.options || []).map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");
    return `<label class="lbl" for="bf-${esc(f.id)}">${esc(f.label)}</label><select id="bf-${esc(f.id)}" data-field="${esc(f.id)}" style="width:100%">${opts}</select>`;
  }
  if (f.type === "textarea") return `<label class="lbl" for="bf-${esc(f.id)}">${esc(f.label)}</label><textarea id="bf-${esc(f.id)}" data-field="${esc(f.id)}" style="min-height:72px;width:100%" placeholder="${esc(f.placeholder || "")}"></textarea>`;
  return `<label class="lbl" for="bf-${esc(f.id)}">${esc(f.label)}</label><input id="bf-${esc(f.id)}" data-field="${esc(f.id)}" type="text" autocomplete="off" style="width:100%" placeholder="${esc(f.placeholder || "")}" value="${esc(f.id === "sendTime" ? "10:00" : f.id === "tags" ? "new-lead, booked, customer" : f.id === "stages" ? "New, Contacted, Won" : f.id === "counts" ? "0, 0, 0" : f.id === "number" ? "INV-1001" : f.id === "welcome" ? "Hello. How can we help?" : f.id === "title" ? "A time to talk" : f.id === "minutes" ? "30" : "")}">`;
}
function checksHtml(checks) {
  if (!checks?.length) return "";
  return checks.map((c) => `<label class="small" style="display:block;margin:4px 0"><input type="checkbox" data-check="${esc(c.id)}"> ${esc(c.label)}</label>`).join("");
}
function previewHtml() {
  if (!preview) return `<p class="dim small" style="margin:0">Nothing is sent until you click Publish.</p>`;
  const who = preview.recipients || { ais: [], withheld: [] };
  const ais = (who.ais || []).map((a) => `<li><b>${esc(a.providerName || "AI")}</b> ${esc(a.name || "")}: ${esc(a.receives || "")}</li>`).join("");
  const held = (who.withheld || []).map((s) => `<li>${esc(s)}</li>`).join("");
  return `<h3 style="margin:0 0 8px">Preview</h3>
    <p class="small">${esc(preview.gate?.message || "")}</p>
    <p class="small">${esc(preview.publishNote || "")}</p>
    <div class="lbl">AIs that would receive your words</div><ul class="small">${ais}</ul>
    <div class="lbl">Service</div><p class="small">${esc(preview.service?.name || "")}: ${esc(preview.service?.receives || "")}</p>
    <div class="lbl">Not sent</div><ul class="small">${held}</ul>
    <div class="lbl">Draft</div><p class="small" style="white-space:pre-wrap">${esc(draftText(preview.draft))}</p>
    ${draftText(preview.draft).trim() ? `<div class="row small" id="builders-personas"></div>` : ""}`;
}

// The ending: a Result card with what was made, where it was saved, and Finish. Saved to MindMedia once per run.
function endText(draft) {
  const t = draftText(draft).trim();
  if (t) return t;
  try { return JSON.stringify(draft || {}, null, 2); } catch { return ""; }
}
async function finishRun(root, out, builderTitle, runJob, draft) {
  const CC = window.CC;
  const text = endText(draft || preview?.draft);
  const id = runJob?.id || out?.job?.id || "";
  if (!text.trim() || !CC.resultCard) return;
  const title = `${builderTitle || "Builder"} (${new Date().toISOString().slice(0, 10)})`;
  endResult = { id, text, title, posted: !!out?.posted, reason: out?.reason || "", saved: null };
  CC._lastResult = { kind: "text", text, name: title, source: "Builders" };
  try {
    const r = await CC.saveToMindMedia({ kind: "text", text, name: title, source: "Builders", status: out?.posted ? "Published" : "Draft", dedupeKey: `builder:${id}`, quiet: true });
    endResult.saved = { where: r.where || "Unfiled", projectId: r.projectId, assetId: r.items?.[0]?.id };
  } catch (e) { endResult.saved = { error: e.message || "Could not save to MindMedia." }; }
  paintEnd(root);
}
function paintEnd(root) {
  const CC = window.CC;
  const box = (root || document).querySelector("#builders-result");
  if (!box || !endResult || !CC.resultCard) return;
  const r = endResult;
  const saved = r.saved?.error ? `Not saved in MindMedia: ${r.saved.error}` : r.saved ? `Saved in MindMedia, ${r.saved.where}.` : "Saving to MindMedia...";
  box.innerHTML = "";
  box.appendChild(CC.resultCard({
    what: r.posted ? "Sent, and saved" : "Your draft is ready",
    detail: r.posted ? "" : (r.reason || "Saved on this computer. Nothing was sent."),
    savedWhere: saved,
    item: r.saved?.assetId ? { projectId: r.saved.projectId, assetId: r.saved.assetId } : null,
    actions: [{ label: "Finish", primary: true, onClick: () => { CC._lastResult = { kind: "text", text: r.text, name: r.title, source: "Builders" }; return CC.openFinishDrawer?.({ ...CC._lastResult, item: r.saved?.assetId ? { projectId: r.saved.projectId, assetId: r.saved.assetId, kind: "text" } : undefined }); } }],
  }));
}

function paint() {
  const root = document.getElementById("builders-root");
  if (!root) return;
  const list = root.querySelector("#builders-list");
  const work = root.querySelector("#builders-work");
  if (list) list.innerHTML = listHtml();
  if (work) work.innerHTML = workHtml();
  const conn = root.querySelector("#builders-conn");
  if (conn && info?.connections) {
    const c = info.connections;
    const on = Object.entries({ HighLevel: c.highlevel, QuickBooks: c.quickbooks, Xero: c.xero, Chatwoot: c.chatwoot, "Cal.com": c.cal, DocuSeal: c.docuseal, "Invoice Ninja": c.invoiceninja }).filter(([, v]) => v).map(([k]) => k);
    conn.textContent = on.length ? `Saved: ${on.join(", ")}.` : "Nothing saved from this form yet.";
  }
  wire(root);
  paintEnd(root);
  // Build it all for me: describe, then preview, build, test and publish in one go.
  const all = root.querySelector("#builders-build-all");
  if (all) {
    import("/build-all-ui.js").then(({ mountBuildAll }) => mountBuildAll(all, {
      surface: "builder",
      payload: () => { const input = fieldValue(root); return { builderId: openId, description: String(input.text || ""), input }; },
      onEnd: async (j) => {
        toast(j.status === "done" ? "Built it all." : (j.waiting?.reason || j.error || "Build it all for me stopped."));
        if (j.status !== "done" || !j.result?.draft) return;
        const title = (info?.builders || []).find((b) => b.id === openId)?.title;
        await finishRun(root, { posted: j.result.posted, reason: j.result.note }, title, { id: j.result.jobId || j.id }, j.result.draft);
      },
    })).catch(() => { /* the step by step buttons still work */ });
  }
  // Test with personas on the draft
  const pt = root.querySelector("#builders-personas");
  if (pt && window.CC.personaButton) pt.appendChild(window.CC.personaButton({ getText: () => draftText(preview?.draft), kind: "draft" }));
}
function markStale(root) {
  previewKey = "";
  const build = root.querySelector("#builders-build");
  const test = root.querySelector("#builders-test");
  const publish = root.querySelector("#builders-publish");
  if (build) build.disabled = true;
  if (test) test.disabled = true;
  if (publish) publish.disabled = true;
}
function wire(root) {
  root.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => {
    openId = btn.dataset.open;
    preview = null;
    previewKey = "";
    job = null;
    lastBody = null;
    lastChecks = {};
    endResult = null;
    paint();
  }));
  const form = root.querySelector("#builders-form");
  form?.addEventListener("input", (e) => {
    if (e.target?.dataset?.check) { lastChecks = checksOf(root); return; }
    markStale(root);
  });
  root.querySelector("#builders-preview")?.addEventListener("click", () => run(root, "preview"));
  root.querySelector("#builders-build")?.addEventListener("click", () => run(root, "build"));
  root.querySelector("#builders-test")?.addEventListener("click", () => run(root, "test"));
  root.querySelector("#builders-publish")?.addEventListener("click", () => run(root, "publish"));
}
function applyState(root) {
  if (lastBody) {
    root.querySelectorAll("[data-field]").forEach((el) => {
      if (!(el.dataset.field in lastBody)) return;
      if (el.type === "checkbox") el.checked = !!lastBody[el.dataset.field];
      else el.value = lastBody[el.dataset.field] ?? "";
    });
    const ai = root.querySelector("#builders-use-ai");
    if (ai) ai.checked = !!lastBody.useAi;
  }
  root.querySelectorAll("[data-check]").forEach((el) => { el.checked = !!lastChecks[el.dataset.check]; });
}
async function run(root, action, sendAnyway = false) {
  const body = fieldValue(root);
  lastBody = body;
  lastChecks = checksOf(root);
  if (action !== "preview" && formKey(body) !== previewKey) return toast("Preview this again before you continue.", true);
  const path = action === "preview" ? `/builders/${openId}/preview` : `/builders/${openId}/${action}`;
  const payload = action === "preview" ? body : { ...body, jobId: job?.id, confirm: action === "publish", checks: checksOf(root), ...(sendAnyway ? { sendAnyway: true } : {}) };
  try {
    const out = await api(path, { method: "POST", body: payload });
    if (action === "preview") {
      preview = out;
      previewKey = formKey(body);
      job = out.job;
    } else {
      job = out.job || job;
      if (out.draft) preview = { ...preview, draft: out.draft, gate: out.gate || preview?.gate };
    }
    paint();
    applyState(root);
    if (action === "publish") {
      toast(out.posted ? "Published after your click." : (out.reason || "Saved. Nothing was sent."));
      const title = (info?.builders || []).find((b) => b.id === openId)?.title;
      await finishRun(root, out, title, job, preview?.draft);
    }
    else if (action === "test") toast("Test finished. Nothing was sent.");
    else if (action === "build") toast(out.ai?.started ? "Build started." : "Draft built here. Nothing was sent.");
  } catch (e) {
    toast(e.message, true);
    if (e.warnings?.length && action === "publish") {
      const { showReview } = await import("../compliance-ui.js");
      const anchor = root.querySelector("#builders-checks") || root;
      showReview(anchor, e.warnings, { onFix: () => (root.querySelector("textarea, input[type=text]"))?.focus(), onSendAnyway: () => run(root, "publish", true) });
    }
  }
}
async function load(text) {
  info = await api(`/builders?text=${encodeURIComponent(text || "")}`);
}
async function render(view) {
  openId = "";
  preview = null;
  previewKey = "";
  job = null;
  const preset = sessionStorage.getItem("cc.builderText") || "";
  view.innerHTML = `<div class="panel"><p class="small">Loading builders.</p></div>`;
  try { await load(preset); } catch (e) { toast(e.message, true); info = { builders: [], steps: [], connections: {}, forms: {} }; }
  view.innerHTML = shell();
  const root = view.querySelector("#builders-root");
  const box = root.querySelector("#builders-need");
  if (preset && box) box.value = preset;
  paint();
  root.querySelector("#builders-show").addEventListener("click", async () => {
    try {
      await load(box.value);
      sessionStorage.setItem("cc.builderText", box.value);
      openId = "";
      preview = null;
      job = null;
      lastBody = null;
      lastChecks = {};
      paint();
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#builders-connect").addEventListener("click", async () => {
    const service = root.querySelector("#builders-service").value;
    const token = root.querySelector("#builders-token").value;
    const extra = root.querySelector("#builders-extra").value.trim();
    const url = root.querySelector("#builders-url").value.trim();
    const body = { service, token, url };
    if (service === "highlevel") body.locationId = extra;
    if (service === "quickbooks") body.realmId = extra;
    if (service === "xero") body.tenantId = extra;
    if (service === "chatwoot") body.accountId = extra || "1";
    try {
      await api("/builders/connect", { method: "POST", body });
      root.querySelector("#builders-token").value = "";
      toast("Saved. The token is not shown again.");
      await load(box.value);
      paint();
    } catch (e) { toast(e.message, true); }
  });
}

function renderHint(container) {
  container.innerHTML = "";
  const box = document.querySelector("#orders");
  const paintHint = async (text) => {
    if (!document.body.contains(container)) return;
    let found = [];
    try { found = (await api("/builders/detect", { method: "POST", body: { text: text || "" } })).builders || []; } catch { return; }
    if (!document.body.contains(container)) return;
    if (!found.length) { container.innerHTML = ""; return; }
    container.innerHTML = `<div class="panel" style="margin-top:10px"><div class="small"><b>A builder fits this.</b> Nothing is sent from here.</div>
      <div class="row" style="margin-top:6px;flex-wrap:wrap">${found.slice(0, 4).map((b) => `<button type="button" class="btn sm" data-go="${esc(b.id)}">${esc(b.title)}</button>`).join("")}</div></div>`;
    container.querySelectorAll("[data-go]").forEach((btn) => btn.addEventListener("click", () => {
      sessionStorage.setItem("cc.builderText", document.querySelector("#orders")?.value || text || "");
      window.CC.go("builders");
    }));
  };
  paintHint(box?.value || "");
  if (box && !box.dataset.buildersWatch) {
    box.dataset.buildersWatch = "1";
    let timer = 0;
    box.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => paintHint(box.value), 500);
    });
  }
}

CC.register({
  id: "builders",
  tab: { label: "Builders", short: "Builders", icon: "✎", order: 26, render },
  command: { order: 42, render: renderHint },
});
