// Personas panel and the optional "Share to a persona section?" step (flag_personasections, 0.4.19).
// Sharing is template-only and a choice for each item. The preview shows exactly what would leave.
// Nothing is sent from here: a confirmed item waits in an outbox on this PC.
const CC = window.CC;

const STYLE = `
.ps-card{overflow-wrap:anywhere;word-break:break-word}
.ps-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
.ps-row>span{min-width:0;overflow-wrap:anywhere}
.ps-box{border-left:3px solid var(--violet);padding:6px 10px;margin:8px 0;overflow-wrap:anywhere}
.ps-pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:4px 0;font-size:12px}
.ps-card input[type=text],.ps-card select{max-width:100%;box-sizing:border-box}
`;
function ensureStyle() {
  if (document.getElementById("ps-style")) return;
  const s = document.createElement("style");
  s.id = "ps-style"; s.textContent = STYLE;
  document.head.appendChild(s);
}
const on = () => !!CC.S?.flags?.personasections;

async function renderPanel(el) {
  el.innerHTML = "";
  if (!on()) return;
  ensureStyle();
  const { api, esc, toast } = CC;
  const card = document.createElement("div");
  card.className = "panel ps-card";
  card.id = "ps-panel";
  card.setAttribute("aria-label", "Personas");
  el.appendChild(card);
  let d;
  const load = async () => {
    try { d = await api("/persona-sections"); } catch (e) { card.innerHTML = `<h3>Personas</h3><div class="dim small">${esc(e.message)}</div>`; return false; }
    return true;
  };
  const paint = () => {
    const open = d.sections.filter((s) => s.status === "active");
    card.innerHTML = `<h3>Personas <span class="right small dim">you decide what is shared, item by item</span></h3>
      <p class="small dim" style="margin:0 0 6px">${esc(d.note)}</p>
      <div class="small"><b>Sections</b> (hide the ones you do not want)</div>
      ${d.sections.map((s) => `<div class="ps-row" data-sec="${esc(s.id)}">
        <label class="row small" style="gap:6px"><input type="checkbox" data-target="${esc(s.id)}" ${d.targets.includes(s.id) ? "checked" : ""} ${s.status !== "active" || s.hidden ? "disabled" : ""}> <span>${esc(s.name)}${s.status !== "active" ? " (waiting for approval)" : ""}${s.hidden ? " (hidden)" : ""}</span></label>
        <button type="button" class="btn sm" data-hide="${esc(s.id)}" data-to="${s.hidden ? "0" : "1"}">${s.hidden ? "Show" : "Hide"}</button>
        ${s.custom && s.status !== "active" && d.owner ? `<button type="button" class="btn sm" data-approve="${esc(s.id)}">Approve</button>` : ""}
        ${s.custom ? `<button type="button" class="btn sm danger" data-rm="${esc(s.id)}">Remove</button>` : ""}
      </div>`).join("")}
      <div class="small dim">Ticked sections are the ones offered first when you share.</div>
      <div class="ps-row"><input type="text" id="ps-new" maxlength="30" placeholder="Add a section" aria-label="New section name"><button type="button" class="btn sm" id="ps-add">Add persona</button></div>
      <div class="small dim">${d.owner ? "As owner, a new section opens right away." : "A new section opens after approval."}</div>
      <div class="small" style="margin-top:10px"><b>Waiting to share</b></div>
      ${d.outbox.length ? d.outbox.map((o) => `<div class="ps-row"><span>${esc(o.name)} to ${esc(o.sectionName)}</span><button type="button" class="btn sm danger" data-wd="${esc(o.id)}">Withdraw</button></div>`).join("") : `<div class="small dim">Nothing is waiting.</div>`}
      <div class="ps-row"><button type="button" class="btn sm primary" id="ps-share" ${open.length ? "" : "disabled"}>Share a template</button></div>`;
  };
  const refresh = async () => { if (await load()) paint(); };
  await refresh();
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); await refresh(); } catch (e) { toast(e.message, true); } };
  card.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.hide) act(() => api(`/persona-sections/sections/${encodeURIComponent(t.dataset.hide)}/hide`, { method: "POST", body: { hidden: t.dataset.to === "1" } }));
    else if (t.dataset.approve) act(() => api(`/persona-sections/sections/${encodeURIComponent(t.dataset.approve)}/approve`, { method: "POST", body: {} }), "Section approved");
    else if (t.dataset.rm) act(() => api(`/persona-sections/sections/${encodeURIComponent(t.dataset.rm)}`, { method: "DELETE" }), "Removed");
    else if (t.dataset.wd) act(() => api(`/persona-sections/outbox/${encodeURIComponent(t.dataset.wd)}`, { method: "DELETE" }), "Withdrawn");
    else if (t.id === "ps-add") act(() => api("/persona-sections/sections", { method: "POST", body: { name: card.querySelector("#ps-new").value } }), "Added");
    else if (t.id === "ps-share") openShare({});
  });
  card.addEventListener("change", (e) => {
    if (!e.target.dataset?.target) return;
    const ids = [...card.querySelectorAll("[data-target]")].filter((x) => x.checked).map((x) => x.dataset.target);
    act(() => api("/persona-sections/targets", { method: "POST", body: { targets: ids } }));
  });
}

function dialog(html) {
  document.querySelector(".ps-dlg")?.remove();
  const el = document.createElement("div");
  el.className = "ps-dlg";
  el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:70";
  el.innerHTML = `<div class="panel ps-card" role="dialog" aria-modal="true" aria-labelledby="ps-title" style="width:min(640px,94vw);max-height:88vh;overflow:auto">${html}</div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) el.remove(); });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") el.remove(); });
  document.body.appendChild(el);
  el.querySelector("select, button")?.focus();
  return el;
}

// The optional step. source is { walkId } or { templateId }. With none, the person picks a saved template.
export async function openShare(source = {}) {
  if (!on()) return;
  ensureStyle();
  const { api, esc, toast } = CC;
  let d, templates = [];
  try { d = await api("/persona-sections"); } catch (e) { return toast(e.message, true); }
  if (!source.walkId && !source.templateId) {
    try { templates = (await api("/walkthrough/templates")).templates || []; } catch { templates = []; }
    if (!templates.length) return toast("Save a project as a template first, then share it here.", true);
  }
  const open = d.sections.filter((s) => s.status === "active" && !s.hidden);
  if (!open.length) return toast("Every section is hidden. Show one in Personas first.", true);
  const ordered = [...open.filter((s) => d.targets.includes(s.id)), ...open.filter((s) => !d.targets.includes(s.id))];
  const el = dialog(`<h3 id="ps-title">Share to a persona section?</h3>
    <p class="small" style="margin:4px 0 8px">Optional. Only the template shape is shared, never your own words. You see exactly what leaves before anything is saved.</p>
    ${templates.length ? `<label class="small" for="ps-tpl">Template</label><select id="ps-tpl">${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select>` : ""}
    <label class="small" for="ps-sec">Section</label>
    <select id="ps-sec">${ordered.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select>
    <div class="ps-row"><button type="button" class="btn sm primary" id="ps-prev">See what would be shared</button><button type="button" class="btn sm" data-close>Skip</button></div>
    <div id="ps-out"></div>`);
  const out = el.querySelector("#ps-out");
  const body = () => ({ ...source, ...(templates.length ? { templateId: el.querySelector("#ps-tpl").value } : {}), section: el.querySelector("#ps-sec").value });
  el.querySelector("#ps-prev").addEventListener("click", async () => {
    out.innerHTML = "";
    let p;
    try { p = await api("/persona-sections/preview", { method: "POST", body: body() }); }
    catch (e) { out.innerHTML = `<div class="ps-box" role="alert">${esc(e.message)}</div>`; return; }
    const x = p.payload;
    out.innerHTML = `<div class="ps-box"><b>This is exactly what would be shared with ${esc(x.sectionName)}</b>
      <div class="ps-pre"><b>Name:</b> ${esc(x.name)}\n<b>Type:</b> ${esc(x.type)}\n<b>Note:</b> ${esc(x.note || "none")}\n<b>Steps:</b>\n${x.steps.map((s, i) => `${i + 1}. ${esc(s.title)} (${esc(s.kind)}, ${esc(s.level)})`).join("\n") || "none"}\n<b>Persona tags:</b> ${esc(x.personas.join(", ") || "none")}</div></div>
      ${p.cleaned.length ? `<div class="small" role="note">Cleaned before showing: ${esc(p.cleaned.join("; "))}</div>` : ""}
      <div class="small dim">Never shared: ${p.never.map(esc).join("; ")}.</div>
      <label class="row small" style="gap:6px;margin-top:8px"><input type="checkbox" id="ps-ok"> <span>I checked this and I want to share it.</span></label>
      <div class="ps-row"><button type="button" class="btn sm primary" id="ps-go" disabled>Share this</button></div>`;
    const ok = out.querySelector("#ps-ok"), go = out.querySelector("#ps-go");
    ok.addEventListener("change", () => { go.disabled = !ok.checked; });
    go.addEventListener("click", async () => {
      go.disabled = true;
      try {
        const r = await api("/persona-sections/share", { method: "POST", body: { ...body(), hash: p.hash, confirm: true } });
        el.remove();
        toast(r.note || "Saved");
        document.getElementById("ps-panel") && CC.render?.();
      } catch (e) { out.insertAdjacentHTML("beforeend", `<div class="ps-box" role="alert">${esc(e.message)}</div>`); go.disabled = false; }
    });
  });
}

CC.sharePersonaSection = openShare;
CC.register({ id: "persona-sections", settings: { order: 40, render: renderPanel } });
